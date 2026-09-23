import { describe, expect, it } from "vitest";
import { capabilitiesSchema, capabilityViewSchema } from "../../src/control/webProtocol.js";

describe("capabilitiesSchema", () => {
  it("is the view schema plus protocol, with no independent field list", () => {
    const view = {
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "unavailable",
      handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      contextWindowTokens: null,
      requestBoundProof: null,
    };
    expect(capabilityViewSchema.safeParse(view).success).toBe(true);
    expect(capabilitiesSchema.safeParse({ protocol: 2, ...view }).success).toBe(true);
    // Old vocabulary must be rejected, named individually.
    expect(capabilitiesSchema.safeParse({ protocol: 2, ...view, durableAccept: true }).success).toBe(false);
    expect(capabilitiesSchema.safeParse({ protocol: 1, ...view }).success).toBe(false);
    expect(capabilitiesSchema.safeParse({ protocol: 2, ...view, budgetEnforcement: "unsupported" }).success).toBe(false);
  });
});
