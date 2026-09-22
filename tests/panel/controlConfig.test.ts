import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile, unavailableCapabilities } from "../../src/control/profiles.js";
import { createTrustedControlConfig } from "../../src/panel/controlConfig.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { rm } from "node:fs/promises";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const hash = (value: string) => value.repeat(64);

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-control-config-")));
  roots.push(root);
  const repo = join(root, "repo");
  const plans = join(repo, "plans");
  await mkdir(plans, { recursive: true });
  const plan = join(plans, "ship.json");
  await writeFile(plan, "{}", { mode: 0o600 });
  const binary = join(root, "ccloop");
  const adapterConfig = join(root, "adapter.json");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(binary, 0o700);
  await writeFile(adapterConfig, "{}", { mode: 0o600 });

  const snapshot: ExecutionProfileSnapshotV1 = {
    schema: "orca-execution-profile-snapshot-v1",
    profile: {
      profileId: "estimator", allowedWorkKinds: ["budget-estimate"], adapter: "codex",
      adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null,
      workMaxOutputTokens: null,
      capabilities: {
        usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
        handoffControl: "durable", handoffExecution: "mechanical-in-run-v1",
        contextWindowTokens: null, requestBoundProof: null,
      },
      estimatorPreflight: null,
    },
    resolved: {
      adapterConfigContentHash: hash("a"), modelPolicyContentHash: hash("b"), proofDocumentContentHashes: [],
      adapterImplementationHash: hash("c"), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [],
    },
  };
  const port = {
    probeProfileCapabilities: async () => ({ ...snapshot.profile.capabilities }),
    capabilities: async () => ({ protocol: 1 as const, durableAccept: true, ownershipIsolation: true, evidenceRetention: true, usageObservation: "phase-end" as const, budgetEnforcement: "soft" as const, requestBoundEvidence: null }),
    readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" as const }), inspect: async () => ({ kind: "unknown" as const }),
    requestHandoff: async (_input: never, request: {requestId:string}) => ({ kind: "unknown" as const, requestId: request.requestId }),
    collect: async () => ({ events: [], candidate: null, terminal: null }),
  } as unknown as ExecutionPort;
  const frozen = resolveProfile(snapshot, port);
  const router = createExecutionProfileRouter([frozen]);
  return { root, repo, plan, binary, adapterConfig, frozen, router };
}

describe("trusted panel control config", () => {
  it("resolves only stable repository and plan IDs and never exposes trusted paths", async () => {
    const h = await setup();
    const config = createTrustedControlConfig({
      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
      archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
      repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }],
      plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: h.plan }],
      defaultEstimatorProfileId: "estimator", defaultEstimateMode: "soft",
    }, h.router);

    expect(config.resolveTarget({ repoId: "repo", planId: "ship" })).toEqual({ repositoryPath: h.repo, planPath: h.plan });
    expect(() => config.resolveTarget({ repoId: "repo", planId: "ship", path: "/tmp/evil" } as never)).toThrow("control-target-not-allowed");
    expect(() => config.resolveTarget({ repoId: "missing", planId: "ship" })).toThrow("control-target-not-allowed");

    const view = await config.readView();
    const serialized = JSON.stringify(view);
    expect(view.defaults).toEqual({ estimatorProfileId: "estimator", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" });
    expect(serialized).not.toContain(h.root);
    expect(serialized).not.toContain("executablePath");
    expect(serialized).not.toContain("adapterConfigPath");
  });

  it("rejects allowlisted plan escapes and symlinked path components at startup", async () => {
    const h = await setup();
    const outside = join(h.root, "outside.json");
    await writeFile(outside, "{}");
    const link = join(h.repo, "linked-plan.json");
    await symlink(outside, link);
    const base = {
      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
      archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
      repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }],
      defaultEstimatorProfileId: "estimator", defaultEstimateMode: "soft" as const,
    };

    expect(() => createTrustedControlConfig({ ...base, plans: [{ planId: "outside", repoId: "repo", displayName: "Outside", path: outside }] }, h.router)).toThrow("control-path-escape");
    expect(() => createTrustedControlConfig({ ...base, plans: [{ planId: "link", repoId: "repo", displayName: "Link", path: link }] }, h.router)).toThrow("control-path-symlink");
  });

  it("rejects a plan or ancestor swapped to a symlink after startup", async () => {
    const h = await setup();
    const config = createTrustedControlConfig({
      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
      archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
      repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }],
      plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: h.plan }],
      defaultEstimatorProfileId: "estimator", defaultEstimateMode: "soft",
    }, h.router);
    const originalPlans = join(h.repo, "plans-original");
    await (await import("node:fs/promises")).rename(join(h.repo, "plans"), originalPlans);
    await symlink(originalPlans, join(h.repo, "plans"));
    expect(() => config.resolveTarget({ repoId: "repo", planId: "ship" })).toThrow("control-path-symlink");
  });

  it("rejects duplicate IDs and invalid trusted executable paths before serving config", async () => {
    const h = await setup();
    const input = {
      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
      archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
      repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }, { repoId: "repo", displayName: "Again", path: h.repo }],
      plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: h.plan }],
      defaultEstimatorProfileId: "estimator", defaultEstimateMode: "soft" as const,
    };
    expect(() => createTrustedControlConfig(input, h.router)).toThrow("control-trusted-config-invalid");
    expect(() => createTrustedControlConfig({ ...input, repositories: input.repositories.slice(0, 1), executablePath: "relative" }, h.router)).toThrow("control-trusted-config-invalid");
    expect(() => createTrustedControlConfig({ ...input, repositories: input.repositories.slice(0, 1), browserPath: "/tmp/evil" } as never, h.router)).toThrow("control-trusted-config-invalid");
  });
});
