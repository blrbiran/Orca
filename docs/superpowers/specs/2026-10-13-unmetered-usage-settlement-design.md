# Unmetered usage settlement and failed-task discoverability

Session `6b7843ec`, 2026-10-13. Source: external tester feedback `orca_archived_files/issue-20261008.md`, issues 46
and 47 (Codex 429 failures leave a task with no visible way forward). Part A changes a ruling of
`2026-10-11-token-policy-design.md`; the human chose this option explicitly (§A.1). Part B is Web discoverability only.

## A. Release an unlimited run's unknown usage without booking a number

### A.1 Problem and ruling change

A run whose work grant is unlimited (`remaining.work.tokens === null`) and whose provider died before reporting usage
(e.g. a Codex `codex-exit-error` after HTTP 429) keeps `unknown.work` set. `retry-task` refuses it
(`task-not-retryable usage-unknown`, `src/control/retryTask.ts`) and `settle-unknown-usage` refuses it
(`run-usage-not-settleable:unlimited-remainder`, `src/control/settleUnknownUsage.ts`). The task has no exit.

`2026-10-11-token-policy-design.md` (the paragraph beginning "Existing Claude/Codex adapters advertise soft
enforcement") ruled: "Unknown-usage `remaining-grant` settlement is illegal for a null remainder; keep blocked and require
existing finite evidence-backed/manual finite settlement. Never book infinity, null or zero guessed usage." The finite
manual settlement it points to was never built, which is why the block is a dead end.

**Correction (human, 2026-10-13, this session).** The human rejected an owner-entered finite amount ("asking the user to
type a number every time is practically impossible") and chose: *the owner may release the unknown usage of an
unlimited run without any number being booked*. This section supersedes that sentence for null work remainders only.
The other half of it still holds: the system never books infinity, null-as-zero or a guessed amount. The published spec
text is not edited.

Why this is acceptable: a null work remainder exists only when no finite binder (group ceiling or spend cap) funds the
run; under a finite cap the funded allowance is finite and the existing `remaining-grant` settlement applies. So the
released usage escapes no enforced limit. What it does lose is completeness of the usage record; §A.4 makes that loss
visible instead of silent.

### A.2 Command

`settle-unknown-usage` gains a second acknowledgement. Payload `acknowledge` becomes
`"charge-remaining-grant" | "release-unmetered"`:

- `charge-remaining-grant`: unchanged behaviour; still refused for a null work remainder with
  `run-usage-not-settleable:unlimited-remainder`.
- `release-unmetered`: accepted only when `remaining.work.tokens === null`; otherwise refused with
  `run-usage-not-settleable:finite-remainder` (a finite run must be charged, never released unmetered).

Every other admission rule of `settlementAdmission` applies unchanged to both (owner Web principal, not archived, not
already settled, current failed task, no open handoff request, no pending usage events, at least one unknown flag,
`committed`/`released` dispositions, `stop-mode-conflict`). The admission check for the null remainder moves from "always
refuse" to "refuse unless the acknowledgement is `release-unmetered`".

### A.3 Effect

Marker `usageSettlement` gains method `"owner-acknowledged-unmetered"` (the existing `remaining-grant` marker shape is
unchanged). Only the work **token** dimension is unlimited; every other dimension is finite and keeps the one existing
rule (charge the conservative remaining grant). So `charged.work.tokens` is `null` and everything else is an integer:

- **work tokens**: nothing booked. `run.cumulative.work.tokens` keeps exactly the observed usage; `group.used.tokens`,
  the usage ledger and per-model accounting receive no work token row. `run.remaining.work.tokens` stays `null`
  (unlimited stays unlimited).
- **work activeMs / attempts / sessions** and the whole **handoff** bucket: charged exactly as `remaining-grant`
  charges them today.
- Both unknown flags are cleared, as `remaining-grant` clears them: in this code "unknown" means "unsettled".
- Reservation disposition, request resolution and activity follow the existing code path; the activity row carries the
  new method and `charged.work: null`.

After the command, `retry-task` admits the run as it admits a `remaining-grant`-settled run.

### A.4 Visibility (never shown as zero)

- Run view: the receipt names the method and shows the work bucket as "not metered", never `0`.
- Group budget view and Results: a derived flag `usageIncomplete: true` when any run of the group carries an
  `owner-acknowledged-unmetered` marker, rendered as "usage incomplete: N run(s) released unmetered". Totals keep the
  booked numbers; the flag is what tells the reader they are a lower bound.
- `inheritedWorkUsage` for a retry carries the observed cumulative only; the retried task shows the same flag.

### A.5 Criteria (each must be seen red by deleting its own branch)

1. Null remainder + `release-unmetered` succeeds; `group.used.tokens` grows by the handoff charge only; marker method
   and `charged.work.tokens === null` exact; no work token ledger row.
2. Null remainder + `charge-remaining-grant` still refused `unlimited-remainder` (literal).
3. Finite remainder + `release-unmetered` refused `finite-remainder` (literal).
4. After release, `retry-task` succeeds (previously `usage-unknown`).
5. Handoff bucket charged equals its remaining grant (literal amounts).
6. Group view `usageIncomplete` true after release, false for a `remaining-grant` settlement.
7. Web: unlimited preview offers the release acknowledgement only; receipt renders "not metered" (zh and en full text).
8. Old stores: a persisted `remaining-grant` marker still parses; schema union does not change its hash inputs.

## B. Make the way forward visible (issues 46, 47)

1. Wherever Retry is hidden because usage is unknown (Problem region, TaskDetail), show the settlement entry
   (`UsageSettlement`) or a link to it, instead of nothing.
2. When the settlement preview is refused with `stop-mode-conflict`, the text says to resume dispatch first.
3. An `archive-run-active` refusal from the group card menu offers an inline action that opens the group's dispatch
   controls (`focus.region = "dispatch"`, already mapped by `focusedDetailRegion`).

Criteria: each new element asserted in zh and en with full text, and each removed by a mutation that turns its test red.

## Out of scope

ccloop-side transient (429) classification and backoff (separate ccloop spec, waits for a real `events.jsonl` sample);
format re-ask; wizard and visual restyle.

## Corrections (Orca session 7f37d261, 2026-10-13, during implementation)

The text above is kept as written; these notes record where the implementation departs from it and why.

1. **Lineage inherits observed usage only (human ruling, this session).** §A.3 charges work activeMs/attempts/sessions
   from the remaining grant. Under `optional-v1` (the only policy that yields a null work token remainder) a retry's
   authored budget is "authored grant minus lineage cumulative", so that charge exhausts attempts and the retry is
   refused `authored-budget-exhausted` (measured), which contradicts §A.3's last line. The human chose: the group books the
   conservative charge, and a task's lineage inherits only what the provider observed. `lineageWorkUsage()`
   (`src/control/usageSettlement.ts`) is that rule; every lineage sum uses it (`inheritedWorkUsage` and
   `readFundedAllowance` in `fundedAllowance.ts`, `retryTask.ts`, `savedResultRecovery.ts`). A fresh run after a release
   still needs group headroom for the non-token dimensions, as after any remaining-grant settlement.
2. **One count instead of a flag.** §A.4's `usageIncomplete: true` is the group view's `ledger.unmeteredRuns > 0`
   (derived from the run views, never persisted). Results show no usage totals today, so nothing is flagged there.
3. **Scope of the release.** Admission still requires a current failed task (§A.2's list), so a handoff-stopped (not
   failed) run with unknown usage and an unlimited remainder stays held (`current-failed-task`), pinned by the rewritten
   `tests/control/tokenPolicyStop.test.ts` criterion. Whether to open that path is a separate decision.
4. **§B.1 placement.** Task detail shows the settlement entry only for failed or blocked runs: every fresh run starts with
   unknown usage, and only those runs hide Retry for it.

## Corrections (Orca session b39a5527, 2026-10-14)

1. **Corrections §3 is superseded.** The human opened the path on 2026-10-14: a handoff-stopped (not failed) run with
   unknown usage is now settled back to recoverable and continued from its checkpoint, under every budget shape (the dead
   end was measured under finite budgets too, not only unlimited ones). Design:
   `docs/superpowers/specs/2026-10-14-handoff-stop-unknown-usage-design.md`. The criterion Corrections §3 names was
   rewritten again in the commit `feat(control): settle a handoff-stopped run's unknown usage back to recoverable`.
