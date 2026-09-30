### Task 2: The i18n instance, the resources, detection, the switch, and the shell

**Files:**
- Modify: `web/package.json`, `package-lock.json` (npm install)
- Create: `web/src/i18n.ts`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Create: `web/tests/setup.ts`; Modify: `web/vite.config.ts:14`
- Modify: `web/src/main.tsx`, `web/src/Shell.tsx`, `web/src/App.tsx` (imports 25-87; after line 122; line 133; line 565; lines 620-626)
- Create: `web/tests/i18nKeys.test.ts`, `web/tests/i18nDetect.test.tsx`, `web/tests/i18nSwitch.test.tsx`

**Interfaces:**
- Produces (`web/src/i18n.ts`):
  ```ts
  export const LANG_KEY: "orca.panel.lang";
  export const PANEL_LANGUAGES: readonly ["en", "zh"];
  export type PanelLanguage = "en" | "zh";
  export const LANGUAGE_NAMES: Record<PanelLanguage, string>;          // { en: "English", zh: "中文" }
  export default i18n;                                                  // the panel's own instance (createInstance)
  export function readLanguage(storage: Pick<Storage, "getItem"> | undefined): string | undefined;
  export function writeLanguage(storage: Pick<Storage, "setItem"> | undefined, lang: PanelLanguage): void;
  export function currentLanguage(): PanelLanguage;                     // from resolvedLanguage
  export function initI18n(options?: { lng?: string }): typeof i18n;
  export function enumText<F extends keyof typeof en.enums>(family: F, value: string): string;
  ```
- Produces (`web/src/locales/en.ts`): `export type Translation<T>`, `export const en` (as const). (`web/src/locales/zh.ts`): `export const zh: Translation<typeof en>`, `export const zhErrors: Record<string, string>` (empty until Task 10).
- Produces (`web/src/App.tsx`): `export function footerLines(summary: ControlSummaryV1 | null): string[]`.
- Produces (`web/src/Shell.tsx`): two optional props, `language?: PanelLanguage`, `onLanguage?: (lang: PanelLanguage) => void`.

- [ ] **Step 1: Dependencies**

```bash
npm install --workspace web i18next@^26.4.2 react-i18next@^17.0.15 i18next-browser-languagedetector@^8.2.1 > "$SCRATCH/t2-install.txt" 2>&1; echo rc=$?
/usr/bin/git diff -- web/package.json > "$SCRATCH/t2-pkg-diff.txt" 2>&1; echo rc=$?
```
Expected `rc=0`; the diff adds exactly `"i18next": "^26.4.2"`, `"i18next-browser-languagedetector": "^8.2.1"`, `"react-i18next": "^17.0.15"` under `dependencies` (caret ranges, spec §2). Read `package-lock.json`'s diff stat and record the resolved versions of the three packages (Rule 14: the numbers the lock file shows, not assumed).

- [ ] **Step 2: Write the failing criteria**

`web/tests/i18nKeys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n, { enumText } from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";

/**
 * Panel i18n spec §2, §6.2: Chinese has exactly the English keys, both ways (the Chinese-only zhErrors table is a separate
 * export and part of neither); every value is a non-empty string; a Chinese value keeps every placeholder and markup tag
 * of its English value (a dropped {{count}} would drop data without an error); each Chinese _one key carries its _other
 * text (Chinese has one plural form). §3.5: an enum value this panel has no words for is shown as sent.
 */
type Tree = { readonly [key: string]: string | Tree };
function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}
const EN = flatten(en as unknown as Tree);
const ZH = flatten(zh as unknown as Tree);
const marks = (value: string): string[] => [...value.matchAll(/\{\{\w+\}\}|<\/?\w+>/g)].map((match) => match[0]).sort();

describe("key parity (spec §6.2)", () => {
  it("gives Chinese exactly the English keys, both ways, every value a non-empty string", () => {
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
    for (const [key, value] of [...Object.entries(EN), ...Object.entries(ZH)]) expect(value, key).not.toBe("");
  });

  it("keeps every placeholder and markup tag of the English value in the Chinese one", () => {
    for (const key of Object.keys(EN)) expect(marks(ZH[key] ?? ""), key).toEqual(marks(EN[key]!));
  });

  it("gives each Chinese _one key the text of its _other key", () => {
    // No plural key exists before Task 3; MT3-10 is this criterion's red.
    for (const key of Object.keys(ZH).filter((name) => name.endsWith("_one"))) expect(ZH[key], key).toBe(ZH[key.replace(/_one$/, "_other")]);
  });
});

describe("enum values in words (spec §3.5)", () => {
  it("shows a known value in the reader's language and an unknown one as sent", async () => {
    expect(enumText("theme", "dark")).toBe("dark");
    await i18n.changeLanguage("zh");
    expect(enumText("theme", "dark")).toBe("深色");
    expect(enumText("theme", "sepia")).toBe("sepia");
  });
});
```

`web/tests/i18nDetect.test.tsx`:

```tsx
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
});
```

`web/tests/i18nSwitch.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §4, §6.7: choosing 中文 in the sidebar writes orca.panel.lang = zh, sets <html lang="zh"> and
 * re-renders the page's text; choosing English reverses all three. Task 6 adds the helper-built case (a chain banner).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// Copied verbatim from web/tests/controlCommandRecovery.test.tsx:100 (the page reads the metrics on load).
const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
/** What GET /api/chains answers; a Task 6 case puts a stopped chain here. */
let chainRepos: unknown[] = [];

beforeEach(() => {
  window.localStorage.clear();
  chainRepos = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/metrics") return json(METRICS);
    if (url === "/api/chains") return json({ repos: chainRepos });
    // No control plane in this criterion: the config read is refused and the page shows no control section.
    return json({ error: { code: "control-port-unconfigured", message: "no control plane in this criterion" } }, 404);
  }) as typeof fetch;
});
afterEach(cleanup);

async function languageSelect(container: HTMLElement): Promise<HTMLSelectElement> {
  return waitFor(() => {
    const select = container.querySelector<HTMLSelectElement>('select[name="language"]');
    if (select === null) throw new Error("no language switch yet");
    return select;
  });
}

describe("the language switch (spec §6.7)", () => {
  it("switches the page to Chinese and back, remembering the choice in this browser", async () => {
    const { container } = render(<App />);
    const select = await languageSelect(container);
    expect(screen.getByRole("link", { name: /Decisions/ })).toBeTruthy();
    fireEvent.change(select, { target: { value: "zh" } });
    await waitFor(() => expect(screen.getByRole("link", { name: /决策/ })).toBeTruthy());
    expect(window.localStorage.getItem("orca.panel.lang")).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
    expect(select.value).toBe("zh");
    expect(container.textContent).toContain("主题");
    fireEvent.change(select, { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("link", { name: /Decisions/ })).toBeTruthy());
    expect(window.localStorage.getItem("orca.panel.lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/i18nKeys.test.ts tests/i18nDetect.test.tsx tests/i18nSwitch.test.tsx) > "$SCRATCH/t2-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: every test red (the modules `../src/i18n.js`, `../src/locales/*.js` do not exist; the switch finds no `select[name="language"]`).

- [ ] **Step 4: Implement**

`web/src/locales/en.ts`:

```ts
/**
 * Panel i18n spec §2: the English resource. It is the source shape (`as const`), and every value is today's panel text
 * byte for byte. Keys are grouped by panel area. Enum families (spec §3.5) are Records over the value unions, so a new
 * value is a compile error here until it has its words. Tasks 3-10 add their areas.
 */
import type { ThemePref } from "../theme.js";

/** The Chinese resource's type: the same key set, every value widened to string (spec §2). */
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

const theme = { system: "system", light: "light", dark: "dark" } as const satisfies Record<ThemePref, string>;

export const en = {
  nav: { sections: "Sections", decisions: "Decisions", chains: "Chains", tasks: "Task control", metrics: "Metrics" },
  shell: {
    brandTitle: "Leave it to Orca — every idea, made real.",
    chainRunning: "a chain is running",
    needsAttention: "needs attention",
    theme: "Theme",
    language: "Language",
    loading: "orca panel loading…",
    epoch: "epoch {{epoch}}",
  },
  common: { none: "none", na: "n/a", unknown: "unknown", dispatchBlocked: "dispatch blocked", dispatchLive: "dispatch live" },
  enums: { theme },
} as const;
```

`web/src/locales/zh.ts`:

```ts
/**
 * Panel i18n spec §2, §5: the Chinese resource, the same key set as en (a missing or extra key is a compile error; the
 * _one plural keys carry the _other text). zhErrors (spec §3.2) is Chinese-only and not part of the key set: the text
 * shown for a refusal code in place of the server's English message; a code with no entry shows the message as sent.
 * The human reviews these values before the round closes (spec §5).
 */
import type { Translation, en } from "./en.js";

export const zh: Translation<typeof en> = {
  nav: { sections: "分区", decisions: "决策", chains: "链", tasks: "任务控制", metrics: "指标" },
  shell: {
    brandTitle: "交给 Orca —— 每个想法，都能成真。",
    chainRunning: "有一条链在运行",
    needsAttention: "需要处理",
    theme: "主题",
    language: "语言",
    loading: "orca 面板加载中…",
    epoch: "纪元 {{epoch}}",
  },
  common: { none: "无", na: "不适用", unknown: "未知", dispatchBlocked: "派发已阻断", dispatchLive: "派发正常" },
  enums: { theme: { system: "跟随系统", light: "浅色", dark: "深色" } },
};

export const zhErrors: Record<string, string> = {};
```

`web/src/i18n.ts`:

```ts
/**
 * Panel i18n spec §2, §4: the panel's one i18next instance. English is the fallback and reproduces today's text; the
 * language follows the browser unless this browser chose one (orca.panel.lang). Detection never writes the choice
 * (caches: []): only the Language switch does, so today's browser language is never frozen into a choice (ruling L2).
 */
import { createInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en.js";
import { zh } from "./locales/zh.js";

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
```

`web/tests/setup.ts`:

```ts
/**
 * Panel i18n spec §6.1: every web criterion renders in English unless it switches the language itself, and a criterion
 * that switches is put back to English afterwards.
 */
import { afterEach } from "vitest";
import i18n, { initI18n } from "../src/i18n.js";

initI18n({ lng: "en" });
afterEach(async () => {
  await i18n.changeLanguage("en");
});
```

`web/vite.config.ts:14`: `test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },` → `test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], setupFiles: ["tests/setup.ts"] },`

`web/src/main.tsx`: add `import { initI18n } from "./i18n.js";` after the `./App.js` import, and the line `initI18n();` directly before `applyTheme(document.documentElement, readTheme(storage));`.

`web/src/Shell.tsx`:
- imports: after `import type { JSX, ReactNode } from "react";` add
  ```ts
  import { useTranslation } from "react-i18next";
  import { LANGUAGE_NAMES, PANEL_LANGUAGES, enumText } from "./i18n.js";
  import type { PanelLanguage } from "./i18n.js";
  ```
- line 12 `const LABELS: Record<Section, string> = { decisions: "Decisions", chains: "Chains", tasks: "Task control", metrics: "Metrics" };` →
  ```ts
  const NAV_KEY = { decisions: "nav.decisions", chains: "nav.chains", tasks: "nav.tasks", metrics: "nav.metrics" } as const satisfies Record<Section, string>;
  ```
- `Badge` (lines 42-47): first line of the body `const { t } = useTranslation();`; `title="a chain is running"` → `title={t("shell.chainRunning")}`; `title="needs attention"` → `title={t("shell.needsAttention")}`.
- `Shell` props (after `onTheme?: (pref: ThemePref) => void;`): add
  ```ts
  /** Panel i18n spec §4: the language on screen and the switch; absent in criteria that render the shell alone. */
  language?: PanelLanguage;
  onLanguage?: (lang: PanelLanguage) => void;
  ```
- `Shell` body: first line `const { t } = useTranslation();`; `aria-label="Sections"` → `aria-label={t("nav.sections")}`; `title="Leave it to Orca — every idea, made real."` → `title={t("shell.brandTitle")}`; `<span>{LABELS[section]}</span>` → `<span>{t(NAV_KEY[section])}</span>`; the theme label becomes
  ```tsx
          <label className="theme-pick">
            {t("shell.theme")}
            <select name="theme" value={props.theme} onChange={(e) => props.onTheme?.(e.currentTarget.value as ThemePref)}>
              {THEME_PREFS.map((pref) => <option key={pref} value={pref}>{enumText("theme", pref)}</option>)}
            </select>
          </label>
          <label className="theme-pick">
            {t("shell.language")}
            <select name="language" value={props.language ?? "en"} onChange={(e) => props.onLanguage?.(e.currentTarget.value as PanelLanguage)}>
              {PANEL_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>)}
            </select>
          </label>
  ```
- Header comment: append the line ` * Panel i18n spec §4: the Language switch sits beside Theme; each option names its language in that language.`

`web/src/App.tsx`:
- imports: add `import { useTranslation } from "react-i18next";` after line 26; add `import i18n, { currentLanguage, writeLanguage } from "./i18n.js";` after the `./ErrorPage.js` import; add `ControlSummaryV1` to the type import from `./controlTypes.js` (line 70).
- after line 122 (`const pageHidden = …`) add:
  ```ts
  /** The sidebar footer's lines (panel i18n spec §3.3); exported for the pseudo-locale criterion. */
  export function footerLines(summary: ControlSummaryV1 | null): string[] {
    if (summary === null) return [];
    return [i18n.t("shell.epoch", { epoch: summary.epoch }), i18n.t(summary.dispatchBlocked ? "common.dispatchBlocked" : "common.dispatchLive")];
  }
  ```
- line 133 (first line of `App`): insert `  const { t } = useTranslation();` before `const [home, setHome] = …`.
- line 565: `if (home === null) return <main>orca panel loading…</main>;` → `if (home === null) return <main>{t("shell.loading")}</main>;`
- line 620: `footer={summary === null ? [] : [`epoch ${summary.epoch}`, summary.dispatchBlocked ? "dispatch blocked" : "dispatch live"]}` → `footer={footerLines(summary)}`; after `theme={theme}` add
  ```tsx
      language={currentLanguage()}
      onLanguage={(lang) => {
        writeLanguage(browserStorage(), lang);
        void i18n.changeLanguage(lang);
      }}
  ```

- [ ] **Step 5: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/i18nKeys.test.ts tests/i18nDetect.test.tsx tests/i18nSwitch.test.tsx) > "$SCRATCH/t2-green.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t2-web-check.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t2-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0`; `t2-web-check.txt` shows every existing web test file passing unmodified (spec §6.1) plus the three new ones.

- [ ] **Step 6: Mutations** (`$SCRATCH/mut-t2`; files: every file of this Task; criteria: `(cd "$M/web" && ../node_modules/.bin/vitest run tests/<file>)`)
  - MT2-1 switch not wired: in `Shell.tsx`, `props.onLanguage?.(e.currentTarget.value as PanelLanguage)` → `undefined`. Red: `i18nSwitch … > switches the page to Chinese and back …`.
  - MT2-2 choice not remembered: delete `writeLanguage(browserStorage(), lang);` in `App.tsx`. Red: same test (storage assertion).
  - MT2-3 `<html lang>` not followed: delete `i18n.on("languageChanged", syncHtmlLang);`. Red: same test (`document.documentElement.lang` stays `en`).
  - MT2-4 browser before choice: `order: ["orcaStored", "navigator"]` → `["navigator", "orcaStored"]`. Red: `i18nDetect … > lets a stored zh beat a browser that says en-US` and `… > lets a stored en beat a browser that says zh-CN`.
  - MT2-5 detection persists: `caches: []` → `caches: ["localStorage"]`. Red: `i18nDetect … > writes nothing while detecting …`.
  - MT2-6 language, not resolvedLanguage: in `currentLanguage`, `i18n.resolvedLanguage === "zh"` → `i18n.language === "zh"`. Red: `i18nDetect … > resolves a zh-TW browser to zh …` (`htmlLang` is `en`).
  - MT2-7 unguarded storage access: `browserStorage` body → `return typeof window === "undefined" ? undefined : window.localStorage;` (no try). Red: `i18nDetect … > … when touching localStorage at all throws`.
  - MT2-8 unguarded read: `readLanguage` body → `return storage?.getItem(LANG_KEY) ?? undefined;` (no try). Red: `i18nDetect … > … when reading storage throws`.
  - MT2-9 nav not translated: `<span>{t(NAV_KEY[section])}</span>` → `<span>{NAV_KEY[section].slice(4)}</span>`. Red: `i18nSwitch …` and `i18nDetect … > lets a stored zh beat …` (no `决策`).
  - MT2-10 key parity: in `zh.ts`, `export const zh: Translation<typeof en> = {` → `export const zh = {` and delete `metrics: "指标", ` from `nav`. Red: `i18nKeys … > gives Chinese exactly the English keys …`.
  - MT2-11 placeholder dropped: `zh.shell.epoch` `"纪元 {{epoch}}"` → `"纪元"`. Red: `i18nKeys … > keeps every placeholder …`.
  - MT2-12 unknown enum shown as a key: `enumText` body → `return i18n.t(\`enums.${family}.${value}\` as never) as string;`. Red: `i18nKeys … > shows a known value … and an unknown one as sent` (`enums.theme.sepia`).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add web/package.json package-lock.json web/src/i18n.ts web/src/locales/en.ts web/src/locales/zh.ts web/tests/setup.ts web/vite.config.ts web/src/main.tsx web/src/Shell.tsx web/src/App.tsx web/tests/i18nKeys.test.ts web/tests/i18nDetect.test.tsx web/tests/i18nSwitch.test.tsx
/usr/bin/git commit -F - <<'MSG'
feat(web): switch the panel between English and Chinese

react-i18next with the panel's own instance and two static resources: English
reproduces today's text, Chinese has the same keys (a missing one does not
compile). The language follows the browser unless this browser chose one; a
Language select beside Theme writes the choice and <html lang> follows the
resolved language. Detection writes nothing. The nav, theme and footer are
the first area converted.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

