import type { CommandVerbV1 } from "../control/webProtocol.js";

/**
 * Accounts spec §3.5 (extends agent entry spec §5, human ruling H3): every command verb and who may send it. `any`: every
 * principal; `human-only`: only a principal the permission table (permissions.ts) lets do human-only actions -- set a
 * group's budget amount, the bound every other command stays under; `panel`: issued by the panel itself, no route sends
 * it. A Record, so a new verb has no default: it does not compile until it is classified here.
 */
export const VERB_ACCESS: Readonly<Record<CommandVerbV1, "any" | "human-only" | "panel">> = {
  "import-plan": "any",
  "proposal-edit": "any",
  "estimate": "any",
  "confirm": "any",
  "start": "any",
  "pause-dispatch": "any",
  "handoff-stop": "any",
  "resume-dispatch": "any",
  "resume-from-handoff": "any",
  "set-limit": "human-only",
  "continue-task": "any",
  "recovery-retry": "any",
  "retry-task": "any",
  "verify-saved-result": "any",
  "settle-unknown-usage": "human-only",
  "shutdown": "panel",
  "set-workspace-mode": "any",
  "set-agent-preferences": "any",
  "apply-agent-update": "human-only",
  "proposal-set-agent": "any",
  "set-task-labels": "any",
  "set-task-loop": "any",
  "requirement-open": "any",
  "requirement-answer": "any",
  "requirement-consensus": "any",
  "requirement-draft-feedback": "any",
  "requirement-draft-accept": "any",
  // Clarify caps spec 2026-10-21 §3.3: as answer and consensus.
  "requirement-clarify-more": "any",
  "requirement-classify": "any",
  // Accounts spec §3.5, §6.1: the spend caps bound every group, and the calendar moves their period boundaries.
  "set-spend-cap": "human-only",
  "clear-spend-cap": "human-only",
  "set-usage-calendar": "human-only",
  // Integration spec §3.1, §8: only an owner chooses where a group's work is carried (a push, a PR).
  "set-integration-scheme": "human-only",
  // Kanban spec §7 layer 1: the check runs a command an owner names, in Orca's own environment.
  "set-integration-check": "human-only",
  // Protect-acceptance-criteria spec §5: switching the reviewer off leaves every flag for a person.
  "set-criteria-review": "human-only",
  "set-group-integration": "human-only",
  "retry-integration": "human-only",
  "resolve-integration-conflict": "human-only",
  // Issue-fixes spec §6.3: archiving hides and freezes a group but deletes nothing; any principal may do it and undo it.
  "archive-group": "any",
  "unarchive-group": "any",
  // Control run decisions plan Task 9: approving a refused decision writes a ledger line in an owner's name.
  "approve-pending-decision": "human-only",
  "ratify-flagged-decision": "human-only",
  "set-orchestration-settings": "human-only",
  // Kanban spec §9a.5: v1 edges between groups come from the person only.
  "add-group-dependency": "human-only",
  "remove-group-dependency": "human-only",
  // Control run decisions plan Task 10: rejecting one records a correction in an owner's name.
  "reject-pending-decision": "human-only",
  // Debug task design §12.4: opening a correction's debug group spends nothing, so the agent path may do it.
  "correction-debug-open": "any",
  // System debug task spec 2026-10-21 §2: Orca's own debug group (orca-auto); no route sends it.
  "system-debug-open": "panel",
  // Debug task plan Task 11 (design §12.4, withdraw Amendment 7): recording, closing and withdrawing a correction are an owner's acts.
  "correction-record": "human-only",
  "correction-close": "human-only",
  "correction-withdraw": "human-only",
};
export const HUMAN_ONLY_VERBS: readonly CommandVerbV1[] =
  (Object.keys(VERB_ACCESS) as CommandVerbV1[]).filter((verb) => VERB_ACCESS[verb] === "human-only");
export const HUMAN_ONLY_FIELDS: Readonly<Partial<Record<CommandVerbV1, readonly string[]>>> = {
  "requirement-open": ["limit"],
  "proposal-edit": ["proposedGroupLimit"],
  // Integration spec §3.2, ruling R2: approving where a group's work is carried is an owner's confirm.
  "confirm": ["integrationHash"],
  // Debug task plan Task 6 (controller's call 5): the undo.how the closing row records as the human's; an agent's value
  // would be recorded as the human's.
  "correction-debug-open": ["undoHow"],
};
/** Spec §5 / C19: an amount field an agent may send, with the reason. Empty until a reviewed exception exists. */
export const AGENT_AMOUNT_FIELDS: Readonly<Record<string, string>> = {};

/** The refusal for a principal that may not do human-only actions (permissions.ts decides who); null when it is not human-only. */
export function humanOnlyRefusal(verb: CommandVerbV1, payload: unknown):
  { code: "control-verb-human-only" | "control-field-human-only"; message: string } | null {
  if (HUMAN_ONLY_VERBS.includes(verb)) return { code: "control-verb-human-only", message: `${verb} is done by an owner logged in to the Web UI.` };
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const field = (HUMAN_ONLY_FIELDS[verb] ?? []).find((name) => Object.hasOwn(payload, name));
  return field === undefined ? null : { code: "control-field-human-only", message: `${verb}.${field} is set by an owner logged in to the Web UI; send the command without it.` };
}
