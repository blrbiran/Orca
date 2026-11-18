import { describe, it, expect, vi } from "vitest";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openTestStore } from "./fixtures/store.js";

/**
 * Tester #364 (a) (plan 2026-11-18 tester batch D, D1): an artifact publication copies its bytes into `staging/` first. A
 * publication that failed before its temp file was renamed into place left that file behind for ever; with a run whose
 * archive fails the same way every round, that is one leaked copy per round. Every failed publication now removes it.
 */

// The stream copy archiveFile makes: the real pipeline runs (the temp file exists, partly or wholly written), then fails.
const pipelineFault = vi.hoisted(() => ({ armed: false }));
vi.mock("node:stream/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:stream/promises")>();
  return { ...real, pipeline: async (...args: unknown[]) => {
    await (real.pipeline as (...a: unknown[]) => Promise<void>)(...args);
    if (pipelineFault.armed) throw Object.assign(new Error("read failed mid-copy"), { code: "EIO" });
  } };
});

const { archiveFile, writeArtifact } = await import("../../src/control/archive.js");

const stagingEntries = async (stateDir: string): Promise<string[]> => {
  try { return await readdir(join(stateDir, "staging")); } catch { return []; }
};

describe("archive temp files never outlive a failed publication (#364 a)", () => {
  it("a failing pipeline in archiveFile leaves no file in staging/", async () => {
    const h = await openTestStore();
    try {
      const source = join(h.root, "source.txt");
      await writeFile(source, "bytes\n");
      pipelineFault.armed = true;
      await expect(archiveFile(h.store, source)).rejects.toThrow("read failed mid-copy");
      expect(await stagingEntries(h.store.stateDir)).toEqual([]);
    } finally { pipelineFault.armed = false; await h.dispose(); }
  });

  it("a publication that fails before its rename (archiveFile, writeArtifact) leaves no file in staging/", async () => {
    const h = await openTestStore();
    try {
      const source = join(h.root, "source.txt");
      await writeFile(source, "bytes\n");
      const syncFile = async () => { throw Object.assign(new Error("fsync failed"), { code: "EIO" }); };
      await expect(archiveFile(h.store, source, { syncFile })).rejects.toThrow("fsync failed");
      await expect(writeArtifact(h.store, "artifact-1", Buffer.from("x"), { syncFile })).rejects.toThrow("fsync failed");
      expect(await stagingEntries(h.store.stateDir)).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a publication that succeeds still publishes and leaves staging/ empty", async () => {
    const h = await openTestStore();
    try {
      const source = join(h.root, "source.txt");
      await writeFile(source, "bytes\n");
      const ref = await archiveFile(h.store, source);
      expect(ref.artifactId).toMatch(/^sha256-/);
      expect(await stagingEntries(h.store.stateDir)).toEqual([]);
    } finally { await h.dispose(); }
  });
});
