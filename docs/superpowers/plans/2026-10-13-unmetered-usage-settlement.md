# Unmetered Usage Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Session `7f37d261`, 2026-10-13, written on branch `codex/unmetered-settlement` at `docs(spec): unmeter only the work token dimension`.

**Goal:** An owner can release the unknown usage of a run whose work token remainder is unlimited, without booking a work token number, so the failed task can be retried; and the Web shows the way forward where it is hidden today.

**Architecture:** `settle-unknown-usage` gains acknowledgement `release-unmetered`. It reuses the `remaining-grant` path for every finite dimension and writes a marker with method `owner-acknowledged-unmetered` whose `charged.work.tokens` is `null`. `hasValidUsageSettlement` accepts that shape. The group view exposes a derived `usageIncomplete` count. The Web picks the acknowledgement from a new server preview field.

**Tech Stack:** TypeScript, zod, node:sqlite control store, vitest, React + i18next (web workspace).

**Spec:** `docs/superpowers/specs/2026-10-13-unmetered-usage-settlement-design.md`

## Global Constraints

- `charge-remaining-grant` with `remaining.work.tokens === null` stays refused `run-usage-not-settleable:unlimited-remainder`.
- `release-unmetered` with a finite work token remainder is refused `run-usage-not-settleable:finite-remainder`.
- Only `charged.work.tokens` is `null`; every other dimension of both buckets is charged exactly as `remaining-grant` charges it.
- Never book infinity, null-as-zero or a guessed amount: no work token usage-ledger row, `group.used.tokens` grows by the handoff charge only.
- `run.remaining.work.tokens` stays `null`; `run.cumulative.work.tokens` stays the observed baseline.
- A persisted `remaining-grant` marker parses to exactly its own bytes (old stores).
- Web never renders the unmetered work tokens as `0`; zh and en full text asserted.
- Every new branch gets a named mutation that deletes it and is seen red (mutations only in a `git clone --local` copy).
- Commit messages English; the rewrite of `tests/control/tokenPolicyStop.test.ts` "holds an unknown nullable stop and refuses remaining-grant settlement" is named in its commit message.

## Review Focus

1. A released-unmetered run then re-reported by a late provider usage event: `recordUsage` must still throw `run-usage-settled` (same guard as today) — pinned in Task 1.
2. An old `remaining-grant` marker on a run whose grant has a null dimension must still be invalid (the unmetered allowance is only for the new method) — pinned in Task 1.
3. The unmetered marker with a non-null `charged.work.tokens`, or with `remaining.work.tokens` rewritten to 0, must be invalid — pinned in Task 1.
4. Retry after release under `optional-v1` (the only policy that produces a null remainder) must succeed and the retried run must inherit observed tokens only — pinned in Task 2.
5. Activity row and command receipt with `charged.work.tokens: null` must render "not metered", not drop the work bucket silently — pinned in Task 4.

## Interpretations recorded (not in spec text)

- Results (`web/src/GroupResults.tsx`, `TaskResults.tsx`) show no usage totals today (grep of `usage|ledger` there: 0 hits), so §A.4's "Results" has nothing to flag; the flag goes on the group budget view only.
- §A.4 "the retried task shows the same flag": the retried task belongs to the same group, so the group flag covers it; the released run's receipt stays in the task's activity.
- The preview's choice of acknowledgement is a server field (`acknowledge`), not derived in the browser (`UsageSettlement.tsx` comment: never recompute authority in the browser).

---

### Task 1: Marker schema, admission and validity

**Files:**
- Modify: `src/control/usageSettlement.ts` (schema union, `hasValidUsageSettlement`)
- Modify: `src/control/settleUnknownUsage.ts` (admission by acknowledgement, effect)
- Modify: `src/control/webProtocol.ts:681` (payload enum), `:1586` (result union), `:1278` (preview `acknowledge`)
- Modify: `src/panel/controlViews.ts` `settlementPreview`
- Test: `tests/control/settleUnknownUsageUnmetered.test.ts` (new)

**Interfaces — Produces:**
- `type SettleAcknowledge = "charge-remaining-grant" | "release-unmetered"` exported from `settleUnknownUsage.ts`.
- `settlementAdmission(store, run, context?, acknowledge?: SettleAcknowledge)`; default derives from the remainder (`null` ⇒ `release-unmetered`) so the preview asks the question it will offer.
- Preview field `acknowledge: SettleAcknowledge`.
- Marker / receipt: `{ method: "owner-acknowledged-unmetered", charged: { work: { tokens: null, activeMs, attempts, sessions }, handoff: Amount }, ... }`.

- [ ] Step 1: Write failing tests in the new file using `driverHarness([{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1",killGraceMs:0,behaviour:()=>"stoppable-usage-unknown"})` + `handoffStop` (the shape of `tokenPolicyStop.test.ts`), settling through `withCommandContext(..., {client:"web",principal:"user:owner"})`:
  1. preview `{allowed:true, refusalReason:null, acknowledge:"release-unmetered"}`;
  2. `charge-remaining-grant` ⇒ error code `run-usage-not-settleable`, message containing `unlimited-remainder` (literal);
  3. `release-unmetered` succeeds; result `method:"owner-acknowledged-unmetered"`, `charged.work.tokens === null`, other dimensions equal the pre-settlement `remaining` literals read before the command; `group.used.tokens` grew by exactly `charged.handoff.tokens`; no `usage_ledger` row with `source='run-work'` added by the settlement; `run.remaining.work.tokens === null`; `run.cumulative.work.tokens` unchanged; `unknown` both false; `hasValidUsageSettlement` true; late `recordUsage` throws `run-usage-settled`;
  4. finite case using `unknownFailure()` (finite grant): `release-unmetered` ⇒ `finite-remainder`;
  5. validity negatives: a copy of the settled run with `usageSettlement.charged.work.tokens = 1` ⇒ false; with `remaining.work.tokens = 0` ⇒ false; with method swapped to `remaining-grant` ⇒ false;
  6. old marker: the marker produced by an existing `charge-remaining-grant` settlement parses through `usageSettlementSchema` to a value `toEqual` the stored one.
- [ ] Step 2: Run `node_modules/.bin/vitest run tests/control/settleUnknownUsageUnmetered.test.ts > $S/t1-red.log 2>&1`; read the log; expected red on the new behaviour (not on load errors).
- [ ] Step 3: Implement.
  - `usageSettlement.ts`: split the object into `remainingGrantMarker` and `unmeteredMarker` (same fields; method literal and `charged.work.tokens: z.null()`); `usageSettlementSchema = z.union([...]).superRefine(<same disposition rule>)`. In `hasValidUsageSettlement`'s dimension loop: when `m.method === "owner-acknowledged-unmetered" && b === "work" && d === "tokens"` require `run.grant.work.tokens === null && run.remaining.work.tokens === null && m.charged.work.tokens === null && run.cumulative.work.tokens === baseline.work.tokens` and `continue`; otherwise keep the existing check unchanged.
  - `settleUnknownUsage.ts`: replace line 29 with `const ack = acknowledge ?? (run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant"); if (run.remaining.work.tokens === null && ack !== "release-unmetered") throw ...("unlimited-remainder"); if (run.remaining.work.tokens !== null && ack === "release-unmetered") throw ...("finite-remainder");`. Both `settlementAdmission` calls in `applySettleUnknownUsage` pass `command.payload.acknowledge`. In the effect: `unmetered = command.payload.acknowledge === "release-unmetered"`; `charged.work = unmetered ? { ...budget dims of remaining.work, tokens: null } : amountSchema.parse(...)`; `delta = add({ ...charged.work, tokens: charged.work.tokens ?? 0 }, charged.handoff)`; per bucket: `cumulative` adds `tokens ?? 0`, `remaining` zeroes except work tokens stay `null` when unmetered, `bookSettledUsage` skipped when `charged[b].tokens === null`; marker method `unmetered ? "owner-acknowledged-unmetered" : "remaining-grant"`.
  - `webProtocol.ts`: payload `acknowledge: z.enum(["charge-remaining-grant","release-unmetered"])`; result `usage-settled` becomes a union of the existing object and one with `method: z.literal("owner-acknowledged-unmetered")` and `work: amountSchema.extend({ tokens: z.null() })`; preview adds `acknowledge`.
  - `controlViews.ts` `settlementPreview`: return `acknowledge: run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant"`.
- [ ] Step 4: Run the new file and `tests/control/settleUnknownUsage.test.ts tests/control/driverSettle.test.ts tests/control/handoffFailedRetry.test.ts` (redirect, read back); all green.
- [ ] Step 5: `npm run typecheck > $S/tc.log 2>&1`; commit `feat(control): release an unlimited run's unknown usage unmetered`.

### Task 2: Retry after release; rewrite the old criterion

**Files:**
- Modify: `tests/control/tokenPolicyStop.test.ts:25-35`
- Modify (only if Step 2 shows a refusal): `src/control/retryTask.ts`, `src/control/fundedAllowance.ts`, `src/control/retryGrant.ts`

- [ ] Step 1: Rewrite "holds an unknown nullable stop and refuses remaining-grant settlement" into "holds an unknown nullable stop, refuses remaining-grant settlement and releases it unmetered": keep its existing assertions up to `usageUnknown`/`committedRemaining`; preview now `{allowed:true, acknowledge:"release-unmetered"}`; `charge-remaining-grant` refused `unlimited-remainder`; `release-unmetered` succeeds; `retryTask` returns no error; after one `driver.round()` + `deliverScheduledStart`, the new run has `grant.work.tokens === null` and `tokenPolicy.inheritedUsage.tokens === 10` (the observed cumulative, literal). Keep the spend-cap assertion. Comment: "This criterion now encodes the 2026-10-13 ruling (spec 2026-10-13-unmetered-usage-settlement-design.md §A.1)".
- [ ] Step 2: Run it (redirect, read). If retry refuses, read the refusal code and fix only the guard it names, adding the unmetered exception the same way as Task 1.
- [ ] Step 3: Commit `test(control): release, not refuse, an unlimited run's unknown usage` with the body naming the rewritten criterion and why.

### Task 3: Group view `usageIncomplete`

**Files:**
- Modify: `src/panel/controlViews.ts:1024`, `src/control/webProtocol.ts:1119`, `web/src/controlTypes.ts:166`
- Test: extend `tests/control/settleUnknownUsageUnmetered.test.ts`

- [ ] Step 1: Test: after release, `readControlGroup(...).ledger` has `usageIncomplete: true, unmeteredRuns: 1`; after a `remaining-grant` settlement (`unknownFailure()` + `settle`) it has `usageIncomplete: false, unmeteredRuns: 0`. Run, see red.
- [ ] Step 2: Implement: count runs of the group whose body `usageSettlement.method === "owner-acknowledged-unmetered"` (the read snapshot's run list already in scope at that line; read it first); add both fields to the ledger object and its strict schema and the web type.
- [ ] Step 3: Run green; commit `feat(panel): flag a group whose usage has unmetered runs`.

### Task 4: Web — release acknowledgement, receipt, activity, flag

**Files:**
- Modify: `web/src/UsageSettlement.tsx`, `web/src/TaskDetail.tsx:116-126`, `web/src/BudgetEditor.tsx:515`, `web/src/controlTypes.ts:224-228,487`, `web/src/locales/{en,zh}.ts`
- Test: `web/tests/settleUnknownUsage.test.tsx` (extend), plus the TaskDetail activity test that covers `activityCharge` (find with grep before editing)

Copy (new keys under `control.settlement`):
- en `releaseOpen` "Release unknown usage unmetered"; `releaseWarning` "This run has no work token limit, so nothing can be charged for its unknown work tokens. Releasing records no work token number; the group's token totals become a lower bound. Every other limit is charged from the remaining grant. It cannot be undone and does not restart the task."; `releaseConfirm` "Confirm irreversible release"; `methodUnmetered` "released unmetered by owner"; `notMetered` "not metered"; `incomplete` "Usage incomplete: {{count}} run(s) released unmetered".
- zh `releaseOpen` "不计量放行未知用量"; `releaseWarning` "此运行的工作 token 不设上限，未知的工作 token 无法按额度记入。放行不记入任何工作 token 数，组的 token 总数因此只是下限。其他各项上限照剩余额度记入。放行不能撤销，也不会重新运行任务。"; `releaseConfirm` "确认不可撤销的放行"; `methodUnmetered` "owner 不计量放行"; `notMetered` "不计量"; `incomplete` "用量不完整：{{count}} 个运行被不计量放行".

- [ ] Step 1: Tests (zh and en full text): preview with `acknowledge:"release-unmetered"` shows `releaseOpen`, the confirmation shows `releaseWarning`, confirming sends `acknowledge:"release-unmetered"`; preview with `charge-remaining-grant` still sends that; settled unmetered marker renders receipt with `methodUnmetered` and the work tokens cell is `notMetered` (not `0`, not empty); activity row for `method:"owner-acknowledged-unmetered"` renders the work bucket with `notMetered`; BudgetEditor shows `incomplete` with count when `unmeteredRuns > 0`. Run, see red.
- [ ] Step 2: Implement: `ChargeTable` renders `t("control.settlement.notMetered")` for a `null` cell; `UsageSettlement` chooses open/warning/confirm/method keys and payload from `preview.acknowledge` / `marker.method`; `activityText` accepts both methods and a `null` tokens field; types updated.
- [ ] Step 3: `npm run build --workspace web` and the web tests (redirect, read); commit `feat(web): offer and show an unmetered usage release`.

### Task 5: Part B — the way forward is visible

**Files:** `web/src/TaskDetail.tsx:266`, `web/src/locales/zh.ts:1135`, `web/src/GroupActionsMenu.tsx`, its parent that supplies `onOpen` (grep), tests next to the existing ones for each.

- [ ] Step 1 (B1): Read how TaskDetail renders `retryRunOpen`; when `run.unknownUsageSettlement && !run.unknownUsageSettlement.settlement` and retry is hidden, render a note "Usage must be settled before retry." / "需先结清用量才能重试。" with a button that focuses the problem region (use the existing region navigation TaskDetail already has; read before writing). Test zh+en full text and the navigation call.
- [ ] Step 2 (B2): zh `stop-mode-conflict` becomes "组当前的停止方式不允许这条命令。先解除停止（「恢复调度」，或交接后提供的恢复），再重试。" (mirrors en). Grep tests asserting the old zh text first and update only those. Test: settlement preview refused `stop-mode-conflict` renders the full text in zh and en.
- [ ] Step 3 (B3): When the card refusal code is `archive-run-active`, `GroupActionsMenu` renders a button "Open dispatch controls" / "打开调度控制" that calls a new prop `onOpenDispatch()`; the parent wires it to the existing open-group navigation with `region: "dispatch"`. Test zh+en and the region passed.
- [ ] Step 4: Run web tests; commit `feat(web): show the way forward for a failed task with unknown usage`.

### Task 6: Mutations and gate

- [ ] Step 1: `git clone --local` the branch to `/private/tmp/orca-unm-mut`, link `node_modules`, build web; green baseline of the touched test files.
- [ ] Step 2: For each branch below apply a deleting mutation, record `shasum -a 256` before/after, run the owning test file, confirm red, restore with `cat`, confirm `git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0:
  M1 finite-remainder refusal; M2 unlimited-remainder refusal kept for charge; M3 `bookSettledUsage` skip for null; M4 `tokens ?? 0` in delta replaced by `remaining.work.tokens`-style booking; M5 remaining work tokens kept null; M6 validity special case accepts non-null charged; M7 validity special case not limited to new method; M8 preview `acknowledge`; M9 `usageIncomplete` count; M10 Web notMetered cell; M11 Web payload ack; M12 activity null branch; M13 B1 note; M14 B2 zh text; M15 B3 button.
- [ ] Step 3: Full gate in background with `ORCA_CCLOOP_BIN` = a built `clone --local` of ccloop at the pinned commit: typecheck, build, web build, root vitest, `verify:control`, `verify:panel`, `--ws check`; each redirected and read back; reds checked against `docs/handoff/known-load-flakes.md`, each red file rerun alone 3× with load recorded.
- [ ] Step 4: One fresh whole-branch reviewer; address findings; update `docs/handoff/handoff.md` §3.3/§4; commit.
