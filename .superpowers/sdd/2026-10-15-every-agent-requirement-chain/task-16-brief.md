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
