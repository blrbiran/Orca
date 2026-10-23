import { archivedMarkOf } from "./archivedMark.js";
import { readGroupIntegration } from "./integrationScheme.js";
import type { ImportDefaults } from "./planImport.js";
import { readBudgetProposal } from "./queries.js";
import { readStopIntent } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import { readSystemDebugMark } from "./systemDebug.js";

/**
 * Tester round 2 spec §7.2 (ruling H4): an unlimited-token group a person created is confirmed by Orca (`orca-auto`) once
 * nothing blocks it. This module is the pass's only predicate (review I3 / round 2 N5): every port-free condition, in the
 * spec's order, as code (Rule 5). Condition 10 (the agent slots resolve as `orca-auto`) needs the port; its failure is
 * booked under condition 9's command id, so a reader sees it here as condition 9 with `booked`.
 */
export type AutoConfirmBlockerCode =
  | "not-draft" | "limited" | "archived" | "stopped" | "stop-intent" | "flow-child" | "system-debug" | "correction-debug"
  | "proposal-not-editable" | "delivery-scheme" | "estimate-running" | "defaults-missing" | "already-attempted"
  | "not-person-created";
export type AutoConfirmBlocker = {
  condition: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 11;
  code: AutoConfirmBlockerCode;
  /** Condition 9 only: the error code of the booked row (e.g. "auto-confirm-selections-unresolved"); absent if it succeeded. */
  booked?: string;
};

/** One attempt per proposal version (condition 9): a person's edit bumps the version and allows a new one. */
export const autoConfirmCommandId = (proposalVersion: number): string => `orca-auto-confirm-unlimited-v${proposalVersion}`;

type Body = Record<string, unknown>;
type Check = (store: ControlStore, group: Body, defaults: ImportDefaults | null) => AutoConfirmBlocker | null;
const groupIdOf = (group: Body): string => String(group.groupId);

/** The `error.code` of a booked command row's result, or null for a success or an unreadable row. */
export function bookedErrorCode(store: ControlStore, groupId: string, commandId: string): { booked: boolean; code: string | null } {
  const row = store.db.prepare("SELECT result FROM commands WHERE group_id=? AND id=?").get(groupId, commandId);
  if (row === undefined) return { booked: false, code: null };
  try {
    const code = (JSON.parse(String(row.result)) as { error?: { code?: unknown } }).error?.code;
    return { booked: true, code: typeof code === "string" ? code : null };
  } catch { return { booked: true, code: null }; }
}

/**
 * Condition 11 (review C2, round 2 minor): a person created the group -- the `createdByPerson` stamp written at import
 * and accept -- or the person's schedule fired it (`origin.kind = "schedule"`). A group from before the stamp falls back
 * to the principal of its first successful `import-plan` / `requirement-draft-accept` command.
 */
export function personCreated(store: ControlStore, group: Body): boolean {
  if (group.createdByPerson === true) return true;
  if ((group.origin as { kind?: unknown } | undefined)?.kind === "schedule") return true;
  if (group.createdByPerson === false) return false;
  const row = store.db.prepare("SELECT principal FROM commands WHERE group_id=? AND verb IN ('import-plan','requirement-draft-accept') AND original_status < 400 ORDER BY rowid LIMIT 1").get(groupIdOf(group));
  const principal = row === undefined || row.principal === null ? null : String(row.principal);
  return principal === "web" || (principal !== null && principal.startsWith("user:"));
}

const CHECKS: ReadonlyArray<readonly [AutoConfirmBlocker["condition"], Check]> = [
  [1, (_store, group) => group.status === "draft" && Object.hasOwn(group, "planHash") ? null : { condition: 1, code: "not-draft" }],
  [2, (_store, group) => (group.limit as { tokens?: unknown } | undefined)?.tokens === null ? null : { condition: 2, code: "limited" }],
  [3, (store, group) => archivedMarkOf(group) !== null ? { condition: 3, code: "archived" }
    : group.stopped === true ? { condition: 3, code: "stopped" }
      : readStopIntent(store, groupIdOf(group)) !== null ? { condition: 3, code: "stop-intent" } : null],
  [4, (_store, group) => Object.hasOwn(group, "flow") ? { condition: 4, code: "flow-child" }
    : readSystemDebugMark(group) !== null ? { condition: 4, code: "system-debug" }
      : typeof group.debug === "object" && group.debug !== null ? { condition: 4, code: "correction-debug" } : null],
  [5, (store, group) => readBudgetProposal(store, groupIdOf(group)).state === "editable" ? null : { condition: 5, code: "proposal-not-editable" }],
  [6, (_store, group) => readGroupIntegration(group) === null ? null : { condition: 6, code: "delivery-scheme" }],
  [7, (store, group) => store.db.prepare("SELECT 1 FROM estimates WHERE group_id=? AND state IN ('running','start-unknown') LIMIT 1").get(groupIdOf(group)) === undefined
    ? null : { condition: 7, code: "estimate-running" }],
  [8, (_store, _group, defaults) => defaults !== null && defaults.estimatorProfileId !== null && defaults.estimatorProfileHash !== null
    ? null : { condition: 8, code: "defaults-missing" }],
  [9, (store, group) => {
    const attempt = bookedErrorCode(store, groupIdOf(group), autoConfirmCommandId(readBudgetProposal(store, groupIdOf(group)).proposalVersion));
    return !attempt.booked ? null : { condition: 9, code: "already-attempted", ...(attempt.code === null ? {} : { booked: attempt.code }) };
  }],
  [11, (store, group) => personCreated(store, group) ? null : { condition: 11, code: "not-person-created" }],
];

/**
 * Spec §7.2 (signature fixed in round 2 N5; D14 adds `defaults`, which live in the control config, not the store): the
 * first failing port-free condition (1-9, 11) for a parsed group body, or null when only condition 10 is left. Reads the
 * store only -- no I/O, no clock, no port. A body that cannot be read throws, as the store's own readers do.
 */
export function autoConfirmBlocker(store: ControlStore, group: Body, defaults: ImportDefaults | null): AutoConfirmBlocker | null {
  for (const [, check] of CHECKS) {
    const blocker = check(store, group, defaults);
    if (blocker !== null) return blocker;
  }
  return null;
}

/**
 * Spec §7.3: the group view's `autoConfirm`. `eligible`: conditions 2, 3, 4, 6 and 11 hold (the ones that do not change
 * while the person looks at the page, plus archive/stop), from the same checks; `refusedCode`: the error code booked
 * under the current proposal version's command id, or null.
 */
export function autoConfirmView(store: ControlStore, group: Body, proposalVersion: number): { eligible: boolean; refusedCode: string | null } {
  const eligible = CHECKS.filter(([condition]) => [2, 3, 4, 6, 11].includes(condition)).every(([, check]) => check(store, group, null) === null);
  return { eligible, refusedCode: bookedErrorCode(store, groupIdOf(group), autoConfirmCommandId(proposalVersion)).code };
}
