import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stepA1, stepA2, stepB, stepC } from "../../src/control/executionDriver.js";
import { drainMemoryOutcomes, outcomePayloadOf, type RunCcmem } from "../../src/memory/outcomeOutbox.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

/**
 * Run-outcome writeback spec 2026-11-21 §3. The outbox queues only a run whose collect echoed `memory`, freezes the
 * payload on first sight, and never lets a ccmem failure touch the run. Every ccmem here is injected (Rule 17).
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const NOW = Date.UTC(2026, 10, 21, 12);

function fakeCcmem(): string {
  const root = mkdtempSync(join(tmpdir(), "orca-outbox-"));
  roots.push(root);
  const bin = join(root, "ccmem.mjs");
  writeFileSync(bin, `#!/usr/bin/env node
const scope = process.argv[process.argv.indexOf("--scope") + 1];
process.stdout.write(JSON.stringify({ version: "0.7", exported_at: 1, memories: [{
  id: 42, scope, project_key: scope === "project" ? "github.com/acme/x" : null, type: "rule",
  content: "run with the project's conventions", pinned: 0, source: "user_explicit", trust_score: 0.9,
  tags: null, created_at: 1, updated_at: 1
}] }));
`);
  chmodSync(bin, 0o755);
  return bin;
}

async function collected() {
  const t = await driverHarness([{ taskId: "a" }], { memory: true });
  t.deps.memory = { ccmemBin: fakeCcmem(), env: process.env };
  const runId = await t.claim();
  for (const step of [stepA1, stepA2, stepB, stepC]) expect(await step(t.deps, runId)).toBe(true);
  return { t, runId };
}

describe("the run-outcome outbox (#418)", () => {
  it("queues nothing without the collect echo, and freezes the payload when it has one", async () => {
    const { t, runId } = await collected();
    try {
      const run = t.body(runId);
      expect(outcomePayloadOf({ ...run, state: "settled" }, NOW)).toMatchObject({ runId, taskId: "a", outcome: "succeeded", abandoned: false, memoryIds: [42], observedAt: NOW });
      // mutation (queue on drive.memory alone) -> a run with no memoryReport still gets a payload, red.
      expect(outcomePayloadOf({ ...run, state: "settled", drive: { ...run.drive, memoryReport: undefined } }, NOW)).toBeNull();
      expect(outcomePayloadOf({ ...run, state: "accepted" }, NOW)).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("sends one frozen payload and marks the row sent", async () => {
    const { t, runId } = await collected();
    try {
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), state: "settled" }), runId);
      const calls: Array<{ args: string[]; input: string; cwd: string }> = [];
      const runCcmem: RunCcmem = async (args, input, cwd) => { calls.push({ args, input: input ?? "", cwd }); return { code: 0, stdout: '{"version":1,"state":"recorded","projectKey":"x"}', stderr: "" }; };
      expect(await drainMemoryOutcomes(t.deps, { ccmemBin: "/fake", env: {} }, NOW, { runCcmem, probe: async () => true })).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args).toEqual(["orca-outcome", "upsert"]);
      expect(JSON.parse(calls[0]!.input)).toMatchObject({ version: 1, runId, taskId: "a", outcome: "succeeded", abandoned: false, memoryIds: [42], observedAt: NOW });
      expect(t.body(runId).drive.memoryFeedback.state).toBe("sent");
      // mutation (send without checking the row) -> a second drain sends again, red.
      expect(await drainMemoryOutcomes(t.deps, { ccmemBin: "/fake", env: {} }, NOW + 1, { runCcmem, probe: async () => true })).toBe(0);
      expect(calls).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("marks a refused payload refused and does not retry it", async () => {
    const t = await driverHarness([{ taskId: "a" }], { memory: true });
    try {
      t.deps.memory = { ccmemBin: fakeCcmem(), env: process.env };
      const runId = await t.claim();
      for (const step of [stepA1, stepA2, stepB, stepC]) expect(await step(t.deps, runId)).toBe(true);
      // Move it to a terminal state with an outcome, as step E would after landing.
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), state: "settled" }), runId);
      const calls: string[] = [];
      const runCcmem: RunCcmem = async (_args, input) => { calls.push(input ?? ""); return { code: 64, stdout: '{"version":1,"state":"refused","projectKey":"x"}', stderr: "" }; };
      expect(await drainMemoryOutcomes(t.deps, { ccmemBin: "/fake", env: {} }, NOW, { runCcmem, probe: async () => true })).toBe(1);
      expect(t.body(runId).drive.memoryFeedback).toMatchObject({ state: "refused", attempts: 0 });
      expect(calls).toHaveLength(1);
      // mutation (retry a 64) -> a second drain sends again, red.
      expect(await drainMemoryOutcomes(t.deps, { ccmemBin: "/fake", env: {} }, NOW + 1, { runCcmem, probe: async () => true })).toBe(0);
      expect(calls).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("records unsupported once when the ccmem binary has no such verb", async () => {
    const t = await driverHarness([{ taskId: "a" }], { memory: true });
    try {
      t.deps.memory = { ccmemBin: fakeCcmem(), env: process.env };
      const runId = await t.claim();
      for (const step of [stepA1, stepA2, stepB, stepC]) expect(await step(t.deps, runId)).toBe(true);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), state: "settled" }), runId);
      let spawned = 0;
      const runCcmem: RunCcmem = async () => { spawned += 1; return { code: 1, stdout: "", stderr: "nope" }; };
      expect(await drainMemoryOutcomes(t.deps, { ccmemBin: "/fake", env: {} }, NOW, { runCcmem, probe: async () => false })).toBe(1);
      // mutation (a payload 64 disables the feature) -> this state would be unsupported only after a send, red elsewhere.
      expect(t.body(runId).drive.memoryFeedback.state).toBe("unsupported");
      expect(spawned).toBe(0);
    } finally { await t.h.dispose(); }
  });
});