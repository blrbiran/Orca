# Task 11 — parked uncertain commands

## Scope and source

- Isolated worktree: `/private/tmp/orca-feedback-followup-task8-20261011`, branch `codex/feedback-followup-task8`.
- Base: `5a0ee69b9b7f7675fd73dfd6a14d869a17de4a74`.
- Product/test commit: `48f65e7344484dedb5608beed592cf74b96fbe5a` (`fix(web): park unverifiable command outcomes without losing their identity`). One-command empty `core.hooksPath=/dev/null`; no main merge, remote action, default pin change or Results 5 WIP edit.
- Independent-review fix commit: `ae6df40c1e213408b5bea3553560638a9fa889e2` (`fix(web): preserve dismissed uncertain command checks`). This is the final Task 11 HEAD.
- The only untracked worktree item at handoff is the pre-existing `node_modules` symlink. `progress.md` was not staged or changed.

## Behavior delivered

1. The command lookup remains the first authority. A retained result resolves the original ID even if its group is absent; the browser does not read a missing group after resolution. The root criterion moves a retained ledger row under a group ID with no group row and proves the route returns that result, while a miss returns typed `group-not-found`.
2. A typed missing group plus missing result parks the browser entry. The entry retains original `groupId` scope, command ID, import marker, and verb/payload when they were known at send time; legacy entries are not given invented metadata. `parked`, `dismissed`, and `reason: group-missing` survive session storage and epoch reduction. Automatic control ticks skip parked IDs. The item appears in a globally owned attention surface with exact English/Chinese text and explicit Check again/Dismiss controls.
3. Dismiss hides the attention and Overview queue row while keeping the unknown identity in storage and an expandable dismissed-operations section. Check again makes one lookup of the original ID. A repeated group miss re-parks; a temporary failure restores ordinary retry; a retained result resolves. No UI POST/replay was added. Temporary lookup errors stay owned by the uncertain command instead of becoming an unowned sticky panel refusal.
4. `@repository`, `@operator`, and `@spend` scopes cannot be classified as missing groups by the browser. The server's scoped lookup behavior and Task 10's separate installation-update intent were left intact.

## RED/GREEN evidence

Raw stdout/stderr and JSON metadata for every run are copied into `task-11-evidence/` beside this report. The runner redirects HOME, XDG, TMPDIR and CCMEM data roots and unsets CCMEM_CONFIG_PATH; it records command, RC, commit, source-tree SHA-256 and elapsed time.

| Phase | Exact runner command suffix | RC | Evidence |
|---|---:|---:|---|
| Initial Web RED | `npx vitest run tests/controlCommandRecovery.test.tsx tests/controlState.test.ts` from `web` | 1 | `task11-red-web-*`: 3 intended failures (retained result read/duplicate, no park UI, no reducer event), 19 passed |
| Overview RED | `npx vitest run tests/overviewModel.test.ts` from `web` | 1 | `task11-overview-red-*`: dismissed parked row incorrectly remained; 1 failed, 7 passed |
| Transient RED | `npx vitest run tests/controlCommandRecovery.test.tsx -t 'resumes ordinary retry'` from `web`, with resume event temporarily removed | 1 | `task11-transient-red-*`: original ID remained parked after 503; 1 failed, 9 filtered skips |
| Transient GREEN | `npx vitest run tests/controlCommandRecovery.test.tsx` from `web` | 0 | `task11-transient-green-*`: 10 passed |

An initial root-cwd invocation of the Web test paths found no files (RC 1, `task11-red-*`); it did not exercise the code. The corrected Web-cwd RED run above did.

## Final committed-tree gates

| Gate | Exact runner command suffix | RC | Result / source tree |
|---|---|---:|---|
| Full Web type + tests | `npm run check` from `web` | 0 | 108 files, 953 tests passed, 0 skipped; `task11-web-postcommit-*`; Web tree `48ab500df785a77ceb586accb0fb10729de5658469e9aedc3707355eafb744b5` |
| Web build | `npm run build` from `web` | 0 | `task11-web-build-postcommit-*`; same Web tree |
| Root typecheck | `npm run typecheck` | 0 | `task11-root-type-postcommit-*`; root tree `2b4165bff5dcb9d2405ac8003d2c17e2dd378640692f2aac342437d039ee2319` |
| Root build | `npm run build` | 0 | `task11-root-build-postcommit-*`; same root tree |
| Affected root tests | `npx vitest run tests/panel/controlReadApi.test.ts tests/panel/controlSocketGate.test.ts tests/control/commandLedger.test.ts` | 0 | 3 files, 64 tests passed, 0 skipped; `task11-root-postcommit-*`; same root tree |

The first root test run in the sandbox (`task11-root-lookup-*`) failed all 64 tests before setup because `openControlStore` calls local `ps` and received `spawnSync ps EPERM`; the raw log is retained. The same isolated runner, approved outside that sandbox restriction, passed 64/64 (`task11-root-lookup-approved-*` and final committed-tree run). This was a test-environment denial, not an assertion failure. No root test was waived.

## Clone-only deletion mutants

Each mutant used a separate `git clone --no-hardlinks --local` of initial product commit `28602ef5720548771672f07093eecf91aaab971b`, with an untracked dependency symlink. The final commit changes only the additional transient lifecycle test, so the mutated product lines and their killer criteria are unchanged. These are deliberate RC 1 results; targeted `-t` filters explain skips.

| Mutant | Mutation | Killer / result |
|---|---|---|
| `task11-mutant-auto-*` | Remove the parked guard from App automatic lookup | Reload lifecycle test observes a second lookup without Check again; 1 failed, 8 filtered skips |
| `task11-mutant-dismiss-*` | Make Dismiss delete the uncertain entry | Lifecycle test finds no preserved `dismissed` entry; 1 failed, 8 filtered skips |
| `task11-mutant-scope-*` | Treat every typed `group-not-found` as a missing group | Three `@repository`/`@operator`/`@spend` scope cases fail; 3 failed, 6 filtered skips |

## Limits and handoff

The outcome of a command with no retained result and no group remains unknown by design; only an explicit lookup can change that classification. Session storage is tab-scoped and follows the existing browser best-effort storage behavior. No live service, real provider, real data, SQL deletion or remote endpoint was used. Package manifests and default ccloop pin are unchanged. The disposable mutant clones and raw run directories remain under `/private/tmp` for audit; the authoritative raw copies are `task-11-evidence/`.

## Independent review fix — final HEAD `ae6df40c1e213408b5bea3553560638a9fa889e2`

The independent review found that an explicit Check again could be pending when Dismiss was clicked; a late `group-not-found` response then re-parked the entry with `dismissed: false` and reopened attention. It also found that code-only missing-group classification could park a 500/503 response. Both findings matched the code. The scoped fix preserves the current dismissed choice in `command-parked` and classifies a genuine missing group only when HTTP status is 404 **and** code is `group-not-found` for a non-`@` scope.

The held-lookup App test clicks Check again, Dismisses before the held 404 returns, waits for the persisted post-response write, verifies storage and attention remain dismissed, then explicitly checks the same ID again and resolves its retained result. Two API cases verify that 500/503 responses carrying `group-not-found` stay transient. No root source changed; the previous committed-tree root test/build gates above remain applicable.

| Phase | Exact runner command suffix | RC | Raw evidence / result |
|---|---|---:|---|
| Fix RED | `npx vitest run tests/controlCommandRecovery.test.tsx -t 'keeps Dismiss\|keeps a 500\|keeps a 503'` from `web` | 1 | `task11-fix-red-*`: 3 intended assertion failures, 10 filtered skips |
| Fix focused GREEN | `npx vitest run tests/controlCommandRecovery.test.tsx tests/controlState.test.ts` from `web` | 0 | `task11-fix-green-*` |
| Final full Web type + tests | `npm run check` from `web` | 0 | `task11-fix-web-postcommit-*`: 108 files, 956 passed, 0 skipped; source Web tree `0d391fcb61645226840f97c4854efc6b82894fd232c1e3c4aabe3ac8dbe12ee7` |
| Final Web build | `npm run build` from `web` | 0 | `task11-fix-build-postcommit-*`: same commit/tree |

Fresh separate `git clone --no-hardlinks --local` mutants of final HEAD, each with only an untracked dependency symlink, both yielded intentional RC 1:

- `task11-fix-mutant-repark-*`: restored `dismissed: false` on re-park. The held-lookup test caught `false` where dismissal must remain true; 1 failed, 12 filtered skips.
- `task11-fix-mutant-status-*`: removed the status-404 guard. The 500 and 503 tests caught `missing-group` instead of `unresolved`; 2 failed, 11 filtered skips.

The final Web check and build metadata both name `ae6df40c1e213408b5bea3553560638a9fa889e2`. The root suite was not rerun because this fix touches only Web source/tests; the earlier root lookup criterion remains 64/64 on the unchanged root source.
