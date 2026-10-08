# Task 4 report: GitHub PR delivery (`syncGroupPr`, fake `gh`)

Implementer: subagent of session eaee0f2c, 2026-10-08. Branch `feat/integration-schemes`, base `718eeb7`.
Every git command used `git -C <abs path>`. The main checkout `/Users/biran/code/skills/loop/Orca` was not touched.
`progress.md` was not edited or staged.

Commits:
- `e11fc54` feat(control): keep one GitHub pull request per group up to date
- `3519737` test(control): pin every failing gh call and the push-free ready-only pass

## What was implemented

### `src/control/integrationPr.ts` (new): `syncGroupPr(input)`

The input follows the brief's interface, with two additions:
- `cwd`: `runChild` needs a working directory. It is the target repository; gh reads nothing from it while `--repo` is
  given.
- `onStep?(step)`: the crash hook for `after-pr-create` and `after-pr-ready`.

Every gh child goes through `runChild`, so it gets the Global Constraints env (`GH_PROMPT_DISABLED=1`,
`GH_NO_UPDATE_NOTIFIER=1`, etc.) and the deadline. The steps are:

1. `gh auth status --hostname <host>`:
   - A non-zero exit whose stderr reads like the network returns `transient`.
   - Any other non-zero exit blocks `integration-gh-unavailable`.
2. If no PR is recorded, it runs
   `gh pr list --repo R --head orca/<g> --base <target> --state all --json url,number,state,isDraft`. Then:
   - An open PR is recorded with `ready = !isDraft`.
   - Otherwise, any closed or merged PR blocks `integration-pr-closed`.
   - With none at all, it runs `gh pr create --repo R --base <target> --head orca/<g> [--draft] --title=<title>
     --body-file -`, with the body on stdin. It parses the URL and number from the last stdout line and calls
     `onStep("after-pr-create")`.
3. If a PR is recorded, it runs `gh pr view --repo R <n> --json state,isDraft`. This is read once per integration.
   - A state other than `OPEN` blocks `integration-pr-closed`.
   - A PR that is no longer a draft is recorded as ready with no `pr ready` call. This covers a person marking it ready,
     and a crash after `pr ready` that lost the record.
4. If the group is complete and the PR is not ready, it runs `gh pr ready --repo R <n>`, then
   `onStep("after-pr-ready")`.

Failure mapping:
- A gh that cannot be started (`ChildSpawnFailed`) blocks `integration-gh-unavailable`.
- A failed `pr list`, `create`, `view` or `ready` is classified by stderr:
  - The network (`error connecting to|could not resolve|timed out|timeout`) returns `transient`.
  - Anything else blocks `integration-pr-refused:<gh's words>` (one line, at most 500 characters). Draft refused falls
    here.
- A `ChildTimeout` is not caught here. The pass's handler backs it off, as Task 3 does for git. A separate catch would
  be a branch no criterion can see.
- `blocked` in the result is the full record reason. `message` carries gh's words.

### `src/control/integrationPass.ts`

`finishWorkBranch(deps, repo, groupId, integration, scheme, tip)`:
- `push-branch` is done as before.
- For `github-pr`, it reads the raw `remote.<r>.url` with `remoteUrl` (never `remote get-url`) and runs `githubRepoOf`
  on it.
  - A URL that no longer names GitHub blocks `integration-pr-refused:remote <r> no longer names a GitHub repository`
    and runs no gh.
  - Otherwise it calls `syncGroupPr` with:
    - `repo = <host>/<owner>/<name>`;
    - the title: the first line of the group's `plan.goal`, truncated to 256 characters, passed as one `--title=` argv
      element;
    - the body (see below);
    - `draft` = the trigger is `task`;
    - `complete` = `groupComplete`;
    - the recorded `pr`;
    - `onStep` = `crash(deps, step)`.
- The body is "Opened by Orca for group `g`: its landed work on `orca/g`, into `<target>`." plus "Tasks landed: n of
  m.". It contains no paths and no secrets.

Settling:
- `Outcome.done` gains an optional `pr`. `settle` writes it in the same final write (§6.1 step 6), so the
  write-ahead/settle semantics are unchanged.
- A crash after `pr create` leaves `pending` set. The next pass re-enters through `remoteHas`, and `pr list` finds the
  PR that was opened, so no second create runs.

Due rule (§5), the ready-only case:
- When `tip === lastIntegrated`, a `github-pr` group is still due if its PR is recorded and not ready and the group is
  complete.
- That pass goes straight to `finishWorkBranch`. It writes no pending record and starts no git push; a criterion pins
  this with a child spy.

### `src/control/integrationScheme.ts`

Unchanged. `preflightScheme` already used `gh auth status --hostname` (Task 3). The brief's confirm criterion
("authOk:false at confirm ⇒ preflight names gh-auth") is now also covered with the fake gh, through
`WebControlService.confirm`.

### `tests/control/fixtures/fakeGh.mjs` (new, mode 755, node)

- It is driven by `FAKE_GH_DIR`.
- Each call appends `{argv, stdin?}` to `calls.jsonl`.
- It reads `state.json`, which holds `{prs, authOk, refuseDraft, fail}`.
- It implements `auth status`, `pr list` (honours `--head`, `--base`, and `--state`, which defaults to open as real gh
  does), `pr create` (`refuseDraft` + `--draft` exits 1 with "Draft pull requests are not supported"), `pr ready` and
  `pr view`.
- `fail: {"<sub command>": "<stderr>"}` makes that sub-command exit 1 with those words. This one addition beyond the
  brief scripts the network-error and other-failure cases.
- Unknown commands exit 2.

### `tests/control/integrationGh.test.ts` (new, 14 tests)

Each world's remote is set up as follows:
- `remote.origin.url = https://github.com/o/r.git`;
- `url.<bare>.insteadOf = https://github.com/o/r.git`;
- `ghBin` is the fake gh.

| Test | What it checks |
|---|---|
| Trigger `task` | The exact argv of `auth status`, `pr list` and `pr create` (with `--draft`, `--title=ship`, `--body-file -`, and stdin naming `orca/g`). The record and the view's `pr`. A second integration runs `pr view` and no second create. Incomplete ⇒ nothing due. On completion: `pr ready --repo … 1` and no git push. After that, nothing is due. `--repo github.com/o/r` is on every `pr` call. |
| Existing open PR | It is recorded and none is created. |
| Closed or merged PR | A closed PR from `pr list`, or a recorded PR later merged, blocks `integration-pr-closed`. |
| Draft refused | `refuseDraft` ⇒ `integration-pr-refused:…Draft pull requests are not supported`. |
| Marked ready by the person | A recorded draft that the person marked ready is recorded ready with no `pr ready` call. |
| Crashes | `after-pr-create` and `after-pr-ready` crashes, then the next pass: exactly one create and one ready, and the same final record. |
| Trigger `group` | Nothing runs while the group is incomplete. Then `pr create` without `--draft`, no `pr ready`, and `ready: true`. |
| Hostile goal | A goal of `"--evil\nsecond line"` gives exactly `--title=--evil`, no bare `--evil`, no "second line" in argv, and the body on stdin. |
| Long title | A 300-character first line is truncated to 256. |
| gh unavailable | `authOk:false` and a missing gh binary both block `integration-gh-unavailable`, after the work branch was pushed. |
| Network error | In `auth status` and in `pr list`: stays `idle` with `transient: 1` and `retryAfter: now+30s`. |
| Other failures | A non-network failure of `pr list`, `create`, `view` or `ready` blocks `integration-pr-refused:<words>`. |
| Remote not GitHub | A remote re-pointed to a non-GitHub URL blocks `integration-pr-refused:…GitHub` and runs no gh. |
| Confirm | `authOk:false` ⇒ `integration-preflight-failed:gh-auth`, and the only gh call is `auth status --hostname github.com`. Once authenticated, confirm is applied. |

## TDD evidence (redirected files under `$S`)

- RED, `$S/t4-red.txt`: the tests were written before `integrationPr.ts` and the pass change. rc=1, 13 failed / 1
  passed. The confirm/preflight test passed because preflight predates this task. The first failure was
  `expected [] to deeply equal [ 'auth status', 'pr list', …(1) ]`.
- `$S/t4-g1.txt`: rc=1, 1 failed. The cause was in the test: changing `plan.goal` in the default world made
  `readControlGroup`'s archived-plan check throw `recovery-blocked`. The default world now keeps the fixture's goal
  `"ship"`, and only the title tests change the goal.
- `$S/t4-g2.txt`: rc=0, 14 passed, at `e11fc54`'s tree.
- `$S/t4-g3.txt`: rc=0, 14 passed, at `3519737`'s tree (the added assertions).
- `npm run typecheck`: rc=0 (`$S/t4-tc2.txt` at `e11fc54`, `$S/t4-tc3.txt` at `3519737`).
- The four files (gh, git, keep, scheme): rc=0, 4 files and 97 tests. `$S/t4-set.txt` is at `e11fc54`; `$S/t4-set2.txt`
  is at `3519737`.
- Broad `vitest run tests/control tests/panel tests/entry` (`$S/t4-broad.txt`, rc in `$S/t4-broad-rc.txt`) ran at the
  `e11fc54` tree: rc=0, 203 files passed / 8 skipped, 1931 tests passed / 52 skipped. The skips are the real-ccloop
  criteria (`ORCA_CCLOOP_BIN` unset). `uptime` load was 10.53 7.56 6.44.
  - It was not re-run after `3519737`, which changes only `integrationGh.test.ts`; that file is green in t4-g3 and
    t4-set2.

## Mutation table

- Clone: `git clone --local` at `3519737` in `$S/mut-t4`, with `node_modules` symlinked.
- Baseline (`$S/mut-t4-baseline.txt`): rc=0, 14 passed.
- Driver `$S/mut-t4-run.py`, summary `$S/mut-t4-summary.txt`, progress `$S/mut-t4-progress.txt`, and each mutation's
  output in `$S/mut-t4-<id>.txt`.
- Each run was `vitest run tests/control/integrationGh.test.ts -t <test>`.
- Each mutation was restored with `git checkout -- .`. `git diff | wc -c` / `git diff --cached | wc -c` was 0/0 for
  every row.

All 28 are red. PR = `integrationPr.ts`, P = `integrationPass.ts`.

| id | mutation | red test | seen red |
|---|---|---|---|
| M4-1 | (brief) drop `--repo` from `pr list` | trigger task | `expected ['pr','list','--head',…] to deeply equal ['pr','list','--repo',…]` |
| M4-2 | (brief) `--state open` instead of `all` | closed/merged | `match object { state: 'blocked', … }` |
| M4-3 | (brief) always `--draft` | trigger group | `expected [ 'pr', 'create', … ] to not include '--draft'` |
| M4-4 | PR: auth-failure branch removed | gh unavailable | `match object { state: 'blocked', … }` |
| M4-5 | PR: auth network ⇒ always unavailable | network | `expected true to be false` |
| M4-6 | PR: `failure()` never transient | network | `expected true to be false` |
| M4-7 | PR: `pr list` failure check removed | other failures | `expected false to be true` |
| M4-8 | PR: open PR from list not found | existing open | `match object { state: 'idle', pr: {…} }` |
| M4-9 | PR: closed-in-list branch removed | closed/merged | `match object { state: 'blocked', … }` |
| M4-10 | PR: `pr create` failure check removed | draft refused | `expected false to be true` |
| M4-11 | PR: `onStep("after-pr-create")` removed | crash | `promise resolved "true" instead of rejecting` |
| M4-12 | PR: `pr view` failure check removed | other failures | `expected false to be true` |
| M4-13 | PR: viewed-not-OPEN branch removed | closed/merged | `match object { state: 'blocked', … }` |
| M4-14 | PR: `ready \|\| !isDraft` → `ready` | marked ready by person | `expected [ …(6) ] to not include 'pr ready'` |
| M4-15 | PR: the `pr ready` step removed | trigger task | `expected ['auth status','pr view'] to deeply equal [Array(3)]` |
| M4-16 | PR: `pr ready` failure check removed | other failures | `pr ready: match object { state: 'blocked', … }` |
| M4-17 | PR: `onStep("after-pr-ready")` removed | crash | `promise resolved "true" instead of rejecting` |
| M4-18 | PR: `ChildSpawnFailed` catch removed | gh unavailable | `expected false to be true` |
| M4-19 | P: ready-only ignores `pr.ready` | trigger task | `expected true to be false` (the final pass was due again) |
| M4-20 | P: ready-only ignores completeness | trigger task | `expected true to be false` (the pass before completion was due) |
| M4-21 | P: ready-only dispatch removed (goes through push) | trigger task | `expected [ [ 'git', 'push', … ] ] to deeply equal []` |
| M4-22 | P: non-GitHub URL branch removed | remote not GitHub | `expected false to be true` |
| M4-23 | P: 256 truncation removed | long title | `expected [ Array(1) ] to deeply equal [ Array(1) ]` |
| M4-24 | P: first-line split removed | hostile goal | `expected ['--title=--evil\nsecond line'] to deeply equal ['--title=--evil']` |
| M4-25 | P: settle drops `pr` | trigger task | `match object { state: 'idle', …(4) }` |
| M4-26 | P: `complete` always false | trigger task | `expected ['auth status','pr view'] to deeply equal [Array(3)]` |
| M4-27 | PR: body not written to stdin | hostile goal | `TypeError: .toMatch() expects to receive a string, but got undefined` (the stdin assertion) |
| M4-28 | PR: title as two argv elements | hostile goal | `expected [ '--title' ] to deeply equal [ '--title=--evil' ]` |

## Rewrite inventory

None. No existing test was changed.

## Deviations and decisions (for the ledger)

1. The `syncGroupPr` input gains `cwd` (required by `runChild`) and `onStep` (the crash hook) beyond the brief's
   interface.
2. `blocked` in the result is the full record reason (`integration-pr-refused:<words>` or a bare code). `message` is
   gh's words, for diagnostics.
3. `gh auth status --hostname` runs at the start of every PR sync, so "gh not logged in" is told apart by name, as the
   controller's failure mapping asks. This costs one extra gh child per `github-pr` integration.
4. Draft refused has no separate branch. Every non-network failure of a `pr` sub-command, the draft refusal included,
   is `integration-pr-refused:<words>`. A separate draft check would produce the same record and could not be seen.
5. The body counts "Tasks landed: n of m" from the work items (`status = done`), not git first-parent commits. A count
   from git would need a base that `push-branch`/`github-pr` does not compute.
6. A remote re-pointed to a non-GitHub URL after confirm blocks `integration-pr-refused:remote <r> no longer names a
   GitHub repository`. The failure table has no row for it, and this is the nearest code.
7. A recorded draft that turns out to be no longer a draft is recorded ready without `pr ready`. This makes a crash
   after `pr ready` idempotent and respects a person who marked it ready.
8. The ready-only pass (no new landing) goes straight to the PR step, with no pending record and no push.

## Untested branches (named, Rule 12)

- `pr create` exiting 0 with no `/pull/<n>` URL on stdout throws. The pass backs it off as transient, and the next
  attempt finds the PR with `pr list`. It is defensive and needs a gh that misbehaves.
- The `integration.pr !== null` guard in the ready-only due rule is a type narrowing. A record with `lastIntegrated`
  set and `pr: null` arises only from a scheme switched to `github-pr` after integrations under another scheme (the
  setter keeps `lastIntegrated`). Such a group opens its PR only at its next landing. See concerns.

## Concerns

- Scheme switch to `github-pr`: a frozen group switched from `push-branch` (for example) to `github-pr` keeps
  `lastIntegrated`, so no PR opens until something new lands. Spec §5 does not cover this. One fix is to make
  "`pr === null`" due in the ready-only rule as well; I did not add it because it is beyond the spec.
- Crash coverage here is limited to the pass-level `crash` dep for the two new points. Task 5 owns the driver-level
  crash criteria (`integrationCrash.test.ts`).

## Files

New: `src/control/integrationPr.ts`, `tests/control/fixtures/fakeGh.mjs`, `tests/control/integrationGh.test.ts`.
Modified: `src/control/integrationPass.ts`.

---

# Fix round 1 (controller rulings R1, R2; minors M1, M2, M3)

Implementer: same subagent, 2026-10-08. Commits:
- `50826ec` fix(control): keep the group's PR record true across scheme changes, gh timeouts and forks
- `0267b08` test(control): a switched github-pr group whose work the target holds stays quiet

## Changes

- **R1** (`integrationPass.ts`, due rule): when `tip == lastIntegrated`, only a `github-pr` group can still be due.
  - If `pr === null`, it is due when `nothingLanded` is false, that is, when the tip is not contained in the local or
    remote-tracking target. It then takes the normal path: write-ahead, push (an up-to-date push is accepted), and the
    PR step, which lists and creates.
  - If a PR is recorded, the earlier ready-only rule applies: not ready and the group complete.
  - This settles concern 1 of the main report.
- **R2** (`integrationCommands.ts`, `applySetGroupIntegration` on an existing record): the record keeps `pr` only when
  `delivery`, `target` and `remote` are all unchanged. Otherwise `pr` becomes null. A trigger change keeps it.
- **M1** (`integrationPass.ts`): a `ChildTimeout` marks the remote unreachable for the round only when
  `error.bin === "git"`.
- **M2** (`integrationPr.ts`): `pr list` requests `--json url,number,state,isDraft,headRepositoryOwner`. Only PRs whose
  `headRepositoryOwner.login` equals the slug's owner are considered, whether open or closed.
  - Fake gh: a PR may carry `owner` (default `o`), which it returns as `headRepositoryOwner: {login}`.
  - Fake gh also gained `hang: {"<sub>": ms}`, which sleeps before answering.
- **M3** (`integrationPass.ts`): a first line of the goal that trims to empty gives the title `orca/<g>`. Otherwise the
  title is the first line truncated to 256 characters, as before.

## Covering criteria (`tests/control/integrationGh.test.ts`, describe "fix round 1")

| Criterion | What it checks |
|---|---|
| R1, switched group opens its PR | Integrate under `push-branch`, after a real confirm through `WebControlService.confirm` with the fake gh. Switch to `github-pr` with the real `set-group-integration`: the record stays frozen, `lastIntegrated` is kept and `pr` is null. The next pass, with no new landing, runs `auth status`, `pr list` and `pr create`, and records PR #1. The pass after that is not due. |
| R1, nothing landed | A switched group whose tip the person fast-forwarded `main` to is not due: no gh call, no `push` child, and `pr` stays null. |
| R2 | A trigger change keeps the recorded PR (`toEqual`). A target change to `dev` sets `pr` to null. The next pass runs `pr list` with `dev`, then creates PR #2; no `pr view` runs. |
| M1 | Two `github-pr` groups `g` and `h` share the remote `github.com`. The remote is named like the host, so gh's own argv names it. The fake gh hangs `auth status` for 20 s, with `ORCA_INTEGRATION_TIMEOUT_MS=3000`. `g` ends with `transient: 1`, and `h` is still tried in the same round: the remote's `orca/h` equals h's tip and h has `transient: 1`. |
| M2 | A fork's open PR on the same `orca/g` → `main` (owner `someone-else`) is ignored, and `pr create` runs and records #2. |
| M3 | A goal of `"   \nthe real goal"` gives `--title=orca/g`. |

Existing test rewritten:
- `integrationGh.test.ts` case 1: the expected `pr list` argv gains `headRepositoryOwner` (M2). It is just as strict:
  the argv is still compared exactly.

## Commands and output (redirected under `$S`)

- RED, `$S/t4f-red.txt`: the new test file and fake gh were run against the pre-fix source in the mutation clone at
  `3519737`. rc=1, 6 failed / 13 passed:
  - case 1: the `pr list` argv without `headRepositoryOwner`;
  - R1: `expected false to be true`;
  - R2: `expected { …(3) } to be null`;
  - M1: `expected null to be '<h tip>'`;
  - M2: `expected ['auth status','pr list'] to deeply equal [... 'pr create']`;
  - M3: `expected ['--title=   '] to deeply equal ['--title=orca/g']`.

  The clone was restored to 0/0 bytes. The second R1 criterion was added in `0267b08` (see the F1-2 note below).
- `npm run typecheck`: rc=0 (`$S/t4f-tc1.txt` at `50826ec`, `$S/t4f-tc2.txt` at `0267b08`).
- integrationGh alone: rc=0, 19 passed at `50826ec` (`$S/t4f-g1.txt`); 20 passed at `0267b08` (`$S/t4f-g2.txt`).
- The four files (gh, git, keep, scheme) at `0267b08` (`$S/t4f-set2.txt`): rc=0, 4 files and 103 tests.
- Broad `vitest run tests/control` (`$S/t4f-broad.txt`; rc and `uptime` in `$S/t4f-broad-rc.txt`): rc=0, 132 files
  passed / 8 skipped, 1421 passed / 52 skipped (the real-ccloop criteria). Load was 9.71 7.74 6.62.
  - It was started at `50826ec`. `0267b08` only adds one test to integrationGh, which is green in `$S/t4f-set2.txt`.

## Mutation rows

- Clone: `$S/mut-t4`, checked out at `0267b08`. Baseline (`$S/mut-t4f-baseline.txt`): rc=0.
- Driver `$S/mut-t4-run.py` (its MUT list replaced by the F1 rows), progress `$S/mut-t4f-progress.txt`, summary
  `$S/mut-t4f-summary.txt`, and each mutation's output in `$S/mut-t4f-<id>.txt`.
- Every row's restore was 0/0 bytes (`git diff` / `git diff --cached`).

All 7 are red.

| id | mutation | red test | seen red |
|---|---|---|---|
| F1-1 | caught-up with `pr === null` is never due (pre-R1 rule) | R1 switched group | `expected false to be true` |
| F1-2 | the "nothing landed" check dropped for the caught-up catch-up | R1 nothing landed | `expected true to be false` |
| F1-3 | `set-group-integration` always keeps `pr` | R2 | `expected { …(3) } to be null` |
| F1-4 | `set-group-integration` always clears `pr` | R2, trigger-change half | `expected null to deeply equal { …(3) }` |
| F1-5 | `error.bin === "git"` removed | M1 | `expected null to be '<h tip>'` (h was skipped) |
| F1-6 | owner filter removed | M2 | `expected ['auth status','pr list'] to deeply equal [... 'pr create']` |
| F1-7 | blank-title fallback removed | M3 | `expected ['--title=   '] to deeply equal ['--title=orca/g']` |

F1-2 was first seen to be invisible to the six criteria of `50826ec`: the R1 catch-up had no negative case. That is why
`0267b08` adds the "nothing landed" criterion. The mutation was then run at `0267b08`.

## Corrections to the main report above

- Concern 1 there ("a group switched to `github-pr` … opens no PR until its next landing") no longer holds. R1 opens
  the PR at the next pass.
- The "untested branch" note on the `integration.pr !== null` guard is superseded. The `pr === null` case is now its
  own branch, pinned by F1-1 and F1-2.
- The `pr list` argv in the main report gains `headRepositoryOwner` (M2).
