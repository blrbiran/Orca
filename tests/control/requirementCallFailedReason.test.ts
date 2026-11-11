import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { draftBodySchema, roundBodySchema } from "../../src/control/requirementSchemas.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";

/**
 * Tester follow-up E §7 (#125): a round or draft whose last call FAILED (ccloop's record outcome not complete) used to
 * end as `clarify-output-invalid` / `split-output-invalid`, whose words say the model's output was invalid three times --
 * false for a call refused before it ran, or one the provider failed. It now ends as `clarify-call-failed` /
 * `split-call-failed`; an output that came back and was judged invalid keeps the old codes. `lastInvalidReason` still
 * quotes `no-output` into the next prompt (provider text is untrusted and gives the model nothing), and the failed call
 * keeps ccloop's detail. Overrides ccloop error codes spec (2026-10-15) §4.5 for call failures.
 */
const failed = (purpose: "clarify" | "split", errorCode = "codex-turn-failed") =>
  ({ purpose, output: null, outcome: "failed" as const, tokens: 0, errorCode, recordExtra: { failureCause: { cause: "transient", detail: "upstream 502" } } });
const invalid = (purpose: "clarify" | "split") => ({ purpose, output: { nonsense: true } });

describe("a requirement step that ends on a failed call says so (#125)", () => {
  it("clarify: three failed calls end the round clarify-call-failed; lastInvalidReason stays no-output; the call keeps its detail", async () => {
    const x = await requirementHarness({ answers: [failed("clarify"), failed("clarify"), failed("clarify")] });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(x.round(1)).toMatchObject({ state: "failed", retries: 2, reasonCode: "clarify-call-failed", lastInvalidReason: "no-output" });
      expect(x.round(1).calls.at(-1)).toMatchObject({ outcome: "failed", reason: "codex-turn-failed", detail: "upstream 502" });
    } finally { await x.dispose(); }
  });

  it("clarify: the last call decides -- invalid, invalid, failed is call-failed; failed, failed, invalid is output-invalid", async () => {
    for (const [answers, reasonCode] of [
      [[invalid("clarify"), invalid("clarify"), failed("clarify")], "clarify-call-failed"],
      [[failed("clarify"), failed("clarify"), invalid("clarify")], "clarify-output-invalid"],
    ] as const) {
      const x = await requirementHarness({ answers: [...answers] });
      try {
        await x.until(() => x.round(1).state === "failed");
        expect(x.round(1).reasonCode, reasonCode).toBe(reasonCode);
      } finally { await x.dispose(); }
    }
  });

  it("split: three failed calls end the last draft split-call-failed; three invalid outputs stay split-output-invalid", async () => {
    for (const [answer, reasonCode] of [[failed("split"), "split-call-failed"], [invalid("split"), "split-output-invalid"]] as const) {
      const x = await requirementHarness({ answers: [answer, answer, answer], startAt: "split" });
      const state = () => { try { return readDraft(x.store, "r", 3).state; } catch { return "drafting"; } };
      try {
        await x.until(() => state() === "failed");
        expect(readDraft(x.store, "r", 3).reasonCode, reasonCode).toBe(reasonCode);
      } finally { await x.dispose(); }
    }
  });

  it("the stored round and draft accept the new codes and still refuse an unknown one", () => {
    const round = roundBodySchema.shape.reasonCode, draft = draftBodySchema.shape.reasonCode;
    expect([round.safeParse("clarify-call-failed").success, round.safeParse("clarify-output-invalid").success, round.safeParse("split-call-failed").success]).toEqual([true, true, false]);
    expect([draft.safeParse("split-call-failed").success, draft.safeParse("split-output-invalid").success, draft.safeParse("clarify-call-failed").success]).toEqual([true, true, false]);
  });
});
