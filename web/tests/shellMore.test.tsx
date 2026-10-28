// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Section } from "../src/sections.js";
import { Shell } from "../src/Shell.js";

/**
 * Tester #79 (issue-20261023.md; human ruling 「可以先收进 更多 里」): Chains, Memory and Metrics are folded under one "More"
 * group in the sidebar. Every destination keeps its #hash link, the open page is always indicated, and the chain's
 * running dot is not lost when the group is closed.
 */
const render1 = (active: Section, badges: { chainRunning?: boolean } = {}): void => {
  render(
    <Shell active={active} badges={{ unreviewed: 3, chainRunning: badges.chainRunning === true, controlAlert: false }} footer={[]} showAdvanced>
      <p>body</p>
    </Shell>,
  );
};
const link = (name: string): HTMLElement => screen.getByRole("link", { name: new RegExp(name) });
const hiddenByClass = (el: HTMLElement): boolean => el.closest("li")!.className.split(/\s+/).includes("hidden");
const toggle = (): HTMLElement => screen.getByRole("button", { name: /^More/ });

afterEach(cleanup);

describe("the sidebar's More group (tester #79)", () => {
  it("starts closed: Memory, Metrics and Chains are folded away, the daily pages and Settings are not", () => {
    render1("tasks");
    // mutation: start the group open (useState(true)) -> Memory is visible on load, red
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    for (const name of ["Memory", "Metrics", "Continuous improvement"]) expect(hiddenByClass(link(name)), name).toBe(true);
    for (const name of ["Overview", "Requirements", "Task control", "Board", "Decisions", "Settings"]) expect(hiddenByClass(link(name)), name).toBe(false);
  });

  it("opens and closes on its button, and every folded destination keeps its hash link", () => {
    render1("tasks");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    // mutation: href="#" instead of hashFor(section) on the nav link -> a destination loses its route, red
    expect(link("Memory").getAttribute("href")).toBe("#memory");
    expect(link("Metrics").getAttribute("href")).toBe("#metrics");
    expect(link("Continuous improvement").getAttribute("href")).toBe("#chains");
    for (const name of ["Memory", "Metrics", "Continuous improvement"]) expect(hiddenByClass(link(name)), name).toBe(false);
    fireEvent.click(toggle());
    expect(hiddenByClass(link("Memory"))).toBe(true);
  });

  it("keeps the open page visible and indicated while the group is closed", () => {
    render1("metrics");
    // mutation: hide every folded entry when closed (drop the "not the active one" filter) -> the open page vanishes from the sidebar, red
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(hiddenByClass(link("Metrics"))).toBe(false);
    expect(link("Metrics").getAttribute("aria-current")).toBe("page");
    expect(hiddenByClass(link("Memory"))).toBe(true);
  });

  it("carries the chain's running dot on the closed toggle, and drops the copy once the group is open", () => {
    render1("tasks", { chainRunning: true });
    // mutation: delete the nav-dot-more span -> a running chain is invisible while the group is closed, red
    expect(screen.queryByTestId("nav-dot-more")).not.toBeNull();
    expect(screen.queryByTestId("nav-dot-chains")).not.toBeNull();
    fireEvent.click(toggle());
    expect(screen.queryByTestId("nav-dot-more")).toBeNull();
    expect(screen.queryByTestId("nav-dot-chains")).not.toBeNull();
  });

  it("shows no dot on the toggle when the chain is idle, or when the chain page itself is open", () => {
    render1("tasks");
    expect(screen.queryByTestId("nav-dot-more")).toBeNull();
    cleanup();
    render1("chains", { chainRunning: true });
    expect(screen.queryByTestId("nav-dot-more")).toBeNull();
  });
});
