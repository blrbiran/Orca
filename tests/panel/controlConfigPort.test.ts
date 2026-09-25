import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { createTrustedControlConfig, type TrustedControlConfigInput } from "../../src/panel/controlConfig.js";
import { createUnconfiguredControlPort } from "../../src/control/unconfiguredPort.js";
import { controlConfigSchema, type ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { ControlError } from "../../src/control/errors.js";

/**
 * Assembly plan Task 4b (rulings R6 and R7). Two facts a shipped panel must be able to serve without
 * being able to do the work: no execution port is configured, and no estimator was chosen. Both are
 * states, not boot failures, and both are read from their own field rather than inferred.
 */

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const hash = (value: string) => value.repeat(64);

const snapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v1",
  profile: {
    profileId: "estimator", allowedWorkKinds: ["budget-estimate"], adapter: "codex",
    adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null, workMaxOutputTokens: null,
    capabilities: {
      usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
      handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
    },
    estimatorPreflight: null,
  },
  resolved: {
    adapterConfigContentHash: hash("a"), modelPolicyContentHash: hash("b"), proofDocumentContentHashes: [],
    adapterImplementationHash: hash("c"), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [],
  },
});

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-control-port-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const plan = join(repo, "ship.json");
  await writeFile(plan, "{}", { mode: 0o600 });
  const binary = join(root, "ccloop");
  const agentsTable = join(root, "agents.json");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(binary, 0o700);
  await writeFile(agentsTable, "{}", { mode: 0o600 });
  const router = (port: ExecutionPort) => createExecutionProfileRouter([resolveProfile(snapshot(), port)]);
  const base = (over: Partial<TrustedControlConfigInput> = {}): TrustedControlConfigInput => ({
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
    resolveAgent: async () => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 1, killGraceMs: 0, capabilities: { ...snapshot().profile.capabilities } }),
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
    readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }),
  } as unknown as ExecutionPort;
  return { root, repo, plan, binary, agentsTable, router, base, capablePort };
}

describe("the served config states whether an execution port is configured", () => {
  it("serves \"unconfigured\" when the panel was started without one", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base({ executionPort: "unconfigured", agentsTablePath: null }), h.router(createUnconfiguredControlPort()));
    // Parsed by the protocol schema rather than read off the input object: an input that is never
    // copied into the view would pass an assertion made against the input.
    const view = controlConfigSchema.parse(await config.readView());
    expect(view.executionPort).toBe("unconfigured");
  });

  it("serves \"configured\" when it was", async () => {
    const h = await setup();
    const view = controlConfigSchema.parse(await createTrustedControlConfig(h.base(), h.router(h.capablePort)).readView());
    expect(view.executionPort).toBe("configured");
  });

  it("does not answer the port question from a profile's probe failure", async () => {
    // Ruling R6 / spec §9.3. Here every profile carries a probe failure code while the process does
    // have a port configured -- an implementation that derived the field from probeFailureCode would
    // answer "unconfigured" and this criterion would catch it.
    const h = await setup();
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the failing probe is resolveAgent.
    const failing = { ...h.capablePort, resolveAgent: async () => { throw new ControlError("control-capability-probe-failed"); } } as ExecutionPort;
    const view = controlConfigSchema.parse(await createTrustedControlConfig(h.base(), h.router(failing)).readView());
    expect(view.profiles[0]!.probeFailureCode).toBe("control-capability-probe-failed");
    expect(view.executionPort).toBe("configured");
  });
});

describe("the served config states whether an estimator was chosen", () => {
  it("serves null defaults rather than refusing to build", async () => {
    const h = await setup();
    const config = createTrustedControlConfig(h.base({ defaultEstimatorProfileId: null, defaultEstimateMode: null }), h.router(h.capablePort));
    const view = controlConfigSchema.parse(await config.readView());
    expect(view.defaults).toBe(null);
  });

  it("still refuses an estimator that was named and does not resolve", async () => {
    // R7 relaxes "no estimator"; it does not relax "the estimator you named is not there".
    const h = await setup();
    expect(() => createTrustedControlConfig(h.base({ defaultEstimatorProfileId: "absent" }), h.router(h.capablePort)))
      .toThrow("control-trusted-config-invalid");
  });
});

describe("the two pairs cannot disagree", () => {
  const detail = (fn: () => unknown): string => {
    try { fn(); return "<built>"; } catch (error) { return error instanceof ControlError ? String(error.detail) : String(error); }
  };

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the pair is port + agents
  // table now (spec §6.6), and the refinement is named for it.
  it("refuses a configured port with no agents table", async () => {
    const h = await setup();
    expect(detail(() => createTrustedControlConfig(h.base({ executionPort: "configured", agentsTablePath: null }), h.router(h.capablePort))))
      .toBe("execution-port-agents-table-mismatch");
  });

  it("refuses an unconfigured port that still carries one, which is the other direction", async () => {
    // Asserted separately from the case above: one refinement passing says nothing about the other.
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): same pair, renamed refinement.
    const h = await setup();
    expect(detail(() => createTrustedControlConfig(h.base({ executionPort: "unconfigured" }), h.router(createUnconfiguredControlPort()))))
      .toBe("execution-port-agents-table-mismatch");
  });

  it("refuses half an estimator in both directions", async () => {
    const h = await setup();
    expect(detail(() => createTrustedControlConfig(h.base({ defaultEstimatorProfileId: null }), h.router(h.capablePort))))
      .toBe("estimator-defaults-incomplete");
    expect(detail(() => createTrustedControlConfig(h.base({ defaultEstimateMode: null }), h.router(h.capablePort))))
      .toBe("estimator-defaults-incomplete");
  });
});
