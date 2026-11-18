# Change-sized runs, phase P0 (Orca on the current ccloop pin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Who / when:** written by a design subagent (Claude Opus 5.5) spawned by the Orca control session, 2026-11-18, from
  Orca `main` `b1f458c6` and ccloop pin `dd491c1`. Line numbers were read at `b1f458c6`; re-find each one before editing.
- **Status:** plan, not started. The spec is uncommitted and needs the person's review first.

**Goal:** On the current ccloop pin, with no ccloop change and no protocol change: Orca's run workspace stops being a
checkout (both modes, with clone mode's HEAD set to `base`); `<sourceDir>/repo` is deleted once a complete archive holds
it, safely across crashes and on every settle path; attempt worktrees stop being archived as logs; and Orca's two strict
schemas learn ccloop's future `attemptRef` feature and `attemptDelivery` envelope key without ever sending it.

**Architecture:** Four narrow changes in `src/control`: `ensureWorkspace` (`workspace.ts`), the log exclusions of
`archiveRun` (`archive.ts`), one guarded deletion helper `removeResultCopies` beside `cleanupCommittedRun`
(`cleanup.ts`) called from the six settle/cleanup sites in `executionDriver.ts` and `driverHandoff.ts`, and two schema
fields (`ccloopPort.ts`, `schema.ts`). No new state shape, no control-store migration, no ccloop change.

**Tech Stack:** TypeScript, Node, vitest, zod, git CLI, node:sqlite.

**Spec:** `docs/superpowers/specs/2026-11-19-change-sized-runs-design.md` — §5.1 (workspace), §5.6 (deletion rule,
guard table, call-site order, disk per case), §5.4.1 (log exclusions), §6.2 (P0 schema changes), §11.1 (P0 rewrites),
§11.3 (P0-1..7), §12 (P0-A, P0-B), §13 (P0 row), §16 (review resolutions I1, I2, I4, O6/O7).

## Global Constraints

- Rules: Orca `CLAUDE.md`. Rule 4 (every success criterion is a command with an exit code); Rule 9 (every new branch
  names the mutation that deletes it, and that mutation is **seen red**; mutations only in a `git clone --local` copy,
  restored and proven by the byte counts of `git diff` and `git diff --cached`, Rule 15); Rule 13 (every persistent note
  carries who/when/commit); Rule 14 (verification output redirected to a file and read back whole; no pipes; numbers only
  as the tool prints them); Rule 17 (tests use the driver harness's temporary control directory, never `~/.orca`; new
  directories `0700`, new files `0600`; existing modes untouched); Rule 18 (per patch set `npm test`; before the merge
  `npm run test:wide` with `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js`; never `npm run verify`).
- **No ccloop change, no envelope change on the wire.** P0 never sends `attemptDelivery`; every envelope Orca builds is
  byte-identical to today's (spec §5.8 row 1).
- **The deletion is the only irreversible step.** It runs only through `removeResultCopies`, only after the run is in a
  terminal state, only when the run's latest archive row has `missing: []` and a snapshot, and only on the exact
  `<sourceDir>/repo` (and `<sourceDir>/repos` at step E) after the source-identity check (spec §5.6). A partial archive
  keeps the copy.
- **Order at every cleanup site:** archive (skipped when a row exists, `stepCleanupFailed` only) → workspace cleanup →
  `removeResultCopies` → the `cleanedUp` write, which is always last (spec §5.6, review I1).
- Human ruling (2026-11-18): 「同意这样大改，并且同意改所有必要的判据」. Each rewritten assertion gets a comment
  `// Ruling (2026-11-18 change-sized runs P0): <why>` and is listed in the task report with its intent.
- Worktree under `/Users/biran/code/skills/orca/.wt-363-p0/` (not `/private/tmp`). Its `node_modules` is a symlink to the
  main repo: never `npm ci` / `npm install` / `rm` it (`/Users/biran/code/skills/orca/.agent-notice-node-modules.md`).
- vitest in subagents: `--maxWorkers=2`; `TMPDIR=$(mktemp -d /tmp/oXX)` (socket paths stay under 103 bytes).
- Commits: one per task, subject as given, body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Merge into `main` with `--ff-only` only. Push needs the person's `allow-push` (Rule 15).

## Review Focus

1. A crash between `removeResultCopies` and the `cleanedUp` write, on step E and on `stepCleanupFailed`: the next round must finish with `cleanedUp:true`, no new archive row, and no ENOENT from `archiveRun`.
2. A recoverable run (ceiling, handoff, allowance) after its settle: `<sourceDir>/repo` gone, yet `exportResumeBundle` and a real-ccloop continuation still work from the archive alone.
3. A run whose archive is partial, or whose `<sourceDir>/repo` is a symlink, or whose source directory was replaced: nothing is deleted, and the reason is visible (`cleanupError` or a stderr line).
4. Clone mode with the target's HEAD past `base`: the workspace HEAD and the attempt ccloop cuts from it are `base`, detached; the workspace holds only `.git`.
5. Every envelope Orca builds is byte-identical to today's (no `attemptDelivery` key, no defaulting), and a ccloop answering `features` without `attemptRef` reads exactly as before.

---

### Task 1: Orca's strict schemas learn `attemptRef` and `attemptDelivery` (spec §6.2, O6, review I4)

**Files:** `src/control/ccloopPort.ts:254` (`featuresSchema`), `src/control/schema.ts:73` (`loopWorkSchema`) and the
`startEnvelopeSchema` `superRefine` (`:75-100`). Test: new `tests/control/attemptDeliveryWire.test.ts` (pattern of
`tests/control/handoffWire.test.ts:33-60` and `tests/control/liveTranscriptProtocol.test.ts:17`).

**Interfaces:**
- `featuresSchema` gains `attemptRef: z.literal("v1").optional()`. `readFeatures()`'s type gains `attemptRef?: "v1"`.
- `loopWorkSchema` gains `attemptDelivery: z.literal("ref-v1").optional()` — never `.default(...)`.
- `superRefine` adds two issues, mirroring ccloop's: `attempt-delivery-requires-protocol4` (path `work.attemptDelivery`)
  when `protocol !== 4`, and `attempt-delivery-with-saved-result` when `mode !== undefined`.
- `toStartEnvelope` is **not** changed.

- [ ] Write the tests:
  - `readFeatures accepts a ccloop that advertises attemptRef v1, and refuses the whole answer for any other value` —
    fixture `features: {protocol:1, tokenPolicy:"optional-v1", savedResultRecovery:"v1", agentInstallationUpdate:"v1",
    transcripts:"v1", attemptRef:"v1"}` ⇒ `readFeatures()` deep-equals it; `attemptRef:"v2"` ⇒ rejects with
    `control-response-invalid`; the answer without the key ⇒ deep-equals the input (no key added).
  - `a protocol-4 loop envelope with attemptDelivery ref-v1 parses, and parsing never adds the key` — take the envelope
    built by `toStartEnvelope` in `startEnvelope.test.ts`'s fixture: `startEnvelopeSchema.parse(e)` deep-equals `e` and
    has no `attemptDelivery` own property; `sha256Canonical` of the parsed value equals that of `e`; with
    `work.attemptDelivery = "ref-v1"` and `protocol: 4` it parses.
  - `attemptDelivery is refused on protocol 3, beside mode verify-saved-result, and with any other value` — three
    `safeParse` calls, each `success === false` with the named message (or a zod literal issue for the third).
- [ ] Run red (`npx vitest run tests/control/attemptDeliveryWire.test.ts --maxWorkers=2 > <tmp>/t1-red.txt 2>&1; echo $?`, read the file).
- [ ] Implement; run green the same way.
- [ ] Mutations (each seen red, in a `git clone --local` copy):
  - M1.1 remove `attemptRef` from `featuresSchema` ⇒ the first test red (`control-response-invalid`).
  - M1.2 `attemptDelivery: z.literal("ref-v1").default("ref-v1")` ⇒ "never adds the key" red.
  - M1.3 drop the protocol-4 issue ⇒ refusal test red; M1.4 drop the `mode` issue ⇒ refusal test red.
  - M1.5 `z.string()` instead of the literal ⇒ "any other value" red.
- [ ] Existing tests rewritten: none. `npm test > <tmp>/t1-quick.txt 2>&1; echo $?`; copy its selected/deferred lines into the report.
- [ ] Commit `feat(control): Orca's strict schemas learn ccloop's attemptRef feature and the attemptDelivery envelope key, sent by nobody yet (#363 P0)`.

### Task 2: the run workspace is a git handle with no checkout; clone mode sets HEAD to base (spec §5.1, O1)

**Files:** `src/control/workspace.ts:130-142` (`ensureWorkspace`). Tests: `tests/control/workspace.test.ts`
(new `it`s in "the run workspace" describe, `:65`), rewrite in `tests/control/dirRequirementExport.test.ts:193`.

**Interfaces:** `ensureWorkspace` keeps its signature. Worktree mode: `git -C <targetRepo> worktree add --no-checkout
--detach <path> <base>`. Clone mode: `git clone --local --no-checkout <targetRepo> <path>` then
`git -C <path> update-ref --no-deref HEAD <base>` (replaces `checkout --detach`). `checkedOutAt` unchanged. Both keep
`QUIET_GIT`.

- [ ] Write the tests:
  - `a worktree-mode workspace holds only .git, with an empty index, detached at base` — `readdirSync(path)` equals
    `[".git"]`; `git -C path ls-files` is empty; `rev-parse HEAD` = base; `symbolic-ref -q HEAD` exits non-zero.
  - `a clone-mode workspace holds only .git and is detached at base even when the target's HEAD has moved past base` —
    commit `later` in the target first; `ensureWorkspace(..., "clone", path, base)`; entries `[".git"]`;
    `rev-parse HEAD` = base (not `later`); `symbolic-ref -q HEAD` exits non-zero.
  - `an attempt worktree cut from the workspace with no start point, as ccloop cuts it, holds base's tree, in both modes`
    — `git -C path worktree add --detach <attempt>` (no start point, `worktreeManager.ts:27` at the pin);
    `rev-parse HEAD` in the attempt = base and `shared.txt` reads `base\n`. This is the reason the HEAD fix exists.
  - `a clone left by a crash before its HEAD was set is rebuilt` — `git clone --local --no-checkout target path` by hand
    (HEAD = `later`), then `ensureWorkspace(..., base)` ⇒ HEAD = base.
- [ ] Rewrite `dirRequirementExport.test.ts:193` line 205 (intent: the agent starts from the exported work branch) to
  `git -C <workspace> show HEAD:src/export.ts` = `export {};\n` and `readdirSync(workspace)` = `[".git"]`, with the
  Ruling comment. Mutation: ensure at a wrong base (the vault's parent commit) ⇒ red.
- [ ] Run red, implement, run green (files redirected, read back).
- [ ] Mutations: M2.1 drop `--no-checkout` from the worktree add ⇒ the worktree test red (entries include `shared.txt`);
  M2.2 drop the `update-ref` ⇒ clone test and attempt test red (HEAD = `later`); M2.3 keep `checkout --detach` instead of
  `update-ref` ⇒ clone entries test red.
- [ ] Existing tests that stay and why: `workspace.test.ts:66,77,90` (HEAD = base, marker reuse and rebuild hold);
  `executionDriverE2E.test.ts:130` (clone `.git` is a directory).
- [ ] Real ccloop at the pin with a no-checkout `repoPath` (deferred by the quick tier; run explicitly):
  `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js npx vitest run tests/control/executionDriverE2E.test.ts tests/control/handoffE2E.test.ts tests/control/handoffE2EResume.test.ts tests/control/dirRequirementE2E.test.ts tests/control/multiDirCollect.test.ts --maxWorkers=2 > <tmp>/t2-e2e.txt 2>&1; echo $?` — read whole; report every skipped test by name.
- [ ] `npm test > <tmp>/t2-quick.txt 2>&1; echo $?`.
- [ ] Commit `fix(control): the run workspace is a git handle with no checkout, and clone mode sets HEAD to base (#363 P0, O1)`.

### Task 3: a run's archive no longer files its attempt worktrees as logs (spec §5.4.1, O7)

**Files:** `src/control/archive.ts:200` (exclusion list of `captureTree`). Tests: `tests/control/archive.test.ts` (new
`it`), `tests/control/allowanceHeldSettlement.test.ts:16` (one added assertion, real ccloop).

**Interfaces:** the exclusion list gains `run/worktrees` and `run/dirs` (relative to the source). No manifest field is
added (the first draft's `retained` is dropped, spec §16 item 11).

- [ ] Write the tests:
  - `archive.test.ts`: `a kept or retained attempt worktree under run/ is not archived as logs` — in `archiveCase()`,
    create `run/state.json`, `run/worktrees/attempt-1/big.txt`, `run/worktrees/attempt-1/.git` (a file, as a linked
    worktree has), `run/dirs/attempt-1/k/x.txt`; `archiveRun`; the manifest's `logs` paths contain `run/state.json`, no
    path starts with `run/worktrees` or `run/dirs`, and `missing` equals `[]` (the `containsExclusion` children check
    must not report `changed:run`).
  - `allowanceHeldSettlement.test.ts:16`: after `settled-recoverable`, the run's newest archive manifest has no log path
    under `run/worktrees/` (an allowance park keeps the attempt worktree in the real ccloop).
- [ ] Run red, implement, run green.
- [ ] Mutation M3.1: remove the two exclusions ⇒ both tests red.
- [ ] Existing tests that stay: `archive.test.ts:12-148` (v1 capture), `taskResultIsolation.test.ts` (task-result
  exclusions untouched).
- [ ] `npm test > <tmp>/t3-quick.txt 2>&1; echo $?`; the real-ccloop file explicitly as in Task 2.
- [ ] Commit `fix(control): a run's archive no longer files its attempt worktrees as logs (#363 P0, O7)`.

### Task 4: `removeResultCopies`, the one guarded way the result copy is deleted (spec §5.6 guard table)

**Files:** `src/control/cleanup.ts` (new export beside `cleanupCommittedRun`; reuse its identity check, `within`,
`privateDirectory`). Test: new `tests/control/resultCopies.test.ts` (unit, `archiveCase()` fixture; set the run's state
with a direct `UPDATE runs` as `retryTask.test.ts:60` does).

**Interfaces:**
```ts
export async function removeResultCopies(store: ControlStore, runId: string, sourceDir: string,
  options: { extras: boolean }): Promise<{ removed: string[]; kept: "archive-partial" | null }>;
```
- Reads the run's **latest** archive row (`ORDER BY rowid DESC LIMIT 1`, as `acceptAttempt.ts:59`).
- Throws `ControlError("result-copy-unarchived")` when there is no row; `ControlError("result-copy-run-active")` when
  `!isTerminalRunState(readRun(store, runId).state)` (`budget.ts:65`); `cleanup-path-invalid` / `cleanup-source-reused`
  exactly as `cleanup.ts:16-26` for the source directory; `cleanup-path-invalid` when `repo` (or `repos`) is a symlink or
  not a directory.
- Returns `{ removed: [], kept: "archive-partial" }` without touching anything when the row's `missing` is non-empty or
  its `snapshot` is null.
- Absent paths are not an error. `rm(path, { recursive: true })` (no `force`, so an unexpected error surfaces).

- [ ] Write one test per guard row (spec §5.6), each naming its mutation:
  - `removes repo, and repos only when asked, once a complete archive holds it` — two calls (`extras:false` keeps
    `repos/`, `extras:true` removes it); the source directory and its logs stay; `verifySnapshot(row.snapshot)` resolves
    after the removal (the evidence is whole without the copy). Mutation M4.1: ignore `extras` ⇒ red.
  - `is idempotent: a second call removes nothing and does not throw`.
  - `throws result-copy-unarchived and removes nothing when the run has no archive row` (delete the rows first).
    Mutation M4.2: skip the row check ⇒ red.
  - `keeps the copies when the latest archive is partial` (archive after placing a FIFO in the source: `special:`
    missing). Mutation M4.3: drop the completeness check ⇒ red.
  - `throws result-copy-run-active for a run that is not terminal`. Mutation M4.4: drop the state check ⇒ red.
  - `throws cleanup-source-reused when the source directory was replaced` (rename it away and recreate it with a `repo/`
    inside). Mutation M4.5: drop the identity check ⇒ red.
  - `refuses a repo that is a symlink and leaves the link and its target alone` (`repo` → a directory outside). Mutation
    M4.6: drop the `lstat` check ⇒ red (the link is gone).
- [ ] Run red, implement, run green.
- [ ] `npm test > <tmp>/t4-quick.txt 2>&1; echo $?`.
- [ ] Commit `feat(control): removeResultCopies deletes a run's result copy only once a complete archive holds it (#363 #366 P0)`.

### Task 5: step E and failed-run cleanup remove the copy, resumably; the cleanup re-archives only when nothing is archived (spec §5.6, review I1)

**Files:** `src/control/executionDriver.ts` — `CrashPoint` (`:101`, add `"E-before-result-copies"` and
`"cleanup-failed-after-result-copies"`), step E cleanup (`:1676-1683`), `stepCleanupFailed` (`:1692-1708`). Tests: new
`tests/control/resultCopyCleanup.test.ts` (driver harness, `tests/control/fixtures/driverHarness.ts`; crash hooks as
`driverSettle.test.ts:127`); rewrite `tests/control/taskResultIsolation.test.ts:88`; harden
`tests/control/debugRepro.test.ts:346` and `tests/control/criteriaBaseRun.test.ts:248`.

**Behaviour (order is the contract):**
- Step E, after `cleanupExtraWorkspace`: `deps.crash?.("E-before-result-copies")`, then
  `removeResultCopies(store, runId, drive.sourceDir, { extras: true })`, then the `cleanedUp:true` write. A throw is
  recorded in `cleanupError` by the round's existing handler (`:1930-1938`).
- `stepCleanupFailed`: `archiveRun` only when **no** archive row for the run exists (a small `hasArchiveRow(store,
  runId)` in `cleanup.ts` or inline query, `kind='archive' AND json_extract(body,'$.runId')=?`); then workspace and
  extras cleanup; then `removeResultCopies(..., { extras: false })`; then `deps.crash?.("cleanup-failed-after-result-copies")`;
  then the `cleanedUp:true` write.

- [ ] Write the tests in `resultCopyCleanup.test.ts`:
  - `a landed run's settle removes <sourceDir>/repo after its archive persisted, keeps the source directory, and its
    snapshot still verifies` — `until cleanedUp`; `existsSync(join(sourceDir,"repo"))` false; `sourceDir` exists;
    `verifySnapshot` of the newest archive row's snapshot resolves. Mutation M5.1: drop the call ⇒ red. Mutation M5.2:
    call it before `archiveRun` ⇒ red (`result-copy-unarchived`, run blocked at E).
  - `a crash between the workspace cleanup and the removal resumes to cleanedUp with the copy gone` — crash once at
    `E-before-result-copies`; next driver: `cleanedUp:true`, `cleanupError:null`, repo absent. Mutation M5.3: move the
    `cleanedUp` write above the crash point ⇒ red (the copy stays for ever).
  - `a failed run's cleanup resumes after a crash that followed the removal, without re-archiving` (review I1) — run
    fails (`behaviour: () => "failed"`), `retryTask` ⇒ `settled-failed`; crash once at
    `cleanup-failed-after-result-copies`; then `stepCleanupFailed` ⇒ `true`; drive `cleanedUp:true`,
    `cleanupError:null`; archive row count for the run unchanged from before the cleanup; repo absent. Mutation M5.4:
    re-archive unconditionally ⇒ red (ENOENT from `realpath(repoDir)`).
  - `a failed run with no archive row is archived exactly once by its cleanup` — delete the run's archive rows after it
    blocks; `stepCleanupFailed`; exactly one row, `missing: []`. Mutation M5.5: never archive in the cleanup ⇒ red.
- [ ] Rewrite `taskResultIsolation.test.ts:88` (intent: supplemental faults never make a failed run's evidence partial):
  delete the run's archive rows after it blocks, then poison, then `stepCleanupFailed`; exactly one new row with
  `missing: []`. Ruling comment. Mutation: drop `TASK_RESULT_SOURCE_EXCLUSIONS` from the capture ⇒ red.
- [ ] Harden `debugRepro.test.ts:355` and `criteriaBaseRun.test.ts:262`: assert `existsSync(join(sourceDir,"repo"))` is
  `true` immediately before the `node_modules` check (they run at `landed`, before step E).
- [ ] Existing tests that stay and why: `driverSettle.test.ts:102` (keeps the source directory: still true);
  `retryTask.test.ts:313` (`archived > 0`); `executionDriver.test.ts:177` (blocked at C, copy kept).
- [ ] Run red, implement, run green; mutations seen red.
- [ ] `npm test > <tmp>/t5-quick.txt 2>&1; echo $?`.
- [ ] Commit `fix(control): a settled run's result copy goes once its archive holds it, and a failed run's cleanup resumes without re-archiving (#363 #366 P0, review I1)`.

### Task 6: recoverable settles, continuations and abandoned runs remove the copy too (spec §5.6, review I2, O12)

**Files:** `src/control/executionDriver.ts` — `settleTokenAllowance` (`:2265-2287`), `settleCeilingStopOnce` (orphan
path `:2419-2421`, normal path `:2423-2428`), `cleanupPredecessor` (`:747-757`); `src/control/driverHandoff.ts` —
`settleHandoffCheckpoint` (`:545-588`), `settleAbandonedUnderStop` (`:400-416`). Tests: `resultCopyCleanup.test.ts`
(more `it`s), rewrite `tests/control/liveCeilingSettle.test.ts:81`, extend `tests/control/allowanceHeldSettlement.test.ts:16`.

**Behaviour:**
- Recoverable settles: after `commitCandidate` (or the H-settle transaction) returned and the run re-read is terminal,
  `removeResultCopies(..., { extras: false })` inside a `try`; a failure writes one stderr line
  `orca-driver: <runId>: result copy kept: <describeError>` and the settle's return value is unchanged. A transaction
  that did not commit (`write` returned false, or `commitCandidate` threw) removes nothing.
- `cleanupPredecessor`: after `cleanupRunWorkspace`, the removal in the same `try`, so its failure lands in the existing
  `cleanupError`.
- `settleAbandonedUnderStop`: after `removeNeverStartedWorkspace`; a failure joins its `cleanupError`.

- [ ] Write the tests:
  - `a ceiling-settled run has no result copy, and its continuation bundle exports from the archive alone` — harness
    options of `usagePauseFreshStart.test.ts:28-52` (or `liveCeilingSettle.test.ts:25`) until `settled-recoverable`;
    repo absent; `exportResumeBundle({ predecessorRunId, newSourceDir })` resolves when its checkpoint is recoverable.
    Mutation M6.1: drop the ceiling call ⇒ red.
  - `a handoff-settled run has no result copy` — `behaviour: () => "stoppable"` and `stop(t)` from
    `tests/control/fixtures/handoffHarness.js`, until `settled-recoverable`; repo absent; `exportResumeBundle` resolves.
    Mutation M6.2: drop the H-settle call ⇒ red.
  - `a predecessor settled before P0 loses its result copy when its continuation starts` — after the handoff settle,
    recreate `<sourceDir>/repo/` as a plain directory (a pre-P0 leftover), resume from the handoff; the predecessor's
    drive has `cleanedUp:true`, `cleanupError:null`, repo absent. Mutation M6.3: drop the `cleanupPredecessor` call ⇒
    red.
  - `an abandoned run settled under a stop has no result copy` — the abandon-under-stop path of
    `tests/control/abandonUnderStop.test.ts` (reuse its setup). Mutation M6.4: drop that call ⇒ red.
  - `a removal that fails at a recoverable settle leaves the settle's answer unchanged and says so on stderr` — with the
    `liveCeilingSettle.test.ts` harness, drive to `accepted`, then create `<sourceDir>/repo/locked/f` and `chmod 0500
    locked` (the archive can still read it; `rm` cannot unlink inside it), then call `stepC` by hand as
    `liveCeilingSettle.test.ts:96-98` does: it returns `true`, the run is `settled-recoverable`, `locked/f` still
    exists, and captured stderr contains `result copy kept`. Restore the mode in `finally`. (A symlinked `repo` cannot
    be used here: `archiveRun` refuses it first, `archive.ts:191`.) Mutation M6.5: let the error propagate ⇒ red.
- [ ] `allowanceHeldSettlement.test.ts:16` (real ccloop at the pin): after `settled-recoverable`, repo absent and
  `exportResumeBundle` resolves. Mutation M6.6: drop the allowance call ⇒ red (wide tier; run the file explicitly).
- [ ] Rewrite `liveCeilingSettle.test.ts:81` line 105 (intent: a late C visit reuses the committed checkpoint and never
  re-archives): assert repo absent after the first settle, then write `late.txt` into the **source directory**. Ruling
  comment. Mutation: make the late visit re-archive ⇒ red (second checkpoint or `checkpoint-identity-conflict`).
- [ ] Existing tests that stay and why: `liveCeilingSettle.test.ts:150` (writes into the copy before the orphan settle
  that removes it — still meaningful in P0; rewritten in P2); `usagePauseFreshStart.test.ts:66` (predecessor
  `cleanedUp:true` still holds).
- [ ] Real-ccloop continuation over a removed copy: `ORCA_CCLOOP_BIN=… npx vitest run tests/control/handoffE2EResume.test.ts tests/control/handoffE2ERecovery.test.ts tests/control/allowanceHeldSettlement.test.ts --maxWorkers=2 > <tmp>/t6-e2e.txt 2>&1; echo $?`.
- [ ] `npm test > <tmp>/t6-quick.txt 2>&1; echo $?`.
- [ ] Commit `fix(control): recoverable settles, continuations and abandoned runs drop the result copy their archive already holds (#363 #366 P0, review I2)`.

### Task 7: Corrections in the published specs (spec §10, P0 list; Orca Rule 13)

**Files (append only, never edit an existing paragraph):** `docs/superpowers/specs/2026-09-25-execution-driver-design.md`
(§3.2, §3.5), `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` (§4.2(2)),
`docs/superpowers/specs/2026-10-10-task-results-design.md` (archive exclusions), `docs/superpowers/specs/2026-09-25-handoff-delivery-design.md`
and `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` (§6.3). Confirm each file name with `ls` first.

- [ ] Append to each a section `## Correction (2026-11-19, change-sized runs P0)` with who/when/commit (Rule 13): what
  changed, the commit that changed it, and a pointer to `2026-11-19-change-sized-runs-design.md` §5.1 / §5.6 / §5.4.1.
- [ ] Check: `git diff --stat` shows only additions in those files (`git diff --numstat` deletions column all `0`), saved
  to a file and read back.
- [ ] Commit `docs(specs): corrections for the no-checkout workspace, the result-copy removal and the archive exclusions (#363 P0)`.

### Task 8: P0 acceptance on repo L, and the merge gate (spec §12 P0-A, P0-B; Rule 18)

**Files:** new `tests/bench/noCheckoutWorkspace.ts` (not a test tier; pattern of `tests/bench/controlPollPerformance.ts`).

**Behaviour of the bench** (spec §12 P0-A, thresholds fixed there): reads `ORCA_BENCH_REPO` and `ORCA_CONTROL_DIR`
(refuses to run without either, and refuses a control directory under `~/.orca`); makes a `clone --local --no-checkout`
target in the control directory's scratch; adds a `later` commit with `commit-tree` + `update-ref` (no checkout); for
each mode runs the real `ensureWorkspace`, cuts an attempt with `git -C ws worktree add --detach <p>` and no start point,
measures, removes the attempt, runs the real `cleanupRunWorkspace`; prints one JSON object per mode with
`{mode, ensureMs, entries, unsharedBytes, headIsBase, attemptHeadIsBase}` plus `uptimeBefore`, `uptimeAfter`, the Orca
commit and the ccloop pin; exits 1 on any breach of `ensureMs ≤ 2000`, `entries == [".git"]`,
`unsharedBytes ≤ 1048576` (regular files with link count 1, under the workspace and, in worktree mode, under the
directory `git -C <workspace> rev-parse --git-dir` names), and both HEAD checks.

- [ ] Write the bench. Smoke it on a toy repository first (exit 0), then a mutation in a clone: drop `--no-checkout` ⇒
  exit 1 on the toy. Both outputs to files, read back.
- [ ] Run P0-A on repo L: `ORCA_BENCH_REPO=<repoL> ORCA_CONTROL_DIR=<scratch>/state npx tsx tests/bench/noCheckoutWorkspace.ts > <scratch>/p0a.json 2> <scratch>/p0a.err; echo $?` — record the exit code and the JSON verbatim with the measuring commit in the handoff; move the scratch clone to the Trash afterwards (`/usr/bin/trash`).
- [ ] P0-B only if the person allows a paid run: one small task on repo L with the panel from this commit, then
  `node <scratch>/p0b-check.mjs <stateDir> <runId> > <scratch>/p0b.txt 2>&1; echo $?` (script outside the repository;
  read-only; thresholds in spec §12). Otherwise list it under `awaitingHuman` in the checkpoint.
- [ ] Merge gate: `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js npm run test:wide > <tmp>/wide.txt 2>&1; echo $?`
  — read whole; copy its deferred/skipped lines into the report (Rule 12); on red, `npm test -- --rerun-failed` and label
  it "rerun, not a gate".
- [ ] Commit `test(bench): no-checkout workspace bench for the change-sized runs P0 acceptance (#363 P0)`.
- [ ] Merge into `main` with `git merge --ff-only`. Push only after the person's `allow-push`.

---

## Rewritten existing criteria (summary for the reviewer)

| Task | Test | Intent kept | Replacement criterion |
|---|---|---|---|
| 2 | `tests/control/dirRequirementExport.test.ts:193` (line 205) | the agent starts from the exported work branch | `git show HEAD:src/export.ts` in the workspace + entries `[".git"]` |
| 5 | `tests/control/taskResultIsolation.test.ts:88` | supplemental faults never make a failed run's evidence partial | archive rows deleted first, so the cleanup archives after the poison; one row, `missing: []` |
| 6 | `tests/control/liveCeilingSettle.test.ts:81` (line 105) | a late C visit reuses the committed checkpoint, never re-archives | copy absent after the first settle; `late.txt` written into the source directory |
| 5 | `tests/control/debugRepro.test.ts:346`, `tests/control/criteriaBaseRun.test.ts:248` (hardening) | setup output never left in the result copy | `repo` asserted present before the `node_modules` check |

## Out of P0 (do not start here)

Pinning, snapshot v2, the check worktree, `ORCA_SETTLE_SLOW_MS`, sending `attemptDelivery`, and every §11.1 P2 rewrite
belong to P2; every ccloop change belongs to P1 (its two rewritten criteria are awaiting the person's naming).
