import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { claimWork, readRun } from "../../src/control/budget.js";
import { hashPayload, putWork, setGroupStopped } from "../../src/control/commands.js";
import type { ExecutionPort, StartEnvelope } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { ControlService, type ExecutionProfileSelection } from "../../src/control/service.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { collectControlled } from "../../src/control/schedulerBridge.js";
import { getGroup } from "../../src/control/queries.js";
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
import { amount, openTestStore, resolvedAs, seedBudgetCase } from "./fixtures/store.js";

const digest = (byte: string) => byte.repeat(64);
const latch = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };

function profileSnapshot(): ExecutionProfileSnapshotV1 {
  return {
    schema: "orca-execution-profile-snapshot-v1",
    profile: {
      profileId: "worker", allowedWorkKinds: ["task"], adapter: "test-adapter",
      adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null,
      workMaxOutputTokens: 4096,
      capabilities: {
        usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable",
        handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null,
        requestBoundProof: {
          scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"],
          handoffDimensions: ["activeMs"], evidenceKind: "request-bound-v1",
        },
      },
      estimatorPreflight: null,
    },
    resolved: {
      adapterConfigContentHash: digest("a"), modelPolicyContentHash: digest("b"), proofDocumentContentHashes: [],
      adapterImplementationHash: digest("c"), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [],
    },
  };
}

function handoffSnapshot(): ExecutionProfileSnapshotV1 {
  const value = profileSnapshot();
  value.profile.profileId = "handoff";
  value.profile.allowedWorkKinds = ["handoff"];
  value.profile.workMaxOutputTokens = null;
  value.resolved.adapterImplementationHash = digest("d");
  return value;
}

function capableProbe() {
  return structuredClone(profileSnapshot().profile.capabilities);
}

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's one capability
// question is resolveAgent (capabilities protocol 3, spec §4.6), which both the router's probe and the service's own
// check ask; `probing(view)` answers it with `view` for whatever selection is asked.
const probing = (view: () => ReturnType<typeof capableProbe> | Promise<ReturnType<typeof capableProbe>>): Pick<ExecutionPort, "resolveAgent"> => ({
  resolveAgent: async (partial) => resolvedAs(await view(), partial),
});

function port(overrides: Partial<ExecutionPort> = {}): ExecutionPort {
  return {
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
    ...probing(() => capableProbe()),
    listAgents: async () => ({ installations: [] }),
    readEvidence: async () => Buffer.alloc(0),
    accept: async (input) => ({ kind: "accepted", executionId: `execution-${input.claim.runId}`, configHash: input.claim.configHash }),
    inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
    collect: async () => ({ events: [], candidate: null, terminal: null }),
    ...overrides,
  };
}

function serviceWith(store: Awaited<ReturnType<typeof openTestStore>>["store"], selected: ExecutionPort, fallback = port(), handoffPort = port()) {
  const frozen = resolveProfile(profileSnapshot(), selected);
  const handoff = resolveProfile(handoffSnapshot(), handoffPort);
  const router = createExecutionProfileRouter([frozen, handoff]);
  const selection: ExecutionProfileSelection = { workKind: "task", profileId: "worker", profileHash: frozen.profileHash };
  const handoffSelection: ExecutionProfileSelection = { workKind: "handoff", profileId: "handoff", profileHash: handoff.profileHash };
  return { service: new ControlService(store, fallback, { profileRouter: router, reconcileGrant: { work: amount(7, 500, 1, 1), handoff: amount(2, 50, 0, 0) } }), selection, handoffSelection, frozen };
}

function envelope(claim: Awaited<ReturnType<ControlService["claimProfiled"]>>, contract: unknown, root: string): StartEnvelope {
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  return { protocol: 2, claim, contractHash: hashPayload(contract), inputCheckpoint: null, work: { contract, targetRepo: root, base: "HEAD", sourceDir: `${root}/${claim.runId}` } };
}

describe("profiled service execution", () => {
  it("rejects stale, missing, and unavailable profiles before claim state or provider invocation", async () => {
    for (const mode of ["stale", "missing", "unavailable"] as const) {
      const h = await openTestStore();
      try {
        seedBudgetCase(h.store);
        let accepts = 0;
        const selected = port({
          // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
          ...probing(() => mode === "unavailable" ? { ...capableProbe(), handoffControl: "unavailable" } : capableProbe()),
          accept: async () => { accepts += 1; return { kind: "unknown" }; },
        });
        const { service, selection, handoffSelection } = serviceWith(h.store, selected);
        const attempted = mode === "stale" ? { ...selection, profileHash: digest("0") }
          : mode === "missing" ? { ...selection, profileId: "gone" }
          : selection;
        await expect(service.claimProfiled("g1", "T1", attempted, handoffSelection)).rejects.toThrow(mode === "unavailable" ? "control-capability-unsupported" : "profile-changed");
        expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
        expect(accepts).toBe(0);
      } finally { await h.dispose(); }
    }
  });

  it("persists the binding and starts only through the selected profile port", async () => {
    const h = await openTestStore();
    try {
      const seeded = seedBudgetCase(h.store);
      let selectedAccepts = 0;
      const selected = port({ accept: async (input) => { selectedAccepts += 1; return { kind: "accepted", executionId: "selected", configHash: input.claim.configHash }; } });
      const fallback = port({ accept: async () => { throw new Error("fallback-provider-called"); } });
      const { service, selection, handoffSelection } = serviceWith(h.store, selected, fallback);
      const claim = await service.claimProfiled("g1", "T1", selection, handoffSelection);
      expect(readRun(h.store, claim.runId).executionProfile).toEqual(selection);
      expect(readRun(h.store, claim.runId).handoffProfile).toEqual(handoffSelection);
      await expect(service.startProfiled(selection, envelope(claim, seeded.w1.contract, h.root))).resolves.toMatchObject({ executionId: "selected" });
      expect(selectedAccepts).toBe(1);
    } finally { await h.dispose(); }
  });

  it("freshly rejects stale, missing, and unavailable profiles at start without invoking a provider", async () => {
    for (const mode of ["stale", "missing", "unavailable"] as const) {
      const h = await openTestStore();
      try {
        const seeded = seedBudgetCase(h.store);
        let available = true, accepts = 0;
        const selected = port({
          // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
          ...probing(() => available ? capableProbe() : { ...capableProbe(), handoffControl: "unavailable" }),
          accept: async () => { accepts += 1; return { kind: "unknown" }; },
        });
        const { service, selection, handoffSelection } = serviceWith(h.store, selected);
        const claim = await service.claimProfiled("g1", "T1", selection, handoffSelection);
        available = false;
        const attempted = mode === "stale" ? { ...selection, profileHash: digest("0") }
          : mode === "missing" ? { ...selection, profileId: "gone" }
          : selection;
        await expect(service.startProfiled(attempted, envelope(claim, seeded.w1.contract, h.root)))
          .rejects.toThrow(mode === "unavailable" ? "control-capability-unsupported" : "profile-changed");
        expect(accepts).toBe(0);
        expect(readRun(h.store, claim.runId).state).toBe("claimed");
        expect(h.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(`start:${claim.runId}`)).toBeUndefined();
      } finally { await h.dispose(); }
    }
  });

  it("freshly validates the persisted profile before reconciling an unknown start", async () => {
    for (const mode of ["stale", "missing", "unavailable"] as const) {
      const h = await openTestStore();
      try {
        const seeded = seedBudgetCase(h.store);
        let available = true, accepts = 0;
        const selected = port({
          // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
          ...probing(() => available ? capableProbe() : { ...capableProbe(), handoffControl: "unavailable" }),
          accept: async () => { accepts += 1; throw new Error("lost-start-response"); },
          inspect: async () => ({ kind: "absent" }),
        });
        const { service, selection, handoffSelection } = serviceWith(h.store, selected);
        const claim = await service.claimProfiled("g1", "T1", selection, handoffSelection);
        await expect(service.startProfiled(selection, envelope(claim, seeded.w1.contract, h.root))).rejects.toThrow("start-outcome-unknown");
        available = false;
        if (mode !== "unavailable") {
          const run = readRun(h.store, claim.runId);
          run.executionProfile = { ...selection, ...(mode === "stale" ? { profileHash: digest("0") } : { profileId: "gone" }) };
          h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), claim.runId);
        }
        await expect(Promise.resolve().then(() => service.reconcileStartForRun(claim.runId))).rejects.toThrow(mode === "unavailable" ? "control-capability-unsupported" : "profile-changed");
        expect(accepts).toBe(1);
        expect(readRun(h.store, claim.runId).state).toBe("unknown");
        expect(h.store.db.prepare("SELECT count(*) AS n FROM outbox WHERE kind='start'").get()?.n).toBe(1);
      } finally { await h.dispose(); }
    }
  });

  it("rejects strict profiles whose matching proof omits the tokens work dimension", async () => {
    for (const workDimensions of [[], ["activeMs"]] as Array<Array<"tokens" | "activeMs">>) {
      const h = await openTestStore();
      try {
        seedBudgetCase(h.store);
        const workerSnapshot = profileSnapshot();
        workerSnapshot.profile.capabilities.requestBoundProof!.workDimensions = workDimensions;
        // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
        const selected = port({ ...probing(() => structuredClone(workerSnapshot.profile.capabilities)) });
        const worker = resolveProfile(workerSnapshot, selected), handoff = resolveProfile(handoffSnapshot(), port());
        const router = createExecutionProfileRouter([worker, handoff]);
        const service = new ControlService(h.store, port(), { profileRouter: router });
        const workerSelection = { workKind: "task" as const, profileId: "worker", profileHash: worker.profileHash };
        const handoffSelection = { workKind: "handoff" as const, profileId: "handoff", profileHash: handoff.profileHash };
        await expect(service.claimProfiled("g1", "T1", workerSelection, handoffSelection)).rejects.toThrow("control-capability-unsupported");
        expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
      } finally { await h.dispose(); }
    }
  });

  it("rejects a task-only profile where a separate handoff profile is required", async () => {
    const h = await openTestStore();
    try {
      seedBudgetCase(h.store);
      const worker = resolveProfile(profileSnapshot(), port()), router = createExecutionProfileRouter([worker]);
      const service = new ControlService(h.store, port(), { profileRouter: router });
      const selection = { workKind: "task" as const, profileId: "worker", profileHash: worker.profileHash };
      await expect(service.claimProfiled("g1", "T1", selection, selection)).rejects.toThrow("profile-changed");
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("lets drain pass a hanging claim probe, then rejects its writer", async () => {
    const h = await openTestStore();
    const entered = latch(), resume = latch();
    try {
      seedBudgetCase(h.store);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
      const { service, selection, handoffSelection } = serviceWith(h.store, port({ ...probing(async () => { entered.release(); await resume.promise; return capableProbe(); }) }));
      const claim = service.claimProfiled("g1", "T1", selection, handoffSelection);
      await entered.promise;
      await service.admissionGate.beginDrain().beforeWriterTransaction;
      resume.release();
      await expect(claim).rejects.toThrow("panel-draining");
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    } finally { resume.release(); await h.dispose(); }
  });

  it("lets drain pass a hanging reconcile probe, then rejects its writer", async () => {
    const h = await openTestStore();
    const entered = latch(), resume = latch();
    try {
      seedBudgetCase(h.store);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
      const { service, selection, handoffSelection } = serviceWith(h.store, port({ ...probing(async () => { entered.release(); await resume.promise; return capableProbe(); }) }));
      const reconcile = service.reconcileBudgetProfiled("g1", "T1", selection, handoffSelection);
      await entered.promise;
      await service.admissionGate.beginDrain().beforeWriterTransaction;
      resume.release();
      await expect(reconcile).rejects.toThrow("panel-draining");
      expect(h.store.db.prepare("SELECT id FROM work_items WHERE group_id=? AND id=?").get("g1", "reconcile-T1")).toBeUndefined();
    } finally { resume.release(); await h.dispose(); }
  });

  it("lets drain pass a hanging start call and forbids its post-I/O status write", async () => {
    const h = await openTestStore();
    const entered = latch(), resume = latch();
    try {
      const seeded = seedBudgetCase(h.store);
      const selected = port({ accept: async (input) => { entered.release(); await resume.promise; return { kind: "accepted", executionId: "late", configHash: input.claim.configHash }; } });
      const { service, selection, handoffSelection } = serviceWith(h.store, selected);
      const claim = await service.claimProfiled("g1", "T1", selection, handoffSelection);
      const start = service.startProfiled(selection, envelope(claim, seeded.w1.contract, h.root));
      await entered.promise;
      await service.admissionGate.beginDrain().beforeWriterTransaction;
      resume.release();
      await expect(start).rejects.toThrow("panel-draining");
      expect(readRun(h.store, claim.runId).state).toBe("starting");
    } finally { resume.release(); await h.dispose(); }
  });

  it("lets drain pass hanging evidence I/O and rejects every later evidence writer", async () => {
    const h = await openTestStore();
    const entered = latch(), resume = latch();
    try {
      const seeded = seedBudgetCase(h.store);
      const bytes = Buffer.from("usage");
      const source = { artifactId: "late-usage", hash: createHash("sha256").update(bytes).digest("hex") };
      const selected = port({
        collect: async (input) => ({ events: [{ runId: input.claim.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: amount(1, 1, 1, 1), source }], candidate: null, terminal: null }),
        readEvidence: async () => { entered.release(); await resume.promise; return bytes; },
      });
      const { service, selection, handoffSelection } = serviceWith(h.store, selected);
      const claim = await service.claimProfiled("g1", "T1", selection, handoffSelection);
      await service.startProfiled(selection, envelope(claim, seeded.w1.contract, h.root));
      const collect = collectControlled(service, claim.runId);
      await entered.promise;
      await service.admissionGate.beginDrain().beforeWriterTransaction;
      resume.release();
      await expect(collect).rejects.toThrow("panel-draining");
      expect(h.store.db.prepare("SELECT count(*) AS n FROM artifacts").get()?.n).toBe(0);
      expect(readRun(h.store, claim.runId).highWater).toBe(0);
    } finally { resume.release(); await h.dispose(); }
  });

  it("lets drain pass a hanging handoff call and rejects its later evidence writer", async () => {
    const h = await openTestStore();
    const entered = latch(), resume = latch();
    try {
      const seeded = seedBudgetCase(h.store), bytes = Buffer.from("handoff-usage");
      const source = { artifactId: "late-handoff-usage", hash: createHash("sha256").update(bytes).digest("hex") };
      let workerHandoffs = 0, selectedHandoffs = 0;
      const selected = port({ requestHandoff: async (_input, request) => { workerHandoffs += 1; entered.release(); await resume.promise; return { kind: "latched", requestId: request.requestId }; } });
      const handoffPort = port({
        requestHandoff: async (_input, request) => { selectedHandoffs += 1; entered.release(); await resume.promise; return { kind: "latched", requestId: request.requestId }; },
        collect: async (input) => ({ events: [{ runId: input.claim.runId, generation: 1, eventSeq: 1, bucket: "handoff", cumulative: amount(1, 1, 0, 0), source }], candidate: null, terminal: null }),
        readEvidence: async () => bytes,
      });
      const { service, selection, handoffSelection } = serviceWith(h.store, selected, port(), handoffPort);
      const claim = await service.claimProfiled("g1", "T1", selection, handoffSelection);
      await service.startProfiled(selection, envelope(claim, seeded.w1.contract, h.root));
      const group = getGroup(h.store, "g1");
      putWork(h.store, "g1", { ...seeded.w1, workItemId: "handoff-T1", kind: "handoff", parentRunId: claim.runId, grant: { work: amount(0, 0, 0, 0), handoff: seeded.w1.grant.handoff } }, { commandId: "register-profiled-handoff", expectedRevision: group.revision, by: "test" });
      const handoff = service.requestHandoff("g1", claim.runId, { requestId: "profiled-handoff", reason: "human", deadlineAt: "2030-01-01T00:00:00Z" });
      await entered.promise;
      await service.admissionGate.beginDrain().beforeWriterTransaction;
      resume.release();
      await expect(handoff).rejects.toThrow("panel-draining");
      expect(h.store.db.prepare("SELECT count(*) AS n FROM artifacts").get()?.n).toBe(0);
      expect(readRun(h.store, claim.runId).highWater).toBe(0);
      expect(h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(`handoff-request:${claim.runId}`)?.delivered).toBe(0);
      expect(workerHandoffs).toBe(0);
      expect(selectedHandoffs).toBe(1);
    } finally { resume.release(); await h.dispose(); }
  });

  it("releases admission after reconcile and claim exceptions", async () => {
    const h = await openTestStore();
    try {
      seedBudgetCase(h.store);
      const { service, selection, handoffSelection } = serviceWith(h.store, port());
      const group = getGroup(h.store, "g1");
      setGroupStopped(h.store, "g1", true, { commandId: "stop-profiled", expectedRevision: group.revision, by: "test" });
      await expect(service.claimProfiled("g1", "T1", selection, handoffSelection)).rejects.toThrow("group-stopped");
      await expect(service.reconcileBudgetProfiled("g1", "T1", selection, handoffSelection)).rejects.toThrow("group-stopped");
      await service.admissionGate.beginDrain().beforeWriterTransaction;
    } finally { await h.dispose(); }
  });
});
