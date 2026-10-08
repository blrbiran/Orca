import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ControlError } from "./errors.js";
import { groupRepoId, groupStopped, write } from "./executionDriver.js";
import {
  BranchMissing, ChildTimeout, RemoteFailure, fetchInto, gitChild, gitOk, isAncestor, oneLine, pushPorcelain, refTip, remoteHas, remoteTip, revParse,
} from "./integrationGit.js";
import { readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "./integrationScheme.js";
import { readGroup, saveGroup } from "./queries.js";
import { workBranchRef, type WorkspaceRoots } from "./workspace.js";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";

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
}

type Scheme = Exclude<IntegrationScheme, { delivery: "keep" }>;
type Outcome =
  | { kind: "done"; tip: string; integrated: string | null }
  | { kind: "blocked"; reason: string }
  | { kind: "conflict"; base: string; tip: string; paths: string[] }
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
  const halted = (): boolean => deps.stopped() || deps.admissionGate?.draining === true;
  if (halted()) return false;
  let moved = false;
  for (const row of deps.store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
    if (halted()) break;
    const groupId = String(row.id);
    let integration: GroupIntegration | null;
    try { integration = readGroupIntegration(JSON.parse(String(row.body))); }
    catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`); continue; }
    // A keep group (no record) is never looked at further: no git child runs for it (review focus 1).
    if (integration === null || !integration.frozen || integration.state !== "idle") continue;
    if (integration.retryAfter !== null && integration.retryAfter > deps.now()) continue;
    // Ruling R7: a stopped or person-paused group waits; a budget-blocked one still integrates what it landed.
    if (groupStopped(deps.store, groupId)) continue;
    let outcome: Outcome | null;
    try { outcome = await integrateGroup(deps, groupId, integration); }
    catch (error) {
      if (error instanceof Crashed) throw error.error;
      if (error instanceof ControlError && error.code === "panel-draining") throw error;
      // Anything else is this group's alone and is retried after the backoff; the round goes on to the next group.
      process.stderr.write(`orca-driver: integration ${groupId}: ${describe(error)}\n`);
      outcome = { kind: "transient", message: describe(error) };
    }
    if (outcome !== null && settle(deps, groupId, integration.schemeHash, outcome)) moved = true;
  }
  return moved;
}

function describe(error: unknown): string {
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/** spec §5: every task-kind work item done and no run active (a reconciling run is active). */
function groupComplete(store: ControlStore, groupId: string): boolean {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  if (tasks.length === 0 || tasks.some((work) => work.status !== "done")) return false;
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
async function integrateGroup(deps: IntegrationDeps, groupId: string, integration: GroupIntegration): Promise<Outcome | null> {
  const scheme = integration.scheme as Scheme;
  const repo = deps.repoPathOf(groupRepoId(deps.store, groupId));
  const tip = await refTip(repo, workBranchRef(groupId));
  if (tip === null || tip === integration.lastIntegrated) return null;
  if (scheme.trigger === "group" && !groupComplete(deps.store, groupId)) return null;
  if (integration.lastIntegrated === null && await nothingLanded(repo, scheme, tip)) return null;
  try {
    if (scheme.delivery === "local") return await integrateLocal(deps, repo, groupId, integration, scheme, tip);
    if (scheme.delivery === "push-target") return await integratePushTarget(deps, repo, groupId, integration, scheme, tip);
    return await integrateWorkBranch(deps, repo, groupId, integration, scheme, tip);
  } catch (error) {
    if (error instanceof ChildTimeout) return { kind: "transient", message: error.message };
    if (error instanceof RemoteFailure) return error.transient ? { kind: "transient", message: error.message } : { kind: "blocked", reason: "integration-remote-missing" };
    if (error instanceof BranchMissing) return { kind: "blocked", reason: "integration-target-missing" };
    throw error;
  }
}

async function remoteConfigured(repo: string, remote: string): Promise<boolean> {
  return (await gitChild(repo, ["config", "--get", `remote.${remote}.url`])).code === 0;
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
    return finishWorkBranch(deps, groupId, integration, scheme, pending.tip);
  }
  if (!recordPending(deps, groupId, integration.schemeHash, { schemeHash: integration.schemeHash, tip, base: tip, new: tip })) return { kind: "dropped" };
  crash(deps, "after-pending");
  if ((await remoteTip(repo, scheme.remote, branch)) !== tip) {
    await deps.beforePublish?.();
    const pushed = await pushPorcelain(repo, scheme.remote, `${tip}:refs/heads/${branch}`);
    if (pushed === "moved") return { kind: "blocked", reason: "integration-work-branch-diverged" };
    const failed = pushFailure(pushed);
    if (failed !== null) return failed;
  }
  crash(deps, "after-publish");
  return finishWorkBranch(deps, groupId, integration, scheme, tip);
}

/**
 * spec §6.1 step 5, the `github-pr` delivery's PR (§6.4). Task 4 fills it with `syncGroupPr`; until then the delivery
 * carries the work branch only, as `push-branch` does.
 */
async function finishWorkBranch(_deps: IntegrationDeps, _groupId: string, _integration: GroupIntegration, _scheme: Extract<Scheme, { delivery: "push-branch" | "github-pr" }>, tip: string): Promise<Outcome> {
  return { kind: "done", tip, integrated: tip };
}

function pushFailure(pushed: Awaited<ReturnType<typeof pushPorcelain>>): Outcome | null {
  if (pushed === "ok" || pushed === "up-to-date" || pushed === "moved") return null;
  if ("refused" in pushed) return { kind: "blocked", reason: `integration-push-refused:${pushed.refused}` };
  return pushed.transient ? { kind: "transient", message: pushed.failed } : { kind: "blocked", reason: `integration-push-refused:${pushed.failed}` };
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
    const landings = (await gitOk(repo, ["rev-list", "--count", "--first-parent", `${mergeBase}..${tip}`])).trim();
    const commit = (await gitOk(repo, [...ORCA_IDENTITY, "commit-tree", tree, "-p", base, "-m", `orca: integrate ${groupId} (${landings} landings)`])).trim();
    return { kind: "new", commit };
  }
  const workspace = integrationPathOf(deps.roots, groupId);
  await removeWorkspace(repo, deps.roots, workspace);
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
  } finally { await removeWorkspace(repo, deps.roots, workspace); }
}

/** `merge-tree --name-only` on a conflict: the tree, the conflicted names, a blank line, then git's messages. */
function conflictedNames(stdout: string): string[] {
  const lines = stdout.split("\n");
  const end = lines.indexOf("", 1);
  return [...new Set(lines.slice(1, end === -1 ? lines.length : end).filter((line) => line.length > 0))];
}

/** The integration workspace is removed by its own name only (a direct child of the workspaces root). */
async function removeWorkspace(repo: string, roots: WorkspaceRoots, path: string): Promise<void> {
  if (dirname(path) !== roots.workspacesRoot) throw new Error(`orca: refusing to touch ${path}, which is not a workspace this driver named`);
  const listed = await gitOk(repo, ["worktree", "list", "--porcelain"]);
  if (listed.split("\n").includes(`worktree ${path}`)) await gitOk(repo, ["worktree", "remove", "--force", path]);
  await rm(path, { recursive: true, force: true });
  await gitChild(repo, ["worktree", "prune"]);
}

type Published = "ok" | "moved" | Outcome;

/**
 * spec §6.1 steps 3-4 for the deliveries that compute `new` on a base: write-ahead, publish, and on a base that moved
 * in between, clear the record, fetch again and recompute once; moved again blocks integration-target-moved.
 */
async function computeAndPublish(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, method: "merge" | "squash", tip: string,
  readBase: () => Promise<string>, publish: (next: string, base: string) => Promise<Published>): Promise<Outcome> {
  for (let attempt = 0; ; attempt += 1) {
    const base = await readBase();
    // The target already contains the tip: nothing to carry, and what was integrated stays as it was.
    if (await isAncestor(repo, tip, base)) return { kind: "done", tip, integrated: integration.integratedCommit };
    const computed = await computeNew(deps, repo, groupId, integration, method, base, tip);
    if (computed.kind === "conflict") return { kind: "conflict", base, tip, paths: computed.paths };
    if (!recordPending(deps, groupId, integration.schemeHash, { schemeHash: integration.schemeHash, tip, base, new: computed.commit })) return { kind: "dropped" };
    crash(deps, "after-pending");
    await deps.beforePublish?.();
    const published = await publish(computed.commit, base);
    if (published === "moved") {
      if (!recordPending(deps, groupId, integration.schemeHash, null)) return { kind: "dropped" };
      if (attempt === 0) continue;
      return { kind: "blocked", reason: "integration-target-moved" };
    }
    if (published !== "ok") return published;
    crash(deps, "after-publish");
    return { kind: "done", tip, integrated: computed.commit };
  }
}

/** `local`: `refs/heads/<target>` of the target repository moves to `new` (spec §6.3 when a worktree has it checked out). */
async function integrateLocal(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, scheme: Extract<Scheme, { delivery: "local" }>, tip: string): Promise<Outcome> {
  const ref = `refs/heads/${scheme.target}`;
  const current = await refTip(repo, ref);
  if (current === null) return { kind: "blocked", reason: "integration-target-missing" };
  const pending = reentry(integration);
  if (pending !== null && (current === pending.new || await isAncestor(repo, pending.new, current))) return { kind: "done", tip: pending.tip, integrated: pending.new };
  return computeAndPublish(deps, repo, groupId, integration, scheme.method, tip,
    async () => { const at = await refTip(repo, ref); if (at === null) throw new BranchMissing(scheme.target); return at; },
    async (next, base) => {
      const checkedOut = await worktreeOf(repo, ref);
      if (checkedOut === null) {
        if ((await gitChild(repo, ["update-ref", ref, next, base])).code === 0) return "ok";
        if ((await refTip(repo, ref)) !== base) return "moved";
        throw new Error(`update-ref ${ref}: refused while still at ${base}`);
      }
      // H5: only a clean worktree, and only a fast-forward of its HEAD; the person's files are otherwise not touched.
      if ((await gitOk(checkedOut, ["status", "--porcelain", "--untracked-files=all"])).trim().length > 0) return { kind: "blocked", reason: "integration-worktree-dirty" };
      if (!(await isAncestor(repo, await revParse(checkedOut, "HEAD"), next))) return { kind: "blocked", reason: "integration-not-fast-forward" };
      await gitOk(checkedOut, ["merge", "--ff-only", "--quiet", next]);
      return "ok";
    });
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
async function integratePushTarget(deps: IntegrationDeps, repo: string, groupId: string, integration: GroupIntegration, scheme: Extract<Scheme, { delivery: "push-target" }>, tip: string): Promise<Outcome> {
  if (!(await remoteConfigured(repo, scheme.remote))) return { kind: "blocked", reason: "integration-remote-missing" };
  const fetched = fetchedRefOf(groupId, "target");
  const pending = reentry(integration);
  if (pending !== null && await remoteHas(repo, scheme.remote, scheme.target, pending.new, fetched)) return { kind: "done", tip: pending.tip, integrated: pending.new };
  return computeAndPublish(deps, repo, groupId, integration, scheme.method, tip,
    () => fetchInto(repo, scheme.remote, scheme.target, fetched),
    async (next) => {
      const pushed = await pushPorcelain(repo, scheme.remote, `${next}:refs/heads/${scheme.target}`);
      if (pushed === "moved") return "moved";
      return pushFailure(pushed) ?? "ok";
    });
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
        next = { ...current, lastIntegrated: outcome.tip, integratedCommit: outcome.integrated, pending: null, state: "idle", reason: null, retryAfter: null, transient: 0 };
        break;
      case "blocked":
        next = { ...current, state: "blocked", reason: outcome.reason, pending: null, retryAfter: null, transient: 0 };
        break;
      case "conflict": {
        // Task 6 materialises the conflict for an agent; here it is recorded and nothing is dispatched.
        const attempt = (current.conflict?.attempt ?? 0) + 1;
        next = { ...current, state: "conflict", reason: "integration-conflict", pending: null, retryAfter: null, transient: 0,
          conflict: { attempt, key: `integrate-${groupId}-${attempt}`, base: outcome.base, tip: outcome.tip, paths: outcome.paths } };
        break;
      }
      case "transient":
        next = { ...current, retryAfter: deps.now() + Math.min(BACKOFF_START_MS * 2 ** current.transient, BACKOFF_MAX_MS), transient: current.transient + 1 };
        break;
    }
    saveGroup(deps.store, { ...group, integration: next } as typeof group);
    return outcome.kind !== "transient";
  });
}
