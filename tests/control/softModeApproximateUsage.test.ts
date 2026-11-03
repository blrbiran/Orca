import { describe, expect, it } from "vitest";
import { groupUsageUnknown } from "../../src/control/budget.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "../../src/control/requirementSchemas.js";
import type { Amount } from "../../src/control/types.js";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { readGroupSummary, readOverviewGroupSource, readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// Spec docs/superpowers/specs/2026-11-03-soft-mode-approximate-usage-design.md (human ruling, session 43913afc: 「同意。…」):
// in a group with no token limit, a call whose usage the tool did not report no longer stops the requirement until a person
// charges a million tokens for it. Orca books ccloop's observed floor (0 without one), marks the run approximate, and goes
// on as a known-usage completion goes on. A group with a finite token limit keeps today's block (singleCallUsageSettle).

const UNLIMITED = { ...REQUIREMENT_LIMIT_DEFAULT } as unknown as Amount;
const STALLED = { outcome: "failed" as const, output: null, tokens: null, errorCode: "omp-stalled" };
const ledgerTokens = (x: Awaited<ReturnType<typeof requirementHarness>>, runId: string): number =>
  Number(x.store.db.prepare("SELECT COALESCE(SUM(tokens),0) AS n FROM usage_ledger WHERE run_id=?").get(runId)!.n);

describe("unknown usage in a group with no token limit", () => {
  // mutation: drop the unlimited branch -> the run blocks with requirement-usage-unknown -> red
  // mutation: book the remaining grant instead of the floor -> used is 1,000,000 -> red
  // mutation: keep the reservation -> reserved stays at the grant -> red
  it("books ccloop's floor as approximate, keeps the flag clear, and the round's retry is claimed and answered with no person", async () => {
    const x = await requirementHarness({ limit: UNLIMITED, answers: [{ purpose: "clarify", ...STALLED, recordExtra: { usageLowerBound: { tokens: 1_234 } } }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const [first] = x.runs();
      expect(first).toMatchObject({ state: "settled-restartable", active: 0, unknown: { work: false, handoff: false }, cumulative: { work: { tokens: 1_234 } },
        usageApproximate: { floorTokens: 1_234, reason: "requirement-usage-unknown:omp-stalled" } });
      expect(first.drive).toMatchObject({ blockedAt: null, blockedReason: null });
      expect(ledgerTokens(x, first.runId)).toBe(1_234);
      expect(x.round(1).calls[0]).toMatchObject({ runId: first.runId, outcome: "failed", reason: "omp-stalled" });
      expect(x.fake.calls.accept).toHaveLength(2);
      expect(x.group()).toMatchObject({ used: { tokens: 1_234 + 777 }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
      expect(groupUsageUnknown(x.store, "r")).toBe(false);
    } finally { await x.dispose(); }
  });

  // mutation: book 0 as a plain 0 (no null floor) -> floorTokens 0 -> red
  it("with no floor at all, books nothing, says the floor is unknown, and still goes on", async () => {
    const x = await requirementHarness({ limit: UNLIMITED, answers: [{ purpose: "clarify", ...STALLED }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const [first] = x.runs();
      expect(first).toMatchObject({ unknown: { work: false }, usageApproximate: { floorTokens: null, reason: "requirement-usage-unknown:omp-stalled" } });
      expect(ledgerTokens(x, first.runId)).toBe(0);
      expect(x.group()).toMatchObject({ used: { tokens: 777 }, reserved: { tokens: 0 }, ledger: { usageUnknown: false } });
    } finally { await x.dispose(); }
  });

  // mutation: throw the answer away as a person's settlement does -> a second call is made -> red
  it("uses a complete answer whose usage was not reported: the round needs no second call", async () => {
    const x = await requirementHarness({ limit: UNLIMITED, answers: [{ purpose: "clarify", output: ROUND_ONE, tokens: null }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept).toHaveLength(1);
      expect(x.runs()[0]).toMatchObject({ usageApproximate: { floorTokens: null, reason: "requirement-usage-unknown" } });
    } finally { await x.dispose(); }
  });

  // mutation: leave usageApproximate out of the strict run schema -> the Overview names run-invalid -> red
  // mutation: count no approximate runs in the requirement view -> approximateRuns 0 -> red
  it("the read model parses an approximate run, and the requirement view counts it", async () => {
    const x = await requirementHarness({ limit: UNLIMITED, answers: [{ purpose: "clarify", ...STALLED, recordExtra: { usageLowerBound: { tokens: 1_234 } } }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(readGroupSummary(x.store, "r")).toMatchObject({ groupId: "r" });
      expect(readOverviewGroupSource(x.store, "r")?.summary).toMatchObject({ groupId: "r" });
      expect(JSON.stringify(readControlOverview(x.store, "epoch"))).not.toContain("run-invalid");
      expect(readRequirementView(x.store, "epoch", "r").ledger).toMatchObject({ approximateRuns: 1, usageUnknown: false, used: { tokens: 1_234 + 777 } });
    } finally { await x.dispose(); }
  });

  it("a group with a finite token limit still blocks the call for a person to settle", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", ...STALLED }] });
    try {
      await x.until(() => x.runs()[0]?.state === "blocked");
      expect(x.runs()[0]).toMatchObject({ drive: { blockedAt: "C", blockedReason: "requirement-usage-unknown:omp-stalled" }, unknown: { work: true } });
      expect(x.runs()[0].usageApproximate).toBeUndefined();
    } finally { await x.dispose(); }
  });
});
