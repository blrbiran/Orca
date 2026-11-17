// @vitest-environment jsdom
/**
 * Tester #348 review: the server leaves a run it cannot decode out of the view's `runs` and names it in `unreadableRuns`
 * (on the group, and on the task that owns it). The panel must say so -- otherwise the run silently vanishes from Runs and
 * from the task's detail. The group's Problems region names every such run and the Problems tab counts it; the owning
 * task's detail names its own; another task's detail says nothing.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import i18n from "../src/i18n.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { GroupViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const BAD = "run-bad-1", PROBE = "run-probe-1";
const REASON = "run-invalid:run-bad-1:Unrecognized key(s) in object: 'futureKey'";
const PROBE_REASON = "run-invalid:run-probe-1:Unrecognized key(s) in object: 'futureKey'";
const owner = (): WorkItemViewV1 => ({ ...workItem({ taskId: "a", status: "blocked", category: "blocked" }), unreadableRuns: [{ runId: BAD, reason: REASON }] });
const other = (): WorkItemViewV1 => workItem({ taskId: "b", status: "ready", category: "idle" });
const withUnreadable = (): GroupViewV1 => ({ ...view([owner(), other()]), unreadableRuns: [
  { runId: BAD, workItemId: "a", taskId: "a", reason: REASON },
  { runId: PROBE, workItemId: "quota-probe-x", taskId: null, reason: PROBE_REASON },
] });
const mount = (value: GroupViewV1) =>
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} refusal={null} roles={["owner"]} />);
const openProblems = (): void => { fireEvent.click(screen.getAllByRole("tab").find((tab) => tab.textContent?.startsWith("Problems") === true || tab.textContent?.startsWith("问题") === true)!); };
const problemHint = (): string | null => screen.getAllByRole("tab").find((tab) => tab.textContent?.startsWith("Problems") === true || tab.textContent?.startsWith("问题") === true)!.querySelector("[data-tab-hint]")?.textContent ?? null;
const detail = (item: WorkItemViewV1, value: GroupViewV1) => render(<TaskDetail view={value} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

describe("runs the server could not read (#348 review)", () => {
  it("the group's Problems region names each one, in the problem region, and the tab counts them", () => {
    const { container } = mount(withUnreadable());
    // mutation: leave unreadableRuns out of the problem hint -> no hint, red
    expect(problemHint()).toBe("2");
    openProblems();
    // mutation: drop the group banner from the Problems region -> no row, red
    const row = container.querySelector(`[data-unreadable-run='${BAD}']`)!;
    expect(row.closest("[role=tabpanel]")?.getAttribute("data-overview-region")).toBe("problem");
    expect(row.textContent).toBe(`Run ${BAD} cannot be read: ${REASON}`);
    expect(container.querySelector(`[data-unreadable-run='${PROBE}']`)?.textContent).toBe(`Run ${PROBE} cannot be read: ${PROBE_REASON}`);
  });

  it("the owning task's detail names its own run; another task's detail names nothing", () => {
    const value = withUnreadable();
    // mutation: drop the banner from TaskDetail -> no row, red
    expect(detail(value.workItems[0]!, value).container.querySelector(`[data-unreadable-run='${BAD}']`)?.textContent).toBe(`Run ${BAD} cannot be read: ${REASON}`);
    cleanup();
    expect(detail(value.workItems[1]!, value).container.querySelector("[data-unreadable-runs]")).toBeNull();
  });

  it("a group with none shows and counts nothing", () => {
    const { container } = mount(view([other()]));
    expect(problemHint()).toBeNull();
    openProblems();
    expect(container.querySelector("[data-unreadable-runs]")).toBeNull();
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { container } = mount(withUnreadable());
    openProblems();
    expect(container.querySelector(`[data-unreadable-run='${BAD}']`)?.textContent).toBe(`运行 ${BAD} 无法读取：${REASON}`);
  });
});
