import { basename } from "node:path";
import { projectKeyOf } from "../corrections/projectKey.js";
import { CorrectRejection } from "../corrections/rejection.js";
import { ControlError } from "../control/errors.js";
import { savedReport } from "../control/executionDriver.js";
import { labelDecisions, ledgerSources } from "../control/ledgerAtRef.js";
import { listFlaggedDecisions, listFlagsInvolving } from "../control/flaggedDecisions.js";
import { listPendingDecisions } from "../control/pendingDecisions.js";
import { readGroup } from "../control/queries.js";
import { reportedDecisionsOf, type ReportedDecisions } from "../control/reportedDecisions.js";
import type { ControlStore } from "../control/store.js";
import { groupDecisionsViewSchema, type GroupDecisionsViewV1 } from "../control/webProtocol.js";

type RunView = GroupDecisionsViewV1["tasks"][number]["runs"][number];

/**
 * Plan Task 8: the run states in which a run's reported decisions may still land; such a run lists nothing as unlanded.
 * `landed` is among them: an empty result's ledger-only commit is written in E, after the run is already `landed`.
 */
const DECISIONS_MAY_STILL_LAND = new Set(["starting", "start-pending", "accepted", "unknown", "collected", "reconciling", "landed"]);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
/**
 * Reported-decisions spec 2026-10-20 §6: an entry's grade, from its raw value. Only exactly "minor" is minor: an absent
 * grade (every line written before it) or one the ledger would refuse reads as major, so a refused entry with a bad
 * grade is never hidden behind the "show minor" control.
 */
const importanceOf = (value: unknown): "major" | "minor" => (field(value, "importance") === "minor" ? "minor" : "major");
/** A ledger line's field as text: Orca wrote it as a string; anything else is shown as its JSON, never dropped. */
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value) ?? "");

/**
 * What the run reported, from the report already in the control DB (spec §10.4); a run with no saved report reported
 * nothing. A saved report that cannot be read (Task 8 fix round 1, M3) is named as such for that run only: one bad
 * artifact must not take the whole group's view away.
 */
async function reportedOf(store: ControlStore, runId: string): Promise<ReportedDecisions | { kind: "unreadable" }> {
  try { return reportedDecisionsOf(await savedReport(store, runId)); }
  catch (error) {
    if (error instanceof ControlError && error.code === "control-terminal-pending") return { kind: "absent" };
    // Final review T8: only the artifact read's own failures are "unreadable"; a store or programming error propagates.
    if (error instanceof ControlError && ARTIFACT_UNREADABLE.has(error.code)) return { kind: "unreadable" };
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return { kind: "unreadable" };
    throw error;
  }
}

/** What readArtifact (archive.ts) throws for an artifact whose bytes cannot be read back as recorded. */
const ARTIFACT_UNREADABLE = new Set<string>(["artifact-not-found", "artifact-hash-mismatch", "control-path-symlink"]);

/**
 * GET /api/control/groups/:groupId/decisions. Per task and run: the landed decisions with the first ref holding each,
 * the pending items with their reason, and -- for a run that ended without landing -- the entries it reported.
 * Kanban spec §9a: a landed decision Orca flagged carries its flag; `correctedIds` are the decision ids some recorded
 * correction names (the caller reads the corrections store), and a flag on one of them reads `corrected` -- disagreeing
 * is a correction, so it no longer waits for the person. Nothing is written here.
 */
export async function readGroupDecisionsView(store: ControlStore, repo: string, groupId: string, correctedIds: ReadonlySet<string> = new Set(), group?: unknown): Promise<GroupDecisionsViewV1> {
  // group-not-found before any git child; a caller that already read the group passes it.
  const record = group ?? readGroup(store, groupId);
  const { first, lines } = await labelDecisions(repo, await ledgerSources(store, repo, groupId, record));
  const pendingRows = listPendingDecisions(store, groupId);
  // Checks spec 2026-10-22 §6.6: a model-review finding this group is involved in is listed here too (its row is the
  // review group's, named as ownerGroupId so a ratify goes there).
  const flags = new Map([...listFlaggedDecisions(store, groupId), ...listFlagsInvolving(store, groupId)].map((row) => [row.decisionId, row]));
  const flagOf = (id: string): RunView["decisions"][number]["flag"] => {
    const row = flags.get(id);
    if (row === undefined) return null;
    const state = row.state === "ratified" ? "ratified" : correctedIds.has(id) ? "corrected" : "flagged";
    return { state, source: row.source, reason: row.reason, evidence: row.evidence };
  };
  const groupFlagOf = (row: ReturnType<typeof listFlaggedDecisions>[number]) => ({
    decisionId: row.decisionId, ...flagOf(row.decisionId)!,
    ...(row.severity === "minor" ? { severity: "minor" as const } : row.source === "model-review" ? { severity: "major" as const } : {}),
    ...(row.groupId === groupId ? {} : { ownerGroupId: row.groupId }),
  });
  let projectKey: string | null;
  try { projectKey = await projectKeyOf(repo); }
  catch (error) { if (error instanceof CorrectRejection) projectKey = null; else throw error; }

  const tasks = new Map<string, RunView[]>();
  const shown = new Set<string>();
  for (const row of store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const runId = String(row.id);
    const body = JSON.parse(String(row.body)) as { taskId?: unknown; state?: unknown; drive?: { landedCommit?: unknown; ledgerCommit?: unknown } };
    if (typeof body.taskId !== "string") continue;
    const reported = await reportedOf(store, runId);
    // Final review I2: pending rows are inserted only when a landing is recorded, so a run that has any landed, even
    // an empty result whose entries were all refused (no ledger commit); its entries are pending, not also unlanded.
    const landed = (body.drive?.landedCommit ?? null) !== null || (body.drive?.ledgerCommit ?? null) !== null
      || pendingRows.some((p) => p.runId === runId);
    // Controller ruling (fix round 1): a run whose decisions may still land is not settled, so `reported` on it is not final.
    const settled = landed || !DECISIONS_MAY_STILL_LAND.has(String(body.state));

    const decisions: RunView["decisions"] = [];
    if (landed) {
      const files = new Set([`${runId}.jsonl`, `reconcile-${runId}.jsonl`]);
      const seen = new Set<string>();
      for (const line of lines) {
        if (!files.has(basename(line.path)) || seen.has(line.id)) continue;
        seen.add(line.id);
        const { where, value } = first.get(line.id)!;
        decisions.push({ id: line.id, where, question: text(field(value, "question")), chose: text(field(value, "chose")), kind: text(field(value, "kind")), scope: text(field(value, "scope")), importance: importanceOf(value), flag: flagOf(line.id) });
      }
    }

    const pending: RunView["pending"] = pendingRows.filter((p) => p.runId === runId).map((p) => ({
      pendingId: p.pendingId, reason: p.entry.reason, state: p.state,
      question: textOrNull(field(p.entry.entry, "question")), chose: textOrNull(field(p.entry.entry, "chose")),
      undoHow: textOrNull(field(field(p.entry.entry, "undo"), "how")), importance: importanceOf(p.entry.entry),
    }));

    const unlanded: RunView["unlanded"] = [];
    if (!landed && settled) {
      // A non-array value is one entry, at index 0, as the landing records it as one pending item.
      const entries = reported.kind === "array" ? reported.entries : reported.kind === "malformed" ? [reported.value] : [];
      entries.forEach((entry, entryIndex) => unlanded.push({ entryIndex, question: textOrNull(field(entry, "question")), chose: textOrNull(field(entry, "chose")), importance: importanceOf(entry) }));
    }

    for (const decision of decisions) shown.add(decision.id);
    const runs = tasks.get(body.taskId) ?? [];
    runs.push({ runId, settled, reported: reported.kind, decisions, pending, unlanded });
    tasks.set(body.taskId, runs);
  }

  return groupDecisionsViewSchema.parse({
    schema: "orca-group-decisions-v1", groupId, projectKey,
    // goal.md §1.3: a minor entry must not demand attention, so only major pending entries count toward needs-human.
    pendingCount: pendingRows.filter((p) => p.state === "pending" && importanceOf(p.entry.entry) === "major").length,
    // A flag counts while it waits: not ratified and no correction names its decision. Counted from the store, so a
    // flagged decision on a ref this read does not reach still counts.
    // Checks spec §6.6 (P5): a minor flag is listed, never counted.
    flaggedCount: [...flags.values()].filter((row) => row.state === "flagged" && row.severity !== "minor" && !correctedIds.has(row.decisionId)).length,
    tasks: [...tasks].map(([taskId, runs]) => ({ taskId, runs })),
    // Kanban spec §9a.2: a flag no run's landed lines carry here (an integration conflict an agent resolved has no
    // ledger line), listed for the group so it is never only a number.
    groupFlags: [...flags.values()].filter((row) => !shown.has(row.decisionId)).map(groupFlagOf),
  });
}
