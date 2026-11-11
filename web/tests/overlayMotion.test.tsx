// @vitest-environment jsdom
/**
 * Tester #84 (spec 2026-11-11-tester-followup-e-design.md §10; corrects web/DESIGN.md's motion line): the Radix overlays
 * (dialog, its scrim, menu, select list) fade and scale in over the 120 ms motion token as they open, collapsible
 * blocks (<details>) fade their content in, and all of it stops under prefers-reduced-motion. Closing is not animated,
 * so Radix still unmounts a closed overlay at once. jsdom never applies the sheet, so the CSS half reads styles.css.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "../src/ui/Dialog.js";
import { Menu, MenuItem } from "../src/ui/Menu.js";
import { Select } from "../src/ui/Select.js";

afterEach(() => cleanup());
// A path through a variable: Vite rewrites a literal new URL("….css", import.meta.url) into an asset URL.
const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const css = src("../src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
/** The declarations of the rule whose selector list is exactly `selector`, outside any @media block or inside `media`. */
function rule(selector: string, media?: string): string | null {
  const scope = media === undefined ? css : [...css.matchAll(new RegExp(`@media ${media.replace(/[()]/g, "\\$&")} \\{([\\s\\S]*?)\\n\\}`, "g"))].map((m) => m[1]).join("\n");
  const at = scope.split("\n").find((line) => line.trim().startsWith(`${selector} {`));
  return at === undefined ? null : at.slice(at.indexOf("{") + 1, at.lastIndexOf("}")).trim();
}

describe("each overlay carries the hook its motion keys on", () => {
  it("dialog content and its scrim", () => {
    render(<Dialog trigger={<button type="button">open</button>} title="Title" closeLabel="Close" open onOpenChange={() => {}}><p>body</p></Dialog>);
    const content = screen.getByRole("dialog");
    // mutation: drop data-overlay from the dialog content -> red here
    expect([content.getAttribute("data-overlay"), content.getAttribute("data-state")]).toEqual(["dialog", "open"]);
    expect(document.querySelector('[data-overlay="scrim"]')?.getAttribute("data-state")).toBe("open");
  });
  it("menu content", () => {
    render(<Menu trigger={<button type="button">more</button>} open onOpenChange={() => {}}><MenuItem onSelect={() => {}}>one</MenuItem></Menu>);
    const content = screen.getByRole("menu");
    // mutation: drop data-overlay from the menu content -> red here
    expect([content.getAttribute("data-overlay"), content.getAttribute("data-state")]).toEqual(["menu", "open"]);
  });
  it("select list", async () => {
    render(<Select aria-label="Pick" value="a" onValueChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    const trigger = screen.getByRole("combobox", { name: "Pick" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    await screen.findByRole("listbox");
    const content = document.querySelector('[data-overlay="select"]');
    // mutation: drop data-overlay from the select content -> red here
    expect(content?.getAttribute("data-state")).toBe("open");
    expect(content?.contains(screen.getByRole("listbox"))).toBe(true);
  });
});

describe("styles.css animates them over the motion token and stops under reduced motion", () => {
  it("fades and scales an opening overlay in, from where it opened, and fades the scrim", () => {
    // mutation: drop the opening rule -> red here
    expect(rule('[data-overlay][data-state="open"]')).toBe("animation: overlay-in var(--dur) var(--ease);");
    expect(rule('[data-overlay="scrim"][data-state="open"]')).toBe("animation-name: fade-in;");
    // mutation: animate only opacity -> red here
    expect(css).toContain("@keyframes overlay-in { from { opacity: 0; scale: 0.96; } to { opacity: 1; scale: 1; } }");
    expect(css).toContain("@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }");
    expect(rule('[data-overlay="menu"]')).toBe("transform-origin: var(--radix-dropdown-menu-content-transform-origin);");
    expect(rule('[data-overlay="select"]')).toBe("transform-origin: var(--radix-select-content-transform-origin);");
    // The token is the 120 ms the DESIGN.md scale names.
    expect(css).toMatch(/--dur: 120ms;/);
  });
  it("does not animate a closing overlay (Radix would wait for it), nor any other state", () => {
    expect(css).not.toMatch(/\[data-state="closed"\][^{]*\{[^}]*animation/);
  });
  it("fades a collapsible block's content in", () => {
    // mutation: drop the details rule -> red here
    expect(rule("details[open] > :not(summary)")).toBe("animation: fade-in var(--dur) var(--ease);");
  });
  it("turns every one of them off under prefers-reduced-motion, at a specificity that wins", () => {
    // mutation: drop the reduced-motion rule -> red here; write it as [data-overlay] alone -> loses to the open rule, red here
    expect(rule('[data-overlay][data-state="open"], details[open] > :not(summary)', "(prefers-reduced-motion: reduce)")).toBe("animation: none;");
  });
});
