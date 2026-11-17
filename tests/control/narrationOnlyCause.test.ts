// Tester #347: ccloop names an execute call that ended after one sentence ("I'll start by reading the handoff context..."),
// with no tool, command or file change and no answer, `narration-only` instead of `unknown`. Why it matters: Orca retried
// the task silently and the agent could open with the same sentence again. Here:
// - the cause is accepted and stored as ccloop states it, the group's first failure names it, and the ladder still
//   re-dispatches it (another try is the way on: it is not an exemption like auth or quota);
// - the re-dispatched run's envelope states what the previous attempt did, through the existing priorFailures evidence
//   (ccloop renders it into the plan and execute prompts as data from checks, not instructions; its schema is
//   unchanged), so it is one factual sentence with the byte count ccloop measured, and no imperative (review follow-up);
// - the two sibling causes (a final message that is not JSON, JSON of the wrong shape) carry no such sentence.
import { describe, expect, it } from "vitest";
import { narrationOnlyEvidence, priorFailureOf } from "../../src/control/priorFailures.js";
import { PRIOR_FAILURE_BOUNDS, priorFailureSchema } from "../../src/control/schema.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

const NARRATION = { cause: "narration-only", phase: "execute" as const, retries: 0,
  detail: "the call ended after a 98-byte final message that is not an execute answer; no tool, command or file change was observed" };

describe("priorFailureOf: what a narration-only run tells the next run (#347)", () => {
  // No lastFailure: the store is not read.
  const store = {} as never;

  it("names the cause and states what the previous attempt did, with ccloop's byte count", async () => {
    const entry = await priorFailureOf(store, { runId: "run-1", drive: { failureCause: NARRATION } as never });
    // mutation N1 (no narration-only branch in priorFailureOf) -> evidence null, red here.
    expect(entry).toEqual({ runId: "run-1", rejectCategory: "run-failed:narration-only", failingCommand: null, failureCause: "narration-only",
      evidence: ["The previous attempt ended its turn after a 98-byte message that was not the answer, and no tool use, command or file change was observed."] });
    expect(priorFailureSchema.safeParse(entry).success).toBe(true);
  });

  it("is one factual sentence in every form ccloop's detail takes, never an instruction", () => {
    const forms = [
      narrationOnlyEvidence(NARRATION.detail),
      narrationOnlyEvidence("the call ended without a final answer; no tool, command or file change was observed"),
      narrationOnlyEvidence(null),
      narrationOnlyEvidence("a detail in some other form"),
    ];
    // mutation N5 (the byte count not taken from the detail) -> red here.
    expect(forms[0]).toContain("98-byte message");
    expect(forms[1]).toBe("The previous attempt ended its turn without a final message, and no tool use, command or file change was observed.");
    expect(forms[2]).toBe("The previous attempt ended its turn after a message that was not the answer, and no tool use, command or file change was observed.");
    expect(forms[3]).toBe(forms[2]);
    for (const sentence of forms) {
      expect(sentence.match(/\./g)).toHaveLength(1); // one sentence
      expect(sentence).not.toMatch(/\b(must|should|do the task|make the changes|run the checks|this attempt)\b/i);
      expect(Buffer.byteLength(sentence, "utf8")).toBeLessThanOrEqual(PRIOR_FAILURE_BOUNDS.evidenceEntry);
    }
  });

  it("adds nothing for the other execute-answer causes", async () => {
    for (const cause of ["execution-not-json", "execution-shape", "unknown"]) {
      const entry = await priorFailureOf(store, { runId: "run-1", drive: { failureCause: { ...NARRATION, cause } } as never });
      // mutation N2 (the hint added for every execute-phase cause) -> red here.
      expect(entry.evidence).toBeNull();
    }
  });
});

describe("a narration-only run, collected and re-dispatched (#347)", { timeout: 180_000 }, () => {
  it("is stored as narration-only, named as the group's first failure, and the next run's envelope carries the hint", async () => {
    let failing = true;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => (failing ? "failed" : "succeed"), failure: () => ({ failureCause: NARRATION }) });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const driver = t.driver();
      const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "blocked", 120);
      expect(t.body(first).drive.failureCause).toEqual(NARRATION);
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "narration-only" });
      // Not exempt from the ladder: Orca retries it, as it retried the `unknown` it used to be.
      expect((await service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      failing = false;
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
      await t.until(driver, () => t.body(delivered.runId).drive?.prepared === true, 120);
      const work = (JSON.parse(readCanonicalRecord(t.h.store, t.body(delivered.runId).drive.envelopeHash)) as { work: Record<string, unknown> }).work;
      // mutation N1 -> evidence null, red here.
      expect(work.priorFailures).toEqual([
        { runId: first, rejectCategory: "run-failed:narration-only", failingCommand: null, evidence: [narrationOnlyEvidence(NARRATION.detail)], failureCause: "narration-only" },
      ]);
    } finally { await t.h.dispose(); }
  });
});
