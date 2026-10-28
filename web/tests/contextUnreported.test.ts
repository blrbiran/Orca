import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { explainEstimatorCheck } from "../src/ccloopCodes.js";

// Issue #105: Orca's estimator check names `context-unreported` when the agent's catalog lists the model without a
// context window; the words point at ccloop's installation field `declaredContextWindow`, not at "choose another model".
// Texts written out, so a dropped entry or a zh entry left in English turns this red.
const EN = "Orca's estimator check refused this agent: The agent's catalog lists this model but reports no context window for it (common with a third-party codex provider). Declare the window on this installation: set `declaredContextWindow` (the model's context window, in tokens) in the agent installation table (by default ~/.orca/agents.json); ccloop uses it only when the catalog gives no window.";
const ZH = "Orca 的估算器检查拒绝了这个 agent：agent 的模型目录列出了这个模型，但没有给出它的上下文窗口（第三方 codex provider 常见）。请在这个安装上声明窗口：在 agent 安装表（默认 ~/.orca/agents.json）里给它设 `declaredContextWindow`（模型的上下文窗口，单位 token）；ccloop 只在目录没给窗口时才用它。";

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("context-unreported in words (#105)", () => {
  it("points at declaredContextWindow, in English and Chinese", async () => {
    expect(explainEstimatorCheck("agent-selection-rejected:estimator:context-unreported")).toBe(EN);
    await i18n.changeLanguage("zh");
    expect(explainEstimatorCheck("agent-selection-rejected:estimator:context-unreported")).toBe(ZH);
  });
});
