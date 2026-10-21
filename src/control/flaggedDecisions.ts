import { z } from "zod";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";

/**
 * Kanban and group orchestration spec 2026-10-20 §9a (controller's call): a decision Orca lets land and then flags for a
 * person ("land, then flag"). The ledger is append-only and `.strict()`, so the flag lives here, keyed by the landed
 * decision's id. Ratify clears it; disagreeing is a correction on the decision (nothing is reverted). A flag never
 * blocks anything -- it is shown and counted, nothing waits on it.
 *
 * `source` names who raised it (kebab-case; e.g. `reconcile`, `integration-conflict`, `test-change`), so a later
 * source needs no schema step.
 */
export const flagSourceSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const flagBodySchema = z.object({
  reason: z.string().min(1).max(2048),
  evidence: z.array(z.string().max(4096)).max(32),
  flaggedBy: z.string().min(1),
  flaggedAt: z.string().min(1),
  ratifiedBy: z.string().min(1).optional(),
  // CLI v2 spec §16: the channel the ratify came by; absent on rows ratified before it and on Orca's own.
  ratifiedVia: z.string().min(1).optional(),
  ratifiedAt: z.string().min(1).optional(),
  ratifyCommandId: z.string().min(1).optional(),
  // Checks spec 2026-10-22 §6.6: a model-review finding's grade (absent = major, today's meaning), the person's
  // dismissal reason, and the finding's evidence groups (stored structurally; the flag's row stays the review group's).
  severity: z.enum(["major", "minor"]).optional(),
  note: z.string().min(1).max(2048).optional(),
  involvedGroupIds: z.array(z.string().min(1)).min(2).max(8).optional(),
}).strict();

export interface FlaggedDecisionRow {
  decisionId: string;
  groupId: string;
  runId: string | null;
  source: string;
  state: "flagged" | "ratified";
  reason: string;
  evidence: string[];
  flaggedBy: string;
  flaggedAt: string;
  ratifiedBy: string | null;
  ratifiedVia: string | null;
  ratifiedAt: string | null;
  severity: "major" | "minor";
  note: string | null;
  involvedGroupIds: string[];
}

export interface FlagInput {
  decisionId: string;
  groupId: string;
  runId: string | null;
  source: string;
  reason: string;
  evidence: readonly string[];
  /** Rule 13: who raised it (`orca-auto` for the driver). */
  by: string;
  at: string;
  severity?: "major" | "minor";
  involvedGroupIds?: readonly string[];
}

type Stored = { decision_id: string; group_id: string; run_id: string | null; source: string; state: FlaggedDecisionRow["state"]; body: string };
const COLUMNS = "decision_id,group_id,run_id,source,state,body";

function toRow(row: Stored): FlaggedDecisionRow {
  const body = flagBodySchema.parse(JSON.parse(row.body));
  return {
    decisionId: row.decision_id, groupId: row.group_id, runId: row.run_id, source: row.source, state: row.state,
    reason: body.reason, evidence: body.evidence, flaggedBy: body.flaggedBy, flaggedAt: body.flaggedAt,
    ratifiedBy: body.ratifiedBy ?? null, ratifiedVia: body.ratifiedVia ?? null, ratifiedAt: body.ratifiedAt ?? null,
    severity: body.severity ?? "major", note: body.note ?? null, involvedGroupIds: body.involvedGroupIds ?? [],
  };
}

/**
 * Called inside the caller's transaction. A decision is flagged at most once: a second flag of the same id (a re-run of
 * the same landing, or a ratified one flagged again) keeps the first row, so ratifying is never silently undone.
 * Returns whether this call wrote the row.
 */
export function flagDecision(store: ControlStore, input: FlagInput): boolean {
  const body = flagBodySchema.parse({
    reason: input.reason, evidence: [...input.evidence], flaggedBy: input.by, flaggedAt: input.at,
    ...(input.severity === undefined ? {} : { severity: input.severity }), ...(input.involvedGroupIds === undefined ? {} : { involvedGroupIds: [...input.involvedGroupIds] }),
  });
  const result = store.db.prepare(
    `INSERT INTO flagged_decisions(${COLUMNS}) VALUES (?,?,?,?,'flagged',?) ON CONFLICT(decision_id) DO NOTHING`,
  ).run(input.decisionId, input.groupId, input.runId, flagSourceSchema.parse(input.source), JSON.stringify(body));
  return Number(result.changes) === 1;
}

export function listFlaggedDecisions(store: ControlStore, groupId: string): FlaggedDecisionRow[] {
  return (store.db.prepare(`SELECT ${COLUMNS} FROM flagged_decisions WHERE group_id=? ORDER BY rowid`).all(groupId) as Stored[]).map(toRow);
}

/**
 * Checks spec §6.6: the model-review flags another group owns that name `groupId` among their involved groups (a JSON
 * scan over the `model-review` rows; few at this size).
 */
export function listFlagsInvolving(store: ControlStore, groupId: string): FlaggedDecisionRow[] {
  return (store.db.prepare(`SELECT ${COLUMNS} FROM flagged_decisions WHERE source='model-review' AND group_id<>? ORDER BY rowid`).all(groupId) as Stored[])
    .map(toRow).filter((row) => row.involvedGroupIds.includes(groupId));
}

export function readFlaggedDecision(store: ControlStore, decisionId: string): FlaggedDecisionRow | null {
  const row = store.db.prepare(`SELECT ${COLUMNS} FROM flagged_decisions WHERE decision_id=?`).get(decisionId) as Stored | undefined;
  return row ? toRow(row) : null;
}

/** Flagged → ratified. Refuses an unknown id (or another group's) by name, and a second ratify as a no-op command. */
export function ratifyFlag(store: ControlStore, groupId: string, decisionId: string, by: { actorId: string; via?: string; commandId: string; at: string; note?: string }): void {
  const row = store.db.prepare(`SELECT ${COLUMNS} FROM flagged_decisions WHERE decision_id=?`).get(decisionId) as Stored | undefined;
  if (row === undefined || row.group_id !== groupId) throw new ControlError("flagged-decision-not-found");
  if (row.state === "ratified") throw new ControlError("no-op-command");
  const body = { ...flagBodySchema.parse(JSON.parse(row.body)), ratifiedBy: by.actorId, ...(by.via === undefined ? {} : { ratifiedVia: by.via }), ratifiedAt: by.at, ratifyCommandId: by.commandId, ...(by.note === undefined ? {} : { note: by.note }) };
  store.db.prepare("UPDATE flagged_decisions SET state='ratified', body=? WHERE decision_id=?").run(JSON.stringify(flagBodySchema.parse(body)), decisionId);
}
