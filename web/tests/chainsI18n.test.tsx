// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3: the chains area's own sentences (state, cost, progress, outcomes, the form and the banners) in
 * Chinese; the stop reason is shown as sent (data), its category in words.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
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
  { repoKey: "acme-alpha", defaultSessionTimeoutMin: 30, chain: chain(), problem: null },
  { repoKey: "acme-beta", defaultSessionTimeoutMin: null, chain: stopped, problem: null },
  { repoKey: "acme-gamma", defaultSessionTimeoutMin: null, chain: null, problem: null },
];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// Copied verbatim from web/tests/i18nSwitch.test.tsx (the page reads the metrics on load).
const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };

afterEach(cleanup);

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

  // Task 6 implementer addition: each site read on its own node (whole text, bounded by its tags), so no assertion
  // passes on a neighbour's text -- "链" alone is inside nearly every Chinese string here.
  it("puts each chains sentence on its own node, the missing stop reason and category read 未知, and cost keeps its amount", async () => {
    await i18n.changeLanguage("zh");
    expect(chainStateText(chain({ state: "stopped", stop: null }))).toBe("已停止：未知（未知）");
    expect(costText(1.5)).toBe("USD 1.50");
    const html = renderToStaticMarkup(<ChainPanel repos={repos} banners={[]} outcome={{ kind: "stop-requested", chainId: "chain-0000000b" }} />);
    for (const expected of [
      "<h2>链</h2>",
      "<p>还没有链。</p>",
      "<dt>目标</dt>",
      "<dt>发起人</dt>",
      "<dt>进度</dt>",
      "<dt>状态</dt>",
      "<dd>第 3 个会话；费用读不出</dd>",
      "<dd>第 2 个会话；USD 1.50</dd>",
      '<dd data-testid="chain-state">运行中</dd>',
      '<dd data-testid="chain-state">已停止：r-1（触达上限）</dd>',
      ">停止链</button>",
      "<span> 当前会话结束后停止。</span>",
      '<label>仓库 <select name="repoKey">',
      '<label>目标 <textarea name="goal"',
      '<label>最多会话数 <input type="number" min="1" step="1" required="" name="maxSessions"/></label>',
      '<label>费用上限（美元，软限制） <input type="number" min="0.01" step="0.01" required="" name="maxCostUsd"/></label>',
      '<label>会话超时（分钟） <input type="number" min="1" name="sessionTimeoutMin"',
      ">启动链</button>",
      '<p role="status">链 chain-0000000b 将在当前会话结束后停止。</p>',
    ]) expect(html).toContain(expected);
    const started = renderToStaticMarkup(<ChainPanel repos={repos} banners={[]} outcome={{ kind: "started", chainId: "chain-0000000b" }} />);
    expect(started).toContain('<p role="status">链 chain-0000000b 已启动。</p>');
    const banner = renderToStaticMarkup(<ChainBanners banners={bannersFor([repos[1]!], new Set())} />);
    expect(banner).toContain("<strong>链因触达上限而停止</strong>");
    expect(banner).toContain('data-action="dismiss">知道了</button>');
  });

  it("says the chains have not loaded in Chinese while the page waits for them", async () => {
    await i18n.changeLanguage("zh");
    // /api/chains never answers, so the page keeps its not-loaded line; there is no control plane.
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === "/api/chains") return new Promise<Response>(() => {});
      if (url === "/api/todo") return json({ rows: [] });
      if (url === "/api/metrics") return json(METRICS);
      return json({ error: { code: "control-port-unconfigured", message: "no control plane in this criterion" } }, 404);
    }) as typeof fetch;
    render(<App />);
    await waitFor(() => expect(screen.getByText("链尚未加载。").className).toBe("empty"));
  });
});
