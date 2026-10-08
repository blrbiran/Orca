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
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, commandRevision: 6, evidenceIds: [], retryable: false } }, status);
const success = (): Response => json({ schema: "orca-command-success-v1", commandRevision: 7 });

beforeEach(() => {
  panel = installFakePanel();
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

    g1 = await openGroup("g1");
    expect(within(g1).getByTestId("group-refusal").textContent).toContain(enErrors["stop-mode-conflict"]);
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Control group g1" })).queryByTestId("group-refusal")).toBeNull());
  });
});

describe("an import's refusal stays in the import form (spec §2.2(d))", () => {
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
