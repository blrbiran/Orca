# OMP Single Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Orca session `7ea088aa`, 2026-10-14, written on Orca branch `codex/omp-single-call` at `docs(spec): fold the independent review into the omp single-call design` (`13db3241`). Every line number below was read with `cat -n` / `sed -n` at ccloop `1cefda2` (main) and Orca `13db3241`; re-measure before quoting one.

**Goal:** omp serves Orca's single calls (estimate, clarify, split) bounded by its catalog `maxTokens`, checked again at spawn, with its context window taken from the same catalog row.

**Architecture:** ccloop's catalog reader returns rows; `resolveAgent` hands the selected row to the descriptor, so the resolution itself carries `capabilities.contextWindowTokens`, `singleCallExecution` and a new `singleCallOutputCap`, and `capabilities`/`accept` read those instead of recomputing. `OmpAdapter.singleCall` re-reads the row, refuses before spawning when the cap exceeds the request's `maxOutputTokens`, runs one `omp -p` with tools/rules/LSP off and a `--config` overlay that switches session retry, model fallback, loop guard, advisor and auto-compaction off, then decodes exactly one assistant message under a fail-closed output rule. Orca accepts the new field and sizes and sends `max(preflight.maxOutputTokens, singleCallOutputCap ?? 0)`.

**Tech Stack:** TypeScript (NodeNext ESM), zod 3, vitest (ccloop 2.x, Orca 5.x), node:sqlite control store (Orca), omp 18.10.1 (oh-my-pi, Bun), `tests/fixtures/fake-omp.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-14-omp-single-call-design.md` (Orca). Research note it follows: `docs/superpowers/specs/2026-10-14-omp-single-call-options.md`.

## Global Constraints

- omp argv for a single call, in this order: `--profile <p> --no-extensions --no-skills --no-rules --no-lsp --no-tools --no-session --no-title --no-prewalk --model <m> --mode json -p --system-prompt <file> --cwd <request.cwd> --config <overlay>`; no `--tools` list.
- Timeout of a single call: `min(request.timeoutMs, installation.timeoutMs)`; cwd and runDir are the request's.
- Spawn-time check: re-read the catalog row immediately before spawning; run only when the row exists, `singleCallExecution` would still be `"v1"`, and `0 < row.maxTokens <= request.maxOutputTokens`; otherwise refuse `omp-single-call-cap-exceeded` (or `omp-single-call-unavailable`), `neverStarted` (books 0).
- `singleCallExecution` is `"v1"` only when the row has a `maxTokens` and its provider is not `openrouter`, else null. `contextWindowTokens` is the row's `contextWindow`, else null. `singleCallOutputCap` is the row's `maxTokens` for omp, null for claude and codex.
- A catalog number is used only when it is a positive safe integer.
- Decode, fail closed: exactly one assistant `message_end` (more ⇒ `omp-single-call-multiple-requests`); no `tool_execution_*` event (`omp-phase-tool-forbidden`); `provider/model` equals the selection (`omp-model-mismatch`); `stopReason` `"stop"` decodes, `"length"` ⇒ `SingleCallOutputInvalid`, any other ⇒ `omp-single-call-stop:<reason>`.
- Output rule: the final text, trimmed, with at most one surrounding fenced block removed, must `JSON.parse` to a plain non-array object; anything else is `SingleCallOutputInvalid`.
- Usage: the assistant message's `usage` with the per-model breakdown; output-invalid and decode failures book that observed total; a process that exits non-zero, is aborted or times out books null even after a complete `message_end`; `ompUsageLowerBound` stays diagnostic.
- Orca: `bound = max(preflight.maxOutputTokens, singleCallOutputCap ?? 0)` is the contract/envelope `maxOutputTokens`; `requiredRequestTokens = inputTokens + bound`; the `input-too-large` rule is unchanged (`ESTIMATE_GRANT.tokens` = 250 000).
- Orca: `singleCallOutputCap` is optional, nullable, a positive safe integer; never frozen (like `singleCallExecution`); no persisted schema changes.
- omp's `budgetEnforcement` stays `"soft"` and `requestBoundProof` null: omp serves soft estimate mode only.
- No proxy, no wire-format scope (ruling 3).
- If Task 0 cannot confirm every overlay key, omp keeps answering `singleCallExecution: null` (spec §3.3.3) — see Task 0's stop rule.
- Mutations only in a `git clone --local` copy; restore proven by the byte counts of `git diff` and `git diff --cached` (redirected to files, read whole). `ORCA_CCLOOP_BIN` points at a built ccloop clone, never `node_modules/ccloop`.
- No existing test is rewritten unless the human names it (ccloop Rule 15; Orca Rule 9/11). Every commit message ends with the two trailer lines below. The agent never pushes, merges, or deletes branches/worktrees (ccloop Rule 13, Orca Rule 15); those go to `awaitingHuman`.
- No paid model call (no real `omp -p` against a real provider, no codex/claude prompt) without the human's yes for that run.
- Verification output is redirected to a file and read back whole (never piped through grep/tail/head).

Commit trailer (append to every commit message, after one blank line):

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
```

## Review Focus

1. A catalog row whose `maxTokens`/`contextWindow` is `0`, negative, fractional, a string, or above `Number.MAX_SAFE_INTEGER` must count as absent (no window, no cap, `singleCallExecution: null`), never as a bound — pinned in Task 1.
2. The catalog cannot be read at spawn (non-zero exit, bad JSON) or no longer lists the selected model: the call is refused `omp-single-call-unavailable`, never started, books 0, and no model process is spawned — pinned in Task 4.
3. omp exits non-zero (or is aborted) after printing a complete `message_end`: the call books null, not the printed total, and no output is used — pinned in Task 5.
4. A request whose `timeoutMs` is below the installation's `timeoutMs`: the call is stopped at the request's limit (`omp-timeout`) — pinned in Task 5.
5. A `stopReason` that is not a short word (object, long string): the failure code stays bounded (`omp-single-call-stop:invalid`), never echoes provider text into the call record — pinned in Task 5.

## Interpretations recorded (not in the spec text; reversible, Orca Rule 1 step 2)

- **Catalog read failure at spawn** (§3.3.1 is silent): refused as `omp-single-call-unavailable`, `neverStarted` — the row is not known to exist and nothing was sent.
- **ccloop's strict answer schema** (§3.2 "gains `singleCallOutputCap`"): the field is `.optional()` there, so `tests/control/requestBoundDimensions.test.ts`, whose stand-in answer omits it, keeps passing unchanged (Rule 15). ccloop's own handler always prints it.
- **"accept and the worker use the resolution"** (§3.2 heading): the worker holds no resolution (it reads the sealed config). Its side of the rule is the adapter's spawn-time catalog re-read (§3.3.1). `runSingleCall` (`src/control/singleCall.ts:64-65`) is unchanged.
- **`resolveAgent`'s old `probeModels` injection** (selector list) stays accepted: its rows declare no numbers. New criteria inject `probeCatalog` (rows). This keeps `tests/agents/ompSelection.test.ts` untouched.
- **Decode failures with unusable usage**: an unparseable event line (`omp-events-invalid`), invalid usage (`omp-usage-invalid`) or no assistant message (`omp-no-completion`) books null — there is no observed total to book.
- **The failure code** of a non-`stop`/`length` stop reason is carried as the error's `code` property (`omp-single-call-stop:<reason>`), because `errorCodeOf` (`src/control/singleCall.ts:52-56`) splits a message at the first colon; `<reason>` is the stop reason when it matches `/^[A-Za-z]{1,32}$/`, else `invalid`.
- **Tool events** (§3.3.5): controller ruling 2026-10-14 (session `7ea088aa`, fail closed, reversible): `tool_execution_*`, `extension_ui_request` and any type containing `subagent` are all refused as `omp-phase-tool-forbidden`, as the phase decoder does; the spec's §3.3.5 says the same after this ruling.
- **Clarify/split** freeze the bound at `requirement-open` (DR8 freezes `maxOutputTokens` there today, `src/control/requirementCommands.ts:97`), from the resolution probed at open.

## Existing criteria that change — needs the human to name each

**None is changed by this plan.** The design was chosen so that every existing criterion stays as it is (only tests are added). Checked, with the reason each stays green — the gates in Task 12 confirm:

ccloop:
- `tests/control/singleCallCapability.test.ts` › "C1: answers singleCallExecution beside an unchanged seven-key view: v1 for claude, null for codex" — compares stdout to `{ protocol: 3, ...resolution, singleCallExecution }`; the resolution now carries `singleCallExecution` and `singleCallOutputCap` itself, so the spread keeps the equality.
- `tests/control/singleCallCapability.test.ts` › "C3: accept refuses single-call work for an agent that answers null…" — codex still answers null.
- `tests/control/requestBoundDimensions.test.ts` › "prints a proof whose dimensions are a sorted, unique subset…" — its stand-in answer omits `singleCallOutputCap`; the field is optional in ccloop's schema.
- `tests/agents/ompSelection.test.ts` › "freezes each installation's model and profile…", "rejects fuzzy and thinking-suffixed overrides…" — inject `probeModels: async () => string[]`, still accepted; "keeps a multibyte model ID intact…" — `readOmpModels` still returns `string[]`.
- `tests/runtime/omp/ompPhase.test.ts`, `tests/runtime/omp/ompSkills.test.ts`, `tests/control/ompEndToEnd.test.ts`, `tests/control/ompSkillsDir.test.ts` — the phase argv and files are unchanged by Task 3's extraction.
- ⚠️ **Title drift, assertions unchanged:** `tests/agents/registry.test.ts` › "reports contextWindowTokens only for claude's verified 1M mapping and null otherwise". Its assertions (claude, codex) still hold; its title's "null otherwise" no longer holds for omp. Not edited. The human may name it if the title should be rewritten.

Orca:
- `tests/control/ccloopPort.test.ts` › "asks capabilities about exactly the given selection and returns ccloop's resolution without the protocol tag" — its stand-in (`tests/control/fixtures/fake-ccloop-control.mjs`) emits no `singleCallOutputCap`, so the `toEqual` holds.
- `tests/control/estimator.test.ts` › "freezes exact input formula, contract constants, and checks later degradation"; `tests/control/driverEstimate.test.ts` › "drives an estimate run from starting to a ready estimate…"; `tests/control/driverRequirementClarify.test.ts`, `tests/control/driverRequirementSplit.test.ts`; `tests/control/requirementCommands.test.ts` › "creates a clarifying group with round 1 queued…" — their stand-in resolutions carry no cap, so the bound is the preflight's 64 000 as today.
- After the repin (Task 11), real-ccloop worlds receive `singleCallOutputCap: null` for claude/codex (accepted by the new schema). A world on `tests/fixtures/fake-omp.mjs` now resolves omp with `contextWindowTokens: 200000`, `singleCallExecution: "v1"`, `singleCallOutputCap: 8192` (the fixture's default row). `tests/control/ompSkillsE2E.test.ts` is already a registered environment red with a local `ORCA_CCLOOP_BIN` (`docs/handoff/known-load-flakes.md`); Task 12 reports what it does, no exemption assumed.

Code comments whose meaning drifts (append-only notes, ccloop Rule 16 / Orca Rule 13 spirit): `src/runtime/types.ts:230` (ccloop, `singleCall?` doc) in Task 5; `src/control/requirementRecords.ts:24` (Orca, DR8 doc) in Task 9.

---

## Setup: workspaces (once, before Task 0)

- [ ] **S1: Scratch root for logs, Task 0, mutations, the build clone and the gates** (short real path: tsx sockets, git realpaths)

```bash
test ! -e /private/tmp/osc && mkdir -m 700 /private/tmp/osc /private/tmp/osc/logs /private/tmp/osc/t0 /private/tmp/osc/mut /private/tmp/osc/gate; echo rc=$?
```
Expected: `rc=0`. If `/private/tmp/osc` exists, stop and ask (another session's data).

- [ ] **S2: ccloop worktree on a new branch from ccloop main**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop status --porcelain > /private/tmp/osc/logs/s2-ccloop-status.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop rev-parse main > /private/tmp/osc/logs/s2-ccloop-main.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop worktree add -b codex/omp-single-call /Users/biran/code/skills/orca/ccloop-wt/omp-single-call main > /private/tmp/osc/logs/s2-worktree.log 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/orca/ccloop/node_modules /Users/biran/code/skills/orca/ccloop-wt/omp-single-call/node_modules
```
Read the three logs whole. Expected: status empty; main = `1cefda2…` (record the full sha); worktree added. The node_modules symlink is how `ccloop-wt/omp-updates-timeout` was set up (measured: `node_modules -> /Users/biran/code/skills/orca/ccloop/node_modules`). ccloop needs no `npm install` here (no dependency change).

⚠️ ccloop's `.gitignore` has `node_modules/` (directory pattern), which does **not** match a symlink: `git status` shows `?? node_modules` (measured in `ccloop-wt/omp-updates-timeout`). **Never `git add -A` / `git add .` in the ccloop worktree; add explicit paths only.**

- [ ] **S3: Orca worktree dependencies** (the worktree `/Users/biran/code/skills/orca/Orca-wt/omp-single-call`, branch `codex/omp-single-call`, already holds the spec; it has no `node_modules` today)

```bash
ln -s /Users/biran/code/skills/orca/Orca/node_modules /Users/biran/code/skills/orca/Orca-wt/omp-single-call/node_modules
ln -s /Users/biran/code/skills/orca/Orca/web/node_modules /Users/biran/code/skills/orca/Orca-wt/omp-single-call/web/node_modules
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call status --porcelain > /private/tmp/osc/logs/s3-status.log 2>&1
```
Read the log whole. Expected: only `?? docs/superpowers/plans/2026-10-14-omp-single-call.md` (Orca's `.gitignore` lists `/node_modules` and `/web/node_modules`, which match symlinks — as in `Orca-wt/ui-taste`). Task 11 replaces both symlinks with a real install, because `scripts/pin-ccloop.mjs` runs `npm install`.

- [ ] **S4: Commit this plan on the Orca branch**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add docs/superpowers/plans/2026-10-14-omp-single-call.md
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/s4-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
docs(plan): plan omp single call on its catalog cap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```
Read `s4-diff.log` before committing.

---

### Task 0: Measure the overlay keys, the single POST and the prompt overhead (zero cost, throwaway)

Everything here lives in `/private/tmp/osc/t0` and is thrown away; only the measured values are kept (Step 8). No credentials exist under the scratch HOME and `env -i` strips every provider key and proxy variable, so no request can reach a paid provider. A probe this session saw omp route even `127.0.0.1` through `HTTP_PROXY` and probe ollama/llama.cpp at start: the fake answers every unexpected request with 404 and never crashes; `env -i` leaves `HTTP_PROXY`/`NO_PROXY` unset. No `timeout` binary on this macOS: use `perl -e 'alarm N; exec @ARGV'`.

Candidate keys, read from the installed source (`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src`, omp 18.10.1):
- session auto-retry: `retry.enabled` (`session/settings.ts:680`, default `true`);
- model fallback: `retry.modelFallback` (`session/settings.ts:731`);
- loop guard: `model.loopGuard.enabled` (`session/settings.ts:274`);
- advisor: `advisor.enabled` (`advisor/settings.ts:12`);
- auto-compaction: `compaction.enabled` (`session/context-settings.ts:106`).
`--config <file>` is a YAML overlay, appended to the same list as `PI_CONFIG_FILES` (`config/settings.ts:674-676`) and deep-merged after the main config (`config/settings.ts:2485-2492`); a missing or malformed overlay is a hard error (`config/settings.ts:2501-2505`). JSON is valid YAML.

**Files:** all under `/private/tmp/osc/t0` (nothing in either repository until Step 8).

**Interfaces:**
- Consumes: nothing.
- Produces: the confirmed overlay object used verbatim as `OMP_SINGLE_CALL_OVERLAY` in Task 4 (if it differs from the candidate in Task 4's code, Task 4 uses the measured one); the measured numbers appended to the spec as §7.

- [ ] **Step 1: Re-read the five setting ids on the installed version (source is the evidence)**

```bash
cd /Users/biran/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src && /usr/bin/grep -n 'id: "retry.enabled"\|id: "retry.modelFallback"\|id: "model.loopGuard.enabled"\|id: "advisor.enabled"\|id: "compaction.enabled"\|id: "contextPromotion.enabled"' session/settings.ts session/context-settings.ts advisor/settings.ts > /private/tmp/osc/t0/ids.log 2>&1; echo rc=$?
/Users/biran/.bun/bin/omp --version > /private/tmp/osc/t0/version.log 2>&1
```
Read both whole. Expected: six hits; version `18.10.1`. (`contextPromotion.enabled` is recorded for Step 7's question, not added to the overlay.)

- [ ] **Step 2: Scratch HOME with the operator's real `config.yml` (copied, never printed) and a fake provider**

```bash
mkdir -m 700 -p /private/tmp/osc/t0/home/.omp/agent /private/tmp/osc/t0/tmp /private/tmp/osc/t0/cwd
install -m 600 /Users/biran/.omp/agent/config.yml /private/tmp/osc/t0/home/.omp/agent/config.yml
shasum -a 256 /Users/biran/.omp/agent/config.yml /private/tmp/osc/t0/home/.omp/agent/config.yml > /private/tmp/osc/t0/config-sha.log 2>&1
```
Read `config-sha.log`: the two hashes are equal. Do not `cat` either file.

Write `/private/tmp/osc/t0/fake-anthropic.mjs`:

```js
// A local Anthropic-messages stand-in. Usage: node fake-anthropic.mjs <port-file> <log-file> <mode>
// mode: "ok" (one complete answer) or "drop-after-text" (streams some text, then destroys the socket).
// Logs method, url and body of every request (never headers: no key is logged). Unexpected requests get 404.
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [portFile, logFile, mode = "ok"] = process.argv.slice(2);
let posts = 0;
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    appendFileSync(logFile, `${JSON.stringify({ method: req.method, url: req.url, bytes: body.length, body: body.toString("utf8") })}\n`);
    if (req.method !== "POST" || !/\/messages(\?|$)/.test(req.url ?? "")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    posts += 1;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("message_start", { type: "message_start", message: { id: `msg_${posts}`, type: "message", role: "assistant", model: "fake-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 1 } } });
    send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{\"answer\":" } });
    if (mode === "drop-after-text") { setTimeout(() => res.socket?.destroy(), 50); return; }
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "\"42\"}" } });
    send("content_block_stop", { type: "content_block_stop", index: 0 });
    send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
    send("message_stop", { type: "message_stop" });
    res.end();
  });
  req.on("error", () => {});
});
server.on("clientError", (_error, socket) => socket.destroy());
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
```

Write `/private/tmp/osc/t0/measure.mjs`:

```js
// Usage: node measure.mjs <server-log> <prompt-file>. Prints every request line and the first model POST's sizes.
import { readFileSync } from "node:fs";

const [log, promptFile] = process.argv.slice(2);
const rows = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const posts = rows.filter((row) => row.method === "POST" && /\/messages(\?|$)/.test(row.url));
const promptBytes = Buffer.byteLength(readFileSync(promptFile, "utf8"));
const out = { requests: rows.map((row) => `${row.method} ${row.url}`), modelPosts: posts.length };
if (posts.length > 0) {
  const body = JSON.parse(posts[0].body);
  const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? null);
  out.first = {
    bodyBytes: posts[0].bytes, promptBytes, overheadBytes: posts[0].bytes - promptBytes, systemBytes: Buffer.byteLength(system),
    max_tokens: body.max_tokens, tools: body.tools ?? "absent", model: body.model,
    messageCount: Array.isArray(body.messages) ? body.messages.length : null,
  };
}
console.log(JSON.stringify(out, null, 2));
```

- [ ] **Step 3: Inputs exactly as ccloop will send them** (the estimate's real response schema; the system prompt text is Task 4's `singleCallSystemPrompt`, copied literally)

```bash
cd /Users/biran/code/skills/orca/Orca && ./node_modules/.bin/tsx -e 'import { BUDGET_ESTIMATE_JSON_SCHEMA } from "/Users/biran/code/skills/orca/Orca/src/control/estimatePrompt.ts"; process.stdout.write(JSON.stringify(BUDGET_ESTIMATE_JSON_SCHEMA));' > /private/tmp/osc/t0/schema.json 2> /private/tmp/osc/t0/schema.err; echo rc=$?
node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync("/private/tmp/osc/t0/schema.json","utf8"));fs.writeFileSync("/private/tmp/osc/t0/system-prompt.md",["This invocation is one ccloop single call: answer the user prompt once, with no tools and no follow-up.","Reply with exactly one JSON object that satisfies the JSON Schema below, and nothing else: no prose before or after it.",JSON.stringify(s)].join("\n"));fs.writeFileSync("/private/tmp/osc/t0/prompt.txt","Reply with {\"answer\":\"42\"}.\n");fs.writeFileSync("/private/tmp/osc/t0/overlay.yml",JSON.stringify({retry:{enabled:false,modelFallback:false},model:{loopGuard:{enabled:false}},advisor:{enabled:false},compaction:{enabled:false}})+"\n");'
```
Expected: `rc=0`, `schema.err` empty.

- [ ] **Step 4: Overlay keys as omp resolves them, on top of the real config.yml** — save as `/private/tmp/osc/t0/step4.sh` and run `/bin/bash /private/tmp/osc/t0/step4.sh` (the tool shell is zsh; these are bash arrays):

```bash
#!/bin/bash
for key in retry.enabled retry.modelFallback model.loopGuard.enabled advisor.enabled compaction.enabled contextPromotion.enabled; do
  for overlay in none flag env; do
    case $overlay in
      none) extra=(); envx=();;
      flag) extra=(--config /private/tmp/osc/t0/overlay.yml); envx=();;
      env) extra=(); envx=(PI_CONFIG_FILES=/private/tmp/osc/t0/overlay.yml);;
    esac
    env -i PATH=/Users/biran/.bun/bin:/usr/bin:/bin HOME=/private/tmp/osc/t0/home PI_CODING_AGENT_DIR=/private/tmp/osc/t0/home/.omp/agent TMPDIR=/private/tmp/osc/t0/tmp OMP_PROFILE=default "${envx[@]}" \
      perl -e 'alarm 60; exec @ARGV' /Users/biran/.bun/bin/omp --no-extensions --profile default "${extra[@]}" config get "$key" --json \
      > "/private/tmp/osc/t0/get-$key-$overlay.out" 2> "/private/tmp/osc/t0/get-$key-$overlay.err"
    echo "$key $overlay rc=$?" >> /private/tmp/osc/t0/get.rc
  done
done
```
Read `get.rc` and every `.out`/`.err` whole. A key is **confirmed** when `none` answers the operator's effective value and `flag` (or, if `config get` ignores `--config`, `env` — same list per `config/settings.ts:674-676`) answers `false`. Record for each key: the value under `none`, under `flag`, under `env`.

- [ ] **Step 5: Exactly one model POST with the overlay — and what the overlay changes**

`models.yaml` is written after the fake starts (its port is dynamic). Save as `/private/tmp/osc/t0/step5.sh` and run `/bin/bash /private/tmp/osc/t0/step5.sh`:

```bash
#!/bin/bash
for spec in ok-yes:ok:yes drop-yes:drop-after-text:yes drop-no:drop-after-text:no; do
IFS=: read -r run mode overlay <<< "$spec"
rm -f /private/tmp/osc/t0/port /private/tmp/osc/t0/$run.server.log
node /private/tmp/osc/t0/fake-anthropic.mjs /private/tmp/osc/t0/port /private/tmp/osc/t0/$run.server.log $mode > /private/tmp/osc/t0/$run.fake.log 2>&1 &
fake=$!; for i in 1 2 3 4 5 6 7 8 9 10; do test -s /private/tmp/osc/t0/port && break; sleep 0.2; done
port=$(cat /private/tmp/osc/t0/port)
printf 'providers:\n  fake:\n    baseUrl: http://127.0.0.1:%s\n    apiKey: fake-key-not-a-secret\n    api: anthropic-messages\n    models:\n      - id: fake-model\n        contextWindow: 100000\n        maxTokens: 1234\n' "$port" > /private/tmp/osc/t0/home/.omp/agent/models.yaml
cfg=(); test $overlay = yes && cfg=(--config /private/tmp/osc/t0/overlay.yml)
env -i PATH=/Users/biran/.bun/bin:/usr/bin:/bin HOME=/private/tmp/osc/t0/home PI_CODING_AGENT_DIR=/private/tmp/osc/t0/home/.omp/agent TMPDIR=/private/tmp/osc/t0/tmp OMP_PROFILE=default \
  perl -e 'alarm 180; exec @ARGV' /Users/biran/.bun/bin/omp --profile default --no-extensions --no-skills --no-rules --no-lsp --no-tools \
  --no-session --no-title --no-prewalk --model fake/fake-model --mode json -p --system-prompt /private/tmp/osc/t0/system-prompt.md \
  --cwd /private/tmp/osc/t0/cwd "${cfg[@]}" < /private/tmp/osc/t0/prompt.txt > /private/tmp/osc/t0/$run.events 2> /private/tmp/osc/t0/$run.stderr
echo "$run rc=$?" >> /private/tmp/osc/t0/runs.rc
kill $fake
node /private/tmp/osc/t0/measure.mjs /private/tmp/osc/t0/$run.server.log /private/tmp/osc/t0/prompt.txt > /private/tmp/osc/t0/$run.measure.json 2>&1
done
```
Read `runs.rc`, each `.events`, `.stderr` and `.measure.json` whole. Expected:
- `ok-yes`: rc 0; `modelPosts: 1`; `max_tokens: 1234` (the catalog cap, §2); `tools` `[]` or `"absent"`; events contain exactly one assistant `message_end` with `stopReason: "stop"`, `provider: "fake"`, `model: "fake-model"`, and its `usage`.
- `drop-yes`: `modelPosts: 1` (session auto-retry off).
- `drop-no`: `modelPosts` > 1 (retry on without the overlay: the overlay is what changes it). If it is also 1, record that `retry.enabled` is confirmed by Step 4 only.
- Any GET/other request in `requests` is listed and recorded (ollama/llama.cpp probes go to other ports and do not appear here).

- [ ] **Step 6: Overhead against the operator's `framingTokenOverhead`**

```bash
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("/Users/biran/.orca/profile.json","utf8"));const find=(v)=>{if(v&&typeof v==="object"){if(Object.hasOwn(v,"estimatorPreflight"))return v.estimatorPreflight;for(const x of Object.values(v)){const r=find(x);if(r!==undefined)return r;}}return undefined;};const e=find(p);console.log(JSON.stringify(e===undefined?"absent":e===null?null:{maxOutputTokens:e.maxOutputTokens,framingTokenOverhead:e.framingTokenOverhead,tokenizer:e.tokenizer}));' > /private/tmp/osc/t0/preflight.json 2>&1; echo rc=$?
```
Read it whole (only those numbers are printed). From `ok-yes.measure.json`: `overheadTokensUpperBound = ceil(overheadBytes × numerator / denominator)` (the operator's `utf8-upper-bound` tokenizer). It covers when `overheadTokensUpperBound <= framingTokenOverhead`. If not covered, or the preflight is absent/null, record it as a finding for the human (`~/.orca/profile.json` is the operator's file; the agent does not change it).

- [ ] **Step 7: Flags accepted**

```bash
env -i PATH=/Users/biran/.bun/bin:/usr/bin:/bin HOME=/private/tmp/osc/t0/home TMPDIR=/private/tmp/osc/t0/tmp perl -e 'alarm 60; exec @ARGV' /Users/biran/.bun/bin/omp --help > /private/tmp/osc/t0/help.txt 2>&1; echo rc=$?
```
Read `help.txt` whole: `--no-rules`, `--no-lsp`, `--no-tools`, `--config` are listed. Step 5's `ok-yes` exiting 0 with all of them is the acceptance proof. Record `contextPromotion.enabled`'s effective value from Step 4: if it is `true` under the real config, report it to the human as a possible second request not covered by the spec's overlay list (the `modelPosts` count of Step 5 is the empirical check).

- [ ] **Step 8: Stop rule, then record**

**Stop rule:** if any of the five keys is not confirmed in Step 4, or `ok-yes`/`drop-yes` shows more than one model POST, **stop here**: write the findings to the human, keep omp at `singleCallExecution: null` (spec §3.3.3), and do not start Task 1 until the human rules (the design changes).

Otherwise append to the Orca spec (append-only, Orca Rule 13) a new section:

```markdown
## 7. Task 0 measurements (session <id>, <date>; Orca commit <sha>, omp 18.10.1; raw logs were in /private/tmp/osc/t0, gone)

- Overlay (confirmed; `config get` under the real config.yml, by `--config`|`PI_CONFIG_FILES`): <the overlay JSON>.
  Per key, none → overlay: retry.enabled <a → b>; retry.modelFallback <…>; model.loopGuard.enabled <…>; advisor.enabled <…>; compaction.enabled <…>.
- Model POSTs (fake Anthropic server, ccloop's argv): ok+overlay <n>; drop-after-text+overlay <n>; drop-after-text, no overlay <n>. `max_tokens` sent: <n> (catalog 1234). `tools`: <value>.
- Request body <bodyBytes> B, prompt <promptBytes> B, overhead <overheadBytes> B (system <systemBytes> B, BUDGET_ESTIMATE_JSON_SCHEMA embedded) ⇒ ≤ <tokens> tokens at <num>/<den>; operator framingTokenOverhead <value> ⇒ <covers | does not cover>.
- contextPromotion.enabled under the real config: <value>.
- Commands: plan `docs/superpowers/plans/2026-10-14-omp-single-call.md` Task 0 Steps 4-7.
```

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add docs/superpowers/specs/2026-10-14-omp-single-call-design.md
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t0-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
docs(spec): record the omp single-call Task 0 measurements

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```
Read `t0-diff.log` first: only lines added at the end of the spec.

---

### Task 1 (ccloop): Catalog rows

**Files:**
- Modify: `src/agents/types.ts` (add `CatalogRowV1` after `CapabilityViewV1`, line 32)
- Modify: `src/agents/ompModels.ts:1-64` (`readOmpCatalog`, `readOmpModels` on top of it, `ompSingleCallExecution`)
- Test: `tests/agents/ompCatalog.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface CatalogRowV1 { selector: string; provider: string; contextWindow: number | null; maxTokens: number | null }` in `src/agents/types.ts`.
  - `export async function readOmpCatalog(installation: InstallationV1): Promise<CatalogRowV1[]>` in `src/agents/ompModels.ts`.
  - `export async function readOmpModels(installation: InstallationV1): Promise<string[]>` (unchanged signature).
  - `export function ompSingleCallExecution(row: CatalogRowV1 | undefined): "v1" | null`.

- [ ] **Step 1: Write the failing test** — `tests/agents/ompCatalog.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ompSingleCallExecution, readOmpCatalog, readOmpModels } from "../../src/agents/ompModels.js";
import type { InstallationV1 } from "../../src/agents/types.js";

// OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.1): the catalog's one spawn gives rows, and a number is
// used only when it is a positive safe integer -- so a malformed or absent value can never become a context window or the
// output bound Orca books. §3.2: only a row that declares the cap pi-ai sends, from a provider other than openrouter (for
// which pi-ai sends no cap without an explicit one), may answer "v1".
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function catalogInstallation(models: unknown[]): Promise<InstallationV1> {
  const dir = await mkdtemp(join(tmpdir(), "ccloop-omp-rows-"));
  dirs.push(dir);
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("models")) { process.stdout.write(${JSON.stringify(`${JSON.stringify({ models })}\n`)}); process.exit(0); }
process.exit(2);
`, { mode: 0o700 });
  return { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 10_000, killGraceMs: 50, defaultModel: "gateway/a", profile: null };
}
const row = (provider: string, id: string, numbers: Record<string, unknown>) => ({ provider, id, selector: `${provider}/${id}`, kind: "chat", ...numbers });

describe("OMP catalog rows (omp single call §3.1)", () => {
  it("keeps contextWindow and maxTokens only when each is a positive safe integer, with the row's provider", async () => {
    const installation = await catalogInstallation([
      row("gateway", "a", { contextWindow: 200_000, maxTokens: 8_192 }),
      row("gateway", "zero", { contextWindow: 0, maxTokens: 0 }),
      row("gateway", "negative", { contextWindow: -1, maxTokens: -5 }),
      row("gateway", "fraction", { contextWindow: 1.5, maxTokens: 2.5 }),
      row("gateway", "string", { contextWindow: "128000", maxTokens: "16384" }),
      row("gateway", "unsafe", { contextWindow: 2 ** 53, maxTokens: 2 ** 53 }),
      row("gateway", "absent", {}),
      row("openrouter", "vendor/m", { contextWindow: 64_000, maxTokens: 4_096 }),
    ]);
    const none = { contextWindow: null, maxTokens: null };
    expect(await readOmpCatalog(installation)).toEqual([
      { selector: "gateway/a", provider: "gateway", contextWindow: 200_000, maxTokens: 8_192 },
      { selector: "gateway/zero", provider: "gateway", ...none },
      { selector: "gateway/negative", provider: "gateway", ...none },
      { selector: "gateway/fraction", provider: "gateway", ...none },
      { selector: "gateway/string", provider: "gateway", ...none },
      { selector: "gateway/unsafe", provider: "gateway", ...none },
      { selector: "gateway/absent", provider: "gateway", ...none },
      { selector: "openrouter/vendor/m", provider: "openrouter", contextWindow: 64_000, maxTokens: 4_096 },
    ]);
    // The selector-list callers (detect, updates, older criteria) keep exactly what they had: the selectors, in order.
    expect(await readOmpModels(installation)).toEqual([
      "gateway/a", "gateway/zero", "gateway/negative", "gateway/fraction", "gateway/string", "gateway/unsafe", "gateway/absent", "openrouter/vendor/m",
    ]);
  });

  it("still refuses a row whose selector is not provider/id, from both readers", async () => {
    const installation = await catalogInstallation([{ provider: "gateway", id: "a", selector: "gateway/b", maxTokens: 8 }]);
    await expect(readOmpCatalog(installation)).rejects.toThrow("omp-model-catalog-invalid");
    await expect(readOmpModels(installation)).rejects.toThrow("omp-model-catalog-invalid");
  });

  it("answers v1 only for a row with a cap whose provider is not openrouter", () => {
    expect(ompSingleCallExecution({ selector: "gateway/a", provider: "gateway", contextWindow: null, maxTokens: 8_192 })).toBe("v1");
    expect(ompSingleCallExecution({ selector: "gateway/a", provider: "gateway", contextWindow: 200_000, maxTokens: null })).toBeNull();
    expect(ompSingleCallExecution({ selector: "openrouter/vendor/m", provider: "openrouter", contextWindow: 64_000, maxTokens: 4_096 })).toBeNull();
    expect(ompSingleCallExecution(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompCatalog.test.ts > /private/tmp/osc/logs/t1-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t1-red.log
```
Read the whole log; its `RUN` line names `/Users/biran/code/skills/orca/ccloop-wt/omp-single-call`. Expected: FAIL — `readOmpCatalog`/`ompSingleCallExecution` are not exported (`is not a function`).

- [ ] **Step 3: Implement**

`src/agents/types.ts`, insert after the `CapabilityViewV1` interface (after line 32):

```ts
/**
 * OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.1): one row of a kind's model catalog, as ccloop uses
 * it. A number is kept only when the catalog gave a positive safe integer; anything else is null.
 */
export interface CatalogRowV1 { selector: string; provider: string; contextWindow: number | null; maxTokens: number | null }
```

`src/agents/ompModels.ts`: change line 2 to `import type { CatalogRowV1, InstallationV1 } from "./types.js";` and replace lines 50-64 (`readOmpModels`) with:

```ts
const positiveSafe = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

/**
 * OMP single call (Orca spec 2026-10-14 §3.1): the catalog's rows from its one spawn, read under the same structured
 * profile/configuration as a phase. A number is kept only when it is a positive safe integer. This never sends a model prompt.
 */
export async function readOmpCatalog(installation: InstallationV1): Promise<CatalogRowV1[]> {
  const parsed = await runOmpJson(installation, ["models", "--json"]);
  if (parsed === null || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) throw new Error("omp-model-catalog-invalid");
  const rows = (parsed as { models: unknown[] }).models.map((row): CatalogRowV1 => {
    if (row === null || typeof row !== "object") throw new Error("omp-model-catalog-invalid");
    const value = row as Record<string, unknown>;
    if (typeof value.provider !== "string" || typeof value.id !== "string" || typeof value.selector !== "string"
      || value.selector !== `${value.provider}/${value.id}` || value.selector.length > 200) throw new Error("omp-model-catalog-invalid");
    return { selector: value.selector, provider: value.provider, contextWindow: positiveSafe(value.contextWindow), maxTokens: positiveSafe(value.maxTokens) };
  });
  if (new Set(rows.map((row) => row.selector)).size !== rows.length) throw new Error("omp-model-catalog-invalid");
  return rows;
}

/** Read the catalog under the same structured profile/configuration as a phase. This never sends a model prompt. */
export async function readOmpModels(installation: InstallationV1): Promise<string[]> {
  return (await readOmpCatalog(installation)).map((row) => row.selector);
}

/**
 * OMP single call (Orca spec 2026-10-14 §2, §3.2): "v1" only when the row declares the cap pi-ai sends (maxTokens) and its
 * provider is not openrouter, for which pi-ai sends no cap unless one is given explicitly.
 */
export function ompSingleCallExecution(row: CatalogRowV1 | undefined): "v1" | null {
  return row !== undefined && row.maxTokens !== null && row.provider !== "openrouter" ? "v1" : null;
}
```

- [ ] **Step 4: Run it green, with the selector callers' criteria**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompCatalog.test.ts tests/agents/ompSelection.test.ts tests/agents/ompDetect.test.ts tests/agents/ompUpdates.test.ts > /private/tmp/osc/logs/t1-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t1-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t1-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t1-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`. (`ompUpdates` "preserves the unavailable reason…" is a registered load timeout; if it alone times out, rerun the file alone per `known-load-flakes.md`.)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/agents/types.ts src/agents/ompModels.ts tests/agents/ompCatalog.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t1-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): read the model catalog as rows with their window and cap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```
Read `t1-diff.log` before committing.

---

### Task 2 (ccloop): The resolution decides; capabilities and accept use it (criteria 1, 2)

**Files:**
- Modify: `src/agents/types.ts:39-45` (`AgentResolutionV1`)
- Modify: `src/agents/registry.ts:34-40` (descriptor methods take the row; new `singleCallOutputCap`)
- Modify: `src/agents/omp.ts:1-43`, `src/agents/claude.ts:72-76`, `src/agents/codex.ts:52-56`
- Modify: `src/agents/materialize.ts:1-128` (`resolveAgent`)
- Modify: `src/control/command.ts:89-99` (schema), `:250-256` (handler)
- Modify: `src/control/accept.ts:6`, `:86-90`
- Modify: `tests/fixtures/fake-omp.mjs:10,17-21` (catalog override; fixture, not a criterion; default row unchanged)
- Test: `tests/agents/ompSingleCallResolution.test.ts` (new), `tests/control/ompSingleCallAccept.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `CatalogRowV1`, `readOmpCatalog`, `readOmpModels`, `ompSingleCallExecution`.
- Produces:
  - `AgentResolutionV1` gains `singleCallExecution: "v1" | null` and `singleCallOutputCap: number | null`.
  - `AgentDescriptor.capabilities(config, row?: CatalogRowV1)`, `.singleCallExecution(config, row?: CatalogRowV1)`, new `.singleCallOutputCap(config, row?: CatalogRowV1): number | null`.
  - `resolveAgent(table, partial, deps?: { probeVersion?; probeModels?: typeof readOmpModels; probeCatalog?: typeof readOmpCatalog })`.
  - `control capabilities` prints `{ protocol: 3, ...resolution }`; accept refuses on `resolution.singleCallExecution === null`.
  - Fake omp: `<marker>.catalog.json` (a JSON array of rows), when present, is the catalog.

- [ ] **Step 1: Extend the fake omp's catalog** — `tests/fixtures/fake-omp.mjs`: change line 10 to

```js
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
```

and replace lines 17-21 with:

```js
// OMP single call (Orca spec 2026-10-14 §5): `<marker>.catalog.json`, when present, is the catalog's rows; without it the
// one row below, as before.
if (args.includes("models")) {
  const rows = existsSync(`${marker}.catalog.json`) ? JSON.parse(readFileSync(`${marker}.catalog.json`, "utf8"))
    : [{ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 }];
  process.stdout.write(`${JSON.stringify({ models: rows })}\n`);
  process.exit(0);
}
```

- [ ] **Step 2: Write the failing criterion 1** — `tests/agents/ompSingleCallResolution.test.ts`:

```ts
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeDescriptor } from "../../src/agents/claude.js";
import { codexDescriptor } from "../../src/agents/codex.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import type { CatalogRowV1, InstallationV1, MaterializedAgentConfigV1 } from "../../src/agents/types.js";
import { runControlCommand } from "../../src/control/command.js";
import { writeAgentsTable } from "../control/agentsFixture.js";

// OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.2, criterion 1): the selected catalog row decides the
// resolution's context window, its single-call answer and the cap that call runs under -- Orca sizes the estimate by the
// cap, and refuses the call by the answer -- so a resolution that ignored the row would let omp run unbounded or never.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const installation: InstallationV1 = {
  kind: "omp", command: ["/opt/omp"], version: "18.10.1", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000, defaultModel: "gateway/model-a", profile: null,
};
const table = { schema: "ccloop-agents-table-v1" as const, installations: { work: installation } };
const rows: CatalogRowV1[] = [
  { selector: "gateway/model-a", provider: "gateway", contextWindow: 200_000, maxTokens: 8_192 },
  { selector: "gateway/no-cap", provider: "gateway", contextWindow: 128_000, maxTokens: null },
  { selector: "openrouter/vendor/m", provider: "openrouter", contextWindow: 64_000, maxTokens: 4_096 },
];
const deps = { probeVersion: async () => "18.10.1", probeCatalog: async () => rows };

describe("the omp resolution takes its numbers from the selected catalog row (criterion 1)", () => {
  it("C1: a row with a cap answers its window, v1 and its cap", async () => {
    const { resolution } = await resolveAgent(table, { agent: "work" }, deps);
    expect([resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual([200_000, "v1", 8_192]);
  });

  it("C1: a row without maxTokens answers null for both, keeping its window", async () => {
    const { resolution } = await resolveAgent(table, { agent: "work", model: "gateway/no-cap" }, deps);
    expect([resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual([128_000, null, null]);
  });

  it("C1: an openrouter row answers singleCallExecution null although it declares a cap", async () => {
    const { resolution } = await resolveAgent(table, { agent: "work", model: "openrouter/vendor/m" }, deps);
    expect([resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual([64_000, null, 4_096]);
  });

  it("still refuses a model the catalog does not list, by name", async () => {
    await expect(resolveAgent(table, { agent: "work", model: "gateway/absent" }, deps)).rejects.toMatchObject({ code: "agent-selection-invalid" });
  });

  it("leaves claude's and codex's cap null: their calls honour the request's maxOutputTokens", () => {
    const config = (kind: "claude" | "codex"): MaterializedAgentConfigV1 => ({
      schema: "ccloop-agent-config-v1", kind,
      installation: { kind, command: ["/bin/echo"], version: "1.2.3", configDir: null, timeoutMs: 1000, killGraceMs: 50, ...(kind === "codex" ? { sandbox: "workspace-write", budgetMode: "soft" } : {}) },
      selection: { agent: kind, model: kind === "claude" ? "claude-opus-5-5" : "gpt-6-sol", contextWindow: "agent-default" },
    });
    expect([claudeDescriptor.singleCallOutputCap(config("claude")), codexDescriptor.singleCallOutputCap(config("codex"))]).toEqual([null, null]);
  });

  it("C1 on the wire: control capabilities prints the row's values through ccloop's strict answer schema", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-resolution-wire-")));
    dirs.push(dir);
    const marker = join(dir, "omp-marker");
    await writeFile(`${marker}.catalog.json`, JSON.stringify([{ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 }]));
    const binary = join(dir, "omp");
    await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
    const { path } = await writeAgentsTable({ omp: { ...installation, command: [binary], timeoutMs: 10_000, killGraceMs: 50 } }, dir);
    const result = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "omp" } }));
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ protocol: 3, capabilities: { contextWindowTokens: 200_000 }, singleCallExecution: "v1", singleCallOutputCap: 8_192 });
  });
});
```

- [ ] **Step 3: Write the failing criterion 2** — `tests/control/ompSingleCallAccept.test.ts`:

```ts
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { acceptStart } from "../../src/control/accept.js";
import { runControlCommand } from "../../src/control/command.js";
import { singleCallEnvelope, writeAgentsTable } from "./agentsFixture.js";

// OMP single call (Orca spec 2026-10-14 §3.2, criterion 2): accept refuses single-call work by the resolution's answer --
// for omp, the selected catalog row's -- not by the installation's config alone, which cannot tell a row with a cap from
// one without. Both directions are pinned: a config-only answer would refuse the admitted call too.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    let pid: number | undefined;
    try {
      pid = (JSON.parse(await readFile(join(dir, "control", "accepted.json"), "utf8")) as { worker?: { pid?: number } }).worker?.pid;
    } catch {}
    for (const deadline = Date.now() + 10_000; pid !== undefined && Date.now() < deadline; await new Promise((r) => setTimeout(r, 20))) {
      try { process.kill(pid, 0); } catch { break; }
    }
    await rm(dir, { recursive: true, force: true });
  }
});

async function ompTable() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-accept-")));
  dirs.push(dir);
  const marker = join(dir, "omp-marker");
  await writeFile(`${marker}.catalog.json`, JSON.stringify([
    { provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 },
    { provider: "gateway", kind: "chat", id: "no-cap", selector: "gateway/no-cap", contextWindow: 128000 },
  ]));
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  return await writeAgentsTable({
    omp: { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 10_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
  }, dir);
}
async function sourceDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-accept-source-")));
  dirs.push(dir);
  return dir;
}

describe("accept uses the resolution for omp single calls (criterion 2)", { timeout: 30_000 }, () => {
  it("C2: refuses an omp single call whose resolution answers null, by name and before anything is persisted", async () => {
    const { path, table } = await ompTable();
    const source = await sourceDir();
    const { resolution } = await resolveAgent(table, { agent: "omp", model: "gateway/no-cap" });
    expect(resolution.singleCallExecution).toBeNull();
    const envelope = singleCallEnvelope({ sourceDir: source, agent: resolution.selection, configHash: resolution.configHash });
    expect(await runControlCommand(["accept", "--agents", path], JSON.stringify(envelope))).toEqual({ code: 2, stdout: "", stderr: "single-call-unsupported\n" });
    expect(await readdir(source)).toEqual([]);
  });

  it("C2: admits an omp single call whose resolution answers v1 and seals its envelope", async () => {
    const { path, table } = await ompTable();
    const source = await sourceDir();
    const { resolution } = await resolveAgent(table, { agent: "omp" });
    expect(resolution.singleCallExecution).toBe("v1");
    const envelope = singleCallEnvelope({ sourceDir: source, agent: resolution.selection, configHash: resolution.configHash });
    const status = await acceptStart(envelope, {
      agentsTablePath: path,
      workerCommand: [resolve("node_modules/.bin/tsx"), resolve("tests/fixtures/control-worker.mjs")],
      receiptTimeoutMs: 2_000,
    });
    expect(status.kind).toBe("accepted");
    expect(JSON.parse(await readFile(join(source, "control", "envelope.json"), "utf8"))).toEqual(envelope);
  });
});
```

- [ ] **Step 4: Run both red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts > /private/tmp/osc/logs/t2-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t2-red.log
```
Read it whole. Expected red on: C1 values (`[null, undefined, undefined]` received), the `singleCallOutputCap is not a function` test, the wire test (`singleCallExecution: null`, no cap), C2 admission (`single-call-unsupported` thrown: omp answers null today). C2 refusal and "still refuses a model the catalog does not list" may already be green (they hold today); that is expected — their reds come from the Task 6 mutations.

- [ ] **Step 5: Implement**

`src/agents/types.ts` — replace `AgentResolutionV1` (lines 39-45):

```ts
export interface AgentResolutionV1 {
  selection: AgentSelectionV1;
  configHash: string;
  timeoutMs: number;
  killGraceMs: number;
  capabilities: CapabilityViewV1;
  /** Orca single-call estimate (2026-09-27) §4.4; decided at resolution since OMP single call (Orca spec 2026-10-14 §3.2). */
  singleCallExecution: "v1" | null;
  /** OMP single call (Orca spec 2026-10-14 §3.2): the cap the call actually runs under; null = it honours the request's maxOutputTokens. Never frozen. */
  singleCallOutputCap: number | null;
}
```

`src/agents/registry.ts` — line 9-12 import adds `type CatalogRowV1,`; line 34 becomes

```ts
  /** `row` is the selected catalog row for a kind that has a catalog (omp, OMP single call 2026-10-14 §3.2), else undefined. */
  capabilities(config: MaterializedAgentConfigV1, row?: CatalogRowV1): CapabilityViewV1;
```

line 40 becomes `singleCallExecution(config: MaterializedAgentConfigV1, row?: CatalogRowV1): "v1" | null;` and after it add:

```ts
  /**
   * OMP single call (Orca spec 2026-10-14 §3.2): the output cap the kind's single call actually runs under, from its catalog
   * row; null means the call honours the request's maxOutputTokens. A sibling of singleCallExecution: never in the
   * seven-key view, never frozen.
   */
  singleCallOutputCap(config: MaterializedAgentConfigV1, row?: CatalogRowV1): number | null;
```

`src/agents/claude.ts` — after `singleCallExecution() { return "v1"; },` (line 74-76) add:

```ts
  // OMP single call (Orca spec 2026-10-14 §3.2): CLAUDE_CODE_MAX_OUTPUT_TOKENS takes the request's own cap.
  singleCallOutputCap() {
    return null;
  },
```

`src/agents/codex.ts` — after `singleCallExecution() { return null; },` (line 54-56) add:

```ts
  // OMP single call (Orca spec 2026-10-14 §3.2): codex runs no single call; nothing to bound.
  singleCallOutputCap() {
    return null;
  },
```

`src/agents/omp.ts` — add `import { ompSingleCallExecution } from "./ompModels.js";` after line 4; replace lines 30-41 with:

```ts
  capabilities(_config, row) {
    return {
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "unavailable",
      handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      // OMP single call (Orca spec 2026-10-14 §1.2, §3.2): the selected catalog row's window, omp's defaults included.
      contextWindowTokens: row?.contextWindow ?? null,
      requestBoundProof: null,
    };
  },
  singleCallExecution(_config, row) { return ompSingleCallExecution(row); },
  singleCallOutputCap(_config, row) { return row?.maxTokens ?? null; },
```

`src/agents/materialize.ts` — line 5 becomes `import { readOmpCatalog, readOmpModels } from "./ompModels.js";`; the type import (lines 7-14) adds `type CatalogRowV1,`; replace lines 87-128 (`resolveAgent`) with:

```ts
export async function resolveAgent(
  table: AgentsTableV1,
  partial: PartialSelectionV1,
  deps: {
    probeVersion?: (command: string[]) => Promise<string | null>;
    probeModels?: typeof readOmpModels;
    probeCatalog?: typeof readOmpCatalog;
  } = {},
): Promise<{ config: MaterializedAgentConfigV1; resolution: AgentResolutionV1 }> {
  if (partial.agent === undefined) throw new AgentError("agent-unselected");
  const installation = Object.hasOwn(table.installations, partial.agent) ? table.installations[partial.agent] : undefined;
  if (installation === undefined) throw new AgentError("agent-installation-missing", partial.agent);
  const descriptor = getDescriptor(installation.kind);
  const defaults = descriptorDefaults(descriptor, installation);
  const selection = {
    agent: partial.agent,
    model: partial.model ?? defaults.model,
    contextWindow: partial.contextWindow ?? defaults.contextWindow,
  };
  descriptor.validateSelection(selection);
  const config: MaterializedAgentConfigV1 = { schema: "ccloop-agent-config-v1", kind: installation.kind, installation, selection };
  const observed = await (deps.probeVersion ?? probeVersion)(installation.command);
  // Orca wave-2 review I-3 (2026-09-26): a probe that observed no version at all (spawn failure, non-zero exit, no
  // x.y.z, oversized output, timeout) may be transient, so it is NOT the named refusal agent-version-drift. It is a
  // plain Error: `control` exits 1 (Orca treats it as unknown and retries) and `run --agents` exits 1 with a message
  // that is not a code (Orca: reconcile-spawn). Only an observed version that differs from the table is a drift.
  if (observed === null) {
    throw new Error(`Could not observe the version of installation ${JSON.stringify(partial.agent)}: \`--version\` answered no x.y.z (table ${installation.version})`);
  }
  if (observed !== installation.version) {
    throw new AgentError("agent-version-drift", `${partial.agent}: table ${installation.version}, observed ${observed}`);
  }
  // OMP single call (Orca spec 2026-10-14 §3.2): the selected catalog row decides the window, the single-call answer and
  // its cap. `probeModels` is the selector-only injection older criteria use; its rows declare no numbers.
  let row: CatalogRowV1 | undefined;
  if (installation.kind === "omp") {
    const rows: CatalogRowV1[] = deps.probeCatalog !== undefined ? await deps.probeCatalog(installation)
      : deps.probeModels !== undefined
        ? (await deps.probeModels(installation)).map((selector) => ({ selector, provider: selector.slice(0, selector.indexOf("/")), contextWindow: null, maxTokens: null }))
        : await readOmpCatalog(installation);
    row = rows.find((candidate) => candidate.selector === selection.model);
    if (row === undefined) throw new AgentError("agent-selection-invalid", `OMP model is not an exact catalog selector: ${selection.model}`);
  }
  return {
    config,
    resolution: {
      selection,
      configHash: agentConfigHash(config),
      timeoutMs: installation.timeoutMs,
      killGraceMs: installation.killGraceMs,
      capabilities: descriptor.capabilities(config, row),
      singleCallExecution: descriptor.singleCallExecution(config, row),
      singleCallOutputCap: descriptor.singleCallOutputCap(config, row),
    },
  };
}
```

`src/control/command.ts` — in `capabilitiesSchema`'s resolution object (line 97), after `singleCallExecution: z.enum(["v1"]).nullable(),` add:

```ts
      // OMP single call (Orca spec 2026-10-14 §3.2). Optional, so an answer without it (a handler stand-in) still parses.
      singleCallOutputCap: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
```

and replace lines 252-255 with:

```ts
    const { resolution } = await resolveAgent(await readAgentsTable(context.agentsTablePath), request.agent);
    // Orca single-call estimate (2026-09-27), spec §4.4: a sibling of `capabilities`, like timeoutMs and killGraceMs,
    // so the seven-key view (frozen into Orca profiles and task records) stays exactly as it is.
    // OMP single call (Orca spec 2026-10-14 §3.2): singleCallExecution and singleCallOutputCap now come with the resolution.
    return { protocol: 3, ...resolution };
```

`src/control/accept.ts` — delete line 6 (`import { getDescriptor } from "../agents/registry.js";`, its only use is below); replace lines 86-90 with:

```ts
  // Orca single-call estimate (2026-09-27), spec §5.1: refused here, before anything is persisted, even when Orca's
  // preflight let it through.
  // OMP single call (Orca spec 2026-10-14 §3.2): the resolution's answer, which for omp comes from the catalog row.
  if (input.work.kind === "single-call" && resolution.singleCallExecution === null) {
    throw new ControlProtocolError("single-call-unsupported");
  }
```

- [ ] **Step 6: Run green, with every criterion near the change**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts tests/agents/ompCatalog.test.ts tests/agents/ompSelection.test.ts tests/agents/registry.test.ts tests/agents/materialize.test.ts tests/control/singleCallCapability.test.ts tests/control/requestBoundDimensions.test.ts tests/control/command.test.ts tests/control/agentsControl.test.ts tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t2-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t2-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t2-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t2-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/agents/types.ts src/agents/registry.ts src/agents/omp.ts src/agents/claude.ts src/agents/codex.ts src/agents/materialize.ts src/control/command.ts src/control/accept.ts tests/fixtures/fake-omp.mjs tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t2-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): decide the window, single-call answer and cap from the catalog row

Capabilities and accept now read singleCallExecution from the resolution instead of recomputing it from the config.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

### Task 3 (ccloop): Extract omp's process handling from the phase runner (no behaviour change)

**Files:**
- Modify: `src/runtime/omp/runOmpPhase.ts:1-123`
- Test: existing `tests/runtime/omp/ompPhase.test.ts`, `tests/runtime/omp/ompSkills.test.ts`, `tests/control/ompEndToEnd.test.ts`, `tests/control/ompSkillsDir.test.ts` (unchanged; they are the criterion)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface OmpProcessInput { args: string[]; prompt: string; cwd: string; evidenceDir: string; timeoutMs: number; phase: string; abortSignal?: AbortSignal; onProcessRegistered?: AttemptContext["onProcessRegistered"] }`
  - `export async function runOmpProcess(config: MaterializedAgentConfigV1, input: OmpProcessInput): Promise<OmpPhaseOutcome>` — detached group, registration before the prompt is written, abort, timeout, output limit, `events.jsonl`/`stderr.log`/`process.json`/`outcome.json` in `input.evidenceDir`.
  - `runOmpPhase` keeps its signature and behaviour.

- [ ] **Step 1: Baseline the phase criteria green**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompEndToEnd.test.ts tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t3-before.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t3-before.log
```
Read it whole; record pass/skip counts. Expected: all pass, 0 skipped.

- [ ] **Step 2: Implement** — replace `src/runtime/omp/runOmpPhase.ts` lines 14-123 (from `export interface OmpPhaseOutcome` to the end) with:

```ts
export interface OmpPhaseOutcome {
  reason: "completed" | "aborted" | "timeout" | "spawn-error" | "exit-error" | "output-limit" | "io-error";
  code: number | null;
  signal: NodeJS.Signals | null;
  events: string;
  evidenceDir: string;
  neverStarted: boolean;
}

/**
 * OMP single call (Orca spec 2026-10-14 §3.3): what one omp process needs. A phase and a single call differ only in these:
 * their argv, cwd, evidence directory, time limit and the name written into the process registration.
 */
export interface OmpProcessInput {
  args: string[];
  prompt: string;
  cwd: string;
  evidenceDir: string;
  timeoutMs: number;
  phase: string;
  abortSignal?: AbortSignal;
  onProcessRegistered?: AttemptContext["onProcessRegistered"];
}

export async function runOmpPhase(
  config: MaterializedAgentConfigV1, phase: OmpPhase, prompt: string, context: AttemptContext, options: { skillsDir?: string } = {},
): Promise<OmpPhaseOutcome> {
  // OMP skill injection (spec 2026-10-13): checked before anything is spawned; OMP's own discovery stays off below.
  const skills = options.skillsDir === undefined ? "" : await ompSkillsPromptBlock(options.skillsDir, context.worktreePath);
  const root = join(context.runDir, "omp", String(context.attempt), phase);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const evidenceDir = await mkdtemp(join(root, "call-"));
  const systemPath = join(evidenceDir, "system-prompt.md");
  await writeFile(systemPath, skills === "" ? phaseSystemPrompt(phase) : `${phaseSystemPrompt(phase)}\n\n${skills}`, { mode: 0o600 });
  const tools = phase === "execute" ? "read,grep,glob,edit,write,bash" : "read,grep,glob";
  const profile = config.installation.profile as string | null;
  const args = ["--profile", profile ?? "default", "--no-extensions", "--no-skills", "--no-tools", "--tools", tools,
    "--no-session", "--no-title", "--no-prewalk", "--model", config.selection.model,
    "--mode", "json", "-p", "--system-prompt", systemPath, "--cwd", context.worktreePath];
  return runOmpProcess(config, {
    args, prompt, cwd: context.worktreePath, evidenceDir, phase,
    timeoutMs: Math.min(config.installation.timeoutMs, context.state.budgetSnapshot.timeRemainingMs),
    abortSignal: context.abortSignal, onProcessRegistered: context.onProcessRegistered,
  });
}

export async function runOmpProcess(config: MaterializedAgentConfigV1, input: OmpProcessInput): Promise<OmpPhaseOutcome> {
  const { args, evidenceDir } = input;
  const eventsPath = join(evidenceDir, "events.jsonl");
  const stderrPath = join(evidenceDir, "stderr.log");
  await Promise.all([writeFile(eventsPath, "", { mode: 0o600 }), writeFile(stderrPath, "", { mode: 0o600 })]);
  const result: OmpPhaseOutcome = { reason: "completed", code: null, signal: null, events: "", evidenceDir, neverStarted: false };
  const persist = async (): Promise<OmpPhaseOutcome> => {
    await writeFile(join(evidenceDir, "outcome.json"), JSON.stringify({ reason: result.reason, code: result.code, signal: result.signal, neverStarted: result.neverStarted, executable: config.installation.command[0], args }, null, 2), { mode: 0o600 });
    return result;
  };
  if (input.abortSignal?.aborted) { result.reason = "aborted"; result.neverStarted = true; return persist(); }
  const timeoutMs = input.timeoutMs;
  if (timeoutMs <= 0) { result.reason = "timeout"; result.neverStarted = true; return persist(); }
  const profile = config.installation.profile as string | null;
  const env: NodeJS.ProcessEnv = { ...process.env, OMP_PROFILE: profile ?? "default" };
  if (config.installation.configDir !== null) env.PI_CODING_AGENT_DIR = config.installation.configDir;
  const chunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  await new Promise<void>((resolve) => {
    const child = spawn(config.installation.command[0], args, { cwd: input.cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stopped = false;
    let closed = false;
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
    };
    const stop = (reason: OmpPhaseOutcome["reason"]): void => {
      if (stopped || closed) return;
      stopped = true;
      result.reason = reason;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), config.installation.killGraceMs);
    };
    const abort = (): void => stop("aborted");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      const kept = chunk.subarray(0, Math.max(0, OUTPUT_LIMIT - stdoutBytes));
      stdoutBytes += chunk.length;
      try { appendFileSync(eventsPath, kept); } catch { stop("io-error"); }
      chunks.push(kept);
      if (stdoutBytes > OUTPUT_LIMIT) stop("output-limit");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const kept = chunk.subarray(0, Math.max(0, OUTPUT_LIMIT - stderrBytes));
      stderrBytes += chunk.length;
      try { appendFileSync(stderrPath, kept); } catch { stop("io-error"); }
      if (stderrBytes > OUTPUT_LIMIT) stop("output-limit");
    });
    child.stdin.on("error", () => { if (!closed && !stopped) stop("io-error"); });
    child.on("error", () => { result.neverStarted = true; stop("spawn-error"); });
    child.once("spawn", () => {
      void (async () => {
        try {
          const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(child.pid)], { env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 1000 });
          if (!stdout.trim()) throw new Error("process identity unavailable");
          const registration = { pid: child.pid!, pgid: child.pid!, startedAt: stdout.trim(), phase: input.phase };
          await writeFile(join(evidenceDir, "process.json"), JSON.stringify(registration), { mode: 0o600 });
          await input.onProcessRegistered?.(registration);
          if (!closed && !stopped) child.stdin.end(input.prompt);
        } catch { stop("io-error"); }
      })();
    });
    child.on("exit", (code, signal) => {
      result.code = code;
      result.signal = signal;
      if (!stopped && (code !== 0 || signal !== null)) result.reason = "exit-error";
      drainTimer = setTimeout(() => { kill("SIGKILL"); child.stdout.destroy(); child.stderr.destroy(); }, 1000);
    });
    child.on("close", () => {
      closed = true;
      kill("SIGKILL");
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      input.abortSignal?.removeEventListener("abort", abort);
      result.events = Buffer.concat(chunks).toString("utf8");
      resolve();
    });
    if (input.abortSignal?.aborted) abort();
  });
  return persist();
}
```

(The only intended differences: the system prompt is written alone before `events.jsonl`/`stderr.log` instead of in one `Promise.all`; `context.*` reads become `input.*`.)

- [ ] **Step 3: Run the same criteria green with the same counts**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompEndToEnd.test.ts tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t3-after.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t3-after.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t3-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t3-tc.log
```
Read both whole. Expected: same pass count as Step 1, 0 skipped, typecheck `rc=0`.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/runtime/omp/runOmpPhase.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t3-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
refactor(omp): run one omp process from its argv, cwd and time limit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

### Task 4 (ccloop): The single call's spawn-time check, argv, overlay and system prompt (criteria 3, 4)

**Files:**
- Modify: `src/runtime/omp/phasePrompt.ts` (add `singleCallSystemPrompt`)
- Create: `src/runtime/omp/ompSingleCall.ts` (`OMP_SINGLE_CALL_OVERLAY`, `OmpSingleCallRefused`, `runOmpSingleCall`)
- Modify: `tests/fixtures/fake-omp.mjs` (single-call branch; fixture, not a criterion)
- Test: `tests/runtime/omp/ompSingleCall.test.ts` (new; Task 5 adds to it)

**Interfaces:**
- Consumes: Task 1's `readOmpCatalog`, `ompSingleCallExecution`; Task 3's `runOmpProcess`, `OmpPhaseOutcome`; `SingleCallRequest` (`src/runtime/types.ts:186-196`).
- Produces:
  - `export function singleCallSystemPrompt(responseSchema: Record<string, unknown>): string` (phasePrompt.ts).
  - `export const OMP_SINGLE_CALL_OVERLAY` (the Task 0 confirmed object).
  - `export class OmpSingleCallRefused extends Error { readonly neverStarted = true; readonly code: "omp-single-call-cap-exceeded" | "omp-single-call-unavailable" }`.
  - `export async function runOmpSingleCall(config: MaterializedAgentConfigV1, request: SingleCallRequest): Promise<OmpPhaseOutcome>`.
  - Fake omp: a call whose system prompt contains `one ccloop single call` appends `single-call` to `<marker>.calls`, its argv (one JSON line) to `<marker>.argv`, and prints `<marker>.single.json` (`{ rows?, exitCode?, hang? }`) or one complete `{"answer":"42"}` costing 14 tokens.

- [ ] **Step 1: Extend the fake omp's single call** — in `tests/fixtures/fake-omp.mjs`, after the line `const system = readFileSync(args[args.indexOf("--system-prompt") + 1], "utf8");` insert:

```js
// OMP single call (Orca spec 2026-10-14 §5): ccloop's single-call system prompt says "one ccloop single call". Records the
// call and its argv, then prints `<marker>.single.json` ({rows?, exitCode?, hang?}) or one complete {"answer":"42"}.
if (system.includes("one ccloop single call")) {
  appendFileSync(`${marker}.calls`, "single-call\n");
  appendFileSync(`${marker}.argv`, `${JSON.stringify(args)}\n`);
  const script = existsSync(`${marker}.single.json`) ? JSON.parse(readFileSync(`${marker}.single.json`, "utf8")) : {};
  if (script.hang === true) setInterval(() => {}, 1000);
  else {
    const answer = { role: "assistant", content: [{ type: "text", text: "{\"answer\":\"42\"}" }], provider: "gateway", model: "model-a", stopReason: "stop", usage: { input: 8, output: 2, cacheRead: 3, cacheWrite: 1, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const rows = script.rows ?? [{ type: "agent_start" }, { type: "message_end", message: answer }, { type: "agent_end", isTerminal: true, yielded: true, messages: [answer] }];
    process.stdout.write(rows.map((row) => `${JSON.stringify(row)}\n`).join(""), () => process.exit(script.exitCode ?? 0));
  }
  await new Promise(() => {});
}
```

- [ ] **Step 2: Write the failing criteria 3 and 4** — `tests/runtime/omp/ompSingleCall.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { OMP_SINGLE_CALL_OVERLAY, runOmpSingleCall } from "../../../src/runtime/omp/ompSingleCall.js";
import { observedTokensOf, type SingleCallRequest } from "../../../src/runtime/types.js";

// OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.3). Orca books the catalog cap as the call's output
// bound; omp cannot take a per-call cap, so a cap that rose above the request's must refuse the call before anything is
// sent (criterion 3), and the call must run with every tool, rule and LSP off, under the overlay that switches omp's own
// retries and model switches off (criterion 4) -- otherwise one booked request could become several, or a tool run.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function ompWorld(options: { catalog?: unknown; single?: unknown; installationTimeoutMs?: number } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-single-")));
  dirs.push(dir);
  const marker = join(dir, "omp-marker");
  if (options.catalog !== undefined) await writeFile(`${marker}.catalog.json`, JSON.stringify(options.catalog));
  if (options.single !== undefined) await writeFile(`${marker}.single.json`, JSON.stringify(options.single));
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  const runDir = join(dir, "run");
  const cwd = join(runDir, "cwd");
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const config: MaterializedAgentConfigV1 = {
    schema: "ccloop-agent-config-v1", kind: "omp",
    installation: { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: options.installationTimeoutMs ?? 10_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
    selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" },
  };
  const request = (over: Partial<SingleCallRequest> = {}): SingleCallRequest => ({
    prompt: "Estimate the plan below.", responseSchema: SCHEMA, maxOutputTokens: 8_192, cwd, runDir, timeoutMs: 60_000, ...over,
  });
  return { dir, marker, config, request };
}
const modelA = (numbers: Record<string, unknown>) => ({ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, ...numbers });
const failureOf = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error);

describe("spawn-time check (§3.3.1, criterion 3)", () => {
  it("C3: refuses before spawning when the catalog cap exceeds the request's maxOutputTokens, booking 0", async () => {
    const w = await ompWorld({ catalog: [modelA({ maxTokens: 8192 })] });
    const failure = await failureOf(runOmpSingleCall(w.config, w.request({ maxOutputTokens: 4_096 })));
    expect(failure).toMatchObject({ code: "omp-single-call-cap-exceeded", neverStarted: true });
    expect(observedTokensOf(failure)).toBe(0);
    expect(existsSync(`${w.marker}.calls`)).toBe(false);
  });

  it("C3: runs when the catalog cap equals the request's maxOutputTokens", async () => {
    const w = await ompWorld({ catalog: [modelA({ maxTokens: 8192 })] });
    const outcome = await runOmpSingleCall(w.config, w.request({ maxOutputTokens: 8_192 }));
    expect(outcome).toMatchObject({ reason: "completed", neverStarted: false });
    expect(await readFile(`${w.marker}.calls`, "utf8")).toBe("single-call\n");
  });

  it("refuses as unavailable, never started, when the row lost its cap, the model left the catalog, or the catalog cannot be read", async () => {
    for (const catalog of [[modelA({})], [{ ...modelA({ maxTokens: 8192 }), id: "other", selector: "gateway/other" }], "not rows"]) {
      const w = await ompWorld({ catalog });
      const failure = await failureOf(runOmpSingleCall(w.config, w.request()));
      expect([catalog, failure]).toEqual([catalog, expect.objectContaining({ code: "omp-single-call-unavailable", neverStarted: true })]);
      expect(observedTokensOf(failure)).toBe(0);
      expect(existsSync(`${w.marker}.calls`)).toBe(false);
    }
  });
});

describe("argv (§3.3.2-§3.3.4, criterion 4)", () => {
  it("C4: passes exactly the single-call argv: tools, rules and LSP off, no --tools list, the overlay, the request's cwd", async () => {
    const w = await ompWorld();
    const request = w.request();
    await runOmpSingleCall(w.config, request);
    const [argv] = (await readFile(`${w.marker}.argv`, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(argv).toEqual([
      "--profile", "default", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-tools",
      "--no-session", "--no-title", "--no-prewalk", "--model", "gateway/model-a", "--mode", "json", "-p",
      "--system-prompt", expect.stringMatching(/\/run\/omp\/1\/single-call\/call-[^/]+\/system-prompt\.md$/),
      "--cwd", request.cwd,
      "--config", expect.stringMatching(/\/run\/omp\/1\/single-call\/call-[^/]+\/config-overlay\.yml$/),
    ]);
    expect(argv).not.toContain("--tools");
    expect(JSON.parse(await readFile(argv![argv!.indexOf("--config") + 1]!, "utf8"))).toEqual(OMP_SINGLE_CALL_OVERLAY);
    const system = await readFile(argv![argv!.indexOf("--system-prompt") + 1]!, "utf8");
    expect(system).toContain("one ccloop single call");
    expect(system).toContain(JSON.stringify(SCHEMA));
  });
});
```

- [ ] **Step 3: Run red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp/ompSingleCall.test.ts > /private/tmp/osc/logs/t4-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t4-red.log
```
Read it whole. Expected: FAIL — `../../../src/runtime/omp/ompSingleCall.js` does not exist (module load). That load failure is the red for a new module; the criteria's own reds are Task 6's mutations.

- [ ] **Step 4: Implement**

`src/runtime/omp/phasePrompt.ts` — append:

```ts
/**
 * OMP single call (Orca spec 2026-10-14 §3.3.4): the whole answer is one JSON object satisfying the request's schema.
 * Task 0 measured this prompt's request-body overhead against the operator's framingTokenOverhead (spec §7).
 */
export function singleCallSystemPrompt(responseSchema: Record<string, unknown>): string {
  return [
    "This invocation is one ccloop single call: answer the user prompt once, with no tools and no follow-up.",
    "Reply with exactly one JSON object that satisfies the JSON Schema below, and nothing else: no prose before or after it.",
    JSON.stringify(responseSchema),
  ].join("\n");
}
```

Create `src/runtime/omp/ompSingleCall.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ompSingleCallExecution, readOmpCatalog } from "../../agents/ompModels.js";
import type { CatalogRowV1, MaterializedAgentConfigV1 } from "../../agents/types.js";
import type { SingleCallRequest } from "../types.js";
import { singleCallSystemPrompt } from "./phasePrompt.js";
import { runOmpProcess, type OmpPhaseOutcome } from "./runOmpPhase.js";

/**
 * OMP single call (Orca spec 2026-10-14 §3.3.3): switches off session auto-retry, model fallback, the loop guard, the
 * advisor and auto-compaction. Keys confirmed against omp 18.10.1 in plan Task 0 (spec §7), applied on top of the
 * operator's config.yml: omp deep-merges a --config file (YAML; JSON is YAML) after its own configuration.
 */
export const OMP_SINGLE_CALL_OVERLAY = {
  retry: { enabled: false, modelFallback: false },
  model: { loopGuard: { enabled: false } },
  advisor: { enabled: false },
  compaction: { enabled: false },
} as const;

/** §3.3.1: refused before anything was spawned, so nothing was sent; observedTokensOf books 0 for it. */
export class OmpSingleCallRefused extends Error {
  readonly neverStarted = true;
  constructor(readonly code: "omp-single-call-cap-exceeded" | "omp-single-call-unavailable", detail: string) {
    super(`${code}: ${detail}`);
    this.name = "OmpSingleCallRefused";
  }
}

/**
 * §3.3.1-§3.3.4: re-reads the selected catalog row immediately before spawning and runs only when it still answers "v1"
 * and its cap is at most the request's maxOutputTokens; then one `omp -p` with tools, rules and LSP off under the overlay.
 */
export async function runOmpSingleCall(config: MaterializedAgentConfigV1, request: SingleCallRequest): Promise<OmpPhaseOutcome> {
  let rows: CatalogRowV1[];
  try { rows = await readOmpCatalog(config.installation); }
  catch (error) { throw new OmpSingleCallRefused("omp-single-call-unavailable", `catalog ${error instanceof Error ? error.message : String(error)}`); }
  const row = rows.find((candidate) => candidate.selector === config.selection.model);
  if (row === undefined || row.maxTokens === null || ompSingleCallExecution(row) !== "v1") throw new OmpSingleCallRefused("omp-single-call-unavailable", config.selection.model);
  if (row.maxTokens > request.maxOutputTokens) throw new OmpSingleCallRefused("omp-single-call-cap-exceeded", `catalog maxTokens ${row.maxTokens} > maxOutputTokens ${request.maxOutputTokens}`);
  const root = join(request.runDir, "omp", "1", "single-call");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const evidenceDir = await mkdtemp(join(root, "call-"));
  const systemPath = join(evidenceDir, "system-prompt.md");
  const overlayPath = join(evidenceDir, "config-overlay.yml");
  await Promise.all([
    writeFile(systemPath, singleCallSystemPrompt(request.responseSchema), { mode: 0o600 }),
    writeFile(overlayPath, `${JSON.stringify(OMP_SINGLE_CALL_OVERLAY)}\n`, { mode: 0o600 }),
  ]);
  const profile = config.installation.profile as string | null;
  const args = ["--profile", profile ?? "default", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-tools",
    "--no-session", "--no-title", "--no-prewalk", "--model", config.selection.model, "--mode", "json", "-p",
    "--system-prompt", systemPath, "--cwd", request.cwd, "--config", overlayPath];
  return runOmpProcess(config, {
    args, prompt: request.prompt, cwd: request.cwd, evidenceDir, phase: "single-call",
    timeoutMs: Math.min(request.timeoutMs, config.installation.timeoutMs),
    abortSignal: request.signal, onProcessRegistered: request.onProcessRegistered,
  });
}
```

If Task 0 confirmed a different overlay object, `OMP_SINGLE_CALL_OVERLAY` is that object, byte for byte.

- [ ] **Step 5: Run green**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t4-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t4-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t4-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t4-tc.log
```
Read both whole. Expected: all pass, 0 skipped (the phase criteria prove the fake's phase branch is unchanged); typecheck `rc=0`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/runtime/omp/phasePrompt.ts src/runtime/omp/ompSingleCall.ts tests/fixtures/fake-omp.mjs tests/runtime/omp/ompSingleCall.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t4-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): check the catalog cap at spawn and run one call with tools and retries off

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

### Task 5 (ccloop): Decode, output rule, usage, and `OmpAdapter.singleCall` (criteria 5, 6, 7)

**Files:**
- Modify: `src/runtime/omp/ompProtocol.ts:12` (export `assistantUsage`)
- Modify: `src/runtime/omp/ompSingleCall.ts` (add `parseSingleCallObject`, `decodeOmpSingleCall`)
- Modify: `src/runtime/omp/ompAdapter.ts:1-65` (`singleCall`)
- Modify: `src/runtime/types.ts:230` (append-only note)
- Test: `tests/runtime/omp/ompSingleCall.test.ts` (add), `tests/control/ompSingleCallWorker.test.ts` (new)

**Interfaces:**
- Consumes: Task 4's `runOmpSingleCall`, `OmpSingleCallRefused`; `SingleCallOutputInvalid`, `SingleCallResult` (`src/runtime/types.ts:198-207`); `ModelUsageV1` (`src/control/usage.ts`).
- Produces:
  - `export function assistantUsage(message: Record<string, unknown>): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }` (ompProtocol.ts, now exported, unchanged body).
  - `export function parseSingleCallObject(text: string): Record<string, unknown> | undefined`.
  - `export function decodeOmpSingleCall(events: string, expectedSelector: string, evidenceDir: string): SingleCallResult`.
  - `OmpAdapter.singleCall(request: SingleCallRequest): Promise<SingleCallResult>`.

- [ ] **Step 1: Write the failing criteria 5, 6, 7 and the Review Focus items 3-5** — append to `tests/runtime/omp/ompSingleCall.test.ts` (and add `decodeOmpSingleCall, parseSingleCallObject` to its `ompSingleCall.js` import, `SingleCallOutputInvalid` to its `types.js` import, and `import { OmpAdapter } from "../../../src/runtime/omp/ompAdapter.js";`):

```ts
const usage = { input: 8, output: 2, cacheRead: 3, cacheWrite: 1, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = (over: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text: "{\"answer\":\"42\"}" }], provider: "gateway", model: "model-a", stopReason: "stop", usage, ...over });
const end = (m: unknown) => ({ type: "message_end", message: m });
const lines = (...rows: unknown[]) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const decodeFailure = (events: string): unknown => { try { decodeOmpSingleCall(events, "gateway/model-a", "/evidence"); return null; } catch (error) { return error; } };

describe("decode (§3.3.5, criterion 5): one request, no tool, the selected model", () => {
  it("decodes one complete answer with its usage and per-model breakdown", () => {
    expect(decodeOmpSingleCall(lines({ type: "agent_start" }, end(message()), { type: "agent_end", isTerminal: true }), "gateway/model-a", "/evidence")).toEqual({
      output: { answer: "42" }, tokenUsage: 14,
      usageEvidence: expect.objectContaining({ usageStatus: "present", normalizedTotal: 14 }),
      modelUsage: [{ model: "gateway/model-a", input: 8, output: 2, cacheRead: 3, cacheWrite: 1 }],
    });
  });

  it("C5: refuses two assistant messages as multiple requests, booking both", () => {
    expect(decodeFailure(lines(end(message()), end(message())))).toMatchObject({ message: "omp-single-call-multiple-requests", observedTokens: 28 });
  });

  it("C5: refuses a tool event even beside a complete answer, booking what was spent", () => {
    expect(decodeFailure(lines({ type: "tool_execution_start", toolCallId: "t1", toolName: "read" }, end(message())))).toMatchObject({ message: "omp-phase-tool-forbidden", observedTokens: 14 });
  });

  it("C5: refuses an extension UI request or a subagent event like a tool event", () => {
    expect(decodeFailure(lines({ type: "extension_ui_request" }, end(message())))).toMatchObject({ message: "omp-phase-tool-forbidden", observedTokens: 14 });
    expect(decodeFailure(lines({ type: "subagent_start" }, end(message())))).toMatchObject({ message: "omp-phase-tool-forbidden", observedTokens: 14 });
  });

  it("C5: refuses an answer from a different model, booking what was spent", () => {
    expect(decodeFailure(lines(end(message({ model: "model-b" }))))).toMatchObject({ message: "omp-model-mismatch", observedTokens: 14 });
  });

  it("books null when there is no assistant message or its usage is not readable", () => {
    for (const events of [lines({ type: "agent_start" }), lines(end(message({ usage: { ...usage, totalTokens: 15 } }))), "not json\n"]) {
      expect(observedTokensOf(decodeFailure(events))).toBeNull();
    }
  });
});

describe("stop reasons (§3.3.5, criterion 6)", () => {
  it("C6: a length stop is an output-invalid answer that still books the observed usage", () => {
    const failure = decodeFailure(lines(end(message({ stopReason: "length", content: [{ type: "text", text: "{\"answer\":\"4\"}" }] }))));
    expect(failure).toBeInstanceOf(SingleCallOutputInvalid);
    expect(failure).toMatchObject({ code: "single-call-output-invalid", tokenUsage: 14, usageEvidence: expect.objectContaining({ normalizedTotal: 14 }) });
  });

  it("C6: another stop reason is the named failure, booking the observed usage", () => {
    for (const stopReason of ["error", "toolUse", "aborted"]) {
      expect([stopReason, decodeFailure(lines(end(message({ stopReason }))))]).toEqual([stopReason, expect.objectContaining({ code: `omp-single-call-stop:${stopReason}`, observedTokens: 14 })]);
    }
  });

  it("keeps the failure code bounded when the stop reason is not a short word", () => {
    for (const stopReason of [{ nested: true }, "x".repeat(33), "has space"]) {
      expect(decodeFailure(lines(end(message({ stopReason }))))).toMatchObject({ code: "omp-single-call-stop:invalid" });
    }
  });
});

describe("output rule (§3.3.6, criterion 7)", () => {
  it("C7: only one plain object, with at most one fence around it, is an answer", () => {
    expect(parseSingleCallObject("[{\"answer\":\"42\"}]")).toBeUndefined();
    expect(parseSingleCallObject("42")).toBeUndefined();
    expect(parseSingleCallObject("null")).toBeUndefined();
    expect(parseSingleCallObject("Here: {\"answer\":\"4\"} and {\"answer\":\"2\"}")).toBeUndefined();
    expect(parseSingleCallObject("```json\n{\"a\":1}\n```\n```json\n{\"a\":2}\n```")).toBeUndefined();
    expect(parseSingleCallObject("```json\n{\"answer\":\"42\"}\n```")).toEqual({ answer: "42" });
    expect(parseSingleCallObject("  {\"answer\":\"42\"}\n")).toEqual({ answer: "42" });
  });

  it("C7: an answer that is not one object is output-invalid and books what the call spent", () => {
    for (const text of ["[{\"answer\":\"42\"}]", "42", ""]) {
      const failure = decodeFailure(lines(end(message({ content: [{ type: "text", text }] }))));
      expect([text, failure instanceof SingleCallOutputInvalid, (failure as { tokenUsage?: unknown }).tokenUsage]).toEqual([text, true, 14]);
    }
  });
});

describe("OmpAdapter.singleCall (§3.3, §3.3.7)", () => {
  it("returns the fake's answer through the real process path", async () => {
    const w = await ompWorld();
    await expect(new OmpAdapter(w.config).singleCall(w.request())).resolves.toMatchObject({ output: { answer: "42" }, tokenUsage: 14 });
  });

  it("books null when omp exits non-zero after a complete message, and uses none of it", async () => {
    const w = await ompWorld({ single: { exitCode: 3 } });
    const failure = await failureOf(new OmpAdapter(w.config).singleCall(w.request()));
    expect((failure as Error).message).toMatch(/^omp-exit-error: /);
    expect(observedTokensOf(failure)).toBeNull();
  });

  it("stops the call at the request's time limit when it is below the installation's", async () => {
    const w = await ompWorld({ single: { hang: true }, installationTimeoutMs: 30_000 });
    const started = Date.now();
    const failure = await failureOf(new OmpAdapter(w.config).singleCall(w.request({ timeoutMs: 300 })));
    expect((failure as Error).message).toMatch(/^omp-timeout: /);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(observedTokensOf(failure)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the worker-level criteria** — `tests/control/ompSingleCallWorker.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { parseAgentsTable } from "../../src/agents/table.js";
import { collectExecution } from "../../src/control/collect.js";
import { readEvidence } from "../../src/control/evidence.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "../../src/control/paths.js";
import { canonicalHash, canonicalJson } from "../../src/control/protocol.js";
import { writeAccepted } from "../../src/control/store.js";
import { runControlWorker } from "../../src/control/worker.js";
import { singleCallEnvelope } from "./agentsFixture.js";

// OMP single call (Orca spec 2026-10-14 §3.3.1, §3.3.7) through the control worker, read back as Orca reads it: a complete
// call books its observed usage and answer; a call refused at spawn because the catalog cap rose above the envelope's
// maxOutputTokens (4096 here) books 0 and names the cap -- nothing was sent, so nothing may be charged.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    try {
      for (const registered of JSON.parse(await readFile(join(dir, "control", "processes.json"), "utf8")) as Array<{ pgid: number }>) {
        try { process.kill(-registered.pgid, "SIGKILL"); } catch {}
      }
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});

async function world(maxTokens: number) {
  const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-single-source-")));
  const aux = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-single-aux-")));
  dirs.push(sourceDir, aux);
  const marker = join(aux, "omp-marker");
  await writeFile(`${marker}.catalog.json`, JSON.stringify([{ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens }]));
  const binary = join(aux, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  const table = parseAgentsTable({ schema: "ccloop-agents-table-v1", installations: {
    omp: { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 300, defaultModel: "gateway/model-a", profile: null },
  } });
  const { config, resolution } = await resolveAgent(table, { agent: "omp" });
  const envelope = singleCallEnvelope({ sourceDir, agent: resolution.selection, configHash: resolution.configHash });
  const controlDir = join(sourceDir, "control");
  await ensurePrivateDirectory(sourceDir, controlDir);
  await atomicReplacePrivateFile(sourceDir, join(controlDir, "config.json"), Buffer.from(canonicalJson(config)));
  await atomicReplacePrivateFile(sourceDir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
  await writeAccepted(sourceDir, {
    protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: envelope.claim.configHash,
    generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
  });
  await runControlWorker(["--source-dir", sourceDir, "--execution-id", "execution-1", "--nonce", "nonce-1"]);
  const collected = await collectExecution(envelope, 0);
  const record = JSON.parse((await readEvidence(sourceDir, collected.candidate!.handoff)).toString("utf8")) as { outcome: string; errorCode: string | null };
  return { sourceDir, marker, collected, record };
}
const booked = (events: Array<{ bucket: string; cumulative: { tokens: number } | null }>) => events.map((event) => [event.bucket, event.cumulative?.tokens ?? null]);

describe("omp single calls through the control worker", { timeout: 30_000 }, () => {
  it("books a complete call's observed usage and its answer", async () => {
    const w = await world(4096);
    expect(booked(w.collected.events)).toEqual([["work", 14], ["handoff", 0]]);
    expect(w.record).toMatchObject({ outcome: "complete", errorCode: null });
    expect(JSON.parse((await readEvidence(w.sourceDir, w.collected.candidate!.artifacts[0]!)).toString("utf8"))).toEqual({ answer: "42" });
  });

  it("C3: books 0 and names the cap when the catalog cap exceeds the envelope's maxOutputTokens", async () => {
    const w = await world(8192);
    expect(booked(w.collected.events)).toEqual([["work", 0], ["handoff", 0]]);
    expect(w.record).toMatchObject({ outcome: "failed", errorCode: "omp-single-call-cap-exceeded" });
    expect(existsSync(`${w.marker}.calls`)).toBe(false);
  });
});
```

- [ ] **Step 3: Run red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp/ompSingleCall.test.ts tests/control/ompSingleCallWorker.test.ts > /private/tmp/osc/logs/t5-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-red.log
```
Read it whole. Expected: `decodeOmpSingleCall`/`parseSingleCallObject` not exported (`is not a function`); the adapter tests fail on `singleCall is not a function`; the worker tests fail with `single-call-unsupported` (`src/control/singleCall.ts:65`).

- [ ] **Step 4: Implement**

`src/runtime/omp/ompProtocol.ts` line 12: `function assistantUsage(` → `export function assistantUsage(` (body unchanged).

`src/runtime/omp/ompSingleCall.ts` — the imports become:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ompSingleCallExecution, readOmpCatalog } from "../../agents/ompModels.js";
import type { CatalogRowV1, MaterializedAgentConfigV1 } from "../../agents/types.js";
import type { ModelUsageV1 } from "../../control/usage.js";
import { SingleCallOutputInvalid, type SingleCallRequest, type SingleCallResult, type UsageEvidence } from "../types.js";
import { assistantUsage } from "./ompProtocol.js";
import { singleCallSystemPrompt } from "./phasePrompt.js";
import { runOmpProcess, type OmpPhaseOutcome } from "./runOmpPhase.js";
```

and append:

```ts
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** §3.3.6: the trimmed text, with at most one surrounding fenced block removed, must parse to a plain non-array object. */
export function parseSingleCallObject(text: string): Record<string, unknown> | undefined {
  let body = text.trim();
  const fenced = /^```[A-Za-z0-9_-]*\n([\s\S]*)\n```$/.exec(body);
  if (fenced) body = fenced[1]!.trim();
  let value: unknown;
  try { value = JSON.parse(body); } catch { return undefined; }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** §3.3.7: the assistant messages' usage with the per-model breakdown; unreadable usage is "not observed" (null). */
function observedUsage(messages: Record<string, unknown>[], selector: string): { total: number; usageEvidence: UsageEvidence; modelUsage: ModelUsageV1[] } {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const message of messages) {
    const usage = assistantUsage(message);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) totals[key] += usage[key];
  }
  if (!Object.values(totals).every(Number.isSafeInteger) || totals.total === 0) throw new Error("omp-usage-invalid");
  const usageEvidence: UsageEvidence = {
    usageStatus: "present",
    fields: {
      input_tokens: { status: "absent" }, output_tokens: { status: "absent" },
      inputTokens: { status: "finite", value: totals.input }, outputTokens: { status: "finite", value: totals.output },
    },
    cacheFields: {
      cache_creation_input_tokens: { status: "finite", value: totals.cacheWrite },
      cache_read_input_tokens: { status: "finite", value: totals.cacheRead },
    },
    selectedInputField: "inputTokens", selectedOutputField: "outputTokens", normalizedTotal: totals.total,
  };
  return { total: totals.total, usageEvidence, modelUsage: [{ model: selector, input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite }] };
}

/**
 * §3.3.5-§3.3.7, fail closed: exactly one assistant message, no tool event, the selected model, a "stop" with one object.
 * Every refusal after the usage was read books that observed total; "length" is a truncated answer (output-invalid).
 */
export function decodeOmpSingleCall(events: string, expectedSelector: string, evidenceDir: string): SingleCallResult {
  const messages: Record<string, unknown>[] = [];
  let toolEvent = false;
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error("omp-events-invalid"); }
    if (!record(raw) || typeof raw.type !== "string") throw new Error("omp-events-invalid");
    if (raw.type.startsWith("tool_execution_") || raw.type === "extension_ui_request" || raw.type.includes("subagent")) toolEvent = true;
    if (raw.type === "message_end" && record(raw.message) && raw.message.role === "assistant") messages.push(raw.message);
  }
  if (messages.length === 0) throw new Error("omp-no-completion");
  const usage = observedUsage(messages, expectedSelector);
  const observed = { observedTokens: usage.total };
  if (messages.length > 1) throw Object.assign(new Error("omp-single-call-multiple-requests"), observed);
  if (toolEvent) throw Object.assign(new Error("omp-phase-tool-forbidden"), observed);
  const message = messages[0]!;
  if (`${message.provider}/${message.model}` !== expectedSelector) throw Object.assign(new Error("omp-model-mismatch"), observed);
  if (message.stopReason === "length") throw new SingleCallOutputInvalid(evidenceDir, usage.total, usage.usageEvidence);
  if (message.stopReason !== "stop") {
    const reason = typeof message.stopReason === "string" && /^[A-Za-z]{1,32}$/.test(message.stopReason) ? message.stopReason : "invalid";
    throw Object.assign(new Error(`omp-single-call-stop:${reason}`), { code: `omp-single-call-stop:${reason}`, ...observed });
  }
  const text = Array.isArray(message.content)
    ? message.content.filter((item): item is { type: "text"; text: string } => record(item) && item.type === "text" && typeof item.text === "string").map((item) => item.text).join("")
    : "";
  const output = parseSingleCallObject(text);
  if (output === undefined) throw new SingleCallOutputInvalid(evidenceDir, usage.total, usage.usageEvidence);
  return { output, tokenUsage: usage.total, usageEvidence: usage.usageEvidence, modelUsage: usage.modelUsage };
}
```

`src/runtime/omp/ompAdapter.ts` — line 5 becomes `import type { AttemptContext, RuntimeAdapter, SingleCallRequest, SingleCallResult } from "../types.js";`; after line 8 add `import { decodeOmpSingleCall, runOmpSingleCall } from "./ompSingleCall.js";`; after `verify(…)` (line 64) add:

```ts

  /**
   * OMP single call (Orca spec 2026-10-14 §3.3): one read-only structured call bounded by the catalog cap, refused before
   * spawning when that cap exceeds the request's. A process that did not end cleanly books null even after a complete
   * message (§3.3.7); its observed total stays diagnostic, as for a phase.
   */
  async singleCall(request: SingleCallRequest): Promise<SingleCallResult> {
    const outcome = await runOmpSingleCall(this.config, request);
    if (outcome.reason !== "completed") {
      const lowerBound = ompUsageLowerBound(outcome.events);
      if (lowerBound !== null) await writeFile(join(outcome.evidenceDir, "usage-lower-bound.json"), JSON.stringify({ tokens: lowerBound }), { mode: 0o600 });
      throw Object.assign(new Error(`omp-${outcome.reason}: ${outcome.evidenceDir}`), { neverStarted: outcome.neverStarted });
    }
    try {
      const result = decodeOmpSingleCall(outcome.events, this.config.selection.model, outcome.evidenceDir);
      await writeFile(join(outcome.evidenceDir, "usage.json"), JSON.stringify(result.usageEvidence), { mode: 0o600 });
      return result;
    } catch (error) {
      await writeFile(join(outcome.evidenceDir, "decode-error.txt"), String(error), { mode: 0o600 });
      throw error;
    }
  }
```

`src/runtime/types.ts` — the comment at line 230 is published (ccloop Rule 16): first scan for every copy of the sentence being corrected, then append, never replace:

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && /usr/bin/grep -rn 'only a kind whose descriptor answers singleCallExecution' src tests docs > /private/tmp/osc/logs/t5-scan.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-scan.log
```
Read it whole (expected: `src/runtime/types.ts:230` only; append the same note to any other hit). Then change line 230 into:

```ts
  /** Orca single-call estimate (2026-09-27): only a kind whose descriptor answers singleCallExecution "v1" has it.
   * *** ERRATUM (OMP single call, Orca spec 2026-10-14 §3.2, session 7ea088aa) -- the omp adapter has it while its
   * descriptor answers "v1" only for some catalog rows; accept refuses the rest by the resolution, and the adapter
   * refuses again at spawn. *** */
```
(the original sentence kept verbatim on its first line).

- [ ] **Step 5: Run green**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompSingleCallWorker.test.ts tests/control/ompSingleCallAccept.test.ts tests/control/singleCall.test.ts tests/control/ompEndToEnd.test.ts tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t5-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t5-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/runtime/omp/ompProtocol.ts src/runtime/omp/ompSingleCall.ts src/runtime/omp/ompAdapter.ts src/runtime/types.ts tests/runtime/omp/ompSingleCall.test.ts tests/control/ompSingleCallWorker.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t5-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): decode one single-call answer fail-closed and book its observed usage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

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

### Task 7 (Orca): The resolution schema and `AgentResolution` accept `singleCallOutputCap` (criterion 10)

**Files:**
- Modify: `src/control/ccloopPort.ts:43-45`
- Modify: `src/control/agentSelection.ts:34-37`
- Test: `tests/control/singleCallOutputCap.test.ts` (new; Task 8 adds to it)

**Interfaces:**
- Consumes: nothing from ccloop code (Orca reads the wire only).
- Produces: `AgentResolution.singleCallOutputCap?: number | null`; `FrozenSlot` omits it; `ccloopResolutionSchema` accepts it (optional, nullable, positive safe integer); `ccloopPort.resolveAgent` passes it through.

- [ ] **Step 1: Write the failing test** — `tests/control/singleCallOutputCap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { frozenSlotOf, type AgentResolution } from "../../src/control/agentSelection.js";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";

// OMP single call (spec 2026-10-14-omp-single-call-design.md §4, criterion 10): ccloop now states the cap an agent's single
// call runs under. Orca must accept it (or the strict schema refuses every omp resolution once ccloop is repinned), refuse
// a value that could not be a cap, keep refusing keys it does not know, and never freeze it into a slot.
const answer = (extra: Record<string, unknown> = {}) => ({
  protocol: 3, selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000,
  capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 200_000, requestBoundProof: null },
  singleCallExecution: "v1", ...extra,
});

describe("singleCallOutputCap on the resolution (criterion 10)", () => {
  it("C10: accepts a positive safe integer, null, or no field", () => {
    for (const extra of [{ singleCallOutputCap: 8_192 }, { singleCallOutputCap: Number.MAX_SAFE_INTEGER }, { singleCallOutputCap: null }, {}]) {
      expect([extra, ccloopResolutionSchema.safeParse(answer(extra)).success]).toEqual([extra, true]);
    }
  });

  it("C10: refuses 0, a negative, a fraction, a string and an unsafe integer, and still refuses an unknown key", () => {
    for (const value of [0, -1, 1.5, "8192", 2 ** 53]) {
      expect([value, ccloopResolutionSchema.safeParse(answer({ singleCallOutputCap: value })).success]).toEqual([value, false]);
    }
    expect(ccloopResolutionSchema.safeParse(answer({ singleCallOutputCap: 8_192, outputCap: 8_192 })).success).toBe(false);
  });

  it("is never frozen into a slot", () => {
    const { protocol: _protocol, ...parsed } = ccloopResolutionSchema.parse(answer({ singleCallOutputCap: 8_192 }));
    const slot = frozenSlotOf(parsed as AgentResolution, { agent: "omp" }, { agent: "operator", model: "descriptor", contextWindow: "descriptor" });
    expect(Object.keys(slot).sort()).toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts > /private/tmp/osc/logs/t7-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t7-red.log
```
Read it whole (its `RUN` line names the Orca worktree). Expected red: "C10: accepts…" (`8192` and `MAX_SAFE_INTEGER` and `null` refused as an unknown key; `{}` passes) and "is never frozen" (`parse` throws). "C10: refuses…" may be green already (strict refuses any unknown key) — its red is mutation `M10`'s complement and is not claimed here.

- [ ] **Step 3: Implement**

`src/control/ccloopPort.ts` — replace lines 43-45 with:

```ts
// Single-call estimate spec §4.4: a selection's resolution also answers singleCallExecution, beside the view, never in it.
// Accounts D8: `usageBreakdown` is accepted beside it when ccloop states it; Orca consumes no behavior from it.
// OMP single call (spec 2026-10-14 §4): `singleCallOutputCap`, when ccloop states it, is the cap the agent's call runs
// under; optional (an older ccloop omits it), nullable, never frozen (frozenSlotOf copies field by field).
const agentResolutionSchema=z.object({protocol:z.literal(3),selection:agentSelectionSchema,configHash:z.string().regex(/^[a-f0-9]{64}$/),timeoutMs:safeInteger.positive().max(2_147_483_647),killGraceMs:safeInteger.max(60_000),capabilities:capabilityViewSchema,singleCallExecution:z.enum(["v1"]).nullable(),singleCallOutputCap:safeInteger.positive().nullable().optional(),usageBreakdown:z.enum(["per-model","unavailable"]).optional()}).strict();
```

`src/control/agentSelection.ts` — replace lines 34-37 with:

```ts
/** Single-call estimate spec §4.4: `singleCallExecution` sits beside the seven-key view, like timeoutMs/killGraceMs. */
// OMP single call (spec 2026-10-14 §4): so does `singleCallOutputCap` when ccloop states it; null or absent = the call honours the request's cap.
export interface AgentResolution { selection: AgentSelection; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1; singleCallExecution: "v1" | null; singleCallOutputCap?: number | null }
/** What confirmation and import freeze; `singleCallExecution` is never frozen (spec §4.4: no persisted schema changes). */
// OMP single call (spec 2026-10-14 §4): nor is `singleCallOutputCap`.
export interface FrozenSlot extends Omit<AgentResolution, "singleCallExecution" | "singleCallOutputCap"> { partial: PartialSelection; provenance: Record<Field, ProvenanceSource> }
```

- [ ] **Step 4: Run green, with the port's and freezing criteria**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/ccloopPort.test.ts tests/control/usageLedger.test.ts tests/control/profiles.test.ts tests/control/planImport.test.ts tests/control/agentPlanImport.test.ts > /private/tmp/osc/logs/t7-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t7-green.log
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t7-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t7-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add src/control/ccloopPort.ts src/control/agentSelection.ts tests/control/singleCallOutputCap.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t7-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
feat(control): accept ccloop's single-call output cap beside the resolution

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

### Task 8 (Orca): The estimate is sized and sent with the bound (criteria 8, 9)

**Files:**
- Modify: `src/control/estimator.ts:1-13` (import), `:74-115` (`buildBudgetEstimateRequest`), new export `singleCallOutputBound`
- Test: `tests/control/singleCallOutputCap.test.ts` (add)

**Interfaces:**
- Consumes: Task 7's `AgentResolution.singleCallOutputCap`.
- Produces: `export function singleCallOutputBound(preflightMaxOutputTokens: number, resolution: Pick<AgentResolution, "singleCallOutputCap"> | null): number` in `src/control/estimator.ts`. The contract's `maxOutputTokens` (and so the envelope's, `src/control/singleCallPurposes.ts:49`) is the bound; `requiredRequestTokens = inputTokens + bound`.

- [ ] **Step 1: Write the failing test** — append to `tests/control/singleCallOutputCap.test.ts` (add imports `buildBudgetEstimateRequest, ESTIMATE_GRANT, persistEstimateArtifacts, readEstimateContract, singleCallOutputBound` from `../../src/control/estimator.js`, `readArchivedPlan` from `../../src/control/queries.js`, `webFixture` from `./fixtures/web.js`):

```ts
// Criteria 8 and 9 (spec §4): omp cannot take the request's cap, so Orca sizes and sends the larger of the preflight's cap
// and the agent's own -- otherwise the estimate would book less than the call can spend, and ccloop's spawn check
// (row.maxTokens <= maxOutputTokens) would refuse every omp estimate whose catalog cap is above the preflight's.
type Fixture = Awaited<ReturnType<typeof webFixture>>;
async function build(h: Fixture, cap: number | null | undefined) {
  const plan = readArchivedPlan(h.store, "g");
  const observation = await h.deps.profileRouter.probe(h.frozen, { agent: "codex" });
  const withCap = cap === undefined ? observation : { ...observation, resolution: { ...observation.resolution!, singleCallOutputCap: cap } };
  return buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile: h.frozen, observation: withCap, mode: "strict" });
}

describe("the estimate's output bound (criteria 8 and 9)", () => {
  it("C8: a cap above the preflight value is the contract's maxOutputTokens, read back for the envelope, and sizes the request", async () => {
    const h = await webFixture(); try {
      const raised = await build(h, 100_000);
      expect(raised.state).toBe("queued");
      expect(raised.contract!.maxOutputTokens).toBe(100_000);
      expect(raised.requiredRequestTokens).toBe(raised.inputTokens! + 100_000);
      // The single-call envelope takes contract.maxOutputTokens (singleCallPurposes.ts ESTIMATE.prepare) from the persisted contract.
      persistEstimateArtifacts(h.store, "g", "estimate-cap", raised);
      expect(readEstimateContract(h.store, "g", "estimate-cap").maxOutputTokens).toBe(100_000);
    } finally { await h.dispose(); }
  });

  it("C8: no cap, a null cap or a smaller cap leaves today's numbers", async () => {
    const h = await webFixture(); try {
      for (const cap of [undefined, null, 1_000]) {
        const today = await build(h, cap);
        expect([cap, today.state, today.contract!.maxOutputTokens, today.requiredRequestTokens! - today.inputTokens!]).toEqual([cap, "queued", 64_000, 64_000]);
      }
    } finally { await h.dispose(); }
  });

  it("C9: a cap of 250 001 with a small input is input-too-large, though the input alone fits", async () => {
    const h = await webFixture(); try {
      const result = await build(h, 250_001);
      expect(result.inputTokens!).toBeLessThan(ESTIMATE_GRANT.tokens);
      expect(result).toMatchObject({ state: "input-too-large", reasonCode: "estimate-input-too-large", requiredRequestTokens: result.inputTokens! + 250_001 });
    } finally { await h.dispose(); }
  });

  it("takes the larger of the preflight cap and the agent's cap", () => {
    expect([singleCallOutputBound(64_000, null), singleCallOutputBound(64_000, {}), singleCallOutputBound(64_000, { singleCallOutputCap: null }),
      singleCallOutputBound(64_000, { singleCallOutputCap: 16_384 }), singleCallOutputBound(64_000, { singleCallOutputCap: 524_288 })]).toEqual([64_000, 64_000, 64_000, 64_000, 524_288]);
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts > /private/tmp/osc/logs/t8-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t8-red.log
```
Read it whole. Expected red: "C8: a cap above…" (`64000` received), "C9" (`queued` received), "takes the larger…" (`singleCallOutputBound is not a function`). "C8: no cap…" is green today (it pins that nothing else moves).

- [ ] **Step 3: Implement** — `src/control/estimator.ts`: add after line 11 `import type { AgentResolution } from "./agentSelection.js";`; add before `export interface EstimateInput` (line 56):

```ts
/**
 * OMP single call (spec 2026-10-14 §4): the output bound a single call is sized and sent with -- the preflight's cap, or the
 * agent's own catalog cap when that is larger (omp cannot lower its cap per call; ccloop refuses at spawn if it rose).
 */
export function singleCallOutputBound(preflightMaxOutputTokens: number, resolution: Pick<AgentResolution, "singleCallOutputCap"> | null): number {
  return Math.max(preflightMaxOutputTokens, resolution?.singleCallOutputCap ?? 0);
}
```

and replace lines 107-111 with:

```ts
  const inputTokens = safeNumber(serialized + BigInt(preflight.framingTokenOverhead));
  const bound = singleCallOutputBound(preflight.maxOutputTokens, observation.resolution);
  const requiredRequestTokens = safeNumber(BigInt(inputTokens) + BigInt(bound));
  const contract = estimateExecutionContractSchema.parse({ schema: "orca-estimate-execution-contract-v1", requestHash, grant: ESTIMATE_GRANT,
    profile: request.estimatorProfile, estimatorCapabilities: request.estimatorCapabilities, instructionVersion: preflight.instructionVersion,
    responseSchemaVersion: preflight.schemaVersion, tokenizer: preflight.tokenizer, framingTokenOverhead: preflight.framingTokenOverhead, maxOutputTokens: bound });
```

(line 112, `const tooLarge = requiredRequestTokens > observed.contextWindowTokens || requiredRequestTokens > ESTIMATE_GRANT.tokens;`, is unchanged.)

- [ ] **Step 4: Run green, with every estimate criterion**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/estimator.test.ts tests/control/estimatePrompt.test.ts tests/control/estimateSingleCallGate.test.ts tests/control/estimatorCompatibility.test.ts tests/control/driverEstimate.test.ts tests/control/planImport.test.ts > /private/tmp/osc/logs/t8-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t8-green.log
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t8-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t8-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add src/control/estimator.ts tests/control/singleCallOutputCap.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t8-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
feat(control): size and send the estimate with the agent's own output cap when larger

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

### Task 9 (Orca): Clarify and split send the same bound

**Files:**
- Modify: `src/control/requirementCommands.ts:6-12` (import), `:97`
- Modify: `src/control/requirementRecords.ts:24` (append-only note)
- Test: `tests/control/requirementOutputBound.test.ts` (new)

**Interfaces:**
- Consumes: Task 8's `singleCallOutputBound`; `PreparedEstimatorSlot.observation.resolution` (`src/control/planImport.ts:42`).
- Produces: `group.requirement.maxOutputTokens` = the bound at `requirement-open`; every clarify/split call sends it (`src/control/requirementCalls.ts:246`).

- [ ] **Step 1: Write the failing test** — `tests/control/requirementOutputBound.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// OMP single call (spec 2026-10-14 §4): clarify and split are single calls too, so they send the same bound as the estimate --
// the larger of the preflight's cap and the agent's own -- or ccloop's spawn check refuses every omp call whose catalog
// cap is above the preflight's. The bound is frozen at requirement-open with the rest of the requirement (DR8).
const open = (groupId: string) => ({
  schema: "orca-raw-command-v1", commandId: `open-${groupId}`, actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId },
  payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown.", contentLanguage: "zh" },
}) as never;

describe("clarify and split send the estimate's output bound", () => {
  it("freezes the agent's cap as the requirement's maxOutputTokens when it is above the preflight value, and the preflight value otherwise", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      for (const [groupId, cap, expected] of [["cap-high", 100_000, 100_000], ["cap-low", 1_000, 64_000], ["cap-null", null, 64_000]] as const) {
        const port = { ...x.fake.port, resolveAgent: async (partial: Parameters<typeof x.fake.port.resolveAgent>[0]) => ({ ...await x.fake.port.resolveAgent(partial), singleCallOutputCap: cap }) };
        const profile = resolveProfile(profileSnapshot(), port);
        const service = new WebControlService({ ...x.service.deps, profileRouter: createExecutionProfileRouter([profile]),
          defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: profile.profileHash, estimateMode: "strict" as const }) });
        expect(await service.openRequirement(open(groupId))).toMatchObject({ result: { kind: "requirement-opened", groupId } });
        expect([groupId, readRequirementGroup(x.store, groupId).requirement.maxOutputTokens]).toEqual([groupId, expected]);
      }
    } finally { await x.dispose(); }
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/requirementOutputBound.test.ts > /private/tmp/osc/logs/t9-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t9-red.log
```
Read it whole. Expected red: `["cap-high", 64000]` received.

- [ ] **Step 3: Implement** — `src/control/requirementCommands.ts`: after line 8 (`import { estimatorCompatibility } …`) add `import { singleCallOutputBound } from "./estimator.js";`; line 97's `maxOutputTokens: preflight.maxOutputTokens,` becomes:

```ts
          agentSlot: slot.outcome.slot, agentOverrides: payload.agent === null ? {} : { estimator: payload.agent }, maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution),
```

`src/control/requirementRecords.ts:24` — keep the sentence, append:

```ts
  /** DR8: the profile's estimatorPreflight.maxOutputTokens, frozen at open; every call of this requirement asks for it.
   * OMP single call (spec 2026-10-14 §4, session 7ea088aa): since then the larger of that and the agent's singleCallOutputCap. */
```

- [ ] **Step 4: Run green, with the requirement criteria**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/requirementOutputBound.test.ts tests/control/requirementCommands.test.ts tests/control/driverRequirementClarify.test.ts tests/control/driverRequirementSplit.test.ts > /private/tmp/osc/logs/t9-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t9-green.log
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t9-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t9-tc.log
```
Read both whole. Expected: all pass, 0 skipped (the registered `driverRequirementSplit` / `requirementCommands` load timeouts: rerun the file alone per `known-load-flakes.md` before judging); typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add src/control/requirementCommands.ts src/control/requirementRecords.ts tests/control/requirementOutputBound.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t9-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
feat(control): send clarify and split with the same single-call output bound

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

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

### Task 11 (Orca): Repin ccloop to the new commit — **awaits the human's push first**

`scripts/pin-ccloop.mjs` installs `github:blrbiran/ccloop#<sha>`: npm can install nothing GitHub does not have. Pushing is the human's (ccloop Rule 13; Orca Rule 15 — the Tier 0 gate blocks it for the agent).

**Files:** Modify `package.json`, `package-lock.json` (by the script only).

**Interfaces:** Consumes ccloop `codex/omp-single-call`'s head commit, pushed. Produces Orca's `dependencies.ccloop = "github:blrbiran/ccloop#<sha>"`.

- [ ] **Step 1: List for the human** (checkpoint `awaitingHuman`): "push ccloop `codex/omp-single-call` (or ff-merge it into main and push main) so `<full sha>` is on GitHub". Get the sha with `/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call rev-parse HEAD > /private/tmp/osc/logs/t11-sha.log`.
- [ ] **Step 2: After the human says it is pushed, check it is there (read-only)**

```bash
/usr/bin/git ls-remote https://github.com/blrbiran/ccloop > /private/tmp/osc/logs/t11-lsremote.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t11-lsremote.log
```
Read it whole: the sha is the head of the pushed ref.
- [ ] **Step 3: Replace the worktree's dependency symlinks with a real install** (the symlinks are the ones S3 created; check first)

```bash
test -L /Users/biran/code/skills/orca/Orca-wt/omp-single-call/node_modules && test -L /Users/biran/code/skills/orca/Orca-wt/omp-single-call/web/node_modules && /bin/rm -f /Users/biran/code/skills/orca/Orca-wt/omp-single-call/node_modules /Users/biran/code/skills/orca/Orca-wt/omp-single-call/web/node_modules; echo rc=$?
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm ci > /private/tmp/osc/logs/t11-ci.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t11-ci.log
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call status --porcelain > /private/tmp/osc/logs/t11-status.log 2>&1
```
Read all; `rc=0`; status empty (pin-ccloop requires a clean tree).
- [ ] **Step 4: Pin**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && node scripts/pin-ccloop.mjs <full 40-hex sha from Step 1> > /private/tmp/osc/logs/t11-pin.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t11-pin.log
```
Read it whole. Expected: every check `ok` (package.json pins the commit; the lock changes only ccloop; only the two files changed; built real directory; the default-resolution E2E passed; typecheck; `npm ci` reproduces the lock), `rc=0`. Any `FAIL` ⇒ stop and report; do not commit.
- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add package.json package-lock.json
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t11-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
chore(deps): repin ccloop to the omp single-call commit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

If the human has not pushed by the time Task 12 runs, Task 12 runs on the unrepinned tree (its default-resolution tests then use the old pin) and Steps 2-5 here plus a second Orca gate go to `awaitingHuman`.

---

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

### Task 13: Real-provider acceptance — **paid; ask the human first, separately**

Not run by this plan without an explicit yes for this run (spec §6: "Real-provider acceptance … is paid and asked for separately").

- [ ] **Step 1: Ask.** State to the human: one omp estimate through the operator's LiteLLM endpoint (`local-litellm/<model>`), soft mode, a one-task plan; expected spend is one request of at most `inputTokens + bound` tokens; preconditions the human owns: (a) `~/.orca/profile.json` must declare a context window (today `contextWindowTokens: null` ⇒ `context-unavailable` for every estimator, spec §6), (b) its `framingTokenOverhead` covers spec §7's measured overhead, (c) the LiteLLM endpoint is up. Wait for an explicit yes.
- [ ] **Step 2 (only after yes):** run it in a disposable world as `docs/handoff/2026-10-12-oh-my-pi-acceptance.md` did (scratch HOME/XDG/control store, copied omp configuration files mode `0600` in `0700` directories, `ORCA_CCLOOP_BIN=/private/tmp/osc/ccl-build/dist/cli.js`); keep `events.jsonl`, `outcome.json`, `usage.json` and `config-overlay.yml` from the call's evidence directory; record: exactly one assistant `message_end`, its `usage`, the booked tokens, the estimate's state, and LiteLLM's own request count for that minute if the human can read it. Write the result into the handoff (Chinese) with the commit it ran on.

---

## Self-review (done while writing)

- **Spec coverage:** §3.1 → Task 1; §3.2 → Task 2 (resolution, descriptors, command, accept, strict schema); §3.3.1 → Task 4 (+ worker booking, Task 5); §3.3.2-§3.3.4 → Tasks 0, 4; §3.3.5-§3.3.7 → Task 5; process parameterisation → Task 3; §4 schema/type → Task 7; sizing → Task 8; clarify/split → Task 9; soft-only → unchanged `estimatorCompatibility` (no task: no change); §5 criteria 1-7 → Tasks 2, 4, 5 + Task 6; criteria 8-10 → Tasks 7, 8 + Task 10; §6 paid acceptance → Task 13; repin → Task 11; gates → Task 12.
- **Names used across tasks:** `CatalogRowV1`, `readOmpCatalog`, `readOmpModels`, `ompSingleCallExecution` (Task 1) → Tasks 2, 4; `runOmpProcess`, `OmpProcessInput`, `OmpPhaseOutcome` (Task 3) → Task 4; `OMP_SINGLE_CALL_OVERLAY`, `OmpSingleCallRefused`, `runOmpSingleCall`, `singleCallSystemPrompt` (Task 4) → Task 5; `decodeOmpSingleCall`, `parseSingleCallObject`, `assistantUsage` (Task 5); `AgentResolution.singleCallOutputCap` (Task 7) → Tasks 8, 9; `singleCallOutputBound` (Task 8) → Task 9.
