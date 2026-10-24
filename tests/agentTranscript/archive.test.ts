/**
 * T6 (spec §10.2.5, §10.4.1 "Source"): after cleanup a transcript is served from the run's archive by ranged reads --
 * one streaming hash check, then reads by range -- and never through `readArtifact`, which reads the whole file into
 * memory (archive.ts). A file removed between polls switches to the archive on the next request; with neither source
 * the answer is `transcript-gone`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as archive from "../../src/control/archive.js";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { cleanupCommittedRun } from "../../src/control/cleanup.js";
import { noteTranscriptListing } from "../../src/agentTranscript/listing.js";
import type { TranscriptEntry } from "../../src/control/schema.js";
import { candidateCase } from "../control/fixtures/candidate.js";
import { claude, jsonl } from "./fixtures.js";
import { serve } from "./http.js";

vi.mock("../../src/control/archive.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/control/archive.js")>();
  return { ...real, readArtifact: vi.fn(real.readArtifact) };
});

const PATH = "claude/1/plan/call-a/transcript.jsonl";
const entries: TranscriptEntry[] = [
  { attempt: 1, phase: "plan", seq: 1, path: PATH, bytes: 1, final: true, truncatedAt: null },
  { attempt: 1, phase: "plan", seq: 2, path: "claude/1/plan/call-z/transcript.jsonl", bytes: 1, final: true, truncatedAt: null },
];
const lines = Array.from({ length: 300 }, (_, i) => claude.text(`archived line ${i}`));

describe("T6: the archive source", () => {
  it("serves from the run directory, then -- after cleanup -- from the archive by ranged reads, never through readArtifact", async () => {
    const h = await candidateCase(async (world) => {
      await mkdir(join(world.sourceDir, "run", "claude", "1", "plan", "call-a"), { recursive: true });
      await writeFile(join(world.sourceDir, "run", PATH), jsonl(lines), { mode: 0o600 });
    });
    const web = await serve(h.store, "web");
    try {
      const runId = h.claim.runId;
      h.store.transaction(() => noteTranscriptListing(h.store, runId, h.sourceDir, entries));
      const before = await web.get(`/api/control/runs/${runId}/transcripts/1/plan/1?tail=1`);
      expect(before.status).toBe(200);
      expect(before.body.source).toBe("run");
      expect(before.body.events.at(-1).fields.text.text).toBe("archived line 299");

      await commitCandidate(h.store, h.candidate);
      const acceptance = await archive.writeArtifact(h.store, "acceptance", Buffer.from(JSON.stringify({ runId, checksPassed: true, landing: "landed" })));
      h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)").run("acceptance:" + runId, JSON.stringify({ runId, accepted: true, source: acceptance }));
      expect(await cleanupCommittedRun(h.store, runId, h.sourceDir)).toEqual({ removed: true });
      const readArtifact = vi.mocked(archive.readArtifact);
      readArtifact.mockClear();

      // The file removed between polls: the next request switches to the archive.
      const tail = await web.get(`/api/control/runs/${runId}/transcripts/1/plan/1?tail=1`);
      expect(tail.status).toBe(200);
      expect(tail.body.source).toBe("archive");
      expect(tail.body.final).toBe(true);
      expect(tail.body.events).toHaveLength(200);
      expect(tail.body.events.at(-1).fields.text.text).toBe("archived line 299");
      const earlier = await web.get(`/api/control/runs/${runId}/transcripts/1/plan/1?before=${tail.body.start}`);
      expect(earlier.body.events[0].fields.text.text).toBe("archived line 0");
      const expand = await web.get(`/api/control/runs/${runId}/transcripts/1/plan/1/expand?at=0&i=0&field=text`);
      expect(expand).toMatchObject({ status: 200, body: { text: "archived line 0", page: 0, pages: 1 } });

      // The transcript itself is never read whole: readArtifact saw at most the manifest, never the transcript's ref.
      const transcriptRef = `sha256-${(await import("node:crypto")).createHash("sha256").update(jsonl(lines)).digest("hex")}`;
      expect(readArtifact.mock.calls.length).toBeGreaterThan(0);
      for (const [, ref] of readArtifact.mock.calls) expect(ref.artifactId).not.toBe(transcriptRef);
      expect(readArtifact.mock.calls.every(([, ref]) => ref.artifactId.startsWith("archive-"))).toBe(true);

      // Neither source: a listed call whose file never existed and was never archived.
      expect(await web.get(`/api/control/runs/${runId}/transcripts/1/plan/2?tail=1`)).toMatchObject({ status: 404, body: { error: { code: "transcript-gone" } } });
    } finally { await web.close(); await h.dispose(); }
  });
});
