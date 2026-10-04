import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { createTrustedControlConfig, type TrustedControlConfigInput } from "../../src/panel/controlConfig.js";
import { createUnconfiguredControlPort } from "../../src/control/unconfiguredPort.js";
import { controlConfigSchema, type ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { resolve } from "node:path";

import { ControlError } from "../../src/control/errors.js";

/**
 * Assembly plan Task 4b (rulings R6 and R7). Two facts a shipped panel must be able to serve without
 * being able to do the work: no execution port is configured, and no estimator was chosen. Both are
 * states, not boot failures, and both are read from their own field rather than inferred.
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

describe("repositories added and renamed at runtime (project registry spec §5)", () => {
  it("T1: an added repository resolves, is known, and is listed by readView with its display name", async () => {
    const h = await setup();
    const extra = join(h.root, "extra");
    await mkdir(extra);
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    expect(config.hasRepository("extra-1")).toBe(false);
    config.addRepository({ repoId: "extra-1", displayName: "Extra", path: extra });
    expect(config.hasRepository("extra-1")).toBe(true);
    expect(config.resolveRepository("extra-1")).toBe(extra);
    const view = await config.readView({ agent: "codex" });
    expect(view.repositories).toEqual([{ repoId: "extra-1", displayName: "Extra" }, { repoId: "repo", displayName: "Repo" }]);
  });
  it("T2: refuses a duplicate id, a missing path and a symlinked path, adding nothing", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    const code = (f: () => void): string => { try { f(); return "none"; } catch (error) { return (error as ControlError).code; } };
    expect(code(() => config.checkRepository({ repoId: "repo", displayName: "Again", path: h.repo }))).toBe("control-trusted-config-invalid");
    expect(code(() => config.addRepository({ repoId: "gone", displayName: "Gone", path: join(h.root, "nope") }))).toBe("control-trusted-config-invalid");
    await symlink(h.repo, join(h.root, "link"));
    expect(code(() => config.addRepository({ repoId: "link", displayName: "Link", path: join(h.root, "link") }))).toBe("control-path-symlink");
    expect(config.hasRepository("gone")).toBe(false);
    expect(config.hasRepository("link")).toBe(false);
  });
  it("T3: a rename changes the display name only", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base(), h.router(h.capablePort));
    config.renameRepository("repo", "Renamed");
    expect((await config.readView({ agent: "codex" })).repositories).toEqual([{ repoId: "repo", displayName: "Renamed" }]);
    expect(config.resolveRepository("repo")).toBe(h.repo);
    expect(() => config.renameRepository("absent", "X")).toThrowError(ControlError);
  });
});

it("T4: a repository added to the trusted config at runtime is known to set-workspace-mode, with no restart", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-known-")));
  roots.push(root);
  const repo = join(root, "repo"); await mkdir(repo);
  const later = join(root, "later"); await mkdir(later);
  const binary = join(root, "ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json"); await writeFile(table, "{}", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table };
  const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const runtime = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-known", env });
  if (runtime === null) throw new Error("no runtime");
  try {
    const repoId = controlRepoKey("later");
    expect(runtime.service.repositoryKnown(repoId)).toBe(false);
    runtime.config.addRepository({ repoId, displayName: "Later", path: later });
    expect(runtime.service.repositoryKnown(repoId)).toBe(true);
    const set = await runtime.service.setWorkspaceMode({
      schema: "orca-raw-command-v1", commandId: "mode", actorId: "human", verb: "set-workspace-mode",
      target: { kind: "repository", repoId }, expectedRevision: 0, payload: { workspaceMode: "clone" },
    } as never);
    expect(set).toMatchObject({ result: { kind: "workspace-mode-set", repoId, workspaceMode: "clone" } });
  } finally { runtime.close(); }
});
