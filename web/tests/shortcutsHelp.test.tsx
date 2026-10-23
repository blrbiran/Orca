// @vitest-environment jsdom
/**
 * Tester round 2 spec §10 (ruling H12, C36, C37; tester #55): no new single-key binding -- not even `?` (WCAG 2.1.4, and
 * Vimium's own help key) -- and a visible footer button that opens the list of the keys Orca uses in a native modal
 * <dialog> named by its heading, returning focus to the button on close. The list is a constant next to the functions
 * that decide the keys, and names exactly the letters they act on.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { SHORTCUTS, isRetryKey, reviewKeyAction } from "../src/reviewKeys.js";
import { Shell } from "../src/Shell.js";
import { installFakePanel } from "./fixtures/twoProjects.js";

// jsdom may not implement the modal dialog; stand-ins that keep the open state and fire "close" like a browser.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

const shell = () => render(<Shell active="overview" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]}><p>body</p></Shell>);

describe("no ? binding; a button opens the list (C36)", () => {
  it("a ? keydown on the body opens nothing and nothing prevents its default", async () => {
    installFakePanel();
    render(<App />);
    await screen.findByRole("button", { name: "Keyboard shortcuts" });
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const event = new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(showModal).not.toHaveBeenCalled();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("the footer button opens a modal dialog named by its heading; closing it returns focus to the button", () => {
    shell();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });
    expect(button.closest(".sidebar-foot")).not.toBeNull();
    button.focus();
    fireEvent.click(button);
    expect(showModal).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector("dialog")!;
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("Keys Orca uses");
    expect(dialog.textContent).toContain("r: retry the open task's run");
    const close = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === "Close")!;
    close.focus();
    fireEvent.click(close);
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
