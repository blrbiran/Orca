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
7. Full gates of both repositories as their handoffs define them; Orca `npm run verify` segments run separately.

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
- **Safety does not rest on the cache**: a stale omp row can only make Orca reserve a bound the call no longer has; omp's
  own overlay plus the spawn-time `cap-exceeded` refusal (re-check reads through the same key, so a config edit is seen)
  keep a call from exceeding what was reserved.

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
- The codex adapter gains `singleCall`: `codex exec --json --ephemeral --color never --model <m> --sandbox read-only
  -C <empty private cwd> --output-schema <schema> -o <final> -c features.<f>=false … -` for each tool flag that
  `codex features list` reports present on this version (the adapter keeps a list; a flag missing on the installed
  version is skipped, not an error). Timeout and abort as the phase adapter.
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
- Paid, each asked separately when reached: one real codex single call (`gpt-6-luna`) to confirm one request with
  tools off; one real omp requirement chain on this machine with a warm and a cold cache.

## 10. Out of scope and residuals

- A third-party claude model below 200000 behind `ANTHROPIC_BASE_URL` is over-reported (§2.3).
- The tester's actual omp root cause stays unknown until their log shows a stage (§4.3); the cache removes most probes
  either way.
- Codex subagents, OMP skills real-provider acceptance, and everything else in Orca handoff §4.2 not named here.
