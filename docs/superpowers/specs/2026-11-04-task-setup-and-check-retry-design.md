# Task setup, checks that exist, and retries that can help

Date: 2026-11-04. Session `af2ceee1` (Claude Code, Opus 5.5). Observed on Orca `d090e3e8`, ccloop `026c571` (ccloop
main `aa7ec07` has the same `src`).
Status: design, reviewed (builder check, then an independent review; §9 lists what each changed). Cross-repository:
Orca and ccloop.

## 1. Why

The first agent-driven dogfood run (ledger `.superpowers/sdd/2026-11-04-session-af2ceee1/progress.md`) took one small
web bug in a clone of Orca from requirement to loop run. Clarify, split, estimate and confirm worked on codex. The loop
run spent 1,051,285 tokens and could not have passed, for three reasons:

- **F1** The required check ran in a fresh attempt worktree with no dependencies installed (`sh: vitest: command not
  found`, exit 127). Neither repository has any setup step: ccloop creates `<sourceDir>/run/worktrees/attempt-N` with
  `git worktree add` (ccloop `src/workspace/worktreeManager.ts:19-29`) and runs checks as `sh -lc <command>` in it
  (`src/controller/runLoop.ts:203-254`). So no check in any repository with dependencies can pass, Orca itself included.
- **F2** The split chose `npm test --workspace web`, and `web/package.json` has no `test` script. The split never sees
  a manifest: the overview's documents are only `README*`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`
  (`src/control/requirementOverview.ts:41`), and draft validation (`src/control/requirementSplit.ts:307-`) never checks
  that a command exists. Attempt 2 then edited `web/package.json` to add the script, out of the task's scope.
- **F3** After ccloop stopped the run (`required-check-failed`, `safeToRetry:false`), Orca's level-1 ladder retried the
  task at once (`src/control/webService.ts:771-785`, `src/control/systemDebug.ts:293-328`). It retries any failed
  terminal run except four causes and never asks whether another try can help.

The goal behind all three (the human, 2026-11-04): an agent operating Orca can take a requirement in any repository,
including Orca, to a finished group without a person filling in details.

## 2. What the human decided (verbatim, 2026-11-04)

- Setup differs by area of a repository, not by repository: 「每个仓库做不同方向的工作，检查命令可能差别很大。比如orca仓库的orca daemon 和 web 页面就不是一套东西」.
- Who decides setup: 「自己推断。如果人愿意，也可以提前由人提供（但是我理解人是懒惰的…大概率不会提供）」.
- Retries: 「希望在遇到一些非常明显问题的情况下，带着之前的问题，自动再试一次」. The controller then proposed two classes
  (class 1: the check ran and failed in a way the agent can fix ⇒ one automatic retry carrying the failure; class 2:
  setup failed, the command could not run, or another try cannot help ⇒ no retry, the task stops for a person, the
  task page says why), and the human answered 「对，就是第一类，这样分没问题」.
- Criteria: 「授权改写」 (the split prompt golden, §6.3), with 「派subagent review spec。修复完问题后继续写plan。」

## 3. Goals, non-goals, anti-goals

Goals
- G1 Each task can carry its own setup commands. In every attempt worktree they run after the worktree is created and
  before the agent's first phase, so the agent works, and the checks later run, with dependencies installed. An agent
  that adds a dependency installs it itself in its execute phase (the worktree carries into verify); setup is not run a
  second time.
- G2 The split infers setup and checks from the repository's real manifests, and Orca's code refuses a draft whose
  commands name a script or workspace that does not exist.
- G3 An automatic retry happens once, carrying the previous failure, only when the agent can plausibly fix what failed;
  otherwise the task stops and says why.

Non-goals (this round)
- Human-provided setup hints per directory in project settings. (Controller's call: deferred. A human who writes a plan
  file can already give `setup` per task, §4.2.)
- Multi-directory projects and saved-result recovery: refused by name (§5.4), not silently run without setup.
- Sharing or caching installed dependencies across attempts or runs.
- A per-check timeout in ccloop.

Anti-goals (would make this a failure even if it works)
- A setup step that hides what the agent changed: anything setup writes must not appear as the agent's change, and the
  agent's changes must not be mistaken for setup's.
- Orca refusing a command shape its code cannot check.
- A retry that cannot help, spending another million tokens; and, equally, a skip that stops a task which would have
  recovered.
- Setup output (for example `node_modules`) copied into Orca's run archive.

## 4. Behaviour

### 4.1 The overview the split sees (Orca)

The split's overview gains a `manifests` part. Clarify's overview does not (clarify asks about intent; its golden
prompt is unchanged), and the multi-directory overview does not (setup is refused there, §5.4). `manifests` is built
from the overview's commit, beside the cached overview parts, the way session `43913afc` made clarify's overview differ
from split's (`withoutStructure`, `src/control/requirementCalls.ts`). For the repository root and every directory a
root `package.json` names in `workspaces` (globs expanded against the tree), it lists:
- `package.json`: the `name`, `scripts` (names and bodies) and `workspaces` fields, nothing else;
- which lockfile exists there (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`);
- which of these exist there: `pyproject.toml`, `requirements*.txt`, `Makefile`, `Cargo.toml`, `go.mod`.
It is bounded (controller's call: 32 KiB, entries cut in path order, the cut named like the other parts), recorded and
hashed as sent.

### 4.2 Where `setup` lives (Orca)

A task gains optional `setup: string[]` (1–8 commands, each non-empty, one line, ≤ 4096 B). Absent means the key is
omitted everywhere, never `[]`, so recipe and contract bytes and hashes are unchanged (the pattern `skills` uses). Its
path through the strict schemas, each gaining the optional key:
- the split output: `splitOutputSchema` (`src/control/requirementSchemas.ts`); the multi-directory schema does not gain
  it;
- the loop inputs and the plan file: `loopInputsSchema`, `loopPlanFileSchema`, `loopRecipeSchema`,
  `normalizeLoopInputs`, `expandRecipe` (`src/control/loopPlans.ts`), so a human-written plan file may also give it;
- the task contract: `taskContractSchema.context.setupCommands` (`src/scheduler/planFile.ts`);
- contracts Orca builds for other runs of the same task carry it too: the debug plan (`src/control/debugPlan.ts`) and
  the system-debug plan (`src/control/systemDebug.ts`).
The split instruction says: infer setup and checks from `manifests`, per task, for the directories the task touches;
prefer the repository's own install and check scripts; use the lockfile's installer in its clean form (`npm ci`,
`pnpm install --frozen-lockfile`, …); name checks that exist; do not plan to add a script to make a check exist.

### 4.3 Draft validation (Orca, F2)

`validateSplitDraft` gains a `command:` reason, explained in `explainSplitReason` (`src/control/requirementSplit.ts`).
Every command in `setup` and `checks` is classified by code:
- **Verifiable**: the whole command is one or more parts joined by `&&`, and every part is exactly one of `npm test`,
  `npm run <s>`, `npm run-script <s>`, each with at most one of `--workspace <w>` / `--workspace=<w>` / `-w <w>`, and
  nothing else (no other flag, no `--` arguments, no environment prefix, no `cd`).
- Anything else is **unverifiable** and is never refused.
A verifiable part is checked against the overview's commit itself (`git show <commit>:<dir>/package.json`, as
`overviewPathExists` does), not against the cut `manifests`: the script (`test` for `npm test`) must be in that
package's `scripts`, and `<w>` must be a workspace of the root `package.json` (by path or by package name). A refused
draft goes through the existing automatic redraft (`MAX_AUTO_RETRIES` = 2), the reason naming the command and what is
missing.

### 4.4 Running setup (ccloop, F1)

The loop contract gains optional `context.setupCommands: string[]` (min 1, max 8 when present; no default). Orca puts
the task's `setup` there. ccloop's strict contract schema refuses the key today, so an older ccloop refuses such a
contract by name; Orca pins ccloop and repins only after ccloop ships it (§5.1). No features key is added.

In every attempt, after the attempt worktree is created (and after a continuation's predecessor tree is restored into
it, ccloop `src/control/materialize.ts:159-167`) and before the agent's first phase, ccloop runs each setup command in
order, the way it runs a check (`sh -lc`, cwd the worktree, the same environment and abort signal; controller's call: at
most 15 minutes per command, within the attempt's remaining time).

- **Cleanliness**: ccloop fingerprints the worktree before setup and after it (the binary tracked diff against `HEAD`,
  plus every untracked non-ignored path with its content hash) and fails the attempt, naming the changed paths, when
  they differ. A fresh attempt starts clean, so this is "setup wrote only ignored files"; a continuation starts with its
  predecessor's tree and the comparison still holds. (Controller's call, builder check Q1.)
- **Failure** (non-zero exit, the time limit, or a changed tree) ends the run:
  - status `failed`; the attempt counts as used; no agent phase of that attempt runs;
  - `failureCause: { cause: "setup-failed", phase: "setup", retries: 0, detail }`, where `detail` fits ccloop's
    512-byte bound: `<command> exit=<n>` | `<command> timeout` | `<command> changed: <paths>`;
  - the command's stdout and stderr are written to the attempt's directory in the run directory (controller's call:
    `attempts/<n>/setup-<i>.log`, bounded like check output);
  - the attempt's usage is a measured 0 (not null: Orca cannot settle a null-usage run, ccloop
    `src/controller/runLoop.ts:247-249`); earlier attempts' usage is reported as today;
  - not retried inside ccloop; `setup-failed` is not in `RETRYABLE_CAUSES`;
  - the attempt worktree is cleaned up exactly as for any other failed attempt.
- `resumeLoop` after a crash during setup cleans the residual worktree up and continues at the next attempt on a fresh
  worktree, which runs setup again; the crashed attempt stays counted (ccloop `src/controller/resumeLoop.ts:172-187,
  398-415`, today's behaviour for any crash).
- ccloop's own cause list `FAILURE_CAUSES` (`src/runtime/failureCause.ts:9-17`) is closed and collect's parse refuses a
  cause outside it (`src/control/command.ts:215-218`), so `setup-failed` is added there; the phase enum is widened in
  every ccloop zod schema that declares it (the same parse).
- The zero usage of a setup-failed attempt is written as an explicit measured-zero observation: no phase settles on
  that path, and today it would record none.
- Setup time counts toward the attempt's active time.

### 4.5 Orca reads the new phase and cause (Orca)

`phase` is a closed enum on both sides (Orca `src/control/schema.ts:120`, used by collect, the drive record and the web
protocol; ccloop `src/runtime/failureCause.ts:27`). Orca's enum gains `setup` first; ccloop's then gains it. `cause`
is already an open bounded string, so only the panel needs `setup-failed`: `web/src/RunReason.tsx`'s cause list and
en/zh text. The task page shows the cause's `detail` (the failing setup command and its exit, timeout or changed paths),
as it does for every cause; the full setup log is reachable through the run's evidence list. (Controller's call while
planning: no new log viewer this round.)

### 4.6 Orca's own check runs get setup too (Orca)

Orca runs required checks itself in three places, each in a directory that would otherwise have no dependencies:
the criteria base run (`runChecksAtBase`, `src/control/criteriaProtection.ts:137-170`), the debug reproduce-first check
(`checkReproduction`, `src/control/debugRepro.ts`), and the integration check (`runIntegrationCheck`,
`src/control/integrationCheck.ts:70`). Each runs the task's setup commands, in order, in its directory before its
checks; a setup failure there is reported as that step's own could-not-run result (for example `base-run-failed` with
the setup command named), never as a check verdict. `checkPaths` (`criteriaProtection.ts:35`) also reads paths from
setup commands.

### 4.7 The ladder retries only what an agent can fix (Orca, F3)

The ladder (`ladderCandidates`) keeps today's level-1 retry with `priorFailures`
(`src/control/executionDriver.ts:404-410`) and, after it, today's level-2 debug group, for every ordinary failure. A
run is left out of the whole ladder, both levels, recorded with its reason, when either holds:
- the cause is in `LADDER_EXEMPT_CAUSES`, which gains `setup-failed`;
- the run's last rejection is `required-check-failed` and **its failing command could not run**. Matched by code on the
  raw stored rejection (the collector's copy, not the 4096-byte-cut `priorFailures` copy), only on the one evidence
  entry whose second segment is `required check failed: <failingCommand>` (ccloop `buildRequiredCheckEvidence`,
  `src/controller/runLoop.ts:155-185`): its last segment is ` exit=127` or ` exit=126`, or its `stderr=` segment
  contains `command not found` or `Missing script:`.
This holds for a run that was itself the level-1 retry: it opens no debug group.
When the stored rejection cannot be read, the run keeps the ladder (fail open).
ccloop's repeated-failure stop is **not** a skip condition: its rule (`src/stop/stopController.ts:9-18`) matches two
verifier rejections (both `failingCommand: null`) and two failures of the same command with different output, so it
would skip ordinary failures (independent review C-1).

A left-out run leaves the task stopped for a person. The task page shows "not retried automatically", the reason, the
failing command and the evidence tail. A person's own `task retry` is unchanged.

### 4.8 The agent is told not to bend the repository (Orca)

A task contract whose task has `setup` gains one constraint (controller's call: only then, so contracts without setup
keep their bytes and the plan version does not move): when a required check or a setup command cannot run, report it in
the result; do not change the repository to make it run unless the task is about that; install a dependency you add.

### 4.9 Archives (Orca)

A run archive never contains files setup produced. Builder to confirm ccloop removes attempt worktrees before Orca's
`archiveRun` walks `<sourceDir>` (`src/control/archive.ts:181`); if any path keeps one, the walk excludes
`run/worktrees`.

## 5. Constraints

5.1 Order across repositories: Orca first (the `setup` phase in its enum, the contract key in its schemas, the cause in
the panel, all inert while ccloop emits none of them); then ccloop (contract key, setup step, phase); the human pushes
ccloop; Orca repins (handoff §5.2.4) and only then may a split emit `setup`. Until the repin, Orca's split does not ask
for `setup` (controller's call: the split instruction change lands with the repin).

5.2 Unchanged bytes: a contract, recipe, envelope and collect without `setup` are byte-for-byte what they are today in
both repositories. ccloop's features answer is unchanged. The clarify prompt is unchanged.

5.3 Refused by name in this round (`setup-unsupported-here`): `setup` on a task of a multi-directory group, and
`verify-saved-result` / saved-result recovery of a run whose contract has `setupCommands`.

5.4 Rule 17 / sandbox: setup runs in the attempt worktree or Orca's own check directory only; it may use the network.
What the command itself writes elsewhere (npm's cache) is its own behaviour, named in the handoff.

## 6. Criteria

### 6.1 Gates (commands)

- Orca: `npm test` (selected by `scripts/test-affected.mjs`, includes typecheck) RC 0, output redirected to a file.
- ccloop: full `vitest --reporter=json` then `node scripts/check-known-reds.mjs <json>` RC 0, in a built
  `git clone --local` copy.

### 6.2 New criteria, each seen red by its named mutation in a `git clone --local` copy

Run as `npx vitest run <file> > <log> 2>&1` in the copy. File names are the builder's; one row per branch:

| # | Repo | Behaviour | Mutation that must turn it red |
|---|---|---|---|
| 1 | Orca | split overview has `manifests`; clarify's has none | build manifests for clarify too / not for split |
| 2 | Orca | `npm run x -w web` refused when `x` missing; when workspace missing | skip the script lookup / skip the workspace lookup |
| 3 | Orca | `cd web && npm test`, `npm test -- --x`, `FOO=1 npm test` not refused | check `&&` parts independently |
| 4 | Orca | the lookup reads the commit, so a cut `manifests` does not matter | look the script up in `manifests` |
| 5 | Orca | absent `setup` ⇒ recipe and contract bytes equal the committed golden; present ⇒ `context.setupCommands` | emit `[]` when absent |
| 6 | Orca | debug and system-debug contracts carry the task's `setupCommands` | drop it in `debugPlan` |
| 7 | Orca | collect and drive record parse a `setup-failed` / `phase: "setup"` terminal | leave `setup` out of the enum |
| 8 | Orca | base run, reproduce check, integration check run setup first | skip setup in `runChecksAtBase` |
| 9 | Orca | ladder leaves out `setup-failed` at both levels | remove it from the exempt set |
| 10 | Orca | ladder leaves out exit 127 / `Missing script:` on the failing entry, at both levels, also for a level-1 retry run | match any entry / only level 1 |
| 11 | Orca | `ENOENT` or `command not found` in a passed check's stdout, or in the failing check's stdout, does not skip | match the whole evidence array |
| 12 | Orca | two verifier rejections, and an ordinary check failure, still get the level-1 retry | skip on the repeated-failure stop |
| 13 | Orca | unreadable stored rejection keeps the ladder | treat unreadable as skip |
| 14 | Orca | constraint present iff `setup` present | add it always |
| 15 | Orca | multi-dir `setup` and saved-result recovery with setup refused `setup-unsupported-here` | accept them |
| 16 | ccloop | setup runs before plan, after a continuation's restore | run it after plan |
| 17 | ccloop | `setup-failed` on non-zero exit, time limit, changed tree (fresh and continuation); no agent call; usage measured 0; `detail` ≤ 512 B | ignore the exit code / skip the fingerprint / report usage null |
| 18 | ccloop | absent `setupCommands` ⇒ contract and argv goldens unchanged | default to `[]` |
| 19 | ccloop | `setup-failed` not retried | add it to `RETRYABLE_CAUSES` |

### 6.3 Existing criteria that change (authorized)

Only Orca's split prompt golden (the `manifests` part and the instruction lines), by the human's 「授权改写」. Each
rewrite carries a `Ruling:` line. No ccloop criterion changes; if implementation finds one that must, it stops and asks
the human by name (ccloop Rule 15).

### 6.4 Acceptance (paid, asked first)

C3: a second dogfood run, the same bug in a clone of Orca, on codex. Passes only if the task succeeds and lands on
`orca/<groupId>`. Any other ending is recorded as a C3 failure with its named reason.

## 7. Left to the builder

The `manifests` cut rule within its budget; the setup per-command limit and log file names; i18n wording; how the
activity row records a ladder skip; how `runChecksAtBase` reports a setup failure within its existing verdict type.

## 8. Risks

- Setup adds minutes per attempt (one `npm ci` in Orca's clone: about a minute in this session's measurement of
  `npm ci --prefer-offline` on the target clone; not measured per attempt).
- A model may still pick an unverifiable command that does not exist; §4.7's could-not-run skip catches it at run time
  without a retry.

## 9. Review record

- Builder check (subagent, 2026-11-04): Q1 continuation tree (⇒ before/after fingerprint), Q2 ladder level 2 (⇒ both
  levels), Q3 golden authorization (⇒ asked; 「授权改写」), Q4 features key (⇒ first a features key; replaced after the
  independent review by the strict contract refusal, so no ccloop criterion is rewritten), check timeout (⇒ dropped).
- Independent review (subagent, 2026-11-04): C-1 repeated-failure skip removed (§4.7); C-2 `phase` enum on both sides
  (§4.5); I-1 `detail` 512 B, output to a log (§4.4); I-2 match only the failing entry, raw copy, fail open (§4.7);
  I-3 Orca's own check runs and debug contracts (§4.2, §4.6); I-4 constraint only with setup (§4.8); I-5 schema path
  and plan import (§4.2); I-6 no features key (§4.4, §6.3); I-7 lifecycle (§4.4); I-8 setup once, agent installs what
  it adds (§3 G1); I-9 whole-command verifiability (§4.3); M-1 commit lookup (§4.3); M-2 contract always carries it
  (§4.4); M-3 the class quote (§2); M-4 manifests split-only (§4.1); M-5 archive (§4.9); criteria table and C3 (§6).

## 10. Corrections (implementation, session af2ceee1, 2026-11-05)

Appended after the spec was committed (`d222dfb2`); the text above is unchanged (CLAUDE.md Rule 13). Each line is a
controller ruling recorded in the SDD ledgers (`.superpowers/sdd/2026-11-04-task-setup-and-check-retry/progress.md`,
ccloop `.superpowers/sdd/2026-11-04-task-setup-ccloop/progress.md`).

- §4.4 time: setup's measured elapsed time is deducted from the attempt's remaining time before the first phase, and
  every setup that ran (ok, failed, handoff, error; not a lease loss) writes one usage observation `attempt-<n>-setup`
  (running-total tokens, measured elapsedMs, evidence kind `setup-ended-attempt-v1` with `outcome`). Without it a handoff
  during attempt 1's setup would leave Orca's work usage unknown forever.
- §4.4 failure detail gains `<command> signal=<NAME>` and `<command> error=<message>` (or `setup error=<message>`); a
  timeout bounded by the attempt's remaining time (not the 15-minute per-command cap) ends `exhausted` with the
  budget-exhausted reason, like a phase out of time.
- §4.4 log: each setup log is capped at 16 MiB with one truncation marker line; per-command `process.json`/`outcome.json`
  under `attempts/<n>/setup-<i>/` let resume reap a setup group left by a crash; the group is SIGKILLed when the command
  ends; after an exit a 2 s drain bounds a pipe held by an escaped process. A command whose process registration
  happens through the worker's hook; a pending handoff at registration ends at the handoff boundary.
- §4.4 handoff: a handoff during setup ends at `handoff_interrupted`/`handoff_boundary` like a phase; a handoff
  requested during a successful setup stops before the first phase.
- §4.4 / §4.9 archive: with setup, ccloop's result repository copied from a live worktree leaves out git-ignored
  paths, and Orca's own check runs remove ignored paths they created, so archives carry no setup output.
- §5.3: ccloop also refuses `setupCommands` with `additionalRepos` in the contract schema, and both repositories
  report saved-result eligibility as unavailable for a contract with setup (ccloop `control-setup-recovery-unsupported`,
  Orca `setup-unsupported-here`); Orca blocks a multi-directory run with setup at A2.
- §4.4 no features key (as already recorded in §9): an older ccloop refuses the contract key by its strict schema.
- §4.2: the conflict-resolution contracts (`integrationContractOf`, both reconcile builders) and system-debug groups
  opened from the integration check or model-review findings also carry the union of the involved tasks' setup.
- §4.6: a failing setup in the integration check is a could-not-run result (`errored`, no system-debug group, the
  watermark kept), not a red check.
- §4.7: a `required-check-failed` candidate is held while its verification has not been collected (bounded by 10
  minutes from its `run-blocked` row; the pass schedules a collection), then decided; the skip row carries the failing
  command and the task page shows it; the setup-failed cause line shows its detail.
- §4.3: `-w .`, `-w <a parent directory of a workspace>`, the built-in `npm run env`, and a package.json that cannot be
  read or parsed are unverifiable (never refused). The split's answer template lists `"setup": optional`; the prompt
  head stays "version 3" (compatible superset).
- §4.1: yarn's object form `workspaces: {packages: [...]}` is read; a manifests build failure blocks the split like an
  overview failure; a root entry larger than the budget leaves `entries: []`, `cut: true`.
- §4.5: the full setup log is reached through the run's evidence/archive; no new log viewer.
- Not done this round (registered in the handoff): the 2 s drain cut is silent; an out-of-time setup's stop reason is
  always budget-exhausted wording; exempt causes other than setup-failed get no skip row; a human plan file with setup is
  refused by ccloop 026c571 until the repin.
- §6.4 C3 result (2026-11-05): PASS on Part C's build with ccloop 5e10091 (ledger `2026-11-04-session-af2ceee1`): the split
  inferred `setup: ["npm ci"]` and the existing check `npm run check --workspace web`; attempt 1 passed and landed. The
  target's `npm ci` prepare script set `core.hooksPath` in the clone's shared git config (§5.4, the command's own
  behaviour).

## 11. Correction (session 3cfc2e73, issue #135, branch `fix/estimate-plan-split`, 2026-11-05)

Appended on top of `3cdced36`; the sections above stay as committed (Rule 13). Where this section and §4.1 disagree,
this section holds.

1. **§4.1 `package.json` fields: `type` is sent too, when the package gives it.** §4.1 said "the `name`, `scripts`
   (names and bodies) and `workspaces` fields, nothing else". The split has no tools, so with the module type stripped
   it guessed, and a tester's split wrote `node -e "require(...)"` checks in a `"type": "module"` repository (issue
   #135). `packageOf` (`src/control/requirementManifests.ts`) now adds `type` when it is a string; a package without one
   is sent with the same bytes as before, so an existing overview's hash does not move. `main` and `exports` are not
   added (`exports` can be large and nested; `type` alone decides how `node` loads a `.js` file).
2. **Not done here, reported to the controller:** the split-prompt rule against ad-hoc `node -e require(...)` checks
   (#135) and the "no lockfile ⇒ `npm install --no-package-lock` or no setup" instruction (#130). Any change to the
   single split instruction's text moves the pinned prompt hash in `tests/control/multiDirOverview.test.ts`
   (`PINNED.splitPrompt`), and a validator refusing `npm ci` without a lockfile reddens
   `tests/control/requirementSplitItems.test.ts` ("checks every setup command too", which uses `npm ci` in a repository
   with no lockfile). Existing criteria are not rewritten without the human's authorization.
3. Criteria: `tests/control/requirementManifestsType.test.ts`.

## 12. Correction (session 3cfc2e73, issues #130 and #135, after the human's 「这个session允许改写必要的判据」)

Supersedes §11 item 2. The single-repository split instruction (still "version 3", as earlier text changes under a human
authorization kept it) gains two rules: with no lockfile in `manifests`, omit setup when nothing needs installing,
else `npm install --no-package-lock` (§4.2's "use the lockfile's installer" holds only when there is a lockfile; #130);
and prefer the repository's own test scripts as checks, no ad-hoc `node -e` module-loading checks (a package's `type`
in `manifests` says ESM or CommonJS), no assertions about files not shown (#135). The validator is unchanged.
Criteria: `tests/control/splitPromptRules130135.test.ts`; the prompt pin in `tests/control/multiDirOverview.test.ts` moved.
