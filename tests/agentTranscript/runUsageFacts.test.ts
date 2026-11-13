/**
 * Tester #285: during a codex execute `used` and `lastActivityAt` stayed frozen for minutes (codex reports usage only when
 * a phase ends, ccloop `usageObservation: "phase-end"`), so the run looked stuck and cheap. Orca cannot see live usage;
 * the group view now carries how the run's agent observes usage, when its figure was last booked and its split by kind,
 * the brief names the runs under way whose `used` lags, and the transcripts listing gives the newest write to a run's
 * transcript -- the one sign that a run between phase ends is still producing output.
 */
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectInto, readDriverRun, readStartEnvelope } from "../../src/control/executionDriver.js";
import type { TranscriptEntry } from "../../src/control/schema.js";
import { recordUsage } from "../../src/control/usage.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { serve } from "./http.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const entry = (over: Partial<TranscriptEntry> = {}): TranscriptEntry => ({ attempt: 1, phase: "plan", seq: 1, path: "codex/1/plan/call-a/transcript.jsonl", bytes: 10, final: false, truncatedAt: null, ...over });

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

/**
 * The run's agent as one that reports usage only when a phase ends (the harness's fake observes it live). Only the run's
 * body: the full view refuses a run whose frozen agent differs from its work item's and the snapshot's (I1), so the view
 * is read with the harness's own (realtime) agent and the brief, which reads the summary, with this one.
 */
const observeAtPhaseEnd = (t: Harness, runId: string, observation = "phase-end"): void => {
  t.h.store.db.prepare("UPDATE runs SET body=json_set(body,'$.agentCapabilities.usageObservation',?) WHERE id=?").run(observation, runId);
};

describe("a run's usage observation, booking time and split by kind (#285)", () => {
  it("the group view carries them, and the brief names a run under way whose used lags", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const web = await serve(t.h.store, "web");
    try {
      const runId = await acceptedRun(t);
      const groupId = readDriverRun(t.h.store, runId).groupId;
      const generation = t.body(runId).generation as number, next = (t.body(runId).highWater as number) + 1;
      const source = { artifactId: "usage-src", hash: "a".repeat(64) };
      const cumulative = (tokens: number) => ({ tokens, activeMs: 1, attempts: 1, sessions: 1 });
      const m = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number) => ({ model, input, output, cacheRead, cacheWrite });
      recordUsage(t.h.store, { runId, generation, eventSeq: next, bucket: "work", source, cumulative: cumulative(1_100), byModel: [m("gpt", 110, 5, 985, 0)] }, 5_000);
      recordUsage(t.h.store, { runId, generation, eventSeq: next + 1, bucket: "work", source, cumulative: cumulative(2_000), byModel: [m("gpt", 140, 20, 1_800, 40)] }, 9_000);
      const shown = readControlGroup(t.h.store, "epoch", groupId).runs.find((run) => run.runId === runId)!;
      // The run's frozen agent's observation, as written (the harness's fake declares realtime).
      // mutation: drop usageObservation from the run view -> red
      expect(shown.usageObservation).toBe("realtime");
      // mutation: usageBookedAt reads min(applied_at) -> 5000, red
      expect(shown.usageAt).toBe(9_000);
      // The newest event's cumulative split (not the sum of every event's): 140 + 20 + 1800 + 40 = 2000 = used.
      // mutation: usageBreakdownOf reads the oldest event -> red
      expect(shown.usageBreakdown).toEqual({ input: 140, output: 20, cacheRead: 1_800, cacheWrite: 40 });

      observeAtPhaseEnd(t, runId);
      // mutation: drop phaseEndUsage from the brief route -> red
      expect((await web.get(`/api/control/groups/${groupId}/brief`)).body.phaseEndUsage).toEqual({ runIds: [runId], asOf: 9_000 });
      // An agent that observes usage live: the brief says nothing.
      observeAtPhaseEnd(t, runId, "realtime");
      expect((await web.get(`/api/control/groups/${groupId}/brief`)).body).not.toHaveProperty("phaseEndUsage");
      // A run that has ended is not under way, whatever its agent.
      observeAtPhaseEnd(t, runId);
      t.h.store.db.prepare("UPDATE runs SET body=json_set(body,'$.endedAt',?) WHERE id=?").run(10_000, runId);
      // mutation: phaseEndUsageOf ignores endedAt -> red
      expect((await web.get(`/api/control/groups/${groupId}/brief`)).body).not.toHaveProperty("phaseEndUsage");
      // Tester #285 (follow-up J): nor is a run the driver blocked -- it waits on a person, its used is not a phase in progress.
      t.h.store.db.prepare("UPDATE runs SET body=json_remove(json_set(body,'$.state','blocked','$.drive.blockedAt','C'),'$.endedAt') WHERE id=?").run(runId);
      // mutation: runUnderWay ignores blocked -> red
      expect((await web.get(`/api/control/groups/${groupId}/brief`)).body).not.toHaveProperty("phaseEndUsage");
    } finally { await web.close(); await t.h.dispose(); }
  });

  it("the transcripts listing gives the newest write to the run's transcripts, and nothing when none is there", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const web = await serve(t.h.store, "web");
    try {
      answerTranscripts(t, () => [entry(), entry({ phase: "execute", path: "codex/1/execute/call-b/transcript.jsonl" })]);
      const runId = await acceptedRun(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      const sourceDir = readStartEnvelope(t.h.store, readDriverRun(t.h.store, runId)).work.sourceDir;
      const listed = async () => (await web.get(`/api/control/runs/${runId}/transcripts`)).body as { lastTranscriptAt?: number };
      // Nothing written yet: absent, not 0 or the epoch.
      expect(await listed()).not.toHaveProperty("lastTranscriptAt");
      const plan = join(sourceDir, "run", "codex", "1", "plan", "call-a"), execute = join(sourceDir, "run", "codex", "1", "execute", "call-b");
      mkdirSync(plan, { recursive: true }); mkdirSync(execute, { recursive: true });
      writeFileSync(join(plan, "transcript.jsonl"), "{}\n"); writeFileSync(join(execute, "transcript.jsonl"), "{}\n");
      const older = new Date(Date.UTC(2026, 10, 12, 2, 40, 0)), newer = new Date(Date.UTC(2026, 10, 12, 2, 49, 30));
      utimesSync(join(plan, "transcript.jsonl"), older, older);
      utimesSync(join(execute, "transcript.jsonl"), newer, newer);
      // mutation: keep the first entry's time instead of the newest -> red
      expect((await listed()).lastTranscriptAt).toBe(newer.getTime());
      rmSync(join(sourceDir, "run", "codex"), { recursive: true, force: true });
      expect(await listed()).not.toHaveProperty("lastTranscriptAt");
    } finally { await web.close(); await t.h.dispose(); }
  });
});
