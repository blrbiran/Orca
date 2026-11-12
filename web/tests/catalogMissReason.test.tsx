import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const MISS = "model-not-in-catalog: gpt-6-sol (listed: mode-a mode-b)";
const rateLimited = (catalogMiss?: string) => run({ runId: "run-r", state: "blocked", outcome: "failed", stopReason: "Error: 429",
  failureCause: { cause: "rate-limited", phase: "plan", retries: 0, detail: "429 Too Many Requests" }, ...(catalogMiss === undefined ? {} : { catalogMiss }) });
const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

// Issue #209: a 0-usage rate limit on a model the agent's catalog does not list reads as a quota problem; the run's reason
// names the catalog warning the server keeps for it, so a person changes the model rather than waits.
describe("a 0-usage rate-limited run off the catalog names the warning (#209)", () => {
  it("says the model is not in the catalog, with the warning, in English and Chinese", async () => {
    const en = text(renderToStaticMarkup(<RunReason run={rateLimited(MISS)} />));
    expect(en).toContain(`its model is not in the agent's catalog (${MISS})`);
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={rateLimited(MISS)} />))).toContain(`它的模型不在 agent 的模型目录里（${MISS}）`);
  });

  it("says nothing of the catalog when the view carries no miss", () => {
    const html = renderToStaticMarkup(<RunReason run={rateLimited()} />);
    expect(html).not.toContain("run-catalog-miss");
    expect(html).not.toContain("catalog");
  });
});
