# Common context for every task (extracted from the plan lines 93-255; the plan is the source)

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

## Session facts (controller, session a852f96a)
- SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad ; LOGS=$SCRATCH/logs
- Human decisions: spec issue 8 -> the `--version` answer IS cached in the entry (spec §4.1 as written); E1-E6 approved as listed in P-5 (record "Ruling: human named E<n> in Orca session a852f96a, 2026-10-15" beside each rewritten criterion); Task 0 done by the controller.
- Task 0 result: isolation workable on codex-cli 0.160.0; the single-call isolation list (CODEX_SINGLE_CALL_CONFIG) is the plan's ISO list PLUS `-c features.plugins=false` (removes a <recommended_plugins> block the linked config.toml injects).
- Local machine: `rm`, `cp` are interactive aliases -> use /bin/rm -f, `cat src > dst`. Use /usr/bin/git for every git call. Node: nvm v22.13.1 first on PATH. `rtk` rewrites some commands and lies about output (use `rtk proxy <cmd>` or redirect to a file and Read it).
- Never push, merge, rebase, amend, stash, reset, checkout, delete branches/worktrees. Never dispatch subagents.
