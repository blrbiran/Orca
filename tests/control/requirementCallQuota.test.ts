import { describe, expect, it } from "vitest";
import { readDraft, readDrafts } from "../../src/control/requirementRecords.js";
import { draftBodySchema, roundBodySchema } from "../../src/control/requirementSchemas.js";
import { requirementSummaryOf } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";

/**
 * Dogfood finding (1) (session 3ba26002): in `dogfood-20261119-count` (codex) every clarify call failed because the codex
 * account's usage limit was used up -- ccloop's single-call record said so (`failureCause: { cause: "quota", detail:
 * "You've hit your usage limit ... try again at Nov 23rd, 2026 7:13 AM." }`) -- and Orca spent the round's two
 * automatic retries on it before ending `clarify-call-failed`. A call that ended on ccloop's typed `quota` cause is not
 * retried: its round or draft ends at once as `requirement-agent-quota`, the call keeps the cause, and the summary (the
 * brief, the Web, the overview's problem) names the reset the CLI's own text gives and the next step.
 */
const DETAIL = "You've hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 23rd, 2026 7:13 AM.";
const quota = (purpose: "clarify" | "split") =>
  ({ purpose, output: null, outcome: "failed" as const, tokens: 0, errorCode: "codex-exit-error", recordExtra: { failureCause: { cause: "quota", detail: DETAIL } } });
// The reset the detail names, in the machine's local time (the CLI prints local time; quotaRest.ts parseResetAt).
const RESET_AT = new Date(2026, 10, 23, 7, 13).getTime();

describe("a requirement call that ended on an exhausted quota (dogfood finding 1)", () => {
  it("clarify: the round fails after the one call, as requirement-agent-quota, and the call keeps the cause and the detail", async () => {
    const x = await requirementHarness({ answers: [quota("clarify"), quota("clarify"), quota("clarify")] });
    try {
      await x.until(() => x.round(1).state === "failed");
      // mutation: drop the quota branch in recordClarify -> three calls, clarify-call-failed -> red
      expect(x.round(1)).toMatchObject({ state: "failed", retries: 0, reasonCode: "requirement-agent-quota" });
      expect(x.round(1).calls).toHaveLength(1);
      // mutation: drop `cause` from the quota call record -> red
      expect(x.round(1).calls[0]).toMatchObject({ outcome: "failed", reason: "codex-exit-error", detail: DETAIL, cause: "quota", resetAt: RESET_AT });
      const summary = requirementSummaryOf(x.store, "r");
      expect(summary.reasonCode).toBe("requirement-agent-quota");
      // mutation: drop agentQuota from the summary -> red
      expect(summary.agentQuota).toEqual({ detail: DETAIL, resetAt: RESET_AT,
        next: `the agent's usage quota ran out (it resets at ${new Date(RESET_AT).toISOString()}): switch the requirement's agent with orca requirement set-agent r --agent <agent> --model <model>, then orca recovery retry --group r; or wait for the reset and run orca recovery retry --group r` });
    } finally { await x.dispose(); }
  });

  it("split: the draft fails after the one call, with no automatic re-draft", async () => {
    const x = await requirementHarness({ answers: [quota("split"), quota("split"), quota("split")], startAt: "split" });
    const state = () => { try { return readDraft(x.store, "r", 1).state; } catch { return "drafting"; } };
    try {
      await x.until(() => state() === "failed");
      // mutation: drop the quota branch in recordSplit -> draft 1 invalid, drafts 2 and 3 drafted -> red
      expect(readDrafts(x.store, "r").map((draft) => [draft.draftNo, draft.state, draft.reasonCode])).toEqual([[1, "failed", "requirement-agent-quota"]]);
      expect(readDraft(x.store, "r", 1).calls).toHaveLength(1);
      expect(readDraft(x.store, "r", 1).calls[0]).toMatchObject({ cause: "quota", detail: DETAIL, resetAt: RESET_AT });
      expect(requirementSummaryOf(x.store, "r").agentQuota?.resetAt).toBe(RESET_AT);
    } finally { await x.dispose(); }
  });

  it("a quota failure whose text names no reset says so with a null reset, and the next step has no time", async () => {
    const x = await requirementHarness({ answers: [{ ...quota("clarify"), recordExtra: { failureCause: { cause: "quota", detail: "usage limit reached" } } }] });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(x.round(1).calls[0]).not.toHaveProperty("resetAt");
      expect(requirementSummaryOf(x.store, "r").agentQuota).toEqual({ detail: "usage limit reached", resetAt: null,
        next: "the agent's usage quota ran out: switch the requirement's agent with orca requirement set-agent r --agent <agent> --model <model>, then orca recovery retry --group r; or wait for the reset and run orca recovery retry --group r" });
    } finally { await x.dispose(); }
  });

  it("the stored round and draft accept the quota code; a call record accepts only the quota cause", () => {
    expect(roundBodySchema.shape.reasonCode.safeParse("requirement-agent-quota").success).toBe(true);
    expect(draftBodySchema.shape.reasonCode.safeParse("requirement-agent-quota").success).toBe(true);
    const call = { runId: "run-1", overviewHash: null, commit: null, usage: null, outcome: "failed", reason: "codex-exit-error" };
    expect(roundBodySchema.shape.calls.element.safeParse({ ...call, cause: "quota", resetAt: RESET_AT }).success).toBe(true);
    expect(roundBodySchema.shape.calls.element.safeParse({ ...call, cause: "transient" }).success).toBe(false);
  });
});
