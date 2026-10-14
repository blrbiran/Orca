### Task 12: Gates (both repositories) and the handoff

**Files:** `/private/tmp/osc/gate/*`, `/private/tmp/osc/ccl-build`; Modify `docs/handoff/handoff.md` (Orca, Chinese, living document) at the end.

**Interfaces:** Consumes both branches' heads. Produces the gate summary for the handoff.

- [ ] **Step 1: ccloop build clone for `ORCA_CCLOOP_BIN`** (never `node_modules/ccloop`: the npm package has no `tests/fixtures`)

If Task 10 built `/private/tmp/osc/ccl-build` from the same ccloop head (`/usr/bin/git -C /private/tmp/osc/ccl-build rev-parse HEAD` equals the worktree's), reuse it; otherwise remove that directory only with the human's yes and build fresh:

```bash
/usr/bin/git clone -q --local --branch codex/omp-single-call /Users/biran/code/skills/orca/ccloop /private/tmp/osc/ccl-build > /private/tmp/osc/logs/g-clone.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/g-clone.log
ln -s /Users/biran/code/skills/orca/ccloop/node_modules /private/tmp/osc/ccl-build/node_modules
cd /private/tmp/osc/ccl-build && npm run build > /private/tmp/osc/logs/g-ccl-build.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/g-ccl-build.log
node -e 'const fs=require("fs");fs.mkdirSync("/private/tmp/osc/gate/tmp",{recursive:true,mode:0o700});fs.writeFileSync("/private/tmp/osc/gate/table.json",JSON.stringify({schema:"ccloop-agents-table-v1",installations:{codex:{kind:"codex",command:[process.execPath,"/private/tmp/osc/ccl-build/tests/fixtures/fake-codex.mjs","integration","/private/tmp/osc/gate/marker"],version:"9.9.9-fake",configDir:null,timeoutMs:120000,killGraceMs:0,sandbox:"workspace-write",budgetMode:"soft"}}}),{mode:0o600});'
```
Read the logs; build `rc=0`. (Same table shape as the 2026-10-14 `b39a5527` gate; fake codex **`integration`** mode.) This clone is never mutated.

- [ ] **Step 2: ccloop gate** — write `/private/tmp/osc/gate/ccloop.sh`:

```bash
#!/bin/bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call
G=/private/tmp/osc/gate
seg(){ name=$1; shift; echo "== $name start $(date +%T) load $(uptime | awk '{print $(NF-2)}')" >> $G/ccloop-summary.txt; "$@" > $G/ccloop-$name.log 2>&1; echo "== $name rc=$? end $(date +%T)" >> $G/ccloop-summary.txt; }
seg typecheck npm run typecheck
seg build npm run build
seg targeted ./node_modules/.bin/vitest run tests/agents/ompCatalog.test.ts tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts tests/runtime/omp tests/control/ompSingleCallWorker.test.ts tests/control/singleCallCapability.test.ts tests/control/requestBoundDimensions.test.ts tests/agents/ompSelection.test.ts tests/agents/registry.test.ts
seg full ./node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile=$G/ccloop-full.json
seg knownreds node scripts/check-known-reds.mjs $G/ccloop-full.json
seg control npm run verify:control
seg tmpleak node scripts/check-tmp-leak.mjs
echo DONE >> $G/ccloop-summary.txt
```
Run it in the background (`run_in_background`), wait for `DONE`, then read `ccloop-summary.txt` and every log whole. Record pass/fail/skip counts from `ccloop-full.json`.

- [ ] **Step 3: Orca gate** — write `/private/tmp/osc/gate/orca.sh` (the `b39a5527` gate, retargeted):

```bash
#!/bin/bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call
G=/private/tmp/osc/gate
export ORCA_CCLOOP_BIN=/private/tmp/osc/ccl-build/dist/cli.js ORCA_AGENTS_TABLE=$G/table.json TMPDIR=$G/tmp ECC_GATEGUARD=off DISABLE_OMC=1
seg(){ name=$1; shift; echo "== $name start $(date +%T) load $(uptime | awk '{print $(NF-2)}')" >> $G/orca-summary.txt; "$@" > $G/orca-$name.log 2>&1; echo "== $name rc=$? end $(date +%T)" >> $G/orca-summary.txt; }
seg typecheck npm run typecheck
seg build npm run build
seg webbuild npm run build --workspace web
seg targeted ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/requirementOutputBound.test.ts tests/control/ccloopPort.test.ts tests/control/estimator.test.ts tests/control/estimateSingleCallGate.test.ts tests/control/requirementCommands.test.ts tests/control/driverEstimate.test.ts tests/control/estimateE2E.test.ts tests/control/ompSkillsE2E.test.ts
seg full ./node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile=$G/orca-full.json
seg control npm run verify:control
seg scheduler npm run verify:scheduler
seg chain npm run verify:chain
seg pin npm run verify:ccloop-pin
seg panel npm run verify:panel
seg ws npm run --ws check
seg claudemd node scripts/check-claude-md-lines.mjs
seg hooks node scripts/check-hooks-path.mjs
seg tmpleak node scripts/check-tmp-leak.mjs
echo DONE >> $G/orca-summary.txt
```
Run it in the background after the ccloop gate finishes (running both at once pushes load past 100 — see the `7f37d261` entry in `known-load-flakes.md`). Read every log whole.

- [ ] **Step 4: Judge the reds** per `docs/handoff/known-load-flakes.md`: only a registered entry with the **same failure shape** (mostly `Test timed out` / `until` timeout) may be a flake; rerun that file alone (`./node_modules/.bin/vitest run <file> > log 2>&1`) with `uptime` recorded, and judge only once load is in single digits (3/3 green ⇒ not a regression). An assertion red — explicitly `agentSelectionE2E` C3 (`expected [ 'b', 'd' ] …`) and `handoffE2E` H5 (`expected [ 'collected', 'collected' ] …`) — **is a new problem to investigate**, not a flake. `taskResultPaired` ×2 and `ompSkillsE2E` (`selectionsHash … null`) are registered environment reds with a local `ORCA_CCLOOP_BIN`; report what they did. Report failures and skips exactly; "registered" never means "green".

- [ ] **Step 5: Handoff** — add a §3.x section for this session to `docs/handoff/handoff.md` (Chinese; Rule 13: attributed — session, date, commit subject lines): what landed in each repository (commit subject lines), the mutation table (Tasks 6 and 10, restore bytes), the Task 0 measurements (pointer to spec §7), the gate summary with load, and `awaitingHuman`: push ccloop `codex/omp-single-call`; the repin (if not done); ff-merge both branches; delete `ccloop-wt/omp-single-call` and `Orca-wt/omp-single-call` after merge; the operator's `~/.orca/profile.json` (`contextWindowTokens: null` blocks every estimator, spec §6; `framingTokenOverhead` per spec §7); the title drift of `tests/agents/registry.test.ts` › "reports contextWindowTokens only for claude's verified 1M mapping and null otherwise" (human may name it). Commit:

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add docs/handoff/handoff.md
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/g-handoff-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
docs(handoff): record the omp single-call round

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

