import { describe, expect, it } from "vitest";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Issue #105 (tester, 2026-10-28): a codex selection whose model the catalog lists without a window was refused with
// words that said the model was not in the catalog. ccloop decides the codex single call per catalog row: "v1-soft" when
// the row is found, null when it is not (ccloop src/agents/codex.ts singleCallExecution). So a null window with a single
// call is a listed model with no window -- `context-unreported`, which an installation's `declaredContextWindow` fills
// (ccloop spec 2026-10-21-declared-context-window-design.md) -- and a null window without one stays `context-unavailable`.
const profile = resolveProfile(profileSnapshot());
const withWindow = (window: number | null, singleCallExecution: "v1" | "v1-soft" | null) => {
  const observed = { ...profile.snapshot.profile.capabilities, contextWindowTokens: window };
  return { profile, observed, observedAt: new Date(0).toISOString(), probeFailureCode: null,
    resolution: { ...fixtureResolutionFor(observed), singleCallExecution } };
};
const contextCodes = (codes: readonly string[]) => codes.filter((code) => code.startsWith("context-"));

describe("a model with no context window (#105)", () => {
  it("is context-unreported when the catalog row was found (ccloop answered a single call)", () => {
    expect(contextCodes(estimatorCompatibility(withWindow(null, "v1-soft"), "soft").reasonCodes)).toEqual(["context-unreported"]);
  });

  it("stays context-unavailable when no row was found (no single call), beside single-call-unavailable", () => {
    expect(estimatorCompatibility(withWindow(null, null), "soft").reasonCodes).toEqual(["single-call-unavailable", "context-unavailable"]);
  });

  it("names neither when the window is known", () => {
    expect(contextCodes(estimatorCompatibility(withWindow(272_000, "v1-soft"), "soft").reasonCodes)).toEqual([]);
  });
});
