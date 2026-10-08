/**
 * Issue fixes spec §4.2(5): which runs get "Retry task", which reason a run shows, and the task's run number (the count
 * of its lineage runs that reached the provider, i.e. not failed-before-provider).
 */
import { describe, expect, it } from "vitest";
import type { Amount, GroupViewV1, RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { isTerminalFailure, reasonCode, runReasonText, taskRunNumber } from "../src/runFacts.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const item = (over: Partial<WorkItemViewV1>): WorkItemViewV1 => ({
  taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const viewOf = (workItems: WorkItemViewV1[], runs: RunViewV1[]): GroupViewV1 => ({ workItems, runs } as unknown as GroupViewV1);

describe("run facts (spec §4.2(5))", () => {
  it("calls a run a terminal failure only when it is blocked with an outcome other than succeeded", () => {
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed" }))).toBe(true);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "Error: codex-skills-cleanup-failed:EACCES", outcome: "failed" }))).toBe(true);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded" }))).toBe(false);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "control-peer-timeout", outcome: null }))).toBe(false);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "control-peer-timeout" }))).toBe(false);
    expect(isTerminalFailure(run({ state: "settled-failed", outcome: "failed" }))).toBe(false);
  });

  it("reads ccloop's reason code through the Error: prefix its phase errors carry", () => {
    expect(reasonCode("Error: codex-result-invalid: /runs/x")).toBe("codex-result-invalid: /runs/x");
    expect(reasonCode("terminal:failed")).toBe("terminal:failed");
  });

  it("shows ccloop's reason for a failed or settled-failed run, else the blocked reason, else nothing", () => {
    expect(runReasonText(run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /x" }))).toBe("Error: codex-result-invalid: /x");
    expect(runReasonText(run({ state: "blocked", blockedReason: "terminal:exhausted", outcome: "exhausted", stopReason: null }))).toBe("terminal:exhausted");
    expect(runReasonText(run({ state: "settled-failed", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-event-error" }))).toBe("Error: codex-event-error");
    expect(runReasonText(run({ state: "blocked", blockedReason: "reconcile-budget", outcome: "succeeded", stopReason: null }))).toBe("reconcile-budget");
    expect(runReasonText(run({ state: "running" }))).toBe(null);
  });

  it("numbers a task's runs by those of its lineage that reached the provider", () => {
    const runs = [run({ runId: "r1", state: "settled-failed" }), run({ runId: "r2", state: "failed-before-provider" }), run({ runId: "r3", state: "starting" }), run({ runId: "rb", taskId: "b" })];
    expect(taskRunNumber(viewOf([item({ lineageRunIds: ["r1", "r2", "r3"] }), item({ taskId: "b", lineageRunIds: ["rb"] })], runs), "a")).toBe(2);
    expect(taskRunNumber(viewOf([item({ lineageRunIds: [] })], []), "a")).toBe(0);
  });
});
