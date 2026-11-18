// @vitest-environment jsdom
/**
 * Tester #355 / #357 (human rulings 2026-11-19: #355 「同意该方案，同意允许互转」; #92 「同意」 to list multi-select with bulk
 * archive/close, no bulk retry, nothing on the Board): the Closed and Archived chips (both out of All), a count on every chip,
 * a selection box beside each card's button, and a toolbar that sends one command per selected group and lists each outcome.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { BoardView } from "../src/BoardView.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { GroupList, type BulkOutcome, type BulkVerb } from "../src/GroupList.js";
import { boardColumn, boardDrop, groupCategory, matchesGroupFilter } from "../src/groupCategory.js";
import type { ControlRefusal } from "../src/controlState.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { config, view } from "./fixtures/board.js";

const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const doneOf = (groupId: string, over: Partial<GroupSummaryV1> = {}) => g(groupId, { state: "done", completion: { done: 1, total: 1 }, counts: { ...zero, done: 1 }, ...over });
const GROUPS = [
  g("n1"), g("r1", { state: "running", counts: { ...zero, running: 1 } }), doneOf("d1"), doneOf("d2"),
  doneOf("c1", { archived: true, archiveKind: "closed" }), g("x1", { archived: true, archiveKind: "archived" }), g("x2", { archived: true }),
];
const nav = () => screen.getByRole("navigation", { name: "Control groups" });
const ids = () => [...nav().querySelectorAll(":scope > .group-card-row > .group-card")].map((card) => (card.textContent ?? "").split(" · ")[0]);
const chips = () => within(screen.getByRole("group", { name: "Show groups" }));
const chip = (name: string) => chips().getByRole("button", { name: new RegExp(`^${name} \\(\\d+\\)$`) });
const toolbar = () => screen.getByRole("group", { name: "Selected groups" });

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("Closed and Archived chips, and a count on every chip (#355, #357)", () => {
  it("files a closed group under Closed and an archived one under Archived; All shows neither", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={0} />);
    // mutation: matchesGroupFilter("all") excludes archived only -> c1 listed, red here
    expect(ids()).toEqual(["n1", "r1", "d1", "d2"]);
    fireEvent.click(chip("Closed"));
    expect(ids()).toEqual(["c1"]);
    // mutation: groupCategory answers archived for any mark -> Closed is empty and c1 is under Archived, red above and here
    expect(nav().querySelector(".group-card-name")!.textContent).toContain("c1 · closed");
    fireEvent.click(chip("Archived"));
    expect(ids()).toEqual(["x1", "x2"]);
  });

  it("names each chip's count over the groups in scope, whichever chip is chosen", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={0} />);
    const counts = () => chips().getAllByRole("button").map((button) => button.textContent);
    const expected = ["All (4)", "Not started (1)", "Running (1)", "Needs attention (0)", "Done (2)", "Closed (1)", "Archived (2)"];
    expect(counts()).toEqual(expected);
    // mutation: count the shown groups instead of the listed ones -> the counts follow the chosen chip, red here
    fireEvent.click(chip("Closed"));
    expect(counts()).toEqual(expected);
  });

  it("files by the summary alone: closed is its own category, out of All, and the Board drops it on Done to unclose", () => {
    const closed = doneOf("c", { archived: true, archiveKind: "closed" }), archived = g("x", { archived: true });
    expect([groupCategory(closed), groupCategory(archived)]).toEqual(["closed", "archived"]);
    expect([matchesGroupFilter(closed, "all"), matchesGroupFilter(closed, "closed"), matchesGroupFilter(archived, "closed")]).toEqual([false, true, false]);
    // The Board keeps one Archived column for both kinds (kanban spec §4 correction), shown under its box.
    expect([boardColumn(closed), boardColumn(archived)]).toEqual(["archived", "archived"]);
    // mutation: boardDrop always answers unarchive-group from Archived -> the server refuses it group-closed, red here
    expect(boardDrop(closed, "done")).toEqual({ verb: "unclose-group" });
    expect(boardDrop(archived, "done")).toEqual({ verb: "unarchive-group" });
  });

  it("shows a closed group in the Board's Archived column once its box is ticked, reading closed", () => {
    render(<BoardView groups={[doneOf("c", { archived: true, archiveKind: "closed" })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("board-card-c")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show closed and archived" }));
    expect(within(screen.getByRole("region", { name: "Archived" })).getByTestId("board-card-c").textContent).toContain("c · closed");
  });
});

/** A page owner, as App is: it keeps each group's refusal and answers the list's bulk calls through `answer`. */
function Owner(props: { groups: GroupSummaryV1[]; answer: (groupId: string, verb: BulkVerb) => BulkOutcome | ControlRefusal; calls: Array<[string, BulkVerb]> }) {
  const [refusals, setRefusals] = useState<Record<string, ControlRefusal>>({});
  const onBulkAction = async (groupId: string, verb: BulkVerb): Promise<BulkOutcome> => {
    props.calls.push([groupId, verb]);
    const answer = props.answer(groupId, verb);
    if (typeof answer === "string") return answer;
    setRefusals((all) => ({ ...all, [groupId]: answer }));
    return "refused";
  };
  return <GroupList groups={props.groups} selected={null} onSelect={vi.fn()} now={0} onBulkAction={onBulkAction} refusals={refusals} />;
}

describe("multi-select and the bulk toolbar (#357)", () => {
  const box = (groupId: string) => screen.getByRole("checkbox", { name: `Select ${groupId}` });

  it("puts each card's selection box beside its button, never inside it, and offers none without a bulk handler", () => {
    render(<Owner groups={GROUPS} answer={() => "succeeded"} calls={[]} />);
    const card = screen.getByRole("button", { name: /^d1 · done/ });
    expect(card.querySelector("input")).toBeNull();
    expect(box("d1").closest(".group-card-row")).toBe(card.closest(".group-card-row"));
    cleanup();
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={0} />);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
  });

  it("offers Close only when every selected group is done, and never a retry or pause", () => {
    render(<Owner groups={GROUPS} answer={() => "succeeded"} calls={[]} />);
    expect(screen.queryByRole("group", { name: "Selected groups" })).toBeNull();
    fireEvent.click(box("d1"));
    fireEvent.click(box("d2"));
    expect(within(toolbar()).getByText("2 selected")).toBeTruthy();
    const close = () => within(toolbar()).getByRole("button", { name: "Close" }) as HTMLButtonElement;
    expect(close().disabled).toBe(false);
    fireEvent.click(box("n1"));
    // mutation: bulkCloseOpen answers true for any non-empty selection -> Close stays enabled, red here
    expect(close().disabled).toBe(true);
    expect(within(toolbar()).getByText("Close takes done groups only; deselect the others.")).toBeTruthy();
    expect((within(toolbar()).getByRole("button", { name: "Archive" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(toolbar()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Archive", "Close", "Clear selection"]);
    // DESIGN.md: one primary per view -- the toolbar adds none.
    expect(toolbar().querySelector(".btn-primary")).toBeNull();
  });

  it("sends one command per selected group, in order, and lists each one's outcome -- a refusal with its code and what to do", async () => {
    const calls: Array<[string, BulkVerb]> = [];
    const refusal: ControlRefusal = { status: 409, code: "archive-run-active", message: "archive-run-active:run-1", commandRevision: 1 };
    render(<Owner groups={GROUPS} calls={calls} answer={(groupId) => groupId === "r1" ? refusal : groupId === "n1" ? "skipped" : "succeeded"} />);
    for (const id of ["n1", "r1", "d1"]) fireEvent.click(box(id));
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.getByTestId("bulk-outcome-d1")).toBeTruthy());
    // mutation: send only the first selected group -> one call, red here
    expect(calls).toEqual([["n1", "archive-group"], ["r1", "archive-group"], ["d1", "archive-group"]]);
    expect(screen.getByTestId("bulk-outcome-d1").textContent).toBe("d1: archived");
    expect(screen.getByTestId("bulk-outcome-n1").textContent).toBe("n1: already archived or changed; nothing sent");
    // mutation: render the refused row as plain text (no RefusalNotice) -> no code, red here
    const refused = within(screen.getByTestId("bulk-outcome-r1"));
    expect(refused.getByTestId("bulk-refusal-r1").textContent).toContain("archive-run-active");
    // Only the refused group stays selected, so the person can act on it again.
    expect([(box("r1") as HTMLInputElement).checked, (box("d1") as HTMLInputElement).checked, (box("n1") as HTMLInputElement).checked]).toEqual([true, false, false]);
  });

  it("closes a selection of done groups through close-group", async () => {
    const calls: Array<[string, BulkVerb]> = [];
    render(<Owner groups={GROUPS} calls={calls} answer={() => "succeeded"} />);
    fireEvent.click(box("d1"));
    fireEvent.click(box("d2"));
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByTestId("bulk-outcome-d2").textContent).toBe("d2: closed"));
    expect(calls).toEqual([["d1", "close-group"], ["d2", "close-group"]]);
  });
});

describe("a closed group's page (#355)", () => {
  it("says it is closed and offers Unclose, which sends unclose-group; a done group offers Close", () => {
    const base = view([]);
    const onCommand = vi.fn();
    render(<ControlGroupView view={{ ...base, summary: { ...base.summary, state: "done", archived: true, archiveKind: "closed" } }} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    const banner = screen.getByRole("status", { name: "Closed" });
    expect(banner.textContent).toContain("This group is closed");
    // mutation: the banner keeps sending unarchive-group -> the server refuses it group-closed, red here
    fireEvent.click(within(banner).getByRole("button", { name: "Unclose" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "unclose-group", groupId: base.summary.groupId, expectedRevision: base.summary.commandRevision, payload: {} });
    expect(screen.queryByRole("status", { name: "Archived" })).toBeNull();
    cleanup();
    const sent = vi.fn();
    render(<ControlGroupView view={{ ...base, summary: { ...base.summary, state: "done" } }} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={sent} />);
    fireEvent.click(screen.getByRole("button", { name: "Close group" }));
    expect(sent).toHaveBeenCalledWith({ verb: "close-group", groupId: base.summary.groupId, expectedRevision: base.summary.commandRevision, payload: {} });
  });
});
