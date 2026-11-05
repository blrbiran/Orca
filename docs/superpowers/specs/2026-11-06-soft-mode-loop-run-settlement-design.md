# Soft mode for loop runs: who settles an approximate floor, and how ccloop's saved-result recovery reads it

Session 3cfc2e73 (Orca dev, 2026-11-06). Design only; nothing implemented. Revision 2 after an independent review
(session 3cfc2e73, findings 1–13 in the scratchpad file `review-spec-softloop.md`; resolutions in §5). Written on Orca
main `e783beee` and ccloop main `f3ea202`. Orca pins ccloop `963b856f` (`package.json:41`), an ancestor of `f3ea202`.
`/usr/bin/git diff --stat 963b856f f3ea202 -- src/control/savedResultRecovery.ts src/control/usageLowerBound.ts
src/control/usage.ts` printed nothing (rc 0). Every `file:line` below was read at those commits. Anything not read or
not run is marked **[unverified]**.

Parent: `2026-11-03-soft-mode-approximate-usage-design.md` (§2 rule, §3 D1–D6, §5 criteria 1, 2, 6, §7 "Not done: loop
runs"). This spec is the "design it with ccloop first" that the parent's §7 asks for.

## 0. Human rulings that bear on this (verbatim; the human has NOT ruled on this design)

- Soft mode itself (parent spec header, session `43913afc`): 「同意。我们之前的很多裁定在新的语义下可能有一些过期了，一些需要、可以修改。」
- Soft D1–D6 and the other open items of session `43913afc` (Orca `docs/handoff/handoff.md:83`, recorded at the start of
  session `af2ceee1`): soft D1–D6 「允许没有下界也继续。新版本之前的不改没关系。」. The remaining items, which include
  "loop run 跨仓": 「其他都同意」. The handoff summarises the reply at `handoff.md:647` as "soft D1–D6 同意、D4 不做；…loop run 跨仓「其他都同意」".
- ⚠️ **The handoff contradicts itself on D4 (Rule 7, surfaced, not resolved here).** `handoff.md:458` lists as next
  work "再实施 spec §5 判据 1、2、6 与 D4（已停住的调用按新规则放行）". `handoff.md:647` records the human's reply as
  "D4 不做". The verbatim words (`:83`) say that leaving the old runs unchanged is *acceptable*. They do not forbid
  changing them. This spec defaults to the recorded reply (§3.6) and asks the human in Q1.
- Cross-repo rollout precedent (Orca `handoff.md:645`, one of the rulings of session `af2ceee1`): 「不加 features 键、靠 ccloop 严格契约拒绝」.
- Socket settlement (spec `2026-10-29-socket-usage-settlement-design.md`, line 5): 「要你定做不做：让 orca task settle-usage
  能走 CLI，需要给命令台账加一列记 person token 的账号，这是 schema 变更。 => 同意」.
- Lineage (human ruling 2026-10-13, session `7f37d261`, quoted in the doc comment of `lineageWorkUsage`,
  `src/control/usageSettlement.ts:127-131`): a task lineage inherits only provider-observed usage, never the conservative
  charge of an unmetered release.

## 1. The problem, from the person's side

A person chose "no token limit" for a group (`group.limit.tokens === null`). A task's ccloop run ends without the tool
reporting its usage (killed process, timeout, stalled stream). In such a group, single calls now continue on their own
(parent §7). A loop run does not:

1. The run settles with `unknown.work` or `unknown.handoff` true. `groupUsageUnknown` (`src/control/budget.ts:94-101`)
   turns the group's `ledger.usageUnknown` on, and the claim path refuses every further claim:
   `src/control/webDispatch.ts:191` (`recovery-blocked`) and `:288-289` (`{ kind: "blocked", reason: "usage-unknown" }`).
   **The whole group stops**, not just the task. This affects every agent kind.
2. The only way out is `settle-unknown-usage`, which only a person can send. `applySettleUnknownUsage` throws
   `control-verb-human-only` unless `settlingPersonFor` names a `user:` account (`src/control/settleUnknownUsage.ts:102-103`,
   `src/control/commandClient.ts:73-78`). When the task's work grant is unlimited, the only acknowledgement admitted is
   `release-unmetered` (`settleUnknownUsage.ts:22`), which books **nothing** for work tokens (`:85-86`). When the task
   has a finite authored budget, the person must charge the whole remainder (`charge-remaining-grant`).

**Who gains what (restated after review finding 4).**

- *All agent kinds* gain the main thing: the group keeps running with no person in between.
- *A non-zero floor* exists only for omp runs. omp is the only writer of `usage-lower-bound.json` in ccloop's `src`
  (`src/runtime/omp/ompAdapter.ts:136`, `:188`; `grep -rn usage-lower-bound.json src`). Codex and claude loop runs always
  have `floorTokens: null` and book 0.
- *Saved-result recovery* exists only for codex (ccloop `src/control/savedResultRecovery.ts:242`:
  `config.kind!=="codex"` ⇒ `saved-result-provider-original-evidence-unsupported`). Every run whose recoverability
  depends on this design is therefore a codex run with floor null and charge 0.

### 1.1 What exists today (evidence)

**Orca: the marker and its validators.**

- The marker schema `usageSettlementSchema` (`src/control/usageSettlement.ts:14-27`) has two methods, `remaining-grant`
  and `owner-acknowledged-unmetered`. Its shared fields include `commandId: idSchema` and
  `principal: z.string().regex(/^user:.+/)` (`:15`), and `reservationDisposition` `committed | released | recovered`
  (`:18`).
- Its only writer is `applySettleUnknownUsage` (`settleUnknownUsage.ts:127-131`).
- The validator `hasValidUsageSettlement` (`usageSettlement.ts:142-184`) works in this order:
  - it rebuilds the baseline from `usage_events` and requires at least one null event (`:149-154`);
  - it checks the charge against the grant (`:155-163`);
  - it checks the stop proof (`:164-165`);
  - it checks **the command ledger row**: verb `settle-unknown-usage`, a Web row matched by `principal`, a socket row by
    `person_principal` (`:166-168`), and the row's receipt (`:169-171`).
- Readers of that validator:
  - `hasObservedUsage` (`budget.ts:166-173`), called by `releaseRunReserve` (`budget.ts:178`), by `commitCandidate`'s
    settled check (`src/control/checkpoints.ts:87`), by the handoff (`src/control/driverHandoff.ts:393`) and by the
    scheduler bridge (`src/control/schedulerBridge.ts:100`);
  - the group read model, which blocks **the whole group view** on an invalid marker
    (`src/panel/controlViews.ts:1074`, also `:1199`; `src/control/stopIntent.ts:232`);
  - retry: `src/control/retryTask.ts:122-124` (a released run needs a valid `released` marker), `:163`, and
    `src/control/retryGrant.ts:47`;
  - Orca's side of saved-result recovery: `src/control/savedResultRecovery.ts:78-84` and `src/control/executionDriver.ts:1644`.
- `lineageWorkUsage` (`usageSettlement.ts:132-139`) subtracts the charge for `owner-acknowledged-unmetered` and for
  `recovered`.
- The single-call soft path is in `src/control/approximateUsage.ts`. `approximateUsageApplies` is at `:20-24` and
  `bookApproximateFloorInTransaction` at `:27-52`. The booking:
  - books `max(floor - cumulative, 0)` (`:36`), which is right there because a single call's floor is that call's own
    total (`:34-35`);
  - always subtracts `min(tokens, held)` from the group's `reserved` (`:41`);
  - writes activity with `taskId: null` and `principal: "orca-auto"` (`:50-51`);
  - writes **no** `usageSettlement` marker.
- The loop floor is kept on the run as `usageLowerBound` (`executionDriver.ts:790-791`) and shown in the run view
  (`src/panel/controlViews.ts:1147-1148`).
- Where a loop run with unknown usage stops:
  - **failed:** blocks at C (`executionDriver.ts:824-835`); this is `settlementAdmission`'s `committed` case
    (`settleUnknownUsage.ts:64-67`);
  - **stopped by a handoff:** `released` (`:68-72`) or `recovered` (`:48-63`);
  - **token allowance:** blocks at C as `usage-unknown` (`executionDriver.ts:1611`);
  - **succeeded:** blocks at E as `settle-incomplete` (`:1246-1247`), which admission refuses
    (`settleUnknownUsage.ts:39-41`). **[Unverified whether ccloop can produce a succeeded run with a null event.]**

**Orca: the saved-result receipt.** `savedRecoveryAccounting` (`src/control/savedResultRecovery.ts:90-94`) persists two
artifacts: the marker, and `settlementReceipt` (`:86-89`), which is a copy of the command row read by
`usageSettlement.commandId` (`:87`).

**Orca: code acting under `orca-auto` through the command ledger.**

- `src/control/orchestration.ts:18` declares `ORCHESTRATION_ACTOR = "orca-auto"`, and `:281` sends commands with a
  deterministic id (`orca-auto-start-…`).
- The failover retry's doc comment (`src/control/systemDebug.ts:373-374`): "its row (applied or refused) is the record".
- Scheduled fires use `by: "orca-auto"` (`src/panel/controlAssembly.ts:478`).
- `VERB_ACCESS` has a `panel` class for verbs that no route sends (`src/panel/humanOnly.ts:9`, `:25`, `:73`).
  `settle-unknown-usage` is `human-only` on the Web (`:24`) and `token` on the socket (`:225`).

**ccloop: saved-result recovery** (`validateAccounting`, `src/control/savedResultRecovery.ts:180-209`, shared by the
source path `:287` and the predecessor path `:367`):

- The marker schema accepts only `remaining-grant`, with a `user:` principal and disposition `committed | released`
  (`:172-175`).
- The receipt schema (`:176-178`) is verb `settle-unknown-usage` with method `remaining-grant`.
- With a null ledger event:
  - both artifacts are required, else `saved-result-usage-unsettled` (`:198`, checked **before** the parse at `:199`);
  - the principals must match per `client` (`:201`);
  - each charge must equal `max(ceiling - baseline, 0)`, and a null ceiling fails (`:204-207`).
- A parse error is reported as `saved-result-evidence-invalid` (`:303`).
- History: Orca session `b999cc81` added the `personPrincipal` branch (ccloop `docs/handoff/handoff.md:65-69`;
  `tests/control/socketSettlementReceipt.test.ts`, 4 cases). This design is registered as pending at `handoff.md:210`.

**ccloop: the floor and the ledger.**

- `observedUsageLowerBound` (`src/control/usageLowerBound.ts:5-25`) sums `usage-lower-bound.json` over **only the calls
  that ended without a usage report**.
- The worker adds a phase's tokens to `cumulativeTokens` only when `tokenUsage !== null`
  (`src/control/worker.ts:295-302`). Under protocol 4 it writes `threadTotalTokens: null` for every phase after the first
  unreported one (`:308`).
- So the baseline B (the last non-null cumulative) and the floor F count **disjoint** calls. Calls reported after the
  first unknown one are counted in neither, so `B + F` can only under-count.

### 1.2 A finding that changes the shape of the problem

From reading the code: ccloop already refuses saved-result recovery of every unknown-usage run whose work grant is
unlimited, whatever the person did. `owner-acknowledged-unmetered` fails to parse (`:172`), and every marker fails the
null-ceiling check (`:206`). Orca's test of this path (`tests/control/savedResultUnmeteredLineage.test.ts`) uses a
synthetic port. **[Unverified by a paired run: `savedResultRecovery.paired.test.ts` skips unless
`ORCA_SAVED_RESULT_VERIFY=1`, line 6.]**

So the runs that can be saved-result-recovered after a person's settlement today are codex runs with a **finite** task
grant inside the unlimited group.

## 2. Options for the automatic principal

All four options share the parent's §2 booking (floor booked as work usage, `usageApproximate`, flags cleared, activity
row). They differ in what proves the booking to the readers listed in §1.1.

### (a) New marker method `approximate-floor`, principal `orca-auto`, no command row

- **Orca:** a third union branch, `method: "approximate-floor"`, `principal: z.literal("orca-auto")`, no `commandId`,
  plus `floorTokens` and `reason`.
  - `hasValidUsageSettlement` gets a branch that checks the marker against `run.usageApproximate` and the baseline
    instead of a row.
  - `savedRecoveryAccounting` sends `receipt: null`.
- **ccloop:** `approximate-floor` is accepted only with `receipt === null` and principal `orca-auto`.
- **Rule 12 cost:** nothing records a refused or skipped automatic attempt. That needs a new run field.
- **Idempotency:** rests on the `run-usage-settled` guard alone.
- **Rule 11 cost:** code acting on its own normally leaves a row (`orchestration.ts:281`, `systemDebug.ts:373-374`). (a)
  does not.

### (b) Book under the group owner, on their behalf

- This needs a person row that no person sent. No group-owner field was found by `grep` of `queries.ts`, `types.ts`,
  `store.ts` **[unverified elsewhere]**.
- Neither person method can carry a floor: `remaining-grant` must charge the whole remainder, and
  `owner-acknowledged-unmetered` books nothing.
- It breaks Rule 13 attribution, and the b999cc81 rule "the agent principal alone never backs a person's settlement".
  **Rejected.**

### (c) No marker; recovery refuses approximate runs

- **ccloop:** unchanged. It already refuses with `saved-result-usage-unsettled` (`:198`).
- **Orca:** about five readers that treat "no marker + null event" as unsettled (`checkpoints.ts:87`, `budget.ts:178`,
  `driverHandoff.ts:393`, `schedulerBridge.ts:100`, `retryTask.ts:124`) need a parallel acceptance. That is a marker by
  another name, with no schema.
- **Loss:** finite-grant codex runs lose the recovery they have today (if Q2 = follow the group).

### (d) A `panel`-class command row under `orca-auto`, which the marker points at

- **Orca, new verb.** `settle-approximate-usage`, of class `panel` in `VERB_ACCESS`, so no route can send it. It is
  added to the strict raw and effective command unions in the same way as `settle-unknown-usage`
  (`src/control/webProtocol.ts:1204`, `:1303`). The pass applies it through the ledger (`applyWebCommand`), with the
  deterministic id `orca-auto-approximate-<runId>-<generation>`.
- **Marker.** It keeps `commandId`. It gets method `approximate-floor`, `principal: z.literal("orca-auto")`,
  `floorTokens` and `reason`.
- **Validator.** The row check (`:166-171`) gains one branch. For `approximate-floor` the row must have
  `verb === "settle-approximate-usage"` and `principal === "orca-auto"`, and its receipt must match as today. The person
  methods must keep verb `settle-unknown-usage` and a `user:` principal, so neither verb can back the other's method.
- **ccloop.** The receipt stays **required for every method**, which keeps one rule. The receipt schema becomes a union:
  - the existing person receipt (unchanged);
  - `{ principal: "orca-auto", client, verb: "settle-approximate-usage", commandId, result.method: "approximate-floor" }`,
    where the marker principal must equal `receipt.principal`.
- **Rule 12.** A refused application is the ledger's refused row, as with failover, so the record is free.
- **Idempotency.** It comes from the ledger: replaying the same id returns the same outcome.
- **Rule 11.** It matches `orca-auto` start, failover and schedules.
- **Cost.**
  - A new verb in the Web protocol unions, the panel-class entry, and the generated CLI or verb documentation, if any
    lists every verb **[unverified]**.
  - One more row per settled run.
  - The row's `client` value for an in-panel command is whatever the orchestration rows record **[unverified; read in
    the plan]**.

### 2.1 Comparison

| | Orca marker | Orca readers changed | ccloop change | finite-grant codex run keeps recovery (if Q2 = group) | unlimited-grant codex run becomes recoverable (new) | refusal recorded | person invariant |
|---|---|---|---|---|---|---|---|
| (a) | +1 branch, no `commandId` | validator, lineage, `savedRecoveryAccounting` | marker + "null receipt for this method only" | yes | yes | needs a new run field | narrowed, explicit |
| (b) | unchanged (wrong arithmetic) | none | none | yes, falsely | no | no | broken |
| (c) | none | ~5 readers widened | none | no | no | needs a new run field | intact |
| (d) | +1 branch, keeps `commandId` | validator row branch, lineage, new panel verb | marker + one receipt branch, receipt always required | yes | yes | yes (refused row) | narrowed, explicit, every marker backed by a row |

## 3. Recommendation: (d), ccloop first for recovery only

### 3.1 Why (d) over (a)

1. **A row is how this codebase already records code acting on its own** (`orchestration.ts:18`, `:281`;
   `systemDebug.ts:373-374`; `controlAssembly.ts:478`). (a) would be the only automatic act with no row (Rule 11).
2. **Rule 12 and idempotency come with the row.** A refused application is booked and visible. A replay returns the
   same outcome. (a) needs a new `run.approximateRefusal` field and its view to reach the same result.
3. **The ccloop rule stays uniform:** "a marker is backed by a receipt", with no "except when null" branch. The new rule
   is narrow: the `orca-auto` principal plus the new verb, accepted only for `approximate-floor`.
4. **The invariant is narrowed explicitly, not broken.** "A *charge or release* is a person's act; an approximate floor
   is Orca's act, and its row says so." A person row and an `orca-auto` row cannot be swapped: the verbs differ and the
   principals differ, and both repos check both.

Against (d): a new protocol verb and one row per settlement, versus (a)'s smaller schema surface. Q3 asks the human to
choose. Both are reversible before the first release.

What (d) or (a) adds over (c), stated conditionally (finding 4):

- If Q2 = "follow the group", finite-grant codex runs keep saved-result recovery.
- In either case, unlimited-grant codex runs become recoverable. That is refused today, so it is a new capability; Q6
  asks whether the human wants it.
- Every such recoverable run has `floorTokens: null` and charge 0.

### 3.2 Contract delta

**Orca, `src/control/usageSettlement.ts`:**

```ts
const personFields = { commandId: idSchema, principal: z.string().regex(/^user:.+/) };
export const usageSettlementSchema = z.union([
  z.object({ method: z.literal("remaining-grant"), charged: pair, ...personFields, ...markerFields }).strict(),
  z.object({ method: z.literal("owner-acknowledged-unmetered"), charged: unmeteredChargeSchema, ...personFields, ...markerFields }).strict(),
  z.object({ method: z.literal("approximate-floor"), commandId: idSchema, principal: z.literal("orca-auto"), charged: pair,
    floorTokens: safeInteger.nullable(), reason: z.string().min(1), ...markerFields }).strict(),
]).superRefine(/* unchanged */);   // markerFields = today's minus commandId and principal
```

- **Arithmetic (finding 1).** The floor and the baseline count disjoint calls (§1.1, `worker.ts:295-308`). So the
  booked amount is the floor itself:
  - `charged.work.tokens = floorTokens ?? 0`;
  - `cumulative.work.tokens = baseline.work.tokens + charged.work.tokens`;
  - every other charged dimension, and all of `charged.handoff`, is 0.

  It can only under-count, which preserves parent D3's premise. This differs from the single-call formula on purpose:
  there the floor is the call's own total.
- **`hasValidUsageSettlement`, `approximate-floor` branch.**
  - `run.usageApproximate` deep-equals `{ floorTokens, reason, at }`.
  - The charge and cumulative values follow the arithmetic above.
  - `run.remaining.work.tokens` equals the per-disposition value in §3.4.
  - The row is checked as in (d), and its receipt as today.
  - Identity, `highWater`, "at least one null event", no later event, the stop proof and `handoffResolution` are
    shared and unchanged.
  - **The validator never re-checks `approximateUsageApplies`.** A later `set-limit` to a finite value must not
    invalidate the marker.
- **`lineageWorkUsage`:** `approximate-floor` never subtracts, whether `recovered` or not. The floor is provider-observed.
- **`savedRecoveryAccounting`:** unchanged under (d). The row exists, and `settlementReceipt` copies it.
- **`settlementAdmission`:** unchanged. A person's later `settle-unknown-usage` is refused with `run-usage-settled`
  (`settleUnknownUsage.ts:37`), per parent D5.
- **Activity (finding 12):** `usage-settled` with `taskId: run.taskId`, body
  `{ method: "approximate-floor", floorTokens, reason, principal: "orca-auto", at }`.

**ccloop, `src/control/savedResultRecovery.ts`:**

- **Marker schema** (`:172-175`): a union of the existing object (unchanged) and the `approximate-floor` object.
  `principal: z.literal("orca-auto")`, `commandId` kept, `reservationDisposition` `committed | released` as today (Q5).
- **Receipt schema** (`:176-178`): a union with the `orca-auto` receipt from §2 (d).
  - The `:201` comparison becomes: for `approximate-floor`, `marker.principal === receipt.principal` and
    `receipt.verb === "settle-approximate-usage"`; for `remaining-grant`, unchanged.
  - Any cross-combination fails with `saved-result-settlement-invalid`.
- **Charge rule** (`:204-207`) for `approximate-floor`:
  - `charged.work.tokens === (floorTokens ?? 0)`;
  - `a.work.tokens === baseline.work.tokens + charged.work.tokens`;
  - every other dimension is charged 0 and equals the baseline;
  - the ceiling is not consulted, so it may be null.
- **Errata (finding 10, ccloop Rule 16).** Append a named ERRATUM, pointing here, to every sentence found by
  `grep -rn -i 'never booked\|never.*to book\|never charged' src` in ccloop. At `f3ea202` these are:
  - `usageLowerBound.ts:7` ("never an exact figure to book");
  - `collect.ts:57` ("For display, never booked.");
  - `ompAdapter.ts:193` ("never booked as usage").

  Record the scan command and its commit in the ccloop ledger. Orca's `usageSettlement.ts:31` ("never charged (D3)") is
  the single-call schema doc, which is still true for finite groups. It gets a one-line pointer here, not an erratum.
- ccloop does not re-derive the floor (the saved package may not carry the per-call files **[unverified]**). It checks
  the arithmetic; Orca vouches for the number, as it vouches for the baseline.

**Order, repin, and backward compatibility (finding 7).**

- The marker and the row are **Orca-internal**. Only the recovery admission reaches ccloop. So Orca may ship the pass
  without waiting for ccloop.
  - Until the repin, ccloop's strict contract refuses recovery of such runs (the precedent 「不加 features 键、靠 ccloop
    严格契约拒绝」).
  - Under (d) the receipt is present, so the old ccloop fails at the marker parse (`:199`) and reports
    `saved-result-evidence-invalid` (`:303`).
  - Under (a) the receipt is null, so it fails earlier at `:198` with `saved-result-usage-unsettled`.
  - Orca shows ccloop's reason unchanged. Both outcomes are safe.
- **Order:**
  1. ccloop change and criteria C1–C8. Merge `--ff-only`; the human pushes.
  2. Orca repins ccloop.
  3. Orca implements the pass, the marker and the views.

  Steps 1 and 3 may run in parallel. The only effect of skipping the repin is that finite-grant codex runs in unlimited
  groups lose saved-result recovery in the meantime, whichever repo lands first.

### 3.3 The pass (code, Rule 5)

One function, `bookApproximateLoopRun(store, runId, at)`, issues the `settle-approximate-usage` panel command for one
run. The command's apply does:

1. **Scope.**
   - `approximateUsageApplies(store, run)` (the group's limit is null and the run is not a flow call).
   - `run.phase === "work"` and `run.taskId !== null`.
   - **`run.mode === undefined && run.recoveryOf === undefined`** (finding 5). Saved-result verification and recovery
     runs keep the person's path in this change. ccloop `settleSavedResult.ts:76` writes a null event for every
     interrupted verification. Such a run would then reach ccloop as a predecessor through the same
     `validateAccounting` (`:367`). Including recovery runs is Q7.
2. **Admission.** `disposition = settlementAdmission(store, run)`, the same guards a person passes.
3. **Evidence,** as `applySettleUnknownUsage` gathers it (`:106-112`), and the same "evidence changed" recheck inside
   the transaction (`:117-122`).
4. **Booking** per disposition, as in §3.4. Then the marker and the shared disposition tail of `:136-155`, extracted
   into one function rather than copied (Rule 7).
5. **Activity**, as in §3.2.

**When the pass is refused (finding 6, Rule 12).**

- *Transient codes* — `stop-mode-conflict`, `run-usage-not-settleable:handoff-request-open`, `run-usage-pending`: these
  are states already visible on the run and group. The pass does not issue the command while a preflight admission
  throws one of them, and retries on a later round.
- *Any other code* — e.g. `run-stop-proof-required`, `group-reserve-insufficient`, `run-usage-not-settleable:released-handoff`:
  the command is issued once and its **refused row** is the record. The run diagnosis shows "Orca could not settle the
  usage automatically: <code>". The person's `settle-unknown-usage` stays available as today. The deterministic id
  makes this once per (run, generation).

**Where it runs.** In the driver round, over runs of unlimited groups with unknown usage, before claims **[the exact
hook is left to the plan]**. Not covered (Q4): the token-allowance `usage-unknown` block (`executionDriver.ts:1611`)
and the succeeded-at-E shape.

### 3.4 Per disposition: reserved, remaining, allocations, task grant (finding 2)

Today's person path charges the whole remainder (remaining → 0), and its reservation choice is at `:135`. The
approximate path charges `F = floorTokens ?? 0` work tokens only. The other dimensions of `remaining` are untouched,
which keeps the read model's `remaining == max(grant - cumulative, 0)` (`budget.ts:182-184`).

| Disposition | Person path today | Approximate path |
|---|---|---|
| `committed` (failed, blocked at C, active) | `reserved -= charged` (releaseReserved true); remaining 0 | `used += F`; `reserved -= min(F, held)` (`approximateUsage.ts:41` semantics); `remaining.work.tokens = grant null ? null : max(grant - cumulative, 0)`; run stays blocked at C; the rest of the reservation follows a known-usage failed run's path (retry or terminalise) |
| `released` (handoff-stopped, allocations already `terminal`) | `used += charged`; reserved unchanged (releaseReserved false); state `settled-failed` | `used += F`; **reserved unchanged** (the stop already gave it back; applying `:41` here would release it twice); remaining recomputed; state `settled-failed`, `recoverable: false`; `retryTask.ts:122-124` admits it through the valid `released` marker |
| `recovered`, optional-v1 | `reserved -= charged`; task `held`, `fundingReleased: true`; allocations `held` (amounts unchanged) | `used += F`; `reserved -= min(F, held)`; remaining recomputed; task `held`, `fundingReleased: true`; allocations `held` **with amounts set to the post-booking `run.remaining`**, and `work.grant = run.remaining`, so `retryTask.ts:120-121` holds **[unverified how the person path satisfies :120-121 after zeroing remaining; the plan reads it before choosing]** |
| `recovered`, finite-legacy | charge consumes the remainder; the continuation is funded by `parked` = the pre-charge remainder (`:134`, `:150-153`), shortfall `2 × parked` (`:56-59`) | `parked` = the post-booking remainder (pre-charge minus F in tokens); `reserveCommitment(parked)`; the admission's `2 × parked` shortfall check stays (stricter than needed, kept so admission is shared) **[unverified whether a finite-legacy group can have `limit.tokens === null`; if not, this row is unreachable and is so stated in the plan]** |

### 3.5 Views (finding 11)

- `web/src/controlTypes.ts:385` (`UsageSettlementV1`) gains the method.
- `web/src/UsageSettlement.tsx:33-35` today renders every non-unmetered marker as "method … principal". It needs a third
  wording: "booked at least N by Orca (usage not reported)". It reuses `usageApproximate` and `usageApproximateNone`
  (`web/src/locales/en.ts:540-541`, `zh.ts:414-415`).
- `web/src/TaskDetail.tsx:107-108` renders only the two person methods; add the third.
- `web/src/controlTypes.ts:695` is the **command result** union (`result:` at `:692`). Under (d) it gains the result of
  `settle-approximate-usage`; under (a) it does not change.
- The runs-table badge (`web/src/ControlGroupView.tsx:765`) and `approximateRuns` (`src/panel/controlViews.ts:1299`)
  already key on `usageApproximate`.
- The refusal of a person's `settle-unknown-usage` on such a run should say "settled approximately by Orca", not
  "already conservatively settled" (`en.ts:2327`, `zh.ts:2237`).

### 3.6 D4: runs blocked before the release (finding 8; no recommendation)

- **Default: the recorded reply ("D4 不做").** It is implemented as a cutoff:
  - at the first start of the new version the panel writes a `softLoopSince` timestamp once;
  - the pass skips runs whose `endedAt` precedes it, and runs with no `endedAt` (written before schema 9,
    `src/panel/controlViews.ts:229-231`).
- The single-call path already follows "D4 不做" (parent §7, line 66). With the cutoff, both kinds of run follow one rule.
- Switching D4 on means removing the cutoff for loop runs. For single calls it would need its own pass over runs blocked
  at C by their purpose's `usage-unknown` reason. Q1 asks for one answer covering both.

### 3.7 Criteria (each a command that exits 0/non-0; each seen red on its named mutation; mutations only in a `git clone --local` copy)

Orca (`npx vitest run <file>`; daily runs use `npm test`, Rule 18):

| # | File / case | Asserts | Mutation that must turn it red |
|---|---|---|---|
| O1 | `tests/control/softModeLoopRunSettlement.test.ts` "failed omp-shaped run, floor F" | marker `approximate-floor`/`orca-auto`; row verb `settle-approximate-usage`; `usageApproximate.floorTokens === F`; `ledger.usageUnknown === false`; next task claimed with no person command | `approximateUsageApplies` false for task runs; separately, delete the pass call |
| O2 | same, "no floor" | booked 0, `floorTokens: null`, run view `usageApproximate: { floorTokens: null }` | write `floorTokens: 0` |
| O3 | same, "finite group" | blocks and flags as today; `settleUnknownUsage.test.ts`, `settleUnknownUsageUnmetered.test.ts` unchanged and green | drop the `limit.tokens === null` check |
| O4 | `tests/control/approximateFloorMarker.test.ts` | validator true for a fresh marker; false for: floor tampered, `usageApproximate` absent, `principal: "user:x"`, row principal not `orca-auto`, row verb `settle-unknown-usage`, `charged.handoff.tokens` 1, and **a `remaining-grant` marker whose row is an `orca-auto` row** (only the approximate branch accepts that row) | skip each check in turn (seven reds) |
| O5 | same, "group view reads it" | `readControlGroup` not `blocked` | remove the validator branch |
| O6 | same, "lineage keeps the floor, recovered or not" | `lineageWorkUsage` equals cumulative | let `recovered` subtract for this method |
| O7 | same, "a person cannot settle it again" | `settle-unknown-usage` ⇒ `run-usage-settled` | delete `settleUnknownUsage.ts:37` |
| O8 | `softModeLoopRunSettlement.test.ts` "floor arithmetic" | baseline B, floor F ⇒ cumulative `B + F`, charged `F` | book `max(F - B, 0)` |
| O9 | same, "released disposition" | `group.reserved` unchanged, `used += F`, state `settled-failed`, `retry-task` admits | apply `approximateUsage.ts:41` unconditionally |
| O10 | same, "recovered optional-v1" | `reserved -= min(F, held)`; allocations `held` with amount = `run.remaining`; `retry-task` admits | leave allocation amounts unchanged |
| O11 | same, "recovered finite-legacy" (if reachable) | `parked` = post-booking remainder; continuation admitted | use the pre-charge remainder |
| O12 | same, "idempotent" | pass run twice ⇒ one marker, one row, one `usage-settled` activity, one usage-ledger row, `used` grows once | remove the `run-usage-settled` guard from the pass's admission |
| O13 | same, "race, person second" | person's evidence read via `afterEvidence` before the pass commits ⇒ person gets `run-usage-settled`, run unchanged | drop the in-transaction `evidence-changed` recheck |
| O14 | same, "race, person first" | person commits first ⇒ pass skips, no second activity, no row | issue the command without preflight admission |
| O15 | same, "set-limit afterwards" | `set-limit` to finite after settlement ⇒ marker still valid, view not blocked | add `approximateUsageApplies` to the validator |
| O16 | same, "permanent refusal is visible" | stop-proof artifact missing ⇒ refused row exists, run diagnosis names the code, group still `usageUnknown`, person path still offered | do not issue the command on a permanent code |
| O17 | same, "recovery runs out of scope" | an interrupted verify run with unknown usage is not settled by the pass | drop the `mode`/`recoveryOf` check |
| O18 | same, "D4 cutoff" (default) | a run ended before `softLoopSince` is left for a person; one after is settled | drop the cutoff |
| O19 | `tests/control/savedResultRecovery.paired.test.ts`, new case; `ORCA_SAVED_RESULT_VERIFY=1 npx vitest run tests/control/savedResultRecovery.paired.test.ts` | the real pinned ccloop declares an approximate codex run eligible | pin the old ccloop ⇒ `saved-result-evidence-invalid` |

ccloop (`npx vitest run tests/control/approximateFloorReceipt.test.ts`; Rule 15: added only):

| # | Case | Mutation |
|---|---|---|
| C1 | `approximate-floor` with an `orca-auto` receipt, null work ceiling ⇒ `eligible` | marker schema keeps `remaining-grant` only |
| C2 | same with marker `principal: "user:fixture"` ⇒ refused | `principal: z.string()` |
| C3 | `approximate-floor` with a person receipt (verb `settle-unknown-usage`) ⇒ `saved-result-settlement-invalid`; `remaining-grant` with an `orca-auto` receipt ⇒ same | compare principals without the verb |
| C4 | `charged.work.tokens` ≠ `floorTokens ?? 0`, or `a.work.tokens` ≠ baseline + charged ⇒ `saved-result-settlement-invalid` | skip the charge rule for the method |
| C5 | `approximate-floor` with `receipt: null` ⇒ `saved-result-usage-unsettled` | accept a null receipt for the method |
| C6 | `reservationDisposition: "released"` with `handoffResolution` ⇒ eligible; `released` without it ⇒ refused | drop the `:203` check for the method |
| C7 | an interrupted predecessor (`:367` path) with an `approximate-floor` marker ⇒ eligible (only if Q7 = include) | predecessor path keeps the person-only schema |
| C8 | `tests/control/socketSettlementReceipt.test.ts` 4/4 unchanged | (existing; must stay green, not edited) |

## 4. Open questions for the human

- **Q1 (D4, loop runs and single calls together).** The handoff records "D4 不做" (`:647`) and 「新版本之前的不改没关系。」 (`:83`).
  `:458` lists D4 as next work. The default here is the recorded reply: runs blocked before the release are left for a
  person, for loop runs and single calls alike. Keep that, or settle old runs automatically for both kinds?
- **Q2 (scope of the rule).** A task with an **authored** finite token budget inside an unlimited group: follow the group
  (approximate floor), or follow its budget (the person charges the remainder, as today)? Parent D2 settled this for
  requirement calls with the rationale 「The finite grant is a reservation size, not a limit the person set」 (parent
  spec line 32). An authored task budget *is* a limit a person set, so that rationale does not carry over. No
  recommendation.
- **Q3 ((d) or (a)).** (d): a panel-class `orca-auto` command row that the marker points at (recommended: precedent,
  refusals recorded, idempotency, one receipt rule in ccloop). (a): no row and a null receipt (smaller protocol surface,
  refusals need a new run field).
- **Q4 (not covered).** The token-allowance `usage-unknown` block, and a succeeded run blocked at E with unknown usage
  (no person path exists for this one either). Separate design, or fold in?
- **Q5 (ccloop `recovered`).** ccloop has never admitted `reservationDisposition: "recovered"`. Keep that, or widen it in
  the same ccloop change?
- **Q6 (new capability).** (d) and (a) make **unlimited-grant** codex runs saved-result recoverable once settled
  approximately, which ccloop refuses today even after a person's release. Is that wanted, or should ccloop accept
  `approximate-floor` only under a finite ceiling?
- **Q7 (recovery runs).** Saved-result verification and recovery runs are excluded from the pass (they keep the person's
  path). Include them, which adds ccloop C7 and Orca criteria for the predecessor path?
- **Q8 (principal string).** `orca-auto`, as orchestration, failover and schedules write it, or a namespaced
  `system:orca-auto`?

## 5. Review round 1 — resolutions (reviewer: independent subagent, session 3cfc2e73; findings in the scratchpad `review-spec-softloop.md`)

Each finding was checked against the code at the commits named above before it was applied.

1. **Critical, floor arithmetic: applied.** Verified `worker.ts:295-308` (tokens added only when known; protocol 4
   writes null after the first unreported phase) and `usageLowerBound.ts:5-8`. The two count disjoint calls. The spec
   now books the floor itself; O8 and C4 were rewritten; the old Q6 was removed. Also verified that floors are
   omp-only (`ompAdapter.ts:136`, `:188`).
2. **Important, per-disposition budget: applied.** §3.4 table. Verified `settleUnknownUsage.ts:134-135`, `:150-153`,
   `retryTask.ts:120-121` and `setAllocationStates` (`stopIntent.ts:1027-1050`: amounts change only when passed).
   Criteria O9–O11 added. One point is marked unverified: how the person path satisfies `:120-121`.
3. **Important, command-row option: applied, and now recommended.** Verified `orchestration.ts:18`, `:281`,
   `systemDebug.ts:373-374`, `controlAssembly.ts:478`, `humanOnly.ts:9`, `:25`, `:73`. Option (d) added and weighed in
   §2.1 and §3.1; Q3 added. The `agentSwitch.ts:21` citation was dropped: it is a type's doc comment, as the reviewer
   said.
4. **Important, who benefits: applied.** Verified ccloop `savedResultRecovery.ts:242` (codex only). Restated in §1 and
   §3.1. A column was added to §2.1. The "recommended" label was removed from Q2, which now quotes the D2 rationale.
   Q6 added.
5. **Important, recovery runs: applied.** Verified `settleSavedResult.ts:76` and the shared `validateAccounting` at
   `:367`. They are excluded explicitly in §3.3 step 1. Criterion O17 added; C7 is conditional on Q7.
6. **Important, silent skip: applied.** §3.3 now splits transient from permanent refusals; under (d) the refused row is
   the record. Criterion O16 added.
7. **Important, backward compatibility: applied, with one refinement.** Verified that `:198` precedes `:199`. The
   reviewer's `saved-result-usage-unsettled` is right for (a), where the receipt is null. Under the now-recommended (d),
   the receipt is present, so an older ccloop fails at the `:199` parse and reports `saved-result-evidence-invalid`
   (`:303`). Both are stated. The "Orca must wait for the repin" gate was removed and the 「不加 features 键…」 precedent is
   cited. O19's expectation follows (d).
8. **Important, D4: applied.** The default is the recorded reply, implemented as the cutoff. The `:458` versus `:647`
   conflict is quoted in §0. Q1 covers single calls. No recommendation is made.
9. **Important, missing criteria: applied.** Added O12 (idempotency), O13 and O14 (both race orders, using the existing
   `afterEvidence` hook at `settleUnknownUsage.ts:23`, `:113`), O15 (set-limit), the extra O4 case, C6 (released plus
   `handoffResolution`) and C5.
10. **Minor, errata scan: applied.** Verified `collect.ts:57` and `ompAdapter.ts:193`. The scan command and three hits
    are listed. Orca's `usageSettlement.ts:31` gets a pointer, not an erratum (still true for finite groups).
11. **Minor, view references: applied.** Verified `controlTypes.ts:692-695` (command result) and
    `UsageSettlement.tsx:33-35`. Paths are now full.
12. **Minor, activity `taskId`: applied.** It is `run.taskId`.
13. **Minor, open questions: applied.** Q6 (old) removed; (d) versus (a), the new capability, and recovery runs added.
    Q2 is no longer labelled.

No finding was rejected.
