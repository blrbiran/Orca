// @vitest-environment jsdom
/**
 * Project filtering spec §6 and §11 R2 (plan Task 8): the person's unsent detail inputs -- requirement answers and
 * glossary/ADR choices, split feedback, a raised token limit, a decision correction and a new requirement per concrete
 * target -- live in an App-owned store keyed by their owner. They outlive the detail that shows them (closure, scope
 * switch), never appear under another owner, never put a stale round's ids into a payload, and are cleared by a success
 * only when unchanged since they were submitted. Also (Task 4 review M1, spec §8): an All-projects target that is no
 * longer held counts as unchosen in both creation forms. Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { rowKey } from "../src/DecisionList.js";
import { PROJECT_VIEW_KEY } from "../src/projectScope.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { answerKey, clearIfUnchanged, correctionKey, EMPTY_DRAFTS, feedbackKey, limitKey, setDraft } from "../src/detailDrafts.js";
import { requirementView } from "./fixtures/requirement.js";
import type { RequirementFixtureState } from "./fixtures/requirement.js";
import { ALPHA, BETA, TWO_PROJECTS, decisionRow, installFakePanel } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
beforeEach(() => { panel = installFakePanel(); });
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const projectSelect = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
const selectedText = (): string | undefined => projectSelect().selectedOptions[0]?.textContent ?? undefined;
const ready = async (): Promise<void> => { await screen.findByRole("combobox", { name: "Project" }); };
const switchTo = async (projectKey: string, name: string): Promise<void> => {
  fireEvent.change(projectSelect(), { target: { value: projectKey } });
  await waitFor(() => expect(selectedText()).toBe(name));
};
const chooseAll = async (): Promise<void> => {
  fireEvent.change(projectSelect(), { target: { value: projectSelect().options[0]!.value } });
  await waitFor(() => expect(selectedText()).toBe("All projects"));
};

/** A requirement view of the fixture, owned by `repoId`, as group `groupId` and requirement `requirementId`. */
function owned(groupId: string, repoId: string, requirementId: string, state: RequirementFixtureState, budgetExhausted = false): RequirementViewV1 {
  const base = requirementView(state);
  const requirement = { ...base.summary.requirement!, ...(budgetExhausted ? { waiting: "requirement-budget-exhausted" as const } : {}) };
  return { ...base, epoch: "epoch-a", summary: { ...base.summary, groupId, repoId, requirement }, requirement: { ...base.requirement, repoId, requirementId } };
}
/**
 * ra (alpha, round 1 awaiting answers), ra2 (alpha, draft 1 awaiting review, budget exhausted), and beta's twins rb and
 * rb2 with the SAME round, draft and entry ids -- so any key that forgets its owner shows alpha's values under beta.
 * Decisions alpha/d1 and beta/d1 share their id for the same reason.
 */
function seed(): void {
  const views = [
    owned("ra", ALPHA, "req-a", "awaiting-answers"), owned("ra2", ALPHA, "req-a2", "awaiting-review", true),
    owned("rb", BETA, "req-b", "awaiting-answers"), owned("rb2", BETA, "req-b2", "awaiting-review", true),
  ];
  for (const view of views) panel.requirementViews[view.summary.groupId] = view;
  panel.summary = { ...panel.summary, groups: views.map((view) => view.summary) };
  panel.todo = [decisionRow("alpha", "d1"), decisionRow("beta", "d1")];
  for (const row of panel.todo) {
    panel.decisions[rowKey(row)] = { id: row.id, question: `question of ${row.projectKey}/${row.id}`, chose: "c", because: "b", alternatives: [] };
  }
}

const requirementNav = async () => within(await screen.findByRole("navigation", { name: "Requirement list" }));
const article = (): HTMLElement => screen.getByRole("article", { name: "markdown-export" });
/** Open requirement `groupId` and wait until its own view is the one shown (its round form, or its draft review). */
const openRequirement = async (groupId: string, shows: "answers" | "review"): Promise<HTMLElement> => {
  fireEvent.click(await (await requirementNav()).findByRole("button", { name: new RegExp(`^${groupId} · `) }));
  await waitFor(() => expect(panel.requests).toContain(`GET /api/control/groups/${groupId}/requirement`));
  await waitFor(() => {
    const shown = article();
    if (shows === "answers") expect(within(shown).getByRole("button", { name: "Send answers" })).toBeTruthy();
    else expect(within(shown).getByRole("textbox", { name: "Feedback" })).toBeTruthy();
  });
  // Only the chosen requirement's detail is on screen (the panel shows one at a time).
  expect(screen.getAllByRole("article", { name: "markdown-export" })).toHaveLength(1);
  return article();
};
const questionGroup = (scope: HTMLElement, id: string): HTMLElement => within(scope).getByRole("group", { name: new RegExp(`^${id.replace(/\./g, "\\.")} `) });
const radio = (scope: HTMLElement, name: string): HTMLInputElement => within(scope).getByRole("radio", { name }) as HTMLInputElement;
const raiseForm = (scope: HTMLElement): HTMLElement => within(scope).getByRole("form", { name: "Raise the limit" });
const limitBox = (scope: HTMLElement): HTMLInputElement => within(raiseForm(scope)).getByRole("textbox", { name: "Token limit" }) as HTMLInputElement;
const feedbackBox = (scope: HTMLElement): HTMLTextAreaElement => within(scope).getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement;

const openDecision = async (projectKey: string): Promise<HTMLElement> => {
  const button = (await screen.findAllByRole("button")).find((candidate) => candidate.closest(".decision-list") !== null && candidate.textContent?.includes("d1"));
  fireEvent.click(button!);
  await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(`question of ${projectKey}/d1`));
  return document.querySelector(".decision-detail") as HTMLElement;
};
const becauseBox = (scope: HTMLElement): HTMLTextAreaElement => within(scope).getByRole("textbox", { name: "Because" }) as HTMLTextAreaElement;
const kindSelect = (scope: HTMLElement): HTMLSelectElement => within(scope).getByRole("combobox", { name: "Kind" }) as HTMLSelectElement;

describe("detail drafts outlive the detail, keyed by owner (spec §11 R2)", () => {
  it("1: alpha's answers, choices, feedback, limit and correction survive Beta and come back; Beta shows its own defaults", async () => {
    seed();
    render(<App />);
    await ready();
    // Alpha: an own answer for Q1 and a rejected glossary entry on ra.
    let shown = await openRequirement("ra", "answers");
    fireEvent.click(radio(questionGroup(shown, "R1.Q1"), "Own answer"));
    fireEvent.change(within(questionGroup(shown, "R1.Q1")).getByRole("textbox"), { target: { value: "alpha text" } });
    fireEvent.click(radio(questionGroup(shown, "R1.G1"), "Reject"));
    // Split feedback and a raised limit on ra2 (opening it closes ra).
    shown = await openRequirement("ra2", "review");
    fireEvent.change(feedbackBox(shown), { target: { value: "alpha feedback" } });
    fireEvent.change(limitBox(shown), { target: { value: "12000000" } });
    // A correction of alpha/d1.
    let detail = await openDecision("alpha");
    fireEvent.change(becauseBox(detail), { target: { value: "alpha because" } });
    fireEvent.change(kindSelect(detail), { target: { value: "not_my_taste" } });

    await switchTo("beta", "Beta");
    await waitFor(() => expect(screen.queryByRole("article", { name: "markdown-export" })).toBeNull());
    expect(screen.queryByTestId("decision-question")).toBeNull();
    // Beta's twins (same round, draft and entry ids) show their own defaults.
    shown = await openRequirement("rb", "answers");
    expect(within(shown).getAllByRole("radio", { name: "Use recommended", checked: true })).toHaveLength(2);
    expect(within(shown).getAllByRole("radio", { name: "Accept", checked: true })).toHaveLength(2);
    expect(within(shown).queryByRole("textbox")).toBeNull();
    shown = await openRequirement("rb2", "review");
    expect(feedbackBox(shown).value).toBe("");
    expect(limitBox(shown).value).toBe("10,000,000");
    detail = await openDecision("beta");
    expect(becauseBox(detail).value).toBe("");
    expect(kindSelect(detail).value).toBe("wrong");

    await switchTo("alpha", "Alpha");
    await waitFor(() => expect(screen.queryByTestId("decision-question")).toBeNull());
    shown = await openRequirement("ra2", "review");
    expect(feedbackBox(shown).value).toBe("alpha feedback");
    expect(limitBox(shown).value).toBe("12,000,000");
    detail = await openDecision("alpha");
    expect(becauseBox(detail).value).toBe("alpha because");
    expect(kindSelect(detail).value).toBe("not_my_taste");
    shown = await openRequirement("ra", "answers");
    expect(radio(questionGroup(shown, "R1.Q1"), "Own answer").checked).toBe(true);
    expect((within(questionGroup(shown, "R1.Q1")).getByRole("textbox") as HTMLTextAreaElement).value).toBe("alpha text");
    expect(radio(questionGroup(shown, "R1.Q2"), "Use recommended").checked).toBe(true);
    expect(radio(questionGroup(shown, "R1.G1"), "Reject").checked).toBe(true);
    expect(radio(questionGroup(shown, "R1.ADR1"), "Accept").checked).toBe(true);

    // The restored draft is what is sent, over every current id -- including those the person never touched.
    fireEvent.click(within(shown).getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(panel.posts.some((post) => post.url === "/api/control/groups/ra/requirement/answer")).toBe(true));
    const sent = panel.posts.find((post) => post.url === "/api/control/groups/ra/requirement/answer")!.body as { payload: unknown };
    expect(sent.payload).toEqual({
      roundNo: 1, answers: [{ id: "R1.Q1", kind: "text", text: "alpha text" }, { id: "R1.Q2", kind: "recommended" }],
      glossaryDecisions: [{ id: "R1.G1", accept: false }], adrDecisions: [{ id: "R1.ADR1", accept: true }],
    });
  });

  it("2: a round that advanced while closed shows the new round with defaults, and the old round's draft is never sent", async () => {
    seed();
    render(<App />);
    await ready();
    let shown = await openRequirement("ra", "answers");
    fireEvent.click(radio(questionGroup(shown, "R1.Q1"), "Own answer"));
    fireEvent.change(within(questionGroup(shown, "R1.Q1")).getByRole("textbox"), { target: { value: "round one text" } });
    fireEvent.click(radio(questionGroup(shown, "R1.G1"), "Reject"));
    await openRequirement("ra2", "review");

    // While ra is closed, round 1 is answered elsewhere and round 2 asks new questions.
    const old = panel.requirementViews["ra"]!;
    const answered = owned("ra", ALPHA, "req-a", "answered").rounds[0]!;
    const first = old.rounds[0]!.result!;
    const result = { ...first, questions: [{ ...first.questions[0]!, id: "R2.Q1" }], glossary: [{ ...first.glossary[0]!, id: "R2.G1" }], adrs: [] };
    panel.requirementViews["ra"] = { ...old, rounds: [answered, { ...old.rounds[0]!, roundNo: 2, result }] };

    fireEvent.click((await requirementNav()).getByRole("button", { name: /^ra · / }));
    await waitFor(() => expect(within(article()).queryByRole("group", { name: /^R2\.Q1 / })).not.toBeNull());
    shown = article();
    // Only the current round is editable: the answered round offers no form for the old draft.
    expect(within(shown).getAllByRole("button", { name: "Send answers" })).toHaveLength(1);
    expect(radio(questionGroup(shown, "R2.Q1"), "Use recommended").checked).toBe(true);
    expect(radio(questionGroup(shown, "R2.G1"), "Accept").checked).toBe(true);
    expect(within(shown).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(shown).getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(panel.posts.some((post) => post.url === "/api/control/groups/ra/requirement/answer")).toBe(true));
    const sent = panel.posts.find((post) => post.url === "/api/control/groups/ra/requirement/answer")!.body as { payload: unknown };
    expect(sent.payload).toEqual({ roundNo: 2, answers: [{ id: "R2.Q1", kind: "recommended" }], glossaryDecisions: [{ id: "R2.G1", accept: true }], adrDecisions: [] });
  });

  it("3: a success clears only an unchanged draft -- text edited while it was in flight survives -- and a refusal keeps it", async () => {
    seed();
    let release!: () => void;
    let hold: Promise<void> | null = new Promise<void>((resolve) => { release = resolve; });
    let refuse = false;
    const base = panel.onPost;
    panel.onPost = async (url, body) => {
      if (url !== "/api/control/groups/ra2/requirement/feedback") return base(url, body);
      if (hold !== null) await hold;
      if (refuse) return json({ error: { code: "revision-mismatch", message: "revision-mismatch", commandRevision: 3, evidenceIds: [], retryable: false } }, 409);
      return base(url, body);
    };
    const feedbackPosts = (): number => panel.posts.filter((post) => post.url === "/api/control/groups/ra2/requirement/feedback").length;
    const settled = async (count: number): Promise<void> => {
      await waitFor(() => expect(feedbackPosts()).toBe(count));
      // The command's answer is followed by a re-read of the requirement; let it land.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    };
    render(<App />);
    await ready();
    const shown = await openRequirement("ra2", "review");

    // Late success: "first" is sent and held; the person edits to "second"; the success must not clear "second".
    fireEvent.change(feedbackBox(shown), { target: { value: "first" } });
    fireEvent.click(within(shown).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(feedbackPosts()).toBe(1));
    expect((panel.posts.at(-1)!.body as { payload: { feedback: string } }).payload.feedback).toBe("first");
    fireEvent.change(feedbackBox(article()), { target: { value: "second" } });
    await act(async () => { release(); });
    await settled(1);
    expect(feedbackBox(article()).value).toBe("second");

    // An unchanged draft is cleared by its success.
    hold = null;
    fireEvent.click(within(article()).getByRole("button", { name: "Send back" }));
    await settled(2);
    await waitFor(() => expect(feedbackBox(article()).value).toBe(""));

    // A refusal keeps the draft as it was.
    refuse = true;
    fireEvent.change(feedbackBox(article()), { target: { value: "kept" } });
    fireEvent.click(within(article()).getByRole("button", { name: "Send back" }));
    await settled(3);
    await within(screen.getByRole("region", { name: "Requirements" })).findByText(/^revision-mismatch/);
    expect(feedbackBox(article()).value).toBe("kept");
  });

  it("4: in All projects a new requirement's text belongs to its target, and survives leaving All and coming back", async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, "all");
    seed();
    render(<App />);
    await ready();
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    const form = (): HTMLElement => screen.getByRole("form", { name: "New requirement" });
    const target = (): HTMLSelectElement => within(form()).getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
    const idea = (): HTMLTextAreaElement => within(form()).getByRole("textbox", { name: "Idea" }) as HTMLTextAreaElement;
    await waitFor(() => expect(target().value).toBe(""));
    fireEvent.change(target(), { target: { value: ALPHA } });
    fireEvent.change(idea(), { target: { value: "idea A" } });
    fireEvent.change(target(), { target: { value: BETA } });
    expect(idea().value).toBe("");
    fireEvent.change(idea(), { target: { value: "idea B" } });
    fireEvent.change(target(), { target: { value: ALPHA } });
    expect(idea().value).toBe("idea A");

    // Project Alpha's form is alpha's draft; back in All the target is unchosen again and shows no project's text.
    await switchTo("alpha", "Alpha");
    await waitFor(() => expect(idea().value).toBe("idea A"));
    await chooseAll();
    await waitFor(() => expect(target().value).toBe(""));
    expect(idea().value).toBe("");
    fireEvent.change(target(), { target: { value: ALPHA } });
    expect(idea().value).toBe("idea A");
    fireEvent.change(target(), { target: { value: BETA } });
    expect(idea().value).toBe("idea B");
  });
});

describe("text typed in All before a target is chosen (fix round 1, I1 and ruling M2)", () => {
  it("4b: the next explicit choice takes it only into a draft-less target and drops it either way; it never resurfaces", async () => {
    const GAMMA = "gamma-33333333";
    panel.config = { ...panel.config, repositories: [...panel.config.repositories, { repoId: GAMMA, displayName: "gamma" }] };
    panel.projects = { status: 200, body: { projects: [...TWO_PROJECTS, { projectKey: "gamma", name: "Gamma", controlRepoId: GAMMA, editable: true }] } };
    window.localStorage.setItem(PROJECT_VIEW_KEY, "all");
    render(<App />);
    await ready();
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    const form = (): HTMLElement => screen.getByRole("form", { name: "New requirement" });
    const target = (): HTMLSelectElement => within(form()).getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
    const idea = (): HTMLTextAreaElement => within(form()).getByRole("textbox", { name: "Idea" }) as HTMLTextAreaElement;
    await waitFor(() => expect(Array.from(target().options).map((option) => option.value)).toEqual(["", ALPHA, BETA, GAMMA]));
    expect(target().value).toBe("");

    fireEvent.change(idea(), { target: { value: "loose" } });
    fireEvent.change(target(), { target: { value: ALPHA } });
    expect(idea().value).toBe("loose");
    fireEvent.change(idea(), { target: { value: "alpha idea" } });
    // Alpha took the loose text; it is gone, so Beta starts empty.
    fireEvent.change(target(), { target: { value: BETA } });
    expect(idea().value).toBe("");
    fireEvent.change(idea(), { target: { value: "beta idea" } });

    await switchTo("alpha", "Alpha");
    await chooseAll();
    await waitFor(() => expect(target().value).toBe(""));
    expect(idea().value).toBe("");
    // Beta has its own draft: the loose text does not overwrite it, and is dropped.
    fireEvent.change(idea(), { target: { value: "loose2" } });
    fireEvent.change(target(), { target: { value: BETA } });
    expect(idea().value).toBe("beta idea");
    // A fresh target shows neither loose text nor another target's draft.
    fireEvent.change(target(), { target: { value: GAMMA } });
    expect(idea().value).toBe("");
    fireEvent.change(target(), { target: { value: ALPHA } });
    expect(idea().value).toBe("alpha idea");
    await switchTo("alpha", "Alpha");
    await chooseAll();
    await waitFor(() => expect(target().value).toBe(""));
    expect(idea().value).toBe("");
  });
});

describe("an All-projects target that is no longer held is unchosen (Task 4 review M1, spec §8)", () => {
  it("5: Beta chosen in both forms, then the project re-read drops beta: neither form can submit, and nothing is posted", async () => {
    const gamma = { projectKey: "gamma", name: "Gamma", controlRepoId: null, editable: true };
    panel.projects = { status: 200, body: { projects: [...TWO_PROJECTS, gamma] } };
    window.localStorage.setItem(PROJECT_VIEW_KEY, "all");
    render(<App />);
    await ready();
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    const importRegion = (): HTMLElement => screen.getByRole("region", { name: "Import plan" });
    const form = (): HTMLElement => screen.getByRole("form", { name: "New requirement" });
    const targetIn = (scope: HTMLElement): HTMLSelectElement => within(scope).getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
    const importButton = (): HTMLButtonElement => within(importRegion()).getByRole("button", { name: "Import plan" }) as HTMLButtonElement;
    const startButton = (): HTMLButtonElement => within(form()).getByRole("button", { name: "Start clarifying" }) as HTMLButtonElement;
    await waitFor(() => expect(targetIn(importRegion()).value).toBe(""));
    fireEvent.change(targetIn(importRegion()), { target: { value: BETA } });
    fireEvent.change(targetIn(form()), { target: { value: BETA } });
    fireEvent.change(within(form()).getByRole("textbox", { name: "Idea" }), { target: { value: "export notes" } });
    expect(importButton().disabled).toBe(false);
    expect(startButton().disabled).toBe(false);

    panel.projects = { status: 200, body: { projects: [TWO_PROJECTS[0]!, gamma] } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(Array.from(targetIn(form()).options).map((option) => option.value)).toEqual(["", ALPHA]));
    expect(selectedText()).toBe("All projects");
    expect(targetIn(importRegion()).value).toBe("");
    expect(targetIn(form()).value).toBe("");
    expect(importButton().disabled).toBe(true);
    expect(startButton().disabled).toBe(true);
    fireEvent.click(importButton());
    fireEvent.click(startButton());
    fireEvent.submit(form());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(panel.posts.map((post) => post.url)).toEqual([]);

    // Fix round 1, ruling M1: a target seen unheld is forgotten -- beta listed again is not chosen again without a choice.
    panel.projects = { status: 200, body: { projects: [...TWO_PROJECTS, gamma] } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(Array.from(targetIn(form()).options).map((option) => option.value)).toEqual(["", ALPHA, BETA]));
    await waitFor(() => expect(Array.from(targetIn(importRegion()).options).map((option) => option.value)).toEqual(["", ALPHA, BETA]));
    expect(targetIn(importRegion()).value).toBe("");
    expect(targetIn(form()).value).toBe("");
    expect(importButton().disabled).toBe(true);
    expect(startButton().disabled).toBe(true);
    fireEvent.click(importButton());
    fireEvent.click(startButton());
    fireEvent.submit(form());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(panel.posts.map((post) => post.url)).toEqual([]);
  });
});

describe("the draft store itself (spec §11 R2)", () => {
  it("clears a draft only when it still equals what was submitted, and leaves an absent one as the same object", () => {
    const key = feedbackKey("repo", "g", "req", 1);
    const stored = setDraft(EMPTY_DRAFTS, "feedback", key, "sent text");
    expect(clearIfUnchanged(stored, "feedback", key, "sent text").feedback).toEqual({});
    expect(clearIfUnchanged(stored, "feedback", key, "older text").feedback).toEqual({ [key]: "sent text" });
    expect(clearIfUnchanged(stored, "feedback", "other", "sent text")).toBe(stored);
    const answer = { choice: { Q1: { kind: "text" as const, text: "a" } }, decisions: { G1: false } };
    const withAnswer = setDraft(EMPTY_DRAFTS, "answer", "k", answer);
    expect(clearIfUnchanged(withAnswer, "answer", "k", { choice: { Q1: { kind: "text", text: "b" } }, decisions: { G1: false } })).toBe(withAnswer);
    expect(clearIfUnchanged(withAnswer, "answer", "k", structuredClone(answer)).answer).toEqual({});
    // Setting one slot leaves the store it came from untouched.
    expect(EMPTY_DRAFTS.feedback).toEqual({});
  });

  it("keys are injective over their owner's parts", () => {
    expect(answerKey("a,b", "c", "r", 1)).not.toBe(answerKey("a", "b,c", "r", 1));
    expect(answerKey("a", "g", "r", 1)).not.toBe(answerKey("b", "g", "r", 1));
    expect(feedbackKey("a\",\"b", "c", "r", 1)).not.toBe(feedbackKey("a", "b\",\"c", "r", 1));
    expect(limitKey("a,b", "c")).not.toBe(limitKey("a", "b,c"));
    expect(correctionKey("alpha", "d1")).not.toBe(correctionKey("beta", "d1"));
  });
});
