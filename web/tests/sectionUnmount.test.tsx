// @vitest-environment jsdom
/**
 * Ruling R1 (#219; plan docs/superpowers/plans/2026-11-10-tester-followup-b.md T8; human, session of 2026-11-10:
 * "#219 同意改裁定"): a section that is not the current one is unmounted, and so is a Settings category that is not
 * shown -- the page holds one copy of what the person sees, so a find-in-page, a screen reader or a label lookup meets
 * only the current page. What the person typed and has not sent survives leaving: the half-filled revision of a
 * clarification round and the import form's target and plan path live in App's draft stores. Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { FlowSettingsReadV1, RequirementViewV1 } from "../src/controlTypes.js";
import { PROJECT_VIEW_KEY } from "../src/projectScope.js";
import { requirementView } from "./fixtures/requirement.js";
import type { RequirementFixtureState } from "./fixtures/requirement.js";
import { pickOption, shownText } from "./selectControl.js";
import { ALPHA, TWO_PROJECTS, installFakePanel } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";
import { openImportMenu } from "./fixtures/newMenu.js";

const S = <T,>(value: T) => ({ value, source: "builtin" as const, lockedBy: null });
/** A global flow settings read, so the Flows category renders its fields (among them the skill sources). */
const FLOWS: FlowSettingsReadV1 = {
  effects: { local: S("confirm"), cost: S("confirm"), external: S("confirm"), irreversible: S("confirm") },
  rerunReview: S("review"), rerunAskTimeoutSeconds: S(300), roles: S({}), allowedSkillSources: S(null), budgets: { tokensPerRun: S(2_000_000) }, paramDefaults: {}, locks: [],
} as FlowSettingsReadV1;
const SKILL_SOURCES = "Allowed skill sources (one per line)";
const IDEA = "Let people take a note out as Markdown.";

let panel: FakePanel;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  panel = installFakePanel();
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) === "/api/control/flows/settings" && (init?.method ?? "GET") === "GET") {
      panel.requests.push("GET /api/control/flows/settings");
      return new Response(JSON.stringify(FLOWS), { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(input, init);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); window.location.hash = ""; });

/** The fixture's requirement, held by alpha as group `ra`. */
function seed(state: RequirementFixtureState): RequirementViewV1 {
  const base = requirementView(state);
  const view = { ...base, epoch: "epoch-a", summary: { ...base.summary, groupId: "ra", repoId: ALPHA }, requirement: { ...base.requirement, repoId: ALPHA } };
  panel.requirementViews.ra = view;
  panel.summary = { ...panel.summary, groups: [view.summary] };
  return view;
}
/** Opens `ra` from the Requirements list (a #requirements/<id> link needs the overview read, which this fake does not serve). */
async function openRequirement(): Promise<void> {
  await go("#requirements");
  fireEvent.click(await within(await screen.findByRole("navigation", { name: "Requirement list" })).findByRole("button", { name: /^ra · / }));
}
async function go(hash: string): Promise<void> { await act(async () => { window.location.hash = hash; window.dispatchEvent(new Event("hashchange")); }); }
const pane = (section: string): Element => document.querySelector(`[data-section="${section}"]`)!;

describe("a section that is not the current one is not in the page (R1, #219)", () => {
  it("on #requirements holds no Settings field, and the requirement's idea is one node", async () => {
    seed("awaiting-answers");
    render(<App />);
    await openRequirement();
    await screen.findByRole("article", { name: "markdown-export" });
    // mutation: SectionPane renders its children whatever the active section -> the hidden Flows category is in the page, red
    expect(document.body.textContent).not.toContain(SKILL_SOURCES);
    expect(document.querySelectorAll(`[aria-label="${SKILL_SOURCES}"]`)).toHaveLength(0);
    // mutation: keep the Overview / Task control panes mounted -> the idea is read by every copy of the page, red
    expect(screen.getAllByText(IDEA)).toHaveLength(1);
    expect(pane("settings").childElementCount).toBe(0);
    // Not vacuous: the same fixture does render the field where it belongs, once.
    await go("#settings/flows");
    await waitFor(() => expect(document.querySelectorAll(`[aria-label="${SKILL_SOURCES}"]`)).toHaveLength(1));
    expect(screen.queryByText(IDEA)).toBeNull();
  });

  it("on #settings shows only the open category, and none of the global ones on the project's", async () => {
    window.location.hash = "#settings/appearance";
    render(<App />);
    await screen.findByRole("navigation", { name: "Settings categories" });
    // mutation: SettingsCategoryPane renders every category's children -> the Flows field is in the Appearance page, red
    await waitFor(() => expect(panel.requests.length).toBeGreaterThan(0));
    expect(document.querySelectorAll(`[aria-label="${SKILL_SOURCES}"]`)).toHaveLength(0);
    expect(document.querySelectorAll(".settings-category > *")).not.toHaveLength(0);
    expect([...document.querySelectorAll(".settings-category")].filter((el) => el.childElementCount > 0).map((el) => el.getAttribute("data-category"))).toEqual(["appearance"]);
    await go("#settings/project");
    // mutation: render the global settings region on the project category -> its refusal line and scope text show there, red
    expect(screen.queryByRole("region", { name: "Global settings" })).toBeNull();
  });
});

describe("unsent input survives leaving its section (R1, #219)", () => {
  it("keeps a half-filled revision of an answered round", async () => {
    seed("answered");
    render(<App />);
    await openRequirement();
    fireEvent.click(await screen.findByRole("button", { name: "Revise this round" }));
    const form = (): HTMLElement => screen.getByRole("form", { name: "Revise round 1" });
    const q1 = (): HTMLElement => within(form()).getByRole("group", { name: "R1.Q1 Which Markdown flavour?" });
    fireEvent.click(within(q1()).getByRole("radio", { name: "Own answer" }));
    fireEvent.change(within(form()).getByRole("textbox", { name: "R1.Q1: your own answer" }), { target: { value: "GFM" } });
    fireEvent.change(within(form()).getByRole("textbox", { name: "Why revise (optional)" }), { target: { value: "tables matter" } });
    await go("#overview");
    expect(screen.queryByRole("form", { name: "Revise round 1" })).toBeNull();
    await go("#requirements");
    // mutation: ReviseRound keeps its form in its own state -> back on the page the form is closed and empty, red
    expect((within(await screen.findByRole("form", { name: "Revise round 1" })).getByRole("textbox", { name: "R1.Q1: your own answer" }) as HTMLTextAreaElement).value).toBe("GFM");
    expect((within(form()).getByRole("textbox", { name: "Why revise (optional)" }) as HTMLTextAreaElement).value).toBe("tables matter");
    // Cancel discards it: the next visit opens no form.
    fireEvent.click(within(form()).getByRole("button", { name: "Cancel" }));
    await go("#overview");
    await go("#requirements");
    await screen.findByRole("button", { name: "Revise this round" });
    expect(screen.queryByRole("form", { name: "Revise round 1" })).toBeNull();
  });

  it("keeps the new requirement's text typed in All projects before a target, and the target once chosen", async () => {
    localStorage.setItem(PROJECT_VIEW_KEY, "all");
    window.location.hash = "#requirements";
    render(<App />);
    const form = (): HTMLElement => screen.getByRole("form", { name: "New requirement" });
    const idea = (): HTMLTextAreaElement => within(form()).getByRole("textbox", { name: "Idea" }) as HTMLTextAreaElement;
    const target = (): HTMLElement => within(form()).getByRole("combobox", { name: "Repository" });
    await screen.findByRole("form", { name: "New requirement" });
    fireEvent.change(idea(), { target: { value: "loose idea" } });
    await go("#overview");
    await go("#requirements");
    // mutation: NewRequirement keeps text typed before a target in its own state -> the idea is empty again, red
    expect(idea().value).toBe("loose idea");
    await pickOption(target(), "Beta");
    await go("#overview");
    await go("#requirements");
    // mutation: NewRequirement keeps the All-projects target in its own state -> "Choose a repository" again, red
    expect(shownText(target())).toBe("Beta");
    expect(idea().value).toBe("loose idea");
  });

  it("keeps the import form's target and plan path", async () => {
    // The register-a-path field is offered only when the project list is editable (App.tsx onRegisterPlan).
    panel.projects = { status: 200, body: { projects: TWO_PROJECTS, editable: true } };
    localStorage.setItem(PROJECT_VIEW_KEY, "all");
    window.location.hash = "#tasks";
    render(<App />);
    const region = (): HTMLElement => {
      // Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- #306: Import a plan is an item of the Tasks page's "New" menu now, not a button of its own.
      if (screen.queryByRole("region", { name: "Import plan" }) === null) openImportMenu();
      return screen.getByRole("region", { name: "Import plan" });
    };
    // Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- #306: Import a plan is an item of the Tasks page's "New" menu now, not a button of its own.
    await screen.findByRole("button", { name: "New" });
    await pickOption(within(region()).getByRole("combobox", { name: "Repository" }), "Alpha");
    const path = (): HTMLInputElement => within(region()).getByRole("textbox", { name: /^Register a plan file/ }) as HTMLInputElement;
    fireEvent.change(path(), { target: { value: "plans/half.json" } });
    await go("#overview");
    expect(screen.queryByRole("region", { name: "Import plan" })).toBeNull();
    await go("#tasks");
    // mutation: ImportForm / RegisterPlanForm keep target and path in their own state -> a fresh form, red
    expect(shownText(within(region()).getByRole("combobox", { name: "Repository" }))).toBe("Alpha");
    expect(path().value).toBe("plans/half.json");
  });

  it("forgets the import form's All-projects target when the scope changes, as the remounted form used to", async () => {
    localStorage.setItem(PROJECT_VIEW_KEY, "all");
    window.location.hash = "#tasks";
    render(<App />);
    const region = (): HTMLElement => {
      // Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- #306: Import a plan is an item of the Tasks page's "New" menu now, not a button of its own.
      if (screen.queryByRole("region", { name: "Import plan" }) === null) openImportMenu();
      return screen.getByRole("region", { name: "Import plan" });
    };
    const projectSelect = (): HTMLElement => screen.getByRole("combobox", { name: "Project" });
    // Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- #306: Import a plan is an item of the Tasks page's "New" menu now, not a button of its own.
    await screen.findByRole("button", { name: "New" });
    await pickOption(within(region()).getByRole("combobox", { name: "Repository" }), "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await pickOption(projectSelect(), "Alpha");
    await waitFor(() => expect(shownText(projectSelect())).toBe("Alpha"));
    await pickOption(projectSelect(), "All projects");
    await waitFor(() => expect(shownText(projectSelect())).toBe("All projects"));
    // mutation: App keeps the import target across a scope change -> Beta is still chosen in the new All scope, red
    expect(shownText(within(region()).getByRole("combobox", { name: "Repository" }))).toBe("Choose a repository");
  });

  it("does not reopen the import dialog an Overview link opened once its section was left", async () => {
    window.location.hash = "#overview";
    render(<App />);
    // Ruling (2026-11-12, tester follow-up F): #81 「要收起来」 moved Overview's Import plan into its "More" menu.
    fireEvent.click(await within(await screen.findByRole("region", { name: "Overview" })).findByRole("button", { name: "More" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Import plan" }));
    await screen.findByRole("region", { name: "Import plan" });
    await go("#overview");
    await go("#tasks");
    // Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- #306: Import a plan is an item of the Tasks page's "New" menu now, not a button of its own.
    await screen.findByRole("button", { name: "New" });
    // mutation: keep App's overview focus after its section is left -> the remounted Task control reopens the dialog, red
    expect(screen.queryByRole("region", { name: "Import plan" })).toBeNull();
  });
});
