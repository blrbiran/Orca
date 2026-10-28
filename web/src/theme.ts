/**
 * Panel UI redesign spec §5.1 (ruling U3). "system" follows prefers-color-scheme; the
 * others pin a theme. The choice lives in this browser only, so every storage call
 * is wrapped: a private window or blocked site data must leave the page working.
 * Session e236bbe4 (human: "add selectable themes"): light and dark are the default pair; the six after them are
 * candidates the human will keep or drop. Each one is a `:root[data-theme="<id>"]` block in styles.css.
 * Tester round 2026-10-28 (controller session a9f9d6de; human: 「之前的主题都不好看，你可以都整体再优化一遍」): the six reworked
 * (each now sets type, radius and density as well as colour) and four added (rose, ink, violet, lagoon); light themes
 * first, then dark. No id was dropped, so a stored choice of any earlier name still applies.
 */
export const THEME_KEY = "orca.panel.theme";
export const THEME_PREFS = [
  "system", "light", "dark",
  "frost", "rose", "ink", "contrast",
  "violet", "navy", "lagoon", "dusk", "ember", "terminal",
] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

export function readTheme(storage: Pick<Storage, "getItem"> | undefined): ThemePref {
  try {
    const value = storage?.getItem(THEME_KEY) ?? null;
    return (THEME_PREFS as readonly string[]).includes(value ?? "") ? (value as ThemePref) : "system";
  } catch {
    return "system";
  }
}

export function writeTheme(storage: Pick<Storage, "setItem"> | undefined, pref: ThemePref): void {
  try {
    storage?.setItem(THEME_KEY, pref);
  } catch {
    // A lost preference only costs one click next time.
  }
}

export function applyTheme(root: Pick<HTMLElement, "setAttribute" | "removeAttribute">, pref: ThemePref): void {
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}
