/**
 * Multi-directory projects spec §9: the landing of a multi group's worked directories. Once per driver round, after the
 * integration pass, one complete group at a time in id order. A group is due when a carried directory (`local`,
 * `push-target` or `place`) has a work-branch tip other than `lastLanded[key]`; `keep` never makes it due.
 *
 * The pre-check writes nothing into any target: `local` / `push-target` reuse the integration primitives without
 * publishing, `place` runs DIR §8.5 steps 1–6 under the folder's lock. The plan is journaled whole, then published in
 * registered order; a failure midway leaves what landed (`partial`) and never reverts it. Crash hooks replay the same
 * sequence without a pre-check. Checks are opt-in per member and run off the round under state `prechecking`.
 */
import { archivedMarkOf } from "./archivedMark.js";
import { effectiveChecks } from "./checks/settings.js";
import { applyWebCommand } from "./commandLedger.js";
import { dirWorkspaceOf, initialPlacement, readPlacement, type PlacementRecord } from "./dirGroup.js";
import {
  folderStopMoved, placementRefs, prepareFolderPlacement, writeFolderPlacement, type FolderPlacementIo, type FolderPlacementTarget, type PlacementOwner,
  type SavePlacement,
} from "./dirPlacement.js";
import { DirFolderMissing, type DirWorkspace, type FrozenDirWorkspace } from "./dirWorkspace.js";
import { ControlError } from "./errors.js";
import { runIntegrationCheck } from "./integrationCheck.js";
import { BranchMissing, RemoteFailure, isAncestor, refTip, remoteHas } from "./integrationGit.js";
import { computeNew, localDelivery, pushTargetDelivery, worktreeOf, type Delivery } from "./integrationPass.js";
import { schemeHash, type GroupIntegration } from "./integrationScheme.js";
import { dirTargetRepoId, multiDirOf, type FrozenMultiDir, type FrozenMultiDirTarget } from "./multiGroup.js";
import {
  initialLanding, isCarried, readMultiLanding, type CarriedScheme, type LandingScheme, type MultiLanding, type MultiPlanEntry,
  type PublishableScheme,
} from "./multiLandingRecord.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { groupComplete } from "./integrationPass.js";
import { groupHasReconcilingRun, readGroup } from "./queries.js";
import { taskWrites } from "./requirementRecords.js";
import { workBranchRef, type WorkspaceRoots } from "./workspace.js";
import { gitChild, gitOk, revParse } from "./integrationGit.js";
import { withDirLock } from "../flow/vault/dirLock.js";
import { vaultGit } from "../flow/vault/vault.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export { initialLanding, readMultiLanding } from "./multiLandingRecord.js";
export type { LandingScheme, MultiLanding, MultiPlanEntry } from "./multiLandingRecord.js";

export type MultiLandingCrashPoint = "multi-land-after-journal" | `multi-land-after-publish:${string}` | `multi-land-after-record:${string}`;

/** The landing record of a group, or null for a group that is not multi / has none. */
export function multiLandingOf(store: ControlStore, groupId: string): { multi: FrozenMultiDir; landing: MultiLanding | null } | null {
  const multi = multiDirOf(readGroup(store, groupId));
  return multi === null ? null : { multi, landing: readMultiLanding(multi.landing) };
}

export type MultiDirLandingCommand = Extract<RawAuthorityCommandV1, { verb: "multi-dir-landing" }>;
const PENDING_STATES = new Set(["partial", "blocked", "folder-changed", "folder-unwritable"]);

/**
 * §9.7: the person's answer to a stopped landing (or `mark-resolved`: they landed the rest themselves). The command only
 * records `resolution` (or, for `mark-resolved`, the record is read by the next pass); the next round does the work.
 */
export function applyMultiDirLanding(deps: { store: ControlStore }, command: MultiDirLandingCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const found = multiLandingOf(deps.store, groupId);
      if (found?.landing === null || found === null) throw new ControlError("multi-dir-landing-not-pending");
      const landing = found.landing;
      if (!PENDING_STATES.has(landing.state)) throw new ControlError("multi-dir-landing-not-pending");
      const action = (context.effectiveCommand.payload as { action: "retry-rest" | "mark-resolved" }).action;
      const group = readGroup(deps.store, groupId) as unknown as Record<string, unknown>;
      const next: MultiLanding = { ...landing, resolution: { action, by: command.actorId, at: deps.store.now() }, at: deps.store.now() };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...group, multiDir: { ...found.multi, landing: next } }), groupId);
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "multi-dir-landing-set", groupId, action },
      } };
    },
  }).body;
}

interface CheckSpec { key: string; repo: string; repoId: string; target: string; commands: string[]; rev: string }
interface Prechecked { plan: MultiPlanEntry[]; carried: Record<string, string>; checks: CheckSpec[] }
export type PrecheckResult = { kind: "ready"; prechecked: Prechecked } | { kind: "blocked"; state: "blocked" | "folder-changed" | "folder-unwritable"; reason: string; failedKey: string | null; detail: string | null }
  | { kind: "aborted" };

/** One pre-check's settled outcome, kept in memory: a restart re-pre-checks from scratch (nothing was written). */
export interface MultiPrecheck {
  settled: null | { kind: "ready"; prechecked: Prechecked } | { kind: "blocked"; result: Extract<PrecheckResult, { kind: "blocked" }> } | { kind: "error"; error: unknown };
}

export interface MultiLandingDeps {
  store: ControlStore;
  roots: WorkspaceRoots;
  repoPathOf(repoId: string): string;
  /** The panel's empty `dispatched-person` directory, a check's ORCA_PERSON_DIR (§9.4). */
  personDir: string;
  admissionGate?: AdmissionGate;
  /** Dir-requirements spec §6.1 (Rule 17): where a vault is found. */
  env?: NodeJS.ProcessEnv;
  /** Test-only fault injection, as the integration and placement passes have. */
  crash?: (point: MultiLandingCrashPoint) => void;
  /** Test-only seam before each publish: §9.5's race (the target moving after the pre-check). */
  beforePublish?: (key: string) => void | Promise<void>;
  stopped?: () => boolean;
  /** Checks running off the round, by group; the driver owns one map. */
  prechecks: Map<string, MultiPrecheck>;
}

class Crashed { constructor(readonly error: unknown) {} }

function groupStopped(store: ControlStore, groupId: string): boolean {
  return readGroup(store, groupId).stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

function bodyOf(store: ControlStore, groupId: string): Record<string, unknown> {
  return readGroup(store, groupId) as unknown as Record<string, unknown>;
}

function write<T>(deps: MultiLandingDeps, action: () => T): T {
  const release = deps.admissionGate?.enter();
  try { return deps.store.transaction(action); } finally { release?.(); }
}

/** The landing record's save: the group body is read again inside the transaction (another writer may have moved it). */
/** Writes the update in one transaction; an update that answers `current` itself writes nothing (answers false). */
function saveLanding(deps: MultiLandingDeps, groupId: string, update: (current: MultiLanding) => MultiLanding): boolean {
  return write(deps, () => {
    const body = bodyOf(deps.store, groupId);
    const multi = multiDirOf(body);
    if (multi === null) throw new ControlError("multi-dir-invalid", `not-multi:${groupId}`);
    const current = readMultiLanding(multi.landing);
    if (current === null) throw new ControlError("recovery-blocked", `multi-landing-missing:${groupId}`);
    const updated = update(current);
    if (updated === current) return false;
    const next = readMultiLanding({ ...updated, at: deps.store.now() })!;
    deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, multiDir: { ...multi, landing: next } }), groupId);
    recordProjectionChange(deps.store, [groupId]);
    return true;
  });
}

/**
 * §9.7: the person's answer that started a pass. A `mark-resolved` accepted while the pass awaited git (the command is
 * accepted in every pending state) is theirs: the pass's result is dropped and nothing is journaled, so the next round
 * reads the new answer. Null: the pass did not start from a pending state, and no command can land during it.
 */
type StartedWith = { resolution: MultiLanding["resolution"] } | null;
function answeredSince(current: MultiLanding, started: StartedWith): boolean {
  if (started === null) return false;
  const a = current.resolution, b = started.resolution;
  return a === null || b === null ? a !== b : a.action !== b.action || a.by !== b.by || a.at !== b.at;
}

/** The projection progress is judged by (§9.5): the time alone and the placement `at`s are not a move. */
function projection(landing: MultiLanding): string {
  return JSON.stringify({
    state: landing.state, pending: landing.pending, lastLanded: landing.lastLanded, reason: landing.reason, detail: landing.detail,
    failedKey: landing.failedKey, movedBeforeAny: landing.movedBeforeAny, resolution: landing.resolution, delivery: landing.delivery,
    placement: Object.fromEntries(Object.entries(landing.placement ?? {}).map(([key, record]) => [key, {
      state: record.state, tip: record.tip, landedTip: record.landedTip, pending: record.pending === null ? null : { from: record.pending.from, to: record.pending.to },
      changed: record.changed, changedTotal: record.changedTotal, unwritable: record.unwritable, unwritableTotal: record.unwritableTotal,
      withheld: record.withheld, resolution: record.resolution,
    }])),
  });
}

function describe(error: unknown): string {
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/** The scheme a member's delivery was frozen with (§9.2). */
function schemeOf(landing: MultiLanding, key: string): LandingScheme | null {
  return landing.delivery.find((entry) => entry.key === key)?.scheme ?? null;
}

function memberOf(multi: FrozenMultiDir, key: string): FrozenMultiDirTarget | null {
  return multi.dirs.find((member) => member.key === key) ?? null;
}

/** The member's repository path: a `repo` member's, a folder's vault for a `dir` member. */
function repoPathOf(deps: MultiLandingDeps, groupId: string, member: FrozenMultiDirTarget): string {
  return deps.repoPathOf(dirTargetRepoId(deps.store, groupId, member.key));
}

/** The per-directory stand-in `computeNew` and `squashMessage` read (§9.4 step 3). */
function standIn(scheme: PublishableScheme, lastIntegrated: string | null): GroupIntegration {
  return {
    scheme, schemeHash: schemeHash(scheme), frozen: true,
    lastIntegrated, integratedCommit: lastIntegrated, state: "idle", reason: null, pending: null, conflict: null, resolution: null,
    pr: null, retryAfter: null, transient: 0, attempts: 0,
  };
}

const localRef = (scheme: Extract<CarriedScheme, { delivery: "local" }>): string => `refs/heads/${scheme.target}`;
/** Orca's own fetched ref, as integrationPass names it (the person's FETCH_HEAD is never written). */
const fetchedTargetRef = (groupId: string): string => `refs/orca/integration/${groupId}/target`;

/** The union of the checks the group's done tasks declared for `key`, in task order and then contract order, deduped. */
export function taskChecksFor(store: ControlStore, groupId: string, key: string): string[] {
  const seen = new Set<string>(), commands: string[] = [];
  for (const row of store.db.prepare("SELECT id, body FROM work_items WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const work = JSON.parse(String(row.body)) as { kind?: unknown; status?: unknown };
    if (work.kind !== "task" || (work.status !== "done" && work.status !== "completed")) continue;
    const writes = taskWrites(store, groupId, String(row.id));
    for (const write of writes ?? []) {
      if (write.dir !== key) continue;
      for (const command of write.checks) {
        if (seen.has(command)) continue;
        seen.add(command);
        commands.push(command);
      }
    }
  }
  return commands;
}

/** §9.4: the pre-check of every directory not in `skip`, writing nothing into any target. */
async function precheckGroup(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding, skip: ReadonlySet<string>): Promise<PrecheckResult> {
  const plan: MultiPlanEntry[] = [], carried: Record<string, string> = {}, specs: Array<{ key: string; member: FrozenMultiDirTarget; repo: string; repoId: string; next: string }> = [];
  for (const { key } of landing.delivery) {
    // A stop mid-walk journals nothing: a truncated plan would look like a complete pre-check on replay.
    if (deps.stopped?.() === true) return { kind: "aborted" };
    if (skip.has(key)) continue;
    const scheme = schemeOf(landing, key)!;
    if (!isCarried(scheme)) continue;
    const member = memberOf(multi, key);
    if (member === null) return { kind: "blocked", state: "blocked", reason: `multi-dir-invalid:${key}`, failedKey: key, detail: null };
    const repo = repoPathOf(deps, groupId, member);
    const tip = await refTip(repo, workBranchRef(groupId));
    if (tip === null) return { kind: "blocked", state: "blocked", reason: `multi-dir-target-missing:${key}`, failedKey: key, detail: null };
    const lastLanded = landing.lastLanded[key] ?? null;
    if (tip === lastLanded) { carried[key] = tip; continue; }
    if (scheme.delivery === "place") {
      const result = await precheckPlace(deps, groupId, multi, landing, member, repo, tip, lastLanded);
      if (result.kind === "blocked") return result;
      if (result.kind === "carried") { carried[key] = tip; continue; }
      plan.push(result.entry);
      specs.push({ key, member, repo, repoId: dirTargetRepoId(deps.store, groupId, key), next: result.entry.next });
      continue;
    }
    if (scheme.delivery === "push-target" && !(await remoteConfigured(repo, scheme.remote))) {
      return { kind: "blocked", state: "blocked", reason: `integration-remote-missing:${key}`, failedKey: key, detail: null };
    }
    const delivery = deliveryOf(groupId, repo, scheme);
    let base: string;
    try { base = await delivery.readBase(); }
    catch (error) {
      if (error instanceof BranchMissing) return { kind: "blocked", state: "blocked", reason: `multi-dir-target-missing:${key}`, failedKey: key, detail: null };
      if (error instanceof RemoteFailure) return { kind: "blocked", state: "blocked", reason: `integration-preflight-failed:${key}`, failedKey: key, detail: error.message };
      throw error;
    }
    if (await isAncestor(repo, tip, base)) { carried[key] = tip; continue; }
    const computed = await computeNew({ roots: deps.roots }, repo, groupId, standIn(scheme, lastLanded), scheme.method, base, tip);
    if (computed.kind === "conflict") {
      return { kind: "blocked", state: "blocked", reason: `multi-dir-precheck-conflict:${key}:${computed.paths.join(",")}`, failedKey: key, detail: computed.paths.join("\n") };
    }
    const refused = await publishPrecondition(repo, scheme, base, computed.commit);
    if (refused !== null) return { kind: "blocked", state: "blocked", reason: `${refused}:${key}`, failedKey: key, detail: null };
    plan.push({ key, kind: scheme.delivery, base, next: computed.commit, tip });
    specs.push({ key, member, repo, repoId: member.repoId, next: computed.commit });
  }
  // §9.4: checks are opt-in per member and run only for a directory that is carried.
  const checks: CheckSpec[] = [];
  for (const spec of specs) {
    let setting;
    try { setting = effectiveChecks(deps.store, spec.repoId).kinds["integration-check"]; }
    catch (error) { return { kind: "blocked", state: "blocked", reason: `multi-dir-precheck-check-failed:${spec.key}`, failedKey: spec.key, detail: describe(error) }; }
    if (!setting.enabled.value) continue;
    const commands = setting.command.value !== null ? [setting.command.value] : taskChecksFor(deps.store, groupId, spec.key);
    if (commands.length === 0) continue;
    const target = spec.key;
    checks.push({ key: spec.key, repo: spec.repo, repoId: spec.repoId, target, commands, rev: spec.next });
  }
  return { kind: "ready", prechecked: { plan, carried, checks } };
}

/** §9.4 step 4: a `local` target checked out must be clean and fast-forwardable; a `push-target` remote is configured. */
async function publishPrecondition(repo: string, scheme: PublishableScheme, base: string, next: string): Promise<string | null> {
  if (scheme.delivery !== "local") return null;
  const checkedOut = await worktreeOf(repo, localRef(scheme));
  if (checkedOut === null) return null;
  if ((await gitOk(checkedOut, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"])).trim().length > 0) return "integration-worktree-dirty";
  const head = await revParse(checkedOut, "HEAD");
  if (head !== base && !(await isAncestor(repo, head, next))) return "integration-not-fast-forward";
  return null;
}

function deliveryOf(groupId: string, repo: string, scheme: PublishableScheme): Delivery {
  return scheme.delivery === "local" ? localDelivery(repo, scheme) : pushTargetDelivery(repo, groupId, scheme);
}

/** §9.4: DIR §8.5 steps 1–6 for a folder member, under its lock; a stop is the pre-check's answer, not a write. */
async function precheckPlace(
  deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding, member: FrozenMultiDirTarget, repo: string, tip: string, lastLanded: string | null,
): Promise<{ kind: "blocked"; state: "blocked" | "folder-changed" | "folder-unwritable"; reason: string; failedKey: string; detail: string | null } | { kind: "carried" } | { kind: "entry"; entry: MultiPlanEntry }> {
  if (member.dirWorkspace === undefined) return { kind: "blocked", state: "blocked", reason: `multi-dir-invalid:${member.key}`, failedKey: member.key, detail: null };
  if (deps.env === undefined) return { kind: "blocked", state: "blocked", reason: `multi-dir-invalid:${member.key}`, failedKey: member.key, detail: "env-missing" };
  const target = folderTarget(deps, groupId, multi, member);
  const record = await folderRecord(deps, groupId, landing, member, repo, tip, lastLanded);
  const io = folderIo(deps, groupId, member, record);
  let prepared;
  try {
    prepared = await withDirLock(member.dirWorkspace.dir, () => prepareFolderPlacement(target, io.load(), io));
  } catch (error) {
    if (error instanceof DirFolderMissing) return { kind: "blocked", state: "blocked", reason: `folder-missing:${member.key}`, failedKey: member.key, detail: error.dir };
    throw error;
  }
  const stop = placementStop(io.load(), member.key);
  // A stop this preparation recorded is a `done`; a re-entry on a moved watch that classifies cleanly still carries the
  // stale stopped state until the write clears it, so only a `done` may read a changed/unwritable stop as this pass's.
  if (stop !== null && (stop.state === "blocked" || prepared.kind === "done")) return { kind: "blocked", ...stop, failedKey: member.key };
  if (prepared.kind === "done") return { kind: "carried" };
  return { kind: "entry", entry: { key: member.key, kind: "place", base: prepared.from, next: prepared.to, tip } };
}

/**
 * §9.8: what a folder's placement record says stopped it, read the same way by the pre-check and the publish: a changed
 * or unwritable folder by its own code, a vanished one or a failed write as `folder-missing`; null for `idle`.
 */
function placementStop(record: PlacementRecord, key: string): { state: "blocked" | "folder-changed" | "folder-unwritable"; reason: string; detail: string | null } | null {
  if (record.state === "folder-changed") return { state: "folder-changed", reason: `dir-folder-changed:${key}`, detail: record.detail };
  if (record.state === "folder-unwritable") return { state: "folder-unwritable", reason: `dir-folder-unwritable:${key}`, detail: record.detail };
  if (record.state === "folder-missing" || record.state === "failed") return { state: "blocked", reason: `folder-missing:${key}`, detail: record.detail };
  return null;
}

/** §9.8: the folder's record; the first one starts where the export left the folder. */
async function folderRecord(deps: MultiLandingDeps, groupId: string, landing: MultiLanding, member: FrozenMultiDirTarget, repo: string, tip: string, lastLanded: string | null): Promise<PlacementRecord> {
  const existing = readPlacement(landing.placement?.[member.key]);
  if (existing !== null) return existing;
  const placed = await refTip(repo, placementRefs(groupId).placed);
  const base = placed ?? tip;
  return initialPlacement({ base, landedTip: lastLanded ?? base, at: deps.store.now() });
}

function folderTarget(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, member: FrozenMultiDirTarget): FolderPlacementTarget {
  const primary = multi.dirs[0]?.key;
  // §10: the requirement document is on the primary's work branch only.
  const document = (bodyOf(deps.store, groupId) as { requirement?: { export?: { path?: unknown } } }).requirement?.export?.path;
  return {
    groupId, frozen: member.dirWorkspace!, workBranch: workBranchRef(groupId), refs: placementRefs(groupId),
    orcaOwn: member.key === primary && typeof document === "string" ? [document] : [],
  };
}

/** §9.8: the io whose `save` writes `landing.placement[key]` in the group body (the integration pass's `write` shape). */
function folderIo(deps: MultiLandingDeps, groupId: string, member: FrozenMultiDirTarget, initial: PlacementRecord): FolderPlacementIo {
  const load = (): PlacementRecord => {
    const body = bodyOf(deps.store, groupId);
    const landing = readMultiLanding(multiDirOf(body)?.landing);
    return readPlacement(landing?.placement?.[member.key]) ?? initial;
  };
  const save: SavePlacement = (update) => write(deps, () => {
    const body = bodyOf(deps.store, groupId);
    const multi = multiDirOf(body);
    if (multi === null) throw new ControlError("multi-dir-invalid", `not-multi:${groupId}`);
    const landing = readMultiLanding(multi.landing);
    if (landing === null) throw new ControlError("recovery-blocked", `multi-landing-missing:${groupId}`);
    const records = { ...(landing.placement ?? {}) };
    const current = readPlacement(records[member.key]) ?? initial;
    const next = readPlacement({ ...update(current), at: deps.store.now() })!;
    records[member.key] = next;
    const saved = readMultiLanding({ ...landing, placement: records, at: deps.store.now() })!;
    deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, multiDir: { ...multi, landing: saved } }), groupId);
    recordProjectionChange(deps.store, [groupId]);
    return next;
  });
  const owners = async (ws: DirWorkspace): Promise<{ dirGroups: PlacementOwner[]; flowRuns: PlacementOwner[] }> => {
    const dirGroups: PlacementOwner[] = [], flowRuns: PlacementOwner[] = [];
    const vaultId = member.dirWorkspace!.vaultId;
    for (const other of deps.store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
      const id = String(other.id);
      if (id === groupId) continue;
      let sameVault: boolean;
      try {
        const body = JSON.parse(String(other.body));
        const single: FrozenDirWorkspace | null = dirWorkspaceOf(body);
        sameVault = single !== null
          ? single.vaultId === vaultId
          : (multiDirOf(body)?.dirs ?? []).some((dir) => dir.dirWorkspace?.vaultId === vaultId);
      } catch { continue; }
      if (!sameVault) continue;
      const commit = (await vaultGit(ws.vault, ["rev-parse", "--verify", "-q", placementRefs(id).placed]).catch(() => "")).trim();
      if (commit.length > 0) dirGroups.push({ id, commit });
    }
    for (const line of (await vaultGit(ws.vault, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/"])).split("\n")) {
      const [name, object] = line.split(" ");
      if (name === undefined || object === undefined) continue;
      const parts = name.split("/");
      if (parts.length === 4 && parts[1] === "orca" && parts[3] === "head") flowRuns.push({ id: parts[2]!, commit: object });
    }
    return { dirGroups, flowRuns };
  };
  return { env: deps.env!, save, load, owners, log: (line) => process.stderr.write(`${line}\n`) };
}

/** §9.4: the checks run off the round; their failure stops the pre-check by the member's key. */
async function runPrecheckChecks(deps: MultiLandingDeps, checks: readonly CheckSpec[], signal?: AbortSignal): Promise<{ failures: Array<{ key: string; command: string; exit: string; tail: string }> }> {
  const failures: Array<{ key: string; command: string; exit: string; tail: string }> = [];
  for (const spec of checks) {
    if (signal?.aborted === true) break;
    const run = await runIntegrationCheck(spec.repo, deps.roots, spec.repoId, spec.target, spec.commands, deps.store.now(), deps.personDir, spec.rev);
    for (const failure of run.failures) failures.push({ key: spec.key, ...failure });
    if (failures.length > 0) break;
  }
  return { failures };
}

function checkDetail(failures: ReadonlyArray<{ command: string; exit: string; tail: string }>): string {
  return failures.map((failure) => `\`${failure.command}\` exited ${failure.exit}${failure.tail === "" ? "" : `; the end of its output:\n${failure.tail}`}`).join("\n\n");
}

async function remoteConfigured(repo: string, remote: string): Promise<boolean> {
  const answer = await gitChild(repo, ["config", "--get", `remote.${remote}.url`]);
  return answer.code === 0 && answer.stdout.trim().length > 0;
}

/** §9.5 step 2 for a `local` / `push-target` member. */
async function publishCarried(groupId: string, repo: string, scheme: PublishableScheme, entry: MultiPlanEntry): Promise<"ok" | { kind: "moved" } | { kind: "blocked"; reason: string } | { kind: "transient"; message: string }> {
  const published = await deliveryOf(groupId, repo, scheme).publish(entry.next, entry.base);
  if (published === "ok") return "ok";
  if (published === "moved") return { kind: "moved" };
  if (published.kind === "blocked") return { kind: "blocked", reason: published.reason };
  if (published.kind === "transient") return { kind: "transient", message: published.message };
  // A delivery that answers anything else for a pre-checked plan (a conflict, a drop) is this directory's failure.
  return { kind: "blocked", reason: `multi-dir-landing-failed:${published.kind}` };
}

/** Whether a target already holds `next` (§9.6). */
async function targetHolds(groupId: string, repo: string, scheme: CarriedScheme, entry: MultiPlanEntry): Promise<boolean> {
  if (scheme.delivery === "local") {
    const current = await refTip(repo, localRef(scheme));
    return current !== null && (current === entry.next || await isAncestor(repo, entry.next, current));
  }
  if (scheme.delivery === "push-target") return remoteHas(repo, scheme.remote, scheme.target, entry.next, fetchedTargetRef(groupId));
  return false;
}

/** §9.5 steps 2–4: publish the plan in order; a failure records what landed and stops. */
async function landPlan(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding): Promise<void> {
  const pending = landing.pending;
  if (pending === null) return;
  for (const entry of pending.plan) {
    if (pending.landed.includes(entry.key)) continue;
    const scheme = schemeOf(landing, entry.key);
    const member = memberOf(multi, entry.key);
    if (scheme === null || !isCarried(scheme) || member === null) throw new ControlError("recovery-blocked", `multi-landing-plan:${entry.key}`);
    const repo = repoPathOf(deps, groupId, member);
    // §9.6: a target that already holds `next` is recorded, not published again.
    if (scheme.delivery !== "place" && await targetHolds(groupId, repo, scheme, entry)) {
      recordLanded(deps, groupId, entry);
      continue;
    }
    await deps.beforePublish?.(entry.key);
    if (scheme.delivery === "place") {
      const failure = await publishPlace(deps, groupId, multi, member);
      if (failure !== null) {
        recordFailure(deps, groupId, entry.key, failure.reason, failure.detail, failure.moved);
        return;
      }
    } else {
      const published = await publishCarried(groupId, repo, scheme, entry);
      if (published !== "ok") {
        if (published.kind === "moved") recordFailure(deps, groupId, entry.key, `multi-dir-target-moved:${entry.key}`, null, true);
        else if (published.kind === "blocked") recordFailure(deps, groupId, entry.key, failureCode(published.reason, entry.key), null, false);
        else recordFailure(deps, groupId, entry.key, `multi-dir-landing-transient:${entry.key}`, published.message, false);
        return;
      }
    }
    crashAt(deps, `multi-land-after-publish:${entry.key}`);
    recordLanded(deps, groupId, entry);
  }
  saveLanding(deps, groupId, (current) => ({
    ...current, state: "landed", pending: null, movedBeforeAny: 0, failedKey: null, reason: null, detail: null, resolution: null,
  }));
}

/** The code a publish's blocked reason carries, naming the directory (§9.5, §9.4's spelling). */
function failureCode(reason: string, key: string): string {
  return reason.endsWith(`:${key}`) ? reason : `${reason}:${key}`;
}

/**
 * §9.5/§9.8 steps 6–8 for a folder: classify, journal and write in one critical section, so no other vault writer can
 * slip between the classification and the write; a stop is the failure's reason.
 */
async function publishPlace(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, member: FrozenMultiDirTarget): Promise<{ reason: string; detail: string | null; moved: boolean } | null> {
  if (member.dirWorkspace === undefined || deps.env === undefined) return { reason: `multi-dir-invalid:${member.key}`, detail: null, moved: false };
  const repo = repoPathOf(deps, groupId, member);
  const current = readMultiLanding(multiDirOf(bodyOf(deps.store, groupId))!.landing)!;
  const target = folderTarget(deps, groupId, multi, member);
  const tip = (await refTip(repo, workBranchRef(groupId))) ?? current.lastLanded[member.key] ?? "";
  const initial = await folderRecord(deps, groupId, current, member, repo, tip, current.lastLanded[member.key] ?? null);
  const io = folderIo(deps, groupId, member, initial);
  // Only an `idle` record after the write is a landing; any stop (a missing folder or a failed write too) is this key's.
  const stopOf = (after: PlacementRecord) => {
    const stop = placementStop(after, member.key);
    return stop === null ? null : { reason: stop.reason, detail: stop.detail, moved: false };
  };
  try {
    return await withDirLock(member.dirWorkspace.dir, async () => {
      const prepared = await prepareFolderPlacement(target, io.load(), io);
      if (prepared.kind === "done") return stopOf(io.load());
      await writeFolderPlacement(target, prepared, io);
      return stopOf(io.load());
    });
  } catch (error) {
    if (error instanceof DirFolderMissing) return { reason: `folder-missing:${member.key}`, detail: error.dir, moved: false };
    throw error;
  }
}

function crashAt(deps: MultiLandingDeps, point: MultiLandingCrashPoint): void {
  try { deps.crash?.(point); } catch (error) { throw new Crashed(error); }
}

function recordLanded(deps: MultiLandingDeps, groupId: string, entry: MultiPlanEntry): void {
  saveLanding(deps, groupId, (current) => ({
    ...current, pending: current.pending === null ? null : { ...current.pending, landed: [...current.pending.landed, entry.key] },
    lastLanded: { ...current.lastLanded, [entry.key]: entry.tip },
  }));
  crashAt(deps, `multi-land-after-record:${entry.key}`);
}

/** §9.5 step 3: what landed stays; a `moved` before anything landed retries once, then blocks. */
function recordFailure(deps: MultiLandingDeps, groupId: string, key: string, reason: string, detail: string | null, moved: boolean): void {
  saveLanding(deps, groupId, (current) => {
    const landed = current.pending?.landed ?? [];
    if (landed.length > 0) return { ...current, state: "partial", failedKey: key, reason, detail, movedBeforeAny: 0 };
    if (moved && current.movedBeforeAny === 0) return { ...current, state: "idle", pending: null, failedKey: key, reason, detail, movedBeforeAny: 1 };
    return { ...current, state: "blocked", pending: null, failedKey: key, reason, detail, movedBeforeAny: 0 };
  });
}

/** §9.7 `mark-resolved`: the current tips become `lastLanded`, the state `landed`, the never-carried keys recorded. */
async function markResolved(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding): Promise<void> {
  const tips: Record<string, string> = {}, unlanded: string[] = [];
  for (const { key, scheme } of landing.delivery) {
    if (!isCarried(scheme)) continue;
    const member = memberOf(multi, key);
    if (member === null) continue;
    const tip = await refTip(repoPathOf(deps, groupId, member), workBranchRef(groupId));
    if (tip === null) continue;
    if (tip !== landing.lastLanded[key]) { unlanded.push(key); tips[key] = tip; }
  }
  saveLanding(deps, groupId, (current) => ({
    ...current, state: "landed", pending: null, movedBeforeAny: 0, failedKey: null, reason: null, detail: null,
    resolution: { action: "mark-resolved", by: current.resolution!.by, at: current.resolution!.at, unlanded },
    lastLanded: { ...current.lastLanded, ...tips },
  }));
}

/** After `retry-rest`: only the directories not in `pending.landed` are pre-checked (§9.7). */
function skippedAfterRetry(landing: MultiLanding): Set<string> {
  return new Set(landing.pending?.landed ?? []);
}

/** §9.8: a stopped folder whose signature moved re-runs the pre-check without a new command; one that vanished is a
 * pre-check answer (`folder-missing`), not a crash. */
async function anyFolderStopMoved(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding): Promise<boolean> {
  if (deps.env === undefined) return false;
  for (const { key, scheme } of landing.delivery) {
    if (scheme.delivery !== "place") continue;
    const member = memberOf(multi, key);
    const record = landing.placement?.[key];
    if (member?.dirWorkspace === undefined || record === undefined) continue;
    try { if (await folderStopMoved(deps.env, member.dirWorkspace, record)) return true; }
    catch (error) { if (error instanceof DirFolderMissing) return true; throw error; }
  }
  return false;
}

/** §9.4/§9.5: one pre-check's result either journals the plan or records why nothing landed. */
function recordPrecheck(deps: MultiLandingDeps, groupId: string, result: PrecheckResult, carriedBefore: Readonly<Record<string, string>>, started: StartedWith = null): boolean {
  if (result.kind === "aborted") return false;
  if (result.kind === "blocked") {
    saveLanding(deps, groupId, (current) => answeredSince(current, started) ? current : ({
      ...current, state: result.state,
      pending: null, failedKey: result.failedKey, reason: result.reason, detail: result.detail, resolution: null, movedBeforeAny: 0,
      lastLanded: { ...current.lastLanded, ...carriedBefore },
    }));
    return true;
  }
  const { plan, carried } = result.prechecked;
  if (plan.length === 0) {
    saveLanding(deps, groupId, (current) => answeredSince(current, started) ? current : ({
      ...current, state: "landed", pending: null, movedBeforeAny: 0, failedKey: null, reason: null, detail: null, resolution: null,
      lastLanded: { ...current.lastLanded, ...carried },
    }));
    return true;
  }
  if (!saveLanding(deps, groupId, (current) => answeredSince(current, started) ? current : ({
    ...current, state: "landing", pending: { plan, landed: [], startedAt: deps.store.now() }, lastLanded: { ...current.lastLanded, ...carried },
    failedKey: null, reason: null, detail: null, resolution: null,
  }))) return true;
  try { deps.crash?.("multi-land-after-journal"); } catch (error) { throw new Crashed(error); }
  return true;
}

/** Starts the opt-in checks off the round, under state `prechecking`, and answers the journal's result asynchronously. */
function startChecks(deps: MultiLandingDeps, groupId: string, prechecked: Prechecked, started: StartedWith): void {
  if (!saveLanding(deps, groupId, (current) => answeredSince(current, started) ? current : ({
    ...current, state: "prechecking", pending: null, failedKey: null, reason: null, detail: null, resolution: null,
    lastLanded: { ...current.lastLanded, ...prechecked.carried },
  }))) return;
  const entry: MultiPrecheck = { settled: null };
  deps.prechecks.set(groupId, entry);
  void runPrecheckChecks(deps, prechecked.checks).then(async ({ failures }) => {
    if (failures.length === 0) { entry.settled = { kind: "ready", prechecked }; return; }
    const first = failures[0]!;
    entry.settled = { kind: "blocked", result: { kind: "blocked", state: "blocked", reason: `multi-dir-precheck-check-failed:${first.key}`, failedKey: first.key, detail: checkDetail(failures) } };
  }, (error: unknown) => { entry.settled = { kind: "error", error }; });
}

/** §9.4→§9.5: journal the plan, or run the checks that must pass first. */
function journalOrChecks(deps: MultiLandingDeps, groupId: string, prechecked: Prechecked, started: StartedWith = null): void {
  if (prechecked.checks.length > 0) { startChecks(deps, groupId, prechecked, started); return; }
  recordPrecheck(deps, groupId, { kind: "ready", prechecked }, prechecked.carried, started);
}

/** §9.3: a group that is due. One group's whole turn: replay, a waiting state, a pre-check, or the sequence. */
async function landOne(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding): Promise<boolean> {
  const state = landing.state;
  if (state === "landing" && landing.pending !== null) { await landPlan(deps, groupId, multi, landing); return true; }
  if (state === "prechecking") {
    const entry = deps.prechecks.get(groupId);
    if (entry === undefined) {
      // A restarted panel finds no live check: nothing was written, so the pre-check runs again.
      const again = await precheckGroup(deps, groupId, multi, landing, new Set());
      if (again.kind === "aborted") return false;
      if (again.kind === "blocked") recordPrecheck(deps, groupId, again, {});
      else journalOrChecks(deps, groupId, again.prechecked);
      return true;
    }
    if (entry.settled === null) return false;
    deps.prechecks.delete(groupId);
    if (entry.settled.kind === "error") {
      if (entry.settled.error instanceof ControlError && entry.settled.error.code === "panel-draining") return false;
      recordPrecheck(deps, groupId, { kind: "blocked", state: "blocked", reason: "multi-dir-precheck-failed", failedKey: null, detail: describe(entry.settled.error) }, {});
      return true;
    }
    if (entry.settled.kind === "blocked") { recordPrecheck(deps, groupId, entry.settled.result, {}); return true; }
    // The checks already passed: journal now rather than starting them again.
    recordPrecheck(deps, groupId, { kind: "ready", prechecked: entry.settled.prechecked }, entry.settled.prechecked.carried);
    return true;
  }
  if (state === "partial" || state === "blocked" || state === "folder-changed" || state === "folder-unwritable") {
    if (landing.resolution?.action === "mark-resolved") { await markResolved(deps, groupId, multi, landing); return true; }
    const retry = landing.resolution?.action === "retry-rest";
    const folderAnswer = Object.values(landing.placement ?? {}).some((record) =>
      (record.state === "folder-changed" || record.state === "folder-unwritable") && record.resolution !== null);
    if (!retry && !folderAnswer && !await anyFolderStopMoved(deps, groupId, multi, landing)) return false;
    const started: StartedWith = { resolution: landing.resolution };
    const prechecked = await precheckGroup(deps, groupId, multi, landing, retry ? skippedAfterRetry(landing) : new Set(landing.pending?.landed ?? []));
    if (prechecked.kind === "aborted") return false;
    if (prechecked.kind === "blocked") { recordPrecheck(deps, groupId, prechecked, {}, started); return true; }
    journalOrChecks(deps, groupId, prechecked.prechecked, started);
    return true;
  }
  // `idle` / `landed`: due only when a carried directory's tip moved.
  const due = await isDue(deps, groupId, multi, landing);
  if (!due) {
    // §9.4's empty plan, met without ever being due: a complete group with nothing to carry ends `landed`, so that
    // §9.9 answers its dependents instead of waiting for a tip that will never move.
    if (state === "idle") {
      saveLanding(deps, groupId, (current) => ({
        ...current, state: "landed", pending: null, movedBeforeAny: 0, failedKey: null, reason: null, detail: null, resolution: null,
      }));
      return true;
    }
    return false;
  }
  const prechecked = await precheckGroup(deps, groupId, multi, landing, new Set());
  if (prechecked.kind === "aborted") return false;
  if (prechecked.kind === "blocked") { recordPrecheck(deps, groupId, prechecked, {}); return true; }
  journalOrChecks(deps, groupId, prechecked.prechecked);
  return true;
}

async function isDue(deps: MultiLandingDeps, groupId: string, multi: FrozenMultiDir, landing: MultiLanding): Promise<boolean> {
  for (const { key, scheme } of landing.delivery) {
    if (!isCarried(scheme)) continue;
    const member = memberOf(multi, key);
    if (member === null) continue;
    const tip = await refTip(repoPathOf(deps, groupId, member), workBranchRef(groupId));
    if (tip !== null && tip !== landing.lastLanded[key]) return true;
  }
  return false;
}

/** §9.1: once per driver round, after the integration pass; answers whether any landing moved. */
export async function landMultiDirGroups(deps: MultiLandingDeps): Promise<boolean> {
  let moved = false;
  for (const row of deps.store.db.prepare("SELECT id, body FROM groups ORDER BY id").all()) {
    if (deps.stopped?.() === true || deps.admissionGate?.draining === true) break;
    const groupId = String(row.id);
    let multi: FrozenMultiDir | null;
    try {
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      multi = multiDirOf(body);
      if (multi === null || archivedMarkOf(body) !== null) continue;
    } catch (error) { process.stderr.write(`orca-driver: multi landing ${groupId}: ${describe(error)}\n`); continue; }
    let landing: MultiLanding | null;
    try { landing = readMultiLanding(multi.landing); }
    catch (error) { process.stderr.write(`orca-driver: multi landing ${groupId}: ${describe(error)}\n`); continue; }
    if (landing === null || landing.delivery.length === 0) continue;
    if (groupStopped(deps.store, groupId) || groupHasReconcilingRun(deps.store, groupId)) continue;
    if (!groupComplete(deps.store, groupId)) continue;
    const before = projection(landing);
    try {
      if (await landOne(deps, groupId, multi, landing)) {
        const after = readMultiLanding(multiDirOf(bodyOf(deps.store, groupId))!.landing);
        if (after !== null && projection(after) !== before) moved = true;
      }
    } catch (error) {
      if (error instanceof Crashed) throw error.error;
      if (error instanceof ControlError && error.code === "panel-draining") throw error;
      process.stderr.write(`orca-driver: multi landing ${groupId}: ${describe(error)}\n`);
      // A thrown failure mid-sequence still leaves what landed recorded. Anything else (a pre-check, a restart's re-check,
      // `mark-resolved` reading the tips) wrote nothing into any target: it blocks `multi-dir-precheck-failed` with the
      // error as its detail, for a person's answer (§9.7), rather than retrying silently every round.
      try {
        saveLanding(deps, groupId, (current) => current.state === "landing"
          ? { ...current, state: (current.pending?.landed.length ?? 0) > 0 ? "partial" : "blocked", failedKey: current.failedKey, reason: current.reason ?? `multi-dir-landing-failed:${describe(error)}`, detail: current.detail ?? describe(error) }
          : { ...current, state: current.state === "partial" ? "partial" : "blocked", pending: current.state === "partial" ? current.pending : null,
            failedKey: null, reason: "multi-dir-precheck-failed", detail: describe(error), resolution: null, movedBeforeAny: 0 });
      } catch { /* the record that cannot be written is named on stderr above */ }
    }
  }
  return moved;
}
