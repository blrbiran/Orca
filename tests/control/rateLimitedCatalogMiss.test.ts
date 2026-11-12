import { describe, expect, it } from "vitest";
import type { AgentModelsView } from "../../src/control/executionPort.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";

// Issue #209: a provider may answer a model it does not serve with a 429, which ccloop reports as `rate-limited`, so an
// operator reads a quota problem. When such a run used no tokens and its frozen model is missing from the agent's read
// catalog (the warning the selection preview already showed, eaf2073d), the run's failure explanation names that warning.
const RATE_LIMITED: HarnessOptions["failure"] = () => ({ failureCause: { cause: "rate-limited", phase: "plan", retries: 0, detail: "429 Too Many Requests" } });
const QUOTA: HarnessOptions["failure"] = () => ({ failureCause: { cause: "quota", phase: "plan", retries: 0, detail: null } });

/** `listed`: the catalog's models; `own` adds the run's frozen model to them; `unread`: the catalog cannot be read. */
async function failedRun(shape: { listed: string[] | "unread"; own?: boolean; tokens: number; failure?: HarnessOptions["failure"] }) {
  const runModel: { value: string | null } = { value: null };
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: () => "failed", workTokens: () => shape.tokens, failure: shape.failure ?? RATE_LIMITED,
    listModels: async (installation: string): Promise<AgentModelsView> => {
      if (shape.listed === "unread") throw new Error("catalog unreadable");
      const models = [...(shape.own === true && runModel.value !== null ? [runModel.value] : []), ...shape.listed];
      return { installation, kind: "codex", source: "cache", observedAt: null,
        models: models.map((model) => ({ model, contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" as const })) };
    },
  });
  const runId = await t.claim();
  runModel.value = String(t.body(runId).agent.model);
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  return { t, model: runModel.value, view: () => readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)! };
}

describe("a 0-usage rate-limited run on a model the catalog does not list says so (#209)", { timeout: 90_000 }, () => {
  it("names the catalog warning in the run's view, in the preview's words", async () => {
    const { t, model, view } = await failedRun({ listed: ["mode-a", "mode-b"], tokens: 0 }); try {
      expect(model).not.toMatch(/^mode-[ab]$/);
      expect(view().failureCause).toMatchObject({ cause: "rate-limited" });
      expect(view().catalogMiss).toBe(`model-not-in-catalog: ${model} (listed: mode-a mode-b)`);
    } finally { await t.h.dispose(); }
  });

  it.each([
    ["the catalog lists the model", { listed: ["mode-a"], own: true, tokens: 0 }],
    ["the catalog cannot be read", { listed: "unread" as const, tokens: 0 }],
    ["the run used tokens", { listed: ["mode-a"], tokens: 10 }],
    ["the cause is quota", { listed: ["mode-a"], tokens: 0, failure: QUOTA }],
  ])("names nothing when %s", async (_name, shape) => {
    const { t, view } = await failedRun(shape); try {
      expect(view().state).toBe("blocked");
      expect(view().catalogMiss).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});
