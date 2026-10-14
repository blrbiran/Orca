### Task 6 (ccloop): Each criterion seen red under its named mutation (criteria 1-7)

Run by a fresh context (not the implementer of Tasks 1-5). Only in a clone; the worktree is never touched.

**Files:** `/private/tmp/osc/mut/*` only.

**Interfaces:** Consumes the committed head of `codex/omp-single-call` (ccloop). Produces a mutation table (name, file sha before/after, red assertion, restore byte counts) for the checkpoint and the handoff.

- [ ] **Step 1: Clone, tools, baseline**

```bash
/usr/bin/git clone -q --local --branch codex/omp-single-call /Users/biran/code/skills/orca/ccloop /private/tmp/osc/mut/ccloop > /private/tmp/osc/logs/m-clone.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/m-clone.log
ln -s /Users/biran/code/skills/orca/ccloop/node_modules /private/tmp/osc/mut/ccloop/node_modules
/usr/bin/git -C /private/tmp/osc/mut/ccloop log --oneline -6 > /private/tmp/osc/logs/m-head.log 2>&1
```
Read both (head is Task 5's commit).

Write `/private/tmp/osc/mut/mutate.mjs`:

```js
// Usage: node mutate.mjs <file> <spec.json>; spec is {"from": string, "to": string, "count"?: number} or an array of them,
// applied in order. Refuses (exit 2, file untouched) unless each `from` occurs exactly `count` (default 1) times at its
// turn, so a mutation can never silently miss.
import { readFileSync, writeFileSync } from "node:fs";

const [file, specPath] = process.argv.slice(2);
const parsed = JSON.parse(readFileSync(specPath, "utf8"));
let text = readFileSync(file, "utf8");
for (const { from, to, count = 1 } of Array.isArray(parsed) ? parsed : [parsed]) {
  const seen = text.split(from).length - 1;
  if (seen !== count) { console.error(`mutate: expected ${count} occurrence(s) of ${JSON.stringify(from)} in ${file}, found ${seen}`); process.exit(2); }
  text = text.split(from).join(to);
}
writeFileSync(file, text);
console.log(`mutate: applied ${Array.isArray(parsed) ? parsed.length : 1} replacement spec(s) to ${file}`);
```

Write `/private/tmp/osc/mut/mut.sh`:

```bash
#!/bin/bash
# Usage: mut.sh <clone> <name> <relative file> <spec.json> <test file> [<-t pattern>]
# Saves the file, mutates it, runs the criterion, restores with cat, and records sha256 and git diff byte counts.
C=$1; N=$2; F=$3; SPEC=$4; T=$5; P=${6:-}
L=/private/tmp/osc/mut/logs; mkdir -p "$L" "/private/tmp/osc/mut/orig/$N"
cp "$C/$F" "/private/tmp/osc/mut/orig/$N/file"
shasum -a 256 "$C/$F" > "$L/$N.sha-before"
node /private/tmp/osc/mut/mutate.mjs "$C/$F" "$SPEC" > "$L/$N.mutate" 2>&1 || { echo "mutate failed: $N" >> "$L/$N.mutate"; exit 2; }
shasum -a 256 "$C/$F" > "$L/$N.sha-after"
if [ -n "$P" ]; then (cd "$C" && ./node_modules/.bin/vitest run "$T" -t "$P" > "$L/$N.red.log" 2>&1); else (cd "$C" && ./node_modules/.bin/vitest run "$T" > "$L/$N.red.log" 2>&1); fi
echo "rc=$?" > "$L/$N.red.rc"
cat "/private/tmp/osc/mut/orig/$N/file" > "$C/$F"
shasum -a 256 "$C/$F" > "$L/$N.sha-restored"
/usr/bin/git -C "$C" diff > "$L/$N.diff"; /usr/bin/git -C "$C" diff --cached > "$L/$N.cached"
wc -c "$L/$N.diff" "$L/$N.cached" > "$L/$N.restore-bytes"
```
`chmod 700 /private/tmp/osc/mut/mut.sh`. Self-check the runner with a bad spec first: `echo '{"from":"no such text","to":"x"}' > /private/tmp/osc/mut/bad.json; /private/tmp/osc/mut/mut.sh /private/tmp/osc/mut/ccloop selfcheck src/agents/omp.ts /private/tmp/osc/mut/bad.json tests/agents/ompCatalog.test.ts`; expected `exit 2`, `selfcheck.mutate` names "found 0", file untouched (`git diff` 0 bytes).

Baseline green (every file this task mutates against):

```bash
cd /private/tmp/osc/mut/ccloop && ./node_modules/.bin/vitest run tests/agents/ompCatalog.test.ts tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts tests/runtime/omp/ompSingleCall.test.ts tests/control/ompSingleCallWorker.test.ts > /private/tmp/osc/logs/m-baseline.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/m-baseline.log
```
Read it whole: all pass, 0 skipped. `pgrep -fl "fake-omp|worker.js" > /private/tmp/osc/logs/m-pgrep-before.log`.

For every step below: write the spec JSON to `/private/tmp/osc/mut/<name>.json`, run `mut.sh`, then read `<name>.mutate`, `<name>.sha-before`/`-after`/`-restored` (after ≠ before = restored), `<name>.red.log` whole (red **on the named assertion**, not a load error or crash), and `<name>.restore-bytes` (both `0`).

- [ ] **Step 2: Criterion 1, "ignore the row"** — `M1a`, file `src/agents/materialize.ts`, spec `{"from": "(config, row)", "to": "(config, undefined)", "count": 3}`, test `tests/agents/ompSingleCallResolution.test.ts`. Expected red: the three C1 row tests (`[null, null, null]` received for model-a; `[null, …]` windows for the others) and the wire test (`contextWindowTokens: null`).
- [ ] **Step 3: Criterion 1, "drop the openrouter rule"** — `M1b`, file `src/agents/ompModels.ts`, spec `{"from": "row.maxTokens !== null && row.provider !== \"openrouter\" ? \"v1\" : null", "to": "row.maxTokens !== null ? \"v1\" : null"}`, test `tests/agents/ompSingleCallResolution.test.ts`. Expected red: "C1: an openrouter row answers singleCallExecution null…" (`"v1"` received) only.
- [ ] **Step 4: §3.2 strict schema (extra, verification only)** — `M1c`, file `src/control/command.ts`, spec `{"from": "      singleCallOutputCap: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),\n", "to": ""}`, test `tests/agents/ompSingleCallResolution.test.ts`. Expected red: the wire test (`code 1`, `control-response-invalid`).
- [ ] **Step 5: Criterion 2, "accept recomputes from the config"** — `M2`, file `src/control/accept.ts`, spec `{"from": "resolution.singleCallExecution === null", "to": "(await import(\"../agents/registry.js\")).getDescriptor(config.kind).singleCallExecution(config) === null"}`, test `tests/control/ompSingleCallAccept.test.ts`. Expected red: "C2: admits an omp single call whose resolution answers v1…" (`single-call-unsupported` thrown).
- [ ] **Step 6: Criterion 3, "skip the check"** — `M3`, file `src/runtime/omp/ompSingleCall.ts`, spec `{"from": "  if (row.maxTokens > request.maxOutputTokens) throw new OmpSingleCallRefused(\"omp-single-call-cap-exceeded\", `catalog maxTokens ${row.maxTokens} > maxOutputTokens ${request.maxOutputTokens}`);\n", "to": ""}`, tests `tests/runtime/omp/ompSingleCall.test.ts` and (second run, name `M3w`, same spec) `tests/control/ompSingleCallWorker.test.ts`. Expected red: "C3: refuses before spawning…" (resolved instead of refused) and "C3: books 0 and names the cap…" (`["work", 14]` received).
- [ ] **Step 7: Criterion 4, "drop each" (five runs, test `tests/runtime/omp/ompSingleCall.test.ts -t "C4"`)** — file `src/runtime/omp/ompSingleCall.ts`:
  - `M4a` `{"from": "\"--no-lsp\", \"--no-tools\",", "to": "\"--no-lsp\","}`
  - `M4b` `{"from": "\"--no-skills\", \"--no-rules\",", "to": "\"--no-skills\","}`
  - `M4c` `{"from": "\"--no-rules\", \"--no-lsp\",", "to": "\"--no-rules\","}`
  - `M4d` `{"from": ", \"--config\", overlayPath]", "to": "]"}`
  - `M4e` (no `--tools`) `{"from": "\"--no-tools\",\n    \"--no-session\"", "to": "\"--no-tools\", \"--tools\", \"read,grep,glob\",\n    \"--no-session\""}`
  Expected red for each: "C4: passes exactly the single-call argv…" at the `toEqual` of the argv.
- [ ] **Step 8: Criterion 5, one mutation each (test `tests/runtime/omp/ompSingleCall.test.ts -t "C5"`)** — file `src/runtime/omp/ompSingleCall.ts`:
  - `M5a` `{"from": "  if (messages.length > 1) throw Object.assign(new Error(\"omp-single-call-multiple-requests\"), observed);\n", "to": ""}` — red: "C5: refuses two assistant messages…" (decoded, `null` failure).
  - `M5b` `{"from": "  if (toolEvent) throw Object.assign(new Error(\"omp-phase-tool-forbidden\"), observed);\n", "to": ""}` — red: "C5: refuses a tool event…".
  - `M5c` `{"from": "  if (`${message.provider}/${message.model}` !== expectedSelector) throw Object.assign(new Error(\"omp-model-mismatch\"), observed);\n", "to": ""}` — red: "C5: refuses an answer from a different model…".
- [ ] **Step 9: Criterion 6 (test `tests/runtime/omp/ompSingleCall.test.ts -t "C6"`)** — file `src/runtime/omp/ompSingleCall.ts`:
  - `M6a` "treat as complete" (one spec file, two replacements in order): `[{"from": "if (message.stopReason === \"length\") throw", "to": "if (false) throw"}, {"from": "if (message.stopReason !== \"stop\") {", "to": "if (message.stopReason !== \"stop\" && message.stopReason !== \"length\") {"}]` — red: "C6: a length stop is an output-invalid answer…" (`null` failure, the answer decoded).
  - `M6b` "book null": `{"from": "if (message.stopReason === \"length\") throw new SingleCallOutputInvalid(evidenceDir, usage.total, usage.usageEvidence);", "to": "if (message.stopReason === \"length\") throw new SingleCallOutputInvalid(evidenceDir, null, usage.usageEvidence);"}` — red: same test at `tokenUsage: 14` (`null` received).
- [ ] **Step 10: Criterion 7, "return the raw parse" (test `tests/runtime/omp/ompSingleCall.test.ts -t "C7"`)** — `M7`, file `src/runtime/omp/ompSingleCall.ts`, spec `{"from": "return value !== null && typeof value === \"object\" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;", "to": "return value as Record<string, unknown>;"}` — red: "C7: only one plain object…" (array returned) and "C7: an answer that is not one object…" (`[text, false, undefined]`).
- [ ] **Step 11: Close** — `pgrep -fl "fake-omp|worker.js" > /private/tmp/osc/logs/m-pgrep-after.log` (new processes ⇒ report; killing needs the human). Final restore proof for the clone: `/usr/bin/git -C /private/tmp/osc/mut/ccloop diff > /private/tmp/osc/logs/m-final.diff; /usr/bin/git -C /private/tmp/osc/mut/ccloop diff --cached > /private/tmp/osc/logs/m-final.cached; wc -c /private/tmp/osc/logs/m-final.diff /private/tmp/osc/logs/m-final.cached > /private/tmp/osc/logs/m-final.bytes` — both 0. Write the table (name, criterion, red assertion, restore bytes) into the checkpoint. A mutation that stays green is a missing criterion: add the test in the owning task (new test only), re-run that mutation, record both.

---

