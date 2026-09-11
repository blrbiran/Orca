# Task 1 — independent mutation verification report

Commit under test: `29c0de4fe6f625c02379ef413b2b20fdae5eddb0` (`feat(panel): register the web workspace and reserve the seventh subcommand`).
Verifier did not write this code. Did not dispatch subagents. Main tree at
`/Users/biran/code/skills/loop/Orca` was never touched: `/usr/bin/git status --porcelain -z | wc -c` = 0 both
before and after this run; `/usr/bin/git rev-parse HEAD` = `29c0de4fe6f625c02379ef413b2b20fdae5eddb0` both times.
Every mutation ran in its own `git clone --local` scratch copy, checked out at `29c0de4`, with
`node_modules` and `web/node_modules` symlinked in from the main tree (never copied, never installed).
Each clone was torn down with `/bin/rm -rf "$(dirname "$C")"` after a `diff -rq` confirmed its
`tests/panel` and `web/tests` files were byte-identical to the main tree's (all eight `CMP_RC=0`).

## Baseline (unmutated clone at 29c0de4)

Root run (`vitest run tests/panel tests/cli`): Test Files 3 passed (3), Tests 20 passed (20), RC=0.
Web run: `tsc --noEmit -p tsconfig.json` TSC_RC=0; `vitest run` Test Files 1 passed (1), Tests 1
passed (1), VITEST_RC=0. All green as required before proceeding.

## Per-mutation detail

### W-1 — remove ` && npm run --ws check` from root `scripts.verify`
- Anchor matched exactly once in `package.json`. sha256 before `53e083bf…cb7`, after `9a8678bc…56e` (differ).
- `git status --porcelain`: ` M package.json`. Diff: the `verify` script's tail `&& npm run --ws check`
  removed; rest of the chain unchanged.
- Root run RC=1. Test Files 1 failed | 2 passed (3), Tests 1 failed | 19 passed (20).
- Failing test: `tests/panel/workspace.test.ts > the web workspace (spec §2 / §1.2) > runs the workspace
  check as part of verify, or a web-side type error ships unseen` — `tests/panel/workspace.test.ts:36:33`
  — `expected 'npm run typecheck && npm test && (npm…' to contain 'npm run --ws check'`.
- No other test failed.
- **hypothesis matched** (red in that one criterion, and only it).

### W-2 — create `web/package-lock.json` containing `{}`
- Pre-hash: file absent (`ABSENT: …/web/package-lock.json`). Post: created, content `{}`, sha256
  `44136fa3…8a`. Creation confirmed (did not exist before, exists after).
- `git status --porcelain`: `?? web/package-lock.json`.
- Root run RC=1. Test Files 1 failed | 2 passed (3), Tests 1 failed | 19 passed (20).
- Failing test: `tests/panel/workspace.test.ts > the web workspace (spec §2 / §1.2) > gives web/ no
  lockfile of its own — the root holds the only one` — `tests/panel/workspace.test.ts:30:78` —
  `AssertionError: promise resolved "'{}'" instead of rejecting` (expected the `readFile` on
  `web/package-lock.json` to reject; it resolved once the file existed).
- No other test failed.
- **hypothesis matched** — and it is the direct proof the brief asked for: this criterion was
  vacuously green in the unmutated commit (per the implementer's own report, C7/Concern 2 — no
  `web/package-lock.json` existed to reject on), and this mutation is what shows it is capable of
  going red at all.

### W-3 — move `express` from `dependencies` to `devDependencies`
- Pre-hash `53e083bf…cb7` (same file as W-1/W-8's pre-state), post `fa064b51…03e` (differ).
- `git status --porcelain`: ` M package.json`. Diff: `express` line removed from `dependencies`,
  added into `devDependencies`.
- Root run RC=1. Test Files 1 failed | 2 passed (3), Tests 1 failed | 19 passed (20).
- Failing test: `tests/panel/workspace.test.ts > the web workspace (spec §2 / §1.2) > declares express
  as a runtime dependency, not a dev one` — `tests/panel/workspace.test.ts:45:39` — `expected undefined
  to be type of 'string'` (`root.dependencies.express` now undefined).
- No other test failed.
- **hypothesis matched**.

### W-4 — delete the words `does not suit a team` from `src/cli.ts` USAGE
- Anchor matched exactly once. sha256 before `9e5f69ef…5e2`, after `8ac489cd…446` (differ).
- Diff: `own machines and does not suit a team.` → `own machines and .` (only the named words removed,
  as instructed).
- Root run RC=1. Test Files 1 failed | 2 passed (3), Tests 1 failed | 19 passed (20).
- Failing test: `tests/panel/usage.test.ts > orca panel usage text (spec §3.3) > warns that --bind's
  external mode does not suit a team, and names the flag that must be typed to accept it` —
  `tests/panel/usage.test.ts:13:20` — `expected 'usage:\n  orca validate <path...>    …' to contain
  'does not suit a team'`.
- No other test failed (in particular `tests/panel/workspace.test.ts` stayed green).
- **measured**: exactly one criterion pins this sentence — `tests/panel/usage.test.ts`'s first
  assertion (added under the implementer's C6 ruling) — and it does go red.

### W-5 — delete `--i-know-this-is-exposed` from the panel usage block
- Anchor matched exactly once. sha256 before `9e5f69ef…5e2`, after `3f9687f5…4f4` (differ).
- Diff: `--i-know-this-is-exposed as well: there is no TLS, the token` → ` as well: there is no TLS,
  the token` (flag name only removed).
- Root run RC=1. Test Files 1 failed | 2 passed (3), Tests 1 failed | 19 passed (20).
- Failing test: same test as W-4, `tests/panel/usage.test.ts > orca panel usage text (spec §3.3) >
  warns that --bind's external mode does not suit a team, and names the flag that must be typed to
  accept it` — `tests/panel/usage.test.ts:14:20` — `expected 'usage:\n  orca validate <path...>    …'
  to contain '--i-know-this-is-exposed'` (this test's second assertion; its first assertion, on "does
  not suit a team", still passed since that text is intact here).
- No other test failed.
- **measured**: the same single test carries this criterion too (its second `expect`), and it goes
  red independently of W-4's assertion.

### W-6 — delete the `--by` guard block in `startPanelFromArgs`
- Anchor (the full `if (by === undefined …) { … }` block, 8 lines) matched exactly once. sha256 before
  `66da2d35…9e1`, after `6800da33…808` (differ).
- Diff: the guard block removed; the following unconditional `throw new PanelRejection("not-implemented",
  …)` remains, now unreachable-by-that-branch but still the only statement executed either way (this
  function only ever throws in the tested paths).
- Root run RC=0. Test Files 3 passed (3), Tests 20 passed (20) — fully green.
- **hypothesis matched trivially / finding**: no criterion in `tests/panel` or `tests/cli` at this
  commit exercises the `--by` guard's absence — a fully green mutation, exactly as the brief flagged
  ("Task 3 owns the full guard criteria; a green here is information, not a defect"). Stating it
  plainly: **this guard currently has zero test coverage in the suites this task owns.**

### W-7 — `web/src/App.tsx`: `orca panel` → `orca`
- Anchor matched exactly once. sha256 before `946ecfb4…29d`, after `1a1ee078…540` (differ).
- Diff: `return <main>orca panel</main>;` → `return <main>orca</main>;`.
- Root run RC=0, Test Files 3 passed (3), Tests 20 passed (20) — unaffected, as predicted.
- Web run: `tsc --noEmit` TSC_RC=0 (unaffected — no type error from a text change). `vitest run`
  VITEST_RC=1, Test Files 1 failed (1), Tests 1 failed (1).
- Failing test: `web/tests/App.test.tsx > App > renders the placeholder markup` —
  `tests/App.test.tsx:13:43` — `expected '<main>orca</main>' to contain 'orca panel'`.
- **hypothesis matched** exactly: red in the web smoke criterion only, root run unaffected.

### W-8 — root `package.json` `workspaces` → `["client"]`
- Pre-hash `53e083bf…cb7`, post `11eb0a9c…8be` (differ).
- Diff: `"workspaces": ["web"]` → `"workspaces": ["client"]`.
- Root run RC=1. Test Files 1 failed | 2 passed (3), Tests 1 failed | 19 passed (20).
- Failing test: `tests/panel/workspace.test.ts > the web workspace (spec §2 / §1.2) > registers web/ in
  the root workspaces array, so npm ci installs it in one command` — `tests/panel/workspace.test.ts:14:29`
  — `expected [ 'client' ] to deeply equal [ 'web' ]`.
- No other test failed — notably `keeps the os floor off the web workspace` and `runs the workspace
  check as part of verify` both stayed green even though they also read `web/package.json`/`web`-adjacent
  state, because this clone's `web/` directory on disk is unchanged (only the `workspaces` array
  literal moved) and npm workspace resolution is not re-run inside `vitest`.
- **measured**: exactly one criterion pins the literal `["web"]` value.

## Summary table

| id | RC(s) | failing count | verdict |
|---|---|---|---|
| W-1 | root RC=1 | 1 | hypothesis matched |
| W-2 | root RC=1 | 1 | hypothesis matched |
| W-3 | root RC=1 | 1 | hypothesis matched |
| W-4 | root RC=1 | 1 | measured — pins spec §3.3 sentence in `tests/panel/usage.test.ts` |
| W-5 | root RC=1 | 1 | measured — pins the flag name, same test |
| W-6 | root RC=0 | 0 | fully green — finding: `--by` guard uncovered by `tests/panel`/`tests/cli` |
| W-7 | root RC=0, web TSC_RC=0, web VITEST_RC=1 | 0 root / 1 web | hypothesis matched |
| W-8 | root RC=1 | 1 | measured — pins literal `["web"]` |

Porcelain byte counts on the main tree: before = 0, after = 0.
