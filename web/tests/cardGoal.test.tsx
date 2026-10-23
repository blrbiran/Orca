// @vitest-environment jsdom
/**
 * Flow gaps Task 10a (human request, session 0e13a9b7): a group whose goal is a whole requirement (the live one is 1230
 * characters) filled its overview, board and task cards. A card now shows the clarify round's short title, else a summary
 * of the goal clamped to two lines, with the whole goal in its tooltip; the group's own page still shows the whole goal.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import { CARD_SUMMARY_MAX, goalSummary } from "../src/CardGoal.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { GroupList } from "../src/GroupList.js";
import { Overview } from "../src/Overview.js";
import type { GroupSummaryV1, RequirementSummaryV1 } from "../src/controlTypes.js";
import type { OverviewModel } from "../src/overviewModel.js";
import { config, view } from "./fixtures/board.js";

afterEach(cleanup);

// A long Chinese goal of the live shape: a heading line, then a first line with no sentence end in its first 120
// characters, then many more lines.
const FIRST_LINE = "对 Web 界面做一次完整的可用性审查并修复发现的问题".repeat(6);
const LONG_GOAL = `\n  ${FIRST_LINE}。其余内容\n${"第二段：逐页检查概览、任务和看板页面，记录每个让人困惑的地方，并给出修复。\n".repeat(30)}`;
const REQUIREMENT: RequirementSummaryV1 = {
  roundNo: 1, roundState: "awaiting-answers", openQuestions: 1, draftNo: null, draftState: null, waiting: null, reasonCode: null, exportState: "not-due",
  used: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, reserved: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 },
  limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, usageUnknown: false, blockedRun: null, slug: "web-ui-usability-review",
};
const g = (over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId: "g", repoId: "orca", state: "running", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 2 }, counts: { idle: 2, running: 0, waiting: 0, blocked: 0, done: 0 }, goal: LONG_GOAL, ...over,
});
const titled = g({ requirement: { ...REQUIREMENT, title: "Web 界面可用性审查" } });
const untitled = g({ requirement: REQUIREMENT });

const model = (group: GroupSummaryV1): OverviewModel => ({
  progress: [{ group, owner: "Orca", ownerUnknown: false, target: { kind: "group", groupId: group.groupId, region: null, taskId: null, runId: null } as never }],
  queue: [], issues: [], sources: [], scopeUnavailable: false, complete: true,
});
const CARDS: Array<[string, (group: GroupSummaryV1) => void]> = [
  ["overview", (group) => { render(<Overview model={model(group)} onOpen={vi.fn()} onImport={vi.fn()} onRequirement={vi.fn()} />); }],
  ["board", (group) => { render(<BoardView groups={[group]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />); }],
  ["tasks", (group) => { render(<GroupList groups={[group]} selected={null} onSelect={vi.fn()} now={0} />); }],
];
const cardGoal = (): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>(".card-goal");
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("a goal's card summary (Task 10a; acceptance fix, session ffec7b28)", () => {
  it("is the goal's non-empty lines joined, unchanged when short", () => {
    expect(goalSummary("\n\n  Ship the export  \nmore")).toBe("Ship the export more");
    expect(goalSummary("x".repeat(CARD_SUMMARY_MAX))).toBe("x".repeat(CARD_SUMMARY_MAX));
  });
  // Task 11 acceptance: a 1,175-character goal showed only its first sentence, with nothing saying more was cut.
  // Mutation "stop at the first sentence": the zh case below would come back as its 41-character first sentence.
  it("fills the limit, ends at the last sentence end past half of it, and always marks a cut with an ellipsis", () => {
    const zh = `${"界面审查".repeat(10)}。${"后续".repeat(80)}`;
    expect(goalSummary(zh)).toBe(`${Array.from(zh).slice(0, CARD_SUMMARY_MAX).join("")}…`);
    const en = "Review the web UI. ".repeat(8);
    expect(goalSummary(en)).toBe(`${"Review the web UI. ".repeat(6).trimEnd()}…`);
    expect(goalSummary("界面审查。".repeat(40))).toBe(`${"界面审查。".repeat(24)}…`);
    expect(goalSummary(`v1.2 ${"a".repeat(200)}`)).toBe(`v1.2 ${"a".repeat(CARD_SUMMARY_MAX - 5)}…`);
    expect(Array.from(goalSummary(FIRST_LINE + FIRST_LINE))).toHaveLength(CARD_SUMMARY_MAX + 1);
  });
});

describe.each(CARDS)("the %s card (Task 10a)", (_name, mount) => {
  // Mutation "title ignored by cards": the card would show the goal's summary instead.
  it("shows the clarify round's title when there is one, the whole goal in its tooltip", () => {
    mount(titled);
    const shown = cardGoal();
    expect(shown.textContent).toBe("Web 界面可用性审查");
    expect(shown.getAttribute("title")).toBe(LONG_GOAL);
    expect(document.body.textContent).not.toContain(FIRST_LINE.slice(0, 40) + FIRST_LINE.slice(0, 40));
  });
  it("shows a clamped summary of the goal when no round gave a title", () => {
    mount(untitled);
    const shown = cardGoal();
    expect(shown.textContent).toBe(goalSummary(LONG_GOAL));
    expect(Array.from(shown.textContent!)).toHaveLength(CARD_SUMMARY_MAX + 1);
    expect(shown.getAttribute("title")).toBe(LONG_GOAL);
    expect(document.body.textContent).not.toContain("第二段");
  });
});

// Task 11 acceptance: a clarifying group's Tasks card showed only its id and state, never its goal or title.
describe("a clarifying group's Tasks card (acceptance fix, session ffec7b28)", () => {
  it("shows the round's title, else the goal's summary, and still links to Requirements", () => {
    render(<GroupList groups={[g({ state: "clarifying", requirement: { ...REQUIREMENT, title: "Web 界面可用性审查" } })]} selected={null} onSelect={vi.fn()} now={0} />);
    expect(cardGoal().textContent).toBe("Web 界面可用性审查");
    expect(cardGoal().closest("a")?.getAttribute("href")).toBe("#requirements");
    cleanup();
    render(<GroupList groups={[g({ state: "clarifying", requirement: REQUIREMENT })]} selected={null} onSelect={vi.fn()} now={0} />);
    expect(cardGoal().textContent).toBe(goalSummary(LONG_GOAL));
  });
});

describe("where the whole goal still shows (Task 10a)", () => {
  it("the group's own page shows the plan's whole goal even when the requirement has a title", () => {
    const value = view([]);
    value.plan.goal = LONG_GOAL.trim();
    value.summary = { ...value.summary, goal: LONG_GOAL, requirement: { ...REQUIREMENT, title: "Web 界面可用性审查" } };
    render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(document.body.textContent).toContain(LONG_GOAL.trim());
    expect(document.querySelector(".card-goal")).toBeNull();
  });
  it("an overview card with neither title nor goal is named by its group id, as before", () => {
    render(<Overview model={model(g({ goal: undefined }))} onOpen={vi.fn()} onImport={vi.fn()} onRequirement={vi.fn()} />);
    expect(screen.getByRole("button", { name: "g" })).toBeTruthy();
  });
});
