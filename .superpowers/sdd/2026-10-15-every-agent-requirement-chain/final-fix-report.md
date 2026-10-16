# Final-fix report: I4 (ccloop), I2 and I1 (Orca)

Who: single fix agent of Orca session a852f96a (Claude Opus 5.5), 2026-10-16 Asia/Shanghai. No subagents. No push,
merge, rebase, amend, reset, checkout or delete. All git via `/usr/bin/git`; commits with `git commit -F` and exact
paths. Logs: `LOGS=/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs`
(`$LOGS/i4-*`, `$LOGS/i2-*`, `$LOGS/i1-*`); I4 probe artefacts in `$SCRATCH/i4/` (`probe.sh`, `mut.sh`, `out/`).

## I4 (ccloop worktree `ccloop-wt/every-agent-chain`, base d9cb32c) -- commit 15d3494

`fix(agents): codex single call also turns off the other on-by-default tool flags and notify`

### What changed
- `src/agents/codexCatalog.ts`: `CODEX_SINGLE_CALL_FEATURES` gains browser_use, browser_use_external, code_mode_host,
  computer_use, goals, hooks, in_app_browser, realtime_conversation, remote_plugin, skill_search, sleep_tool,
  tool_suggest (20 names, alphabetical). Unchanged filter: only names the installed `codex features list` prints are sent.
- `src/agents/codexIsolation.ts`: `CODEX_SINGLE_CALL_CONFIG` gains `notify=[]` (so the isolated `mcp list` probe gets it too).
- Fixture `tests/fixtures/fake-codex.mjs` (pre-existing file; listed for the human): default `features list` = the 20
  names plus `browser_use_full_cdp_access` (listed by real codex, not ccloop's).
- Criteria corrected (all in files new on this branch, exact, not loosened): `codexSingleCall.test.ts` ISOLATION
  constant (+`notify=[]`), C8.2 (full 20-flag exact list), C8.4b (foreign flag is now `browser_use_full_cdp_access`;
  expects apps, hooks, shell_tool), C8.10d probe `-c` list (+`notify=[]`), C8.10e feature count 8 -> 20;
  `catalogProbe.test.ts` codex decode features (exact 20); `fakeCatalogFixtures.test.ts` default list (exact 21).
  No pre-branch criterion changed.

### Zero-cost check on real codex-cli 0.160.0 (`$SCRATCH/i4/probe.sh`, log `$LOGS/i4-probe.log`)
Binary `/Users/biran/.nvm/versions/node/v22.13.1/bin/codex` (`codex --version` = codex-cli 0.160.0). `env -i` with
PATH, private `HOME` and private `CODEX_HOME` under `/private/tmp/i4codex-Wbtq` with symlinks to `~/.codex/auth.json`
and `config.toml`. No model call.
- `features list` RC 0, stderr 0 B: all 12 added flags print `stable true` (`out/features-list.out`).
- isolated `mcp list --json` (with the isolation keys incl. `notify=[]`) RC 0, stderr 0 B: computer-use, figma, node_repl.
- `debug prompt-input` with the full list (`out/full-c-list.txt`: 7 isolation keys, 19 `=false` flags +
  `skip_host_skill_discovery=true`, 3 MCP overrides) and a one-line prompt: **RC 0, stderr 0 B**, 6381 B.
- Same render with the old list: RC 0, 6381 B; `diff` differs only in message ids and `create_time` (`out/diff-old-full.txt`).
- Control: `-c features.not_a_real_flag_i4=false` on `prompt-input` was also RC 0 (stderr 0 B). So prompt-input does
  not refuse unknown flags; spec §6.1's "Codex refuses an unknown flag" was not re-measured on `exec`. Filter kept.
- `~/.codex/auth.json`, `config.toml`: `ls -l` + `shasum` before/after `cmp` RC 0. Never printed contents. The
  person's `config.toml` has 1 line matching `^\s*notify\s*=` (counted only).
- Cleanup: the two credential links removed with `/bin/rm -f`; `/private/tmp/i4codex-Wbtq` (codex's own state) left
  for the human.

### Tests (`$LOGS/i4-focused.log`, `i4-focused2.log`, `i4-suites.json`, `i4-alone.txt`)
- `npm run build` RC 0 (`$LOGS/i4-build.log`).
- Focused (codexSingleCall, catalogProbe, fakeCatalogFixtures): first run 1 red (C8.10e count 8, a criterion the change
  forces; corrected), then 50/50 passed RC 0.
- `vitest run tests/runtime/codex tests/agents tests/control` (JSON reporter; the `tests/control` filter also matches
  `tests/controller`), load 17-36 while the Orca gate ran: **1071 total, 1063 passed, 8 failed, 0 skipped**, RC 1. The 8:
  updates.test.ts x3 (timeouts), phasesCompleted x1 (timeout), verifySavedResult r1 modified=false (known n=1),
  extractFinalObject 16 MiB x2 (5297/3186 ms vs 3000), skillsController handoff-abort (fixture marker missing). None in a
  touched file. Each file re-run alone (load 24 -> 12): updates 15/15, phasesCompleted 8/8, verifySavedResult 26/26,
  extractFinalObject 58/58, skillsController 11/11, all RC 0 => load flakes by the alone rule.

### Mutations (clone `/private/tmp/mut-WfMQ/repo`, uncommitted files copied in; `$SCRATCH/i4/mut.sh`)
Baseline 50/50 green (`$LOGS/i4-mut-baseline.log`).
- M-I4.1 drop `"notify=[]"` from CODEX_SINGLE_CALL_CONFIG (sha256 81a459f0... -> 96587fb8...): red C8.2, C8.4b, C8.10d.
- M-I4.2 drop `"hooks"` from CODEX_SINGLE_CALL_FEATURES (15fec6d7... -> 224bc6c7...): red catalogProbe codex decode,
  C8.2, C8.4b, C8.10e.
- M-I4.3 bypass the features-list filter (`.filter(() => true)`) (15fec6d7... -> 643f308f...): red C8.4b.
Restore: each file `cmp` RC 0 against the worktree; `$LOGS/i4-mut-restore.txt` no DIFF lines; worktree diff 13917 B
== clone diff (incl. --cached) 13917 B. `pgrep -fl "fake-omp|fake-codex|worker.js"` before/after: 0 B. Clone's
node_modules link removed; clone dir left for the human.

## I2 (Orca worktree `Orca-wt/every-agent-chain`, base e2bfdc0e) -- commit 5a5a24dc

`docs(readme): codex runs clarify, split and estimate as a soft single call`

- README :129-131 (kinds paragraph), :381-385 (Requirements) and :579 (troubleshooting row) rewritten: codex runs
  clarify/split/estimate as a single call in soft estimate mode only; output not capped by the CLI, checked after the
  call, overrun booked and shown; strict mode refuses codex (`agent-selection-rejected`, reason
  `single-call-unavailable`). The omp half of the same sentences ("not yet" for omp) was already false (omp single call
  is on main): now "omp for a model whose catalog row carries an output cap; not OpenRouter" (`ompSingleCallExecution`).
- Beyond the three passages, same commit, because each becomes false on merge: the syncskill row's "does not give Codex
  or OMP single-call capability" and the estimator-profile note "declared-null window => blocked-capability" (now R7:
  ccloop's reported window is used; blocked only when ccloop reports none). Flag for the controller: scope widened by
  these two sentences.
- Wording scan `grep -n -i -E "codex.{0,120}(bounded|capped)|(bounded|capped).{0,120}codex" README.md` RC 1 (no
  match; `$LOGS/i2-wording.txt`). Stale scan for `not yet|pinned Codex|only .claude. provides` RC 1.
- README criteria: grep of tests/, web/tests/, scripts/ found no criterion that reads Orca's own README.md (only
  fixtures writing a target repo's README) -- nothing to run. Pre-commit hook: "ok: CLAUDE.md is 150/200 lines".
- Not edited (outside README): `web/src/locales/en.ts:824` / `zh.ts:719` `codexUnsupported` ("Codex does not support
  bounded single-call clarification...") -- stale; grep shows no reference to the key in web/src or web/tests (dead text).

## I1 (Orca, same worktree) -- commit 83e78c9a

`docs(spec): append corrections and registrations after implementation to the every-agent spec`

- Appended `## 11. Corrections and registrations after implementation (session a852f96a, 2026-10-16)` to
  `docs/superpowers/specs/2026-10-15-every-agent-requirement-chain-design.md`: 11.1 Rule 17 registration of the codex
  private homes (path, both writers, ccloop's writes, codex's writes, residue, no-cache-dir fallbacks; supersedes §6.1
  "under the run directory"); 11.2 §2.5 re-render (final `-c` list, I4 zero-cost check, Task 0 byte totals, P1/P1c
  input_tokens 11590 -> 10811, framing value is the human's); 11.3 P1 error items / P1b undefined-MCP finding;
  11.4 live vs cached reads, version cached (human, issue 8); 11.5 residuals (token rotation, keyring, worker log sink,
  codex phase skills, omp config.yaml/PI_CONFIG_DIR, old cache entries, I4 flags unpaid).
- Original text proof: `head -c 20751 <spec> | shasum -a 256` = c9a5988876c586b3f5fc1835de97425b550cc28bbf9ae4fb12746c4fbba5b6e8
  before and after; `git diff --numstat` 132 insertions, 0 deletions (`$LOGS/i1-append-check3.txt`).
- Evidence pointers: ccloop commit subjects and the ledger path `.superpowers/sdd/2026-10-15-every-agent-requirement-chain/progress.md`.

## Concerns
1. I4 flags and `notify=[]` are verified at render time only (`prompt-input` RC 0); whether `notify=[]` actually
   suppresses the person's notify program, and that tools are off, needs a paid call (not made).
2. `prompt-input` accepts an unknown feature flag (RC 0): the spec's "codex refuses an unknown flag" is unconfirmed for
   prompt-input; exec not re-measured.
3. Old cache entries (≤30 min) keep the earlier, shorter feature list after an upgrade (key has no ccloop version).
4. I2 scope widened by two README sentences (syncskill row, R7 note); dead `codexUnsupported` locale strings left.
5. The ccloop branch tip moved d9cb32c -> 15d3494: H1 / the repin must use 15d3494, and the ccloop gate's affected
   files were run here only as the three dirs above, not a full gate.

I2 re-review residual (2026-10-16): README Cost section ~:571-572 now says estimating calls the model "unless neither the profile nor ccloop reports a context window for the selected agent" (R7); wording grep RC 1, `context window is .null.` grep RC 1 ($LOGS/i2b-wording.txt); commit 88314f5c `docs(readme): estimating calls the model unless no context window is known`.
