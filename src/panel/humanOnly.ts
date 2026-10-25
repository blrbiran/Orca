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
  // Flow engine spec §10.3 (W-76): as requirement-answer -- the person answering the clarification may revise it.
  "requirement-revise": "any",
  // Accounts spec §3.5, §6.1: the spend caps bound every group, and the calendar moves their period boundaries.
  "set-spend-cap": "human-only",
  "clear-spend-cap": "human-only",
  "set-usage-calendar": "human-only",
  // Integration spec §3.1, §8: only an owner chooses where a group's work is carried (a push, a PR).
  "set-integration-scheme": "human-only",
  // Protect-acceptance-criteria spec §5: switching the reviewer off leaves every flag for a person.
  "set-criteria-review": "human-only",
  // Dir-requirements spec §9.2, D5: a folder change the person made is answered by the person (owner only), whatever
  // the answer -- take-folder, withhold or recheck.
  "resolve-folder-change": "human-only",
  // Multi-directory projects spec §9.7: what lands, and what is left unlanded, is the person's answer (owner only).
  "multi-dir-landing": "human-only",
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
  // Checks spec 2026-10-22 §4.4: every check setting, schedule, lock, run-now and resume is a person's act (a custom
  // command runs in Orca's environment; a schedule or a run spends review budget unattended; a lock is an admin act).
  "set-check-settings": "human-only",
  "set-scheduled-check": "human-only",
  "set-check-locks": "human-only",
  "run-check-now": "human-only",
  "resume-check": "human-only",
  // Flow engine spec §11.2, §14.2: run policy (effect levels, budgets, skill sources) and its admin locks are a person's.
  "set-flow-settings": "human-only",
  "set-flow-locks": "human-only",
  // Flow engine spec §14.2, the table as written: starting a run, messages (feedback, edits, commands) and asking for a
  // plan are any principal's; running a plan, answering an ask, an effect's confirm/enact/discard and raising the pool
  // are the person's.
  "flow-start": "any",
  "flow-message": "any",
  "flow-plan": "any",
  "flow-rerun": "human-only",
  "flow-answer": "human-only",
  "flow-effect": "human-only",
  "flow-pool": "human-only",
  // Gaps spec §5.5, §13: answering a step of the running plan is the person's (like running the plan); `accept-unchanged`
  // is open on the socket (SOCKET_TIER), `run` spends and wants a person token.
  "flow-plan-step": "human-only",
  // Scheduled flows and groups spec §11.1, §11.2: an entry becomes importable and schedulable, so every library write is
  // the owner's (a trust act, as registering a plan is). Members read and import into a group only.
  "plan-library-save": "human-only",
  "plan-library-import": "human-only",
  "plan-library-archive": "human-only",
  // Scheduled flows and groups spec 2026-10-24 §11.1: a schedule starts paid work unattended and its pool, token limit and
  // scheme are budget/delivery choices, so all five writes are the owner's, as the checks' schedules are.
  "schedule-set": "human-only",
  "schedule-enable": "human-only",
  "schedule-remove": "human-only",
  "schedule-resume": "human-only",
  "schedule-from-group": "human-only",
};
/**
 * Review finding I4 (controller's call, flagged for the human): verbs any principal may send that a run Orca dispatched is
 * still refused -- a dispatched run must not start a flow (it would spend and write a folder nobody attends).
 */
export const DISPATCHED_RUN_REFUSED: ReadonlySet<CommandVerbV1> = new Set<CommandVerbV1>(["flow-start"]);
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
  // Flow engine spec §14.2: a run's pool is a budget amount (like requirement-open.limit).
  "flow-start": ["pool"],
  // Scheduled flows and groups spec §9.1, §11.1: a library import's token limit is a budget amount and its scheme a
  // delivery choice (what confirm.integrationHash guards today).
  "import-plan": ["tokenLimit", "integration"],
};
/**
 * CLI v2 spec §15.1: the control socket's tier for each human-only entry (a verb, or `verb.field`), the table's code mirror.
 * `open`: the socket agent may send it (a person acts through their agent, the human ruled); `token`: only with a person
 * token (Task 11) -- setting where work goes, a command Orca runs outside the sandbox, a budget or spend amount, an agent
 * update. A predicate reads the raw payload: what it cannot read is `token` (the stricter tier; the schema refuses it
 * later). Web members are not tiered (I3): they keep the refusals above. A run Orca dispatched is refused every entry
 * (§15.4, permissions.ts). tests/panel/accessMatrix.test.ts fails when an entry above has no row here.
 *
 * Gaps spec §6.3, §13: a row may also be a predicate on an `any` verb (`flow-message`, the first): what it calls `token`
 * wants a person token on the socket and is refused to a run Orca dispatched, exactly as a human-only entry; what it calls
 * `open` is the verb as before. Web members are not tiered: an `any` verb stays theirs. Its token entries: a defer releasing
 * a held effect, and pause, resume and note (live transcript spec §10.5.3).
 */
export type SocketTier = "open" | "token";
type Payload = Readonly<Record<string, unknown>>;
// §15.1: `keep` changes nothing about where work goes; any other delivery (a merge, a push, a PR) does.
const deliveryTier = (p: Payload): SocketTier => {
  const integration = p.integration;
  return typeof integration === "object" && integration !== null && (integration as Payload).delivery === "keep" ? "open" : "token";
};
export const SOCKET_TIER: Readonly<Record<string, SocketTier | ((payload: Payload) => SocketTier)>> = {
  "correction-record": "open",
  "correction-close": "open",
  "correction-withdraw": "open",
  "correction-debug-open.undoHow": "open",
  "approve-pending-decision": "open",
  "reject-pending-decision": "open",
  "ratify-flagged-decision": "open",
  "add-group-dependency": "open",
  "remove-group-dependency": "open",
  "set-criteria-review": "open",
  "set-orchestration-settings": "open",
  // Moved to open by the human: Orca already dispatches conflict resolution itself (kanban S5).
  "retry-integration": "open",
  "resolve-integration-conflict": "open",
  // Checks plan "Access mapping": a custom command (runs in Orca's own environment, outside ccloop's sandbox) or a
  // budget (spend) is token; switching, triggers and group counts are open. Adding or enabling a schedule spends review
  // budget unattended: token; disabling or removing one is open. Locks are an admin act: token. Run-now and resume:
  // open (as retry-integration).
  "set-check-settings": (p) => {
    const set = typeof p.set === "object" && p.set !== null ? p.set as Payload : null;
    if (set === null) return "token";
    return typeof set.command === "string" || Object.hasOwn(set, "budgetTokens") ? "token" : "open";
  },
  "set-scheduled-check": (p) => (p.remove !== true && p.enabled !== false ? "token" : "open"),
  "set-check-locks": "token",
  // Flow plan Global Constraints (Access): all six human-only flow verbs are token; a dispatched run is refused them.
  "set-flow-settings": "token",
  "set-flow-locks": "token",
  "flow-rerun": "token",
  "flow-answer": "token",
  "flow-effect": "token",
  "flow-pool": "token",
  "flow-start.pool": "token",
  // Gaps spec §13: running a step the plan asked about spends (as flow-rerun); accepting it unchanged does what the
  // timeout would do.
  "flow-plan-step": (p) => (p.choice === "accept-unchanged" ? "open" : "token"),
  // Gaps spec §6.3: a `defer` whose `effects` says `proceed` for any step releases a held external effect (as flow-effect);
  // any other message is open. Effects it cannot read are token. Live transcript spec §10.5.3: pause, resume and note want
  // a person on the socket (a dispatched run is refused); a Web member is not tiered.
  "flow-message": (p) => {
    const body = typeof p.body === "object" && p.body !== null ? p.body as Payload : null;
    if (p.kind !== "command") return "open";
    if (body === null) return "open";
    const command = body.command;
    if (command === "pause" || command === "resume" || command === "note") return "token";
    if (command !== "defer" || body.effects === undefined) return "open";
    const effects = body.effects;
    if (typeof effects !== "object" || effects === null || Array.isArray(effects)) return "token";
    return Object.values(effects).some((choice) => choice !== "wait") ? "token" : "open";
  },
  "run-check-now": "open",
  "resume-check": "open",
  // R3a: confirming under the configured integration (any delivery) carries only its hash; a mismatch is refused anyway.
  "confirm.integrationHash": "open",
  "set-integration-scheme": deliveryTier,
  "set-group-integration": deliveryTier,
  "set-limit": "token",
  "requirement-open.limit": "token",
  "proposal-edit.proposedGroupLimit": "token",
  "set-spend-cap": "token",
  "clear-spend-cap": "token",
  "set-usage-calendar": "token",
  // Dir-requirements spec §9.2, D5: all three answers are a person's; a socket agent needs the person token.
  "resolve-folder-change": "token",
  // Multi-directory projects spec §9.7: as resolve-folder-change.
  "multi-dir-landing": "token",
  "settle-unknown-usage": "token",
  "apply-agent-update": "token",
  // Scheduled flows and groups spec §11.1 (I-3): a new entry copies data Orca already holds (open); appending a version
  // changes what an existing entry offers every repin and one-off import (token). Importing outside bytes is the owner's
  // act of trust (token); archiving only hides (open).
  "plan-library-save": (p) => (p.entryId === undefined ? "open" : "token"),
  "plan-library-import": "token",
  "plan-library-archive": "open",
  // Scheduled flows and groups spec 2026-10-24 §11.1: setting a schedule (its pool and token limit are budgets, its scheme
  // a delivery choice) and making one from a group are token; enabling is token as set-scheduled-check; disabling,
  // removing and resuming stop spending (open).
  "schedule-set": "token",
  "schedule-enable": (p) => (p.enabled === false ? "open" : "token"),
  "schedule-remove": "open",
  "schedule-resume": "open",
  "schedule-from-group": "token",
  "import-plan.tokenLimit": "token",
  "import-plan.integration": "token",
};

/** The socket tier of a command: `token` when any human-only entry it carries is (an entry with no row is `token`); null when it carries none. */
export function socketTier(verb: CommandVerbV1, payload: unknown): SocketTier | null {
  const object: Payload = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Payload : {};
  const entries = [
    // A human-only verb, or (gaps spec §13) an `any` verb with a predicate row.
    ...(HUMAN_ONLY_VERBS.includes(verb) || (VERB_ACCESS[verb] === "any" && Object.hasOwn(SOCKET_TIER, verb)) ? [verb as string] : []),
    ...(HUMAN_ONLY_FIELDS[verb] ?? []).filter((field) => Object.hasOwn(object, field)).map((field) => `${verb}.${field}`),
  ];
  if (entries.length === 0) return null;
  return entries.some((entry) => {
    const rule = SOCKET_TIER[entry];
    return rule === undefined || (typeof rule === "function" ? rule(object) : rule) === "token";
  }) ? "token" : "open";
}

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
