// @vitest-environment jsdom
/**
 * Tester #319 (human-agreed proposals 1, 3, 5): a group's Results opens with a conclusion card -- done and accepted, where
 * it delivers, what waits for the person (each line leading to the existing place with its action), the work branch and
 * its tip -- above the Git section; the Git table names each run's workspace, base and merged commit, not the bare run id;
 * a task's runs are reached from its row, not from one "open run" button per run.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { enumText } from "../src/i18n.js";
import { integrationSentence } from "../src/IntegrationScheme.js";
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
const show = (value: GroupViewV1, decisions?: GroupDecisionsViewV1 | { failed: string }) =>
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

  // Review fix 3: the delivery line is the Git section's own sentence (integrationSentence), so it loses no fact (when, method).
  it.each([
    [undefined, "Orca does not merge or push this work; merging into main is the person's."],
    [{ delivery: "keep" } as const, "Orca does not merge or push this work; merging into main is the person's."],
    [{ delivery: "local", trigger: "group", method: "merge", target: "main" } as const, "When the group completes: merge orca/g into the local branch main."],
    [{ delivery: "push-target", trigger: "task", method: "squash", target: "main", remote: "origin" } as const, "After each task: squash orca/g into main on origin and push it there."],
    [{ delivery: "push-branch", trigger: "task", target: "main", remote: "origin" } as const, "After each task: push orca/g to origin; merging it into main is the person's."],
    [{ delivery: "github-pr", trigger: "group", target: "develop", remote: "up" } as const, "When the group completes: push orca/g to up and open one GitHub PR into develop."],
  ])("says where %j delivers in the Git section's own words", (scheme, said) => {
    const value = done(); if (scheme !== undefined) value.integration = integration(scheme);
    show(value);
    // mutation: the card words the scheme itself (drops when / method) -> red
    expect(line("delivery-sentence").textContent).toBe(said);
    expect(said).toBe(integrationSentence(scheme ?? { delivery: "keep" }, "g"));
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

  // Re-review ruling: "Waiting for you" claims no more than the server's needs-you; the merge Orca leaves to the person is
  // a fact of the delivery, so it is said under the delivery sentence.
  it("says a finished keep group's merge is the person's under Delivery, with no button, and not as waiting", () => {
    show(done());
    // mutation: drop the keep merge line -> red
    expect(line("merge").textContent).toBe("Merging orca/g into your main branch is yours; Orca does not do it");
    expect(within(line("delivery") as HTMLElement).queryAllByRole("button")).toEqual([]);
    // mutation: the merge line back among the waiting lines -> red
    expect(line("waiting").textContent).toBe("Nothing");
    cleanup();
    const running = done(); running.summary.state = "running";
    show(running);
    // mutation: drop the `state === "done"` condition -> red
    expect(card().querySelector('[data-conclusion="merge"]')).toBeNull();
  });

  // Tester #365(a) (batch D C4): a kept delivery's files are on the work branch, not in the person's working tree; the card
  // says so, names the tip when the view carries one, gives the commands that list and take the files, and names local
  // delivery as the alternative.
  it("says where a kept delivery's files are and how to take them", () => {
    show(done());
    // mutation: drop the kept lines -> red here.
    expect(line("kept").textContent).toBe("The files are on orca/g (tip abcdef012345), not in your working tree.");
    expect(line("kept-take").textContent).toBe("List them: git diff --name-only HEAD...orca/g · take them: git checkout orca/g -- <paths> · or set local delivery and Orca merges them into a local branch");
    cleanup();
    const noTip = done(); delete noTip.summary.acceptance;
    show(noTip);
    // mutation: always print the tip clause -> red here.
    expect(line("kept").textContent).toBe("The files are on orca/g, not in your working tree.");
    cleanup();
    const pushed = done(); pushed.integration = integration({ delivery: "push-branch", trigger: "task", target: "main", remote: "origin" });
    show(pushed);
    expect(card().querySelector('[data-conclusion="kept"]')).toBeNull();
  });

  // Review fix 3: a done push-branch group and a github-pr group with a ready PR also leave the merge to the person.
  it("says the merge is the person's for a done push-branch group and a ready pull request, and not before", () => {
    const pushed = done(); pushed.integration = integration({ delivery: "push-branch", trigger: "task", target: "main", remote: "origin" });
    show(pushed);
    // mutation: drop the push-branch merge line -> red
    expect(line("merge").textContent).toBe("Merging orca/g into main is yours; Orca only pushes it to origin");
    expect(line("waiting").textContent).toBe("Nothing");
    cleanup();
    const merge = () => card().querySelector('[data-conclusion="merge"]');
    const pushing = done(); pushing.summary.state = "running"; pushing.integration = integration({ delivery: "push-branch", trigger: "task", target: "main", remote: "origin" });
    show(pushing);
    // mutation: drop its `state === "done"` condition -> red
    expect(merge()).toBeNull();
    cleanup();
    const pr = (ready: boolean) => { const value = done(); value.integration = integration({ delivery: "github-pr", trigger: "task", target: "main", remote: "origin" }, { pr: { url: "https://github.com/o/r/pull/7", number: 7, ready } }); return value; };
    show(pr(true));
    // mutation: drop the pull request merge line -> red
    expect(line("merge").textContent).toBe("Merging pull request #7 is yours");
    expect(line("waiting").textContent).toBe("Nothing");
    cleanup();
    show(pr(false));
    // mutation: drop its `ready` condition (a draft is still Orca's to update) -> red
    expect(merge()).toBeNull();
  });

  // Review fix 1: the card never says Nothing while the server's needs-you rule holds; it names what it can.
  const landing = (state: "partial" | "blocked" | "folder-changed" | "folder-unwritable") =>
    ({ state, landedKeys: [], reason: null, detail: null, failedKey: null, movedBeforeAny: 0 as const, resolution: null, at: 1 });
  const placed = (state: GroupPlacementV1["state"]): GroupPlacementV1 => ({ workspaceKind: "dir", state, tip: null, landedTip: null, pending: null,
    changed: [], changedTotal: 0, unwritable: [], unwritableTotal: 0, withheld: [], watch: null, detail: null, resolution: null, at: 1 });
  it.each([
    ["placement folder-changed", (v: GroupViewV1) => { v.summary.placement = placed("folder-changed"); }, "Integration: the folder changed under Orca", "Go to integration"],
    ["placement folder-unwritable", (v: GroupViewV1) => { v.summary.placement = placed("folder-unwritable"); }, "Integration: some files cannot be written into the folder", "Go to integration"],
    ["placement folder-missing", (v: GroupViewV1) => { v.summary.placement = placed("folder-missing"); }, "Integration: the folder is gone or has moved", "Go to integration"],
    ["placement failed", (v: GroupViewV1) => { v.summary.placement = placed("failed"); }, "Integration: writing into the folder failed", "Go to integration"],
    ["multi landing partial", (v: GroupViewV1) => { v.summary.multiDir = { project: "p", dirs: [], landing: landing("partial") }; }, "Integration: some directories landed, then it stopped", "Go to integration"],
    ["multi landing blocked", (v: GroupViewV1) => { v.summary.multiDir = { project: "p", dirs: [], landing: landing("blocked") }; }, "Integration: stopped before any directory landed", "Go to integration"],
    ["multi landing folder-changed", (v: GroupViewV1) => { v.summary.multiDir = { project: "p", dirs: [], landing: landing("folder-changed") }; }, "Integration: a directory's folder changed under Orca", "Go to integration"],
    ["multi landing folder-unwritable", (v: GroupViewV1) => { v.summary.multiDir = { project: "p", dirs: [], landing: landing("folder-unwritable") }; }, "Integration: some files cannot be written into a directory's folder", "Go to integration"],
    ["state blocked", (v: GroupViewV1) => { v.summary.state = "blocked"; }, "The group is blocked", "Open Problems"],
    ["stop handoff-unresolved", (v: GroupViewV1) => { v.summary.stopMode = "handoff"; v.summary.stopState = "handoff-unresolved"; }, `Stop: ${enumText("stopState", "handoff-unresolved")}`, "Open Problems"],
    ["delivered acceptance failed", (v: GroupViewV1) => { v.summary.deliveredAcceptance = { tip: TIP, commit: TIP, result: "failed", commands: [], at: 1, problem: "delivered-acceptance-failed:npm test" }; }, "The acceptance on the delivered commit failed", "Open Problems"],
    ["requirement review problem", (v: GroupViewV1) => { v.summary.requirementReview = { state: "not-passed", rounds: [], autoFixRounds: 0, problem: "requirement-review-not-passed" }; }, "The requirement review did not pass", "Open Problems"],
    ["anything else the server counts", (_v: GroupViewV1) => {}, "Something waits for you", "Open Problems"],
  ])("names %s as waiting, with the way to it", (_name, set, said, button) => {
    const value = done(); value.summary.state = "running"; value.summary.needsYou = true;
    value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" });
    set(value);
    show(value);
    const item = [...line("waiting").querySelectorAll("li")].find((li) => li.textContent?.startsWith(said));
    // mutation: drop this state's line (or the needs-you fallback) -> "Nothing" or no such line, red
    expect(item, line("waiting").textContent ?? "").toBeTruthy();
    expect(within(item as HTMLElement).getByRole("button", { name: button })).toBeTruthy();
  });
  it.each(["paused", "handoff-complete"] as const)("does not list a %s stop (the server's rule: nothing is left to decide)", (stopState) => {
    const value = done(); value.summary.state = "running"; value.summary.stopMode = stopState === "paused" ? "pause" : "handoff"; value.summary.stopState = stopState;
    value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" });
    show(value);
    // mutation: drop the paused / handoff-complete exclusion -> a Stop line, red
    expect(line("waiting").textContent).toBe("Nothing");
  });
  it("adds no needs-you fallback beside a line it could name", () => {
    const value = done(); value.summary.state = "running"; value.summary.placement = placed("folder-missing"); value.summary.needsYou = true;
    show(value);
    // mutation: the fallback shown although a line is named -> red
    expect([...line("waiting").querySelectorAll("li")].map((li) => li.firstChild?.textContent)).toEqual(["Integration: the folder is gone or has moved"]);
  });

  // Review fix 2: a decisions read still loading or failed does not make pending decisions vanish.
  it("counts pending decisions from the summary while the read is loading, and says a failed read failed", () => {
    const value = done(); value.summary.state = "running";
    value.summary.card = { budget: { usedTokens: 0, limitTokens: null }, pendingDecisions: 2, firstFailure: null };
    show(value);
    // mutation: drop the summary.card fallback -> "Nothing", red
    expect(line("waiting").textContent).toBe("2 decisions wait for you");
    cleanup();
    show(value, { failed: "control-unavailable" });
    // mutation: drop the failed-read line -> red
    expect(line("waiting").textContent).toContain("Decisions could not be read (control-unavailable)");
    expect(line("waiting").textContent).toContain("2 decisions wait for you");
    cleanup();
    value.summary.card.pendingDecisions = 0;
    show(value, { failed: "control-unavailable" });
    expect(line("waiting").textContent).toBe("Decisions could not be read (control-unavailable)");
  });
  // Re-review Minor 1: a failed read says nothing about what waits, so it does not stand in for the needs-you fallback.
  it("still says something waits when the group needs you and the only other line is a failed decisions read", () => {
    const value = done(); value.summary.state = "running"; value.summary.needsYou = true;
    value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" });
    show(value, { failed: "control-unavailable" });
    // mutation: the failed-read line counts toward the fallback's check -> no fallback, red
    expect([...line("waiting").querySelectorAll("li")].map((li) => li.firstChild?.textContent))
      .toEqual(["Decisions could not be read (control-unavailable)", "Something waits for you"]);
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
    const untipped = done(); delete untipped.summary.acceptance;
    show(untipped);
    // mutation: drop the noTip branch -> red
    expect(line("artifact").textContent).toContain("no accepted tip recorded yet");
    expect(within(line("artifact") as HTMLElement).queryByRole("button", { name: "Copy tip commit" })).toBeNull();
    cleanup();
    // Review fix 4: an acceptance that is recorded (e.g. not-needed) and has no tip is final; "yet" would promise one.
    const settled = done(); settled.summary.acceptance = { tip: null, result: "not-needed", commands: [], at: 1 };
    show(settled);
    // mutation: say "recorded yet" for a recorded acceptance -> red
    expect(line("artifact").textContent).toContain("no accepted tip");
    expect(line("artifact").textContent).not.toContain("yet");
  });

  it("sends no command from any of its buttons (they navigate or copy; an archived group may show them)", () => {
    const value = done(); value.summary.acceptance!.result = "failed";
    value.integration = integration({ delivery: "local", trigger: "group", method: "merge", target: "main" }, { state: "conflict" });
    const decisions: GroupDecisionsViewV1 = { schema: "orca-group-decisions-v1", groupId: "g", projectKey: null, pendingCount: 1, tasks: [
      { taskId: "a", runs: [{ runId: "run-a", settled: false, reported: "array", decisions: [], unlanded: [],
        pending: [{ pendingId: "p1", reason: "r", question: "q?", chose: null, undoHow: null, state: "pending" }] }] }] };
    const onCommand = vi.fn();
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "results", taskId: null, runId: null }} view={value} decisions={decisions} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    const buttons = within(card()).getAllByRole("button");
    const names = buttons.map((button) => button.textContent);
    expect(names).toEqual(["Open Problems", "Go to integration", "Open task a", "Copy branch name", "Copy tip commit"]);
    // Review fix 5: each carries the structural marker archiveGroup.test.tsx excludes by (not its English name).
    // mutation: drop the marker from any card button -> red
    for (const button of buttons) expect(button.hasAttribute("data-no-command"), button.textContent ?? "").toBe(true);
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
      expect(zh.querySelector('[data-conclusion="delivery-sentence"]')!.textContent).toBe(integrationSentence({ delivery: "keep" }, "g"));
      expect(zh.querySelector('[data-conclusion="merge"]')!.textContent).toBe("把 orca/g 合并进你的主分支由你来做；Orca 不做");
      expect(zh.querySelector('[data-conclusion="waiting"]')!.textContent).toBe("没有");
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
