import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readStartEnvelope, stepA1, stepA2, stepB, stepC } from "../../src/control/executionDriver.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Memory in runs spec 2026-11-20 §3–§4: A2 produces one bundle from ccmem and freezes it into the envelope; a ccmem
 * failure is recorded on the drive and never stops the dispatch; collect's echo is kept as the dispatch proof. Every
 * path here is a temp ccmem script (Rule 17); nothing reads the person's ccmem.
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fakeCcmem(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "orca-memory-envelope-"));
  roots.push(root);
  const bin = join(root, "ccmem.mjs");
  writeFileSync(bin, `#!/usr/bin/env node\n${source}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const exportOne = fakeCcmem(`
const scope = process.argv[process.argv.indexOf("--scope") + 1];
process.stdout.write(JSON.stringify({ version: "0.7", exported_at: 1, memories: [{
  id: 42, scope, project_key: scope === "project" ? "github.com/acme/x" : null, type: "rule",
  content: "run with the project's conventions", pinned: 0, source: "user_explicit", trust_score: 0.9,
  tags: null, created_at: 1, updated_at: 1
}] }));
`);
const failing = fakeCcmem("process.stderr.write('nope'); process.exit(3);");

async function prepared(memoryBin: string | null) {
  const t = await driverHarness([{ taskId: "a" }], { memory: true });
  if (memoryBin !== null) t.deps.memory = { ccmemBin: memoryBin, env: process.env };
  const runId = await t.claim();
  expect(stepA1(t.deps, runId)).toBe(true);
  expect(await stepA2(t.deps, runId)).toBe(true);
  return { t, runId };
}

describe("the run's memory bundle in the envelope (#417/#418)", () => {
  it("freezes the bundle, records it, and keeps collect's echo as the dispatch proof", async () => {
    const { t, runId } = await prepared(exportOne);
    try {
      const envelope = readStartEnvelope(t.h.store, t.body(runId));
      if (envelope.work.kind !== "loop") throw new Error("loop work expected");
      // mutation (send `memory: null`) -> the envelope body carries a null key, red on this and the absent case.
      expect(envelope.work.memory?.ids).toEqual([42]);
      expect(envelope.work.memory?.text).toContain("run with the project's conventions");
      expect(t.body(runId).drive.memory).toEqual({ sha256: envelope.work.memory!.sha256, ids: [42], tokens: envelope.work.memory!.tokens });
      expect(await stepB(t.deps, runId)).toBe(true);
      expect(await stepC(t.deps, runId)).toBe(true);
      // mutation (drop noteMemoryReport) -> memoryReport is absent, red.
      expect(t.body(runId).drive.memoryReport).toEqual({ sha256: envelope.work.memory!.sha256, ids: [42], tokens: envelope.work.memory!.tokens });
    } finally { await t.h.dispose(); }
  });

  it("records a ccmem failure and dispatches without memory", async () => {
    const { t, runId } = await prepared(failing);
    try {
      const envelope = readStartEnvelope(t.h.store, t.body(runId));
      if (envelope.work.kind !== "loop") throw new Error("loop work expected");
      expect(envelope.work.memory).toBeUndefined();
      // mutation (throw from produceMemoryBundle) -> A2 does not complete, red.
      expect(t.body(runId).drive.memory).toEqual({ error: expect.stringMatching(/^ccmem-failed:/) });
    } finally { await t.h.dispose(); }
  });

  it("keeps the envelope byte-identical when no ccmem is configured", async () => {
    const { t, runId } = await prepared(null);
    try {
      const envelope = readStartEnvelope(t.h.store, t.body(runId));
      if (envelope.work.kind !== "loop") throw new Error("loop work expected");
      // mutation (emit `memory: null` unconditionally) -> this key exists, red.
      expect("memory" in envelope.work).toBe(false);
      expect(t.body(runId).drive.memory).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});