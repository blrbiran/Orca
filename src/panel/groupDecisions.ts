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

/** Plan Task 8: the states in which a run's reported decisions may still land; such a run lists nothing as unlanded. */
const NOT_YET_SETTLED = new Set(["starting", "start-pending", "accepted", "unknown", "collected", "reconciling", "landed"]);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
/** A ledger line's field as text: Orca wrote it as a string; anything else is shown as its JSON, never dropped. */
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value) ?? "");

/** What the run reported, from the report already in the control DB (spec §10.4); a run with no saved report reported nothing. */
async function reportedOf(store: ControlStore, runId: string): Promise<ReportedDecisions> {
  try { return reportedDecisionsOf(await savedReport(store, runId)); }
  catch (error) {
    if (error instanceof ControlError && error.code === "control-terminal-pending") return { kind: "absent" };
    throw error;
  }
}

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
    const landed = (body.drive?.landedCommit ?? null) !== null || (body.drive?.ledgerCommit ?? null) !== null;

    const decisions: RunView["decisions"] = [];
    if (landed) {
      const files = new Set([`${runId}.jsonl`, `reconcile-${runId}.jsonl`]);
      const seen = new Set<string>();
      for (const line of lines) {
        if (!files.has(basename(line.path)) || seen.has(line.id)) continue;
        seen.add(line.id);
        const { where, value } = first.get(line.id)!;
        decisions.push({ id: line.id, where, question: text(field(value, "question")), chose: text(field(value, "chose")), kind: text(field(value, "kind")), scope: text(field(value, "scope")) });
      }
    }

    const pending: RunView["pending"] = pendingRows.filter((p) => p.runId === runId).map((p) => ({
      pendingId: p.pendingId, reason: p.entry.reason, state: p.state,
      question: textOrNull(field(p.entry.entry, "question")), chose: textOrNull(field(p.entry.entry, "chose")),
      undoHow: textOrNull(field(field(p.entry.entry, "undo"), "how")),
    }));

    const unlanded: RunView["unlanded"] = [];
    if (!landed && !NOT_YET_SETTLED.has(String(body.state))) {
      // A non-array value is one entry, at index 0, as the landing records it as one pending item.
      const entries = reported.kind === "array" ? reported.entries : reported.kind === "malformed" ? [reported.value] : [];
      entries.forEach((entry, entryIndex) => unlanded.push({ entryIndex, question: textOrNull(field(entry, "question")), chose: textOrNull(field(entry, "chose")) }));
    }

    const runs = tasks.get(body.taskId) ?? [];
    runs.push({ runId, reported: reported.kind, decisions, pending, unlanded });
    tasks.set(body.taskId, runs);
  }

  return groupDecisionsViewSchema.parse({
    schema: "orca-group-decisions-v1", groupId, projectKey,
    pendingCount: pendingRows.filter((p) => p.state === "pending").length,
    tasks: [...tasks].map(([taskId, runs]) => ({ taskId, runs })),
  });
}
