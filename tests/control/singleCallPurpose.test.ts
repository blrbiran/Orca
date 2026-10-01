import { describe, expect, it } from "vitest";
import { advance } from "../../src/control/executionDriver.js";
import { SINGLE_CALL_PURPOSES, singleCallClaimRowOf, singleCallPurposeOf } from "../../src/control/singleCall.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";

// N1 spec §5.1 and §12.1 (human ruling H6, B′): the estimate chain is one single call with a purpose. Phase 1 changes no
// behaviour -- every estimate criterion stays as it is -- and adds this one: a purpose no handler is registered for is
// refused by name, never driven as something else. Drafter ruling DR1: a stored estimate run keeps phase "estimate".
describe("the single call, generalised (N1 spec §5.1, §12.1)", () => {
  it("reads a stored estimate run as purpose estimate, and a work or handoff run as no single call", () => {
    expect(SINGLE_CALL_PURPOSES).toContain("estimate");
    expect(singleCallPurposeOf({ phase: "estimate" })).toBe("estimate");
    expect(singleCallPurposeOf({ phase: "work" })).toBeNull();
    expect(singleCallPurposeOf({ phase: "handoff" })).toBeNull();
    // The estimate's claim row is the one claimEstimate has always written (webService.ts claimEstimate).
    expect(singleCallClaimRowOf("estimate", "g", "estimate-1")).toEqual({ id: "estimate:g:estimate-1", kind: "estimate-claim" });
  });

  it("refuses a single-call run whose purpose has no handler, by name (DR3)", () => {
    for (const purpose of ["translate", "estimate", undefined, 7]) {
      expect(() => singleCallPurposeOf({ phase: "single-call", purpose })).toThrow(`single-call-purpose-unknown:${String(purpose)}`);
    }
  });

  it("refuses such a run in the driver instead of driving it, and leaves the run where it was", async () => {
    const x = await estimateHarness();
    try {
      const row = x.body();
      row.phase = "single-call";
      row.purpose = "translate";
      x.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), x.runId);
      await expect(advance(x.deps, x.runId, { reconciling: new Map(), stopped: false })).rejects.toThrow("single-call-purpose-unknown:translate");
      expect(x.body()).toMatchObject({ state: "starting", providerAttemptOrdinal: 0 });
      expect(x.fake.calls.accept).toHaveLength(0);
    } finally { await x.h.dispose(); }
  });
});
