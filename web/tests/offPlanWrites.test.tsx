// @vitest-environment jsdom
/**
 * Off-plan writes spec W3 (#346, plan Task 4): the task view's run line names a landed run's off-plan writes. And (routed
 * into Task 4 from Task 1's review) a loop plan of version 4 has no allowlist, so its card no longer says "Only changes"
 * of its targetPaths -- they are what the task is expected to change; versions 1-3 keep the fence's words.
 */
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { loopSummaryLines } from "../src/LoopPlanCard.js";
import { TaskDetail } from "../src/TaskDetail.js";
import { PLAN, run, view, workItem } from "./fixtures/board.js";
import type { RunViewV1 } from "../src/controlTypes.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const item = workItem({ status: "completed", currentRunId: "run-a", lineageRunIds: ["run-a"] });
const landed = (over: Partial<RunViewV1>) => run({ state: "landed", outcome: "succeeded", ...over });
const taskRegion = (candidate: RunViewV1) => {
  const { container } = render(<TaskDetail view={view([item], [candidate])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  // By the task id, not the region's name: the name is translated.
  return within(container.querySelector<HTMLElement>("section[data-task-id='a']")!);
};

describe("the task view's run line names off-plan writes (W3)", () => {
  it("lists the kept paths and how many more there were", () => {
    const region = taskRegion(landed({ offPlanWrites: { paths: ["README.md", "src/board/cli.js"], count: 5 } }));
    // mutation: drop <OffPlanWrites> from the run line -> red
    expect(region.getByText("Off-plan writes: README.md, src/board/cli.js (+3 more)")).toBeTruthy();
  });

  it("every path kept: no count; no record: no line", () => {
    const region = taskRegion(landed({ offPlanWrites: { paths: ["README.md"], count: 1 } }));
    // mutation: always print the count suffix -> "(+0 more)", red
    expect(region.getByText("Off-plan writes: README.md")).toBeTruthy();
    cleanup();
    expect(taskRegion(landed({})).queryByText(/Off-plan writes/)).toBeNull();
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const region = taskRegion(landed({ offPlanWrites: { paths: ["README.md", "src/board/cli.js"], count: 5 } }));
    expect(region.getByText("计划外改动：README.md、src/board/cli.js（另有 3 个）")).toBeTruthy();
  });
});

describe("a v4 loop plan's card says its targetPaths are expected, not a fence", () => {
  const planAt = (planVersion: number) => ({ ...PLAN, planVersion, inputs: { ...PLAN.inputs, targetPaths: ["src/auth/**", "tests/auth/**"] } });

  it("v4: 'Expected to change', and no 'Only changes' line; v3 and below keep 'Only changes'", () => {
    // mutation: key the line on nothing (always onlyChanges) -> red for v4
    expect(loopSummaryLines(planAt(4))).toContain("Expected to change: src/auth/**, tests/auth/** (other files may change when the work needs them)");
    expect(loopSummaryLines(planAt(4)).some((line) => line.startsWith("Only changes"))).toBe(false);
    for (const version of [1, 2, 3]) {
      // mutation: switch at >= 3 instead of >= 4 -> red for v3
      expect(loopSummaryLines(planAt(version)), `v${version}`).toContain("Only changes: src/auth/**, tests/auth/**");
      expect(loopSummaryLines(planAt(version)).some((line) => line.startsWith("Expected to change")), `v${version}`).toBe(false);
    }
  });

  it("in Chinese too", async () => {
    await i18n.changeLanguage("zh");
    expect(loopSummaryLines(planAt(4))).toContain("预计会改：src/auth/**、tests/auth/**（工作需要时也可能改其他文件）");
    expect(loopSummaryLines(planAt(3))).toContain("只改：src/auth/**、tests/auth/**");
  });
});
