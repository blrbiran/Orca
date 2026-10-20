import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { createTrustedControlConfig, type TrustedControlConfigInput } from "../../src/panel/controlConfig.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { ControlError } from "../../src/control/errors.js";
import { readSchedulerControlPlanSource } from "../../src/scheduler/planFile.js";

/**
 * In-repo plan path spec 2026-10-21 §2.2-§2.3 (#65): plans registered at runtime join the trusted config with the digest
 * the person registered, and import refuses any other bytes by name. The fixture below is controlConfigRepositories'.
 */

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const hash = (value: string) => value.repeat(64);

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): profile v2 (spec §6.5): no adapter identity fields;
// the declared capabilities these criteria depend on are the same.
const snapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v2",
  profile: {
    profileId: "estimator", allowedWorkKinds: ["budget-estimate"], contextTokenizer: null, workMaxOutputTokens: null,
    capabilities: {
      usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
      handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
    },
    estimatorPreflight: null,
  },
  resolved: { proofDocumentContentHashes: [hash("c")], tokenizerArtifactHashes: [], secretValueHashes: [] },
});

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-control-port-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const plan = join(repo, "ship.json");
  await writeFile(plan, "{}", { mode: 0o600 });
  const binary = join(root, "ccloop");
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  const agentsTable = join(root, "agents.json");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(binary, 0o700);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  await writeFile(agentsTable, "{}", { mode: 0o600 });
  const router = (port: ExecutionPort) => createExecutionProfileRouter([resolveProfile(snapshot(), port)]);
  const base = (over: Partial<TrustedControlConfigInput> = {}): TrustedControlConfigInput => ({
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
    epoch: "epoch-1", stateDir: root, executablePath: binary, agentsTablePath: agentsTable,
    executionPort: "configured", archiveRoot: root, exportRoot: root, evidenceRoot: root, shutdownGraceMs: 30_000,
    repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
    plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: plan }],
    defaultEstimatorProfileId: "estimator", defaultEstimateMode: "soft",
    ...over,
  });
  // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): the mock now
  // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
  // carries, so the peer's raw answer stays schema-valid.
  const capablePort = {
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities protocol 3.
    // Single-call estimate (2026-09-28): ccloop's resolution answer now carries singleCallExecution beside capabilities (spec §4.4); fixture input only.
    resolveAgent: async () => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 1, killGraceMs: 0, capabilities: { ...snapshot().profile.capabilities }, singleCallExecution: null }),
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
    readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }),
  } as unknown as ExecutionPort;
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  return { root, repo, plan, binary, agentsTable, router, base, capablePort };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const detailOf = (f: () => unknown): string => { try { f(); return "none"; } catch (error) { return error instanceof ControlError ? `${error.code}:${error.detail ?? ""}` : `other:${(error as Error).message}`; } };

describe("runtime plans carry the registered digest (in-repo plan path spec 2026-10-21)", () => {
  it("C1: an added plan is listed and resolves; its bytes as registered pass the descriptor check, changed bytes are refused as plan-changed-since-registration", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    const path = join(h.repo, "late.json");
    await writeFile(path, "{\"a\":1}");
    config.addPlan({ planId: "repo.late.json", repoId: "repo", displayName: "late.json", path, sha256: sha("{\"a\":1}") });
    expect((await config.readView({ agent: "codex" })).plans).toEqual([
      { planId: "repo.late.json", repoId: "repo", displayName: "late.json" }, { planId: "ship", repoId: "repo", displayName: "Ship" }]);
    const target = config.resolveTarget({ repoId: "repo", planId: "repo.late.json" });
    const fd = openSync(path, "r");
    try { expect(detailOf(() => target.validatePlanDescriptor(fd))).toBe("none"); } finally { closeSync(fd); }
    // The real reader runs the same check: unchanged bytes get past it (and are then judged as a plan), changed ones do not.
    expect(detailOf(() => readSchedulerControlPlanSource(target))).not.toContain("plan-changed-since-registration");
    await writeFile(path, "{\"a\":2}");
    expect(detailOf(() => readSchedulerControlPlanSource(config.resolveTarget({ repoId: "repo", planId: "repo.late.json" }))))
      .toBe("control-plan-rejected:plan-changed-since-registration");
    // Re-registering with the new digest (same id, same path) trusts the new bytes.
    config.addPlan({ planId: "repo.late.json", repoId: "repo", displayName: "late.json", path, sha256: sha("{\"a\":2}") });
    expect(detailOf(() => readSchedulerControlPlanSource(config.resolveTarget({ repoId: "repo", planId: "repo.late.json" }))))
      .not.toContain("plan-changed-since-registration");
  });

  it("C2: a boot-flag plan has no digest and is not compared; a runtime plan may not take another plan's id or leave its repository", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    await writeFile(h.plan, "{\"changed\":true}");
    expect(detailOf(() => readSchedulerControlPlanSource(config.resolveTarget({ repoId: "repo", planId: "ship" })))).not.toContain("plan-changed-since-registration");
    const other = join(h.repo, "other.json");
    await writeFile(other, "{}");
    expect(detailOf(() => config.checkPlan({ planId: "ship", repoId: "repo", displayName: "x", path: other, sha256: sha("{}") }))).toBe("control-trusted-config-invalid:duplicate-id");
    const outside = join(h.root, "outside.json");
    await writeFile(outside, "{}");
    expect(detailOf(() => config.addPlan({ planId: "out", repoId: "repo", displayName: "x", path: outside, sha256: sha("{}") }))).toBe("control-path-escape:");
    expect(detailOf(() => config.addPlan({ planId: "bad-sha", repoId: "repo", displayName: "x", path: other, sha256: "nothex" }))).toBe("control-trusted-config-invalid:plan-sha256");
    expect((await config.readView({ agent: "codex" })).plans).toEqual([{ planId: "ship", repoId: "repo", displayName: "Ship" }]);
  });
});
