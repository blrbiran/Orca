/**
 * Panel i18n spec §2, §4: the panel's one i18next instance. English is the fallback and reproduces today's text; the
 * language follows the browser unless this browser chose one (orca.panel.lang). Detection never writes the choice
 * (caches: []): only the Language switch does, so today's browser language is never frozen into a choice (ruling L2).
 */
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { en, enErrors } from "./locales/en.js";
import { zh, zhErrors } from "./locales/zh.js";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

export const LANG_KEY = "orca.panel.lang";
export const PANEL_LANGUAGES = ["en", "zh"] as const;
export type PanelLanguage = (typeof PANEL_LANGUAGES)[number];
/** Spec §4: each option names its language in that language, never translated. */
export const LANGUAGE_NAMES: Record<PanelLanguage, string> = { en: "English", zh: "中文" };

/**
 * The panel's own instance, not i18next's default one: that one lives in the (externalised) package, so a criterion that
 * resets modules would get it back already initialised (Drafter finding F3).
 */
const i18n = createInstance();
export default i18n;

/** localStorage, or undefined where touching it throws (a private window, blocked site data). */
function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored choice as written; i18next ignores a value it does not support, and the browser's list decides. */
export function readLanguage(storage: Pick<Storage, "getItem"> | undefined): string | undefined {
  try {
    return storage?.getItem(LANG_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLanguage(storage: Pick<Storage, "setItem"> | undefined, lang: PanelLanguage): void {
  try {
    storage?.setItem(LANG_KEY, lang);
  } catch {
    // A lost choice only costs one click next time.
  }
}

/** Spec §4: resolvedLanguage, not language (which stays "zh-TW" for a Taiwanese browser). */
export function currentLanguage(): PanelLanguage {
  return i18n.resolvedLanguage === "zh" ? "zh" : "en";
}

function syncHtmlLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = currentLanguage();
}

export function initI18n(options: { lng?: string } = {}): typeof i18n {
  if (i18n.isInitialized) return i18n;
  const detector = new LanguageDetector();
  // Spec §4 order: the stored choice, then the browser's list. The stored choice is read through the wrapped storage
  // above rather than the detector's own localStorage lookup, which caches whether storage works and then reads it
  // unguarded (Drafter finding F2).
  detector.addDetector({ name: "orcaStored", lookup: () => readLanguage(browserStorage()) });
  i18n.on("languageChanged", syncHtmlLang);
  void i18n.use(detector).use(initReactI18next).init({
    ...(options.lng === undefined ? {} : { lng: options.lng }),
    resources: { en: { translation: en }, zh: { translation: zh } },
    initAsync: false,
    fallbackLng: "en",
    supportedLngs: [...PANEL_LANGUAGES],
    load: "languageOnly",
    interpolation: { escapeValue: false },
    detection: { order: ["orcaStored", "navigator"], caches: [] },
  });
  syncHtmlLang();
  return i18n;
}

/** Spec §3.5: an enum value in words; a value this panel has no words for (a newer server) is shown as sent. */
export function enumText<F extends keyof typeof en.enums>(family: F, value: string): string {
  const key = `enums.${family}.${value}`;
  return i18n.exists(key) ? (i18n.t(key as never) as string) : value;
}

/** The current language's refusal table (spec 2026-10-08 §2.2(a)). */
function errorTable(): Record<string, string> {
  return currentLanguage() === "zh" ? zhErrors : enErrors;
}

/** The current language's entry for a code; hasOwnProperty, so a code such as "toString" never finds an Object.prototype member. */
export function errorEntry(code: string): string | undefined {
  const table = errorTable();
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

/** An entry with its {{message}}, {{status}} and {{detail}} filled. */
export function fillEntry(entry: string, values: { message: string; status: string; detail: string }): string {
  return entry.replace(/\{\{(message|status|detail)\}\}/g, (_match: string, name: "message" | "status" | "detail") => values[name]);
}

/** Spec 2026-10-08 §2.2(a): the server's words after `<code>:` -- nothing when the message is the code, all of it when it has no such prefix. */
export function refusalDetail(refusal: { code: string; message: string }): string {
  if (refusal.message === refusal.code) return "";
  const prefix = `${refusal.code}:`;
  return refusal.message.startsWith(prefix) ? refusal.message.slice(prefix.length) : refusal.message;
}

/**
 * Spec §3.2; spec 2026-10-08 §2.2(a): what a refusal says -- the current language's entry for its code (http-<n> is the
 * one entry http-status), with {{message}}, {{status}} and {{detail}} filled from the refusal, else the message as sent.
 * The code is on screen beside it, so the fallback is visible.
 */
export function refusalText(refusal: { code: string; message: string; status: number | null }): string {
  const key = /^http-\d+$/.test(refusal.code) ? "http-status" : refusal.code;
  const entry = errorEntry(key);
  if (entry === undefined) return refusal.message;
  return fillEntry(entry, { message: refusal.message, status: String(refusal.status ?? ""), detail: refusalDetail(refusal) });
}
