// @vitest-environment jsdom
/**
 * Ruling H6(b) (2026-10-27, session 7753e97d; tester issues #39, #41, #59): global and project settings are one Settings
 * page with a category nav, one category shown at a time, each its own hash -- so a person reaches a setting by its
 * category instead of scrolling one long page, and a link can open the exact category. Hiding is by styles.css only
 * (data-active), as for the section panes; jsdom does not apply the sheet, so the criteria read data-active.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { SETTINGS_CATEGORIES } from "../src/sections.js";
import { installFakePanel } from "./fixtures/twoProjects.js";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); installFakePanel(); });
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); window.location.hash = ""; });

const active = (): string[] => [...document.querySelectorAll('.settings-category[data-active="true"]')].map((el) => el.getAttribute("data-category")!);
const globalShown = (): string | null => screen.getByRole("region", { name: "Global settings" }).getAttribute("data-active");
const current = (): string | null => within(screen.getByRole("navigation", { name: "Settings categories" })).getAllByRole("link")
  .find((link) => link.getAttribute("aria-current") === "page")?.textContent ?? null;
async function go(hash: string): Promise<void> { await act(async () => { window.location.hash = hash; window.dispatchEvent(new Event("hashchange")); }); }

describe("the Settings page (H6b)", () => {
  it("lists every category as a link to its own hash", async () => {
    window.location.hash = "settings";
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Settings categories" });
    expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Appearance", "#settings/appearance"], ["Account", "#settings/account"], ["Orchestration", "#settings/orchestration"], ["Checks", "#settings/checks"],
      ["Flows", "#settings/flows"], ["Agents", "#settings/agents"], ["This project", "#settings/project"],
    ]);
    expect(SETTINGS_CATEGORIES).toHaveLength(7);
    // A bare #settings opens Appearance.
    expect(active()).toEqual(["appearance"]);
    expect(current()).toBe("Appearance");
  });

  it("shows exactly the category the hash names, and hides the global settings while the project's are shown", async () => {
    window.location.hash = "settings/agents";
    render(<App />);
    await screen.findByRole("navigation", { name: "Settings categories" });
    // mutation: mark every category active -> the page is one long scroll again, red
    expect(active()).toEqual(["agents"]);
    expect(current()).toBe("Agents");
    expect(globalShown()).toBe("true");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    await go("settings/project");
    expect(active()).toEqual(["project"]);
    expect(current()).toBe("This project");
    // mutation: leave the global section shown on the project category -> its refusal line and scope text show beside it, red
    expect(globalShown()).toBe("false");
    await go("settings/checks");
    expect(active()).toEqual(["checks"]);
    expect(globalShown()).toBe("true");
  });

  it("opens the old global and project settings hashes on the category each showed first", async () => {
    window.location.hash = "project-settings";
    render(<App />);
    await screen.findByRole("navigation", { name: "Settings categories" });
    expect(active()).toEqual(["project"]);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    await go("global-settings");
    expect(active()).toEqual(["appearance"]);
  });
});
