export type DurableCommandErrorStatus = 400 | 404 | 409 | 422 | 423;

/**
 * Stable V1 classification for errors that are safe to persist as immutable
 * command outcomes. Every other ControlError code must be explicitly classified
 * in the disjoint non-durable catalog below and escape for transaction rollback.
 */
export const durableCommandErrorStatuses = {
  // The raw envelope is already valid when command processing starts. These
  // are the remaining payload/value validation errors that command handlers
  // can discover.
  "control-invalid-stop": 400,
  "control-non-canonical-json": 400,
  "control-non-json-payload": 400,
  // Integration spec §8: a branch or remote name, the remote's existence or its GitHub identity failed the setter's check;
  // the detail names the check.
  "integration-invalid": 400,
  // Control run decisions plan Task 9: the approved undo.how still fails the tier-0 gate (detail: the reason), or the
  // refused entry is invalid for another reason no undo.how can fix (detail: the reason).
  "decision-undo-not-executable": 400,
  "pending-decision-entry-invalid": 400,
  // Debug task plan Task 11 (correction-record / correction-close): the corrections store's and `orca correct --close`'s
  // own refusals, booked under their own names (CorrectRejection codes, 1:1). closing-row-refused: the ledger writer
  // refused the closing row (the detail is its reason; an undo.how the tier-0 gate refuses is the usual one).
  "correction-row-invalid": 400,
  "no-chose-instead": 400,
  "close-argument-conflict": 400,
  "target-not-a-git-repo": 400,
  "closing-row-refused": 400,

  // Resource lookup.
  "artifact-not-found": 404,
  "checkpoint-not-committed": 404,
  "group-not-found": 404,
  "handoff-work-not-found": 404,
  "run-not-found": 404,
  "start-intent-missing": 404,
  "task-checkpoint-not-committed": 404,
  "work-not-found": 404,
  "command-result-not-found": 404,
  "control-target-not-allowed": 404,
  "route-not-found": 404,
  // Accounts final review: a `repo:<id>` spend cap for a repository the panel does not hold; the detail names the id.
  "spend-cap-repository-unknown": 404,
  // Control run decisions plan Task 9: no pending decision of this group has the id.
  "pending-decision-not-found": 404,
  // Kanban spec §9a: no flagged decision of this group has the id.
  "flagged-decision-not-found": 404,
  // Debug task plan Task 6 (correction-debug-open): no stored correction has the id; no configured repository has the
  // correction's projectKey; the decision a correction names is in no ledger source (Task 3's DECISION_NOT_FOUND), or the
  // pending item it names has no control-DB row (Task 3's PENDING_DECISION_NOT_FOUND).
  "correction-not-found": 404,
  "correction-repository-unknown": 404,
  "original-decision-not-found": 404,
  "original-pending-decision-not-found": 404,
  // Debug task plan Task 11 (fix round 1): correction-withdraw's membership guard, the panel withdraw route's own 404.
  "decision-not-found": 404,

  // Optimistic concurrency, immutable identity, and ownership conflicts.
  // Agent selection spec §6.4 step 3 (W6-12): the selections a confirmation resolves are no longer the ones the
  // operator saw (the previewed selectionsHash, or a layer that moved while ccloop answered).
  "agent-selection-changed": 409,
  // Issue-fixes spec §6.3: archive is refused while the group still has work in motion; each guard has its own code. The
  // detail of archive-stop-pending is `<mode>:<state>`, of archive-call-in-flight `estimate` or `requirement`.
  "archive-call-in-flight": 409,
  "archive-integration-resolving": 409,
  "archive-run-active": 409,
  "archive-stop-pending": 409,
  "artifact-id-conflict": 409,
  "checkpoint-id-conflict": 409,
  "checkpoint-identity-conflict": 409,
  "checkpoint-run-settled": 409,
  "checkpoint-usage-high-water": 409,
  "continuation-identity-conflict": 409,
  // Control run decisions plan Task 9: approve while a run of the group reconciles (the commit would move the tip under
  // it, Review Focus 3); the group branch kept moving past three tries.
  "decision-approve-reconciling": 409,
  "decision-approve-tip-moved": 409,
  // W6 (loop plans spec §5.1): the estimate was built from contracts a set-task-loop change has since replaced.
  "estimate-stale": 409,
  "execution-identity-conflict": 409,
  "graph-version-conflict": 409,
  "group-already-exists": 409,
  // Issue-fixes spec §6.3: an archived group refuses every group-targeted command but unarchive-group.
  "group-archived": 409,
  "group-graph-conflict": 409,
  "group-project-conflict": 409,
  "handoff-identity-conflict": 409,
  "handoff-request-conflict": 409,
  // Integration spec §3.2-§3.4, §6.5, §7: the integration refusals (none retryable).
  "integration-busy": 409,
  "integration-no-checks": 409,
  "integration-not-blocked": 409,
  "integration-preflight-failed": 409,
  "integration-unapproved": 409,
  // Labels and progress spec §3.1 (§8 R7): the task's labels moved since the person read them (plan finding F17).
  "labels-version-conflict": 409,
  "landing-branch-conflict": 409,
  // Control run decisions plan Task 9: the pending decision was rejected; it cannot be approved now.
  "pending-decision-settled": 409,
  // Control run decisions plan Task 10: rejecting could not record its correction (detail: the CorrectRejection code);
  // the item stays pending.
  "pending-decision-correction-failed": 409,
  // Control run decisions plan Task 10 (cross-plan resolution 5): the correction names a pending item, not a recorded
  // decision, so there is no ledger row to overturn. `orca correct --close` refuses it by the same name.
  "correction-target-not-a-decision": 409,
  // Debug task plan Task 6: the integration target (or HEAD) already holds the correction's closing row; the decision is
  // not in HEAD's ledger, where the debug branch starts (it is only on a group branch, in the working tree, or on a
  // target HEAD does not contain); a reopen while the newest debug group is live; the correction was withdrawn
  // (decisions review withdraw spec §5.3); the withdrawals file has a line that does not parse (nothing is opened).
  "correction-already-closed": 409,
  "correction-decision-not-integrated": 409,
  "debug-group-not-reopenable": 409,
  // Controller ruling (debug plan Task 4/7): a debug group whose task's checks are still the placeholder is not confirmed or started.
  "debug-checks-unnamed": 409,
  // Controller ruling (Task 7): no original contract and no `checks` in the open; refused before anything is written.
  "debug-checks-required": 409,
  "correction-withdrawn": 409,
  "correction-withdrawals-unreadable": 409,
  // Debug task plan Task 10 (fix round 1): GET /api/control/corrections over a corrections.jsonl with a line that does not
  // parse; the list is not answered as if that row were absent.
  "corrections-store-unreadable": 409,
  // Debug task plan Task 11: the remaining CorrectRejection codes of correction-record, correction-close and
  // correction-withdraw (the store's and --close's, 1:1); a manual close while a debug group of the correction is live
  // (design §12.1: archive or stop it first); the withdrawal refusals of decisions review withdraw spec §5.2; and the two
  // partial outcomes, as the panel routes answer them 409: the correction was recorded but its reviewed mark was not
  // written, or it was withdrawn but a step after the withdrawal failed (detail: `<correctionId>:<step>:<code>`).
  "correction-already-recorded": 409,
  "duplicate-correction-id": 409,
  "corrections-store-busy": 409,
  "target-mid-git-operation": 409,
  "ledger-commit-refused": 409,
  "debug-group-active": 409,
  "correction-not-yours": 409,
  "correction-already-withdrawn": 409,
  "correction-closed": 409,
  "correction-recorded-unreviewed": 409,
  "correction-withdrawn-incomplete": 409,
  // correction-withdraw: the panel's ledger scan (the withdraw route's closed rule) refused; the detail names its gate code.
  "correction-closed-state-unknown": 409,
  "plan-version-conflict": 409,
  "profile-changed": 409,
  "proposal-version-conflict": 409,
  // Integration spec §7: resolve-integration-conflict when the group cannot afford the resolution's token budget.
  "reconcile-budget": 409,
  "reconcile-version-conflict": 409,
  "report-commit-invalid": 409,
  "report-identity-conflict": 409,
  "report-path-conflict": 409,
  "resume-artifact-conflict": 409,
  "resume-bundle-exists": 409,
  "revision-conflict": 409,
  "run-already-settled": 409,
  "run-usage-not-settleable": 409,
  "run-stop-proof-required": 409,
  "run-usage-pending": 409,
  "run-usage-settled": 409,
  "run-usage-not-unknown": 409,
  "run-generation-conflict": 409,
  "run-grant-conflict": 409,
  "run-owner-conflict": 409,
  // Issue fixes spec §4.2(3): recovery-retry on a run ccloop ended failed; only retry-task moves it.
  "run-terminal-failed": 409,
  "start-contract-conflict": 409,
  "start-envelope-conflict": 409,
  "start-state-conflict": 409,
  // Start guard spec (2026-10-15) §3.2: a start while the group's execution is pending or running (feedback #53).
  "group-execution-pending": 409,
  "stop-already-active": 409,
  "stop-mode-conflict": 409,
  "target-version-conflict": 409,
  // Loop plans spec §5.2 step 3: the task's plan moved since the person read it.
  "task-loop-version-conflict": 409,
  // Issue fixes spec §4.2(2): retry-task on a task whose current run is not one ccloop ended failed (the detail names why).
  "task-not-retryable": 409,
  "saved-result-unavailable":409,
  "saved-result-source-stale":409,
  "saved-result-usage-unsettled":409,
  "control-saved-result-unsupported":409,
  "usage-event-conflict": 409,
  "work-already-active": 409,
  "work-already-done": 409,

  // Valid commands that cannot be represented or performed in current state.
  // Agent selection spec §6.3 (e) and §4.6 (M5): no layer chose an agent; an answer did not echo a requested field.
  "agent-unselected": 422,
  "agent-selection-invalid": 422,
  // Spec §6.4 step 2 (W6-12): a slot ccloop refused; the detail is `<taskId|reconcile>:<ccloop code>`.
  "agent-selection-rejected": 422,
  "cleanup-not-recoverable": 422,
  "budget-overflow": 422,
  // Loop plans spec §4.3 (C6): a loop task's work allocation is changed only by set-task-loop.
  "budget-owned-by-loop-plan": 422,
  "continuation-budget-unavailable": 422,
  "continuation-predecessor-unrecoverable": 422,
  "control-capability-unsupported": 422,
  "control-token-policy-unsupported": 422,
  "active-unbounded-budget-conflict": 409,
  "control-evidence-unavailable": 422,
  "control-plan-rejected": 422,
  // Assembly spec §3 / ruling R5: no execution port is configured on this process. Durable, so a
  // person sees a named outcome rather than a rolled-back command, and 422 rather than 5xx because
  // the request was understood perfectly -- the environment simply cannot carry it out.
  "control-port-unconfigured": 422,
  // Assembly spec §10 / ruling R7: this process was started without an estimator profile and mode.
  // Same shape and same reason as the line above: a state a person is told about, not a crash.
  "control-estimator-unconfigured": 422,
  "control-protocol-unavailable": 422,
  // Agent selection spec §7 (W6-11/W6-12): ccloop's named refusals of a selection or table, which the port rethrows
  // under their own names. Durable and 422 like the port codes above: understood, and not performable as asked.
  // (agent-unselected and agent-selection-invalid are registered above, by plan T8.)
  "agent-context-unsupported": 422,
  "agent-installation-missing": 422,
  "agent-version-drift": 422,
  "agents-table-invalid": 422,
  "control-terminal-pending": 422,
  "dependency-not-done": 422,
  "duplicate-proposal-target": 422,
  "duplicate-task-id": 422,
  "estimate-in-flight": 422,
  "execution-policy-unrepresentable": 422,
  "grant-amendment-unsupported": 422,
  "graph-change-needs-handoff": 422,
  "graph-cycle": 422,
  "graph-dangling-dependency": 422,
  "group-budget-unavailable": 422,
  "group-deadline-expired": 422,
  "group-project-binding-required": 422,
  // Loop plans spec §5.2 (step 6): a raise the group's reserve cannot cover; the detail is `<dimension>:<shortfall>`.
  "group-reserve-insufficient": 422,
  "group-review-budget-unavailable": 422,
  "group-state-invalid": 422,
  "group-stopped": 422,
  "handoff-budget-unavailable": 422,
  "handoff-grant-insufficient": 422,
  "handoff-parent-invalid": 422,
  "identity-space-exhausted": 422,
  // Labels and progress spec §3.1 (§8 R8): an input label the vocabulary or the format refuses; the detail names it.
  "labels-invalid": 422,
  "landing-not-confirmed": 422,
  "landing-needs-review": 422,
  // Loop plans spec §3.2 / §5.2 step 4: the expansion refused the plan or its inputs; the detail names the reason.
  "loop-plan-invalid": 422,
  "no-op-command": 422,
  "numeric-overflow": 422,
  "reconcile-budget-unapproved": 422,
  "reconcile-registration-invalid": 422,
  "recovery-validation-failed": 422,
  // N1 spec §11.1 (DR27): a requirement's export has not landed yet, so its group cannot start.
  "requirement-export-pending": 422,
  // N1 spec §4.1 (DR6): a clarifying group has no plan, proposal or work items yet.
  "requirement-not-split": 422,
  "resume-predecessor-unrecoverable": 422,
  "resume-handoff-invalid": 422,
  "resume-source-dir-not-absolute": 422,
  "run-stop-unconfirmed": 422,
  // Syncskill integration spec §10.5 / §10.8 C4: confirm freezes each task's skill set. A task with skills on an agent other
  // than claude; a profile with no members, or a member breaking the name rule (§10.4); and the lookup's own failures,
  // under syncskill-failed:<E_CODE|status>. Durable and 422 like control-port-unconfigured and agent-installation-missing:
  // the request was understood, and this process cannot carry it out as asked (syncskill unset, not absolute or not
  // startable, too slow, or answering something unreadable). Each refusal leaves the group unconfirmed.
  "skills-profile-empty": 422,
  "skills-shape": 422,
  "skills-unsupported-agent": 422,
  "syncskill-failed": 422,
  "syncskill-missing": 422,
  "syncskill-output-invalid": 422,
  "syncskill-output-too-large": 422,
  "syncskill-timeout": 422,
  "syncskill-unconfigured": 422,
  // Control run decisions plan Task 10 (review fix 3): this process was given no corrections store or identity, so
  // reject-pending-decision cannot record its correction. Same shape and reason as control-port-unconfigured.
  "corrections-store-unconfigured": 422,
  "snapshot-partial": 422,
  "snapshot-invalid": 422,
  "snapshot-required": 422,
  // Loop plans spec §5.2 steps 2-3: a task that has started, or that has no loop plan, cannot be changed.
  "task-already-started": 422,
  "task-has-no-loop-plan": 422,
  "usage-gap": 422,

  // A durable recovery lock is immutable for this command ID.
  "control-recovery-required": 423,
  // Debug task plan Task 11: another orca process holds the repository's lock, so correction-close cannot close now.
  "repo-locked": 423,
  "agent-installation-update-stale": 409,
  "agent-installation-update-conflict": 409,
  "agent-installation-update-invalid": 422,
  "control-agent-update-unsupported": 422,
  "agent-installation-update-pending": 423,
  "recovery-blocked": 423,
} as const satisfies Record<string, DurableCommandErrorStatus>;

export type NonDurableControlErrorClassification = "internal" | "transient";

/**
 * ControlError codes that must never become immutable command
 * outcomes. Internal/background failures roll back; transient failures are
 * retried under a new attempt rather than frozen under the command ID.
 */
export const nonDurableControlErrorClassifications = {
  "archive-not-regular": "internal",
  "archive-source-invalid": "internal",
  "artifact-hash-mismatch": "internal",
  "checkpoint-hash-mismatch": "internal",
  "cleanup-path-invalid": "internal",
  "cleanup-source-reused": "internal",
  "command-id-conflict": "internal",
  "control-agents-table-invalid": "internal",
  "control-async-transaction": "internal",
  "control-binary-invalid": "internal",
  "control-capability-probe-failed": "transient",
  "control-command-result-invalid": "internal",
  "control-effective-command-identity-mismatch": "internal",
  "control-evidence-context-missing": "internal",
  "control-global-authority-requires-explicit-groups": "internal",
  "control-host-identity-unavailable": "internal",
  "control-host-mismatch": "internal",
  "control-nested-transaction": "internal",
  "control-node-unsupported": "internal",
  "control-operation-in-progress": "transient",
  "control-owner-changed": "transient",
  "control-owner-invalid": "internal",
  "control-path-not-directory": "internal",
  "control-path-escape": "internal",
  "control-path-changed": "internal",
  "control-path-symlink": "internal",
  "control-path-unsafe-file": "internal",
  "control-peer-exit": "transient",
  "control-peer-timeout": "transient",
  "control-port-options-invalid": "internal",
  "control-profile-invalid": "internal",
  "control-projection-state-missing": "internal",
  "control-projection-transaction-missing": "internal",
  "control-recovery-busy": "transient",
  "control-response-invalid": "transient",
  "control-response-too-large": "transient",
  "control-schema-unsupported": "internal",
  "control-sequence-overflow": "internal",
  "control-store-closed": "internal",
  "control-trusted-config-invalid": "internal",
  "control-writer-active": "transient",
  "handoff-outcome-unknown": "internal",
  "landing-outcome-unknown": "internal",
  "panel-draining": "transient",
  "query-invalid": "internal",
  "resume-bundle-hash-mismatch": "internal",
  "resume-bundle-unsafe-file": "internal",
  "snapshot-head-mismatch": "internal",
  "snapshot-index-hash-mismatch": "internal",
  "start-outcome-unknown": "internal",
  "usage-query-invalid": "internal",
  "usage-regression": "internal",

  // V1 background reason codes are projected on runs/groups, not returned as
  // immutable outcomes of the already accepted command.
  "budget-overrun": "internal",
  "claim-capability-unavailable": "internal",
  "context-observation-gap": "internal",
  "context-observation-invalid": "internal",
  "estimate-blocked-capability": "internal",
  "estimate-capability-degraded": "internal",
  "estimate-input-too-large": "internal",
  "handoff-capability-unavailable": "internal",
  "request-bound-proof-invalid": "internal",
  "shutdown-frozen-set-inconsistent": "internal",
  "start-proof-outcome-unknown": "internal",
  // N1 spec §11.1 (DR27): reason codes projected on a requirement's rounds, drafts and export, never command outcomes.
  "clarify-output-invalid": "internal",
  "requirement-budget-exhausted": "internal",
  "requirement-export-conflict": "internal",
  "requirement-export-path-blocked": "internal",
  "split-output-invalid": "internal",
  "split-validation-exhausted": "internal",
} as const satisfies Record<string, NonDurableControlErrorClassification> &
  Partial<Record<keyof typeof durableCommandErrorStatuses, never>>;

/**
 * The closed construction contract: adding a code requires one classification.
 * The non-durable catalog's `never` constraint rejects overlap at compile time.
 * Helpers must accept this union (or a classified subset), never raw strings.
 */
export type KnownControlErrorCode =
  | keyof typeof durableCommandErrorStatuses
  | keyof typeof nonDurableControlErrorClassifications;

export type NonDurableControlErrorCode = keyof typeof nonDurableControlErrorClassifications;

/** Audited V1 error and typed failure codes named by the Web control spec. */
export const v1WebErrorCodes = [
  "budget-overrun",
  "claim-capability-unavailable",
  "command-id-conflict",
  "command-result-not-found",
  "context-observation-gap",
  "context-observation-invalid",
  "control-capability-unsupported",
  "control-writer-active",
  "correction-target-not-a-decision",
  "corrections-store-unconfigured",
  "decision-approve-reconciling",
  "decision-approve-tip-moved",
  "decision-undo-not-executable",
  "duplicate-proposal-target",
  "estimate-blocked-capability",
  "estimate-capability-degraded",
  "estimate-in-flight",
  "estimate-input-too-large",
  "execution-policy-unrepresentable",
  "grant-amendment-unsupported",
  "group-budget-unavailable",
  "group-state-invalid",
  "handoff-capability-unavailable",
  "handoff-grant-insufficient",
  "identity-space-exhausted",
  "no-op-command",
  "numeric-overflow",
  "panel-draining",
  "pending-decision-correction-failed",
  "pending-decision-entry-invalid",
  "pending-decision-not-found",
  "pending-decision-settled",
  "plan-version-conflict",
  "profile-changed",
  "proposal-version-conflict",
  "recovery-blocked",
  "request-bound-proof-invalid",
  "revision-conflict",
  "route-not-found",
  "shutdown-frozen-set-inconsistent",
  "start-proof-outcome-unknown",
  "stop-already-active",
  "stop-mode-conflict",
] as const satisfies readonly KnownControlErrorCode[];

export function durableCommandErrorStatus(code: string): DurableCommandErrorStatus | null {
  if (!Object.hasOwn(durableCommandErrorStatuses, code)) return null;
  return durableCommandErrorStatuses[code as keyof typeof durableCommandErrorStatuses];
}

export class ControlError extends Error {
  constructor(public readonly code: KnownControlErrorCode, public readonly detail?: string) {
    super(detail === undefined ? code : `${code}:${detail}`);
    this.name = "ControlError";
  }
}
