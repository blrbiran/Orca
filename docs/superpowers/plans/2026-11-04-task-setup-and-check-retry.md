# Task setup, checks that exist, and retries that can help — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks carry inferred setup commands that run before their agent and before every check Orca or ccloop runs; the split's checks name scripts that exist; the ladder retries only failures an agent can fix.

**Architecture:** Part A (Orca, inert until ccloop emits anything new) widens Orca's schemas, contract building, its own check runs and the ladder. Part B is ccloop's half (separate plan). Part C (Orca, after the human pushes ccloop and Orca repins) gives the split a `manifests` view, the `setup` key and code validation of npm commands. Absent `setup` leaves every byte as today.

**Tech Stack:** TypeScript, zod, vitest, React (web), git.

**Spec:** `docs/superpowers/specs/2026-11-04-task-setup-and-check-retry-design.md`. Part B: ccloop `docs/superpowers/plans/2026-11-04-task-setup-ccloop.md`.

## Global Constraints

- `CLAUDE.md` governs (Rules 13–18). Routine gate: `npm test` (selected, includes typecheck), redirected to a file, run in the background; never `npm run verify`.
- Mutations only in a `git clone --local` copy (build `web/dist` there first, or panel tests go red `panel-dist-missing`); restore proven by `git diff | wc -c` and `git diff --cached | wc -c` both 0 through `rtk proxy … > file`.
- `ORCA_CCLOOP_BIN` for gates: a clone build of the pinned ccloop (Part A: `026c571`; Part C: the new pin). `CCLOOP_CACHE_DIR` in the scratchpad.
- `setup`: optional `string[]`, 1–8 entries, each 1–4096 bytes, no `\r` or `\n`. Absent ⇒ key omitted everywhere, never `[]`. One constant `SETUP_BOUNDS = { commands: 8, bytes: 4096 }` exported from `src/control/loopPlans.ts`.
- Cause `setup-failed`, phase `setup`. Ladder skip reasons: `"setup-failed"`, `"could-not-run"`.
- Refusal code `setup-unsupported-here` (saved-result recovery of a contract with `setupCommands`).
- The only existing criterion that may be rewritten: the split prompt and split schema pins `PINNED.splitPrompt` / `PINNED.splitSchema` in `tests/control/multiDirOverview.test.ts` (human: 「授权改写」), with a `Ruling:` line. Any other existing criterion that must change: stop and ask.
- Branches: `feat/task-setup-a` (Part A) and `feat/task-setup-c` (Part C) in worktrees under the session scratchpad; merge `--ff-only`; push is the human's.

## Review Focus

1. A workspace named by package name (`-w @orca/web`) as well as by path (`-w web`) is accepted when it exists. Test in Task C2.
2. A root `workspaces` glob (`"packages/*"`) is expanded against the commit's tree, not the disk. Test in Task C1.
3. A split task with `setup` in a multi-directory group cannot reach a contract (the multi schema has no `setup`). Test in Task C2.
4. The integration check of a group whose tasks have different setups runs each distinct command once, in first-seen task order, before its checks. Test in Task A4.
5. The ladder reading an unparseable or missing stored rejection keeps today's behaviour (retry). Test in Task A5.

---

## Part A — Orca, inert (mergeable before ccloop ships)

### Task A1: The `setup` phase and the `setup-failed` cause

**Files:** Modify `src/control/schema.ts:118-123`, `web/src/controlTypes.ts:416`, `web/src/RunReason.tsx:13-14`, `web/src/locales/en.ts` (~698-712), `web/src/locales/zh.ts` (~569+). Test: `tests/control/failureCauseRecord.test.ts`, `tests/control/ccloopPort.test.ts`, `web/tests/runReasonDiagnosis.test.tsx` (add cases).

**Interfaces:** Produces `runFailureCauseSchema.phase` = `z.enum(["plan","execute","verify","setup"]).nullable()`; `KNOWN_FAILURE_CAUSES` includes `"setup-failed"`; i18n `control.failureCause.label.setup-failed`, `control.failureCause.next.setup-failed`.

- [ ] **Step 1: Failing tests** — `"a setup-failed cause in phase setup parses in collect and the drive record"` (both parses accept `{cause:"setup-failed",phase:"setup",retries:0,detail:"npm ci exit=1"}`); web `"setup-failed has its own label and next step in en and zh"` (rendered text is not the unknown-cause text).
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/control/failureCauseRecord.test.ts tests/control/ccloopPort.test.ts > <log> 2>&1`; `cd web && npx vitest run tests/runReasonDiagnosis.test.tsx > <log> 2>&1`.
- [ ] **Step 3: Implement.** Label: en "Setup failed" / zh「准备步骤失败」; next: en "A setup command could not finish; see its output, fix the command or the repository, then retry." / zh「有一条准备命令没能完成。看它的输出，改命令或改仓库后重试。」
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Mutations** — A1-M1 drop `"setup"` from the enum ⇒ parse case red; A1-M2 drop the cause from `KNOWN_FAILURE_CAUSES` ⇒ web case red.
- [ ] **Step 6: Commit** `feat(control): read a setup-phase failure and word setup-failed`

### Task A2: `setup` through plan, recipe and contract

**Files:** Modify `src/control/loopPlans.ts` (`loopInputsSchema` :119, `loopPlanFileSchema` :176, `normalizeLoopInputs` :312, `expandRecipe` :261-290), `src/scheduler/planFile.ts:214-226` (`taskContractSchema.context`). Test: `tests/control/loopPlanSetup.test.ts` (new).

**Interfaces:**
- Produces `LoopInputs["setup"]?: string[]`, `LoopPlanFileInput["setup"]?: string[]`, `TaskContract["context"]["setupCommands"]?: string[]`, `SETUP_BOUNDS`, and `export const SETUP_CONSTRAINT: string` (the §4.8 text, exact): `"When a required check or a setup command cannot run, report it in your result; do not change the repository to make it run unless the task is about that. Install any dependency you add."`

- [ ] **Step 1: Failing tests** (`loopPlanSetup.test.ts`):
  - `"absent setup leaves recipe and contract bytes as committed"`: expanding the input used by `tests/control/loopPlanSkills.test.ts:25-36` reproduces `tests/control/fixtures/loopPlanGolden.json` exactly, and `"setup" in inputs` / `"setupCommands" in contract.context` are both `false`.
  - `"present setup reaches context.setupCommands and adds the constraint"`: `setup: ["npm ci"]` ⇒ `contract.context.setupCommands` equals `["npm ci"]`; `contract.context.constraints` ends with `SETUP_CONSTRAINT`.
  - `"setup is bounded"`: `[]`, 9 entries, a 4097-byte entry, `"a\nb"` are each refused by `loopPlanFileSchema`.
  - `"a plan file may give setup"`: `loopPlanFileSchema` → `normalizeLoopInputs` → `expandRecipe` keeps it.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (omit-when-absent, like `tokenBudget` in `normalizeLoopInputs`).
- [ ] **Step 4: Run, expect PASS**, plus `npx vitest run tests/control/loopPlanSkills.test.ts tests/control/planImport.test.ts tests/control/loopPlans.test.ts` unchanged and green.
- [ ] **Step 5: Mutations** — A2-M1 emit `setup: []` when absent ⇒ golden case red; A2-M2 always add the constraint ⇒ golden red; A2-M3 drop `setupCommands` in `expandRecipe` ⇒ present case red.
- [ ] **Step 6: Commit** `feat(plans): a task's optional setup reaches its contract as context.setupCommands`

### Task A3: Debug and system-debug contracts keep the task's setup

**Files:** Modify `src/control/debugPlan.ts:181-202` (`debugContract`), `src/control/systemDebug.ts:128-139` (`buildSystemDebugPlanSource`). Test: `tests/control/debugPlan.test.ts`, `tests/control/systemDebug.test.ts` (add cases).

- [ ] **Step 1: Failing tests** — `"a debug contract carries the original's setupCommands"` and the same for the system-debug source; both `"…omits it when the original has none"`.
- [ ] **Step 2–4:** FAIL, implement (copy when present), PASS.
- [ ] **Step 5: Mutation** A3-M1 drop the copy in `debugContract` ⇒ red; A3-M2 in `buildSystemDebugPlanSource` ⇒ red.
- [ ] **Step 6: Commit** `feat(debug): debug runs of a task keep its setup commands`

### Task A4: Orca's own check runs do the setup first

**Files:** Create `src/control/setupCommands.ts`. Modify `src/control/criteriaProtection.ts` (`checkPaths` :35, `CriteriaBaseVerdict` :123, `runChecksAtBase` :137-161), `src/control/debugRepro.ts` (`ReproFailure` :15, `checkReproduction` :94-118), `src/control/integrationCheck.ts` (`landedGroups` :54, `runIntegrationCheck` :70-82), callers `src/control/executionDriver.ts:957-983`, `src/control/webService.ts:1176`, `src/control/multiLanding.ts:406`. Test: `tests/control/criteriaProtection.test.ts`, `tests/control/debugRepro.test.ts`, `tests/control/integrationCheck.test.ts` (add cases), `tests/control/setupCommands.test.ts` (new).

**Interfaces:**
- Produces `export async function runSetup(workdir: string, commands: readonly string[], timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; command: string }>` (each through `exitsZero`, `src/control/debugRepro.ts:50`, in order, stopping at the first false).
- `CriteriaBaseVerdict` gains `{ kind: "base-setup-failed"; command: string }`; `ReproFailure` gains `"setup-failed"`; `IntegrationCheckRun`'s failure names the setup command with a `setup: ` prefix in its existing command field (builder: keep the type, prefix the string).
- `runChecksAtBase` and `checkReproduction` gain `setupCommands?: readonly string[]` (read by `startDebugCheck` from `contract.context.setupCommands`); `runIntegrationCheck` gains `setup: readonly string[]` after `commands` (callers pass the de-duplicated union of the landed tasks' `context.setupCommands`, first-seen order; `landedGroups` returns it beside `checks`).
- `checkPaths(requiredChecks, setupCommands = [])`.

- [ ] **Step 1: Failing tests**:
  - `"base run runs setup before checks"` (setup creates an ignored marker the check tests for) and `"a failing setup is base-setup-failed, not base-failed"`.
  - `"reproduction runs setup first"`, `"a failing setup is the setup-failed reproduction failure"`.
  - `"integration check runs each distinct setup once, in task order, before its commands"` (Review Focus 4: two tasks share `npm ci`, one adds `make gen`; a log file shows `npm ci`, `make gen`, then the check).
  - `"checkPaths reads paths from setup commands too"`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** Every consumer of `CriteriaBaseVerdict` handles the new kind (TypeScript exhaustiveness); its activity/panel wording reuses the base-run-failed text with the command shown as `setup: <cmd>`.
- [ ] **Step 4: Run, expect PASS** with the three existing files green.
- [ ] **Step 5: Mutations** — A4-M1 skip setup in `runChecksAtBase`; A4-M2 report setup failure as `base-failed`; A4-M3 run integration setups per task (duplicates); A4-M4 ignore setup in `checkPaths`. Each red.
- [ ] **Step 6: Commit** `feat(control): Orca's own check runs install a task's setup first`

### Task A5: The ladder leaves out what another try cannot fix

**Files:** Create `src/control/ladderSkip.ts`. Modify `src/control/priorFailures.ts:52-73` (export an uncut reader), `src/control/systemDebug.ts:328` (`LADDER_EXEMPT_CAUSES` + `setup-failed`), `src/control/webService.ts:760-798` (`systemDebugPass`, both levels), `web/src/controlApi.ts` (`activityKinds` + `ladder-skipped`), the task page component that renders run activity (`web/src/TaskDetail.tsx` or `RunReason.tsx`, builder finds where activity reasons show), locales. Test: `tests/control/ladderSkip.test.ts` (new, pure), `tests/control/ladderLevelOne.test.ts` (add cases), `web/tests/taskActivity.test.tsx` (add case).

**Interfaces:**
- `export async function readStoredRejection(store: ControlStore, runId: string, last: NonNullable<DriveRecord["lastFailure"]>): Promise<{ failingCommand: string | null; evidence: string[] } | null>` in `priorFailures.ts` (the existing `storedEvidence` uses it, then cuts as today).
- `export function couldNotRun(failingCommand: string | null, evidence: readonly string[]): boolean` and `export type LadderSkip = "setup-failed" | "could-not-run"` and `export async function ladderSkipOf(store: ControlStore, run: LadderRun): Promise<LadderSkip | null>` in `ladderSkip.ts`.
- `couldNotRun` algorithm (spec §4.7): `failingCommand` non-null; pick the entry `e` whose segments (split on `" | "`) have `segments[1] === "required check failed: " + failingCommand`; none ⇒ false; true iff the last segment is `exit=127` or `exit=126`, or the segment starting `stderr=` contains `command not found` or `Missing script:`.
- Activity row `{kind: "ladder-skipped", body: {reason: LadderSkip}}` written once per run (no second row on later passes); i18n `control.ladder.skipped.setup-failed` / `.could-not-run`: en "Not retried automatically: setup failed." / "Not retried automatically: the check could not run."; zh「没有自动重试：准备步骤失败。」/「没有自动重试：检查命令根本没能运行。」

- [ ] **Step 1: Failing pure tests** (`ladderSkip.test.ts`), evidence strings built with ccloop's exact shape `command output | required check failed: <cmd> | stdout=… | stderr=… | exit=<n>`:
  - exit 127 on the failing entry ⇒ true; `stderr=npm error Missing script: "test"` with `exit=1` ⇒ true.
  - `"ENOENT or command not found elsewhere does not count"`: in a passed entry (`required check passed: …`), and in the failing entry's `stdout=` ⇒ false.
  - `"an ordinary failure is not could-not-run"`: `exit=1`, stderr `AssertionError` ⇒ false; `failingCommand: null` (verifier rejection) ⇒ false.
- [ ] **Step 2: Failing pass tests** (`ladderLevelOne.test.ts`): `setup-failed` run ⇒ neither L1 retry nor L2 group, one `ladder-skipped` row; could-not-run run ⇒ same; the run that was itself the L1 retry and could-not-run ⇒ no L2 group; two verifier rejections (`required-check-failed` absent, stop reason "repeated failure pattern detected") ⇒ L1 retry still issued; unreadable stored rejection (Review Focus 5) ⇒ L1 retry issued; a second pass writes no second row.
- [ ] **Step 3: Failing web test**: a run whose activity has `ladder-skipped` shows the could-not-run sentence.
- [ ] **Step 4: Run, expect FAIL.** **Step 5: Implement.** **Step 6: Run, expect PASS.**
- [ ] **Step 7: Mutations** — A5-M1 match any evidence entry; A5-M2 skip only level 1; A5-M3 treat unreadable as skip; A5-M4 skip on the repeated-failure stop reason; A5-M5 remove `setup-failed` from the exempt set. Each red.
- [ ] **Step 8: Commit** `fix(control): the ladder does not retry a run whose setup failed or whose check could not run`

### Task A6: Saved-result recovery refuses a contract with setup

**Files:** Modify `src/control/savedResultRecovery.ts:112-151` (`applyVerifySavedResult`), `src/control/executionDriver.ts:356-365` (recovery dispatch). Test: `tests/control/savedResultRecovery.test.ts` (add cases).

- [ ] **Step 1: Failing tests** — `verify-saved-result` of a task whose contract has `setupCommands` ⇒ `ControlError('saved-result-unavailable', 'setup-unsupported-here')`; a recovery run reaching dispatch ⇒ `blockRun(…, "A2", "setup-unsupported-here")`.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Mutation** A6-M1 remove the refusal ⇒ red.
- [ ] **Step 6: Commit** `feat(recovery): saved-result recovery of a task with setup is refused by name`

### Task A7: Part A gate and merge

- [ ] **Step 1:** Rebase on main; build `web/dist`; `npm test > <scratch>/npmtestA.log 2>&1` in the background with `ORCA_CCLOOP_BIN` = ccloop `026c571` clone build; RC 0, skipped files copied from the log into the report.
- [ ] **Step 2:** Independent review (read-only subagent) of the Part A diff; fix; rerun affected files.
- [ ] **Step 3:** `git merge --ff-only feat/task-setup-a`; `npm run build`, web build; ask the human before restarting the installed panel (an agent does not run `orca panel restart`).

## Part B — ccloop

Follow ccloop `docs/superpowers/plans/2026-11-04-task-setup-ccloop.md` Tasks 1–4 in the ccloop repository, under its rules. Then the human pushes ccloop.

## Part C — Orca, after the push

### Task C0: Repin

- [ ] `node scripts/pin-ccloop.mjs <new ccloop main sha>` (only after `git ls-remote` shows it on origin), `npm ci`, commit `chore(deps): repin ccloop to <sha> for task setup commands`. Gate `ORCA_CCLOOP_BIN` from now on = a clone build of that sha.

### Task C1: The split's `manifests` view

**Files:** Create `src/control/requirementManifests.ts`. Modify `src/control/requirementOverview.ts` (export `readBlobs` / `treeOf` or add a small exported reader), `src/control/requirementCalls.ts:341-356,476-480` (split's `view`). Test: `tests/control/requirementManifests.test.ts` (new), `tests/control/clarifyOverviewWithoutStructure.test.ts` (add a case).

**Interfaces:**
- `export type ManifestsPart = { status: "ok"; entries: Array<{ dir: string; package: { name: string | null; scripts: Record<string, string>; workspaces: string[] | null } | null; lockfiles: string[]; present: string[] }>; cut: boolean }`.
- `export async function buildManifests(repo: string, commit: string, maxBytes = 32 * 1024): Promise<ManifestsPart>` — reads the commit's tree; root plus each `workspaces` entry (globs `*` / `**` expanded against tree paths, Review Focus 2); entries sorted by `dir` (`""` first); cut in that order at `maxBytes` of canonical JSON.
- `export function withManifests(built: BuiltOverview, manifests: ManifestsPart): BuiltOverview` — adds `manifests` and recomputes `canonicalJson` / `hash` over what is sent (as `withoutStructure` does). Split single-repo only; multi untouched.

- [ ] **Step 1: Failing tests** — root and `web` entries from a fixture repo with `workspaces: ["web"]`, scripts as committed (not as on disk after an uncommitted edit); glob expansion; lockfile and `present` detection; cut at a small `maxBytes` sets `cut: true` and keeps whole entries; split's sent overview has `manifests` and its hash differs from clarify's; clarify's has none.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Mutations** — C1-M1 read the disk instead of the commit; C1-M2 apply the view to clarify; C1-M3 skip glob expansion. Each red.
- [ ] **Step 6: Commit** `feat(requirements): the split sees the repository's manifests`

### Task C2: The split asks for `setup`, and code checks npm commands

**Files:** Create `src/control/npmCommand.ts`. Modify `src/control/requirementSchemas.ts:86-90` (`splitTaskSchema` + `setup`), `src/control/requirementSplit.ts` (`SPLIT_JSON_SCHEMA` :125-133 + `setup` property, not required; `loopOf` :160 carries it; `SPLIT_INSTRUCTION_V3` :46-77 new lines; `validateSplitDraft` :307 + `command:`; `explainSplitReason` :388). Rewrite: `tests/control/multiDirOverview.test.ts:31` `PINNED.splitPrompt`, `PINNED.splitSchema` (Ruling line). Test: `tests/control/npmCommand.test.ts` (new), `tests/control/requirementSplitItems.test.ts` (add cases).

**Interfaces:**
- `export type NpmPart = { script: string; workspace: string | null }`; `export function classifyNpmCommand(command: string): { kind: "npm"; parts: NpmPart[] } | { kind: "unverifiable" }` — split on `&&` (trimmed); each part exactly matches `npm test`, `npm run <s>`, `npm run-script <s>`, with at most one `--workspace <w>`, `--workspace=<w>` or `-w <w>` in any position after the subcommand; any other token anywhere ⇒ the whole command is unverifiable.
- `export async function npmCommandReason(repo: string, commit: string, command: string): Promise<string | null>` — for each part: the workspace (by root `workspaces` path, or by a workspace package's `name`, Review Focus 1) must exist; the script must be in that package's `scripts` at `commit` (`git show <commit>:<dir>/package.json`); else `command:<command>: <what is missing>`.
- Instruction lines added after the checks rule (:67), exact text:
  `- Each task may give "setup": the commands that make its checks runnable in a fresh clone (install dependencies, generate code). Infer them from "manifests" for the directories the task touches; use the lockfile's installer in its clean form (npm ci, pnpm install --frozen-lockfile, yarn install --immutable). Omit "setup" when nothing is needed.`
  `- A check must name a script or command that already exists in "manifests"; never plan to add a script so that a check exists.`

- [ ] **Step 1: Failing tests** (`npmCommand.test.ts`): verifiable forms with each workspace spelling; `cd web && npm test`, `npm test -- --x`, `FOO=1 npm test`, `npm run -ws x`, `npm run x --if-present` ⇒ unverifiable; with a fixture repo: missing script ⇒ reason; missing workspace ⇒ reason; `-w @orca/web` by name ⇒ null; a script present only in the uncommitted working tree ⇒ reason (reads the commit).
- [ ] **Step 2: Failing split tests**: a draft whose check is `npm test --workspace web` against a `web/package.json` without `test` gets a `command:` reason with its meaning from `explainSplitReason`; a draft with `setup` keeps it through accept into `context.setupCommands`; a multi-directory output with `setup` on a task is refused by `multiSplitOutputSchema` (Review Focus 3).
- [ ] **Step 3: Run, expect FAIL.** **Step 4: Implement.** **Step 5: Rewrite** the two `PINNED` hashes with `// Ruling: 2026-11-04 session af2ceee1, human 「授权改写」: the split prompt gains manifests and the setup lines (spec §6.3).` and check the word diff of old vs new prompt is only the new lines and the schema's `setup` property.
- [ ] **Step 6: Run, expect PASS**; `npx vitest run tests/control/splitPromptV3.test.ts tests/control/requirementSplit.test.ts` green unchanged.
- [ ] **Step 7: Mutations** — C2-M1 check `&&` parts independently; C2-M2 look up `manifests` instead of the commit; C2-M3 accept workspaces by path only; C2-M4 drop `setup` in `loopOf`. Each red.
- [ ] **Step 8: Commit** `feat(requirements): the split infers setup and names checks that exist`

### Task C3: Part C gate, merge, acceptance

- [ ] **Step 1:** As A7 Steps 1–3 for `feat/task-setup-c`.
- [ ] **Step 2: Acceptance (paid; ask the human first):** rerun the dogfood of ledger `2026-11-04-session-af2ceee1` (isolated panel, clone of Orca at the new main, codex gpt-6-luna, spend cap 3M tokens) with the same idea. Pass only if the task succeeds and lands on `orca/<groupId>`; otherwise record a C3 failure with its reason. Check `~/.orca` before/after and remove the run's `~/.codex/config.toml` trust entry after backing the file up.
- [ ] **Step 3:** Handoff (Orca §3 new section, §4.2, §8; ccloop and ccmem Orca sections in place).

## As built

(filled at the end)
