### Task 6: The chains area, and the switch's helper-built case

**Files:**
- Modify: `web/src/ChainPanel.tsx`, `web/src/chainBanner.ts:6-13,30`, `web/src/App.tsx:630`
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`chains` area; enum family `chainStopCategory`)
- Create: `web/tests/chainsI18n.test.tsx`; Modify: `web/tests/i18nSwitch.test.tsx` (this round's file, Task 2: one added `it`)

**Interfaces:** `chainStateText(chain)`, `costText(usd)`, `progressText(chain)` and `bannersFor(repos, dismissed)` keep their signatures; `BANNER_TEXT` stays exported as the English map (`= en.chains.banner`, drafter finding F10); `bannersFor`'s `text` is translated when it is called.

**Keys:**

| Key | English | 中文 | Site (today) |
|---|---|---|---|
| `chains.notLoaded` | `Chains have not loaded.` | `链尚未加载。` | `App.tsx:630` |
| `chains.title` | `Chains` | `链` | `ChainPanel.tsx:84` |
| `chains.noChain` | `No chain yet.` | `还没有链。` | `:91` |
| `chains.goal` / `by` / `progress` / `state` | `Goal` / `By` / `Progress` / `State` | `目标` / `发起人` / `进度` / `状态` | `:94,96,98,100` |
| `chains.stop` | `Stop chain` | `停止链` | `:107` |
| `chains.stopsAfter` | ` Stops after the current session ends.` (leading space) | ` 当前会话结束后停止。` | `:109` |
| `chains.formRepository` | `Repository ` (trailing space) | `仓库 ` | `:116` |
| `chains.formGoal` | `Goal ` | `目标 ` | `:126` |
| `chains.formMaxSessions` | `Max sessions ` | `最多会话数 ` | `:130` |
| `chains.formMaxCost` | `Max cost in USD (a soft limit) ` | `费用上限（美元，软限制） ` | `:134` |
| `chains.formTimeout` | `Session timeout in minutes ` | `会话超时（分钟） ` | `:138` |
| `chains.start` | `Start chain` | `启动链` | `:142` |
| `chains.started` | `Chain {{chainId}} started.` | `链 {{chainId}} 已启动。` | `:145` |
| `chains.stopRequested` | `Chain {{chainId}} will stop after the current session ends.` | `链 {{chainId}} 将在当前会话结束后停止。` | `:146` |
| `chains.gotIt` | `Got it` | `知道了` | `:51` |
| `chains.stateStopped` | `stopped: {{reason}} ({{category}})` | `已停止：{{reason}}（{{category}}）` | `:23` |
| `chains.stateRunning` | `running` | `运行中` | `:24` |
| `chains.stateOrphaned` | `running (supervisor is gone)` | `运行中（监督进程已不在）` | `:24` |
| `chains.costUnreadable` | `cost unreadable` | `费用读不出` | `:26` |
| `chains.cost` | `USD {{amount}}` | `USD {{amount}}` | `:26` |
| `chains.sessionProgress` | `session {{n}}; {{cost}}` | `第 {{n}} 个会话；{{cost}}` | `:29` |
| `chains.banner.done` / `blocked` / `limit` / `anomaly` | `Chain finished` / `Chain is waiting for you` / `Chain stopped at a limit` / `Chain stopped on an anomaly` | `链已完成` / `链在等你` / `链因触达上限而停止` / `链因异常而停止` | `chainBanner.ts:9-12` |

Enum family `chainStopCategory` (`ChainStopCategory`): done 已完成 · blocked 等人处理 · limit 触达上限 · anomaly 异常. A missing stop reason or category reads `common.unknown` (as today's `"unknown"`).

- [ ] **Step 1: Write the failing criteria**

`web/tests/chainsI18n.test.tsx`:

```tsx
/**
 * Panel i18n spec §3.3: the chains area's own sentences (state, cost, progress, outcomes, the form and the banners) in
 * Chinese; the stop reason is shown as sent (data), its category in words.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bannersFor } from "../src/chainBanner.js";
import { ChainBanners, ChainPanel, chainStateText, costText } from "../src/ChainPanel.js";
import i18n from "../src/i18n.js";
import type { ChainRepoView, ChainView } from "../src/types.js";

const chain = (over: Partial<ChainView> = {}): ChainView => ({
  chainId: "chain-0000000b", goal: "g-1", by: "amy", via: "cli", startedAt: "2026-10-01T00:00:00.000Z",
  state: "running", holderGone: false, sessionsDone: 2, costUsd: null, stop: null, ...over,
});
const stopped: ChainView = chain({ state: "stopped", costUsd: 1.5, stop: { reason: "r-1", category: "limit", at: "2026-10-01T01:00:00.000Z", awaitingHuman: [], detail: null } });
const repos: ChainRepoView[] = [
  { repoKey: "repo-one", defaultSessionTimeoutMin: 30, chain: chain(), problem: null },
  { repoKey: "repo-two", defaultSessionTimeoutMin: null, chain: stopped, problem: null },
  { repoKey: "repo-three", defaultSessionTimeoutMin: null, chain: null, problem: null },
];

describe("the chains area in Chinese", () => {
  it("shows state, cost, progress, the form, outcomes and banners in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect(chainStateText(stopped)).toBe("已停止：r-1（触达上限）");
    expect(chainStateText(chain({ holderGone: true }))).toBe("运行中（监督进程已不在）");
    expect(costText(null)).toBe("费用读不出");
    const html = renderToStaticMarkup(<ChainPanel repos={repos} banners={[]} outcome={{ kind: "stop-requested", chainId: "chain-0000000b" }} />);
    for (const expected of ["链", "还没有链。", "发起人", "第 3 个会话；费用读不出", "运行中", "停止链", " 当前会话结束后停止。", "会话超时（分钟） ", "启动链", "链 chain-0000000b 将在当前会话结束后停止。"]) expect(html).toContain(expected);
    const banner = renderToStaticMarkup(<ChainBanners banners={bannersFor([repos[1]!], new Set())} />);
    expect(banner).toContain("链因触达上限而停止");
    expect(banner).toContain("知道了");
  });
});
```

In `web/tests/i18nSwitch.test.tsx` (Task 2's file), add after the first `it`:

```tsx
  it("re-renders a helper-built string too: the chain banner bannersFor builds", async () => {
    chainRepos = [{
      repoKey: "repo-one", defaultSessionTimeoutMin: null, problem: null,
      chain: { chainId: "chain-0000000b", goal: "g-1", by: "amy", via: "cli", startedAt: "2026-10-01T00:00:00.000Z", state: "stopped", holderGone: false, sessionsDone: 2, costUsd: 1.5, stop: { reason: "r-1", category: "done", at: "2026-10-01T01:00:00.000Z", awaitingHuman: [], detail: null } },
    }];
    const { container } = render(<App />);
    const select = await languageSelect(container);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Chain finished"));
    fireEvent.change(select, { target: { value: "zh" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("链已完成"));
    fireEvent.change(select, { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Chain finished"));
  });
```

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/chainsI18n.test.tsx tests/i18nSwitch.test.tsx) > "$SCRATCH/t6-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `chainsI18n` red; `i18nSwitch … > re-renders a helper-built string too …` red (the banner stays English); the Task 2 case stays green.

- [ ] **Step 3: Implement**

`web/src/locales/en.ts`: add `ChainStopCategory` to the `../types.js` type import and, before `export const en`,
```ts
const chainStopCategory = { done: "done", blocked: "blocked", limit: "limit", anomaly: "anomaly" } as const satisfies Record<ChainStopCategory, string>;
const chainBanner = {
  done: "Chain finished",
  blocked: "Chain is waiting for you",
  limit: "Chain stopped at a limit",
  anomaly: "Chain stopped on an anomaly",
} as const satisfies Record<ChainStopCategory, string>;
```
In `en`, after `decisions`:
```ts
  chains: {
    notLoaded: "Chains have not loaded.",
    title: "Chains",
    noChain: "No chain yet.",
    goal: "Goal",
    by: "By",
    progress: "Progress",
    state: "State",
    stop: "Stop chain",
    stopsAfter: " Stops after the current session ends.",
    formRepository: "Repository ",
    formGoal: "Goal ",
    formMaxSessions: "Max sessions ",
    formMaxCost: "Max cost in USD (a soft limit) ",
    formTimeout: "Session timeout in minutes ",
    start: "Start chain",
    started: "Chain {{chainId}} started.",
    stopRequested: "Chain {{chainId}} will stop after the current session ends.",
    gotIt: "Got it",
    stateStopped: "stopped: {{reason}} ({{category}})",
    stateRunning: "running",
    stateOrphaned: "running (supervisor is gone)",
    costUnreadable: "cost unreadable",
    cost: "USD {{amount}}",
    sessionProgress: "session {{n}}; {{cost}}",
    banner: chainBanner,
  },
```
and in `enums` add `chainStopCategory`.

`web/src/locales/zh.ts`, after `decisions`:
```ts
  chains: {
    notLoaded: "链尚未加载。",
    title: "链",
    noChain: "还没有链。",
    goal: "目标",
    by: "发起人",
    progress: "进度",
    state: "状态",
    stop: "停止链",
    stopsAfter: " 当前会话结束后停止。",
    formRepository: "仓库 ",
    formGoal: "目标 ",
    formMaxSessions: "最多会话数 ",
    formMaxCost: "费用上限（美元，软限制） ",
    formTimeout: "会话超时（分钟） ",
    start: "启动链",
    started: "链 {{chainId}} 已启动。",
    stopRequested: "链 {{chainId}} 将在当前会话结束后停止。",
    gotIt: "知道了",
    stateStopped: "已停止：{{reason}}（{{category}}）",
    stateRunning: "运行中",
    stateOrphaned: "运行中（监督进程已不在）",
    costUnreadable: "费用读不出",
    cost: "USD {{amount}}",
    sessionProgress: "第 {{n}} 个会话；{{cost}}",
    banner: { done: "链已完成", blocked: "链在等你", limit: "链因触达上限而停止", anomaly: "链因异常而停止" },
  },
```
and in `enums`: `chainStopCategory: { done: "已完成", blocked: "等人处理", limit: "触达上限", anomaly: "异常" },`.

`web/src/chainBanner.ts`: add `import i18n from "./i18n.js";` and `import { en } from "./locales/en.js";`; lines 8-13 → 
```ts
/** In English (criteria read it); bannersFor translates when it is called (panel i18n spec §3.3). */
export const BANNER_TEXT: Record<ChainStopCategory, string> = en.chains.banner;
```
line 30: `text: BANNER_TEXT[c.stop.category],` → `text: i18n.t(`chains.banner.${c.stop.category}`),`.

`web/src/ChainPanel.tsx`:
- imports: add `import { useTranslation } from "react-i18next";` and `import i18n, { enumText } from "./i18n.js";`
- lines 22-30:
```ts
export function chainStateText(chain: ChainView): string {
  if (chain.state === "stopped") {
    return i18n.t("chains.stateStopped", {
      reason: chain.stop?.reason ?? i18n.t("common.unknown"),
      category: chain.stop ? enumText("chainStopCategory", chain.stop.category) : i18n.t("common.unknown"),
    });
  }
  return chain.holderGone ? i18n.t("chains.stateOrphaned") : i18n.t("chains.stateRunning");
}
export const costText = (usd: number | null): string => (usd === null ? i18n.t("chains.costUnreadable") : i18n.t("chains.cost", { amount: usd.toFixed(2) }));
export function progressText(chain: ChainView): string {
  const n = chain.state === "running" && !chain.holderGone ? chain.sessionsDone + 1 : chain.sessionsDone;
  return i18n.t("chains.sessionProgress", { n, cost: costText(chain.costUsd) });
}
```
- `ChainBanners`: first body line `const { t } = useTranslation();`; `Got it` → `{t("chains.gotIt")}`.
- `ChainPanel`: first body line `const { t } = useTranslation();`; `<h2>Chains</h2>` → `<h2>{t("chains.title")}</h2>`; `<p>No chain yet.</p>` → `<p>{t("chains.noChain")}</p>`; `<dt>Goal</dt>`, `<dt>By</dt>`, `<dt>Progress</dt>`, `<dt>State</dt>` → `<dt>{t("chains.goal")}</dt>` etc.; `Stop chain` → `{t("chains.stop")}`; `{" Stops after the current session ends."}` → `{t("chains.stopsAfter")}`; `{"Repository "}` → `{t("chains.formRepository")}`; `{"Goal "}` → `{t("chains.formGoal")}`; `{"Max sessions "}` → `{t("chains.formMaxSessions")}`; `{"Max cost in USD (a soft limit) "}` → `{t("chains.formMaxCost")}`; `{"Session timeout in minutes "}` → `{t("chains.formTimeout")}`; `Start chain` → `{t("chains.start")}`; ``{`Chain ${outcome.chainId} started.`}`` → `{t("chains.started", { chainId: outcome.chainId })}`; ``{`Chain ${outcome.chainId} will stop after the current session ends.`}`` → `{t("chains.stopRequested", { chainId: outcome.chainId })}`.

`web/src/App.tsx:630`: `<p className="empty">Chains have not loaded.</p>` → `<p className="empty">{t("chains.notLoaded")}</p>`.

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/chainsI18n.test.tsx tests/i18nSwitch.test.tsx tests/chainPanel.test.tsx) > "$SCRATCH/t6-green.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t6-web-check.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`; `chainPanel.test.tsx` unmodified and green (F10).

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t6`)
  - MT6-1 banner from the English map: `text: i18n.t(`chains.banner.${c.stop.category}`)` → `text: BANNER_TEXT[c.stop.category]`. Red: `i18nSwitch … > re-renders a helper-built string too …` and `chainsI18n …` (`链因触达上限而停止`).
  - MT6-2 category raw: `enumText("chainStopCategory", chain.stop.category)` → `chain.stop.category`. Red: `chainsI18n …` (`（limit）`).
  - MT6-3 cost literal: `i18n.t("chains.costUnreadable")` → `"cost unreadable"`. Red: `chainsI18n …`.
  - MT6-4 outcome literal: `t("chains.stopRequested", …)` → `` `Chain ${outcome.chainId} will stop after the current session ends.` ``. Red: `chainsI18n …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/ChainPanel.tsx web/src/chainBanner.ts web/src/App.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/chainsI18n.test.tsx web/tests/i18nSwitch.test.tsx
/usr/bin/git commit -F - <<'MSG'
feat(web): translate the chains area and its banners

Chain state, cost and progress text, the start form, the outcomes and the
stop banners read in the chosen language; the stop reason stays as sent and
its category is shown in words. The switch criterion now also covers a
helper-built string: the banner re-renders when the language changes.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

