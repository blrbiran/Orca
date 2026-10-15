# Every Agent Runs the Requirement Chain -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Owner: written by an Orca planning subagent of session `ec9ce319` (Claude Opus 5.5), 2026-10-15 Asia/Shanghai, on branch
`codex/round-20261015b` of Orca. Anchors (file:line) were read on ccloop `a52ce96` (`main`) and Orca `codex/round-20261015b`
(tip `eea00735` at planning time). **The tree is the truth: every anchor is re-read before it is edited** (Orca handoff §6.9,
"并行写计划 ⇒ before 锚点会过期"); an anchor that moved is followed, not forced.

**Goal:** claude, codex and omp can each run the whole requirement chain (clarify, split, estimate, execute) on their own,
with the agent catalog cached in a file by ccloop, a model drop-down for omp and codex, a soft (after-the-fact) output bound
for codex single calls, and claude's default window reported.

**Architecture:** ccloop gets one catalog reader (`readAgentCatalog`) with a file cache and a deadline/abort-bounded probe,
a `models` control method, a codex single-call adapter answering `singleCallExecution: "v1-soft"`, and claude's 200000
default window. Orca reads `"v1-soft"` (accepted only in soft estimate mode), takes the observed window when a profile
declares `contextWindowTokens: null` (R7), shows a single call's output overrun at read time, and serves the model list to a
`<datalist>` in the selection editor. ccloop lands and is pushed first; Orca lands together with the repin.

**Tech Stack:** TypeScript (Node 22), zod, vitest; ccloop CLI (`control`, `agents`); Orca express panel + React web (jsdom tests).

**Spec:** `docs/superpowers/specs/2026-10-15-every-agent-requirement-chain-design.md` (Orca). Rulings R1-R9 are binding.
Repository rules: ccloop `CLAUDE.md` Rules 13-18; Orca `CLAUDE.md` Rules 1-17; Orca `docs/handoff/handoff.md` §6 (pitfalls).

---

## Spec issues found while planning

Each item is a place where the spec is silent, ambiguous or (measured) at odds with the code. The plan takes the stated
choice (all reversible, Orca Rule 1 step 2) and the human may overrule any of them before execution starts.

1. **Failure code for omp vs. `agent-catalog-unavailable` (§3, §4.3).** ccloop criteria C58a-c
   (`tests/agents/ompCatalogDiagnostics.test.ts:34,41,48-56`) pin `omp-model-catalog-unavailable: exit 3`,
   `...: timeout 300ms` and the stderr tail as the **last** segment; Orca's `web/src/locales/en.ts:1358-1359` and
   `tests/panel/refusalCoverage.test.ts:94` key on the omp codes. Plan: omp keeps `omp-model-catalog-unavailable` /
   `omp-model-catalog-invalid`; codex catalog failures use the new `agent-catalog-unavailable`; `control models` passes the
   kind's own error through. Stage and elapsed time are inserted **before** ` · stderr: ` so C58a-c stay green unchanged.
2. **Stage list (§4.3) has no value for the caller's abort.** Plan adds stage `abort` (`spawn | timeout | abort | exit | decode`);
   output over the 1 MiB limit is stage `decode`.
3. **"Logged separately on ccloop's stderr" (§4.3) collides with the control wire.** Orca reads ccloop's code from the
   *start* of stderr (`src/control/ccloopPort.ts:57`), and ccloop success criteria assert `stderr: ""`. Plan: `control`
   prints no cache/probe log lines (the failure message itself names stage and elapsed time); `ccloop agents models` and the
   control worker (whose stderr goes to its own log) print `ccloop-agent-catalog: miss|probe-failed ...` lines.
4. **No caller deadline on the control path (§4.3).** Orca's port timeout is 60_000 ms (`src/panel/controlAssembly.ts:41`,
   `src/agents/command.ts:19`). Plan: a resolution without a caller deadline gets **one** 30_000 ms deadline shared by its
   version probe and its catalog probes, so a cold resolution ends before Orca kills ccloop.
5. **A codex catalog failure during resolution (spec silent).** Plan: codex **degrades** (window `null`,
   `singleCallExecution: null`) instead of refusing, because loop phases do not need the catalog and a transient
   `debug models` failure must not stop codex loop work; omp keeps refusing (its model must be an exact catalog selector).
   Side effect, measured by reading: ccloop `tests/agents/materialize.test.ts:71-76` (injected probe, codex `null`) and Orca
   `tests/control/ccloopDefaultE2E.test.ts:40` (a shell "codex" that prints a version for every argv) stay green.
6. **Hidden codex models (`visibility: "hide"`).** `models` lists only `list` rows (§3); resolution matches any row, since a
   hidden slug is a valid selection (e.g. `gpt-reserve` on this machine).
7. **Cache key (§4.1).** (a) The codex installation has no `-p` profile field (`src/agents/codex.ts:35`), so the codex key
   reads `config.toml` only. (b) When `configDir` is null the kind's inherited env variable (`PI_CODING_AGENT_DIR`,
   `CODEX_HOME`) decides the config dir, so it is in the key. (c) The full `command` argv is in the key, and so is a stamp of
   **every argv element that names an existing file** -- see item 8. (d) omp's config files are `config.yml` and
   `models.yaml` under the agent dir (`<HOME>/.omp/agent`, `<HOME>/.omp/profiles/<name>/agent`, or the env/`configDir`
   override), read from omp 18.10.1's `pi-utils/src/dirs.ts:119-133`; omp's Linux XDG layout is not in the key and is
   bounded only by the 30-minute lifetime.
8. **Caching the version weakens drift detection (§4.1 says "all catalog and version reads").** A version cached under a key
   that cannot see an indirection (a shim script that `exec`s the real binary, e.g. the `cmux` shims on this machine) hides
   an in-place upgrade's `agent-version-drift` for up to 30 minutes. Orca `tests/control/agentUpgradeE2E.test.ts:38-47`
   upgrades a fake by rewriting a version file passed in argv; item 7(c) keeps that criterion seeing the change (predicted,
   must be run). **The human should confirm caching the version at all**; if not, Task 4 drops `version` from the entry and
   probes it every time (one line in `readAgentCatalog`).
9. **Codex spawn-time feature list (§6.1).** If the cached feature list cannot be read at spawn, the tool flags are unknown
   and the call could run with tools on; plan refuses before spawning with a new code `codex-single-call-unavailable`
   (`neverStarted`, books 0) and adds its Orca text.
10. **"No object ⇒ `codex-single-call-not-single`" (§6.1).** Plan uses the existing `single-call-output-invalid`
    (`SingleCallOutputInvalid`, usage booked) for "no object", as claude and omp do, because Orca's requirement retry keys on
    it; `codex-single-call-not-single:<what>` is used for `tool`, `messages`, `turns`. Orca stores the code cut at the first
    colon (`src/control/executionDriver.ts:670-674`), so the web explains `codex-single-call-not-single`.
11. **"A single call whose resolution was `v1-soft`" (§6.2) is not knowable at read time:** `singleCallExecution` is never
    frozen (`src/control/agentSelection.ts:37-39`). Plan computes `outputBound` for **every** estimate and requirement
    single-call run and `outputBoundExceededBy` whenever observed output exceeds it (for `"v1"` kinds this can only happen in
    the R8 case, and then it is true). The run view carries no agent kind, so the web sentence is kind-neutral
    ("This agent cannot cap a call's output; ..."). If the human wants the word "Codex", the run view needs a kind field.
12. **`framingTokenOverhead` is per profile, not per kind (§6.1 "Framing").** It lives in
    `estimatorPreflight` of one profile that serves every kind. Plan measures codex's overhead (Task 0 bytes; paid check P1
    tokens) and records it in the ledger and Orca handoff for the human, who owns `~/.orca/profile.json` (§8.3).
13. **Criterion 1 counts version probes too** (both are cached per §4.1).
14. **§4.2 "a criterion checks that a run with it set writes nothing under the real cache path".** After the repin the
    human's own panel writes the real path, so a criterion that watched it would go red at random. Plan proves the
    redirection with a relocated `HOME` (the default path then lies inside a temp dir) and never reads the real path.
15. **`models` for claude:** `observedAt: null` (nothing was observed).
16. **Strict mode and codex (criterion 4):** a strict refusal also names `budget-unavailable` and
    `request-bound-unavailable` (codex's `budgetEnforcement` is `soft`); the criterion asserts that the reasons contain
    `single-call-unavailable`, as `tests/control/requirementCommands.test.ts:42` already does.

---

## Global Constraints

- R1-R9 of the spec are binding; `~/.orca/profile.json` is not touched (spec §8.3).
- Order (spec §8): ccloop parts A, B, D, E on one ccloop branch -> ccloop full gate -> **human pushes ccloop** -> Orca tasks
  -> repin with `scripts/pin-ccloop.mjs` **in the same Orca branch** -> Orca full gate. An Orca repin alone is forbidden
  (an older Orca's resolution schema refuses `"v1-soft"`).
- Cache path: `$CCLOOP_CACHE_DIR` (absolute) else `$XDG_CACHE_HOME/ccloop/agent-catalog/` else
  `<HOME>/.cache/ccloop/agent-catalog/`, all from the passed environment, never `os.homedir()`. New dirs `0700`, files
  `0600`, set explicitly; an existing dir's mode is left alone. One file per key: `<sha256 of the canonical key>.json`,
  written to a temp file in the same dir and renamed. Lifetime 30 minutes (`1_800_000` ms). Never the raw stdout.
- Probe timeout: `min(caller deadline, 30_000)` ms; the caller's `AbortSignal` kills the probe's process group.
- Codex single call: `singleCallExecution: "v1-soft"`, `singleCallOutputCap: null`; window = catalog `context_window`
  (not multiplied by `effective_context_window_percent`); `model_context_window` in the installation's `config.toml` wins.
- Orca: strict mode requires `"v1"`; soft mode accepts `"v1"` or `"v1-soft"`.
- Wording rule (§6.2): nothing in `web/`, `README.md` or `SKILL.md` calls a codex single call bounded or capped.
- **Every criterion that can reach the cache sets `CCLOOP_CACHE_DIR` to a temp dir** (Orca Rule 17; done once per suite
  in a vitest setup file, Tasks 4 and 10).
- Existing criteria are rewritten **only after the human names each one** (ccloop Rule 15: named, rewritten whole, never
  loosened, the ruling recorded beside it). Published comments get an appended ERRATUM, never an in-place edit (ccloop
  Rule 16; Orca handoff §6.2).
- Mutations only in `git clone --local` copies (ccloop Rule 17, Orca Rule 15); restore proven by `git diff` and
  `git diff --cached` byte counts.
- Evidence: every verifying run is redirected to a file and read back whole (ccloop Rule 14, Orca Rule 14). All git via
  `/usr/bin/git`. No `| grep`, `| tail` on verifying output.
- New SDD/plan text is English; `docs/handoff/**` is Chinese (Orca memory "language convention").
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`, written with `git commit -F`.
- **Never** push, merge, rebase, amend, stash, reset, checkout, or delete a branch/worktree. Human-only steps are marked
  **[HUMAN]**.

## Review Focus

Five inputs no spec criterion exercises that are most likely to bite a person, each with the test that pins it:

1. **Two ccloop processes probe the same cold key at once** (Orca resolves a group's slots and the driver claims in
   parallel). Expected: both answer; one entry file remains; no temp file is left. Pinned in Task 2 (`RF1`).
2. **The cache dir cannot be written** (read-only dir, or a regular file where the dir should be). Expected: the read still
   answers from the probe and is never an error. Task 2 (`RF2`).
3. **No `HOME`, no `XDG_CACHE_HOME`, no `CCLOOP_CACHE_DIR`** (launchd/systemd environments), or a relative
   `CCLOOP_CACHE_DIR`. Expected: no cache, probe every time, nothing written to the working directory. Task 2 (`RF3`).
4. **An entry from the future** (clock moved back) or **whose stored key differs from its file name's key** (tampered).
   Expected: a miss, overwritten. Task 2 (`RF4`).
5. **The installation is removed from the table while the selection editor is open.** Expected: the model list answers
   `agent-installation-missing` and the editor shows that reason beside a still-usable free-text box. Tasks 5 and 14 (`RF5`).

---

## Shared procedures (read once; every task refers to them)

### P-1. Paths and variables

```bash
export SCRATCH="${SCRATCH:?set to this session's scratchpad dir}"
export LOGS="$SCRATCH/logs"; mkdir -p "$LOGS"
export CL=/Users/biran/code/skills/orca/ccloop-wt/every-agent-chain     # ccloop worktree (Task 1 creates it)
export OR=/Users/biran/code/skills/orca/Orca-wt/every-agent-chain       # Orca worktree (Task 10 creates it)
export TMPDIR="$(mktemp -d /private/tmp/cl-XXXX)"                       # short, real dir (Orca handoff §6.7)
export ECC_GATEGUARD=off DISABLE_OMC=1
which node; node --version     # expect nvm v22.13.1 first on PATH (ccloop handoff "环境")
```

### P-2. A verifying run (Rule 14)

```bash
( cd "$CL" && ./node_modules/.bin/vitest run tests/agents/catalogCache.test.ts ) > "$LOGS/<name>.log" 2>&1; echo "RC=$?" >> "$LOGS/<name>.log"
```

Then read the **whole** log file with the Read tool; check vitest's first `RUN` line names the expected root. "Red" means
RC≠0 **and** the named test is among the failures; "green" means RC=0 and the named tests are listed as passed (not
skipped). Expected values in tests are literals, never computed by the code under test.

### P-3. Mutation protocol (ccloop Rule 17 / Orca Rule 15)

Write once to `$SCRATCH/mutate.py`:

```python
import hashlib, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
n = src.count(old)
assert n == 1, f"expected exactly one occurrence of the mutation anchor, found {n}"
before = hashlib.sha256(src.encode()).hexdigest()
open(path, "w", encoding="utf-8").write(src.replace(old, new))
after = hashlib.sha256(open(path, encoding="utf-8").read().encode()).hexdigest()
print("sha256", before, "->", after)
assert before != after
```

Per mutation group:

```bash
REPO="$CL"   # or "$OR"
M="$(mktemp -d /private/tmp/mut-XXXX)/repo"
/usr/bin/git clone --local -q "$REPO" "$M"
ln -s "$REPO/node_modules" "$M/node_modules"
# Uncommitted files under test are copied in (the clone holds committed state only):
#   cat "$REPO/<file>" > "$M/<file>"
cd "$M"   # ALWAYS run from the clone (cwd-relative fixtures go falsely red elsewhere)
# 1. green baseline of the named test file (P-2 with cwd $M)
# 2. python3 "$SCRATCH/mutate.py" "$M/<file>" '<old>' '<new>'
# 3. run the named test file -> must be red in the named test
# 4. restore: cat "$REPO/<file>" > "$M/<file>"; then
/usr/bin/git -C "$M" diff > "$LOGS/mut-diff.txt"; /usr/bin/git -C "$M" diff --cached >> "$LOGS/mut-diff.txt"; wc -c < "$LOGS/mut-diff.txt"   # expect 0 (for committed files)
# before deleting the clone: /bin/rm -f "$M/node_modules"; the clone dir itself is removed only by the human (listed in the checkpoint)
```

A ccloop clone needs `npm run build` before any test that spawns `dist/cli.js` (ccloop handoff). An Orca clone that runs
real-ccloop scenarios needs `ORCA_CCLOOP_BIN` pointing at a built ccloop clone that is **not** being mutated.
Before and after each mutation group: `pgrep -fl "fake-omp|fake-codex|worker.js" > "$LOGS/pgrep-<task>.txt"`; killing a
leftover process needs the human.

### P-4. Commit

```bash
cat > "$SCRATCH/msg.txt" <<'EOF'
<subject>

<body: what, which spec section, which criteria>

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
/usr/bin/git -C "$REPO" add <exact paths>      # never -A (node_modules is a symlink)
/usr/bin/git -C "$REPO" diff --cached --stat > "$LOGS/staged.txt"   # read it; show the diff before committing (global CLAUDE.md)
/usr/bin/git -C "$REPO" commit -F "$SCRATCH/msg.txt"
/usr/bin/git -C "$REPO" log -1 --format=%B > "$LOGS/last-commit.txt"   # read it back
```

### P-5. Existing criteria this round changes (to be approved by the human, one by one)

Found by grep on ccloop `a52ce96` and Orca `codex/round-20261015b` (commands in the ledger:
`/usr/bin/grep -rn 'singleCallExecution' tests`, `/usr/bin/grep -rn 'contextWindowTokens' tests`,
`/usr/bin/grep -rn 'blocked-capability' tests`, `/usr/bin/grep -rn 'intersectCapabilities' tests`). **Will change (named
to the human before rewriting):**

| # | Repo | file:line | Today asserts | After this round |
|---|---|---|---|---|
| E1 | ccloop | `tests/control/singleCallCapability.test.ts:16` (`SEVEN.contextWindowTokens: null`), used at `:53` (claude) and `:59` (codex) | claude agent-default and codex `gpt-6-sol` report window `null` | claude `200000` (part E); codex `272000` from the fake catalog (part D) |
| E2 | ccloop | `tests/control/singleCallCapability.test.ts:48,60` (C1 title and `singleCallExecution: null` for codex) | codex answers `null` | codex answers `"v1-soft"` |
| E3 | ccloop | `tests/control/singleCallCapability.test.ts:70-78` (C3) | accept refuses codex single-call work with `single-call-unsupported` | accept admits it (the refusal stays for a model with no catalog row: rewritten to select `model: "fixture"`, which the fake catalog does not list) |
| E4 | ccloop | `tests/agents/registry.test.ts:83` (and the title at `:81`) | claude agent-default window `null` | `200000` |
| E5 | ccloop | `tests/control/agentsControl.test.ts:110` | claude (`model: "opus"`, agent-default) `capabilities: { contextWindowTokens: null }` | `200000` |
| E6 | Orca | `tests/control/webCcloopSmoke.test.ts:156-159` | real ccloop answers codex `contextWindowTokens: null` | `272000` (fake catalog default) |

**Read and predicted unchanged (confirm in the red runs; any that goes red is named to the human, not edited):**
ccloop `tests/agents/registry.test.ts:84-92` (codex without a row stays `null`), `tests/agents/materialize.test.ts:71-76`
(injected probe ⇒ no catalog), `tests/control/requestBoundDimensions.test.ts:32,35` and `tests/control/command.test.ts:108`
(handler stand-ins), `tests/control/ompSingleCallAccept.test.ts:53,63`, `tests/agents/ompSingleCallResolution.test.ts:33-69`,
`tests/agents/ompCatalogDiagnostics.test.ts:34,41,48-56`; Orca `tests/control/profiles.test.ts:171` (observed `null` stays
`null` under R7), `tests/control/planImport.test.ts:125,147,156,423,429`, `tests/control/agentPlanImport.test.ts:76,99,154`,
`tests/control/agentSelectionE2E.test.ts:72`, `tests/control/fixtures/ccloopWorld.ts:244`,
`tests/control/estimatePrompt.test.ts:70,79`, `tests/control/estimateSingleCallGate.test.ts:26,39` (each injects
`singleCallExecution: null`, no estimator profile, or no agent -- none asserts a codex estimate through the real resolution),
`tests/control/agentUpgradeE2E.test.ts:52-106` (see spec issue 8).
**Prose that may become false (ERRATUM appended, assertion untouched, only if a run proves it false):**
Orca `tests/control/fixtures/ccloopWorld.ts:82` ("null otherwise, so the estimate stays blocked-capability"),
`tests/control/executionDriverE2E.test.ts:16`, `tests/control/handoffE2E.test.ts:319`,
`tests/control/estimateSingleCallGate.test.ts:11` ("`contextWindowTokens: null`, which blocks an estimate on its own").

**Fixture changes (listed for the human separately, Orca handoff §6.9):** ccloop `tests/fixtures/fake-codex.mjs`,
`tests/fixtures/fake-omp.mjs`, `tests/setup/scopeTmpdir.ts`-sibling setup file; Orca `vitest.config.ts`,
`tests/control/fixtures/ccloopWorld.ts` (`WorldOptions.estimateMode`), `tests/control/fixtures/estimateHarness.ts`
(`byModel` option), `tests/panel/fixtures/controlPanel.ts` (`BootOptions.listModels`).

---

## File map

ccloop (branch `codex/every-agent-chain`, worktree `$CL`):

| File | Responsibility |
|---|---|
| `src/agents/catalogCache.ts` (new) | cache dir, key, entry read/write, lifetime, modes |
| `src/agents/catalogProbe.ts` (new) | one bounded probe process: deadline, abort, stage, elapsed, stderr tail |
| `src/agents/codexCatalog.ts` (new) | `codex debug models` + `codex features list` decode, `model_context_window` override |
| `src/agents/agentCatalog.ts` (new) | `readAgentCatalog`: cache first, then version + catalog probes |
| `src/agents/models.ts` (new) | `listAgentModels` (part A answer) |
| `src/agents/ompModels.ts` | `runOmpJson` delegates to `catalogProbe`; `readOmpCatalog` takes `deadline`/`signal` |
| `src/agents/materialize.ts` | `resolveAgent` reads through `readAgentCatalog`; codex row |
| `src/agents/updates.ts` | `ompUnavailable` reads through `readAgentCatalog` |
| `src/agents/codex.ts`, `claude.ts`, `registry.ts`, `types.ts` | `"v1-soft"`, codex window, claude 200000, `CatalogRowV1.listed` |
| `src/agents/command.ts` | `ccloop agents models` |
| `src/control/protocol.ts`, `src/control/command.ts` | `control models`; resolution enum `"v1-soft"` |
| `src/runtime/omp/ompSingleCall.ts` | spawn-time re-check through the cache with the call's deadline and signal |
| `src/runtime/codex/runCodexPhase.ts` | optional `spawn` override (args/env/schema) for the single call |
| `src/runtime/codex/codexSingleCall.ts` (new) | args, private HOME/CODEX_HOME, decoder |
| `src/runtime/codex/codexAdapter.ts` | `singleCall` |
| `tests/fixtures/fake-codex.mjs`, `tests/fixtures/fake-omp.mjs` | catalog answers, counts, sleeps, single-call modes |
| `tests/setup/relocateCatalogCache.ts` (new) + `vitest.config.ts` | `CCLOOP_CACHE_DIR` for every test file |

Orca (branch `codex/every-agent-chain`, worktree `$OR`):

| File | Responsibility |
|---|---|
| `tests/setup/relocateCcloopCache.ts` (new) + `vitest.config.ts` | `CCLOOP_CACHE_DIR` for every test file and every spawned ccloop |
| `src/control/profiles.ts` | R7 intersection |
| `src/control/ccloopPort.ts`, `src/control/agentSelection.ts`, `src/control/executionPort.ts` | `"v1-soft"`; `listModels` |
| `src/control/estimatorCompatibility.ts` | strict/soft split |
| `src/panel/controlViews.ts`, `src/control/webProtocol.ts` | `outputBound`/`outputBoundExceededBy`; models view schema |
| `src/panel/controlApi.ts` | `GET /api/control/agents/:installation/models` |
| `web/src/controlApi.ts`, `web/src/controlTypes.ts`, `web/src/App.tsx`, `web/src/AgentFields.tsx`, `web/src/AgentSelectionEditor.tsx`, `web/src/AgentSettings.tsx`, `web/src/RunOutputBound.tsx` (new), `web/src/ControlGroupView.tsx` | datalist, refresh, reason, overrun line |
| `web/src/locales/en.ts`, `web/src/locales/zh.ts` | new strings; `agent-catalog-unavailable`, `codex-single-call-not-single`, `codex-single-call-unavailable` |
| `package.json`, `package-lock.json` | repin (script output) |

---

## Task 0: Codex isolation research (zero-cost; R9; spec §2.5, §6.1)

**Files:** none in either repo. Output: `$SCRATCH/task0/` and a ledger section (Task 9 commits the ledger text into Orca's
`.superpowers/sdd/2026-10-15-every-agent-chain/progress.md` with `git add -f`).

- [ ] **Step 1 [HUMAN nod required before running]: name the credential-path step.** Tell the human, verbatim: "Task 0 makes
  `$SCRATCH/task0/codex-home/` holding **symlinks** (not copies) to `~/.codex/auth.json` and `~/.codex/config.toml`, sets
  `HOME=$SCRATCH/task0/home` and `CODEX_HOME=$SCRATCH/task0/codex-home`, and runs `codex debug prompt-input hi` (renders
  input, sends no request). OK?" Do not continue without a yes.

- [ ] **Step 2: build the private setup and render (after the yes).**

```bash
T="$SCRATCH/task0"; mkdir -p "$T/home" "$T/codex-home" "$T/cwd"; chmod 700 "$T/home" "$T/codex-home" "$T/cwd"
ln -s "$HOME/.codex/auth.json" "$T/codex-home/auth.json"
ln -s "$HOME/.codex/config.toml" "$T/codex-home/config.toml"
codex --version > "$T/version.txt" 2>&1
codex features list > "$T/features.txt" 2>&1
ISO=(-c include_permissions_instructions=false -c include_apps_instructions=false -c include_collaboration_mode_instructions=false
     -c include_environment_context=false -c project_doc_max_bytes=0 -c features.multi_agent=false -c features.skip_host_skill_discovery=true)
( cd "$T/cwd" && HOME="$T/home" CODEX_HOME="$T/codex-home" codex debug prompt-input "${ISO[@]}" hi ) > "$T/linked.json" 2> "$T/linked.err"; echo "RC=$?" >> "$T/linked.err"
mkdir -p "$T/empty-codex-home"; chmod 700 "$T/empty-codex-home"
( cd "$T/cwd" && HOME="$T/home" CODEX_HOME="$T/empty-codex-home" codex debug prompt-input "${ISO[@]}" hi ) > "$T/empty.json" 2> "$T/empty.err"; echo "RC=$?" >> "$T/empty.err"
```

- [ ] **Step 3: measure, by code (Rule 5).** Write `$T/measure.py` that loads each JSON, prints the total bytes of
  `json.dumps(item, ensure_ascii=False).encode()` summed over the items, and per item the first 80 characters of its text
  with its byte size. Run it on both files into `$T/measure.txt`, read it whole.

```python
import json, sys
for path in sys.argv[1:]:
    items = json.load(open(path, encoding="utf-8"))
    items = items if isinstance(items, list) else items.get("input", items.get("items", []))
    sizes = [len(json.dumps(i, ensure_ascii=False).encode()) for i in items]
    print(path, "items", len(items), "total", sum(sizes))
    for i, s in zip(items, sizes):
        print("  ", s, json.dumps(i, ensure_ascii=False)[:80])
```

- [ ] **Step 4: decide (record in the ledger, with the commands above and `codex --version`).**
  - Expected (spec §2.5 last row): `linked.json` total ≈ `empty.json` total (≈ 6332 bytes on codex-cli 0.160.0). If
    `linked.json` is larger, find which item the linked `config.toml` adds (MCP servers, `instructions`, profiles), add
    the matching `-c` override to `ISO`, re-render, and record the override; Task 8 copies the final `ISO` list into
    `CODEX_SINGLE_CALL_CONFIG`.
  - Record the feature names from `features.txt` that intersect
    `apps, image_generation, multi_agent, plugins, shell_tool, unified_exec, view_image, skip_host_skill_discovery`.
    Also record (do not act on) the stable-and-on flags that look like tools but are outside the spec's list
    (`browser_use`, `computer_use`, `code_mode_host` were listed on this machine at planning time) -- for the human.
  - **Fallback (R9):** if any render fails with the private HOME/CODEX_HOME (auth or provider errors in `linked.err`),
    record "isolation not workable on codex <version>" and take Task 8's fallback branch.
  - The framing overhead in **tokens** is not estimated from bytes (Rule 14); it is read from paid check P1's
    `input_tokens` minus the prompt's own count, if the human approves P1.

- [ ] **Step 5: clean up.** `/bin/rm -f "$T/codex-home/auth.json" "$T/codex-home/config.toml"` (removes the links only, never
  their targets; check with `ls -l ~/.codex/auth.json ~/.codex/config.toml` before and after, sizes unchanged).

---

## Task 1: ccloop worktree and fake catalog answers (fixtures)

**Files:**
- Modify: `tests/fixtures/fake-codex.mjs:10-11` (insert before the argv append), stdin `end` handler (single-call branch, Task 8)
- Modify: `tests/fixtures/fake-omp.mjs:14-33`
- Create: `tests/agents/fakeCatalogFixtures.test.ts`

**Interfaces:**
- Produces (fixture contract used by Tasks 3-8 and Orca's real-ccloop worlds):
  - fake codex: `debug models` prints `{"models":[...]}` (default rows below, or `<marker>.catalog.json` `{rows?, sleepMs?, exitCode?, stderr?}`), `features list` prints one `name stage enabled` line per flag; each of those calls appends `debug-models` / `features-list` to `<marker>.catalog-calls`; `--version` appends `version` to `<marker>.version-calls`. None of them touches `<marker>.argv` or `<marker>.calls`.
  - fake omp: `models` appends `models` to `<marker>.catalog-calls` and writes its pid to `<marker>.models.pid`; `--version` appends `version` to `<marker>.version-calls`; `<marker>.models.json` gains `sleepMs`.

- [ ] **Step 1: create the worktree (not one of the four human-only actions).**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop ls-remote origin refs/heads/main > "$LOGS/cl-remote.txt"   # read: note the sha
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop worktree add -b codex/every-agent-chain "$CL" main > "$LOGS/cl-wt.txt" 2>&1
ln -s /Users/biran/code/skills/orca/ccloop/node_modules "$CL/node_modules"
( cd "$CL" && npm run build ) > "$LOGS/cl-build0.txt" 2>&1; echo "RC=$?" >> "$LOGS/cl-build0.txt"
```

- [ ] **Step 2: write the failing fixture test** `tests/agents/fakeCatalogFixtures.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every-agent requirement chain (Orca spec 2026-10-15 §9): the fakes answer the catalog commands, count every catalog and
// version spawn in files of their own (criterion 1 reads the count), and never log a catalog call as a phase call.
const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "ccloop-fake-catalog-")));
const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n") : []);

describe("fake catalog answers (spec 2026-10-15 §9)", () => {
  it("fake codex answers debug models and features list, counts them, and leaves argv and calls alone", () => {
    const marker = join(dir(), "codex-marker");
    const models = spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" });
    expect(models.status).toBe(0);
    expect(JSON.parse(models.stdout).models.map((row: { slug: string; context_window: number; visibility: string }) => [row.slug, row.context_window, row.visibility]))
      .toEqual([["gpt-6-sol", 272000, "list"], ["gpt-6-luna", 272000, "list"], ["gpt-reserve", 272000, "hide"]]);
    const features = spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "features", "list"], { encoding: "utf8" });
    expect(features.status).toBe(0);
    expect(features.stdout.split("\n").filter(Boolean).map((line) => line.split(/\s+/)[0]))
      .toEqual(["apps", "browser_use", "image_generation", "multi_agent", "plugins", "shell_tool", "skip_host_skill_discovery", "unified_exec", "view_image"]);
    spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "--version"], { encoding: "utf8" });
    expect(lines(`${marker}.catalog-calls`)).toEqual(["debug-models", "features-list"]);
    expect(lines(`${marker}.version-calls`)).toEqual(["version"]);
    expect(existsSync(`${marker}.argv`)).toBe(false);
    expect(existsSync(`${marker}.calls`)).toBe(false);
  });

  it("fake codex obeys <marker>.catalog.json: rows, exit code with stderr, and a sleep", () => {
    const marker = join(dir(), "codex-marker");
    writeFileSync(`${marker}.catalog.json`, JSON.stringify({ rows: [{ slug: "only", context_window: 1000, visibility: "list" }] }));
    expect(JSON.parse(spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" }).stdout).models)
      .toEqual([{ slug: "only", context_window: 1000, visibility: "list" }]);
    writeFileSync(`${marker}.catalog.json`, JSON.stringify({ exitCode: 4, stderr: "no catalog\n" }));
    const failed = spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" });
    expect([failed.status, failed.stderr]).toEqual([4, "no catalog\n"]);
    writeFileSync(`${marker}.catalog.json`, JSON.stringify({ sleepMs: 400 }));
    const started = Date.now();
    spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it("fake omp counts models and version calls, records the models pid, and sleeps on request", () => {
    const marker = join(dir(), "omp-marker");
    spawnSync(process.execPath, [FAKE_OMP, marker, "--no-extensions", "--profile", "default", "models", "--json"], { encoding: "utf8" });
    spawnSync(process.execPath, [FAKE_OMP, marker, "--version"], { encoding: "utf8" });
    expect(lines(`${marker}.catalog-calls`)).toEqual(["models"]);
    expect(lines(`${marker}.version-calls`)).toEqual(["version"]);
    expect(Number(readFileSync(`${marker}.models.pid`, "utf8"))).toBeGreaterThan(0);
    writeFileSync(`${marker}.models.json`, JSON.stringify({ sleepMs: 400 }));
    const started = Date.now();
    const slow = spawnSync(process.execPath, [FAKE_OMP, marker, "models", "--json"], { encoding: "utf8" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(slow.stdout).models[0].selector).toBe("gateway/model-a");
  });
});
```

- [ ] **Step 3: red.** P-2 with `tests/agents/fakeCatalogFixtures.test.ts` into `$LOGS/t1-red.log`. Expected: RC≠0, all three
  tests fail (the fake codex treats `debug models` as an `exec` call; the fake omp writes no count files).

- [ ] **Step 4: implement.** In `tests/fixtures/fake-codex.mjs`, insert after line 10 (the `--version` line) and change that
  line so it also counts:

```js
// Every-agent requirement chain (Orca spec 2026-10-15 §9): `--version` appends `version` to `<marker>.version-calls`;
// `debug models` and `features list` answer the catalog and the feature list and append `debug-models` / `features-list`
// to `<marker>.catalog-calls`, before anything below runs, so `<marker>.argv` and `<marker>.calls` never see them.
// `<marker>.catalog.json` ({rows?, sleepMs?, exitCode?, stderr?}) overrides the rows, sleeps first, or fails.
if(process.argv.at(-1)==="--version"&&!process.argv.includes("exec")) {appendFileSync(marker+".version-calls","version\n");await new Promise(resolve=>process.stdout.write("9.9.9-fake\n",resolve));process.exit(0);}
const catalogCall=process.argv.includes("debug")&&process.argv.includes("models")?"debug-models":process.argv.includes("features")&&process.argv.includes("list")?"features-list":null;
if(catalogCall!==null&&!process.argv.includes("exec")) {
  appendFileSync(marker+".catalog-calls",catalogCall+"\n");
  const script=existsSync(marker+".catalog.json")?JSON.parse(readFileSync(marker+".catalog.json","utf8")):{};
  if(script.sleepMs!==undefined) await new Promise(resolve=>setTimeout(resolve,script.sleepMs));
  if(script.stderr!==undefined) await new Promise(resolve=>process.stderr.write(script.stderr,resolve));
  if(script.exitCode!==undefined) process.exit(script.exitCode);
  if(catalogCall==="debug-models") {
    const rows=script.rows??[{slug:"gpt-6-sol",context_window:272000,visibility:"list"},{slug:"gpt-6-luna",context_window:272000,visibility:"list"},{slug:"gpt-reserve",context_window:272000,visibility:"hide"}];
    await new Promise(resolve=>process.stdout.write(JSON.stringify({models:rows})+"\n",resolve));
  } else {
    const flags=["apps","browser_use","image_generation","multi_agent","plugins","shell_tool","skip_host_skill_discovery","unified_exec","view_image"];
    await new Promise(resolve=>process.stdout.write(flags.map(flag=>`${flag.padEnd(40)} stable             true`).join("\n")+"\n",resolve));
  }
  process.exit(0);
}
```

  and add `existsSync` to the line-1 import. In `tests/fixtures/fake-omp.mjs`: in the `--version` branch (line 14) add
  `appendFileSync(\`${marker}.version-calls\`, "version\n");` before writing; at the top of the `models` branch (line 20)
  add `appendFileSync(\`${marker}.catalog-calls\`, "models\n"); writeFileSync(\`${marker}.models.pid\`, String(process.pid));`;
  inside the `models.json` block add `if (script.sleepMs !== undefined) await new Promise((done) => setTimeout(done, script.sleepMs));`
  before the `stderr` line; extend the header comment with one sentence naming the new files.

- [ ] **Step 5: green.** P-2 into `$LOGS/t1-green.log`; RC=0, 3 passed. Then the files that use these fakes most, to show
  nothing else moved: `tests/control/singleCallCapability.test.ts tests/runtime/omp tests/agents/ompCatalogDiagnostics.test.ts tests/control/ompSingleCallWorker.test.ts tests/control/handoffDeadlineUsage.test.ts`
  into `$LOGS/t1-neighbours.log`; RC=0.

- [ ] **Step 6: mutations (P-3).** M1.1: in fake-codex delete `appendFileSync(marker+".catalog-calls",catalogCall+"\n");`
  ⇒ red in "fake codex answers debug models...". M1.2: in fake-omp remove the `catalog-calls` append ⇒ red in "fake omp
  counts...". M1.3: insert a copy of the line `appendFileSync(marker+".argv",JSON.stringify(process.argv.slice(process.argv.indexOf("exec")))+"\n");`
  directly above `const catalogCall=` (so catalog calls are logged as argv) ⇒ red on `existsSync(\`${marker}.argv\`)`.

- [ ] **Step 7: commit** (P-4) `tests/fixtures/fake-codex.mjs tests/fixtures/fake-omp.mjs tests/agents/fakeCatalogFixtures.test.ts`,
  subject `test(fixtures): fake codex and omp answer and count catalog probes`.

---

## Task 2: The catalog cache file (ccloop, spec §4.1-§4.2)

**Files:**
- Create: `src/agents/catalogCache.ts`
- Modify: `src/agents/types.ts:37` (`CatalogRowV1` gains `listed?: boolean`)
- Test: `tests/agents/catalogCache.test.ts`

**Interfaces:**
- Produces:
  - `export const CATALOG_LIFETIME_MS = 1_800_000`
  - `export interface CatalogStampV1 { path: string; mtimeMs: number | null; size: number | null }`
  - `export interface CatalogKeyV1 { schema: "ccloop-agent-catalog-key-v1"; kind: string; command: string[]; files: CatalogStampV1[]; profile: string | null; configDir: string | null; inheritedConfigDir: string | null; configFiles: CatalogStampV1[] }`
  - `export interface CatalogEntryV1 { schema: "ccloop-agent-catalog-v1"; key: CatalogKeyV1; observedAt: string; version: string; rows: CatalogRowV1[] | null; codexFeatures: string[] | null }`
  - `export function catalogCacheDir(env: NodeJS.ProcessEnv): string | null`
  - `export async function catalogKey(installation: InstallationV1, env: NodeJS.ProcessEnv): Promise<CatalogKeyV1>`
  - `export function entryFileName(key: CatalogKeyV1): string` (`<canonicalHash(key)>.json`)
  - `export async function readCatalogEntry(dir: string, key: CatalogKeyV1, now: number): Promise<CatalogEntryV1 | null>`
  - `export async function writeCatalogEntry(dir: string, entry: CatalogEntryV1): Promise<void>` (never throws)
  - `CatalogRowV1` = `{ selector; provider; contextWindow; maxTokens; listed?: boolean }`

- [ ] **Step 1: failing tests** `tests/agents/catalogCache.test.ts`:

```ts
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_LIFETIME_MS, catalogCacheDir, catalogKey, entryFileName, readCatalogEntry, writeCatalogEntry, type CatalogEntryV1 } from "../../src/agents/catalogCache.js";
import type { InstallationV1 } from "../../src/agents/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §4.1-§4.2, R4): one file per key under a redirectable dir, 0700/0600
// set explicitly, a 30-minute lifetime, and any change of a key field is a miss. Each key-field test is the one the
// mutation "drop that field from catalogKey" turns red.
const T0 = Date.parse("2026-10-15T00:00:00.000Z");
const root = async () => realpath(await mkdtemp(join(tmpdir(), "ccloop-cache-")));
async function world(kind: "omp" | "codex" = "omp") {
  const dir = await root();
  const binary = join(dir, kind); await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  const home = join(dir, "home"); await mkdir(join(home, ".omp", "agent"), { recursive: true }); await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".omp", "agent", "config.yml"), "a: 1\n"); await writeFile(join(home, ".codex", "config.toml"), "model = \"x\"\n");
  const installation: InstallationV1 = kind === "omp"
    ? { kind, command: [binary], version: "18.10.1", configDir: null, timeoutMs: 1000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null }
    : { kind, command: [binary], version: "9.9.9-fake", configDir: null, timeoutMs: 1000, killGraceMs: 50, sandbox: "read-only", budgetMode: "soft" };
  const env = { HOME: home, CCLOOP_CACHE_DIR: join(dir, "cache") } as NodeJS.ProcessEnv;
  return { dir, binary, home, installation, env, cache: join(dir, "cache") };
}
const entry = (key: CatalogEntryV1["key"], at = T0): CatalogEntryV1 => ({ schema: "ccloop-agent-catalog-v1", key, observedAt: new Date(at).toISOString(), version: "18.10.1",
  rows: [{ selector: "gateway/model-a", provider: "gateway", contextWindow: 200000, maxTokens: 8192 }], codexFeatures: null });

describe("cache dir (spec §4.2)", () => {
  it("prefers CCLOOP_CACHE_DIR, then XDG_CACHE_HOME, then HOME, and refuses a relative or absent root", () => {
    expect(catalogCacheDir({ CCLOOP_CACHE_DIR: "/a", XDG_CACHE_HOME: "/b", HOME: "/c" })).toBe("/a");
    expect(catalogCacheDir({ XDG_CACHE_HOME: "/b", HOME: "/c" })).toBe("/b/ccloop/agent-catalog");
    expect(catalogCacheDir({ HOME: "/c" })).toBe("/c/.cache/ccloop/agent-catalog");
    expect(catalogCacheDir({ CCLOOP_CACHE_DIR: "rel", HOME: "/c" })).toBeNull();   // RF3
    expect(catalogCacheDir({})).toBeNull();                                         // RF3
  });
});

describe("entries (spec §4.1)", () => {
  it("round-trips an entry, creating the dir 0700 and the file 0600 whatever the umask", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    const old = process.umask(0o000);
    try { await writeCatalogEntry(w.cache, entry(key)); } finally { process.umask(old); }
    expect(await readCatalogEntry(w.cache, key, T0 + 1)).toEqual(entry(key));
    expect((await stat(w.cache)).mode & 0o777).toBe(0o700);
    expect((await stat(join(w.cache, entryFileName(key)))).mode & 0o777).toBe(0o600);
    expect(await readdir(w.cache)).toEqual([entryFileName(key)]);
  });

  it("leaves an existing dir's mode alone", async () => {
    const w = await world(); await mkdir(w.cache, { mode: 0o755 }); await chmod(w.cache, 0o755);
    await writeCatalogEntry(w.cache, entry(await catalogKey(w.installation, w.env)));
    expect((await stat(w.cache)).mode & 0o777).toBe(0o755);
  });

  it("is a miss at exactly 30 minutes, and for an entry from the future (RF4)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await writeCatalogEntry(w.cache, entry(key));
    expect(await readCatalogEntry(w.cache, key, T0 + CATALOG_LIFETIME_MS - 1)).not.toBeNull();
    expect(await readCatalogEntry(w.cache, key, T0 + 1_800_000)).toBeNull();
    expect(await readCatalogEntry(w.cache, key, T0 - 1)).toBeNull();
  });

  it("treats a corrupt entry and an entry whose stored key differs as a miss (RF4)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await mkdir(w.cache, { recursive: true });
    await writeFile(join(w.cache, entryFileName(key)), "{not json");
    expect(await readCatalogEntry(w.cache, key, T0)).toBeNull();
    await writeFile(join(w.cache, entryFileName(key)), JSON.stringify(entry({ ...key, kind: "codex" })));
    expect(await readCatalogEntry(w.cache, key, T0)).toBeNull();
  });

  it("never throws when the dir cannot be written, and leaves no temp file (RF2)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await writeFile(w.cache, "a file where the dir should be");
    await expect(writeCatalogEntry(w.cache, entry(key))).resolves.toBeUndefined();
    const locked = join(w.dir, "locked"); await mkdir(locked, { mode: 0o500 }); await chmod(locked, 0o500);
    await expect(writeCatalogEntry(locked, entry(key))).resolves.toBeUndefined();
    expect(await readdir(locked)).toEqual([]);
  });

  it("keeps one file when two writers race on a cold key (RF1)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await Promise.all([writeCatalogEntry(w.cache, entry(key)), writeCatalogEntry(w.cache, entry(key, T0 + 5))]);
    expect(await readdir(w.cache)).toEqual([entryFileName(key)]);
  });
});

describe("key fields (spec §4.1; each is a stale-hit guard)", () => {
  const changed = async (mutate: (w: Awaited<ReturnType<typeof world>>) => Promise<InstallationV1 | void>, kind: "omp" | "codex" = "omp") => {
    const w = await world(kind); const before = await catalogKey(w.installation, w.env);
    const next = (await mutate(w)) ?? w.installation;
    return entryFileName(await catalogKey(next, w.env)) !== entryFileName(before);
  };
  it("the binary's mtime", async () => expect(await changed(async (w) => { await utimes(w.binary, new Date(T0), new Date(T0)); })).toBe(true));
  it("the binary's size", async () => expect(await changed(async (w) => { await writeFile(w.binary, "#!/bin/sh\n# longer\n"); await utimes(w.binary, new Date(T0), new Date(T0)); })).toBe(true));
  it("the binary's realpath", async () => expect(await changed(async (w) => { const other = join(w.dir, "other"); await writeFile(other, "#!/bin/sh\n", { mode: 0o700 }); return { ...w.installation, command: [other] }; })).toBe(true));
  it("an argv file's mtime (a wrapper's version file, spec issue 8)", async () => {
    const w = await world(); const file = join(w.dir, "version.txt"); await writeFile(file, "1.0.0\n");
    const installation: InstallationV1 = { ...w.installation, command: [w.binary, file] };
    const before = entryFileName(await catalogKey(installation, w.env));
    await utimes(file, new Date(T0 + 9_000), new Date(T0 + 9_000));
    expect(entryFileName(await catalogKey(installation, w.env))).not.toBe(before);
  });
  it("the profile", async () => expect(await changed(async (w) => ({ ...w.installation, profile: "work" }))).toBe(true));
  it("the configDir", async () => expect(await changed(async (w) => ({ ...w.installation, configDir: w.dir }))).toBe(true));
  it("the inherited config dir variable", async () => expect(await changed(async (w) => { w.env.PI_CODING_AGENT_DIR = w.dir; })).toBe(true));
  it("omp's config.yml mtime", async () => expect(await changed(async (w) => { await utimes(join(w.home, ".omp", "agent", "config.yml"), new Date(T0), new Date(T0)); })).toBe(true));
  it("codex's config.toml mtime", async () => expect(await changed(async (w) => { await utimes(join(w.home, ".codex", "config.toml"), new Date(T0), new Date(T0)); }, "codex")).toBe(true));
  it("not the cache dir or the clock", async () => expect(await changed(async (w) => { w.env.CCLOOP_CACHE_DIR = join(w.dir, "elsewhere"); })).toBe(false));
});
```

  And extend `src/agents/types.ts:37` in the test's sight: nothing (types only).

- [ ] **Step 2: red.** P-2 `tests/agents/catalogCache.test.ts` → `$LOGS/t2-red.log`; expected: the file fails to import
  (`catalogCache.js` missing). That is a load failure, so additionally record that **each** test is listed as failed after
  Step 3's first stub (`export {}`) -- crash-red is not evidence (Orca handoff §6.2).

- [ ] **Step 3: implement** `src/agents/catalogCache.ts`:

```ts
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalHash } from "../control/protocol.js";
import type { CatalogRowV1, InstallationV1 } from "./types.js";

/**
 * Every-agent requirement chain (Orca spec 2026-10-15 §4.1-§4.2, ruling R4): the agent catalog and `--version` answer,
 * cached in one file per key. Out-of-repo write registered in that spec §4.2: path below, writer = any ccloop process
 * that probes, residue on failure = at most one temp file (removed when possible); a corrupt entry is a miss.
 */
export const CATALOG_LIFETIME_MS = 1_800_000;
export interface CatalogStampV1 { path: string; mtimeMs: number | null; size: number | null }
export interface CatalogKeyV1 {
  schema: "ccloop-agent-catalog-key-v1"; kind: string; command: string[]; files: CatalogStampV1[];
  profile: string | null; configDir: string | null; inheritedConfigDir: string | null; configFiles: CatalogStampV1[];
}
export interface CatalogEntryV1 {
  schema: "ccloop-agent-catalog-v1"; key: CatalogKeyV1; observedAt: string; version: string;
  rows: CatalogRowV1[] | null; codexFeatures: string[] | null;
}

export function catalogCacheDir(env: NodeJS.ProcessEnv): string | null {
  if (env.CCLOOP_CACHE_DIR !== undefined && env.CCLOOP_CACHE_DIR !== "") return isAbsolute(env.CCLOOP_CACHE_DIR) ? env.CCLOOP_CACHE_DIR : null;
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME)) return join(env.XDG_CACHE_HOME, "ccloop", "agent-catalog");
  if (env.HOME && isAbsolute(env.HOME)) return join(env.HOME, ".cache", "ccloop", "agent-catalog");
  return null;
}

async function stamp(path: string): Promise<CatalogStampV1> {
  try {
    const real = await realpath(path);
    const info = await stat(real);
    return { path: real, mtimeMs: info.mtimeMs, size: info.size };
  } catch { return { path, mtimeMs: null, size: null }; }
}

const ENV_OF_KIND: Record<string, string> = { omp: "PI_CODING_AGENT_DIR", codex: "CODEX_HOME" };

/** Spec issue 7(d): omp 18.10.1 `pi-utils/src/dirs.ts:119-133`; codex: `$CODEX_HOME/config.toml` (default `~/.codex`). */
function configFilesOf(installation: InstallationV1, env: NodeJS.ProcessEnv): string[] {
  const inherited = ENV_OF_KIND[installation.kind] === undefined ? undefined : env[ENV_OF_KIND[installation.kind]!];
  const home = env.HOME && isAbsolute(env.HOME) ? env.HOME : null;
  if (installation.kind === "omp") {
    const profile = installation.profile as string | null;
    const agentDir = installation.configDir ?? inherited ?? (home === null ? null : profile ? join(home, ".omp", "profiles", profile, "agent") : join(home, ".omp", "agent"));
    return agentDir === null ? [] : [join(agentDir, "config.yml"), join(agentDir, "models.yaml")];
  }
  if (installation.kind === "codex") {
    const codexHome = installation.configDir ?? inherited ?? (home === null ? null : join(home, ".codex"));
    return codexHome === null ? [] : [join(codexHome, "config.toml")];
  }
  return [];
}

export async function catalogKey(installation: InstallationV1, env: NodeJS.ProcessEnv): Promise<CatalogKeyV1> {
  const argvFiles: CatalogStampV1[] = [];
  for (const [index, part] of installation.command.entries()) {
    const s = await stamp(part);
    if (index === 0 || s.mtimeMs !== null) argvFiles.push(s);
  }
  const variable = ENV_OF_KIND[installation.kind];
  return {
    schema: "ccloop-agent-catalog-key-v1", kind: installation.kind, command: [...installation.command], files: argvFiles,
    profile: (installation.profile as string | null | undefined) ?? null, configDir: installation.configDir,
    inheritedConfigDir: installation.configDir === null && variable !== undefined ? env[variable] ?? null : null,
    configFiles: await Promise.all(configFilesOf(installation, env).map(stamp)),
  };
}

export const entryFileName = (key: CatalogKeyV1): string => `${canonicalHash(key)}.json`;

export async function readCatalogEntry(dir: string, key: CatalogKeyV1, now: number): Promise<CatalogEntryV1 | null> {
  try {
    const value = JSON.parse(await readFile(join(dir, entryFileName(key)), "utf8")) as CatalogEntryV1;
    if (value === null || typeof value !== "object" || value.schema !== "ccloop-agent-catalog-v1" || typeof value.version !== "string"
      || canonicalHash(value.key) !== canonicalHash(key) || !(value.rows === null || Array.isArray(value.rows))
      || !(value.codexFeatures === null || Array.isArray(value.codexFeatures))) return null;
    const age = now - Date.parse(value.observedAt);
    return Number.isFinite(age) && age >= 0 && age < CATALOG_LIFETIME_MS ? value : null;
  } catch { return null; }
}

/** Creates each missing directory with 0700 set explicitly (not from umask); an existing one is left alone. */
async function ensureDir(dir: string): Promise<void> {
  const missing: string[] = [];
  for (let at = dir; ; at = dirname(at)) {
    try { if ((await stat(at)).isDirectory()) break; throw new Error("not a directory"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing.unshift(at); if (dirname(at) === at) break; }
  }
  for (const path of missing) { await mkdir(path, { mode: 0o700 }); await chmod(path, 0o700); }
}

export async function writeCatalogEntry(dir: string, entry: CatalogEntryV1): Promise<void> {
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  try {
    await ensureDir(dir);
    await writeFile(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, join(dir, entryFileName(entry.key)));
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
```

  In `src/agents/types.ts:37` add `listed?: boolean` to `CatalogRowV1` with the comment
  `/** codex only (Orca spec 2026-10-15 §3): the catalog row's visibility is "list"; omp rows leave it out. */`.

- [ ] **Step 4: green.** P-2 → `$LOGS/t2-green.log`; RC=0, every test passed (count them: 17).

- [ ] **Step 5: mutations (P-3), each red in the named test only:** M2.1 drop `files: argvFiles,` (→ `files: [],`) ⇒ red
  "the binary's mtime", "size", "realpath", "an argv file's mtime". M2.2 `profile: (installation.profile ...) ?? null,` →
  `profile: null,` ⇒ red "the profile". M2.3 `configDir: installation.configDir,` → `configDir: null,` ⇒ red "the configDir".
  M2.4 `inheritedConfigDir: ...` → `inheritedConfigDir: null,` ⇒ red "the inherited config dir variable". M2.5
  `configFiles: await Promise.all(configFilesOf(installation, env).map(stamp)),` → `configFiles: [],` ⇒ red "omp's config.yml
  mtime" and "codex's config.toml mtime". M2.6 `age < CATALOG_LIFETIME_MS` → `age <= CATALOG_LIFETIME_MS` ⇒ red "is a
  miss at exactly 30 minutes". M2.7 `age >= 0 && ` → `` ⇒ red same test (future entry). M2.8 drop
  `canonicalHash(value.key) !== canonicalHash(key) ||` ⇒ red "treats a corrupt entry...". M2.9 `{ mode: 0o600, flag: "wx" }` →
  `{ flag: "wx" }` and delete `await chmod(temporary, 0o600);` ⇒ red "round-trips...0600". M2.10 delete
  `await chmod(path, 0o700);` ⇒ red "round-trips...0700". M2.11 replace the `catch { await rm(...) }` body with `{ }` ⇒ red
  "never throws when the dir cannot be written" only if the temp file stays (record the observation either way; if green,
  register the guard as redundant -- the `wx` write fails before a temp exists -- do not invent a criterion).
  M2.12 `return isAbsolute(env.CCLOOP_CACHE_DIR) ? env.CCLOOP_CACHE_DIR : null;` → `return env.CCLOOP_CACHE_DIR;` ⇒ red
  "prefers CCLOOP_CACHE_DIR...".

- [ ] **Step 6: commit** `src/agents/catalogCache.ts src/agents/types.ts tests/agents/catalogCache.test.ts`, subject
  `feat(agents): cache file for agent catalogs, keyed by binary and config stamps`.

---

## Task 3: A bounded probe with stage and elapsed time (ccloop, spec §4.3, R6; criterion 2)

**Files:**
- Create: `src/agents/catalogProbe.ts`, `src/agents/codexCatalog.ts`
- Modify: `src/agents/ompModels.ts:4-77,85-86` (`runOmpJson` → `runProbe`; `readOmpCatalog` options)
- Modify: `src/agents/materialize.ts:25,47` (`probeVersion` accepts `signal`)
- Test: `tests/agents/catalogProbe.test.ts`

**Interfaces:**
- Consumes: Task 1 fakes (`<marker>.models.json {hang|sleepMs}`, `<marker>.models.pid`, `<marker>.catalog.json`).
- Produces:
  - `export const PROBE_CAP_MS = 30_000`
  - `export type ProbeStage = "spawn" | "timeout" | "abort" | "exit" | "decode"`
  - `export class CatalogProbeError extends Error { readonly stage: ProbeStage; readonly elapsedMs: number }`
  - `export function probeTimeoutMs(deadline: number | undefined, now?: number): number` (`max(0, min(deadline-now, 30_000))`; no deadline ⇒ 30_000)
  - `export async function runProbe(code: string, command: string, args: string[], env: NodeJS.ProcessEnv, options: { timeoutMs: number; signal?: AbortSignal }): Promise<string>`
  - `export function stderrTail(kept: Buffer): string` (moved verbatim from `ompModels.ts:13-22`)
  - `readOmpCatalog(installation, options?: { timeoutMs?: number; deadline?: number; signal?: AbortSignal })`
  - `export async function readCodexCatalog(installation: InstallationV1, options: { deadline?: number; signal?: AbortSignal }): Promise<{ rows: CatalogRowV1[]; features: string[] }>`
  - `export const CODEX_SINGLE_CALL_FEATURES = ["apps","image_generation","multi_agent","plugins","shell_tool","skip_host_skill_discovery","unified_exec","view_image"] as const`
  - Message shape: `<code>: <reason> · stage <stage> · elapsedMs <n>[ · stderr: <tail>]`; reasons `exit <n>`, `signal <s>`, `timeout <ms>ms`, `aborted`, `spawn <errno>`, `output-limit`.

- [ ] **Step 1: failing tests** `tests/agents/catalogProbe.test.ts`:

```ts
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexCatalog } from "../../src/agents/codexCatalog.js";
import { probeTimeoutMs } from "../../src/agents/catalogProbe.js";
import { readOmpCatalog } from "../../src/agents/ompModels.js";
import type { InstallationV1 } from "../../src/agents/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §4.3, R6; criterion 2): a probe that outlives the caller's deadline
// or abort is killed (its process is gone) and the refusal names the elapsed time and the stage. The old fixed limit was
// 10 s; every deadline here is far below it.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs"), FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
async function omp(models?: Record<string, unknown>) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-probe-")));
  const marker = join(dir, "omp-marker");
  if (models) await writeFile(`${marker}.models.json`, JSON.stringify(models));
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  const installation: InstallationV1 = { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null };
  return { marker, installation };
}
async function codex(catalog?: Record<string, unknown>, toml?: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-probe-codex-")));
  const marker = join(dir, "codex-marker");
  if (catalog) await writeFile(`${marker}.catalog.json`, JSON.stringify(catalog));
  if (toml !== undefined) await writeFile(join(dir, "config.toml"), toml);
  const installation: InstallationV1 = { kind: "codex", command: [process.execPath, FAKE_CODEX, "integration", marker], version: "9.9.9-fake", configDir: dir, timeoutMs: 60_000, killGraceMs: 50, sandbox: "read-only", budgetMode: "soft" };
  return { marker, installation };
}
const gone = async (pid: number) => { for (const until = Date.now() + 3_000; Date.now() < until; await new Promise((r) => setTimeout(r, 25))) { try { process.kill(pid, 0); } catch { return true; } } return false; };
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a rejection"); }, (error: Error) => error);

describe("criterion 2: deadline and abort (spec §4.3)", () => {
  it("kills a hanging omp catalog probe at the caller's deadline and names stage and elapsed time", async () => {
    const w = await omp({ hang: true });
    const started = Date.now();
    const error = await failure(readOmpCatalog(w.installation, { deadline: started + 600 }));
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(error.message).toMatch(/^omp-model-catalog-unavailable: timeout \d+ms · stage timeout · elapsedMs \d+$/);
    expect(Number(/elapsedMs (\d+)/.exec(error.message)![1])).toBeGreaterThanOrEqual(500);
    expect(await gone(Number(await readFile(`${w.marker}.models.pid`, "utf8")))).toBe(true);
  });

  it("kills it when the caller aborts, as stage abort", async () => {
    const w = await omp({ hang: true });
    const controller = new AbortController(); setTimeout(() => controller.abort(), 300);
    const error = await failure(readOmpCatalog(w.installation, { signal: controller.signal }));
    expect(error.message).toMatch(/^omp-model-catalog-unavailable: aborted · stage abort · elapsedMs \d+$/);
    expect(await gone(Number(await readFile(`${w.marker}.models.pid`, "utf8")))).toBe(true);
  });

  it("refuses without spawning when the deadline has already passed", async () => {
    const w = await omp();
    const error = await failure(readOmpCatalog(w.installation, { deadline: Date.now() - 1 }));
    expect(error.message).toMatch(/^omp-model-catalog-unavailable: timeout 0ms · stage timeout · elapsedMs \d+$/);
    await expect(readFile(`${w.marker}.catalog-calls`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("caps the timeout at 30 s and follows a nearer deadline", () => {
    expect(probeTimeoutMs(undefined, 1_000)).toBe(30_000);
    expect(probeTimeoutMs(1_000 + 90_000, 1_000)).toBe(30_000);
    expect(probeTimeoutMs(1_000 + 1_234, 1_000)).toBe(1_234);
    expect(probeTimeoutMs(500, 1_000)).toBe(0);
  });

  it("names exit, stage and the stderr tail last for codex (agent-catalog-unavailable)", async () => {
    const w = await codex({ exitCode: 4, stderr: "no catalog\n" });
    const error = await failure(readCodexCatalog(w.installation, {}));
    expect(error.message).toMatch(/^agent-catalog-unavailable: exit 4 · stage exit · elapsedMs \d+ · stderr: no catalog$/);
  });

  it("names a codex probe past its deadline as stage timeout", async () => {
    const w = await codex({ sleepMs: 5_000 });
    const error = await failure(readCodexCatalog(w.installation, { deadline: Date.now() + 400 }));
    expect(error.message).toMatch(/^agent-catalog-unavailable: timeout \d+ms · stage timeout · elapsedMs \d+$/);
  });
});

describe("codex catalog decode (spec §3, §6.1)", () => {
  it("reads every row with its window and visibility, and the installed tool flags in order", async () => {
    const w = await codex();
    expect(await readCodexCatalog(w.installation, {})).toEqual({
      rows: [
        { selector: "gpt-6-sol", provider: "codex", contextWindow: 272000, maxTokens: null, listed: true },
        { selector: "gpt-6-luna", provider: "codex", contextWindow: 272000, maxTokens: null, listed: true },
        { selector: "gpt-reserve", provider: "codex", contextWindow: 272000, maxTokens: null, listed: false },
      ],
      features: ["apps", "image_generation", "multi_agent", "plugins", "shell_tool", "skip_host_skill_discovery", "unified_exec", "view_image"],
    });
  });

  it("lets config.toml's top-level model_context_window win over the catalog, and ignores one inside a table", async () => {
    expect((await readCodexCatalog((await codex(undefined, "model = \"x\"\nmodel_context_window = 100000\n[profiles.a]\n")).installation, {})).rows[0]!.contextWindow).toBe(100000);
    expect((await readCodexCatalog((await codex(undefined, "[profiles.a]\nmodel_context_window = 100000\n")).installation, {})).rows[0]!.contextWindow).toBe(272000);
  });

  it("refuses malformed rows as stage decode", async () => {
    const w = await codex({ rows: [{ slug: 3 }] });
    expect((await failure(readCodexCatalog(w.installation, {}))).message).toMatch(/^agent-catalog-unavailable: decode · stage decode · elapsedMs \d+$/);
  });
});
```

- [ ] **Step 2: red.** P-2 → `$LOGS/t3-red.log` (load failure: `codexCatalog.js` missing; then after an empty stub, each test
  listed failed).

- [ ] **Step 3: implement.**
  `src/agents/catalogProbe.ts`: move `STDERR_KEEP`, `STDERR_TAIL_BYTES`, `OUTPUT_LIMIT` and `stderrTail` from
  `ompModels.ts:4-22` verbatim (keep the #58 comment), then:

```ts
import { spawn } from "node:child_process";

/** Every-agent requirement chain (Orca spec 2026-10-15 §4.3, R6): the old fixed 10 s became min(caller deadline, 30 s). */
export const PROBE_CAP_MS = 30_000;
export type ProbeStage = "spawn" | "timeout" | "abort" | "exit" | "decode";
export class CatalogProbeError extends Error {
  constructor(readonly stage: ProbeStage, readonly elapsedMs: number, message: string) { super(message); this.name = "CatalogProbeError"; }
}
export function probeTimeoutMs(deadline: number | undefined, now = Date.now()): number {
  return deadline === undefined ? PROBE_CAP_MS : Math.max(0, Math.min(deadline - now, PROBE_CAP_MS));
}
export function probeFailure(code: string, reason: string, stage: ProbeStage, startedAt: number, tail = ""): CatalogProbeError {
  const elapsedMs = Date.now() - startedAt;
  return new CatalogProbeError(stage, elapsedMs, `${code}: ${reason} · stage ${stage} · elapsedMs ${elapsedMs}${tail === "" ? "" : ` · stderr: ${tail}`}`);
}

/** One catalog/feature probe in a private process group; resolves with stdout, or rejects naming why, the stage and the time. */
export function runProbe(code: string, command: string, args: string[], env: NodeJS.ProcessEnv, options: { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
  const startedAt = Date.now();
  if (options.timeoutMs <= 0) return Promise.reject(probeFailure(code, "timeout 0ms", "timeout", startedAt));
  if (options.signal?.aborted) return Promise.reject(probeFailure(code, "aborted", "abort", startedAt));
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let bytes = 0; let stderr: Buffer = Buffer.alloc(0);
    let stopped: { reason: string; stage: ProbeStage } | null = null; let spawnError: NodeJS.ErrnoException | null = null;
    const kill = (reason: string, stage: ProbeStage): void => {
      if (stopped !== null) return; stopped = { reason, stage };
      if (child.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => kill(`timeout ${options.timeoutMs}ms`, "timeout"), options.timeoutMs);
    const onAbort = (): void => kill("aborted", "abort");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > OUTPUT_LIMIT) { kill("output-limit", "decode"); return; } chunks.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => {
      if (chunk.length > OUTPUT_LIMIT) kill("output-limit", "decode");
      stderr = Buffer.concat([stderr, chunk.subarray(Math.max(0, chunk.length - STDERR_KEEP))]);
      if (stderr.length > STDERR_KEEP) stderr = stderr.subarray(stderr.length - STDERR_KEEP);
    });
    child.on("error", (error: NodeJS.ErrnoException) => { spawnError = error; });
    child.on("close", (exit, signal) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
      // Feedback #58: the code stays the message's prefix; the reason comes first, the stderr tail last.
      const failed = stopped ?? (spawnError !== null ? { reason: `spawn ${spawnError.code ?? spawnError.message}`, stage: "spawn" as const }
        : exit === null ? { reason: `signal ${signal ?? "unknown"}`, stage: "exit" as const } : exit !== 0 ? { reason: `exit ${exit}`, stage: "exit" as const } : null);
      if (failed !== null) { reject(probeFailure(code, failed.reason, failed.stage, startedAt, stderrTail(stderr))); return; }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
```

  `src/agents/ompModels.ts`: delete the moved constants/`stderrTail`; replace `runOmpJson` (lines 30-77) with:

```ts
async function runOmpJson(installation: InstallationV1, args: string[], options: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
  const profile = installation.profile as string | null;
  const env: NodeJS.ProcessEnv = { ...process.env, OMP_PROFILE: profile ?? "default" };
  if (installation.configDir !== null) env.PI_CODING_AGENT_DIR = installation.configDir;
  const stdout = await runProbe("omp-model-catalog-unavailable", installation.command[0], ["--no-extensions", "--profile", profile ?? "default", ...args], env, options);
  try { return JSON.parse(stdout) as unknown; } catch { throw new Error("omp-model-catalog-invalid"); }
}
```

  `readOmpCatalog(installation, options: { timeoutMs?: number; deadline?: number; signal?: AbortSignal } = {})` calls
  `runOmpJson(installation, ["models", "--json"], { timeoutMs: options.timeoutMs ?? probeTimeoutMs(options.deadline), signal: options.signal })`;
  `readOmpConfiguredDefault` calls `runOmpJson(installation, [...], { timeoutMs: PROBE_CAP_MS })`. (C58b passes
  `{ timeoutMs: 300 }` and keeps reading `timeout 300ms` first.)

  `src/agents/codexCatalog.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { probeFailure, probeTimeoutMs, runProbe } from "./catalogProbe.js";
import type { CatalogRowV1, InstallationV1 } from "./types.js";

/** Spec 2026-10-15 §2.4/§6.1: the tool flags a codex single call turns off, plus skip_host_skill_discovery (turned on). */
export const CODEX_SINGLE_CALL_FEATURES = ["apps", "image_generation", "multi_agent", "plugins", "shell_tool", "skip_host_skill_discovery", "unified_exec", "view_image"] as const;
const CODE = "agent-catalog-unavailable";
const positiveSafe = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

/** §6.1 "Window": a top-level `model_context_window = <n>` before the first `[table]` wins over the catalog. */
function configuredWindow(toml: string): number | null {
  const head = toml.split(/^\s*\[/m, 1)[0]!;
  const match = /^\s*model_context_window\s*=\s*(\d+)\s*(?:#.*)?$/m.exec(head);
  return match === null ? null : positiveSafe(Number(match[1]));
}

export async function readCodexCatalog(installation: InstallationV1, options: { deadline?: number; signal?: AbortSignal }): Promise<{ rows: CatalogRowV1[]; features: string[] }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(installation.configDir === null ? {} : { CODEX_HOME: installation.configDir }) };
  const deadline = options.deadline ?? Date.now() + 30_000;
  const startedAt = Date.now();
  const models = await runProbe(CODE, installation.command[0], [...installation.command.slice(1), "debug", "models"], env, { timeoutMs: probeTimeoutMs(deadline), signal: options.signal });
  let rows: CatalogRowV1[];
  try {
    const parsed = JSON.parse(models) as { models?: unknown };
    if (!Array.isArray(parsed.models)) throw new Error();
    rows = parsed.models.map((row) => {
      const value = row as Record<string, unknown>;
      if (typeof value.slug !== "string" || value.slug.length === 0 || value.slug.length > 200 || (value.visibility !== "list" && value.visibility !== "hide")) throw new Error();
      return { selector: value.slug, provider: "codex", contextWindow: positiveSafe(value.context_window), maxTokens: null, listed: value.visibility === "list" };
    });
    if (new Set(rows.map((row) => row.selector)).size !== rows.length) throw new Error();
  } catch { throw probeFailure(CODE, "decode", "decode", startedAt); }
  const codexHome = installation.configDir ?? env.CODEX_HOME ?? (env.HOME ? join(env.HOME, ".codex") : null);
  const window = codexHome === null ? null : await readFile(join(codexHome, "config.toml"), "utf8").then(configuredWindow, () => null);
  if (window !== null) rows = rows.map((row) => ({ ...row, contextWindow: window }));
  const listed = await runProbe(CODE, installation.command[0], [...installation.command.slice(1), "features", "list"], env, { timeoutMs: probeTimeoutMs(deadline), signal: options.signal });
  const names = new Set(listed.split("\n").map((line) => /^([a-z0-9_.]+)\s/.exec(line)?.[1]).filter((name): name is string => name !== undefined));
  return { rows, features: CODEX_SINGLE_CALL_FEATURES.filter((name) => names.has(name)) };
}
```

  `src/agents/materialize.ts:25`: `probeVersion(command, options: { timeoutMs?: number; signal?: AbortSignal } = {})`;
  inside, `options.signal?.addEventListener("abort", abortTree, { once: true })` and remove it in `finish`.

- [ ] **Step 4: green.** P-2 `tests/agents/catalogProbe.test.ts tests/agents/ompCatalogDiagnostics.test.ts tests/agents/ompCatalog.test.ts tests/runtime/omp tests/agents/materialize.test.ts`
  → `$LOGS/t3-green.log`; RC=0; C58a-c pass **unchanged** (`git diff --stat -- tests/agents/ompCatalogDiagnostics.test.ts` empty).

- [ ] **Step 5: mutations.** M3.1 `const onAbort = (): void => kill("aborted", "abort");` → `const onAbort = (): void => undefined;`
  ⇒ red "kills it when the caller aborts". M3.2 `try { process.kill(-child.pid, "SIGKILL"); }` → `try { child.kill("SIGTERM"); }`
  ⇒ red on `gone(pid)` in the deadline test (the shell wrapper dies, the node child keeps the pid) -- record if green
  (then the wrapper `exec`s and the guard is redundant for this fixture; register, do not invent). M3.3 in
  `probeTimeoutMs` `Math.min(deadline - now, PROBE_CAP_MS)` → `PROBE_CAP_MS` ⇒ red "caps the timeout..." and the deadline
  test (elapsed < 3000). M3.4 `if (options.timeoutMs <= 0) return Promise.reject(...)` deleted ⇒ red "refuses without
  spawning". M3.5 `if (window !== null) rows = ...` → `if (false) rows = ...` ⇒ red "lets config.toml's...". M3.6
  `CODEX_SINGLE_CALL_FEATURES.filter((name) => names.has(name))` → `[...CODEX_SINGLE_CALL_FEATURES]` ⇒ survives with the
  default fake (all listed); add the observation and **add** a test whose fake lists only `apps` (write it as
  `<marker>.catalog.json` cannot do this -- the fake's flag list is fixed, so record M3.6 as needing Task 8's
  unknown-flag criterion C8.4 and re-run it there).

- [ ] **Step 6: commit** `src/agents/catalogProbe.ts src/agents/codexCatalog.ts src/agents/ompModels.ts src/agents/materialize.ts tests/agents/catalogProbe.test.ts`,
  subject `feat(agents): catalog probes honour the caller's deadline and abort and name their stage`.

---

## Task 4: One reader for every catalog and version read (ccloop, spec §4.1, R4/R6/R8; criterion 1)

**Files:**
- Create: `src/agents/agentCatalog.ts`, `tests/setup/relocateCatalogCache.ts`
- Modify: `vitest.config.ts:7` (setupFiles), `src/agents/materialize.ts:88-143`, `src/agents/updates.ts:139-144`,
  `src/runtime/omp/ompSingleCall.ts:36-42`
- Test: `tests/agents/agentCatalog.test.ts`

**Interfaces:**
- Consumes: Tasks 2-3.
- Produces:
  - `export interface AgentCatalogV1 { source: "cache" | "probe"; observedAt: string; version: string | null; rows: CatalogRowV1[] | null; codexFeatures: string[] | null; catalogError: string | null }`
  - `export async function readAgentCatalog(installation: InstallationV1, options?: { deadline?: number; signal?: AbortSignal; refresh?: boolean; env?: NodeJS.ProcessEnv; log?: (line: string) => void; now?: () => number }): Promise<AgentCatalogV1>`
  - `resolveAgent(table, partial, deps: { probeVersion?; probeModels?; probeCatalog?; deadline?: number; signal?: AbortSignal })`

- [ ] **Step 1: setup file** `tests/setup/relocateCatalogCache.ts` (listed **after** `scopeTmpdir.ts` in `vitest.config.ts`):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every-agent requirement chain (Orca spec 2026-10-15 §4.2): every test file, and every process it spawns, caches agent
 * catalogs under this file's scoped TMPDIR (scopeTmpdir.ts removes it), never in the person's ~/.cache.
 */
process.env.CCLOOP_CACHE_DIR = mkdtempSync(join(tmpdir(), "ccache-"));
```

- [ ] **Step 2: failing tests** `tests/agents/agentCatalog.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentCatalog } from "../../src/agents/agentCatalog.js";
import { runControlCommand } from "../../src/control/command.js";
import { acceptStart } from "../../src/control/accept.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import { codexInstallation, singleCallEnvelope, writeAgentsTable } from "../control/agentsFixture.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §4.1, R4; criterion 1): with a warm cache, capabilities and accept
// for an omp or codex selection spawn no catalog and no version process -- read from the fakes' own counts.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs"), FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
const count = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").length : 0);
async function table() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agent-catalog-")));
  const ompMarker = join(dir, "omp-marker"), codexMarker = join(dir, "codex-marker");
  const omp = join(dir, "omp");
  await writeFile(omp, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${ompMarker}' "$@"\n`, { mode: 0o700 });
  const codex = await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", codexMarker], sandbox: "read-only", budgetMode: "soft", timeoutMs: 60_000, killGraceMs: 100 });
  const written = await writeAgentsTable({
    omp: { kind: "omp", command: [omp], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
    codex,
  }, dir);
  return { dir, ...written, ompMarker, codexMarker };
}
const spawns = (marker: string) => count(`${marker}.catalog-calls`) + count(`${marker}.version-calls`);

describe("criterion 1: a warm cache spawns nothing (spec §4.1)", { timeout: 30_000 }, () => {
  it("capabilities for omp and codex probe once, then never again", async () => {
    const t = await table();
    for (const agent of ["omp", "codex"]) {
      expect((await runControlCommand(["capabilities", "--agents", t.path], JSON.stringify({ agent: { agent } }))).code).toBe(0);
    }
    const warm = [spawns(t.ompMarker), spawns(t.codexMarker)];
    // omp 2 = 1 version + 1 models; codex 4 = 1 version by codexInstallation (agentsFixture.ts:28-41) + 1 version + debug-models + features-list.
    expect(warm).toEqual([2, 4]);
    for (const agent of ["omp", "codex", "omp", "codex"]) {
      expect((await runControlCommand(["capabilities", "--agents", t.path], JSON.stringify({ agent: { agent } }))).code).toBe(0);
    }
    expect([spawns(t.ompMarker), spawns(t.codexMarker)]).toEqual(warm);
  });

  // codex joins this loop in Task 6 (only-add), once codex answers v1-soft and accept admits its single-call work.
  it("accept for omp probes nothing on a warm key", async () => {
    const t = await table();
    for (const agent of ["omp"] as const) {
      const { resolution } = await resolveAgent(t.table, { agent });
      const before = spawns(agent === "omp" ? t.ompMarker : t.codexMarker);
      const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agent-catalog-accept-")));
      const status = await acceptStart(singleCallEnvelope({ sourceDir, agent: resolution.selection, configHash: resolution.configHash }), {
        agentsTablePath: t.path, workerCommand: [resolve("node_modules/.bin/tsx"), resolve("tests/fixtures/control-worker.mjs")], receiptTimeoutMs: 2_000,
      });
      expect(status.kind).toBe("accepted");
      expect(spawns(agent === "omp" ? t.ompMarker : t.codexMarker)).toBe(before);
    }
  });

  it("refresh skips the read, probes, and rewrites", async () => {
    const t = await table();
    const installation = t.table.installations.omp!;
    expect((await readAgentCatalog(installation)).source).toBe("probe");
    expect((await readAgentCatalog(installation)).source).toBe("cache");
    expect((await readAgentCatalog(installation, { refresh: true })).source).toBe("probe");
    expect(count(`${t.ompMarker}.catalog-calls`)).toBe(2);
  });

  it("does not write an entry when a probe failed, and reports the omp failure as catalogError", async () => {
    const t = await table();
    await writeFile(`${t.ompMarker}.models.json`, JSON.stringify({ exitCode: 3, stderr: "boom\n" }));
    const answer = await readAgentCatalog(t.table.installations.omp!, { env: { ...process.env, CCLOOP_CACHE_DIR: join(t.dir, "cache") } });
    expect(answer.catalogError).toMatch(/^omp-model-catalog-unavailable: exit 3 · stage exit · elapsedMs \d+ · stderr: boom$/);
    expect(existsSync(join(t.dir, "cache"))).toBe(false);
  });

  it("writes under a relocated HOME's default path only when CCLOOP_CACHE_DIR and XDG_CACHE_HOME are unset (§4.2)", async () => {
    const t = await table();
    const home = join(t.dir, "home");
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR };
    const run = spawnSync(process.execPath, [resolve("dist/cli.js"), "control", "capabilities", "--agents", t.path], { input: JSON.stringify({ agent: { agent: "omp" } }), env, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect((await readdir(join(home, ".cache", "ccloop", "agent-catalog"))).length).toBe(1);
    const redirected = join(t.dir, "redirected");
    const again = spawnSync(process.execPath, [resolve("dist/cli.js"), "control", "capabilities", "--agents", t.path], { input: JSON.stringify({ agent: { agent: "codex" } }), env: { ...env, CCLOOP_CACHE_DIR: redirected }, encoding: "utf8" });
    expect(again.status, again.stderr).toBe(0);
    expect((await readdir(join(home, ".cache", "ccloop", "agent-catalog"))).length).toBe(1);
    expect((await readdir(redirected)).length).toBe(1);
  });

  it("reads the omp spawn-time re-check through the cache (R8)", async () => {
    const t = await table();
    await readAgentCatalog(t.table.installations.omp!);
    const before = count(`${t.ompMarker}.catalog-calls`);
    const { runOmpSingleCall } = await import("../../src/runtime/omp/ompSingleCall.js");
    const runDir = join(t.dir, "run"), cwd = join(runDir, "cwd");
    await (await import("node:fs/promises")).mkdir(cwd, { recursive: true, mode: 0o700 });
    const config = { schema: "ccloop-agent-config-v1" as const, kind: "omp", installation: t.table.installations.omp!, selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" as const } };
    await runOmpSingleCall(config, { prompt: "p", responseSchema: { type: "object" }, maxOutputTokens: 8192, cwd, runDir, timeoutMs: 30_000 });
    expect(count(`${t.ompMarker}.catalog-calls`)).toBe(before);
  });
});
```

  Note for the implementer: `[2, 4]` is arithmetic from reading the code, not a measurement; if the green run shows other
  counts, find out why before changing the literal (an extra spawn is exactly what this criterion exists to catch). The
  criterion proper is the second `toEqual(warm)`.

- [ ] **Step 3: red.** `( cd "$CL" && npm run build )` then P-2 `tests/agents/agentCatalog.test.ts` → `$LOGS/t4-red.log`.

- [ ] **Step 4: implement** `src/agents/agentCatalog.ts`:

```ts
import { catalogCacheDir, catalogKey, entryFileName, readCatalogEntry, writeCatalogEntry } from "./catalogCache.js";
import { PROBE_CAP_MS, probeTimeoutMs } from "./catalogProbe.js";
import { readCodexCatalog } from "./codexCatalog.js";
import { probeVersion } from "./materialize.js";
import { readOmpCatalog } from "./ompModels.js";
import type { CatalogRowV1, InstallationV1 } from "./types.js";

/**
 * Every-agent requirement chain (Orca spec 2026-10-15 §4.1, R4/R6/R8): every catalog and version read goes through here.
 * A hit within 30 minutes answers without spawning; a miss probes `--version` and, for omp and codex, the catalog, under
 * one deadline (the caller's, else 30 s from now), and writes an entry only when every probe answered.
 */
export interface AgentCatalogV1 {
  source: "cache" | "probe"; observedAt: string; version: string | null;
  rows: CatalogRowV1[] | null; codexFeatures: string[] | null; catalogError: string | null;
}
export interface ReadAgentCatalogOptions {
  deadline?: number; signal?: AbortSignal; refresh?: boolean; env?: NodeJS.ProcessEnv; log?: (line: string) => void; now?: () => number;
}

export async function readAgentCatalog(installation: InstallationV1, options: ReadAgentCatalogOptions = {}): Promise<AgentCatalogV1> {
  const env = options.env ?? process.env, now = options.now ?? Date.now, log = options.log ?? (() => undefined);
  const deadline = options.deadline ?? now() + PROBE_CAP_MS;
  const dir = catalogCacheDir(env);
  const key = await catalogKey(installation, env);
  if (dir !== null && options.refresh !== true) {
    const hit = await readCatalogEntry(dir, key, now());
    if (hit !== null) return { source: "cache", observedAt: hit.observedAt, version: hit.version, rows: hit.rows, codexFeatures: hit.codexFeatures, catalogError: null };
    log(`ccloop-agent-catalog: miss ${installation.kind} ${entryFileName(key).slice(0, 12)}`);
  }
  const version = await probeVersion(installation.command, { timeoutMs: Math.min(10_000, probeTimeoutMs(deadline, now())), signal: options.signal });
  let rows: CatalogRowV1[] | null = null, codexFeatures: string[] | null = null, catalogError: string | null = null;
  try {
    if (installation.kind === "omp") rows = await readOmpCatalog(installation, { deadline, signal: options.signal });
    else if (installation.kind === "codex") ({ rows, features: codexFeatures } = await readCodexCatalog(installation, { deadline, signal: options.signal }));
  } catch (error) {
    catalogError = error instanceof Error ? error.message : String(error);
    log(`ccloop-agent-catalog: probe-failed ${installation.kind} ${catalogError}`);
  }
  const observedAt = new Date(now()).toISOString();
  if (dir !== null && version !== null && catalogError === null) {
    await writeCatalogEntry(dir, { schema: "ccloop-agent-catalog-v1", key, observedAt, version, rows, codexFeatures });
  }
  return { source: "probe", observedAt, version, rows, codexFeatures, catalogError };
}
```

  (If the human rejects caching the version -- spec issue 8 -- the hit branch re-probes `version` and only `rows` /
  `codexFeatures` come from the entry.)

  `src/agents/materialize.ts` `resolveAgent` (lines 88-143): add `deadline?: number; signal?: AbortSignal` to `deps`;
  after `descriptor.validateSelection(selection)`:

```ts
  // Every-agent requirement chain (Orca spec 2026-10-15 §4.1): without injected probes, the version and the catalog come
  // through the file cache under one deadline (spec issue 4); injected probes keep the uncached path older criteria use.
  const injected = deps.probeVersion !== undefined || deps.probeModels !== undefined || deps.probeCatalog !== undefined;
  const catalog = injected ? null : await readAgentCatalog(installation, { deadline: deps.deadline, signal: deps.signal });
  const observed = catalog !== null ? catalog.version : await (deps.probeVersion ?? probeVersion)(installation.command);
```

  keep lines 110-119 unchanged; in the omp block, when `catalog !== null`, throw `new Error(catalog.catalogError)` if it is
  non-null, else take `catalog.rows!`; otherwise keep the existing injected/uncached expression (write it as an `if`
  chain). (The codex row line is Task 6's.)

  `src/agents/updates.ts:142`: `const answer = await readAgentCatalog(installation); if (answer.catalogError !== null) return "omp-frozen-model-unavailable"; return answer.rows!.some((row) => row.selector === installation.defaultModel) ? undefined : "omp-frozen-model-unavailable";`
  (inside the existing try). Delete the now-unused `readOmpModels` import only if the typechecker says it is unused.

  `src/runtime/omp/ompSingleCall.ts:37-39`:

```ts
  // Every-agent requirement chain (Orca spec 2026-10-15 §4.1, §4.3, R6, R8): the re-check reads through the same cache key
  // and the call's own deadline and signal; a provider-side cap change without a config change is the accepted risk.
  const catalog = await readAgentCatalog(config.installation, { deadline: Date.now() + Math.min(request.timeoutMs, config.installation.timeoutMs), signal: request.signal });
  if (catalog.catalogError !== null || catalog.rows === null) throw new OmpSingleCallRefused("omp-single-call-unavailable", `catalog ${catalog.catalogError ?? "absent"}`);
  const rows: CatalogRowV1[] = catalog.rows;
```

  The published comment block at `ompSingleCall.ts:32-35` ("re-reads the selected catalog row immediately before
  spawning") gets an appended ERRATUM line (ccloop Rule 16): `*** ERRATUM (Orca spec 2026-10-15 §4.1, R8) -- "re-reads"
  now reads through the catalog cache (30-minute lifetime, config-stamped key); a cap raised on the provider side without
  a config change is not seen until the entry expires. ***`

- [ ] **Step 5: green, then the whole agents/control/runtime dirs.** `npm run build`; P-2
  `tests/agents tests/control tests/runtime` → `$LOGS/t4-green.log`; RC must be 0 (no resolution answer changes in this
  task: codex rows reach resolution only in Task 6). Any red: stop and diagnose; do not edit a criterion.

- [ ] **Step 6: mutations.** M4.1 `if (hit !== null) return {...}` → `if (false) return {...}` ⇒ red criterion 1 (both
  tests). M4.2 `options.refresh !== true` → `true` ⇒ red "refresh skips the read". M4.3
  `&& catalogError === null` deleted ⇒ red "does not write an entry when a probe failed". M4.4 in `ompSingleCall.ts`
  replace the new call with the old `readOmpCatalog(config.installation)` ⇒ red "reads the omp spawn-time re-check through
  the cache". M4.5 in `materialize.ts` `injected ? null : await readAgentCatalog(...)` → `null` ⇒ red criterion 1.
  M4.6 delete the setup file line in `vitest.config.ts` and run `tests/agents/agentCatalog.test.ts` with
  `HOME=$M/fakehome` ⇒ the default path appears under `$M/fakehome/.cache` (assert by `ls`, recorded; this mutation
  proves the setup file is what redirects).

- [ ] **Step 7: commit** `src/agents/agentCatalog.ts src/agents/materialize.ts src/agents/updates.ts src/runtime/omp/ompSingleCall.ts tests/setup/relocateCatalogCache.ts vitest.config.ts tests/agents/agentCatalog.test.ts`,
  subject `feat(agents): read every catalog and version through the file cache`.

---

## Task 5: `control models` and `ccloop agents models` (ccloop, part A, spec §3)

**Files:**
- Create: `src/agents/models.ts`
- Modify: `src/control/protocol.ts:9-27,132-150,152-162,291-310`; `src/control/command.ts:195-214,247-291,293-318`;
  `src/agents/command.ts:24-54`
- Test: `tests/control/modelsControl.test.ts`

**Interfaces:**
- Produces:
  - `export interface AgentModelV1 { model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }`
  - `export interface AgentModelsV1 { schema: "ccloop-models-v1"; installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: AgentModelV1[] }`
  - `export async function listAgentModels(tablePath: string, installationId: string, options?: { refresh?: boolean; log?: (line: string) => void }): Promise<AgentModelsV1>`
  - wire: `ccloop control models --agents <table>`, stdin `{"installation":"<id>","refresh":false}`; CLI `ccloop agents models --agents <table> --installation <id> [--refresh]`.

- [ ] **Step 1: failing tests** `tests/control/modelsControl.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentsCommand } from "../../src/agents/command.js";
import { runControlCommand } from "../../src/control/command.js";
import { claudeInstallation, codexInstallation, FAKE_CLAUDE_CLI, writeAgentsTable } from "./agentsFixture.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §3, part A): one installation's models, sorted by model in code-unit
// order; codex lists only `list` rows; claude has no catalog command and answers none.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs"), FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
async function world() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-models-")));
  const ompMarker = join(dir, "omp-marker"), codexMarker = join(dir, "codex-marker");
  await writeFile(`${ompMarker}.catalog.json`, JSON.stringify([
    { provider: "openrouter", kind: "chat", id: "z", selector: "openrouter/z", contextWindow: 64000, maxTokens: 4096 },
    { provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 },
    { provider: "gateway", kind: "chat", id: "B", selector: "gateway/B", contextWindow: 128000 },
  ]));
  const omp = join(dir, "omp");
  await writeFile(omp, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${ompMarker}' "$@"\n`, { mode: 0o700 });
  const script = join(dir, "script.json"); await writeFile(script, "{}\n", { mode: 0o600 });
  const t = await writeAgentsTable({
    omp: { kind: "omp", command: [omp], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
    codex: await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", codexMarker], sandbox: "read-only", budgetMode: "soft", timeoutMs: 60_000, killGraceMs: 100 }),
    claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", join(dir, "claude-marker"), script]),
  }, dir);
  return { dir, ...t, ompMarker, codexMarker };
}
const models = (path: string, installation: string, refresh = false) => runControlCommand(["models", "--agents", path], JSON.stringify({ installation, refresh }));

describe("control models (spec §3)", { timeout: 30_000 }, () => {
  it("answers omp's rows sorted in code-unit order with window, cap and single-call answer", async () => {
    const w = await world();
    const answer = await models(w.path, "omp");
    expect(answer.code, answer.stderr).toBe(0);
    expect(JSON.parse(answer.stdout)).toMatchObject({ schema: "ccloop-models-v1", installation: "omp", kind: "omp", source: "probe", models: [
      { model: "gateway/B", contextWindowTokens: 128000, maxOutputTokens: null, singleCallExecution: null },
      { model: "gateway/model-a", contextWindowTokens: 200000, maxOutputTokens: 8192, singleCallExecution: "v1" },
      { model: "openrouter/z", contextWindowTokens: 64000, maxOutputTokens: 4096, singleCallExecution: null },
    ] });
    expect(JSON.parse((await models(w.path, "omp")).stdout).source).toBe("cache");
  });

  it("answers codex's listed rows only, each v1-soft with no output cap", async () => {
    const w = await world();
    expect(JSON.parse((await models(w.path, "codex")).stdout).models).toEqual([
      { model: "gpt-6-luna", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
      { model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
    ]);
  });

  it("answers claude with no models and source none, spawning nothing", async () => {
    const w = await world();
    expect(JSON.parse((await models(w.path, "claude")).stdout)).toEqual({ schema: "ccloop-models-v1", installation: "claude", kind: "claude", source: "none", observedAt: null, models: [] });
  });

  it("refresh probes again", async () => {
    const w = await world();
    await models(w.path, "omp"); await models(w.path, "omp", true);
    expect(readFileSync(`${w.ompMarker}.catalog-calls`, "utf8").trim().split("\n")).toEqual(["models", "models"]);
  });

  it("names a missing installation with exit 2 (RF5) and a catalog failure with exit 1 and the kind's code", async () => {
    const w = await world();
    expect(await models(w.path, "gone")).toEqual({ code: 2, stdout: "", stderr: "agent-installation-missing: gone\n" });
    await writeFile(join(w.dir, "codex-marker.catalog.json"), JSON.stringify({ exitCode: 5 }));
    const failed = await models(w.path, "codex");
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(/^agent-catalog-unavailable: exit 5 · stage exit · elapsedMs \d+\n$/);
  });

  it("refuses a request without a boolean refresh", async () => {
    const w = await world();
    expect(await runControlCommand(["models", "--agents", w.path], JSON.stringify({ installation: "omp" }))).toMatchObject({ code: 2, stderr: "control-request-invalid\n" });
  });

  it("prints the same answer from `ccloop agents models`, and logs a miss on stderr", async () => {
    const w = await world();
    const cli = await runAgentsCommand(["models", "--agents", w.path, "--installation", "codex"]);
    expect(cli.code, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout).models.map((row: { model: string }) => row.model)).toEqual(["gpt-6-luna", "gpt-6-sol"]);
    expect(existsSync(`${w.codexMarker}.catalog-calls`)).toBe(true);
  });
});
```

- [ ] **Step 2: red.** P-2 → `$LOGS/t5-red.log` (expected: every test red with `control-command-invalid`).

- [ ] **Step 3: implement.** `src/agents/models.ts`:

```ts
import { readAgentCatalog } from "./agentCatalog.js";
import { ompSingleCallExecution } from "./ompModels.js";
import { readAgentsTable } from "./table.js";
import { AgentError } from "./types.js";

/** Every-agent requirement chain (Orca spec 2026-10-15 §3, part A): one installation's models, for Orca's drop-down. */
export interface AgentModelV1 { model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }
export interface AgentModelsV1 { schema: "ccloop-models-v1"; installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: AgentModelV1[] }

export async function listAgentModels(tablePath: string, id: string, options: { refresh?: boolean; log?: (line: string) => void } = {}): Promise<AgentModelsV1> {
  const table = await readAgentsTable(tablePath);
  const installation = Object.hasOwn(table.installations, id) ? table.installations[id] : undefined;
  if (installation === undefined) throw new AgentError("agent-installation-missing", id);
  const empty: AgentModelsV1 = { schema: "ccloop-models-v1", installation: id, kind: installation.kind, source: "none", observedAt: null, models: [] };
  if (installation.kind !== "omp" && installation.kind !== "codex") return empty;
  const catalog = await readAgentCatalog(installation, { refresh: options.refresh, log: options.log });
  if (catalog.catalogError !== null || catalog.rows === null) throw new Error(catalog.catalogError ?? "agent-catalog-unavailable: no rows");
  const codex = installation.kind === "codex";
  const models = catalog.rows.filter((row) => !codex || row.listed === true).map((row): AgentModelV1 => ({
    model: row.selector, contextWindowTokens: row.contextWindow, maxOutputTokens: codex ? null : row.maxTokens,
    singleCallExecution: codex ? "v1-soft" : ompSingleCallExecution(row),
  })).sort((left, right) => (left.model < right.model ? -1 : left.model > right.model ? 1 : 0));
  return { ...empty, source: catalog.source, observedAt: catalog.observedAt, models };
}
```

  `src/control/protocol.ts`: add `| "models"` to `ControlMethodV1` (after `"capabilities"`), `| { method: "models"; installation: string; refresh: boolean }`
  to `ControlRequestV1`, `| { installation: string; refresh: boolean }` to `ControlPayloadV1`, and
  `models: z.object({ installation: idSchema, refresh: z.boolean() }).strict(),` to `payloadSchemas` (the default branch of
  `attachControlMethod` already spreads it). `src/control/command.ts`: add `"models"` to `METHODS`; in `defaultHandler`
  `if (request.method === "models") return await listAgentModels(context.agentsTablePath, request.installation, { refresh: request.refresh });`;
  add the response schema and its `validateResponse` line:

```ts
// Every-agent requirement chain (Orca spec 2026-10-15 §3): refused here rather than printed for Orca to refuse whole.
const modelsSchema = z.object({
  schema: z.literal("ccloop-models-v1"), installation: z.string().min(1), kind: z.string().min(1), source: z.enum(["cache", "probe", "none"]),
  observedAt: z.string().datetime().nullable(),
  models: z.array(z.object({ model: z.string().min(1).max(200), contextWindowTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(), singleCallExecution: z.enum(["v1", "v1-soft"]).nullable() }).strict()),
}).strict();
```

  `src/agents/command.ts`: a `models` branch before `throw new AgentError("agents-command-invalid")`, parsing exactly
  `--agents <table> --installation <id> [--refresh]` (any other shape ⇒ `agents-command-invalid`), calling
  `listAgentModels(table, id, { refresh, log: (line) => process.stderr.write(\`${line}\n\`) })`, printing the JSON; update
  the doc comment at line 24 to name the new verb (it is this function's own comment; additive sentence, not an edit of
  published text -- append it as a new line).

- [ ] **Step 4: green.** P-2 `tests/control/modelsControl.test.ts tests/control/command.test.ts tests/control/protocol.test.ts tests/agents/command.test.ts` → `$LOGS/t5-green.log`; RC=0.

- [ ] **Step 5: mutations.** M5.1 `!codex || row.listed === true` → `true` ⇒ red "codex's listed rows only". M5.2 the sort
  comparator → `0` ⇒ red "sorted in code-unit order". M5.3 `if (installation.kind !== "omp" && installation.kind !== "codex") return empty;`
  deleted ⇒ red "claude ... source none" (claude has no catalog: answer would be `source: "probe"`). M5.4 in `modelsSchema`
  `.strict()` of the row → removed and a stray key added in `listAgentModels` (`{ ...row, extra: 1 }`) ⇒ only red when
  strict; record. M5.5 `refresh: request.refresh` → `refresh: false` ⇒ red "refresh probes again".

- [ ] **Step 6: commit** `src/agents/models.ts src/control/protocol.ts src/control/command.ts src/agents/command.ts tests/control/modelsControl.test.ts`,
  subject `feat(control): list an installation's models (control models, agents models)`.

---

## Task 6: Codex resolves `"v1-soft"` with its catalog window (ccloop, part D resolution, spec §6.1; criterion 3 codex half)

**Files:**
- Modify: `src/agents/codex.ts:41-60`, `src/agents/registry.ts:46`, `src/agents/types.ts:51`, `src/control/command.ts:97`
- Test: `tests/agents/codexResolution.test.ts`
- Rewrite (only after the human names each): E1 (codex half), E2, E3 in `tests/control/singleCallCapability.test.ts`

**Interfaces:**
- Produces: `AgentResolutionV1.singleCallExecution: "v1" | "v1-soft" | null`; `AgentDescriptor.singleCallExecution(...): "v1" | "v1-soft" | null`.

- [ ] **Step 1: failing tests** `tests/agents/codexResolution.test.ts`:

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { runControlCommand } from "../../src/control/command.js";
import { codexInstallation, writeAgentsTable } from "../control/agentsFixture.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §6.1, R2; criterion 3): codex answers the soft single call and its
// catalog row's window; a model the catalog does not have, or a catalog that cannot be read, answers neither (issue 5).
const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
async function table() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-codex-resolution-")));
  const marker = join(dir, "codex-marker");
  return { dir, marker, ...(await writeAgentsTable({ codex: await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", marker], sandbox: "read-only", budgetMode: "soft", timeoutMs: 60_000, killGraceMs: 100 }) }, dir)) };
}

describe("codex resolution (spec §6.1)", { timeout: 30_000 }, () => {
  it("answers v1-soft, no output cap, and the catalog window for a listed model", async () => {
    const t = await table();
    const { resolution } = await resolveAgent(t.table, { agent: "codex" });
    expect([resolution.selection.model, resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual(["gpt-6-sol", 272000, "v1-soft", null]);
  });
  it("answers the same for a hidden row", async () => {
    const t = await table();
    expect((await resolveAgent(t.table, { agent: "codex", model: "gpt-reserve" })).resolution.singleCallExecution).toBe("v1-soft");
  });
  it("answers null and null for a model with no row, and for an unreadable catalog", async () => {
    const t = await table();
    const absent = (await resolveAgent(t.table, { agent: "codex", model: "not-in-catalog" })).resolution;
    expect([absent.capabilities.contextWindowTokens, absent.singleCallExecution]).toEqual([null, null]);
    await writeFile(`${t.marker}.catalog.json`, JSON.stringify({ exitCode: 3 }));
    const broken = (await resolveAgent(t.table, { agent: "codex", model: "gpt-6-luna" })).resolution;
    expect([broken.capabilities.contextWindowTokens, broken.singleCallExecution]).toEqual([null, null]);
  });
  it("prints v1-soft through control capabilities (the wire enum accepts it)", async () => {
    const t = await table();
    const answer = await runControlCommand(["capabilities", "--agents", t.path], JSON.stringify({ agent: { agent: "codex" } }));
    expect(answer.code, answer.stderr).toBe(0);
    expect(JSON.parse(answer.stdout)).toMatchObject({ singleCallExecution: "v1-soft", singleCallOutputCap: null, capabilities: { contextWindowTokens: 272000 } });
  });
});
```

- [ ] **Step 2: red.** P-2 → `$LOGS/t6-red.log`.

- [ ] **Step 3: implement.** `src/agents/codex.ts`:

```ts
  capabilities(_config, row) {
    return {
      usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      // Every-agent requirement chain (Orca spec 2026-10-15 §6.1): the catalog row's context_window (config.toml's
      // model_context_window wins), not scaled by effective_context_window_percent; no row ⇒ unknown.
      contextWindowTokens: row?.contextWindow ?? null,
      requestBoundProof: null,
    };
  },
  // Orca single-call estimate (2026-09-27), Task 0 item 1 (codex-cli 0.155.1): no config caps the model's output, so a
  // single call cannot be bounded the way spec §4.4 asks.
  // *** ERRATUM (Orca spec 2026-10-15 §6.1, ruling R2) -- the bound is now checked after the fact: codex answers "v1-soft"
  // (one structured call, tools off, output bound not enforced by the CLI) when its catalog row is found. ***
  singleCallExecution(_config, row) {
    return row !== undefined ? "v1-soft" : null;
  },
  // OMP single call (Orca spec 2026-10-14 §3.2): codex runs no single call; nothing to bound.
  // *** ERRATUM (Orca spec 2026-10-15 §6.1) -- codex runs a soft single call; it still has no cap, so this stays null. ***
  singleCallOutputCap() {
    return null;
  },
```

  (The two original comment lines are kept verbatim; the ERRATUM lines are appended -- ccloop Rule 16; check publication
  with `git ls-remote` + `git merge-base --is-ancestor` first and record it.)
  `src/agents/materialize.ts`, after the omp block of `resolveAgent`:

```ts
  // Every-agent requirement chain (Orca spec 2026-10-15 §6.1, plan issue 5): a codex row (any visibility) decides the
  // window and the soft single call; a catalog that could not be read leaves both unknown rather than refusing.
  if (installation.kind === "codex" && catalog !== null && catalog.rows !== null) row = catalog.rows.find((candidate) => candidate.selector === selection.model);
```

  `tests/agents/agentCatalog.test.ts` (only-add, a new `it` beside Task 4's omp accept test): "accept for codex probes
  nothing on a warm key" -- the same body with `agent = "codex"` and `t.codexMarker`.
  `src/agents/registry.ts:46` type → `"v1" | "v1-soft" | null`, and append to the doc comment above it:
  `*** ERRATUM (Orca spec 2026-10-15 §6.1, R2) -- a third answer, "v1-soft": one structured call with tools off whose output bound the CLI cannot enforce (codex); Orca accepts it only in soft estimate mode. ***`
  `src/agents/types.ts:51` type → `"v1" | "v1-soft" | null`. `src/control/command.ts:97` →
  `singleCallExecution: z.enum(["v1", "v1-soft"]).nullable(),`.

- [ ] **Step 4: green + named reds.** P-2 `tests/agents/codexResolution.test.ts tests/control tests/agents` → `$LOGS/t6-green.log`.
  Expected red: exactly E1 (`singleCallCapability.test.ts` C1, codex half), E2, E3. **[HUMAN] Stop and ask the human to
  name E1, E2, E3** (show each assertion and the proposed replacement below). After the yes, rewrite each whole, with the
  comment `Rewritten for the every-agent requirement chain (Orca spec 2026-10-15 §6.1, ruling R2; human named <E#> on <date>): <what it encodes now>.`:
  - E2 (`:48,60`): title `"C1: answers singleCallExecution beside the seven-key view: v1 for claude, v1-soft for codex"`; line 60 →
    `expect(JSON.parse(codex.stdout)).toEqual({ protocol: 3, ...codexResolution, singleCallExecution: "v1-soft" });`
  - E1 codex half (`:59`): `expect(codexResolution.capabilities).toEqual({ ...SEVEN, contextWindowTokens: 272000 });`
    (the claude half is Task 7).
  - E3 (`:70-78`): keep the refusal for a selection without a catalog row:
    `const { resolution } = await resolveAgent(table, { agent: "codex", model: "fixture" });` and title
    `"C3: accept refuses single-call work for an agent that answers null (a codex model the catalog does not list), by name and before anything is persisted"`.
    Add (only-add) `"C3b: accept admits codex single-call work for a catalog model (v1-soft)"` mirroring C4 with
    `{ agent: "codex" }`.

- [ ] **Step 5: mutations.** M6.1 `return row !== undefined ? "v1-soft" : null;` → `return null;` ⇒ red in
  `codexResolution` tests 1, 2, 4 and C3b. M6.2 `contextWindowTokens: row?.contextWindow ?? null,` → `contextWindowTokens: null,`
  ⇒ red test 1 and test 4. M6.3 `z.enum(["v1", "v1-soft"])` → `z.enum(["v1"])` in `command.ts` ⇒ red test 4
  (`control-response-invalid`). M6.4 in `materialize.ts` delete the codex `row = ...` line ⇒ red tests 1, 2.

- [ ] **Step 6: commit** source + `tests/agents/codexResolution.test.ts` + the rewritten `tests/control/singleCallCapability.test.ts`,
  subject `feat(agents): codex resolves a soft single call and its catalog window`; body lists E1-E3 and the human's words.

---

## Task 7: Claude's default window is 200000 (ccloop, part E, spec §7; criterion 3 claude half)

**Files:**
- Modify: `src/agents/claude.ts:60-70`
- Test: `tests/agents/claudeDefaultWindow.test.ts`
- Rewrite (human-named): E1 claude half (`tests/control/singleCallCapability.test.ts:53`), E4
  (`tests/agents/registry.test.ts:81,83`), E5 (`tests/control/agentsControl.test.ts:110`)

- [ ] **Step 1: failing test** `tests/agents/claudeDefaultWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claudeDescriptor } from "../../src/agents/claude.js";
import type { MaterializedAgentConfigV1 } from "../../src/agents/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §2.3, §7, R5): every model in claude-code 2.1.300's built-in table
// has a window of at least 200000, so agent-default reports that lower bound; the verified 1M mapping is unchanged.
const config = (contextWindow: "agent-default" | 1_000_000): MaterializedAgentConfigV1 => ({ schema: "ccloop-agent-config-v1", kind: "claude",
  installation: { kind: "claude", command: ["/opt/claude"], version: "2.1.300", configDir: null, timeoutMs: 1, killGraceMs: 1 },
  selection: { agent: "claude", model: "claude-opus-5-5", contextWindow } });

describe("claude windows (spec §7)", () => {
  it("reports 200000 for agent-default and 1000000 for the 1M selection", () => {
    expect([claudeDescriptor.capabilities(config("agent-default")).contextWindowTokens, claudeDescriptor.capabilities(config(1_000_000)).contextWindowTokens]).toEqual([200000, 1000000]);
  });
});
```

- [ ] **Step 2: red** (P-2 → `$LOGS/t7-red.log`: `null` ≠ `200000`).

- [ ] **Step 3: implement** `src/agents/claude.ts:67-68`:

```ts
      // Spec §12 I6: only a mapping Task 0 verified is reported; "agent-default" stays unknown (null).
      // *** ERRATUM (Orca spec 2026-10-15 §2.3, §7, ruling R5) -- "agent-default" is now reported as 200000: every model in
      // claude-code 2.1.300's built-in model table has a window of at least 200000 (read from the binary, no model called);
      // a native-1M model is under-reported, which only makes input-too-large trip earlier. ***
      contextWindowTokens: config.selection.contextWindow === ONE_MILLION ? ONE_MILLION : 200_000,
```

  Before editing, run the publication check (ccloop Rule 16):
  `/usr/bin/git -C /Users/biran/code/skills/orca/ccloop ls-remote origin refs/heads/main` and
  `/usr/bin/git -C "$CL" merge-base --is-ancestor <commit that added line 67> <remote main sha>; echo $?`; record both.
  Also full-tree scan for prose saying agent-default is unknown/null (Rule 16, list derived from the corrected sentence):
  `/usr/bin/grep -rn 'agent-default.*\(null\|unknown\)' src tests docs README.md > "$LOGS/t7-scan.txt"`; read it; each hit in
  published text gets an ERRATUM, each hit in a test is listed for the human.

- [ ] **Step 4: green + named reds.** P-2 `tests/agents tests/control` → `$LOGS/t7-green.log`; expected red exactly E1
  (claude half), E4, E5. **[HUMAN] name each**; rewrite: E4 title `"reports claude's contextWindowTokens as 200000 for agent-default and 1M for its verified mapping, and codex's as null without a catalog row (omp reads its own from its catalog row)"`,
  line 83 `.toBe(200_000)`; E5 line 110 `capabilities: { contextWindowTokens: 200_000 },`; E1 claude half line 53
  `expect(claudeResolution.capabilities).toEqual({ ...SEVEN, contextWindowTokens: 200000 });` -- each with the
  "Rewritten for ... human named ..." comment.

- [ ] **Step 5: mutation.** M7.1 `: 200_000,` → `: null,` ⇒ red `claudeDefaultWindow` and the three rewritten criteria.

- [ ] **Step 6: commit**, subject `feat(agents): report claude's 200000 default window (ERRATUM on the unknown-window note)`.

---

## Task 8: The codex single call (ccloop, part D adapter, spec §6.1, R2, R9)

**Files:**
- Create: `src/runtime/codex/codexSingleCall.ts`
- Modify: `src/runtime/codex/runCodexPhase.ts:11,28-30,42-44,48`; `src/runtime/codex/codexAdapter.ts:12,36-39` (+ method);
  `src/agents/codex.ts:61-64`; `src/runtime/types.ts:230-234` (append ERRATUM); `tests/fixtures/fake-codex.mjs` (single-call branch)
- Test: `tests/runtime/codex/codexSingleCall.test.ts`, `tests/control/codexSingleCallWorker.test.ts`

**Interfaces:**
- Consumes: `readAgentCatalog` (Task 4), `CODEX_SINGLE_CALL_FEATURES` (Task 3), Task 0's final `ISO` list.
- Produces:
  - `PhaseRequest = { phase: CodexPhase | "single-call"; prompt; context; spawn?: { args: (paths: { schemaPath: string; finalPath: string }) => string[]; env: NodeJS.ProcessEnv; schema: Record<string, unknown> } }`
  - `export const CODEX_SINGLE_CALL_CONFIG: readonly string[]` (Task 0's `-c` values, without `features.*`)
  - `export function codexSingleCallArgs(input: { model: string; cwd: string; schemaPath: string; finalPath: string; features: readonly string[] }): string[]`
  - `export async function codexSingleCallHome(runDir: string, sourceCodexHome: string): Promise<{ home: string; codexHome: string }>`
  - `export function decodeCodexSingleCall(events: string, final: string | null, model: string, evidenceDir: string): SingleCallResult`
  - `CodexAdapterOptions` gains `installation?: InstallationV1`; `CodexAdapter.singleCall(request)`.
  - Error codes: `codex-single-call-not-single:tool|messages|turns` (observed usage booked), `codex-single-call-unavailable` (`neverStarted`, books 0).

- [ ] **Step 1: fake codex single-call branch.** In `tests/fixtures/fake-codex.mjs`'s stdin `end` handler, first lines:

```js
  // Every-agent requirement chain (Orca spec 2026-10-15 §6.1, §9): a single call is the only codex call with
  // --skip-git-repo-check. It records HOME, CODEX_HOME and whether auth.json there is a symlink in <marker>.single-env.json,
  // appends `single-call` to <marker>.calls, then plays <marker>.single.json ({rows?, final?, exitCode?, hang?}) or one
  // complete {"answer":"42"} with usage input 20 (5 cached) and output 4.
  if(args.includes("--skip-git-repo-check")) {
    appendFileSync(marker+".calls","single-call\n");
    let authIsLink=null; try{authIsLink=lstatSync(`${process.env.CODEX_HOME}/auth.json`).isSymbolicLink();}catch{}
    writeFileSync(marker+".single-env.json",JSON.stringify({HOME:process.env.HOME,CODEX_HOME:process.env.CODEX_HOME,authIsLink}));
    const script=existsSync(marker+".single.json")?JSON.parse(readFileSync(marker+".single.json","utf8")):{};
    if(script.hang===true){setInterval(()=>{},1000);return;}
    const rows=script.rows??[{type:"thread.started",thread_id:"t"},{type:"turn.started"},{type:"item.completed",item:{id:"item_0",type:"agent_message",text:"{\"answer\":\"42\"}"}},{type:"turn.completed",usage:{input_tokens:20,cached_input_tokens:5,output_tokens:4}}];
    writeFileSync(value("-o"),script.final??"{\"answer\":\"42\"}");
    process.stdout.write(rows.map(row=>JSON.stringify(row)).join("\n")+"\n",()=>{process.exitCode=script.exitCode??0;});
    return;
  }
```

  (add `lstatSync` to the line-1 import).

- [ ] **Step 2: failing tests** `tests/runtime/codex/codexSingleCall.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codexDescriptor } from "../../../src/agents/codex.js";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { observedTokensOf, SingleCallOutputInvalid } from "../../../src/runtime/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §6.1, R2, R9): one structured codex call with tools off, in a
// private HOME and CODEX_HOME whose auth.json and config.toml are symlinks; decoding fails closed and books what it saw.
const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
async function world(single?: unknown) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-codex-single-")));
  const marker = join(dir, "codex-marker"), codexHome = join(dir, "codex-home");
  await mkdir(codexHome); await writeFile(join(codexHome, "auth.json"), "{}"); await writeFile(join(codexHome, "config.toml"), "");
  if (single !== undefined) await writeFile(`${marker}.single.json`, JSON.stringify(single));
  const config: MaterializedAgentConfigV1 = { schema: "ccloop-agent-config-v1", kind: "codex",
    installation: { kind: "codex", command: [process.execPath, FAKE_CODEX, "integration", marker], version: "9.9.9-fake", configDir: codexHome, timeoutMs: 60_000, killGraceMs: 100, sandbox: "read-only", budgetMode: "soft" },
    selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" } };
  const runDir = join(dir, "run"), cwd = join(runDir, "cwd"); await mkdir(cwd, { recursive: true, mode: 0o700 });
  const adapter = codexDescriptor.createAdapter(config);
  const request = { prompt: "Estimate.", responseSchema: SCHEMA, maxOutputTokens: 4096, cwd, runDir, timeoutMs: 30_000 };
  return { dir, marker, codexHome, adapter, request };
}
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a rejection"); }, (error: unknown) => error);
const lastArgv = (marker: string): string[] => JSON.parse(readFileSync(`${marker}.argv`, "utf8").trim().split("\n").at(-1)!);

describe("codex single call (spec §6.1)", { timeout: 30_000 }, () => {
  it("C8.1: answers the object with the observed usage per model", async () => {
    const w = await world();
    expect(await w.adapter.singleCall!(w.request)).toEqual({ output: { answer: "42" }, tokenUsage: 24, usageEvidence: expect.objectContaining({ normalizedTotal: 24 }),
      modelUsage: [{ model: "gpt-6-sol", input: 15, output: 4, cacheRead: 5, cacheWrite: 0 }] });
    expect(readFileSync(`${w.marker}.calls`, "utf8")).toBe("single-call\n");
  });

  it("C8.2: runs read-only in the empty cwd with every isolation key and the installed tool flags off", async () => {
    const w = await world();
    await w.adapter.singleCall!(w.request);
    const argv = lastArgv(w.marker);
    expect(argv.slice(0, 7)).toEqual(["exec", "--json", "--ephemeral", "--color", "never", "--skip-git-repo-check", "--model"]);
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(argv[argv.indexOf("-C") + 1]).toBe(w.request.cwd);
    const c = argv.flatMap((arg, i) => (arg === "-c" ? [argv[i + 1]!] : []));
    expect(c).toEqual([
      "include_permissions_instructions=false", "include_apps_instructions=false", "include_collaboration_mode_instructions=false",
      "include_environment_context=false", "project_doc_max_bytes=0",
      "features.apps=false", "features.image_generation=false", "features.multi_agent=false", "features.plugins=false",
      "features.shell_tool=false", "features.skip_host_skill_discovery=true", "features.unified_exec=false", "features.view_image=false",
    ]);
    expect(argv.at(-1)).toBe("-");
  });

  it("C8.3: runs in a private HOME and CODEX_HOME whose auth.json and config.toml are symlinks, never copies (R9)", async () => {
    const w = await world();
    await w.adapter.singleCall!(w.request);
    const env = JSON.parse(readFileSync(`${w.marker}.single-env.json`, "utf8")) as { HOME: string; CODEX_HOME: string; authIsLink: boolean };
    expect(env.HOME.startsWith(join(w.request.runDir, "codex", "1", "single-call"))).toBe(true);
    expect(env.CODEX_HOME.startsWith(join(w.request.runDir, "codex", "1", "single-call"))).toBe(true);
    expect(env.authIsLink).toBe(true);
    expect(await readlink(join(env.CODEX_HOME, "config.toml"))).toBe(join(w.codexHome, "config.toml"));
    expect([(await lstat(env.HOME)).mode & 0o777, (await lstat(env.CODEX_HOME)).mode & 0o777]).toEqual([0o700, 0o700]);
  });

  it("C8.4: refuses before spawning, booking 0, when the feature list cannot be read", async () => {
    const w = await world();
    await writeFile(`${w.marker}.catalog.json`, JSON.stringify({ exitCode: 9 }));
    const error = await failure(w.adapter.singleCall!(w.request));
    expect(error).toMatchObject({ code: "codex-single-call-unavailable", neverStarted: true });
    expect(observedTokensOf(error)).toBe(0);
    expect(existsSync(`${w.marker}.calls`)).toBe(false);
  });

  it.each([
    ["tool", [{ type: "item.started", item: { id: "i", type: "command_execution", command: "ls" } }, { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } }], 36],
    ["messages", [{ type: "item.completed", item: { type: "agent_message", text: "{}" } }, { type: "item.completed", item: { type: "agent_message", text: "{\"answer\":\"42\"}" } }, { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } }], 36],
    ["turns", [{ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 1 } }, { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } }], 36],
  ] as const)("C8.5: refuses a call that was not single (%s) and books the usage it saw", async (what, rows, booked) => {
    const w = await world({ rows });
    const error = await failure(w.adapter.singleCall!(w.request));
    expect(error).toMatchObject({ code: `codex-single-call-not-single:${what}` });
    expect(observedTokensOf(error)).toBe(booked);
  });

  it("C8.6: an answer that is not one object is single-call-output-invalid with its usage", async () => {
    const w = await world({ final: "not json" });
    const error = await failure(w.adapter.singleCall!(w.request));
    expect(error).toBeInstanceOf(SingleCallOutputInvalid);
    expect((error as SingleCallOutputInvalid).tokenUsage).toBe(24);
  });

  it("C8.7: an answer over the request's maxOutputTokens is still the answer (R2: the bound is checked after the fact by Orca)", async () => {
    const w = await world({ rows: [{ type: "item.completed", item: { type: "agent_message", text: "{\"answer\":\"42\"}" } }, { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 9000 } }] });
    expect(await w.adapter.singleCall!(w.request)).toMatchObject({ output: { answer: "42" }, tokenUsage: 9020, modelUsage: [{ output: 9000 }] });
  });
});
```

  and `tests/control/codexSingleCallWorker.test.ts`, copying `tests/control/ompSingleCallWorker.test.ts:31-70`'s `world()`
  shape with a codex installation (`[process.execPath, FAKE_CODEX, "integration", marker]`, `configDir` a temp codex home)
  and asserting: complete call ⇒ `booked(events)` = `[["work", 24], ["handoff", 0]]`, record
  `{ outcome: "complete", errorCode: null }`, output `{ answer: "42" }`; a `tool` call ⇒ `[["work", 36], ["handoff", 0]]`,
  record `{ outcome: "failed", errorCode: "codex-single-call-not-single:tool" }`.

- [ ] **Step 3: red.** P-2 both files → `$LOGS/t8-red.log` (`adapter.singleCall` is undefined).

- [ ] **Step 4: implement.** `src/runtime/codex/codexSingleCall.ts`:

```ts
import { chmod, lstat, mkdir, mkdtemp, symlink } from "node:fs/promises";
import { join } from "node:path";
import { parseSingleCallObject } from "../omp/ompSingleCall.js";
import { SingleCallOutputInvalid, type SingleCallResult } from "../types.js";
import { codexModelUsage, decodeCodexUsage, observedTurnUsage } from "./protocol.js";

/** Every-agent requirement chain (Orca spec 2026-10-15 §2.5 last row, §6.1; values from plan Task 0 on codex <version>). */
export const CODEX_SINGLE_CALL_CONFIG: readonly string[] = [
  "include_permissions_instructions=false", "include_apps_instructions=false", "include_collaboration_mode_instructions=false",
  "include_environment_context=false", "project_doc_max_bytes=0",
];
const TURNED_ON = new Set(["skip_host_skill_discovery"]);

export function codexSingleCallArgs(input: { model: string; cwd: string; schemaPath: string; finalPath: string; features: readonly string[] }): string[] {
  return ["exec", "--json", "--ephemeral", "--color", "never", "--skip-git-repo-check", "--model", input.model, "--sandbox", "read-only",
    "-C", input.cwd, "--output-schema", input.schemaPath, "-o", input.finalPath,
    ...CODEX_SINGLE_CALL_CONFIG.flatMap((value) => ["-c", value]),
    ...input.features.flatMap((name) => ["-c", `features.${name}=${TURNED_ON.has(name) ? "true" : "false"}`]),
    "-"];
}

/** R9: a private HOME and CODEX_HOME under the run directory; auth.json and config.toml are symlinked, never copied. */
export async function codexSingleCallHome(runDir: string, sourceCodexHome: string): Promise<{ home: string; codexHome: string }> {
  const root = join(runDir, "codex", "1", "single-call");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const base = await mkdtemp(join(root, "home-"));
  const home = join(base, "home"), codexHome = join(base, "codex-home");
  for (const dir of [home, codexHome]) { await mkdir(dir, { mode: 0o700 }); await chmod(dir, 0o700); }
  for (const name of ["auth.json", "config.toml"]) {
    const source = join(sourceCodexHome, name);
    if (await lstat(source).then(() => true, () => false)) await symlink(source, join(codexHome, name));
  }
  return { home, codexHome };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const notSingle = (what: string, events: string) => Object.assign(new Error(`codex-single-call-not-single:${what}`), { code: `codex-single-call-not-single:${what}`, observedTokens: observedTurnUsage(events) });

/** §6.1, fail closed: no tool or command item, at most one completed agent message, exactly one completed turn, one object. */
export function decodeCodexSingleCall(events: string, final: string | null, model: string, evidenceDir: string): SingleCallResult {
  let messages = 0, turns = 0, tool = false;
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { throw Object.assign(new Error("codex-events-invalid"), { observedTokens: observedTurnUsage(events) }); }
    if (!record(row) || typeof row.type !== "string") throw Object.assign(new Error("codex-events-invalid"), { observedTokens: observedTurnUsage(events) });
    if (row.type.startsWith("item.") && record(row.item) && row.item.type !== "agent_message" && row.item.type !== "reasoning") tool = true;
    if (row.type === "item.completed" && record(row.item) && row.item.type === "agent_message") messages += 1;
    if (row.type === "turn.completed") turns += 1;
  }
  if (tool) throw notSingle("tool", events);
  if (messages > 1) throw notSingle("messages", events);
  if (turns > 1) throw notSingle("turns", events);
  const usage = decodeCodexUsage(events, true);
  const modelUsage = codexModelUsage(events, model);
  const output = final === null ? undefined : parseSingleCallObject(final);
  if (output === undefined) throw new SingleCallOutputInvalid(evidenceDir, usage.tokenUsage, usage.usageEvidence);
  return { output, tokenUsage: usage.tokenUsage, usageEvidence: usage.usageEvidence, ...(modelUsage === null ? {} : { modelUsage }) };
}
```

  `src/runtime/codex/runCodexPhase.ts`: widen `PhaseRequest` (line 11) to the interface above; line 28-30 →
  `const args = request.spawn !== undefined ? [...config.command.slice(1), ...request.spawn.args({ schemaPath, finalPath })] : [<existing array>];`;
  line 42 → `const wireBusinessSchema = request.spawn?.schema ?? (phase === "execute" ? executeWireJsonSchema() : phaseJsonSchema(phase as CodexPhase));`
  (line 43 unchanged: `phase === "execute"` is false for `"single-call"`); line 48 env →
  `env: request.spawn?.env ?? { ...process.env, ...extraEnv }`. Nothing else in the function changes.

  `src/runtime/codex/codexAdapter.ts`: `CodexAdapterOptions` gains `installation?: InstallationV1`; store
  `private readonly installation` in the constructor; add:

```ts
  /**
   * Every-agent requirement chain (Orca spec 2026-10-15 §6.1, R2, R9): one structured call, tools off, in a private HOME and
   * CODEX_HOME. Codex cannot cap the output; the bound is checked by Orca after the fact. Refused before spawning when the
   * installed feature list is unknown, since the tool flags could not be turned off (plan spec issue 9).
   */
  async singleCall(request: SingleCallRequest): Promise<SingleCallResult> {
    if (this.installation === undefined) throw new Error("single-call-unsupported");
    const catalog = await readAgentCatalog(this.installation, { deadline: Date.now() + Math.min(request.timeoutMs, this.config.timeoutMs), signal: request.signal });
    if (catalog.codexFeatures === null) {
      throw Object.assign(new Error(`codex-single-call-unavailable: ${catalog.catalogError ?? "no feature list"}`), { code: "codex-single-call-unavailable", neverStarted: true });
    }
    const features = catalog.codexFeatures;
    const isolated = await codexSingleCallHome(request.runDir, this.extraEnv?.CODEX_HOME ?? join(process.env.HOME ?? "/nonexistent", ".codex"));
    const context = { runDir: request.runDir, attempt: 1, worktreePath: request.cwd, abortSignal: request.signal, onProcessRegistered: request.onProcessRegistered,
      state: { budgetSnapshot: { timeRemainingMs: request.timeoutMs } } } as unknown as AttemptContext;
    const outcome = await runCodexPhase(this.config, { phase: "single-call", prompt: request.prompt, context, spawn: {
      schema: request.responseSchema, env: { ...process.env, HOME: isolated.home, CODEX_HOME: isolated.codexHome },
      args: ({ schemaPath, finalPath }) => codexSingleCallArgs({ model: this.config.model, cwd: request.cwd, schemaPath, finalPath, features }),
    } });
    if (outcome.reason === "aborted") throw new CodexPhaseAborted(outcome.evidenceDir, outcome.observedTokens);
    if (outcome.reason !== "completed") throw Object.assign(new Error(`codex-${outcome.reason}: ${outcome.evidenceDir}`), { observedTokens: outcome.observedTokens });
    return decodeCodexSingleCall(outcome.events, outcome.final, this.config.model, outcome.evidenceDir);
  }
```

  `src/agents/codex.ts:63`: `return new CodexAdapter(toCodexConfig(config), configDir === null ? undefined : { CODEX_HOME: configDir }, options?.codexSkillsDir, { installation: config.installation });`
  `src/runtime/types.ts:230-233`: append to the doc comment `*** ERRATUM (Orca spec 2026-10-15 §6.1) -- codex has it too: its descriptor answers "v1-soft" per catalog row; the adapter refuses again at spawn when the feature list is unknown. ***`

  **Fallback branch (Task 0 said isolation is not workable):** `codexSingleCallHome` is not called; env is
  `{ ...process.env, ...this.extraEnv }`; C8.3 is replaced by a criterion that asserts the env equals the user's
  (`HOME === process.env.HOME`) with the comment "R9 fallback: codex single calls are not reproducible and carry the
  user's skills (Task 0, <date>)"; record it in the ledger and in ccloop's handoff.

- [ ] **Step 5: green.** P-2 the two new files + `tests/runtime/codex tests/control/singleCall.test.ts tests/control/handoffDeadlineUsage.test.ts` → `$LOGS/t8-green.log`; RC=0.

- [ ] **Step 6: mutations.** M8.1 `env: request.spawn?.env ?? {...}` → `env: { ...process.env, ...extraEnv }` ⇒ red C8.3.
  M8.2 `await symlink(source, ...)` → `await copyFile(source, ...)` (import it) ⇒ red C8.3 (`authIsLink`). M8.3
  `if (catalog.codexFeatures === null) {...}` removed (use `features = catalog.codexFeatures ?? []`) ⇒ red C8.4 (and re-run
  M3.6 here: `[...CODEX_SINGLE_CALL_FEATURES]` instead of the filter -- C8.2 stays green with the full fake list; record it
  as covered only by the real codex's "Unknown feature flag" refusal, paid check P1). M8.4 `if (tool) throw ...` deleted ⇒
  red C8.5[tool]. M8.5 `messages > 1` → `messages > 2` ⇒ red C8.5[messages]. M8.6 `turns > 1` → `turns > 2` ⇒ red
  C8.5[turns] (or `decodeCodexUsage(..., true)` catches it first as `codex-conflicting-completion` -- then the guard is
  shadowed; register, do not invent; Orca handoff §6.1 item 8). M8.7 `TURNED_ON.has(name) ? "true" : "false"` → `"false"`
  ⇒ red C8.2. M8.8 `"--sandbox", "read-only"` → `"--sandbox", "workspace-write"` ⇒ red C8.2.

- [ ] **Step 7: commit**, subject `feat(runtime): codex single call, tools off in a private home, bound checked after the fact`.

---

## Task 9: ccloop full gate and ledger

**Files:** ccloop `docs/handoff/handoff.md` (Chinese, live document: roll the "Orca line" section in place per its own
rules); Orca ledger `.superpowers/sdd/2026-10-15-every-agent-chain/progress.md` (created here, `git add -f`, committed in
Task 10's first commit since it lives in Orca).

- [ ] **Step 1: gate in a clone of the branch tip (P-3 clone, no mutation).**

```bash
G="$(mktemp -d /private/tmp/ccg-XXXX)"; /usr/bin/git clone --local -q --branch codex/every-agent-chain "$CL" "$G/repo"
ln -s /Users/biran/code/skills/orca/ccloop/node_modules "$G/repo/node_modules"; cd "$G/repo"
export TMPDIR="$(mktemp -d /private/tmp/cl-XXXX)"; export CCLOOP_CACHE_DIR="$G/cache"
rtk proxy npm run typecheck > "$LOGS/ccg-typecheck.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-typecheck.log"
rtk proxy npm run build > "$LOGS/ccg-build.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-build.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$LOGS/ccg-vitest.json" > "$LOGS/ccg-vitest.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-vitest.log"
node scripts/check-known-reds.mjs "$LOGS/ccg-vitest.json" > "$LOGS/ccg-known-reds.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-known-reds.log"
# verify:control: a fake-only table (fake codex in integration mode), binary = this clone's build
node -e 'const fs=require("fs");const p=process.argv[1];fs.writeFileSync(p,JSON.stringify({schema:"ccloop-agents-table-v1",installations:{codex:{kind:"codex",command:[process.execPath,process.argv[2],"integration",process.argv[3]],version:"9.9.9-fake",configDir:null,timeoutMs:120000,killGraceMs:5000,sandbox:"workspace-write",budgetMode:"soft"}}}),{mode:0o600})' "$G/agents.json" "$G/repo/tests/fixtures/fake-codex.mjs" "$G/codex-marker"
ORCA_CCLOOP_BIN="$G/repo/dist/cli.js" ORCA_AGENTS_TABLE="$G/agents.json" npm run verify:control > "$LOGS/ccg-verify-control.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-verify-control.log"
node scripts/check-tmp-leak.mjs > "$LOGS/ccg-tmpleak.log" 2>&1; echo "RC=$?" >> "$LOGS/ccg-tmpleak.log"
ls -la "$G/cache" > "$LOGS/ccg-cache-dir.txt" 2>&1
```

  Read every log whole. Success = typecheck/build RC 0; `check-known-reds` RC 0 (every red is on the mechanical list) --
  a red not on the list is diagnosed by running its file alone three times (load flakes are classified only that way,
  ccloop handoff); `verify:control` likewise; tmp leak 0. Counts are reported as the tool printed them.

- [ ] **Step 2: ledger + ccloop handoff.** Write the Orca ledger section "ccloop part" (tasks done, commit subjects, each
  mutation and its observed red, the human's named rewrites, Task 0 results, gate counts with commands and the gate commit).
  Roll ccloop `docs/handoff/handoff.md` §"Orca line" in place (that file's rules; keep conclusions), commit on the ccloop
  branch with subject `docs(handoff): every-agent chain ccloop part ready for push`.

- [ ] **Step 3: checkpoint (Rule 10).** State: branch, tip sha, gate result, what waits for the human.

### Checkpoint H1 [HUMAN]: push ccloop

The human, in their own terminal: review `codex/every-agent-chain` in ccloop, merge into `main` with `--ff-only`, push
`main` (Rule 13/15: each a separate nod). The agent then records `git ls-remote origin refs/heads/main` (the 40-hex sha
used by the repin) and does nothing in Orca's `package.json` before that sha is on the remote.

---

## Task 10: Orca worktree, cache redirection for the suite, and R7 (spec §6.3; criterion 7)

**Files:**
- Create: `tests/setup/relocateCcloopCache.ts`, `tests/control/declaredNullWindow.test.ts`
- Modify: `vitest.config.ts:10`, `src/control/profiles.ts:119-122`

- [ ] **Step 1: worktree [HUMAN decides the base].** If the human has merged `codex/round-20261015b`, cut from `main`;
  otherwise from that branch's tip -- ask. Then:

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca worktree add -b codex/every-agent-chain "$OR" <base> > "$LOGS/or-wt.txt" 2>&1
ln -s /Users/biran/code/skills/orca/Orca/node_modules "$OR/node_modules"     # and web/node_modules if the main tree has one; never git add
( cd "$OR" && npm run build --workspace web ) > "$LOGS/or-webbuild.txt" 2>&1; echo "RC=$?" >> "$LOGS/or-webbuild.txt"   # handoff §6.7
B="$(mktemp -d /private/tmp/ccb-XXXX)"; /usr/bin/git clone --local -q --branch main /Users/biran/code/skills/orca/ccloop "$B/repo"
ln -s /Users/biran/code/skills/orca/ccloop/node_modules "$B/repo/node_modules"; ( cd "$B/repo" && npm run build ) > "$LOGS/ccb-build.txt" 2>&1
export ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"     # the pushed ccloop main, built; never mutated
```

- [ ] **Step 2: setup file** `tests/setup/relocateCcloopCache.ts` (added to `vitest.config.ts` setupFiles right after
  `tests/setup/scopeTmpdir.ts`):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * CLAUDE.md Rule 17 and spec 2026-10-15 §4.2: ccloop caches agent catalogs outside the repository. Every ccloop this
 * suite spawns inherits this directory (execFile without `env` passes process.env), inside this file's scoped TMPDIR.
 */
process.env.CCLOOP_CACHE_DIR = mkdtempSync(join(tmpdir(), "ccache-"));
```

- [ ] **Step 3: failing test** `tests/control/declaredNullWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { intersectCapabilities, resolveProfile } from "../../src/control/profiles.js";
import type { CapabilityViewV1 } from "../../src/control/webProtocol.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Spec 2026-10-15 §6.3, human ruling R7 (criterion 7): a profile's `contextWindowTokens: null` means "not declared", so the
// intersection takes ccloop's observed window; two numbers still take the smaller; an observed null stays null.
const declared = (window: number | null) => ({ ...profileSnapshot().profile.capabilities, contextWindowTokens: window });
const observed = (window: number | null): CapabilityViewV1 => ({ ...profileSnapshot().profile.capabilities, contextWindowTokens: window });

describe("a declared-null window (R7)", () => {
  it("takes the observed window, the smaller of two, and keeps an observed null", () => {
    expect([
      intersectCapabilities(declared(null), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(200000), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(null), observed(null)).contextWindowTokens,
      intersectCapabilities(declared(300000), observed(null)).contextWindowTokens,
    ]).toEqual([272000, 200000, null, null]);
  });

  it("has no context-unavailable when ccloop reports a window under a null-declaring profile, and has it when ccloop reports none", () => {
    const snapshot = profileSnapshot(); snapshot.profile.capabilities = declared(null);
    const profile = resolveProfile(snapshot);
    const at = (window: number | null) => estimatorCompatibility({ profile, observed: observed(window), probeFailureCode: null, resolution: fixtureResolutionFor(observed(window)) }, "soft").reasonCodes;
    expect([at(272000).includes("context-unavailable"), at(null).includes("context-unavailable")]).toEqual([false, true]);
  });
});
```

- [ ] **Step 4: red.** P-2 (cwd `$OR`, `./node_modules/.bin/vitest run tests/control/declaredNullWindow.test.ts`) → `$LOGS/t10-red.log`.

- [ ] **Step 5: implement** `src/control/profiles.ts:119-122`:

```ts
    // Spec 2026-10-15 §6.3, human ruling R7: a declared null is "not declared", so the observed window is taken; an observed
    // null stays null (Orca never invents a window ccloop did not state); two numbers take the smaller.
    contextWindowTokens:
      observed.contextWindowTokens === null ? null
        : declared.contextWindowTokens === null ? observed.contextWindowTokens
          : Math.min(declared.contextWindowTokens, observed.contextWindowTokens),
```

- [ ] **Step 6: green and the R7 sweep.** P-2 the new file → green. Then the whole backend control suite with the built
  pushed ccloop: `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js" ./node_modules/.bin/vitest run tests/control tests/panel --reporter=json --outputFile="$LOGS/t10-sweep.json"`
  → `$LOGS/t10-sweep.log`. Every red that is not a known load flake (Orca `known-load-flakes.md`, re-run alone 3×) is a
  criterion R7 or the new ccloop changed: compare with P-5. Expected newly red: **E6 only** (`webCcloopSmoke.test.ts:156-159`).
  **[HUMAN] name E6**; rewrite line 158 `contextWindowTokens: 272000` with the comment
  `Rewritten for the every-agent requirement chain (spec 2026-10-15 §6.1; human named E6 on <date>): ccloop now reads codex's window from its catalog (the build's fake codex answers 272000 for gpt-6-sol).`
  Any red not in P-5: stop, name it to the human, do not edit. For each prose line in P-5 that a run proves false, append
  an ERRATUM line beside it (Orca handoff §6.2).

- [ ] **Step 7: mutation.** M10.1 the new expression → the old one (`declared !== null && observed !== null ? min : null`)
  ⇒ red both tests in `declaredNullWindow.test.ts`. M10.2 delete the setup-file line from `vitest.config.ts` and run
  `tests/control/webCcloopSmoke.test.ts` with `HOME="$M/fakehome"`: an entry appears under `$M/fakehome/.cache/ccloop`
  (recorded; proves the setup file is what redirects).

- [ ] **Step 8: commit** `src/control/profiles.ts tests/control/declaredNullWindow.test.ts tests/setup/relocateCcloopCache.ts vitest.config.ts tests/control/webCcloopSmoke.test.ts`
  plus `git add -f .superpowers/sdd/2026-10-15-every-agent-chain/progress.md`, subject
  `feat(control): a declared-null context window takes ccloop's observed window (R7)`.

---

## Task 11: Orca reads `"v1-soft"`; soft mode accepts it, strict refuses it (spec §6.2; criterion 4)

**Files:**
- Modify: `src/control/ccloopPort.ts:47`, `src/control/agentSelection.ts:36`, `src/control/estimatorCompatibility.ts:16`
- Modify (fixture, listed for the human): `tests/control/fixtures/ccloopWorld.ts:82,162` (`WorldOptions.estimateMode?: "strict" | "soft"`, default `"soft"`)
- Test: `tests/control/estimatorSoftExecution.test.ts`, `tests/control/codexRequirementOpen.test.ts`

- [ ] **Step 1: failing tests.** `tests/control/estimatorSoftExecution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft accepts "v1" or "v1-soft". The fixture profile is strict-capable
// (bounded, with a request-bound proof), so single-call-unavailable is the only reason either way.
const profile = resolveProfile(profileSnapshot());
const at = (execution: "v1" | "v1-soft" | null, mode: "strict" | "soft") => estimatorCompatibility({ profile, observed: profile.snapshot.profile.capabilities, probeFailureCode: null,
  resolution: { ...fixtureResolutionFor(profile.snapshot.profile.capabilities), singleCallExecution: execution } }, mode).reasonCodes;

describe("strict and soft single-call execution (spec §6.2)", () => {
  it.each([
    ["v1", "strict", []], ["v1-soft", "strict", ["single-call-unavailable"]], [null, "strict", ["single-call-unavailable"]],
    ["v1", "soft", []], ["v1-soft", "soft", []], [null, "soft", ["single-call-unavailable"]],
  ] as const)("%s in %s mode", (execution, mode, reasons) => {
    expect(at(execution, mode)).toEqual(reasons);
  });

  it("parses v1-soft from ccloop and refuses any other new value", () => {
    const answer = { protocol: 3, selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" }, configHash: "a".repeat(64), timeoutMs: 1000, killGraceMs: 0,
      capabilities: profile.snapshot.profile.capabilities, singleCallExecution: "v1-soft", singleCallOutputCap: null };
    expect([ccloopResolutionSchema.safeParse(answer).success, ccloopResolutionSchema.safeParse({ ...answer, singleCallExecution: "v2" }).success]).toEqual([true, false]);
  });
});
```

  `tests/control/codexRequirementOpen.test.ts` (real ccloop; must not be skipped in the gate -- see Task 16):

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ccloopWorlds, raw, realBinary } from "./fixtures/ccloopWorld.js";

// Spec 2026-10-15 criterion 4 (R1, R2, R7) against the real ccloop build and its fake codex: a codex estimator opens a
// requirement in soft mode under a profile that declares no window; strict mode still refuses it by name.
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-codex-req-", epochPrefix: "epoch-codex-req-" });
afterAll(removeRoots);

describe("requirement-open with a codex estimator (spec 2026-10-15 criterion 4)", { timeout: 120_000 }, () => {
  relocateHome("orca-codex-req-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });
  const open = async (estimateMode: "strict" | "soft") => {
    const w = await world([], {}, { estimateMode });
    const runtime = await w.boot();
    try {
      const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
        { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "codex" } } }, { kind: "operator", operatorId: "human" }));
      expect("error" in prefs ? prefs.error : "set").toBe("set");
      return await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
        target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: w.repoId, idea: "Let people export notes.", contentLanguage: "en" } } as never);
    } finally { await w.teardown(); }
  };
  it("opens in soft mode", async () => {
    expect(await open("soft")).toMatchObject({ result: { kind: "requirement-opened" } });
  });
  it("refuses in strict mode with single-call-unavailable among the reasons", async () => {
    expect(await open("strict")).toMatchObject({ error: { code: "agent-selection-rejected", message: expect.stringContaining("single-call-unavailable") } });
  });
});
```

- [ ] **Step 2: red.** P-2 both files with `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"` and `--reporter=json --outputFile="$LOGS/t11-red.json"`;
  read the JSON's `numPendingTests` for `codexRequirementOpen` (must be 0: a skip is not red).

- [ ] **Step 3: implement.** `ccloopPort.ts:47` `singleCallExecution:z.enum(["v1","v1-soft"]).nullable()` and append to
  the comment block at 43-46 a line `// Spec 2026-10-15 §6.2: "v1-soft" (codex) -- a single call whose output bound is checked after the fact.`;
  `agentSelection.ts:36` `singleCallExecution: "v1" | "v1-soft" | null`; `estimatorCompatibility.ts:16`:

```ts
  // Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft also accepts "v1-soft", whose output bound is checked after the fact.
  const execution = resolution.resolution?.singleCallExecution;
  if (!(execution === "v1" || (mode === "soft" && execution === "v1-soft"))) reasons.push("single-call-unavailable");
```

  `ccloopWorld.ts`: `WorldOptions` gains `/** Spec 2026-10-15 criterion 4: the panel's estimate mode (soft when absent). */ estimateMode?: "strict" | "soft";`
  and line 162 uses `worldOptions.estimateMode ?? "soft"` in place of the literal `"soft"`.

- [ ] **Step 4: green** (same command → `$LOGS/t11-green.json`/`.log`; 8 passed, 0 pending).

- [ ] **Step 5: mutations.** M11.1 `(mode === "soft" && execution === "v1-soft")` → `execution === "v1-soft"` ⇒ red
  `v1-soft in strict mode` and `codexRequirementOpen` strict. M11.2 the same → `false` ⇒ red `v1-soft in soft mode` and
  `opens in soft mode`. M11.3 the port enum back to `["v1"]` ⇒ red the schema test and `opens in soft mode` (the probe fails
  ⇒ `selection-unavailable`). Run the real-ccloop mutations with `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"` from the clone.

- [ ] **Step 6: commit**, subject `feat(control): accept codex's soft single call in soft estimate mode only`.

---

## Task 12: A single call's output overrun, at read time (spec §6.2; criterion 5)

**Files:**
- Modify: `src/control/webProtocol.ts:1243-1316` (`runViewSchema` gains two optional fields), `src/panel/controlViews.ts:902-924`
- Modify (fixture, listed for the human): `tests/control/fixtures/estimateHarness.ts:19-29,52-54` (`byModel?` option)
- Create: `web/src/RunOutputBound.tsx`; modify `web/src/controlTypes.ts` (`RunViewV1`), `web/src/ControlGroupView.tsx:403`,
  `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `tests/control/singleCallOutputBound.test.ts`, `web/tests/runOutputBound.test.tsx`

**Interfaces:**
- Produces: `RunViewV1.outputBound?: number` (positive safe integer), `RunViewV1.outputBoundExceededBy?: number`
  (positive safe integer, present only when observed output > bound). i18n key `control.outputBound.exceeded`
  (`{{tokens}}`).

- [ ] **Step 1: failing tests.** `tests/control/singleCallOutputBound.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";

// Spec 2026-10-15 §6.2, criterion 5 (R2): a single call is booked at its observed usage; its run view carries the bound it
// was sent with (64000 here: the fixture profile's maxOutputTokens, no agent cap) and, when the observed output (sum of
// byModel[].output) is over it, by how much. Computed at read time from the stored usage event: no schema change.
const run = async (output: number) => {
  const x = await estimateHarness({ tokens: 100 + output, byModel: [{ model: "gpt-6-sol", input: 100, output, cacheRead: 0, cacheWrite: 0 }] });
  try {
    await x.rounds(() => x.estimate().state !== "running");
    return readControlGroup(x.h.store, "epoch", "g").runs.find((view) => view.runId === x.runId)!;
  } finally { await x.h.dispose(); }
};

describe("output bound on a single call's run view (spec §6.2)", () => {
  it("over the bound: booked as observed, overrun shown", async () => {
    expect(await run(64_100)).toMatchObject({ outputBound: 64000, outputBoundExceededBy: 100, used: { tokens: 64_200 } });
  });
  it("at the bound and under it: no overrun", async () => {
    const at = await run(64_000), under = await run(10);
    expect([at.outputBound, Object.hasOwn(at, "outputBoundExceededBy"), under.outputBound, Object.hasOwn(under, "outputBoundExceededBy")]).toEqual([64000, false, 64000, false]);
  });
});
```

  (If `ESTIMATE_GRANT.tokens` is below 64_200 the harness's settlement may refuse; read `src/control/estimator.ts`
  `ESTIMATE_GRANT` first and, if needed, lower the bound by giving the harness profile a smaller
  `estimatorPreflight.maxOutputTokens` -- keep the literals consistent and write the arithmetic in the comment.)

  `web/tests/runOutputBound.test.tsx` (`// @vitest-environment jsdom` first line): render `<RunOutputBound run={...} />`
  for a run with `outputBound: 64000, outputBoundExceededBy: 100` and assert the English text
  `"This agent cannot cap a call's output; this call went 100 tokens over its declared bound."`, then switch the language
  to `zh` and assert the full Chinese text from the locale (handoff §6.7: assert the whole string in Chinese and run the
  "put English back" mutation); a run without `outputBoundExceededBy` renders nothing.

- [ ] **Step 2: red** (P-2 both; web via `npm --workspace web exec vitest run tests/runOutputBound.test.tsx`).

- [ ] **Step 3: implement.**
  `estimateHarness.ts`: `SingleCallOptions` gains
  `/** Spec 2026-10-15 §6.2: the event's per-model breakdown (absent: none, as before). */ byModel?: Array<{ model: string; input: number; output: number; cacheRead: number; cacheWrite: number }>;`
  and the event literal at 53-54 spreads `...(options.byModel === undefined ? {} : { byModel: options.byModel })`.
  `webProtocol.ts` `runViewSchema` (before `createdOrdinal`):

```ts
    // Spec 2026-10-15 §6.2 (R2): a single call's (estimate or requirement) output bound and, when the observed output (the sum
    // of its usage event's byModel[].output) went over it, by how much. Optional on the wire; read-time only.
    outputBound: positiveSafeInteger.optional(),
    outputBoundExceededBy: positiveSafeInteger.optional(),
```

  `controlViews.ts`: a helper above `runViews` and its spread in the returned object (after `createdOrdinal`):

```ts
/** Spec 2026-10-15 §6.2 and plan issue 11: every estimate or requirement single call; computed from the stored usage event. */
function outputBoundView(store: ControlStore, groupId: string, run: { runId: string; phase: string; estimateId: string | null }): { outputBound?: number; outputBoundExceededBy?: number } {
  if (run.phase !== "estimate" && run.phase !== "single-call") return {};
  let bound: number;
  try {
    bound = run.phase === "estimate" ? readEstimateContract(store, groupId, run.estimateId!).maxOutputTokens : readRequirementGroup(store, groupId).requirement.maxOutputTokens;
  } catch { return {}; }
  const event = store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq DESC").all(run.runId)
    .map((row) => JSON.parse(String(row.body)) as { bucket: string; byModel?: Array<{ output: number }> | null })
    .find((candidate) => candidate.bucket === "work" && Array.isArray(candidate.byModel));
  const output = event?.byModel?.reduce((sum, entry) => sum + entry.output, 0) ?? 0;
  return output > bound ? { outputBound: bound, outputBoundExceededBy: output - bound } : { outputBound: bound };
}
```

  (import `readEstimateContract` from `../control/estimator.js` if not already imported; `readRequirementGroup` is.)
  `web/src/controlTypes.ts` `RunViewV1`: add `outputBound?: number; outputBoundExceededBy?: number;`.
  `web/src/RunOutputBound.tsx`:

```tsx
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunViewV1 } from "./controlTypes.js";

/** Spec 2026-10-15 §6.2: the result is used as normal; this only says the call went over its declared bound. */
export function RunOutputBound(props: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  if (props.run.outputBoundExceededBy === undefined) return null;
  return <small role="note">{t("control.outputBound.exceeded", { tokens: props.run.outputBoundExceededBy })}</small>;
}
```

  `ControlGroupView.tsx:403`: `<RunReason run={run} /> <RunOutputBound run={run} />`.
  `en.ts` (under `control`): `outputBound: { exceeded: "This agent cannot cap a call's output; this call went {{tokens}} tokens over its declared bound." },`
  `zh.ts`: `outputBound: { exceeded: "该 agent 无法限制单次调用的输出；这次调用比声明的上限多用了 {{tokens}} 个 token。" },`
  Wording rule: the sentence never says the call was bounded or capped.

- [ ] **Step 4: green** (both; plus `tests/metrics` and `tests/panel/scanPanelText.test.ts` per handoff §6.7 -- web text).

- [ ] **Step 5: mutations.** M12.1 `output > bound` → `output >= bound` ⇒ red "at the bound". M12.2 `return output > bound ? {...} : { outputBound: bound };`
  → `return { outputBound: bound };` ⇒ red "over the bound". M12.3 `.find((candidate) => candidate.bucket === "work" && ...)`
  → `.find(() => false)` ⇒ red "over the bound". M12.4 (web) the zh entry replaced by the English sentence ⇒ red the zh
  assertion.

- [ ] **Step 6: commit**, subject `feat(control): show a single call's output overrun beside its booked usage`.

---

## Task 13: The model list API (Orca, part C server, spec §5)

**Files:**
- Modify: `src/control/executionPort.ts:44-46` (optional `listModels`), `src/control/ccloopPort.ts` (schema + method),
  `src/control/webProtocol.ts` (`agentModelsViewSchema` after `agentsViewSchema` at 1763), `src/panel/controlApi.ts:36,289-309`
- Modify (fixture, listed for the human): `tests/panel/fixtures/controlPanel.ts:67-77,144-150` (`BootOptions.listModels`)
- Test: `tests/panel/agentModelsApi.test.ts`, `tests/control/ccloopModels.test.ts`

**Interfaces:**
- Produces:
  - `ExecutionPort.listModels?(installation: string, refresh: boolean): Promise<AgentModelsView>`;
    `AgentModelsView = { installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: Array<{ model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }> }`
  - `agentModelsViewSchema` (`schema: "orca-agent-models-v1"` + the fields above), exported from `webProtocol.ts`
  - `GET /api/control/agents/:installation/models[?refresh=1]` → 200 view; 400 `query-invalid`; 403 `owner-required` (refresh by a member); 401 without a session; 424 `ccloop-failed` with `ccloop-failed:<code>: <detail>`.

- [ ] **Step 1: failing tests.** `tests/control/ccloopModels.test.ts` (real ccloop build): build a table with the build's
  fake codex (as `webCcloopSmoke.test.ts:56-62` does), `createCcloopExecutionPort({...}).listModels!("codex", false)` ⇒
  `toEqual({ installation: "codex", kind: "codex", source: "probe", observedAt: expect.any(String), models: [
  { model: "gpt-6-luna", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
  { model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" } ] })`; the
  second call answers `source: "cache"`; `listModels!("gone", false)` rejects with `{ code: "agent-installation-missing" }`
  (`named()` maps it). `tests/panel/agentModelsApi.test.ts` with `createHarness` + `BootOptions.listModels` (harness,
  `boot` and `afterAll(dispose)` set up exactly as `tests/panel/agentSelectionApi.test.ts` does):

```ts
// Spec 2026-10-15 §5 (R3, R4): owner and member read; refresh=1 is owner-only (it spawns the CLI); no Orca-side cache.
it("serves the view to a session, refuses refresh to a member, and passes refresh to the port", async () => {
  const seen: Array<[string, boolean]> = [];
  const panel = await boot("epoch-models", { listModels: async (installation, refresh) => { seen.push([installation, refresh]);
    return { installation, kind: "codex", source: "cache", observedAt: "2026-10-15T00:00:00.000Z", models: [{ model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" }] }; } });
  expect(await json(await get(panel, "/api/control/agents/codex/models"))).toEqual({ schema: "orca-agent-models-v1", installation: "codex", kind: "codex", source: "cache",
    observedAt: "2026-10-15T00:00:00.000Z", models: [{ model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" }] });
  expect((await get(panel, "/api/control/agents/codex/models?refresh=1")).status).toBe(200);
  expect((await get(panel, "/api/control/agents/codex/models", "none")).status).toBe(401);
  expect((await get(panel, "/api/control/agents/codex/models?refresh=yes")).status).toBe(400);
  expect((await get(panel, "/api/control/agents/codex/models?other=1")).status).toBe(400);
  seedUser(join(panel.root, "accounts"), "member", "member");
  const member = await login(panel.url, "member");
  expect((await member.fetch("/api/control/agents/codex/models")).status).toBe(200);
  const denied = await member.fetch("/api/control/agents/codex/models?refresh=1");
  expect([denied.status, (await denied.json() as { code: string }).code]).toEqual([403, "owner-required"]);
  expect(seen).toEqual([["codex", false], ["codex", true], ["codex", false]]);
});
it("names ccloop's failure (424 ccloop-failed) and a missing installation (RF5)", async () => {
  const panel = await boot("epoch-models-fail", { listModels: async (installation) => {
    if (installation === "gone") throw new ControlError("agent-installation-missing", "gone");
    throw new ControlError("control-peer-exit", "1:agent-catalog-unavailable: exit 5 · stage exit · elapsedMs 12"); } });
  const failed = await get(panel, "/api/control/agents/codex/models");
  expect([failed.status, ((await failed.json()) as { code: string; message: string })]).toEqual([424, expect.objectContaining({ code: "ccloop-failed", message: "ccloop-failed:agent-catalog-unavailable: exit 5 · stage exit · elapsedMs 12" })]);
  expect(((await (await get(panel, "/api/control/agents/gone/models")).json()) as { code: string }).code).toBe("agent-installation-missing");
});
```

  (imports: `seedUser`, `login` from `./fixtures/auth.js`; `ControlError` from `../../src/control/errors.js`; `join`.)

- [ ] **Step 2: red** (P-2 both files with `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"`; `numPendingTests` 0).

- [ ] **Step 3: implement.** `executionPort.ts`: add the optional method and the `AgentModelsView` type next to
  `AgentsView`. `ccloopPort.ts`:

```ts
// Spec 2026-10-15 §3, §5: ccloop's `control models` answer (ccloop-models-v1), strict, so a wrong one refuses the answer.
const agentModelsSchema=z.object({schema:z.literal("ccloop-models-v1"),installation:idSchema,kind:z.string().min(1),source:z.enum(["cache","probe","none"]),observedAt:z.string().datetime().nullable(),
 models:z.array(z.object({model:z.string().min(1).max(200),contextWindowTokens:safeInteger.positive().nullable(),maxOutputTokens:safeInteger.positive().nullable(),singleCallExecution:z.enum(["v1","v1-soft"]).nullable()}).strict())}).strict();
```

  and in the port object `async listModels(installation,refresh){let answer:unknown;try{answer=await raw("models",{installation,refresh});}catch(error){throw named(error);}const {schema:_schema,...view}=parse(agentModelsSchema,answer);return view;},`.
  `webProtocol.ts`: `export const agentModelsViewSchema = z.object({ schema: z.literal("orca-agent-models-v1"), installation: idSchema, kind: nonemptyString, source: z.enum(["cache", "probe", "none"]), observedAt: z.string().nullable(), models: z.array(z.object({ model: nonemptyString, contextWindowTokens: positiveSafeInteger.nullable(), maxOutputTokens: positiveSafeInteger.nullable(), singleCallExecution: z.enum(["v1", "v1-soft"]).nullable() }).strict()) }).strict();`
  `controlApi.ts`: `port?: Pick<ExecutionPort, "listAgents" | "resolveAgent" | "listModels">;` and inside `if (deps.port)`:

```ts
      // Spec 2026-10-15 §5 (R3, R4): the installation's models for the selection editor; ccloop's file cache serves it.
      app.get("/api/control/agents/:installation/models", asyncRoute(async (req, res) => {
        const installation = String(req.params.installation);
        const refreshText = req.query.refresh;
        if (!idSchema.safeParse(installation).success || Object.keys(req.query).some((key) => key !== "refresh") || (refreshText !== undefined && refreshText !== "1")) {
          sendMappedControlError(res, new ControlError("query-invalid")); return;
        }
        const refresh = refreshText === "1";
        if (refresh && !owner(res)) return;
        if (port.listModels === undefined) { sendMappedControlError(res, new ControlError("control-protocol-unavailable")); return; }
        try { res.json(agentModelsViewSchema.parse({ schema: "orca-agent-models-v1", ...(await port.listModels(installation, refresh)) })); }
        catch (error) { sendMappedControlError(res, error); }
      }));
```

  (`idSchema` from `../control/schema.js`; check that `query-invalid` and `control-protocol-unavailable` map to 400/503 in
  `readErrorStatuses`; if `query-invalid` is not there, read how the results route at `controlApi.ts:315` gets its 400 and
  use the same.) `controlPanel.ts` fixture: `BootOptions.listModels?: ExecutionPort["listModels"]` and
  `...(options.listModels === undefined ? {} : { listModels: options.listModels }),` in the port literal.

- [ ] **Step 4: green.** **Step 5: mutations.** M13.1 `if (refresh && !owner(res)) return;` → `` ⇒ red the member 403.
  M13.2 the `refreshText !== "1"` clause removed ⇒ red `refresh=yes` 400. M13.3 `refresh` → `false` in the
  `listModels(installation, refresh)` call ⇒ red `seen`. M13.4 `throw named(error)` → `throw error` ⇒ red the
  `agent-installation-missing` code in `ccloopModels.test.ts`.

- [ ] **Step 6: commit**, subject `feat(panel): serve an installation's models from ccloop`.

---

## Task 14: The model drop-down, refresh, and the unavailable reason (Orca web, part C, spec §5)

**Files:**
- Modify: `web/src/controlApi.ts:151` (+ `fetchAgentModels`), `web/src/controlTypes.ts:558` (+ `AgentModelsViewV1`, `ModelListState`),
  `web/src/AgentFields.tsx:134-154,214-218`, `web/src/AgentSelectionEditor.tsx:80-90,183,212`, `web/src/AgentSettings.tsx:162-176`,
  `web/src/App.tsx:261,543-549` (state + load), `web/src/ccloopCodes.ts` (unchanged API), `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `web/tests/agentModelsDatalist.test.tsx`, `tests/panel/refusalCoverage.test.ts` (**only-add**: a new `it`)

**Interfaces:**
- Produces:
  - `export type ModelListState = { state: "loading" } | { state: "ready"; view: AgentModelsViewV1 } | { state: "unavailable"; code: string; detail: string }`
  - `SelectionFieldsProps.models?: (installationId: string) => ModelListState | undefined`; `SelectionFieldsProps.onRefreshModels?: (installationId: string) => void` (absent ⇒ no button; App passes it only when `account?.user.roles` includes `"owner"`).
  - i18n keys: `agents.models.refresh`, `agents.models.loading`, `agents.models.window` (`{{tokens}}`), `agents.models.unavailable` (`{{reason}}`).

- [ ] **Step 1: failing tests.** `web/tests/agentModelsDatalist.test.tsx` (`// @vitest-environment jsdom`), rendering
  `<SelectionFields>` directly with the two-installation `agents` of `web/tests/agentSelectionEditor.test.tsx:28-34` plus an
  omp row `{ id: "omp", kind: "omp", defaults: { model: "gateway/model-a", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "18.10.1" }`:
  1. codex selected, `models` answers `ready` with `gpt-6-luna` and `gpt-6-sol` (272000) ⇒ the model `<input>` has a `list`
     attribute naming a `<datalist>` whose options' values are `["gpt-6-luna", "gpt-6-sol"]` and whose labels contain
     `"272000"`; typing `my-custom-model` into the input calls `onDraft("<prefix>:model", "my-custom-model")` (free text kept).
  2. claude selected ⇒ no `list` attribute, no datalist (claude keeps free text).
  3. omp selected, `models` answers `{ state: "unavailable", code: "omp-model-catalog-unavailable", detail: "timeout 30000ms · stage timeout · elapsedMs 30001" }`
     ⇒ a `role="note"` element whose text equals `explainCcloopCode("omp-model-catalog-unavailable", "timeout 30000ms · stage timeout · elapsedMs 30001")`
     -- assert the literal English sentence from `en.ts:1358` with the detail filled in -- and the input still accepts text (RF5:
     the same with `code: "agent-installation-missing"`).
  4. `onRefreshModels` given ⇒ a button named `"Refresh models"`; clicking calls it with `"codex"`; not given ⇒ no button.
  5. zh: the refresh button's full Chinese label (handoff §6.7).
  The new `it` in `tests/panel/refusalCoverage.test.ts` (only-add, beside line 96):
  `it("has en and zh entries for the every-agent chain codes", () => { for (const table of [enCcloopErrors, zhCcloopErrors]) expect(["agent-catalog-unavailable", "codex-single-call-not-single", "codex-single-call-unavailable"].filter((code) => !has(table, code))).toEqual([]); });`

- [ ] **Step 2: red** (`npm --workspace web exec vitest run tests/agentModelsDatalist.test.tsx` and the root refusalCoverage file).

- [ ] **Step 3: implement.**
  `web/src/controlApi.ts`: `export const fetchAgentModels = (installation: string, refresh = false): Promise<AgentModelsViewV1> => controlGet<AgentModelsViewV1>(\`/api/control/agents/${segment(installation)}/models${refresh ? "?refresh=1" : ""}\`);`
  `web/src/AgentFields.tsx` -- in `SelectionFields`, after `effective` is computed:

```tsx
  // Spec 2026-10-15 §5 (R3): omp and codex offer their installation's models as a datalist; the box stays free text, and an
  // unreadable list shows ccloop's reason beside it. Claude keeps free text only.
  const listed = effective !== undefined && (effective.kind === "omp" || effective.kind === "codex") ? props.models?.(effective.id) : undefined;
  const listId = `${prefix}:models`;
```

  the model `<input>` gains `list={listed?.state === "ready" ? listId : undefined}` and, after it:

```tsx
        {listed?.state === "ready" && (
          <datalist id={listId}>
            {listed.view.models.map((row) => <option key={row.model} value={row.model} label={row.contextWindowTokens === null ? row.model : t("agents.models.window", { tokens: row.contextWindowTokens })} />)}
          </datalist>
        )}
        {listed?.state === "loading" && <small>{t("agents.models.loading")}</small>}
        {listed?.state === "unavailable" && <small role="note">{t("agents.models.unavailable", { reason: explainCcloopCode(listed.code, listed.detail) })}</small>}
        {effective !== undefined && listed !== undefined && props.onRefreshModels !== undefined && (
          <button type="button" onClick={() => props.onRefreshModels!(effective.id)}>{t("agents.models.refresh")}</button>
        )}
```

  (import `explainCcloopCode` from `./ccloopCodes.js`.) `AgentSelectionEditor.tsx` and `AgentSettings.tsx`: accept
  `models?` / `onRefreshModels?` props and pass them to every `<SelectionFields>`. `App.tsx`:

```tsx
  const [agentModels, setAgentModels] = useState<Record<string, ModelListState>>({});
  const loadModels = async (id: string, refresh: boolean): Promise<void> => {
    setAgentModels((all) => ({ ...all, [id]: { state: "loading" } }));
    try { const view = await fetchAgentModels(id, refresh); setAgentModels((all) => ({ ...all, [id]: { state: "ready", view } })); }
    catch (err) {
      const refusal = controlFailureFrom(err);
      const parsed = refusal.code === "ccloop-failed" ? codeAndDetail(refusal.message.slice("ccloop-failed:".length)) : { code: refusal.code, detail: "" };
      setAgentModels((all) => ({ ...all, [id]: { state: "unavailable", ...parsed } }));
    }
  };
```

  and in `loadAgents` after `setAgents(table)`: `for (const row of table.installations) if (row.kind === "omp" || row.kind === "codex") void loadModels(row.id, false);`.
  Pass `models={(id) => agentModels[id]}` and, only when `(account?.user.roles ?? []).includes("owner")`,
  `onRefreshModels={(id) => void loadModels(id, true)}` where `AgentSelectionEditor`/`AgentSettings` are rendered
  (`App.tsx:1328`, `:1432` regions -- re-read them).
  Locales: en `models: { refresh: "Refresh models", loading: "Reading the model list…", window: "{{tokens}} tokens of context", unavailable: "The model list is unavailable: {{reason}}" }`
  under `agents`; zh `models: { refresh: "刷新模型列表", loading: "正在读取模型列表…", window: "上下文 {{tokens}} token", unavailable: "读不到模型列表：{{reason}}" }`.
  `enCcloopErrors` / `zhCcloopErrors` additions:
  - `"agent-catalog-unavailable": "The agent could not list its models ({{detail}}). Check that it is installed and starts, then retry."` /
    `"agent 列不出它的模型（{{detail}}）。请确认它已安装且能启动，然后重试。"`
  - `"codex-single-call-not-single": "Codex did more than one model call, or used a tool, in a call that must be a single answer; the usage it spent is booked."` /
    `"Codex 在本应只答一次的调用里多次调用了模型或用了工具；已花的用量照记。"`
  - `"codex-single-call-unavailable": "Codex's feature list could not be read, so its tools could not be turned off; the call was refused before it started ({{detail}})."` /
    `"读不到 Codex 的功能列表，无法关闭它的工具，调用在开始前被拒绝（{{detail}}）。"`
  (None says "bounded" or "capped" -- §6.2 wording rule.)

- [ ] **Step 4: green** (the two files + `npm --workspace web exec vitest run` whole web suite + root `tests/panel/scanPanelText.test.ts tests/metrics` + `npm run --ws check`).

- [ ] **Step 5: mutations.** M14.1 `list={listed?.state === "ready" ? listId : undefined}` → `list={undefined}` ⇒ red test 1.
  M14.2 `(effective.kind === "omp" || effective.kind === "codex")` → `effective.kind !== "claude-never"` ⇒ red test 2.
  M14.3 the `unavailable` line removed ⇒ red test 3. M14.4 `props.onRefreshModels !== undefined &&` removed ⇒ red test 4
  (no-button half). M14.5 zh `refresh` replaced by the English text ⇒ red test 5.

- [ ] **Step 6: commit**, subject `feat(web): offer omp and codex models as a datalist with refresh and the unavailable reason`.

---

## Task 15: Repin ccloop in the same Orca branch (spec §8.2)

**Files:** `package.json:35`, `package-lock.json` (written by the script)

- [ ] **Step 1:** precondition: H1 done; `/usr/bin/git -C /Users/biran/code/skills/orca/ccloop ls-remote origin refs/heads/main > "$LOGS/t15-remote.txt"` names `<SHA>`; `$OR` is clean (`/usr/bin/git -C "$OR" status --porcelain > "$LOGS/t15-status.txt"`, 0 bytes).
- [ ] **Step 2:** `( cd "$OR" && node scripts/pin-ccloop.mjs <SHA> ) > "$LOGS/t15-pin.log" 2>&1; echo "RC=$?" >> "$LOGS/t15-pin.log"` -- RC 0 required (the script runs its own checks, including the default E2E with relocated HOME/XDG).
- [ ] **Step 3:** P-2 `npm run verify:ccloop-pin` → `$LOGS/t15-verify-pin.log`, RC 0.
- [ ] **Step 4: commit** `package.json package-lock.json`, subject `chore(deps): repin ccloop to <short SHA> for the every-agent requirement chain`.

---

## Task 16: Orca full gate, wording scan, ledger, handoff

- [ ] **Step 1: wording scan with must-catch / must-not-catch samples** (handoff §6.4):

```bash
cat > "$SCRATCH/wording.py" <<'PY'
import re, sys, pathlib
pat = re.compile(r"codex[^.\n]{0,120}\b(bounded|capped|caps its)\b", re.I)
must_catch = ["Codex single calls are bounded.", "the codex call is capped at 4096"]
must_not = ["Codex cannot cap a call's output", "This agent cannot cap a call's output; this call went 5 tokens over"]
assert all(pat.search(s) for s in must_catch) and not any(pat.search(s) for s in must_not), "scanner self-test failed"
hits = []
for root in sys.argv[1:]:
    p = pathlib.Path(root)
    for f in ([p] if p.is_file() else p.rglob("*")):
        if f.is_file() and f.suffix in {".ts", ".tsx", ".md"} and "node_modules" not in f.parts and "dist" not in f.parts:
            for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if pat.search(line): hits.append(f"{f}:{n}: {line.strip()[:160]}")
print("\n".join(hits)); print("HITS", len(hits))
PY
python3 "$SCRATCH/wording.py" "$OR/web/src" "$OR/README.md" "$OR/SKILL.md" > "$LOGS/t16-wording.log" 2>&1; echo "RC=$?" >> "$LOGS/t16-wording.log"
```

  Expected `HITS 0`, RC 0 (a missing `SKILL.md` is reported by the script as no file; record it).

- [ ] **Step 2: full gate in a clone** (handoff §2, §3.4 shape; every segment separately with its own RC; fake-only
  `ORCA_AGENTS_TABLE` with the build's fake codex in `integration` mode; `ORCA_CCLOOP_BIN` = the ccloop build of `<SHA>`
  from `$B`; `npm run build --workspace web` **before** tests; `CCLOOP_CACHE_DIR` set; short `TMPDIR`):

```bash
G="$(mktemp -d /private/tmp/org-XXXX)"; /usr/bin/git clone --local -q --branch codex/every-agent-chain "$OR" "$G/repo"
ln -s /Users/biran/code/skills/orca/Orca/node_modules "$G/repo/node_modules"; cd "$G/repo"
export TMPDIR="$(mktemp -d /private/tmp/cl-XXXX)" CCLOOP_CACHE_DIR="$G/ccache" ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"
node -e '<same fake-only table writer as Task 9, fake path $B/repo/tests/fixtures/fake-codex.mjs>' "$G/agents.json" "$B/repo/tests/fixtures/fake-codex.mjs" "$G/codex-marker"
export ORCA_AGENTS_TABLE="$G/agents.json"
for seg in "npm run typecheck" "npm run build" "npm run build --workspace web" "npm test" "node scripts/check-claude-md-lines.mjs" "node scripts/check-hooks-path.mjs" "npm run verify:control" "npm run verify:scheduler" "npm run verify:chain" "npm run verify:ccloop-pin" "npm run verify:panel" "npm run --ws check" "node scripts/check-tmp-leak.mjs"; do
  name=$(echo "$seg" | tr ' :/' '___'); $seg > "$LOGS/org-$name.log" 2>&1; echo "RC=$?" >> "$LOGS/org-$name.log"
done
```

  (`npm test` takes ~20 minutes: run this loop in the background with `run_in_background` and wait for its notification.)
  Read every log whole. Success = RC 0 for every segment, or every red attributed by running its file alone three times
  (`known-load-flakes.md`), and the fixed environment reds of handoff §3.4 (`taskResultPaired` ×2) named as such.
  The new real-ccloop files (`codexRequirementOpen`, `ccloopModels`, `webCcloopSmoke`) must show **passed, not skipped**
  in the `npm test` JSON (run `npm test -- --reporter=json --outputFile="$LOGS/org-vitest.json"` as the `npm test` segment).

- [ ] **Step 3: ledger + Orca handoff.** Ledger: the Orca part (tasks, commits, mutations observed red, the human's named
  rewrites E6 and any others, gate counts with their commands and the gate commit, Task 0 facts, the framing-overhead
  bytes for the human (issue 12)). Orca `docs/handoff/handoff.md` (Chinese, live document, Rule 13 three conditions for
  deleting others' entries): §3.3 replaced with this round's state, §4.1 human list (merge+push Orca, panel rebuild and
  restart, the paid checks P1/P2 awaiting a nod, the clone dirs to remove), §4.2 item 1 marked done with the commit
  subjects; follow §6.5 (extract the `-` lines of the diff and check each conclusion survives).

- [ ] **Step 4: checkpoint** (Rule 10): what was done, what is verified (gate logs), what waits for the human.

### Checkpoint H2 [HUMAN]

Merge Orca `codex/every-agent-chain` (`--ff-only`) and push; `npm run build` + `orca panel restart`; remove the listed
clone directories (`/private/tmp/ccg-*`, `ccb-*`, `org-*`, `mut-*`, `cl-*`) after checking no process uses them.

---

## Paid acceptance (each asked separately when reached; never run without the human's yes)

- **P1 -- one real codex single call** (`gpt-6-luna`), isolated as Task 8 (or its fallback). Shape: a fake-free agents
  table with the real `codex` (version recorded), `CCLOOP_CACHE_DIR` and `HOME`/`XDG_*` relocated except the symlinked
  `auth.json`/`config.toml` (the credential-path step is named again), one `control accept` of a single-call envelope with
  the `SINGLE_CALL_SCHEMA` and a 20-word prompt, then `collect`. Confirms: exactly one `turn.completed`, no item other than
  `agent_message`/`reasoning` in `events.jsonl`, codex accepted every `-c` key (no "Unknown feature flag"), and records
  `input_tokens` (framing overhead = `input_tokens` minus the prompt's own count from the provider's tokenizer, if
  available; otherwise reported as "not derivable" -- never estimated). Cost: only the number the tool reports.
- **P2 -- one real omp requirement chain on this machine** with a warm and a cold cache: open → clarify → split → estimate
  under the live omp installation and a relocated Orca control dir; record per step whether ccloop spawned `omp models`
  (the stage/elapsed lines of `ccloop agents models` and the cache dir listing), and the total wall time.

---

## Self-review (done while writing; kept for the reviewer)

- Spec coverage: §3 → Task 5; §4.1 → Tasks 2, 4; §4.2 → Tasks 2, 4, 10; §4.3 → Task 3 (+4 for the re-check); §5 → Tasks 13,
  14; §6.1 → Tasks 0, 3 (catalog, window override, feature list), 6, 8; §6.2 → Tasks 11, 12, 14 (texts), 16 (wording);
  §6.3 → Task 10; §7 → Task 7; §8 → Checkpoint H1, Task 15; §9 fakes → Tasks 1, 8; criteria 1-8 → Tasks 4, 3, 6+7, 11, 12,
  14, 10, 9+16.
- Names used across tasks: `readAgentCatalog`, `AgentCatalogV1.catalogError`, `CatalogRowV1.listed`,
  `CODEX_SINGLE_CALL_FEATURES`, `codexSingleCallArgs`, `codexSingleCallHome`, `decodeCodexSingleCall`, `listAgentModels`,
  `ExecutionPort.listModels`, `agentModelsViewSchema`, `ModelListState`, `outputBound`/`outputBoundExceededBy` -- each
  defined in exactly one task's Interfaces block.
- Literals that the implementer must re-measure rather than trust: Task 4's `warm` counts (explicitly marked), Task 12's
  grant arithmetic (explicitly marked), every anchor line number.
