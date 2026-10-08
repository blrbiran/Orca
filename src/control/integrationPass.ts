import { readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ControlError } from "./errors.js";
import { groupRepoId, groupStopped, write } from "./executionDriver.js";
import {
  BranchMissing, ChildTimeout, RemoteFailure, conflictedNames, fetchInto, gitChild, gitOk, isAncestor, oneLine, pushPorcelain, refTip, remoteHas, revParse,
} from "./integrationGit.js";
import { advanceIntegrationResolution, copyOwner, materialiseIntegrationConflict, nextAttempt } from "./integrationResolve.js";
import { syncGroupPr } from "./integrationPr.js";
import { githubRepoOf, readGroupIntegration, remoteUrl, type GroupIntegration, type IntegrationScheme } from "./integrationScheme.js";
import { readGroup, saveGroup } from "./queries.js";
import { removeOwnPath, workBranchRef, type WorkspaceRoots } from "./workspace.js";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { runTask } from "../scheduler/ccloopRunner.js";

/**
 * Integration spec §5-§6: once per driver round, after the runs and the requirement exports, each due group's landed
 * work is carried to where its scheme says -- a local branch, a remote branch, the group's own branch on a remote.
 * One group at a time, in group id order; every git child is bounded (integrationGit.ts).
 */
export type IntegrationCrashPoint = "after-pending" | "after-publish" | "after-pr-create" | "after-pr-ready";
export interface IntegrationDeps {
  store: ControlStore; roots: WorkspaceRoots; repoPathOf(repoId: string): string; now(): number;
  /** The `gh` the PR step (spec §6.4, Task 4) runs. */
  ghBin: string;
  /** Test-only fault injection: a throw here ends the pass as a process death would (no record is written after it). */
  crash?: (point: IntegrationCrashPoint) => void;
  admissionGate?: AdmissionGate;
  stopped(): boolean;
  /** Test seam: runs between computing `new` and publishing it (a remote that moves in between). */
  beforePublish?: () => Promise<void>;
  /**
   * spec §7: what a conflict's resolution run is spawned with (the driver's ccloop, agents table and its map of
   * background runs, shared with the landing reconciliations). Absent: `resolving` groups are not advanced.
   */
  resolution?: { ccloopBin: string; agentsTablePath: string; reconciling: Map<string, Promise<void>>; runTask: typeof runTask };
}

type Scheme = Exclude<IntegrationScheme, { delivery: "keep" }>;
type Outcome =
  /** `pr` is the `github-pr` delivery's PR record, written with the rest (§6.1 step 6). */
  | { kind: "done"; tip: string; integrated: string | null; pr?: GroupIntegration["pr"] }
  | { kind: "blocked"; reason: string }
  /**
   * `materialised` is the conflict re-created in its copy (spec §7), null when the copy did not reproduce it; `attempt`
   * is the number it was given (nextAttempt).
   */
  | { kind: "conflict"; base: string; tip: string; paths: string[]; attempt?: number; materialised?: GroupIntegration["conflict"] }
  /** spec §7: a resolution finished on a base that has moved since; it is dropped and the integration starts over. */
  | { kind: "discarded" }
  | { kind: "transient"; message: string }
  /** The scheme changed while this integration ran: nothing is recorded (spec §6.1 step 6). */
  | { kind: "dropped" };

/** A throw from the crash hook, carried past the per-group handler unchanged. */
class Crashed { constructor(readonly error: unknown) {} }
function crash(deps: IntegrationDeps, point: IntegrationCrashPoint): void {
  try { deps.crash?.(point); } catch (error) { throw new Crashed(error); }
}

const BACKOFF_START_MS = 30_000, BACKOFF_MAX_MS = 600_000;
const integrationPathOf = (roots: WorkspaceRoots, groupId: string): string => join(roots.workspacesRoot, `integrate-${groupId}`);
/** Orca's own refs in the target repository for what an integration fetched (the person's FETCH_HEAD is never written). */
const fetchedRefOf = (groupId: string, what: "target" | "work"): string => `refs/orca/integration/${groupId}/${what}`;

/** spec §5: answers whether any group's integration record moved to a new state (a transient failure does not count). */
export async function integratePendingGroups(deps: IntegrationDeps): Promise<boolean> {
  let moved = false;
  // spec §5: every group whose conflict an agent is resolving is advanced first (spec §7).
  for (const row of deps.store.db.prepare("SELECT id FROM groups WHERE json_extract(body,'$.integration.state')='resolving' ORDER BY id").all()) {
    if (deps.stopped() || deps.admissionGate?.draining === true) return moved;
    try { if (await advanceIntegrationResolution(deps, String(row.id))) moved = true; }
    catch (error) {
      if (error instanceof Crashed) throw error.error;
      // Left as it is and tried again next round (a resolution's own failures are recorded by it as a conflict).
      process.stderr.write(`orca-driver: integration ${String(row.id)}: ${describe(error)}\n`);
    }
  }
  const copies = conflictCopies(deps.roots);
  // Fix round 1 (M1): a remote (repository path + remote name) that timed out in this round is not tried again by a
  // later group of the same round, so a hung remote costs one timeout per round, not one per group.
  const unreachable = new Set<string>();
  for (const row of deps.store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
    // A stopped driver or a draining panel ends the pass before the next group (a draining panel refuses every write).
    if (deps.stopped() || deps.admissionGate?.draining === true) break;
    const groupId = String(row.id);
    let integration: GroupIntegration | null;
    try { integration = readGroupIntegration(JSON.parse(String(row.body))); }
    catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`); continue; }
    // spec §7: a group with no conflict on record (its integration succeeded, or its scheme changed) owns no copy.
    if (copies.has(groupId) && (integration === null || integration.conflict === null)) {
      try { for (const copy of copies.get(groupId)!) await removeOwnPath(deps.repoPathOf(groupRepoId(deps.store, groupId)), deps.roots, copy); }
      catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`); }
    }
    // A keep group (no record) is never looked at further: no git child runs for it (review focus 1).
    if (integration === null || !integration.frozen || integration.state !== "idle") continue;
    if (integration.retryAfter !== null && integration.retryAfter > deps.now()) continue;
    // Ruling R7: a stopped or person-paused group waits; a budget-blocked one still integrates what it landed.
    if (groupStopped(deps.store, groupId)) continue;
    let outcome: Outcome | null;
    try { outcome = await integrateGroup(deps, groupId, integration, unreachable); }
    catch (error) {
      if (error instanceof Crashed) throw error.error;
      // Anything else is this group's alone (a panel that began draining refuses the settle write below, which ends the
      // pass) and is retried after the backoff; the round goes on to the next group.
      process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`);
      outcome = { kind: "transient", message: describe(error) };
    }
    if (outcome !== null && settle(deps, groupId, integration.schemeHash, outcome)) moved = true;
  }
  return moved;
}

/** spec §7: the conflict copies in the workspaces root, by the group that owns them. */
function conflictCopies(roots: WorkspaceRoots): Map<string, string[]> {
  const byGroup = new Map<string, string[]>();
  for (const name of readdirSync(roots.workspacesRoot)) {
    const owner = copyOwner(name);
    if (owner !== null) byGroup.set(owner, [...(byGroup.get(owner) ?? []), join(roots.workspacesRoot, name)]);
  }
  return byGroup;
}

function describe(error: unknown): string {
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/** spec §5: every task-kind work item done and no run active (a reconciling run is active). */
function groupComplete(store: ControlStore, groupId: string): boolean {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  if (tasks.some((work) => work.status !== "done")) return false;
  return store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(groupId) === undefined;
}

/**
 * spec §5, before the first integration: `orca/<g>` holds no landed work while its tip is already in the target (it was
 * created from the repository's HEAD). Judged on local refs only, so a group with nothing landed costs no network.
 */
async function nothingLanded(repo: string, scheme: Scheme, tip: string): Promise<boolean> {
  const candidates = [`refs/heads/${scheme.target}`, ...("remote" in scheme ? [`refs/remotes/${scheme.remote}/${scheme.target}`] : [])];
  for (const ref of candidates) {
    const at = await refTip(repo, ref);
    if (at !== null && await isAncestor(repo, tip, at)) return true;
  }
  return false;
}

/** One group's integration; null when it is not due. */
async function integrateGroup(deps: IntegrationDeps, groupId: string, integration: GroupIntegration, unreachable: Set<string>): Promise<Outcome | null> {
  const scheme = integration.scheme as Scheme;
  const repo = deps.repoPathOf(groupRepoId(deps.store, groupId));
  const remoteKey = "remote" in scheme ? `${repo}\0${scheme.remote}` : null;
  if (remoteKey !== null && unreachable.has(remoteKey)) return null;
  const tip = await refTip(repo, workBranchRef(groupId));
  if (tip === null) return null;
  // Nothing new landed: only a `github-pr` group can still be due. With no PR recorded (a group switched to `github-pr`
  // after integrating under another scheme, or whose PR target changed) it pushes and opens one (ruling, fix round 1
  // R1); with a draft PR and the group complete it only marks it ready (spec §5).
  const caughtUp = tip === integration.lastIntegrated;
  let readyOnly = false;
  if (caughtUp) {
    if (scheme.delivery !== "github-pr") return null;
    if (integration.pr !== null) {
      if (integration.pr.ready || !groupComplete(deps.store, groupId)) return null;
      readyOnly = true;
    }
  }
  if (scheme.trigger === "group" && !groupComplete(deps.store, groupId)) return null;
  // A write-ahead record of this scheme is always finished (§6.1 step 2): a `merge` published before a crash leaves the
  // tip in the target, which is not "nothing landed" but an integration whose record was never settled (Task 5).
  if (reentry(integration) === null && (integration.lastIntegrated === null || (caughtUp && !readyOnly)) && await nothingLanded(repo, scheme, tip)) return null;
  try {
    if (readyOnly) return await finishWorkBranch(deps, repo, groupId, integration, scheme as Extract<Scheme, { delivery: "github-pr" }>, tip);
    if (scheme.delivery === "local" || scheme.delivery === "push-target") {
      const outcome = scheme.delivery === "local" ? await integrateLocal(deps, repo, groupId, integration, scheme, tip) : await integratePushTarget(deps, repo, groupId, integration, scheme, tip);
      if (outcome.kind !== "conflict") return outcome;
      // spec §7: the conflict is re-created for an agent and pinned; nothing is dispatched until an owner approves.
      const attempt = nextAttempt(deps.store, groupId, integration);
      return { ...outcome, attempt, materialised: await materialiseIntegrationConflict({ roots: deps.roots, repo }, groupId, outcome.base, outcome.tip, scheme.method, attempt, integration.lastIntegrated) };
    }
    return await integrateWorkBranch(deps, repo, groupId, integration, scheme, tip);
  } catch (error) {
    return failureOutcome(error, scheme, remoteKey, unreachable);
  }
}

/** A failure of a delivery's git children, by name (or rethrown for the pass's handler, which backs it off). */
function failureOutcome(error: unknown, scheme: Scheme, remoteKey: string | null, unreachable: Set<string>): Outcome {
  // A child that timed out is left to the pass's own handler, which backs it off like any transient; one that was
  // talking to the remote marks the remote unreachable for the rest of this round.
  // Only a git child talks to the remote; a gh timeout says nothing about it (fix round 1, M1).
  if (error instanceof ChildTimeout && error.bin === "git" && remoteKey !== null && "remote" in scheme && error.args.includes(scheme.remote)) unreachable.add(remoteKey);
  // Fix round 1 (I2): a configured remote that answers with anything but the network refuses like a push, with git's
  // words; integration-remote-missing is only a remote that is not configured.
  if (error instanceof RemoteFailure) return error.transient ? { kind: "transient", message: error.message } : { kind: "blocked", reason: `integration-push-refused:${error.message}` };
  if (error instanceof BranchMissing) return { kind: "blocked", reason: "integration-target-missing" };
  throw error;
}

async function remoteConfigured(repo: string, remote: string): Promise<boolean> {
  return (await remoteUrl(repo, remote)) !== null;
}

/** spec §6.1 step 2: a write-ahead record of this scheme whose `new` the target already holds is finished, not redone. */
function reentry(integration: GroupIntegration): NonNullable<GroupIntegration["pending"]> | null {
  return integration.pending !== null && integration.pending.schemeHash === integration.schemeHash ? integration.pending : null;
}

/** `push-branch` (and the push half of `github-pr`): `orca/<g>` itself goes to the remote, never forced. */
async function integrateWorkBranch(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, scheme: Extract<Scheme, { delivery: "push-branch" | "github-pr" }>, tip: string): Promise<Outcome> {
  if (!(await remoteConfigured(repo, scheme.remote))) return { kind: "blocked", reason: "integration-remote-missing" };
  const branch = `orca/${groupId}`;
  const pending = reentry(integration);
  if (pending !== null && await remoteHas(repo, scheme.remote, branch, pending.new, fetchedRefOf(groupId, "work"))) {
    return finishWorkBranch(deps, repo, groupId, integration, scheme, pending.tip);
  }
  if (!recordPending(deps, groupId, integration.schemeHash, { schemeHash: integration.schemeHash, tip, base: tip, new: tip })) return { kind: "dropped" };
  crash(deps, "after-pending");
  await deps.beforePublish?.();
  // A remote that already has the tip answers "up to date", which is success like any other accepted push.
  const pushed = await pushPorcelain(repo, scheme.remote, `${tip}:refs/heads/${branch}`);
  if (pushed === "moved") return { kind: "blocked", reason: "integration-work-branch-diverged" };
  const failed = pushFailure(pushed);
  if (failed !== null) return failed;
  crash(deps, "after-publish");
  return finishWorkBranch(deps, repo, groupId, integration, scheme, tip);
}

/** spec §6.1 step 5: for `github-pr`, the group's PR (§6.4); `push-branch` is done once its branch is pushed. */
async function finishWorkBranch(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, scheme: Extract<Scheme, { delivery: "push-branch" | "github-pr" }>, tip: string): Promise<Outcome> {
  if (scheme.delivery !== "github-pr") return { kind: "done", tip, integrated: tip };
  // The raw configured URL names the repository (not `remote get-url`, which applies insteadOf); confirm checked it,
  // and a remote re-pointed since is refused by name rather than letting gh guess.
  const github = githubRepoOf((await remoteUrl(repo, scheme.remote)) ?? "");
  if (github === null) return { kind: "blocked", reason: `integration-pr-refused:remote ${scheme.remote} no longer names a GitHub repository` };
  const firstLine = groupGoalSchema.parse(readGroup(deps.store, groupId)).plan.goal.split(/\r?\n/)[0]!;
  const synced = await syncGroupPr({
    ghBin: deps.ghBin, repo: `${github.host}/${github.slug}`, head: `orca/${groupId}`, base: scheme.target, cwd: repo,
    // A goal whose first line is blank still gives the PR a title (fix round 1, M3).
    title: firstLine.trim() === "" ? `orca/${groupId}` : firstLine.slice(0, 256), body: prBody(deps.store, groupId, scheme.target),
    draft: scheme.trigger === "task", complete: groupComplete(deps.store, groupId), pr: integration.pr,
    onStep: (step) => crash(deps, step),
  });
  if ("pr" in synced) return { kind: "done", tip, integrated: tip, pr: synced.pr };
  if ("blocked" in synced) return { kind: "blocked", reason: synced.blocked };
  return { kind: "transient", message: synced.transient };
}

const groupGoalSchema = z.object({ plan: z.object({ goal: z.string().min(1) }).passthrough() }).passthrough();

/** The PR body: what Orca knows about the group, nothing secret (no paths, no tokens). */
function prBody(store: ControlStore, groupId: string, target: string): string {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  return `Opened by Orca for group \`${groupId}\`: its landed work on \`orca/${groupId}\`, into \`${target}\`.\n\n`
    + `Tasks landed: ${tasks.filter((work) => work.status === "done").length} of ${tasks.length}.\n`;
}

function pushFailure(pushed: Awaited<ReturnType<typeof pushPorcelain>>): Outcome | null {
  if (pushed === "ok" || pushed === "moved") return null;
  if ("refused" in pushed) return { kind: "blocked", reason: `integration-push-refused:${pushed.refused}` };
  return pushed.transient ? { kind: "transient", message: pushed.failed } : { kind: "blocked", reason: `integration-push-refused:${pushed.failed}` };
}

/** The squash commit's subject: how many landings (first-parent commits of the work branch) it carries. */
async function squashMessage(repo: string, groupId: string, integration: GroupIntegration, base: string, tip: string): Promise<string> {
  const mergeBase = integration.lastIntegrated ?? (await gitOk(repo, ["merge-base", tip, base])).trim();
  const landings = (await gitOk(repo, ["rev-list", "--count", "--first-parent", `${mergeBase}..${tip}`])).trim();
  return `orca: integrate ${groupId} (${landings} landings)`;
}

type Computed = { kind: "new"; commit: string } | { kind: "conflict"; paths: string[] };

/**
 * spec §6.2: `new` on top of `base`. `merge` merges the tip --no-ff in the integration workspace (parents base, tip);
 * `squash` is one commit whose tree is the three-way merge of the new work with `lastIntegrated` as merge base, so work
 * an earlier integration already carried is never re-applied over what the person did since.
 */
async function computeNew(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, method: "merge" | "squash", base: string, tip: string): Promise<Computed> {
  if (method === "squash") {
    const mergeBase = integration.lastIntegrated ?? (await gitOk(repo, ["merge-base", tip, base])).trim();
    const merged = await gitChild(repo, ["merge-tree", "--write-tree", "--name-only", `--merge-base=${mergeBase}`, base, tip]);
    if (merged.code === 1) return { kind: "conflict", paths: conflictedNames(merged.stdout) };
    if (merged.code !== 0) throw new Error(`git merge-tree: ${oneLine(merged.stderr)}`);
    const tree = merged.stdout.split("\n")[0]!.trim();
    const commit = (await gitOk(repo, [...ORCA_IDENTITY, "commit-tree", tree, "-p", base, "-m", await squashMessage(repo, groupId, integration, base, tip)])).trim();
    return { kind: "new", commit };
  }
  const workspace = integrationPathOf(deps.roots, groupId);
  await removeOwnPath(repo, deps.roots, workspace);
  try {
    await gitOk(repo, ["worktree", "add", "--detach", workspace, base]);
    const merged = await gitChild(workspace, [...ORCA_IDENTITY, "merge", "--no-ff", "-m", `orca: integrate ${groupId}`, tip]);
    if (merged.code !== 0) {
      const unmerged = (await gitOk(workspace, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter((line) => line.length > 0);
      if (unmerged.length === 0) throw new Error(`git merge: ${oneLine(merged.stderr || merged.stdout)}`);
      await gitChild(workspace, ["merge", "--abort"]);
      return { kind: "conflict", paths: unmerged };
    }
    return { kind: "new", commit: await revParse(workspace, "HEAD") };
  } finally { await removeOwnPath(repo, deps.roots, workspace); }
}

type Published = "ok" | "moved" | Outcome;

/** Where a delivery that computes `new` on a base reads that base and publishes `new` (spec §6.1 steps 3-4, §6.3). */
interface Delivery { readBase(): Promise<string>; publish(next: string, base: string): Promise<Published> }

/**
 * spec §6.1 steps 3-4: write-ahead, publish; a base that moved in between clears the record and answers "moved".
 */
async function writeAheadAndPublish(deps: IntegrationDeps, groupId: string, integration: GroupIntegration, tip: string, base: string, next: string, delivery: Delivery): Promise<Outcome | "moved"> {
  if (!recordPending(deps, groupId, integration.schemeHash, { schemeHash: integration.schemeHash, tip, base, new: next })) return { kind: "dropped" };
  crash(deps, "after-pending");
  await deps.beforePublish?.();
  const published = await delivery.publish(next, base);
  if (published === "moved") return recordPending(deps, groupId, integration.schemeHash, null) ? "moved" : { kind: "dropped" };
  if (published !== "ok") return published;
  crash(deps, "after-publish");
  return { kind: "done", tip, integrated: next };
}

/**
 * spec §6.1 steps 3-4 for the deliveries that compute `new` on a base: on a base that moved in between, fetch again and
 * recompute once; moved again blocks integration-target-moved.
 */
async function computeAndPublish(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, method: "merge" | "squash", tip: string, delivery: Delivery): Promise<Outcome> {
  for (let attempt = 0; ; attempt += 1) {
    const base = await delivery.readBase();
    // The target already contains the tip: nothing to carry, and what was integrated stays as it was.
    if (await isAncestor(repo, tip, base)) return { kind: "done", tip, integrated: integration.integratedCommit };
    const computed = await computeNew(deps, repo, groupId, integration, method, base, tip);
    if (computed.kind === "conflict") return { kind: "conflict", base, tip, paths: computed.paths };
    const published = await writeAheadAndPublish(deps, groupId, integration, tip, base, computed.commit, delivery);
    if (published !== "moved") return published;
    if (attempt > 0) return { kind: "blocked", reason: "integration-target-moved" };
  }
}

/** `local`: `refs/heads/<target>` of the target repository moves to `new` (spec §6.3 when a worktree has it checked out). */
function localDelivery(repo: string, scheme: Extract<Scheme, { delivery: "local" }>): Delivery {
  const ref = `refs/heads/${scheme.target}`;
  return {
    readBase: async () => { const at = await refTip(repo, ref); if (at === null) throw new BranchMissing(scheme.target); return at; },
    publish: async (next, base) => {
      const checkedOut = await worktreeOf(repo, ref);
      if (checkedOut === null) {
        if ((await gitChild(repo, ["update-ref", ref, next, base])).code === 0) return "ok";
        if ((await refTip(repo, ref)) !== base) return "moved";
        throw new Error(`update-ref ${ref}: refused while still at ${base}`);
      }
      // H5: only a clean worktree, and only a fast-forward of its HEAD; the person's files are otherwise not touched.
      // --no-optional-locks: the check never writes the person's index back (a stale stat cache would make it).
      if ((await gitOk(checkedOut, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"])).trim().length > 0) return { kind: "blocked", reason: "integration-worktree-dirty" };
      if (!(await isAncestor(repo, await revParse(checkedOut, "HEAD"), next))) return { kind: "blocked", reason: "integration-not-fast-forward" };
      await gitOk(checkedOut, ["merge", "--ff-only", "--quiet", next]);
      return "ok";
    },
  };
}

async function integrateLocal(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, scheme: Extract<Scheme, { delivery: "local" }>, tip: string): Promise<Outcome> {
  const pending = reentry(integration);
  if (pending !== null) {
    const current = await refTip(repo, `refs/heads/${scheme.target}`);
    if (current !== null && (current === pending.new || await isAncestor(repo, pending.new, current))) return { kind: "done", tip: pending.tip, integrated: pending.new };
  }
  return computeAndPublish(deps, repo, groupId, integration, scheme.method, tip, localDelivery(repo, scheme));
}

/** The worktree of the target repository that has `ref` checked out, if any. */
async function worktreeOf(repo: string, ref: string): Promise<string | null> {
  let path: string | null = null;
  for (const line of (await gitOk(repo, ["worktree", "list", "--porcelain"])).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch ${ref}` && path !== null) return path;
  }
  return null;
}

/** `push-target`: `new` computed on the freshly fetched `<remote>/<target>` and pushed there, never forced. */
function pushTargetDelivery(repo: string, groupId: string, scheme: Extract<Scheme, { delivery: "push-target" }>): Delivery {
  return {
    readBase: () => fetchInto(repo, scheme.remote, scheme.target, fetchedRefOf(groupId, "target")),
    publish: async (next) => {
      const pushed = await pushPorcelain(repo, scheme.remote, `${next}:refs/heads/${scheme.target}`);
      if (pushed === "moved") return "moved";
      return pushFailure(pushed) ?? "ok";
    },
  };
}

async function integratePushTarget(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, scheme: Extract<Scheme, { delivery: "push-target" }>, tip: string): Promise<Outcome> {
  if (!(await remoteConfigured(repo, scheme.remote))) return { kind: "blocked", reason: "integration-remote-missing" };
  const pending = reentry(integration);
  if (pending !== null && await remoteHas(repo, scheme.remote, scheme.target, pending.new, fetchedRefOf(groupId, "target"))) return { kind: "done", tip: pending.tip, integrated: pending.new };
  return computeAndPublish(deps, repo, groupId, integration, scheme.method, tip, pushTargetDelivery(repo, groupId, scheme));
}

/**
 * spec §7, a resolution that finished with no markers: `new` is the resolved tree as a merge (parents base, tip) or as
 * one squash commit on base, then §6.1 from step 3. A base that moved since the conflict discards it (the integration
 * starts over at idle and may conflict again). Answers whether the record moved.
 */
export async function finishResolvedIntegration(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, tree: string): Promise<boolean> {
  const scheme = integration.scheme as Extract<Scheme, { delivery: "local" | "push-target" }>, conflict = integration.conflict!;
  const delivery = scheme.delivery === "local" ? localDelivery(repo, scheme) : pushTargetDelivery(repo, groupId, scheme);
  let outcome: Outcome;
  try {
    const base = await delivery.readBase();
    if (base !== conflict.base) outcome = { kind: "discarded" };
    else {
      const next = scheme.method === "merge"
        ? (await gitOk(repo, [...ORCA_IDENTITY, "commit-tree", tree, "-p", base, "-p", conflict.tip, "-m", `orca: integrate ${groupId}`])).trim()
        : (await gitOk(repo, [...ORCA_IDENTITY, "commit-tree", tree, "-p", base, "-m", await squashMessage(repo, groupId, integration, base, conflict.tip)])).trim();
      const published = await writeAheadAndPublish(deps, groupId, integration, conflict.tip, base, next, delivery);
      outcome = published === "moved" ? { kind: "discarded" } : published;
    }
  } catch (error) {
    // A crash (Crashed) is rethrown by failureOutcome like anything else it does not name.
    outcome = failureOutcome(error, scheme, null, new Set());
  }
  return settle(deps, groupId, integration.schemeHash, outcome);
}

/** The write-ahead record (null clears it), only while the group still has this scheme. */
function recordPending(deps: IntegrationDeps, groupId: string, hash: string, pending: GroupIntegration["pending"]): boolean {
  return write(deps, () => {
    const group = readGroup(deps.store, groupId);
    const current = readGroupIntegration(group);
    if (current === null || current.schemeHash !== hash) return false;
    saveGroup(deps.store, { ...group, integration: { ...current, pending } } as typeof group);
    return true;
  });
}

/**
 * spec §6.1 step 6 and §6.5: one write that re-reads the group; a record whose scheme changed meanwhile is dropped (the
 * new scheme starts over). Answers whether the record moved to a new state.
 */
function settle(deps: IntegrationDeps, groupId: string, hash: string, outcome: Outcome): boolean {
  if (outcome.kind === "dropped") return false;
  return write(deps, () => {
    const group = readGroup(deps.store, groupId);
    const current = readGroupIntegration(group);
    if (current === null || current.schemeHash !== hash) return false;
    let next: GroupIntegration;
    switch (outcome.kind) {
      case "done":
        // A success ends any conflict: the record and its resolution go (and the pass then removes its copies, spec §7).
        next = { ...current, lastIntegrated: outcome.tip, integratedCommit: outcome.integrated, pending: null, state: "idle", reason: null, retryAfter: null, transient: 0,
          conflict: null, resolution: null, ...(outcome.pr === undefined ? {} : { pr: outcome.pr }) };
        break;
      case "blocked":
        // A finished resolution's record goes with it (fix round 1, F1): it must not outlive a retry or the next conflict.
        next = { ...current, state: "blocked", reason: outcome.reason, pending: null, retryAfter: null, transient: 0, resolution: null };
        break;
      case "conflict": {
        // spec §7: recorded with its materialised copy, and nothing is dispatched until an owner approves.
        const attempt = outcome.attempt ?? nextAttempt(deps.store, groupId, current);
        next = { ...current, state: "conflict", reason: outcome.materialised === null ? "integration-conflict-unreproducible" : "integration-conflict", pending: null,
          retryAfter: null, transient: 0, attempts: Math.max(current.attempts, attempt),
          conflict: outcome.materialised ?? { attempt, key: `integrate-${groupId}-${attempt}`, base: outcome.base, tip: outcome.tip, paths: outcome.paths } };
        break;
      }
      case "discarded":
        // spec §7: the base moved while the resolution ran; the next round computes the integration again. A write-ahead
        // record is kept: a target already holding its `new` is then finished, not redone (§6.1 step 2).
        next = { ...current, state: "idle", reason: null, resolution: null };
        break;
      case "transient":
        next = { ...current, retryAfter: deps.now() + Math.min(BACKOFF_START_MS * 2 ** current.transient, BACKOFF_MAX_MS), transient: current.transient + 1 };
        break;
    }
    saveGroup(deps.store, { ...group, integration: next } as typeof group);
    return outcome.kind !== "transient";
  });
}
