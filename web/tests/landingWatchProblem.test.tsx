// @vitest-environment jsdom
/**
 * Tester follow-up G §6.2 (#269): a check that turned red on the group branch after a landing is a problem of the group --
 * one row per regression in the Problems region, naming the landing and the check, with the output tail -- and the
 * Problems tab counts it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import i18n from "../src/i18n.js";
import type { GroupViewV1, LandingWatchV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const TIP = "c".repeat(40);
const WATCH: LandingWatchV1 = { tip: TIP, at: 1, commands: [{ command: "npm test", exit: "1", ms: 3, tail: "AssertionError" }],
  regressions: [{ command: "npm test", landedTaskIds: ["b"], tip: TIP, exit: "1", tail: "AssertionError", since: 1, problem: "landing-regression:npm test" }] };

const withWatch = (landingWatch: LandingWatchV1 | undefined): GroupViewV1 => {
  const value = view([workItem({ taskId: "a", status: "completed", category: "done" }), workItem({ taskId: "b", status: "completed", category: "done" })]);
  return { ...value, summary: { ...value.summary, ...(landingWatch === undefined ? {} : { landingWatch }) } };
};
const mount = (value: GroupViewV1) =>
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} refusal={null} roles={["owner"]} />);
// #219: a group renders only its selected detail region; the rows are read with Problems open.
const openProblems = (): void => { fireEvent.click(screen.getAllByRole("tab").find((tab) => tab.textContent?.startsWith("Problems") === true || tab.textContent?.startsWith("问题") === true)!); };
const problemHint = (): string | null => screen.getByRole("tab", { name: "Problems" }).querySelector("[data-tab-hint]")?.textContent ?? null;

describe("a landing regression in the group view (tester follow-up G §6.2)", () => {
  it("Problems lists each regression and the tab counts it", () => {
    const { container } = mount(withWatch(WATCH));
    expect(problemHint()).toBe("1");
    openProblems();
    const row = container.querySelector("[data-landing-regression='npm test']")!;
    expect(row.closest("[role=tabpanel]")?.getAttribute("data-overview-region")).toBe("problem");
    expect(row.querySelector("code")?.textContent).toBe("landing-regression:npm test");
    expect(screen.getByText("after b landed, npm test turned red")).toBeTruthy();
    expect(row.querySelector("pre")?.textContent).toBe("AssertionError");
  });

  it("a record with no regression shows and counts nothing", () => {
    const { container } = mount(withWatch({ ...WATCH, regressions: [] }));
    expect(problemHint()).toBeNull();
    openProblems();
    expect(container.querySelector("[data-problem-landing-watch]")).toBeNull();
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    mount(withWatch(WATCH));
    openProblems();
    expect(screen.getByText("b 落地后，npm test 变红了")).toBeTruthy();
  });
});
