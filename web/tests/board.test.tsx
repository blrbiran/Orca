// @vitest-environment jsdom
/**
 * Kanban spec 2026-10-20 §4 (session 9ec98639): the board tab. Columns come from the summary only; a drag sends exactly
 * one existing command or is refused on the page; the group graph adds and removes a person's edges.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { boardColumn, boardDrop, groupLed } from "../src/groupCategory.js";
import { GroupList } from "../src/GroupList.js";
import i18n, { currentLanguage } from "../src/i18n.js";
import { utility } from "./sourceClasses.js";

afterEach(cleanup);

const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "ready", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 2, running: 0, waiting: 0, blocked: 0, done: 0 }, executionPending: false, ...over,
});
const queued = { mode: "run" as const, state: "queued" as const, waitingFor: [], refusal: null };

describe("board columns (kanban spec §4)", () => {
  it("puts each group in exactly the column its summary says", () => {
    const cases: Array<[Partial<GroupSummaryV1>, string]> = [
      [{ state: "clarifying" }, "clarifying"],
      [{ state: "draft" }, "awaiting-confirmation"],
      [{ orchestration: queued }, "queued"],
      [{ orchestration: { ...queued, mode: "hold", state: "held" } }, "queued"],
      [{ orchestration: { ...queued, state: "waiting-slot" } }, "queued"],
      // mutation: drop the orchestration branch -> a started group whose tasks are all idle reads queued, red
      [{ orchestration: { ...queued, state: "started" } }, "running"],
      [{ executionPending: true, orchestration: { ...queued, state: "started" } }, "running"],
      [{ state: "running" }, "running"],
      [{ counts: { idle: 1, running: 0, waiting: 0, blocked: 1, done: 0 } }, "needs-you"],
      [{ stopMode: "pause", stopState: "paused" }, "needs-you"],
      [{ completion: { done: 2, total: 2 } }, "done"],
      [{ completion: { done: 2, total: 2 }, archived: true }, "archived"],
      // A ready group confirmed before start-on-confirm: queued until anything ran.
      [{}, "queued"],
      [{ counts: { idle: 1, running: 0, waiting: 0, blocked: 0, done: 1 } }, "running"],
    ];
    expect(cases.map(([over]) => boardColumn(g(over)))).toEqual(cases.map(([, column]) => column));
  });

  it("allows only pause, resume, archive and unarchive by drag", () => {
    const running = g({ state: "running" }), paused = g({ stopMode: "pause", stopState: "paused" }), done = g({ completion: { done: 2, total: 2 } });
    expect(boardDrop(running, "queued")).toEqual({ verb: "pause-dispatch" });
    expect(boardDrop(paused, "running")).toEqual({ verb: "resume-dispatch" });
    expect(boardDrop(done, "archived")).toEqual({ verb: "archive-group" });
    expect(boardDrop({ ...done, archived: true }, "done")).toEqual({ verb: "unarchive-group" });
    // mutation: allow any drop on running -> a draft is "started" by drag, red
    expect(boardDrop(g({ state: "draft" }), "running")).toEqual({ refused: "not-allowed" });
    expect(boardDrop(running, "done")).toEqual({ refused: "not-allowed" });
    expect(boardDrop(running, "running")).toEqual({ refused: "same" });
  });
});

const dataTransfer = () => { const store = new Map<string, string>(); return { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "" }; };

describe("the board tab (kanban spec §4)", () => {
  it("shows cards in columns with their facts, and a drop sends the one command or is refused on the page", () => {
    const onCommand = vi.fn<(action: ControlAction) => void>();
    const groups = [
      g({ groupId: "run1", state: "running", goal: "Do X", card: { budget: { usedTokens: 1200, limitTokens: 5000 }, pendingDecisions: 2, firstFailure: { taskId: "a", cause: "required-check-failed" } } }),
      g({ groupId: "wait", orchestration: { ...queued, state: "waiting-prerequisite", waitingFor: ["run1"] } }),
      g({ groupId: "draft1", state: "draft" }),
    ];
    render(<BoardView groups={groups} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={onCommand} />);
    const running = screen.getByRole("region", { name: "Running" });
    const card = within(running).getByTestId("board-card-run1");
    expect(card.textContent).toContain("Do X");
    // Failure-cause spec 2026-10-21 §5: a cause ccloop typed is worded (was the raw code; Ruling in the commit body).
    // Issue #84: the budget's figures short (was "1200 of 5000 tokens"), the exact ones in the title.
    expect(card.textContent).toContain("1.2K of 5K tokens · 2 decisions to review · a failed: a required check failed");
    expect(within(card).getByTitle("1,200 / 5,000")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Queued" })).getByTestId("board-card-wait").textContent).toContain("waiting for run1");
    const transfer = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: "Queued" }), { dataTransfer: transfer });
    expect(onCommand.mock.calls).toEqual([[{ verb: "pause-dispatch", groupId: "run1", expectedRevision: 7, payload: {} }]]);
    const draftTransfer = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("board-card-draft1"), { dataTransfer: draftTransfer });
    fireEvent.drop(screen.getByRole("region", { name: "Running" }), { dataTransfer: draftTransfer });
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("board-refusal").textContent).toContain("draft1 cannot be moved to Running");
  });

  // Tester #54: a refusal used to be known only after the drop. While a card is dragged each column says beforehand
  // whether it takes the card (from boardDrop, the same function the drop obeys), and the marks go when the drag ends.
  it("marks, while a card is dragged, the columns that take it and those that refuse it", () => {
    const groups = [g({ groupId: "run1", state: "running" }), g({ groupId: "draft1", state: "draft" })];
    render(<BoardView groups={groups} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const column = (name: string): HTMLElement => screen.getByRole("region", { name });
    fireEvent.dragStart(screen.getByTestId("board-card-run1"), { dataTransfer: dataTransfer() });
    expect(column("Queued").getAttribute("data-drop")).toBe("allowed");
    expect(screen.getByTestId("board-drop-hint-queued").textContent).toBe("Drop to pause");
    expect(column("Done").getAttribute("data-drop")).toBe("refused");
    expect(column("Running").getAttribute("data-drop")).toBeNull();
    // Final pass (session a9f9d6de): the allowed mark is drawn by utilities (layer above the legacy sheet), not by a
    // `.board-column[data-drop]` rule the section rule out-ranked. mutation: drop either utility from boardColumnBox, red
    for (const part of ["data-[drop=allowed]:border-dashed", "data-[drop=allowed]:border-accent", "data-[drop=refused]:opacity-55"]) expect(column("Queued").classList.contains(part), part).toBe(true);
    fireEvent.dragEnd(screen.getByTestId("board-card-run1"));
    expect(column("Queued").getAttribute("data-drop")).toBeNull();
    expect(screen.queryByTestId("board-drop-hint-queued")).toBeNull();
  });

  it("keeps a failure the panel cannot word (an Orca reason, or a cause it does not know) as written", () => {
    const card = (cause: string) => g({ groupId: `g-${cause}`, state: "running", card: { budget: { usedTokens: 0, limitTokens: null }, pendingDecisions: 0, firstFailure: { taskId: "a", cause } } });
    render(<BoardView groups={[card("terminal:failed"), card("a-newer-cause")]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("board-card-g-terminal:failed").textContent).toContain("a failed: terminal:failed");
    expect(screen.getByTestId("board-card-g-a-newer-cause").textContent).toContain("a failed: a-newer-cause");
  });

  it("hides the archived column until asked, and the group graph adds and removes a person's edge", () => {
    const onCommand = vi.fn<(action: ControlAction) => void>();
    render(<BoardView groups={[g({ groupId: "a", dependsOn: ["b"] }), g({ groupId: "b", commandRevision: 3 })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("region", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
    expect(screen.getByRole("region", { name: "Archived" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Group graph" }));
    expect(screen.getByRole("list", { name: "Dependencies" }).textContent).toContain("a waits for b");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Group" }), { target: { value: "b" } });
    fireEvent.change(screen.getByRole("combobox", { name: "waits for" }), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCommand.mock.calls).toEqual([
      [{ verb: "remove-group-dependency", groupId: "a", expectedRevision: 7, payload: { dependsOn: "b" } }],
      [{ verb: "add-group-dependency", groupId: "b", expectedRevision: 3, payload: { dependsOn: "a" } }],
    ]);
  });
});

// Tester issue #58 (ruling 2026-10-27, session 7753e97d): a system-debug card names why Orca opened it in the reader's
// language -- the raw source kind ("ladder") means nothing to a person -- and its badge wraps inside its own border.
describe("the system-debug badge (#58)", () => {
  afterEach(async () => { await i18n.changeLanguage("en"); });
  const sources: Array<[NonNullable<GroupSummaryV1["systemDebug"]>["source"], string, string]> = [
    [{ kind: "ladder", groupId: "a", taskId: "t", runId: null }, "automatic fix", "自动修复"],
    [{ kind: "integration-check", groupId: "a", taskId: null, runId: null }, "integration check", "集成检查"],
    [{ kind: "criteria-review", groupId: "a", taskId: null, runId: null }, "criteria review", "判据审查"],
    [{ kind: "model-review", repoId: "r", target: "main", from: "x", to: "y", runSeq: 1 }, "model review", "模型审阅"],
    [{ kind: "model-review-finding", repoId: "r", reviewGroupId: "rv", findingId: "f" }, "review finding fix", "审阅发现的修复"],
  ];
  const board = () => render(<BoardView groups={sources.map(([source], i) => g({ groupId: `s${i}`, state: "running", systemDebug: { source, stackOn: null, settled: null } }))}
    scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
  const badges = () => sources.map((_, i) => within(screen.getByTestId(`board-card-s${i}`)).getByTestId("board-card-system-debug").textContent);

  it("words each source kind in English and in Chinese, never as the raw kind", async () => {
    board();
    // mutation: pass source.kind raw again -> "(ladder)", red
    expect(badges()).toEqual(sources.map(([source, word]) => `Orca's fix for ${"groupId" in source ? source.groupId : source.kind === "model-review" ? source.target : source.reviewGroupId} (${word})`));
    cleanup();
    await i18n.changeLanguage("zh");
    board();
    const zh = badges();
    sources.forEach(([source, , word], i) => { expect(zh[i]).toContain(`（${word}）`); expect(zh[i]).not.toContain(source.kind); });
  });

  it("boxes a board card's badge so a second line stays inside its border", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; the `.board-card .badge` rule became
    // utilities on each badge in BoardView.tsx, so the criterion reads the rendered badges instead of styles.css)
    const groups = [g({ groupId: "stopped", stopState: "paused", card: { budget: { usedTokens: 1, limitTokens: null }, pendingDecisions: 0, firstFailure: null, reviewFindings: { major: 1, minor: 2 } } })];
    render(<BoardView groups={groups} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const badges = [...screen.getByTestId("board-card-stopped").querySelectorAll<HTMLElement>(".badge")];
    expect(badges.length).toBe(3);
    // mutation: drop one of the three utilities from cardBadge -> the 999px pill clips a two-line badge, red
    for (const badge of badges) for (const part of ["rounded-control", "max-w-full", "wrap-anywhere"]) expect(badge.classList.contains(part), `${badge.textContent}: ${part}`).toBe(true);
  });
});

// Ruling H8 (2026-10-27, session 7753e97d): a status light on each group card in the Tasks list and on the Board, so a
// person can scan for what is moving or stuck. It repeats the state the card's text states, so it is hidden from
// assistive tech and never changes a card's accessible name.
describe("the status light (H8)", () => {
  it("is red when the group needs you, green with a run going, amber when started or queued with none going, dim otherwise", () => {
    const cases: Array<[Partial<GroupSummaryV1>, string]> = [
      [{ counts: { idle: 1, running: 0, waiting: 0, blocked: 1, done: 0 } }, "failed"],
      [{ state: "blocked" }, "failed"],
      [{ state: "running", counts: { idle: 1, running: 1, waiting: 0, blocked: 0, done: 0 } }, "running"],
      // mutation: a running-column group is always green -> a started group with nothing going reads running, red
      [{ orchestration: { ...queued, state: "started" } }, "waiting"],
      [{ orchestration: queued }, "waiting"],
      [{ orchestration: { ...queued, state: "waiting-slot" } }, "waiting"],
      [{ state: "draft" }, "idle"],
      [{ state: "clarifying" }, "idle"],
      [{ completion: { done: 2, total: 2 } }, "idle"],
      [{ completion: { done: 2, total: 2 }, archived: true }, "idle"],
    ];
    expect(cases.map(([over]) => groupLed(g(over)))).toEqual(cases.map(([, led]) => led));
  });

  it("sits on board cards and Tasks list cards, aria-hidden, leaving each card's name as its text", () => {
    const running = g({ groupId: "run1", state: "running", counts: { idle: 1, running: 1, waiting: 0, blocked: 0, done: 0 } });
    const stuck = g({ groupId: "stuck", state: "blocked" });
    render(<BoardView groups={[running, stuck]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const led = (testId: string) => screen.getByTestId(testId).querySelector(".led");
    // mutation: drop the light from BoardCard -> null, red
    expect([led("board-card-run1")?.getAttribute("data-led"), led("board-card-stuck")?.getAttribute("data-led")]).toEqual(["running", "failed"]);
    expect(led("board-card-run1")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    render(<GroupList groups={[running, stuck]} selected={null} onSelect={vi.fn()} now={0} />);
    const card = screen.getByRole("button", { name: /^run1 · running/ });
    // mutation: drop the light from GroupCard -> null, red
    expect(card.querySelector(".led")?.getAttribute("data-led")).toBe("running");
    expect(screen.getByRole("button", { name: /^stuck · blocked/ }).querySelector(".led")?.getAttribute("data-led")).toBe("failed");
  });

  it("colours the light from the theme's tone tokens, glowing only while running, and sets key figures in tabular digits", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; final pass: .led and .num are @utility blocks in index.css, the light's states nested in it).
    // mutation: drop the running glow from the led utility -> red; mutation: drop tabular-nums from the num utility -> red
    const led = utility("led");
    expect(led).toContain("width: 7px");
    expect(led).toMatch(/&\[data-led="running"\] \{[^}]*box-shadow: 0 0 6px var\(--ok\)/);
    expect(led).toMatch(/&\[data-led="failed"\] \{[^}]*background: var\(--danger\)/);
    expect(led).toMatch(/&\[data-led="waiting"\] \{[^}]*background: var\(--warn\)/);
    expect(utility("num")).toContain("font-variant-numeric: tabular-nums");
    render(<BoardView groups={[g({ groupId: "b", state: "running", card: { budget: { usedTokens: 1200, limitTokens: 5000 }, pendingDecisions: 0, firstFailure: null } })]}
      scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop "num" from the board card's budget line -> its figures jitter as they poll, red
    expect(screen.getByTestId("board-card-budget").classList.contains("num")).toBe(true);
  });
});

// Tester #49 (session e236bbe4): the card's open control gave no hint where it leads. Its title names the destination App's
// onOpen takes it to -- a clarifying group opens its requirement, any other group its detail -- in the reader's language.
describe("the board card's open control says where it leads (tester #49)", () => {
  it("titles a clarifying card as opening its requirement and any other card as opening the group, in English and Chinese", async () => {
    const open = (groupId: string) =>
      within(screen.getByTestId(`board-card-${groupId}`)).getByRole("button", { name: new RegExp(groupId) });
    render(<BoardView groups={[g({ groupId: "req", state: "clarifying" }), g({ groupId: "grp", state: "running" })]}
      scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the clarifying branch -> the requirement card says "group", red
    expect(open("req").getAttribute("title")).toBe("Open this requirement");
    // mutation: drop the title attribute -> null, red
    expect(open("grp").getAttribute("title")).toBe("Open this group's detail");
    await i18n.changeLanguage("zh");
    try {
      cleanup();
      render(<BoardView groups={[g({ groupId: "req", state: "clarifying" })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      expect(open("req").getAttribute("title")).toBe("打开这个需求");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// Tester #73/#90 (session a9f9d6de): a board card says how far its group is and when it last did anything, from the summary alone
// (completion, updatedAt) -- the way the Tasks list card does. The absolute time is the element's title; the card's own title (#49) stays.
describe("the board card's progress and last activity (tester #73, #90)", () => {
  const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
  const cards = () => [
    g({ groupId: "fresh", state: "running", completion: { done: 3, total: 5 }, updatedAt: NOW - 5 * 60_000 }),
    g({ groupId: "empty", completion: { done: 0, total: 0 }, updatedAt: null }),
    g({ groupId: "old", state: "running", completion: { done: 1, total: 2 }, updatedAt: NOW - 3 * 3_600_000 }),
  ];
  const meta = (groupId: string) => within(screen.getByTestId(`board-card-${groupId}`));

  it("shows done/total tasks and a relative last-activity time whose title is the absolute time, in English and Chinese", async () => {
    render(<BoardView groups={cards()} scope={{ kind: "all" }} now={NOW} onOpen={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the tasks span -> null, red
    expect(meta("fresh").getByTestId("board-card-tasks").textContent).toBe("3/5 tasks done");
    // mutation: drop the <time> element -> null, red
    const time = meta("fresh").getByTestId("board-card-updated");
    expect(time.textContent).toBe("updated 5 min ago");
    // mutation: title the element with the relative text again -> not the absolute time, red
    expect(time.getAttribute("title")).toBe(new Date(NOW - 5 * 60_000).toLocaleString(currentLanguage()));
    expect(meta("old").getByTestId("board-card-updated").textContent).toBe("updated 3 h ago");
    // A group with no task and no activity row has nothing to say, so no empty line is drawn.
    expect(meta("empty").queryByTestId("board-card-meta")).toBeNull();
    // Tester #49: the open control keeps its title.
    expect(meta("fresh").getByRole("button", { name: /fresh/ }).getAttribute("title")).toBe("Open this group's detail");
    await i18n.changeLanguage("zh");
    try {
      cleanup();
      render(<BoardView groups={cards()} scope={{ kind: "all" }} now={NOW} onOpen={vi.fn()} onCommand={vi.fn()} />);
      expect(meta("fresh").getByTestId("board-card-tasks").textContent).toBe("已完成 3/5 个任务");
      expect(meta("fresh").getByTestId("board-card-updated").textContent).toBe("5 分钟前更新");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("reads the clock itself when none is given, so the line moves while nothing else does", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      render(<BoardView groups={[cards()[0]!]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      expect(meta("fresh").getByTestId("board-card-updated").textContent).toBe("updated 5 min ago");
      // mutation: read Date.now() once per render instead of useClock -> the line never moves, red
      act(() => { vi.advanceTimersByTime(30_000 * 3); });
      expect(meta("fresh").getByTestId("board-card-updated").textContent).toBe("updated 6 min ago");
    } finally {
      vi.useRealTimers();
    }
  });
});
