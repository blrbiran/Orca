import { describe, expect, it } from "vitest";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { intersectCapabilities, resolveProfile } from "../../src/control/profiles.js";
import type { CapabilityViewV1 } from "../../src/control/webProtocol.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Spec 2026-10-15 §6.3, human ruling R7 (criterion 7): a profile's `contextWindowTokens: null` means "not declared", so the
// intersection takes ccloop's observed window; two numbers still take the smaller; an observed null stays null.
const declared = (window: number | null) => ({ ...profileSnapshot().profile.capabilities, contextWindowTokens: window });
const observed = (window: number | null): CapabilityViewV1 => ({ ...profileSnapshot().profile.capabilities, contextWindowTokens: window });

describe("a declared-null window (R7)", () => {
  it("takes the observed window, the smaller of two, and keeps an observed null", () => {
    expect([
      intersectCapabilities(declared(null), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(200000), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(300000), observed(272000)).contextWindowTokens,
      intersectCapabilities(declared(null), observed(null)).contextWindowTokens,
      intersectCapabilities(declared(300000), observed(null)).contextWindowTokens,
    ]).toEqual([272000, 200000, 272000, null, null]);
  });

  it("has no context-unavailable when ccloop reports a window under a null-declaring profile, and has it when ccloop reports none", () => {
    const snapshot = profileSnapshot(); snapshot.profile.capabilities = declared(null);
    const profile = resolveProfile(snapshot);
    const at = (window: number | null) => estimatorCompatibility({ profile, observed: observed(window), probeFailureCode: null, resolution: fixtureResolutionFor(observed(window)) }, "soft").reasonCodes;
    // Ruling: 「这次批准改写所有必要的判据」 (human, tester feedback round 2026-10-28, controller a9f9d6de): #105 splits the
    // refusal; this fixture's resolution answers a single call (a catalog row was found), so ccloop's null window is now
    // `context-unreported`. It still encodes R7: a reported window clears the refusal, a null one is refused.
    const context = (codes: string[]) => codes.filter((code) => code.startsWith("context-"));
    expect([context(at(272000)), context(at(null))]).toEqual([[], ["context-unreported"]]);
  });
});
