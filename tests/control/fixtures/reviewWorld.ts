import { newRound, writeRound } from "../../../src/control/requirementRecords.js";
import { FIXTURE_SLOT } from "./requirement.js";
import { replenishStartWakes } from "../../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../../src/control/webDispatch.js";
import { reviewOf } from "../../../src/control/requirementReviewRecord.js";
import { readWebGroup } from "../../../src/control/webService.js";
import { driverHarness, type HarnessOptions } from "./driverHarness.js";
import { answerSingleCalls, type SingleCallAnswer, type SingleCallSeen } from "./singleCallAnswers.js";
import type { WebFixtureTask } from "./web.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
export const CRITERIA = [{ id: "AC1", text: "a.txt says hello" }, { id: "AC2", text: "b.txt says world" }];

/**
 * Tester follow-up G spec §3 test world: a confirmed group created from a requirement under follow-up G -- its body
 * carries a requirement block and the model marker, and its clarification's latest round names the acceptance criteria.
 * Each task lands its own file, so the group acceptance runs on its tip; the review's single calls are answered by
 * `answer` (fixtures/singleCallAnswers.ts). `requirement: false` leaves the block off; `followupG: false` strips the marker.
 */
export async function reviewWorld(options: { tasks?: WebFixtureTask[]; requirement?: boolean; followupG?: boolean; answer?: (call: SingleCallSeen) => SingleCallAnswer; harness?: HarnessOptions } = {}) {
  const t = await driverHarness(options.tasks ?? [{ taskId: "a" }, { taskId: "b" }], options.harness ?? {});
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, activeMs: limit.activeMs * 4, attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  t.h.store.transaction(() => {
    const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
    // The requirement block a split acceptance leaves on the group (requirementRecords.ts requirementBlockSchema).
    if (options.requirement !== false) body.requirement = {
      requirementId: "0123456789abcdef0123456789abcdef", repoId: "repo", slug: null, contentLanguage: "en", createdOn: "2026-11-12",
      idea: "Write a.txt and b.txt", profile: { profileId: "all", profileHash: "b".repeat(64) }, agentSlot: FIXTURE_SLOT, maxOutputTokens: 64_000,
      consensus: { roundNo: 1, at: "2026-11-12T00:00:00.000Z", openBranches: [], openQuestions: [] }, acceptedDraftNo: 1, document: null,
      export: { state: "done", path: "docs/requirements/x.md", commit: "c".repeat(40), parent: "d".repeat(40), detail: null },
    };
    if (options.followupG === false) delete body.modelVersion;
    t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
    writeRound(t.h.store, "g", { ...newRound(1), state: "answered", closedByConsensus: true,
      result: { slug: null, statement: "Two files say hello world.", acceptanceCriteria: CRITERIA, questions: [], frontierEmpty: true, openBranches: [], glossary: [], adrs: [] } });
  });
  const seen = answerSingleCalls(t, options.answer ?? (() => ({ outcome: "complete", output: allMet() })));
  const driver = t.driver();
  const review = () => reviewOf(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)));
  const groupStatus = () => String(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).status);
  /** Claims and runs every ready task, as the driver and the scheduler bridge would. */
  const runAll = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) {
      const ready = t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND json_extract(body,'$.status')='ready'").get();
      if (ready === undefined) return;
      // The first claim starts the group; a later one (a fix task appended to a running group) is armed as the driver arms it.
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      const runId = delivered.kind === "claimed" ? delivered.runId : await t.claim();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
    }
  };
  return { t, driver, calls: seen.calls, review, groupStatus, runAll };
}

export const allMet = () => ({ criteria: CRITERIA.map((c) => ({ id: c.id, verdict: "met", evidence: [{ path: c.id === "AC1" ? "a" : "b", line: 1 }], missing: null })), summary: "both files are there" });
export const verdicts = (v: Record<string, "met" | "not-met" | "cannot-judge">) => ({
  criteria: CRITERIA.map((c) => ({ id: c.id, verdict: v[c.id], evidence: v[c.id] === "cannot-judge" ? [] : [{ path: c.id === "AC1" ? "a" : "b", line: 1 }], missing: v[c.id] === "not-met" ? `${c.id} is not done` : null })),
  summary: "reviewed",
});
export type ReviewWorld = Awaited<ReturnType<typeof reviewWorld>>;
export type { Harness };
