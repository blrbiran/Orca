import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"");
const failed = (detail: string) => run({ runId: "run-s", state: "blocked", outcome: "failed", stopReason: "Error: codex-exit-error",
  agent: { installation: "codex-proxy", model: "m" }, failureCause: { cause: "unknown", phase: "plan", retries: 0, detail } });

/**
 * #122: a third-party provider behind codex answers --output-schema with a 400 about the response format. The run's reason
 * names the way out -- ccloop's opt-in `"structuredOutput": "prompt"` on that installation -- and only for that refusal.
 * Mutation (seen red, Rule 9): the shared predicate (src/control/structuredOutputHint.ts) always false -> the hint is gone.
 */
describe("the structured-output hint on a run's reason (#122)", () => {
  it("names the installation and the setting, in English and Chinese, for a provider 400 about response_format", async () => {
    const r = failed("unexpected status 400 Bad Request: Unsupported parameter: 'response_format'");
    expect(text(renderToStaticMarkup(<RunReason run={r} />))).toContain("The provider refused the structured-output request (--output-schema). Set \"structuredOutput\": \"prompt\" on the codex installation codex-proxy in the agents table; ccloop never chooses it on its own.");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={r} />))).toContain("服务商拒绝了结构化输出请求（--output-schema）。请在 agents 表里给 codex 安装 codex-proxy 设置 \"structuredOutput\": \"prompt\"；ccloop 不会自动选择它。");
  });

  it("says nothing of it for another failure", () => {
    expect(renderToStaticMarkup(<RunReason run={failed("codex-exit-error: network unreachable")} />)).not.toContain("structuredOutput");
  });
});
