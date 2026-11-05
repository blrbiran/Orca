import { describe, expect, it } from "vitest";
import { catalogMissOf, estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import type { AgentModelsView, ExecutionPort } from "../../src/control/executionPort.js";
import { estimatorSlotFor } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { FIXTURE_AGENT_ID, fixtureResolutionFor, writePreferencesRow } from "./fixtures/agents.js";
import { openTestStore } from "./fixtures/store.js";
import { profileSnapshot } from "./fixtures/web.js";

// Issue #124 (session 3cfc2e73): codex's default model was not in a third-party provider's catalog, and Orca said
// `single-call-unavailable,context-unavailable` -- capability words that pointed the person away from the fix (choose a
// listed model). When ccloop's catalog for the installation was read and does not list the chosen model, the estimator
// check now says `model-not-in-catalog: <model> (listed: ...)` in place of those two codes. A catalog that was not read
// (or cannot be) changes nothing: that is not a refusal of its own (ccloop plan issue 5).
const profile = resolveProfile(profileSnapshot());
const observed = { ...profile.snapshot.profile.capabilities, contextWindowTokens: null };
const resolution = { ...fixtureResolutionFor(observed), singleCallExecution: null };
const model = resolution.selection.model;
const view = (over: Partial<AgentModelsView> = {}): AgentModelsView => ({ installation: resolution.selection.agent, kind: "codex", source: "cache", observedAt: null,
  models: [{ model: "gpt-x", contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" }, { model: "gpt-y", contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1-soft" }], ...over });
const portOf = (answer: AgentModelsView | Error) => {
  const calls: Array<[string, boolean]> = [];
  return { calls, port: { listModels: async (installation: string, refresh: boolean) => { calls.push([installation, refresh]); if (answer instanceof Error) throw answer; return answer; } } };
};
const observation = (catalogMiss?: { model: string; listed: string[] }) => ({ profile, observed, observedAt: new Date(0).toISOString(), probeFailureCode: null, resolution, ...(catalogMiss ? { catalogMiss } : {}) });

describe("a codex model the read catalog does not list is named (#124)", () => {
  it("catalogMissOf names the model and the listed ones, from ccloop's cached catalog (no refresh)", async () => {
    const { port, calls } = portOf(view());
    expect(await catalogMissOf(port, resolution)).toEqual({ model, listed: ["gpt-x", "gpt-y"] });
    expect(calls).toEqual([[resolution.selection.agent, false]]);
  });

  it("the estimator check says model-not-in-catalog in place of the single-call and context codes", () => {
    expect(estimatorCompatibility(observation(), "soft").reasonCodes.slice(0, 2)).toEqual(["single-call-unavailable", "context-unavailable"]);
    const codes = estimatorCompatibility(observation({ model, listed: ["gpt-x", "gpt-y"] }), "soft").reasonCodes;
    expect(codes[0]).toBe(`model-not-in-catalog: ${model} (listed: gpt-x gpt-y)`);
    expect(codes).not.toContain("single-call-unavailable");
    expect(codes).not.toContain("context-unavailable");
  });

  it("control: no miss when the catalog was not read, lists nothing, lists the model, is not codex, or cannot be read", async () => {
    expect(await catalogMissOf(portOf(view({ source: "none" })).port, resolution)).toBeNull();
    expect(await catalogMissOf(portOf(view({ models: [] })).port, resolution)).toBeNull();
    expect(await catalogMissOf(portOf(view({ models: [{ model, contextWindowTokens: null, maxOutputTokens: null, singleCallExecution: null }] })).port, resolution)).toBeNull();
    expect(await catalogMissOf(portOf(view({ kind: "omp" })).port, resolution)).toBeNull();
    expect(await catalogMissOf(portOf(new Error("unreadable")).port, resolution)).toBeNull();
    expect(await catalogMissOf({}, resolution)).toBeNull();
  });

  it("control: a resolution with a single call or a window never asks for the catalog", async () => {
    const { port, calls } = portOf(view());
    expect(await catalogMissOf(port, { ...resolution, singleCallExecution: "v1-soft" })).toBeNull();
    expect(await catalogMissOf(port, { ...resolution, capabilities: { ...observed, contextWindowTokens: 1000 } })).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("the estimator slot carries the catalog miss to every estimator check (#124)", () => {
  it("estimatorSlotFor, through the profile router's own port, attaches catalogMiss and the check names it", async () => {
    const h = await openTestStore();
    try {
      writePreferencesRow(h.store, "operator", { defaultAgent: FIXTURE_AGENT_ID, perAgent: {} });
      const unused = async () => { throw new Error("not used here"); };
      const port = { resolveAgent: async () => resolution, listModels: async () => view(), listAgents: unused, readEvidence: unused, accept: unused, inspect: unused, requestHandoff: unused, collect: unused } as unknown as ExecutionPort;
      const router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), port)]);
      const prepared = await estimatorSlotFor({ store: h.store, profileRouter: router }, "operator", {}, router.list()[0]!);
      expect(prepared.outcome.kind).toBe("frozen");
      expect(prepared.observation.catalogMiss).toEqual({ model, listed: ["gpt-x", "gpt-y"] });
      expect(estimatorCompatibility(prepared.observation, "soft").reasonCodes[0]).toBe(`model-not-in-catalog: ${model} (listed: gpt-x gpt-y)`);
    } finally { await h.dispose(); }
  });
});
