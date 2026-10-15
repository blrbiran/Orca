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

const uncounted = () => view([workItem({ taskId: "b", status: "active", currentRunId: "rb-2", lineageRunIds: ["rb-1", "rb-2"] })], [
  run({ runId: "rb-1", taskId: "b", state: "failed-before-provider", claimOrdinal: 1, providerAttemptOrdinal: 2, createdOrdinal: 1 }),
  run({ runId: "est-run", taskId: null, estimateId: "est-1", phase: "estimate", claimOrdinal: 2, providerAttemptOrdinal: 4, createdOrdinal: 2 }),
  run({ runId: "rb-2", taskId: "b", state: "running", claimOrdinal: 3, providerAttemptOrdinal: 1, createdOrdinal: 3 }),
]);
const shownUncounted = () => stateCells(render(<ControlGroupView view={uncounted()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container);

describe("a run its task does not count shows no task run number (feedback #61)", () => {
  it("in English: a failed-before-provider run and an estimate run keep the attempt label only; the counted run is run 1", () => {
    const [failed, estimate, counted] = shownUncounted();
    expect(failed).toContain(" · attempt 2 in this run (claim 1)");
    expect(failed).not.toContain("of this task");
    expect(estimate).toContain(" · attempt 4 in this run (claim 2)");
    expect(estimate).not.toContain("of this task");
    expect(counted).toContain(" · attempt 1 in this run (claim 3) · run 1 of this task");
  });

  it("in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const [failed, estimate, counted] = shownUncounted();
    expect(failed).toContain(" · 本次运行内第 2 次尝试（认领序号 1）");
    expect(failed).not.toContain("这个任务的第");
    expect(estimate).toContain(" · 本次运行内第 4 次尝试（认领序号 2）");
    expect(estimate).not.toContain("这个任务的第");
    expect(counted).toContain(" · 本次运行内第 1 次尝试（认领序号 3） · 这个任务的第 1 次运行");
  });
});
