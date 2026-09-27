/**
 * Panel UI redesign spec §5.1 (ruling U3). "system" follows prefers-color-scheme; the
 * other two pin a theme. The choice lives in this browser only, so every storage call
 * is wrapped: a private window or blocked site data must leave the page working.
 */
export const THEME_KEY = "orca.panel.theme";
export const THEME_PREFS = ["system", "light", "dark"] as const;
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
