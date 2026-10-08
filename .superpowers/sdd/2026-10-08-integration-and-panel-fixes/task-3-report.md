# Task 3 report: the integration pass (`local`, `push-target`, `push-branch`), the shared runner, `retry-integration`

Implementer: subagent of session eaee0f2c, attempt 2, 2026-10-08. Branch `feat/integration-schemes`, base `5fc4870`.
Every git command used `git -C <abs path>`; the main checkout `/Users/biran/code/skills/loop/Orca` was not touched.
Commits:
- `03aefc3` feat(control): integrate a group's work into its target after each task or group
- `18034e5` test(control): pin every branch of the integration pass, dropping the ones no criterion can see
- `7ac5e94` refactor(control): leave timeouts and fetch network errors to the one place that judges them

## What was implemented

- `src/control/integrationGit.ts` (new), the shared runner: `runChild(bin, args, {cwd, input?, quiet?})` spawns with
  `detached: true` and an argv array. Its env is `unsetInheritedGitEnv()` plus `GIT_TERMINAL_PROMPT=0`,
  `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, `GH_PROMPT_DISABLED=1` and `GH_NO_UPDATE_NOTIFIER=1`. `quiet` prepends
  `QUIET_GIT`.
  - On a timeout (`ORCA_INTEGRATION_TIMEOUT_MS`, default 60000) it SIGKILLs the whole process group and rejects at once
    with `ChildTimeout`. A spawn failure rejects with `ChildSpawnFailed`. It never throws on a non-zero exit.
  - `__setRunChildForTests` / `spawnRunChild` are the spy seam.
  - Helpers: `classifyNetwork`, `pushPorcelain` (→ `"ok" | "moved" | {refused} | {failed, transient}`),
    `remoteTip`, `remoteHas`, `fetchInto`, `isAncestor`, `refTip`, `revParse`, `gitOk`.
  - `fetchInto` fetches into the Orca-owned `refs/orca/integration/<g>/{target,work}` with `--no-write-fetch-head`, so
    the person's FETCH_HEAD is never written. It throws `BranchMissing` when the remote answers without the branch, and
    `RemoteFailure(transient)` when the remote does not answer.
- `src/control/integrationPass.ts` (new): `integratePendingGroups(deps)`, with `IntegrationDeps` as the brief describes
  plus the test seam `beforePublish`.
  - Groups are visited in id order. Before each group the pass checks that the driver is not stopped and the panel is
    not draining.
  - Due rule (spec §5):
    - The group has a frozen record in state `idle` whose `retryAfter` has passed.
    - It is not `groupStopped` (stop or pause; a budget-blocked group still integrates).
    - `orca/<g>` exists and its tip ≠ `lastIntegrated`.
    - Trigger `group`: every task work item is `done` and no run has `active=1`.
    - Before the first integration, a tip already contained in the local target, or in `refs/remotes/<r>/<target>`,
      counts as no landed work.
  - The pass reads keep groups (no record) and skips them before any git child runs.
  - `push-branch` and `github-pr`: the remote must be configured, otherwise `integration-remote-missing`. Re-entry
    checks `remoteHas`. Then the write-ahead `pending` record, `crash("after-pending")`, and a push of
    `<tip>:refs/heads/orca/<g>`. A push answered `moved` blocks `integration-work-branch-diverged`; then
    `crash("after-publish")`.
  - `finishWorkBranch` is the named hook for §6.1 step 5. Task 4 fills it with `syncGroupPr`; it runs no `gh` today.
  - `local` and `push-target` go through `computeAndPublish`, which reads the base, computes `new`, writes `pending`,
    then calls `crash`, `beforePublish`, publish and `crash` again. When the base moved, it clears `pending` and
    recomputes once; moving again blocks `integration-target-moved`. A tip the base already contains is recorded as
    done without a commit, and `integratedCommit` stays unchanged.
  - Computing `new`:
    - `squash`: `merge-tree --write-tree --name-only --merge-base=<lastIntegrated ?? merge-base>`, then
      `commit-tree -p base` with the message "orca: integrate g (n landings)". Exit 1 is a conflict.
    - `merge`: `git worktree add --detach <workspacesRoot>/integrate-<g>`, then `merge --no-ff` with `ORCA_IDENTITY`.
      On unmerged paths it runs `merge --abort` and records a conflict. The workspace is removed by name before and
      after: `worktree remove` if registered, then `rm` and `worktree prune`.
  - `local` publish (§6.3):
    - When no worktree has the target checked out: CAS `update-ref`. A target that moved returns `moved`. A refusal
      while the ref is still at base throws, and the pass backs it off.
    - When a worktree has it checked out: a dirty worktree (`status --porcelain --untracked-files=all`) blocks
      `integration-worktree-dirty`. A HEAD that `new` does not descend from blocks `integration-not-fast-forward`.
      Otherwise the pass runs `merge --ff-only` in that worktree, under `QUIET_GIT`.
  - `push-target` publish: push `<new>:refs/heads/<target>`. A `moved` answer recomputes. A refusal blocks
    `integration-push-refused:<git's words>`; a transient failure backs off.
  - Settling (§6.1 step 6, §6.5) is one write that re-reads the group. If `schemeHash` changed, the write is dropped.
    - done: sets `lastIntegrated`, `integratedCommit`, `pending: null`, `idle`, `transient: 0`.
    - blocked: sets `reason` and `pending: null`.
    - conflict: sets `conflict: {attempt: prev+1, key: "integrate-<g>-<attempt>", base, tip, paths}` and dispatches
      nothing.
    - transient: `retryAfter = now + min(30000·2^transient, 600000)` and `transient + 1`. A transient failure does not
      count as progress.
  - Any other error, timeouts included, is logged on stderr and backed off as transient. A throw from the crash hook is
    carried out unchanged through the `Crashed` wrapper.
- `src/control/executionDriver.ts`:
  - `CrashPoint` gains `IntegrationCrashPoint`.
  - `integrationDepsOf(deps, context)`: the repo path comes from `resolveRepository`, the clock from `deps.now`,
    `ghBin` from `ORCA_GH_BIN || "gh"`, and `crash` is passed through. A DriverCrash ends the driver as for runs.
  - After the export block the driver calls `try { if (await integratePendingGroups(...)) progressed = true; } catch
    (panel-draining → return progressed)`.
- `retry-integration` (human-only):
  - Protocol: the verb, the raw and effective unions (group target, empty payload) and the result
    `{ kind: "integration-retried", groupId }`. It is not projectionless.
  - `applyRetryIntegration` moves `blocked`/`conflict` to `idle` (`reason`, `retryAfter` null; `transient` 0). It
    keeps `conflict`, which numbers the next attempt. Anything else is refused `integration-not-blocked`.
  - Wiring: `service.retryIntegration`, the route `POST /api/control/groups/:groupId/integration/retry`, `VERB_ACCESS`,
    a SKILL.md row and owner-only line, and the web types.
- Deferred minors closed:
  - (a) `checkScheme`/`preflightScheme` run on the shared runner. When a git child times out or cannot be started they
    return the check `git`. A `gh` that cannot be started reads as `gh-auth`.
  - (b) A repository path that does not resolve (a `resolveRepository` refusal, or no resolver at all) is the check
    `repository`. The setters refuse `git`/`repository` as `integration-preflight-failed:<check>`
    (`ENVIRONMENT_CHECKS`); a bad name stays `integration-invalid`. All of them are booked through the transaction. The
    TOCTOU `githubRepoOf(...)!` now answers `remote-not-github`.
  - (c) The test title is now "a confirmed keep group's new scheme is frozen at once".
  - Both setters run their git checks before entering the admission gate.

## TDD evidence

The implementation was written before the tests in this attempt. RED was then shown by running the new criteria
against the base source in the mutation clone:
- `$S/t3-red.txt`, base `src` with the new modules left in place: rc=1, 13 failed. The failures:
  - `retryIntegration is not a function`
  - the driver crash test: `expected null to be 'after-pending'`
  - `expected 'target-name' to be 'git'`
  - `Error: control-path-changed` (unbooked)
  - skill counts 27≠28
  - the retry route answered `route-not-found`
- `$S/t3-red2.txt`, with `integrationGit.ts`/`integrationPass.ts` removed: rc=1, both new files fail with `Cannot find
  module '../../src/control/integrationGit.js'`.

GREEN:
- `$S/t3-g6.txt`: integrationGit and integrationKeep, rc=0, 26 tests.
- `$S/t3-g5.txt`: integrationScheme, integrationKeep, executionDriver and requirementExport, rc=0, 96 tests.
- At the tip `7ac5e94`: `npm run typecheck` rc=0 (`$S/t3-tc8.txt`), `npm run --ws check` rc=0 (`$S/t3-web.txt`, run
  at `03aefc3`; no web change since).
- Broad `vitest run tests/control tests/panel tests/entry` at the tip (`$S/t3-broad3.txt`): rc=0, 202 files passed / 8
  skipped, 1913 tests passed / 52 skipped. The skips are the real-ccloop criteria.
- With `ORCA_CCLOOP_BIN=$S/ccloop-new/dist/cli.js`, executionDriverE2E and usageByModelE2E (`$S/t3-e2e2.txt`): rc=0,
  10 passed.
- An earlier broad run at `03aefc3`, before two fixes (`$S/t3-broad.txt`), was rc=1 with 3 reds:
  1. `agentFreeze` "re-checks where each field came from" was a real regression. I had moved confirm's integration
     preflight before the gate, ahead of `resolveGroupSelections`, and that test needs the selection resolution to
     start before anything awaits. Confirm's preflight is back where Task 2 put it, inside the gate, so only the setters
     run their checks outside the gate.
  2. and 3. Two integrationGit tests hit the 5 s default timeout under load (load average 11). Every integrationGit
     describe now allows 60 s.

## Mutation table

Mutations ran in `git clone --local` at `7ac5e94` (`$S/mut-t3`), with `node_modules` symlinked and `web/dist` copied.
The clone baseline (`$S/mut-t3-baseline.txt`) is rc=0, 88 passed. The driver is `$S/mut-t3-run.py`, the summary is
`$S/mut-t3-summary.txt`, and each mutation's output is in `$S/mut-t3-<id>.txt`. Each mutation was restored with
`git checkout -- .`, and `git diff | wc -c` / `git diff --cached | wc -c` were 0/0 for every row.

The first pass had problems with 4 rows, which were re-run (`$S/mut-t3-progress2.txt`):
- M3-1's replacement did not parse.
- For M3-2, M3-50 and M3-52, `-t "7 (H5)"` is a regex and matched no test.

All 53 are red. G = integrationGit.test.ts.

| id | mutation | red test | seen red |
|---|---|---|---|
| M3-1 | squash merge base = fork point (no `lastIntegrated`) | G 3 | `match object { state: 'idle', conflict: null }` (conflict instead) |
| M3-2 | H5 clean check removed | G 7 | `match object { state: 'blocked', … }` |
| M3-3 | no timeout | G 8 | the test ran 5766 ms; first red is `expected true to be false` (the hang ended after 5 s and the push failed permanently) |
| M3-4 | push-target `moved` treated as refused | G 5 | `expected 1 to be 2` (moves) |
| M3-5 | the pass runs git for a keep group | keep | `expected [[git, rev-parse…]…] to deeply equal []` |
| M3-6 | paused check removed | G 12 | `expected true to be false` |
| M3-7 | "nothing landed" check removed | G 1 | `expected true to be false` |
| M3-8 | trigger-group completeness removed | G 4 | `expected true to be false` |
| M3-9 | active-run check removed | G 4 | `expected true to be false` |
| M3-10 | `retryAfter` skip removed | G 8 | `expected 2 to be 1` |
| M3-11 | frozen check removed | G 12 | `expected true to be false` |
| M3-12 | idle-state check removed | conflict test | `expected true to be false` |
| M3-13 | `tip === lastIntegrated` removed | G 1 | `expected true to be false` |
| M3-14 | push-branch remote-config check removed | push-branch table | `match object { state: 'blocked', … }` |
| M3-15 | work-branch-diverged removed | G 9 | `match object { state: 'blocked', … }` |
| M3-16 | refused-push branch removed | G 6 | `'integration-push-refused:undefined' to match /…pre-receive…/` |
| M3-17 | failed push never transient | push-branch table | `expected true to be false` |
| M3-18 | `classifyNetwork` always null | push-target network | `expected true to be false` |
| M3-19 | local target missing not detected | local test | `expected false to be true` |
| M3-20 | local CAS "moved" removed | local test | `expected false to be true` |
| M3-21 | locked ref read as "moved" | local test | `expected true to be false` |
| M3-22 | not-fast-forward check removed | H5 not-ff | `expected false to be true` |
| M3-23 | "base already contains tip" removed | already-contains test | `match object { …(4) }` |
| M3-24 | merge conflict not recorded | conflict test | `expected false to be true` |
| M3-25 | squash conflict not recorded | squash conflict | `expected false to be true` |
| M3-26 | recompute twice before blocking | G 5 | `expected 3 to be 2` |
| M3-27 | `recordPending` ignores the scheme hash | scheme-changed-while-moved | `expected 2 to be 1` |
| M3-28 | settle ignores the scheme hash | drop test | `expected true to be false` |
| M3-29 | no 10-min cap | G 8 | `match object { retryAfter: 1630000, transient: 11 }` |
| M3-30 | no doubling | G 8 | `match object { state: 'idle', … }` |
| M3-31 | crash throw swallowed | driver crash test | `expected null to be 'after-pending'` |
| M3-32 | stopped/draining check removed | stopped/draining | `expected true to be false` |
| M3-33 | invalid record rethrown | stopped/draining | `Error: recovery-blocked:group-integration-invalid` |
| M3-34 | driver does not call the pass | driver crash test | `expected null to be 'after-pending'` |
| M3-35 | environment checks refused as `integration-invalid` | naming git or the repository | `match object { error: … }` |
| M3-36 | setter repository-path catch removed | same | `Error: control-path-changed` |
| M3-37 | confirm repository-path catch removed | confirm repository | `Error: control-path-changed` |
| M3-38 | `orGitCheck` removed | names git itself | `ChildSpawnFailed: git: could not start: spawn git ENOENT` |
| M3-39 | runner failures not mapped to the git check | names git itself | `ChildSpawnFailed … ENOENT` |
| M3-40 | gh spawn failure not caught | preflight names the failing check | `ChildSpawnFailed: …/no-such-gh … ENOENT` |
| M3-41 | retry accepts idle | G 11 | `expected 'applied' to be 'integration-not-blocked'` |
| M3-42 | retry `VERB_ACCESS` `any` | integrationApi retry | `[404,'group-not-found'] to deeply equal [403,'control-verb-human-only']` |
| M3-43 | remote-tracking candidate removed | remote-tracking test | `expected true to be false` |
| M3-44 | `BranchMissing` removed | G 10 | `match object { state: 'blocked', … }` |
| M3-45 | non-transient `RemoteFailure` treated as transient | G 10 | `expected false to be true` |
| M3-46 | `crash("after-pending")` removed (push-branch) | driver crash test | `expected null to be 'after-pending'` |
| M3-47 | conflict attempt always 1 | conflict test | `match object { attempt: 2, … }` |
| M3-48 | retry keeps `retryAfter`/`transient` | G 11 | `match object { state: 'idle', reason: null, … }` |
| M3-49 | transient counted as progress | G 8 | `expected true to be false` |
| M3-50 | ff merge in the checked-out worktree removed | G 7 | `ENOENT … target/a.txt` |
| M3-51 | local `update-ref` skipped | G 2 | `expected [] to deeply equal […2]` |
| M3-52 | `worktreeOf` never finds the checkout | G 7 | `ENOENT … target/a.txt` |
| M3-53 | integration workspace not removed after use | G 2 | `expected true to be false` |

## Rewrite inventory

- `tests/entry/skill.test.ts`: route, verb and row counts go 27→28 and `schemaByVerb` gains `retry-integration` →
  `emptyPayloadSchema` (spec §3.4). The counts are still exact.
- `tests/control/integrationScheme.test.ts:281`: title only (deferred minor c); the assertions are unchanged.

## Deviations and decisions (for the ledger)

1. Branches removed because no criterion can see them (Rule 9). Each removal is named in its commit:
   - the separate `"up-to-date"` push outcome (callers treat it as accepted);
   - the `ls-remote` skip before pushing `orca/<g>` (spec §6.1 step 4 says "if ls-remote already shows tip, skip"; an
     up-to-date push is accepted, and re-entry covers a crash);
   - the push-target remote-config read (the fetch reports a missing remote the same way);
   - the pass-level panel-draining rethrow (the settle write refuses it);
   - the empty-task-list guard;
   - the early `ChildTimeout` mapping and the fetch's first network check.
2. `retry-integration` keeps `conflict` (only state, reason, `retryAfter` and `transient` reset), so attempt numbers
   keep counting up and Task 6's conflict refs never collide.
3. A remote that is configured but answers with a non-network failure is treated as `integration-remote-missing`. This
   includes an auth failure ("Could not read from remote repository").
4. A push that fails with no porcelain line and no network signature is `integration-push-refused:<git's words>`, for
   example a URL path that is no repository.
5. Blocked reasons carry git's words only for `integration-push-refused:<message>` (whitespace collapsed, at most 500
   characters). Every other reason is the bare code.
6. Case 1's "spawns nothing" is read as no outward action. With no new landing, the criterion pins that the only child
   is one `rev-parse` of `orca/g`; before the first landing it is `rev-parse` ×2 plus `merge-base`. Reading a ref
   needs git.
7. Confirm's integration preflight stays inside the admission gate (see the agentFreeze regression above). Only the two
   setters run their git checks before the gate.
8. Not tested here, and left to Task 5: the re-entry hits (`remoteHas` / the local "contains `pending.new`" branch) and
   `crash("after-publish")`. These are Task 5's crash criteria per the controller. The driver crash test covers
   `after-pending` only.
9. Untested branches I left in place:
   - `remote-not-github` on the preflight TOCTOU: defensive; it replaces a crash and needs a remote changed between two
     children.
   - Kill the whole process group vs only the child: the runner rejects at the deadline without waiting for the pipes,
     so a grandchild that is not killed is not observable by time. The group kill stays so no `sleep` is leaked.
   - `merge` failing without unmerged paths, and `merge-tree` exiting ≥2: both throw, and the pass backs them off.
10. Test case 11's member and agent refusal is in `tests/panel/integrationApi.test.ts`, the file with the HTTP harness.
    The state transitions are in integrationGit.
11. `github-pr` groups currently push like `push-branch` and record `lastIntegrated` with no PR. Task 4 must keep that
    shape or reset the record.

## Concerns

- Context budget (Rule 6): partway through, the harness's StrategicCompact hook reported about 384k tokens of context
  (38% of 1M). That is over the 330k per-task figure. This is a tool-reported number; I have no other measure.
- Tier 0 gate: a `git push` in my own shell (a scratch experiment) was refused by the gate. I did not retry it or
  rephrase it. All pushes happened only inside vitest criteria, against temporary bare repositories.

## Files

New: `src/control/integrationGit.ts`, `src/control/integrationPass.ts`, `tests/control/integrationGit.test.ts`,
`tests/control/integrationKeep.test.ts`.
Modified: `src/control/executionDriver.ts`, `src/control/integrationCommands.ts`, `src/control/integrationScheme.ts`,
`src/control/webProtocol.ts`, `src/control/webService.ts`, `src/panel/controlApi.ts`, `src/panel/humanOnly.ts`,
`web/src/controlTypes.ts`, `skills/orca-control/SKILL.md`, `tests/control/integrationScheme.test.ts`,
`tests/entry/skill.test.ts`, `tests/panel/integrationApi.test.ts`.

---

# Fix round 1 (review findings I1, I2, I3, M1, M3)

Implementer: same subagent, 2026-10-08. Commit `718eeb7` fix(control): name remote failures consistently and leave the
person's worktree records alone.

## Changes

- **I1:** the integration workspace is removed with `removeOwnPath(repo, roots, workspace)` from `workspace.ts`. The
  pass's own `removeWorkspace` and its `git worktree prune` are gone.
- **I2:** `integration-remote-missing` now means only that `remote.<r>.url` is not configured.
  - The config is read with `integrationScheme.ts`'s `remoteUrl`, which is now exported; `remoteConfigured` wraps it.
  - The read runs for `push-branch`, and for `push-target` before its fetch.
  - A non-transient `RemoteFailure` (from the fetch, the `ls-remote` in `remoteHas`, or `fetchInto`'s `ls-remote`) now
    blocks `integration-push-refused:<git's words>`, the same as a refused or failed push.
- **I3:** `classifyNetwork` now treats `unable to access` as transient only with a network cause:
  `/Could not resolve host|Connection refused|timed out|unable to access .*(?:Could not resolve|Failed to connect|timed out|Connection refused)/i`.
  An HTTP 401/403 is permanent.
- **M1:** within one pass, a remote whose child timed out is skipped by every later group with the same repository path
  and remote name. The remote counts as timed out when a `ChildTimeout`'s argv names it. Those groups stay unchanged and
  are retried next round.
- **M3:** the criteria's `g` helper passes `-c core.hooksPath=/dev/null` and drops inherited `GIT_*` with
  `unsetInheritedGitEnv()`, as `driverHarness`'s `git` does.
- **Reconciling runs (read-only check):** a reconciling run does have `runs.active=1`.
  - `driveRecord.ts:10` says none of the five driver states (`start-pending`, `collected`, `landed`, `reconciling`,
    `blocked`) is terminal and each owns its work item with `active=1`.
  - `driverLanding.ts:193` sets `state = "reconciling"` without touching `active`.
  - `active=0` is written only when the run settles (`budget.ts:168`, `:175`), by `stopIntent.saveRunBody` and by
    `singleCallLedger.ts:98`.
  - So `groupComplete` already counts reconciling runs as active. No change.

## New criteria

All four are in `tests/control/integrationGit.test.ts`, describe "fix round 1". The failing remotes are `ext::` URLs:
`sh` prints git's words to stderr and exits 128.
- **I2:** with `fatal: Authentication failed …`, three paths block with a reason matching
  `integration-push-refused:.*Authentication failed`:
  - the `push-branch` push;
  - the re-entry path (a `pending` of the current scheme): only `ls-remote` runs and no push;
  - the `push-target` fetch.
- **I3:** `fatal: unable to access https://…: The requested URL returned error: 403` blocks with `retryAfter: null`,
  `transient: 0` and reason `integration-push-refused:…error: 403`. The hanging-remote case 8 still ends `idle` with
  backoff, and it is green.
- **I1:** a person's worktree (`worktree add -b pw person-wt`) whose directory is then deleted is still listed in
  `worktree list --porcelain` after a `local` merge integration, which used the integration workspace.
- **M1:** a second group `h` lands on the same hanging remote (`ext::sh -c echo hit>>file; sleep 5`), with
  `ORCA_INTEGRATION_TIMEOUT_MS=500`. The pass returns in under 1.5 s, the hit file holds exactly one `hit`, and `h`'s
  record is unchanged (`transient: 0`, `retryAfter: null`).

## Commands and output (all redirected to files under `$S`, at `718eeb7` unless noted)

- `vitest run tests/control/integrationGit.test.ts`:
  - `$S/t3f-g1.txt`, before the escaping fix: rc=1, 2 failed. The test's `ext::` script sent its echo to the protocol
    stream, because the space before `1>&2` was not `%`-escaped.
  - `$S/t3f-g2.txt`: rc=0, 29 passed.
- `npm run typecheck`: rc=0 (`$S/t3f-tc2.txt`).
- `vitest run tests/control/integrationKeep.test.ts tests/control/integrationScheme.test.ts
  tests/control/executionDriver*.test.ts`: rc=0, 3 files passed and 1 skipped, 75 passed and 9 skipped
  (`$S/t3f-cov.txt`). The skipped file is `executionDriverE2E`, because `ORCA_CCLOOP_BIN` was not set.
- `vitest run tests/control`: rc=0, 131 files passed and 8 skipped, 1401 tests passed and 52 skipped
  (`$S/t3f-broad.txt`). No reds. `uptime` load was 6.79 6.75 6.36.

## Mutation rows

Clone `$S/mut-t3` at `718eeb7`, driver `$S/mut-t3-run.py`, summary `$S/mut-t3f-summary.txt`, each mutation's output in
`$S/mut-t3-F1-<n>.txt`. Every restore measured 0/0 bytes (`git diff` / `git diff --cached`).

| id | mutation | red test | seen red |
|---|---|---|---|
| F1-1 | re-add `git worktree prune` after removing the workspace | I1 | `expected 'worktree /private/tmp/…' to contain 'person-wt'` |
| F1-2 | a non-transient remote failure read as `integration-remote-missing` again | I2 | `expected 'integration-remote-missing' to match /^integration-push-refused:.*Authentic…/` |
| F1-3 | push-target's config read removed | case 10 | `match object { state: 'blocked', … }` (a removed remote is refused, not reported missing) |
| F1-4 | `classifyNetwork` back to a bare `unable to access` | I3 | `expected false to be true` (the 403 backed off) |
| F1-5 | the same-round unreachable skip removed | M1 | `expected 'hit\nhit\n' to be 'hit\n'` |
| F1-6 | the timed-out remote never marked unreachable | M1 | `expected 'hit\nhit\n' to be 'hit\n'` |

## Corrections to the main report above

- Deviation 3 there ("an auth or non-network remote failure is integration-remote-missing") no longer holds. It is now
  `integration-push-refused:<words>` (I2).
- M3-45 in the main table mutated the old remote-missing line. Its successor is F1-2.
