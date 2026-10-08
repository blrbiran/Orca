# Task 5 report: crash safety of every outward action

Implementer: subagent of session eaee0f2c, 2026-10-08. Branch `feat/integration-schemes`, base `0267b08`.
Every git command used `git -C <abs path>`. The main checkout `/Users/biran/code/skills/loop/Orca` was not touched.
`progress.md` was not edited or staged.

Commits:
- `63cfb3c` fix(control): match the PR's head owner without case
- `d87e906` test(control): pin that a crash never repeats an integration's push or PR

## What was done

### `tests/control/integrationCrash.test.ts` (new, 16 tests)

The file has its own world builder. I did not extract a shared fixture: this world has a different shape from the two
existing ones, and extracting would have touched both existing files. The world has:
- one GitHub-shaped `origin` (`https://github.com/o/r.git` with `url.<bare>.insteadOf`), used by every delivery;
- a bare remote with `core.logAllRefUpdates=always`, so each ref update is one reflog line;
- the target repo with `other` checked out, so `local` publishes by CAS `update-ref`;
- the group's task already `done`, so `github-pr` both creates and readies in one pass;
- fixed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` for the fixture's own commits.

**Matrix (14 tests).** Each row is one delivery × one crash point it reaches:
- local merge and local squash: after-pending, after-publish;
- push-target merge and push-target squash: after-pending, after-publish;
- push-branch: after-pending, after-publish;
- github-pr: after-pending, after-publish, after-pr-create, after-pr-ready.

Each test builds two worlds. The control world runs one pass and never crashes. In the crash world, the first pass
crashes at the given point, and the pass then runs again with no crash. The test asserts:
- After the crash, the record still holds the write-ahead `pending: {tip}`, with `lastIntegrated: null` and state
  `idle`.
- The `settled()` value of the crash world equals the control's. This covers every §4 view field (`state`, `reason`,
  `pending`, `lastIntegrated`, `integratedCommit`, `pr`, `conflict`, `retryAfter`, `transient`) and the published ref.
  - Commits the pass itself makes (merge, squash) carry their creation time, and git children drop `GIT_*`, so their
    hashes cannot match across worlds. These commits, the published ref and `integratedCommit`, are compared by shape:
    `%T %P %s` (tree, parents, subject).
  - The fixture's own commits are compared by hash; the fixed dates make them equal in both worlds.
- Ref updates come from the published ref's reflog: the target repo's `main` for local, the bare repo's `main` for
  push-target, and the bare repo's `orca/g` otherwise. The control's update count is exactly 1, and the crash world's
  count across both passes equals it.
- Push children (from the runChild spy, across both passes) equal the control's: 1 for a remote delivery, 0 for local.
  An up-to-date re-push leaves no reflog line, so a second push of `orca/g` is visible only this way.
- For github-pr: exactly 1 `pr create` in `calls.jsonl` (in both worlds), at most 1 `pr ready`, and the final
  `pr = {url …/pull/1, number 1, ready: true}`.

**Re-entry "contains" half (2 tests).** Spec §6.1 step 2 says the target "equals or contains" `pending.new`. These
tests cover local squash and push-target squash:
- crash at after-publish;
- someone commits on top of the target;
- restart.

Each asserts that the target is still the person's commit, there is no new reflog line and no push child, and the
record has `integratedCommit = pending.new` and `lastIntegrated = tip`.

### Real bug found and fixed (`src/control/integrationPass.ts`)

**The bug.** A `merge` delivery (local or push-target) that crashed at after-publish was never settled. The merge
commit contains the tip. With `lastIntegrated` still null, the due rule's "nothing landed" check found the tip in the
target and skipped the group, so re-entry never ran. The record kept `pending` and `lastIntegrated: null` until a later
landing.

**RED evidence.** `$S/t5-crash-g1.txt`: rc=1, 2 failed (local merge and push-target merge, after-publish).
`expect(await crashed.pass(children)).toBe(true)` received `false`.

**Fix.** The due rule skips the "nothing landed" check when `reentry(integration) !== null`, that is, when there is a
pending record of the current scheme:

```ts
if (reentry(integration) === null && (integration.lastIntegrated === null || (caughtUp && !readyOnly)) && await nothingLanded(repo, scheme, tip)) return null;
```

### Deferred Task 4 minor closed (`src/control/integrationPr.ts`)

The `headRepositoryOwner.login` comparison is now case-insensitive: both sides are lowercased.

The new criterion is in `tests/control/integrationGh.test.ts`, in the "fix round 1" describe. A draft PR that is
already open, whose `owner` is `"O"`, is recorded on remote `o/r`. Only `auth status` and `pr list` run, with no
create, and `pr` is `{number 1, ready false}`.

RED before the fix (`$S/t5-owner-red.txt`, rc=1):
`expected ['auth status','pr list', …(1)] to deeply equal ['auth status','pr list']` (a `pr create` ran).

## Verification (all redirected under `$S`; `$S` = the session scratchpad)

- `npm run typecheck`: rc=0 (`$S/t5-tc1.txt`, tree of `d87e906`).
- integrationGh alone after the owner fix: rc=0, 21 passed (`$S/t5-gh-g1.txt`).
- integrationCrash after the pass fix: rc=0, 16 passed (`$S/t5-crash-g2.txt`).
- The five integration files (crash, gh, git, keep, scheme): rc=0, 5 files, 120 tests passed (`$S/t5-set1.txt`).
- Broad `vitest run tests/control` at `d87e906`: rc=0. 133 files passed and 8 skipped; 1438 tests passed and 52
  skipped (`$S/t5-broad.txt`; rc and `uptime` in `$S/t5-broad-rc.txt`).
  - Load average was 12.50 9.11 7.25. The run overlapped the mutation baseline.
  - The 52 skips are the real-ccloop criteria (`ORCA_CCLOOP_BIN` unset), as in earlier tasks.

## Mutation table

- Clone: `git clone --local` at `d87e906` in `$S/mut-t5`, with `node_modules` symlinked.
- Baseline (`$S/mut-t5-baseline.txt`): rc=0, 2 files, 37 tests.
- Driver `$S/mut-t5-run.py`. Summary `$S/mut-t5-summary.txt`. Each mutation's output is in `$S/mut-t5-<id>.txt`.
- Each row was restored with `git checkout -- .`, and `git diff | wc -c` / `git diff --cached | wc -c` was 0/0 for
  every row.
- All 10 are red. C = integrationCrash.test.ts, G = integrationGh.test.ts.

| id | mutation | red test | seen red |
|---|---|---|---|
| M5-1 | (brief) the re-entry check removed: `reentry()` always null | C "local squash, crash after-publish" | `settled` toEqual (line 156): `published` and `integratedCommit` have parent `535e4f8…` (the first squash) instead of the base `500a10b…`, so a second squash commit was made |
| M5-2 | (brief) the `pr list` lookup before create removed (answers `[]`) | C "github-pr, crash after-pr-create" | `settled` toEqual: `pr.number` 2 / `…/pull/2` instead of 1 (a second PR) |
| M5-3 | the local re-entry site removed | C "local squash, crash after-publish" | `settled` toEqual (line 156) |
| M5-4 | the push-target re-entry site removed | C "push-target squash, crash after-publish" | `settled` toEqual (line 156) |
| M5-5 | the push-branch/github-pr re-entry site removed | C "push-branch, crash after-publish" | `expected 2 to be 1` (push children, line 164) |
| M5-6 | the local re-entry "contains" half removed (`===` only) | C "local squash … then someone commits" | `expected 'ecf6fd2…' to be '022c7b9…'` (the target moved past the person's commit, line 189) |
| M5-7 | the `remoteHas` "contains" half removed | C "push-target squash … then someone commits" | `expected '12d6da9…' to be 'ad5acf6…'` (line 189) |
| M5-8 | the due-rule fix removed (the pre-fix rule) | C "local merge, crash after-publish" | `expected false to be true` (the restart pass is not due, line 153) |
| M5-9 | owner compared with case | G "differs from the remote only in case" | `expected ['auth status','pr list', …(1)] to deeply equal ['auth status','pr list']` |
| M5-10 | an open PR found by `pr list` never read as ready | C "github-pr, crash after-pr-ready" | `expected 2 to be less than or equal to 1` (`pr ready` calls, line 169) |

## Rewrite inventory

None. One test was added to `integrationGh.test.ts`; no existing test was changed.

## Deviations and decisions (for the ledger)

1. Ref updates are counted with the reflog (`core.logAllRefUpdates=always` on the bare repo; the default reflog on the
   target repo), not with a `post-receive` hook.
2. The re-entry cases for push-branch and github-pr could not be checked by the reflog alone. An up-to-date push leaves
   no reflog line, so "no second push" is measured by push children, which is also asserted for every row.
3. The pass's own merge and squash commits are compared by `tree parents subject`, not by hash. Their committer date is
   the wall clock and `childEnv()` drops `GIT_*`.
4. The matrix runs at the pass level (`deps.crash`), not through the driver. The driver-level wiring of `crash` is
   already pinned by Task 3's driver crash test and mutations M3-31/M3-34.
5. The re-entry "contains" half for push-branch/github-pr (a remote `orca/g` moved past `pending.new`) is not tested
   here. A diverged `orca/g` is Task 3 case 9, and `remoteHas`'s contains branch is pinned through push-target (M5-7).

## Concerns

- No concerns with the code.
- The broad run was green under load average 12.5, with no flakes seen.
- I have no tool-reported context figure for this task, so I report none.

## Files

New: `tests/control/integrationCrash.test.ts`.
Modified: `src/control/integrationPass.ts` (due rule, 1 line + comment), `src/control/integrationPr.ts` (owner
comparison), `tests/control/integrationGh.test.ts` (+1 test).
