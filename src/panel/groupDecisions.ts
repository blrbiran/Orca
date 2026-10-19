import { basename } from "node:path";
import { projectKeyOf } from "../corrections/projectKey.js";
import { CorrectRejection } from "../corrections/rejection.js";
import { ControlError } from "../control/errors.js";
import { savedReport } from "../control/executionDriver.js";
import { labelDecisions, ledgerSources } from "../control/ledgerAtRef.js";
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
 */
export async function readGroupDecisionsView(store: ControlStore, repo: string, groupId: string): Promise<GroupDecisionsViewV1> {
  readGroup(store, groupId); // group-not-found before any git child
  const { first, lines } = await labelDecisions(repo, await ledgerSources(store, repo, groupId));
  const pendingRows = listPendingDecisions(store, groupId);
  let projectKey: string | null;
  try { projectKey = await projectKeyOf(repo); }
  catch (error) { if (error instanceof CorrectRejection) projectKey = null; else throw error; }

  const tasks = new Map<string, RunView[]>();
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
        decisions.push({ id: line.id, where, question: text(field(value, "question")), chose: text(field(value, "chose")), kind: text(field(value, "kind")), scope: text(field(value, "scope")), importance: importanceOf(value) });
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

    const runs = tasks.get(body.taskId) ?? [];
    runs.push({ runId, settled, reported: reported.kind, decisions, pending, unlanded });
    tasks.set(body.taskId, runs);
  }

  return groupDecisionsViewSchema.parse({
    schema: "orca-group-decisions-v1", groupId, projectKey,
    // goal.md §1.3: a minor entry must not demand attention, so only major pending entries count toward needs-human.
    pendingCount: pendingRows.filter((p) => p.state === "pending" && importanceOf(p.entry.entry) === "major").length,
    tasks: [...tasks].map(([taskId, runs]) => ({ taskId, runs })),
  });
}
