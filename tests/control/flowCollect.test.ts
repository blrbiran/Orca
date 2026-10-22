import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { reportedFlowOf } from "../../src/control/reportedDecisions.js";

/**
 * ccloop spec 2026-10-22-flow-answer-key-design.md §4 item 7, §8 (pinned at fbd3512): collect answers what a flow
 * step's agent reported under `flow` at the top level, opaquely, after `debug`. Orca's collect parse is strict, so
 * without this mirror every collect of a run that reported `flow` would be refused, and the flow engine's child port
 * (which reads `flow` from the saved report) would never see `needs`, `candidates` or an effect's remote id.
 */
const FLOW = { needs: { kind: "confirmation", what: "upload the draft", payloadSummary: "one article" }, candidates: { title: { items: ["A", "B"], recommended: 1 } }, effect: { remoteId: "media-1" } };

async function port(protocol: 3 | 4, collectExtra: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-flow-collect-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), collectExtra, ...(protocol === 4 ? { features: { protocol: 1, tokenPolicy: "optional-v1" } } : {}) }), { mode: 0o600 });
  const envelope = { protocol, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "claude", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: {}, targetRepo: root, base: "HEAD", sourceDir: root } } as unknown as StartEnvelope;
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope };
}

describe("collect's top-level flow (ccloop flow-answer-key spec §4 item 7)", () => {
  for (const protocol of [3, 4] as const) {
    it(`protocol ${protocol}: keeps the reported flow as given on the execution report, where the child port reads it`, async () => {
      const h = await port(protocol, { flow: FLOW });
      const report = await h.port.collect(h.envelope, 0);
      expect(report.flow).toEqual(FLOW);
      // The child port reads the saved report through reportedFlowOf: the collected value is Orca's shape.
      expect(reportedFlowOf(report)).toEqual({ kind: "object", value: FLOW });
    });
    it(`protocol ${protocol}: states no flow key when ccloop answered none`, async () => {
      const h = await port(protocol, {});
      expect("flow" in (await h.port.collect(h.envelope, 0))).toBe(false);
    });
  }
  it("keeps a flow Orca's reader refuses, opaquely: the reader, not collect, calls it malformed", async () => {
    const h = await port(3, { flow: "not an object" });
    const report = await h.port.collect(h.envelope, 0);
    expect(report.flow).toBe("not an object");
    expect(reportedFlowOf(report)).toEqual({ kind: "malformed", value: "not an object" });
  });
});
