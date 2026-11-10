import { describe, expect, it } from "vitest";
import { resolveGroupSelections, taskSlotKey } from "../../src/control/agentFreeze.js";
import type { AgentModelsView, ExecutionPort } from "../../src/control/executionPort.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Issue #209: a codex worker whose model the read catalog does not list reached dispatch and failed at the provider,
 * which the panel then showed as rate limiting. The worker slots now get the same catalog check the estimator has
 * (#124): the slot is refused before confirmation, naming the model and the listed ones.
 */
type Harness = Awaited<ReturnType<typeof requirementHarness>>;
async function accepted(): Promise<Harness> {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  const answer = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
  if ("error" in (answer as object)) throw new Error(JSON.stringify(answer));
  return x;
}
/** The fixture port, answering every selection as a codex model whose window the catalog did not supply. */
function uncataloged(x: Harness, listed: string[]): ExecutionPort {
  return {
    ...x.fake.port,
    resolveAgent: async (partial) => {
      const base = await x.fake.port.resolveAgent(partial);
      return { ...base, singleCallExecution: null, capabilities: { ...base.capabilities, contextWindowTokens: null } };
    },
    listModels: async (installation: string): Promise<AgentModelsView> => ({ installation, kind: "codex", source: "cache", observedAt: null,
      models: listed.map((model) => ({ model, contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" as const })) }),
  };
}

describe("a worker model the read catalog does not list is warned about, not refused (#209)", () => {
  it("keeps each task slot resolved and carries a warning naming the listed models", async () => {
    const x = await accepted(); try {
      const resolution = await resolveGroupSelections({ store: x.store, port: uncataloged(x, ["mode-a", "mode-b"]) }, "r", "human");
      const slot = resolution.slots.find((entry) => entry.key === taskSlotKey("exporter"))!;
      expect(slot.outcome.kind).toBe("resolved");
      expect(slot.warning).toMatch(/^model-not-in-catalog: .+ \(listed: mode-a mode-b\)$/);
      // A warning is not a refusal: confirm still has a hash to bind.
      expect(resolution.selectionsHash).not.toBeNull();
    } finally { await x.dispose(); }
  });

  it("control: a model the catalog lists resolves with no warning", async () => {
    const x = await accepted(); try {
      const model = (await x.fake.port.resolveAgent({})).selection.model;
      const resolution = await resolveGroupSelections({ store: x.store, port: uncataloged(x, ["mode-a", model]) }, "r", "human");
      const slot = resolution.slots.find((entry) => entry.key === taskSlotKey("exporter"))!;
      expect(slot.outcome.kind).toBe("resolved");
      expect(slot.warning).toBeUndefined();
    } finally { await x.dispose(); }
  });
});
