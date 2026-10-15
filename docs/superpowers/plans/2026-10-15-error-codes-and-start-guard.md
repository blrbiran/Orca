# ccloop Error Codes, #53 Start Guard and Three Small Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Orca session `026d10e3`, 2026-10-15, written on branch `docs/spec-error-codes-and-start-guard` at `docs(spec): fold the independent review into the error-code and start-guard specs` (`d3c02b7f`). Every line number below was read with `cat -n` / `grep -n` at that commit; the code under `src/`, `web/src/`, `tests/` and `skills/` is byte-identical on `main` (`28ac9eae`, `Merge branch 'ui/panel-taste'`: `git diff --stat b3bb5506 main -- src web/src tests web/tests skills` touches only `web/src/styles.css` and two style tests). ccloop line numbers were read at ccloop `dc51022` (main). **Re-measure before quoting one** (Rule 14); the tree is the truth — anchors below are text, apply them incrementally, never rebuild a file from this plan.

**Goal:** (A) ccloop's own error code and a cut detail reach the operator wherever a ccloop failure is shown today as `control-peer-exit` / `control-internal-error`, and a single call's `errorCode` is carried into the estimate, the requirement call record and the block reason; (B) a second `start` is refused by name while a group's execution is pending, and an unstarted task's loop plan stays editable while its group runs or is paused; plus three small human-approved fixes (#61 label, a coverage list entry, a ccloop test title).

**Architecture:** One parser in `src/control/ccloopPort.ts` (`peerFailure`) takes a `control-peer-exit` apart into exit, code and a cut detail; the HTTP mapper, the stored-code sites, `describeError` and the log lines all read it. The driver normalises a single-call record's `errorCode` once and passes it to the purpose handlers as an optional last argument. A new `src/control/executionPending.ts` holds the #53 predicate; the group view calls it over its read snapshot and `scheduleStart` calls its store entry before the probe (ledgered refusal) and again in the apply transaction. `setTaskLoop`'s group-state check becomes a status-and-stop-intent predicate; the per-task `task-already-started` check is untouched. The web gains `web/src/ccloopCodes.ts` and two locale tables.

**Tech Stack:** TypeScript (NodeNext ESM), zod 3, node:sqlite control store, express 5, React 19 + i18next (web), vitest 5 (root `tests/**/*.test.ts`, web `web/tests/**`), jsdom for DOM criteria.

**Spec:** `docs/superpowers/specs/2026-10-15-ccloop-error-codes-design.md` (spec A) and `docs/superpowers/specs/2026-10-15-start-guard-and-running-plan-edits-design.md` (spec B). Small items: feedback #61 (`docs/handoff/2026-10-14-feedback-triage.md` row 5; `.superpowers/sdd/2026-10-14-web-start-running/brief-59-61.md`, `progress.md:25-26`), `VIEW_REASONS` + `codex-rate-limited`, ccloop `tests/agents/registry.test.ts` title — all human-approved 2026-10-15.

## Global Constraints

- Language: code, comments and commit messages in English; the handoff (Task G Step 7) in Chinese.
- Git: `/usr/bin/git` only (plain `git` is wrapped by a proxy that misreports); commit with `/usr/bin/git commit -F <file>`; message = subject, blank line, `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never `git add -A` / `git add .` (the worktree's `node_modules` are symlinks); `git add` the exact paths each task lists.
- Mutations only in a `git clone --local` copy under `/private/tmp/oec/mut/` with `ln -s <main>/node_modules` (and `web/node_modules`); restore proven by the byte counts of `git diff` and `git diff --cached` = 0, read from redirected files.
- Expected values in criteria are literals, never computed by the code under test.
- A new criterion counts only after its named mutation was seen red (on the named assertion, not a crash or a load error).
- Existing criteria may be rewritten only where the specs' "Existing criteria this rewrites" lists name them (plus the human-named #61 pair and the ccloop title); any other existing test that goes red is reported, not edited.
- Targeted tests during tasks; the full gate only in Task G.
- No real provider call (no real `omp`, `codex` or `claude` prompt); every ccloop is a fake or the build clone with fake agents.
- Verification output is redirected to a file and read back whole (no `grep`/`tail`/`head` over a verification run; pipes swallow exit codes).
- Mutation verification is done by a fresh context (the task's reviewer), never by the implementer of the task.
- No push, merge, branch or worktree deletion by the agent (Rule 15, Tier 0): those go to the checkpoint's `awaitingHuman`.

## Review Focus

1. A peer exit during `apply-agent-update` happens after the outbox row is reserved and leaves it `pending`: it must still answer 500 (uncertain, the browser keeps the id), never 424 — pinned in Task A2 (`tests/panel/ccloopFailedMapping.test.ts` › "keeps an apply-agent-update …").
2. `1:file:///x` names no code, a 65-character "code" names none, control characters become spaces and the 512 cut never splits a surrogate pair — pinned in Task A1 (`tests/control/peerFailure.test.ts`).
3. A transient peer exit in a selection preview stays `kind: "unavailable"` (classification still on `error.code`) and confirm still rethrows it — pinned in Task A3 (`tests/control/peerCodeStored.test.ts` › "F2 …").
4. A start refused as `group-execution-pending` asks the agent nothing (port call count unchanged) and replays the identical body under the same `commandId` — pinned in Task B2 (`tests/control/startGuard.test.ts` › "C1 …").
5. A task whose earlier run finished (status `ready`, a `runs` row) in a `review` group still refuses its own loop-plan change, and its retry runs the contract frozen at its claim — pinned in Task B3 (`tests/control/setTaskLoopRunning.test.ts` › "C8 …").

## Spec corrections found while planning

Each is planned as written in the right-hand column; the specs are not edited (they are published history; a correction section can be appended by the human or a later docs task).

| # | Spec text | What the code says | Planned behaviour |
|---|---|---|---|
| K1 | A §4.1: code regex `^[^:]*:([a-z][a-z0-9-]{0,63})(?=:\|\s\|$)` "so `1:file:///…` does not yield `file`" | With `(?=:\|…)` the lookahead accepts the `:` after `file`, so `1:file:///x` yields `file`. ccloop prints `<code>` or `<code>: <detail>` (`ccloop src/control/command.ts:343-350`, `AgentError` message `code: detail`, `src/agents/types.ts:85`) | Lookahead `(?=$\|\s\|:\s\|:$)`: the code must be followed by the end, whitespace, `: ` or a final `:`. Criterion in Task A1 |
| K2 | A §4.2: "every ccloop call that a command makes happens before its transaction or inside a savepoint that is rolled back" | `apply-agent-update` reserves an `agent_update_outbox` row first and keeps it `pending` on any unknown subprocess outcome (`src/control/agentUpdates.ts:140-155`) | `WebControlService.applyAgentUpdate` rethrows a peer exit that left the operation pending as a plain `Error`, so the route keeps answering 500 `control-internal-error` (uncertain). Task A2, Review Focus 1 |
| K3 | A §5 rewrites `tests/control/driverEstimate.test.ts:27` | `:27` calls `service.completeEstimate("g", id, null, …)` directly: no call record, no `errorCode`; §4.5 adds the suffix only from a record | `:27` is not rewritten and stays green; Task A5 rewrites `:86` and `:136` only |
| K4 | A §5 crit 6: hostile `errorCode` `"x:y\n<script>"` "becomes `unknown`" | §4.5's own rule keeps the part before the first `:` when it is a code: `x` is one | That literal normalises to `x` (pinned); `"<b>x</b>:y\n"`, `"X-Y"`, a 65-char code and `""` pin `unknown`. Task A5 |
| K5 | A §4.8: "resolve the requirement's frozen `agentSlot` **partial**" | The calls run `agentSlot.selection` (`requirementCalls.ts:100` → `insertSingleCallRun`); resolving the partial could land on another model if a descriptor default moved | Resolve `agentSlot.selection` (a complete selection is a valid partial). Task A6 |
| K6 | B §5 rewrites `tests/control/setTaskLoop.test.ts:33` "(a paused group refuses → accepts)" | `:33` writes `body.stopped = true` with **no** stop intent — a stopped flag with no intent, which B §3.3 keeps refused | `:33` is not rewritten (stays green); the paused-group acceptance is a new real-state criterion. Task B3 |
| K7 | B §5's rewrite list is complete | `tests/control/fixtures/driverHarness.ts:78-84` `claim()` sends a fresh `start` for **every** claim. Criteria that claim twice while a run is active (e.g. `configHashPerTask.test.ts:44`, `driverReconcileN.test.ts:53` and `:73`, `setTaskLoopConfirmed.test.ts:150`) will be refused `group-execution-pending` and go red | Task B2 runs a census and **stops for the human** with the exact list and two options (fixture change vs. named rewrites); nothing is edited before the ruling |
| K8 | Small item 3: the title is wrong "now that omp also answers singleCallExecution" | The test is in **ccloop** (`tests/agents/registry.test.ts:80`); its drift is `contextWindowTokens`: omp's `capabilities(_config, row)` returns `row?.contextWindow ?? null` (`ccloop src/agents/omp.ts:31-39`), so "null otherwise" is false for omp | Task S3 retitles it in a ccloop worktree; ccloop Rule 15(c)/16 require an appended comment naming the ruling (the published comment at `:79` stays verbatim) |

## Controller rulings before execution (Orca session 026d10e3, 2026-10-15; the human delegated: "有问题先按你的建议执行")

- **R1 (K7):** Option A. `driverHarness.claim()` arms later claims the way the driver does; the fixture change is listed for the human. Task B2 Step 6 does not stop.
- **R2 (K1-K8):** the two specs are unpublished drafts on this branch; each gets an appended "Corrections found while planning" section pointing at the table above. The plan's right-hand column is what is built.
- **R3 (generic text):** the fallback sentence must not say "ccloop" (Orca-only codes reach some surfaces, e.g. `saved-result-evidence-unavailable`). `ccloop.generic` = `{{code}}: {{detail}}` (en and zh), `ccloop.genericNoDetail` = `{{code}}`. The lookup order stays: ccloop table, then Orca's table, then the generic form. Task A7's test literals follow mechanically: `ccloop failed with X: y` → `X: y`, `ccloop failed with X.` → `X`, `ccloop 失败（X）：y` → `X：y`, `ccloop 失败（X）。` → `X` (9 occurrences in the A7 steps; the surrounding text of each literal is unchanged).
- **R4:** the six A8 log-line sites without a criterion are accepted as registered gaps.
- **R5 (S3):** on ccloop branch `codex/attempt-commit-no-hooks` (worktree `/Users/biran/code/skills/orca/ccloop-wt/attempt-commit-no-hooks`), on top of `fix(workspace): run the attempt commit without the target repository's hooks`.

## Interpretations recorded (not in the spec text; reversible, Rule 1 step 2)

- **`peerFailure` of a peer exit with no detail** (`new ControlError("control-peer-exit")`): `{ exit: "", code: null, detail: "" }`, so the HTTP answer is `ccloop-failed:unknown` and the stored reason is `control-peer-exit`. The existing criterion at `agentSelectionApi.test.ts:240-265` throws exactly that.
- **Message forms**: `ccloop-failed:<code|unknown>` when the detail is empty, else `ccloop-failed:<code|unknown>: <detail>`. Stored run reason after the prefix: `<exit>[:<code>][: <detail>]` (`peerExitText`). Both drop the `: ` when the detail is empty, so `accept-refused:2:control-config-hash-mismatch` (`executionDriver.test.ts:134`) is unchanged.
- **The 512 cut**: total length ≤ 512 including the trailing `…` (511 units + `…`), one unit less when unit 511 would be a lone high surrogate.
- **C0/C1**: `\u0000-\u001f` and `\u0080-\u009f`; `\u007f` (DEL) is in neither set and is kept.
- **A single call's failure** is passed to the handlers as `failure: string | null`: non-null only when `record.outcome !== "complete"` and ccloop named a code (normalised, possibly `unknown`). A failed call with `errorCode: null` keeps today's handling.
- **`estimate-call-failed:<code>`** is built in `completeEstimateInStore`'s local `reasonCode: string | null`; `EstimateOutputClass` (`estimator.ts:141-143`) describes what `classifyEstimateOutput` returns, which is unchanged, so its union is not widened.
- **`refusalText` vs `explainRefusal`** (A §4.6 row 1): `refusalText` (`web/src/i18n.ts:136-141`, used by `ControlPanel.tsx:317`, `ProjectControl.tsx`, `ErrorPage.tsx`) shows the new `ccloop-failed` error-table entry ("ccloop failed: {{detail}}" → code and detail verbatim); `explainRefusal` (`RefusalNotice`, every command refusal in a group) adds the known-code explanation. Calling `ccloopCodes.ts` from `i18n.ts` would make an `i18n.ts ↔ ccloopCodes.ts` import cycle.
- **Generic text** lives in the `en`/`zh` translation objects (`ccloop.generic`, `ccloop.genericNoDetail`), not in the error tables (those may interpolate only message/status/detail).
- **Stale-but-green web criteria** (A §5: `agentPreviewRefresh.test.tsx:184,224,317,339`, `agentSelectionEditor.test.tsx:55,143`) are left unchanged: a peer exit with no parseable code is still sent as `control-peer-exit` (slot) and a non-peer read failure still as 500 `control-internal-error`, so they still model real shapes. New criteria are added beside them.
- **Overview gate** (B §3.1): `controlOverview.ts:94-98` counts any active run and lists `continuation`. `continuation` is never written; a non-work active run in a `ready` group with no busy task is unreachable (an active estimate run implies estimate state `running`/`start-unknown`, already `estimateLaunching`; a handoff-phase run implies a held/continuing task). It cannot disagree in a reachable state, so it is **not** changed (Rule 3). `BUSY_WORK` moves to `src/control/executionPending.ts` and `controlViews.ts` re-exports it, so `controlOverview.ts:8` is untouched.
- **Store entry of the predicate** reads the group's `kind: "task"` work items (the same set as the plan's tasks for a planned group) so it needs no archived-plan read inside `start`'s transaction.
- **Log line for the model-assisted handoff probe** (`stopIntent.ts:654`): the probe already swallowed the error into `probeFailureCode`, so the line carries the code only: `orca-driver: <runId>: ccloop <code>`.

## Existing criteria that change

Named by the specs (rewritten whole, a comment says what each now encodes):
- `tests/panel/agentSelectionApi.test.ts:258-263` (A2) — 500 `control-internal-error` → 424 `ccloop-failed`.
- `tests/control/driverEstimate.test.ts:86` and `:136` (A5).
- `tests/control/driverRequirementSplit.test.ts:57` (A5).
- `tests/control/setTaskLoop.test.ts:24-31` (B3).
- `web/tests/loopPlanEdit.test.tsx:148-157` and `web/tests/budgetI18n.test.tsx:150` (B3).
- `web/tests/controlI18n.test.tsx:76` and `:144` (S1, human-named 2026-10-15).
- ccloop `tests/agents/registry.test.ts:80` title (S3, human-named 2026-10-15).

Fixture changes (default-preserving, listed for the human per handoff §6.9): `tests/control/fixtures/estimateHarness.ts` (`errorCode` option), `tests/control/fixtures/requirementHarness.ts` (`errorCode` on an answer; `setResolveAgent`/`baseResolveAgent`). `driverHarness.ts` only if the human picks Option A in Task B2.

## File Structure

| Path | Responsibility |
|---|---|
| `src/control/ccloopPort.ts` (modify) | `peerFailure`, `peerCode`, `peerExitText`, `ccloopFailedMessage`, `peerFailureLogLine`; `peerErrorCode` redefined through `peerFailure` |
| `src/panel/controlErrors.ts` (modify) | 424 in `ControlHttpStatus`; `ccloop-failed` in the panel-only catalog; peer exit → 424 |
| `src/control/webService.ts` (modify) | apply-agent-update keeps an unknown outcome 500; stored installation codes; estimate suffix; human retry recomputes the bound; `setTaskLoop` editability |
| `src/control/profiles.ts`, `src/control/planImport.ts`, `src/control/agentFreeze.ts`, `src/panel/controlViews.ts`, `src/control/savedResultRecovery.ts` (modify) | stored codes become `peerCode(error)`; types widen to `string` |
| `src/control/executionDriver.ts` (modify) | `describeError` and `accept-refused` cut; `normalizeSingleCallErrorCode`; failure threading and usage-unknown suffix; log lines |
| `src/control/singleCallPurposes.ts`, `src/control/requirementCalls.ts` (modify) | handler signature gains `failure?`; clarify/split record `failed` + code; no automatic retry for a pre-spawn refusal |
| `src/control/stopIntent.ts` (modify) | `applyRecoveryRetry(deps, command, outputBound)`; the bound stored on re-queue; handoff probe log line |
| `src/control/driverHandoff.ts`, `src/control/dispatch.ts` (modify) | log lines on the "unknown" paths |
| `src/control/executionPending.ts` (create) | `BUSY_WORK`, `EXECUTION_WAKE_KINDS`, `executionPendingFrom`, `groupExecutionPending` (snapshot), `groupExecutionPendingInStore` |
| `src/control/webDispatch.ts` (modify) | the `group-execution-pending` guard before the probe and in the transaction |
| `src/control/errors.ts` (modify) | durable `group-execution-pending: 409` |
| `skills/orca-control/SKILL.md` (modify) | line 32 names the refusal |
| `web/src/ccloopCodes.ts` (create) | `explainCcloopCode`, `codeAndDetail`, `peerExitReason`, `explainEstimateReason` |
| `web/src/refusalExplain.ts`, `web/src/AgentSelectionEditor.tsx`, `web/src/AgentSettings.tsx`, `web/src/ControlGroupView.tsx`, `web/src/TaskDetail.tsx`, `web/src/RequirementsPanel.tsx`, `web/src/LoopPlanCard.tsx`, `web/src/runFacts.ts` (modify) | each surface calls the explainer; loop-plan predicate; #61 label + run number |
| `web/src/locales/en.ts`, `web/src/locales/zh.ts` (modify) | error entries `ccloop-failed`, `control-peer-exit`, `group-execution-pending`; `enCcloopErrors`/`zhCcloopErrors`; `ccloop.generic*`; #61 keys |
| `tests/panel/refusalCoverage.test.ts` (modify) | `CCLOOP_CODES`; `control-peer-exit` and `codex-rate-limited` in `VIEW_REASONS` |
| ccloop `tests/agents/registry.test.ts` (modify, ccloop repo) | title only, plus an appended comment |
| new tests | listed in each task |

---

## Setup (once, before Task A1)

- [ ] **U1: Scratch root** (short real path; tsx sockets; `/private/tmp` survives only until macOS cleans it — handoff §6.9)

```bash
test ! -e /private/tmp/oec && mkdir -m 700 /private/tmp/oec /private/tmp/oec/logs /private/tmp/oec/mut /private/tmp/oec/gate /private/tmp/oec/gate/tmp; echo rc=$?
```
Expected `rc=0`. If `/private/tmp/oec` exists, stop and ask (another session's data).

- [ ] **U2: Implementation worktree from `main`** (the design branch is a sibling of main; main holds the repin)

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca status --porcelain > /private/tmp/oec/logs/u2-main-status.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca rev-parse main > /private/tmp/oec/logs/u2-main.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca worktree add -b feat/error-codes-start-guard /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard main > /private/tmp/oec/logs/u2-wt.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/u2-wt.log
ln -s /Users/biran/code/skills/orca/Orca/node_modules /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/node_modules
ln -s /Users/biran/code/skills/orca/Orca/web/node_modules /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web/node_modules
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && npm run build --workspace web > /private/tmp/oec/logs/u2-webbuild.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/u2-webbuild.log
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard status --porcelain > /private/tmp/oec/logs/u2-status.log 2>&1
```
Read every log whole. Expected: main status empty; main = `28ac9eae…` (record the full sha; if it moved, re-run `git diff --stat 28ac9eae main -- src web/src tests web/tests skills` and re-measure every anchor in the touched files); worktree added; web build `rc=0`; worktree status empty (`/node_modules`, `/web/node_modules` and `dist/` are in `.gitignore`). The plan and specs are read from `/Users/biran/code/skills/orca/Orca-wt/design-20261015/docs/superpowers/`. Root tests: `./node_modules/.bin/vitest run <file>`; web tests: `cd web && ../node_modules/.bin/vitest run tests/<file>` (`web/node_modules` is empty; deps are hoisted).

- [ ] **U3: Mutation tooling** (per task, the reviewer clones the task's commit; Tier 0 blocks `pull`/`checkout`/`reset` even in clones, so each task gets a fresh clone)

Write `/private/tmp/oec/mut/mutate.mjs`:

```js
// Usage: node mutate.mjs <file> <spec.json>; spec is {"from": string, "to": string, "count"?: number} or an array of them,
// applied in order. Refuses (exit 2, file untouched) unless each `from` occurs exactly `count` (default 1) times at its turn.
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

Write `/private/tmp/oec/mut/mut.sh` (`chmod 700`):

```bash
#!/bin/bash
# Usage: mut.sh <clone> <name> <relative file> <spec.json> <dir: root|web> <test file relative to dir> [<-t pattern>]
C=$1; N=$2; F=$3; SPEC=$4; D=$5; T=$6; P=${7:-}
L=/private/tmp/oec/mut/logs; mkdir -p "$L" "/private/tmp/oec/mut/orig/$N"
cat "$C/$F" > "/private/tmp/oec/mut/orig/$N/file"
shasum -a 256 "$C/$F" > "$L/$N.sha-before"
node /private/tmp/oec/mut/mutate.mjs "$C/$F" "$SPEC" > "$L/$N.mutate" 2>&1 || { echo "mutate failed: $N" >> "$L/$N.mutate"; exit 2; }
shasum -a 256 "$C/$F" > "$L/$N.sha-after"
if [ "$D" = web ]; then W="$C/web"; VT=../node_modules/.bin/vitest; else W="$C"; VT=./node_modules/.bin/vitest; fi
if [ -n "$P" ]; then (cd "$W" && "$VT" run "$T" -t "$P" > "$L/$N.red.log" 2>&1); else (cd "$W" && "$VT" run "$T" > "$L/$N.red.log" 2>&1); fi
echo "rc=$?" > "$L/$N.red.rc"
cat "/private/tmp/oec/mut/orig/$N/file" > "$C/$F"
shasum -a 256 "$C/$F" > "$L/$N.sha-restored"
/usr/bin/git -C "$C" diff > "$L/$N.diff"; /usr/bin/git -C "$C" diff --cached > "$L/$N.cached"
wc -c "$L/$N.diff" "$L/$N.cached" > "$L/$N.restore-bytes"
```

Clone recipe (used as "Mutation setup" in each task; `<T>` is the task id, e.g. `a1`):

```bash
/usr/bin/git clone -q --local --branch feat/error-codes-start-guard /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard /private/tmp/oec/mut/<T> > /private/tmp/oec/logs/<T>-clone.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/<T>-clone.log
ln -s /Users/biran/code/skills/orca/Orca/node_modules /private/tmp/oec/mut/<T>/node_modules
ln -s /Users/biran/code/skills/orca/Orca/web/node_modules /private/tmp/oec/mut/<T>/web/node_modules
/usr/bin/git -C /private/tmp/oec/mut/<T> log --oneline -1 > /private/tmp/oec/logs/<T>-head.log 2>&1
```
For a task whose mutations run `tests/panel/*`, also `cd /private/tmp/oec/mut/<T> && npm run build --workspace web > /private/tmp/oec/logs/<T>-webbuild.log 2>&1` (else `panel-dist-missing` false reds, handoff §6.7). Before the first mutation of a task: self-check the runner with a bad spec (`{"from":"no such text","to":"x"}` → `exit 2`, `.mutate` says "found 0", `restore-bytes` both 0), then run the task's test files once in the clone (green baseline, 0 skipped). For each mutation read `<name>.mutate`, the three sha files (after ≠ before = restored), `<name>.red.log` whole (red on the named assertion) and `<name>.restore-bytes` (both `0`). `pgrep -fl "fake-ccloop|worker.js|vitest"` before and after each task's mutations; a leftover process is reported, killing it needs the human. A mutation that stays green is a missing criterion: add the test in the owning task (new test only), re-run, record both.

---

### Task A1: One parser for a peer failure (spec A §4.1; criterion 2)

**Files:**
- Modify: `src/control/ccloopPort.ts:51-59` (the `peerErrorCode` block; the rest of the file is untouched)
- Test (create): `tests/control/peerFailure.test.ts`

**Interfaces:**
- Consumes: `ControlError` (`src/control/errors.ts:354-359`).
- Produces (all exported from `src/control/ccloopPort.ts`):
  - `export const PEER_DETAIL_MAX = 512;`
  - `export interface PeerFailure { readonly exit: string; readonly code: string | null; readonly detail: string }`
  - `export function peerFailure(error: unknown): PeerFailure | null`
  - `export function peerErrorCode(error: unknown): string | null` (same signature as today)
  - `export function peerCode(error: ControlError): string`
  - `export function peerExitText(failure: PeerFailure): string`
  - `export function ccloopFailedMessage(failure: PeerFailure): string`
  - `export function peerFailureLogLine(runId: string, error: unknown): string | null`

- [ ] **Step 1: Write the failing test** — create `tests/control/peerFailure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ccloopFailedMessage, peerCode, peerErrorCode, peerExitText, peerFailure, peerFailureLogLine } from "../../src/control/ccloopPort.js";
import { ControlError } from "../../src/control/errors.js";

// ccloop error codes spec (2026-10-15) §4.1, criterion 2: ccloop exits non-zero with `<code>[: <detail>]` on stderr and Orca
// sees `control-peer-exit` with detail `<exit>:<stderr>`. One parser takes it apart; every site that stores or shows a
// ccloop failure reads it, so a wrong code or an uncut stderr here reaches the database and the browser.
const peer = (detail?: string) => new ControlError("control-peer-exit", detail);

describe("peerFailure (spec A §4.1)", () => {
  it("reads ccloop's code and the detail after it", () => {
    expect(peerFailure(peer("2:omp-model-catalog-unavailable: spawn ENOENT"))).toEqual({ exit: "2", code: "omp-model-catalog-unavailable", detail: "spawn ENOENT" });
    expect(peerFailure(peer("2:agent-version-drift"))).toEqual({ exit: "2", code: "agent-version-drift", detail: "" });
    expect(peerFailure(peer("2:agent-x something else"))).toEqual({ exit: "2", code: "agent-x", detail: "something else" });
  });

  it("names no code for a URL, an upper-case word or a 65-character run, and keeps the whole stderr as the detail", () => {
    expect(peerFailure(peer("1:file:///x"))).toEqual({ exit: "1", code: null, detail: "file:///x" });
    expect(peerFailure(peer("1:Error: socket closed"))).toEqual({ exit: "1", code: null, detail: "Error: socket closed" });
    const sixtyFour = `a${"b".repeat(63)}`;
    expect(peerFailure(peer(`2:${sixtyFour}: d`))).toEqual({ exit: "2", code: sixtyFour, detail: "d" });
    expect(peerFailure(peer(`2:${sixtyFour}b: d`))).toEqual({ exit: "2", code: null, detail: `${sixtyFour}b: d` });
  });

  it("replaces every C0 and C1 control character with a space and trims", () => {
    expect(peerFailure(peer("2:agent-config-invalid: line1\nline2\tx\u0085y\u0007"))).toEqual({ exit: "2", code: "agent-config-invalid", detail: "line1 line2 x y" });
  });

  it("cuts the detail to 512 UTF-16 units with a trailing ellipsis, never splitting a surrogate pair", () => {
    const long = peerFailure(peer(`1:${"a".repeat(600)}`))!;
    expect([long.code, long.detail, long.detail.length]).toEqual([null, `${"a".repeat(511)}…`, 512]);
    const emoji = peerFailure(peer(`1:${"😀".repeat(300)}`))!;
    expect([emoji.detail, emoji.detail.length]).toEqual([`${"😀".repeat(255)}…`, 511]);
  });

  it("answers an empty failure for a peer exit with no detail, and null for anything that is not a peer exit", () => {
    expect(peerFailure(peer())).toEqual({ exit: "", code: null, detail: "" });
    expect(peerFailure(new ControlError("control-peer-timeout"))).toBeNull();
    expect(peerFailure(new Error("control-peer-exit:2:agent-version-drift"))).toBeNull();
  });
});

describe("the forms built on it (spec A §4.2-§4.4, §4.9)", () => {
  it("peerCode is ccloop's code, else control-peer-exit, and any other ControlError's own code", () => {
    expect([peerCode(peer("2:omp-model-catalog-unavailable: x")), peerCode(peer("1:Error: x")), peerCode(new ControlError("control-peer-timeout"))])
      .toEqual(["omp-model-catalog-unavailable", "control-peer-exit", "control-peer-timeout"]);
    expect([peerErrorCode(peer("1:file:///x")), peerErrorCode(peer("2:agent-version-drift: table says 2.1.0"))]).toEqual([null, "agent-version-drift"]);
  });

  it("writes the stored, HTTP and log forms", () => {
    expect([peerExitText(peerFailure(peer("2:agent-config-invalid: bad"))!), peerExitText(peerFailure(peer("2:agent-version-drift"))!),
      peerExitText(peerFailure(peer("1:Error: x"))!), peerExitText(peerFailure(peer("1"))!), peerExitText(peerFailure(peer())!)])
      .toEqual(["2:agent-config-invalid: bad", "2:agent-version-drift", "1:Error: x", "1", ""]);
    expect([ccloopFailedMessage(peerFailure(peer("2:omp-model-catalog-unavailable: spawn ENOENT"))!), ccloopFailedMessage(peerFailure(peer())!),
      ccloopFailedMessage(peerFailure(peer("1:Error: x"))!)])
      .toEqual(["ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", "ccloop-failed:unknown", "ccloop-failed:unknown: Error: x"]);
    expect([peerFailureLogLine("run-1", peer("2:agent-config-invalid: bad")), peerFailureLogLine("run-1", peer("1:Error: x")),
      peerFailureLogLine("run-1", new ControlError("control-peer-timeout"))])
      .toEqual(["orca-driver: run-1: ccloop agent-config-invalid: bad\n", "orca-driver: run-1: ccloop unknown: Error: x\n", null]);
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/control/peerFailure.test.ts > /private/tmp/oec/logs/a1-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a1-red.log
```
Read it whole. Expected: every test red with `peerFailure is not a function` / `peerCode is not a function` (not exported yet), `rc=1`. The `peerErrorCode` half of the third test would pass today; it is the regression pin for the redefinition.

- [ ] **Step 3: Implement** — replace `src/control/ccloopPort.ts:51-59` (the doc comment from `/**` through the closing `}` of `peerErrorCode`) with:

```ts
/** Spec 2026-10-15 ccloop error codes §4.1: the most of a peer's stderr Orca keeps or shows, in UTF-16 code units. */
export const PEER_DETAIL_MAX = 512;
/**
 * ccloop's leading code: `<exit>:<code>` followed by the end, whitespace, `: ` or a final `:` -- so `1:file:///x` names
 * no code (plan correction K1: a bare `:` after the code is a URL's, not ccloop's `<code>: <detail>`).
 */
const PEER_CODE = /^[^:]*:([a-z][a-z0-9-]{0,63})(?=$|\s|:\s|:$)/;
/** C0 and C1 control characters, written as \u escapes in this source (never as raw bytes). */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u0080-\u009f]/g;
export interface PeerFailure { readonly exit: string; readonly code: string | null; readonly detail: string }

function cutDetail(text: string): string {
  const flat = text.trim().replace(CONTROL_CHARACTERS, " ").trim();
  if (flat.length <= PEER_DETAIL_MAX) return flat;
  let end = PEER_DETAIL_MAX - 1;
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${flat.slice(0, end)}…`;
}

/**
 * A `control-peer-exit` (ccloop exited non-zero; its detail is `<exit>:<stderr>`) taken apart: the exit, ccloop's leading
 * code when it printed one, and the rest of its stderr cut for storage and display. Null for any other failure.
 */
export function peerFailure(error: unknown): PeerFailure | null {
  if (!(error instanceof ControlError) || error.code !== "control-peer-exit") return null;
  const raw = error.detail ?? "";
  const colon = raw.indexOf(":");
  const exit = colon === -1 ? raw : raw.slice(0, colon), stderr = colon === -1 ? "" : raw.slice(colon + 1);
  const code = PEER_CODE.exec(raw)?.[1] ?? null;
  return { exit, code, detail: cutDetail(code === null ? stderr : stderr.slice(code.length).replace(/^:/, "")) };
}

/**
 * The ccloop error code inside a `control-peer-exit` (ccloop prints `<code>[: detail]` on stderr and exits non-zero),
 * or null for any other failure. Agent selection spec §7: `agent-selection-rejected:<taskId|slot>:<ccloop code>`
 * names the code, so it is read here, where the peer's output is parsed, and nowhere else.
 */
export function peerErrorCode(error: unknown): string | null {
  return peerFailure(error)?.code ?? null;
}

/** §4.3: the code Orca stores for a failure -- ccloop's own for a peer exit (else `control-peer-exit`), another ControlError's code. */
export function peerCode(error: ControlError): string {
  if (error.code !== "control-peer-exit") return error.code;
  return peerFailure(error)?.code ?? "control-peer-exit";
}

/** §4.4: a peer exit after its reason prefix -- `<exit>[:<code>][: <detail>]`, the detail cut. */
export function peerExitText(failure: PeerFailure): string {
  const body = failure.code === null ? failure.detail : failure.detail === "" ? failure.code : `${failure.code}: ${failure.detail}`;
  return body === "" ? failure.exit : `${failure.exit}:${body}`;
}

/** §4.2: the message of a `ccloop-failed` answer. */
export function ccloopFailedMessage(failure: PeerFailure): string {
  return `ccloop-failed:${failure.code ?? "unknown"}${failure.detail === "" ? "" : `: ${failure.detail}`}`;
}

/** §4.9: the stderr line for a peer failure a path leaves as "unknown"; null for any other failure. */
export function peerFailureLogLine(runId: string, error: unknown): string | null {
  const failure = peerFailure(error);
  if (failure === null) return null;
  return `orca-driver: ${runId}: ccloop ${failure.code ?? "unknown"}${failure.detail === "" ? "" : `: ${failure.detail}`}\n`;
}
```

⚠️ The write tool can turn `\u0000` into a raw NUL byte (handoff §6.6). After writing, prove the bytes: `python3 -I -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\\x00'), b.count(b'\\\\u0000-\\\\u001f'))" src/control/ccloopPort.ts > /private/tmp/oec/logs/a1-bytes.log 2>&1` and read it: expected `0 1`.

- [ ] **Step 4: Run green, with the port's existing criteria**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/control/peerFailure.test.ts tests/control/ccloopPort.test.ts tests/control/agentFreeze.test.ts tests/control/taskResultCollector.test.ts > /private/tmp/oec/logs/a1-green.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a1-green.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && npm run typecheck > /private/tmp/oec/logs/a1-tc.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a1-tc.log
```
Read both whole: all pass, 0 skipped (`ccloopPort.test.ts:188-195` "reads ccloop's error code out of a peer exit…" stays green unchanged); typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && /usr/bin/git add src/control/ccloopPort.ts tests/control/peerFailure.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard diff --cached > /private/tmp/oec/logs/a1-diff.log 2>&1
printf 'feat(control): read ccloop'"'"'s code and cut detail out of a peer exit\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\n' > /private/tmp/oec/logs/a1-msg.txt
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard commit -q -F /private/tmp/oec/logs/a1-msg.txt
```
Read `a1-diff.log` before committing (only the two paths).

- [ ] **Step 6 (reviewer, clone `a1`): mutations** — file `src/control/ccloopPort.ts`, test `tests/control/peerFailure.test.ts`, dir `root`:
  - `A1a` drop the code-end anchor: `{"from": "(?=$|\\s|:\\s|:$)", "to": ""}` — red: "names no code for a URL…" (`code: "file"` received) only.
  - `A1b` drop the cut: `{"from": "  if (flat.length <= PEER_DETAIL_MAX) return flat;\n", "to": "  return flat;\n"}` — red: "cuts the detail to 512…".
  - `A1c` keep control characters: `{"from": ".replace(CONTROL_CHARACTERS, \" \")", "to": ""}` — red: "replaces every C0 and C1…".
  - `A1d` split a surrogate: `{"from": "  if (last >= 0xd800 && last <= 0xdbff) end -= 1;\n", "to": ""}` — red: "cuts the detail…" at the emoji line only.

---

### Task A2: A peer exit over HTTP is a definite, named failure (spec A §4.2; criterion 1; correction K2)

**Files:**
- Modify: `src/panel/controlErrors.ts:1-3` (imports), `:7` (`ControlHttpStatus`), `:20-21` (panel-only catalog), `:86-94` (the fallback of `sendMappedControlError`)
- Modify: `src/control/webService.ts:1` (import), `:688-711` (`applyAgentUpdate`)
- Modify: `web/src/locales/en.ts` (`enErrors`, after `"agent-selection-rejected"` at `:1060`), `web/src/locales/zh.ts` (`zhErrors`, the same place)
- Modify (named rewrite): `tests/panel/agentSelectionApi.test.ts:258-263`; append two criteria after that test (ends `:265`)
- Test (create): `tests/panel/ccloopFailedMapping.test.ts`, `web/tests/ccloopFailed.test.ts`

**Interfaces:**
- Consumes: Task A1's `peerFailure`, `ccloopFailedMessage`.
- Produces: `type ControlHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 424 | 500 | 503`; catalog entry `{ code: "ccloop-failed", status: 424 }` (served by `GET /api/control/config` `errorCatalog`); HTTP body `{ error: { code: "ccloop-failed", message: ccloopFailedMessage(failure), commandRevision, evidenceIds: [], retryable: true } }`; error-table entries `enErrors["ccloop-failed"]`, `zhErrors["ccloop-failed"]`.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/panel/ccloopFailedMapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { WebControlService } from "../../src/control/webService.js";
import { sendMappedControlError } from "../../src/panel/controlErrors.js";
import { webFixture } from "../control/fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.2, criterion 1: a peer exit is a definite failure -- the web files a status under
// 500 as a refusal and stops looking the command up -- so it must carry ccloop's code and detail and stay retryable.
// Plan correction K2: apply-agent-update is the one command whose ccloop call runs after it reserved durable state.
const recorder = () => {
  const r = { statusCode: 0, body: undefined as unknown, status(code: number) { r.statusCode = code; return r; }, json(body: unknown) { r.body = body; return r; } };
  return r;
};
const mapped = (error: unknown) => { const r = recorder(); sendMappedControlError(r as never, error); return { status: r.statusCode, body: r.body }; };

describe("a peer exit over HTTP (spec A §4.2)", () => {
  it("maps a peer exit to 424 ccloop-failed with ccloop's code and detail, and one with no code as unknown", () => {
    expect(mapped(new ControlError("control-peer-exit", "2:agent-config-invalid: bad table"))).toEqual({ status: 424,
      body: { error: { code: "ccloop-failed", message: "ccloop-failed:agent-config-invalid: bad table", commandRevision: null, evidenceIds: [], retryable: true } } });
    expect(mapped(new ControlError("control-peer-exit"))).toEqual({ status: 424,
      body: { error: { code: "ccloop-failed", message: "ccloop-failed:unknown", commandRevision: null, evidenceIds: [], retryable: true } } });
    // Unchanged (spec A §3): a peer timeout and anything that is not a ControlError stay retryable internal errors.
    expect([mapped(new ControlError("control-peer-timeout")).status, mapped(new Error("boom")).status]).toEqual([500, 500]);
  });

  it("keeps an apply-agent-update whose ccloop exited after the outbox reserved it an unknown outcome (500), its operation pending", async () => {
    const h = await webFixture(); try {
      const port = {
        ...(h.deps.port as unknown as Record<string, unknown>),
        previewAgentInstallations: async () => ({ schema: "orca-agent-detection-preview-v1", previewId: "preview-1", baseTableHash: "a".repeat(64),
          observedAt: "2026-10-15T00:00:00.000Z", installed: [], changes: [{ changeId: "change-1" }] }),
        applyAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-installation-apply-failed: disk full"); },
      } as unknown as ExecutionPort;
      const service = new WebControlService({ ...h.deps, port });
      await service.previewAgentUpdates();
      const command = { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0, actorId: "human", verb: "apply-agent-update",
        target: { kind: "operator", operatorId: "human" }, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } } as never;
      const failure = await service.applyAgentUpdate(command, { client: "web", principal: "user:owner" }).then(() => null, (error: unknown) => error);
      expect(mapped(failure).status).toBe(500);
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "pending" });
    } finally { await h.dispose(); }
  });
});
```

(b) Create `web/tests/ccloopFailed.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendControlCommand } from "../src/controlApi.js";

afterEach(() => { vi.unstubAllGlobals(); });

// ccloop error codes spec (2026-10-15) §4.2: the server's 424 is only useful if the web files it as a durable refusal --
// a status of 500 or more is "may not have committed" and is looked up instead (controlApi.ts sendControlCommand). This
// pins the web side the server change relies on; it is green before Task A2 (no web change is needed).
describe("a 424 ccloop-failed in the browser", () => {
  it("is an answered refusal, not an uncertain outcome", async () => {
    const body = { error: { code: "ccloop-failed", message: "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", commandRevision: 3, evidenceIds: [], retryable: true } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 424, headers: { "content-type": "application/json" } })));
    expect(await sendControlCommand("/api/control/groups/g/confirm", { commandId: "c-1", expectedRevision: 3, payload: {} } as never))
      .toEqual({ kind: "answered", status: 424, body });
  });
});
```

(c) In `tests/panel/agentSelectionApi.test.ts` the named rewrite. Old (`:258-263`):

```ts
    // The confirm is not bound to a partial resolution: the transient failure is rethrown, which the panel serves as
    // a retryable internal error (a transient code has no durable status) -- not as a selection refusal.
    const confirmed = await confirm(panel, "agents-confirm-flaky", "0".repeat(64));
    expect(confirmed.status).toBe(500);
    expect(confirmed.body).toMatchObject({ error: { code: "control-internal-error", retryable: true } });
```
New:

```ts
    // The confirm is not bound to a partial resolution: the transient failure is rethrown, which the panel serves as
    // a retryable internal error (a transient code has no durable status) -- not as a selection refusal.
    // Rewritten for the ccloop error codes spec (2026-10-15; its §5 names this criterion): this now encodes that the
    // rethrown peer exit is answered 424 ccloop-failed, retryable, still not a selection refusal; this stand-in printed no code.
    const confirmed = await confirm(panel, "agents-confirm-flaky", "0".repeat(64));
    expect(confirmed.status).toBe(424);
    expect(confirmed.body).toMatchObject({ error: { code: "ccloop-failed", message: "ccloop-failed:unknown", retryable: true } });
```

(d) Append after that test (after its closing `});` at `:265`):

```ts
  // ccloop error codes spec (2026-10-15) §4.2, criterion 1: ccloop's code and detail reach the browser, and nothing is booked.
  it.each([
    ["names its code", "2:omp-model-catalog-unavailable: spawn ENOENT", "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT"],
    ["prints no code", "1:Error: socket closed", "ccloop-failed:unknown: Error: socket closed"],
  ])("answers a confirm whose ccloop %s as 424 ccloop-failed carrying it, and books no command row", async (_label, stderr, message) => {
    const failing = async (partial: PartialSelection) => {
      if (partial.agent === "codex") throw new ControlError("control-peer-exit", stderr);
      return claudeCodexResolveAgent(partial);
    };
    const panel = await boot(`epoch-ccloop-${message.length}`, { resolveAgent: failing });
    expect((await setPreferences(panel, "prefs-c", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const before = await view(panel);
    expect((await command(panel, `/api/control/groups/${GROUP}/proposal/agent`, {
      commandId: "agent-task-c", expectedRevision: before.summary.commandRevision,
      payload: { baseProposalVersion: before.proposal.proposalVersion, scope: { kind: "task", taskId: "a" }, partial: { agent: "codex" } },
    })).status).toBe(200);
    const confirmed = await confirm(panel, "agents-confirm-ccloop", "0".repeat(64));
    expect(confirmed.status).toBe(424);
    expect(confirmed.body).toMatchObject({ error: { code: "ccloop-failed", message, retryable: true } });
    expect(panel.store.db.prepare("SELECT id FROM commands WHERE id='agents-confirm-ccloop'").get()).toBeUndefined();
    await panel.close();
  });
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/panel/ccloopFailedMapping.test.ts tests/panel/agentSelectionApi.test.ts > /private/tmp/oec/logs/a2-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-red.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web && ../node_modules/.bin/vitest run tests/ccloopFailed.test.ts > /private/tmp/oec/logs/a2-red-web.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-red-web.log
```
Read both whole. Expected red: "maps a peer exit to 424…" (`500` received), the rewritten "previews a slot whose installation fails transiently…" (`500` received), both rows of "answers a confirm whose ccloop…" (`500`). "keeps an apply-agent-update…" is **green** here (it pins today's 500 against the change). The web test is green (pin; see its comment).

- [ ] **Step 3: Implement**

`src/panel/controlErrors.ts`: after line 2 add `import { ccloopFailedMessage, peerFailure } from "../control/ccloopPort.js";`; line 7 becomes `type ControlHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 424 | 500 | 503;`; after `"control-limit-over-cap-headroom": 403,` (line 20) insert:

```ts
  // Spec 2026-10-15 ccloop error codes §4.2: ccloop exited non-zero; the message names its code (or `unknown`) and detail.
  "ccloop-failed": 424,
```
In `sendMappedControlError`, replace lines 87-93 (the final `sendControlError(res, 500, …)` call) with:

```ts
  // Spec 2026-10-15 ccloop error codes §4.2: a peer exit is a definite, named failure. A command's ccloop calls run before
  // its transaction or inside a savepoint that is rolled back, and the code stays transient, so nothing was booked
  // (apply-agent-update, which reserves first, rethrows an unknown outcome as a plain error: webService.ts).
  const failure = peerFailure(error);
  if (failure !== null) {
    sendControlError(res, 424, "ccloop-failed", ccloopFailedMessage(failure), { ...context, retryable: true });
    return;
  }
  sendControlError(
    res,
    500,
    "control-internal-error",
    "The control read could not be completed.",
    { ...context, retryable: true },
  );
```

`src/control/webService.ts`: add `import { peerFailure } from "./ccloopPort.js";` after line 1. In `applyAgentUpdate` replace

```ts
      const result = await applyAgentUpdate({ store: this.store, port: this.deps.port }, command, context);
```
with

```ts
      let result: Awaited<ReturnType<typeof applyAgentUpdate>>;
      try { result = await applyAgentUpdate({ store: this.store, port: this.deps.port }, command, context); }
      catch (error) {
        // Plan correction K2 (2026-10-15): ccloop's apply runs after the outbox row is reserved, and a peer exit leaves the
        // operation pending for same-identity reconciliation -- its outcome is unknown, so it is not a 424 refusal.
        if (peerFailure(error) !== null && hasPendingAgentUpdate(this.store, command.actorId)) throw new Error("agent-installation-update-outcome-unknown", { cause: error });
        throw error;
      }
```

`web/src/locales/en.ts` `enErrors`, after the `"agent-selection-rejected"` line:

```ts
  // ccloop error codes spec (2026-10-15) §4.2: ccloop exited non-zero; the detail is `<code>: <detail>` (web/src/ccloopCodes.ts explains a known code).
  "ccloop-failed": "ccloop failed: {{detail}}",
```
`web/src/locales/zh.ts` `zhErrors`, same place:

```ts
  "ccloop-failed": "ccloop 执行失败：{{detail}}",
```

- [ ] **Step 4: Run green**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/panel/ccloopFailedMapping.test.ts tests/panel/agentSelectionApi.test.ts tests/panel/refusalCoverage.test.ts tests/panel/permissions.test.ts tests/panel/controlChannel.test.ts tests/control/agentUpdates.test.ts tests/control/agentUpdateAdmission.test.ts > /private/tmp/oec/logs/a2-green.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-green.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web && ../node_modules/.bin/vitest run tests/ccloopFailed.test.ts tests/refusalText.test.tsx tests/agentPreviewRefresh.test.tsx > /private/tmp/oec/logs/a2-green-web.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-green-web.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && npm run typecheck > /private/tmp/oec/logs/a2-tc.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-tc.log
```
Read all whole: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 5: Commit** — `git add src/panel/controlErrors.ts src/control/webService.ts web/src/locales/en.ts web/src/locales/zh.ts tests/panel/agentSelectionApi.test.ts tests/panel/ccloopFailedMapping.test.ts web/tests/ccloopFailed.test.ts`; diff to `/private/tmp/oec/logs/a2-diff.log`, read; message `feat(panel): answer a ccloop peer exit as 424 ccloop-failed with its code and detail` + trailer (via `-F`).

- [ ] **Step 6 (reviewer, clone `a2`, web build first): mutations**
  - `A2a` drop the branch: file `src/panel/controlErrors.ts`, spec `{"from": "  if (failure !== null) {\n    sendControlError(res, 424, \"ccloop-failed\", ccloopFailedMessage(failure), { ...context, retryable: true });\n    return;\n  }\n", "to": ""}`, test `tests/panel/ccloopFailedMapping.test.ts` (root) — red: "maps a peer exit to 424…" (`500`). Second run `A2a2`, same spec, test `tests/panel/agentSelectionApi.test.ts` — red: the rewritten test and both "answers a confirm…" rows (`500`).
  - `A2b` drop the K2 wrap: file `src/control/webService.ts`, spec `{"from": "        if (peerFailure(error) !== null && hasPendingAgentUpdate(this.store, command.actorId)) throw new Error(\"agent-installation-update-outcome-unknown\", { cause: error });\n", "to": ""}`, test `tests/panel/ccloopFailedMapping.test.ts` — red: "keeps an apply-agent-update…" (`424` received).
  - `A2c` web pin: file `web/src/controlApi.ts`, spec `{"from": "if (res.status >= 500) return { kind: \"uncertain\"", "to": "if (res.status >= 424) return { kind: \"uncertain\""}`, dir `web`, test `tests/ccloopFailed.test.ts` — red (`kind: "uncertain"`).
  - `A2d` catalog coverage: file `web/src/locales/zh.ts`, spec `{"from": "  \"ccloop-failed\": \"ccloop 执行失败：{{detail}}\",\n", "to": ""}`, test `tests/panel/refusalCoverage.test.ts` — red: "has a zh entry for every catalog code…" (`["ccloop-failed"]`) and "keeps the two tables over the same codes".

---

### Task A3: Stored codes keep ccloop's code (spec A §4.3; criteria 3, 4)

**Files:**
- Modify: `src/control/profiles.ts:1` (import), `:25` (`probeFailureCode` type), `:135-137` (`probeFailureCode()`)
- Modify: `src/control/planImport.ts:41` (`EstimatorSlotOutcome` rejected `code`), `:147` (`rejectedEstimatorRequest`)
- Modify: `src/control/agentFreeze.ts:132` (+ import)
- Modify: `src/panel/controlViews.ts:1191` (+ import)
- Modify: `src/control/webService.ts:675`, `:682` (`recoverAgentUpdates`, `observeAgentUpdates`) (+ import `peerCode` beside A2's `peerFailure`)
- Modify: `src/control/savedResultRecovery.ts:104` (+ import)
- Test (create): `tests/control/peerCodeStored.test.ts`; append one test to `tests/control/savedResultUnmeteredLineage.test.ts` (new `it` inside its `describe`, plus `import { ControlError } from "../../src/control/errors.js";`)

**Interfaces:**
- Consumes: Task A1's `peerCode(error: ControlError): string`.
- Produces: `ObservedProfile.probeFailureCode: string | null`; `function probeFailureCode(error: unknown): string`; `EstimatorSlotOutcome` rejected `code: string`; `export function rejectedEstimatorRequest(code: string): FrozenEstimateRequest`. Classification in `resolveGroupSelections` and `rolePreview` stays on `error.code`.

- [ ] **Step 1: Write the failing tests** — create `tests/control/peerCodeStored.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyAgentUpdate } from "../../src/control/agentUpdates.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { estimatorSlotFor } from "../../src/control/planImport.js";
import { WebControlService } from "../../src/control/webService.js";
import { readSelectionPreview } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.3, criteria 3 and 4: where Orca reduces a ccloop failure to a code it keeps
// ccloop's code, so the estimator, the preview and the installation panel say why -- while the choice between "refused"
// and "try again" still reads Orca's own classification of the error, so a transient exit is never frozen as a refusal.
const CATALOG = () => new ControlError("control-peer-exit", "2:omp-model-catalog-unavailable: spawn ENOENT");
const open = { schema: "orca-raw-command-v1", commandId: "open-r", actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId: "r" },
  payload: { groupId: "r", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never;
const apply = { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0, actorId: "human", verb: "apply-agent-update",
  target: { kind: "operator", operatorId: "human" }, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } } as never;
const observation = { schema: "orca-agent-detection-observation-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-15T00:00:00.000Z", installed: [] };

describe("stored codes keep ccloop's code (spec A §4.3)", () => {
  it("F1: the profile probe, every estimator slot built on it and requirement-open name ccloop's code", async () => {
    const h = await webFixture(); try {
      h.resolveAgent.mockImplementation(async () => { throw CATALOG(); });
      expect((await h.deps.profileRouter.probe(h.frozen, { agent: "codex" })).probeFailureCode).toBe("omp-model-catalog-unavailable");
      expect((await estimatorSlotFor({ store: h.store, profileRouter: h.deps.profileRouter }, "human", {}, h.frozen)).outcome)
        .toMatchObject({ kind: "rejected", code: "omp-model-catalog-unavailable" });
      const service = new WebControlService({ ...h.deps, knownRepository: (id: string) => id === "repo" });
      expect(await service.openRequirement(open)).toMatchObject({ error: { code: "agent-selection-rejected", message: "agent-selection-rejected:estimator:omp-model-catalog-unavailable" } });
      h.resolveAgent.mockImplementation(async () => { throw new ControlError("control-peer-exit", "1:Error: lost"); });
      expect((await h.deps.profileRouter.probe(h.frozen, { agent: "codex" })).probeFailureCode).toBe("control-peer-exit");
    } finally { await h.dispose(); }
  });

  it("F2: a transient peer exit in a preview is still unavailable and carries ccloop's code; confirm still rethrows it", async () => {
    const h = await webFixture(); try {
      h.resolveAgent.mockImplementation(async () => { throw CATALOG(); });
      const preview = await resolveGroupSelections({ store: h.store, port: h.deps.port }, "g", "human", "preview");
      expect(preview.slots.map((slot) => [slot.key, slot.outcome])).toEqual([
        ["reconcile", { kind: "unavailable", code: "omp-model-catalog-unavailable" }],
        ["task:a", { kind: "unavailable", code: "omp-model-catalog-unavailable" }],
      ]);
      await expect(resolveGroupSelections({ store: h.store, port: h.deps.port }, "g", "human", "confirm")).rejects.toMatchObject({ code: "control-peer-exit" });
      expect((await readSelectionPreview(h.store, h.deps.port, "human", "g")).rolePreviews).toEqual({
        worker: { kind: "unavailable", code: "omp-model-catalog-unavailable" }, estimator: { kind: "unavailable", code: "omp-model-catalog-unavailable" },
      });
    } finally { await h.dispose(); }
  });

  it("F3: an installation observation and a reconciliation that fail name ccloop's code; a non-ControlError is control-internal-error", async () => {
    const h = await webFixture(); try {
      const base = h.deps.port as unknown as Record<string, unknown>;
      const observing = new WebControlService({ ...h.deps, port: { ...base, observeAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-config-invalid: bad table"); } } as unknown as ExecutionPort });
      await observing.observeAgentUpdates();
      expect(observing.agentUpdateView("human").failureCode).toBe("agent-config-invalid");
      const crashing = new WebControlService({ ...h.deps, port: { ...base, observeAgentInstallations: async () => { throw new Error("socket hang up"); } } as unknown as ExecutionPort });
      await crashing.observeAgentUpdates();
      expect(crashing.agentUpdateView("human").failureCode).toBe("control-internal-error");
      // A pending operation (ccloop died during apply), reconciled at startup against a ccloop that fails again.
      const dying = { applyAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-installation-apply-failed: disk full"); } } as unknown as ExecutionPort;
      await expect(applyAgentUpdate({ store: h.store, port: dying }, apply, { client: "web", principal: "user:owner" })).rejects.toMatchObject({ code: "control-peer-exit" });
      const reconciling = new WebControlService({ ...h.deps, port: { ...base, applyAgentInstallations: dying.applyAgentInstallations, observeAgentInstallations: async () => observation } as unknown as ExecutionPort });
      await reconciling.recoverAgentUpdates();
      expect(reconciling.agentUpdateView("human").failureCode).toBe("agent-installation-apply-failed");
    } finally { await h.dispose(); }
  });
});
```
Append inside the `describe` of `tests/control/savedResultUnmeteredLineage.test.ts` (after its last `it`), reusing its `world()` and `release()`:

```ts
  // ccloop error codes spec (2026-10-15) §4.3, criterion 4: the saved-result `unavailable` reason names ccloop's code.
  it("names ccloop's code when the saved-result eligibility read fails with a peer exit", async () => {
    const { t, service } = await world(); const driver = t.driver(); try {
      const source = await t.claim();
      await t.until(driver, () => t.body(source).state === "blocked");
      expect(await release(t, service, source)).not.toHaveProperty("error");
      const failing = { ...(t.fake.port as object), readFeatures: async () => { throw new ControlError("control-peer-exit", "2:control-features-failed: lost"); } };
      const failingService = new WebControlService({ ...(t.service as any).deps, profileRouter: createExecutionProfileRouter([resolveProfile(profileSnapshot(), failing as never)]) });
      expect(await failingService.savedResultEligibility(source)).toEqual({ status: "unavailable", reason: "control-features-failed" });
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30_000);
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/control/peerCodeStored.test.ts tests/control/savedResultUnmeteredLineage.test.ts > /private/tmp/oec/logs/a3-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a3-red.log
```
Read it whole. Expected red: F1 at the first assertion (`"control-peer-exit"` received), F2 at the slots (`code: "control-peer-exit"`), F3 at the first `failureCode` (`"control-peer-exit"`), the saved-result test (`reason: "control-peer-exit"`). The `confirm` rejection inside F2 and the `"1:Error: lost"` line inside F1 are green today (they pin what must not move).

- [ ] **Step 3: Implement**
  - `profiles.ts`: add `import { peerCode } from "./ccloopPort.js";`; line 25 `readonly probeFailureCode: string | null;`; lines 135-137:
    ```ts
    function probeFailureCode(error: unknown): string {
      // Spec 2026-10-15 ccloop error codes §4.3: a peer exit is stored as ccloop's own code.
      return error instanceof ControlError ? peerCode(error) : "control-capability-probe-failed";
    }
    ```
  - `planImport.ts:41` `| { kind: "rejected"; partial: PartialSelection | null; code: string };` and `:147` `export function rejectedEstimatorRequest(code: string): FrozenEstimateRequest {` (leave `KnownControlErrorCode` in its import even if unused; the build has no unused-import check).
  - `agentFreeze.ts`: add `import { peerCode } from "./ccloopPort.js";`; line 132 `        slots.push({ ...identity, outcome: { kind: "unavailable", code: peerCode(error) } });` (line 131's `if (mode === "confirm") throw error;` and line 129's classification on `error.code` are unchanged).
  - `controlViews.ts`: add `import { peerCode } from "../control/ccloopPort.js";`; line 1191 `        ? { kind: "unavailable" as const, code: peerCode(error) }`.
  - `webService.ts`: extend A2's import to `import { peerCode, peerFailure } from "./ccloopPort.js";`; line 675 `    catch (error) { reconcileFailure = error instanceof ControlError ? peerCode(error) : "control-internal-error"; }`; line 682 `    catch (error) { this.installationObservation = null; this.installationFailure = error instanceof ControlError ? peerCode(error) : "control-internal-error"; }`.
  - `savedResultRecovery.ts`: add `import { peerCode } from "./ccloopPort.js";`; in line 104 replace `error instanceof ControlError?error.code:` with `error instanceof ControlError?peerCode(error):`.

- [ ] **Step 4: Run green** — the two test files plus `tests/control/agentFreeze.test.ts tests/control/planImport.test.ts tests/control/estimatorCompatibility.test.ts tests/control/requirementCommands.test.ts tests/control/agentUpdates.test.ts tests/panel/agentSelectionApi.test.ts tests/panel/controlConfig.test.ts` to `/private/tmp/oec/logs/a3-green.log`; typecheck to `a3-tc.log`. All pass, 0 skipped; `rc=0`. (If `tests/panel/controlConfig.test.ts` does not exist, drop it and say so.)

- [ ] **Step 5: Commit** — `git add src/control/profiles.ts src/control/planImport.ts src/control/agentFreeze.ts src/panel/controlViews.ts src/control/webService.ts src/control/savedResultRecovery.ts tests/control/peerCodeStored.test.ts tests/control/savedResultUnmeteredLineage.test.ts`; message `feat(control): store ccloop's own code where a peer exit is reduced to a code`.

- [ ] **Step 6 (reviewer, clone `a3`): mutations** (test `tests/control/peerCodeStored.test.ts` unless named)
  - `A3a` profile probe stores `error.code`: `src/control/profiles.ts` `{"from": "return error instanceof ControlError ? peerCode(error) : \"control-capability-probe-failed\";", "to": "return error instanceof ControlError ? error.code : \"control-capability-probe-failed\";"}` — red: F1 only.
  - `A3b` preview slot stores `error.code`: `src/control/agentFreeze.ts` `{"from": "outcome: { kind: \"unavailable\", code: peerCode(error) } });", "to": "outcome: { kind: \"unavailable\", code: error.code } });"}` — red: F2 at the slots.
  - `A3c` classify on `peerCode` (criterion 3): `src/control/agentFreeze.ts` `{"from": "(nonDurableControlErrorClassifications as Record<string, string>)[error.code] === \"transient\"", "to": "(nonDurableControlErrorClassifications as Record<string, string>)[peerCode(error)] === \"transient\""}` — red: F2 (slots `rejected`; confirm resolves instead of rejecting).
  - `A3d` role preview stores `error.code`: `src/panel/controlViews.ts` `{"from": "? { kind: \"unavailable\" as const, code: peerCode(error) }", "to": "? { kind: \"unavailable\" as const, code: error.code }"}` — red: F2 at `rolePreviews`.
  - `A3e` observation: `src/control/webService.ts` `{"from": "this.installationFailure = error instanceof ControlError ? peerCode(error) : \"control-internal-error\";", "to": "this.installationFailure = error instanceof ControlError ? error.code : \"control-internal-error\";"}` — red: F3 first assertion.
  - `A3f` non-ControlError back to a false peer exit: same file `{"from": "this.installationFailure = error instanceof ControlError ? peerCode(error) : \"control-internal-error\";", "to": "this.installationFailure = error instanceof ControlError ? peerCode(error) : \"control-peer-exit\";"}` — red: F3 second assertion.
  - `A3g` reconciliation: same file `{"from": "reconcileFailure = error instanceof ControlError ? peerCode(error) : \"control-internal-error\";", "to": "reconcileFailure = error instanceof ControlError ? error.code : \"control-internal-error\";"}` — red: F3 last assertion.
  - `A3h` saved result: `src/control/savedResultRecovery.ts` `{"from": "error instanceof ControlError?peerCode(error):", "to": "error instanceof ControlError?error.code:"}`, test `tests/control/savedResultUnmeteredLineage.test.ts -t "names ccloop's code"` — red.

---

### Task A4: Stored run reasons are cut (spec A §4.4; criterion 5)

**Files:**
- Modify: `src/control/executionDriver.ts:124-127` (`describeError`), `:473` (`accept-refused`), imports (add `peerExitText, peerFailure` from `./ccloopPort.js`)
- Test (create): `tests/control/peerReasonCut.test.ts`

**Interfaces:**
- Consumes: Task A1's `peerFailure`, `peerExitText`.
- Produces: `describeError(peerExit)` = `control-peer-exit:<peerExitText>` (or `control-peer-exit` when empty); `drive.blockedReason` of an accept refusal = `accept-refused:<peerExitText>`.

- [ ] **Step 1: Write the failing test** — create `tests/control/peerReasonCut.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { describeError } from "../../src/control/executionDriver.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.4, criterion 5: a blocked run's reason used to keep ccloop's whole stderr (up to
// 24 MiB) and the panel showed it raw. It is stored as `<exit>:<code>: <detail>` with the detail cut to 512 units.
describe("stored peer-exit reasons are cut (spec A §4.4)", () => {
  it("describeError stores the cut form", () => {
    expect([
      describeError(new ControlError("control-peer-exit", `2:agent-config-invalid: ${"x".repeat(2048)}`)),
      describeError(new ControlError("control-peer-exit", "2:control-config-hash-mismatch")),
      describeError(new ControlError("control-peer-exit")),
      describeError(new ControlError("control-peer-timeout")),
    ]).toEqual([`control-peer-exit:2:agent-config-invalid: ${"x".repeat(511)}…`, "control-peer-exit:2:control-config-hash-mismatch", "control-peer-exit", "control-peer-timeout"]);
  });

  it("an accept refusal with a 2 KiB stderr is stored in its cut form", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      (t.fake.port as unknown as Record<string, unknown>).accept = async () => { throw new ControlError("control-peer-exit", `2:agent-config-invalid: ${"y".repeat(2048)}`); };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B", blockedReason: `accept-refused:2:agent-config-invalid: ${"y".repeat(511)}…` });
    } finally { await t.h.dispose(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red** — `./node_modules/.bin/vitest run tests/control/peerReasonCut.test.ts > /private/tmp/oec/logs/a4-red.log 2>&1`. Expected red: both tests (the whole 2 KiB stderr received).

- [ ] **Step 3: Implement** — `executionDriver.ts`: add `import { peerExitText, peerFailure } from "./ccloopPort.js";` beside the other imports; `describeError` becomes:

```ts
export function describeError(error: unknown): string {
  // Spec 2026-10-15 ccloop error codes §4.4: a peer exit is stored cut -- `control-peer-exit:<exit>:<code>: <detail≤512>`.
  const peer = peerFailure(error);
  if (peer !== null) { const text = peerExitText(peer); return text === "" ? "control-peer-exit" : `control-peer-exit:${text}`; }
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}
```
Line 473: `      blockRun(deps, runId, "B", \`accept-refused:${peerExitText(peerFailure(error)!)}\`);`

- [ ] **Step 4: Run green** — `tests/control/peerReasonCut.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/skillsE2E.test.ts` (the last two are long; `skillsE2E` may need `ORCA_CCLOOP_BIN` — if it skips, say so) to `a4-green.log`; typecheck. `executionDriver.test.ts:134` (`accept-refused:2:control-config-hash-mismatch`) stays green.

- [ ] **Step 5: Commit** — `src/control/executionDriver.ts tests/control/peerReasonCut.test.ts`; message `feat(control): store a peer exit's run reason cut to its code and 512-unit detail`.

- [ ] **Step 6 (reviewer, clone `a4`): mutations** — file `src/control/executionDriver.ts`, test `tests/control/peerReasonCut.test.ts`:
  - `A4a` drop the cut in `describeError`: `{"from": "  if (peer !== null) { const text = peerExitText(peer); return text === \"\" ? \"control-peer-exit\" : `control-peer-exit:${text}`; }\n", "to": ""}` — red: "describeError stores the cut form" (whole stderr).
  - `A4b` store `error.detail` again: `{"from": "`accept-refused:${peerExitText(peerFailure(error)!)}`", "to": "`accept-refused:${error.detail}`"}` — red: "an accept refusal…".

---

### Task A5: Single-call failures carry the record's `errorCode` (spec A §4.5; criterion 6; corrections K3, K4)

**Files:**
- Modify: `src/control/executionDriver.ts:640-648` (after `singleCallRecordSchema`), `:695-706` (`stepCSingleCall`)
- Modify: `src/control/singleCallPurposes.ts:30`, `:34` (interface), `:53-55` (`ESTIMATE.complete`)
- Modify: `src/control/webService.ts:1106-1110` (`completeEstimateInStore` signature), `:1136` (`reasonCode`)
- Modify: `src/control/requirementCalls.ts:13` (comment-free import is unchanged), `:191-207` (`recordClarify`), `:257-259` (`CLARIFY_HANDLER.complete`), `:293-309` (`recordSplit`), `:322-324` (`SPLIT_HANDLER.complete`)
- Modify (fixtures): `tests/control/fixtures/estimateHarness.ts:20-27` (`SingleCallOptions`), `:63`; `tests/control/fixtures/requirementHarness.ts:30` (`QueuedAnswer`), `:67`
- Modify (named rewrites): `tests/control/driverEstimate.test.ts:86`, `:136`; `tests/control/driverRequirementSplit.test.ts:57`
- Test (create): `tests/control/singleCallErrorCode.test.ts`

**Interfaces:**
- Produces: `export function normalizeSingleCallErrorCode(errorCode: string | null): string | null` (`executionDriver.ts`); `export const PRE_SPAWN_REFUSALS: ReadonlySet<string>` (`requirementCalls.ts`); `SingleCallHandler.evaluate?(deps, run, rawOutput, failure?: string | null)`; `SingleCallHandler.complete(deps, run, rawOutput, commitTerminal, failure?: string | null)`; `completeEstimateInStore(deps, id, estimateId, rawOutput, commitTerminal?, classify = classifyEstimateOutput, callFailure: string | null = null)`. Estimate `reasonCode` `estimate-call-failed:<code>`; call record `{ outcome: "failed", reason: <code> }`; blocked reason `<usageUnknownReason>:<code>`.
- Fixture options: `SingleCallOptions.errorCode?: string | null`, `QueuedAnswer.errorCode?: string | null` (absent ⇒ `"single-call-output-invalid"` for a failed call, as today).

- [ ] **Step 1: Fixtures** (default-preserving; listed for the human)
  - `estimateHarness.ts` `SingleCallOptions`: add `  /** ccloop error codes spec §4.5: the failed call's record errorCode (absent: single-call-output-invalid, as before). */\n  errorCode?: string | null;`; line 63 `outcome, outputRef, errorCode: outcome === "failed" ? (options.errorCode === undefined ? "single-call-output-invalid" : options.errorCode) : null,`.
  - `requirementHarness.ts:30` `QueuedAnswer` gains `; errorCode?: string | null` before the closing `}`; line 67 `outcome, outputRef, errorCode: outcome === "failed" ? (answer.errorCode === undefined ? "single-call-output-invalid" : answer.errorCode) : null };`.

- [ ] **Step 2: Write the failing test** — create `tests/control/singleCallErrorCode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSingleCallErrorCode } from "../../src/control/executionDriver.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// ccloop error codes spec (2026-10-15) §4.5, criterion 6: ccloop's single-call record names why a call failed. Orca now
// stores that code where it stores the failure, never ccloop's free text; and a call ccloop refused before spawning (its
// catalog cap or model changed) is not retried automatically, because the same envelope would be refused again.
const preSpawn = (purpose: "clarify" | "split", errorCode: string) => ({ purpose, output: null, outcome: "failed" as const, tokens: 0, errorCode });

describe("the record's errorCode, normalised (spec A §4.5)", () => {
  it("keeps a code, cuts at the first colon, and makes anything else unknown (plan correction K4)", () => {
    expect([null, "omp-single-call-cap-exceeded", "omp-single-call-stop:length", "x:y\n<script>", "<b>x</b>:y\n", "X-Y", "a".repeat(65), ""].map(normalizeSingleCallErrorCode))
      .toEqual([null, "omp-single-call-cap-exceeded", "omp-single-call-stop", "x", "unknown", "unknown", "unknown", "unknown"]);
  });
});

describe("where a failed call is stored (spec A §4.5)", () => {
  it("estimate: a failed call's reason carries ccloop's code; a hostile one is stored as unknown", async () => {
    for (const [errorCode, reasonCode] of [["omp-single-call-cap-exceeded", "estimate-call-failed:omp-single-call-cap-exceeded"], ["<b>x</b>:y\n", "estimate-call-failed:unknown"]]) {
      const x = await estimateHarness({ outcome: "failed", tokens: 0, errorCode }); try {
        await x.rounds(() => x.estimate().state !== "running");
        expect(x.estimate()).toMatchObject({ state: "failed", reasonCode });
      } finally { await x.h.dispose(); }
    }
  });

  it("usage unknown: the block reason appends ccloop's code", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null, errorCode: "omp-single-call-unavailable" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown:omp-single-call-unavailable" });
    } finally { await x.h.dispose(); }
  });

  it("clarify: a pre-spawn refusal fails the round at once, its one call recorded failed with the code, lastInvalidReason still no-output", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => preSpawn("clarify", "omp-single-call-cap-exceeded")) });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(x.round(1)).toMatchObject({ state: "failed", retries: 0, reasonCode: "clarify-output-invalid", lastInvalidReason: "no-output" });
      expect(x.round(1).calls.map((call) => [call.outcome, call.reason])).toEqual([["failed", "omp-single-call-cap-exceeded"]]);
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });

  it("clarify: any other failed call keeps its automatic retry, recorded failed with its code, and the next prompt says no-output", async () => {
    const x = await requirementHarness({ answers: [preSpawn("clarify", "<b>x</b>:y\n"), { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).calls.map((call) => [call.outcome, call.reason])).toEqual([["failed", "unknown"], ["valid", null]]);
      expect(x.round(1).retries).toBe(1);
      const second = x.fake.calls.accept[1]!;
      expect(second.work.kind === "single-call" && second.work.prompt).toContain("no-output");
    } finally { await x.dispose(); }
  });

  it("split: a pre-spawn refusal fails the draft at once, its call recorded failed with the code", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => preSpawn("split", "omp-single-call-unavailable")), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "failed");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "failed", autoRetry: 0, reasonCode: "split-output-invalid", calls: [{ outcome: "failed", reason: "omp-single-call-unavailable" }] });
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });
});
```

Named rewrites (each keeps its title; add the comment line shown above the changed assertion):
- `tests/control/driverEstimate.test.ts:86`: old `      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });` → new
  ```ts
      // Rewritten for the ccloop error codes spec (2026-10-15; its §5 names this criterion): this now encodes that the
      // named block also carries ccloop's code for the failed call (the harness's failed calls name single-call-output-invalid).
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown:single-call-output-invalid" });
  ```
- `tests/control/driverEstimate.test.ts:136`: old `    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed"],` → new
  ```ts
    // Rewritten for the ccloop error codes spec (2026-10-15; §5): a failed call's reason now carries ccloop's code.
    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed:single-call-output-invalid"],
  ```
- `tests/control/driverRequirementSplit.test.ts:57`: old `      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", output: null, calls: [{ outcome: "invalid" }] });` → new
  ```ts
      // Rewritten for the ccloop error codes spec (2026-10-15; §5): this now encodes that the failed call is recorded as
      // failed with ccloop's code, and still uses one of the two automatic retries.
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", output: null, calls: [{ outcome: "failed", reason: "single-call-output-invalid" }] });
  ```

- [ ] **Step 3: Run red** — `tests/control/singleCallErrorCode.test.ts tests/control/driverEstimate.test.ts tests/control/driverRequirementSplit.test.ts` to `a5-red.log`. Expected red: the normaliser test (`not a function`), every "where a failed call is stored" test, and the three rewritten assertions. `driverEstimate.test.ts:27` stays green (K3).

- [ ] **Step 4: Implement**
  - `executionDriver.ts`, after the `singleCallRecordSchema` declaration (`}).strict();` at line 648):
    ```ts
    /**
     * Spec 2026-10-15 ccloop error codes §4.5: the record's errorCode as Orca stores it -- the part before the first `:`
     * (ccloop prints `omp-single-call-stop:<reason>`) when it is a code, else `unknown`; null stays null.
     */
    export function normalizeSingleCallErrorCode(errorCode: string | null): string | null {
      if (errorCode === null) return null;
      const head = errorCode.split(":", 1)[0]!;
      return /^[a-z][a-z0-9-]{0,63}$/.test(head) ? head : "unknown";
    }
    ```
    In `stepCSingleCall` replace line 695 with
    ```ts
      // §4.5: "the call failed" means outcome !== complete; the handler is told ccloop's (normalised) code, rawOutput is unchanged.
      const failure = record.outcome === "complete" ? null : normalizeSingleCallErrorCode(record.errorCode);
      const settled = handler.evaluate === undefined ? rawOutput : await handler.evaluate(deps, run, rawOutput, failure);
    ```
    append `, failure` as the last argument of the `handler.complete(…)` call (its closing `});` at line 703 becomes `}, failure);`), and line 706's block reason becomes `failure === null ? handler.usageUnknownReason : \`${handler.usageUnknownReason}:${failure}\``.
  - `singleCallPurposes.ts`: line 30 `  evaluate?(deps: SingleCallPrepareDeps, run: SingleCallRunRow, rawOutput: unknown, failure?: string | null): Promise<unknown>;`; line 34 `  complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure?: string | null): void;`; lines 53-55:
    ```ts
      complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure: string | null = null): void {
        completeEstimateInStore(deps, run.groupId, String(run.estimateId), rawOutput, commitTerminal, ESTIMATE.classify, failure);
      },
    ```
  - `webService.ts` `completeEstimateInStore`: after the `classify` parameter (line 1109) add `  // Spec 2026-10-15 ccloop error codes §4.5: ccloop's code for a failed call (driver-normalised); the service method passes none.\n  callFailure: string | null = null,`; line 1136 becomes
    ```ts
          let reasonCode: string | null = classified.ok ? null
            : classified.reasonCode === "estimate-call-failed" && callFailure !== null ? `estimate-call-failed:${callFailure}` : classified.reasonCode;
    ```
  - `requirementCalls.ts`: after the imports add
    ```ts
    /** Spec 2026-10-15 ccloop error codes §4.5: ccloop refused before spawning (books 0); the same envelope would be refused again. */
    export const PRE_SPAWN_REFUSALS: ReadonlySet<string> = new Set(["omp-single-call-cap-exceeded", "omp-single-call-unavailable"]);
    ```
    `recordClarify` gains a last parameter `failure: string | null`; line 196 becomes
    ```ts
      round.calls = [...round.calls, failure !== null ? callOf(run, "failed", failure) : callOf(run, classified.ok ? "valid" : "invalid", classified.ok ? null : classified.reason)];
    ```
    and line 200 `  } else if (round.retries < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))) {` (line 201's `lastInvalidReason: classified.reason` is unchanged — `no-output`). `CLARIFY_HANDLER.complete(deps, run, rawOutput, commitTerminal, failure = null) { settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordClarify(store, group, target, settled, rawOutput, failure)); },`.
    `recordSplit` gains `failure: string | null`; line 296 becomes
    ```ts
      draft.calls = [...draft.calls, failure !== null ? callOf(run, "failed", failure) : callOf(run, ev.ok ? "valid" : "invalid", ev.ok ? null : ev.reasons.join("; "))];
    ```
    and line 299 `  else if (draft.autoRetry < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))) {` (the failed branch's `reasonCode` already answers `split-output-invalid` for a schema-invalid evaluation). `SPLIT_HANDLER.complete(deps, run, evaluation, commitTerminal, failure = null) { settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordSplit(store, group, target, settled, evaluation as SplitEvaluation, failure)); },`.

- [ ] **Step 5: Run green** — `tests/control/singleCallErrorCode.test.ts tests/control/driverEstimate.test.ts tests/control/driverRequirementSplit.test.ts tests/control/driverRequirementClarify.test.ts tests/control/estimateOutcome.test.ts tests/control/requirementCommands.test.ts tests/control/singleCallOutputCap.test.ts` to `a5-green.log`; typecheck. All pass, 0 skipped.

- [ ] **Step 6: Commit** — the five src files, the two fixtures, the three test files and the new test; message `feat(control): carry a single call's errorCode into its estimate, call record and block reason`.

- [ ] **Step 7 (reviewer, clone `a5`): mutations** (test `tests/control/singleCallErrorCode.test.ts` unless named)
  - `A5a` normaliser: `src/control/executionDriver.ts` `{"from": "  return /^[a-z][a-z0-9-]{0,63}$/.test(head) ? head : \"unknown\";\n", "to": "  return errorCode;\n"}` — red: the normaliser test and the estimate test's hostile row.
  - `A5b` estimate suffix: `src/control/webService.ts` `{"from": "classified.reasonCode === \"estimate-call-failed\" && callFailure !== null ? `estimate-call-failed:${callFailure}` : classified.reasonCode", "to": "classified.reasonCode"}` — red: "estimate: …"; second run `A5b2` with test `tests/control/driverEstimate.test.ts` — red: the rewritten `:136` row only.
  - `A5c` usage-unknown suffix: `src/control/executionDriver.ts` `{"from": "failure === null ? handler.usageUnknownReason : `${handler.usageUnknownReason}:${failure}`", "to": "handler.usageUnknownReason"}` — red: "usage unknown…"; `A5c2` on `tests/control/driverEstimate.test.ts` — red: the rewritten `:86` test only.
  - `A5d` clarify record: `src/control/requirementCalls.ts` `{"from": "failure !== null ? callOf(run, \"failed\", failure) : callOf(run, classified.ok", "to": "callOf(run, classified.ok"}` — red: both clarify tests at the `calls` assertion.
  - `A5e` clarify re-queue: same file `{"from": "round.retries < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))", "to": "round.retries < MAX_AUTO_RETRIES"}` — red: "clarify: a pre-spawn refusal…" (`retries` 2, three calls).
  - `A5f` split record: same file `{"from": "failure !== null ? callOf(run, \"failed\", failure) : callOf(run, ev.ok", "to": "callOf(run, ev.ok"}` — red: "split: …"; `A5f2` on `tests/control/driverRequirementSplit.test.ts` — red: the rewritten `:57` test.
  - `A5g` split re-queue: same file `{"from": "draft.autoRetry < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))", "to": "draft.autoRetry < MAX_AUTO_RETRIES"}` — red: "split: …" (`state: "invalid"`, draft 2 exists).

---

### Task A6: A human retry recomputes the bound (spec A §4.8; criterion 7; correction K5)

**Files:**
- Modify: `src/control/stopIntent.ts:440` (`applyRecoveryRetry` signature), `:455` (`retryGroup` call), `:497-504` (`retryGroup`), `:513-547` (`retryRequirementInTransaction`)
- Modify: `src/control/webService.ts:579-581` (`recoveryRetry`), new private method, imports
- Modify (fixture): `tests/control/fixtures/requirementHarness.ts` (`queuedPort`: `setResolveAgent`, `baseResolveAgent`)
- Test (create): `tests/control/requirementRetryBound.test.ts`

**Interfaces:**
- Consumes: `singleCallOutputBound(preflightMaxOutputTokens, resolution)` (`src/control/estimator.ts:61-63`); A3's `probeFailureCode` (ccloop's code); `describeError` (A4).
- Produces: `export function applyRecoveryRetry(deps: StopDeps, command: RecoveryRetryCommand, outputBound: number | null = null): StopCommandResult`; `retryRequirementInTransaction(store, groupId, revision, outputBound: number | null)` stores `group.requirement.maxOutputTokens = outputBound` only when it re-queues; one stderr line `orca-control: recovery-retry <groupId>: output bound kept at <n>: <reason>\n` when the bound cannot be recomputed. Fixture: `queuedPort(...)` returns `{ port, calls, setResolveAgent(fn: ((partial: PartialSelection) => Promise<AgentResolution>) | null): void, baseResolveAgent }`.

- [ ] **Step 1: Fixture** — in `requirementHarness.ts` `queuedPort`: after `const resolveAgent = fixtureResolveAgent(…);` add `let resolveOverride: ((partial: PartialSelection) => Promise<AgentResolution>) | null = null;`; the port's `resolveAgent: async (partial) => resolveAgent(partial),` becomes `resolveAgent: async (partial) => (resolveOverride ?? resolveAgent)(partial),` (a closure, so the router's `bind` at creation still sees later overrides); the `return { port, calls };` becomes `return { port, calls, baseResolveAgent: resolveAgent, setResolveAgent: (fn: ((partial: PartialSelection) => Promise<AgentResolution>) | null) => { resolveOverride = fn; } };`. Add `import type { AgentResolution, PartialSelection } from "../../../src/control/agentSelection.js";`.

- [ ] **Step 2: Write the failing test** — create `tests/control/requirementRetryBound.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// ccloop error codes spec (2026-10-15) §4.8, criterion 7: a call refused for its frozen output bound is not retried
// automatically (§4.5); a person's group retry recomputes that requirement's bound from the current catalog -- for the
// selection its calls run (plan correction K5) -- and if the agent cannot be asked, the retry behaves exactly as before.
const CAP_REFUSED = { purpose: "clarify" as const, output: null, outcome: "failed" as const, tokens: 0, errorCode: "omp-single-call-cap-exceeded" };

describe("a human group retry recomputes the output bound (spec A §4.8)", () => {
  it("stores the bound recomputed from the frozen selection's current cap, and the next call is sent with it", async () => {
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "failed");
      const asked: unknown[] = [];
      x.fake.setResolveAgent(async (partial) => { asked.push(partial); return { ...(await x.fake.baseResolveAgent(partial)), singleCallOutputCap: 100_000 }; });
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(readRequirementGroup(x.store, "r").requirement.maxOutputTokens).toBe(100_000);
      expect(asked).toEqual([{ agent: "codex", model: "fixture-model", contextWindow: "agent-default" }]);
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept.map((sent) => (sent.work.kind === "single-call" ? sent.work.maxOutputTokens : null))).toEqual([64_000, 100_000]);
    } finally { await x.dispose(); }
  });

  it("with a failing probe the retry re-queues under the frozen bound and one log line names why", async () => {
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      await x.until(() => x.round(1).state === "failed");
      x.fake.setResolveAgent(async () => { throw new ControlError("control-peer-exit", "2:omp-model-catalog-unavailable: spawn ENOENT"); });
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect([readRequirementGroup(x.store, "r").requirement.maxOutputTokens, x.round(1).state]).toEqual([64_000, "drafting"]);
      expect(lines.filter((line) => line.startsWith("orca-control: recovery-retry r:"))).toEqual(["orca-control: recovery-retry r: output bound kept at 64000: omp-model-catalog-unavailable\n"]);
    } finally { spy.mockRestore(); await x.dispose(); }
  });
});
```

- [ ] **Step 3: Run red** — to `a6-red.log`. Expected red: test 1 at `maxOutputTokens` (`64000`); test 2 at the log line (`[]` received); its first two assertions are green today (they pin "exactly as before").

- [ ] **Step 4: Implement**
  - `stopIntent.ts`: `export function applyRecoveryRetry(deps: StopDeps, command: RecoveryRetryCommand, outputBound: number | null = null): StopCommandResult {`; line 455 `          : retryGroup(store, groupId, context, outputBound);`; `function retryGroup(store: ControlStore, groupId: string, context: WebCommandContext, outputBound: number | null): ObservedRecovery {` and its call `? retryRequirementInTransaction(store, groupId, context.nextCommandRevision, outputBound)`; `function retryRequirementInTransaction(store: ControlStore, groupId: string, revision: number, outputBound: number | null)`; its line `    if (requeue) { wakeIds.push(queueRequirementCall(store, groupId, \`recovery-${revision}\`)); resolved = true; }` becomes
    ```ts
        // Spec 2026-10-15 ccloop error codes §4.8: a human retry sends the call with the bound recomputed before this
        // transaction (webService.ts recoveryRetry); null keeps the frozen one. Automatic retries never pass one.
        if (requeue && outputBound !== null) group.requirement.maxOutputTokens = outputBound;
        if (requeue) { wakeIds.push(queueRequirementCall(store, groupId, `recovery-${revision}`)); resolved = true; }
    ```
  - `webService.ts`: imports — add `singleCallOutputBound` to the `./estimator.js` import (line 13); add `hasRequirementBlock, latestDraft, latestRound, readRequirementGroup` to the `./requirementRecords.js` import (line 54); add `describeError` to the `./executionDriver.js` import (line 1). Replace `recoveryRetry` (lines 579-581) with:
    ```ts
      async recoveryRetry(command: RecoveryRetryCommand): Promise<WebCommandResult> {
        const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
        const outputBound = command.target.kind === "group" ? await this.retryOutputBound(command.target.groupId) : null;
        return applyRecoveryRetry(this.stopDeps(), command, outputBound) as WebCommandResult;
      }
      /**
       * Spec 2026-10-15 ccloop error codes §4.8: for a clarifying requirement whose latest round or draft failed or was
       * interrupted, the output bound its calls would be sent with now -- asked of the frozen selection (plan correction K5)
       * through the requirement's own profile. Null, with one log line, when it cannot be asked: the retry is as before.
       */
      private async retryOutputBound(groupId: string): Promise<number | null> {
        const row = this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
        if (row === undefined || !hasRequirementBlock(JSON.parse(String(row.body)) as { requirement?: unknown })) return null;
        const group = readRequirementGroup(this.store, groupId);
        if (group.status !== "clarifying") return null;
        const step = group.requirement.consensus === null ? latestRound(this.store, groupId) : latestDraft(this.store, groupId);
        if (step === null || (step.state !== "failed" && step.state !== "interrupted")) return null;
        const kept = (reason: string): null => { process.stderr.write(`orca-control: recovery-retry ${groupId}: output bound kept at ${group.requirement.maxOutputTokens}: ${reason}\n`); return null; };
        let profile: ReturnType<ExecutionProfileRouter["resolve"]>;
        try { profile = this.deps.profileRouter.resolve("budget-estimate", group.requirement.profile.profileId, group.requirement.profile.profileHash); }
        catch (error) { return kept(describeError(error)); }
        const preflight = profile.snapshot.profile.estimatorPreflight;
        if (preflight === null) return kept("estimator-preflight-missing");
        const observation = await this.deps.profileRouter.probe(profile, group.requirement.agentSlot.selection);
        if (observation.resolution === null) return kept(observation.probeFailureCode ?? "probe-failed");
        return singleCallOutputBound(preflight.maxOutputTokens, observation.resolution);
      }
    ```
    (`ExecutionProfileRouter` is the type of `this.deps.profileRouter`; import it as a type from `./profiles.js` if it is not already in scope — check with `grep -n "ExecutionProfileRouter" src/control/webService.ts` and redirect.)

- [ ] **Step 5: Run green** — `tests/control/requirementRetryBound.test.ts tests/control/requirementRecovery.test.ts tests/control/stopIntent.test.ts tests/control/driverRequirementClarify.test.ts tests/control/driverRequirementSplit.test.ts tests/control/requirementGuards.test.ts` (drop any that does not exist and say so) to `a6-green.log`; typecheck.

- [ ] **Step 6: Commit** — `src/control/stopIntent.ts src/control/webService.ts tests/control/fixtures/requirementHarness.ts tests/control/requirementRetryBound.test.ts`; message `feat(control): recompute a requirement's output bound on a human group retry`.

- [ ] **Step 7 (reviewer, clone `a6`): mutations** — test `tests/control/requirementRetryBound.test.ts`:
  - `A6a` skip the store: `src/control/stopIntent.ts` `{"from": "    if (requeue && outputBound !== null) group.requirement.maxOutputTokens = outputBound;\n", "to": ""}` — red: test 1 (`64000`).
  - `A6b` probe failure refuses: `src/control/webService.ts` `{"from": "if (observation.resolution === null) return kept(observation.probeFailureCode ?? \"probe-failed\");", "to": "if (observation.resolution === null) throw new ControlError(\"recovery-blocked\", \"retry-bound\");"}` — red: test 2 (the retry rejects).
  - `A6c` probe today's preferences instead of the frozen selection: same file `{"from": "this.deps.profileRouter.probe(profile, group.requirement.agentSlot.selection)", "to": "this.deps.profileRouter.probe(profile, group.requirement.agentSlot.partial)"}` — red: test 1 at `asked` (the partial `{ agent: "codex" }` received).

---

### Task A7: The web explains ccloop codes everywhere they are shown (spec A §4.6, §4.7; criterion 8)

**Files:**
- Create: `web/src/ccloopCodes.ts`
- Modify: `web/src/refusalExplain.ts:7` (import), `:31-43` (`explainRefusal`, `explainRunReason`)
- Modify: `web/src/AgentSelectionEditor.tsx:15` (import), `:73` (`FailedCell` text)
- Modify: `web/src/AgentSettings.tsx:10` (import), `:118`
- Modify: `web/src/ControlGroupView.tsx:22` area (import), `:488`
- Modify: `web/src/TaskDetail.tsx:20` (import), `:307`
- Modify: `web/src/RequirementsPanel.tsx:12` area (import), `:260`, `:299-302`
- Modify: `web/src/locales/en.ts` (`en` before `enums:` at `:1034`; `enErrors`; new `enCcloopErrors` after `enErrors`), `web/src/locales/zh.ts` (same three places)
- Modify: `tests/panel/refusalCoverage.test.ts:3-4` (imports), `:44-55` (`VIEW_REASONS` + `"control-peer-exit"`), new `CCLOOP_CODES` test
- Test (create): `web/tests/ccloopCodes.test.tsx`; append tests to `web/tests/agentSelectionEditor.test.tsx` and `web/tests/agentSettings.test.tsx`

**Interfaces:**
- Consumes: A2's `ccloop-failed` message form; A3's stored codes; A4's run-reason form; A5's `estimate-call-failed:<code>`, `<usageUnknownReason>:<code>`, call `reason`.
- Produces (`web/src/ccloopCodes.ts`): `export function explainCcloopCode(code: string, detail: string): string`; `export function codeAndDetail(text: string): { code: string; detail: string }`; `export function peerExitReason(rest: string): { code: string; detail: string }`; `export function explainEstimateReason(reasonCode: string): string | null`. Locale: `export const enCcloopErrors: Record<string, string>`, `export const zhCcloopErrors: Record<string, string>`; error entries `control-peer-exit`; translation keys `ccloop.generic`, `ccloop.genericNoDetail`.

Texts (the criteria below repeat them as literals):

| key | en | zh |
|---|---|---|
| `enErrors/zhErrors["control-peer-exit"]` | `ccloop exited with an error: {{detail}}` | `ccloop 出错退出：{{detail}}` |
| `ccloop.generic` | `{{code}}: {{detail}}` | `{{code}}：{{detail}}` |
| `ccloop.genericNoDetail` | `{{code}}` | `{{code}}` |
| `omp-model-catalog-unavailable` | `omp could not list its model catalog ({{detail}}). Check that omp is installed and starts, then retry.` | `omp 无法列出它的模型目录（{{detail}}）。请确认 omp 已安装且能启动，然后重试。` |
| `omp-model-catalog-invalid` | `omp's model catalog could not be read ({{detail}}).` | `omp 的模型目录无法读取（{{detail}}）。` |
| `omp-single-call-cap-exceeded` | `omp's catalog now caps this model's output above the bound this requirement was opened with, so the call was refused before it started. Retry: a retry recomputes the bound from the current catalog.` | `omp 目录里这个模型的输出上限已高于这个需求开启时定下的上限，调用在开始前被拒绝。请重试：重试会按当前目录重新计算上限。` |
| `omp-single-call-unavailable` | `omp cannot make this single call with the selected model ({{detail}}).` | `omp 无法用所选模型完成这次单次调用（{{detail}}）。` |
| `agent-config-invalid` | `The agent's configuration is not valid ({{detail}}).` | `这个 agent 的配置无效（{{detail}}）。` |
| `single-call-unsupported` | `This agent cannot make single calls (estimate, clarify, split); choose another agent.` | `这个 agent 不能做单次调用（估算、澄清、拆分），请换一个 agent。` |
| `single-call-output-invalid` | `The model's answer was not the JSON this call asked for.` | `模型的回答不是这次调用要求的 JSON。` |

`fillEntry` drops ` ({{detail}})` / `（{{detail}}）` with an empty detail (`web/src/i18n.ts:111-121`).

- [ ] **Step 1: Write the failing tests**

(a) Create `web/tests/ccloopCodes.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * ccloop error codes spec (2026-10-15) §4.6, criterion 8: wherever the panel shows a ccloop code it explains it in the
 * reader's language -- ccloop's table first, then Orca's own table, else a generic sentence that still names the code and
 * the detail (an unknown code is never dropped). The texts are written out here, not read from the tables, so a dropped
 * entry and a zh entry left in English both turn this red.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { codeAndDetail, explainCcloopCode, explainEstimateReason, peerExitReason } from "../src/ccloopCodes.js";
import { explainRefusal, explainRunReason } from "../src/refusalExplain.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import { RunReason } from "../src/RunReason.js";
import { SavedResultAction } from "../src/TaskDetail.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { run } from "./fixtures/board.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

const EN_CATALOG = "omp could not list its model catalog (spawn ENOENT). Check that omp is installed and starts, then retry.";
const ZH_CATALOG = "omp 无法列出它的模型目录（spawn ENOENT）。请确认 omp 已安装且能启动，然后重试。";
const EN_CAP = "omp's catalog now caps this model's output above the bound this requirement was opened with, so the call was refused before it started. Retry: a retry recomputes the bound from the current catalog.";
const ZH_CAP = "omp 目录里这个模型的输出上限已高于这个需求开启时定下的上限，调用在开始前被拒绝。请重试：重试会按当前目录重新计算上限。";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

describe("explaining a ccloop code", () => {
  it("reads ccloop's table, then Orca's, else the generic sentence, in English", () => {
    expect([explainCcloopCode("omp-model-catalog-unavailable", "spawn ENOENT"), explainCcloopCode("omp-model-catalog-unavailable", ""),
      explainCcloopCode("agent-unselected", ""), explainCcloopCode("omp-new-thing", "x"), explainCcloopCode("omp-new-thing", "")]).toEqual([
      EN_CATALOG, "omp could not list its model catalog. Check that omp is installed and starts, then retry.",
      "A slot has no agent selected. Choose an agent for every slot, then confirm.", "ccloop failed with omp-new-thing: x", "ccloop failed with omp-new-thing."]);
  });

  it("in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect([explainCcloopCode("omp-model-catalog-unavailable", "spawn ENOENT"), explainCcloopCode("omp-new-thing", "x"), explainCcloopCode("omp-new-thing", "")])
      .toEqual([ZH_CATALOG, "ccloop 失败（omp-new-thing）：x", "ccloop 失败（omp-new-thing）。"]);
  });

  it("takes the server's forms apart as the server wrote them", () => {
    expect([codeAndDetail("omp-model-catalog-unavailable: spawn ENOENT"), codeAndDetail("agent-version-drift"), codeAndDetail("file:///x"), codeAndDetail("Error: x"), codeAndDetail("")])
      .toEqual([{ code: "omp-model-catalog-unavailable", detail: "spawn ENOENT" }, { code: "agent-version-drift", detail: "" }, { code: "unknown", detail: "file:///x" },
        { code: "unknown", detail: "Error: x" }, { code: "unknown", detail: "" }]);
    expect([peerExitReason("2:agent-config-invalid: bad"), peerExitReason("1"), peerExitReason("1:Error: x")])
      .toEqual([{ code: "agent-config-invalid", detail: "bad" }, { code: "unknown", detail: "" }, { code: "unknown", detail: "Error: x" }]);
  });
});

describe("each surface (spec A §4.6 table)", () => {
  it("a refusal: ccloop-failed is explained by ccloop's code, in both languages", async () => {
    const refusal = { status: 424, code: "ccloop-failed", message: "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", commandRevision: 3 };
    expect(explainRefusal(refusal)).toEqual({ text: EN_CATALOG, items: [] });
    expect(explainRefusal({ ...refusal, message: "ccloop-failed:omp-new-thing: x" }).text).toBe("ccloop failed with omp-new-thing: x");
    await i18n.changeLanguage("zh");
    expect(explainRefusal(refusal).text).toBe(ZH_CATALOG);
  });

  it("a run reason: peer exits and accept refusals (old uncut ones too) and usage-unknown with a code", async () => {
    expect([
      explainRunReason("control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT"),
      explainRunReason("control-peer-exit:2:omp-new-thing: x"),
      explainRunReason("accept-refused:2:agent-config-invalid"),
      explainRunReason("estimate-usage-unknown:single-call-output-invalid"),
      explainRunReason("estimate-usage-unknown"),
    ]).toEqual([
      `ccloop exited with an error: ${EN_CATALOG}`,
      "ccloop exited with an error: ccloop failed with omp-new-thing: x",
      "ccloop refused to accept this run: The agent's configuration is not valid.",
      "This estimate call's usage is unknown, so its budget cannot be settled. The model's answer was not the JSON this call asked for.",
      "This estimate call's usage is unknown, so its budget cannot be settled.",
    ]);
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-x", state: "blocked", blockedReason: "control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT" })} />);
    expect(html).toContain(`ccloop exited with an error: ${EN_CATALOG} <code>control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT</code>`);
    await i18n.changeLanguage("zh");
    expect(explainRunReason("control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT")).toBe(`ccloop 出错退出：${ZH_CATALOG}`);
  });

  it("an estimate's reason code", async () => {
    expect([explainEstimateReason("agent-selection-rejected:estimator:omp-model-catalog-unavailable"), explainEstimateReason("estimate-call-failed:omp-single-call-cap-exceeded"),
      explainEstimateReason("estimate-call-failed:omp-new-thing"), explainEstimateReason("estimate-output-invalid")])
      .toEqual(["omp could not list its model catalog. Check that omp is installed and starts, then retry.", EN_CAP, "ccloop failed with omp-new-thing.", null]);
    await i18n.changeLanguage("zh");
    expect(explainEstimateReason("estimate-call-failed:omp-single-call-cap-exceeded")).toBe(ZH_CAP);
  });

  it("a saved-result reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "unavailable", reason: "omp-new-thing" }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={1} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-new-thing")).parentElement!.textContent).toContain("ccloop failed with omp-new-thing.");
    cleanup();
    await i18n.changeLanguage("zh");
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={2} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-new-thing")).parentElement!.textContent).toContain("ccloop 失败（omp-new-thing）。");
  });

  it("a failed requirement: the latest failed call's code, and a blocked call's reason", async () => {
    const view = requirementView("failed");
    const failed: RequirementViewV1 = { ...view, rounds: [{ ...view.rounds[0]!, calls: [{ runId: "run-1", overviewHash: null, commit: null, usage: null, outcome: "failed", reason: "omp-single-call-cap-exceeded" }] }],
      summary: { ...view.summary, requirement: { ...view.summary.requirement!, blockedRun: { runId: "run-2", reason: "requirement-usage-unknown:omp-new-thing" } } } };
    const shown = (language: "en" | "zh") => render(<RequirementsPanel config={config} summary={summaryWith(failed)} views={{ r: failed }} selected="r" agents={null} language={language} onSelect={() => {}} onCommand={vi.fn()} />).container.textContent ?? "";
    const en = shown("en");
    expect(en).toContain(`omp-single-call-cap-exceeded · ${EN_CAP}`);
    expect(en).toContain("requirement-usage-unknown:omp-new-thing · This requirement call's usage is unknown, so its budget cannot be settled. ccloop failed with omp-new-thing.");
    cleanup();
    await i18n.changeLanguage("zh");
    expect(shown("zh")).toContain(`omp-single-call-cap-exceeded · ${ZH_CAP}`);
  });
});
```
(`"A slot has no agent selected. Choose an agent for every slot, then confirm."` is `enErrors["agent-unselected"]` measured at `web/src/locales/en.ts:1061`; re-read it with `grep -n '"agent-unselected"' web/src/locales/en.ts` redirected, and write the literal you read — the row pins "Orca's table after ccloop's".)

(b) Append to `web/tests/agentSelectionEditor.test.tsx` (inside its `describe`, reusing `renderView`, `row`, `resolvedPreview`, `view`):

```tsx
  // ccloop error codes spec (2026-10-15) §4.6: a slot's ccloop code is explained beside it, and an estimate's reason too.
  it("explains a slot's ccloop code and an estimate's ccloop reason in words beside the code", () => {
    const base = resolvedPreview();
    const preview = { ...base, slots: [base.slots[0]!, base.slots[1]!, { key: "task:b", slot: "worker" as const, taskId: "b", outcome: { kind: "unavailable" as const, code: "omp-model-catalog-unavailable" } }], selectionsHash: null };
    const estimate: GroupViewV1["estimates"][number] = { estimateId: "estimate-1", estimateVersion: 1, state: "failed", profile: { profileId: "all", profileHash: "b".repeat(64) },
      mode: "soft", requestHash: null, outputHash: null, output: null, reasonCode: "estimate-call-failed:omp-new-thing" };
    const { container } = renderView({ preview, view: view({ estimates: [estimate] }) });
    expect(row(container, "task:b").querySelector('[role="alert"]')!.textContent).toContain("omp-model-catalog-unavailable · omp could not list its model catalog. Check that omp is installed and starts, then retry.");
    expect(container.textContent).toContain("estimate-call-failed:omp-new-thing · ccloop failed with omp-new-thing.");
  });
```

(c) Append to `web/tests/agentSettings.test.tsx` (inside its `describe`, reusing `agents`, `preferences`):

```tsx
  // ccloop error codes spec (2026-10-15) §4.6: the installation panel explains ccloop's code beside it.
  it("explains a failed detection's ccloop code", () => {
    const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, failureCode: "agent-config-invalid", observation: null, preview: null };
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
    expect(container.textContent).toContain("Detection unavailable · agent-config-invalid The agent's configuration is not valid.");
  });
```

(d) `tests/panel/refusalCoverage.test.ts`: change the imports to `import { enCcloopErrors, enErrors } from "../../web/src/locales/en.js";` and `import { zhCcloopErrors, zhErrors } from "../../web/src/locales/zh.js";`; in `VIEW_REASONS` after `"single-call-record-invalid", "single-call-prompt-mismatch", "settle-incomplete",` add a line `  // ccloop error codes spec (2026-10-15) §4.4, §4.7: a peer exit's stored run reason.\n  "control-peer-exit",`; append inside the `describe`:

```ts
  // ccloop error codes spec (2026-10-15) §4.7: the ccloop codes an operator can act on, held to both languages as VIEW_REASONS is.
  const CCLOOP_CODES = ["omp-model-catalog-unavailable", "omp-model-catalog-invalid", "omp-single-call-cap-exceeded", "omp-single-call-unavailable",
    "agent-config-invalid", "single-call-unsupported", "single-call-output-invalid"];
  it("has an en and a zh ccloop entry for every CCLOOP_CODES code, the same codes in both, each interpolating only {{detail}}", () => {
    for (const table of [enCcloopErrors, zhCcloopErrors]) expect(CCLOOP_CODES.filter((code) => !has(table, code))).toEqual([]);
    expect(Object.keys(enCcloopErrors).sort()).toEqual(Object.keys(zhCcloopErrors).sort());
    for (const [lang, table] of [["en", enCcloopErrors], ["zh", zhCcloopErrors]] as const) {
      for (const [code, text] of Object.entries(table)) {
        expect(text.trim(), `${lang} ${code}`).not.toBe("");
        expect([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).filter((name) => name !== "detail"), `${lang} ${code}`).toEqual([]);
      }
    }
  });
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web && ../node_modules/.bin/vitest run tests/ccloopCodes.test.tsx tests/agentSelectionEditor.test.tsx tests/agentSettings.test.tsx > /private/tmp/oec/logs/a7-red-web.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a7-red-web.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > /private/tmp/oec/logs/a7-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a7-red.log
```
Expected red: `ccloopCodes.test.tsx` fails to load (`../src/ccloopCodes.js` missing — a load error is acceptable **only** at RED; every mutation below must red on an assertion); the two appended tests at their `toContain`; `refusalCoverage` at `CCLOOP_CODES` (import undefined) and at `control-peer-exit` in both languages.

- [ ] **Step 3: Implement**

Create `web/src/ccloopCodes.ts`:

```ts
/**
 * ccloop error codes spec (2026-10-15) §4.6: ccloop's own code and detail, explained in the reader's language wherever the
 * panel shows one. ccloop's table first, then the Orca error table (a named refusal both share keeps its Orca text), else
 * the generic sentence, which still names the code and the detail.
 */
import i18n, { currentLanguage, errorEntry, fillEntry } from "./i18n.js";
import { enCcloopErrors } from "./locales/en.js";
import { zhCcloopErrors } from "./locales/zh.js";

/** A code as the server writes one before `: <detail>` (src/control/ccloopPort.ts PEER_CODE). */
const CODE_THEN_DETAIL = /^([a-z][a-z0-9-]{0,63})(?:$|: ([\s\S]*)$)/;

function ccloopEntry(code: string): string | undefined {
  const table = currentLanguage() === "zh" ? zhCcloopErrors : enCcloopErrors;
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

export function explainCcloopCode(code: string, detail: string): string {
  const entry = ccloopEntry(code) ?? errorEntry(code);
  if (entry !== undefined) return fillEntry(entry, { message: "", status: "", detail });
  return detail === "" ? i18n.t("ccloop.genericNoDetail", { code }) : i18n.t("ccloop.generic", { code, detail });
}

/** `<code>[: <detail>]`, as the server writes it after `ccloop-failed:` and after a peer exit's `<exit>:`; `unknown` when no code leads. */
export function codeAndDetail(text: string): { code: string; detail: string } {
  const match = CODE_THEN_DETAIL.exec(text);
  return match ? { code: match[1]!, detail: match[2] ?? "" } : { code: "unknown", detail: text };
}

/** A stored peer-exit reason after its prefix: `<exit>[:<code>][: <detail>]` (the server's peerExitText). */
export function peerExitReason(rest: string): { code: string; detail: string } {
  const cut = rest.indexOf(":");
  return codeAndDetail(cut === -1 ? "" : rest.slice(cut + 1));
}

const ESTIMATOR_REJECTED = "agent-selection-rejected:estimator:";
const CALL_FAILED = "estimate-call-failed:";
/** An estimate's reason that carries a ccloop code (§4.3 estimator slot, §4.5 failed call); null for any other. */
export function explainEstimateReason(reasonCode: string): string | null {
  if (reasonCode.startsWith(ESTIMATOR_REJECTED)) return explainCcloopCode(reasonCode.slice(ESTIMATOR_REJECTED.length), "");
  if (reasonCode.startsWith(CALL_FAILED)) return explainCcloopCode(reasonCode.slice(CALL_FAILED.length), "");
  return null;
}
```

`web/src/refusalExplain.ts`: line 7 becomes `import i18n, { errorEntry, fillEntry, refusalDetail, refusalText } from "./i18n.js";` plus `import { codeAndDetail, explainCcloopCode, peerExitReason } from "./ccloopCodes.js";`; `explainRefusal` (lines 32-36) becomes

```ts
export function explainRefusal(refusal: ControlRefusal): { text: string; items: string[] } {
  // ccloop error codes spec (2026-10-15) §4.6: a ccloop failure is explained by ccloop's own code.
  if (refusal.code === "ccloop-failed") { const { code, detail } = codeAndDetail(refusalDetail(refusal)); return { text: explainCcloopCode(code, detail), items: [] }; }
  const detail = refusal.code === PLAN_REJECTED ? refusalDetail(refusal) : "";
  if (detail === "") return { text: refusalText(refusal), items: [] };
  return { text: i18n.t("refusal.planRejected"), items: detail.split("\n").map(planItemText) };
}
```
and `explainRunReason` (lines 39-43) becomes

```ts
/** ccloop error codes spec (2026-10-15) §4.6: prefixes whose detail is a peer exit, and the usage-unknown blocks that may carry a code. */
const PEER_PREFIXES = new Set(["control-peer-exit", "accept-refused"]);
const USAGE_UNKNOWN = new Set(["estimate-usage-unknown", "requirement-usage-unknown"]);
/** A blocked run's reason explained by its prefix up to the first ':' (the rest is its detail); null when there are no words for it. */
export function explainRunReason(reason: string): string | null {
  const cut = reason.indexOf(":");
  const prefix = cut === -1 ? reason : reason.slice(0, cut), rest = cut === -1 ? "" : reason.slice(cut + 1);
  const entry = errorEntry(prefix);
  if (entry === undefined) return null;
  if (PEER_PREFIXES.has(prefix)) { const { code, detail } = peerExitReason(rest); return fillEntry(entry, { message: reason, status: "", detail: explainCcloopCode(code, detail) }); }
  if (USAGE_UNKNOWN.has(prefix) && rest !== "") return `${fillEntry(entry, { message: reason, status: "", detail: "" })} ${explainCcloopCode(rest, "")}`;
  return fillEntry(entry, { message: reason, status: "", detail: rest });
}
```

Surfaces (each imports `explainCcloopCode` / `explainEstimateReason` from `./ccloopCodes.js`, or `explainRunReason` from `./refusalExplain.js`):
- `AgentSelectionEditor.tsx:73`: `{outcome.kind === "rejected" ? t("agents.rejected") : t("agents.unavailable")} · {outcome.code} · {explainCcloopCode(outcome.code, "")}`.
- `AgentSettings.tsx:118`: `{installation.failureCode && <p role="status">{t("agents.updates.unavailable", { code: installation.failureCode })} {explainCcloopCode(installation.failureCode, "")}</p>}`.
- `ControlGroupView.tsx:488`: after `{estimate.reasonCode !== null ? \` · ${estimate.reasonCode}\` : ""}` add `{estimate.reasonCode !== null && explainEstimateReason(estimate.reasonCode) !== null ? \` · ${explainEstimateReason(estimate.reasonCode)}\` : ""}`.
- `TaskDetail.tsx:307`: `<p className="detail-note">{t("control.savedResult.unavailable")} <code>{answer.reason}</code> {explainCcloopCode(answer.reason, "")}</p>`.
- `RequirementsPanel.tsx`: in `Detail`, after `const step = …;` (line 260) add `  // ccloop error codes spec (2026-10-15) §4.5-§4.6: a failed step names its latest failed call's ccloop code.\n  const failedCall = step?.state === "failed" ? [...step.calls].reverse().find((call) => call.outcome === "failed") ?? null : null;`; after the `reason` alert's closing `)}` (line 300) add `      {!archived && failedCall?.reason != null && <p role="status">{failedCall.reason} · {explainCcloopCode(failedCall.reason, "")}</p>}`; line 302's `{blockedRun.reason !== null && <>{blockedRun.reason} · </>}` becomes `{blockedRun.reason !== null && <>{blockedRun.reason}{explainRunReason(blockedRun.reason) !== null ? \` · ${explainRunReason(blockedRun.reason)}\` : ""} · </>}`.

Locales:
- `en.ts`, before `  enums: {` (line 1034): `  // ccloop error codes spec (2026-10-15) §4.6: a ccloop code with no entry in either table.\n  ccloop: { generic: "{{code}}: {{detail}}", genericNoDetail: "{{code}}" },`; `zh.ts` the same place inside `zh`: `  ccloop: { generic: "{{code}}：{{detail}}", genericNoDetail: "{{code}}" },`.
- `enErrors`: after the A2 `"ccloop-failed"` line add `  // ccloop error codes spec §4.4: a peer exit's stored run reason; the detail is ccloop's code explained (web/src/refusalExplain.ts).\n  "control-peer-exit": "ccloop exited with an error: {{detail}}",`; `zhErrors`: `  "control-peer-exit": "ccloop 出错退出：{{detail}}",`.
- After `enErrors` (`};` at the end of `en.ts`) add `/** ccloop error codes spec (2026-10-15) §4.7: ccloop's own codes an operator can act on; each may interpolate only {{detail}}. */\nexport const enCcloopErrors: Record<string, string> = { … };` with the seven en texts of the table above; in `zh.ts` `export const zhCcloopErrors: Record<string, string> = { … };` with the seven zh texts.

- [ ] **Step 4: Run green** — web: `tests/ccloopCodes.test.tsx tests/agentSelectionEditor.test.tsx tests/agentSettings.test.tsx tests/refusalExplain.test.ts tests/refusalText.test.tsx tests/codexRateLimited.test.tsx tests/requirements.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/runReasonDiagnosis.test.tsx` to `a7-green-web.log`; web tsc `cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > /private/tmp/oec/logs/a7-webtsc.log 2>&1`; root: `tests/panel/refusalCoverage.test.ts tests/panel/scanPanelText.test.ts tests/metrics` to `a7-green.log` (handoff §6.7: these two cross-package criteria see web text that `--ws check` does not); `npm run build --workspace web` to `a7-webbuild.log`. All pass, 0 skipped, every RC 0.

- [ ] **Step 5: Commit** — the created and modified web files, `tests/panel/refusalCoverage.test.ts`, the three web test files; message `feat(web): explain ccloop's codes in English and Chinese wherever the panel shows one`.

- [ ] **Step 6 (reviewer, clone `a7`): mutations** (dir `web`, test `tests/ccloopCodes.test.tsx` unless named)
  - `A7a` no ccloop table: `web/src/ccloopCodes.ts` `{"from": "const entry = ccloopEntry(code) ?? errorEntry(code);", "to": "const entry = errorEntry(code);"}` — red: "reads ccloop's table…" row 1, "a refusal…", "a run reason…", "an estimate's reason code", "a failed requirement…".
  - `A7b` no Orca fallback: same file `{"from": "const entry = ccloopEntry(code) ?? errorEntry(code);", "to": "const entry = ccloopEntry(code);"}` — red: "reads ccloop's table…" (the `agent-unselected` row), "a run reason…" (accept-refused row).
  - `A7c` drop an unknown code: same file `{"from": "  return detail === \"\" ? i18n.t(\"ccloop.genericNoDetail\", { code }) : i18n.t(\"ccloop.generic\", { code, detail });\n", "to": "  return detail;\n"}` — red: every generic row.
  - `A7d` refusal not special-cased: `web/src/refusalExplain.ts` `{"from": "  if (refusal.code === \"ccloop-failed\") {", "to": "  if (false) {"}` — red: "a refusal…".
  - `A7e` run reason not parsed: same file `{"from": "  if (PEER_PREFIXES.has(prefix)) {", "to": "  if (false) {"}` — red: "a run reason…".
  - `A7f` usage-unknown code dropped: same file `{"from": "  if (USAGE_UNKNOWN.has(prefix) && rest !== \"\") return", "to": "  if (false) return"}` — red: "a run reason…" row 4 and "a failed requirement…".
  - `A7g` each component: `web/src/AgentSelectionEditor.tsx` `{"from": " · {explainCcloopCode(outcome.code, \"\")}", "to": ""}`, test `tests/agentSelectionEditor.test.tsx` — red: the appended test (slot line). `web/src/ControlGroupView.tsx` (remove the `explainEstimateReason` expression) — same test, estimate line. `web/src/AgentSettings.tsx` (` {explainCcloopCode(installation.failureCode, "")}` → ``), test `tests/agentSettings.test.tsx`. `web/src/TaskDetail.tsx` (` {explainCcloopCode(answer.reason, "")}` → ``) — "a saved-result reason". `web/src/RequirementsPanel.tsx` (remove the `failedCall` paragraph) — "a failed requirement…".
  - `A7h` English back in zh: `web/src/locales/zh.ts` `{"from": "  \"omp-model-catalog-unavailable\": \"omp 无法列出它的模型目录（{{detail}}）。请确认 omp 已安装且能启动，然后重试。\",", "to": "  \"omp-model-catalog-unavailable\": \"omp could not list its model catalog ({{detail}}). Check that omp is installed and starts, then retry.\","}` — red: the zh assertions of "in Chinese", "a refusal…", "a run reason…".
  - `A7i` coverage: `web/src/locales/zh.ts` delete the `zhCcloopErrors` `"omp-single-call-cap-exceeded"` line, dir `root`, test `tests/panel/refusalCoverage.test.ts` — red: the `CCLOOP_CODES` test. `A7j`: delete `enErrors["control-peer-exit"]` — red: "has a en entry for every …" (`["control-peer-exit"]`).

---

### Task A8: A log line for the paths left as "unknown" (spec A §4.9)

**Files:**
- Modify: `src/control/executionDriver.ts:466-477` (stepB catch), `:486-488` (stepBPrime), `:552` (saved-result evidence catch); imports (add `peerFailureLogLine`)
- Modify: `src/control/driverHandoff.ts:146-148` (`inspectUnderStop`), `:188-192` (`deliverAndCollect`); import
- Modify: `src/control/dispatch.ts:42-46` (`send`), `:76` (`reconcileStart`); import
- Modify: `src/control/stopIntent.ts:654` (model-assisted handoff probe)
- Test (create): `tests/control/peerFailureLog.test.ts`

**Interfaces:** Consumes A1's `peerFailureLogLine(runId, error)`. Produces stderr lines `orca-driver: <runId>: ccloop <code|unknown>[: <detail>]\n`; for the handoff probe `orca-driver: <runId>: ccloop <probeFailureCode>\n`. Control flow on every path is unchanged.

Spec A §5 names no criterion for §4.9. Two are added (stepB, stepB′); the other six call sites (`executionDriver.ts:552`, `driverHandoff.ts:148,192`, `dispatch.ts:43,76`, `stopIntent.ts:654`) get the same one-line call and are **registered as uncovered by a criterion** in the checkpoint (Rule 12), not claimed tested.

- [ ] **Step 1: Write the failing test** — create `tests/control/peerFailureLog.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.9: paths that turn a ccloop failure into "unknown" and try again keep doing so,
// but each names ccloop's failure on stderr once per occurrence, so `orca panel logs` says why a run went unknown.
describe("unknown-path log lines (spec A §4.9)", () => {
  it("names the accept and the inspect failures a run went unknown on", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      const port = t.fake.port as unknown as Record<string, unknown>;
      port.accept = async () => { throw new ControlError("control-peer-exit", "1:Error: accept lost"); };
      port.inspect = async () => { throw new ControlError("control-peer-exit", "1:Error: inspect lost"); };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedReason: "inspect-unknown" });
      expect([...new Set(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: ccloop`)))]).toEqual([
        `orca-driver: ${runId}: ccloop unknown: Error: accept lost\n`, `orca-driver: ${runId}: ccloop unknown: Error: inspect lost\n`,
      ]);
    } finally { spy.mockRestore(); await t.h.dispose(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red** — to `a8-red.log`. Expected red at the last assertion (`[]`). If the run does not reach `blocked` with `inspect-unknown`, read the log and the run body and report: the premise (ten unknown inspections block the run, `executionDriver.ts:482` doc) is then wrong for this harness.

- [ ] **Step 3: Implement** — each site keeps its control flow; e.g. `executionDriver.ts` line 476 `    status = { kind: "unknown" };` becomes `    const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line);\n    status = { kind: "unknown" };`; line 488 `  catch { status = { kind: "unknown" }; }` becomes `  catch (error) { const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line); status = { kind: "unknown" }; }`; line 552 `}catch{write(` becomes `}catch(error){const line=peerFailureLogLine(runId,error);if(line!==null)process.stderr.write(line);write(`; `driverHandoff.ts:148` and `:192` the same shape with `run.runId`; `dispatch.ts:43` `catch {` → `catch (error) { const line = peerFailureLogLine(input.claim.runId, error); if (line !== null) process.stderr.write(line);` and `:76` the same with `runId`; `stopIntent.ts` after line 654's `if (observed.probeFailureCode !== null || …) {` insert `        if (observed.probeFailureCode !== null) process.stderr.write(\`orca-driver: ${run.runId}: ccloop ${observed.probeFailureCode}\\n\`);` (check the run variable's name at that line first).

- [ ] **Step 4: Run green** — `tests/control/peerFailureLog.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/dispatch.test.ts tests/control/handoffGuards.test.ts` (drop missing ones, say so) to `a8-green.log`; typecheck.

- [ ] **Step 5: Commit** — the four src files and the test; message `feat(control): name ccloop's failure on the paths that treat it as unknown`.

- [ ] **Step 6 (reviewer, clone `a8`): mutations** — test `tests/control/peerFailureLog.test.ts`, file `src/control/executionDriver.ts`:
  - `A8a` stepB silent: `{"from": "    const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line);\n    status = { kind: \"unknown\" };", "to": "    status = { kind: \"unknown\" };"}` — red (accept line missing).
  - `A8b` stepB′ silent: `{"from": "  catch (error) { const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line); status = { kind: \"unknown\" }; }", "to": "  catch { status = { kind: \"unknown\" }; }"}` — red (inspect line missing).

---

### Task B1: One predicate, shared by the view and the guard (spec B §3.1)

**Files:**
- Create: `src/control/executionPending.ts`
- Modify: `src/panel/controlViews.ts:362-379` (`BUSY_WORK` and `executionPending`), `:455`; import
- Test (create): `tests/control/executionPending.test.ts`

**Interfaces:**
- Produces (`src/control/executionPending.ts`):
  - `export const BUSY_WORK: ReadonlySet<string>`; `export const EXECUTION_WAKE_KINDS: ReadonlySet<string>`
  - `export interface ExecutionFacts { readonly undeliveredWakeKinds: readonly string[]; readonly activeRunPhases: readonly unknown[]; readonly taskStatuses: readonly unknown[] }`
  - `export function executionPendingFrom(facts: ExecutionFacts): boolean`
  - `export interface ExecutionSnapshot { readonly runsByRowid: ReadonlyArray<{ readonly id: string; readonly active: number }>; decodeRun(id: string): StoredJson | undefined; decodeWork(id: string): StoredJson | undefined }` (`StoredJson = { ok: true; value: unknown } | { ok: false; error: SyntaxError }`, structurally the panel's `GroupReadSnapshot`)
  - `export function groupExecutionPending(store: ControlStore, groupId: string, taskIds: readonly string[], snapshot: ExecutionSnapshot): boolean`
  - `export function groupExecutionPendingInStore(store: ControlStore, groupId: string): boolean`
- `controlViews.ts` re-exports `BUSY_WORK` (so `controlOverview.ts:8` is unchanged; the Overview gate is not changed — see Interpretations).

- [ ] **Step 1: Write the failing test** — create `tests/control/executionPending.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { executionPendingFrom, groupExecutionPendingInStore } from "../../src/control/executionPending.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.1: one predicate decides "this group's execution is pending or running" for the group
// view (which hides Start) and for start's guard (which refuses it) -- two copies drifted once already. An estimate,
// clarify or split single call shares the runs table and is not execution: it has its own guards.
async function confirmed() {
  const h = await webFixture(profileSnapshot());
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

describe("the execution-pending predicate (spec B §3.1)", () => {
  it("counts only dispatch wakes, work runs and busy work statuses", () => {
    expect(executionPendingFrom({ undeliveredWakeKinds: ["continuation", "budget-estimate", "requirement-call", "requirement-export"],
      activeRunPhases: ["single-call", "handoff", undefined], taskStatuses: ["draft", "ready", "done", "blocked", "completed", undefined] })).toBe(false);
    const one = (facts: Partial<Parameters<typeof executionPendingFrom>[0]>) => executionPendingFrom({ undeliveredWakeKinds: [], activeRunPhases: [], taskStatuses: [], ...facts });
    expect([one({ undeliveredWakeKinds: ["start"] }), one({ undeliveredWakeKinds: ["no-start"] }), one({ undeliveredWakeKinds: ["resume"] }), one({ activeRunPhases: ["work"] }),
      ...["running", "active", "starting", "start-unknown", "held", "continuing"].map((status) => one({ taskStatuses: [status] }))])
      .toEqual([true, true, true, true, true, true, true, true, true, true]);
  });

  it("an active estimate run alone is not pending, in the view and in the store", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n).toBe(1);
      expect([readControlGroup(h.store, "epoch-test", "g").summary.executionPending, groupExecutionPendingInStore(h.store, "g")]).toEqual([false, false]);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run red** — to `b1-red.log`. Expected: load error (module missing) at RED; after Step 3 the mutations below red on assertions.

- [ ] **Step 3: Implement** — create `src/control/executionPending.ts`:

```ts
import type { ControlStore } from "./store.js";

/**
 * Start guard spec (2026-10-15) §3.1 (feedback #53): a Web start only queues a wake and its claim only marks the work item,
 * so the stored group status stays `ready` through the first run. One predicate says the group's execution is pending or
 * running; the group view reads it over its snapshot (Start is hidden), `start` reads it from the store (it is refused).
 * Defined only for a group with an archived plan; callers check requirement-not-split first.
 */
/** Work statuses that mean a task's execution is under way (the overview's start gate reads the same set). */
export const BUSY_WORK: ReadonlySet<string> = new Set(["running", "active", "starting", "start-unknown", "held", "continuing"]);
/** The wakes that dispatch a group's work. `continuation` is not one: nothing writes it (continuations arm `resume`). */
export const EXECUTION_WAKE_KINDS: ReadonlySet<string> = new Set(["start", "no-start", "resume"]);

export interface ExecutionFacts {
  readonly undeliveredWakeKinds: readonly string[];
  /** The `phase` of each active run: estimate, clarify and split single calls share the table and do not count. */
  readonly activeRunPhases: readonly unknown[];
  readonly taskStatuses: readonly unknown[];
}
export function executionPendingFrom(facts: ExecutionFacts): boolean {
  return facts.undeliveredWakeKinds.some((kind) => EXECUTION_WAKE_KINDS.has(kind))
    || facts.activeRunPhases.some((phase) => phase === "work")
    || facts.taskStatuses.some((status) => BUSY_WORK.has(String(status)));
}

type StoredJson = { ok: true; value: unknown } | { ok: false; error: SyntaxError };
export interface ExecutionSnapshot {
  readonly runsByRowid: ReadonlyArray<{ readonly id: string; readonly active: number }>;
  decodeRun(id: string): StoredJson | undefined;
  decodeWork(id: string): StoredJson | undefined;
}
const field = (result: StoredJson | undefined, name: string): unknown =>
  result?.ok === true && typeof result.value === "object" && result.value !== null ? (result.value as Record<string, unknown>)[name] : undefined;
const decode = (body: unknown): StoredJson => { try { return { ok: true, value: JSON.parse(String(body)) }; } catch (error) { return { ok: false, error: error as SyntaxError }; } };
function undeliveredWakeKinds(store: ControlStore, groupId: string): string[] {
  return store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id=? AND delivered=0").all(groupId).map((row) => String(row.kind));
}

/** The group view's entry: the facts its read snapshot holds; a row whose body does not decode is skipped. */
export function groupExecutionPending(store: ControlStore, groupId: string, taskIds: readonly string[], snapshot: ExecutionSnapshot): boolean {
  return executionPendingFrom({
    undeliveredWakeKinds: undeliveredWakeKinds(store, groupId),
    activeRunPhases: snapshot.runsByRowid.filter((row) => row.active === 1).map((row) => field(snapshot.decodeRun(row.id), "phase")),
    taskStatuses: taskIds.map((taskId) => field(snapshot.decodeWork(taskId), "status")),
  });
}
/** `start`'s entry: the same facts read from the store, inside the caller's transaction (the group's task work items). */
export function groupExecutionPendingInStore(store: ControlStore, groupId: string): boolean {
  return executionPendingFrom({
    undeliveredWakeKinds: undeliveredWakeKinds(store, groupId),
    activeRunPhases: store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(groupId).map((row) => field(decode(row.body), "phase")),
    taskStatuses: store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId).map((row) => decode(row.body))
      .filter((result) => field(result, "kind") === "task").map((result) => field(result, "status")),
  });
}
```
`controlViews.ts`: replace lines 362-379 (the `BUSY_WORK` doc and const, the #53 doc comment and the `executionPending` function) with `export { BUSY_WORK } from "../control/executionPending.js";`; add `import { groupExecutionPending } from "../control/executionPending.js";`; line 455 becomes `    ...(archived === null ? {} : { executionPending: groupExecutionPending(store, groupId, archived.plan.tasks.map((task) => task.taskId), readSnapshot!) }),`.

- [ ] **Step 4: Run green** — `tests/control/executionPending.test.ts tests/control/webDispatch.test.ts tests/panel/controlOverview.test.ts tests/panel/controlOverviewApi.test.ts tests/panel/groupSummaryFields.test.ts tests/panel/controlPollPerformance.test.ts` to `b1-green.log` (`webDispatch.test.ts:277-327`'s five criteria keep their assertions; `:316`'s fixture claims a real **work** run — confirm in the log it is green); typecheck.

- [ ] **Step 5: Commit** — `src/control/executionPending.ts src/panel/controlViews.ts tests/control/executionPending.test.ts`; message `refactor(control): share the execution-pending predicate between the group view and start`.

- [ ] **Step 6 (reviewer, clone `b1`, web build first): mutations** — file `src/control/executionPending.ts`:
  - `B1a` count every active run: `{"from": "facts.activeRunPhases.some((phase) => phase === \"work\")", "to": "facts.activeRunPhases.some(() => true)"}`, test `tests/control/executionPending.test.ts` — red: both tests.
  - `B1b` count `continuation` again: `{"from": "new Set([\"start\", \"no-start\", \"resume\"])", "to": "new Set([\"start\", \"no-start\", \"resume\", \"continuation\"])"}` — red: "counts only…" (first assertion).
  - `B1c` view ignores runs: `{"from": "    activeRunPhases: snapshot.runsByRowid.filter((row) => row.active === 1).map((row) => field(snapshot.decodeRun(row.id), \"phase\")),\n", "to": "    activeRunPhases: [],\n"}`, test `tests/control/webDispatch.test.ts -t "active run alone"` — red: "says execution is pending on an active run alone…".

---

### Task B2: The `group-execution-pending` guard (spec B §3.2; criteria 1-6; correction K7)

**Files:**
- Modify: `src/control/errors.ts:95` (after `"start-state-conflict": 409,`)
- Modify: `src/control/webDispatch.ts:125-171` (`scheduleStart`), imports
- Modify: `skills/orca-control/SKILL.md:32`
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (error tables)
- Test (create): `tests/control/startGuard.test.ts`, `tests/panel/startGuardSocket.test.ts`; append one test to `tests/entry/skill.test.ts`

**Interfaces:**
- Consumes: B1's `groupExecutionPendingInStore`; `applyWebCommand`, `preflightWebCommand` (`src/control/commandLedger.ts:160, 302`).
- Produces: durable `"group-execution-pending": 409`; `scheduleStart` refuses before the probe (ledgered via `applyWebCommand` with a throwing `expand`/`apply`, the `applyRequirementOpen` pattern at `requirementCommands.ts:74-76`) and again inside the transaction after the clarifying check. Precedence: preflight (`revision-conflict`, `group-archived`) → `requirement-not-split` → `group-execution-pending` → the rest unchanged.

- [ ] **Step 0: Census baseline** (before any B2 edit; long, run in the background and wait; record `uptime`)

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && uptime > /private/tmp/oec/logs/b2-census-before.uptime && ORCA_CCLOOP_BIN=/private/tmp/orp-gate/ccl/dist/cli.js ORCA_AGENTS_TABLE=/private/tmp/oec/gate/table.json ./node_modules/.bin/vitest run tests/control tests/panel tests/entry --reporter=json --outputFile=/private/tmp/oec/logs/b2-census-before.json > /private/tmp/oec/logs/b2-census-before.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/b2-census-before.log
```
(The table is written in Task G Step 1; write it now if Task G has not run — the same command.) Read the log whole; keep the JSON.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/control/startGuard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { recordUsage } from "../../src/control/usage.js";
import { createWebWakeHandlers, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.2, criteria 1-6 (feedback #53): a second start while the group's execution is pending
// used to be accepted -- a revision bump, an activity row and a redundant wake -- over HTTP, the socket, the CLI and MCP.
// It is refused by name before the agent is asked, ledgered, and checked again inside the transaction.
type Fixture = Awaited<ReturnType<typeof webFixture>>;
async function confirmed(tasks = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}
const fingerprint = (h: Fixture): string => JSON.stringify({
  groups: h.store.db.prepare("SELECT id,revision,projection_seq,body FROM groups ORDER BY id").all(),
  activity: h.store.db.prepare("SELECT * FROM activity ORDER BY seq").all(),
  wakes: h.store.db.prepare("SELECT id,kind,body,delivered FROM scheduler_wakes ORDER BY rowid").all(),
  allowances: h.store.db.prepare("SELECT * FROM funded_allowances ORDER BY rowid").all(),
  work: h.store.db.prepare("SELECT id,body FROM work_items ORDER BY id").all(),
});
const setWork = (h: Fixture, patch: Record<string, unknown>) => {
  const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, ...patch }));
};

describe("a second start is refused while execution is pending (spec B §3.2)", () => {
  it("C1: refuses before asking the agent, changes nothing, and replays the same refusal from the ledger", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const before = fingerprint(h), asked = h.asked.length;
      const second = h.command("start", {}, "second-start");
      const refused = await service.start(second);
      expect(refused).toEqual({ error: { code: "group-execution-pending", message: "group-execution-pending", commandRevision: expect.any(Number), evidenceIds: [], retryable: false } });
      expect([h.asked.length - asked, fingerprint(h) === before]).toEqual([0, true]);
      expect(lookupCommandResult(h.store, "g", "second-start")).toMatchObject({ originalStatus: 409, body: refused });
      expect(await service.start(second)).toEqual(refused);
      expect(h.asked.length - asked).toBe(0);
    } finally { await h.dispose(); }
  });

  it.each(["no-start", "resume"])("C2: refuses on an undelivered %s wake alone", async (kind) => {
    const { h, service } = await confirmed(); try {
      h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,?,?,0)").run(`injected-${kind}`, "g", kind, "{}");
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it.each(["running", "active", "starting", "start-unknown", "held", "continuing"])("C2: refuses on a %s task alone", async (status) => {
    const { h, service } = await confirmed(); try {
      setWork(h, { status });
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C2: refuses on an active work run alone", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      setWork(h, { status: "ready" });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get()!.n).toBe(0);
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C2: refuses on a held task left by a settled handoff and a resume with no selection (a real state)", async () => {
    const { h, service } = await confirmed([{ taskId: "a" }, { taskId: "b" }]); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const claimed = await deliverScheduledStart(h.deps, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      recordUsage(h.store, { runId: claimed.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 10, activeMs: 10, attempts: 1, sessions: 1 }, source: { artifactId: `usage-${claimed.runId}`, hash: "e".repeat(64) } });
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(claimed.runId)!.id);
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { requestId, outcome: "settled-recoverable" });
      expect(await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }))).toMatchObject({ result: { kind: "resumed-from-handoff" } });
      // The premise (production state, not written by this test): the held task is the only pending fact.
      expect([h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get()!.n,
        h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1 AND json_extract(body,'$.phase')='work'").get()!.n]).toEqual([0, 0]);
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C3: an active estimate run alone is not execution: start answers estimate-in-flight", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "estimate-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("C3: a clarifying group with a call in flight still answers requirement-not-split", async () => {
    const x = await requirementHarness({ answers: [] });
    try {
      await x.deliver();
      expect(x.runs()).toEqual([expect.objectContaining({ state: "starting", phase: "single-call", active: 1 })]);
      expect(await x.service.start(x.command("start", {}))).toMatchObject({ error: { code: "requirement-not-split" } });
    } finally { await x.dispose(); }
  });

  it("C4: catches a start wake that arrives while the frozen profiles are probed", async () => {
    const { h, service } = await confirmed(); try {
      const original = h.resolveAgent.getMockImplementation()!;
      let injected = false;
      h.resolveAgent.mockImplementation(async (partial) => {
        if (!injected) { injected = true; h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('raced-start','g','start','{}',0)").run(); }
        return original(partial);
      });
      expect(await service.start(h.command("start", {}, "raced"))).toMatchObject({ error: { code: "group-execution-pending" } });
      expect([injected, h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get()!.n]).toEqual([true, 1]);
    } finally { await h.dispose(); }
  });

  it("C6: after retry-task returns the only task to ready, and before any driver round re-arms a wake, start is accepted", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried", taskId: "a" } });
      expect(await t.service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await t.h.dispose(); }
  }, 30_000);
});
```

(b) Create `tests/panel/startGuardSocket.test.ts`:

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/entry/controlCommand.js";
import { bindControlSocket, buildControlSocketApp, socketPathTooLong } from "../../src/panel/controlSocket.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { command, createHarness, GROUP, revision } from "./fixtures/controlPanel.js";
import { overSocket } from "./fixtures/socketPanel.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm } = createOverviewFixtures(h);

// Start guard spec (2026-10-15) §5 criterion 5: the refusal is the same over the control socket (agents) and through
// `orca control send` (status 409 in the envelope, exit 2), because both reach scheduleStart through the same routes.
describe("a second start over the control socket and the CLI (spec B criterion 5)", () => {
  it("answers 409 group-execution-pending on the socket, and the CLI prints that envelope and exits 2", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    expect((await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "start-1", expectedRevision: await revision(panel), payload: {} })).status).toBe(202);
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), "s")));
    const path = join(stateDir, "control.sock");
    expect(socketPathTooLong(path)).toBe(false);
    const bound = await bindControlSocket(buildControlSocketApp({ store: panel.store, epoch: panel.epoch, config: undefined as never, service: panel.service }), path);
    if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}: ${bound.detail}`);
    try {
      const rev = await revision(panel);
      const socket = await overSocket(path, "POST", `/api/control/groups/${GROUP}/start`, { "x-orca-client": "cli" }, { commandId: "start-socket", expectedRevision: rev, payload: {} });
      expect([socket.status, JSON.parse(socket.text).error.code]).toEqual([409, "group-execution-pending"]);
      const printed: string[] = [];
      const exit = await runControlCommand(["send", `groups/${GROUP}/start`, "--expected-revision", String(rev), "--payload", "{}", "--command-id", "start-cli", "--control-state-dir", stateDir], {},
        { write: (line) => { printed.push(line); }, readFile: () => "" });
      expect([exit, JSON.parse(printed.join("")).status, JSON.parse(printed.join("")).body.error.code]).toEqual([2, 409, "group-execution-pending"]);
    } finally { await bound.close(); }
  }, 30_000);
});
```

(c) Append inside the `describe` of `tests/entry/skill.test.ts`:

```ts
  // Start guard spec (2026-10-15) §3.2: an agent is told the server refuses a second start, by name.
  it("names group-execution-pending as the refusal of a second start, and no longer says the server accepts one", () => {
    expect(skill).toContain("`group-execution-pending`");
    expect(skill).not.toContain("the server still accepts a second start");
  });
```

- [ ] **Step 2: Run red** — `tests/control/startGuard.test.ts tests/panel/startGuardSocket.test.ts tests/entry/skill.test.ts` to `b2-red.log` (web build exists from U2). Expected red: C1, every C2 row, C4, the socket test, the skill test. **C3 (both) and C6 are green** at RED: they pin what the guard must not refuse.

- [ ] **Step 3: Implement**
  - `errors.ts` after `"start-state-conflict": 409,`: `  // Start guard spec (2026-10-15) §3.2: a start while the group's execution is pending or running (feedback #53).\n  "group-execution-pending": 409,`.
  - `webDispatch.ts`: `import { groupExecutionPendingInStore } from "./executionPending.js";`; before `export async function scheduleStart` add
    ```ts
    /** Start guard spec (2026-10-15) §3.2: a group with a plan whose execution is pending; a clarifying group is left to requirement-not-split. */
    function startRefusedAsPending(store: ControlStore, groupId: string): boolean {
      const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (row === undefined || (JSON.parse(String(row.body)) as { status?: unknown }).status === "clarifying") return false;
      return groupExecutionPendingInStore(store, groupId);
    }
    function refuseStart(store: ControlStore, command: StartCommand): CommandResult {
      const refusal = new ControlError("group-execution-pending");
      return applyWebCommand<CommandResult>(store, { rawCommand: command, expand: () => { throw refusal; }, apply: () => { throw refusal; } }).body;
    }
    ```
    In `scheduleStart`, as the first statement inside `try {` (before `let degraded = false;`): `    // Start guard spec §3.2: refused, ledgered, before the frozen profiles are probed -- a refused start asks no agent.\n    if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);`; inside `apply`, after `if ((group as { status: string }).status === "clarifying") throw new ControlError("requirement-not-split");`: `        // And again here: a wake inserted while the probe ran is still caught.\n        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError("group-execution-pending");`.
  - `SKILL.md:32` becomes: `   A group's \`state\` stays \`ready\` while a Web-started first run is pending or executing; read \`executionPending\` on the group summary: while it is true the server refuses \`start\` with \`group-execution-pending\` (409) and dispatches the group's next task itself.`
  - `en.ts` `enErrors` (next to `"group-state-invalid"`): `  "group-execution-pending": "This group is already starting or running; its next task is dispatched automatically.",`; `zh.ts`: `  "group-execution-pending": "这个组已在启动或运行中；它的下一个任务会自动派发。",`.

- [ ] **Step 4: Run green** — the three test files plus `tests/control/webDispatch.test.ts tests/control/requirementGuards.test.ts tests/panel/refusalCoverage.test.ts tests/panel/controlOverviewApi.test.ts` to `b2-green.log`; typecheck.

- [ ] **Step 5: Census after** — the Step 0 command with `-after` names. Then compare with a script (`/private/tmp/oec/census.py`, run with `python3 -I`): read both JSON files, list every `fullName` whose status is `failed` after and `passed` before, write to `/private/tmp/oec/logs/b2-census-new-reds.txt`; read it whole. Each listed file is rerun alone once (`./node_modules/.bin/vitest run <file>`, redirected) to separate load timeouts (handoff §6.7, `known-load-flakes.md`) from assertion reds.

- [ ] **Step 6: Human stop (correction K7)** — if any existing criterion outside spec B §5's list is red for `start refused: {"code":"group-execution-pending"…}` (expected: the driverHarness double-claim criteria), **do not edit them**. Commit B2 (Step 7) so the branch is describable, and put in the checkpoint's `awaitingHuman`: the exact list from `b2-census-new-reds.txt`, and the two options —
  - **Option A (one fixture change, listed per handoff §6.9):** `tests/control/fixtures/driverHarness.ts` `claim()` arms a later claim the way the driver does:
    ```ts
      /** Start guard spec (2026-10-15) §3.2: while the group's execution is pending a second start is refused, so a later
       * claim is armed as the driver arms it (replenishStartWakes), then delivered. Claims keep the first start's revision. */
      const claim = async (): Promise<string> => {
        if (groupExecutionPendingInStore(h.store, "g")) {
          if (replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate }).length === 0) throw new Error("claim: the driver would arm no start wake");
        } else {
          const started = await service.start(h.command("start", {}));
          if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
        }
        const delivered = await deliverScheduledStart(dispatch, "g");
        if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
        return delivered.runId;
      };
    ```
    (claim identity and run `commandId` then carry the first start's revision for later claims — any criterion that pins those strings will show up in a census after the change and is reported again).
  - **Option B:** the human names each listed criterion for a rewrite.
  Task G cannot pass until the ruling is applied and a new census shows no unexplained red. Continue with B3, S1-S3 meanwhile (they do not depend on it).

- [ ] **Step 7: Commit** — `src/control/errors.ts src/control/webDispatch.ts skills/orca-control/SKILL.md web/src/locales/en.ts web/src/locales/zh.ts tests/control/startGuard.test.ts tests/panel/startGuardSocket.test.ts tests/entry/skill.test.ts`; message `feat(control): refuse a second start while the group's execution is pending (#53)`. If Step 6 found reds, the commit body adds one line: `Known red pending the human's ruling (plan correction K7): <n> criteria, list in the checkpoint.`

- [ ] **Step 8 (reviewer, clone `b2`, web build first): mutations** (test `tests/control/startGuard.test.ts` unless named)
  - `B2a` drop the pre-probe check: `src/control/webDispatch.ts` `{"from": "    if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);\n", "to": ""}` — red: C1 at the probe count only (still 409 from the transaction).
  - `B2b` move it after the probe: `[{"from": "    if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);\n", "to": ""}, {"from": "      observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupTarget(command)));\n", "to": "      observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupTarget(command)));\n      if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);\n"}]` — red: C1 at the probe count.
  - `B2c` drop the in-transaction check: `{"from": "        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError(\"group-execution-pending\");\n", "to": ""}` — red: C4 only.
  - `B2d` per wake kind (2 runs): `src/control/executionPending.ts` `{"from": "new Set([\"start\", \"no-start\", \"resume\"])", "to": "new Set([\"start\", \"resume\"])"}` — red: C2 `no-start` only; `…"to": "new Set([\"start\", \"no-start\"])"` — red: C2 `resume` only.
  - `B2e` per busy status (6 runs): remove each of `"running"`, `"active"`, `"starting"`, `"start-unknown"`, `"held"`, `"continuing"` from `BUSY_WORK` in turn (e.g. `{"from": "\"running\", \"active\",", "to": "\"active\","}`) — red: that status's C2 row (and, for `held`, the real-state held criterion) only.
  - `B2f` drop the work-run disjunct: `{"from": "    || facts.activeRunPhases.some((phase) => phase === \"work\")\n", "to": ""}` — red: "C2: refuses on an active work run alone" only.
  - `B2g` count every active run: `{"from": "facts.activeRunPhases.some((phase) => phase === \"work\")", "to": "facts.activeRunPhases.some(() => true)"}` — red: C3 estimate row (`group-execution-pending` received).
  - `B2h` clarifying precedence: `[{"from": "facts.activeRunPhases.some((phase) => phase === \"work\")", "to": "facts.activeRunPhases.some(() => true)"}]` on `src/control/executionPending.ts` **and**, as a second file in the same run (apply both with two mutate calls in one manual run, recorded like `mut.sh`), `src/control/webDispatch.ts` `[{"from": "        if ((group as { status: string }).status === \"clarifying\") throw new ControlError(\"requirement-not-split\");\n        // And again here: a wake inserted while the probe ran is still caught.\n        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError(\"group-execution-pending\");\n", "to": "        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError(\"group-execution-pending\");\n        if ((group as { status: string }).status === \"clarifying\") throw new ControlError(\"requirement-not-split\");\n"}]` — red: C3 clarifying row. (Either edit alone leaves it green: the store entry reads no task work items for a clarifying group and its call is not a work run — record that as the reason this criterion needs a two-edit mutation.)
  - `B2i` count inactive runs: `{"from": "SELECT body FROM runs WHERE group_id=? AND active=1", "to": "SELECT body FROM runs WHERE group_id=?"}` on `executionPending.ts` — red: C6.
  - `B2j` socket parity: drop both checks (B2a's spec plus B2c's spec in one array on `webDispatch.ts`), test `tests/panel/startGuardSocket.test.ts` — red (202).
  - `B2k` skill text: `skills/orca-control/SKILL.md` restore the old sentence `(the server still accepts a second start while one is pending)`, test `tests/entry/skill.test.ts` — red.

---

### Task B3: Loop-plan edits while the group runs (spec B §3.3; criteria 7, 8; correction K6)

**Files:**
- Modify: `src/control/webService.ts:26` (import `readStopIntent`), `:956-959` (the group-state check in `setTaskLoop`)
- Modify: `web/src/LoopPlanCard.tsx:181-183`
- Modify (named rewrites): `tests/control/setTaskLoop.test.ts:24-31`; `web/tests/loopPlanEdit.test.tsx:148-157`; `web/tests/budgetI18n.test.tsx:150`
- Test (create): `tests/control/setTaskLoopRunning.test.ts`

**Interfaces:**
- Consumes: `readStopIntent(store, groupId): StopIntentV1 | null` (`src/control/stopIntent.ts:216`).
- Produces: `editable = ["draft", "ready", "running", "review"].includes(group.status) && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause")`, else `group-state-invalid`; web: `open = ["draft", "ready", "running", "review"].includes(view.summary.state) && (view.summary.stopMode === null || view.summary.stopMode === "pause")`. `task-already-started` (lines 964-966) unchanged.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/control/setTaskLoopRunning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart, readWorkClaimEnvelope } from "../../src/control/webDispatch.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, loop, workBody } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.3, criteria 7 and 8 (human ruling 2): a task's loop plan stays editable while its group
// runs; an edit reaches only tasks not yet started. The states are built by production code, never a flipped status --
// a flipped column passes checks that a real running group would not.
type T = Awaited<ReturnType<typeof driverHarness>>;
const THREE = [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c", loop: loop("c") }];
const pendingStart = (t: T) => t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind IN ('start','no-start') AND delivered=0").get() !== undefined;
async function claimSecond(t: T, driver: ReturnType<T["driver"]>): Promise<string> {
  await t.until(driver, () => pendingStart(t));
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
  return claimed.runId;
}

describe("set-task-loop while the group runs (spec B §3.3)", () => {
  it("C7: in a review group, after a checkpoint and with another task running, an unstarted task's plan changes and nothing else does", async () => {
    const t = await driverHarness(THREE, { behaviour: (id) => (id === "b" ? "stoppable" : "succeed") });
    try {
      const driver = t.driver();
      await t.claim();
      const runB = await claimSecond(t, driver);
      await t.until(driver, () => readWebGroup(t.h.store, "g").status === "review" && t.body(runB).state === "accepted");
      const before = { a: workBody(t.h, "a").derivedContractHash, b: workBody(t.h, "b").derivedContractHash, c: workBody(t.h, "c").derivedContractHash };
      expect(errorOf(await t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
      expect(await t.service.setTaskLoop(change(t.h, "c", { inputs: { goal: "write c, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "c", loopVersion: 1 } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "c").contract.objective.goal).toBe("write c, changed");
      expect([workBody(t.h, "a").derivedContractHash, workBody(t.h, "b").derivedContractHash]).toEqual([before.a, before.b]);
      expect(workBody(t.h, "c").derivedContractHash).not.toBe(before.c);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("C7: a paused group takes a change to an unstarted task", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ result: { kind: "paused" } });
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "a" } });
    } finally { await h.dispose(); }
  });

  it("C7: a handoff-stopped group does not", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await h.dispose(); }
  });

  it("C8: a task whose run finished keeps its contract -- its change is refused, another's is accepted, and its retry runs the contract frozen at its claim", async () => {
    const t = await driverHarness(THREE, { behaviour: (id) => (id === "b" ? "failed" : "succeed") });
    try {
      const driver = t.driver();
      await t.claim();
      const runB = await claimSecond(t, driver);
      await t.until(driver, () => readWebGroup(t.h.store, "g").status === "review" && t.body(runB).state === "blocked");
      const frozen = workBody(t.h, "b").derivedContractHash;
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "b" }))).toMatchObject({ result: { kind: "task-retried", taskId: "b" } });
      expect(workBody(t.h, "b").status).toBe("ready");
      expect(errorOf(await t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
      expect(await t.service.setTaskLoop(change(t.h, "c", { inputs: { goal: "write c, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "c" } });
      const retried = await claimSecond(t, driver);
      expect([t.body(retried).taskId, readWorkClaimEnvelope(t.h.store, "g", retried).derivedContractHash]).toEqual(["b", frozen]);
    } finally { await t.h.dispose(); }
  }, 60_000);
});
```
(`claimSecond` after the retry: the driver may already have armed a start wake for `c` before `b`'s retry; `nextClaimableTask` orders by id (`webDispatch.ts:351`), so `b` is claimed first either way.)

(b) Named rewrite, `tests/control/setTaskLoop.test.ts:24-31` — old: `it.each(["running", "review", "done", "blocked"])("refuses a group whose status is %s as group-state-invalid", async (status) => { …writeGroup(h, (body) => { body.status = status; }); …group-state-invalid… expectUntouched(h, 1); … });` → new (body of the refusal unchanged):

```ts
  // Rewritten for the start guard spec (2026-10-15; its §5 names this criterion; human ruling 2): this now encodes that done
  // and blocked refuse as group-state-invalid while running and review take a change to an unstarted task (the real
  // running/review/paused states are built in setTaskLoopRunning.test.ts).
  it.each(["done", "blocked"])("refuses a group whose status is %s as group-state-invalid", async (status) => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.status = status; });
      expect(errorOf(await new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "group-state-invalid" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it.each(["running", "review"])("accepts a change to an unstarted task of a confirmed group whose status is %s", async (status) => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      writeGroup(h, (body) => { body.status = status; });
      expect(await service.setTaskLoop(change(h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 } });
    } finally { await h.dispose(); }
  });
```
`:33` ("refuses a stopped group…", a stopped flag with no intent) is **not** rewritten (K6).

(c) Named rewrite, `web/tests/loopPlanEdit.test.tsx:148-157` — old title "offers no change while the group is past ready or stopped, where the server always refuses (group-state-invalid)" iterating `[at({ state: "running" }), at({ state: "review" }), at({ stopMode: "pause", stopState: "paused" })]` → new:

```tsx
  // Rewritten for the start guard spec (2026-10-15; its §5 names this criterion): this now encodes the server's predicate --
  // a running, reviewing or paused group offers the change for an unstarted task; done, blocked and a handoff or shutdown
  // stop show the plan frozen.
  it("offers a change while the group runs or is paused, and none where the server refuses (group-state-invalid)", () => {
    const at = (summary: Partial<GroupViewV1["summary"]>): GroupViewV1 => { const base = view([item()]); return { ...base, summary: { ...base.summary, ...summary } }; };
    for (const shown of [at({ state: "done" }), at({ state: "blocked" }), at({ stopMode: "handoff", stopState: "handoff-complete" }), at({ stopMode: "shutdown", stopState: "handoff-pending" })]) {
      render(<Stateful view={shown} onCommand={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
      expect(screen.getByText("The group is not open for changes; the plan is frozen")).toBeTruthy();
      cleanup();
    }
    for (const shown of [at({ state: "draft" }), at({ state: "running" }), at({ state: "review" }), at({ stopMode: "pause", stopState: "paused" })]) {
      render(<Stateful view={shown} onCommand={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
      cleanup();
    }
  });
```
(re-read lines 148-157 first; if the old `at` helper differs, keep the old helper line verbatim.)

(d) Named rewrite, `web/tests/budgetI18n.test.tsx:150` — old `    expect(card({ view: { ...view, summary: { ...view.summary, state: "running" } } }).container.textContent).toContain("组当前不接受修改，做法已冻结");` → new:

```tsx
    // Rewritten for the start guard spec (2026-10-15; §5): a running group now takes the change, so the frozen text is shown for a done one.
    expect(card({ view: { ...view, summary: { ...view.summary, state: "done" } } }).container.textContent).toContain("组当前不接受修改，做法已冻结");
```

- [ ] **Step 2: Run red** — root `tests/control/setTaskLoopRunning.test.ts tests/control/setTaskLoop.test.ts`, web `tests/loopPlanEdit.test.tsx tests/budgetI18n.test.tsx` to `b3-red*.log`. Expected red: C7 review (`group-state-invalid`), "C7: a paused group…", "accepts a change … running/review", the web rewrite (no button for running). Green at RED: "C7: a handoff-stopped group does not", C8 (both pin unchanged refusals), "refuses … done/blocked", the budgetI18n rewrite.

- [ ] **Step 3: Implement**
  - `webService.ts` line 26: add `readStopIntent` to the `./stopIntent.js` import. Replace lines 956-959 (the two "Step 1" comment lines, `assertKnownConservation(...)` and the `if (... || group.stopped) throw …`) with:
    ```ts
              // Step 1. assertKnownConservation first (recovery-blocked before any state refusal, ruling P3). Start guard spec
              // (2026-10-15) §3.3: a running, reviewing or paused group takes a change to a task that has not started; a handoff
              // or shutdown stop, a stopped flag with no intent, done and blocked do not.
              assertKnownConservation(this.store, group, proposal);
              const stopIntent = readStopIntent(this.store, id);
              const editable = ["draft", "ready", "running", "review"].includes(group.status)
                && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause");
              if (!editable) throw new ControlError("group-state-invalid");
    ```
  - `LoopPlanCard.tsx` lines 181-183 (the two comment lines and `const open = …`):
    ```tsx
      // Start guard spec (2026-10-15) §3.3: the server's predicate -- a running, reviewing or paused group takes a change to an
      // unstarted task; done, blocked and a handoff or shutdown stop refuse it (group-state-invalid).
      const open = ["draft", "ready", "running", "review"].includes(view.summary.state) && (view.summary.stopMode === null || view.summary.stopMode === "pause");
    ```

- [ ] **Step 4: Run green** — root `tests/control/setTaskLoopRunning.test.ts tests/control/setTaskLoop*.test.ts tests/control/retryTask.test.ts`; web `tests/loopPlanEdit.test.tsx tests/budgetI18n.test.tsx tests/loopPlanCard.test.tsx tests/loopPlanDraft.test.tsx`; root `tests/panel/scanPanelText.test.ts`; typecheck and web tsc. All logs read whole.

- [ ] **Step 5: Commit** — `src/control/webService.ts web/src/LoopPlanCard.tsx tests/control/setTaskLoop.test.ts tests/control/setTaskLoopRunning.test.ts web/tests/loopPlanEdit.test.tsx web/tests/budgetI18n.test.tsx`; message `feat(control): let unstarted tasks' loop plans change while the group runs or is paused`.

- [ ] **Step 6 (reviewer, clone `b3`): mutations** (file `src/control/webService.ts`, test `tests/control/setTaskLoopRunning.test.ts` unless named)
  - `B3a` drop the pause clause: `{"from": " || stopIntent?.mode === \"pause\");", "to": ");"}` — red: "C7: a paused group takes…".
  - `B3b` ignore the stop intent: `{"from": "\n            && ((!group.stopped && stopIntent === null) || stopIntent?.mode === \"pause\");", "to": ";"}` — red: "C7: a handoff-stopped group does not"; second run `B3b2` on `tests/control/setTaskLoop.test.ts` — red: "refuses a stopped group…" (`:33`).
  - `B3c` status back to draft/ready: `{"from": "[\"draft\", \"ready\", \"running\", \"review\"].includes(group.status)", "to": "[\"draft\", \"ready\"].includes(group.status)"}` — red: C7 review; `B3c2` on `tests/control/setTaskLoop.test.ts` — red: the running/review rows.
  - `B3d` drop the per-task runs-row check (criterion 8): `{"from": "\n            || this.store.db.prepare(\"SELECT id FROM runs WHERE group_id=? AND work_item_id=?\").get(id, taskId)) throw new ControlError(\"task-already-started\");", "to": ") throw new ControlError(\"task-already-started\");"}` — red: C8 (the change of `b` accepted).
  - `B3e` web status: `web/src/LoopPlanCard.tsx` `{"from": "[\"draft\", \"ready\", \"running\", \"review\"].includes(view.summary.state)", "to": "[\"draft\", \"ready\"].includes(view.summary.state)"}`, dir `web`, test `tests/loopPlanEdit.test.tsx` — red: the rewritten test (running/review). `B3f` web pause: `{"from": "(view.summary.stopMode === null || view.summary.stopMode === \"pause\")", "to": "view.summary.stopMode === null"}` — red: the rewritten test (paused).

---

### Task S1: Feedback #61 — the Runs table's attempt names its scope; the task's run number beside it

**Files:**
- Modify: `web/src/runFacts.ts` (after `lineageRunNumber`, line 101)
- Modify: `web/src/ControlGroupView.tsx:22` (import), `:431` (map signature), `:440`
- Modify: `web/src/locales/en.ts:392`, `web/src/locales/zh.ts:291` (+ new key `taskRun` beside each)
- Modify (human-named rewrites): `web/tests/controlI18n.test.tsx:76`, `:144`
- Test (create): `web/tests/runAttemptLabel.test.tsx`

**Interfaces:** Consumes `lineageRunNumber(lineageRunIds, runs)` (`runFacts.ts:98-101`, the source `taskRunNumber` uses — not recomputed differently) and `runsInCreationOrder` (`ControlGroupView.tsx:42`). Produces `export function runNumberOf(view: GroupViewV1, run: RunViewV1, createdUpTo: readonly RunViewV1[]): number` (0 when the run is not one its task counts). Keys: `control.group.attempt` en `" · attempt {{attempt}} in this run (claim {{claim}})"`, zh `" · 本次运行内第 {{attempt}} 次尝试（认领序号 {{claim}}）"`; `control.group.taskRun` en `" · run {{n}} of this task"`, zh `" · 这个任务的第 {{n}} 次运行"`. The field shown is unchanged: `providerAttemptOrdinal` (per run, `webDispatch.ts:409/442/544`).

- [ ] **Step 1: Write the failing test** — create `web/tests/runAttemptLabel.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Feedback #61 (human ruling 2026-10-15): the Runs table's attempt counter is providerAttemptOrdinal, counted within one run
 * ("never mixed with Orca's grant"), and read as the task's attempt. The label now says it is within this run, and the
 * task's run number (taskRunNumber's own source) stands beside it. Texts are literals, so an English zh entry turns this red.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const twoRuns = () => view([workItem({ taskId: "a", status: "active", currentRunId: "run-2", lineageRunIds: ["run-1", "run-2"] })], [
  run({ runId: "run-1", state: "blocked", blockedReason: "why", claimOrdinal: 1, providerAttemptOrdinal: 3, createdOrdinal: 1 }),
  run({ runId: "run-2", state: "running", claimOrdinal: 2, providerAttemptOrdinal: 1, createdOrdinal: 2 }),
]);
const stateCells = (container: HTMLElement): string[] => [...container.querySelectorAll("tr[data-run-id] td.run-state")].map((cell) => cell.textContent ?? "");
const shown = () => stateCells(render(<ControlGroupView view={twoRuns()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container);

describe("the Runs table's attempt and run number (feedback #61)", () => {
  it("names the attempt within its run and the task's run number, in English", () => {
    const [first, second] = shown();
    expect(first).toContain(" · attempt 3 in this run (claim 1) · run 1 of this task");
    expect(second).toContain(" · attempt 1 in this run (claim 2) · run 2 of this task");
  });

  it("in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const [first, second] = shown();
    expect(first).toContain(" · 本次运行内第 3 次尝试（认领序号 1） · 这个任务的第 1 次运行");
    expect(second).toContain(" · 本次运行内第 1 次尝试（认领序号 2） · 这个任务的第 2 次运行");
  });
});
```

Human-named rewrites in `web/tests/controlI18n.test.tsx` (each preceded by the comment `// Rewritten for feedback #61 (human-named 2026-10-15): this now encodes that the Runs table names providerAttemptOrdinal as the attempt within this run, with the task's run number beside it.` — for `:76` put the comment on the line above the `for (const expected of [` array):
- `:76` old array item `"第 2 次尝试（认领序号 不适用）"` → `"本次运行内第 2 次尝试（认领序号 不适用） · 这个任务的第 1 次运行"`.
- `:144` old `expect(firstRow(container, "运行|阶段|状态|配置|已用|剩余|证据").slice(0, 3)).toEqual(["a", "工作", "运行中 · 第 2 次尝试（认领序号 不适用）"]);` → `expect(firstRow(container, "运行|阶段|状态|配置|已用|剩余|证据").slice(0, 3)).toEqual(["a", "工作", "运行中 · 本次运行内第 2 次尝试（认领序号 不适用） · 这个任务的第 1 次运行"]);`.

- [ ] **Step 2: Run red** — web `tests/runAttemptLabel.test.tsx tests/controlI18n.test.tsx` to `s1-red.log`. Expected red: both new tests and the two rewritten criteria (old text received).

- [ ] **Step 3: Implement**
  - `runFacts.ts`, after `lineageRunNumber`:
    ```ts
    /** Feedback #61: this run's number among its task's runs -- lineageRunNumber over the runs created up to and including it; 0 when it is not counted. */
    export function runNumberOf(view: GroupViewV1, run: RunViewV1, createdUpTo: readonly RunViewV1[]): number {
      if (run.taskId === null) return 0;
      const lineage = view.workItems.find((item) => item.taskId === run.taskId)?.lineageRunIds ?? [];
      return lineageRunNumber(lineage, [run]) === 1 ? lineageRunNumber(lineage, createdUpTo) : 0;
    }
    ```
  - `ControlGroupView.tsx`: line 22 import adds `runNumberOf`; line 431 `{runsInCreationOrder(view.runs).map((run, index, orderedRuns) => (`; line 440 becomes
    `<div>{t("control.group.attempt", { attempt: run.providerAttemptOrdinal, claim: run.claimOrdinal ?? t("common.na") })}{runNumberOf(view, run, orderedRuns.slice(0, index + 1)) > 0 ? t("control.group.taskRun", { n: runNumberOf(view, run, orderedRuns.slice(0, index + 1)) }) : ""}</div>`.
  - `en.ts:392` `      attempt: " · attempt {{attempt}} in this run (claim {{claim}})",` and a new line `      taskRun: " · run {{n}} of this task",`; `zh.ts:291` `      attempt: " · 本次运行内第 {{attempt}} 次尝试（认领序号 {{claim}}）",` and `      taskRun: " · 这个任务的第 {{n}} 次运行",`.

- [ ] **Step 4: Run green** — web `tests/runAttemptLabel.test.tsx tests/controlI18n.test.tsx tests/runsTableOrder.test.tsx tests/i18nKeys.test.ts tests/i18nWidth.test.ts tests/i18nPseudo.test.tsx tests/runFacts.test.ts`; root `tests/panel/scanPanelText.test.ts tests/metrics`; web tsc.

- [ ] **Step 5: Commit** — `web/src/runFacts.ts web/src/ControlGroupView.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/runAttemptLabel.test.tsx web/tests/controlI18n.test.tsx`; message `fix(web): name the Runs table's attempt as within its run and show the task's run number (#61)`.

- [ ] **Step 6 (reviewer, clone `s1`): mutations** (dir `web`, test `tests/runAttemptLabel.test.tsx` unless named)
  - `S1a` old en label: `web/src/locales/en.ts` `{"from": "attempt: \" · attempt {{attempt}} in this run (claim {{claim}})\",", "to": "attempt: \" · attempt {{attempt}} of claim {{claim}}\","}` — red: the English test only.
  - `S1b` English back in zh: `web/src/locales/zh.ts` `{"from": "attempt: \" · 本次运行内第 {{attempt}} 次尝试（认领序号 {{claim}}）\",", "to": "attempt: \" · attempt {{attempt}} in this run (claim {{claim}})\","}` — red: the Chinese test; `S1b2` on `tests/controlI18n.test.tsx` — red: the two rewritten criteria.
  - `S1c` drop the run number: `web/src/ControlGroupView.tsx` `{"from": "{runNumberOf(view, run, orderedRuns.slice(0, index + 1)) > 0 ? t(\"control.group.taskRun\", { n: runNumberOf(view, run, orderedRuns.slice(0, index + 1)) }) : \"\"}", "to": ""}` — red: both tests.
  - `S1d` the task's latest number on every row: `web/src/runFacts.ts` `{"from": "lineageRunNumber(lineage, createdUpTo) : 0;", "to": "lineageRunNumber(lineage, view.runs) : 0;"}` — red: the first row (`run 2 of this task` on run-1).

---

### Task S2: `codex-rate-limited` held to both languages as a view-shown reason

**Files:** Modify `tests/panel/refusalCoverage.test.ts:51-54` (the "Issue fixes spec §4.2(1): ccloop's stop reasons" group of `VIEW_REASONS`).

**Interfaces:** none (the entries exist: `web/src/locales/en.ts:1325`, `zh.ts` the same key).

- [ ] **Step 1: Edit** — after `"codex-skills-source-invalid", "codex-exit-error",` add `  // Feedback #62: Codex answered HTTP 429 and ccloop's backoff ran out (ccloop 3069dbf codexAdapter.ts).\n  "codex-rate-limited",`.
- [ ] **Step 2: Run** — `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > /private/tmp/oec/logs/s2-green.log 2>&1`: green (both entries exist — this criterion is green from the start by construction; its value is the mutation below).
- [ ] **Step 3: Commit** — `tests/panel/refusalCoverage.test.ts`; message `test(panel): hold codex-rate-limited to both languages as a view-shown reason`.
- [ ] **Step 4 (reviewer, clone `s2`): mutation** `S2a` delete the en entry: `web/src/locales/en.ts` `{"from": "  \"codex-rate-limited\": \"The provider rate-limited the Codex call (HTTP 429). Retry the task later, once the provider quota window has passed; a call refused before any work booked no usage.\",\n", "to": ""}`, dir `root`, test `tests/panel/refusalCoverage.test.ts` — red: "has a en entry for every …" (`["codex-rate-limited"]`) and "keeps the two tables over the same codes". As a contrast, run the same mutation on a clone of the commit **before** S2 (`/usr/bin/git clone -q --local --branch feat/error-codes-start-guard …` then read `git log`; build the clone at `HEAD~1` with `git clone --local` + `git -C <clone> switch --detach HEAD~1` — if Tier 0 refuses `switch`, record that and skip the contrast): only "keeps the two tables…" is red there.

---

### Task S3 (ccloop): Retitle the context-window criterion (correction K8)

ccloop's own rules apply (its `CLAUDE.md` Rules 13-17): the human named this criterion (2026-10-15); title only, assertions unchanged; Rule 15(c) wants the ruling written beside it, and Rule 16 keeps the published comment at `:79` verbatim, so a comment line is **appended** after it.

**Files:** ccloop `tests/agents/registry.test.ts:79-80`.

- [ ] **Step 1: Worktree** (worktree creation is allowed; deleting it later is the human's)

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop status --porcelain > /private/tmp/oec/logs/s3-ccloop-status.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop worktree add -b test/registry-title-omp /Users/biran/code/skills/orca/ccloop-wt/registry-title main > /private/tmp/oec/logs/s3-wt.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/s3-wt.log
ln -s /Users/biran/code/skills/orca/ccloop/node_modules /Users/biran/code/skills/orca/ccloop-wt/registry-title/node_modules
```
Read both logs (ccloop main = `dc51022…`, record the full sha). ccloop's `.gitignore` `node_modules/` does not match a symlink: `git status` shows `?? node_modules`; never `git add -A` there.

- [ ] **Step 2: Baseline** — `cd …/ccloop-wt/registry-title && ./node_modules/.bin/vitest run tests/agents/registry.test.ts --reporter=json --outputFile=/private/tmp/oec/logs/s3-before.json > /private/tmp/oec/logs/s3-before.log 2>&1`; read; note the pass count and every `fullName`.

- [ ] **Step 3: Edit** — keep line 79 (`// Spec §12 I6: a requested window is not an observation; only claude's verified 1M mapping is reported.`) verbatim; after it insert `  // Human ruling (2026-10-15, Orca session 026d10e3): title renamed only -- omp reports its catalog row's contextWindow (src/agents/omp.ts capabilities), which this criterion does not assert; its assertions are unchanged.`; line 80's title becomes `"reports claude's contextWindowTokens only for its verified 1M mapping and codex's as null (omp reads its own from its catalog row)"`.

- [ ] **Step 4: Verify** — the same run to `s3-after.json`/`s3-after.log`; `npm run typecheck > /private/tmp/oec/logs/s3-tc.log 2>&1`; `/usr/bin/git -C …/ccloop-wt/registry-title diff --stat > /private/tmp/oec/logs/s3-diffstat.log 2>&1` and `diff > s3-diff.log`. Read all: same pass count, the old title absent and the new present in `fullName`s, typecheck `rc=0`, the diff touches only `tests/agents/registry.test.ts` (1 insertion for the comment, 1 changed line). No mutation applies: no assertion or code changed (the criterion's existing mutation coverage is unaffected).

- [ ] **Step 5: Commit (ccloop)** — `/usr/bin/git -C …/ccloop-wt/registry-title add tests/agents/registry.test.ts`; message `test(agents): retitle the context-window criterion now that omp reports its catalog window` + trailer. Pushing, merging and the repin are the human's (`awaitingHuman`); Orca's pin does not need to move for a test-title change.

---

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

## Self-Review (done while writing)

**Spec coverage**
- Spec A §1-§3 (why, rulings, non-goals): A2-A8 keep `control-peer-timeout`/`control-response-too-large` and the CLI unchanged (A2 test row 3); no ccloop change except S3's test title; no migration of stored reasons (A7 renders old uncut reasons: "a run reason" row 1 form is the old shape too).
- A §4.1 → A1 (+ K1). §4.2 → A2 (+ K2; web definite-refusal pin `web/tests/ccloopFailed.test.ts`; `ControlHttpStatus`; catalog). §4.3 → A3 (classification stays on `error.code`, criterion 3 = F2 + mutation A3c; criterion 4 = F1-F4 + A3a/b/d/e/f/g/h). §4.4 → A4 (criterion 5). §4.5 → A5 (criterion 6; K3, K4). §4.6, §4.7 → A7 (criterion 8; `CCLOOP_CODES`). §4.8 → A6 (criterion 7; K5). §4.9 → A8 (two criteria; six sites registered uncovered). §5 rewrites → A2, A5 (`:27` not rewritten, K3); "stale but green" → kept (Interpretations). §6 test running → each task's targeted runs; Task G.
- Spec B §3.1 → B1 (Overview analysed, not changed; `continuation` dropped from the view). §3.2 → B2 (criteria 1-6; precedence via C3 rows and B2h; ledgered pre-probe refusal; in-transaction check; SKILL.md; locale). §3.3 → B3 (criteria 7-8; K6). §5 rewrites → B3 (`setTaskLoop.test.ts:24`, `loopPlanEdit.test.tsx:148-157`, `budgetI18n.test.tsx:150`; `:33` kept, K6); `webDispatch.test.ts:277-327` unchanged and re-run in B1/B2. K7 → B2 Steps 0, 5, 6.
- Small items → S1 (#61; two human-named rewrites), S2, S3 (K8).

**Type and name consistency**
- `peerFailure`, `PeerFailure`, `peerCode`, `peerExitText`, `ccloopFailedMessage`, `peerFailureLogLine`, `PEER_DETAIL_MAX` (A1) → A2 (`peerFailure`, `ccloopFailedMessage`), A3 (`peerCode`), A4 (`peerFailure`, `peerExitText`), A8 (`peerFailureLogLine`).
- `probeFailureCode: string | null` (A3) → A6's log reason, `stopIntent.ts:654` log (A8).
- `normalizeSingleCallErrorCode` (A5, `executionDriver.ts`), `PRE_SPAWN_REFUSALS` (A5, `requirementCalls.ts` — not in `executionDriver.ts`, which imports `singleCallPurposes.ts` → `requirementCalls.ts`; the reverse import would be a cycle with a top-level `Set`).
- Handler `failure?: string | null` (A5) is optional so `driverRequirementSplit.test.ts:88,97`'s three-argument `evaluate!` calls still compile.
- `completeEstimateInStore(…, classify, callFailure)` (A5) ← `ESTIMATE.complete` only; `WebControlService.completeEstimate` passes none (K3).
- `applyRecoveryRetry(deps, command, outputBound = null)` (A6) — its other callers (none outside `webService.ts:580` today; check with a redirected grep) keep the frozen bound.
- `groupExecutionPending(store, groupId, taskIds, snapshot)` / `groupExecutionPendingInStore(store, groupId)` (B1) → `controlViews.ts` (view), `webDispatch.ts` (B2), Option A of B2 Step 6.
- `explainCcloopCode`, `codeAndDetail`, `peerExitReason`, `explainEstimateReason` (A7) → `refusalExplain.ts`, the five components; `enCcloopErrors`/`zhCcloopErrors` → `ccloopCodes.ts`, `refusalCoverage.test.ts`.
- `runNumberOf` (S1) uses `lineageRunNumber` (the same source as `taskRunNumber`).
- Locale keys added in both languages: `ccloop.generic`, `ccloop.genericNoDetail`, `control.group.taskRun`; error entries `ccloop-failed` (A2), `control-peer-exit` (A7), `group-execution-pending` (B2) — `i18nKeys.test.ts` and `refusalCoverage.test.ts` hold both tables equal.

**Placeholder scan:** none. Where an anchor could have moved (`agentSelectionEditor`/`agentSettings` locals, `enErrors["agent-unselected"]` text, `loopPlanEdit.test.tsx`'s `at` helper, the run variable at `stopIntent.ts:654`, `ExecutionProfileRouter` in `webService.ts`), the step says to re-read it with a redirected command and use what is there.
