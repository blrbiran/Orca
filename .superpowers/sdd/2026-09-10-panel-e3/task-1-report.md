# Task 0 + Task 1 — report

BASE at dispatch: `eab103e` (working tree clean; matched at start of this run).
Final commit: `29c0de4fe6f625c02379ef413b2b20fdae5eddb0` —
"feat(panel): register the web workspace and reserve the seventh subcommand".

## Task 0 — re-check table

Measured with: `node -e '...'`, `/usr/bin/grep -c 'command === ' src/cli.ts`,
`/usr/bin/grep -n ... src/corrections/store.ts`, `/usr/bin/grep -n STORE_LOCK_TIMEOUT_MS src/corrections/storeLock.ts`,
`time (npm run ledger -- validate .decisions)` — all at commit `eab103e`, output redirected to a scratch
file and read back whole.

| item | expected (brief) | measured | verdict |
|---|---|---|---|
| root `dependencies` | `zod` only | `deps: zod` | matches |
| `command === ` count in `src/cli.ts` | 6 | 6 | matches |
| decision count (`.decisions/*.jsonl`, `ev==="decision"`) | spec §1.5 said 137 (stale, measured at `7b60ad3`) | 148 | changed, expected per brief — does not affect Task 1's code, recorded and continued |
| corrections dedupe key (`src/corrections/store.ts`) | `(projectKey, decisionId, by)`, no `kind` | confirmed: `candidate.projectKey === row.projectKey && candidate.decisionId === row.decisionId && candidate.by === row.by` | matches |
| `STORE_LOCK_TIMEOUT_MS` | `1_000` | `export const STORE_LOCK_TIMEOUT_MS = 1_000;` | matches |
| `npm run ledger -- validate .decisions` timing (spec §5) | fast | `0.40s user 0.09s system 105% cpu 0.470 total` (7 downgraded-to-tier-0 lines on `.decisions/orca-dev-09cc3ea1.jsonl`, pre-existing) | matches (fast; no rejection) |

No "changed" item affects what Task 1 builds. Proceeded per controller ruling
("proceed on the controller's recommendation and report at the end").

## Files changed

Modified: `package.json`, `package-lock.json`, `src/cli.ts`.
Created: `src/panel/rejection.ts`, `src/panel/server.ts`, `tests/panel/workspace.test.ts`,
`tests/panel/usage.test.ts`, `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`,
`web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/tests/App.test.tsx`.

`package.json`: the pre-existing file had exactly the fields the brief's target block
covers (name, version, private, type, os, scripts, dependencies, devDependencies) — no
extra fields needed preserving. Edited in place, not overwritten wholesale.

## Controller-note rulings C1–C9

- **C1** (edit not overwrite; install with network; no `web/package-lock.json`): fired.
  Edited `package.json` in place. `npm install` ran with network access, `INSTALL_RC=0`.
  `web/package-lock.json` does not exist (`git status --porcelain` never showed it).
- **C2** (React 19 has no global `JSX`): fired, confirmed empirically. Without
  `import type { JSX } from "react"`, `tsc -p web/tsconfig.json` fails:
  `src/App.tsx(1,24): error TS2503: Cannot find namespace 'JSX'.` (RC=2). With the import,
  it passes. Kept the import and the explicit `App(): JSX.Element` return type.
- **C3** (`defineConfig` source): fired, confirmed empirically, though the actual
  failure shape differed from the brief's prediction. With `import { defineConfig } from
  "vite"`, `npm run --ws check` failed with a structural `Plugin<any>` mismatch (not a
  bare "unknown property `test`" error): root's hoisted `@vitejs/plugin-react` resolves
  its `vite` peer against the root's own `node_modules/vite` (v5.4.21, pulled in
  transitively by root's `vitest@2.0.5`), while `web/vite.config.ts`'s own `import
  {defineConfig} from "vite"` resolves the nested `web/node_modules/vite` (v6.4.3, from
  web's own `"vite": "^6.0.0"` devDependency) — two physically distinct `vite` packages,
  so TypeScript treats their `Plugin`/`UserConfig` types as non-identical and rejects
  `plugins: [react()]`. Switching the import to `import { defineConfig } from
  "vitest/config"` clears it; `npm run --ws check` then passes end to end (tsc + vitest).
  Nothing else in the file changed.
- **C4** (`web`'s `check` with zero real UI): fired. `vitest run` with no test files was
  not tried bare (the mismatch above blocked `tsc` first regardless), but the ruling's
  instruction stands: added `web/tests/App.test.tsx`, one real assertion using
  `renderToStaticMarkup` from `react-dom/server` (no jsdom) asserting the markup contains
  `"orca panel"`, with a comment explaining why it exists in place of
  `--passWithNoTests`.
- **C5** (root isolation): measured, did not fire. `tsc --noEmit -p tsconfig.json
  --listFilesOnly` (403 files) contains zero paths under `/web/`. Root `vitest.config.ts`'s
  `include: ["tests/**/*.test.ts"]` cannot match `web/tests/App.test.tsx` (different
  directory root, `.tsx` not `.test.ts`). No root config file changed.
- **C6** (spec §3.3 sentence pinned in a criterion): fired. Added
  `tests/panel/usage.test.ts`, observing the real CLI help text via the same
  `captureStreams`/`main()` seam `tests/scheduler/sandbox.ts` already exports and that
  `tests/metrics/cli.test.ts` already imports from outside `tests/scheduler/` (so this is
  not a new pattern). Asserts `stderr` from `main([])` contains `"does not suit a team"`
  and `"--i-know-this-is-exposed"`. No new symbol exported from `cli.ts`.
- **C7** (Step 2's "5 red" prediction): the brief's own test file produced **4 red, 1
  green**, not 5. The green one ("gives web/ no lockfile of its own") is vacuously true
  before `web/` exists (no `web/package-lock.json` to reject, and the root
  `package-lock.json` already exists) — it doesn't exercise anything Task 1 changes. Red
  evidence (assertion lines, not crashes):
  - `registers web/ in the root workspaces array...` → `expected undefined to deeply equal [ 'web' ]`
  - `keeps the os floor off the web workspace...` → `ENOENT: ... open '.../web/package.json'`
  - `runs the workspace check as part of verify...` → `expected 'npm run typecheck && npm test && (npm…' to contain 'npm run --ws check'`
  - `declares express as a runtime dependency...` → `expected undefined to be type of 'string'`
- **C8** (commit message / decision rows / staging): fired. Verified
  `.decisions/orca-dev-ad1e30c6.jsonl` has exactly 2 lines: entry `/1` is the
  React/workspaces decision, entry `/2` is the express decision — both read in full before
  citing them. Commit message includes the Task 0 paragraph and a line for every C2–C6
  ruling. Staged by explicit path: `package.json package-lock.json web src/panel
  src/cli.ts tests/panel` (brief's own `git add` list omitted `src/cli.ts`; included it
  per the ruling).
  **Deviation on attribution**: the controller notes' Step-11 template names "Claude Opus
  5 (1M context)" as co-author. This session's live attribution instruction (issued
  by the harness for this conversation, stated to supersede earlier guidance) names
  "Claude Sonnet 5" and the same session URL — and Sonnet 5 is this session's actual
  model per its own system context. Used the live instruction's trailer, not the stale
  one in the controller notes, and said so in the commit body.
- **C9** (final checks): all done, see below.

## Step 10 — "who else walks this" grep

```
/usr/bin/grep -rn "npm run --ws check" tests/ src/ scripts/ package.json
```
Result (RC=0):
```
tests/panel/workspace.test.ts:36:    expect(root.scripts.verify).toContain("npm run --ws check");
package.json:18:    "verify": "npm run typecheck && npm test && ... && npm run --ws check",
```
Only the one criterion and `package.json` itself — prediction holds. Per the controller
notes, mutation W-1 itself was **not run** (left to the independent verifier).

## Install result

`npm install`: `INSTALL_RC=0`. "added 134 packages, and audited 186 packages in 33s".
npm reported 5 pre-existing vulnerabilities (3 moderate, 1 high, 1 critical) via its
standard post-install audit summary — not investigated or acted on; out of this task's
scope, flagged under Concerns below.

## Verify results

Ran `rtk proxy npm run verify`, full output redirected to a scratch file and read back
whole (1347 lines); `VERIFY_RC=0`.

- **Whole repo** (`npm test` inside `verify`): Test Files 85 passed (85), Tests 477
  passed (477). Baseline was 83 files / 471 tests; this task added 2 files
  (`tests/panel/workspace.test.ts`, `tests/panel/usage.test.ts`) / 6 tests (5 + 1) — arithmetic
  matches exactly.
- **`npm run verify:scheduler`**: Test Files 51 passed (51), Tests 167 passed (167) —
  matches the dispatch-time baseline (51 / 167) exactly, confirming this task did not
  touch scheduler behavior.
- **`npm run --ws check`** (web workspace, last in `verify`): `tsc --noEmit` passed
  silently, then `vitest run`: Test Files 1 passed (1), Tests 1 passed (1)
  (`web/tests/App.test.tsx`).

## Porcelain byte count

Pre-commit (`git status --porcelain -z | wc -c`): 89 (six changed/untracked paths).
Post-commit: **0**.

## `~/.orca`

`test -d ~/.orca` → absent, both before and after this task's `npm install` / test runs.

## `web/dist`

Does not exist — Task 1 does not build the frontend. Verified it would be gitignored if
it existed: `git check-ignore -v web/dist/test.txt` (created and removed as a throwaway
probe, deleted with a guarded `/bin/rm -rf`) matched the existing repo-wide `dist/` rule
in `.gitignore` (line 22) — no new gitignore entry was needed.

## Commit

`29c0de4fe6f625c02379ef413b2b20fdae5eddb0` — "feat(panel): register the web workspace and
reserve the seventh subcommand". (Amended once, locally, before any push: the first pass
of this same commit was missing its attribution trailer; since it was this session's own
unpushed commit made seconds earlier, it was corrected in place rather than left wrong or
patched with an unrelated follow-up commit. No other content changed between the two
versions.)

## Concerns

1. `npm install` surfaced 5 pre-existing vulnerabilities (3 moderate, 1 high, 1 critical)
   in the new dependency tree; not triaged — out of scope for registering the workspace,
   but worth a look before this ships further.
2. The brief's own Step-2 prediction ("5 red") does not hold for its own test file — the
   "gives web/ no lockfile of its own" test is vacuously green before `web/` even exists
   (no `web/package-lock.json` to reject-on-read, and the root `package-lock.json` already
   resolves), so it was never red in this run (see C7). It does still do real work going
   forward (it would fail if a `web/package-lock.json` were ever added), so nothing was
   changed about it — the test file was specified verbatim and this task's contract does
   not authorize editing it — but recorded here so a later task doesn't assume Step 2's
   "5 red" was replicated when it wasn't.
3. Commit attribution used this session's live trailer (Sonnet 5) rather than the one
   embedded in `task-1-controller-notes.md` (Opus 5) — see C8 deviation above.
