import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { settlingPersonFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { acceptanceOf, type GroupAcceptance } from "./groupAcceptanceRecord.js";
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

function failedRecord(store: ControlStore, groupId: string): { body: Record<string, unknown>; record: GroupAcceptance & { tip: string } } {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) throw new ControlError("group-not-found");
  const body = JSON.parse(String(row.body)) as Record<string, unknown>;
  const record = acceptanceOf(body);
  if (record === null || record.result !== "failed" || record.tip === null) throw new ControlError("group-acceptance-not-failed", record?.result ?? "none");
  return { body, record: record as GroupAcceptance & { tip: string } };
}

function saveBody(store: ControlStore, groupId: string, body: Record<string, unknown>): void {
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
}

export function applyRecheckAcceptance(deps: { store: ControlStore }, command: RecheckAcceptanceCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { body, record } = failedRecord(deps.store, groupId);
      delete body.acceptance;
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
      const { body, record } = failedRecord(deps.store, groupId);
      const by = settlingPersonFor(command.commandId);
      if (by === null) throw new ControlError("group-acceptance-person-required");
      const at = deps.store.now();
      const waived: GroupAcceptance = { ...record, result: "waived", waived: { by, note: command.payload.note, at } };
      saveBody(deps.store, groupId, { ...body, acceptance: waived });
      recordActivity(deps.store, { groupId, kind: "group-acceptance", body: { ...waived } });
      return commandSuccess(context, { kind: "acceptance-waived", groupId, tip: record.tip });
    },
  }).body;
}
