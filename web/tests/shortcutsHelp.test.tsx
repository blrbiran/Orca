// @vitest-environment jsdom
/**
 * Tester round 2 spec §10 (ruling H12, C36, C37; tester #55): no new single-key binding -- not even `?` (WCAG 2.1.4, and
 * Vimium's own help key) -- and a visible footer button that opens the list of the keys Orca uses in a native modal
 * <dialog> named by its heading, returning focus to the button on close. Since the tester round of 2026-10-28 the modal
 * is the panel's Radix dialog (ui/Dialog.tsx), not a native <dialog>; the promises are the same. The list is a constant next to the functions
 * that decide the keys, and names exactly the letters they act on.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { SHORTCUTS, isRetryKey, reviewKeyAction } from "../src/reviewKeys.js";
import { Shell } from "../src/Shell.js";
import { installFakePanel } from "./fixtures/twoProjects.js";
import { ALPHA, groupSummary, planGroupView } from "./fixtures/twoProjects.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

/** The App with one group open in Tasks; resolves to the open group's region. */
async function groupOpen(): Promise<HTMLElement> {
  const panel = installFakePanel();
  const group = planGroupView(groupSummary("g1", ALPHA));
  panel.summary = { ...panel.summary, groups: [group.summary] }; panel.groupViews.g1 = group;
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /^g1 · / }));
  return screen.findByRole("region", { name: /^Control group g1/ });
}
const inTasks = (): HTMLElement => within(document.querySelector('[data-section="tasks"]') as HTMLElement).getByRole("button", { name: "Keyboard shortcuts" });
const shell = () => render(<Shell active="overview" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]}><p>body</p></Shell>);

describe("no ? binding; a button opens the list (C36)", () => {
  it("a ? keydown on the body opens nothing and nothing prevents its default", async () => {
    installFakePanel();
    render(<App />);
    await screen.findByRole("button", { name: "Keyboard shortcuts" });
    const event = new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): no dialog of any kind opened (was: showModal never called, no dialog[open]).
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Rewritten for tester issue #56: the button is on the group view (and Decisions), not in the sidebar footer. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
  it("the button opens a modal dialog named by its heading; closing it returns focus to the button", async () => {
    await groupOpen();
    const button = inTasks();
    button.focus();
    fireEvent.click(button);
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): the Radix dialog (was: a native <dialog> after the button, opened by showModal).
    const dialog = screen.getByRole("dialog", { name: "Keys Orca uses" });
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("Keys Orca uses");
    expect(dialog.textContent).toContain("r: retry the open task's run");
    // Modal: the page behind it is hidden from assistive technology while it is open. mutation: modal={false} -> red
    expect(button.closest('[aria-hidden="true"]')).not.toBeNull();
    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The dialog returns focus one task after it closes (Radix's focus scope).
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // mutation: onCloseAutoFocus={(event) => event.preventDefault()} on the dialog -> focus is not returned, red
    expect(document.activeElement).toBe(button);
  });
});

describe("the list and the key functions agree (C37)", () => {
  it("SHORTCUTS names exactly the letters reviewKeyAction and isRetryKey act on", () => {
    const facts = (key: string) => ({ key, target: document.body, metaKey: false, ctrlKey: false, altKey: false, repeat: false });
    const acted = [..."abcdefghijklmnopqrstuvwxyz"].filter((key) => reviewKeyAction(facts(key)) !== null || isRetryKey(facts(key))).sort();
    const listed = SHORTCUTS.flatMap((entry) => [...entry.keys]).filter((key) => /^[a-z]$/.test(key)).sort();
    expect(acted.length).toBeGreaterThan(0);
    expect(listed).toEqual(acted);
  });
});

// Tester issue #56 (session 7753e97d): the keys act only on Decisions (j/k/a/c) and in a group's view (r, the arrow keys on
// its region tabs and menus), so the help sits on those two pages -- a sidebar entry read as page-wide keys, and the
// sidebar footer is hidden on narrow screens. The button shows a keyboard icon and keeps its accessible name.
describe("where the shortcuts button is (#56)", () => {
  it("is not in the sidebar, is on the Decisions page, and above an open group's view (outside it), as an icon with its name", async () => {
    shell();
    // mutation: put <ShortcutsHelp /> back in the sidebar footer -> a button in the shell, red
    expect(screen.queryByRole("button", { name: "Keyboard shortcuts" })).toBeNull();
    cleanup();
    installFakePanel();
    render(<App />);
    const buttons = await screen.findAllByRole("button", { name: "Keyboard shortcuts" });
    // mutation: drop it from DecisionsView -> none in the Decisions pane, red; with no group open, Tasks has none
    expect(buttons.map((button) => button.closest("[data-section]")?.getAttribute("data-section"))).toEqual(["decisions"]);
    cleanup();
    const region = await groupOpen();
    // mutation: drop it from ControlPanel -> none in Tasks, red
    const button = inTasks();
    // The group's own actions stay its actions (archiveGroup.test.tsx lists them): the button is outside the group's region.
    expect(region.contains(button)).toBe(false);
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
