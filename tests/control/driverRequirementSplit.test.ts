import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readDraft, readRequirementGroup, readRound, writeDraft, writeRound } from "../../src/control/requirementRecords.js";
import { SPLIT_JSON_SCHEMA } from "../../src/control/requirementSplit.js";
import { singleCallHandler } from "../../src/control/singleCallPurposes.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { INVALID_SPLIT, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// N1 spec §8 and H7: a draft is one single call; an invalid one is handed back automatically, at most twice.
describe("the split purpose on the single-call chain (N1 spec §8)", () => {
  it("brings a valid draft to awaiting-review with its expanded plan, its hash and its layers", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      // PR-B2: the split state carries round 1's slug, as a real round 1 leaves it.
      expect(readRequirementGroup(x.store, "r").requirement.slug).toBe("markdown-export");
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      expect(draft).toMatchObject({ state: "awaiting-review", output: VALID_SPLIT, reasons: [], layers: [["exporter"], ["images"]], reasonCode: null });
      expect(draft.plan).toMatchObject({ workBranch: "orca/r", targetRepo: x.repo });
      expect(draft.draftHash).toBe(sha256Canonical(draft.plan));
      const sent = x.fake.calls.accept[0]!;
      expect(sent).toMatchObject({ claim: { workItemId: "draft-1" }, work: { kind: "single-call", responseSchema: SPLIT_JSON_SCHEMA, maxOutputTokens: 64_000 } });
      expect(sent.work.kind === "single-call" && sent.work.prompt).toContain("<<<ORCA-DATA requirement-document ");
      expect(x.group()).toMatchObject({ used: { tokens: 777 }, reserved: { tokens: 0 } });
    } finally { await x.dispose(); }
  });

  it("hands an invalid draft back, drafts the next one with the reasons in its prompt, and accepts a valid one", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: INVALID_SPLIT }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review" || readDraft(x.store, "r", 2).state === "failed");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", reasons: ["path:exporter:missing/dir/x.ts"] });
      expect(readDraft(x.store, "r", 2)).toMatchObject({ state: "awaiting-review", autoRetry: 1 });
      const second = x.fake.calls.accept[1]!;
      expect(second.work.kind === "single-call" && second.work.prompt).toContain("path:exporter:missing/dir/x.ts");
    } finally { await x.dispose(); }
  });

  it("fails the third consecutive invalid draft as split-validation-exhausted, and a schema-invalid one as split-output-invalid", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => ({ purpose: "split" as const, output: INVALID_SPLIT })), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 3).state === "failed");
      expect(readDraft(x.store, "r", 3)).toMatchObject({ state: "failed", autoRetry: 2, reasonCode: "split-validation-exhausted", reasons: ["path:exporter:missing/dir/x.ts"] });
    } finally { await x.dispose(); }
    const y = await requirementHarness({ answers: [1, 2, 3].map(() => ({ purpose: "split" as const, output: { tasks: [] } })), startAt: "split" });
    try {
      await y.until(() => readDraft(y.store, "r", 3).state === "failed");
      expect(readDraft(y.store, "r", 3)).toMatchObject({ state: "failed", reasonCode: "split-output-invalid" });
    } finally { await y.dispose(); }
  });

  // Task 6 ruling: a provider failure with no output is an invalid output, and uses one of the two automatic retries.
  it("hands back a call that failed with no output as one of the two retries", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: null, outcome: "failed" }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 2).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", output: null, calls: [{ outcome: "invalid" }] });
      expect(readDraft(x.store, "r", 2)).toMatchObject({ state: "awaiting-review", autoRetry: 1 });
    } finally { await x.dispose(); }
  });

  it("a run whose draft left drafting after its claim is blocked at A2 as requirement-call-target-moved, and never sent", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.deliver();
      expect(x.runs()).toEqual([expect.objectContaining({ state: "starting", workItemId: "draft-1" })]);
      writeDraft(x.store, "r", { ...readDraft(x.store, "r", 1), state: "interrupted" });
      await x.until(() => x.runs()[0]!.state === "blocked");
      expect(x.runs()[0]).toMatchObject({ drive: { blockedAt: "A2", blockedReason: "requirement-call-target-moved" } });
      expect(x.fake.calls.accept).toHaveLength(0);
    } finally { await x.dispose(); }
  });

  it("a draft that left drafting while its call ran is not overwritten: the run is blocked at C as requirement-draft-moved", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => x.runs()[0]?.state === "accepted");
      writeDraft(x.store, "r", { ...readDraft(x.store, "r", 1), state: "interrupted" });
      await x.until(() => x.runs()[0]!.state === "blocked");
      expect(x.runs()[0]).toMatchObject({ drive: { blockedAt: "C", blockedReason: expect.stringContaining("requirement-draft-moved") } });
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "interrupted", output: null, calls: [] });
    } finally { await x.dispose(); }
  });

  it("refuses to judge an output whose run names no overview (A2 stores one before every call)", async () => {
    const x = await requirementHarness({ answers: [], startAt: "split" });
    try {
      await expect(singleCallHandler("split").evaluate!(x.deps, { runId: "run-x", groupId: "r", workItemId: "draft-1" }, VALID_SPLIT))
        .rejects.toMatchObject({ code: "recovery-blocked", detail: "requirement-overview-missing" });
    } finally { await x.dispose(); }
  });

  it("refuses to judge an output when no round holds an understanding to split (consensus needs one, DR10)", async () => {
    const x = await requirementHarness({ answers: [], startAt: "split" });
    try {
      writeRound(x.store, "r", { ...readRound(x.store, "r", 1), result: null });
      await expect(singleCallHandler("split").evaluate!(x.deps, { runId: "run-x", groupId: "r", workItemId: "draft-1", overview: { hash: "a".repeat(64), commit: x.head() } }, VALID_SPLIT))
        .rejects.toMatchObject({ code: "recovery-blocked", detail: "requirement-understanding-missing" });
    } finally { await x.dispose(); }
  });
});
