# Agents run the tests a change touches; the full gate runs once, only before a tagged release

Orca session `3831d12f` (Claude Code interactive session, not an orca run), 2026-10-20. Observation anchor: Orca `main`
at `60fcaece`. Builds on the human ruling of session `f3a75a90` (2026-10-19, handoff §3.000) and the gate-speed survey
`.superpowers/sdd/2026-10-20-repin-w2-test-split/gate-speed-survey.md` (git-ignored; its speed-up candidates are ruled
next round, not here).

## 1. Problem

Two things make testing the bottleneck of agent work in this repository (the human, 2026-10-20):

1. **The full gate is slow.** `npm run verify` took about 62 minutes in session `f3a75a90`; the suite itself ran about
   2.5 times inside it: `npm test` 707 s, then `verify:control` re-ran all of `tests/control` (1261 s), then
   `verify:chain` re-ran the whole suite with two workers (1611 s). `verify:scheduler` re-runs `tests/scheduler` a fourth
   time.
2. **The full gate is every step's default.** Agents ran it several times per feature, again before merging into
   `main`, and again after each fix — so a small iteration cost hours and the planned features fell behind.

What the extra passes add, measured on the anchor:

- `verify:control` (`scripts/verify-control.mjs`) only sets `ORCA_CONTROL_VERIFY=1`. One file reads it
  (`tests/control/ccloopProtocol.integration.test.ts:25-26`): it turns "skip when `ORCA_CCLOOP_BIN`/`ORCA_AGENTS_TABLE`
  are unset" into a hard error. The script also refuses up front when either variable is unset or unresolvable.
- `verify:chain` (`scripts/verify-chain.mjs`) runs `tests/chain` (already in `npm test`), then the whole suite with
  `ORCA_CHAIN_ID`/`ORCA_CHAIN_SESSION` set. Its comment: "The second run is what makes a missing isolateChainEnv()
  visible" (review I5) — this repository's tests may run inside a chain session, and `src/checkpoint/write.ts:40`,
  `src/chain/preflight.ts:46`, `src/level/hook.ts:45` change behaviour when those variables are set.
- `verify:scheduler` (`scripts/verify-scheduler.mjs`) runs `tests/scheduler`; its comment says it exists to be a name
  `verify` can depend on, so the gate is armed from the start.

The survey (from the last gate's log and vitest's results cache, observed commit `05a191c2`, no new run): the gate took
3736 s; `npm test` 706.59 s, `verify:control` 1261.09 s, `verify:scheduler` 23.80 s, `verify:chain` 51.83 s + 1610.90 s.
Every file of the re-runs also runs in `npm test`: 2947.62 s, 78.9 % of the gate, is repetition. Removing the three
re-runs leaves roughly 788 s (computed from the stage times, not measured).

## 2. Rulings (verbatim)

From the human, in chat:

- Session `f3a75a90` (2026-10-19): 「同意做取舍。全量应该只在特定节点才跑。甚至合入 main 分支之前都不用跑全量。只有在特定版本发布之前才是必须跑全量的。我感觉跑全量门已经成了你开发的瓶颈。」
- 2026-10-20: 「全量门慢也是问题。如果全量门几十秒能跑完，那多跑几遍也没问题，我理解全量门很难调到那么快。那么两边（全量门慢 + 全量门被当成每一步的默认动作）都要处理。」
- On a mechanical reminder: 「你不要提醒我，你提醒我导致整个流程卡住进而需要我处理的话，我会更烦。你只要限制agent不要默认跑全量门或者尽量不要跑全量门就好。」
- On what "release" is: 「只是我告诉agent打 tag。推远端和装进我自己在用的面板服务之前都只要跑必要的test就好。」
- The controller proposed (a) a script that maps changed files to tests, (b) dedupe of the gate for the one release
  run, (c) a mechanical restriction on agents. The human: 「这一步你的建议我都同意」.
- On the speed survey: run it in parallel, write the results to a file, rule on them next round.
- This round's criteria grant: 「这一轮允许改所有必要 test」 (session `3831d12f` only; logged per change).

## 3. Goals, non-goals, anti-goals

Goals:

- **G1** An agent's default test command runs only the tests a change touches, chosen by code (CLAUDE.md Rule 5), and
  says what it chose and why.
- **G2** The full gate runs only when the human has asked for a tagged release; an agent that runs it otherwise is
  refused by the gate itself, with the command to run instead.
- **G3** Inside the full gate the suite runs once, carrying every condition the extra passes carried (formal control
  verification, chain-session variables).
- **G4** Plans, handoffs and CLAUDE.md stop prescribing the full gate for iterations, fix rounds, merges into `main`,
  push or installing the panel service.

Non-goals: making individual tests faster (the survey's candidates — next round); CI; changing ccloop's or ccmem's own
gates (CLAUDE.md Rule 16 — their rules are theirs); changing what target repositories' checks run.

Anti-goals (a failure even if it works):

- anything that prompts the human, waits for the human, or makes the human handle a refusal;
- a selection that silently runs nothing and looks green — zero selected tests must be printed as zero;
- weakening any criterion to make the single pass green.

## 4. Design

### 4.1 `npm test` runs the affected tests (G1)

`package.json` `test` becomes `node scripts/test-affected.mjs`; the whole root suite moves to `test:all`
(`vitest run`). Agents and plans already say `npm test`, so the default changes without anyone remembering a new name.

`scripts/test-affected.mjs [--base <ref>] [--dry-run] [-- <vitest args>]`:

1. **Pass-through.** When the arguments after `--` contain a positional path or filter (anything not starting with
   `-`), the script selects nothing itself and runs `vitest run <args>` exactly — `npm test -- tests/x.test.ts` keeps
   meaning "run only this" (34 places in docs and history use that form). Flag-only arguments (`--run`, `--reporter …`)
   are forwarded to every vitest run the selection makes; `--run` is accepted and redundant.
2. **Changed files** = `git diff --name-status <base>...HEAD` ∪ staged ∪ unstaged ∪ untracked
   (`git ls-files --others --exclude-standard`), renames split into their old and new path, deletions kept.
   `<base>` defaults to `origin/main` when that ref exists, else `main` (the merge base, via `...`), so after a
   fast-forward into local `main` the unpushed commits are still "changed" — push and installing the panel service see
   the work they are about to ship.
3. **Rules**, applied by code; every selected file carries its reason:
   | changed path | selects |
   |---|---|
   | a test file (`tests/**/*.test.ts`) | that file |
   | `src/**`, any non-test file under `tests/**` (helpers, fixtures, workers, `tests/scheduler/sandbox.ts`, …), `scripts/**` | the static dependants of the file (vitest's `related`, computed through the node API), plus every test file in its mirror directory: `src/<dir>/…` or `tests/<dir>/…` ⇒ `tests/<dir>/`; top-level `src/*.ts` (`src/cli.ts`) ⇒ `tests/entry/`; `scripts/…` ⇒ `tests/scripts/` |
   | a deleted or renamed-away path under those trees | its mirror directory only (a deleted module has no importers left in the graph) |
   | `web/src/**`, `web/tests/**` | the web suite's dependants and changed web test files (web workspace), **and** the root dependants (root tests import `web/src` by value, e.g. `tests/panel/webParity.test.ts:14`) |
   | text read by tests: `skills/**` ⇒ `tests/entry/`; `.decisions/**` ⇒ `tests/ledger/validateFile.test.ts` | as listed (a short explicit table; a test that reads another file as text is a known gap) |
   | `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig*.json`, `tests/setup/**` | the whole root suite; `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json` ⇒ the whole web suite (these are never fed to `related`, which would turn them into a full run silently) |
   | anything else (`docs/**`, `*.md` outside `skills/`) | nothing |
4. **Always** run the root typecheck (`npm run typecheck`); run the web typecheck (`tsc --noEmit -p web/tsconfig.json`)
   when any `web/**` file or `src/control/webProtocol.ts` changed. Type-only imports are invisible to the module graph;
   the typecheck is what covers them.
5. **Running.** The selection is turned into an explicit file list; vitest is invoked as `vitest run <files…>` (never
   `related`, never watch mode). An empty list never invokes vitest and prints
   `test-affected: 0 test files selected (no changes against <base> select any)`. The exit code is the first non-zero
   of the typecheck(s) and vitest run(s), else 0.
6. **Output.** First the selection table (file → reason), then the counts; after the run, the number of skipped tests
   and the files that skipped them, read from vitest's JSON result (Rule 12: a skip is reported, not hidden — this is
   how missing `ORCA_CCLOOP_BIN`/`ORCA_AGENTS_TABLE` shows up). `--dry-run` prints the selection and exits 0.

Coverage cost (accepted, §2): a test that reaches the changed code only through a spawned process (`tsx src/cli.ts`,
`dist/cli.js`, the panel server) and lives outside the mirror directory, or that reads a changed file as text not in
the table, is not selected. The release gate still runs it.

### 4.2 The full gate is a release gate (G2)

`npm run verify` gains a first step, `node scripts/check-release-gate.mjs`: it exits 2 unless `ORCA_RELEASE_TAG` is set
to a non-empty tag name, printing:
`verify is the release gate: run it only when the human asked for a tagged release (ORCA_RELEASE_TAG=<tag> npm run verify). For iterations, fix rounds, merges, push or installing the panel service run: npm test`.
The agent that was told to tag sets the variable; nothing reaches the human. The limit is honour-based (any agent can
set the variable) — that fits the ruling, which forbids prompting the human; the CLAUDE.md rule (§4.4) carries the
rest. This design does not create or push tags.

### 4.3 One suite pass inside the gate (G3)

`verify` becomes:

```
check-release-gate && typecheck && build && check-gate-env && verify-suite && ledger validate &&
check-claude-md-lines && check-hooks-path && build web && verify:ccloop-pin && verify:panel && npm run --ws check
```

- `scripts/check-gate-env.mjs` holds the up-front refusal `verify-control.mjs` has today (`ORCA_CCLOOP_BIN` and
  `ORCA_AGENTS_TABLE` set and resolvable), so the single pass fails fast exactly as before.
- `scripts/verify-suite.mjs` runs `vitest run` once over the whole root suite with `ORCA_CONTROL_VERIFY=1`,
  `ORCA_CHAIN_ID=chain-deadbeef`, `ORCA_CHAIN_SESSION=deadbeef-0000-4000-8000-000000000000` (the values
  `verify-chain.mjs` uses), at vitest's default worker count (`npm test` ran green that way in the last gate, 706 s).
  A missing `isolateChainEnv()` still turns that pass red (the I5 condition — `tests/checkpoint/write.test.ts` calls
  `writeCheckpoint` without `env`, so a leaked `ORCA_CHAIN_SESSION` throws `session-mismatch`), and the formal control
  file still refuses to skip (its module-level throw does not depend on the chain variables). Formal control and the
  chain variables have never been set together; no reader of both was found (registered).
- `verify:control`, `verify:scheduler` and `verify:chain` stay as standalone scripts (they can still be run by name)
  but leave the `verify` chain. `verify-chain.mjs` drops its first `tests/chain` run (already in the suite).
- Coverage cost (accepted): no gate pass runs with the chain variables **unset**; every daily `npm test` does, and tests
  that need them unset already call `isolateChainEnv()`. The gate's suite runs at the default worker count instead of
  `verify:chain`'s 2 — if that proves flaky under load, `docs/handoff/known-load-flakes.md` is where it goes.
- `tests/service/build.test.ts:36` pins the old chain text; it is rewritten (session grant, logged) to pin the new
  chain — release gate first, `verify-suite` present, plain `npm test` absent.

### 4.4 Rules and docs (G4)

- `CLAUDE.md` gains one rule, "Test scope": day-to-day work, fix rounds, merging into `main`, push and installing the
  panel service run `npm test` (affected) plus typecheck; the full gate (`npm run verify`) runs only when the human
  asked for a tagged release; a plan never schedules the full gate except in a release plan. The line budget
  (`scripts/check-claude-md-lines.mjs`, 200) must still hold.
- `docs/cli.md` (lines describing `verify:control` as part of `npm run verify`) and the handoff are updated. History
  under `.superpowers/sdd/` and published specs are not edited.
- New test files must avoid the skip spellings `tests/panel/noSkips.test.ts:78` scans for.

## 5. Criteria (each a command with an exit code, Rule 4)

Every new branch gets a test that fails without it and a named mutation seen red (Rule 9).

1. **Selection rows**: `test-affected.mjs --dry-run --base <commit>` on fixture repositories (built in a temp dir by the
   test, with a resolvable vitest and config) selects exactly the expected files for each row of §4.1's table — one
   test per row (including zero for a docs-only change, a deleted module's mirror directory, a web file reaching a root
   test, a config file selecting the whole suite), each with a mutation that deletes that row's rule.
2. **Change sources**: a staged-only, an unstaged-only and an untracked-only change are each selected; a mutation
   dropping one source reds its test.
3. **Base default**: with an `origin/main` behind local `main`, a commit present only on local `main` is selected.
4. **Pass-through**: `npm test -- <path>` runs exactly that path (stub vitest records argv).
5. **Running and exit**: with a stub typecheck that fails and vitest that passes, the script exits non-zero (and the
   reverse); with an empty selection vitest is not invoked and the zero line is printed byte-for-byte; the typecheck
   runs even when the selection is empty.
6. **Skip report**: a selected file that skips a test makes the output name that file and the count.
7. **Release gate**: `check-release-gate.mjs` exits 2 with `ORCA_RELEASE_TAG` unset or empty and 0 when set; the
   `verify` script's first step is it.
8. **Gate chain**: `build.test.ts` pins the new `verify` chain (release gate first, `check-gate-env`, `verify-suite`,
   no `npm test`); mutation: put `npm test` back in place of `verify-suite` ⇒ red.
9. **Single pass environment**: `verify-suite.mjs` passes the three variables to the one vitest it spawns (stub vitest
   records its environment); mutation: drop one variable ⇒ red.
10. **I5 survives**: in a clone, removing `isolateChainEnv()` from `tests/checkpoint/write.test.ts` makes
    `node scripts/verify-suite.mjs tests/checkpoint/write.test.ts` red, and restoring it makes it green.
11. `npm run typecheck` and the touched test folders green.

The full gate itself is not run this round (§2: release only).

## 6. Left to the builder

File layout inside `scripts/`, the node-API calls used for `related`, the exact selection-table format, and the stub
technique in the criteria.
