import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commitCandidate, repairAcceptedWork } from "../../src/control/checkpoints.js";
import { exportResumeBundle } from "../../src/control/resumeBundle.js";
import { writeArtifact } from "../../src/control/archive.js";
import { getRun, readWork } from "../../src/control/queries.js";
import { candidateCase } from "./fixtures/candidate.js";

/**
 * §6.3's correction: `recoverable` means "this checkpoint can be continued from", which an
 * interrupted run with a whole dirty snapshot satisfies. Whether the task finished is a separate
 * judgement, and these lines are what keeps the two from collapsing back into one boolean.
 */
describe("checkpoint recoverability is not task completion", { timeout: 30_000 }, () => {
  it("keeps an interrupted run with a whole snapshot continuable, and its work unfinished", async () => {
    const h = await candidateCase();
    try {
      await commitCandidate(h.store, { ...h.candidate, result: "partial" });
      expect(getRun(h.store, h.claim.runId).recoverable).toBe(true);
      expect(readWork(h.store, "g1", "T1").status).not.toBe("done");
    } finally {
      await h.dispose();
    }
  });

  it("hands that predecessor's own dirty snapshot to the continuation bundle", async () => {
    const h = await candidateCase();
    try {
      const committed = await commitCandidate(h.store, { ...h.candidate, result: "partial" });
      const input = await exportResumeBundle(h.store, { predecessorRunId: h.claim.runId, newSourceDir: join(h.root, "next") });
      expect(input.checkpointId).toBe(committed.checkpointId);
      const manifest = JSON.parse(await readFile(join(input.bundlePath, "resume-bundle.json"), "utf8"));
      expect(manifest.snapshot).toEqual(h.candidate.snapshot);
    } finally {
      await h.dispose();
    }
  });

  it("does not complete an interrupted task's work at commit time, acceptance or not", async () => {
    const h = await candidateCase();
    try {
      const acceptance = await writeArtifact(h.store, "acceptance-before-commit",
        Buffer.from(JSON.stringify({ runId: h.claim.runId, checksPassed: true, landing: "landed" })));
      h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)")
        .run(`acceptance:${h.claim.runId}`, JSON.stringify({ runId: h.claim.runId, accepted: true, source: acceptance }));
      await commitCandidate(h.store, { ...h.candidate, result: "partial" });
      expect(getRun(h.store, h.claim.runId).recoverable).toBe(true);
      expect(readWork(h.store, "g1", "T1").status).not.toBe("done");
    } finally {
      await h.dispose();
    }
  });

  it("refuses the bundle when the snapshot is gone, even though the run settled", async () => {
    const h = await candidateCase();
    try {
      await commitCandidate(h.store, { ...h.candidate, result: "partial", snapshot: null });
      expect(getRun(h.store, h.claim.runId).recoverable).toBe(false);
      await expect(exportResumeBundle(h.store, { predecessorRunId: h.claim.runId, newSourceDir: join(h.root, "next") }))
        .rejects.toThrow("resume-predecessor-unrecoverable");
    } finally {
      await h.dispose();
    }
  });

  // spec §9.4 names this fault ("marks a partial checkpoint recoverable"): a checkpoint that
  // reports evidence it could not capture is not continuable, whole snapshot or not.
  it("does not call a checkpoint with missing evidence continuable", async () => {
    const h = await candidateCase();
    try {
      await commitCandidate(h.store, { ...h.candidate, result: "partial", missing: ["submodule:vendor"] });
      expect(getRun(h.store, h.claim.runId).recoverable).toBe(false);
      await expect(exportResumeBundle(h.store, { predecessorRunId: h.claim.runId, newSourceDir: join(h.root, "next") }))
        .rejects.toThrow("resume-predecessor-unrecoverable");
    } finally {
      await h.dispose();
    }
  });

  it("does not let late acceptance finish a task that stopped short of its outcome", async () => {
    const h = await candidateCase();
    try {
      await commitCandidate(h.store, { ...h.candidate, result: "partial" });
      const acceptance = await writeArtifact(h.store, "late-acceptance-interrupted",
        Buffer.from(JSON.stringify({ runId: h.claim.runId, checksPassed: true, landing: "landed" })));
      h.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1)")
        .run(`acceptance:${h.claim.runId}`, JSON.stringify({ runId: h.claim.runId, accepted: true, source: acceptance }));
      await repairAcceptedWork(h.store, h.claim.runId);
      expect(readWork(h.store, "g1", "T1").status).not.toBe("done");
    } finally {
      await h.dispose();
    }
  });
});
