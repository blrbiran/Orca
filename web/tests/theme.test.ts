import { describe, expect, it } from "vitest";
import { THEME_KEY, applyTheme, readTheme, writeTheme } from "../src/theme.js";

/** Panel UI redesign spec §5.1 (ruling U3): the theme choice is a per-browser convenience that must never break the page. */
describe("theme preference (ruling U3)", () => {
  it("reads a stored choice and falls back to system for a missing, unknown or unreadable one", () => {
    expect(readTheme({ getItem: (k) => (k === THEME_KEY ? "dark" : null) })).toBe("dark");
    expect(readTheme({ getItem: () => null })).toBe("system");
    expect(readTheme({ getItem: () => "sepia" })).toBe("system");
    expect(readTheme({ getItem: () => { throw new Error("SecurityError"); } })).toBe("system");
    expect(readTheme(undefined)).toBe("system");
  });

  it("swallows a storage that refuses writes", () => {
    expect(() => writeTheme({ setItem: () => { throw new Error("QuotaExceededError"); } }, "light")).not.toThrow();
  });

  it("sets data-theme for an explicit choice and removes it for system", () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyTheme(root, "light");
    expect(attrs.get("data-theme")).toBe("light");
    applyTheme(root, "system");
    expect(attrs.has("data-theme")).toBe(false);
  });
});
