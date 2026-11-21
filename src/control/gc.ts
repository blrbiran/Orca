import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isTerminalRunState } from "./budget.js";
import { archivedMarkOf } from "./archivedMark.js";
import { directorySize, runDirectories, type RunDirectory } from "./diskUsage.js";
import { QUIET_GIT } from "./workspace.js";
import { git } from "../scheduler/gitExec.js";

/**
 * Issue #366, the retention/GC half. `orca gc` reclaims the two per-run trees -- `<stateDir>.runs/<runId>` (ccloop's
 * materialised result repository) and `<stateDir>.workspaces/<runId>` (Orca's own git handle) -- and nothing else: the
 * control store, `staging`, `artifacts`, the service lock and every path outside those roots are out of scope by
 * construction (only direct children named `run-…` are ever considered, diskUsage.ts).
 *
 * A run is eligible only when every guard below holds. Any doubt skips it and says why:
 *  - its group carries a terminal mark (`archived`, or the `closed` kind of the same mark, archivedMark.ts);
 *  - its own state is terminal (`isTerminalRunState`: settled, settled-*, failed-before-provider) -- `landed` and the
 *    driver's working states are not, and an active run never is (`active=1`);
 *  - the driver has finished with it (`drive.cleanedUp`, when a drive record exists): a settled run's cleanup or publish
 *    retry may still read what is on disk;
 *  - it is older than `olderThanDays`, unless it is among the `keepLast` newest runs in scope.
 *
 * A workspace is a git worktree of a registered target. It is removed by `git worktree remove` WITHOUT `--force`: git
 * refuses a dirty worktree, and that refusal is reported as a skip, never overridden. Git's own metadata is therefore
 * cleaned too, not just the directory. A workspace nothing registers is a plain directory and is removed if eligible.
 */

/** A refusal `orca gc` makes here (the CLI turns it into its one-line error); `code` is stable for scripts. */
export class GcRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "GcRefusal"; }
}

export interface GcOptions {
  /** The control state directory (holds `control.sqlite`); the two roots are its siblings. */
  stateDir: string;
  /** False (the default) reports only. */
  apply?: boolean;
  /** Default 30: a run touched at or after `now - days` is kept. */
  olderThanDays?: number;
  /** Keep the newest N runs in scope whatever their age (0: none). */
  keepLast?: number;
  /**
   * Tester #366 follow-up: also reclaim runs whose driver never wrote `cleanedUp` (historical runs, or a driver that
   * died before its cleanup pass). Off by default: the skip is the conservative answer. Every other guard still holds,
   * and each such item is marked `uncleaned` in the plan so the output says what it is.
   */
  includeUncleaned?: boolean;
  /** Only runs of this group are considered. */
  groupId?: string;
  /** The clock, ms since the epoch (tests). */
  now?: number;
  /** A group's repoId → its registered path, for runs that recorded no `drive.targetRepo` (the projects file). */
  repoResolver?: (repoId: string) => string | null;
}

export interface GcItem { runId: string; kind: "runs" | "workspaces"; path: string; bytes: number; worktree: boolean; uncleaned?: boolean }
export interface GcSkip { runId: string; path: string | null; reason: string; detail?: string }
export interface GcResult {
  dryRun: boolean;
  planned: GcItem[];
  removed: GcItem[];
  skipped: GcSkip[];
  /** Bytes freed by `removed` (with --apply), or that the plan would free (dry run). */
  bytes: number;
}

interface RunRow { groupId: string; active: boolean; body: Record<string, unknown> }
interface GroupRow { body: Record<string, unknown> }

const DAY_MS = 86_400_000;

function readTables(dbPath: string): { runs: Map<string, RunRow>; groups: Map<string, GroupRow> } {
  if (!existsSync(dbPath)) throw new GcRefusal("control-store-missing", `no control store at ${dbPath}; is the panel installed?`);
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch (error) { throw new GcRefusal("control-store-unreadable", `${dbPath}: ${(error as Error).message}`); }
  try {
    // The panel may be writing; a reader waits rather than failing on a transient lock (store.ts's own busy timeout).
    db.exec("PRAGMA busy_timeout=5000");
    const runs = new Map<string, RunRow>();
    for (const row of db.prepare("SELECT id, group_id, active, body FROM runs").all() as Array<{ id: string; group_id: string; active: number; body: string }>) {
      runs.set(String(row.id), { groupId: String(row.group_id), active: Number(row.active) === 1, body: parseBody(row.body) });
    }
    const groups = new Map<string, GroupRow>();
    for (const row of db.prepare("SELECT id, body FROM groups").all() as Array<{ id: string; body: string }>) {
      groups.set(String(row.id), { body: parseBody(row.body) });
    }
    return { runs, groups };
  } catch (error) {
    if (error instanceof GcRefusal) throw error;
    throw new GcRefusal("control-store-unreadable", `${dbPath}: ${(error as Error).message}`);
  } finally { db.close(); }
}

function parseBody(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(text)) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** The group's terminal mark, or why it cannot be read (archivedMarkOf throws on a mark that does not parse). */
function groupIsTerminal(group: GroupRow | undefined): "yes" | "no" | "invalid" {
  if (group === undefined) return "no";
  try { return archivedMarkOf(group.body) === null ? "no" : "yes"; }
  catch { return "invalid"; }
}

/** `groupRepoIdOf` (usageLedger.ts) without its module: plan, then requirement, then the project key. */
function groupRepoId(body: Record<string, unknown>): string | null {
  const pick = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  return pick((body.plan as { repoId?: unknown } | undefined)?.repoId)
    ?? pick((body.requirement as { repoId?: unknown } | undefined)?.repoId)
    ?? pick(body.projectKey);
}

/** The repositories a run's workspace could be a worktree of: what the driver recorded, then the group's registration. */
function repoCandidates(run: RunRow, group: GroupRow | undefined, resolve: ((repoId: string) => string | null) | undefined): string[] {
  const paths: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.length > 0 && !paths.includes(value)) paths.push(value);
  };
  const drive = run.body.drive as { targetRepo?: unknown; dirs?: unknown } | undefined;
  add(drive?.targetRepo);
  if (Array.isArray(drive?.dirs)) for (const dir of drive.dirs) add((dir as { targetRepo?: unknown } | undefined)?.targetRepo);
  const repoId = group === undefined ? null : groupRepoId(group.body);
  if (repoId !== null && resolve !== undefined) add(resolve(repoId));
  return paths;
}

const canon = async (path: string): Promise<string | null> => { try { return await realpath(path); } catch { return null; } };

/** Whether `path` is a worktree git has registered under `repo` (its porcelain list names it). */
async function registeredWorktree(repo: string, path: string, canonicalPath: string | null): Promise<boolean> {
  const list = await git(repo, [...QUIET_GIT, "worktree", "list", "--porcelain"]);
  for (const line of list.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const listed = line.slice("worktree ".length);
    if (listed === path) return true;
    if (canonicalPath !== null && await canon(listed) === canonicalPath) return true;
  }
  return false;
}

/** The repository a worktree's `.git` file points into (`--git-common-dir`), for a run that recorded no target. */
async function commonDirRepo(workspacePath: string): Promise<string | null> {
  try {
    const common = (await git(workspacePath, [...QUIET_GIT, "rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    if (common.endsWith("/.git") || common.endsWith("\\.git")) return common.slice(0, -"/.git".length);
    // A bare repository is its own common dir; a plain clone's is <clone>/.git, handled above.
    return common.length > 0 ? common : null;
  } catch { return null; }
}

interface Plan { item: GcItem; worktreeRepo: string | null }

/** The reason git gave for refusing to remove a worktree, classified (a dirty tree is named, never forced). */
function worktreeRefusal(error: unknown): { reason: string; detail: string } {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === "string" && stderr.trim().length > 0 ? stderr : (error as Error).message;
  const detail = text.replace(/\s+/g, " ").trim().slice(0, 300);
  return { reason: /modified or untracked|contains modified|is dirty/i.test(text) ? "worktree-dirty" : "worktree-remove-failed", detail };
}

/** Only a direct child of a root is ever removed, in the same shape workspace.ts's assertOwnPath enforces for the driver. */
function assertDirectChild(root: string, path: string): void {
  if (dirname(path) !== root) throw new GcRefusal("gc-path-unsafe", `refusing to touch ${path}, which is not a direct child of ${root}`);
}

interface Candidate {
  runId: string;
  run: RunRow;
  group: GroupRow | undefined;
  runsDir: RunDirectory | undefined;
  workspacesDir: RunDirectory | undefined;
  touchedAt: number;
  /** Set by the run-level guards (before keep-last and age); both directories are then skipped. */
  skip: { reason: string; detail?: string } | undefined;
}

function basicSkip(run: RunRow, group: GroupRow | undefined, includeUncleaned: boolean): { reason: string; detail?: string } | undefined {
  if (run.active) return { reason: "run-active" };
  const terminal = groupIsTerminal(group);
  if (terminal === "no") return { reason: group === undefined ? "group-not-found" : "group-not-archived" };
  if (terminal === "invalid") return { reason: "group-archived-invalid" };
  const state = typeof run.body.state === "string" ? run.body.state : "unknown";
  if (!isTerminalRunState(state)) return { reason: `run-not-terminal:${state}` };
  const drive = run.body.drive as { cleanedUp?: unknown; publishError?: unknown } | undefined;
  if (drive !== undefined && drive.cleanedUp !== true && !includeUncleaned) return { reason: "not-cleaned-up" };
  // The driver keeps a settled, cleaned run in scope until a failed publish succeeds (executionDriver.driverRunIds).
  if (drive !== undefined && drive.publishError !== null && drive.publishError !== undefined) return { reason: "publish-pending" };
  // ... and an owner's acceptance still to carry out (acceptAttemptDriver.acceptPending).
  if ((run.body.operatorAcceptance as { state?: unknown } | null | undefined)?.state === "pending") return { reason: "acceptance-pending" };
  return undefined;
}

export async function gcControl(options: GcOptions): Promise<GcResult> {
  let stateDir: string;
  try { stateDir = realpathSync(options.stateDir); }
  catch (error) { throw new GcRefusal("control-state-dir-missing", `${options.stateDir}: ${(error as Error).message}`); }
  const now = options.now ?? Date.now();
  const olderThanDays = options.olderThanDays ?? 30;
  const keepLast = Math.max(0, options.keepLast ?? 0);
  const runsRoot = `${stateDir}.runs`;
  const workspacesRoot = `${stateDir}.workspaces`;
  const { runs, groups } = readTables(join(stateDir, "control.sqlite"));

  // Only direct children named after a run, from the two roots; every other leaf is left alone silently.
  const byName = new Map<string, Candidate["runsDir"] | undefined>();
  const workspaceByName = new Map<string, RunDirectory | undefined>();
  for (const dir of await runDirectories(runsRoot)) byName.set(dir.name, dir);
  for (const dir of await runDirectories(workspacesRoot)) workspaceByName.set(dir.name, dir);
  const names = [...new Set([...byName.keys(), ...workspaceByName.keys()])].sort();

  const candidates: Candidate[] = [];
  for (const runId of names) {
    const run = runs.get(runId);
    if (run === undefined) {
      candidates.push({ runId, run: { groupId: "", active: false, body: {} }, group: undefined, runsDir: byName.get(runId), workspacesDir: workspaceByName.get(runId), touchedAt: touchOf(byName.get(runId), workspaceByName.get(runId), undefined), skip: { reason: "run-not-found" } });
      continue;
    }
    if (options.groupId !== undefined && run.groupId !== options.groupId) continue;
    const group = groups.get(run.groupId);
    const touchedAt = touchOf(byName.get(runId), workspaceByName.get(runId), run.body);
    candidates.push({ runId, run, group, runsDir: byName.get(runId), workspacesDir: workspaceByName.get(runId), touchedAt, skip: basicSkip(run, group, options.includeUncleaned === true) });
  }

  // --keep-last protects the newest N eligible runs whatever their age; age then applies to the rest.
  const eligible = candidates.filter((candidate) => candidate.skip === undefined);
  const kept = new Set(eligible.slice().sort((a, b) => b.touchedAt - a.touchedAt || a.runId.localeCompare(b.runId)).slice(0, keepLast).map((candidate) => candidate.runId));
  const cutoff = now - olderThanDays * DAY_MS;

  const planned: Plan[] = [];
  const skipped: GcSkip[] = [];
  for (const candidate of candidates) {
    if (candidate.skip !== undefined) { skipped.push({ runId: candidate.runId, path: null, ...candidate.skip }); continue; }
    if (kept.has(candidate.runId)) { skipped.push({ runId: candidate.runId, path: null, reason: "keep-last" }); continue; }
    if (candidate.touchedAt >= cutoff) {
      skipped.push({ runId: candidate.runId, path: null, reason: "too-recent", detail: new Date(candidate.touchedAt).toISOString() });
      continue;
    }
    const uncleaned = options.includeUncleaned === true && candidate.run.body.drive !== undefined
      && (candidate.run.body.drive as { cleanedUp?: unknown }).cleanedUp !== true;
    if (candidate.runsDir !== undefined) {
      assertDirectChild(runsRoot, candidate.runsDir.path);
      const size = await directorySize(candidate.runsDir.path);
      planned.push({ item: { runId: candidate.runId, kind: "runs", path: candidate.runsDir.path, bytes: size.bytes, worktree: false, ...(uncleaned ? { uncleaned: true } : {}) }, worktreeRepo: null });
    }
    if (candidate.workspacesDir !== undefined) {
      assertDirectChild(workspacesRoot, candidate.workspacesDir.path);
      const size = await directorySize(candidate.workspacesDir.path);
      const item: GcItem = { runId: candidate.runId, kind: "workspaces", path: candidate.workspacesDir.path, bytes: size.bytes, worktree: false, ...(uncleaned ? { uncleaned: true } : {}) };
      // Registration decides the removal command, so it is resolved in both modes: dry-run then names what apply would do.
      const candidatePaths = repoCandidates(candidate.run, candidate.group, options.repoResolver);
      const derived = await commonDirRepo(candidate.workspacesDir.path);
      if (derived !== null && !candidatePaths.includes(derived)) candidatePaths.push(derived);
      const self = await canon(candidate.workspacesDir.path);
      let registered: string | null = null;
      const unreadable: string[] = [];
      for (const repo of candidatePaths) {
        if (await canon(repo) === self) continue; // a clone's own .git is not a registration of the clone
        try { if (await registeredWorktree(repo, candidate.workspacesDir.path, self)) { registered = repo; break; } }
        catch { unreadable.push(repo); }
      }
      if (registered !== null) planned.push({ item: { ...item, worktree: true }, worktreeRepo: registered });
      else if (unreadable.length > 0) skipped.push({ runId: candidate.runId, path: candidate.workspacesDir.path, reason: "repository-unreadable", detail: unreadable.join(", ") });
      else planned.push({ item, worktreeRepo: null });
    }
  }

  const apply = options.apply === true;
  const removed: GcItem[] = [];
  if (apply) {
    for (const plan of planned) {
      try {
        if (plan.worktreeRepo !== null) {
          // No --force: a dirty worktree's refusal is git's own, and is the skip below (the workspace is kept).
          await git(plan.worktreeRepo, [...QUIET_GIT, "worktree", "remove", plan.item.path]);
        } else {
          await rm(plan.item.path, { recursive: true, force: true });
        }
        removed.push(plan.item);
      } catch (error) {
        if (plan.worktreeRepo !== null) skipped.push({ runId: plan.item.runId, path: plan.item.path, ...worktreeRefusal(error) });
        else skipped.push({ runId: plan.item.runId, path: plan.item.path, reason: "remove-failed", detail: (error as Error).message });
      }
    }
  }

  const bytes = (apply ? removed : planned.map((plan) => plan.item)).reduce((sum, item) => sum + item.bytes, 0);
  return { dryRun: !apply, planned: planned.map((plan) => plan.item), removed, skipped, bytes };
}

/** When the run last moved: its `endedAt` (stamped on entering a terminal state), else the directory's own mtime. */
function touchOf(runsDir: RunDirectory | undefined, workspacesDir: RunDirectory | undefined, body: Record<string, unknown> | undefined): number {
  let touched = 0;
  if (body !== undefined && typeof body.endedAt === "number" && Number.isFinite(body.endedAt)) touched = body.endedAt;
  for (const dir of [runsDir, workspacesDir]) if (dir !== undefined) touched = Math.max(touched, dir.mtimeMs);
  return touched;
}