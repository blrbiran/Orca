# Web Recoverable Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Web V1 control slice: trusted plan import, editable/accounted estimates, immutable confirmation, durable start/stop/continuation/recovery, canonical Panel APIs, and a thin recoverable browser client.

**Architecture:** Keep the existing control foundation as the execution primitive layer. Add a Web-facing orchestration service over ControlStore, a trusted profile/allowlist boundary owned by Panel lifecycle, closed protocol/read DTOs, and a separate browser state layer. All authority remains in SQLite; the browser carries only presentation state, unsaved drafts, and uncertain command IDs.

**Tech Stack:** TypeScript, Node.js 22 `node:sqlite`, Express 5, Zod 3, React 19, Vitest 2, Vite 6.

**Spec:** `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`

## Global Constraints

- Work only in `/Users/biran/.codex/worktrees/control-foundation-0919/Orca` on `codex/control-foundation-0919`; do not merge to `main`, push, publish, or clean development/evidence trees.
- Preserve `.superpowers/sdd/2026-09-19-ccloop-control-handoff-d3/`; new evidence belongs under `.superpowers/sdd/2026-09-19-web-recoverable-control/`.
- Reuse the completed control foundation and real ccloop consumer; do not reimplement the eight foundation tasks, Codex adapter tasks, public control protocol, handoff, or D3.
- Codex remains `usageObservation: phase-end` plus `budgetEnforcement: soft`; never advertise Codex as strict or synthesize request-bound proof.
- No live model call is authorized. Estimator/worker tests use deterministic local ports; a real ccloop smoke may not invoke an external model.
- All JSON protocol numbers are nonnegative JavaScript safe integers unless the schema explicitly says otherwise; canonical hashing follows RFC 8785 and lower-case hex SHA-256.
- Every mutation uses raw/effective/authority command identity, commandRevision CAS, durable result replay, and a projection sequence distinct from command authority.
- The trusted `complex-1m` defaults are work `{tokens:3000000,activeMs:14400000,attempts:3,sessions:3}`, handoff `{300000,1800000,0,0}`, goal review `{1000000,3600000,1,1}`, estimate `{250000,900000,1,1}`, and 20% component-wise ceiling reserve.
- Browser input may name only allowlisted IDs and numeric policy values; it may never supply executable paths, adapter configuration, repository paths, plan paths, evidence roots, or arbitrary commands.
- Follow RED → verify RED → GREEN → verify focused GREEN → full task suite. No production behavior is added before its failing test.
- Root regression tests require `ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js` in this development tree.

## Review Focus

- Lost responses and same-ID replay must never duplicate imports, estimates, wakes, handoffs, continuations, or shutdown effects; Tasks 2, 6, 7, and 8 own explicit replay tests.
- Dynamic capability/default changes must not rewrite frozen command/request/profile authority; Tasks 3 and 6 own degradation and replay vectors.
- Crash boundaries must be all-or-nothing across snapshot/derived-contract, stop/request/outbox, continuation, and global shutdown transactions; Tasks 4, 6, 8, and 10 own fault tests.
- Unknown evidence, usage, or provider-start state must retain reserve and block dispatch rather than becoming zero/success; Tasks 7, 8, and 10 own hostile recovery cases.
- Epoch/change-sequence gaps and concurrent tabs must force canonical reload or revision conflict without applying stale UI state; Tasks 5 and 9 own browser/API tests.

---

### Task 1: Canonical protocol values and closed schemas

**Files:**
- Create: `src/control/canonicalJson.ts`
- Create: `src/control/webProtocol.ts`
- Create: `tests/control/canonicalJson.test.ts`
- Create: `tests/control/webProtocol.test.ts`
- Modify: `src/control/types.ts`
- Modify: `src/control/schema.ts`

**Interfaces:**
- Consumes: existing `Amount`, `ControlError`, Zod validation patterns.
- Produces: `canonicalBytes(value)`, `sha256Canonical(value)`, `canonicalTimestampSchema`, `ControlPlanV1`, `ExecutionProfileSnapshotV1`, `ExecutionSnapshotV1`, command envelopes/results, read DTOs, and mutation payload schemas used by every later task.

- [ ] **Step 1: Write canonicalization golden-vector tests**

```ts
it("hashes safe-integer RFC 8785 values and rejects ambiguous JSON", () => {
  expect(canonicalBytes({ z: 1, a: "x" }).toString("utf8")).toBe('{"a":"x","z":1}');
  expect(sha256Canonical({ z: 1, a: "x" })).toBe("8d6a75ac86d8b51bb56acfbb96108ed81474aa3504c317f77c0c576bde387cd3");
  for (const bad of [-0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
    expect(() => canonicalBytes({ bad })).toThrowError("control-non-canonical-json");
  }
});
```

Use a complete independently computed 64-hex literal in the committed test, plus vectors for UTF-16 property ordering, explicit nulls, duplicate-set rejection, and canonical UTC milliseconds.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `rtk npm test -- tests/control/canonicalJson.test.ts tests/control/webProtocol.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement the canonical boundary and closed schemas**

```ts
export function canonicalBytes(value: unknown): Buffer;
export function sha256Canonical(value: unknown): string;
export const canonicalTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
export const commandEnvelopeSchema = z.object({
  commandId: idSchema,
  expectedRevision: safeInteger,
  payload: z.unknown(),
}).strict();
```

Implement the exact schemas and sorted-set rules from spec §§3.1–4.1 and §5.4. Keep legacy foundation `WorkKind` separate from the Web V1 union so existing callers do not change behavior.

- [ ] **Step 4: Verify focused GREEN and typecheck**

Run: `rtk npm test -- tests/control/canonicalJson.test.ts tests/control/webProtocol.test.ts && rtk npm run typecheck`

Expected: all focused tests pass; typecheck exits 0.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add src/control/canonicalJson.ts src/control/webProtocol.ts src/control/types.ts src/control/schema.ts tests/control/canonicalJson.test.ts tests/control/webProtocol.test.ts
rtk git commit -m "feat(control): define web control protocol"
```

---

### Task 2: Durable command ledger, revisions, and projection journal

**Files:**
- Create: `src/control/commandLedger.ts`
- Create: `src/control/projectionJournal.ts`
- Create: `tests/control/commandLedger.test.ts`
- Create: `tests/control/projectionJournal.test.ts`
- Modify: `src/control/migrations.ts`
- Modify: `src/control/store.ts`
- Modify: `src/control/commands.ts`
- Modify: `src/control/queries.ts`
- Modify: `tests/control/commands.test.ts`
- Modify: `tests/control/store.test.ts`

**Interfaces:**
- Consumes: Task 1 canonical hashes and command schemas.
- Produces: `applyWebCommand()`, `lookupCommandResult()`, `recordProjectionChange()`, global `changeSeq`, per-group `projectionSeq`, durable scheduler-wake rows, and schema migration/open validation used by Tasks 4–10.

- [ ] **Step 1: Write failing command/revision/projection tests**

```ts
it("replays the persisted effective default and separates authority from projection", () => {
  const first = applyWebCommand(h.store, requestWithOmittedDefault, () => accepted("profile-a"));
  h.defaults.profileId = "profile-b";
  expect(applyWebCommand(h.store, requestWithOmittedDefault, () => accepted("profile-b"))).toEqual(first);
  observeUsage(h.store, "g", amount(1));
  expect(readVersions(h.store, "g")).toEqual({ commandRevision: 1, projectionSeq: 2 });
});
```

Cover same-ID/different actor, verb, target, revision, or raw payload; stale revision precedence; durable 4xx result replay; one projection bump per transaction; changeSeq gap retention; and safe-integer overflow.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `rtk npm test -- tests/control/commandLedger.test.ts tests/control/projectionJournal.test.ts tests/control/commands.test.ts tests/control/store.test.ts`

Expected: FAIL on missing ledger/journal APIs.

- [ ] **Step 3: Migrate storage without weakening old schema safety**

Add versioned migration support that transforms schema 1 to the Web schema in one transaction and refuses unknown future versions. Persist canonical raw request, expanded effective payload, all three hashes, status/body, actor/verb/target, command revision, projection sequence, and global-command scope. Add projection journal retention metadata, global change sequence, proposal/estimate/snapshot/stop/recovery tables, and durable wake/request/join records required by later tasks.

- [ ] **Step 4: Implement atomic command and projection helpers**

```ts
export function applyWebCommand<T>(store: ControlStore, input: WebCommandInput<T>): StoredCommandOutcome<T>;
export function lookupCommandResult(store: ControlStore, groupId: string, commandId: string): CommandLookupV1 | null;
export function recordProjectionChange(store: ControlStore, groupIds: readonly string[]): number;
```

Lookup existing command identity before reading dynamic defaults. Increment authority and presentation sequences exactly as spec §3.2 states. Keep old `applyCommand` behavior available to completed foundation callers while routing new Web commands through the new ledger.

- [ ] **Step 5: Verify GREEN, old command regressions, and typecheck**

Run: `rtk npm test -- tests/control/commandLedger.test.ts tests/control/projectionJournal.test.ts tests/control/commands.test.ts tests/control/store.test.ts && rtk npm run typecheck`

Expected: all tests pass and legacy command behavior remains green.

- [ ] **Step 6: Commit Task 2**

```bash
rtk git add src/control/commandLedger.ts src/control/projectionJournal.ts src/control/migrations.ts src/control/store.ts src/control/commands.ts src/control/queries.ts tests/control/commandLedger.test.ts tests/control/projectionJournal.test.ts tests/control/commands.test.ts tests/control/store.test.ts
rtk git commit -m "feat(control): persist web command lifecycle"
```

---

### Task 3: Trusted allowlists, profile routing, and admission gate

**Files:**
- Create: `src/control/profiles.ts`
- Create: `src/control/admissionGate.ts`
- Create: `src/panel/controlConfig.ts`
- Create: `tests/control/profiles.test.ts`
- Create: `tests/control/admissionGate.test.ts`
- Create: `tests/panel/controlConfig.test.ts`
- Modify: `src/control/executionPort.ts`
- Modify: `src/control/service.ts`

**Interfaces:**
- Consumes: Task 1 profile snapshot/hash schemas and existing `ExecutionPort` primitives.
- Produces: `ExecutionProfileRouter`, capability intersection/probe results, allowlisted repo/plan/profile resolution, and a shared admission gate/barrier used by claims, mutations, and shutdown.

- [ ] **Step 1: Write failing profile and gate tests**

```ts
it("changes profileHash when any resolved execution byte changes", () => {
  const a = resolveProfile(fixture({ adapterImplementationHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
  const b = resolveProfile(fixture({ adapterImplementationHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
  expect(a.profileHash).not.toBe(b.profileHash);
});

it("makes a claim either visible before shutdown or inadmissible after it", async () => {
  const release = gate.enter();
  const drain = gate.beginDrain();
  release();
  await drain.beforeWriterTransaction;
  expect(() => gate.enter()).toThrowError("panel-draining");
});
```

Cover capability order/intersection, proof descriptor equality, unknown context window, context tokenizer/output limits, stable-ID path resolution, symlink/path escape rejection, and no browser-supplied executable/path.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `rtk npm test -- tests/control/profiles.test.ts tests/control/admissionGate.test.ts tests/panel/controlConfig.test.ts`

Expected: FAIL because router/gate/config modules are absent.

- [ ] **Step 3: Implement trusted configuration and router**

```ts
export interface ExecutionProfileRouter {
  resolve(workKind: WebWorkKind, profileId: string, expectedHash: string): FrozenProfile;
  probe(profile: FrozenProfile): Promise<ObservedProfile>;
}
export interface AdmissionGate {
  enter(): () => void;
  beginDrain(): { beforeWriterTransaction: Promise<void> };
  readonly draining: boolean;
}
```

Hash the complete closed resolved profile; expose only safe display fields. Capability failure always degrades to unavailable. Keep `ControlService` execution primitives, and introduce profile-selected calls without embedding HTTP semantics in it.

- [ ] **Step 4: Verify GREEN and foundation port regressions**

Run: `rtk npm test -- tests/control/profiles.test.ts tests/control/admissionGate.test.ts tests/panel/controlConfig.test.ts tests/control/ccloopPort.test.ts tests/control/dispatch.test.ts && rtk npm run typecheck`

Expected: all pass.

- [ ] **Step 5: Commit Task 3**

```bash
rtk git add src/control/profiles.ts src/control/admissionGate.ts src/panel/controlConfig.ts src/control/executionPort.ts src/control/service.ts tests/control/profiles.test.ts tests/control/admissionGate.test.ts tests/panel/controlConfig.test.ts
rtk git commit -m "feat(control): route trusted execution profiles"
```

---

### Task 4: Immutable plan import and archival

**Files:**
- Create: `src/control/planImport.ts`
- Create: `src/control/executionSnapshot.ts`
- Create: `tests/control/planImport.test.ts`
- Create: `tests/control/executionSnapshot.test.ts`
- Modify: `src/scheduler/planFile.ts`
- Modify: `src/control/queries.ts`
- Modify: `src/control/snapshot.ts`

**Interfaces:**
- Consumes: Tasks 1–3 canonical records, command ledger, allowlists, profiles, and existing plan/contract validation.
- Produces: `normalizeControlPlan()`, `importControlPlan()`, content-addressed plan/original-contract records, default proposal version 1, and execution-snapshot/derived-contract builders used by Task 6.

- [ ] **Step 1: Write failing atomic import/hash tests**

```ts
it("keeps imported authority unchanged after the source plan is edited", () => {
  const imported = importControlPlan(h.deps, importCommand("g"));
  writeFileSync(h.planPath, differentPlanBytes);
  expect(readArchivedPlan(h.store, "g").planHash).toBe(imported.planHash);
  expect(readArchivedPlan(h.store, "g").canonicalJson).toBe(originalCanonicalJson);
});
```

Cover complete-or-absent transaction, plan/task sort order, duplicate IDs/dependencies, original contract hashes, non-allowlisted IDs, missing/hash-mismatched recovery records, response loss, and changed server estimator default replay.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `rtk npm test -- tests/control/planImport.test.ts tests/control/executionSnapshot.test.ts tests/control/snapshot.test.ts tests/scheduler/planFile.test.ts`

Expected: FAIL on missing import APIs.

- [ ] **Step 3: Implement immutable import**

```ts
export function normalizeControlPlan(source: AllowlistedPlanSource): ControlPlanV1;
export function importControlPlan(deps: ImportDeps, command: ImportCommand): CommandSuccessV1;
export function buildExecutionSnapshot(input: ConfirmedProposal): ExecutionSnapshotV1;
```

Import group, graph, task contracts, defaults, plan provenance, content-addressed records, and initial estimate work item/terminal preflight state in one transaction. Never retain a mutable source path as execution authority.

- [ ] **Step 4: Add crash-before/after-commit assertions**

Use the existing crash-worker pattern to prove an interrupted import is absent or fully replayable, and a damaged canonical record blocks recovery without inventing state.

- [ ] **Step 5: Verify GREEN and commit**

Run: `rtk npm test -- tests/control/planImport.test.ts tests/control/executionSnapshot.test.ts tests/control/snapshot.test.ts tests/scheduler/planFile.test.ts && rtk npm run typecheck`

```bash
rtk git add src/control/planImport.ts src/control/executionSnapshot.ts src/scheduler/planFile.ts src/control/queries.ts src/control/snapshot.ts tests/control/planImport.test.ts tests/control/executionSnapshot.test.ts
rtk git commit -m "feat(control): import immutable web plans"
```

---

### Task 5: Canonical read models and invalidation API

**Files:**
- Create: `src/panel/controlViews.ts`
- Create: `src/panel/controlApi.ts`
- Create: `src/panel/controlErrors.ts`
- Create: `tests/panel/controlReadApi.test.ts`
- Modify: `src/panel/api.ts`
- Modify: `tests/panel/security.test.ts`
- Modify: `tests/panel/webParity.test.ts`
- Create: `web/src/controlTypes.ts`

**Interfaces:**
- Consumes: Tasks 1–4 read records, profiles, versions, and existing Panel token middleware.
- Produces: authenticated `config`, `summary`, `groups`, full-group, command lookup, recovery, and evidence endpoints plus server/Web shape parity.

- [ ] **Step 1: Write failing real-HTTP read tests**

```ts
it("returns a complete reset after an epoch mismatch or retained-journal gap", async () => {
  const body = await authedGet<ControlSummaryV1>(panel, "/api/control/summary?sinceChangeSeq=0");
  expect(body).toMatchObject({ schema: "orca-control-summary-v1", resetRequired: true });
  expect(body.groups).toEqual([...body.groups].sort((a, b) => a.groupId.localeCompare(b.groupId)));
});
```

Cover canonical query spelling, malformed/negative/overflow `sinceChangeSeq`, full vs incremental summary, confirmed profile/snapshot reload, estimate output display, paused stop state, evidence manifest, exact typed errors, auth, and forged immediate-kill 404.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `rtk npm test -- tests/panel/controlReadApi.test.ts tests/panel/security.test.ts tests/panel/webParity.test.ts`

Expected: FAIL because routes/views/types are absent.

- [ ] **Step 3: Implement closed views and read routes**

Register `/api/control/*` behind the existing token/Host protections. Build DTOs only from canonical store state, sort every set as specified, expose hashes/references rather than executable paths, and map errors through the V1 envelope without altering existing decision/review APIs.

- [ ] **Step 4: Verify GREEN, parity, and typecheck**

Run: `rtk npm test -- tests/panel/controlReadApi.test.ts tests/panel/security.test.ts tests/panel/webParity.test.ts && rtk npm run typecheck && rtk npm --workspace web run check`

Expected: all pass.

- [ ] **Step 5: Commit Task 5**

```bash
rtk git add src/panel/controlViews.ts src/panel/controlApi.ts src/panel/controlErrors.ts src/panel/api.ts web/src/controlTypes.ts tests/panel/controlReadApi.test.ts tests/panel/security.test.ts tests/panel/webParity.test.ts
rtk git commit -m "feat(panel): expose canonical control reads"
```

---

### Task 6: Draft defaults, estimator, proposal editing, and confirmation

**Files:**
- Create: `src/control/estimator.ts`
- Create: `src/control/webService.ts`
- Create: `tests/control/estimator.test.ts`
- Create: `tests/control/proposal.test.ts`
- Create: `tests/control/confirmation.test.ts`
- Modify: `src/control/executionSnapshot.ts`
- Modify: `src/panel/controlApi.ts`
- Modify: `src/control/budget.ts`
- Modify: `src/control/schedulerBridge.ts`

**Interfaces:**
- Consumes: Tasks 1–5 command/profile/import/read foundations.
- Produces: proposal edit, re-estimate, confirm, set-limit commands; exact estimator request/contract/output records; immutable derived contracts and execution snapshot used by dispatch.

- [ ] **Step 1: Write failing arithmetic/preflight/provenance tests**

```ts
it("builds the five-task complex-1m ledger exactly", () => {
  expect(complex1mDefaults(5)).toEqual({
    base: { tokens: 17750000, activeMs: 85500000, attempts: 17, sessions: 17 },
    reserve: { tokens: 3550000, activeMs: 17100000, attempts: 4, sessions: 4 },
    limit: { tokens: 21300000, activeMs: 102600000, attempts: 21, sessions: 21 },
  });
});
```

Cover safe-integer aggregate overflow, duplicate edit target, no-op, dirty-field protection, model estimate never mutating authority, exact input formula, input-too-large no-call, capability degradation after request freeze, invalid whole output, estimate response replay, and reserve transfer/refund.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `rtk npm test -- tests/control/estimator.test.ts tests/control/proposal.test.ts tests/control/confirmation.test.ts`

Expected: FAIL on missing estimator/Web service operations.

- [ ] **Step 3: Implement estimator and proposal commands**

```ts
export function complex1mDefaults(taskCount: number): DefaultLedger;
export function buildBudgetEstimateRequest(input: EstimateInput): FrozenEstimateRequest;
export class WebControlService {
  editProposal(command: ProposalEditCommand): CommandSuccessV1;
  createEstimate(command: ReestimateCommand): CommandSuccessV1;
  confirm(command: ConfirmCommand): CommandSuccessV1;
  setLimit(command: SetLimitCommand): CommandSuccessV1;
}
```

Freeze effective estimator capabilities at creation, create deterministic wakes only for eligible calls, and validate complete output atomically. Confirmation writes all grants, per-field provenance, profiles, context policy, derived contracts, and `ExecutionSnapshotV1` in one transaction.

- [ ] **Step 4: Prove derived policy cannot exceed grant**

Add literal contract fixtures for exact mapping of tokens, active time, attempts, session outer bound, per-attempt timeout, recovery window, mechanical/model-assisted handoff eligibility, and `execution-policy-unrepresentable` rollback.

- [ ] **Step 5: Wire mutation routes and verify replay statuses**

Implement import/estimate/proposal/confirm/set-limit routes with the exact 200/201/202 statuses and `CommandSuccessV1`; lookup must return the persisted original status/value.

- [ ] **Step 6: Verify GREEN and commit**

Run: `rtk npm test -- tests/control/estimator.test.ts tests/control/proposal.test.ts tests/control/confirmation.test.ts tests/panel/controlReadApi.test.ts tests/control/budget.test.ts tests/control/schedulerBridge.test.ts && rtk npm run typecheck`

```bash
rtk git add src/control/estimator.ts src/control/webService.ts src/control/executionSnapshot.ts src/control/budget.ts src/control/schedulerBridge.ts src/panel/controlApi.ts tests/control/estimator.test.ts tests/control/proposal.test.ts tests/control/confirmation.test.ts
rtk git commit -m "feat(control): confirm accounted web proposals"
```

---

### Task 7: Durable start, proof recovery, and context-watermark control

**Files:**
- Create: `src/control/webDispatch.ts`
- Create: `src/control/contextControl.ts`
- Create: `tests/control/webDispatch.test.ts`
- Create: `tests/control/contextControl.test.ts`
- Modify: `src/control/dispatch.ts`
- Modify: `src/control/recovery.ts`
- Modify: `src/control/service.ts`
- Modify: `src/panel/controlApi.ts`

**Interfaces:**
- Consumes: confirmed execution snapshots from Task 6, Task 3 probes/gate, existing accept/inspect/recovery primitives.
- Produces: durable start/resume wakes, claim identities, phase-attempt proof records, no-start re-arm wakes, context observations, local/global blockers, and run/group recovery retry.

- [ ] **Step 1: Write failing start/proof truth-table tests**

```ts
it("does not call the provider when strict proof is invalid and no-start is proved", async () => {
  const result = await h.claimWith({ proof: invalidProof, providerInvoked: false });
  expect(result.run.state).toBe("failed-before-provider");
  expect(h.peer.providerCalls).toBe(0);
  expect(result.wakeId).toMatch(/^scheduler-wake:g:no-start:/);
});
```

Cover start precedence, profile disappearance between wake and claim, first/later attempt accounting, lost proof acknowledgement accepted/no-start branches, contradictory evidence, exact self-test challenge, unrelated blockers retaining wake, strict vs soft, estimator start-unknown, and no duplicate claims.

- [ ] **Step 2: Write failing context tests**

Cover exact input/output fit, tokenizer binding, sequence duplicate/gap/divergence, stale generation, workerSessionOrdinal 1, occupancy decrease, first crossing, pre-attempt suppression, phase-end advisory only, one latch, and context/stop join handoff identity.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `rtk npm test -- tests/control/webDispatch.test.ts tests/control/contextControl.test.ts tests/control/dispatch.test.ts tests/control/recovery.test.ts`

Expected: FAIL on missing Web dispatch/context behavior.

- [ ] **Step 4: Implement durable start and proof state machine**

```ts
export function scheduleStart(deps: WebDispatchDeps, command: StartCommand): CommandSuccessV1;
export function beginProviderAttempt(deps: AttemptDeps, runId: string, phase: Phase): AttemptEnvelope;
export function recoverAttempt(deps: RecoveryDeps, tuple: AttemptTuple): RecoveryOutcome;
```

Probe before command and again before claim; persist wake/run/envelope before delivery; reserve attempts per invocation and one session per run/phase; apply the spec evidence precedence without inference.

- [ ] **Step 5: Implement context observations before work attempts**

```ts
export function acceptContextObservation(store: ControlStore, observation: ContextObservationV1): ContextAction;
```

On realtime crossing or gap, suppress the imminent work attempt and create/join exactly one handoff request. Phase-end accepts one terminal observation and emits only advisory state.

- [ ] **Step 6: Verify GREEN and commit**

Run: `rtk npm test -- tests/control/webDispatch.test.ts tests/control/contextControl.test.ts tests/control/dispatch.test.ts tests/control/recovery.test.ts tests/control/usage.test.ts && rtk npm run typecheck`

```bash
rtk git add src/control/webDispatch.ts src/control/contextControl.ts src/control/dispatch.ts src/control/recovery.ts src/control/service.ts src/panel/controlApi.ts tests/control/webDispatch.test.ts tests/control/contextControl.test.ts
rtk git commit -m "feat(control): dispatch recoverable web runs"
```

---

### Task 8: Pause, handoff-stop, shutdown, continuation, and recovery commands

**Files:**
- Create: `src/control/stopIntent.ts`
- Create: `src/panel/controlLifecycle.ts`
- Create: `tests/control/stopIntent.test.ts`
- Create: `tests/control/webContinuation.test.ts`
- Create: `tests/panel/controlLifecycle.test.ts`
- Modify: `src/control/handoff.ts`
- Modify: `src/control/continuation.ts`
- Modify: `src/control/resumeBundle.ts`
- Modify: `src/control/recovery.ts`
- Modify: `src/panel/server.ts`
- Modify: `src/panel/controlApi.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 6, and 7 transaction/gate/wake/run primitives.
- Produces: pause/resume, atomic handoff-stop, one-open-request joins, model-assisted handoff phases, batch/direct continuation, global shutdown result, and startup recovery-before-listen.

- [ ] **Step 1: Write failing stop composition and atomicity tests**

```ts
it("commits a handoff latch only with the complete frozen set and request-or-join identities", () => {
  fault.beforeCommit();
  expect(() => service.handoffStop(command)).toThrow();
  expect(readStop(store, "g")).toBeNull();
  fault.clear();
  const result = service.handoffStop(command);
  expect(readStop(store, "g")?.frozenRunIds).toEqual(result.result.frozenRunIds);
});
```

Cover pause/handoff/shutdown strength matrix, existing context request join, earlier deadline, starting/unknown runs in frozen set, independent wall/active clocks, model-assisted probe/proof/retry, expired deadline, estimator disposition, and outbox loss.

- [ ] **Step 2: Write failing continuation tests**

Cover batch all-or-nothing validation, empty frozen set, held unselected task, direct continue, pendingRunId registration timing, claim ordinal increment after no-start, lineage once, inherited remaining grant, soft overrun, dependency readiness, and wake replay.

- [ ] **Step 3: Write failing shutdown lifecycle tests**

Cover gate/writer barrier race, global closed command/result, cross-group single transaction, pause strengthening, stronger/equal intent preservation, inconsistent frozen-set blocker, crash before/after commit, draining 503, and recovery-before-listen.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `rtk npm test -- tests/control/stopIntent.test.ts tests/control/webContinuation.test.ts tests/panel/controlLifecycle.test.ts tests/control/handoffTransaction.test.ts tests/control/continuation.test.ts`

Expected: FAIL on missing stop/lifecycle APIs.

- [ ] **Step 5: Implement stop, continuation, and lifecycle orchestration**

```ts
export function applyHandoffStop(deps: StopDeps, command: HandoffStopCommand): CommandSuccessV1;
export function resumeFromHandoff(deps: ContinuationDeps, command: ResumeFromHandoffCommand): CommandSuccessV1;
export async function beginPanelShutdown(runtime: ControlRuntime): Promise<CommandSuccessV1>;
```

Keep stop intent, frozen set, requests/joins, outboxes, and result in one transaction. Shutdown closes admission first, waits admitted operations, commits one global command, then delivers until the frozen deadline.

- [ ] **Step 6: Wire mutation routes and verify GREEN**

Run: `rtk npm test -- tests/control/stopIntent.test.ts tests/control/webContinuation.test.ts tests/panel/controlLifecycle.test.ts tests/control/handoffTransaction.test.ts tests/control/continuation.test.ts tests/control/resumeBundle.test.ts tests/control/recovery.test.ts && rtk npm run typecheck`

Expected: all pass.

- [ ] **Step 7: Commit Task 8**

```bash
rtk git add src/control/stopIntent.ts src/panel/controlLifecycle.ts src/control/handoff.ts src/control/continuation.ts src/control/resumeBundle.ts src/control/recovery.ts src/panel/server.ts src/panel/controlApi.ts tests/control/stopIntent.test.ts tests/control/webContinuation.test.ts tests/panel/controlLifecycle.test.ts
rtk git commit -m "feat(control): orchestrate recoverable web stops"
```

---

### Task 9: Thin Web control client and recoverable browser state

**Files:**
- Create: `web/src/controlApi.ts`
- Create: `web/src/controlState.ts`
- Create: `web/src/ControlPanel.tsx`
- Create: `web/src/BudgetEditor.tsx`
- Create: `web/src/ControlGroupView.tsx`
- Create: `web/src/RecoveryView.tsx`
- Create: `web/tests/controlState.test.ts`
- Create: `web/tests/controlPanel.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/types.ts`

**Interfaces:**
- Consumes: Tasks 5–8 HTTP DTOs/routes.
- Produces: canonical cache reducer, two-second summary polling, uncertain-command sessionStorage recovery, budget editor, start/pause/handoff/resume/recovery UI, and explicit soft/unknown states.

- [ ] **Step 1: Write failing state-machine tests**

```ts
it("drops canonical caches on epoch change but keeps unsaved drafts and uncertain command ids", () => {
  const next = reduceControlState(populatedState, { type: "summary", value: summary({ epoch: "new" }) });
  expect(next.groups).toEqual({});
  expect(next.drafts).toEqual(populatedState.drafts);
  expect(next.uncertainCommandIds).toEqual(populatedState.uncertainCommandIds);
});
```

Cover resetRequired, sequence gap, projection refetch, complete-summary deletion, two-tab revision conflict, lost POST response lookup, command-id retention/removal, and no local execution authority.

- [ ] **Step 2: Write failing component tests**

Render literal DTO fixtures and assert accessible controls/text for complex-1m defaults, provenance, model advice, soft mode, unavailable context, pause vs handoff, partial/unknown recovery, batch continuation, typed errors, and absence of immediate-kill.

- [ ] **Step 3: Run Web tests and verify RED**

Run: `rtk npm --workspace web run check`

Expected: FAIL because control modules/components are absent.

- [ ] **Step 4: Implement API wrappers and canonical state**

```ts
export async function sendControlCommand<T>(path: string, envelope: CommandEnvelopeV1): Promise<T>;
export async function recoverUncertainCommand(groupId: string, commandId: string): Promise<CommandLookupV1>;
export function reduceControlState(state: ControlClientState, event: ControlClientEvent): ControlClientState;
```

Use the injected token, persist only uncertain IDs in sessionStorage, retain unsaved form drafts across cache reset, and refetch according to epoch/changeSeq/projectionSeq rules.

- [ ] **Step 5: Implement the thin UI**

Add the Control panel alongside the existing decisions/chains UI without regressing either. All button handlers call API wrappers; no component computes authority, inferred reserve, or success from local state. Show model/profile IDs, limits, mode, deadlines, blockers, evidence links, and typed recovery outcomes.

- [ ] **Step 6: Verify Web GREEN and root parity**

Run: `rtk npm --workspace web run check && rtk npm run build --workspace web && rtk npm test -- tests/panel/webParity.test.ts tests/panel/staticFiles.test.ts`

Expected: Web typecheck/tests/build pass and old panel static behavior remains green.

- [ ] **Step 7: Commit Task 9**

```bash
rtk git add web/src/controlApi.ts web/src/controlState.ts web/src/ControlPanel.tsx web/src/BudgetEditor.tsx web/src/ControlGroupView.tsx web/src/RecoveryView.tsx web/src/App.tsx web/src/api.ts web/src/types.ts web/tests/controlState.test.ts web/tests/controlPanel.test.tsx tests/panel/webParity.test.ts
rtk git commit -m "feat(web): add recoverable task control"
```

---

### Task 10: End-to-end acceptance, fault evidence, and non-live consumer smoke

**Files:**
- Create: `tests/panel/controlApi.test.ts`
- Create: `tests/panel/controlRecoveryApi.test.ts`
- Create: `tests/control/webFaults.test.ts`
- Create: `tests/control/webMutations.test.ts`
- Create: `tests/control/webCcloopSmoke.test.ts`
- Create: `.superpowers/sdd/2026-09-19-web-recoverable-control/acceptance-map.md`
- Create: `.superpowers/sdd/2026-09-19-web-recoverable-control/final-report.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete Tasks 1–9 product surface.
- Produces: named verification scripts, spec §9 acceptance map, unfiltered logs/artifacts, final evidence report, and regression proof without a live model.

- [ ] **Step 1: Write failing real-Panel acceptance tests**

Start a Panel on an ephemeral port with temporary stateDir, allowlisted temp repository/plan, deterministic profiles/ExecutionPort, and real token auth. Drive import → estimate/default edit → confirm → soft start → pause/resume → handoff → reload → continuation. Assert exact HTTP schemas and durable SQLite state after each boundary.

- [ ] **Step 2: Add lost-response, restart, and concurrent-tab tests**

Abort client responses after commit, restart Panel for a new epoch, query command results, induce changeSeq gaps, and issue two same-revision commands. Assert one durable effect, one replay/conflict, and canonical reload.

- [ ] **Step 3: Add focused fault and mutation tests**

Implement executable fixtures for these fault seams: import commit before response, estimate request commit before wake delivery, estimate output validation before acceptance, confirmation snapshot and derived-contract atomic commit, start wake commit before delivery, proof accepted/no-start/unknown recovery, context-observation gap and duplicate handling, handoff stop/request/outbox atomic commit, continuation registration before wake delivery, global shutdown cross-group commit, and startup recovery before listen. Add direct mutation guards that independently kill inverted command-replay identity, stale-revision precedence, safe-integer overflow rejection, strict-vs-soft proof gating, unknown evidence reserve retention, context-latch idempotency, stop-strength ordering, continuation all-or-nothing validation, epoch/change-sequence reset, and immediate-kill route absence. Restore each deliberate mutation before committing and record its red/green command in the evidence report.

- [ ] **Step 4: Add a real ccloop control smoke without an external model**

Use `/tmp/ccloop-codex-0919/dist/cli.js` and deterministic fixture execution to prove the frozen dispatch envelope, durable handoff, evidence read, and continuation path. Assert Codex remains soft/phase-end and strict start is rejected.

- [ ] **Step 5: Add scripts and run the new acceptance boundary**

```json
{
  "verify:web-control": "vitest run tests/control/web*.test.ts tests/panel/control*.test.ts",
  "verify:web-control:consumer": "vitest run tests/control/webCcloopSmoke.test.ts"
}
```

Run: `rtk npm run verify:web-control && rtk env ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js npm run verify:web-control:consumer && rtk npm --workspace web run check`

Expected: all new unit/API/browser/fault/mutation/smoke tests pass.

- [ ] **Step 6: Run full regression and build**

Run: `rtk env ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js npm test && rtk npm run typecheck && rtk npm run build --workspace web && rtk npm run verify:control && rtk npm run verify:panel`

Expected: root suite has zero failures; existing three explicitly skipped live integration tests remain the only skips; typecheck/build/control/panel verification exit 0.

- [ ] **Step 7: Write evidence map and final report**

Record exact commands, exit codes, pass/test counts, artifact hashes, redacted API fixtures, fault outcomes, mutation guards, and the explicit statement that no live model call occurred. Link existing D3 evidence without modifying it.

- [ ] **Step 8: Commit Task 10**

```bash
rtk git add tests/panel/controlApi.test.ts tests/panel/controlRecoveryApi.test.ts tests/control/webFaults.test.ts tests/control/webMutations.test.ts tests/control/webCcloopSmoke.test.ts package.json .superpowers/sdd/2026-09-19-web-recoverable-control/acceptance-map.md .superpowers/sdd/2026-09-19-web-recoverable-control/final-report.md
rtk git commit -m "test(control): verify web recoverable control"
```

---

## Final completion checklist

- [ ] Every Task 1–10 completion line and review verdict is present in this plan's SDD ledger.
- [ ] Final whole-branch review checks the spec, this plan, parked/minor findings, and the full diff.
- [ ] One final fix wave and scoped re-review is completed if the whole-branch review reports findings.
- [ ] Fresh full verification is run after the final reviewed code, not reused from an earlier task.
- [ ] Orca, ccloop, and ccmem `docs/handoff/handoff.md` are updated with current state and topic/branch/tree/evidence identifiers, not a hard-coded current HEAD.
- [ ] ccloop and ccmem update their single rolling Orca section rather than appending another unbounded Orca history section.
- [ ] The final user report includes all ledger `Ruling:` lines, verification evidence, remaining human gates, and a separate Orca handoff executive summary of at most 10 lines.
