// @vitest-environment jsdom
/**
 * Spec 2026-10-08 §2.2(d), §2.3: a refusal is shown where the person acted. A group command's refusal is at the top of
 * that group's view, above its actions; it stays while another group is used and goes with the next successful command
 * of the same group. An import's refusal is inside the import form, the plan's problems one per line, in English and
 * Chinese. The panel's own line is not used for either. Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { UNCERTAIN_COMMANDS_KEY } from "../src/controlApi.js";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, commandRevision: 6, evidenceIds: [], retryable: false } }, status);
const success = (): Response => json({ schema: "orca-command-success-v1", commandRevision: 7 });

/** Fix round 1: the fake panel has no command lookup route; a test that needs one sets this. */
let lookup: ((url: string) => Promise<Response>) | null = null;

beforeEach(() => {
  lookup = null;
  panel = installFakePanel();
  const fake = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, request?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (lookup !== null && /^\/api\/control\/groups\/[^/]+\/commands\/[^/]+$/.test(url)) {
      panel.requests.push(`GET ${url}`);
      return lookup(url);
    }
    return fake(input, request);
  }) as typeof fetch;
  const g1 = groupSummary("g1", ALPHA), g2 = groupSummary("g2", ALPHA);
  panel.summary = { ...panel.summary, groups: [g1, g2] };
  panel.groupViews = { g1: planGroupView(g1), g2: planGroupView(g2) };
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

/** Open a group from Task control's list and answer its view's region once it is the one shown. */
async function openGroup(groupId: string): Promise<HTMLElement> {
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  fireEvent.click(await within(nav).findByRole("button", { name: new RegExp(`^${groupId} · `) }));
  return await screen.findByRole("region", { name: `Control group ${groupId}` });
}
const groupReads = (groupId: string): number => panel.requests.filter((request) => request === `GET /api/control/groups/${groupId}`).length;

describe("a group's refusal stays with its group (spec §2.2(d))", () => {
  it("is shown at the top of its group's view, kept through another group's success, and cleared by its own group's next success", async () => {
    let refuseG1 = true;
    panel.onPost = async (url) => {
      if (url === "/api/control/groups/g1/pause-dispatch" && refuseG1) {
        refuseG1 = false;
        return refused(409, "stop-mode-conflict", "stop-mode-conflict:pause");
      }
      return success();
    };
    render(<App />);
    let g1 = await openGroup("g1");
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    const notice = await within(g1).findByTestId("group-refusal");
    expect(notice.textContent).toContain(enErrors["stop-mode-conflict"]);
    expect(within(notice).getByText("stop-mode-conflict").tagName).toBe("CODE");
    // At the top: before the actions and before the budget editor.
    const pause = within(g1).getByRole("button", { name: "Pause dispatch" });
    expect(notice.compareDocumentPosition(pause) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(within(g1).getByRole("region", { name: "Budget proposal" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Only there: the code is on screen once (not also on the panel's own line).
    expect(screen.getAllByText(/stop-mode-conflict/)).toHaveLength(1);

    const g2 = await openGroup("g2");
    expect(within(g2).queryByTestId("group-refusal")).toBeNull();
    const before = groupReads("g2");
    fireEvent.click(within(g2).getByRole("button", { name: "Pause dispatch" }));
    // The success is recorded before the group is read again, so this read means g2's success was handled.
    await waitFor(() => expect(groupReads("g2")).toBeGreaterThan(before));
    // Fix round 1: g1's refusal, though not on screen while g2 is open, keeps Task control's badge lit.
    expect(screen.queryByTestId("nav-dot-tasks")).not.toBeNull();

    g1 = await openGroup("g1");
    expect(within(g1).getByTestId("group-refusal").textContent).toContain(enErrors["stop-mode-conflict"]);
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Control group g1" })).queryByTestId("group-refusal")).toBeNull());
    expect(screen.queryByTestId("nav-dot-tasks")).toBeNull();
  });

  it("clears a group's unknown outcome once the lookup finds the command succeeded", async () => {
    // Fix round 1: a 5xx leaves the outcome unknown; the next poll's lookup finds it committed, which is a success.
    panel.onPost = async (url) => (url === "/api/control/groups/g1/pause-dispatch" ? json({ error: { code: "panel-unavailable", message: "down" } }, 503) : success());
    lookup = async () => json({ schema: "orca-command-lookup-v1", originalStatus: 200, body: { schema: "orca-command-success-v1", commandRevision: 7 } });
    render(<App />);
    const g1 = await openGroup("g1");
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    await within(g1).findByTestId("group-refusal");
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Control group g1" })).queryByTestId("group-refusal")).toBeNull(), { timeout: 6000 });
    expect(screen.queryByTestId("nav-dot-tasks")).toBeNull();
  }, 10_000);
});

describe("an import's refusal stays in the import form (spec §2.2(d))", () => {
  it("leaves no hidden refusal behind a refused import: a later successful import puts the badge out", async () => {
    // Fix round 1: a refused import made no group, so reading that group (404 group-not-found) stored a refusal no view
    // shows and nothing clears, which kept Task control's badge lit until a reload.
    let refuse = true;
    let imported = "";
    panel.onPost = async (url, body) => {
      if (url !== "/api/control/groups/import-plan") return success();
      if (refuse) { refuse = false; return refused(422, "control-plan-rejected", "control-plan-rejected:dangling-dependency:b"); }
      imported = (body as { payload: { groupId: string } }).payload.groupId;
      panel.groupViews[imported] = planGroupView(groupSummary(imported, ALPHA));
      return success();
    };
    render(<App />);
    const form = await screen.findByRole("region", { name: "Import plan" });
    fireEvent.click(await within(form).findByRole("button", { name: "Import plan" }));
    await within(form).findByTestId("import-refusal");
    fireEvent.click(within(form).getByRole("button", { name: "Import plan" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Import plan" })).queryByTestId("import-refusal")).toBeNull());
    // The successful import's own group read is the last thing its command does.
    await waitFor(() => expect(panel.requests).toContain(`GET /api/control/groups/${imported}`));
    expect(screen.queryByTestId("nav-dot-tasks")).toBeNull();
    // Only the imported group was read; the refused import's never-made group was not.
    expect(panel.requests.filter((request) => /^GET \/api\/control\/groups\/group-[^/]+$/.test(request))).toEqual([`GET /api/control/groups/${imported}`]);
  });

  it("remembers an import whose answer was lost as an import, so its lookup's answer replaces the notice in the import form", async () => {
    // Fix round 1: the 5xx leaves the import's outcome unknown; the next poll's lookup says it never reached the ledger.
    let sent = "";
    panel.onPost = async (url, body) => {
      if (url !== "/api/control/groups/import-plan") return success();
      sent = (body as { payload: { groupId: string } }).payload.groupId;
      return json({ error: { code: "panel-unavailable", message: "down" } }, 503);
    };
    lookup = async (url) => refused(404, "command-result-not-found", `no command ${url}`);
    render(<App />);
    const form = await screen.findByRole("region", { name: "Import plan" });
    fireEvent.click(await within(form).findByRole("button", { name: "Import plan" }));
    await within(form).findByTestId("import-refusal");
    await waitFor(() => expect(within(screen.getByTestId("import-refusal")).getByText("command-result-not-found").tagName).toBe("CODE"), { timeout: 6000 });
    expect(panel.requests).not.toContain(`GET /api/control/groups/${sent}`);
  }, 10_000);

  it("shows an unknown import the lookup cannot find in the import form, and reads no group for it", async () => {
    // Fix round 1: an import whose answer was lost is remembered as an import; command-result-not-found means it never
    // reached the ledger, so its group does not exist and the import form is where the person acted.
    window.sessionStorage.setItem(UNCERTAIN_COMMANDS_KEY, JSON.stringify([{ groupId: "group-lost", commandId: "cmd-lost", importPlan: true }]));
    lookup = async (url) => refused(404, "command-result-not-found", `no command ${url}`);
    render(<App />);
    const form = await screen.findByRole("region", { name: "Import plan" });
    const notice = await within(form).findByTestId("import-refusal");
    expect(within(notice).getByText("command-result-not-found").tagName).toBe("CODE");
    expect(panel.requests).toContain("GET /api/control/groups/group-lost/commands/cmd-lost");
    expect(panel.requests).not.toContain("GET /api/control/groups/group-lost");
  });

  it("lists the plan's problems one per line, in English and in Chinese", async () => {
    panel.onPost = async (url) => (url === "/api/control/groups/import-plan"
      ? refused(422, "control-plan-rejected", "control-plan-rejected:missing-target-version:a\ndangling-dependency:b")
      : success());
    render(<App />);
    const form = await screen.findByRole("region", { name: "Import plan" });
    fireEvent.click(await within(form).findByRole("button", { name: "Import plan" }));
    const notice = await within(form).findByTestId("import-refusal");
    expect(within(notice).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Task a has no targetVersion. Add a positive integer, usually 1.",
      "Task b depends on a task that is not in the plan.",
    ]);
    expect(within(notice).getByText("control-plan-rejected").tagName).toBe("CODE");
    expect(screen.getAllByText(/control-plan-rejected/)).toHaveLength(1);
    await act(async () => { await i18n.changeLanguage("zh"); });
    expect(within(screen.getByTestId("import-refusal")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "任务 a 没有 targetVersion。请填一个正整数，通常是 1。",
      "任务 b 依赖了一个计划里没有的任务。",
    ]);
  });
});
