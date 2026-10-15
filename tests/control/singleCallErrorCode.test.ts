import { describe, expect, it } from "vitest";
import { normalizeSingleCallErrorCode } from "../../src/control/executionDriver.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// ccloop error codes spec (2026-10-15) §4.5, criterion 6: ccloop's single-call record names why a call failed. Orca now
// stores that code where it stores the failure, never ccloop's free text; and a call ccloop refused before spawning (its
// catalog cap or model changed) is not retried automatically, because the same envelope would be refused again.
const preSpawn = (purpose: "clarify" | "split", errorCode: string) => ({ purpose, output: null, outcome: "failed" as const, tokens: 0, errorCode });

describe("the record's errorCode, normalised (spec A §4.5)", () => {
  it("keeps a code, cuts at the first colon, and makes anything else unknown (plan correction K4)", () => {
    expect([null, "omp-single-call-cap-exceeded", "omp-single-call-stop:length", "x:y\n<script>", "<b>x</b>:y\n", "X-Y", "a".repeat(65), ""].map(normalizeSingleCallErrorCode))
      .toEqual([null, "omp-single-call-cap-exceeded", "omp-single-call-stop", "x", "unknown", "unknown", "unknown", "unknown"]);
  });
});

describe("where a failed call is stored (spec A §4.5)", () => {
  it("estimate: a failed call's reason carries ccloop's code; a hostile one is stored as unknown", async () => {
    for (const [errorCode, reasonCode] of [["omp-single-call-cap-exceeded", "estimate-call-failed:omp-single-call-cap-exceeded"], ["<b>x</b>:y\n", "estimate-call-failed:unknown"]]) {
      const x = await estimateHarness({ outcome: "failed", tokens: 0, errorCode }); try {
        await x.rounds(() => x.estimate().state !== "running");
        expect(x.estimate()).toMatchObject({ state: "failed", reasonCode });
      } finally { await x.h.dispose(); }
    }
  });

  it("usage unknown: the block reason appends ccloop's code", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null, errorCode: "omp-single-call-unavailable" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown:omp-single-call-unavailable" });
    } finally { await x.h.dispose(); }
  });

  it("clarify: a pre-spawn refusal fails the round at once, its one call recorded failed with the code, lastInvalidReason still no-output", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => preSpawn("clarify", "omp-single-call-cap-exceeded")) });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(x.round(1)).toMatchObject({ state: "failed", retries: 0, reasonCode: "clarify-output-invalid", lastInvalidReason: "no-output" });
      expect(x.round(1).calls.map((call) => [call.outcome, call.reason])).toEqual([["failed", "omp-single-call-cap-exceeded"]]);
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });

  it("clarify: any other failed call keeps its automatic retry, recorded failed with its code, and the next prompt says no-output", async () => {
    const x = await requirementHarness({ answers: [preSpawn("clarify", "<b>x</b>:y\n"), { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).calls.map((call) => [call.outcome, call.reason])).toEqual([["failed", "unknown"], ["valid", null]]);
      expect(x.round(1).retries).toBe(1);
      const second = x.fake.calls.accept[1]!;
      expect(second.work.kind === "single-call" && second.work.prompt).toContain("no-output");
    } finally { await x.dispose(); }
  });

  it("split: a pre-spawn refusal fails the draft at once, its call recorded failed with the code", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => preSpawn("split", "omp-single-call-unavailable")), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "failed");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "failed", autoRetry: 0, reasonCode: "split-output-invalid", calls: [{ outcome: "failed", reason: "omp-single-call-unavailable" }] });
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });
});
