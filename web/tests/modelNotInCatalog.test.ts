import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { explainEstimatorCheck } from "../src/ccloopCodes.js";

// Issue #124 (session 3cfc2e73): Orca's estimator check names a codex model the read catalog does not list as
// `model-not-in-catalog: <model> (listed: ...)`; the words name the model and the list, so the person picks a listed one.
// Texts written out, so a dropped entry or a zh entry left in English turns this red.
const MESSAGE = "agent-selection-rejected:estimator:model-not-in-catalog: gpt-6-sol (listed: gpt-x gpt-y),usage-unavailable";
const EN = "Orca's estimator check refused this agent: The chosen model is not in the agent's catalog: gpt-6-sol (listed: gpt-x gpt-y). Choose a listed model (set the model in agent preferences or on the group). The agent cannot report how many tokens a call used.";
const ZH_START = "Orca 的估算器检查拒绝了这个 agent：所选模型不在 agent 的模型目录里：gpt-6-sol (listed: gpt-x gpt-y)。请选一个目录列出的模型（在 agent 偏好或组上设置模型）。";

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("model-not-in-catalog in words (#124)", () => {
  it("names the model and the listed ones, in English and Chinese, beside the other reasons", async () => {
    expect(explainEstimatorCheck(MESSAGE)).toBe(EN);
    await i18n.changeLanguage("zh");
    expect(explainEstimatorCheck(MESSAGE)?.startsWith(ZH_START)).toBe(true);
  });
});
