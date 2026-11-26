/**
 * Issue #119 (tester round, triage A): the `outbox` table is two things. For a QUEUE kind, `delivered` is the pending
 * bit: a consumer reads `delivered=0` rows and sets 1 once done. For a RECORD kind the row is a durable record read by
 * id, and `delivered` means nothing -- older code writes such rows with 0, newer code with 1, and no reader looks at
 * it. Diagnosing by SQL: `delivered=0` means "pending" only for the QUEUE kinds. A leaf module (no imports), so any
 * module may read it; tests/control/outboxKinds.test.ts keeps both lists complete.
 */
/**
 * Kinds whose `delivered=0` rows a consumer drains (projection.ts, cleanup.ts, recovery.ts, stopIntent.ts, service.ts, schedulerBridge.ts).
 *
 * Tester #170: `handoff-request` only partly. Its rows come in two shapes. A run's own request (service.ts, id
 * `handoff-request:<runId>`) is set delivered when that run ends `settled` (another end leaves it at 0). A stop's or a context threshold's request (stopIntent.ts,
 * contextControl.ts, id = the desired request id) is set delivered only by stopIntent.ts `deliverHandoffStop`, which no
 * production path calls today; the request's own state lives in `handoff_requests`, and those outbox rows stay at 0 after
 * the request settled. So for this kind `delivered=0` does not mean "still to deliver": read the request's state instead
 * (and, for a run's own request, whether its run is still active; controlViews.ts undeliveredHandoffRows, read side only).
 */
const QUEUE_KINDS = ["projection", "task-handoff", "group-handoff", "cleanup", "handoff-request", "landing"] as const;
/** Kinds that are records read by id; `delivered` carries no meaning for them. */
const RECORD_KINDS = [
  "acceptance", "archive", "estimate-claim", "estimate-contract", "handoff-attempt", "handoff-recovery", "integration-usage",
  "reconcile-usage", "recovery-error", "report", "start", "stop", "task-results", "work-claim",
  // Tester #509: written through `closeSingleCall` / `singleCallClaimRowOf`, so the literal scan cannot see them. All
  // four are read back by id only (the contract, the claim row, the settlement receipt and the estimate receipt), and
  // production writes them with `delivered=1`; they are records.
  "single-call-claim", "single-call-contract", "single-call-result", "estimate-result",
] as const;

export const OUTBOX_QUEUE_KINDS: readonly string[] = QUEUE_KINDS;
export const OUTBOX_RECORD_KINDS: readonly string[] = RECORD_KINDS;

/**
 * Every kind a writer may put in `outbox.kind`. Tester #509: typing the shared writers with this union makes a new
 * kind a type error at its call site, which the literal-scan test cannot do for parameterized inserts.
 */
export type OutboxKind = (typeof QUEUE_KINDS)[number] | (typeof RECORD_KINDS)[number];
