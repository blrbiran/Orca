// Tester follow-up G spec §2.1 (plan Part B, O2): the port speaks ccloop's live ceiling (ccloop
// docs/superpowers/specs/2026-11-12-live-ceiling-design.md) -- `live-ceiling` sends {input, ceiling} and answers
// {revision, tokens}; a refusal is ccloop's named exit, read by peerErrorCode; collect hands the top-level
// `liveCeilingStop` on, and the strict protocol-4 parser still refuses an unknown top-level key.
import { chmod, copyFile, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort, peerErrorCode } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

const TERMINAL = { status: "exhausted", currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-11-12T00:00:00Z", waitingOnHuman: false, stopReason: "live token ceiling reached",
  budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 100, tokenBudgetRemaining: null, tokenRemainingStatus: "unlimited" }, recentFailures: [] };
const STOP = { revision: 2, tokens: 5000, cause: "group", observedTokens: 5300, phase: "execute", at: "mid-call" };

async function fixture(extra: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-live-ceiling-port-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const record = join(root, "record.json"), table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record, features: { protocol: 1, tokenPolicy: "optional-v1" }, ...extra }), { mode: 0o600 });
  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 });
  const envelope: StartEnvelope = { protocol: 4, tokenPolicy: { authoredTokenCeiling: null, bindingCauses: ["group"], inheritedUsage: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
    liveCeiling: { protocol: 1, revision: 1, tokens: 4000, cause: "group" },
    claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" },
      grant: { work: { tokens: null, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" },
    contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship" }, targetRepo: root, base: "HEAD", sourceDir: root } };
  return { port, envelope, record };
}

describe("the port and ccloop's live ceiling (spec §2.1)", () => {
  it("setLiveCeiling sends the accepted envelope and the ceiling, and answers its revision", async () => {
    const h = await fixture({});
    expect(await h.port.setLiveCeiling!(h.envelope, { protocol: 1, revision: 2, tokens: 5000, cause: "group" })).toEqual({ revision: 2, tokens: 5000 });
    const sent = JSON.parse(String(JSON.parse(await readFile(h.record, "utf8")).stdin));
    expect(JSON.parse(await readFile(h.record, "utf8")).argv.slice(0, 2)).toEqual(["control", "live-ceiling"]);
    expect(sent).toEqual({ input: h.envelope, ceiling: { protocol: 1, revision: 2, tokens: 5000, cause: "group" } });
  });

  it("a stale revision is ccloop's named refusal, readable by its code", async () => {
    const h = await fixture({ refuse: "control-live-ceiling-stale" });
    const error = await h.port.setLiveCeiling!(h.envelope, { protocol: 1, revision: 1, tokens: 5000, cause: "group" }).then(() => null, (e: unknown) => e);
    expect(peerErrorCode(error)).toBe("control-live-ceiling-stale");
  });

  it("collect parses a top-level liveCeilingStop and hands it on", async () => {
    const h = await fixture({ terminal: TERMINAL, collectExtra: { liveCeilingStop: STOP } });
    const report = await h.port.collect(h.envelope, 0);
    expect(report.liveCeilingStop).toEqual(STOP);
    expect(report.terminal).toMatchObject({ outcome: "exhausted", stopReason: "live token ceiling reached" });
  });

  it("a collect without it has no key, and a malformed one refuses the answer", async () => {
    const h = await fixture({ terminal: TERMINAL });
    expect(await h.port.collect(h.envelope, 0)).not.toHaveProperty("liveCeilingStop");
    const bad = await fixture({ terminal: TERMINAL, collectExtra: { liveCeilingStop: { ...STOP, at: "later" } } });
    await expect(bad.port.collect(bad.envelope, 0)).rejects.toThrow();
  });
});
