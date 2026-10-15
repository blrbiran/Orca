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

