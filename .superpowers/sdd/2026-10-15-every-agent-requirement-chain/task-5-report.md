# Task 5 report: `control models` and `ccloop agents models` (ccloop, part A, spec §3)

Implementer: subagent of Orca session a852f96a, 2026-10-16. Worktree /Users/biran/code/skills/orca/ccloop-wt/every-agent-chain,
base b4bf908, commit **db69eff** `feat(control): list an installation's models (control models, agents models)`.
LOGS = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs.

## What I did
- `src/agents/models.ts` (new): `listAgentModels` as in the brief. Missing id ⇒ `AgentError("agent-installation-missing", id)`
  (control exit 2, RF5); kinds other than omp/codex ⇒ `source: "none"`, `observedAt: null`, `[]`, nothing spawned (plan issue 15);
  a catalog failure rethrows the kind's own message (omp-model-catalog-*, agent-catalog-unavailable, with stage + elapsedMs) as a
  plain Error ⇒ exit 1 (plan issues 1/2); codex lists only `listed === true` rows (plan issue 6).
- `src/control/protocol.ts`: `"models"` method, request/payload types, `payloadSchemas.models` (`installation: idSchema, refresh: boolean`, strict).
- `src/control/command.ts`: METHODS, `defaultHandler` branch (no `log`: the wire prints nothing on stderr — ruling), `modelsSchema` + `validateResponse` line.
- `src/agents/command.ts`: `models` branch, exact shape `--agents <t> --installation <id> [--refresh]`, else `agents-command-invalid`;
  `log` writes the `ccloop-agent-catalog:` lines to process stderr. The doc addition is a new `//` line under the existing JSDoc
  (a second `/** */` block would detach the first).
- `tests/control/modelsControl.test.ts`: the brief's 7 tests, plus the changes below.

## Departures from the brief's test text (each to add an assertion, none loosens)
1. **Codex fixture gets its own empty `configDir`** (`<dir>/codex-home`, 0700). Without it the first green run answered
   `contextWindowTokens: 1000000` for both codex rows: `readCodexCatalog` read the person's real `~/.codex/config.toml`
   (`model_context_window`). Log: the first `t5-green.log` run (overwritten; the failure is quoted here:
   `- "contextWindowTokens": 272000, + "contextWindowTokens": 1000000`). See Concerns 1.
2. **"spawning nothing" is asserted**: the claude command is a sh wrapper that appends `spawn` to `<dir>/claude-spawns` on every
   invocation (`--version` included); the test asserts the file is unchanged across `control models`.
3. **Wire stderr = ""** (ruling): the omp test spies `process.stderr.write` around the first (cache-miss) call and asserts `[]`,
   and asserts `answer.stderr === ""` on both calls; the codex test asserts `answer.stderr === ""`.
4. **"logs a miss on stderr"** (ruling): spies `process.stderr.write`, asserts exactly one write matching
   `/^ccloop-agent-catalog: miss codex [0-9a-f]{12}\n$/`.
5. **New test** "refuses any other `ccloop agents models` shape" (3 argv shapes ⇒ `{code 1, "", "agents-command-invalid\n"}`).
   It was already green in the red run (the old code refuses every `models` argv); its red is M5.6.

## RED / GREEN
- RED: `$LOGS/t5-red.log`, RC=1, 7 failed / 1 passed (the new shape test, see 5). Failures: control-command-invalid (wire), agents-command-invalid (CLI).
- GREEN: `vitest run tests/control/modelsControl.test.ts tests/control/command.test.ts tests/control/protocol.test.ts tests/agents/command.test.ts`
  ⇒ `$LOGS/t5-green.log`, RC=0, 4 files, 48 passed (8 + 7 + 22 + 11), none skipped.
- `tsc --noEmit -p .` (tsconfig includes tests) ⇒ `$LOGS/t5-tsc.log`, RC=0.

## Mutations (clone /private/tmp/mut-wJkI/repo at b4bf908 + the 5 uncommitted files copied in; node_modules symlink removed; clone left for the human)
Baseline green in clone: `$LOGS/t5m-baseline.log` (8 passed, RC=0). Restore proof per mutation: `cmp` of each touched file against
the worktree ok, and clone `git diff`+`git diff --cached` = 7091 bytes before and after every mutation (the uncommitted copies; the
committed baseline is not 0 because the files under test were uncommitted when mutating). pgrep for fake-omp|fake-codex|worker.js empty before and after.

| # | Mutation | sha256 (before -> after) | Red in named test | Log |
|---|---|---|---|---|
| M5.1 | `!codex \|\| row.listed === true` → `true` | 2825f213… -> 9c4f19f5… | yes: "codex's listed rows only" (+ CLI test), gpt-reserve appears | t5m-M5.1.log |
| M5.2 | sort comparator → `0` | 2825f213… -> 6a42b1f0… | yes: "sorted in code-unit order" (+ codex, CLI) | t5m-M5.2.log |
| M5.3 | claude early return deleted | 2825f213… -> c07f64a1… | yes: "claude … source none" (empty stdout: `agent-catalog-unavailable: no rows`) | t5m-M5.3.log |
| M5.4a | `extra: 1` added to each row, `.strict()` kept | 2825f213… -> a5cfe5b1… | yes: omp + codex tests, `control-response-invalid` | t5m-M5.4a.log |
| M5.4b | `extra: 1` added AND the row's `.strict()` removed | models 2825f213… -> a5cfe5b1…; command 5d6b162d… -> 8eec8489… | no (green, RC=0) — recorded: only `.strict()` refuses the stray key | t5m-M5.4b.log |
| M5.5 | `refresh: request.refresh` → `refresh: false` | 5d6b162d… -> 410436c5… | yes: "refresh probes again" (`["models"]`) | t5m-M5.5.log |
| M5.6 | `argv[5] === "--refresh"` → `true` | a8d34f55… -> cbbc2540… | yes: "refuses any other … shape" (`--fresh` accepted) | t5m-M5.6.log |
| M5.7 | CLI `log` option removed | a8d34f55… -> 9be945ac… | yes: "logs a miss on stderr" (0 writes) | t5m-M5.7.log |
| M5.8 | control handler passes a stderr `log` | 5d6b162d… -> 07b42a67… | yes: omp test, `written` = `["ccloop-agent-catalog: miss omp …"]` | t5m-M5.8.log |
| M5.9 | claude branch probes (`readAgentCatalog(…, {refresh:true})`) then returns empty | 2825f213… -> 5a88c981… | yes: "spawning nothing" (`spawn\nspawn\n`) — M5.3 reddens at JSON.parse before the spawn assertion, so M5.9 measures it directly | t5m-M5.9.log |

Full sha256 lines: `$LOGS/t5m-<name>-sha.txt`; restore: `$LOGS/t5m-<name>-restore.txt`.

## Files changed
src/agents/models.ts (new), src/control/protocol.ts, src/control/command.ts, src/agents/command.ts, tests/control/modelsControl.test.ts (new).

## Rewritten criteria
None.

## Self-review
Read the full diff (`$LOGS/t5-diff.txt` for src/control; agents/command.ts diff shown in-session). Types: payload/request unions extended;
`attachControlMethod`'s default branch spreads `{installation, refresh}`. No existing comment edited. `control models` gets no caller
deadline, so readAgentCatalog's default 30 s applies.

## Concerns
1. **Real `~/.codex/config.toml` leaks into criteria.** Any codex fixture with `configDir: null` and no CODEX_HOME reads the person's
   config.toml (`HOME/.codex`); on this machine it sets `model_context_window = 1000000`. I isolated this task's fixture. Criteria
   that expect 272000 from the fake catalog with `configDir: null` (E1/E5-style, Orca E6, Task 6/8/10 criteria) will be red on this
   machine, and they read real user data (Orca Rule 17 / ccloop's equivalent). Suggest: the vitest setup (relocateCatalogCache.ts) also
   sets `CODEX_HOME` to an empty temp dir, or the fixtures pass a configDir — controller's call (fixture change for the human list).
2. The published comment in `parseCommand` ("only capabilities and accept read the table") was already stale (observe/preview read it)
   and now also omits `models`; left untouched (Rule 3 / ERRATUM rule), flagging only.
3. `ccloop agents models` writes the miss lines straight to process stderr (per brief), so on failure the process's stderr starts with
   the miss line, not the code; Orca uses `control models`, which is unaffected.
4. Rule 14: I first displayed mutation logs with `sed -n 1,25p` (a filter); I then read every mutation log whole. No conclusion rests on the filtered view.

---

## Fix round 1/5 (2026-10-16, same implementer session): commit **0085309**
`test(agents): every test file gets an empty CODEX_HOME; agents models --refresh re-probes` (base db69eff).

### Changes
1. `tests/setup/relocateCatalogCache.ts` (new on this branch): also sets `process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "chome-"))`.
   It runs after scopeTmpdir.ts, so the dir is under the scoped TMPDIR and is removed with it. I extended the doc comment with the reason
   and the 2026-10-16 measurement (1000000 instead of 272000).
2. New criterion: "a codex installation with no configDir never reads a window from HOME/.codex". It uses a codex installation with
   `configDir: null` (asserted) and puts a decoy `<fake HOME>/.codex/config.toml` with `model_context_window = 999999` in place.
   `process.env.HOME` is pointed at the fake HOME for the call and restored in `finally`. The expected windows are `[272000, 272000]`.
3. New criterion: "`ccloop agents models --refresh` probes again over a warm cache". It counts `debug-models` lines in the codex
   `catalog-calls`. They go 1 after the first plain call, stay 1 after a second plain call (warm), and reach 2 after `--refresh`,
   whose `source` is `"probe"`. Its stderr miss lines are silenced with a spy.

### Whole-set run (tests/agents tests/control tests/runtime; the `tests/control` filter also matched tests/controller)
`$LOGS/t5f1-wide.log`, RC=1: 131 files, 1305 passed and 2 failed (1307 total), plus 1 unhandled error. I read the log whole.
- `tests/agents/updates.test.ts` "probes a path choice's offered custom argv when the bare binary is unavailable" timed out at 5000 ms.
- `tests/runtime/omp/ompPhase.test.ts` "keeps a stopped phase's completed-message tokens diagnostic…" failed its 1000 ms ready-file poll. The unhandled ENOENT `outcome.json` came from the same file.
- Diagnosis: I ran both files alone under the new setup. `$LOGS/t5f1-reds-alone.log`, RC=0, 29/29 passed. Both match load-flake candidates
  already in the ledger (Task 2: updates.test.ts 5037 ms timeout; Task 4: ompPhase ready-file poll plus the ENOENT outcome.json teardown race).
  The CODEX_HOME change did not cause either one, and I edited neither. **No criterion changed because of the CODEX_HOME change.**
  Note: `singleCallCapability.test.ts` C1 ("null for codex") is still green. E1 has not been rewritten yet (a later task).

### Mutations (clone /private/tmp/mut-92Pn/repo at db69eff with the 2 changed test files copied in; node_modules symlink removed; clone left)
Baseline in the clone: `$LOGS/t5f1m-baseline.log`, 10 passed, RC=0. Restore: `cmp` ok, and the clone diff was 4095 bytes before and after each mutation. pgrep was empty afterwards.
| # | Mutation | sha256 | Red in named test | Log |
|---|---|---|---|---|
| MF1 | drop the `process.env.CODEX_HOME = …` line in the setup file | 616e8d59… -> 00af241f… | yes: "no configDir never reads a window from HOME/.codex" (`[999999, 999999]`) | t5m-MF1.log |
| MF2 | CLI `refresh: argv.length === 6` → `refresh: false` | a8d34f55… -> c04959c3… | yes: "`--refresh` probes again over a warm cache" (`source` `"cache"`) | t5m-MF2.log |

### Verification
- `tsc --noEmit -p .`: `$LOGS/t5f1-tsc.log`, RC=0.
- Neighbour set (modelsControl, control/command, control/protocol, agents/command): `$LOGS/t5f1-green.log`, RC=0, 50 passed.
- Diff: `$LOGS/t5f1-diff.txt`. The files staged were exactly the setup file and the test file.

### Concern
- Fixture change for the human's list: `tests/setup/relocateCatalogCache.ts` now also sets CODEX_HOME for every ccloop test file.
  A test that needs CODEX_HOME unset has to delete it itself. None in the whole set did (extraEnv.test.ts reads `process.env.CODEX_HOME ?? null` dynamically).
