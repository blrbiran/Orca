import { describe, expect, it } from "vitest";
import { capabilityViewSchema } from "../../src/control/webProtocol.js";

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the protocol-2 payload
// (`capabilitiesSchema`, the view plus a protocol tag) is gone. Capabilities protocol 3 carries the seven-key view
// untagged inside one selection's resolution (spec §4.6), so this now pins that the view stays closed: no tag of any
// protocol, no retired v1 field, no value outside the vocabulary.
describe("capabilityViewSchema", () => {
  it("is the closed seven-key view that capabilities protocol 3 carries untagged", () => {
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
    // Old vocabulary must be rejected, named individually.
    expect(capabilityViewSchema.safeParse({ protocol: 2, ...view }).success).toBe(false);
    expect(capabilityViewSchema.safeParse({ protocol: 3, ...view }).success).toBe(false);
    expect(capabilityViewSchema.safeParse({ ...view, durableAccept: true }).success).toBe(false);
    expect(capabilityViewSchema.safeParse({ ...view, budgetEnforcement: "unsupported" }).success).toBe(false);
  });
});
