import { randomUUID } from "node:crypto";
import { cp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archiveRun, readArtifact } from "../../src/control/archive.js";
import { archiveCase } from "./fixtures/archive.js";

// Tester #229: independent archives can publish the same base blobs under the same artifact ids.
// This exercises the publication boundary directly: three distinct run rows and independent source trees with identical
// repository contents share one artifact store. The driver itself serializes step E. No provider or production data is used.
describe("concurrent archive publication (#229)", () => {
  it("archives three distinct runs sharing base blobs in 20 concurrent rounds", async () => {
    const h = await archiveCase();
    try {
      const original = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(h.claim.runId)!;
      const runIds = [h.claim.runId, `run-${randomUUID()}`, `run-${randomUUID()}`];
      for (const runId of runIds.slice(1)) {
        const body = { ...JSON.parse(String(original.body)), runId };
        h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?, 'g1', ?, 1, 0, ?)")
          .run(runId, runId, JSON.stringify(body));
        await cp(h.sourceDir, join(h.root, "runs", runId), { recursive: true });
      }
      const sources = runIds.map((runId) => ({
        runId,
        sourceDir: join(h.root, "runs", runId),
        repoDir: join(h.root, "runs", runId, "repo"),
        stopProof: h.stopProof,
      }));
      const allRefs = new Map<string, string>();
      for (let round = 0; round < 20; round += 1) {
        const outcomes = await Promise.allSettled(sources.map((input) => archiveRun(h.store, input)));
        // Wait for every publisher before disposing the fixture even if one fails; a premature teardown hides the conflict.
        expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
        const archives = outcomes.map((outcome) => {
          if (outcome.status === "rejected") throw outcome.reason;
          return outcome.value;
        });
        expect(archives.map(({ missing, snapshot }) => ({ missing, hasSnapshot: snapshot !== null })))
          .toEqual(Array.from({ length: 3 }, () => ({ missing: [], hasSnapshot: true })));
        for (const archive of archives) for (const ref of archive.artifacts) {
          expect(await readArtifact(h.store, ref)).toBeInstanceOf(Buffer);
          const previous = allRefs.get(ref.artifactId);
          if (previous === undefined) allRefs.set(ref.artifactId, ref.hash);
          else expect(ref.hash).toBe(previous);
        }
      }
      expect(allRefs.size).toBeGreaterThan(3);
      // The table's primary key permits one hash per id, and every shared reference must resolve to that row.
      for (const [id, hash] of allRefs) {
        expect(h.store.db.prepare("SELECT hash FROM artifacts WHERE id=?").get(id)).toEqual({ hash });
      }
      expect(await readdir(join(h.store.stateDir, "staging"))).toEqual([]);
    } finally { await h.dispose(); }
  }, 120_000);
});
