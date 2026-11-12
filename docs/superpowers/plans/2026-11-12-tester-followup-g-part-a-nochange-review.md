# Tester follow-up G, part A: no-change completion and the requirement review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task whose run succeeded without changing anything completes as "no change" (directly, or after one goal-judge call for command-verified runs) with a revocable record, and a requirement group is done only after an independent review finds every acceptance criterion met, opening up to two fix tasks in the same group on its own.

**Architecture:** Part 1 widens the existing no-change proof (stepC measures the base/attempt tree equality for every succeeded empty single-repo run) and adds a route: complete at stepE (agent verifier, or `commandChecksDecideGoal`) or claim a `no-change-judge` single call (command verifier). A shared core reopens a no-change task with a note (person, orchestrating agent, or the judge's `system` re-run). Part 3 adds a `requirement-review` single call run by a driver pass after group acceptance, a record on the group body read by `prerequisiteDone` (the done gate), and a primitive that appends a fix task to a confirmed group.

**Tech Stack:** TypeScript (Node), node:sqlite control store, zod, vitest, React (web/), ccloop single calls (prompt-only: omp runs them `--no-tools`, codex `--sandbox read-only`).

**Spec:** `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md` — Part 1 (§1), Part 3 (§3), §8, §9, and **§10 (overrides §1–§9 where they differ)**: §10.1 (goal judge), §10.5 (migration marker).

## Global Constraints

- §10.1 overrides §1.1: direct auto-complete only when (a) the contract's `verification.verifierType === "agent"` (ccloop's verifier approved: outcome `succeeded`) or (b) `verification.commandChecksDecideGoal === true`. A command verifier without the declaration ⇒ one `no-change-judge` single call first. `cannot-judge` ⇒ treated as `not-met`.
- §10.5: Part 1 applies to every group, to runs that finish after the upgrade. Part 3 applies only to groups confirmed after the release: confirm writes the per-group marker `confirmedUnder: "followup-g"` (Task 1). **Part B's plan (budget, Part 2) must read the same marker through `confirmedUnderG(body)`; if it defines its own, the controller reconciles before either lands.**
- Note on reopen / review exits: required, non-blank, ≤2048 **UTF-8 bytes** (`Buffer.byteLength(note, "utf8") <= 2048`).
- Every new action exists on Web, CLI and for an orchestrating agent (`agent:<client>`): `VERB_ACCESS` `"any"` (src/panel/humanOnly.ts), never Web-only or CLI-only (spec §7).
- Every action is refused on an archived group (`group-archived`, the generic Part E refusal); every new verb gets a row in `tests/control/archiveGroup.test.ts` CALLS.
- Prompts of new single calls are English. Output schemas are strict and classified by code (Rule 5), never by the model.
- Activity kinds added (each enters `ACTIVITY_KINDS` src/control/activity.ts, `WEB_ACTIVITY_KINDS` web/src/controlTypes.ts:610, the webProtocol activity enum near src/control/webProtocol.ts:1829, and `en`/`zh` `enums.activityKind`): `no-change-completed`, `no-change-revoked`, `no-change-judged`, `requirement-review`. Each addition bumps `ENUM_VALUES.length` in web/tests/i18nPseudo.test.tsx:382 — a pinned criterion: **each bump is its own commit** with the comment line `// Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — the activityKind <kind> (spec §1/§3) adds one: <n> + 1.`
- **Existing criteria rewritten** (human approved rewriting necessary criteria for this round): each rewrite is its own commit, carries a `// Ruling (2026-11-12, tester follow-up G): ...` comment naming why, and keeps the old intent where it still holds. The full list is in "Existing criteria to rewrite" below.
- Rule 9: every new branch names the mutation that deletes it and that mutation is seen red. Mutations only in a `git clone --local` copy (`git clone --local /Users/biran/code/skills/orca/Orca /tmp/orca-g-a-mut-T<N> && ln -s /Users/biran/code/skills/orca/Orca/node_modules /tmp/orca-g-a-mut-T<N>/node_modules`); the main worktree is never touched by a mutation; the clone is deleted after.
- Rule 14: verification runs are redirected to a file and read back whole; no `grep`/`tail`/pipes on them.
- Rule 17: nothing here writes outside the control store's state directory; tests use the harness's temporary roots. The task explanation, judge and review records live in the store (artifacts + rows), never in the target repository.
- Every task ends with: `TMPDIR=/tmp ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js node scripts/test-affected.mjs --base=<task base> > /tmp/orca-g-a-T<N>.log 2>&1; echo "exit=$?"` (task base = the commit the task started from), the whole log read back, the selected/skipped counts copied into the task's report as printed (Rule 18: 0 selected is reported as 0, not green). Web changes also `cd web && npx tsc --noEmit -p tsconfig.json > /tmp/orca-g-a-T<N>-web.log 2>&1; echo "exit=$?"`. CLI verb changes also `npm run gen:cli-docs` (tests/commands/drift.test.ts pins the generated reference).
- Commit trailer: the model that writes the commit (repo memory "commit attribution = actual model"); no push (the human pushes).
- **Concurrent seats** (rebase onto main before each task; conflicts are theirs to keep, ours to re-apply):
  - `src/control/executionDriver.ts`: #230 (`blockRun`), #267 (step-C retries), #261 (saved-result paths, top of `stepC`). Our edits are confined to the no-change block of `stepC` (~978–1000) and the landed branch of `stepE` (~1320–1371).
  - `src/control/webDispatch.ts`: #268 (dispatch write sets). Our edit is one line in the work-run builder (~455, `operatorNote`).
  - `src/commands/domains/work.ts`, `src/commands/domains/verbs.ts`: #272 (CLI flags), #264/#265 (messages). New verbs are appended after `task accept-attempt` / `group waive-acceptance`.
  - `web/src/locales/en.ts`, `web/src/locales/zh.ts`: #264/#265. Add keys only; never reword theirs.
  - `web/tests/i18nPseudo.test.tsx:382`: any seat adding an enum value bumps the same number — recompute after rebase, one commit per bump.

## Review Focus

1. **A dependent already landed when its prerequisite is revoked** (spec §1.4: dependents are not rolled back). Expect: the dependent stays `done`, its landing untouched; only the reopened task returns to `ready`. Pinned in Task 4 (`reopen leaves a landed dependent done`).
2. **Reopen while the group is paused, stopped or has a stop intent.** Expect the same refusal `task retry` gives (`stop-mode-conflict`), nothing withdrawn. Pinned in Task 4.
3. **The judge or the review cannot be funded** (finite group with no remainder). Expect no call, a named state (`no-change-judge-unfunded:<dim>` on the run; review `not-passed` with `why: "unfunded"`), and the person's exits still work — never a silent done. Pinned in Tasks 5 and 8.
4. **A very large group diff, or binary artefacts (images)**, in the review prompt. Expect the prompt bounded at `REVIEW_DIFF_MAX_BYTES` with a stated truncation line, binary files named by path, bytes and sha256 (the call is prompt-only), and the reviewer allowed `cannot-judge` — which stops the group in Problems, never passes it. Pinned in Task 8.
5. **A review answer that does not match the criteria** (an id missing, an extra id, a `met` with no evidence, a `not-met` with no `missing`). Expect the round recorded `invalid` and the group `not-passed`, never `passed`. Pinned in Task 8.

---

## Existing criteria to rewrite (each its own commit, `Ruling (2026-11-12, tester follow-up G)`)

| # | Where | Why it must change | Rewritten to |
|---|---|---|---|
| R1 | `tests/control/noChangeCompletion.test.ts:32-40` "keeps the same empty result blocked without the declaration" | §10.1: a command-verified empty run without the declaration now asks the goal judge instead of D14's block | "asks the goal judge, and the task is not done until it answers": one active run `purpose:"no-change-judge"`, `drive.noChangeJudge.state === "pending"`, no acceptance row, work `blocked`, `blockedReason` null (Task 5) |
| R2 | `tests/control/driverDecisionsEmpty.test.ts:145-154` (first half of "records empty-result on a settled empty run…") | an empty run in the default (command-verified) harness no longer ends `empty-result` | the judge answers `not-met` twice ⇒ `{state:"settled", reason:"no-change-twice", work:"blocked"}` and `firstFailure` `{taskId:"a", cause:"no-change-twice"}`; the landed half (155-162) unchanged (Task 5) |
| R3 | `tests/control/driverSettle.test.ts:69-77` "settles an empty result without acceptance, so its work is blocked (deviation D14)" | same | "settles an empty result without acceptance while the goal judge decides": acceptance count 0, work `blocked`, `drive.noChangeJudge.state === "pending"` (Task 5) |
| R4 | `tests/commands/humanOutput.test.ts:243-254` (assertion at 252: `toContain("commandChecksDecideGoal")`) | the advice "set commandChecksDecideGoal and run it in a new group" is no longer the way out | the new `emptyResultLines` words (Task 6): names that the attempt is not a provable no change and `orca task reopen` does not apply; no `commandChecksDecideGoal` |
| R5 | `web/tests/emptyResultReason.test.tsx:21-29` (assertion at 25) | same words in `en`/`zh` `"empty-result"` | the new words (Task 6) |
| R6 | `web/tests/i18nPseudo.test.tsx:381-382` `ENUM_VALUES.length` | four activity kinds added | +1 per kind, one commit each (Tasks 3, 4, 5, 8) |

Run but not expected to change (if any goes red, stop and report — it names a behaviour change this plan did not intend): `tests/control/acceptAttemptCommand.test.ts:83-88`, `tests/control/executionDriver.test.ts:200-211`, `tests/flow/flowLandingDecisions.test.ts`, `tests/control/dirGroupLandedTip.test.ts`, `tests/control/debugRepro.test.ts:310-318`, `tests/control/decisiveChecksContract.test.ts`, `tests/entry/skill.test.ts:97-107`.

---

### Task 1: The per-group confirm-model marker (§10.5)

**Files:**
- Create: `src/control/confirmModel.ts`
- Modify: `src/control/webService.ts` (confirm, beside `(group as Record<string, unknown>).reconcileSlot = reconcileSlot;` ~2259)
- Test: `tests/control/confirmModel.test.ts`

**Interfaces:**
- Produces: `export const CONFIRM_MODEL_G = "followup-g" as const;` `export function confirmedUnderG(body: unknown): boolean` (true only when `body.confirmedUnder === CONFIRM_MODEL_G`). Group body field `confirmedUnder?: "followup-g"`, written once at confirm, never rewritten (absent ⇒ confirmed before this release).

- [ ] **Step 1: Write the failing test** — `tests/control/confirmModel.test.ts`

```ts
it("a group confirmed now carries the follow-up G marker; a body without it reads as confirmed before", async () => {
  const t = await driverHarness([{ taskId: "a" }]); try {
    const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    // mutation: drop the confirmedUnder write in confirm -> undefined, red
    expect(body.confirmedUnder).toBe("followup-g");
    expect(confirmedUnderG(body)).toBe(true);
    expect(confirmedUnderG({ ...body, confirmedUnder: undefined })).toBe(false);
  } finally { await t.h.dispose(); }
});
```

- [ ] **Step 2: Run it, expect FAIL** — `TMPDIR=/tmp npx vitest run tests/control/confirmModel.test.ts > /tmp/orca-g-a-T1-red.log 2>&1; echo "exit=$?"` → non-zero, "Cannot find module …/confirmModel".
- [ ] **Step 3: Implement** `confirmModel.ts` and the one assignment in confirm's transaction.
- [ ] **Step 4: Run it, expect PASS** (same command, exit 0).
- [ ] **Step 5: Affected tests + mutation** — the global command to `/tmp/orca-g-a-T1.log`; in the clone, delete the assignment ⇒ the test is red at `confirmedUnder`.
- [ ] **Step 6: Commit** — `feat(control): mark a group confirmed under tester follow-up G (spec §10.5)`

---

### Task 2: Shared plumbing for a group's own single call, and a test fixture that answers it

**Files:**
- Create: `src/control/groupSingleCall.ts`
- Create: `tests/control/fixtures/singleCallAnswers.ts`
- Modify: `src/control/stopIntent.ts:976` (one line beside the quota-probe interrupt)
- Test: `tests/control/groupSingleCall.test.ts`

**Interfaces:**
- Consumes: `insertSingleCallRun`, `verifyStoppedSingleCall`, `assertCallUsageBooked`, `closeSingleCall` (src/control/singleCallLedger.ts); `singleCallClaimRowOf` (singleCall.ts); `claimCapBlocking` (spendCaps.ts); `readGroup`/`saveGroup`, `syncWebBudget`.
- Produces:
  - `export type GroupCallPurpose = "no-change-judge" | "requirement-review";`
  - `export function boundedGroupGrant(store: ControlStore, groupId: string, grant: Amount, floorTokens: number, at: number): { grant: Amount } | { unfunded: string }` — tokens = `min(grant.tokens, limit.tokens - used.tokens - reserved.tokens)` for a finite group (unchanged when `limit.tokens === null`); `unfunded` names the first dimension that does not fit (or `"spend-cap"`, or `"tokens"` when the bounded tokens are below `floorTokens`).
  - `export function claimGroupSingleCallInTransaction(store: ControlStore, input: { groupId: string; workItemId: string; purpose: GroupCallPurpose; identity: Record<string, unknown>; slot: FrozenSlot; profile: { profileId: string; profileHash: string }; grant: Amount; contract: Record<string, unknown> }): { runId: string }` — the `claimQuotaProbeInTransaction` shape (canonical contract record + `single-call-contract:<g>:<workItem>` row, `insertSingleCallRun`, claim outbox row, `group.reserved += grant`).
  - `export function completeGroupSingleCallInTransaction(store: ControlStore, runRow: SingleCallRunRow, grant: Amount, commitTerminal: () => void, usageUnknownReason: string): StoppedSingleCallRun | null` — null when the `single-call-result:<g>:<run>` receipt already exists; else verifies, asserts usage booked, releases the unused grant and closes.
  - `export function interruptGroupSingleCall(store: ControlStore, run: StoppedSingleCallRun): void` — unused grant back to the group (as `interruptQuotaProbe`).
  - `export function isGroupCallPurpose(purpose: unknown): purpose is GroupCallPurpose`
  - Fixture: `export function answerSingleCalls(t: DriverHarness, answer: (call: { runId: string; purpose: string; prompt: string; responseSchema: Record<string, unknown> }) => { outcome: "complete" | "failed"; output?: unknown; tokens?: number; errorCode?: string }): { calls: Array<{ runId: string; purpose: string; prompt: string }> }` — patches `t.fake.port.collect`/`readEvidence` for `work.kind === "single-call"` exactly as tests/control/quotaRestProbe.test.ts:37-60 does inline (that file is not refactored).

The purposes are registered in `SINGLE_CALL_PURPOSES` by Tasks 5 and 8 (the handler table is a `Record` over the union, so a purpose and its handler land together). `stopIntent.ts` gets `if (isGroupCallPurpose(purpose)) { interruptGroupSingleCall(store, settled as never); return; }` now (it compiles: the predicate takes `unknown`).

- [ ] **Step 1: Failing tests** — `tests/control/groupSingleCall.test.ts`:
  - `boundedGroupGrant caps tokens at the finite remainder and names the dimension that does not fit` — group limit 1,000,000 tokens with 900,000 used: `grant.tokens === 100_000` for a 200,000 ask; with 990,000 used and floor 20,000 ⇒ `{ unfunded: "tokens" }`; an unlimited group returns the ask unchanged. (mutation: drop the `min` ⇒ 200,000, red)
  - `a claim reserves its grant on the group and an interrupt gives the unused part back` — after `claimGroupSingleCallInTransaction` (purpose cast for the test), `group.reserved.tokens` rose by the grant and the run row has `phase:"single-call"`; after `interruptGroupSingleCall` on that run (state set `settled-failed`, nothing used) `reserved` is back where it was. (mutation: skip the subtraction in interrupt ⇒ red)
- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement** `groupSingleCall.ts`, the fixture, the `stopIntent.ts` line.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Affected tests + both named mutations red in the clone.**
- [ ] **Step 6: Commit** — `feat(control): a group's own single call -- bounded grant, claim, completion, interrupt`

---

### Task 3: Every succeeded empty run is proved; agent-verified and declared runs complete as no change

**Files:**
- Create: `src/control/noChange.ts`
- Modify: `src/control/executionDriver.ts` (stepC no-change block ~978-1000; stepE landed branch ~1320-1371)
- Modify: `src/control/driveRecord.ts:193` (beside `noChange`)
- Modify: `src/control/activity.ts` (kind `no-change-completed`), `src/control/webProtocol.ts` (activity enum ~1829), `web/src/controlTypes.ts:610`, `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`enums.activityKind`)
- Modify: `tests/control/fixtures/web.ts:35-43,104` (`WebFixtureTask.verifierType?: "command" | "agent"`, default `"command"`)
- Test: `tests/control/noChangeAuto.test.ts`; rewrite R6 (+1)

**Interfaces:**
- Consumes: `readSystemDebugMark` (systemDebug.ts), `readTaskResultState`, `readOwnedTaskResultEvidence` (taskResultStore.ts), `recordActivity`.
- Produces (src/control/noChange.ts):
  - `export type NoChangeRoute = "complete" | "judge" | "none";`
  - `export function noChangeRouteOf(contract: TaskContract, groupBody: unknown): NoChangeRoute` — `"none"` for a criteria-review judge group (`readSystemDebugMark(body)?.source.kind === "criteria-review"`: its empty attempt *is* its verdict, settled by its run — protect-acceptance-criteria spec §5); `"complete"` for `verifierType === "agent"` or `commandChecksDecideGoal === true`; else `"judge"`.
  - `export const NO_CHANGE_EXPLANATION_MAX_BYTES = 2048;` `export async function noChangeExplanationOf(store: ControlStore, runId: string): Promise<string | null>` — the newest task-result manifest's `explanation` text, cut to the byte bound; null when none was reported.
  - `export interface NoChangeCompletion { runId: string; ordinal: number; decidedBy: "agent-verifier" | "command-checks" | "judge" | "person" | `agent:${string}`; at: number }`
  - `export function recordNoChangeCompletionInTransaction(store: ControlStore, input: { groupId: string; taskId: string; runId: string; decidedBy: NoChangeCompletion["decidedBy"]; explanation: string | null; judge?: { runId: string; finding: string } }): NoChangeCompletion` — sets `work.noChangeCompletion` (ordinal = 1 + earlier `no-change-completed` rows for this task) and writes activity `no-change-completed` `{ runId, decidedBy, ordinal, explanation, judge? }`.
- Drive record (driveRecord.ts): `noChangeRoute: z.enum(["complete","judge","none"]).nullable().default(null)`; `noChangeDirs: z.array(z.object({ key, base, attempt, baseTree, attemptTree }).strict()).nullable().default(null)`. `noChange` keeps its exact shape (the ledger's `noChangeProofSchema` is strict and `acceptanceEvidence` compares canonical bytes).
- Behaviour: stepC measures the tree proof for **every** `measured.empty` run with a base (no longer gated on the declaration). A multi run: every directory's `baseTree === attemptTree` ⇒ `noChange` = the primary's proof, `noChangeDirs` = all; any directory differing ⇒ no proof (today's path). stepE: proof bound to this attempt and route `"complete"` ⇒ the acceptance artifact as today (`landing:"no-change"`, plus `decidedBy`) and, through `commitCandidate`'s `onSettled`, `recordNoChangeCompletionInTransaction`. Route `"judge"` keeps D14 in this task (Task 5 replaces it); route `"none"` keeps D14.

- [ ] **Step 1: Failing tests** — `tests/control/noChangeAuto.test.ts`:
  - `an agent-verified empty run completes as no change without a declaration, with one activity row naming the agent's explanation` — `driverHarness([{ taskId: "a", verifierType: "agent" }], { files: () => ({}) })`; after `cleanedUp`: acceptance proof `{ landing: "no-change", decidedBy: "agent-verifier" }`, work `done`, `work.noChangeCompletion.ordinal === 1`, exactly one `no-change-completed` row with `decidedBy:"agent-verifier"`. (mutation M3a: restore the `commandChecksDecideGoal === true` gate on the proof ⇒ blocked, red)
  - `the declared command path still completes and says command-checks` — `{ commandChecksDecideGoal: true }` ⇒ `decidedBy: "command-checks"`. (mutation M3b: map both to `agent-verifier` ⇒ red)
  - `a criteria-review judge group keeps its empty attempt as its verdict` — call `noChangeRouteOf(contract, { systemDebug: { source: { kind: "criteria-review" } } })` ⇒ `"none"`, and with `{ kind: "ladder" }` ⇒ the contract's route. (mutation M3c: drop the criteria-review branch ⇒ red)
  - `a multi run completes as no change only when every directory is unchanged` — pure test of the exported `allDirsUnchanged(dirs: Array<{ baseTree: string; attemptTree: string }>): boolean` used by stepC (one differing ⇒ false). (mutation M3d: `some` for `every` ⇒ red)
  - `a second no-change completion of the same task says 2nd time` — `recordNoChangeCompletionInTransaction` twice for task `a` ⇒ ordinals 1, 2. (mutation M3e: ordinal constant 1 ⇒ red)
- [ ] **Step 2: Run, expect FAIL** (route/module missing; the agent-verified run is blocked `empty-result`).
- [ ] **Step 3: Implement** `noChange.ts`; the drive-record fields; stepC proof widening; stepE route; the fixture field; the activity kind in the four lists and both locales (`en`: "no change completed", `zh`: "无改动完成").
- [ ] **Step 4: Run, expect PASS**; then rewrite R6 (+1, own commit) and run `web/tests/i18nPseudo.test.tsx`.
- [ ] **Step 5: Affected tests + M3a–M3e red in the clone.** `tests/control/noChangeCompletion.test.ts` must still be fully green here (its R1 rewrite belongs to Task 5).
- [ ] **Step 6: Commit** — `feat(control): an agent-verified or declared empty run completes as no change (spec §1.1, §10.1)`; then `test(web): ...activityKind no-change-completed adds one` (R6).

---

### Task 4: `task reopen` — revoke a no-change completion and re-run the task with a note

**Files:**
- Create: `src/control/reopenTask.ts`
- Modify: `src/control/webProtocol.ts` (verb `reopen-task` in `commandVerbSchema`; raw + effective command schemas; payload schema; success result `{ kind: "task-reopened", taskId, fromRunId }`)
- Modify: `src/control/webService.ts` (`reopenTask(command)` via `this.mutate`), `src/panel/controlApi.ts` (route ~868 list, dispatch switch ~1004), `src/panel/humanOnly.ts` (`"reopen-task": "any"`), `src/control/errors.ts` (`"task-not-reopenable": 409`), `src/panel/controlErrors.ts` if it lists codes
- Modify: `src/control/webDispatch.ts:~455` (work-run builder: `work.reopenNote` ⇒ `run.operatorNote`, cleared on the work item in the same claim)
- Modify: `src/commands/domains/work.ts` (CLI `orca task reopen <group> <task> --note`), `web/src/controlApi.ts`, `skills/orca-control/references/task.md` and `escape-hatch.md` (route row), `web/src/locales/en.ts`, `zh.ts` (refusal `task-not-reopenable`)
- Modify: activity kind `no-change-revoked` (same four lists + locales)
- Test: `tests/control/reopenTask.test.ts`, `tests/control/archiveGroup.test.ts` (CALLS row, an addition), rewrite R6 (+1)

**Interfaces:**
- Consumes: `NoChangeCompletion`, `noChangeRouteOf` (Task 3); `acceptanceEvidence` (checkpoints.ts); `retryFundingOf` (retryTask.ts, read only); `topUpSum`, `appendTopUp` (workTopUp.ts); `hasOptionalTaskPolicy`; `reserveCommitment`, `setAllocationStates`, `readStopIntent` (stopIntent.ts); `operatorNoteSchema` (schema.ts).
- Produces:
  - `export const reopenTaskPayloadSchema = z.object({ runId: idSchema, note: z.string().refine(n => n.trim().length > 0, "note-empty").refine(n => Buffer.byteLength(n, "utf8") <= 2048, "note-over-2048-bytes") }).strict();` (webProtocol.ts)
  - `export type ReopenBy = "system" | string;` `export function reopenNoChangeTaskInTransaction(store: ControlStore, input: { groupId: string; taskId: string; runId: string; note: string; by: ReopenBy; commandId: string }): { fromRunId: string; withdrawn: boolean }` — the one core the verb and the judge's re-run (Task 5) share.
  - `export function applyReopenTask(deps: { store: ControlStore; admissionGate?: AdmissionGate }, command: ReopenTaskCommand): CommandSuccessV1 | CommandErrorBodyV1`
  - `export const NO_CHANGE_BLOCKS = ["no-change-twice", "no-change-judge-failed", "no-change-judge-unfunded"] as const;` (Task 5 writes them; listed here so eligibility is one predicate.)
  - `export function reopenEligibility(store: ControlStore, groupId: string, taskId: string, runId: string): "completed" | "blocked" | string` — `"completed"`: the task is `done`, `runId` is its current run, `state === "settled"`, `acceptanceEvidence` would hold for a `no-change` proof (checked by reading the outbox row's `landing` and the run's `drive.noChange` bound to `drive.attemptSha`); `"blocked"`: the task is `blocked` on that settled run with a bound proof, no acceptance row, `blockedReason` null or starting with one of `NO_CHANGE_BLOCKS`, and no active `no-change-judge` run for it; anything else is the refusal detail (`not-no-change`, `run-moved`, `run-active`, `judge-pending`).
- Effect (one transaction, Part 1.4): refusals first in retry-task's order (`stop-mode-conflict` for `group.stopped` or a stop intent; `task-not-reopenable:<detail>`); for `"completed"` the outbox row `acceptance:<runId>` is rewritten to `{ runId, accepted: false, source, withdrawn: { by, note, at, commandId } }` (so `acceptanceEvidence` and `repairAcceptedWork` never count it again); work ⇒ `status:"ready"`, `pendingRunId:null`, `reopenNote:{ text: note, scope: "remaining-attempts" }`, `noChangeCompletion` deleted; funding as retry's fresh start (Part 1.5): optional policy ⇒ `fundingReleased:true` plus a `kind:"fresh-start"` top-up of the lineage's attempts/activeMs beyond earlier top-ups, capped by the group's non-token remainder; a finite group whose token remainder is ≤ 0 ⇒ `group-budget-unavailable:tokens`; finite-legacy ⇒ `reserveCommitment(grant)` after retry's `group-reserve-insufficient` check; allocations `confirmed`; a `done`/`review` group ⇒ `running`; activity `no-change-revoked` `{ runId, note, by }`. Dependents are not touched.
- CLI: `verb({ domain: "task", action: "reopen", summary: "revoke a task's no-change completion and run it again in this group with a note for its agent", verb: "reopen-task", positionals: [GROUP, TASK], access: "open", flags: [{ name: "note", type: "string", required: true, summary: "what the agent should know; delivered as the new run's operator note (≤2048 bytes)" }], route: (c) => \`groups/${group(c)}/tasks/${task(c)}/reopen\`, payload: async (c) => ({ runId: await currentRun(c), note: str(c, "note") }) })`.

- [ ] **Step 1: Failing tests** — `tests/control/reopenTask.test.ts` (agent-verified harness from Task 3 so the task completes as no change):
  - `reopen withdraws the no-change acceptance, returns the task to ready and the next run carries the note` — after reopen: `acceptanceEvidence(store, runId) === false`, work `ready`, one `no-change-revoked` row with the note; the next `t.claim()` run has `operatorNote: { text: note, scope: "remaining-attempts" }` and the work item no longer has `reopenNote`. (M4a: skip the outbox rewrite ⇒ `acceptanceEvidence` true, red; M4b: drop the operatorNote copy in webDispatch ⇒ red)
  - `a done group goes back to running` — group reached `done` first (single task), after reopen `status === "running"`. (M4c: skip the status write ⇒ red)
  - `reopen leaves a landed dependent done` — tasks `a` (agent, empty) and `b` dependsOn `a` (lands a file); reopen `a`: `b` stays `done` and `refs/heads/orca/g` still contains `b`'s file. (Review Focus 1)
  - `reopen is refused while the group is stopped, and on a task that did not complete as no change` — `stop-mode-conflict` after a pause-dispatch/stop; a landed task ⇒ `task-not-reopenable:not-no-change`; a stale `runId` ⇒ `task-not-reopenable:run-moved`. Nothing withdrawn in either case. (Review Focus 2; M4d: drop the stop check ⇒ red)
  - `a note over 2048 bytes or blank is refused by the payload` — 2049 ASCII bytes and `"   "` ⇒ payload refusal; 2048 bytes accepted. (M4e: `.max(2048)` on characters with a 683-char CJK note ⇒ accepted, red)
  - `a finite group with no token remainder refuses reopen with the exhaustion refusal` — `group-budget-unavailable:tokens`. (M4f: drop the check ⇒ red)
  - archiveGroup.test.ts CALLS: `"reopen-task": { call: (s, c) => s.reopenTask(c), target: "task", payload: { runId: "run-a", note: "n" } }` (the table's own criterion then expects `group-archived`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the core, the verb end to end (protocol, service, route, humanOnly, error code + en/zh refusal words, CLI verb, web client, skill rows), the dispatch line, the activity kind.
- [ ] **Step 4: Run, expect PASS**; `npm run gen:cli-docs`; rewrite R6 (+1, own commit); run `tests/entry/skill.test.ts`, `tests/panel/accessMatrix.test.ts`, `tests/panel/refusalCoverage.test.ts`, `tests/commands/drift.test.ts`.
- [ ] **Step 5: Affected tests + M4a–M4f red in the clone.**
- [ ] **Step 6: Commit** — `feat(control): task reopen -- revoke a no-change completion and re-run with a note (spec §1.4, §1.5)`; then the R6 bump commit.

---

### Task 5: The goal judge for command-verified no-change runs; "no change twice"; `task accept-no-change`

**Files:**
- Create: `src/control/noChangeJudge.ts`
- Modify: `src/control/singleCall.ts` (`SINGLE_CALL_PURPOSES` += `"no-change-judge"`), `src/control/singleCallPurposes.ts` (`HANDLERS["no-change-judge"] = NO_CHANGE_JUDGE_HANDLER`), `src/panel/controlViews.ts:226`, `src/control/webProtocol.ts:376,1864` (purpose enums)
- Modify: `src/control/executionDriver.ts` stepE (route `"judge"`: claim in `onSettled`, or block `no-change-twice` / `no-change-judge-unfunded:<dim>`), `src/control/driveRecord.ts` (`noChangeJudge`)
- Modify: `src/control/noChange.ts` (`completeNoChangeInTransaction`), `src/control/webProtocol.ts` (verb `accept-no-change`, payload `{ runId, note }` same refinements as reopen, result `{ kind: "no-change-accepted", taskId, runId }`), `src/control/webService.ts` (`acceptNoChange(command)`: async, writes the artifact then mutates), `src/panel/controlApi.ts`, `src/panel/humanOnly.ts` (`"accept-no-change": "any"`), `src/control/errors.ts` (`"no-change-not-acceptable": 409`), `src/commands/domains/work.ts` (`orca task accept-no-change <group> <task> --note`), `web/src/controlApi.ts`, skill refs, locales (refusal + VIEW_REASONS words for `no-change-twice`, `no-change-judge-failed`, `no-change-judge-unfunded`, `no-change-judge-usage-unknown`)
- Modify: activity kind `no-change-judged`
- Modify: `tests/panel/refusalCoverage.test.ts:50-77` VIEW_REASONS (an addition: the four reasons)
- Test: `tests/control/noChangeJudge.test.ts`; rewrites R1, R2, R3, R6 (+1); archiveGroup CALLS row

**Interfaces:**
- Consumes: Task 2 (`boundedGroupGrant`, `claimGroupSingleCallInTransaction`, `completeGroupSingleCallInTransaction`, fixture), Task 3 (`noChangeRouteOf`, `noChangeExplanationOf`, `recordNoChangeCompletionInTransaction`), Task 4 (`reopenNoChangeTaskInTransaction`, `NO_CHANGE_BLOCKS`, `reopenEligibility`); `frozenWorkAgent`, `readConfirmedTaskExecution`; `writeArtifact`.
- Produces (src/control/noChangeJudge.ts):
  - `export const NO_CHANGE_JUDGE_GRANT: Readonly<Amount> = { tokens: 200_000, activeMs: 600_000, attempts: 1, sessions: 1 };` `export const NO_CHANGE_JUDGE_FLOOR_TOKENS = 20_000;` `export const NO_CHANGE_JUDGE_MAX_OUTPUT_TOKENS = 2_000;` `export const JUDGE_BASE_MAX_BYTES = 100_000;` `export const NO_CHANGE_JUDGE_USAGE_UNKNOWN = "no-change-judge-usage-unknown";`
  - `export const noChangeJudgeResponseSchema` (JSON schema, strict): `{ verdict: "met" | "not-met" | "cannot-judge", finding: string }` (`finding` 1..2048 bytes).
  - `export function classifyJudgeOutput(raw: unknown): { verdict: "met" | "not-met" | "cannot-judge"; finding: string }` — anything that does not parse is `{ verdict: "cannot-judge", finding: "judge output invalid: <first issue>" }`.
  - `export function buildNoChangeJudgePrompt(input: { goal: string; successCondition: string; requiredChecks: string[]; explanation: string | null; baseListing: string[]; baseFiles: Array<{ path: string; text: string }>; truncated: boolean }): string` — English; says the agent changed nothing, its required checks passed, asks whether the goal is already met in the base tree shown, and that `cannot-judge` is allowed.
  - `export function claimNoChangeJudgeInTransaction(store: ControlStore, input: { groupId: string; taskId: string; workRunId: string; at: number }): { runId: string } | { unfunded: string }` — slot = the task's frozen work agent, profile = the work run's `executionProfile`, workItemId `no-change-judge:<task>:<workRun>`, contract `{ schema: "orca-no-change-judge-contract-v1", groupId, taskId, workRunId, … }`.
  - `export const NO_CHANGE_JUDGE_HANDLER: SingleCallHandler` — `prepare` reads the base tree (`git ls-tree -r --name-only <base>` ≤ 2,000 paths; contents of base files under the task's `targetPaths`, total ≤ `JUDGE_BASE_MAX_BYTES`, `truncated` stated); `evaluate` writes the acceptance artifact when the verdict is `met` (proof `{ runId: workRunId, checksPassed: true, landing: "no-change", commit, noChange, decidedBy: "judge", judge: { runId, finding } }`); `complete`/`completeInTransaction`: `completeGroupSingleCallInTransaction`, then **met** ⇒ outbox `acceptance:<workRun>` + `completeNoChangeInTransaction` + `no-change-completed` (`decidedBy:"judge"`, judge finding); **not-met / cannot-judge** ⇒ `no-change-judged` row and `reopenNoChangeTaskInTransaction({ by: "system", note: finding })` and `work.noChangeRerun = { fromRunId, judgeRunId }`; **call failed** (`failure !== null`) ⇒ work run `drive.blockedReason = "no-change-judge-failed:<code>"`; every case sets `drive.noChangeJudge.state`.
- Produces (noChange.ts): `export function completeNoChangeInTransaction(store: ControlStore, input: { groupId: string; taskId: string; runId: string; decidedBy: NoChangeCompletion["decidedBy"]; explanation: string | null; judge?: { runId: string; finding: string } }): void` — invariants as `repairAcceptedWork`'s (run `settled`, `recoverable`, its `checkpointId` the one checked complete before the transaction, `work.currentRunId === runId`, target and graph versions equal), else `recovery-blocked:no-change-invariant`; work ⇒ `done`, `drive.blockedReason` ⇒ null, then `recordNoChangeCompletionInTransaction`.
- Drive record: `noChangeJudge: z.object({ runId: z.string().nullable(), state: z.enum(["pending","met","not-met","cannot-judge","failed","unfunded"]), finding: z.string().optional() }).strict().nullable().default(null)`.
- stepE route `"judge"`: a work item carrying `noChangeRerun` whose `fromRunId` is in its lineage ⇒ no judge, `blockedReason = "no-change-twice"` (§10.1: a second no-change stops in Problems); else `boundedGroupGrant(NO_CHANGE_JUDGE_GRANT, NO_CHANGE_JUDGE_FLOOR_TOKENS)` ⇒ claim (state `pending`) or `blockedReason = "no-change-judge-unfunded:<dim>"`.
- `accept-no-change` (person or orchestrating agent): `reopenEligibility(...) === "blocked"` else `no-change-not-acceptable:<detail>`; the artifact proof carries `decidedBy` = `"person"` or `agent:<client>` (from `commandPrincipalFor`) and `note`; then `completeNoChangeInTransaction`. CLI: `orca task accept-no-change <group> <task> --note <why>` (`access: "open"`).

- [ ] **Step 1: Failing tests** — `tests/control/noChangeJudge.test.ts` (default command-verified harness, `files: () => ({})`, `answerSingleCalls`):
  - `met completes the task as no change and names the judge` — answer `{ verdict: "met", finding: "already implemented in base.txt" }`: work `done`, acceptance proof `decidedBy:"judge"`, `no-change-completed` row with the finding. (M5a: skip the outbox insert on met ⇒ `acceptanceEvidence` false, red)
  - `not-met re-runs the task once in the same group with the finding as its note` — the next claimed run's `operatorNote.text` equals the finding; `no-change-judged` row `{ verdict: "not-met" }`; principal `system` on the `no-change-revoked`-free path (no acceptance existed). (M5b: skip the reopen ⇒ no second claim, red)
  - `cannot-judge and an invalid answer are treated as not-met` — `{ verdict: "cannot-judge" }` and `{ nonsense: 1 }` both re-run. (M5c: treat cannot-judge as met ⇒ red)
  - `a second no-change after the judge's re-run stops as no-change-twice; accept-no-change completes it` — both runs empty: second run `blockedReason === "no-change-twice"`, only one judge call made; then `accept-no-change` with a note ⇒ `done`, `decidedBy` `"person"` under a person context. (M5d: drop the `noChangeRerun` check ⇒ a second judge call, red)
  - `an unfunded judge is named on the run and the task can still be reopened` — finite group with remainder < floor ⇒ `no-change-judge-unfunded:tokens`, no judge run; `reopenEligibility` ⇒ `"blocked"`. (Review Focus 3; M5e: claim regardless ⇒ red)
  - `a failed judge call names its code on the work run` — answer `{ outcome: "failed", errorCode: "codex-timeout" }` ⇒ `no-change-judge-failed:codex-timeout`.
  - `the judge prompt carries the goal, the explanation and the base tree, bounded` — prompt (from the fixture's `calls`) contains the contract goal, the explanation text, `base.txt`; a base over `JUDGE_BASE_MAX_BYTES` yields the truncation line.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the handler, registration, purpose enums, stepE route, `completeNoChangeInTransaction`, the `accept-no-change` verb end to end, VIEW_REASONS words, activity kind.
- [ ] **Step 4: Run, expect PASS.** Then rewrite **R1**, **R2**, **R3** (one commit each, `// Ruling (2026-11-12, tester follow-up G): §10.1 -- a command-verified empty run asks the goal judge; D14's block remains only for criteria-review verdicts and partial multi runs.`), and **R6** (+1). `npm run gen:cli-docs`.
- [ ] **Step 5: Affected tests + M5a–M5e red in the clone.**
- [ ] **Step 6: Commits** — `feat(control): a goal judge decides a command-verified no-change run (spec §10.1)`; the three rewrite commits; the R6 bump.

---

### Task 6: The "no change" marker, the record and its actions in every view

**Files:**
- Modify: `src/panel/controlViews.ts` (work-item view: `noChangeCompletion`; run view: `noChangeJudge`), `src/control/webProtocol.ts` (the matching optional fields in the group-view work item / run schemas), `web/src/controlTypes.ts`
- Modify: `web/src/BoardView.tsx` (card chip "no change" / "no change · 2nd time"), `web/src/TaskDetail.tsx` (the record: who decided, explanation, judge finding; buttons "Revoke and re-run" → `reopen-task`, "Accept as no change" → `accept-no-change`, each with a note box), `web/src/ControlGroupView.tsx` (task rows carry the chip)
- Modify: `src/commands/domains/verbs.ts` (`noChangeLines(workItems, runs)` beside `emptyResultLines` ~216-232; `emptyResultLines` words), `src/commands/domains/reads.ts:318` (task show), `formatWithUnestimated` (group show)
- Modify: `web/src/locales/en.ts`, `zh.ts` (`"empty-result"` words, new keys under `control.noChange.*`)
- Test: `tests/commands/noChangeLines.test.ts`, `web/tests/noChangeMarker.test.tsx`; rewrites R4, R5

**Interfaces:**
- Consumes: `NoChangeCompletion` (Task 3), `noChangeJudge` drive field and `NO_CHANGE_BLOCKS` (Tasks 4/5), verbs `reopen-task`, `accept-no-change`.
- Produces: `export function noChangeLines(groupId: string, items: ReadonlyArray<{ taskId: string; noChangeCompletion?: NoChangeCompletion }>, runs: readonly EmptyResultRun[]): string[]` — per no-change task: `task <t>: no change (<decidedBy>[, 2nd time]) in run <r>` and `  revoke: orca task reopen <g> <t> --note '<what to change>'`; per run blocked `no-change-twice`/`no-change-judge-*`: `task <t>: <reason>: …` plus `next: orca task accept-no-change <g> <t> --note '<why>'` and `  or: orca task reopen <g> <t> --note '<what to change>'`.
- `emptyResultLines` keeps its head line; the three advice lines become: `"  this attempt is not a provable no change (its tree differs from its base, or it is a criteria-review verdict), so it cannot complete in this group"` and `"  if a change was needed: say in the task what to change, and run it in a new group"`.

- [ ] **Step 1: Failing tests**
  - `tests/commands/noChangeLines.test.ts`: `group show names a no-change task, the 2nd time, and the revoke command` (ordinal 2 ⇒ `2nd time`); `a no-change-twice run names accept-no-change and reopen`; `--json is unchanged: no added field` (as humanOutput.test.ts:264). (M6a: drop the ordinal suffix ⇒ red)
  - `web/tests/noChangeMarker.test.tsx`: Board card of a task with `noChangeCompletion` shows "no change"; TaskDetail shows the explanation and a "Revoke and re-run" button whose send posts `reopen-task` with `{ runId, note }`; the button is disabled with an empty note; an archived group shows no buttons; zh shows zh words. (M6b: render the chip only for ordinal 1 ⇒ red on the 2nd-time case)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** views, CLI lines, locale words.
- [ ] **Step 4: Run, expect PASS**; rewrite **R4** and **R5** (one commit each, `// Ruling (2026-11-12, tester follow-up G): §1 -- the empty-result advice no longer points at commandChecksDecideGoal; a provable no change completes or is judged.`).
- [ ] **Step 5: Affected tests + web typecheck + M6a, M6b red in the clone.**
- [ ] **Step 6: Commits** — `feat(web,cli): show the no-change marker, record and its two actions (spec §1.2)`; the two rewrite commits.

---

### Task 7: Append a task to a confirmed group

**Files:**
- Create: `src/control/groupTaskAppend.ts`
- Test: `tests/control/groupTaskAppend.test.ts`

**Interfaces:**
- Consumes: `readArchivedPlan` (queries.ts), `readBudgetProposal`/`saveWebAuthority`, `executionSnapshotSchema`, `deriveContract`, `writeCanonicalRecord`, `canonicalBytes`, `sha256Canonical`, `taskContractSchema`, `saveTokenPolicy`, `frozenWorkAgent`, `recordProjectionChange`.
- Produces: `export interface AppendTaskInput { taskId: string; contract: TaskContract; agentFrom: string /* an existing task whose frozen work agent the new task copies */; work: Amount; handoff: Amount; dependsOn: string[] }` and `export function appendConfirmedTaskInTransaction(store: ControlStore, groupId: string, input: AppendTaskInput): { planHash: string; derivedContractHash: string; executionSnapshotHash: string }`. In one transaction: the archived plan with the task appended (new canonical record, `group.planHash` updated, `graphVersion` unchanged — no run is active when it is called; refused `recovery-blocked:append-while-active` otherwise), the proposal's two allocations (`state: "confirmed"`), the snapshot's `derivedContracts`, `allocations` and `agents.tasks` entries appended (every other entry byte for byte, as `replaceTaskInSnapshot` keeps them), a Web work item (`status: "ready"`, `targetVersion: 1`, the copied frozen agent, `derivedContractHash`, `lineageRunIds: []`), its token-policy row (`optional-v1` when the group has a token policy), and `group.status = "running"`. Refused `task-already-exists` (existing code) for a taken id.

- [ ] **Step 1: Failing tests** — `tests/control/groupTaskAppend.test.ts` (`driverHarness([{ taskId: "a" }])`, run `a` to done first):
  - `an appended task reads back from the confirmed snapshot and every earlier task still does` — `readConfirmedTaskExecution(store, "g", "fix-1").contract.objective.taskId === "fix-1"` and the same call for `a` does not throw. (M7a: skip the snapshot `agents.tasks` append ⇒ `recovery-blocked`, red)
  - `the driver claims and lands the appended task` — `t.claim()` returns a run with `taskId: "fix-1"`; it lands its file on `orca/g`. (M7b: leave the work item `blocked` ⇒ no claim, red)
  - `appending while a run is active is refused` — `recovery-blocked:append-while-active`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Affected tests + M7a, M7b red in the clone.**
- [ ] **Step 6: Commit** — `feat(control): append a task to a confirmed group (spec §3.4 groundwork)`

---

### Task 8: The requirement review — record, done gate, driver pass and its single call

**Files:**
- Create: `src/control/requirementReviewRecord.ts` (type-only imports, like groupAcceptanceRecord.ts, so `groupEdges.ts` can read it without the runner)
- Create: `src/control/requirementReview.ts`
- Modify: `src/control/groupEdges.ts:77-88` (`prerequisiteDone` also needs `reviewSatisfied`), `src/control/executionDriver.ts` (round: `reviewRequirements(...)` right after `acceptGroups` ~1680-1685), `src/control/singleCall.ts`, `src/control/singleCallPurposes.ts`, `src/panel/controlViews.ts:226,580-643` (purpose enum; summary `requirementReview` with `problem`), `src/control/webProtocol.ts:376,1590-1600,1864`, `web/src/controlTypes.ts`
- Modify: activity kind `requirement-review`
- Test: `tests/control/requirementReview.test.ts`; rewrite R6 (+1)

**Interfaces:**
- Consumes: Task 1 (`confirmedUnderG`), Task 2, `acceptanceSatisfied`, `acceptanceOf`, `acceptanceCommands` (groupAcceptance.ts), `hasRequirementBlock`, `readRequirementGroup`, `readRound` (requirementRecords.ts), `isFlowChildGroup`, `isMultiGroup`, `isDirGroup`, `readConfirmedReconcileSlot`, `readSystemDebugMark`.
- Produces (requirementReviewRecord.ts):
  - `export type CriterionVerdict = { id: string; verdict: "met" | "not-met" | "cannot-judge"; evidence: Array<{ path: string; line: number | null }>; missing: string | null };`
  - `export interface ReviewRound { roundNo: number; tip: string; runId: string | null; at: number; result: "passed" | "not-met" | "cannot-judge" | "invalid" | "failed" | "unfunded"; criteria: CriterionVerdict[]; summary: string; note?: string; fixTaskId?: string; fixBy?: "auto" | string }`
  - `export interface RequirementReview { state: "pending" | "reviewing" | "passed" | "fixing" | "not-passed" | "accepted" | "not-run"; why?: "multi-repo" | "dir" | "unfunded" | "invalid" | "cannot-judge" | "rounds-exhausted" | "failed"; rounds: ReviewRound[]; autoFixRounds: number; accepted?: { by: string; note: string; at: number }; rerun?: { by: string; note: string; at: number } }`
  - `export function reviewOf(body: unknown): RequirementReview | null` (group body field `requirementReview`)
  - `export function reviewRequired(store: Pick<ControlStore, "db">, groupId: string, body: unknown): boolean` — `hasRequirementBlock(body) && confirmedUnderG(body)` and not a flow child or system-debug group (§3.8, §10.5).
  - `export function reviewSatisfied(store: Pick<ControlStore, "db">, groupId: string, body: unknown): boolean` — `!reviewRequired(...)` or state ∈ `passed | accepted | not-run`.
  - `export function reviewProblem(review: RequirementReview | null): string | null` — `"requirement-review-not-passed:<why>"` for `not-passed`.
- Produces (requirementReview.ts):
  - `export const REQUIREMENT_REVIEW_GRANT: Readonly<Amount> = { tokens: 600_000, activeMs: 1_800_000, attempts: 1, sessions: 1 };` `REVIEW_FLOOR_TOKENS = 50_000`; `REVIEW_MAX_OUTPUT_TOKENS = 16_000`; `REVIEW_DIFF_MAX_BYTES = 200_000`; `REQUIREMENT_REVIEW_USAGE_UNKNOWN = "requirement-review-usage-unknown"`.
  - `export const requirementReviewResponseSchema` (strict JSON schema): `{ criteria: Array<{ id, verdict, evidence: Array<{ path, line: integer|null }>, missing: string|null }>, summary: string }`.
  - `export function classifyReviewOutput(raw: unknown, criterionIds: readonly string[]): { result: "passed" | "not-met" | "cannot-judge"; criteria: CriterionVerdict[]; summary: string } | { result: "invalid"; reason: string }` — invalid when ids differ from the consensus criteria (missing, extra or repeated), a `met`/`not-met` has no evidence, or a `not-met` has no `missing`; `cannot-judge` wins over `not-met` for the round result (§3.5: any cannot-judge stops).
  - `export function buildReviewPrompt(input: { idea: string; statement: string; criteria: Array<{ id: string; text: string }>; openBranches: string[]; changedFiles: Array<{ path: string; status: string; bytes: number; sha256: string; binary: boolean }>; diff: string; truncated: boolean; note?: string }): string` — English; says binary files are named only and that `cannot-judge` is the answer when a criterion hinges on one.
  - `export function groupBaseCommit(store: ControlStore, groupId: string): string` — the `drive.base` of the group's first work run (rowid order).
  - `export async function reviewRequirements(deps: ExecutionDriverDeps): Promise<boolean>` — per group with `reviewRequired`, every task done, no active run, no stop intent, `acceptanceSatisfied` on the current tip: multi or dir group ⇒ record `not-run` (why `multi-repo`/`dir`, a stated gap); no round yet for this tip, or the latest round opened a fix task that is now done, or `rerun` set ⇒ `boundedGroupGrant` ⇒ claim (state `reviewing`) or a round `unfunded` and state `not-passed`.
  - `export const REQUIREMENT_REVIEW_HANDLER: SingleCallHandler` — `prepare` reads the consensus (`readRound(store, g, consensus.roundNo).result`), the idea, `git diff --no-color <base>..<tip>` cut at `REVIEW_DIFF_MAX_BYTES`, `--numstat` for binaries (`-`), sizes and sha256 by `git cat-file`; `complete` appends the round and sets the state (`passed` ⇒ `passed`; anything else ⇒ `not-passed` with its `why` — Task 9 turns `not-met` into fix rounds); activity `requirement-review` `{ roundNo, result, tip }`.
- `prerequisiteDone` (groupEdges.ts): after the `acceptanceSatisfied` line, `if (!reviewSatisfied(store, groupId, group)) return false;`. The integration pass (`integrationPass.ts:193`) is not gated (spec gates done only; stated in the final report).

- [ ] **Step 1: Failing tests** — `tests/control/requirementReview.test.ts` (driverHarness with a requirement block and consensus seeded on the group body + `requirement_rounds` row, two tasks so acceptance runs; `answerSingleCalls`):
  - `a requirement group confirmed under G is reviewed after acceptance and is done only when the review passes` — before the answer the group is not `done` and `requirementReview.state === "reviewing"`; answer all `met` ⇒ `passed`, then `done`. (M8a: drop the `reviewSatisfied` line in prerequisiteDone ⇒ done before the review, red)
  - `a group confirmed before the release, or not from a requirement, is not reviewed` — strip `confirmedUnder` ⇒ done without a review call; no requirement block ⇒ same. (M8b: drop `confirmedUnderG` from `reviewRequired` ⇒ a call, red)
  - `an answer that does not match the criteria is invalid and the group stops in Problems` — missing id, extra id, `met` with `evidence: []`, `not-met` with `missing: null`: each ⇒ round `invalid`, state `not-passed`, summary `problem: "requirement-review-not-passed:invalid"`, not `done`. (Review Focus 5; M8c: accept a missing id ⇒ passed, red)
  - `cannot-judge stops the group in Problems` ⇒ `not-passed`, why `cannot-judge`, no fix task. (M8d: treat cannot-judge as met ⇒ red)
  - `the prompt is bounded and names binaries` — a group whose diff exceeds `REVIEW_DIFF_MAX_BYTES` (a generated 300 KB text file) and adds a PNG: the prompt's diff section ≤ the bound and has the truncation line; the PNG appears as `path, bytes, sha256`, its bytes do not. (Review Focus 4; M8e: no cut ⇒ red)
  - `an unfunded review is named and does not pass` — finite group, remainder < floor ⇒ round `unfunded`, `not-passed`. (Review Focus 3)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** record, gate, pass, handler, registration, purpose enums, summary field, activity kind.
- [ ] **Step 4: Run, expect PASS**; rewrite R6 (+1, own commit); run `tests/control/groupAcceptanceGuards.test.ts`, `tests/control/groupEdges*.test.ts`, `tests/commands/groupShowAcceptance.test.ts` (must stay green: non-requirement groups unchanged).
- [ ] **Step 5: Affected tests + M8a–M8e red in the clone.**
- [ ] **Step 6: Commit** — `feat(control): review a requirement group against its acceptance criteria before done (spec §3.1-3.3, §3.6-3.8)`; the R6 bump.

---

### Task 9: Not met ⇒ a fix task in the same group, at most two automatic rounds

**Files:**
- Modify: `src/control/requirementReview.ts` (handler `complete`: `not-met` ⇒ fix round; the pass re-reviews when the fix task is done)
- Test: `tests/control/requirementReviewFix.test.ts`

**Interfaces:**
- Consumes: Task 7 (`appendConfirmedTaskInTransaction`), Task 8 record/handler, `acceptanceCommands`.
- Produces: `export const MAX_AUTO_FIX_ROUNDS = 2;` `export function fixTaskContract(store: ControlStore, groupId: string, round: ReviewRound, criteria: Array<{ id: string; text: string }>, goal?: string): TaskContract` — objective `{ taskId: "review-fix-<roundNo>", goal: <the round's not-met findings: id, text, missing, evidence paths> (or the person's `goal`), successCondition: "the requirement review finds criteria <ids> met" }`; `targetPaths` = the evidence paths of the not-met criteria (unique), or the union of the group's tasks' `targetPaths` when the review named none; `safetyPolicy.allowlistPaths` = union of the tasks' allowlists, `denylistPaths` = union of denylists; `requiredChecks` and `setupCommands` = `acceptanceCommands(store, g)` (setup absent when empty); `executionPolicy` and `verifierType` from the group's first task in plan order; agent copied from that task; allocation = that task's work/handoff amounts.
- Behaviour: a round `not-met` with `autoFixRounds < MAX_AUTO_FIX_ROUNDS` ⇒ append the fix task (`fixBy: "auto"`), `autoFixRounds += 1`, state `fixing`, activity `requirement-review` `{ action: "fix-opened", taskId }`; fix task done ⇒ the acceptance pass checks the new tip, then the review runs again (Task 8's trigger: the latest round's fix task is done); `not-met` with `autoFixRounds === 2` ⇒ `not-passed`, why `rounds-exhausted`. A fix that cannot be funded (`group-budget-unavailable`) ⇒ `not-passed`, why `unfunded`.

- [ ] **Step 1: Failing tests** — `tests/control/requirementReviewFix.test.ts`:
  - `a not-met round opens one fix task covering every unmet criterion, and the review runs again after it lands` — answers: round 1 `AC-1 not-met, AC-2 not-met` ⇒ exactly one new task `review-fix-1` whose goal names both ids and whose `targetPaths` are the evidence paths; it lands; round 2 all met ⇒ `passed`, group `done`. (M9a: one fix task per criterion ⇒ two tasks, red)
  - `the third not-met round stops the group in Problems` — three not-met rounds ⇒ two fix tasks, then `not-passed`, why `rounds-exhausted`, problem code shown. (M9b: `<=` for `<` on the bound ⇒ a third fix task, red)
  - `the fix task's checks are the group's union of required checks` — contract `verification.requiredChecks` equals `acceptanceCommands(...).checks`. (M9c: only the first task's checks ⇒ red when tasks differ)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Affected tests + M9a–M9c red in the clone.**
- [ ] **Step 6: Commit** — `feat(control): an unmet requirement criterion opens a fix task in the same group, two rounds at most (spec §3.4, §3.5)`

---

### Task 10: The review's exits — accept as is, re-run with a note, add a fix task by hand — in the CLI, the Web and `group show`

**Files:**
- Create: `src/control/requirementReviewCommands.ts`, `web/src/RequirementReviewPanel.tsx`
- Modify: `src/control/webProtocol.ts` (verbs `review-accept`, `review-rerun`, `review-fix`; payloads `{ note }`, `{ note }`, `{ goal: <non-blank, ≤ 4096 bytes>, paths?: string[] }`; results `review-accepted`, `review-rerun-requested`, `review-fix-opened`), `src/control/webService.ts`, `src/panel/controlApi.ts` (routes `groups/:groupId/review/accept|rerun|fix` — **not** under `requirement/`, so tests/entry/skill.test.ts:124-130's requirement-row count stays 9), `src/panel/humanOnly.ts` (all three `"any"`), `src/control/errors.ts` (`"requirement-review-not-open": 409`), `src/commands/domains/work.ts` (`orca group review-accept|review-rerun|review-fix`), `src/commands/domains/verbs.ts` (`reviewLines(groupId, review)` in `formatWithUnestimated`, beside `acceptanceLines`), `web/src/ControlGroupView.tsx` (the panel beside `GroupAcceptanceProblem` ~839), `web/src/BoardView.tsx` (card line "reviewing" / "review not passed"), `web/src/controlApi.ts`, locales, skill refs (`group.md`, `escape-hatch.md`)
- Test: `tests/control/requirementReviewCommands.test.ts`, `tests/commands/groupShowReview.test.ts`, `web/tests/requirementReviewPanel.test.tsx`; archiveGroup CALLS rows (additions)

**Interfaces:**
- Consumes: Tasks 7–9.
- Produces: `export function applyReviewAccept(deps, command)`, `applyReviewRerun(deps, command)`, `applyReviewFix(deps, command)` — each refuses `requirement-review-not-open:<state>` unless the state is `not-passed`; accept ⇒ `accepted` with `{ by, note, at }` (the done gate then holds); rerun ⇒ `rerun` set, state `pending` (the pass runs a round whose prompt carries the note); fix ⇒ `appendConfirmedTaskInTransaction` with `fixTaskContract(..., goal)`, round `fixBy: <principal>` (does not count toward `autoFixRounds`), state `fixing`. Each writes `requirement-review` `{ action, by, note|goal }`.
- `export function reviewLines(groupId: string, review: RequirementReview | undefined): string[]` — `review: passed on <tip12> (round <n>)`; `review: reviewing`; for not-passed: `problem: requirement-review-not-passed:<why>` then one line per criterion `  <id> <verdict>: <missing or first evidence path>`, then `next: orca group review-fix <g> --goal '<what to fix>'`, `  or: orca group review-rerun <g> --note '<what to look at>'`, `  or: orca group review-accept <g> --note '<why accept as is>'`.

- [ ] **Step 1: Failing tests**
  - `requirementReviewCommands.test.ts`: `accept as is makes a not-passed group done, by an agent too` (principal `agent:cli` ⇒ `done`, `accepted.by === "agent:cli"`); `rerun carries the note into the next review prompt`; `review-fix by hand opens a task that does not use up an automatic round`; `each is refused unless the review is not-passed` (`requirement-review-not-open:passed`). (M10a: accept without setting state ⇒ not done, red; M10b: count a hand fix in `autoFixRounds` ⇒ red)
  - `groupShowReview.test.ts`: the not-passed lines and the three commands, in that order; a passed review is one line; `--json` unchanged.
  - `web/tests/requirementReviewPanel.test.tsx`: the panel lists each criterion with its verdict and evidence; the three actions post the right verbs; none on an archived group; zh words.
  - archiveGroup CALLS rows for the three verbs.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npm run gen:cli-docs`; run `tests/entry/skill.test.ts`, `tests/panel/accessMatrix.test.ts`, `tests/panel/refusalCoverage.test.ts`, `tests/commands/drift.test.ts`.
- [ ] **Step 5: Affected tests + web typecheck + M10a, M10b red in the clone.**
- [ ] **Step 6: Commit** — `feat(control,web,cli): the requirement review's exits -- accept, re-run with a note, fix by hand (spec §3.3, §3.5)`

---

## Decisions this plan made (reversible; for the human's review at round end)

1. **Criteria-review judge groups keep D14.** Their empty attempt is the verdict ("justified"), settled by the run (`criteriaReview.ts:90`); auto-completing or judging it would spend a call on a verdict. Ladder and other debug groups follow Part 1.
2. **Multi-repo:** `drive.noChange` keeps the primary's proof unchanged (the ledger's `noChangeProofSchema` is strict); every directory's proof goes in `drive.noChangeDirs`.
3. **Judge and review read the tree through the prompt.** ccloop single calls are prompt-only (`omp --no-tools`, `codex --sandbox read-only`), so "read access to the base tree" and "artefacts read as files" become bounded excerpts; images are named (path, bytes, sha256), and the reviewer answers `cannot-judge` when one decides a criterion — which stops the group, never passes it. A gap against §3.2's wording.
4. **The fix task is appended to the confirmed group** (the human's 「同一组里」), via a new primitive (Task 7), not the stacked system-debug group pattern. Its agent, policies and allocation copy the group's first task in plan order.
5. **Multi-directory and folder requirement groups record the review `not-run`**, as group acceptance does — a known gap (no single tree to diff).
6. **Integration delivery is not gated on the review**; only `done` (and dependents) are, as §3.6 says.
7. Grants and bounds stated: judge 200k tokens (floor 20k, 2k output, base excerpt 100 KB); review 600k (floor 50k, 16k output, diff 200 KB); both bounded by the group remainder.
8. `task accept-no-change` is open to a person and an orchestrating agent (§10.1), as `recheck-acceptance` is.
