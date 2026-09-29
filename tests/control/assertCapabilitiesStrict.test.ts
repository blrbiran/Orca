import { describe, expect, it } from "vitest";
import { assertCapabilities } from "../../src/control/budget.js";
import { ControlError } from "../../src/control/errors.js";
import { profileSnapshot } from "./fixtures/web.js";

// Orca backlog #11(a) (2026-09-29; Orca handoff §9.1): strict mode means the token budget is bounded, and every other
// strict gate (webDispatch.ts probeBlocksDispatch, service.ts profiledCapabilities, estimator.ts) already requires the
// request-bound proof to bound "tokens". The claim-time assertion must not be the one gate a proof bounding only other
// dimensions gets through.
const code = (action: () => void): string | null => {
  try { action(); return null; } catch (error) { return error instanceof ControlError ? error.code : `not a ControlError: ${String(error)}`; }
};

describe("assertCapabilities under strict (backlog #11(a))", () => {
  it("refuses a strict claim whose request-bound proof does not bound tokens, and only under strict", () => {
    const bounded = profileSnapshot().profile.capabilities;
    // Non-vacuity: the fixture passes strict as it is, so the refusal below is about the dimensions alone.
    expect(bounded.requestBoundProof?.workDimensions).toEqual(["tokens"]);
    expect(code(() => assertCapabilities("strict", bounded))).toBeNull();
    const withoutTokens = { ...bounded, requestBoundProof: { ...bounded.requestBoundProof!, workDimensions: ["activeMs"] as ["activeMs"] } };
    expect(code(() => assertCapabilities("strict", withoutTokens))).toBe("control-capability-unsupported");
    expect(code(() => assertCapabilities("soft", withoutTokens))).toBeNull();
  });
});
