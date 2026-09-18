import type { ChainRecord } from "../../src/chain/recordSchema.js";

export function recordFixture(over: Partial<ChainRecord> = {}): ChainRecord {
  return {
    v: 1,
    chainId: "chain-0000000a",
    repo: "/r",
    startedBy: { via: "cli", by: "tester" },
    goal: "a goal",
    limits: { maxSessions: 3, maxCostUsd: 5, sessionTimeoutMin: 360 },
    model: "claude-opus-5[1m]",
    startedAt: "2026-09-18T00:00:00.000Z",
    startHead: "a".repeat(40),
    branch: "main",
    supervisorPid: 4242,
    sessions: [],
    state: "running",
    stop: null,
    ...over,
  };
}
