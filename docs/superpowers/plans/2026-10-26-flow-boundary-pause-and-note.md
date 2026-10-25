# Flow boundary pause and operator note (T9/T10)

Status: approved by the human (`同意按你的建议做 A,B 和 C`, 2026-10-26). Implements the only whole unstarted spec-defined
feature left on Orca main: live-transcript design §10.5.1 (pause) and §10.5.2 (note), with §10.5.3 authority.

Binding spec: `docs/superpowers/specs/2026-10-23-live-transcript-design.md` §10.5. The earlier live-transcript plan
(`docs/superpowers/plans/2026-10-24-live-transcript-orca.md:43-44`) records T9/T10 as out of scope for that branch.

Standing boundaries: no merge/push/worktree deletion without separate human authorization; no paid agent run without a
per-run nod; tests use `ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-c205d55/dist/cli.js` and
`CCLOOP_CACHE_DIR=/private/tmp/orca-ffec7b28/ccloop-cache-h7`, never `~/.orca` or `~/.cache/ccloop`; run
`tests/flow/heldEffectChains.test.ts` before touching marks/holds/recovery and again at the gate.

## 1. What the spec requires

### 10.5.1 Pause

- The flow run's `pause` command, taken **while a work step runs** (today messages wait for a boundary).
- Each running work step's hidden child group gets `handoff-stop`, reason `human`.
- `handoffDeadlineAt = acceptedAt + contract.executionPolicy.perAttemptTimeoutMs + 60 s`, capped as
  `freezeHandoffDeadline` caps. The default 30 min is too short and would abort a turn (`handoff_interrupted`).
- The child does not settle the step. The execution stays `running`; the run shows `paused`.
- `resume` issues `resume-from-handoff` for each stopped child (requires `handoff-complete`).
- Direct `resume-dispatch` / `resume-from-handoff` on a child whose stop came from the flow is refused
  `flow-pause-resume-via-flow`.
- If a continuation cannot be funded, the run stays `paused` with `continuation-budget-unavailable` /
  `group-budget-unavailable` shown, not dropped.

### 10.5.2 Note

- A note is not an input. It is recorded on the receiving work execution's body as
  `operatorNotes: [{seq, by, at, text, scope}]`, never in `ranOnInputs`.
- Delivery only through a boundary handoff and a continuation. Accepting a note requests the same stop for that one step's
  child. At `handoff-complete`, the flow continues at once; the run is not paused unless the person also paused it.
- The continuation envelope carries `work.operatorNote`, frozen at prepare like `priorFailures`, hashed with the envelope.
- Pending notes at one boundary are joined in order; the joined text must fit 4096 UTF-8 bytes or the note is refused on
  accept (`flow-note-too-large`).
- `remaining-attempts` notes stay pending and are copied into later continuation runs of the same execution.
- A note re-runs nothing; a new execution does not inherit notes; a note to a step with no running work child is refused
  `flow-note-no-running-work`.
- The command is flow-message `note` aimed at one step; authority is checked by the kernel from the recorded fact
  (`releaseRefusal` pattern).

### 10.5.3 Authority

- `note`: `hasPersonAuthority` (owner on the Web, or socket with an owner's person token, never a dispatched run).
- `pause`: any Web principal (owner or member), or socket with a verified person token; refused for a dispatched run.
- `resume`: `hasPersonAuthority`.
- Only these three commands narrow; every other flow-message command stays `any`.

## 2. Decisions

- **D1 Mid-run lane.** `consumeInterventions` takes accepted `pause`/`resume`/`note` messages at any time, in seq order,
  with the existing apply/reject pattern. `consumeAtBoundary` excludes these three (they are handled exactly once).
  Nothing else is taken mid-run.
- **D2 Pass order.** `advanceIntakes` → `consumeInterventions` → `settleStopIntents` → `consumeAtBoundary` → the existing
  `state !== "running"` gate. `settleStopIntents` runs for `running` and `paused` runs; it issues missing stops and
  completes note resumes. A paused run therefore keeps advancing its stops without starting new work.
- **D3 Store internals, not client payloads.** Flow stops and flow resumes are written by store helpers, not by opening
  `handoff-stop`/`resume-*` to the client with a `flowStop` field: the marker must not be forgeable. Group revision is
  bumped and a projection change recorded so the ledger stays consistent.
- **D4 Side door.** `StopIntentV1` gains optional
  `flowStop: {flowRunId, stepKey, seq, reason: "pause" | "note"}`. `applyResumeDispatch` and
  `applyResumeFromHandoff` throw `ControlError("flow-pause-resume-via-flow", groupId)` when it is present, before any
  other check. The flow's own resume bypasses the command surface through `FlowChildPort.resume`.
- **D5 Deadline.** One helper: `flowHandoffDeadline(acceptedAt, perAttemptTimeoutMs)` =
  `min(acceptedAt + perAttemptTimeoutMs + 60_000, MAX_STOP_INSTANT)`. A missing/non-positive
  `perAttemptTimeoutMs` refuses at accept with `flow-pause-timeout-unknown:<stepKey>`.
- **D6 Intent records.** `FlowRunBody` gains
  `pauseIntent?: {messageSeq, at, steps: [{stepKey, seq, childGroupId, acceptedAt, deadlineAt}]}` and
  `noteIntent?: {steps: [{stepKey, seq, childGroupId, acceptedAt, deadlineAt}]}`. `ExecutionBody` gains
  `operatorNotes?: OperatorNoteEntry[]` with
  `{seq, by, at, text, scope, deliveredTo?: string[], consumedAt?: string}`.
- **D7 Stop state is read from the child.** `FlowChildPort` gains `attemptTimeoutMs`, `stop`, `stopState`, `resume`.
  `stopState` distinguishes `none`, `not-complete` (pending/partial/unresolved), `resumable` (with `recoverable` flag) and
  `foreign` (a stop the flow did not place, or a marker mismatch). A foreign stop keeps the run paused with
  `flow-pause-stop-incomplete:<step>:foreign`; the person resolves their own stop.
- **D8 Resume is all-or-nothing.** `FlowChildPort.resume` writes every child in one `store.transaction`; one child's
  refusal rolls the batch back. The run's intents and state move in a second transaction after the batch succeeds.
- **D9 Note joining.** Pending = `next-attempt` notes with no `deliveredTo` plus all `remaining-attempts` notes. Join in
  seq order with `\n`; scope is `remaining-attempts` if any included note has it, else `next-attempt`. The *joined* text
  must fit 4096 UTF-8 bytes (stricter than the sum, because the wire field is bounded).
- **D10 Delivery bookkeeping.** A `next-attempt` note gets `deliveredTo: [pendingRunId]` when a continuation is
  registered. A `remaining-attempts` note stays pending. A restartable child (no continuation) marks `next-attempt`
  notes `consumedAt` (dropped, accepted gap below).
- **D11 Authority facts.** `FlowMessageInput` gains `pauseAuthority?: boolean`; `acceptMessage` stores
  `pauseAuthority` for `pause` and `personAuthority` for `resume`/`note` (marks keep theirs). `permissions.ts` gains
  `hasPauseAuthority`. `commandClient.ts` adds `pauseAuthority` and `routedPauseAuthorityFor`; `controlApi.ts` passes it.
  The kernel refuses absent facts with `flow-command-needs-person:<pause|resume|note>`.
- **D12 Socket tier.** `SOCKET_TIER["flow-message"]` returns `token` for `pause`, `resume`, `note` and for a `defer` with
  a non-`wait` effect (existing); otherwise `open`. A dispatched run is therefore refused by the existing tier path.
- **D13 UI.** Pause stays on every Web user's controls; resume is rendered only for the owner; the note form is rendered
  only for the owner on a running work step. Notes appear in the message journal (the journal row already renders
  `body.text`); no new view field is added.

## 3. Accepted gaps (registered, not silently dropped)

- A **restartable** child has no continuation, so a note that requested its stop is consumed and not delivered
  (`consumedAt`); the step still continues at once.
- `handoff-partial` / `handoff-unresolved` after a pause or note keeps the run paused (pause) or the intent in place
  (note) with `flow-pause-stop-incomplete:<step>:<state>` shown; the person must recover the child through the existing
  recovery verbs. The flow never resumes an unresolved child.
- A note-resume budget failure keeps `noteIntent` and records `lastError`; each pass retries it. The note is not lost.
- A recovery continuation of a child that was **not** initiated by a flow resume does not carry `remaining-attempts`
  notes; later flow pauses/resumes of the same execution still carry them.
- A note accepted during a pending pause stop joins the same boundary; if that stop turns out restartable, the note is
  consumed as above.
- Cancel (`stop`) still waits for a boundary, as today; this plan does not make cancel mid-turn.

## 4. Task breakdown

Every task: TDD, one commit, `PATH=/usr/local/bin:$PATH`, full unit suite, and a named mutation seen red with a
byte-identical restore. Mutation log: `.superpowers/sdd/2026-10-26-flow-boundary-note/progress.md` (append-only).

### T1 — Flow stop marker, deadline helper, side door

Files: `src/control/stopIntent.ts`, `src/control/errors.ts`, `tests/control/stopIntent.test.ts` (or the existing stop
intent suite), `tests/panel/refusalCoverage.test.ts`.

- `StopIntentV1.flowStop?`; extend the strict `stopIntentBodySchema`; keep `saveStopIntent`/`readStopIntent` canonical.
- `flowHandoffDeadline(acceptedAt, perAttemptTimeoutMs)`; cap at `MAX_STOP_INSTANT`.
- Extract `handoffStopInTransaction` from `applyHandoffStop`'s apply body (freeze runs, derive state, save intent,
  activity, group.stopped), so the command path and the flow path share it.
- `applyFlowHandoffStop(store, groupId, {acceptedAt, deadlineAt, flowStop})`: own transaction, `updateRevision(+1)`,
  projection change, idempotent for the same marker, `stop-mode-conflict` for any other existing intent.
- Side-door refusal in `applyResumeDispatch` and `applyResumeFromHandoff`.
- Add `flow-pause-resume-via-flow` to the error catalog (409) and to the refusal-coverage list only if it reaches a
  locale table (it is a control error, so catalog copy is required).
- Tests: marker round-trips; deadline math with a 60-minute timeout; cap; idempotence; foreign intent conflict; both
  resume verbs refused.
- **Mutation M1**: `flowHandoffDeadline` drops the `+ 60_000` → the 60-minute-timeout test sees 30 minutes? No — it must
  see `perAttemptTimeoutMs`, so the assertion is `deadline - acceptedAt === 3_660_000`; dropping 60 s makes it red.
- **Mutation M2**: remove the `flowStop` refusal from `applyResumeDispatch` → the side-door test goes red.

### T2 — Child port: stop/stopState/resume/attemptTimeoutMs

Files: `src/flow/kinds/work.ts`, `src/flow/childPort.ts`, `src/control/continuation.ts`,
`src/control/executionSnapshot.ts` (import only), `tests/flow/driverChildPort.test.ts`,
`tests/flow/fixtures/fakeChildPort.ts` (new fixture).

- Extend `FlowChildPort`:
  ```ts
  attemptTimeoutMs(childGroupId: string): number | null;
  stop(childGroupId: string, input: { acceptedAt: string; deadlineAt: string; flowStop: FlowStopMarker }): void;
  stopState(childGroupId: string, flowStop: FlowStopMarker): FlowChildStopState;
  resume(children: Array<{ childGroupId: string; flowStop: FlowStopMarker; operatorNote?: OperatorNote }>):
    Array<{ childGroupId: string; pendingRunId: string | null }>;
  ```
  `FlowChildStopState = {state:"none"} | {state:"not-complete"; stopState:string} |
  {state:"resumable"; recoverable:boolean} | {state:"foreign"; stopState:string}`.
- Production `childPort.ts`: `attemptTimeoutMs` reads the child work item and
  `readConfirmedTaskExecution(...).contract.executionPolicy.perAttemptTimeoutMs`, `null` on any refusal.
- `stopState` reads the child intent; `handoff-complete` → `resumable` with `recoverable` iff the held work item's
  current run has a `result: "partial"` checkpoint; `handoff-pending|partial|unresolved` → `not-complete`; no intent,
  a foreign marker, or a non-flow intent → `none`/`foreign`.
- `resume` in one transaction: verify the marker; `updateRevision(+1)`; recoverable → `registerContinuation` (with the
  note) + clear intent/unstop/rearm + `armContinuationWake`; restartable → clear intent/unstop/rearm +
  `startSchedulerWake`. Map `ControlError` to `FlowRefusal` with the same code for
  `continuation-budget-unavailable`/`group-budget-unavailable`, else `flow-pause-resume-failed:<code>`.
- `continuation.ts`: `RegisteredContinuation.operatorNote?` (strict schema), `registerContinuation(..., operatorNote?)`,
  export `resumeChildInTransaction` helpers used by the port.
- Fake port fixture models per-child state and records calls; used by T4–T6.
- Tests: deadline source; stop → intent with marker; stopState transitions; recoverable vs restartable; batch rollback on
  one budget refusal; marker mismatch refused; direct verbs still refused.
- **Mutation M3**: `stopState` returns `resumable` for `handoff-pending` → the batch-refusal test goes red.

### T3 — Authority plumbing

Files: `src/panel/permissions.ts`, `src/panel/humanOnly.ts`, `src/control/commandClient.ts`,
`src/panel/controlApi.ts`, `src/panel/flowAssembly.ts` (no new deps expected), tests `tests/panel/accessMatrix.test.ts`,
`tests/panel/permissions.test.ts`.

- `hasPauseAuthority(p)`: Web user (any role) or a non-dispatched socket principal with a person token.
- `CommandContext.pauseAuthority` + `routedPauseAuthorityFor`; `controlApi.ts` passes `pauseAuthority:
  hasPauseAuthority(principal)`.
- `SOCKET_TIER["flow-message"]` predicate: `pause`/`resume`/`note` → `token`; existing defer rule preserved; else `open`.
- `FlowMessageInput.pauseAuthority`.
- Access matrix rows: owner/member Web accepted for pause; owner accepted for resume/note; member Web accepted by the
  route for resume/note but refused by the kernel (kernel tested in T4/T5); socket without token refused
  `control-person-token-required`; dispatched run refused `control-dispatched-run-refused`.
- **Mutation M4**: `SOCKET_TIER["flow-message"]` ignores `pause` → the dispatched-run pause row goes red.

### T4 — Pause and resume

Files: `src/flow/messages.ts`, `src/flow/kernel.ts`, `src/flow/kinds/registry.ts` (types),
`src/flow/store.ts` (only if a helper is missing), `tests/flow/boundaryPause.test.ts`.

- `FlowRunBody.pauseIntent`; `setFlowRunState` + `updateFlowRunBody` in one transaction.
- `consumeInterventions` and the `INTERVENTIONS` set; `consumeAtBoundary` filter.
- `applyIntervention` pause: authority, `running` only, collect running work executions with a child, compute deadline per
  child (`flow-pause-timeout-unknown` if unknown), record `pauseIntent`, move to `paused`. With no running work child:
  just move.
- `settleStopIntents`: for each pause step, `stopState`; `none` → `stop`; `foreign`/`not-complete` → record
  `lastError` `flow-pause-stop-incomplete:<step>:<state>` (never throw from the pass); `resumable` → wait (resume does
  it). Clears nothing from `pauseIntent` here.
- Resume: authority, `paused` only; no `pauseIntent` → move to `running`; otherwise pre-check every child is `resumable`
  (any other → `flow-pause-stop-incomplete`), join each step's pending notes, `children.resume(...)`; on `FlowRefusal`
  reject the message, leave the run `paused` and the intent in place; on success mark `next-attempt` notes delivered,
  clear `pauseIntent` (and any `noteIntent` step it covers), move to `running`.
- The execution stays `running` throughout; `settleRunning` already sees the child as running while held.
- Tests (fake port; template with one work step):
  1. pause mid-run is applied before the boundary; stop carries `reason: "pause"` and the computed deadline; execution
     stays running; run paused.
  2. resume while `handoff-pending` → `flow-pause-stop-incomplete`; run stays paused.
  3. resume after `handoff-complete` (recoverable) → one continuation registered, run running, intent cleared.
  4. resume after `handoff-complete` (restartable) → scheduler wake, no continuation, run running.
  5. no `pauseAuthority` → `flow-command-needs-person:pause`; no `personAuthority` on resume → `...:resume`.
  6. budget refusal → run paused, message rejected with the budget code, intent intact.
  7. pause with no running work child → paused without a stop.
- **Mutation M5**: pause records `HANDOFF_DEADLINE_MS` instead of the per-contract deadline → test 1 red.
- **Mutation M6**: resume treats `handoff-pending` as resumable → test 2 red.

### T5 — Note accept and record

Files: `src/flow/messages.ts`, `src/flow/kinds/registry.ts`, `tests/flow/operatorNote.test.ts`.

- `noteCommandSchema` (`command`, `text`, `scope`, strict) in `shapeRefusal`; target must be a step; a non-step target is
  `flow-message-target-missing`.
- Accept checks: no running `work` execution with a child → `flow-note-no-running-work`; authority after shape; pending
  bytes + new joined bytes > 4096 → `flow-note-too-large`.
- Apply: re-check target/authority/state; append `{seq, by, at, text, scope}` to the execution body with
  `finishExecution(running→running)`; if the run is `paused` or the step is in `pauseIntent`, record only; otherwise set
  `noteIntent` (deadline from `attemptTimeoutMs`, `flow-pause-timeout-unknown` if unknown).
- `pendingNotes`, `joinPendingNotes`, `noteBytes` exported for T6.
- Tests: recorded body shape; no-running-work; too-large (two notes summing over the cap); missing authority; a note does
  not change `ranOnInputs` or the fingerprint; a new execution body has no notes.
- **Mutation M7**: add `operatorNotes` to `ranOnInputsOf` → the identity test red.
- **Mutation M8**: skip the byte cap → the too-large test red.

### T6 — Note delivery through a continuation

Files: `src/flow/kernel.ts`, `src/flow/messages.ts`, `src/control/continuation.ts`,
`src/control/webDispatch.ts`, `src/control/executionDriver.ts`, `src/control/startEnvelope.ts`,
`src/control/schema.ts` (import only), `tests/flow/operatorNote.test.ts`, `tests/control/startEnvelope.test.ts`,
`tests/control/continuation.test.ts`.

- `settleStopIntents` note path: `none` → `stop`; `resumable` → `resume` with joined notes, clear the step from
  `noteIntent`, mark `next-attempt` delivered / `consumedAt` for restartable; `foreign`/`not-complete` → keep the intent
  and `lastError`; clear `noteIntent` when empty. The run stays `running`.
- `DispatchRun.operatorNote?`; `createStartingRun` copies `continuation.operatorNote`.
- A2: read/validate the run's `operatorNote` with `operatorNoteSchema` and pass it to `toStartEnvelope`; only a
  continuation has one. `StartEnvelopeWork.operatorNote?`; `toStartEnvelope` emits `work.operatorNote`, so envelope hash
  covers it.
- Tests:
  1. a note stops the child, then a recoverable resume registers a continuation whose `operatorNote` is the joined text;
     the envelope carries `work.operatorNote`; the hash differs when the note differs.
  2. two notes join in seq order; `remaining-attempts` wins the scope.
  3. after the first continuation, a `next-attempt` note is not re-sent; a `remaining-attempts` note is.
  4. a restartable note resume continues with no continuation and marks the note consumed.
  5. a budget failure keeps `noteIntent` and `lastError`, and a later pass retries.
- **Mutation M9**: `createStartingRun` drops `continuation.operatorNote` → test 1 red.
- **Mutation M10**: the delivery filter drops `remaining-attempts` → test 3 red.

### T7 — Web run page

Files: `web/src/FlowRunPage.tsx`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`, the existing web flow-run test.

- `RunControls`: resume rendered only when `may`; a `role="note"` owner-only line for a paused run seen by a member.
- `NoteForm` on a running `work` step for `may`: textarea, scope select (`next-attempt` / `remaining-attempts`), send
  `{kind:"command", target:{kind:"step", stepKey}, body:{command:"note", text, scope}}`; disabled when empty or over
  4096 bytes.
- Copy for the new refusal codes in both locales (`flow-command-needs-person`, `flow-note-no-running-work`,
  `flow-note-too-large`, `flow-pause-stop-incomplete`, `flow-pause-resume-via-flow`, `flow-pause-timeout-unknown`,
  `flow-pause-resume-failed`).
- Web test: owner sees pause + resume + note on a running work step; member sees pause, no resume, no note form.
- **Mutation M11**: render resume for every `may` or not — the member test red (whichever the test asserts).

### T8 — Gate, docs, review

- `skills/orca-control/references/error-codes.md`: the new flow refusal codes.
- `tests/panel/refusalCoverage.test.ts`: add the flow message reasons to the list.
- Full gates with the pinned env:
  - `PATH=/usr/local/bin:$PATH npm run build`
  - `PATH=/usr/local/bin:$PATH npm test` (unit; includes `tests/flow/heldEffectChains.test.ts`)
  - `PATH=/usr/local/bin:$PATH npm run test:web`
- Independent spec review then quality review; fix and re-review until both pass.
- No merge, no push, no worktree deletion without separate authorization.

## 5. Open questions resolved during research

- `consumeAtBoundary` early-returns while any execution runs; the new lane is separate so no boundary semantics change for
  feedback/edit/stop/retry/rewind/skip/defer/fill/params.
- `settleRunning`/`pollChild` already keep a held child `running` (`work.status !== "done"`), so the execution naturally
  waits without a new state.
- `resumeExecution` and `applyOutcome` preserve extra body keys, so `operatorNotes` survives restarts, retries and
  settlement; `appendQueued` starts a new body with none.
- `registerContinuation` requires `work.status === "held"`, which is what a handoff stop leaves.
- The production port has the store it needs for stop/resume; no new panel wiring.
