/**
 * Tester #252, second half (spec 2026-11-12-tester-followup-f §6): the transcript listing showed calls by attempt, then
 * phase rank, then seq, with no time per call, so a re-plan after an execute read as if it came before it. A ccloop that
 * records a call's spawn time lists it as `startedAt`; Orca's strict collect parse must accept it (and still refuse a
 * malformed one), keep serving a listing without it (the ccloop Orca is pinned to today has none), order an attempt's calls
 * by it when every call of that attempt carries one, and fall back to today's order otherwise -- a partial order mixed
 * with the phase rank would put an untimed call anywhere.
 */
import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { collectInto, readDriverRun } from "../../src/control/executionDriver.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import type { TranscriptEntry } from "../../src/control/schema.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { serve } from "./http.js";

const ENTRY = { attempt: 1, phase: "execute", seq: 1, path: "claude/1/execute/call-a1/transcript.jsonl", bytes: 12, final: false, truncatedAt: null };

async function fakeCcloop(transcripts: unknown) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-transcript-started-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), collectExtra: { transcripts } }), { mode: 0o600 });
  const envelope: StartEnvelope = { protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship" }, targetRepo: root, base: "HEAD", sourceDir: root } };
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope };
}

describe("tester #252: collect's listing may carry a call's startedAt", () => {
  // mutation: drop `startedAt` from transcriptEntrySchema -> the strict entry refuses the newer listing, red
  it("accepts and hands on a listing with startedAt, and one without (the pinned ccloop's)", async () => {
    const timed = [{ ...ENTRY, startedAt: "2026-10-24T01:00:05.000Z" }, { ...ENTRY, seq: 2 }];
    const withIt = await fakeCcloop(timed);
    expect((await withIt.port.collect(withIt.envelope, 0)).transcripts).toEqual(timed);
    const without = await fakeCcloop([ENTRY]);
    const listed = (await without.port.collect(without.envelope, 0)).transcripts!;
    expect(listed).toEqual([ENTRY]);
    expect(Object.hasOwn(listed[0]!, "startedAt")).toBe(false);
  });

  // mutation: startedAt as z.string() -> ps's raw lstart text is accepted, red
  it("refuses a startedAt that is not an ISO-8601 time", async () => {
    for (const startedAt of ["Fri Oct 24 01:00:00 2026", "", 1_761_267_600_000, null]) {
      const h = await fakeCcloop([{ ...ENTRY, startedAt }]);
      await expect(h.port.collect(h.envelope, 0), JSON.stringify(startedAt)).rejects.toThrow("control-response-invalid");
    }
  });
});

describe("tester #252: the listing is served in start order within a fully timed attempt", () => {
  const entry = (attempt: number, phase: string, seq: number, startedAt?: string): TranscriptEntry =>
    ({ attempt, phase, seq, path: `codex/${attempt}/${phase}/call-${phase}${seq}/transcript.jsonl`, bytes: 3, final: true, truncatedAt: null, ...(startedAt === undefined ? {} : { startedAt }) });

  it("orders by startedAt when every call of the attempt has one, else by phase rank; rows carry the time only when known", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const web = await serve(t.h.store, "web"), socket = await serve(t.h.store, "socket");
    try {
      // The order ccloop answers in: attempts numeric, phases by name, calls by start within a phase.
      const listing = [
        entry(1, "execute", 1, "2026-10-24T01:00:05.000Z"),
        entry(1, "plan", 1, "2026-10-24T01:00:00.000Z"),
        entry(1, "plan", 2, "2026-10-24T01:00:10.000Z"),
        entry(1, "verify", 1, "2026-10-24T01:00:20.000Z"),
        // Attempt 2: the first plan never registered a process (no startedAt), so the attempt keeps the phase-rank order.
        entry(2, "execute", 1, "2026-10-24T02:00:10.000Z"),
        entry(2, "plan", 1),
        entry(2, "plan", 2, "2026-10-24T02:00:20.000Z"),
        // Attempt 3: two calls in one second (ps lstart's resolution) -- the phase rank breaks the tie.
        entry(3, "execute", 1, "2026-10-24T03:00:00.000Z"),
        entry(3, "plan", 1, "2026-10-24T03:00:00.000Z"),
      ];
      const router = t.deps.router;
      t.deps.router = { ...router, resolve(workKind, profileId, expectedHash) {
        const profile = router.resolve(workKind, profileId, expectedHash);
        const collect = profile.port.collect.bind(profile.port);
        return { ...profile, port: { ...profile.port, async collect(envelope, afterSeq) { return { ...await collect(envelope, afterSeq), transcripts: listing }; } } };
      } };
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      type Row = { attempt: number; phase: string; seq: number; startedAt?: string };
      const order = (body: unknown): string[] => (body as { calls: Row[] }).calls.map((c) => `${c.attempt}/${c.phase}/${c.seq}`);
      const expected = [
        // mutation: ignore startedAt (today's order) -> 1/plan/2 above 1/execute/1, red
        "1/plan/1", "1/execute/1", "1/plan/2", "1/verify/1",
        // mutation: order an attempt by time when any call has one, missing first -> 2/execute/1 above 2/plan/2, red
        // mutation: the same with missing last -> 2/plan/1 listed last, red
        "2/plan/1", "2/plan/2", "2/execute/1",
        // mutation: break a same-second tie by phase name or by the stored order -> execute above plan, red
        "3/plan/1", "3/execute/1",
      ];
      const answer = await web.get(`/api/control/runs/${runId}/transcripts`, "owner");
      expect(order(answer.body)).toEqual(expected);
      // The CLI reads the same handler on the socket.
      expect(order((await socket.get(`/api/control/runs/${runId}/transcripts`)).body)).toEqual(expected);
      // mutation: drop the startedAt pass-through in the route -> no row carries it, red
      const calls = (answer.body as { calls: Row[] }).calls;
      expect(calls.find((c) => c.attempt === 1 && c.phase === "plan" && c.seq === 2)).toMatchObject({ startedAt: "2026-10-24T01:00:10.000Z" });
      // mutation: serve `startedAt: entry.startedAt ?? null` for an untimed call -> the key is present, red
      expect(Object.hasOwn(calls.find((c) => c.attempt === 2 && c.phase === "plan" && c.seq === 1)!, "startedAt")).toBe(false);
    } finally { await web.close(); await socket.close(); await t.h.dispose(); }
  });
});
