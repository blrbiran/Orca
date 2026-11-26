import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { settlingPersonFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { acceptanceOf, deliveredAcceptanceOf, deliveredAcceptanceProblem, type DeliveredAcceptance, type GroupAcceptance } from "./groupAcceptanceRecord.js";
import { commandSuccess } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Tester follow-up E §5 (#241): the two ways out of a failed group acceptance besides a moved tip (which the driver's
 * acceptance pass checks again by itself). Both answer a failed record only (`group-acceptance-not-failed` otherwise).
 * - `recheck-acceptance` (any principal): a flaky check -- the failed record is removed, so the next round checks the same
 *   tip again (groupAcceptance.ts acceptGroup: no record for the tip, more than one landing).
 * - `waive-acceptance` (human only, socket tier token): a person accepts the failed tip anyway; the record becomes
 *   `waived` with who and why, and a `group-acceptance` activity row names them. It holds for that tip only: a tip that
 *   moves is checked again.
 */
export type RecheckAcceptanceCommand = Extract<RawAuthorityCommandV1, { verb: "recheck-acceptance" }>;
export type WaiveAcceptanceCommand = Extract<RawAuthorityCommandV1, { verb: "waive-acceptance" }>;
export type AcceptTestChangesCommand = Extract<RawAuthorityCommandV1, { verb: "accept-test-changes" }>;

/**
 * The failed record the verb acts on: the tip's acceptance, else (delivery tail spec D3) the acceptance on the delivered
 * commit when that is the one that failed. `field` names which.
 */
function failedRecord(store: ControlStore, groupId: string): { body: Record<string, unknown>; field: "acceptance" | "deliveredAcceptance"; record: (GroupAcceptance | DeliveredAcceptance) & { tip: string } } {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) throw new ControlError("group-not-found");
  const body = JSON.parse(String(row.body)) as Record<string, unknown>;
  const record = acceptanceOf(body);
  if (record !== null && record.result === "failed" && record.tip !== null) return { body, field: "acceptance", record: record as GroupAcceptance & { tip: string } };
  const delivered = deliveredAcceptanceOf(body);
  if (delivered !== null && delivered.result === "failed" && deliveredAcceptanceProblem(body) !== null) return { body, field: "deliveredAcceptance", record: delivered };
  throw new ControlError("group-acceptance-not-failed", record?.result ?? "none");
}

function saveBody(store: ControlStore, groupId: string, body: Record<string, unknown>): void {
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
}

export function applyRecheckAcceptance(deps: { store: ControlStore }, command: RecheckAcceptanceCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { body, field, record } = failedRecord(deps.store, groupId);
      delete body[field];
      saveBody(deps.store, groupId, body);
      return commandSuccess(context, { kind: "acceptance-recheck-requested", groupId, tip: record.tip });
    },
  }).body;
}

export function applyWaiveAcceptance(deps: { store: ControlStore }, command: WaiveAcceptanceCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { body, field, record } = failedRecord(deps.store, groupId);
      const by = settlingPersonFor(command.commandId);
      if (by === null) throw new ControlError("group-acceptance-person-required");
      const at = deps.store.now();
      const waived = { ...record, result: "waived" as const, waived: { by, note: command.payload.note, at } };
      saveBody(deps.store, groupId, { ...body, [field]: waived });
      recordActivity(deps.store, { groupId, kind: field === "acceptance" ? "group-acceptance" : "delivered-acceptance", body: { ...waived } });
      return commandSuccess(context, { kind: "acceptance-waived", groupId, tip: record.tip });
    },
  }).body;
}

export function applyAcceptTestChanges(deps: { store: ControlStore }, command: AcceptTestChangesCommand, checked: { tip: string; digest: string }): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (row === undefined) throw new ControlError("group-not-found");
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      const acceptance = acceptanceOf(body);
      const delivered = deliveredAcceptanceOf(body);
      const pending = acceptance?.result === "test-change-pending" && acceptance.testChanges !== undefined
        ? { field: "acceptance" as const, tip: acceptance.tip, record: acceptance, changes: acceptance.testChanges }
        : delivered?.result === "test-change-pending" && delivered.testChanges !== undefined
          ? { field: "deliveredAcceptance" as const, tip: delivered.commit, record: delivered, changes: delivered.testChanges }
          : null;
      if (pending === null || pending.changes.paths.length === 0) throw new ControlError("group-acceptance-test-change-not-pending");
      if (pending.tip !== checked.tip || pending.changes.digest !== checked.digest) {
        throw new ControlError("group-acceptance-test-change-stale", "checked tip/digest changed; rerun group acceptance and review the current test paths");
      }
      const by = settlingPersonFor(command.commandId);
      if (by === null) throw new ControlError("group-acceptance-person-required");
      const result = pending.changes.pendingResult;
      if (result === undefined) throw new ControlError("group-acceptance-test-change-not-pending");
      const at = deps.store.now();
      const accepted = { ...pending.record, result, testChanges: { ...pending.changes,
        disposition: { tip: checked.tip, digest: checked.digest, by, note: command.payload.note, at },
      } };
      saveBody(deps.store, groupId, { ...body, [pending.field]: accepted });
      recordActivity(deps.store, { groupId, kind: pending.field === "acceptance" ? "group-acceptance" : "delivered-acceptance", body: { ...accepted } });
      return commandSuccess(context, { kind: "test-changes-accepted", groupId, tip: checked.tip, digest: checked.digest });
    },
  }).body;
}
