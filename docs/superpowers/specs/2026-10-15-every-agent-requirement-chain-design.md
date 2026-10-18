# Every agent runs the requirement chain: catalog cache, model lists, Codex soft single call, Claude default window

Owner: Orca session `ec9ce319` (Claude Opus 5.5), 2026-10-15 Asia/Shanghai. Repositories: ccloop (parts A, B, D, E) and
Orca (parts C, D). Human rulings this spec rests on (2026-10-15, this session, in chat):

- R1. Every agent kind (claude, codex, omp) must run the whole chain -- requirement clarify, split, estimate, execute --
  on its own. This is high priority; "relax a limit or redesign" are both allowed.
- R2. Codex: relax the single-call output bound. Codex cannot cap a call's output; its single call is admitted with the
  bound checked after the fact, the overrun booked and shown, never hidden.
- R3. The model drop-down covers omp **and codex** (supersedes "omp only", Orca handoff §八, session `026d10e3`).
- R4. The catalog is cached in a file, because probe frequency, not the drop-down, is what makes omp unusable (§2.2).
- R5. Claude's default context window must be reported too (expected 200K; the agent verifies, §2.3).
- R6. The spawn-time catalog probe moves inside the call's deadline and abort (Orca omp single-call spec
  `2026-10-14-omp-single-call-design.md` §8 residual), with the diagnosis below.

Rulings from the spec review (2026-10-15, same session, after the first draft):

- R7. A profile that declares `contextWindowTokens: null` means "not declared", not "forbid": the intersection takes the
  observed value (§6.3). Without this, the live `~/.orca/profile.json` (`contextWindowTokens: null`) blocks the chain
  for every kind, whatever ccloop reports.
- R8. The omp spawn-time re-check may read the cache. The risk -- a provider raising a model's cap inside the 30-minute
  lifetime without a config change ccloop can see -- is accepted as rare (§4.1).
- R9. Codex: research a clean, machine-independent prompt first (§2.5, §6.1); if no way is found, go on without it.

External feedback: `issue-20261008.md` Issue 67 (Requirements page refuses codex and omp). Its "omp hangs when stdin is
not a TTY" and the proposed `node-pty` fix are not adopted: the hang does not reproduce (§2.1).

## 1. Success criteria

Each is a command that exits 0 or non-zero (Orca CLAUDE.md Rule 4); the plan names the exact test files.

1. ccloop: with a warm cache, a `capabilities` or `accept` for an omp or codex selection spawns **no** catalog process
   (a fake omp/codex counts its own invocations; the criterion reads the count).
2. ccloop: a catalog probe that outlives the caller's deadline is killed when the deadline or the abort fires, and the
   refusal names the elapsed time and the stage (criterion: fake omp that sleeps; deadline below the old 10 s).
3. ccloop: codex resolves with `singleCallExecution: "v1-soft"` and a numeric `contextWindowTokens` from its catalog;
   claude `agent-default` resolves with `contextWindowTokens: 200000`.
4. Orca: `requirement-open` with a codex estimator in soft mode is accepted; in strict mode it is still refused with
   `single-call-unavailable` (Orca criterion against the real ccloop build with fake codex).
5. Orca: a codex single call whose observed output exceeds its declared bound is booked at its observed usage and its
   view carries the overrun; one at or under the bound carries none.
6. Orca web: the selection editor offers the installation's models as a datalist for omp and codex, accepts free text,
   and shows the reason when the list cannot be read.
7. Orca: with a profile declaring `contextWindowTokens: null` and ccloop reporting a window, `estimatorCompatibility`
   has no `context-unavailable`; with ccloop reporting null it still does (R7).
8. Full gates of both repositories as their handoffs define them; Orca `npm run verify` segments run separately.

## 2. Measured facts (zero-cost; no model was called)

### 2.1 omp startup (omp 18.10.1, this machine, Orca commit `c331aac1`)

Command: a Node `spawn` of `omp --no-extensions --profile default models --json` with `stdio: [<mode>, "pipe", "pipe"]`
(script kept in the session scratchpad, not committed).

| stdin | elapsed |
|---|---|
| `ignore` (cold) | 4683 ms |
| `pipe` | 1168 ms |
| `ignore` | 1256 ms |
| `ignore`, all `*_PROXY` pointed at a proxy that accepts and never answers | 2051 ms (omp opened 5 connections to it and still finished) |

So neither a non-TTY stdin nor a silent proxy explains a hang here. The tester's root cause is unknown; what is measured is
that one probe costs 1.2–4.7 s, which on a slower or loaded machine reaches the current fixed 10 s limit.

### 2.2 Probe frequency (static trace, ccloop `71053e3`, Orca `c331aac1`)

Every ccloop process that resolves an agent (`control capabilities` with an agent, or a fresh `accept`) spawns
`omp --version` once and `omp models --json` once (`src/agents/materialize.ts:109,127`); a single call's worker reads the
catalog again before spawning (`src/runtime/omp/ompSingleCall.ts:38`). Nothing is cached in ccloop or in Orca's profile
router (`src/control/profiles.ts:169-191`). Per Orca operation, for an omp selection (N tasks, D distinct slot
partials, S distinct frozen selections):

| operation | catalog probes |
|---|---|
| requirement-open | 1 |
| each clarify round / split draft | 2 |
| import plan | 1 |
| one estimate (command, claim, accept, worker) | 4 |
| selection preview read | D+2, sequential, re-fetched with backoff while a slot is unavailable |
| confirm | D |
| start plus the start-wake deliveries and one accept per task | 2S + 2S·N + N |

A five-task requirement with five clarify/split steps comes to about 40 catalog probes and 40 version probes, mostly
sequential: 1.5–6 minutes of probing at the measured speeds before any work. This is the bottleneck R4 addresses.

### 2.3 Claude's windows (claude-code 2.1.300, its binary's built-in model table)

Command: `strings -n 6 <claude.exe>` read with a Python regex over `{id:"claude-…",…context:{window:…}}` entries.
Every listed model has a window of at least 200000; the 4.7+/5.x families (e.g. `claude-opus-5-5`, `claude-sonnet-5-5`,
`claude-haiku-5-5`) are native 1M, the older ones 200000. So 200000 is a lower bound for every model the CLI knows;
for a native-1M model it under-reports, which only makes `input-too-large` trip earlier.
Not covered: a third-party model behind `ANTHROPIC_BASE_URL` whose window is below 200000 (§9).

### 2.4 Codex (codex-cli 0.160.0)

- `codex debug models` prints the model catalog as JSON in 1.4 s: per model `slug`, `context_window` (e.g. 272000;
  `gpt-6.1-sol` 500000), `max_context_window`, `effective_context_window_percent`, `visibility` (`list` | `hide`).
- No per-call output cap exists: `model_max_output_tokens` occurs 0 times in the binary; every `max_output_tokens` hit
  is the exec tool's pragma (same conclusion as Orca single-call estimate Task 0, 2026-09-27, codex 0.155.1).
- Tools are feature flags (`codex features list`): `shell_tool`, `unified_exec`, `multi_agent`, `apps`, `plugins`,
  `image_generation`, `view_image` are stable and on by default; each can be turned off per call with
  `-c features.<name>=false`. (Which flags exist is read from `codex features list` at implementation time; §6.1.)
- The phase adapter already runs `codex exec --json --ephemeral --sandbox read-only --output-schema <file> -o <file> -`
  (`src/runtime/codex/runCodexPhase.ts:28-30`) and reads `input_tokens`/`output_tokens` per completion.

### 2.5 What a codex call carries besides the prompt (codex-cli 0.160.0, `codex debug prompt-input hi`, no request sent)

Rendered in an empty, non-git working directory; sizes are the JSON items' bytes.

| setup | total | skills instructions | multi-agent text | AGENTS.md / environment |
|---|---|---|---|---|
| the user's own HOME and CODEX_HOME | 67307 | ~64 KB (the user's skills) | 3.4 KB | present |
| + `-c features.<tool>=false` for every tool flag of §2.4 | 59214 | 56 KB | 3.4 KB (even with `multi_agent=false`) | present |
| empty `CODEX_HOME` only | 32616 | 28 KB (`~/.agents/skills`, 95 skills, plus Codex's own) | 3.4 KB | environment |
| empty `HOME` and empty `CODEX_HOME` | 12322 | 7.3 KB | 3.4 KB | environment |
| empty both + `include_permissions_instructions`, `include_apps_instructions`, `include_collaboration_mode_instructions`, `include_environment_context` = false, `project_doc_max_bytes=0`, `features.multi_agent=false`, `features.skip_host_skill_discovery=true` | 6332 | 2.3 KB (Codex's bundled skills only) | 3.4 KB | none |

So the feature flags remove no injected text, and the user's skills, AGENTS.md and environment reach every codex call
unless HOME and CODEX_HOME are private. The last row is fixed and machine-independent (~1.5k tokens). `prompt-input`
shows input items, not tool definitions: whether tools are really off is not shown by it (§9, paid check).
An empty CODEX_HOME has no `auth.json` and no `config.toml` (custom providers live there); §6.1 says how they are reached.
Found in passing, not fixed here: the codex **phase** adapter runs with the user's HOME and CODEX_HOME, so every codex
loop phase today carries the user's skills and AGENTS.md -- against Orca's "a run is reproducible" rule for skills.

## 3. Part A -- ccloop: list an installation's models

A new control method `models` and its CLI twin `ccloop agents models`:

```
ccloop control models --agents <table>          stdin: {"installation":"<name>","refresh":false}
ccloop agents models --agents <table> --installation <name> [--refresh]
```

Answer (`ccloop-models-v1`): `{ schema, installation, kind, source: "cache" | "probe" | "none", observedAt, models: [{ model,
contextWindowTokens, maxOutputTokens, singleCallExecution }] }`, sorted by `model` in code-unit order.

- omp: the parsed catalog rows (selector, window, `maxTokens`, `ompSingleCallExecution(row)`).
- codex: `codex debug models` rows with `visibility: "list"`; `contextWindowTokens` = `context_window`;
  `maxOutputTokens: null`; `singleCallExecution: "v1-soft"`.
- claude: no catalog command exists; the method answers `models: []` with `source: "none"` (the web keeps free text).
- A failure answers ccloop's usual `<code>: <detail>` on stderr and a non-zero exit: `agent-catalog-unavailable` with the
  elapsed time, the stage (`spawn` | `timeout` | `exit` | `decode`) and the stderr tail (the #58 diagnostics shape).

## 4. Part B -- ccloop: the catalog cache and a bounded probe

### 4.1 One cache for every reader

All catalog and version reads (`materialize.ts` resolve, `ompSingleCall.ts` spawn-time re-check, `updates.ts`,
`control models`, and the new codex reads) go through one function, `readAgentCatalog(installation, { deadline,
signal, refresh })`, which reads the cache first.

- **What is stored**: the parsed rows of §3 and the `--version` answer. Never the raw stdout -- omp's `models --json`
  output (128 KB here) may carry provider URLs or keys.
- **Key** (any change is a miss): the realpath of `command[0]`, its `mtime` and `size`, the installation's
  `profile` and `configDir`, and the `mtime` of each catalog-bearing config file of the kind (omp: its models/config
  files under its config dir; codex: `$CODEX_HOME/config.toml` and the `-p` profile file when set). The plan lists the
  exact files after reading each CLI's config resolution.
- **Lifetime**: a hit is used for at most 30 minutes after `observedAt`; after that it is a miss. A change the key
  cannot see (a provider's remote model list) is bounded only by this lifetime.
- **refresh**: `refresh: true` skips the read, probes, and writes the result.
- **The accepted risk (R8)**: ccloop does not pass an output cap to omp; omp writes up to its catalog's cap, which is why
  the spawn-time re-check exists. The re-check reads through the same key, so a config edit is seen. A cap raised on the
  provider side without a config change is not seen for up to 30 minutes; such a call can then write more than Orca
  reserved, and the overrun shows only in the booked usage. (The first draft said the overlay prevents this; it does
  not -- the overlay turns off retries and fallbacks, not the output cap.)

### 4.2 Where it is written (ccloop's registration of an out-of-repo write)

- Path: `$CCLOOP_CACHE_DIR` when set, else `$XDG_CACHE_HOME/ccloop/agent-catalog/`, else
  `<HOME>/.cache/ccloop/agent-catalog/`, all read from the passed environment (never `os.homedir()`).
- One file per key (`<sha256 of the key>.json`), written to a temp file in the same directory and renamed. New
  directories 0700, files 0600, set explicitly; an existing directory's mode is left alone.
- Writer: any ccloop process that probes. Residue on failure: at most one stray temp file per failed write; a corrupt
  or unreadable entry is treated as a miss and overwritten, never an error.
- Every ccloop and Orca criterion that can reach the cache sets `CCLOOP_CACHE_DIR` to a temp directory; a criterion
  checks that a run with it set writes nothing under the real cache path.

### 4.3 The probe itself (R6)

- The fixed `PROBE_TIMEOUT_MS = 10_000` becomes `min(caller deadline, 30_000)`; the caller's `AbortSignal` kills the
  probe's process group. The spawn-time re-check passes the single call's own deadline and signal.
- A probe failure names `stage`, `elapsedMs` and the stderr tail (cut as #58 does). A miss and a failed probe are
  logged separately on ccloop's stderr, so a tester's log says which happened.

## 5. Part C -- Orca: the model list API and the drop-down

- `GET /api/control/agents/:installation/models[?refresh=1]` calls `control models`; owner and member may read,
  `refresh=1` is owner-only (it spawns the CLI). No Orca-side cache: ccloop's file cache serves it (R4).
- The selection editor (`web/src/AgentSelectionEditor.tsx`, `AgentFields.tsx`) shows a `<datalist>` for omp and codex
  installations, keeps free text, shows the window next to each model, a refresh button (owner), and the explained
  reason (`web/src/ccloopCodes.ts`) when the list is unavailable. Claude keeps free text.
- `ccloopCodes.ts` gains `agent-catalog-unavailable` and `codex-single-call-not-single` (both locales).

## 6. Part D -- Codex soft single call (R2)

### 6.1 ccloop

- `singleCallExecution` gains the value `"v1-soft"`: one structured call with tools off whose output bound is not
  enforced by the CLI. codex answers it when its catalog row is found; `singleCallOutputCap` stays `null`.
- `contextWindowTokens` for codex = the row's `context_window` (not multiplied by
  `effective_context_window_percent`; that percent is Codex's own compaction headroom, and Orca adds its own preflight
  margin). `capabilities()` therefore stops being static for codex, like omp's.
- The codex adapter gains `singleCall`: `codex exec --json --ephemeral --color never --skip-git-repo-check --model <m>
  --sandbox read-only -C <empty private cwd> --output-schema <schema> -o <final> <isolation> <tool flags> -`.
  Timeout and abort as the phase adapter.
- **Isolation (R9, from §2.5)**: the call runs with a private, empty `HOME` and a private `CODEX_HOME` under the run
  directory, plus the `-c` keys of §2.5's last row. The private `CODEX_HOME` holds symlinks (never copies) to the
  installation's `auth.json` and `config.toml`, so login and custom providers keep working. ⚠️ This handles the path of
  a credential file; the plan step that adds it is named to the human before it is written. If the linked
  `config.toml` re-introduces injected text (MCP servers, instructions), the plan adds the matching `-c` override and
  re-renders §2.5's table. Fallback if isolation cannot be made to work: run with the user's environment and record that
  codex single calls are not reproducible and carry the user's skills (R9: go on without it).
- **Tool flags**: `-c features.<f>=false` for each tool flag the installed version lists. Codex refuses an unknown flag
  (`Unknown feature flag`), so the list comes from `codex features list`, read once and kept in the catalog cache entry
  (§4.1), never spawned per call.
- **Window**: when the installation's `config.toml` sets `model_context_window`, that value wins over the catalog's.
- **Framing**: the fixed residue of §2.5 (~1.5k tokens) is measured per codex version (as omp's ~2047 was) and is the
  codex profile's `framingTokenOverhead`; the plan says where it is declared.
- Decoding fails closed: any tool or command event, more than one completed agent message, or no object ⇒
  `codex-single-call-not-single:<what>`; usage observed so far is booked, never 0 for null.
- Usage: `input_tokens`, `output_tokens` (reasoning included in output, as Codex reports it), cache fields, per model.

### 6.2 Orca

- `estimatorCompatibility`: strict mode requires `"v1"`; soft mode accepts `"v1"` or `"v1-soft"`. Requirement, estimate
  and recovery paths keep calling it as today, so codex passes in soft mode only.
- Reservation and `input-too-large` are unchanged: `input + singleCallOutputBound(preflight.maxOutputTokens, resolution)`
  against `contextWindowTokens`. For `"v1-soft"` the bound is the preflight's `maxOutputTokens`.
- Accounting: the call's usage is booked as observed, as today. The run view of a single call whose resolution was
  `"v1-soft"` carries `outputBound` and, when the observed output (sum of `byModel[].output`) exceeds it,
  `outputBoundExceededBy`. Computed at read time from the stored usage events; no schema change.
- Web: the call row shows "Codex cannot cap a call's output; this call went N tokens over its declared bound". The
  result is used as normal.
- Wording rule: nothing in the web, README or SKILL.md may call a codex single call bounded or capped.

### 6.3 Orca: a declared-null window (R7)

`intersectCapabilities` (`src/control/profiles.ts:119-122`) takes the observed `contextWindowTokens` when the profile
declares null, and the minimum when both are numbers; an observed null stays null. This changes behaviour beyond codex:
every kind whose ccloop now reports a window (claude 1M and, with part E, claude default; omp; codex) becomes estimable
under the live profile, so importing a plan starts a real estimate call where it was `blocked-capability` before. The
plan lists every criterion that asserts the old null-wins rule, each named to the human before rewriting.

## 7. Part E -- Claude default window

`claude.ts` `capabilities()` answers `contextWindowTokens: 200000` for `agent-default` (1M stays 1M). The published
comment at `claude.ts:67` is kept and an ERRATUM line appended (ccloop Rule 16) citing §2.3.

## 8. Compatibility and order

1. ccloop first (parts A, B, D, E) on one branch; its full gate; the human pushes.
2. Orca: an older Orca's resolution schema rejects `"v1-soft"` (enum) -- so the Orca side lands before or with the repin
   (`scripts/pin-ccloop.mjs`), never a repin alone.
3. `~/.orca/profile.json` is not touched (human's decision, Orca handoff §4.1 item 6).

## 9. Testing, mutations, paid acceptance

- Fakes: fake omp and fake codex count invocations (criterion 1), can sleep (criterion 2), and for codex single call
  can emit a tool event, two agent messages, or an over-bound answer.
- Each new branch gets the mutation that removes it, seen red, in a `git clone --local` copy (Orca and ccloop rules).
  Named in the plan: cache key fields one by one (drop each ⇒ a stale hit criterion goes red), lifetime, refresh,
  corrupt-entry miss, mode bits, `CCLOOP_CACHE_DIR` redirection, deadline and abort, the strict/soft split of
  compatibility, the overrun field both ways.
- Existing criteria this changes (to be listed exactly in the plan, each named to the human before rewriting under
  ccloop Rule 15): codex `singleCallExecution`/`contextWindowTokens` expectations; claude `agent-default`
  `contextWindowTokens: null` expectations; Orca fixtures that assert codex estimates are `blocked-capability`.
- Paid, each asked separately when reached: one real codex single call (`gpt-6-luna`), isolated as §6.1, to confirm
  exactly one model request, no tool event, and the framing overhead; one real omp requirement chain on this machine with a warm and a cold cache.

## 10. Out of scope and residuals

- A third-party claude model below 200000 behind `ANTHROPIC_BASE_URL` is over-reported (§2.3).
- The tester's actual omp root cause stays unknown until their log shows a stage (§4.3); the cache removes most probes
  either way.
- The codex multi-agent instructions (3.4 KB) survive every switch tried in §2.5; they stay in the framing overhead.
- The codex phase adapter's exposure to the user's skills and AGENTS.md (§2.5) is registered, not fixed here.
- Codex subagents, OMP skills real-provider acceptance, and everything else in Orca handoff §4.2 not named here.

## 11. Corrections and registrations after implementation (session a852f96a, 2026-10-16)

Appended by the final-fix agent of Orca session `a852f96a` (Claude Opus 5.5), 2026-10-16 Asia/Shanghai, on Orca branch
`codex/every-agent-chain` (after `docs(readme): codex runs clarify, split and estimate as a soft single call`) with
ccloop branch `codex/every-agent-chain` at `fix(agents): codex single call also turns off the other on-by-default tool
flags and notify`. The text above is unchanged; where this section differs from it, this section wins. Evidence: the
SDD ledger `.superpowers/sdd/2026-10-15-every-agent-requirement-chain/progress.md` (cited as "ledger") and the ccloop
commit subjects named per item. Values are tool-reported or measured; nothing here is estimated.

### 11.1 Rule 17 registration: the codex private homes (supersedes §6.1 "under the run directory")

§6.1 put the single call's private `HOME` and `CODEX_HOME` under the run directory. The human asked during Task 8
whether the directory has to be rebuilt every time and could be reused; the controller ruled to reuse it (ledger,
"Ruling (Task 8, answering the human)"), because a fresh `CODEX_HOME` makes codex write about 2.4 MB of its own state
and fetch the remote model list on every call (Task 0, ledger). This is a second out-of-repo write next to §4.2's
catalog files:

- **Path**: `<catalog cache dir>/codex-home/<sha256 of realpath(codex executable) NUL source CODEX_HOME>/{home,codex-home}`,
  where the catalog cache dir is §4.2's (`$CCLOOP_CACHE_DIR`, else `$XDG_CACHE_HOME/ccloop/agent-catalog/`, else
  `<HOME>/.cache/ccloop/agent-catalog/`). One pair per installation key, reused by every later probe and call.
- **Writers** (ccloop `docs(agents): register both writers of the codex private homes (catalog-miss probe and single
  call)`): (1) any ccloop process whose codex catalog read misses the cache (`control capabilities`, `control models`,
  `ccloop agents models`, codex resolution for loop phases and accept), through the isolated `codex mcp list --json`
  probe of §11.2 (ccloop `fix(agents): list codex MCP servers under the single call's own isolation; a failed list
  keeps the catalog`); agents updates read the catalog for omp only and never write here; (2) the control worker on
  every codex single call.
- **What ccloop writes**: the missing directories, mode 0700 set explicitly (an existing directory's mode is left
  alone); each must then be a real directory owned by this user, not a symlink, or the call is refused unspawned as
  `codex-single-call-home-invalid`. In `codex-home`, two symlinks, `auth.json` and `config.toml`, to the installation's
  effective CODEX_HOME files (its `configDir`, else an inherited absolute `CODEX_HOME`, else `<HOME>/.codex`), never
  copies, re-checked on every call. A regular file found where a link belongs is moved aside to
  `<name>.displaced-<epoch ms>` (mode kept) and logged, never deleted (ccloop `fix(runtime): codex single-call home
  refuses symlinked dirs, never deletes a regular credential`).
- **What codex writes** (its own modes), measured in Task 0 and P1c: `models_cache.json` (about 400 KB), sqlite
  state and logs, `installation_id`, `cache/`, `skills/.system`, `shell_snapshots/`, `tmp/`, `mcp-oauth-locks/`.
  `home` stays empty unless codex writes there.
- **Residue**: the directories are never removed. On a failure: at most one `.<uuid>.link` temp link, any displaced
  file, and whatever codex wrote before it failed.
- **No cache dir** (no `CCLOOP_CACHE_DIR`, `XDG_CACHE_HOME` or absolute `HOME`): the single call makes a pair per
  call under its run directory (`<runDir>/codex/1/single-call/home-*`); the catalog probe makes one under
  `mkdtemp(<tmpdir>/ccloop-codex-mcp-*)` and removes it in `finally`, so a crash before that leaves the temp
  directory (its links and codex's state) behind.
- Criteria set `CCLOOP_CACHE_DIR` and an empty `CODEX_HOME` per test file in both repositories (ccloop
  `test(agents): every test file gets an empty CODEX_HOME; agents models --refresh re-probes`); ccloop's
  relocated-HOME criterion counts catalog entries apart from `codex-home` (`test(agents): count catalog entries apart
  from codex-home in the relocated-HOME criterion`).

### 11.2 §2.5 re-rendered: the single call's final `-c` list (codex-cli 0.160.0)

§6.1 requires §2.5 to be re-rendered when an override is added. The single call (and the isolated MCP-list probe,
which uses the same isolation keys) now sends, in this order:

1. Isolation keys, always: `include_permissions_instructions=false`, `include_apps_instructions=false`,
   `include_collaboration_mode_instructions=false`, `include_environment_context=false`, `project_doc_max_bytes=0`,
   `features.plugins=false`, `notify=[]`. `features.plugins=false` is here because Task 0 measured that it removes the
   `<recommended_plugins>` block (16 curated remote plugins) a linked `config.toml` injects: linked total 6967 B, with
   it 6010 B, empty `CODEX_HOME` 6017 B (`features.recommended_plugins=false` left 6967 B). `notify=[]` keeps a
   `notify` program in the linked `config.toml` from running (final review I4; the person's `config.toml` has one line
   starting `notify =`, counted without printing it).
2. Tool flags, each only when the installed `codex features list` names it: `features.<name>=false` for `apps`,
   `browser_use`, `browser_use_external`, `code_mode_host`, `computer_use`, `goals`, `hooks`, `image_generation`,
   `in_app_browser`, `multi_agent`, `realtime_conversation`, `remote_plugin`, `shell_tool`, `skill_search`,
   `sleep_tool`, `tool_suggest`, `unified_exec`, `view_image`, and `features.skip_host_skill_discovery=true`. The names
   after §2.4's list are the stable, on-by-default tool-like flags Task 0 recorded (ccloop `fix(agents): codex single
   call also turns off the other on-by-default tool flags and notify`). `browser_use_full_cdp_access` is listed by
   codex but not sent (moot with `browser_use` off). Web search is not a feature flag in 0.160.0 and is not turned off
   by this list.
3. `mcp_servers.<name>.enabled=false` for each server named by `codex mcp list --json`, run under the call's own
   isolation (private homes with the links and the keys of item 1), read with the catalog and cached in its entry
   (ccloop `fix(runtime): codex single call allows codex's error items and turns off the linked MCP servers` and the
   fix-round-3 commit above). A name `-c` cannot address (anything but `[A-Za-z0-9_-]+`) or an unreadable list
   refuses the call as `codex-single-call-unavailable`; an unreadable list keeps the catalog's rows and features.

Zero-cost check of the full list (I4, real codex-cli 0.160.0 at the nvm path, private `HOME` and private
`CODEX_HOME` linking `~/.codex/auth.json` and `config.toml`, no model call): `codex features list` RC 0 named all 12
added flags "stable true"; isolated `codex mcp list --json` named `computer-use`, `figma`, `node_repl`;
`codex debug prompt-input <items 1-3> "<one-line prompt>"` RC 0, stderr 0 bytes, 6381 B of rendered items, identical
except message ids and timestamps to the same render with the earlier list (the added flags change no prompt text;
`prompt-input` does not show tool definitions). `~/.codex/auth.json` and `config.toml` `ls -l` plus `shasum` were
identical before and after. Observed in passing: `prompt-input` also accepted an unknown `-c features.<x>=false`
(RC 0); §6.1's "Codex refuses an unknown flag" was not re-measured on `exec`, and the features-list filter stays.

Tokens (tool-reported `input_tokens` of a real call, `gpt-6-luna`, the same 20-word prompt asking for a JSON object
whose answer is the capital of France, schema `{answer: string}`): P1 11590 (ccloop `efcd5b3`: before the MCP
overrides; the linked config's MCP servers started), P1c 10811 (ccloop `34a14a3`: item 1 without `notify=[]`, §2.4's
tool flags, item 3; no MCP server started), output 15 each. §2.5's "~1.5k tokens" was inferred from bytes;
the measured framing is far above it. The I4 flags were added after P1c, and no paid call measured them. The codex
profile's `framingTokenOverhead` (§6.1 "Framing") is a value in the human-owned `~/.orca/profile.json` (§8.3); it
is the human's to set, with these numbers.

### 11.3 Live-probe findings

- **codex `error` items are diagnostics** (P1, ledger): codex emits `item.completed` items of type `error` for config
  warnings (twice "`features.rmcp_client` is ignored" from the person's `config.toml`, once "Under-development
  features enabled: skip_host_skill_discovery"). The decoder allows them and logs each on stderr; every other item
  type that is not `agent_message` or `reasoning`, known or not, still fails closed as
  `codex-single-call-not-single:tool`.
- **Disabling an MCP server the call's config does not define breaks codex's config load** (P1b, ledger): listed
  against the person's own `~/.codex`, `codex mcp list` also named the `~/.codex/plugins` servers (6 names, 3 of them
  undefined in the isolated config); the call failed with RC 1 in 245 ms, "invalid transport in
  `mcp_servers.code-review`", and no model request was shown. Offline repro: the 6 overrides RC 1, the 3 defined RC 0.
  Also measured: a whole-table `-c mcp_servers={}` leaves the servers on; a quoted segment
  (`mcp_servers."figma".enabled`) breaks the config. Hence item 3's listing under the call's own isolation.

### 11.4 Reads that stay live, and the cached version

- **Cached** (§4.1): every catalog read through `readAgentCatalog`, including the `--version` answer stored in the
  entry. The human decided plan issue 8 on 2026-10-15: cache the version (a shim upgrade can be unseen for up to 30
  minutes).
- **Live by design** (ledger, Task 4 ruling): the version probes of `updates.ts` (observe, preview, Apply),
  `agents validate`'s `probeVersion`, and detection's `readOmpModels` (`detect.ts`). Detection, validation and
  drift/upgrade checks exist to see the binary as it is now. Apply's re-check of the omp catalog reads with
  `refresh: true`. §4.1's "`updates.ts`" is read as its omp catalog read, which is cached. P2 measured one uncached
  `omp --version` per runtime start from `updates.ts`.

### 11.5 Residuals

- **Refresh-token rotation through the `auth.json` symlink is unverified** (final review I3, ruled a residual for the
  human). P1c showed the private `auth.json` still a symlink and `~/.codex` unchanged, but no token refresh happened
  during it. If codex saves a refreshed token by temp file and rename, the new token lands in the private dir; the next
  call displaces it (kept, never deleted) and re-links to the older file in `~/.codex`. Recovery: `codex login`.
- **Keyring-stored codex credentials** (`cli_auth_credentials_store`) leave no `auth.json` to link: the call fails
  closed as an auth error.
- **The control worker's `ccloop-agent-catalog:` log line has no production sink**: `workerLauncher` starts the
  worker with stdio `ignore` (ledger, Task 4 ruling); only the criteria see it.
- **The codex phase adapter still carries the person's skills and AGENTS.md** (unchanged; §2.5, §10).
- The omp legacy `config.yaml` and `PI_CONFIG_DIR` are not stamped in the cache key; the 30-minute lifetime bounds a
  change there (ledger, Task 2).
- A catalog entry written by an older ccloop carries that build's shorter feature list for up to its 30-minute
  lifetime (the key has no ccloop version).
- `notify=[]` and the I4 flags were checked at render time only; no paid call has run with them.

## 12. Registration (Orca session a3b2a7a7, 2026-10-18): codex loop phases become a third writer of the private homes

Appended by Orca session `a3b2a7a7` (Claude Code interactive session), 2026-10-18. The text above is unchanged.

ccloop spec `docs/superpowers/specs/2026-10-18-codex-phase-isolation-design.md` (ccloop `main`, commit subject
`docs(spec): codex phase isolation design`) makes every codex loop phase (plan, execute, verify) run in the same
per-installation private `HOME`/`CODEX_HOME` pair that §11.1 registered for the single call. When it is implemented
(plan `docs/superpowers/plans/2026-10-18-codex-phase-isolation.md` in ccloop, not yet built), §11.1's out-of-repo
writers gain a third: **every codex loop phase run with an installation, on every call**, creates missing dirs under
`<cache root>/codex-home/<sha256(installation key)>/{home,codex-home}` (0700, files 0600), re-checks the two links, and
codex writes its own state there. Without a cache root the pair falls back to
`<runDir>/codex/<attempt>/phase-isolation/home-*`. Residue is unchanged from §11.1. A phase whose isolation cannot be
set up is refused before spawn, final, and books usage 0 (`neverStarted`).
