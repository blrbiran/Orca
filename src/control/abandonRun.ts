import { z } from "zod";
import { recordActivity } from "./activity.js";
import { settlingPersonFor } from "./commandClient.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { boundingCeilingOf, freshCeilingReserve, liveCeilingOf } from "./liveCeiling.js";
import { safeInteger } from "./schema.js";
import { commandSuccess, groupCommandTarget, readRunBody, saveRunBody } from "./stopIntent.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import { refuseFlowChild } from "../flow/groups.js";

/**
 * Stuck-runs spec 2026-11-17 S2 (#344): `orca run abandon` -- a person judged an attempt worthless and wants to stop paying
 * for it. The command only records the request on the run (`abandon`) and, for a run ccloop accepted with a live ceiling,
 * lowers that ceiling to the run's observed work tokens (a new revision, delivered by the driver's deliverLiveCeilings):
 * ccloop stops claude/omp mid-call and codex after its current response, and reports `exhausted`. Orca never kills a
 * process. The driver then settles the run (executionDriver.ts stepC, driverHandoff.ts settleAbandonedUnstarted):
 * `settled-failed` with `operatorSettlement {kind: "abandoned"}`, the task `blocked` (`run-abandoned`), nothing
 * dispatched until a person acts. Human ruling (2026-11-17, 「按你的建议走」): an abandoned run keeps no work for
 * `accept-attempt`. A run ccloop does not stop within the handoff grace is named `abandon-unresolved` (recovery list).
 */
export const RUN_ABANDONED = "run-abandoned";
export const ABANDON_UNRESOLVED = "abandon-unresolved";

const note = z.string().min(1).max(2048);
/** The request on the run. `unresolvedAt`: when the driver found it still running past the handoff grace. */
export const abandonRequestSchema = z.object({ by: z.string().min(1), note, at: safeInteger, unresolvedAt: safeInteger.optional() }).strict();
export type AbandonRequest = z.infer<typeof abandonRequestSchema>;
/** The run's settlement once it stopped: who abandoned it and why. */
export const abandonSettlementSchema = z.object({ kind: z.literal("abandoned"), by: z.string().min(1), note, at: safeInteger }).strict();
export type AbandonSettlement = z.infer<typeof abandonSettlementSchema>;

export function abandonOf(run: unknown): AbandonRequest | null {
  const raw = (run as { abandon?: unknown } | null)?.abandon;
  if (raw === undefined) return null;
  const parsed = abandonRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ControlError("recovery-blocked", "run-abandon-invalid");
  return parsed.data;
}

/** True for a run settled by an abandon (its operatorSettlement). */
export function abandonedRun(run: unknown): boolean {
  return (run as { operatorSettlement?: { kind?: unknown } } | null)?.operatorSettlement?.kind === "abandoned";
}

export function abandonSettlementOf(request: AbandonRequest): AbandonSettlement {
  return { kind: "abandoned", by: request.by, note: request.note, at: request.at };
}

export type AbandonRunCommand = Extract<RawAuthorityCommandV1, { verb: "abandon-run" }>;
export interface AbandonRunDeps { store: ControlStore; admissionGate?: AdmissionGate }

/** The states an attempt can be abandoned in: never reached the provider, or accepted by ccloop. */
const NOT_STARTED = new Set(["starting", "start-pending"]);

type AbandonableRun = ReturnType<typeof readRunBody> & { mode?: unknown; recoveryOf?: unknown; abandon?: unknown; liveCeiling?: unknown };

export function applyAbandonRun(deps: AbandonRunDeps, command: AbandonRunCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        // Archived groups are refused by the ledger (group-archived), before this.
        const groupId = groupCommandTarget(command), { runId } = command.payload;
        refuseFlowChild(store, groupId);
        const run = readRunBody(store, runId) as AbandonableRun;
        if (run.groupId !== groupId) throw new ControlError("run-not-found");
        if (run.phase !== "work" || run.taskId === null || run.mode !== undefined || run.recoveryOf !== undefined) throw new ControlError("run-abandon-unsupported", run.phase);
        const active = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active ?? 0) === 1;
        if (!active || (!NOT_STARTED.has(run.state) && run.state !== "accepted")) throw new ControlError("run-abandon-not-running", run.state);
        if (run.abandon !== undefined) throw new ControlError("run-abandon-pending");
        const by = settlingPersonFor(command.commandId);
        if (by === null) throw new ControlError("run-abandon-person-required");
        const at = store.now();
        const abandon: AbandonRequest = { by, note: command.payload.note, at };
        const ceiling = run.state === "accepted" ? liveCeilingOf(run) : null;
        const stop: "not-started" | "live-ceiling" | "no-live-ceiling" = NOT_STARTED.has(run.state) ? "not-started" : ceiling === null ? "no-live-ceiling" : "live-ceiling";
        let ceilingTokens: number | null = null;
        if (ceiling !== null) {
          // The run's observed work tokens now: ccloop stops it at its next check (it compares its own, newer count).
          ceilingTokens = Math.min(ceiling.tokens, run.cumulative.work.tokens);
          run.liveCeiling = { ...ceiling, revision: ceiling.revision + 1, tokens: ceilingTokens };
        }
        saveRunBody(store, { ...run, abandon });
        // A bounding ceiling's outstanding part is held in the group's reserve; lowering it gives that back now.
        if (ceiling !== null && boundingCeilingOf(run) !== null) freshCeilingReserve(store, groupId);
        recordActivity(store, { groupId, taskId: run.taskId, runId, kind: "run-abandon-requested", body: { by, note: abandon.note, stop, ceilingTokens } });
        return commandSuccess(context, { kind: "run-abandon-requested", runId, taskId: run.taskId, stop });
      },
    }).body;
  } finally { release?.(); }
}
