# Task 8 report — the codex single call (ccloop, part D adapter)

Implementer: Claude Opus 5.5 subagent of Orca session a852f96a, 2026-10-16. Worktree
`/Users/biran/code/skills/orca/ccloop-wt/every-agent-chain`, branch `codex/every-agent-chain`, base `f93e37e`.
Commit: **`67c6e2e`** `feat(runtime): codex single call, tools off in a private home, bound checked after the fact`.
LOGS = `/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs`.

Status: DONE_WITH_CONCERNS (concerns at the end).

## What was done

- `src/runtime/codex/codexSingleCall.ts` (new): `CODEX_SINGLE_CALL_CONFIG` (5 ISO keys + `features.plugins=false`,
  ruling 1), `codexSingleCallArgs` (tool flags = features the installed codex lists; a flag already set in the config list
  is not sent again, so `plugins` appears exactly once; `skip_host_skill_discovery=true`), `codexSingleCallHome`,
  `decodeCodexSingleCall`.
- `codexSingleCallHome(input: {runDir, sourceCodexHome, executable, env})` — **signature differs from the brief** (ruling 3
  needs the executable and the env for the reuse path):
  - cache dir = `catalogCacheDir(env)`; path `<cache>/codex-home/<sha256(realpath(executable) + "\0" + source)>/{home,codex-home}`;
    each missing dir created with `mkdir` 0700 + explicit `chmod 0700`; `EEXIST` (existing or a concurrent creator) ⇒ left alone.
  - every call re-checks `auth.json` and `config.toml`: right symlink ⇒ kept; missing / pointing elsewhere / regular file ⇒
    symlink to `.<uuid>.link` in the same dir + `rename` over it; source file absent ⇒ whatever is there is removed.
  - no cache dir ⇒ a fresh `mkdtemp` pair under `<runDir>/codex/1/single-call/home-*` per call.
  - code comment registers the out-of-repo write (path, writer, residue = at most one `.<uuid>.link`).
- `CodexAdapter.singleCall`: deadline computed once (`min(request.timeoutMs, installation timeoutMs)`), `readAgentCatalog`
  under it with the worker stderr log (as omp); `codexFeatures === null` ⇒ `codex-single-call-unavailable` (`code`,
  `neverStarted: true`); source CODEX_HOME = `configDir ?? (absolute non-empty inherited CODEX_HOME) ?? (absolute HOME)/.codex ?? null`
  (ruling 2); spawn gets `timeRemainingMs = max(1, deadline - now)` — **deviation from the brief's `request.timeoutMs`**,
  following R6 / Task 4 fix ruling (re-check inside the call's deadline); env `{...process.env, HOME, CODEX_HOME}` private.
- `decodeCodexSingleCall`: brief's logic; additionally `decodeCodexUsage` errors (`codex-event-error`, `codex-no-completion`, …)
  and `codex-events-invalid` carry `observedTokens: observedTurnUsage(events)` ("usage observed so far is booked").
- `runCodexPhase.ts`: `PhaseRequest.phase: CodexPhase | "single-call"`, optional `spawn {args, env, schema}` (args/schema/env
  lines only; phase path unchanged).
- `src/agents/codex.ts`: `createAdapter` passes `{ installation }`.
- `src/runtime/types.ts`: ERRATUM appended (comment published: `/usr/bin/git merge-base --is-ancestor 522cd61c 1e05627…` rc=0,
  `a83a1426` rc=0; remote main `1e0562711d815b964f7b71ac2b993187af480263` from `git ls-remote origin main`). Original text kept
  verbatim; only the closing `*/` moved below the new ERRATUM. Tree scan for stale prose
  (`grep -rn -i -e "codex.*no single" -e "codex.*single call" -e "codex.*singleCall" -e "only a kind whose" -e "single-call-unsupported" src tests`):
  nothing else stale (codex.ts:61 already has its ERRATUM).
- `tests/fixtures/fake-codex.mjs`: brief's single-call branch (+ `lstatSync`), and `<marker>.catalog.json` gains `features?`
  (overrides the flags `features list` prints) — needed so a criterion can redden M3.6 (ruling 4 / Task 3 carry).

## Criteria (tests/runtime/codex/codexSingleCall.test.ts, 16 tests; tests/control/codexSingleCallWorker.test.ts, 2 tests)

C8.1, C8.2 (expected `-c` list = 5 ISO + `features.plugins=false` + apps, image_generation, multi_agent, shell_tool,
skip_host_skill_discovery=true, unified_exec, view_image — plugins once), C8.3 rewritten per ruling 3 into:
- C8.3: exact reused path `$CCLOOP_CACHE_DIR/codex-home/<sha256 computed in the test>/{home,codex-home}`, authIsLink, both
  readlinks = source files, modes 0700 (hash dir, home, codex-home); second call: same env, links intact, a pre-chmodded 0750
  home stays 0750 (existing dir's mode left alone).
- C8.3b: regular file at auth.json and a link to elsewhere at config.toml are repaired; source config.toml removed ⇒ link removed.
- C8.3c: two concurrent first calls ⇒ equal results; executable given as a symlink ⇒ path named by the real executable.
- C8.3d: env `{}` (no cache dir) ⇒ per-call dirs under `<runDir>/codex/1/single-call`, 0700, links.
- C8.3e (ruling 2): configDir null ⇒ links the inherited CODEX_HOME's auth.json; `""` and relative CODEX_HOME ⇒ `<HOME>/.codex`.
  (Sets/restores process.env CODEX_HOME and HOME in try/finally.)
C8.4 (brief), C8.4b (new: features list `apps, browser_use, shell_tool` ⇒ only apps and shell_tool sent, plugins still once),
C8.5 ×3 (brief), C8.5b ×2 (new: `codex-event-error` and `codex-events-invalid` book 36), C8.6, C8.7.
Worker: complete ⇒ `[["work",24],["handoff",0]]`, `{outcome:"complete",errorCode:null}`, output `{answer:"42"}`; tool ⇒
`[["work",36],["handoff",0]]`, `{outcome:"failed",errorCode:"codex-single-call-not-single:tool"}`.

## RED / GREEN

- RED `$LOGS/t8-red.log` RC=1: runtime file fails to load (`codexSingleCall.js` does not exist — red reason differs from the
  brief's "singleCall undefined" because the test imports `codexSingleCallHome`); worker file 2/2 failed `single-call-unsupported`.
  (A first red run `t8-red.log` overwritten after removing `defaultModel` from my codex table — the codex table schema has none.)
- GREEN Step 5 set (`codexSingleCall`, `codexSingleCallWorker`, `tests/runtime/codex`, `tests/control/singleCall.test.ts`,
  `tests/control/handoffDeadlineUsage.test.ts`): `$LOGS/t8-green3.log` RC=0, 25 files, 258 passed. (Earlier
  `t8-green.log` RC=1: `runCodexPhase.test.ts` "kills a TERM-ignoring process before returning abort" got `io-error` once
  under load; green alone 3/3 `t8-runphase-{1,2,3}.log`; `t8-green2.log` RC=0 255 passed. Load-flake candidate.)
- Neighbours `vitest run tests/agents tests/control` (prefix also picked up tests/controller): `$LOGS/t8-neighbours.log`
  RC=1, 806 passed, 1 failed: `agentsControl.test.ts` "accepts a claim frozen before the CLI was upgraded…" (`unknown` vs
  `accepted`); alone 2/2 green (`t8-agentsControl-{1,2}.log`, 14/14). Load-flake candidate (version probe under a 246 s
  fully parallel run); not touched by this diff's code path as far as I can see (codex accept does not call singleCall).
- `tsc --noEmit -p .` (includes tests): `$LOGS/t8-tsc.log` RC=0.

## Mutations (clone `/private/tmp/mut-TCD9/repo`, node_modules symlink removed; script `$SCRATCH/t8-mutate.py`; summary `$LOGS/t8m-summary.txt`)

Uncommitted files copied in by `cat`; baseline green `$LOGS/t8m-baseline.log` (18/18) and `t8m-baseline2.log` (16/16 after the
C8.3c edit). Restore: byte-equal to the worktree file after every mutation (True for all), clone `git diff`+`--cached` =
15463 bytes after every restore = the baseline after copying (the clone holds committed f93e37e; 15463 is the copied work).
Each `$LOGS/t8m-<id>.log` read whole (one slip: batch 3 first viewed through `grep -v`, then re-read whole with `cat`).

| id | mutation | red in | sha256 after |
|---|---|---|---|
| M8.1 | spawn env → `{...process.env,...extraEnv}` | C8.3 (HOME = real home, authIsLink null), C8.3b, C8.3e | ca8a38f2… |
| M8.2 | `symlink` → `copyFile` | C8.3 (authIsLink false), C8.3b-e | 108ccdb1… |
| M8.3 | features-null refusal removed (`?? []`) | C8.4 (no rejection) | ad43bc71… |
| M3.6 | codexCatalog filter → `[...CODEX_SINGLE_CALL_FEATURES]` | **C8.4b** (13 vs 8 values) — Task 3 carry closed | 1a4abce8… |
| M8.4 | `if (tool) throw` deleted | C8.5[tool] | e02818d6… |
| M8.5 | `messages > 2` | C8.5[messages] | ae3ed58e… |
| M8.6 | `turns > 2` | C8.5[turns]: got `codex-conflicting-completion` (decodeCodexUsage catches it) — red by name; registered, the turns guard is otherwise shadowed for booking | 12c4a66a… |
| M8.7 | TURNED_ON → "false" | C8.2 | 9b344c01… |
| M8.8 | sandbox workspace-write | C8.2 | 18b8e01f… |
| M8.9 | ALREADY_SET dedupe removed | C8.2 (plugins twice) | 914a6591… |
| M8.10 | `features.plugins=false` dropped from config | C8.2, C8.4b | c83d7762… |
| M8.11 | always fallback | C8.3, C8.3b, C8.3c | 500694be… |
| M8.12 | never fallback | C8.3d (join(null)) | b81fad6d… |
| M8.13 | chmod 0700 → 0755 | C8.3, C8.3d (493 vs 448) | 120e117d… |
| M8.13b | chmod line removed | **survives** (mkdir mode 0700 already yields 0700 under umask 022; vitest worker threads cannot set umask) — registered | 2a05c259… |
| M8.14 | EEXIST also chmods | C8.3 (0750 → 0700) | ebdad325… |
| M8.15 | EEXIST not tolerated | C8.3, C8.3b, C8.3c, C8.3e | 7fbbdefe… |
| M8.16 | fixed temp link name | C8.3c (EEXIST on concurrent symlink); re-run after the C8.3c edit, still red | fc0f73a8… |
| M8.17 | any symlink accepted | C8.3b (link to elsewhere kept) | 4c1b5264… |
| M8.18 | any existing entry kept | C8.3b (regular file kept) | db6bb79e… |
| M8.19 | stale link kept when source gone | C8.3b | 4f9b6b95… |
| M8.20 | inherited CODEX_HOME ignored | C8.3e | e585e81b… |
| M8.21 | isAbsolute check on inherited dropped | C8.3e (relative case) | ace2a3a5… |
| M8.22 | HOME fallback → null | C8.3e | 18603919… |
| M8.23 | source dropped from the hash | C8.3 | a85d3ebd… |
| M8.24 | realpath of executable dropped | first run survived (process.execPath is already real); C8.3c given a symlinked executable; re-run red (`$LOGS/t8m-run2.txt`) | a32c853f… |
| M8.25 | decodeCodexUsage error not given observedTokens | C8.5b[codex-event-error] (null vs 36) | 7e050960… |
| M8.26 | events-invalid without observedTokens | C8.5b[codex-events-invalid] | dc775d5c… |
| M8.27 | adapter singleCall always unsupported | worker test 2/2 | fd288f34… |

All "before" hashes: codexSingleCall.ts 10d11b92…, codexAdapter.ts 41764f15…, runCodexPhase.ts dde91d1f…, codexCatalog.ts 3c702017….
pgrep before/after (`$LOGS/pgrep-t8-before.txt`, `pgrep-t8-after.txt`): empty.

## Files changed

src/runtime/codex/codexSingleCall.ts (new), src/runtime/codex/codexAdapter.ts, src/runtime/codex/runCodexPhase.ts,
src/agents/codex.ts, src/runtime/types.ts (ERRATUM), tests/fixtures/fake-codex.mjs (fixture — for the human's fixture list),
tests/runtime/codex/codexSingleCall.test.ts (new), tests/control/codexSingleCallWorker.test.ts (new).

## Rewritten criteria

None existing. C8.3 is this task's own new criterion, rewritten from the brief per ruling 3 (not a published criterion).

## Self-review (read `$LOGS/t8-src.diff`)

- Phase path of runCodexPhase unchanged when `spawn` is absent (spawn-only ternaries).
- The ERRATUM edit keeps the published text verbatim.
- `plugins` sent once regardless of the features list (ruling 1); if a future codex drops the `plugins` flag, codex would
  refuse `Unknown feature flag` — the ledger already names that cost.

## Concerns

1. Registration of the new out-of-repo write (`<cache>/codex-home/...`) in the Orca spec (appended named section, Rule 17)
   is NOT done here (Orca repo, not this task's files); the code comment carries path/writer/residue. Needs Task 16 / controller.
2. Not covered by a red-seen criterion: M8.13b (explicit chmod after mkdir; survives under umask 022); R6 spawn timeout =
   deadline − now (no criterion distinguishes it from `request.timeoutMs`); M8.6's turns guard is shadowed for booking by
   `decodeCodexUsage(..., true)` (both book the same observed tokens; only the error name differs).
3. A pre-spawn abort / timeout ≤ 0 in runCodexPhase is not `neverStarted` (books null, as the codex phase does today) —
   unlike omp's single call (books 0). Left as the phase adapter behaves.
4. The reused private HOME/CODEX_HOME are shared by concurrent single calls of one installation (codex's own state files);
   accepted by the ruling. Stale reused dirs are never cleaned (no lifetime).
5. Load-flake candidates: runCodexPhase "kills a TERM-ignoring process" (io-error once, under the parallel run);
   agentsControl "accepts a claim frozen before the CLI was upgraded" (unknown once, in a 246 s full agents/control run).
6. Rule 14 slip: batch 3 of mutation logs was first viewed through `grep -v` (rtk also compacted it); re-read whole after.
7. Clone left for the human: `/private/tmp/mut-TCD9/repo` (node_modules link removed).

## Fix round 1 (coordinator items 1-5) — commit `efcd5b3`

Changes (src/runtime/codex/codexSingleCall.ts, codexAdapter.ts; tests/runtime/codex/codexSingleCall.test.ts):
1. `privateDir` now validates after create-or-find: `lstat` ⇒ `isDirectory() && !isSymbolicLink() && uid === process.getuid()`,
   else `codex-single-call-home-invalid:<path>` (message; `code` = `codex-single-call-home-invalid` without the path so the
   worker's errorCode stays a stable code), `neverStarted: true`. Applied to `<cache>/codex-home`, base, home, codex-home and
   the per-run chain (`<runDir>/codex/1/single-call`, mkdtemp base — explicitly chmodded 0700). Existing modes untouched.
   `control/paths.ts ensurePrivateDirectory` not reused: it needs an existing canonical root containing the target; the cache
   root may not exist and is not validated (a symlinked ~/.cache is legitimate).
2. `ensureLink`: any non-symlink at auth.json/config.toml (also when the source is gone) is renamed to
   `<name>.displaced-<Date.now()>` in the same dir, mode untouched, stderr line `ccloop-codex-single-call: displaced A to B`;
   only a symlink is ever removed.
3. Umask criterion C8.3h (0o000, 0o277), cached + per-run paths, 0700 on base/home/codex-home.
4. R6 criterion C8.8: `sleepMs: 1000` (debug models and features list each sleep ⇒ ~2 s), `hang: true`, timeoutMs 6000 ⇒
   `codex-timeout`, observed null, one `single-call`, 5900 ≤ elapsed < 7500.
5. Adapter: a non-completed outcome whose evidence dir has no `process.json` ⇒ `neverStarted: true` (runCodexPhase sends the
   prompt only after process.json is saved and onProcessRegistered returns, so nothing was sent). Covers pre-spawn abort,
   spawn error, deadline/io-error before registration. Phase path untouched. C8.9 (warm cache, pre-aborted signal ⇒ 0, no
   second spawn), C8.9b (missing cwd ⇒ `codex-spawn-error`, 0, no spawn). A missing binary cannot reach spawn through the
   adapter (the catalog probe fails first ⇒ codex-single-call-unavailable), hence the cwd trigger.

New criteria: C8.3f ×2 (symlinked home / codex-home ⇒ refused, 0, no `.calls`, source auth.json still a regular file `{}`),
C8.3g, C8.3h ×2, C8.8, C8.9, C8.9b. No existing criterion rewritten.

Tests: `$LOGS/t8f-focus.log` RC=0 (24/24). Green set (`tests/runtime/codex`, codexSingleCallWorker, singleCall,
handoffDeadlineUsage, singleCallCapability): `$LOGS/t8f-green.log` RC=1 — only `extractFinalObject` perf "under 3 s (plan)"
3168 ms (known load-flake candidate); rerun `$LOGS/t8f-green2.log` RC=0, 26 files, 271 passed. tsc `$LOGS/t8f-tsc.log` RC=0.

Mutations (clone `/private/tmp/mut-TCD9/repo`, changed files copied in by `cat`; baseline `$LOGS/t8f-baseline.log` RC=0 26/26;
script `$SCRATCH/t8f-mutate.py`; summary `$LOGS/t8f-run.txt`; all restored byte-equal, clone diff 16072 bytes = copied work
after every restore). Every earlier mutation re-run on the new code (Rule 17), anchors updated for the rewritten helpers; all
33 RC=1. Logs read whole for F1, F2, F4, F5, M8.13b; M8.14/15/18/19 read through `grep -v` of cache-miss lines (Rule 14
slip, logs whole on disk); the rest checked by RC only on this re-run (their named reds were read whole in the first round).
| id | mutation | red in |
|---|---|---|
| F1 | dir validation removed | C8.3f[home], C8.3f[codex-home] ("expected a rejection") |
| F2 | displace → `rm` | C8.3g (no displaced file) |
| M8.13b | explicit chmod removed | **now red**: C8.3h[0o277] (EACCES on the child mkdir) |
| F4 | spawn `timeRemainingMs: request.timeoutMs` | C8.8 (8216 ms ≥ 7500) |
| F5 | neverStarted mapping removed | C8.9, C8.9b |
| M8.18 | displacement skipped (rename over the regular file) | C8.3g |
| M8.19 | stale link kept when source gone | C8.3b |
| M8.14 | chmod on existing dir | C8.3 (0750 → 0700) |
| M8.15 | EEXIST not tolerated | 22 tests incl. C8.3, C8.3c |
pgrep after: empty (`$LOGS/pgrep-t8f-after.txt`). Clone node_modules link removed again.

Remaining notes: the turns guard is still shadowed for booking by decodeCodexUsage (M8.6 red only by error name);
spec registration of `<cache>/codex-home` (now also `*.displaced-*` residue) is still for the controller / Task 16.

## Fix round 2 (P1 findings) — commit `dcec51e`

### 1. codex `error` items
`decodeCodexSingleCall`: an `item.*` row whose item type is `error` is logged on stderr
(`ccloop-codex-single-call: codex error item "<message JSON>"`) and is not a tool; it is already in events.jsonl. Every
other item type that is not agent_message/reasoning (known or unknown) still sets `tool`. fake-codex's single-call default
stream now carries the three P1 error items verbatim (copied from `/private/tmp/p1-pJnD/src/run/codex/1/single-call/call-2owQxz/events.jsonl`,
item lines only; their messages hold no credentials, only the P1 private config path).

### 2. MCP servers — zero-cost measurement on the real codex (no model call)
Binary `/Users/biran/.nvm/versions/node/v22.13.1/bin/codex` (`codex-cli 0.160.0`), private dirs under
`$SCRATCH/mcp/{home,codex-home}` (0700), `codex-home/config.toml -> /Users/biran/.codex/config.toml` (only that link; no
auth.json; ~/.codex untouched). The JSON was piped straight into `$SCRATCH/mcp/names.py`, which prints only name / enabled /
keys. That is a deliberate filter: raw `mcp list` output can carry server env or headers, so it was never written to disk
or printed. Commands, run with `HOME=$S/home CODEX_HOME=$S/codex-home`:
- `codex mcp list --json` → RC 0, list of 3: computer-use enabled False, figma True, node_repl True (keys auth_status,
  disabled_reason, enabled, name, startup_timeout_sec, tool_timeout_sec, transport); stderr 0 B.
- `-c 'mcp_servers={}'` → unchanged (figma, node_repl still True): a whole-table override is merged, not replaced.
- `-c mcp_servers.figma.enabled=false -c mcp_servers.node_repl.enabled=false -c mcp_servers.computer-use.enabled=false`
  → all three enabled False, RC 0.
- `-c mcp_servers.nonexistent.enabled=false` → RC 1, "failed to load bootstrap configuration … invalid transport in
  `mcp_servers.nonexistent`": an unknown name breaks the config, so the names must come from codex itself.
- `-c 'mcp_servers."figma".enabled=false'` → RC 1, invalid transport in `mcp_servers."figma"`: a quoted segment is taken
  literally, so only bare names (`[A-Za-z0-9_-]+`) can be addressed.
- The full single-call `-c` list (5 ISO + plugins + 7 tool flags + the 3 MCP overrides), run as `codex … -C <empty> debug
  prompt-input hi` → RC 0, stdout 6428 B, stderr 0 B (no "Unknown feature flag" and no config error). `mcp list --json` with
  the same list → all three disabled.
(P1's "4 `[mcp_servers` sections" vs 3 listed: probably a subtable such as `[mcp_servers.x.env]`; not read.)
Side effect of the measurement: codex wrote its own state into `$SCRATCH/mcp/codex-home` (installation_id,
mcp-oauth-locks, skills, …).

Implementation: `readCodexCatalog` runs a third probe, `mcp list --json`, under the same deadline. It returns `mcpServers`
(all listed names; non-empty strings ≤ 200 chars, no duplicates; anything else ⇒ stage decode). The names are cached in the
entry as `codexMcpServers`, and `wellFormed` makes a codex entry without them a miss. The adapter refuses
`codex-single-call-unavailable` (neverStarted) when the list is missing or a name is not bare. `codexSingleCallArgs` appends
`-c mcp_servers.<name>.enabled=false` per name, after the tool flags. A codex whose `mcp list --json` fails now fails the
whole catalog read: resolution degrades as for any codex catalog failure (plan issue 5), and nothing is written.

### Rewritten criteria (human's blanket naming, forced by the new probe)
- `tests/agents/agentCatalog.test.ts:42` (`capabilities for omp and codex probe once…`): `expect(warm).toEqual([2, 4])` →
  `[2, 5]` (codex warm spawns now include mcp-list); ruling comment beside it. Red under the old value: mutation R1
  (`[2, 5]` → `[2, 4]`) ⇒ "expected [ 2, 5 ] to deeply equal [ 2, 4 ]".
- `tests/agents/catalogProbe.test.ts:139` (`reads every row…`): the exact `toEqual` answer gains `mcpServers: []`; ruling
  comment beside it. Red under the old value: R2 ⇒ "expected { …(3) } to deeply equal { …(2) }".

### New criteria
C8.10 (fake lists figma, node_repl, computer-use ⇒ the last -c values are the three `mcp_servers.<n>.enabled=false`);
C8.10b ×3 (list exit 4 / a server without a name / a dotted name ⇒ unavailable, 0, no spawn); C8.10c (codex cache entry
with `codexMcpServers` deleted ⇒ next read is `probe`); C8.11 (default stream with the 3 error items decodes; 3 stderr
lines); C8.11b (unknown item type `some_future_tool_call` ⇒ not-single:tool, 36 booked).

### Tests
- `$LOGS/t8g-focus2.log` RC=0, codexSingleCall 31/31. tsc `$LOGS/t8g-tsc.log` RC=0.
- Covering run (`tests/runtime/codex`, `tests/agents`, codexSingleCallWorker, singleCall, handoffDeadlineUsage,
  singleCallCapability, modelsControl, agentsControl): `$LOGS/t8g-green.log` RC=1, 491 passed, 16 failed. All 16 were
  timeouts or perf failures under heavy machine load: 16 control workers from other sessions were running
  (`/private/tmp/ccg-cEhq`, `ccb-0bIg`, `cl-Rwsa`; listed in `$LOGS/pgrep-t8g-after.txt`; not touched). Every failing file
  was then re-run alone and passed: materialize 18/18, extractFinalObject 58/58, runCodexPhase 24/24, updates 15/15,
  ompUpdates 5/5, skillsController 11/11 (`$LOGS/t8g-solo-*.log`, RC=0 each).

### Mutations
Clone `/private/tmp/mut-TCD9/repo`; all changed files copied in by `cat`; script `$SCRATCH/t8g-mutate.py`; summary
`$LOGS/t8g-run.txt`. Every restore was byte-equal, and the clone diff was 29580 B after every restore.
Baseline `$LOGS/t8g-baseline.log`: 3 agentCatalog tests fail in the clone only, because it has no `dist/cli.js` (unbuilt
clone; ccloop handoff). This is unrelated to the mutated lines.
| id | mutation | red in |
|---|---|---|
| G1 | error items counted as tool | C8.11 and 10 others (not-single:tool) |
| G2 | only command_execution is a tool | C8.11b |
| G3 | MCP `-c` overrides dropped | C8.10 |
| G4 | adapter `codexMcpServers === null` check dropped | **survives by construction**: the MCP list and the feature list fail together (same catalog read), and a cached codex entry always has the names (C8.10c). Registered. |
| G5 | dotted-name refusal dropped | C8.10b[name -c cannot address] |
| G6 | `wellFormed` MCP check dropped | C8.10c (`cache` vs `probe`) |
| G7 | name validation dropped | C8.10b[a server has no name] |
| G8 | stderr log of error items dropped | C8.11 (0 lines vs 3) |
| R1/R2 | forced rewrites reverted | named tests above |
Rule 14 slip: I read these mutation logs through `sed`/`grep` summaries; the full logs are in `$LOGS/t8g-*.log`.
The mutation copies of the clone's node_modules link were removed.

### Not done / for the controller
- `-c suppress_unstable_features_warning=true` is not sent (P1 option b; not in the ruling). The under-development warning
  stays as an allowed error item.
- Not verified on the real codex: that MCP servers are actually *not started* inside an `exec` with the overrides. Only
  `mcp list` and `debug prompt-input` were measured; the P1 re-run will show it (no figma auth error expected in stderr.log).
- An installation with an MCP server whose name is not bare can no longer run a codex single call
  (`codex-single-call-unavailable`).

## Fix round 3 (P1b finding + promoted minor) — commit `34a14a3`

### Changes
- `readCodexCatalog` → `readIsolatedMcpServers`. It runs `codex <CODEX_SINGLE_CALL_CONFIG as -c…> mcp list --json` with
  `HOME`/`CODEX_HOME` set to `codexSingleCallHome(...)`, which are the call's reused private dirs with the auth.json/config.toml
  links and the same source (`effectiveCodexHome`). It is still one cached catalog read, never run per call. With no cache dir,
  the private dirs are created under a fresh `mkdtemp(tmpdir())`, which is removed afterwards (links only; rm does not follow them).
- The isolation code moved verbatim into the leaf module `src/agents/codexIsolation.ts`: `CODEX_SINGLE_CALL_CONFIG`,
  privateDir/displace/ensureLink, `codexSingleCallHome`, and the new `effectiveCodexHome`, which was taken out of the adapter.
  `codexSingleCall.ts` re-exports these. Why: `codexCatalog` cannot import `runtime/codex/codexSingleCall.ts`
  (it pulls in ompSingleCall → agentCatalog → codexCatalog, a cycle).
- Promoted minor: an MCP list failure gives `mcpServers: null` plus `mcpError`. `readAgentCatalog` logs
  `ccloop-agent-catalog: probe-failed codex mcp <reason>`, keeps `catalogError: null`, the rows and the features, and does not
  write the entry (a codex entry without names is a miss anyway). The adapter now refuses in this order:
  1. features null ⇒ unavailable;
  2. private homes (home-invalid);
  3. MCP list null ⇒ `codex-single-call-unavailable: no MCP server list`;
  4. an unaddressable name.
  The private homes moved ahead of the MCP check so C8.3f still names a symlinked private dir: such a dir also makes the
  isolated probe fail.
- fake-codex: `mcpPlugins?` are listed only when `mcp list` is not isolated, meaning `$CODEX_HOME/config.toml` is not a
  symlink or `-c features.plugins=false` is missing. The fake records `{HOME, CODEX_HOME, c}` in `<marker>.mcp-env.json`.
  A single call that turns off a server missing from `mcp` fails like codex 0.160.0 does (stderr "invalid transport in
  `mcp_servers.<n>`", exit 1).

### Zero-cost measurement (real codex-cli 0.160.0, no model call)
`CODEX=/Users/biran/.nvm/versions/node/v22.13.1/bin/codex`. Private dirs: `$SCRATCH/mcp2/{home,codex-home,cwd}` (0700),
with `codex-home/config.toml -> ~/.codex/config.toml` as the only link. Names were printed through `$SCRATCH/mcp/names.py`
(name/enabled only; raw output never stored).
1. `HOME=$S/home CODEX_HOME=$S/codex-home codex -c include_permissions_instructions=false -c include_apps_instructions=false
   -c include_collaboration_mode_instructions=false -c include_environment_context=false -c project_doc_max_bytes=0
   -c features.plugins=false mcp list --json` → RC 0, 3 names: computer-use (enabled False), figma (True), node_repl (True); stderr 0 B.
2. `env -u CODEX_HOME codex mcp list --json` with the person's own HOME → RC 0, 6 names: code-review, codex_app,
   computer-use, cua_repl, figma, node_repl. This matches P1b. ⚠️ This one listing ran the real codex against the person's
   own ~/.codex (a read-only command; codex may still touch its own state files there). `ls -l` afterwards: auth.json 4126 B
   Oct 15 13:01, config.toml 6170 B Oct 13 20:22, so neither changed. Not repeated.
3. `HOME=$S/home CODEX_HOME=$S/codex-home codex <5 ISO + plugins + 7 tool flags + mcp_servers.{computer-use,figma,node_repl}.enabled=false>
   -C $S/cwd debug prompt-input hi` → RC 0, stdout 6429 B, stderr 0 B.
4. The same plus `-c mcp_servers.code-review.enabled=false` → RC 1, "Error: invalid transport in `mcp_servers.code-review`".

### Rewritten criterion (human's blanket naming, forced)
`tests/agents/catalogProbe.test.ts` "reads every row…": the exact answer gains `mcpError: null`. I appended a second ruling
comment; the round-2 comment was left as is.

### New criteria
- C8.10d: the fake lists `figma`, plus plugin `code-review` when un-isolated. The call succeeds and turns off only figma. The
  probe's HOME/CODEX_HOME equal the call's, and its `-c` list equals the 6 isolation keys.
- C8.10e: with `mcpExitCode: 4`, readAgentCatalog returns `source: "probe"`, `catalogError: null`, `codexMcpServers: null`,
  3 rows with window 272000 and 8 features, and writes no cache entry.

### Tests
- Focused run (codexSingleCall 33, agentCatalog, catalogProbe, codexSingleCallWorker, modelsControl): `$LOGS/t8h-focus.log`
  RC=0, 78/78. tsc `$LOGS/t8h-tsc.log` RC=0.
- Covering run (`tests/runtime/codex`, `tests/agents`, `tests/runtime/omp`, the control single-call/models/agents files):
  `$LOGS/t8h-green.log` RC=1, 562 passed, 3 failed. The 3 failures were ompPhase ×2 (known load-flake candidates) and
  updates ×1 (5 s timeout). Both files then passed alone: ompPhase 14/14, updates 15/15 (`$LOGS/t8h-solo-*.log`).

### Mutations
Clone `/private/tmp/mut-TCD9/repo`; script `$SCRATCH/t8h-mutate.py`; summary `$LOGS/t8h-run.txt`. Baseline was 33/33.
Every restore was byte-equal, and the clone diff was 34405 B after every restore. All 27 mutations went RC=1:
- H1 (probe env un-isolated) ⇒ C8.10d red: the call fails with codex-exit-error, i.e. the fake's "invalid transport", which
  reproduces P1b.
- H2 (probe without the -c list) ⇒ C8.10d red.
- H3 (MCP failure rethrown) ⇒ C8.10e red, and C8.3f red.
- H4 (entry written without names) ⇒ C8.10e red.
- H5 (adapter MCP-null check removed) ⇒ C8.10b red (TypeError).
- After the code move I re-ran the home mutations on codexIsolation.ts (M8.2, 11–19, 23, 24, F1, F2) and G1–G3, G5–G8.
  All went red. M8.13b is red in C8.3h[0o277].
- G4 no longer exists: its check was split into H5.

Rule 14 note: I read these mutation results through sed/grep summaries. The full logs are in `$LOGS/t8h-*.log`.
The clone's node_modules link was removed afterwards.

### For the controller
- P1c re-run needed. Expected: the 3 overrides only, no "invalid transport", and no figma auth line in stderr.log.
- The measurement left codex state in `$SCRATCH/mcp2/codex-home`. The probe now also writes codex state into the reused
  private codex-home before the first call; this is the same dir the call itself writes to.

## Fix round 4 (re-review, Rule 17 registration; comment only) — commit `60bcc6c`

I rewrote the out-of-repo write registration on `codexSingleCallHome` in `src/agents/codexIsolation.ts` in place. The
comment is new on this branch and unpublished, so no ERRATUM was needed.

The new comment names:
- Two writers:
  - (1) any codex catalog-read miss, through the isolated `mcp list` probe: control capabilities/models,
    `ccloop agents models`, and codex resolution and accept via materialize.ts.
  - (2) the control worker on every codex single call.
- What ccloop writes (the 0700 dirs and the two credential symlinks) and what codex writes (its runtime state, in its own modes).
- Residue: `.<uuid>.link`, `*.displaced-<ms>`, and codex's partial state. The dirs are never removed.
- The no-cache-dir paths: a per-run pair for the call; a `mkdtemp` dir for the probe, removed in `finally` and left behind on a crash.

One correction to the coordinator's list: agents update checks read the catalog for omp only (`updates.ts` `ompUnavailable`
returns early for other kinds), so they never write here. The comment says so; I checked the callers with
`grep -rn "readAgentCatalog(" src`.

tsc: `$LOGS/t8i-tsc.log` RC=0. As instructed, no tests were run (comment-only change).

## Fix round 5 (gate run 2 red on 60bcc6c) — commit for tests/agents/agentCatalog.test.ts

The criterion "writes under a relocated HOME's default path … (§4.2)" was red: expected 2 to be 1. The cause is my 34a14a3:
the codex catalog probe now also creates `<cache>/codex-home/`. This criterion was added on this branch in Task 4, so I
corrected it directly rather than as a named rewrite. It now checks:
- After the omp read, the default path lists exactly one `<64 hex>.json` and nothing else (no codex-home).
- After the redirected codex read, the default path is unchanged (still that one entry).
- Under CCLOOP_CACHE_DIR, the non-codex-home names are exactly one `<64 hex>.json`, and `codex-home` is present.
- The §4.2 point is kept: writes land only in the selected path.
- I do not assert a sorted pair, because a hash starting with d–f sorts after "codex-home".

Evidence:
- Red when no entry is written: clone `/private/tmp/mut-TCD9/repo`, `npm run build`. The mutation was
  agentCatalog.ts write guard → `if (false) {`, sha256 34ffa617… → 1d58d4a5…. tsc reported a type error, but tsc still
  emits (no noEmitOnError), so dist carried the mutation. The test went red: ENOENT scandir `<home>/.cache/ccloop/agent-catalog`
  (`$LOGS/t8j-mut.log`). Restored by `cat` (cmp equal), rebuilt RC=0, clone node_modules link removed.
- Green: `$LOGS/t8j-focus.log` RC=0 (after `npm run build` in the worktree, `$LOGS/t8j-build.log` RC=0). tsc `$LOGS/t8j-tsc.log` RC=0.
- `vitest run tests/agents` (whole dir, once): `$LOGS/t8j-agents.log` RC=1, 204 passed, 1 failed. The failure was
  command.test.ts "ccloop agents validate…", a 5 s timeout (live version probes under the parallel run). It passed alone
  2/2 (`$LOGS/t8j-command-{1,2}.log`, 11/11). Load-flake candidate.
