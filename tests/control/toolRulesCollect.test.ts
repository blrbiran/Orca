import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { withinGrant } from "../../src/control/executionDriver.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { toolRulesReportSchema, toolRulesSchema, type ToolRulesReport } from "../../src/control/toolRules.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * ccloop per-contract tool rules spec 2026-10-22 §2, §5, §9 (flow engine spec §16.2): a contract may carry
 * `executionPolicy.toolRules`, and ccloop answers the run's tool-rule report at collect's top level. Orca's parses are
 * strict, so without these mirrors a contract with rules would be unrepresentable and every collect of such a run refused.
 * The rules are task identity: the contract hash covers them and the grant cut keeps them, or a run would be dispatched
 * with rules other than those confirmed. A violation is ccloop's cause `tool-rule-violated`, kept and worded like any other.
 */
const RULES = { commands: [{ kind: "exact" as const, value: "npm test" }, { kind: "prefix" as const, value: "node scripts/" }], network: false, secretEnv: ["WECHAT_TOKEN"] };
const REPORT: ToolRulesReport = {
  schema: "ccloop-tool-rules-report-v1", agentKind: "omp", baseline: "omp adds tools by its own settings",
  rules: [
    { rule: { kind: "commands-closed" }, status: "detected", reason: "omp runs a command before ccloop sees it", phases: ["execute"] },
    { rule: { kind: "exact", value: "npm test" }, status: "detected", reason: "seen in the stream", phases: ["execute"] },
    { rule: { kind: "network", value: false }, status: "recorded-only", reason: "omp cannot block network", phases: [] },
    { rule: { kind: "secretEnv", name: "WECHAT_TOKEN" }, status: "recorded-only", reason: "no environment filter", phases: [], present: false },
  ],
};
const CONTRACT = {
  objective: { taskId: "a", goal: "publish", successCondition: "drafted" },
  context: { repoPath: "/repo", targetPaths: ["out/**"], buildTestCommands: ["npm test"] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 1_000_000, totalRuntimeBudgetMs: 2_000_000, tokenBudget: 1000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 5_000 },
  safetyPolicy: { maxFilesTouched: 7 },
  verification: { verifierType: "agent", requiredChecks: ["npm test"], rejectOn: ["REJECT:x"] },
  escalationAndExit: {},
};
const withRules = (toolRules: unknown) => ({ ...CONTRACT, executionPolicy: { ...CONTRACT.executionPolicy, toolRules } });

describe("the contract's tool rules (ccloop spec §2)", () => {
  it("parses a contract with tool rules and keeps them exactly", () => {
    expect(taskContractSchema.parse(withRules(RULES)).executionPolicy.toolRules).toEqual(RULES);
    expect("toolRules" in taskContractSchema.parse(CONTRACT).executionPolicy).toBe(false);
  });
  it("refuses an extra key inside the rules", () => {
    expect(taskContractSchema.safeParse(withRules({ ...RULES, shell: "bash" })).success).toBe(false);
    expect(taskContractSchema.safeParse(withRules({ ...RULES, commands: [{ kind: "exact", value: "npm test", why: "x" }] })).success).toBe(false);
  });
  it("refuses rules with network missing: one rule set has exactly one spelling, so there is no default", () => {
    const { network: _network, ...noNetwork } = RULES;
    expect(taskContractSchema.safeParse(withRules(noNetwork)).success).toBe(false);
    expect(toolRulesSchema.safeParse({ commands: [], secretEnv: [] }).success).toBe(false);
  });
  it("refuses duplicate commands, duplicate or malformed secret names, NUL and over-long values", () => {
    expect(toolRulesSchema.safeParse({ ...RULES, commands: [RULES.commands[0], RULES.commands[0]] }).success).toBe(false);
    expect(toolRulesSchema.safeParse({ ...RULES, secretEnv: ["A", "A"] }).success).toBe(false);
    expect(toolRulesSchema.safeParse({ ...RULES, secretEnv: ["1A"] }).success).toBe(false);
    expect(toolRulesSchema.safeParse({ ...RULES, commands: [{ kind: "exact", value: "a\u0000b" }] }).success).toBe(false);
    expect(toolRulesSchema.safeParse({ ...RULES, commands: [{ kind: "exact", value: "é".repeat(2049) }] }).success).toBe(false);
    expect(toolRulesSchema.safeParse({ ...RULES, commands: [{ kind: "exact", value: "é".repeat(2048) }] }).success).toBe(true);
  });
  it("is covered by the contract hash: the same contract with and without rules hashes differently", () => {
    expect(sha256Canonical(taskContractSchema.parse(withRules(RULES)))).not.toBe(sha256Canonical(taskContractSchema.parse(CONTRACT)));
  });
  it("survives the grant cut, so the run is dispatched with the rules that were confirmed", () => {
    const policy = taskContractSchema.parse(withRules(RULES)).executionPolicy;
    expect(withinGrant(policy, { tokens: 10, activeMs: 10, attempts: 1 }).toolRules).toEqual(RULES);
  });
});

async function port(collectExtra: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-tool-rules-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), collectExtra }), { mode: 0o600 });
  const envelope: StartEnvelope = { protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "omp", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: withRules(RULES), targetRepo: root, base: "HEAD", sourceDir: root } } as StartEnvelope;
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope };
}

describe("collect's tool-rule report through the real port (ccloop spec §5)", () => {
  it("keeps a top-level report as the execution report's toolRules", async () => {
    const h = await port({ toolRules: REPORT });
    expect((await h.port.collect(h.envelope, 0)).toolRules).toEqual(REPORT);
  });
  it("states no toolRules key when ccloop answered none", async () => {
    const h = await port({});
    expect("toolRules" in (await h.port.collect(h.envelope, 0))).toBe(false);
  });
  it("refuses a report of the wrong shape", async () => {
    const bad = { ...REPORT, rules: [{ ...REPORT.rules[0], status: "enforcedish" }] };
    expect(toolRulesReportSchema.safeParse(bad).success).toBe(false);
    const h = await port({ toolRules: bad });
    await expect(h.port.collect(h.envelope, 0)).rejects.toThrow("control-response-invalid");
  });
});

describe("a tool-rule violation on the drive record and the run view (ccloop spec §4, §9)", () => {
  const CAUSE = { cause: "tool-rule-violated", phase: "execute" as const, retries: 0, detail: "curl https://example.invalid" };
  it("keeps the cause and the report on the drive record of a run blocked at C, and the run view names the cause", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", failure: () => ({ failureCause: CAUSE }), toolRules: () => REPORT }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", outcome: "failed", failureCause: CAUSE, toolRules: REPORT });
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === runId)).toMatchObject({ failureCause: CAUSE });
      expect((readGroupSummary(t.h.store, "g") as { card?: { firstFailure: unknown } }).card?.firstFailure).toEqual({ taskId: "a", cause: "tool-rule-violated" });
    } finally { await t.h.dispose(); }
  });
  it("stores no report when ccloop answered none", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", failure: () => ({ failureCause: CAUSE }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect("toolRules" in t.body(runId).drive).toBe(false);
    } finally { await t.h.dispose(); }
  });
});
