import type { AdmissionGate } from "./admissionGate.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { readOrchestrationSettings, writeOrchestrationSettings } from "./orchestration.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type SetOrchestrationSettingsCommand = Extract<RawAuthorityCommandV1, { verb: "set-orchestration-settings" }>;

/**
 * Kanban spec 2026-10-20 §3.2: the running-group cap, under the orchestration scope's own revision. It moves no group
 * revision and no projection (as the spend settings, spendCommands.ts); the command ledger records who set it.
 */
export function applySetOrchestrationSettings(deps: { store: ControlStore; admissionGate?: AdmissionGate }, command: SetOrchestrationSettingsCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const raw = context.rawCommand as SetOrchestrationSettingsCommand;
        if (raw.target.kind !== "orchestration") throw new ControlError("control-target-not-allowed");
        const { maxRunningGroups, criteriaReview, quotaWait } = raw.payload;
        const current = readOrchestrationSettings(deps.store);
        // Protect-acceptance-criteria spec §5: a payload without `criteriaReview` keeps the stored default.
        const review = criteriaReview ?? current.criteriaReview;
        // Failure-cause spec 2026-10-21 §5: likewise `quotaWait`, stored sorted and unique so equal sets compare equal.
        const waiting = quotaWait === undefined ? current.quotaWait : [...new Set(quotaWait)].sort();
        // Checks spec 2026-10-22 §4.1: the global check settings are not this verb's; they are kept as stored.
        const next = { maxRunningGroups, ...(review === undefined ? {} : { criteriaReview: review }), ...(waiting === undefined ? {} : { quotaWait: waiting }), ...(current.checks === undefined ? {} : { checks: current.checks }) };
        if (current.maxRunningGroups === maxRunningGroups && (criteriaReview === undefined || criteriaReview === current.criteriaReview)
          && (quotaWait === undefined || JSON.stringify(waiting) === JSON.stringify(current.quotaWait ?? []))) throw new ControlError("no-op-command");
        writeOrchestrationSettings(deps.store, next, context.nextCommandRevision);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: raw.commandId, actorId: raw.actorId,
          verb: raw.verb, target: raw.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "orchestration-settings-set", maxRunningGroups, revision: context.nextCommandRevision },
        } };
      },
    }).body;
  } finally { release?.(); }
}
