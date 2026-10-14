### Task 10 (Orca): Each criterion seen red under its named mutation (criteria 8-10)

Run by a fresh context. The scripts `/private/tmp/osc/mut/mutate.mjs` and `/private/tmp/osc/mut/mut.sh` written in Task 6 Step 1 are reused as they are. `ORCA_CCLOOP_BIN` is a built ccloop clone (`/private/tmp/osc/ccl-build`, never `node_modules/ccloop`); this clone is never mutated.

**Files:** `/private/tmp/osc/mut/*` only.

**Interfaces:** Consumes the committed head of Orca `codex/omp-single-call`. Produces the Orca half of the mutation table.

- [ ] **Step 1: Build the ccloop clone (if absent), clone Orca, baseline**

```bash
test -e /private/tmp/osc/ccl-build || { /usr/bin/git clone -q --local --branch codex/omp-single-call /Users/biran/code/skills/orca/ccloop /private/tmp/osc/ccl-build && ln -s /Users/biran/code/skills/orca/ccloop/node_modules /private/tmp/osc/ccl-build/node_modules && (cd /private/tmp/osc/ccl-build && npm run build); } > /private/tmp/osc/logs/mo-ccl-build.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/mo-ccl-build.log
/usr/bin/git clone -q --local --branch codex/omp-single-call /Users/biran/code/skills/orca/Orca /private/tmp/osc/mut/orca > /private/tmp/osc/logs/mo-clone.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/mo-clone.log
ln -s /Users/biran/code/skills/orca/Orca/node_modules /private/tmp/osc/mut/orca/node_modules
ln -s /Users/biran/code/skills/orca/Orca/web/node_modules /private/tmp/osc/mut/orca/web/node_modules
cd /private/tmp/osc/mut/orca && ORCA_CCLOOP_BIN=/private/tmp/osc/ccl-build/dist/cli.js ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/requirementOutputBound.test.ts > /private/tmp/osc/logs/mo-baseline.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/mo-baseline.log
```
Read both; baseline all pass, 0 skipped. For each step: spec JSON → `ORCA_CCLOOP_BIN=/private/tmp/osc/ccl-build/dist/cli.js /private/tmp/osc/mut/mut.sh /private/tmp/osc/mut/orca <name> <file> <spec> <test>`; read `.mutate`, the three sha files, `.red.log` whole (red on the named assertion), `.restore-bytes` (both 0).

- [ ] **Step 2: Criterion 8, "drop the max"** — `M8`, file `src/control/estimator.ts`, spec `{"from": "return Math.max(preflightMaxOutputTokens, resolution?.singleCallOutputCap ?? 0);", "to": "return preflightMaxOutputTokens;"}`, test `tests/control/singleCallOutputCap.test.ts`. Expected red: "C8: a cap above…" (`64000` received), "C9" (`queued`), "takes the larger…"; "C8: no cap…" stays green. Second run `M8r`, same spec, test `tests/control/requirementOutputBound.test.ts`: red `["cap-high", 64000]`.
- [ ] **Step 3: Criterion 9, "compare the input alone"** — `M9`, file `src/control/estimator.ts`, spec `{"from": "const tooLarge = requiredRequestTokens > observed.contextWindowTokens || requiredRequestTokens > ESTIMATE_GRANT.tokens;", "to": "const tooLarge = inputTokens > observed.contextWindowTokens || inputTokens > ESTIMATE_GRANT.tokens;"}`, test `tests/control/singleCallOutputCap.test.ts -t "C9"`. Expected red: "C9…" (`queued` received).
- [ ] **Step 4: Criterion 10, "remove the field"** — `M10`, file `src/control/ccloopPort.ts`, spec `{"from": "singleCallOutputCap:safeInteger.positive().nullable().optional(),", "to": ""}`, test `tests/control/singleCallOutputCap.test.ts -t "C10"`. Expected red: "C10: accepts…" (`false` for the cap values and `null`; `{}` still true).
- [ ] **Step 5: Clarify/split bound (extra, verification only)** — `Mopen`, file `src/control/requirementCommands.ts`, spec `{"from": "maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution),", "to": "maxOutputTokens: preflight.maxOutputTokens,"}`, test `tests/control/requirementOutputBound.test.ts`. Expected red: `["cap-high", 64000]`.
- [ ] **Step 6: Close** — final `git diff`/`--cached` byte counts of the clone (both 0) into `/private/tmp/osc/logs/mo-final.bytes`; add the rows to the mutation table.

---

