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
  "run-already-settled": 409,
  "run-generation-conflict": 409,
  "run-grant-conflict": 409,
  "run-owner-conflict": 409,
  "start-contract-conflict": 409,
  "start-envelope-conflict": 409,
  "start-state-conflict": 409,
  "stop-already-active": 409,
  "stop-mode-conflict": 409,
  "target-version-conflict": 409,
  "usage-event-conflict": 409,
  "work-already-active": 409,
  "work-already-done": 409,

  // Valid commands that cannot be represented or performed in current state.
  "cleanup-not-recoverable": 422,
  "budget-overflow": 422,
  "continuation-budget-unavailable": 422,
  "continuation-predecessor-unrecoverable": 422,
  "control-capability-unsupported": 422,
  "control-evidence-unavailable": 422,
  "control-plan-rejected": 422,
  // Assembly spec §3 / ruling R5: no execution port is configured on this process. Durable, so a
  // person sees a named outcome rather than a rolled-back command, and 422 rather than 5xx because
  // the request was understood perfectly -- the environment simply cannot carry it out.
  "control-port-unconfigured": 422,
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
  "identity-space-exhausted": 422,
  "landing-not-confirmed": 422,
  "landing-needs-review": 422,
  "no-op-command": 422,
  "numeric-overflow": 422,
  "reconcile-budget-unapproved": 422,
  "reconcile-registration-invalid": 422,
  "recovery-validation-failed": 422,
  "resume-predecessor-unrecoverable": 422,
  "resume-handoff-invalid": 422,
  "resume-source-dir-not-absolute": 422,
  "run-stop-unconfirmed": 422,
  "snapshot-partial": 422,
  "snapshot-invalid": 422,
  "snapshot-required": 422,
  "usage-gap": 422,

  // A durable recovery lock is immutable for this command ID.
  "control-recovery-required": 423,
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
  "control-adapter-config-invalid": "internal",
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
