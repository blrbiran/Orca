# Delivery Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One visible delivery order (acceptance -> integration -> delivered acceptance -> review -> done), an "integrate now" verb, and a reviewer that is told what Orca recorded beyond the diff.

**Architecture:** Integration record gains `integratedFor` / `transientReason`; a new code pass (`deliveredAcceptance.ts`) checks the delivered commit when its tree differs; the review pass waits for delivery by records and gets a facts section; a new authority verb `integrate-now` clears the backoff. All gates are code (Rule 5).

**Tech Stack:** TypeScript, node:sqlite control store, vitest, React (web).

**Spec:** `docs/superpowers/specs/2026-11-17-delivery-tail-design.md` (Correction 1 wins over the sections above it).

## Global Constraints

- Executed natively by the controller in session 2026-11-17 (human away; "先按你的建议执行").
- Every new branch of behaviour: a test seen red first, then a named mutation in a `git clone --local` copy (Rule 9, Rule 15).
- Old records parse: every new stored field is optional; the web view's new fields are optional.
- New refusal codes get en/zh copy (`refusalCoverage`), and panel text passes `scanPanelText`.
- `npm test` (the daily gate) before the branch is fast-forwarded into main.

## Review Focus

1. A group that was `done` before this ships (no `deliveredAcceptance`) stays done and its dependents are not held.
2. `integrate-now` pressed twice, or on an up-to-date group: never a second merge commit (pass's `caughtUp` / `nothingLanded`).
3. A remote that never answers: the review opens after three transient failures instead of waiting for ever.
4. A history-chain group: integrate-now only clears the backoff; D3 never runs for it.
5. A failed acceptance on the tip: the review still opens at once (#314), no wait for delivery.

---

### Task 1: Integration record facts and D1

**Files:** Modify `src/control/integrationScheme.ts` (schema), `src/control/integrationPass.ts` (`groupComplete`, `settle`), `src/panel/controlViews.ts` (`integrationView`), `src/control/webProtocol.ts` (`groupIntegrationViewSchema`), `web/src/controlTypes.ts`. Test: `tests/control/deliveryTail.test.ts` (new; world copied from `integrationGit.test.ts`).

**Produces:** `GroupIntegration.integratedFor?: string | null`, `GroupIntegration.transientReason?: string | null`; view fields `retryAfter?`, `transient?`, `transientReason?`.

- [ ] Test "a transient failure is recorded and visible": pass with a `repoPathOf` that throws once -> record `transient: 1`, `transientReason` contains the message, activity `integration-backoff` with `retryAfter`, view has `retryAfter`.
- [ ] Test "integratedFor names the tip a new commit was made for": local merge after a landing -> `integratedFor === tip`; second pass with target already holding the tip after a reset of `lastIntegrated` -> `integratedFor` unchanged.
- [ ] Test "an active requirement-review run does not hold integration (ruling 1)": insert an active run row with `purpose: "requirement-review"`, all tasks done, acceptance satisfied -> `groupComplete` true; any other active run -> false.
- [ ] Implement; run; mutations: drop the review exclusion; drop the activity write.

### Task 2: integrate-now

**Files:** `src/control/integrationCommands.ts` (`applyIntegrateNow`), `src/control/webProtocol.ts` (verb in command lists, raw + effective schemas, result `integration-requested`), `src/control/webService.ts` (`integrateNow`, reads tip before the transaction, kicks the pump), `src/panel/controlApi.ts` (route `/api/control/groups/:groupId/integration/now`), `src/panel/humanOnly.ts` (open), `src/commands/domains/work.ts` (`group integrate`), `web/src/controlApi.ts`, `web/src/controlTypes.ts`, `web/src/GitScheme.tsx` (button + backoff line), locales, `docs/cli.md`, `skills/orca-control/references/group.md`. Test: `tests/control/integrateNow.test.ts`, `web/tests/integrationScheme.test.tsx`.

**Consumes:** Task 1 fields.

- [ ] Tests: refusals `integration-not-configured`, `integration-not-idle:blocked`, `integration-not-ready:tasks-not-done`, `integration-not-ready:acceptance-not-satisfied`, `integration-up-to-date`; success clears `retryAfter`/`transient` and writes `integration-requested`; a following pass integrates once; a second integrate-now refused up-to-date (no second merge commit).
- [ ] Web test: button shown while idle and not up to date; hidden when blocked; backoff line names the local time.
- [ ] Implement; mutations: drop the readiness check; drop the up-to-date check.

### Task 3: Delivered acceptance (D3)

**Files:** Create `src/control/deliveredAcceptance.ts` (`acceptDeliveries(deps, checks): Promise<boolean>`, record type `DeliveredAcceptance`), modify `src/control/groupAcceptanceRecord.ts` (`deliveredAcceptanceOf`, `deliveredAcceptanceSatisfied`, problem), `src/control/groupEdges.ts` (`prerequisiteDone`), `src/control/executionDriver.ts` (pass order: after history acceptance; review moves after it), `src/panel/controlOverview.ts` (problem row), recheck / waive verbs (`src/control/groupAcceptanceCommands.ts` or wherever `waive-acceptance` lives). Test: `tests/control/deliveredAcceptance.test.ts`.

- [ ] Tests: same tree -> `not-needed/same-tree`, no command; differing tree (target moved before integration) -> commands run on `C`, `passed`; a check red only on `C` -> `failed`, group not done, problem row `delivered-acceptance-failed:<cmd>`; `integratedFor !== tip` -> `not-needed/already-in-target`; history group -> no record; a `done` group without a record stays done; waive clears the failure.
- [ ] Implement; mutations: skip the tree comparison; drop the done gate.

### Task 4: Review waits for delivery and is told the facts (D2, D4)

**Files:** `src/control/requirementReview.ts` (`deliverySettled`, `reviewFacts`, `buildReviewPrompt` facts section and wording). Test: `tests/control/requirementReviewDelivery.test.ts`; existing `requirementReview.test.ts` prompt assertions.

- [ ] Tests: local-scheme group -> review call made only after `lastIntegrated === tip`; its prompt contains `delivered as <C> (2 parents)`, the acceptance command lines and `orca:delivery`; keep group reviewed as before; failed acceptance -> review opens without delivery; `transient >= 3` -> review opens with `not delivered: retrying`; prompt no longer says "binary file you cannot see".
- [ ] Implement; mutations: drop the delivery wait; drop the facts section.

### Task 5: Brief and show lines (D5)

**Files:** `src/commands/domains/verbs.ts` / `reads.ts` (integration retry line, review waiting line, delivered acceptance line). Test: `tests/commands/groupShowReview.test.ts` or a new `tests/commands/groupShowDelivery.test.ts`.

- [ ] Tests on the rendered lines; implement; commit.
