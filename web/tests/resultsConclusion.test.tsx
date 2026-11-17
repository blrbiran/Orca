// @vitest-environment jsdom
/**
 * Tester #319 (human-agreed proposals 1, 3, 5): a group's Results opens with a conclusion card -- done and accepted, where
 * it delivers, what waits for the person (each line leading to the existing place with its action), the work branch and
 * its tip -- above the Git section; the Git table names each run's workspace, base and merged commit, not the bare run id;
 * a task's runs are reached from its row, not from one "open run" button per run.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupDecisionsViewV1, GroupIntegrationViewV1, GroupPlacementV1, GroupViewV1, IntegrationSchemeV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";
import { savedGroup } from "./fixtures/results.js";

const writeText = vi.fn(async (_text: string) => {});
beforeEach(() => { writeText.mockClear(); Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TIP = "abcdef0123456789abcdef0123456789abcdef01";
const integration = (scheme: IntegrationSchemeV1, over: Partial<GroupIntegrationViewV1> = {}): GroupIntegrationViewV1 => ({
  scheme, schemeHash: "s".repeat(64), frozen: true, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null, ...over,
});
const done = (value: GroupViewV1 = view([workItem({ taskId: "a", status: "completed" })])): GroupViewV1 => {
  value.summary.state = "done"; value.summary.completion = { done: 1, total: 1 };
  value.summary.acceptance = { tip: TIP, result: "passed", commands: [], at: 1 };
  return value;
};
const show = (value: GroupViewV1, decisions?: GroupDecisionsViewV1) =>
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={value} decisions={decisions} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
const card = () => screen.getByRole("region", { name: "Conclusion" });
const line = (name: string) => card().querySelector(`[data-conclusion="${name}"]`)!;
const selected = () => screen.getByRole("tab", { selected: true }).textContent;

describe("the conclusion card (#319 proposal 1)", () => {
  it("comes first in Results, before the Git section", () => {
    show(done());
    // mutation: render ResultsConclusion after the integration block -> red
    expect(card().compareDocumentPosition(screen.getByRole("region", { name: "Git" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says how many tasks are done and the group acceptance, or that either is not known", () => {
    const value = done(); value.summary.completion = { done: 3, total: 5 }; value.summary.acceptance!.result = "passed-relative";
    show(value);
    // mutation: drop the completion text or read acceptance from elsewhere -> red
    expect(line("done").textContent).toBe("3/5 tasks done · acceptance: passed (the failing check failed on the base too)");
    cleanup();
    const unread = done(); delete unread.summary.completion; delete unread.summary.acceptance;
    show(unread);
    // mutation: the `?? "not-run"` fallback or the doneUnread branch removed -> red
    expect(line("done").textContent).toBe("tasks done: not read yet · acceptance: not run");
  });

  it.each([
    [undefined, "Kept on orca/g; Orca does not merge or push it"],
    [{ delivery: "keep" } as const, "Kept on orca/g; Orca does not merge or push it"],
    [{ delivery: "local", trigger: "group", method: "merge", target: "main" } as const, "Merge into the local branch main"],
    [{ delivery: "push-target", trigger: "task", method: "squash", target: "main", remote: "origin" } as const, "Merge into main and push it to origin"],
    [{ delivery: "push-branch", trigger: "task", target: "main", remote: "origin" } as const, "Push orca/g to origin"],
    [{ delivery: "github-pr", trigger: "group", target: "develop", remote: "up" } as const, "Pull request from orca/g into develop on up"],
  ])("says where %j delivers in plain words", (scheme, said) => {
    const value = done(); if (scheme !== undefined) value.integration = integration(scheme);
    show(value);
    expect(line("delivery").textContent).toBe(said);
  });

  it("links an open pull request, and says a dir or multi-directory group's folders instead of a branch", () => {
    const value = done(); value.integration = integration({ delivery: "github-pr", trigger: "task", target: "main", remote: "origin" }, { pr: { url: "https://github.com/o/r/pull/7", number: 7, ready: true } });
    show(value);
    // mutation: drop the pr part -> red
    expect(within(line("delivery") as HTMLElement).getByRole("link", { name: "Pull request #7 (ready)" }).getAttribute("href")).toBe("https://github.com/o/r/pull/7");
    cleanup();
    const placement: GroupPlacementV1 = { workspaceKind: "dir", state: "idle", tip: null, landedTip: null, pending: null, changed: [], changedTotal: 0,
      unwritable: [], unwritableTotal: 0, withheld: [], watch: null, detail: null, resolution: null, at: 1 };
    const dir = done(); dir.summary.placement = placement;
    show(dir);
    // mutation: drop the folder branch -> "Kept on orca/g ...", red; drop `!folders` on the artifact -> a branch line, red
    expect(line("delivery").textContent).toBe("Written into the group's folder");
    expect(card().querySelector('[data-conclusion="artifact"]')).toBeNull();
    expect(line("waiting").textContent).toBe("Nothing");
    cleanup();
    const multi = done(); multi.summary.multiDir = { project: "p", dirs: [], landing: null };
    show(multi);
    // mutation: drop the multi branch -> red
    expect(line("delivery").textContent).toBe("Landed into each of the group's directories");
    expect(card().querySelector('[data-conclusion="artifact"]')).toBeNull();
  });

  it("says nothing waits when nothing does", () => {
    const value = done(); value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" });
    show(value);
    // mutation: drop the empty-list sentence -> red
    expect(line("waiting").textContent).toBe("Nothing");
  });

  it("leads a problem to the Problems tab", () => {
    const value = done(); value.summary.acceptance!.result = "failed";
    show(value);
    // mutation: drop the problems line, or count something other than the Problems tab -> red
    expect(line("waiting").textContent).toContain("1 problem to look at");
    fireEvent.click(within(line("waiting") as HTMLElement).getByRole("button", { name: "Open Problems" }));
    // The tab's text carries its own count hint after the name.
    expect(selected()).toMatch(/^Problems/);
  });

  it.each(["blocked", "conflict"] as const)("leads a %s integration to the integration section on the same page", (state) => {
    const value = done(); value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" }, { state });
    show(value);
    // mutation: drop the integration line -> red
    expect(line("waiting").textContent).toContain(state === "blocked" ? "Integration: blocked" : "Integration: merge conflict");
    fireEvent.click(within(line("waiting") as HTMLElement).getByRole("button", { name: "Go to integration" }));
    // mutation: onOpenIntegration does not focus the region -> red
    expect(document.activeElement?.getAttribute("data-overview-region")).toBe("integration");
  });

  it("leads a pending decision to the task whose detail answers it", () => {
    const decisions: GroupDecisionsViewV1 = { schema: "orca-group-decisions-v1", groupId: "g", projectKey: null, pendingCount: 1, tasks: [
      { taskId: "a", runs: [{ runId: "run-a", settled: false, reported: "array", decisions: [], unlanded: [],
        pending: [{ pendingId: "p1", reason: "r", question: "q?", chose: null, undoHow: null, state: "pending" }] }] }] };
    show(done(), decisions);
    // mutation: drop the decisions line -> red
    expect(line("waiting").textContent).toContain("1 decision waits for you");
    expect(screen.queryByRole("region", { name: "Task a" })).toBeNull();
    fireEvent.click(within(line("waiting") as HTMLElement).getByRole("button", { name: "Open task a" }));
    // mutation: the button opens no task -> red
    expect(selected()).toBe("Results");
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
  });

  it("says a finished keep group's merge is the person's, with no button for it", () => {
    show(done());
    // mutation: drop the keep merge line -> red
    expect(line("waiting").textContent).toBe("Merging orca/g into your main branch is yours; Orca does not do it");
    expect(within(line("waiting") as HTMLElement).queryAllByRole("button")).toEqual([]);
    cleanup();
    const running = done(); running.summary.state = "running";
    show(running);
    // mutation: drop the `state === "done"` condition -> red
    expect(line("waiting").textContent).toBe("Nothing");
  });

  it("gives the work branch and its accepted tip, short with the full sha on hover, each copyable", () => {
    show(done());
    const artifact = line("artifact") as HTMLElement;
    expect(artifact.textContent).toContain("orca/g");
    const tip = within(artifact).getByText(TIP.slice(0, 12));
    // mutation: drop the title -> red
    expect(tip.getAttribute("title")).toBe(TIP);
    fireEvent.click(within(artifact).getByRole("button", { name: "Copy branch name" }));
    fireEvent.click(within(artifact).getByRole("button", { name: "Copy tip commit" }));
    // mutation: copy the wrong text -> red
    expect(writeText.mock.calls.map(([text]) => text)).toEqual(["orca/g", TIP]);
    cleanup();
    const untipped = done(); untipped.summary.acceptance!.tip = null;
    show(untipped);
    // mutation: drop the noTip branch -> red
    expect(line("artifact").textContent).toContain("no accepted tip recorded yet");
    expect(within(line("artifact") as HTMLElement).queryByRole("button", { name: "Copy tip commit" })).toBeNull();
  });

  it("sends no command from any of its buttons (they navigate or copy; an archived group may show them)", () => {
    const value = done(); value.summary.acceptance!.result = "failed";
    value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" }, { state: "conflict" });
    const decisions: GroupDecisionsViewV1 = { schema: "orca-group-decisions-v1", groupId: "g", projectKey: null, pendingCount: 1, tasks: [
      { taskId: "a", runs: [{ runId: "run-a", settled: false, reported: "array", decisions: [], unlanded: [],
        pending: [{ pendingId: "p1", reason: "r", question: "q?", chose: null, undoHow: null, state: "pending" }] }] }] };
    const onCommand = vi.fn();
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={value} decisions={decisions} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    const names = within(card()).getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(["Open Problems", "Go to integration", "Open task a", "Copy branch name", "Copy tip commit"]);
    // Open Problems switches to the Problems tab, and only the selected region is rendered, so it is clicked last.
    for (const name of [...names.slice(1), names[0]!]) fireEvent.click(within(card()).getByRole("button", { name: name! }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toMatch(/^Problems/);
    // mutation: any card button also sends a command (e.g. onOpenProblems calls onCommand) -> red
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("wraps its values and stacks to one column on a narrow screen (≤760px, no sideways scroll)", () => {
    show(done());
    // mutation: drop min-w-0 / wrap-anywhere, or the max-md single column -> red
    for (const name of ["min-w-0", "wrap-anywhere"]) expect(card().classList.contains(name), name).toBe(true);
    expect(card().querySelector("dl")!.classList.contains("max-md:grid-cols-1")).toBe(true);
  });

  it("speaks Chinese", async () => {
    await i18n.changeLanguage("zh");
    try {
      show(done());
      const zh = screen.getByRole("region", { name: "结论" });
      expect(zh.querySelector('[data-conclusion="done"]')!.textContent).toBe("1/1 个任务已完成 · 验收：通过");
      expect(zh.querySelector('[data-conclusion="delivery"]')!.textContent).toBe("留在 orca/g 上；Orca 不合并也不推送");
    } finally { await i18n.changeLanguage("en"); }
  });
});

describe("the Git table's columns (#319 proposal 3)", () => {
  it("keeps the run id off the columns but on the task cell's title, and the full commits on hover", () => {
    const base = "1".repeat(40), landed = "2".repeat(40);
    show(done(view([workItem({})], [run({ runId: "run-a", git: { workspaceMode: "clone", base, landedCommit: landed } })])));
    const table = within(screen.getByRole("region", { name: "Git" })).getByRole("table", { name: "Runs and their landings" });
    expect([...table.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["task", "workspace", "base", "merged commit"]);
    const cells = [...table.querySelectorAll("tbody td")];
    // mutation: drop the title -> red
    expect(cells[0]!.getAttribute("title")).toBe("run-a");
    expect(table.textContent).not.toContain("run-a");
    // mutation: drop either code title -> red
    expect(cells[2]!.querySelector("code")!.getAttribute("title")).toBe(base);
    expect(cells[3]!.querySelector("code")!.getAttribute("title")).toBe(landed);
  });
});

describe("a task's runs are reached from its row (#319 proposal 5)", () => {
  it("has no per-run open button in Results; a task's name opens its detail with its runs", async () => {
    const data = savedGroup(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data))));
    const value = done(view([workItem({ taskId: "a", status: "completed", currentRunId: "run-a", lineageRunIds: ["run-a"] })], [run({ runId: "run-a", state: "settled-recoverable" })]));
    show(value);
    const task = await screen.findByRole("region", { name: "Task results · a" });
    // mutation: restore the per-run button list -> red
    expect(screen.queryByRole("button", { name: /^Open run controls and evidence/ })).toBeNull();
    const open = within(task).getByRole("button", { name: "a" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    // mutation: the task button calls no onOpenTask -> red
    expect(within(screen.getByRole("region", { name: "Task a" })).getByRole("button", { name: "List evidence of run-a" })).toBeTruthy();
    expect(within(task).getByRole("button", { name: "a" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("without a results read, one button opens the newest run in Runs and evidence", () => {
    // Sent in id order ("new" < "old"); the newest is the one created last.
    const value = done(view([], [run({ runId: "new", taskId: "b", state: "settled-recoverable", createdOrdinal: 2 }), run({ runId: "old", state: "settled-recoverable", createdOrdinal: 1 })]));
    show(value);
    // mutation: drop the button, or its view.runs.length condition (it shows for a run-less group) -> red
    fireEvent.click(screen.getByRole("button", { name: "Open runs and evidence" }));
    expect(selected()).toBe("Runs and evidence");
    expect(document.activeElement?.getAttribute("data-run-id")).toBe("new");
    cleanup();
    show(done(view([])));
    expect(screen.queryByRole("button", { name: "Open runs and evidence" })).toBeNull();
  });
});
