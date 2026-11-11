import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { callRecordSchema } from "../../src/control/requirementSchemas.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Tester issue #125, Orca half (session f958ec3f): a failed requirement call kept only ccloop's normalised code
 * (`calls[].reason`, ccloop error codes spec §4.5), so the provider's own words for why it failed -- the head ccloop puts in
 * its single-call record's `failureCause.detail` (quota probe spec 2026-11-06 R0) -- were read and dropped. The failed
 * call's record now keeps that head as `detail`, cut to at most 512 UTF-8 bytes on a character boundary; absent when the
 * record names none. `reason` and `lastInvalidReason` are unchanged (spec §4.5 keeps the latter `no-output`).
 */
const LONG = "限".repeat(200); // 200 units (ccloop's record allows 512), 600 UTF-8 bytes
const CUT = "限".repeat(170); // 510 bytes: one more character would be 513
const failed = (purpose: "clarify" | "split", failureCause?: { cause: string; detail: string | null }) =>
  ({ purpose, output: null, outcome: "failed" as const, tokens: 0, errorCode: "codex-turn-failed", ...(failureCause === undefined ? {} : { recordExtra: { failureCause } }) });

describe("a failed requirement call keeps ccloop's failure detail (#125)", () => {
  it("clarify: the failed call records the detail, cut to 512 UTF-8 bytes; the retried valid call has none", async () => {
    const x = await requirementHarness({ answers: [failed("clarify", { cause: "quota", detail: LONG }), { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const [first, second] = x.round(1).calls;
      // mutation: the clarify handler passes no detail -> no `detail` -> red
      // mutation: the driver passes no record facts to complete -> red; the clarify dispatcher drops them -> red
      expect(first).toMatchObject({ outcome: "failed", reason: "codex-turn-failed", detail: CUT });
      // mutation: drop the cut -> the 600-byte head is stored (or refused by the schema) -> red
      expect(Buffer.byteLength(first!.detail!, "utf8")).toBeLessThanOrEqual(512);
      expect(second).toMatchObject({ outcome: "valid", reason: null });
      expect(second).not.toHaveProperty("detail");
    } finally { await x.dispose(); }
  });

  it("split: the failed draft's call records the detail", async () => {
    const x = await requirementHarness({ answers: [failed("split", { cause: "quota", detail: "You've hit your usage limit" }), { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      const draft2 = () => { try { return readDraft(x.store, "r", 2).state; } catch { return "drafting"; } };
      await x.until(() => draft2() !== "drafting");
      // mutation: the split handler passes no detail -> red
      expect(readDraft(x.store, "r", 1).calls).toMatchObject([{ outcome: "failed", reason: "codex-turn-failed", detail: "You've hit your usage limit" }]);
    } finally { await x.dispose(); }
  });

  it("adds no key where the record names no detail: no failureCause, a null detail, an empty one", async () => {
    for (const cause of [undefined, { cause: "quota", detail: null }, { cause: "quota", detail: "" }]) {
      const x = await requirementHarness({ answers: [failed("clarify", cause), { purpose: "clarify", output: ROUND_ONE }] });
      try {
        await x.until(() => x.round(1).state === "awaiting-answers");
        // mutation: always write `detail` (null when none) -> red; drop the empty-head check -> "" stored or refused -> red
        expect(x.round(1).calls[0]).toMatchObject({ outcome: "failed", reason: "codex-turn-failed" });
        expect(Object.keys(x.round(1).calls[0]!), JSON.stringify(cause)).not.toContain("detail");
      } finally { await x.dispose(); }
    }
  });

  it("the stored call record accepts a detail of at most 512 UTF-8 bytes, and none", () => {
    const call = { runId: "run-1", overviewHash: null, commit: null, usage: null, outcome: "failed", reason: "codex-turn-failed" };
    expect(callRecordSchema.safeParse(call).success).toBe(true);
    expect(callRecordSchema.safeParse({ ...call, detail: CUT }).success).toBe(true);
    // mutation: drop the byte bound from the schema -> a 600-byte detail parses -> red
    expect(callRecordSchema.safeParse({ ...call, detail: LONG }).success).toBe(false);
    expect(callRecordSchema.safeParse({ ...call, detail: "" }).success).toBe(false);
  });
});
