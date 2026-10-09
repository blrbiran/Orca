### Task D8: Web — Retry task button, explained reasons, run number

**Files:**
- Create: `web/src/RunReason.tsx`
- Modify: `web/src/ControlGroupView.tsx` (runs table, lines 196–215)
- Modify: `web/src/TaskDetail.tsx` (imports lines 11–18; runs list lines 178–187)
- Modify: `web/src/controlApi.ts` (imports line 14–40; `ControlAction` after `recovery-retry`, line 251;
  `controlCommandPath` after `case "recovery-retry"`, line 296–297)
- Modify: `web/src/locales/en.ts` (`control.group` after `retryRun`, line 243; `control.task` after `runsOf`, line 278;
  `enErrors`), `web/src/locales/zh.ts` (`control.group` after `retryRun`, line 150; `control.task` after `runsOf`,
  line 185; `zhErrors`)
- Test: `web/tests/driverRetry.test.tsx` (add `it`s), `web/tests/failureReasons.test.ts` (create)

**Interfaces:**
- Consumes: Part A `explainRunReason`; D6 `isTerminalFailure`, `reasonCode`, `runReasonText`, `taskRunNumber`.
- Produces: `ControlAction` member `{ verb: "retry-task"; groupId: string; expectedRevision: number; payload: RetryTaskPayloadV1 }`,
  path `groups/<groupId>/retry-task`; `RunReason` component; i18n keys `control.group.retryTask`, `control.task.runNumber`;
  errors-table entries for the ccloop reasons of spec §4.2(1): `codex-result-invalid`, `codex-events-invalid`,
  `codex-no-completion`, `codex-usage-invalid`, `codex-usage-unavailable`, `codex-event-error`, `codex-timeout`,
  `codex-skills-cleanup-failed`, `codex-skills-path-conflict`, `codex-skills-pending`, `codex-skills-setup-failed`,
  `codex-skills-source-invalid`, and `terminal` (the exhaustion/cancellation outcomes, `terminal:<outcome>`).

- [ ] **Step 1: Write the failing test.** Append to `web/tests/driverRetry.test.tsx` (add `TaskDetail` and
  `controlCommandPath` imports: `import { TaskDetail } from "../src/TaskDetail.js";`,
  `import { controlCommandPath } from "../src/controlApi.js";`, and `WorkItemViewV1` to the `controlTypes` type import):

```tsx
// Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task; a settled-failed run explains itself and offers nothing.
const FAILED = { state: "blocked" as const, blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /runs/r/attempt-1" };
describe("retrying a task whose run ccloop ended failed (issue fixes spec §4.2(5))", () => {
  it("offers Retry task, not Retry run, and explains ccloop's reason beside the raw reason", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([run(FAILED)])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryAllByRole("button", { name: /^Retry run/ })).toHaveLength(0);
    expect(screen.getByText(/did not answer in the required JSON format/)).toBeTruthy();
    expect(screen.getByText("Error: codex-result-invalid: /runs/r/attempt-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
    expect(controlCommandPath({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } })).toBe("/api/control/groups/g/retry-task");
  });

  it("keeps Retry run for a blocked run whose ccloop run succeeded (out of bounds)", () => {
    render(<ControlGroupView view={view([run({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Retry run/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^Retry task/ })).toHaveLength(0);
  });

  it("explains a settled-failed run's reason and offers no button", () => {
    render(<ControlGroupView view={view([run({ ...FAILED, state: "settled-failed", stopReason: "Error: codex-event-error" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText(/reported an error/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Retry (run|task)/ })).toHaveLength(0);
  });

  it("shows the task's run number and Retry task in the task detail", () => {
    const onCommand = vi.fn();
    const item: WorkItemViewV1 = { taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
      derivedContractHash: "f".repeat(64), currentRunId: "run-2", pendingRunId: null, lineageRunIds: ["run-1", "run-2"] };
    const runs = [run({ runId: "run-1", state: "settled-failed", outcome: "failed", blockedReason: "terminal:failed" }), run({ runId: "run-2", ...FAILED })];
    render(<TaskDetail view={{ ...view(runs), workItems: [item] }} item={item} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByText("Run 2 of this task")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
  });
});
```

  Create `web/tests/failureReasons.test.ts`:

```ts
/**
 * Issue fixes spec §4.2(1), §2.2(a): every ccloop failure reason the run views show has text in both languages, and a
 * reason as ccloop sends it (behind `Error: `) reaches that text.
 */
import { describe, expect, it } from "vitest";
import { enErrors } from "../src/locales/en.js";
import { zhErrors } from "../src/locales/zh.js";
import { explainRunReason } from "../src/refusalExplain.js";
import { reasonCode } from "../src/runFacts.js";

const REASONS = [
  "codex-result-invalid", "codex-events-invalid", "codex-no-completion", "codex-usage-invalid", "codex-usage-unavailable", "codex-event-error",
  "codex-timeout", "codex-skills-cleanup-failed", "codex-skills-path-conflict", "codex-skills-pending", "codex-skills-setup-failed",
  "codex-skills-source-invalid", "terminal",
];

describe("ccloop failure reasons (spec §4.2(1))", () => {
  it("has an English and a Chinese entry for every reason", () => {
    expect(REASONS.filter((code) => !Object.hasOwn(enErrors, code) || !Object.hasOwn(zhErrors, code))).toEqual([]);
  });

  it("explains a reason as ccloop sends it, through its Error: prefix, and an outcome through its detail", () => {
    expect(explainRunReason(reasonCode("Error: codex-result-invalid: /runs/r/attempt-1"))).toBe(enErrors["codex-result-invalid"]);
    expect(explainRunReason(reasonCode("terminal:exhausted"))).toContain("exhausted");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `cd $W/web && ../node_modules/.bin/vitest run tests/driverRetry.test.tsx tests/failureReasons.test.ts > $S/d8.txt 2>&1; echo rc=$?`
  → rc=1: the four new `driverRetry` `it`s fail (no "Retry task" button, no explanation, no run number;
  `controlCommandPath` returns `undefined` for `retry-task`), and both `failureReasons` `it`s fail (the entries are missing).
- [ ] **Step 3: Implement.** Create `web/src/RunReason.tsx`:

```tsx
/**
 * Issue fixes spec §4.2(5), §2.2(a): a run's reason, explained in the reader's language, with the raw reason beside it
 * (monospace) -- ccloop's own for a failed run, else the driver's blocked reason. Nothing for a run with neither.
 */
import type { JSX } from "react";
import type { RunViewV1 } from "./controlTypes.js";
import { explainRunReason } from "./refusalExplain.js";
import { reasonCode, runReasonText } from "./runFacts.js";

export function RunReason(props: { run: RunViewV1 }): JSX.Element | null {
  const raw = runReasonText(props.run);
  if (raw === null) return null;
  const text = explainRunReason(reasonCode(raw));
  return <> — {text ?? raw}{text !== null && <> <code>{raw}</code></>}</>;
}
```

  `web/src/controlApi.ts`: add `RetryTaskPayloadV1,` to the type import list (after `RecoveryRetryPayloadV1,`); in
  `ControlAction` after the `recovery-retry` member add
  `| { verb: "retry-task"; groupId: string; expectedRevision: number; payload: RetryTaskPayloadV1 }`; in
  `controlCommandPath` after `case "recovery-retry": return "/api/control/recovery/retry";` add
  `case "retry-task":` / `return \`${group}/retry-task\`;`.

  `web/src/ControlGroupView.tsx`: add imports `import { RunReason } from "./RunReason.js";` and
  `import { isTerminalFailure } from "./runFacts.js";`. In the runs table cell replace

```tsx
                {run.blockedReason ? ` — ${run.blockedReason}` : ""}
```

  with `<RunReason run={run} />`, and replace the block

```tsx
                {run.state === "blocked" && run.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
                  >
                    {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
                  </button>
                ) : null}
```

  with

```tsx
                {/* Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task (a new run); any other blocked
                    run keeps the run-scope recovery-retry, which refuses a terminal failure (run-terminal-failed). */}
                {isTerminalFailure(run) && run.taskId !== null ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: revision, payload: { taskId: String(run.taskId) } })}
                  >
                    {t("control.group.retryTask", { taskId: String(run.taskId) })}
                  </button>
                ) : run.state === "blocked" && run.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
                  >
                    {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
                  </button>
                ) : null}
```

  `web/src/TaskDetail.tsx`: add imports `import { RunReason } from "./RunReason.js";` and
  `import { isTerminalFailure, taskRunNumber } from "./runFacts.js";`; after `const runs = view.runs.filter((run) => run.taskId === item.taskId);`
  add `const runNumber = taskRunNumber(view, item.taskId);`; replace the runs block

```tsx
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)} <EvidenceList runId={run.runId} />
            </li>
          ))}
        </ul>
      )}
```

  with

```tsx
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {/* Issue fixes spec §4.2(2): the run number counts the runs that reached the provider. */}
      {runNumber > 0 && <p>{t("control.task.runNumber", { n: runNumber })}</p>}
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)}<RunReason run={run} /> <EvidenceList runId={run.runId} />
              {isTerminalFailure(run) && (
                <button type="button" onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: view.summary.commandRevision, payload: { taskId: item.taskId } })}>
                  {t("control.group.retryTask", { taskId: item.taskId })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
```

  Locales. `en.ts` `control.group`, after `retryRun: "Retry run {{id}}",`: `retryTask: "Retry task {{taskId}}",`;
  `control.task`, after `runsOf: "Runs of {{taskId}}",`: `runNumber: "Run {{n}} of this task",`.
  `zh.ts` `control.group`, after `retryRun: "重试运行 {{id}}",`: `retryTask: "重试任务 {{taskId}}",`; `control.task`,
  after `runsOf: "{{taskId}} 的运行",`: `runNumber: "这个任务的第 {{n}} 次运行",`.

  `enErrors` (keep key order; if Part A already added `terminal`, keep Part A's text and add only the others — check with
  `grep -n '"terminal"' web/src/locales/en.ts web/src/locales/zh.ts > $S/terminal.txt; echo rc=$?` and read the file):

```ts
  // Issue fixes spec §4.2(1): ccloop's failure reasons, matched by their prefix up to the first ':' (the rest is evidence).
  "codex-event-error": "The model reported an error, for example a quota or service failure.",
  "codex-events-invalid": "The model's event stream could not be read.",
  "codex-no-completion": "The model stopped without finishing its turn.",
  "codex-result-invalid": "The model did not answer in the required JSON format.",
  "codex-skills-cleanup-failed": "The skills given to the model could not be removed afterwards.",
  "codex-skills-path-conflict": "A skill's path collides with a file already in the workspace.",
  "codex-skills-pending": "Skills from an earlier attempt were still in the workspace.",
  "codex-skills-setup-failed": "The model's skills could not be put in place.",
  "codex-skills-source-invalid": "A skill's source is not valid.",
  "codex-timeout": "The model did not finish within its time limit.",
  "codex-usage-invalid": "The model reported its token usage in a form that could not be read.",
  "codex-usage-unavailable": "The model did not report its token usage.",
  "terminal": "The ccloop run ended {{detail}} instead of succeeding. Retry task starts a new run.",
```

  `zhErrors`:

```ts
  // Issue fixes spec §4.2(1): ccloop's failure reasons, matched by their prefix up to the first ':' (the rest is evidence).
  "codex-event-error": "模型报告了错误，例如额度用尽或服务故障。",
  "codex-events-invalid": "读不懂模型的事件流。",
  "codex-no-completion": "模型没有完成这一轮就停了。",
  "codex-result-invalid": "模型没有按要求的 JSON 格式作答。",
  "codex-skills-cleanup-failed": "给模型的 skills 事后没能移除。",
  "codex-skills-path-conflict": "某个 skill 的路径和工作区里已有的文件冲突。",
  "codex-skills-pending": "工作区里还留着上一次尝试的 skills。",
  "codex-skills-setup-failed": "没能为模型放好 skills。",
  "codex-skills-source-invalid": "某个 skill 的来源不合法。",
  "codex-timeout": "模型没有在时限内完成。",
  "codex-usage-invalid": "模型报告的 token 用量格式无法读取。",
  "codex-usage-unavailable": "模型没有报告 token 用量。",
  "terminal": "ccloop 运行以 {{detail}} 结束，没有成功。「重试任务」会开一次新的运行。",
```

  (Comments stay English in `zh.ts` too; Chinese is only in the string values.)
- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0. Web typecheck rc=0 (`controlCommandPath` covers the new
  member). `cd $W/web && ../node_modules/.bin/vitest run > $S/d8b.txt 2>&1; echo rc=$?` rc=0 (the whole web suite: i18n key
  parity, pseudo-locale and width criteria see the new keys). `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/d8c.txt 2>&1; echo rc=$?` rc=0.
- [ ] **Step 5: Mutation** (web: `npm run build --workspace web` in the clone first). (a) In `ControlGroupView`, swap the
  two branches' order so `run.state === "blocked" && run.blockedReason` is tested first → "offers Retry task, not Retry
  run" red (a Retry run button appears). (b) Delete the `isTerminalFailure(run) && run.taskId !== null ? (…) :` branch →
  same `it` red at the "Retry task a" click. (c) Replace `<RunReason run={run} />` with the old blocked-reason text → same
  `it` red at the explanation and "explains a settled-failed run's reason" red. (d) Delete the TaskDetail button →
  "shows the task's run number and Retry task" red at the click; delete the `runNumber` paragraph → same `it` red at
  "Run 2 of this task". (e) Delete `zhErrors["codex-result-invalid"]` → `failureReasons.test.ts` first `it` red.
  (f) Make `reasonCode` the identity in the clone → `failureReasons.test.ts` second `it` red (if it stays green, Part A's
  `explainRunReason` strips `Error: ` itself; record that, and the D6 criterion still pins `reasonCode`).
- [ ] **Step 6: Commit.** `git -C $W add web/src/RunReason.tsx web/src/ControlGroupView.tsx web/src/TaskDetail.tsx web/src/controlApi.ts web/src/locales/en.ts web/src/locales/zh.ts web/tests/driverRetry.test.tsx web/tests/failureReasons.test.ts`;
  message `feat(web): offer Retry task for a run ccloop ended failed, explain its reason, and show the run number`.

---

