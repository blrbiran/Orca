import { describe, expect, it } from "vitest";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

const profile = resolveProfile(profileSnapshot());
const compatible = () => ({ profile, observed: profile.snapshot.profile.capabilities, observedAt: new Date(0).toISOString(), probeFailureCode: null,
  resolution: fixtureResolutionFor(profile.snapshot.profile.capabilities) });

describe("estimator compatibility follows the final resolved installation", () => {
  it("accepts a bounded single-call selection in strict mode", () => {
    expect(estimatorCompatibility(compatible(), "strict")).toEqual({ compatible: true, reasonCodes: [] });
  });

  it("refuses the chosen installation when its single-call capability is absent", () => {
    const observation = compatible();
    expect(estimatorCompatibility({ ...observation, resolution: { ...observation.resolution, singleCallExecution: null } }, "soft"))
      .toEqual({ compatible: false, reasonCodes: ["single-call-unavailable"] });
  });

  it("requires finite request bounds only for strict single-call work", () => {
    const observation = compatible();
    const observed = { ...observation.observed, requestBoundProof: null };
    expect(estimatorCompatibility({ ...observation, observed }, "soft").compatible).toBe(true);
    expect(estimatorCompatibility({ ...observation, observed }, "strict").reasonCodes).toContain("request-bound-unavailable");
  });
});
