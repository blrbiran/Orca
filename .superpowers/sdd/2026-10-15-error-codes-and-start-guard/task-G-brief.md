### Task G: Final gate (both repositories) and the handoff

**Files:** `/private/tmp/oec/gate/*`; at the end `docs/handoff/handoff.md` (Chinese, living document) on the implementation branch.

**Interfaces:** Consumes the head of `feat/error-codes-start-guard` (after B2's human ruling is applied) and of ccloop `test/registry-title-omp`.

- [ ] **Step 1: Environment** — `ORCA_CCLOOP_BIN=/private/tmp/orp-gate/ccl/dist/cli.js` (a ccloop build clone; never `node_modules/ccloop`, whose package has no `tests/fixtures`). Prove what it is: `/usr/bin/git -C /private/tmp/orp-gate/ccl rev-parse HEAD > /private/tmp/oec/logs/g-ccl.log 2>&1` — expected `dc51022f965e40c3953e66e4fb34cb76cd17467d` (Orca's pin, `2669681f`); if not, stop and report. It is never mutated. Fake-only table (same shape as `tests/control/fixtures/ccloopWorld.ts:110-126` and the `02f047f6` gate; fake codex in **`integration`** mode — `ok`/`script` make `ccloopProtocol.integration` red, handoff §6.7):

```bash
node -e 'const fs=require("fs");fs.writeFileSync("/private/tmp/oec/gate/table.json",JSON.stringify({schema:"ccloop-agents-table-v1",installations:{codex:{kind:"codex",command:[process.execPath,"/private/tmp/orp-gate/ccl/tests/fixtures/fake-codex.mjs","integration","/private/tmp/oec/gate/codex-marker"],version:"9.9.9-fake",configDir:null,timeoutMs:120000,killGraceMs:5000,sandbox:"workspace-write",budgetMode:"soft"}}}),{mode:0o600});'
stat -f "%Lp %N" /private/tmp/oec/gate /private/tmp/oec/gate/table.json > /private/tmp/oec/logs/g-modes.log 2>&1
```
Read: `700 /private/tmp/oec/gate`, `600 …/table.json` (ccloop refuses a group- or world-writable table or parent).

- [ ] **Step 2: Orca gate** — `npm run verify` is an `&&` chain; with expected reds each segment runs on its own with its RC (handoff §6.7). Write `/private/tmp/oec/gate/orca.sh` (`chmod 700`):

```bash
#!/bin/bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard
G=/private/tmp/oec/gate
export ORCA_CCLOOP_BIN=/private/tmp/orp-gate/ccl/dist/cli.js ORCA_AGENTS_TABLE=$G/table.json TMPDIR=$G/tmp ECC_GATEGUARD=off DISABLE_OMC=1
seg(){ name=$1; shift; echo "== $name start $(date +%T) load $(uptime | awk '{print $(NF-2)}')" >> $G/summary.txt; "$@" > $G/$name.log 2>&1; echo "== $name rc=$? end $(date +%T)" >> $G/summary.txt; }
seg typecheck npm run typecheck
seg build npm run build
seg webbuild npm run build --workspace web
seg full ./node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile=$G/full.json
seg ledger bash -c 'npm run ledger -- validate .decisions || [ $? -eq 2 ]'
seg claudemd node scripts/check-claude-md-lines.mjs
seg hooks node scripts/check-hooks-path.mjs
seg control npm run verify:control
seg scheduler npm run verify:scheduler
seg chain npm run verify:chain
seg pin npm run verify:ccloop-pin
seg panel npm run verify:panel
seg ws npm run --ws check
seg tmpleak node scripts/check-tmp-leak.mjs
echo DONE >> $G/summary.txt
```
Run it in the background (`run_in_background`), wait for `DONE`, then read `summary.txt` and **every** log whole. Record pass/fail/skip counts from `full.json` with a script (redirected, read whole), and the load at each segment.

- [ ] **Step 3: Judge the reds** per `docs/handoff/known-load-flakes.md` (its rules first): only a registered entry with the **same failure shape** (mostly `Test timed out` / `until` timeout) may be a flake — rerun that file alone (`./node_modules/.bin/vitest run <file>`, redirected, with `uptime`), judge only once the load is in single digits, 3/3 green ⇒ not a regression. An assertion red is a new problem to investigate (handoff §3.4: `agentSelectionE2E` C3 and `handoffE2E` H5 assertion shapes included). The two `tests/control/taskResultPaired.test.ts` criteria are a **known environment red**: they hardcode two `/private/tmp` ccloop paths outside this gate's build clone — report what they did, no exemption assumed. Report failures and skips exactly; "registered" never means "green". A red introduced by this branch is fixed in its owning task's files (new test or code), never by editing an existing criterion.

- [ ] **Step 4: ccloop gate (S3)** — in `…/ccloop-wt/registry-title`: `npm run typecheck`, `npm run build`, `./node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile=/private/tmp/oec/gate/ccloop-full.json`, `node scripts/check-known-reds.mjs /private/tmp/oec/gate/ccloop-full.json`, `node scripts/check-tmp-leak.mjs` — each redirected with its RC (the same `seg` pattern, `ccloop-*.log`). Run it **after** the Orca gate (running both at once pushed load past 100, `known-load-flakes.md` `7f37d261`).

- [ ] **Step 5: Mutation table** — collect every task's mutation logs (name, criterion, red assertion, sha256 before/after/restored, restore bytes) into the checkpoint. A mutation that stayed green is listed as a gap with the test added for it.

- [ ] **Step 6: Final restore proof** — for every clone under `/private/tmp/oec/mut/`: `git diff` / `git diff --cached` byte counts redirected and read (all 0). `pgrep -fl "fake-ccloop|fake-codex|worker.js|vitest" > /private/tmp/oec/logs/g-pgrep.log`; leftovers are reported (killing needs the human).

- [ ] **Step 7: Handoff** — add a §3.x section (Chinese; Rule 13: session, date, commit subject lines) to `docs/handoff/handoff.md`: what landed (subject lines in both repositories), spec corrections K1-K8, the mutation table, the gate summary with load, uncovered sites of A8, and `awaitingHuman`: B2's ruling (if still open), push/ff-merge `feat/error-codes-start-guard` and ccloop `test/registry-title-omp`, deleting both worktrees after merge, deleting the clones under `/private/tmp/oec/mut/`, and whether the published specs get a correction section for K1-K8. Commit `docs/handoff/handoff.md` alone; message `docs(handoff): record the ccloop error codes and start guard round`.

---

