export type DurableCommandErrorStatus = 400 | 404 | 409 | 422 | 423;

/**
 * Stable V1 classification for errors that are safe to persist as immutable
 * command outcomes. Codes absent from this catalog are internal/unexpected and
 * must escape so the surrounding transaction rolls back.
 */
export const durableCommandErrorStatuses = {
  // The raw envelope is already valid when command processing starts. These
  // are the remaining payload/value validation errors that command handlers
  // can discover.
  "control-invalid-stop": 400,
  "control-non-canonical-json": 400,
  "control-non-json-payload": 400,

  // Resource lookup.
  "artifact-not-found": 404,
  "checkpoint-not-committed": 404,
  "group-not-found": 404,
  "handoff-work-not-found": 404,
  "run-not-found": 404,
  "start-intent-missing": 404,
  "task-checkpoint-not-committed": 404,
  "work-not-found": 404,

  // Optimistic concurrency, immutable identity, and ownership conflicts.
  "artifact-id-conflict": 409,
  "checkpoint-id-conflict": 409,
  "checkpoint-identity-conflict": 409,
  "checkpoint-run-settled": 409,
  "checkpoint-usage-high-water": 409,
  "continuation-identity-conflict": 409,
  "execution-identity-conflict": 409,
  "graph-version-conflict": 409,
  "group-already-exists": 409,
  "group-graph-conflict": 409,
  "group-project-conflict": 409,
  "handoff-identity-conflict": 409,
  "handoff-request-conflict": 409,
  "landing-branch-conflict": 409,
  "plan-version-conflict": 409,
  "profile-changed": 409,
  "proposal-version-conflict": 409,
  "reconcile-version-conflict": 409,
  "report-commit-invalid": 409,
  "report-identity-conflict": 409,
  "report-path-conflict": 409,
  "resume-artifact-conflict": 409,
  "resume-bundle-exists": 409,
  "revision-conflict": 409,
  "run-generation-conflict": 409,
  "run-grant-conflict": 409,
  "run-owner-conflict": 409,
  "start-contract-conflict": 409,
  "start-envelope-conflict": 409,
  "start-state-conflict": 409,
  "stop-mode-conflict": 409,
  "target-version-conflict": 409,
  "usage-event-conflict": 409,
  "work-already-active": 409,
  "work-already-done": 409,

  // Valid commands that cannot be represented or performed in current state.
  "cleanup-not-recoverable": 422,
  "continuation-budget-unavailable": 422,
  "continuation-predecessor-unrecoverable": 422,
  "control-capability-unsupported": 422,
  "control-evidence-unavailable": 422,
  "control-plan-rejected": 422,
  "control-protocol-unavailable": 422,
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
  "group-review-budget-unavailable": 422,
  "group-state-invalid": 422,
  "group-stopped": 422,
  "handoff-budget-unavailable": 422,
  "handoff-grant-insufficient": 422,
  "handoff-parent-invalid": 422,
  "landing-needs-review": 422,
  "no-op-command": 422,
  "reconcile-budget-unapproved": 422,
  "reconcile-registration-invalid": 422,
  "recovery-blocked": 422,
  "recovery-validation-failed": 422,
  "resume-predecessor-unrecoverable": 422,
  "resume-source-dir-not-absolute": 422,
  "run-stop-unconfirmed": 422,
  "snapshot-partial": 422,
  "snapshot-required": 422,
  "usage-gap": 422,

  // A durable recovery lock is immutable for this command ID.
  "control-recovery-required": 423,
} as const satisfies Record<string, DurableCommandErrorStatus>;

export function durableCommandErrorStatus(code: string): DurableCommandErrorStatus | null {
  if (!Object.hasOwn(durableCommandErrorStatuses, code)) return null;
  return durableCommandErrorStatuses[code as keyof typeof durableCommandErrorStatuses];
}

export class ControlError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "ControlError"; }
}
