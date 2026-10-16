import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ccloopWorlds, raw, realBinary } from "./fixtures/ccloopWorld.js";

// Spec 2026-10-15 criterion 4 (R1, R2, R7) against the real ccloop build and its fake codex: a codex estimator opens a
// requirement in soft mode under a profile that declares no window; strict mode still refuses it by name.
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-codex-req-", epochPrefix: "epoch-codex-req-" });
afterAll(removeRoots);

describe("requirement-open with a codex estimator (spec 2026-10-15 criterion 4)", { timeout: 120_000 }, () => {
  relocateHome("orca-codex-req-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });
  const open = async (estimateMode: "strict" | "soft") => {
    const w = await world([], {}, { estimateMode });
    const runtime = await w.boot();
    try {
      const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
        { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "codex" } } }, { kind: "operator", operatorId: "human" }));
      expect("error" in prefs ? prefs.error : "set").toBe("set");
      return await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
        target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: w.repoId, idea: "Let people export notes.", contentLanguage: "en" } } as never);
    } finally { await w.teardown(); }
  };
  it("opens in soft mode", async () => {
    expect(await open("soft")).toMatchObject({ result: { kind: "requirement-opened" } });
  });
  it("refuses in strict mode with single-call-unavailable among the reasons", async () => {
    expect(await open("strict")).toMatchObject({ error: { code: "agent-selection-rejected", message: expect.stringContaining("single-call-unavailable") } });
  });
});
