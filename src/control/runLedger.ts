import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { validateLine } from "../ledger/validateLine.js";
import { DECISION_KINDS, DECISION_SCOPES } from "../ledger/types.js";
import type { DecisionEvent } from "../ledger/schema.js";
import { appendEvents } from "../ledger/writer.js";
import { ccloopEvidence } from "../scheduler/ledgerWiring.js";
import type { ReportedDecisions } from "./reportedDecisions.js";

export const agentDecisionId = (ledgerRun: string, entryIndex: number): string => `${ledgerRun}/agent-${entryIndex}`;
export const pendingIdOf = (ledgerRun: string, entryIndex: number): string => `pending-${ledgerRun}-${entryIndex}`;

export const pendingEntrySchema = z
  .object({
    pendingId: z.string().min(1),
    ledgerRun: z.string().min(1),
    entryIndex: z.number().int().min(0),
    entry: z.unknown(),
    reason: z.string().min(1),
    at: z.string().min(1),
    evidence: z.array(z.string()),
  })
  .strict();
export interface PendingEntry {
  pendingId: string;
  ledgerRun: string;
  entryIndex: number;
  entry: unknown;
  reason: string;
  at: string;
  evidence: string[];
}

export interface NormalizeCtx {
  ledgerRun: string;
  entryIndex: number;
  at: string;
  evidence: string[];
  undoHow?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Orca owns ev/id/at/run/evidence; the agent's values for them are dropped silently, never refused. */
export function normalizeAgentEntry(
  entry: unknown,
  ctx: NormalizeCtx,
): { ok: true; event: DecisionEvent } | { ok: false; reason: string } {
  if (!isPlainObject(entry)) return { ok: false, reason: "entry-not-object" };
  const draft: Record<string, unknown> = { ...entry };
  for (const key of ["ev", "id", "at", "run", "evidence"]) delete draft[key];
  draft.ev = "decision";
  draft.id = agentDecisionId(ctx.ledgerRun, ctx.entryIndex);
  draft.at = ctx.at;
  draft.run = ctx.ledgerRun;
  draft.evidence = ctx.evidence;
  if (ctx.undoHow !== undefined && isPlainObject(draft.undo)) draft.undo = { ...draft.undo, how: ctx.undoHow };

  const kind = draft.kind;
  if (!(DECISION_KINDS as readonly unknown[]).includes(kind)) {
    return { ok: false, reason: `kind-unknown:${JSON.stringify(kind)}` };
  }
  const scope = draft.scope;
  if (!(DECISION_SCOPES as readonly unknown[]).includes(scope)) {
    return { ok: false, reason: `scope-unknown:${JSON.stringify(scope)}` };
  }

  const verdict = validateLine(JSON.stringify(draft));
  if (verdict.verdict === "rejected") return { ok: false, reason: `rejected: ${verdict.reasons.join("; ")}` };
  if (verdict.verdict === "downgraded") return { ok: false, reason: `tier-0: ${verdict.reasons.join("; ")}` };
  return { ok: true, event: draft as DecisionEvent };
}

export async function writeRunLedger(
  decisionsDir: string,
  input: {
    ledgerRun: string;
    reported: ReportedDecisions;
    codeAuthored: DecisionEvent[];
    at: string;
    evidence: string[];
  },
): Promise<{ writtenIds: string[]; pending: PendingEntry[] }> {
  const { ledgerRun, reported, codeAuthored, at, evidence } = input;
  const writtenIds: string[] = [];
  const pending: PendingEntry[] = [];
  const refuse = (entryIndex: number, entry: unknown, reason: string): void => {
    pending.push({ pendingId: pendingIdOf(ledgerRun, entryIndex), ledgerRun, entryIndex, entry, reason, at, evidence });
  };

  // Orca's own template failing is a bug: let it throw.
  if (codeAuthored.length > 0) {
    await appendEvents(decisionsDir, ledgerRun, codeAuthored);
    writtenIds.push(...codeAuthored.map((e) => e.id));
  }

  if (reported.kind === "malformed") {
    refuse(0, reported.value, "decisions-not-array");
    return { writtenIds, pending };
  }
  if (reported.kind === "absent") return { writtenIds, pending };

  const passed: { index: number; entry: unknown; event: DecisionEvent }[] = [];
  reported.entries.forEach((entry, index) => {
    const r = normalizeAgentEntry(entry, { ledgerRun, entryIndex: index, at, evidence });
    if (r.ok) passed.push({ index, entry, event: r.event });
    else refuse(index, entry, r.reason);
  });
  if (passed.length === 0) return { writtenIds, pending };

  try {
    await appendEvents(decisionsDir, ledgerRun, passed.map((p) => p.event));
    writtenIds.push(...passed.map((p) => p.event.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const p of passed) refuse(p.index, p.entry, `batch-refused: ${message}`);
    pending.sort((a, b) => a.entryIndex - b.entryIndex);
  }
  return { writtenIds, pending };
}

/**
 * Flow engine spec §6.2: the same entries writeRunLedger would write, normalised the same way, without a file -- a `dir`
 * flow group's landing writes them to `flow_decisions` instead of `.decisions/`. Refused entries are pending as there.
 */
export function runLedgerEvents(input: { ledgerRun: string; reported: ReportedDecisions; codeAuthored: DecisionEvent[]; at: string; evidence: string[] }): { events: DecisionEvent[]; pending: PendingEntry[] } {
  const { ledgerRun, reported, codeAuthored, at, evidence } = input;
  const events: DecisionEvent[] = [...codeAuthored];
  const pending: PendingEntry[] = [];
  const refuse = (entryIndex: number, entry: unknown, reason: string): void => {
    pending.push({ pendingId: pendingIdOf(ledgerRun, entryIndex), ledgerRun, entryIndex, entry, reason, at, evidence });
  };
  if (reported.kind === "malformed") refuse(0, reported.value, "decisions-not-array");
  else if (reported.kind === "array") {
    reported.entries.forEach((entry, index) => {
      const r = normalizeAgentEntry(entry, { ledgerRun, entryIndex: index, at, evidence });
      if (r.ok) events.push(r.event); else refuse(index, entry, r.reason);
    });
  }
  return { events, pending };
}

export function runEvidence(runId: string, attemptSha: string, ccloop: string): string[] {
  return [`run ${runId}`, `attempt ${attemptSha}`, ccloop];
}

/** Never throws: evidence must not block a landing. */
export async function ccloopEvidenceString(ccloopBin: string): Promise<string> {
  try {
    const first = (await ccloopEvidence(ccloopBin))[0];
    if (typeof first === "string" && first.length > 0) return first;
  } catch {
    // fall through to the package.json version
  }
  try {
    let dir = dirname(ccloopBin);
    for (let i = 0; i < 8; i += 1) {
      try {
        const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
        if (pkg.name === "ccloop") return `ccloop ${typeof pkg.version === "string" ? pkg.version : "unknown"}`;
      } catch {
        // no readable package.json here; keep walking
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through
  }
  return "ccloop unknown";
}
