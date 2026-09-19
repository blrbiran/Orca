import { lstat, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { exportResumeBundle } from "../../src/control/resumeBundle.js";
import { candidateCase } from "./fixtures/candidate.js";

describe("immutable continuation bundle", { timeout: 30_000 }, () => {
  it("exports a committed recoverable checkpoint and every nested artifact as private regular files", async () => {
    const h = await candidateCase();
    try {
      const committed = await commitCandidate(h.store, h.candidate);
      const sourceDir = join(h.root, "next-run");
      const input = await exportResumeBundle(h.store, { predecessorRunId: h.claim.runId, newSourceDir: sourceDir });

      expect(input).toEqual({
        predecessorRunId: h.claim.runId,
        checkpointId: committed.checkpointId,
        checkpointHash: committed.hash,
        bundlePath: join(await realpath(sourceDir), "input", committed.checkpointId),
      });
      const manifest = JSON.parse(await readFile(join(input.bundlePath, "resume-bundle.json"), "utf8"));
      expect(manifest).toMatchObject({
        protocol: 1,
        predecessorRunId: h.claim.runId,
        checkpointId: committed.checkpointId,
        checkpointHash: committed.hash,
        snapshot: h.candidate.snapshot,
        unfinished: ["follow-up"],
        pendingDecisions: ["choose"],
        awaitingHuman: ["approve"],
      });
      expect(manifest.artifacts.length).toBeGreaterThan(h.candidate.artifacts.length);
      for (const relative of ["resume-bundle.json", ...manifest.artifacts.map((entry: { file: string }) => entry.file)]) {
        const stat = await lstat(join(input.bundlePath, relative));
        expect(stat.isFile()).toBe(true);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.mode & 0o777).toBe(0o600);
      }
    } finally {
      await h.dispose();
    }
  });

  it("refuses an unsettled predecessor and a committed partial checkpoint", async () => {
    const unsettled = await candidateCase();
    try {
      await expect(exportResumeBundle(unsettled.store, { predecessorRunId: unsettled.claim.runId, newSourceDir: join(unsettled.root, "next") }))
        .rejects.toThrow("resume-predecessor-unrecoverable");
    } finally {
      await unsettled.dispose();
    }

    const partial = await candidateCase();
    try {
      await commitCandidate(partial.store, { ...partial.candidate, result: "partial", stopProof: null });
      await expect(exportResumeBundle(partial.store, { predecessorRunId: partial.claim.runId, newSourceDir: join(partial.root, "next") }))
        .rejects.toThrow("resume-predecessor-unrecoverable");
    } finally {
      await partial.dispose();
    }
  });

  it("refuses a damaged or missing nested artifact instead of exporting a partial bundle", async () => {
    for (const damage of ["bad-hash", "missing"] as const) {
      const h = await candidateCase();
      try {
        await commitCandidate(h.store, h.candidate);
        const nested = h.candidate.artifacts[0]!;
        const path = join(h.store.stateDir, "artifacts", nested.artifactId, "data");
        if (damage === "bad-hash") await writeFile(path, "tampered");
        else h.store.db.prepare("DELETE FROM artifacts WHERE id=?").run(nested.artifactId);
        await expect(exportResumeBundle(h.store, { predecessorRunId: h.claim.runId, newSourceDir: join(h.root, "next") }))
          .rejects.toThrow(damage === "bad-hash" ? "artifact-hash-mismatch" : "artifact-not-found");
      } finally {
        await h.dispose();
      }
    }
  });

  it("refuses a symlinked destination component", async () => {
    const h = await candidateCase();
    try {
      await commitCandidate(h.store, h.candidate);
      const sourceDir = join(h.root, "next");
      const outside = join(h.root, "outside");
      await mkdir(sourceDir, { mode: 0o700 });
      await mkdir(outside, { mode: 0o700 });
      await symlink(outside, join(sourceDir, "input"));
      await expect(exportResumeBundle(h.store, { predecessorRunId: h.claim.runId, newSourceDir: sourceDir }))
        .rejects.toThrow("control-path-symlink");
    } finally {
      await h.dispose();
    }
  });
});
