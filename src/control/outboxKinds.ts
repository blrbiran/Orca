/**
 * Issue #119 (tester round, triage A): the `outbox` table is two things. For a QUEUE kind, `delivered` is the pending
 * bit: a consumer reads `delivered=0` rows and sets 1 once done. For a RECORD kind the row is a durable record read by
 * id, and `delivered` means nothing -- older code writes such rows with 0, newer code with 1, and no reader looks at
 * it. Diagnosing by SQL: `delivered=0` means "pending" only for the QUEUE kinds. A leaf module (no imports), so any
 * module may read it; tests/control/outboxKinds.test.ts keeps both lists complete.
 */
/** Kinds whose `delivered=0` rows a consumer drains (projection.ts, cleanup.ts, recovery.ts, stopIntent.ts, service.ts, schedulerBridge.ts). */
export const OUTBOX_QUEUE_KINDS: readonly string[] = ["projection", "task-handoff", "group-handoff", "cleanup", "handoff-request", "landing"];
/** Kinds that are records read by id; `delivered` carries no meaning for them. */
export const OUTBOX_RECORD_KINDS: readonly string[] = [
  "acceptance", "archive", "estimate-claim", "estimate-contract", "handoff-attempt", "handoff-recovery", "integration-usage",
  "reconcile-usage", "recovery-error", "report", "start", "stop", "task-results", "work-claim",
];
