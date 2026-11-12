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
        const { maxRunningGroups, criteriaReview, quotaWait, failoverOrder, agentTopUpCap, criteriaReviewTokens } = raw.payload;
        const current = readOrchestrationSettings(deps.store);
        // Protect-acceptance-criteria spec §5: a payload without `criteriaReview` keeps the stored default.
        const review = criteriaReview ?? current.criteriaReview;
        // Failure-cause spec 2026-10-21 §5: likewise `quotaWait`, stored sorted and unique so equal sets compare equal.
        const waiting = quotaWait === undefined ? current.quotaWait : [...new Set(quotaWait)].sort();
        // Checks spec 2026-10-22 §4.1: the global check settings are not this verb's; they are kept as stored. Likewise the
        // global flow settings and their locks (flow engine spec §11.2; dropped here until session e2ad4802, 2026-11-05).
        // Quota failover spec §8: `failoverOrder` is kept as given (its order is the meaning); omitted keeps the stored one.
        const order = failoverOrder === undefined ? current.failoverOrder : [...new Set(failoverOrder)];
        // Retry work top-up spec 2026-11-06 §2 "The cap": `agentTopUpCap` likewise; null clears it (agents may not top up),
        // stored as absent so a store that never set it and one that cleared it hold the same bytes.
        const cap = agentTopUpCap === undefined ? current.agentTopUpCap ?? null : agentTopUpCap;
        // Tester #174: the judge's grant likewise; omitted keeps the stored one, never set is the built-in default.
        const judgeTokens = criteriaReviewTokens ?? current.criteriaReviewTokens;
        const next = { maxRunningGroups, ...(review === undefined ? {} : { criteriaReview: review }), ...(waiting === undefined ? {} : { quotaWait: waiting }), ...(order === undefined ? {} : { failoverOrder: order }), ...(current.checks === undefined ? {} : { checks: current.checks }), ...(current.flows === undefined ? {} : { flows: current.flows }), ...(cap === null ? {} : { agentTopUpCap: cap }), ...(judgeTokens === undefined ? {} : { criteriaReviewTokens: judgeTokens }) };
        if (current.maxRunningGroups === maxRunningGroups && (criteriaReview === undefined || criteriaReview === current.criteriaReview)
          && (quotaWait === undefined || JSON.stringify(waiting) === JSON.stringify(current.quotaWait ?? []))
          && (failoverOrder === undefined || JSON.stringify(order) === JSON.stringify(current.failoverOrder))
          && (agentTopUpCap === undefined || JSON.stringify(cap) === JSON.stringify(current.agentTopUpCap ?? null))
          && (criteriaReviewTokens === undefined || criteriaReviewTokens === current.criteriaReviewTokens)) throw new ControlError("no-op-command");
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
