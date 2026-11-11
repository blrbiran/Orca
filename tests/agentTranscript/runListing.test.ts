/**
 * T13 (spec §12.3, §12.4 C8): the transcripts listing of a run of a group no flow started is stored at collect, and
 * `GET /api/control/runs/:runId/transcripts` serves it -- to an owner and a member on the Web, never to a run Orca
 * dispatched (on either listener) -- without any `path`. Plan D1: a live call's growth alone does not move the
 * group's projection; a change of `final` does, once.
 */
import { describe, expect, it } from "vitest";
import { collectInto, readDriverRun, readStartEnvelope } from "../../src/control/executionDriver.js";
import { isFlowChildGroup } from "../../src/flow/groups.js";
import { readControlGroup, readGroupSummaryFromSnapshot } from "../../src/panel/controlViews.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import type { TranscriptEntry } from "../../src/control/schema.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { serve } from "./http.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const entry = (over: Partial<TranscriptEntry> = {}): TranscriptEntry => ({ attempt: 1, phase: "plan", seq: 1, path: "claude/1/plan/call-a/transcript.jsonl", bytes: 10, final: false, truncatedAt: null, ...over });

function answerTranscripts(t: Harness, next: () => TranscriptEntry[] | undefined): void {
  const router = t.deps.router;
  t.deps.router = {
    ...router,
    resolve(workKind, profileId, expectedHash) {
      const profile = router.resolve(workKind, profileId, expectedHash);
      const collect = profile.port.collect.bind(profile.port);
      return { ...profile, port: { ...profile.port, async collect(envelope, afterSeq) {
        const report = await collect(envelope, afterSeq);
        const transcripts = next();
        return transcripts === undefined ? report : { ...report, transcripts };
      } } };
    },
  };
}

async function acceptedRun(t: Harness): Promise<string> {
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "accepted");
  return runId;
}

describe("T13: the listing of every collected run is stored and served", () => {
  it("a run of a group no flow started has its listing stored at collect, with the run's source directory", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      let answer: TranscriptEntry[] | undefined = [entry(), entry({ phase: "execute", path: null, bytes: 0, final: true })];
      answerTranscripts(t, () => answer);
      const runId = await acceptedRun(t);
      const run = readDriverRun(t.h.store, runId);
      expect(isFlowChildGroup(t.h.store, run.groupId)).toBe(false);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(t.body(runId).transcripts).toEqual({ sourceDir: readStartEnvelope(t.h.store, run).work.sourceDir, entries: answer });

      // D1: the growth of a live call alone is not a change of the run body.
      const settled = readProjectionState(t.h.store).changeSeq;
      answer = [entry({ bytes: 5000 }), answer[1]!];
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(readProjectionState(t.h.store).changeSeq).toBe(settled);
      answer = [entry({ bytes: 6000, final: true }), answer[1]!];
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(readProjectionState(t.h.store).changeSeq).toBe(settled + 1);
      expect(t.body(runId).transcripts.entries[0]).toEqual(entry({ bytes: 6000, final: true }));

      // A collect that lists nothing keeps the last listing.
      answer = undefined;
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(t.body(runId).transcripts.entries).toHaveLength(2);

      // D1's run-body key is admitted by the panel's stored-run schema: the group view still reads the run.
      expect(() => readGroupSummaryFromSnapshot(t.h.store, run.groupId)).not.toThrow();
    } finally { await t.h.dispose(); }
  });

  it("GET …/transcripts serves the rows (no path) to an owner and a member on the Web; a dispatched run is refused on either listener", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const web = await serve(t.h.store, "web"), socket = await serve(t.h.store, "socket"), old = await serve(t.h.store, "web", null);
    try {
      answerTranscripts(t, () => [entry(), entry({ attempt: 2, phase: "execute", seq: 1, path: null, bytes: 0, final: true })]);
      const runId = await acceptedRun(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      for (const who of ["owner", "member"] as const) {
        const answer = await web.get(`/api/control/runs/${runId}/transcripts`, who);
        expect(answer.status).toBe(200);
        expect(answer.body).toEqual({
          schema: "orca-run-transcripts-v1", runId, available: true,
          calls: [
            { attempt: 1, phase: "plan", seq: 1, runtime: "claude", recorded: true, bytes: 10, final: false, truncatedAt: null },
            { attempt: 2, phase: "execute", seq: 1, runtime: null, recorded: false, bytes: 0, final: true, truncatedAt: null },
          ],
        });
        expect(JSON.stringify(answer.body)).not.toContain("transcript.jsonl");
        expect(JSON.stringify(answer.body)).not.toContain("path");
      }
      expect(await web.get(`/api/control/runs/${runId}/transcripts`, "dispatched")).toMatchObject({ status: 403, body: { error: { code: "control-dispatched-run-refused" } } });
      expect(await socket.get(`/api/control/runs/${runId}/transcripts`, "dispatched")).toMatchObject({ status: 403, body: { error: { code: "control-dispatched-run-refused" } } });
      expect(await web.get(`/api/control/runs/run-of-another-store/transcripts`)).toMatchObject({ status: 404, body: { error: { code: "run-not-found" } } });
      // §10.2.4: a ccloop without features.transcripts -- the page says why, nothing is served.
      expect(await old.get(`/api/control/runs/${runId}/transcripts`)).toEqual({ status: 200, body: { schema: "orca-run-transcripts-v1", runId, available: false, reason: "ccloop-transcripts-unsupported", calls: [] } });
      expect(await old.get(`/api/control/runs/${runId}/transcripts/1/plan/1?tail=1`)).toMatchObject({ status: 422, body: { error: { code: "transcript-unsupported" } } });
    } finally { await web.close(); await socket.close(); await old.close(); await t.h.dispose(); }
  });
});

// Tester #252 (spec 2026-11-11-tester-followup-e §6): ccloop lists an attempt's phases by name (execute, plan, verify), so
// the Web showed execute above plan, and the Live region's follow -- the last recorded call of the listing -- sat on plan
// while execute ran. Orca serves the listing by attempt, then phase rank (plan, execute, verify, then other phases by
// name), then seq, so `orca run transcript` and the Web read one order.
describe("tester #252: the listing is served in run order", () => {
  it("orders by attempt, then plan, execute, verify, other phases by name, then seq -- whatever order ccloop stored", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const web = await serve(t.h.store, "web"), socket = await serve(t.h.store, "socket");
    try {
      // The order ccloop's collect answers in: attempts numeric, phases by name, calls by start.
      answerTranscripts(t, () => [
        entry({ attempt: 1, phase: "execute", seq: 1, final: false }),
        entry({ attempt: 1, phase: "plan", seq: 1, final: true }),
        entry({ attempt: 1, phase: "verify", seq: 1, path: null, bytes: 0 }),
        entry({ attempt: 2, phase: "execute", seq: 2 }),
        entry({ attempt: 2, phase: "execute", seq: 1 }),
        entry({ attempt: 2, phase: "repair", seq: 1 }),
        entry({ attempt: 2, phase: "plan", seq: 1 }),
        entry({ attempt: 2, phase: "fix", seq: 1 }),
      ]);
      const runId = await acceptedRun(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      const order = (body: unknown): string[] => (body as { calls: Array<{ attempt: number; phase: string; seq: number }> }).calls.map((c) => `${c.attempt}/${c.phase}/${c.seq}`);
      const expected = ["1/plan/1", "1/execute/1", "1/verify/1", "2/plan/1", "2/execute/1", "2/execute/2", "2/fix/1", "2/repair/1"];
      // mutation: serve the stored order -> execute is listed above plan -> red
      // mutation: drop the phase rank (phases by name) -> execute above plan -> red
      // mutation: drop the seq tie-break -> 2/execute/2 above 2/execute/1 -> red
      expect(order((await web.get(`/api/control/runs/${runId}/transcripts`, "owner")).body)).toEqual(expected);
      // The CLI reads the same handler on the socket.
      expect(order((await socket.get(`/api/control/runs/${runId}/transcripts`)).body)).toEqual(expected);
      // What the Live region follows (web/src/AgentTranscript.tsx: the last recorded call of the listing) is the running
      // execute of the first attempt, not the finished plan.
      const firstAttempt = ((await web.get(`/api/control/runs/${runId}/transcripts`, "owner")).body as { calls: Array<{ attempt: number; phase: string; recorded: boolean; final: boolean }> }).calls.filter((c) => c.attempt === 1);
      expect(firstAttempt.filter((c) => c.recorded).at(-1)).toMatchObject({ phase: "execute", final: false });
    } finally { await web.close(); await socket.close(); await t.h.dispose(); }
  });
});

describe("tester #116: a loop run's observed usage floor", () => {
  it("is kept beside the run from collect, shown by the run view, and an unchanged floor does not move the projection", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      let floor: { tokens: number } | undefined = { tokens: 533_486 };
      const router = t.deps.router;
      t.deps.router = { ...router, resolve(workKind, profileId, expectedHash) {
        const profile = router.resolve(workKind, profileId, expectedHash);
        const collect = profile.port.collect.bind(profile.port);
        return { ...profile, port: { ...profile.port, async collect(envelope, afterSeq) {
          const report = await collect(envelope, afterSeq);
          return floor === undefined ? report : { ...report, usageLowerBound: floor };
        } } };
      } };
      const runId = await acceptedRun(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(t.body(runId).usageLowerBound).toEqual({ tokens: 533_486 });
      const group = readDriverRun(t.h.store, runId).groupId;
      expect(readControlGroup(t.h.store, "epoch", group).runs.find((run) => run.runId === runId)!.usageLowerBound).toBe(533_486);

      const settled = readProjectionState(t.h.store).changeSeq;
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(readProjectionState(t.h.store).changeSeq).toBe(settled);
      floor = undefined;
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(t.body(runId).usageLowerBound).toEqual({ tokens: 533_486 });
    } finally { await t.h.dispose(); }
  });
});

describe("T13: the scheduler bridge's collect stores the listing too", () => {
  it("collectControlled keeps the listing on the run body", async () => {
    const { archiveCase } = await import("../control/fixtures/archive.js");
    const { ControlService } = await import("../../src/control/service.js");
    const { collectControlled } = await import("../../src/control/schedulerBridge.js");
    const { readRun } = await import("../../src/control/budget.js");
    const h = await archiveCase();
    try {
      const port = { collect: async () => ({ events: [], candidate: null, terminal: null, transcripts: [entry()] }), readEvidence: async () => Buffer.alloc(0) };
      const service = new ControlService(h.store, port as never);
      await collectControlled(service, h.claim.runId, port as never);
      expect((readRun(h.store, h.claim.runId) as unknown as { transcripts: unknown }).transcripts).toEqual({ sourceDir: h.sourceDir, entries: [entry()] });
    } finally { await h.dispose(); }
  });
});
