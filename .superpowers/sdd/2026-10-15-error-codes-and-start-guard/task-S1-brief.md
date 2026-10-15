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

