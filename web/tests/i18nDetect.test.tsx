// @vitest-environment jsdom
/**
 * Panel i18n spec §4, §6.6 (ruling L2: "跟浏览器语言，手动切换按浏览器记住"). The stored choice beats the browser; the
 * browser's list gives its first supported language; detection writes nothing (a written choice would freeze today's
 * browser language into a choice); storage that throws leaves the browser's language and a page that renders. Each case
 * imports a fresh module graph (vi.resetModules): web/src/i18n.ts creates its own instance, so no state carries over.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Case { stored?: string; languages: string[]; language?: string; storage?: "read-throws" | "access-throws" }

const restore: Array<() => void> = [];
function override(target: object, key: string, get: () => unknown): void {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, get });
  restore.push(() => {
    if (own) Object.defineProperty(target, key, own);
    else delete (target as Record<string, unknown>)[key];
  });
}
afterEach(() => {
  while (restore.length > 0) restore.pop()!();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function detect(c: Case): Promise<{ resolved: string | undefined; htmlLang: string; writes: number; html: string }> {
  vi.resetModules();
  window.localStorage.clear();
  if (c.stored !== undefined) window.localStorage.setItem("orca.panel.lang", c.stored);
  override(window.navigator, "languages", () => c.languages);
  override(window.navigator, "language", () => c.language ?? c.languages[0] ?? "");
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  if (c.storage === "read-throws") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
  if (c.storage === "access-throws") override(window, "localStorage", () => { throw new Error("SecurityError"); });
  const { default: i18n, initI18n } = await import("../src/i18n.js");
  initI18n();
  const { Shell } = await import("../src/Shell.js");
  const html = renderToStaticMarkup(
    <Shell active="decisions" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]} theme="system"><p>pane</p></Shell>,
  );
  return { resolved: i18n.resolvedLanguage, htmlLang: document.documentElement.lang, writes: setItem.mock.calls.length, html };
}

/** A fresh i18n module under a browser that says the given languages, not yet initialised. */
async function freshI18n(languages: string[]): Promise<typeof import("../src/i18n.js")> {
  vi.resetModules();
  window.localStorage.clear();
  override(window.navigator, "languages", () => languages);
  override(window.navigator, "language", () => languages[0] ?? "");
  return import("../src/i18n.js");
}

describe("language detection (spec §4, §6.6)", () => {
  it("lets a stored zh beat a browser that says en-US", async () => {
    const r = await detect({ stored: "zh", languages: ["en-US"] });
    expect([r.resolved, r.htmlLang]).toEqual(["zh", "zh"]);
    expect(r.html).toContain("决策");
  });

  it("lets a stored en beat a browser that says zh-CN", async () => {
    const r = await detect({ stored: "en", languages: ["zh-CN"] });
    expect([r.resolved, r.htmlLang]).toEqual(["en", "en"]);
    expect(r.html).toContain("Decisions");
  });

  it("resolves a zh-TW browser to zh, and <html lang> says zh, not zh-TW", async () => {
    const r = await detect({ languages: ["zh-TW"] });
    expect([r.resolved, r.htmlLang]).toEqual(["zh", "zh"]);
  });

  it("resolves a browser that lists no Chinese to en", async () => {
    const r = await detect({ languages: ["fr"] });
    expect([r.resolved, r.htmlLang]).toEqual(["en", "en"]);
    expect(r.html).toContain("Decisions");
  });

  it("takes the first supported entry of the browser's list: fr, zh-CN is zh", async () => {
    expect((await detect({ languages: ["fr", "zh-CN"] })).resolved).toBe("zh");
  });

  it("reads navigator.language when navigator.languages is empty, and falls back to en when both are empty (Review Focus 1)", async () => {
    expect((await detect({ languages: [], language: "zh-CN" })).resolved).toBe("zh");
    expect((await detect({ languages: [], language: "" })).resolved).toBe("en");
  });

  it("ignores a stored value that is neither en nor zh and follows the browser (Review Focus 2)", async () => {
    expect((await detect({ stored: "de", languages: ["zh"] })).resolved).toBe("zh");
    expect((await detect({ stored: "de", languages: ["fr"] })).resolved).toBe("en");
  });

  it("writes nothing while detecting, so the browser's language is never frozen into a choice (ruling L2)", async () => {
    expect((await detect({ languages: ["zh-TW"] })).writes).toBe(0);
    expect((await detect({ stored: "zh", languages: ["en-US"] })).writes).toBe(0);
  });

  it("uses the browser's language and still renders when reading storage throws", async () => {
    const r = await detect({ stored: "en", languages: ["zh-CN"], storage: "read-throws" });
    expect(r.resolved).toBe("zh");
    expect(r.html).toContain("决策");
  });

  it("uses the browser's language and still renders when touching localStorage at all throws", async () => {
    const r = await detect({ languages: ["zh-CN"], storage: "access-throws" });
    expect(r.resolved).toBe("zh");
    expect(r.html).toContain("决策");
  });

  it("lets an explicit lng beat a Chinese browser, so web criteria render English on any machine (spec §6.1, tests/setup.ts)", async () => {
    const { default: i18n, initI18n } = await freshI18n(["zh-CN"]);
    initI18n({ lng: "en" });
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("initialises once: a second initI18n does not re-detect and undo a language chosen since the first", async () => {
    // i18next's own re-init merges the earlier options, so only a first init without lng re-detects on a second one.
    const { default: i18n, initI18n } = await freshI18n(["zh-CN"]);
    initI18n();
    await i18n.changeLanguage("en");
    initI18n();
    expect(i18n.resolvedLanguage).toBe("en");
  });
});
