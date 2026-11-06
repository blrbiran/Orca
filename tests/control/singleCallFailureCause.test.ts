import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Spec 2026-11-06 quota probe §4 step 1, criterion R0: ccloop's single-call record may carry an optional typed
// `failureCause` on a call that did not complete. Orca must accept it BEFORE ccloop sends it -- the record schema is strict,
// and a record that does not parse blocks the run `single-call-record-invalid`, which would turn every failed estimate,
// clarify, split and flow call into a block. A record without the field must still be read exactly as before.

const settled = async (recordExtra?: Record<string, unknown>) => {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: null, outcome: "failed", errorCode: "codex-turn-failed", ...(recordExtra === undefined ? {} : { recordExtra }) }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
  try {
    const draft2State = () => { try { return readDraft(x.store, "r", 2).state; } catch { return null; } };
    await x.until(() => x.runs()[0]?.state === "blocked" || (draft2State() ?? "drafting") !== "drafting");
    const run = x.runs()[0]!;
    // The run's own ids (run id, overview hash, commit) differ between two harnesses; everything else must not.
    const draft1 = readDraft(x.store, "r", 1);
    const comparable = { ...draft1, updatedAt: null, calls: draft1.calls.map(({ usage, outcome, reason }) => ({ usage, outcome, reason })) };
    return { state: run.state, blockedReason: run.drive?.blockedReason ?? null, draft1: comparable, draft2State: draft2State() };
  } finally { await x.dispose(); }
};

describe("a single-call record with ccloop's failureCause (R0)", () => {
  it("parses, and the failed call is settled exactly as one without the field", async () => {
    const without = await settled();
    const withCause = await settled({ failureCause: { cause: "quota", detail: "You've hit your usage limit" } });
    expect(without.blockedReason).toBeNull();
    expect(withCause.blockedReason).toBeNull();
    expect(withCause.state).toBe(without.state);
    expect(without.draft1).toMatchObject({ state: "invalid", calls: [{ outcome: "failed", reason: "codex-turn-failed" }] });
    expect(JSON.stringify(withCause.draft1)).toBe(JSON.stringify(without.draft1));
    expect(withCause.draft2State).toBe(without.draft2State);
  });

  it("still refuses a failureCause of another shape (the schema stays strict inside the field)", async () => {
    const odd = await settled({ failureCause: { cause: "quota", detail: null, phase: "execute" } });
    expect(odd.blockedReason).toBe("single-call-record-invalid");
  });
});
