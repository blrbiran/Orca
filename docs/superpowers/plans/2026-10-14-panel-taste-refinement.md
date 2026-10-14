# Orca 面板精修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 critique 的 P1-1…P1-4 与 P2-5…P2-7：语气显式化、外壳不挤内容、审阅流程提速、Overview/Metrics 去冗余、统一模板与中文术语，浅色暖纸、深色中性石墨。

**Architecture:** 只动 `web/`。样式集中在 `web/src/styles.css`；行为改动落在小的纯模块（`reviewFlow.ts`、`reviewKeys.ts`）并由 `App.tsx` 接线；组件只做最小标记改动（加 `data-tone`、包一层 `div`、截断渲染）。jsdom 不加载 CSS ⇒ 每条只靠 CSS 的承诺都配一条直接读样式表的判据。

**Tech Stack:** React 19、TypeScript、vitest 5 + jsdom + @testing-library/react、react-i18next。

**Spec:** `docs/superpowers/specs/2026-10-14-panel-taste-refinement-design.md`

## Global Constraints

- 工作目录：worktree `/Users/biran/code/skills/orca/Orca-wt/ui-taste`，分支 `ui/panel-taste`。主工作树 `/Users/biran/code/skills/orca/Orca` 不跑 build／测试、不提交。
- **只改 `web/`**（含 `web/DESIGN.md`）＋本计划与 spec。`src/`（服务端）一行不动。
- **既有判据一条不改写。** 某步让既有判据变红 ⇒ 停下，按 superpowers:systematic-debugging 找原因；确需改写 ⇒ 列出文件:行与理由，升人。
- 单测命令（在 `web/` 下）：`npx vitest run <file>`。**每个任务提交前都跑整套 web**：在 worktree 根 `npm run --ws check > "$SCRATCH/task-N-check.log" 2>&1; echo RC $?`，再整份读回日志（CLAUDE.md Rule 14：不 grep 过滤验证性输出）。`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/62660548-e640-4d47-b3ba-b374f20a1a7a/scratchpad`；日志一律写这里，不写 `/tmp`。
- 测试环境：`web/vite.config.ts` 默认 environment 是 **node**。任何用到 `document`／`window`／`@testing-library/react` 的新测试文件第一行必须是 `// @vitest-environment jsdom`（照既有 .tsx 测试）。
- locale 是**具名导出**：`import { en } from "../src/locales/en.js"`、`import { zh } from "../src/locales/zh.js"`。
- 对既有测试文件**只追加**：提交前 `git diff web/tests/<file>` 整份读，确认没有 `-` 开头的删除行。
- 新 i18n key：en 与 zh 同时加；zh 文本必须与 en 不同；不加 `_one/_other`（避免 `i18nKeys` 的复数规则）。
- `styles.css` 编辑规则：三个主题块（`:root {`、`:root[data-theme="light"] {`、`@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {`）内不得出现 `}` 或注释花括号；新规则不得以既有被测选择器结尾并出现在原规则之前；被测 token 保持 `#rrggbb`／`rgba(...)` 形式。
- 不得改变「所有分区始终挂载」：`.section-pane:not([data-active="true"]) { display: none; }` 原样保留。
- 变异只在 `git clone --local --branch ui/panel-taste` 的副本里做；还原以 `git diff`＋`git diff --cached` 字节数为 0 为证。
- 提交信息结尾：`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。push／合并归人。

## Review Focus

1. **在 Decisions 上出错时 App 不崩**（新 hook 必须在 `if (error !== null) return` 之前）—— Task 4 的 App 判据含一条：打开决策后让 `/api/decision` 拒绝，页面渲染 ErrorPage 而不抛 hook 顺序错误。
2. **按住或连按 `a` 只发一次 `POST /api/reviews`**（同意不可撤销）—— Task 4 判据：`repeat: true` 不发；在途请求期间第二次 `a` 不发。
3. **真错误在两套主题下仍是红的**：`role="alert"` 无 `data-tone` 时为 danger 色 —— Task 2 判据读样式表；Task 9 截图核对一处真错误。
4. **焦点在输入框里按 a/j/k/c 不触发审阅** —— Task 4 `reviewKeyAction` 判据（input／textarea／select／`[contenteditable]`／带修饰键）＋ App 级 textarea 判据（带等待）。
5. **≤760px 与矮屏下长页能整页滚到底，且项目说明仍可见** —— Task 3 样式判据（含不隐藏 `.project-control .caveat`）＋ Task 9 在 390×844、320×256、720×450 实测；Overview 内层无边框以 Task 9 截图核对（jsdom 不渲染样式）。

---

### Task 1: DESIGN.md 与两套主题 token

**Files:**
- Create: `web/DESIGN.md`
- Modify: `web/src/styles.css:1-75`（深色 `:root` 块；两个浅色块）
- Create: `web/tests/lightTheme.test.ts`

**Interfaces:** Produces 主题 token 值（后续任务只引用 token 名，不写色值）。

- [ ] **Step 1: 写会红的判据** `web/tests/lightTheme.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Taste refinement spec §4 (session 62660548): the light theme had no contrast criterion, and its two blocks
 * (manual choice, system preference) were pasted twice and could drift. Same WCAG formula as contrast.test.ts.
 */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const blockOf = (opener: string): string => {
  const at = css.indexOf(opener);
  if (at === -1) throw new Error(`no block ${opener}`);
  return css.slice(at + opener.length, css.indexOf("}", at));
};
const manual = blockOf(':root[data-theme="light"] {');
const system = blockOf(':root:not([data-theme="dark"]) {');
const tok = (block: string, name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`no light token --${name}`);
  return m[1]!.trim();
};
type Rgb = [number, number, number];
const hex = (v: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`not #rrggbb: ${v}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
};
const paint = (v: string, under: Rgb): Rgb => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (!m) return hex(v);
  const a = Number(m[4]);
  return [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * under[k]!)) as Rgb;
};
const lum = (c: Rgb): number => {
  const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
const norm = (block: string): string[] => block.split(";").map((d) => d.trim()).filter(Boolean).sort();

describe("light theme (taste refinement spec §4)", () => {
  it("defines the manual and the system light theme with exactly the same declarations", () => {
    expect(norm(manual)).toEqual(norm(system));
  });

  it("is a warm paper: the page is warmer than neutral (red channel above blue)", () => {
    const [r, , b] = hex(tok(manual, "bg"));
    expect(r - b).toBeGreaterThanOrEqual(5);
  });

  it("keeps body, secondary and accent text readable on every light surface", () => {
    const card = hex(tok(manual, "card")), bg = hex(tok(manual, "bg")), hover = hex(tok(manual, "bg-hover"));
    const selected = paint(tok(manual, "accent-subtle"), card);
    expect(ratio(hex(tok(manual, "text")), card)).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(tok(manual, "text")), bg)).toBeGreaterThanOrEqual(7);
    for (const under of [card, bg, hover, selected]) expect(ratio(hex(tok(manual, "muted")), under)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(tok(manual, "on-accent")), hex(tok(manual, "accent")))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(tok(manual, "accent")), card)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a link readable on a hovered row (independent review: #2563eb measured 4.31 there)", () => {
    expect(ratio(hex(tok(manual, "accent")), hex(tok(manual, "bg-hover")))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("dark theme is a neutral graphite (human ruling R3: not warm)", () => {
  const dark = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  it("keeps every dark surface near-neutral: no channel more than 10 apart, blue never below red", () => {
    for (const name of ["bg", "card", "bg-elevated", "bg-hover", "border", "border-strong"]) {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(dark);
      const [r, g, b] = hex(m![1]!);
      expect(Math.max(r, g, b) - Math.min(r, g, b), name).toBeLessThanOrEqual(10);
      expect(b, name).toBeGreaterThanOrEqual(r);
    }
  });
});
```

- [ ] **Step 2: 跑，确认红在预期处**

Run: `cd web && npx vitest run tests/lightTheme.test.ts`
Expected: FAIL —「warm paper」（今天 `#faf9f7` r-b=3）、「neutral graphite」（今天 `#1a1e28` 差 14）与「link on a hovered row」（今天 4.31）红；「exactly the same」今天应绿（两块现相同）——记下它绿，变异在 Step 6 证明它能红。

- [ ] **Step 3: 改 token**

深色 `:root {` 块只替换这九行的值（其余行不动）：

```css
  --bg: #0e0f11;
  --bg-elevated: #1f2125;
  --bg-hover: #282a2f;
  --card: #1b1c1f;
  --border: #393b41;
  --border-strong: #4b4e55;
  --text: #d6d7da;
  --text-strong: #f7f7f8;
  --muted: #a6a8ae;
```

两个浅色块里的第一行 `--bg: …; --bg-elevated: …; --bg-hover: …; --card: …;` 与第二行 `--border…--muted` 在两处都改为（逐字相同）：

```css
    --bg: #f6f4ef; --bg-elevated: #fffdf9; --bg-hover: #eeeae2; --card: #fffdf9;
    --border: #e3ddd1; --border-strong: #cfc7b8; --text: #3d3830; --text-strong: #1c1915; --muted: #6a645a;
```

（`[data-theme="light"]` 块的缩进是两格，照它原缩进；内容逐字相同。）

两个浅色块里还要把 accent 加深（spec §7：旧 `#2563eb` 在 hover 行上 4.31）：
`--accent: #2563eb; --accent-subtle: rgba(37, 99, 235, 0.1);` → `--accent: #1d4ed8; --accent-subtle: rgba(29, 78, 216, 0.1);`；
`--info: #2563eb;` → `--info: #1d4ed8;`；`--info-subtle: rgba(37, 99, 235, 0.08)` → `--info-subtle: rgba(29, 78, 216, 0.08)`。（`--cat-done` 不动。）

- [ ] **Step 4: 写 `web/DESIGN.md`**

```markdown
# Orca panel — DESIGN

Operate mode: a single developer reviews agent decisions and steers task groups. Density and scanability over expression.

## Themes
- Light = warm paper (`--bg #f6f4ef`, cards `#fffdf9`, warm grey text). Dark = neutral graphite (channels within 10, blue ≥ red); never warm.
- Layers separate by stepping LIGHTER in dark, DARKER-edged in light. Values are pinned by `tests/contrast.test.ts` and `tests/lightTheme.test.ts` — re-run both before changing any token.
- The two light blocks are identical by rule (`lightTheme.test.ts`).

## Tone, not role
- `role` is semantics for assistive tech only. A box with `role=alert|status|note` is NEUTRAL by default.
- Colour comes only from `data-tone`: `info` (blue), `ok` (green), `warn` (amber), `danger` (red). Pick by meaning:
  refusals/errors = danger; blocked/waiting/needs-action = warn; recorded/done = ok; running/in-progress = info; config facts and "not read yet" = no tone.
- Static configuration text is `role="note"`, never `alert`.

## Type
- Body 14px. h3 14px/600. h2 18px. h1 22px (Decisions' title is sized as an h2 so every page title matches).
- Numbers that change (counts, rates, ids) use `font-variant-numeric: tabular-nums` where they sit in rows.

## Buttons
- One primary per view: only `.btn-primary` is filled with the accent. `type="submit"` alone is a secondary button.

## Layout
- ≥761px: fixed shell, sidebar and content scroll independently. ≤760px: the page scrolls as a whole; nav is one horizontally scrolling row; footer and long sidebar captions hide.
- Panes stay mounted; only `.section-pane:not([data-active="true"])` hides one.
```

- [ ] **Step 5: 跑本判据＋两条既有样式判据**

Run: `cd web && npx vitest run tests/lightTheme.test.ts tests/contrast.test.ts tests/styles.test.ts`
Expected: 全 PASS。

- [ ] **Step 6: 变异（clone 内）** — M1a：把 `[data-theme="light"]` 块的 `--muted` 改回 `#6e6960` 而系统块不改 ⇒「exactly the same」红；M1b：深色 `--card` 改回 `#1a1e28` ⇒ graphite 判据红；M1c：浅色 `--muted` 改 `#8a8478` ⇒ 可读性判据红。clone diff 归零。

- [ ] **Step 7: 提交**

```bash
git add web/DESIGN.md web/src/styles.css web/tests/lightTheme.test.ts
git commit -m "feat(web): warm paper light theme, neutral graphite dark theme, and a DESIGN.md that pins them"
```

---

### Task 2: 语气显式化（P1-1）

**Files:**
- Modify: `web/src/styles.css:147-156`（role 规则）、`:132`（uncertain 覆盖保持有效）、`.notices`（Task 3 再动）
- Modify: `web/src/Refusal.tsx:30`、`web/src/RefusalNotice.tsx:14`、`web/src/ChainPanel.tsx:49`、`web/src/ControlPanel.tsx:245-249`、`web/src/App.tsx:1178,1232`、`web/src/Overview.tsx:16`、`web/src/UsageSettlement.tsx:33`
- Create: `web/tests/tone.test.tsx`

**Interfaces:** Produces 属性约定 `data-tone="info"|"ok"|"warn"|"danger"`（无属性＝中性）；`ChainPanel.tsx` 导出 `export const BANNER_TONE: Record<Banner["category"], "ok" | "warn" | "danger">`。

- [ ] **Step 1: 先确认改 role 不撞既有判据**

Run: `cd web && grep -rn "No execution port\|noPort\|未配置执行端口\|executionPort\|getByRole(\"note\"\|getByRole(\"alert\"\|findByRole(\"alert\"" tests > "$SCRATCH/t2-roles.txt"; cat "$SCRATCH/t2-roles.txt"`（读整份）。
对每个单数 `getByRole("note")`／`getByRole("alert")`：看它的夹具是否 `executionPort: "unconfigured"` 且渲染了 ControlPanel —— 若是，把 noPort 改成 note 会造成多匹配或少匹配 ⇒ 不改 role，只加 `data-tone="warn"`，台账记 Ruling。
（不改：导航红点 `Shell.tsx` `controlAlert` 仍把「无执行端口」算作告警 —— `shell.test.tsx` 钉着，改它需人授权，Task 9 列入 awaitingHuman。）

- [ ] **Step 2: 写会红的判据** `web/tests/tone.test.tsx`

```tsx
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANNER_TONE, ChainBanners } from "../src/ChainPanel.js";
import { Refusal } from "../src/Refusal.js";

/** Taste refinement spec §3 P1-1: role is semantics; colour comes only from data-tone. */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

describe("tone, not role (P1-1)", () => {
  it("paints status and note boxes neutral: no status colour in the shared rule, no green for role=status", () => {
    const r = rule('[role="alert"], [role="note"], [role="status"], .callout, .chain-banner');
    for (const t of ["--danger", "--ok", "--info", "--warn"]) expect(r).not.toContain(t);
    expect(css).not.toMatch(/\[role="status"\]\s*\{[^}]*--ok/);
    expect(css).not.toMatch(/\[role="note"\][^{]*\{[^}]*--info/);
  });

  it("keeps an alert with no stated tone red: real errors stay red (spec §7, Review Focus 3)", () => {
    expect(rule('[role="alert"]:not([data-tone])')).toContain("var(--danger-subtle)");
  });

  it("gives each tone its own colour", () => {
    for (const t of ["info", "ok", "warn", "danger"]) {
      expect(rule(`[data-tone="${t}"]`)).toContain(`var(--${t}-subtle)`);
    }
  });

  it("marks a refusal as danger", () => {
    const html = renderToStaticMarkup(<Refusal refusal={{ status: 409, code: "x", message: "m" }} />);
    expect(html).toMatch(/role="alert"[^>]*data-tone="danger"|data-tone="danger"[^>]*role="alert"/);
  });

  it("tones a chain banner by what happened, not as an alarm", () => {
    expect(BANNER_TONE).toEqual({ done: "ok", blocked: "warn", limit: "warn", anomaly: "danger" });
    const html = renderToStaticMarkup(
      <ChainBanners banners={[{ chainId: "c1", category: "done", text: "done", repoKey: "r", reason: "ok", awaitingHuman: [] } as never]} />,
    );
    expect(html).toContain('data-tone="ok"');
  });
});

describe("dark tone boxes stay readable (Review Focus 1)", () => {
  const dark = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const tok = (n: string): string => new RegExp(`--${n}:\\s*([^;]+);`).exec(dark)![1]!.trim();
  const hex = (v: string): number[] => [0, 2, 4].map((i) => parseInt(v.slice(1).slice(i, i + 2), 16));
  const paint = (v: string, under: number[]): number[] => {
    const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v)!;
    const a = Number(m[4]);
    return [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * under[k]!));
  };
  const lum = (c: number[]): number => {
    const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  it("keeps text-strong ≥ 4.5 on every tone fill over a card", () => {
    for (const t of ["info", "ok", "warn", "danger"]) {
      const fill = paint(tok(`${t}-subtle`), hex(tok("card")));
      const [hi, lo] = [lum(hex(tok("text-strong"))), lum(fill)].sort((x, y) => y - x);
      expect((hi! + 0.05) / (lo! + 0.05), t).toBeGreaterThanOrEqual(4.5);
    }
  });
});
```

注：`Banner` 的真实字段以 `web/src/chainBanner.ts` 为准；若字段名不同，按它改夹具字段（不改断言意图）。

- [ ] **Step 3: 跑，确认红**

Run: `cd web && npx vitest run tests/tone.test.tsx`
Expected: FAIL（`BANNER_TONE` 不存在 / 共享规则不存在 / 无 `data-tone`）。

- [ ] **Step 4: 实现**

`styles.css` 把 147-156 三条 role 规则替换为：

```css
/* Taste refinement spec P1-1/§7: role is semantics; status and note are neutral, an alert with no stated tone is an error. */
[role="alert"], [role="note"], [role="status"], .callout, .chain-banner {
  border: 1px solid var(--border); background: var(--bg); color: var(--text-strong);
  border-radius: var(--radius-sm); padding: 10px 12px; margin: 0 0 8px; font-size: var(--text-sm);
}
[role="alert"]:not([data-tone]) { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: var(--danger-subtle); }
[data-tone="info"] { border-color: color-mix(in srgb, var(--info) 40%, var(--border)); background: var(--info-subtle); }
[data-tone="ok"] { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); background: var(--ok-subtle); }
[data-tone="warn"] { border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); background: var(--warn-subtle); }
[data-tone="danger"] { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: var(--danger-subtle); }
```

组件：
- `Refusal.tsx:30`：`<div className="refusal" role="alert" data-tone="danger">`
- `RefusalNotice.tsx:14`：在 `role="alert"` 后加 `data-tone="danger"`。
- `ChainPanel.tsx`：在 `ChainBanners` 前加
  ```tsx
  /** Taste refinement P1-1: a finished chain is good news; only an anomaly is an alarm. */
  export const BANNER_TONE = { done: "ok", blocked: "warn", limit: "warn", anomaly: "danger" } as const satisfies Record<Banner["category"], "ok" | "warn" | "danger">;
  ```
  并在 banner `<div … role="alert"` 上加 `data-tone={BANNER_TONE[b.category]}`。（`Banner` 类型若未在此文件导入，从 `./chainBanner.js` 导入。）
- `ControlPanel.tsx:245-249`：
  ```tsx
  {config.executionPort === "unconfigured" && (
    <p role="note" data-tone="warn">{t("control.noPort")}</p>
  )}
  {summary.resetRequired && <p role="alert" data-tone="danger">{t("control.resetRequired")}</p>}
  {refetchRequired && <p role="alert" data-tone="info">{t("control.refetchRequired")}</p>}
  {recovery.dispatchBlocked && <p role="alert" data-tone="danger">{t("control.dispatchBlockedRecovery")}</p>}
  ```
  （Step 1 若发现 noPort 被按 alert 钉住，则这一行保留 `role="alert"`，只加 tone。）
- `App.tsx:1178`：`<p role="status" data-tone="ok">{t(inline.status.text)}</p>`
- `App.tsx:1232`：running chain banner 的 `<div … role="status" className="chain-banner">` 加 `data-tone="info"`。
- `Overview.tsx:16`：issue 行 `<p role="alert" data-tone="warn" …>`。
- `UsageSettlement.tsx:33`：该 `role="status"` 加 `data-tone="warn"`。

- [ ] **Step 5: 跑本判据与可能受影响的套件**

Run: `cd web && npx vitest run tests/tone.test.tsx`，再在 worktree 根 `npm run --ws check > "$SCRATCH/task-2-check.log" 2>&1; echo RC $?`，整份读。
Expected: 两者 RC 0。

- [ ] **Step 6: 变异（clone）** — M2a：共享规则里 `background: var(--bg)` 改 `var(--danger-subtle)` ⇒ 首条红；M2b：删 `[data-tone="warn"]` 规则 ⇒ 第二条红；M2c：`Refusal` 去掉 `data-tone` ⇒ 第三条红；M2d：`BANNER_TONE.done = "danger"` ⇒ 第四条红；M2e：深色 `--warn-subtle` 透明度改 0.9 ⇒ Review Focus 1 红。

- [ ] **Step 7: 提交**

```bash
git add web/src web/tests/tone.test.tsx
git commit -m "fix(web): colour a message by its tone, not its ARIA role (P1-1)"
```

---

### Task 3: 外壳不再挤压内容（P1-2）

**Files:**
- Modify: `web/src/styles.css`（`.notices`；末尾 `@media (max-width: 760px)` 里 `.authenticated-shell` 那组）
- Modify: `web/src/AuthGate.tsx:262-305`（`Notices`）、`web/src/Shell.tsx`（跳到正文）、`web/src/locales/en.ts`/`zh.ts`（`auth.dismissAll`、`shell.skipToContent`）
- Create: `web/tests/shellReflow.test.ts`、`web/tests/skipLink.test.tsx`；Modify: `web/tests/authGate.test.tsx`（**只追加**一条新 `it`，不动既有）

**Interfaces:** Produces i18n key `auth.dismissAll`（en `"Dismiss all"`，zh `"全部知道了"`）。

- [ ] **Step 1: 写会红的样式判据** `web/tests/shellReflow.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Taste refinement P1-2 (audit C, measured): at 390x844 the content area was 278px, at 320x256 32px, because the
 * shell locks 100dvh and the sidebar takes up to 45dvh. On narrow screens the page must scroll as a whole.
 */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const narrow = (): string => {
  const marker = "/* Narrow screens: the page scrolls as a whole (taste refinement P1-2). */";
  const at = css.indexOf(marker);
  if (at === -1) throw new Error("no narrow-shell block");
  return css.slice(at, css.indexOf("\n}\n", at));
};

describe("narrow shell (P1-2)", () => {
  it("unlocks the viewport height and lets the page scroll, on narrow AND on short screens", () => {
    const b = narrow();
    expect(b).toContain("@media (max-width: 760px), (max-height: 560px)");
    expect(b).toMatch(/\.authenticated-shell \{[^}]*height: auto;[^}]*overflow: visible;/);
    expect(b).toMatch(/\.authenticated-shell \.sidebar \{[^}]*max-height: none;/);
    expect(b).toMatch(/\.authenticated-shell \.content \{[^}]*overflow: visible;/);
  });
  it("keeps navigation to one scrolling row and hides what only the desktop needs", () => {
    const b = narrow();
    expect(b).toMatch(/\.nav \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
    expect(b).toMatch(/\.sidebar-foot \{[^}]*display: none;/);
    // Review Focus 5: once Task 7 hides the never-enabled Add/Rename, the caption is the only explanation left.
    expect(b).not.toContain(".project-control .caveat");
  });
  it("gives touch screens 44px targets (audit C P2)", () => {
    const at = css.indexOf("@media (pointer: coarse) {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/button, select, input, \.nav-item \{ min-height: 44px;/);
  });
  it("hides the skip link until it is focused", () => {
    const at = css.indexOf(".skip-link:focus {");
    expect(at).toBeGreaterThan(-1);
    const base = css.slice(css.indexOf(".skip-link {"), css.indexOf("}", css.indexOf(".skip-link {")));
    expect(base).toContain("left: -9999px");
  });
  it("shows owners' notices as a quiet warning, not an alarm band", () => {
    const at = css.indexOf(".notices {");
    const r = css.slice(at, css.indexOf("}", at));
    expect(r).toContain("var(--warn-subtle)");
    expect(r).not.toContain("--danger");
  });
});
```

在 `web/tests/authGate.test.tsx` 的 `describe` 末尾追加（沿用该文件已有的 `notices`、`render`、`posts` 等辅助；具体渲染方式照 :246 那条复制）：

```tsx
  // Taste refinement P1-2: two or more notices can be acknowledged at once.
  it("acknowledges every open notice with one Dismiss all", async () => {
    notices = [
      { seq: 3, at: 0, kind: "user-created", body: { name: "eve" } },
      { seq: 5, at: 0, kind: "password-changed", body: { name: "eve" } },
    ];
    // render exactly as the :246 test does for an owner
    const banner = await screen.findByRole("region", { name: /security notices/i });
    notices = [];
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss all" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /security notices/i })).toBeNull());
    expect(posts("/api/auth/notices/3/ack")).toHaveLength(1);
    expect(posts("/api/auth/notices/5/ack")).toHaveLength(1);
  });
```

（执行者：把「render exactly as…」替换成 :246 那条里渲染 owner 的同一段代码；`within`/`fireEvent`/`waitFor` 若未导入则从 `@testing-library/react` 导入。）

- [ ] **Step 2: 跑，确认红**

Run: `cd web && npx vitest run tests/shellReflow.test.ts tests/authGate.test.tsx`
Expected: 新 3+1 条红，authGate 既有条目绿。

- [ ] **Step 3: 实现**

`styles.css`：把 `.notices { … background: var(--danger-subtle); }` 改为
```css
.notices { padding: 6px 24px; border-bottom: 1px solid var(--border); background: var(--warn-subtle); font-size: var(--text-sm); }
.notices ul { margin: 0; padding-left: 16px; }
.notices li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.notices button { padding: 2px 10px; }
```
把文件末尾 authenticated-shell 区段里的
```css
@media (max-width: 760px) {
  .authenticated-shell > .shell { grid-template-rows: minmax(0, auto) minmax(0, 1fr); }
  .authenticated-shell .sidebar { height: auto; max-height: 45dvh; }
}
```
整段替换为（注释行一字不差，判据靠它定位）：
```css
/* Narrow screens: the page scrolls as a whole (taste refinement P1-2). */
@media (max-width: 760px), (max-height: 560px) {
  .authenticated-shell { height: auto; min-height: 100dvh; overflow: visible; }
  .authenticated-shell > .shell { overflow: visible; grid-template-rows: auto auto; }
  .authenticated-shell > .notices { max-height: none; }
  .authenticated-shell .sidebar { height: auto; max-height: none; overflow: visible; gap: 8px; padding: 8px 12px; }
  .authenticated-shell .content { overflow: visible; }
  .nav { flex-wrap: nowrap; overflow-x: auto; }
  .nav-item { white-space: nowrap; }
  .sidebar-foot { display: none; }
}
@media (pointer: coarse) {
  button, select, input, .nav-item { min-height: 44px; }
}
.skip-link { position: absolute; left: -9999px; top: 8px; z-index: 100; }
.skip-link:focus { left: 8px; }
```

跳到正文（audit C P2；不能用 `href="#…"`，hash 是分区路由）。`Shell.tsx`：`<div className="shell">` 的第一个子元素加
```tsx
      <button type="button" className="skip-link" onClick={() => document.getElementById("main-content")?.focus()}>{t("shell.skipToContent")}</button>
```
`<main className="content">` 改为 `<main className="content" id="main-content" tabIndex={-1}>`。
locales `shell` 下：`skipToContent`：en `"Skip to content"`，zh `"跳到正文"`。
判据 `web/tests/skipLink.test.tsx`：
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Shell } from "../src/Shell.js";

describe("skip link (audit C P2)", () => {
  it("is the first focusable control and moves focus to the content without touching the section hash", () => {
    window.location.hash = "#decisions";
    render(<Shell active="decisions" badges={{ unreviewed: 0, chainRunning: false, controlAlert: false }} footer={[]}><p>pane</p></Shell>);
    const skip = screen.getByRole("button", { name: "Skip to content" });
    expect(document.querySelector("button, a, select, input")).toBe(skip);
    fireEvent.click(skip);
    expect(document.activeElement?.id).toBe("main-content");
    expect(window.location.hash).toBe("#decisions");
  });
});
```
（执行者：先 `grep -rn "getAllByRole(\"button\")\|querySelectorAll(\"button\")" web/tests` 整份读，确认没有判据数 Shell 里的按钮总数；若有 ⇒ 台账 Ruling 后把 skip 链接放进 `<main>` 之前的 `<div className="chain-banners">` 之外仍可行的位置，或升人。）
（`styles.test.ts` 钉的 `.authenticated-shell { … height: 100dvh` 等是**首次出现**的那几条，原样保留；这里是后出现的媒体查询覆盖。）

`AuthGate.tsx` `Notices`：在 `<ul>` 之后、`refusal` 之前加
```tsx
      {notices.length > 1 && (
        <button type="button" onClick={() => void dismissAll()}>{t("auth.dismissAll")}</button>
      )}
```
并在 `dismiss` 旁加
```tsx
  const dismissAll = async (): Promise<void> => {
    for (const notice of notices) {
      const answer = await ackNotice(notice.seq);
      if (!answer.ok) { setRefusal(answer); break; }
    }
    await read();
  };
```
locales：`en.ts` `auth` 里加 `dismissAll: "Dismiss all",`；`zh.ts` `auth` 里加 `dismissAll: "全部知道了",`（放在各自 `dismiss` 行之后）。

- [ ] **Step 4: 跑**

Run: `cd web && npx vitest run tests/shellReflow.test.ts tests/skipLink.test.tsx tests/authGate.test.tsx`，再整套 `npm run --ws check > "$SCRATCH/task-3-check.log" 2>&1; echo RC $?`，整份读。Expected 两者 RC 0。`git diff web/tests/authGate.test.tsx` 只有新增行。

- [ ] **Step 5: 变异（clone）** — M3a：媒体块里删 `height: auto;` ⇒ 首条红；M3b：`.nav` 去掉 `flex-wrap: nowrap;` ⇒ 第二条红；M3c：`.notices` 背景改回 `--danger-subtle` ⇒ 第三条红；M3d：`dismissAll` 循环里 `break` 提到循环首 ⇒ authGate 新条红（只 ack 了 0 个）。

- [ ] **Step 6: 提交**

```bash
git add web/src web/tests/shellReflow.test.ts web/tests/authGate.test.tsx
git commit -m "fix(web): let narrow screens scroll the whole page and quiet the owners' notices (P1-2)"
```

---

### Task 4: 审阅流程（P1-3）

**Files:**
- Create: `web/src/reviewFlow.ts`、`web/src/reviewKeys.ts`
- Create: `web/tests/reviewFlow.test.ts`、`web/tests/reviewKeys.test.ts`、`web/tests/reviewApp.test.tsx`
- Modify: `web/src/App.tsx`（决策状态区 :202-230、`submitDecision` :1122-1144、Decisions pane :1399-1424、新增一个 keydown effect）
- Modify: `web/src/DecisionsView.tsx`（新 prop `reviewedCount?: number`、快捷键提示）、`web/src/DecisionDetail.tsx`（纠正小标题）
- Modify: locales（`decisions.reviewedThisSession`、`decisions.keyHint`、`decisions.correctionTitle`）、`styles.css`（`.kbd-hint`、`.correction-title`）

**Interfaces:**
- Produces `nextAfterReview(before: readonly DecisionListRow[], reviewed: Pick<DecisionListRow,"projectKey"|"id">, now: readonly DecisionListRow[]): DecisionListRow | null`
- Produces `type ReviewKeyAction = "next" | "previous" | "agree" | "correct" | null` 与 `reviewKeyAction(e: { key: string; target: EventTarget | null; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean }): ReviewKeyAction`
- Consumes `rowKey` (`DecisionList.tsx:42`)、`filterRows` (`DecisionsView.tsx:38`)。

- [ ] **Step 1: 写纯函数判据** `web/tests/reviewFlow.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { nextAfterReview } from "../src/reviewFlow.js";
import type { DecisionListRow } from "../src/types.js";

const row = (id: string): DecisionListRow => ({ projectKey: "p", id, at: "2026-10-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: id }) as DecisionListRow;
const [a, b, c] = [row("a"), row("b"), row("c")];

/** Taste refinement P1-3: after a review lands, the person is taken to the next row -- never away from one that stayed. */
describe("nextAfterReview", () => {
  it("moves to the row that followed the reviewed one", () => {
    expect(nextAfterReview([a, b, c], b, [a, c])?.id).toBe("c");
  });
  it("moves back when the reviewed row was last", () => {
    expect(nextAfterReview([a, b, c], c, [a, b])?.id).toBe("b");
  });
  it("skips rows that also left the list", () => {
    expect(nextAfterReview([a, b, c], a, [c])?.id).toBe("c");
  });
  it("stays (null) while the reviewed row is still listed -- a refresh that failed, or a single row (Review Focus 3)", () => {
    expect(nextAfterReview([a, b], a, [a, b])).toBeNull();
  });
  it("stays (null) when nothing is left", () => {
    expect(nextAfterReview([a], a, [])).toBeNull();
  });
  it("matches rows by project and id, so a same-id row in another project is not the reviewed one", () => {
    const other = { ...a, projectKey: "q" } as DecisionListRow;
    expect(nextAfterReview([a, other], a, [other])?.projectKey).toBe("q");
  });
});
```

`web/tests/reviewKeys.test.ts`：

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reviewKeyAction } from "../src/reviewKeys.js";

const ev = (key: string, target: EventTarget | null = document.body, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "repeat", boolean>> = {}) =>
  ({ key, target, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...mods });

/** Taste refinement P1-3 / Review Focus 2: a letter typed into a field must never record a review. */
describe("reviewKeyAction", () => {
  it("maps j/k/a/c on the page", () => {
    expect(["j", "k", "a", "c"].map((k) => reviewKeyAction(ev(k)))).toEqual(["next", "previous", "agree", "correct"]);
  });
  it("ignores keys typed into an input, a textarea, a select or an editable element", () => {
    const input = document.createElement("input"), area = document.createElement("textarea"), select = document.createElement("select");
    // jsdom does not reflect `contentEditable = "true"` into the attribute; set the attribute itself.
    const editable = document.createElement("div"); editable.setAttribute("contenteditable", "true");
    const inside = document.createElement("span"); editable.appendChild(inside);
    for (const target of [input, area, select, editable, inside]) expect(reviewKeyAction(ev("a", target))).toBeNull();
  });
  it("ignores a held key (auto-repeat): an Agree is never sent twice by holding 'a' (Review Focus 2)", () => {
    expect(reviewKeyAction(ev("a", document.body, { repeat: true }))).toBeNull();
  });
  it("ignores chords and other keys", () => {
    expect(reviewKeyAction(ev("a", document.body, { metaKey: true }))).toBeNull();
    expect(reviewKeyAction(ev("c", document.body, { ctrlKey: true }))).toBeNull();
    expect(reviewKeyAction(ev("x"))).toBeNull();
    expect(reviewKeyAction(ev("A"))).toBeNull();
  });
});
```

注：jsdom 不实现 `isContentEditable`；实现用 `closest('[contenteditable]:not([contenteditable="false"])')`。

- [ ] **Step 2: 跑，确认红** — `cd web && npx vitest run tests/reviewFlow.test.ts tests/reviewKeys.test.ts` ⇒ 模块不存在而红。

- [ ] **Step 3: 实现两个模块**

`web/src/reviewFlow.ts`：
```ts
import { rowKey } from "./DecisionList.js";
import type { DecisionListRow } from "./types.js";

/**
 * Taste refinement P1-3: where the review queue goes after a review lands. `before` is the list as the person saw it
 * when they acted, `now` the refreshed one. Null means stay: the reviewed row is still listed (refresh failed, or it
 * did not leave), or nothing is left.
 */
export function nextAfterReview(
  before: readonly DecisionListRow[],
  reviewed: Pick<DecisionListRow, "projectKey" | "id">,
  now: readonly DecisionListRow[],
): DecisionListRow | null {
  const key = rowKey(reviewed);
  const present = new Map(now.map((row) => [rowKey(row), row] as const));
  if (present.has(key)) return null;
  const at = before.findIndex((row) => rowKey(row) === key);
  if (at === -1) return null;
  for (let i = at + 1; i < before.length; i++) { const hit = present.get(rowKey(before[i]!)); if (hit) return hit; }
  for (let i = at - 1; i >= 0; i--) { const hit = present.get(rowKey(before[i]!)); if (hit) return hit; }
  return null;
}
```

`web/src/reviewKeys.ts`：
```ts
/** Taste refinement P1-3: j/k move, a agrees, c starts a correction -- never while typing, never as a chord. */
export type ReviewKeyAction = "next" | "previous" | "agree" | "correct" | null;

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function reviewKeyAction(e: { key: string; target: EventTarget | null; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean }): ReviewKeyAction {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null;
  const el = e.target as Element | null;
  if (el !== null && typeof (el as Element).closest === "function") {
    if (TYPING.has(el.tagName) || el.closest('[contenteditable]:not([contenteditable="false"])') !== null) return null;
  }
  switch (e.key) {
    case "j": return "next";
    case "k": return "previous";
    case "a": return "agree";
    case "c": return "correct";
    default: return null;
  }
}
```

- [ ] **Step 4: 跑纯函数判据** ⇒ PASS。

- [ ] **Step 5: 写 App 级判据** `web/tests/reviewApp.test.tsx`

文件第一行 `// @vitest-environment jsdom`。照 `web/tests/decisionsI18n.test.tsx:117` 那条的 App 渲染与 fetch 夹具复制一份，但夹具 `/api/todo` 首读返回 `[A, B]`、`POST /api/reviews` 成功后返回 `[B]`；`POST /api/reviews` 的应答可由测试控制延迟（一个可手动 resolve 的 promise），用于在途判据。`afterEach(() => { window.location.hash = ""; })`。断言：
```tsx
  it("after a successful Agree, opens the next row once the reviewed one has left the list, and counts it", async () => {
    // …render App on #decisions, click row A, wait for decision A's question in .split-detail
    fireEvent.click(within(detail()).getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(QUESTION_B));
    expect(screen.getByTestId("reviewed-count").textContent).toBe("Reviewed this session: 1");
  });

  it("does not record a review when 'a' is pressed inside the correction textarea", async () => {
    // …open row A
    const because = document.querySelector<HTMLTextAreaElement>('textarea[name="because"]')!;
    fireEvent.keyDown(because, { key: "a" });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts("/api/reviews")).toHaveLength(0);
  });

  it("records an Agree with 'a', moves with 'j', and ignores both outside Decisions", async () => {
    // …open row A on #decisions
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe(QUESTION_B));
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(posts("/api/reviews")).toHaveLength(1));
    expect(JSON.parse(posts("/api/reviews")[0]!.body).decisionId).toBe("B");
    window.location.hash = "#metrics"; fireEvent(window, new HashChangeEvent("hashchange"));
    fireEvent.keyDown(document.body, { key: "a" });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts("/api/reviews")).toHaveLength(1);
  });

  it("sends one Agree for a double 'a' while the first is still in flight (Review Focus 2)", async () => {
    // …open row A; hold the /api/reviews answer open
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "a" });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts("/api/reviews")).toHaveLength(1);
    // …resolve the held answer
  });

  it("shows the error page instead of crashing when a read fails while Decisions is open (Review Focus 1)", async () => {
    // …open row A, then make the next /api/decision answer a 500, and click row B
    await screen.findByText(/orca panel failed to load|failed/i); // the ErrorPage title in en.ts `panelErrors.title`
  });
```
（执行者：「…」处照 decisionsI18n:117 的写法补全渲染、等待与 `posts` 辅助；QUESTION_A/B 是夹具里两行的 question；`posts(...)` 返回的对象若没有 `body` 字段，照该文件辅助的实际形状取请求体；ErrorPage 文案以 en.ts `panelErrors.title` 为准。最后一条在「hooks 放错位置」时会以 React 的 hook 顺序错误红 —— 变异 M4g 证明。）

- [ ] **Step 6: 跑，确认红**（无计数、无跳转、无快捷键）。

- [ ] **Step 7: App 接线**

1) 状态区（`const [allRows…]` 之后）加：
```tsx
  /** Taste refinement P1-3: reviews this browser recorded since it opened the panel, and a pending move to the next row. */
  const [reviewedThisSession, setReviewedThisSession] = useState(0);
  const [pendingAdvance, setPendingAdvance] = useState<{ reviewed: DecisionListRow; before: DecisionListRow[] } | null>(null);
```
**位置约束（独立审查 B1）：** App 在 `if (error !== null) return <ErrorPage …/>`（约 :1151）提前返回。下面所有 `useState`／`useEffect` 必须在这行**之前**；派生常量放在 `statusRows`（约 :1077-1080）之后；两个新 effect 放在 `recordAnother` 定义之后、`if (error !== null)` 之前（那时 `decision`、`submitDecision`、`openDecisionRow` 都已定义）。**不用 `useMemo`**：普通数组让 effect 每次渲染都拿到最新的 `submitDecision`/`readTodo` 闭包；effect 自己在 `pendingAdvance === null` 时立即返回，所以每渲染一次跑一次无害。

2) 在 `statusRows` 之后把两分支共用的行与筛选提成常量（替换 :1402 与 :1405-1422 里的内联表达式，行为不变）：
```tsx
  const scopedDecisionRows = projects === null || scope.kind === "all" ? statusRows : statusRows.filter((row) => row.projectKey === project);
  const effectiveDecisionFilter = projects === null ? filter : { ...filter, projectKey: "" };
  const visibleDecisionRows = filterRows(scopedDecisionRows, effectiveDecisionFilter);
```
两个 `<DecisionsView>` 分别用 `rows={scopedDecisionRows}`（`projects === null` 分支原为 `statusRows`，二者此时相等）、`filter={effectiveDecisionFilter}`，并都加 `reviewedCount={reviewedThisSession}`。
3) `submitDecision` 成功分支里 `await Promise.all([readTodo(), loadHome()]);` 之前加 `setReviewedThisSession((n) => n + 1);`，之后加：
```tsx
      if (verb === "agree" && advanceFrom !== undefined) setPendingAdvance(advanceFrom);
```
并给 `submitDecision` 加第五个可选参数 `advanceFrom?: { reviewed: DecisionListRow; before: DecisionListRow[] }`；`onAgree` 传 `{ reviewed: selected, before: visibleDecisionRows }`。
4) effect：
```tsx
  useEffect(() => {
    if (pendingAdvance === null) return;
    setPendingAdvance(null);
    if (selected === null || rowKey(selected) !== rowKey(pendingAdvance.reviewed)) return;
    const next = nextAfterReview(pendingAdvance.before, pendingAdvance.reviewed, visibleDecisionRows);
    if (next !== null) openDecisionRow(next);
  }, [pendingAdvance, visibleDecisionRows]);
```
5) keydown effect（`a` 在该决策已有在途请求时不发 —— Review Focus 2；`inlineRequest` 已在 App 导入，返回该选中行的当前请求记录）：
```tsx
  useEffect(() => {
    if (section !== "decisions") return;
    const onKey = (event: KeyboardEvent): void => {
      const action = reviewKeyAction(event);
      if (action === null) return;
      const at = selected === null ? -1 : visibleDecisionRows.findIndex((row) => rowKey(row) === rowKey(selected));
      if (action === "next" || action === "previous") {
        const to = visibleDecisionRows[action === "next" ? at + 1 : Math.max(at - 1, 0)];
        if (to !== undefined) {
          event.preventDefault(); openDecisionRow(to);
          requestAnimationFrame(() => document.querySelector('.decision-row[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" }));
        }
      } else if (action === "agree" && selected !== null && decision !== null && inlineRequest(decisionRequests, selected)?.status.kind !== "pending") {
        event.preventDefault();
        void submitDecision({ projectKey: selected.projectKey, decisionId: selected.id }, "agree", null, undefined, { reviewed: selected, before: visibleDecisionRows });
      } else if (action === "correct") {
        const box = document.querySelector<HTMLTextAreaElement>('.section-pane[data-section="decisions"] textarea[name="because"]');
        if (box !== null) { event.preventDefault(); box.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
```
（无依赖数组：每次渲染重绑，闭包永远新鲜；监听器只有一个，代价可忽略。）
导入：`import { nextAfterReview } from "./reviewFlow.js"; import { reviewKeyAction } from "./reviewKeys.js";`，`rowKey` 自 `./DecisionList.js`，`filterRows` 自 `./DecisionsView.js`（若尚未导入）。

`DecisionsView.tsx`：props 加 `reviewedCount?: number`；在 count `<span>` 之后加
```tsx
        {props.reviewedCount !== undefined && props.reviewedCount > 0 && (
          <span className="count" data-testid="reviewed-count">{t("decisions.reviewedThisSession", { n: props.reviewedCount })}</span>
        )}
```
在 `.section-lede` 之后加 `<p className="kbd-hint">{t("decisions.keyHint")}</p>`。

`DecisionDetail.tsx`：`<form className="correction-form" …>` 的第一个子元素加 `<h3 className="correction-title">{t("decisions.correctionTitle")}</h3>`。

locales（en / zh）`decisions` 下：
- `reviewedThisSession`: `"Reviewed this session: {{n}}"` / `"本次已审 {{n}} 条"`
- `keyHint`: `"Keys: j / k next and previous, a agree, c write a correction"` / `"快捷键：j / k 上下切换，a 同意，c 写纠正"`
- `correctionTitle`: `"Disagree? Record a correction"` / `"不同意？记一条纠正"`

`styles.css`（Decisions 区段末尾）：
```css
.kbd-hint { color: var(--muted); font-size: var(--text-xs); margin: -6px 0 12px; }
.correction-form { border-top: 1px dashed var(--border); margin-top: 16px; padding-top: 12px; }
.correction-title { font-size: var(--text-sm); color: var(--muted); }
```

- [ ] **Step 8: 跑决策相关全部判据**

Run: `cd web && npx vitest run tests/reviewFlow.test.ts tests/reviewKeys.test.ts tests/reviewApp.test.tsx`，再整套 `npm run --ws check > "$SCRATCH/task-4-check.log" 2>&1; echo RC $?`，整份读。Expected 两者 RC 0。

- [ ] **Step 9: 变异（clone）** — M4a：`nextAfterReview` 去掉 `if (present.has(key)) return null;` ⇒「stays」红；M4b：去掉向后找的循环 ⇒「moves back」红；M4c：`reviewKeyAction` 去掉 `TYPING` 检查 ⇒ 字段判据与 App「textarea」判据红（必须**看见** App 那条红）；M4d：keydown effect 去掉 `section !== "decisions"` ⇒ App 第三条红；M4e：删 `setReviewedThisSession` ⇒ 计数断言红；M4f：`setPendingAdvance` 去掉 ⇒ 跳转断言红；M4g：把两个新 effect 移到 `if (error !== null) return` 之后 ⇒ 「error page」条红；M4h：去掉 `!== "pending"` 条件 ⇒ 「double 'a'」条红；M4i：去掉 `e.repeat` ⇒ held-key 判据红；M4j：去掉 `if (action === "agree" …)` 分支 ⇒ App 第三条的 POST 断言红。

- [ ] **Step 10: 提交**

```bash
git add web/src web/tests/reviewFlow.test.ts web/tests/reviewKeys.test.ts web/tests/reviewApp.test.tsx
git commit -m "feat(web): move to the next decision after an agree, add j/k/a/c and a session count (P1-3)"
```

---

### Task 5: Overview 去冗余（P1-4）

**Files:** Modify `web/src/Overview.tsx`、`web/src/styles.css`（overview 区段）、locales（`overview.viewAllDecisions`）；Create `web/tests/overviewQueueCap.test.tsx`

**Interfaces:** Produces `export const OVERVIEW_DECISION_LIMIT = 3` 与 `export function visibleQueue(queue: OverviewQueueRow[]): { rows: OverviewQueueRow[]; hiddenDecisions: number; decisions: number }`（均从 `Overview.tsx` 导出）。

- [ ] **Step 1: 判据** `web/tests/overviewQueueCap.test.tsx`

```tsx
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Overview, OVERVIEW_DECISION_LIMIT, visibleQueue } from "../src/Overview.js";
import type { OverviewModel, OverviewQueueRow } from "../src/overviewModel.js";

const decision = (id: string): OverviewQueueRow => ({ key: `d-${id}`, kind: "decision-review", reason: `question ${id}`, owner: "Orca", ownerUnknown: false, ownerRequired: false, target: { kind: "decision", projectKey: "p", id }, priority: 1 }) as OverviewQueueRow;
const budget: OverviewQueueRow = { key: "b", kind: "budget-review", reason: "budget", owner: "Orca", ownerUnknown: false, ownerRequired: false, target: { kind: "group", groupId: "g" }, priority: 0 } as OverviewQueueRow;
const model = (queue: OverviewQueueRow[]): OverviewModel => ({ progress: [], queue, issues: [], sources: [], scopeUnavailable: false, complete: true });
const render = (queue: OverviewQueueRow[]): string => renderToStaticMarkup(<Overview model={model(queue)} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);

/** Taste refinement P1-4: Overview points at the decision queue; it does not copy all of it. */
describe("Overview decision rows (P1-4)", () => {
  it("shows every non-decision step and at most three decisions, in the model's order", () => {
    const v = visibleQueue([budget, decision("a"), decision("b"), decision("c"), decision("d"), decision("e")]);
    expect(v.rows.map((r) => r.key)).toEqual(["b", "d-a", "d-b", "d-c"]);
    expect(v.hiddenDecisions).toBe(2);
    expect(OVERVIEW_DECISION_LIMIT).toBe(3);
  });

  it("links to all decisions only when some are hidden (Review Focus 4)", () => {
    expect(render([decision("a"), decision("b"), decision("c")])).not.toContain('href="#decisions"');
    const html = render([decision("a"), decision("b"), decision("c"), decision("d")]);
    expect(html).toContain('href="#decisions"');
    expect(html).toContain("View all 4 decisions");
  });

  it("does not make the whole queue a live region", () => {
    expect(render([decision("a")])).not.toContain("aria-live");
  });

  it("aligns the two columns at the top and draws no card inside the Overview card", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
    const at = css.indexOf(".overview-layout {");
    expect(css.slice(at, css.indexOf("}", at))).toContain("align-items: start");
    // Must out-rank `.section-pane section[aria-label]` (card) and `.section-pane section section` (inner bg).
    const inner = css.indexOf(".section-pane .overview-layout > section[aria-label] {");
    expect(inner).toBeGreaterThan(-1);
    const r = css.slice(inner, css.indexOf("}", inner));
    expect(r).toContain("border: 0");
    expect(r).toContain("box-shadow: none");
  });
});
```

- [ ] **Step 2: 跑 ⇒ 红。**

- [ ] **Step 3: 实现** — `Overview.tsx` 顶部加：
```tsx
/** Taste refinement P1-4: the queue keeps every step that is not a decision review, and at most this many reviews. */
export const OVERVIEW_DECISION_LIMIT = 3;
export function visibleQueue(queue: OverviewQueueRow[]): { rows: OverviewQueueRow[]; hiddenDecisions: number; decisions: number } {
  let shown = 0;
  const decisions = queue.filter((row) => row.target.kind === "decision").length;
  const rows = queue.filter((row) => row.target.kind !== "decision" || shown++ < OVERVIEW_DECISION_LIMIT);
  return { rows, hiddenDecisions: decisions - Math.min(decisions, OVERVIEW_DECISION_LIMIT), decisions };
}
```
（导入 `OverviewQueueRow` 类型。）在组件里 `const queue = visibleQueue(model.queue);`，队列 `<ul>` 改为 `queue.rows.map(...)`（行内容不变），`<ul>` 之后加：
```tsx
    {queue.hiddenDecisions > 0 && <p><a href="#decisions">{t("overview.viewAllDecisions", { n: queue.decisions })}</a></p>}
```
删掉队列 `<section>` 上的 `aria-live="polite"`。`model.queue.length === 0` 的空状态判断保持用 `model.queue`。

locales：`overview.viewAllDecisions`：en `"View all {{n}} decisions"`，zh `"查看全部 {{n}} 条决策"`。

`styles.css` overview 区段：`.overview-layout { … }` 里加 `align-items: start;`；把**原有**那行 `.overview-layout > section { min-width: 0; }` **就地替换**为（不新增第二条）：
```css
.section-pane .overview-layout > section[aria-label] { min-width: 0; border: 0; box-shadow: none; background: transparent; padding: 0; margin: 0; }
```
（特异性 0-3-1 高于 `.section-pane section[aria-label]` 0-2-1 与 `.section-pane section section` 0-1-3；Task 9 截图核对内层确实无边框。）

- [ ] **Step 4: 跑** `cd web && npx vitest run tests/overviewQueueCap.test.tsx`，再整套 `npm run --ws check > "$SCRATCH/task-5-check.log" 2>&1; echo RC $?`，整份读。Expected 两者 RC 0。

- [ ] **Step 5: 变异（clone）** — M5a：`OVERVIEW_DECISION_LIMIT = 115` ⇒ 首条红；M5b：链接条件改 `>= 0` ⇒ 第二条红；M5c：恢复 `aria-live` ⇒ 第三条红；M5d：删 `align-items: start;` ⇒ 第四条红。

- [ ] **Step 6: 提交** `git commit -m "fix(web): Overview shows three decisions and a link to the rest, without a card in a card (P1-4)"`

---

### Task 6: Metrics 去文字墙（P2-5）

**Files:** Modify `web/src/MetricsView.tsx`、`web/src/UsagePanel.tsx:170,186,225`、`web/src/styles.css`（Metrics 区段）、locales（改写 `metrics.note.*` 的 4 条 en＋zh 文案）；Create `web/tests/metricsLayout.test.tsx`

- [ ] **Step 1: 判据** `web/tests/metricsLayout.test.tsx`

```tsx
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { MetricsView } from "../src/MetricsView.js";

/** Taste refinement P2-5 (+ spec §7: notes stay shown beside their number -- MetricsView.tsx:7-15, metricsView.test.tsx:101). */
const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("Metrics layout (P2-5)", () => {
  it("lays the three rates out as tiles, each number first and its notes visible right under it", () => {
    // Reuse the report/coverage fixture of web/tests/metricsView.test.tsx (import it or copy its builder verbatim).
    const html = renderToStaticMarkup(<MetricsView report={REPORT} coverage={COVERAGE} />);
    expect(html.match(/class="metric-tile"/g)?.length).toBe(3);
    expect(html).not.toContain("<details");
    const tile = html.slice(html.indexOf('class="metric-tile"', html.indexOf("Review coverage")) - 200);
    expect(tile.indexOf('data-testid="panel-coverage-rate"')).toBeLessThan(tile.indexOf('data-testid="review-coverage-reason"'));
  });
  it("gathers the three data-health counts into one row", () => {
    const html = renderToStaticMarkup(<MetricsView report={REPORT} coverage={COVERAGE} />);
    const row = html.slice(html.indexOf('class="metric-health"'));
    for (const id of ["unresolved-count", "malformed-count", "excluded-as-future"]) expect(row).toContain(`data-testid="${id}"`);
  });
  it("lets wide usage tables scroll inside their own box", () => {
    const usage = src("../src/UsagePanel.tsx");
    expect(usage.match(/<div className="table-scroll">/g)?.length).toBeGreaterThanOrEqual(2);
    const css = src("../src/styles.css");
    const at = css.indexOf(".table-scroll {");
    expect(css.slice(at, css.indexOf("}", at))).toContain("overflow-x: auto");
  });
  it("speaks to the reader, not in spec citations", () => {
    const notes = [...Object.values(zh.metrics.note), ...Object.values(en.metrics.note)].join("\n");
    expect(notes).not.toMatch(/§|ERRATUM|spec|schema\.ts|unresolved_decisions|chose_instead|`reviewed`/);
  });
});
```

注：`REPORT`／`COVERAGE` 取自 `web/tests/metricsView.test.tsx` 的夹具（若它未导出，原样复制其构造代码进本文件，不改既有文件）。en 的 notes 在 `en.metrics.note`（en.ts:1020，引用 en.ts:31 的常量）。

- [ ] **Step 2: 跑 ⇒ 红。**

- [ ] **Step 3: 实现**

`MetricsView.tsx` 的 `<section>` 改为下面结构（所有 testid、六个 `h2` 及其顺序不变）：
```tsx
    <section className="metrics">
      <div className="metric-tiles">
        <div className="metric-tile">
          <h2>{t("metrics.correctionRate")}</h2>
          <p className="metric-value" data-testid="correction-rate">{formatRate(report.correction_rate.rate_excluding_stale)}</p>
          <div className="metric-notes">
            <ul className="caveats" data-testid="correction-rate-caveats">{/* unchanged li map */}</ul>
          </div>
        </div>
        <div className="metric-tile">
          <h2>{t("metrics.repairRate")}</h2>
          <p className="metric-value" data-testid="repair-rate">{formatRate(report.repair_rate.rate)}</p>
          <div className="metric-notes">
            <ul className="caveats" data-testid="repair-rate-caveats">{/* unchanged li map */}</ul>
            <p className="stale-bias" data-testid="stale-bias">{/* unchanged */}</p>
          </div>
        </div>
        <div className="metric-tile">
          <h2>{t("metrics.reviewCoverage")}</h2>
          <p className="metric-value" data-testid="panel-coverage-rate">{formatRate(coverage.rate)}</p>
          <div className="metric-notes">
            <p className="caveat" data-testid="review-coverage-reason">{/* unchanged */}</p>
            <p className="caveat" data-testid="panel-coverage-caveat">{/* unchanged */}</p>
          </div>
        </div>
      </div>
      <div className="metric-health">
        <div><h2>{t("metrics.unresolvedTitle")}</h2><p data-testid="unresolved-count">{/* unchanged */}</p></div>
        <div><h2>{t("metrics.malformedTitle")}</h2><p data-testid="malformed-count">{/* unchanged */}</p></div>
        <div><h2>{t("metrics.futureTitle")}</h2><p data-testid="excluded-as-future">{/* unchanged */}</p></div>
      </div>
    </section>
```
（「unchanged」处把原文件对应 JSX 原样搬过来；覆盖率区把原来在数字之前的 reason 挪到数字之后的 `.metric-notes` 里，数字先出现；说明全部常显（spec §7）。）

`UsagePanel.tsx`：by-model `<table>`（:170）、groups `<table data-testid="usage-groups">`（:186）、caps `<table>`（:225）各包一层 `<div className="table-scroll">…</div>`。

`styles.css` Metrics 区段替换 `.section-pane [data-testid$="-rate"]…` 那条为：
```css
.metric-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
.metric-tile { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; background: var(--bg); }
.metric-tile h2, .metric-health h2 { font-size: var(--text-xs); font-weight: 600; color: var(--muted); margin: 0 0 4px; }
.metric-value { font-size: 28px; font-weight: 700; color: var(--text-strong); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin: 0; }
.metric-notes { margin-top: 6px; color: var(--muted); font-size: var(--text-xs); }
.metric-notes ul { margin: 0; padding-left: 16px; }
.metric-health { display: flex; flex-wrap: wrap; gap: 8px 24px; border-top: 1px solid var(--border); padding-top: 12px; }
.metric-health > div { display: flex; flex-direction: column; }
.metric-health p { font-size: var(--text-sm); font-variant-numeric: tabular-nums; margin: 0; }
.table-scroll { overflow-x: auto; max-width: 100%; }
.table-scroll table { min-width: 520px; }
```

文案（en 与 zh 各改 4 条，键不变）：
- `no-review-coverage`：en `"Review coverage has no data yet: only reviews made in the panel produce it. Read the correction rate together with coverage, never on its own."`；zh `"评审覆盖率还没有数据：只有在面板上做的评审会产生它。纠正率要和覆盖率一起看，不能单独解读。"`
- `unresolved-decisions`：en `"Some corrections point at decisions outside the scanned ledgers; they count in the totals but in no decision-kind group."`；zh `"有些纠正指向的决策不在扫描到的台账里；它们计入总数，但不属于任何决策类型分组。"`
- `stale-bias`：en `"Systematically low: closing a stale correction needs a \"chose instead\" value, which a stale correction may not carry."`；zh `"系统性偏低：关闭一条过时纠正需要填「改选」，而过时纠正按规定不能带这一项。"`
- `reviewed-is-deliberate`：en `"Marking a decision reviewed is a deliberate act, so this number can stay near zero for a long time -- and a long zero looks the same as nobody looking. Read it with the backlog."`；zh `"「已评审」需要人主动标记，所以这个数可能长时间接近零——长期为零和没人看分辨不出来。请结合积压一起看。"`

- [ ] **Step 4: 跑** `cd web && npx vitest run tests/metricsLayout.test.tsx`，再整套 `npm run --ws check > "$SCRATCH/task-6-check.log" 2>&1; echo RC $?`，整份读。Expected 两者 RC 0。若 `metricsView.test.tsx` 有断言字面含旧 en 句子（如 "E2 spec"）⇒ 停，按 Global Constraints 升人。

- [ ] **Step 5: 变异（clone）** — M6a：把覆盖率卡里数字与 reason 的顺序换回去 ⇒ 首条红；M6a'：`metric-health` 包裹去掉 ⇒ 第二条红；M6b：去掉一个 `table-scroll` 包裹（剩 2 个时仍过 ⇒ 改为去两个）⇒ 第二条红；M6c：zh `stale-bias` 末尾加回 `（spec §3）` ⇒ 文案条红。

- [ ] **Step 6: 提交** `git commit -m "fix(web): metrics as three rate tiles with their notes beside them, scrollable usage tables, plain-language notes (P2-5)"`

---

### Task 7: 模板、字号与主按钮（P2-6）

**Files:** Modify `web/src/styles.css`（`h1,h2,h3`、`:root` 字号 token、`button[type="submit"]`、`.project-action:disabled`、`.decisions .section-head h1`、`.section-meta`）、`web/src/AuthGate.tsx`（登录与改密提交按钮加 `className="btn-primary"`）、`web/src/ControlPanel.tsx:235`（summary `<p>` 加 `className="section-meta"`）；Create `web/tests/template.test.ts`

- [ ] **Step 1: 判据** `web/tests/template.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Taste refinement P2-6 (detector: flat-type-hierarchy 14/14/16; one primary per view). */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const rule = (s: string): string => { const at = css.indexOf(`${s} {`); if (at === -1) throw new Error(`no rule ${s}`); return css.slice(at, css.indexOf("}", at)); };
const px = (r: string): number => Number(/font-size:\s*(\d+)px/.exec(r)?.[1] ?? /var\(--text-(\w+)\)/.exec(r)?.[1]);

describe("page template (P2-6)", () => {
  it("steps headings at least 1.2x apart: h3 14, h2 18, h1 22", () => {
    expect(css).toMatch(/h1 \{ font-size: 22px; \}/);
    expect(css).toMatch(/h2 \{ font-size: 18px; \}/);
    expect(css).toMatch(/h3 \{ font-size: var\(--text-md\); font-weight: 600; \}/);
  });
  it("sizes the Decisions page title like every other page title", () => {
    expect(rule(".decisions .section-head h1")).toContain("font-size: 18px");
  });
  it("fills only .btn-primary with the accent; a bare submit is secondary", () => {
    expect(css).not.toMatch(/button\[type="submit"\][^{]*\{[^}]*var\(--accent\)/);
    expect(rule(".btn-primary")).toContain("background: var(--accent)");
  });
  it("hides a project action that this panel can never enable (its reason stays in the caption)", () => {
    expect(rule(".project-action:disabled")).toContain("display: none");
  });
  it("shows the control plane's session line as metadata", () => {
    const r = rule(".section-meta");
    expect(r).toContain("var(--muted)");
    expect(r).toContain("var(--text-xs)");
  });
});
```

另在 `web/tests/authGate.test.tsx` 末尾追加（照该文件渲染登录页的方式）：
```tsx
  it("marks the login submit as the page's one primary action (P2-6)", async () => {
    // …render the login form as the existing login test does
    expect(screen.getByRole("button", { name: "Log in" }).className).toContain("btn-primary");
  });
```
（按钮名以 en.ts `auth.logIn` 为准。）

- [ ] **Step 2: 跑 ⇒ 红。**

- [ ] **Step 3: 实现**

`styles.css`：`h1 { font-size: 20px; } h2 { font-size: var(--text-lg); } h3 { font-size: var(--text-md); }` 改为
```css
h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: var(--text-md); font-weight: 600; }
.decisions .section-head h1 { font-size: 18px; }
.section-meta { color: var(--muted); font-size: var(--text-xs); font-family: var(--mono); overflow-wrap: anywhere; }
```
`button[type="submit"], .btn-primary { background: var(--accent); … }` 改为
```css
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn-primary:hover { background: color-mix(in srgb, var(--accent) 88%, var(--text-strong)); }
```
在 `.project-action:hover:not(:disabled)` 之后加 `.project-action:disabled { display: none; }`。
注意：`.decision-detail h2 { font-size: 18px; }` 已有，不动。

`AuthGate.tsx`：`LoginForm` 与 `ChangePasswordForm` 的 `<button type="submit">` 加 `className="btn-primary"`。
`ControlPanel.tsx:235`：`<p>` → `<p className="section-meta">`。

每个视图的主操作显式 `className="btn-primary"`（spec §7，独立审查 I2；没有判据钉 submit 是主按钮）：
`RequirementsPanel.tsx` 发起需求的提交（约 :121）、`ChainPanel.tsx` 启动链（约 :160）、`LoopPlanCard.tsx` 确认做法（约 :212）、`ControlPanel.tsx` `ImportForm` 的导入提交。执行者先读各处确认它是该视图唯一的主操作；`.btn-primary` 已有的 Agree 不动。
判据（追加到 `web/tests/template.test.ts`，用源码检查，因为这些组件的 App 级夹具很重）：
```ts
  it("keeps one primary action on Requirements, Chains, the loop plan and plan import (spec §7)", () => {
    const read = (f: string): string => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8");
    for (const f of ["RequirementsPanel.tsx", "ChainPanel.tsx", "LoopPlanCard.tsx", "ControlPanel.tsx"]) {
      expect(read(f).match(/className="btn-primary"/g)?.length, f).toBe(1);
    }
  });
```

- [ ] **Step 4: 跑** `cd web && npx vitest run tests/template.test.ts tests/authGate.test.tsx`，再整套 `npm run --ws check > "$SCRATCH/task-7-check.log" 2>&1; echo RC $?`，整份读。Expected 两者 RC 0；`git diff web/tests/authGate.test.tsx` 只有新增行。

- [ ] **Step 5: 变异（clone）** — M7a：h2 改回 `var(--text-lg)` ⇒ 首条红；M7e：去掉 ChainPanel 的 `btn-primary` ⇒ 主操作条红；M7b：恢复 `button[type="submit"], .btn-primary` 合写 ⇒ 第三条红；M7c：删 `.project-action:disabled` ⇒ 第四条红；M7d：登录按钮去掉 `btn-primary` ⇒ authGate 新条红。

- [ ] **Step 6: 提交** `git commit -m "fix(web): a heading scale, one primary button per view, and quieter metadata (P2-6)"`

---

### Task 8: 中文术语（P2-7）

**Files:** Modify `web/src/locales/zh.ts`（`auth.role`、`nav.chains`、`settings.showAdvanced`、`chains.activeBanner`）、`web/src/MemoryView.tsx:122-125`；Create `web/tests/zhTerms.test.tsx`

- [ ] **Step 1: 先查 zh 字面钉住情况**

Run: `cd web && grep -rn "连续改进\|\"owner\"\|\"member\"\|所有者\|成员" tests > "$SCRATCH/t8-zh.txt"; cat "$SCRATCH/t8-zh.txt"`（整份读）。被钉住的 key 不改、在台账记 Ruling。

- [ ] **Step 2: 判据** `web/tests/zhTerms.test.tsx`

```tsx
import { describe, expect, it } from "vitest";
import { zh } from "../src/locales/zh.js";

/** Taste refinement P2-7: one Chinese name per thing; roles in Chinese; no half-English memory error. */
describe("zh terms (P2-7)", () => {
  it("names the roles in Chinese", () => {
    expect(zh.auth.role).toEqual({ owner: "所有者", member: "成员" });
  });
  it("calls chains 链 everywhere it is named", () => {
    expect(zh.nav.chains).toBe("链（高级）");
    expect(zh.chains.activeBanner).toBe("链 {{chainId}} 正在运行");
    expect(zh.settings.showAdvanced).toContain("链");
  });
});
```
另在 `web/tests/memoryView.test.tsx` 末尾追加一条（照 :137 那条的渲染方式，health 为 `{ status: "unavailable", code: "ccmem-missing", message: "ORCA_CCMEM_BIN is not set; …" }`）：
```tsx
  it("does not echo the server's English sentence when ccmem is not configured (P2-7)", async () => {
    // …render as at :137
    expect(screen.getByTestId("refusal-code").textContent).toBe("ccmem-missing");
    expect(document.body.textContent).not.toContain("is not set");
    expect(screen.getByText(/Set ORCA_CCMEM_BIN/)).toBeTruthy();
  });
```

- [ ] **Step 3: 跑 ⇒ 红。**

- [ ] **Step 4: 实现**

zh.ts：`role: { owner: "所有者", member: "成员" }`；`nav.chains: "链（高级）"`；`settings.showAdvanced: "显示链（连续改进）"`；`chains.activeBanner: "链 {{chainId}} 正在运行"`。

`MemoryView.tsx` 把
```tsx
          <Refusal refusal={{ status: null, code: health.code, message: health.message }} />
          {health.code === "ccmem-missing" && <p className="caveat">{t("memory.configureHint")}</p>}
```
改为
```tsx
          {health.code === "ccmem-missing" ? (
            <p role="note" data-tone="warn">{t("memory.configureHint")} <code data-testid="refusal-code">{health.code}</code></p>
          ) : (
            <Refusal refusal={{ status: null, code: health.code, message: health.message }} />
          )}
```

- [ ] **Step 5: 跑** `cd web && npx vitest run tests/zhTerms.test.tsx tests/memoryView.test.tsx`，再整套 `npm run --ws check > "$SCRATCH/task-8-check.log" 2>&1; echo RC $?`，整份读。Expected 两者 RC 0；`git diff web/tests/memoryView.test.tsx` 只有新增行。

- [ ] **Step 6: 变异（clone）** — M8a：`role.owner` 改回 `"owner"` ⇒ 首条红；M8b：`nav.chains` 改回 ⇒ 第二条红；M8c：MemoryView 的三元两支对调 ⇒ memory 新条红。

- [ ] **Step 7: 提交** `git commit -m "fix(web): Chinese role names, one name for chains, and no half-English memory error (P2-7)"`

---

### Task 9: 全量验证、截图、检测器、交接

- [ ] **Step 1: 干净 clone 全量**（环境同 `docs/handoff/handoff_ui.md` §二；ccloop clone＋agents 表＋`ORCA_*` 改道）：
`npm run typecheck`、`npm run build --workspace web`、`npm run --ws check`、`npm run verify:panel`、根 `npx vitest run`，各自重定向到文件、记 RC、整份读回。根 vitest 的红先对基线红名单（`gateCheck` K12/K13、`driverRecovery`、`controlShutdown`、`driverLanding`），再单文件重跑。
- [ ] **Step 2: 截图** —— 本会话 scratchpad 的 `run-panel.sh`（改道面板，端口 7790）＋ `shoot.py after`：9 分区 × 深浅 × 1440/390；另测 320×256 与 720×450 的内容区高度（应能整页滚到底）。真 `~/.orca` 前后 `ls -laR` 比对。
- [ ] **Step 3: 检测器** —— `impeccable detect --json web/src` 一次；浏览器 overlay 3 页（overview/decisions/metrics）。
- [ ] **Step 4: 交接** —— `docs/handoff/handoff_ui.md` 新增「七、第三批：精修」节（不写 HEAD；按主题行引用提交；修掉文首过期路径 `loop/Orca`→`orca/Orca`）。awaitingHuman：视觉验收；合并 `ui/panel-taste`、push；是否授权改写 `shell.test.tsx` 让「无执行端口」不再点亮任务控制的红点（spec §7）；是否做客户端延时撤销；Metrics 说明是否允许折叠（spec §7 依 Rule 7 未折叠）。
- [ ] **Step 5: 提交台账** —— `git add -f .superpowers/sdd/2026-10-14-panel-taste-refinement/progress.md`，与交接同一笔或单独一笔。
