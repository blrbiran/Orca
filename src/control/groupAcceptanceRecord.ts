/**
 * Tester follow-up E §5 (#241): the group acceptance record kept on the group body as `acceptance`, and the predicates the
 * done pass, the integration pass and the views read. Type imports only, so modules on the driver's import cycle can read
 * it without pulling in the acceptance runner (groupAcceptance.ts).
 */
import { fullSuiteCommand } from "./fullSuite.js";
import type { ControlStore } from "./store.js";

export type GroupAcceptanceResult = "passed" | "failed" | "passed-relative" | "not-needed" | "not-run" | "waived";
export interface GroupAcceptance {
  /** The `orca/<g>` tip the record is for; null for not-run (no single tree). */
  tip: string | null;
  result: GroupAcceptanceResult;
  why?: "single-landing" | "multi-repo" | "dir" | "work-branch-missing";
  /** work-branch-missing (#278): how many runs had landed when the branch was found missing; a later landing checks again. */
  landings?: number;
  /** Every command that ran, setup named `setup: <cmd>`, with its exit and wall-clock ms (driveRecord.ts checkRunCommandSchema). */
  commands: Array<{ command: string; exit: string; ms: number }>;
  /** The failing command's output tail (failed, and waived after it). */
  tail?: string;
  at: number;
  /** waive-acceptance: who accepted the failed tip anyway, and why. */
  waived?: { by: string; note: string; at: number };
  /**
   * Full suite spec 2026-11-12 §4 (#279): the project's full-suite command this acceptance ran after the union (null: none
   * set -- then `suggestion` is what code detected, never run), each run's exit (a red first run is run once more), and
   * whether it passed only on the retry. Absent on records written before it, and on not-run.
   */
  fullSuite?: FullSuiteRecord;
}
export interface FullSuiteRecord {
  command: string | null; suggestion: string | null; exits: string[]; flaky: boolean;
  /**
   * Spec 2026-11-16: when the suite was red on the tip, the same command run at the group's base. `exits` red
   * twice there means the failure pre-dated the group (`passed-relative`); green there means a regression.
   */
  baseline?: { tip: string; exits: string[]; tail?: string };
}

const SATISFIED: ReadonlySet<GroupAcceptanceResult> = new Set(["passed", "passed-relative", "not-needed", "not-run", "waived"]);

export function acceptanceOf(body: unknown): GroupAcceptance | null {
  const value = (body as { acceptance?: unknown } | null)?.acceptance;
  return value === undefined || value === null || typeof value !== "object" ? null : value as GroupAcceptance;
}

/** How many of the group's tasks landed a commit on its branch (any run of the task); a DB read, no git. */
export function landedTaskCount(store: Pick<ControlStore, "db">, groupId: string): number {
  return countLandedTasks(store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(groupId).map((row) => JSON.parse(String(row.body)) as unknown));
}

/** Tester #327 review: landedTaskCount's rule over run bodies a caller already decoded (the panel summary's snapshot). */
export function countLandedTasks(runs: Iterable<unknown>): number {
  const tasks = new Set<string>();
  for (const value of runs) {
    const run = value as { taskId?: unknown; drive?: { landedCommit?: unknown } } | null;
    if (typeof run?.taskId === "string" && typeof run.drive?.landedCommit === "string") tasks.add(run.taskId);
  }
  return tasks.size;
}

/** How many of the group's runs landed a commit (#278: a later landing changes it); a DB read, no git. */
export function landedRunCount(store: Pick<ControlStore, "db">, groupId: string): number {
  let count = 0;
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(groupId)) {
    if (typeof (JSON.parse(String(row.body)) as { drive?: { landedCommit?: unknown } }).drive?.landedCommit === "string") count += 1;
  }
  return count;
}

/**
 * The gate the done pass, the integration pass and a dependent's prerequisite read (DB only, no git child). A recorded
 * acceptance answers by its result. With none recorded yet, a group that needs none by definition is accepted -- at most
 * one task landed (its own checks ran on that tree), or a multi-directory or folder group (always `not-run`, a known gap)
 * -- and any other group waits for the acceptance pass. A work branch found missing (#278) answers as no record would, and
 * also satisfies a group already `done` (it stays done, and its dependents keep reading it so); any other group that
 * needs an acceptance has no tree to accept and waits.
 */
export function acceptanceSatisfied(store: ControlStore, groupId: string, body: unknown,
  // Tester #327 review: a reader that already holds the group's runs counts them itself (countLandedTasks).
  landedTasks: () => number = () => landedTaskCount(store, groupId)): boolean {
  const record = acceptanceOf(body);
  if (record?.why === "work-branch-missing" && (body as { status?: unknown }).status === "done") return true;
  if (record !== null && record.why !== "work-branch-missing") return SATISFIED.has(record.result);
  const b = (body ?? {}) as { multiDir?: unknown; dirWorkspace?: unknown; plan?: { repoId?: unknown } };
  if (b.multiDir != null || b.dirWorkspace != null) return true;
  const landed = landedTasks();
  // Full suite spec §4: with a full-suite command set, one landing waits for the acceptance too. Settings that cannot be
  // read wait as well: the acceptance pass names that error every round (groupAcceptance.ts acceptGroups).
  let suite: string | null;
  try { suite = typeof b.plan?.repoId === "string" ? fullSuiteCommand(store, b.plan.repoId) : null; } catch { return false; }
  return landed <= maxLandingsWithoutAcceptance(suite);
}

/**
 * Full suite spec §4: the most landings a group may have and still need no acceptance -- one (its own checks ran on that
 * tree), or none once the project has a full-suite command (the suite ran on no task's tree).
 */
export function maxLandingsWithoutAcceptance(suite: string | null): number {
  return suite === null ? 1 : 0;
}

/** Full suite spec §5: the warning a recorded acceptance gives about its full suite (never a blocking problem); else null. */
export function fullSuiteWarning(record: GroupAcceptance | null): string | null {
  const suite = record?.fullSuite;
  if (record === null || record.result === "failed") return null;
  // Tester follow-up K, item 2: a passed (or not-needed) record written before the full suite existed ran none either --
  // read as not set. A waived or not-run record without the field never had a suite to run, so it says nothing.
  if (suite === undefined) return record.result === "passed" || record.result === "not-needed" ? "full-suite-not-set" : null;
  if (suite.command === null) return "full-suite-not-set";
  if (suite.baseline !== undefined) return `full-suite-pre-existing:${suite.command}`;
  return suite.flaky ? `full-suite-flaky:${suite.command}` : null;
}

/** The command a failed acceptance stopped at (the last one it ran). */
export function failedCommandOf(record: GroupAcceptance): string {
  return record.commands.at(-1)?.command ?? "?";
}

/** The problem a failed acceptance shows (Board, Problems, `group show`); null otherwise. */
export function acceptanceProblem(record: GroupAcceptance | null): string | null {
  return record?.result === "failed" ? `group-acceptance-failed:${failedCommandOf(record)}` : null;
}

/**
 * Delivery tail spec 2026-11-17 D3 (human ruling 3; Correction 1.2, 1.3, 1.6): the acceptance on the commit a `local`
 * delivery made, kept on the group body as `deliveredAcceptance`, keyed by the tip delivered and the commit it became.
 * `not-needed` with `same-tree` (the delivered tree is the accepted tip's) or `already-in-target` (the target held the tip:
 * no new commit was made for it); `waived` carries a person's waiver -- theirs, or the tip's carried over (Correction 1.6).
 */
export interface DeliveredAcceptance {
  tip: string; commit: string;
  result: "passed" | "passed-relative" | "failed" | "not-needed" | "waived";
  why?: "same-tree" | "already-in-target" | "before-record";
  commands: Array<{ command: string; exit: string; ms: number }>;
  tail?: string; at: number;
  waived?: { by: string; note: string; at: number };
}

export function deliveredAcceptanceOf(body: unknown): DeliveredAcceptance | null {
  const value = (body as { deliveredAcceptance?: unknown } | null)?.deliveredAcceptance;
  return value === undefined || value === null || typeof value !== "object" ? null : value as DeliveredAcceptance;
}

/**
 * What D3 checks for this body, read without the integration schema (this module stays a leaf): a frozen, idle `local`
 * delivery with no history promise and nothing pending, delivered as `lastIntegrated` -> `commit`. `madeForTip` is false
 * when no new commit was made for that tip (Correction 1.3). Null when D3 does not apply.
 */
export function deliveredAcceptanceTarget(body: unknown): { tip: string; commit: string; madeForTip: boolean; beforeRecord: boolean } | null {
  const integration = (body as { integration?: unknown } | null)?.integration as {
    scheme?: { delivery?: unknown; historyExpectation?: unknown }; frozen?: unknown; state?: unknown; pending?: unknown;
    lastIntegrated?: unknown; integratedCommit?: unknown; integratedFor?: unknown } | undefined;
  if (integration === undefined || integration === null || typeof integration !== "object") return null;
  if (integration.scheme?.delivery !== "local" || integration.scheme.historyExpectation !== undefined || integration.frozen !== true) return null;
  if (integration.state !== "idle" || (integration.pending !== null && integration.pending !== undefined) || typeof integration.lastIntegrated !== "string") return null;
  const madeForTip = typeof integration.integratedCommit === "string" && integration.integratedFor === integration.lastIntegrated;
  // Review 2026-11-17 finding 2: a record integrated before `integratedFor` existed cannot say which tip its commit was for.
  const beforeRecord = integration.integratedFor === undefined && typeof integration.integratedCommit === "string";
  return { tip: integration.lastIntegrated, commit: madeForTip || beforeRecord ? integration.integratedCommit as string : integration.lastIntegrated, madeForTip, beforeRecord };
}

const DELIVERED_SATISFIED: ReadonlySet<DeliveredAcceptance["result"]> = new Set(["passed", "passed-relative", "not-needed", "waived"]);

/**
 * The done gate's half for D3 (DB only): true where D3 does not apply; else the record for the current delivery must be
 * satisfied. A group already `done` without a current record stays satisfied (it was done before this record existed).
 */
export function deliveredAcceptanceSatisfied(body: unknown): boolean {
  const target = deliveredAcceptanceTarget(body);
  // Only a delivery whose commit D3 would check waits for its record: one made before integratedFor existed, or one
  // where the target already held the tip, never runs a command (it is recorded not-needed), so done does not wait a round.
  if (target === null || !target.madeForTip) return true;
  const record = deliveredAcceptanceOf(body);
  // Review 2026-11-17 finding 3: an archived group is never checked (the pass skips it); it does not hold its dependents.
  const archived = (body as { archived?: unknown } | null)?.archived != null;
  if (record === null || record.tip !== target.tip || record.commit !== target.commit) return (body as { status?: unknown }).status === "done" || archived;
  return DELIVERED_SATISFIED.has(record.result);
}

/** The problem a failed delivered acceptance shows (Overview, `group show`); null otherwise. */
export function deliveredAcceptanceProblem(body: unknown): string | null {
  const record = deliveredAcceptanceOf(body), target = deliveredAcceptanceTarget(body);
  if (record === null || target === null || record.result !== "failed" || record.tip !== target.tip || record.commit !== target.commit) return null;
  return `delivered-acceptance-failed:${record.commands.at(-1)?.command ?? "?"}`;
}

/**
 * Spec 2026-11-16: the commit the group branched from -- the base of its first work run, before any task landed. Used to
 * classify a red full suite (red there too means the failure pre-dated this group) and, pre-existing failures spec L3
 * (#341), as the base a failed task check is run at (baseCheckRecord.ts). Null before any work run has a base.
 */
export function groupBaseCommit(store: ControlStore, groupId: string): string | null {
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { phase?: unknown; drive?: { base?: unknown } };
    if (run.phase === "work" && typeof run.drive?.base === "string") return run.drive.base;
  }
  return null;
}
