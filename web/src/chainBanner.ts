/**
 * D-launch spec §6.2: one banner per stopped chain, by category, until "Got it". Dismissals are kept in this browser
 * only (localStorage), never in ~/.orca. Storage can be missing or throw (private mode, blocked site data); then
 * nothing is remembered and nothing breaks.
 */
import i18n from "./i18n.js";
import { en } from "./locales/en.js";
import type { ChainRepoView, ChainStopCategory } from "./types.js";

/** In English (criteria read it); bannersFor translates when it is called (panel i18n spec §3.3). */
export const BANNER_TEXT: Record<ChainStopCategory, string> = en.chains.banner;
export const DISMISSED_KEY = "orca.chains.dismissed";

export interface Banner {
  repoKey: string;
  chainId: string;
  category: ChainStopCategory;
  text: string;
  reason: string;
  awaitingHuman: string[];
}

export function bannersFor(repos: readonly ChainRepoView[], dismissed: ReadonlySet<string>): Banner[] {
  const out: Banner[] = [];
  for (const r of repos) {
    const c = r.chain;
    if (c === null || c.state !== "stopped" || c.stop === null || dismissed.has(c.chainId)) continue;
    out.push({ repoKey: r.repoKey, chainId: c.chainId, category: c.stop.category, text: i18n.t(`chains.banner.${c.stop.category}`), reason: c.stop.reason, awaitingHuman: c.stop.awaitingHuman });
  }
  return out;
}

export function readDismissed(storage: Pick<Storage, "getItem"> | undefined): Set<string> {
  try {
    const raw = storage?.getItem(DISMISSED_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeDismissed(storage: Pick<Storage, "setItem"> | undefined, dismissed: ReadonlySet<string>): void {
  try {
    storage?.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Not remembered; the banner comes back on reload.
  }
}
