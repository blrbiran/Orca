import { describe, expect, it } from "vitest";
import { createUnconfiguredControlPort } from "../../src/control/unconfiguredPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { ControlError, durableCommandErrorStatuses } from "../../src/control/errors.js";
import { openTestStore, seedBudgetCase } from "./fixtures/store.js";
import { ControlService } from "../../src/control/service.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";

/**
 * Assembly design spec §3 (ruling R5). A panel with no execution port must refuse the commands that
 * need one, by a name that tells an operator which fix applies -- not by a capability error, which
 * says the adapter cannot do something, and not by falling back to a runner with no ledger authority.
 */
const hash = (value: string) => value.repeat(64);

/** A fully capable snapshot, so anything observed below is about the port, never about the profile. */
function controlProfileSnapshot(profileId: string, workKinds: ExecutionProfileSnapshotV1["profile"]["allowedWorkKinds"]): ExecutionProfileSnapshotV1 {
  return {
    schema: "orca-execution-profile-snapshot-v1",
    profile: {
      profileId, allowedWorkKinds: workKinds, adapter: "test-adapter", adapterConfigRef: "adapter-config",
      modelPolicyRef: "model-policy", contextTokenizer: { tokenizerId: "tok", tokenizerVersion: "1" },
      // The schema ties the work output limit to whether the profile does work at all.
      workMaxOutputTokens: workKinds.includes("task") ? 4096 : null,
      capabilities: {
        usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "realtime",
        handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 100_000,
        requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"], handoffDimensions: ["activeMs"], evidenceKind: "request-bound-v1" },
      },
      estimatorPreflight: null,
    },
    resolved: {
      adapterConfigContentHash: hash("a"), modelPolicyContentHash: hash("b"), proofDocumentContentHashes: [hash("c")],
      adapterImplementationHash: hash("d"), adapterProtocolVersion: "1",
      tokenizerArtifactHashes: [{ purpose: "context", contentHash: hash("e") }], secretValueHashes: [{ name: "/adapter/token", valueHash: hash("f") }],
    },
  };
}

describe("the unconfigured execution port", () => {
  const port = createUnconfiguredControlPort();
  const envelope = { protocol: 1, claim: {}, contractHash: "x", inputCheckpoint: null, work: {} } as never;

  it("refuses every method it has, not merely the obvious ones", async () => {
    const calls: Array<[string, Promise<unknown>]> = [
      ["probeProfileCapabilities", port.probeProfileCapabilities!()],
      ["capabilities", port.capabilities()],
      ["readEvidence", port.readEvidence({ artifactId: "a", hash: "h" } as never)],
      ["accept", port.accept(envelope)],
      ["inspect", port.inspect(envelope)],
      ["requestHandoff", port.requestHandoff(envelope, {} as never)],
      ["collect", port.collect(envelope, 0)],
    ];
    // Every method of ExecutionPort is named here on purpose: a port that refuses six of seven is
    // a port with one silent hole, and the hole is the method nobody thought to list.
    expect(calls.map(([name]) => name).sort()).toEqual(
      ["accept", "capabilities", "collect", "inspect", "probeProfileCapabilities", "readEvidence", "requestHandoff"],
    );
    for (const [name, call] of calls) {
      await call.then(
        () => { throw new Error(`${name} resolved instead of refusing`); },
        (error: unknown) => {
          expect(error, name).toBeInstanceOf(ControlError);
          expect((error as ControlError).code, name).toBe("control-port-unconfigured");
        },
      );
    }
  });

  it("exposes the optional probe, so a missing port is never reported as a missing capability", async () => {
    // Without this method the router answers control-capability-probe-failed (profiles.ts:150) and
    // an operator who forgot an environment variable is told their adapter is inadequate.
    expect(typeof port.probeProfileCapabilities).toBe("function");
    const router = createExecutionProfileRouter([resolveProfile(controlProfileSnapshot("worker", ["task"]), port)]);
    const observed = await router.probe(router.list()[0]!);
    expect(observed.probeFailureCode).toBe("control-port-unconfigured");
    expect(observed.probeFailureCode).not.toBe("control-capability-probe-failed");
  });

  it("is registered as a durable outcome, so the refusal reaches a person instead of rolling back", () => {
    // A non-durable classification would roll the command back and leave the panel with nothing to
    // show; the whole point of R5 is that the operator is told which variable is missing.
    expect(durableCommandErrorStatuses["control-port-unconfigured"]).toBe(422);
  });

  it("refuses a second time exactly as it refused the first, holding no state", async () => {
    const first = await port.capabilities().catch((error: ControlError) => error.code);
    const second = await port.capabilities().catch((error: ControlError) => error.code);
    expect([first, second]).toEqual(["control-port-unconfigured", "control-port-unconfigured"]);
  });
});

describe("a claim against an unconfigured port", () => {
  it("refuses by the port's own name and writes no run, rather than blaming the adapter's capabilities", async () => {
    // The router folds every probe throw into a failure code, and the service turns any failure code
    // into control-capability-unsupported. That answer sends an operator to look at their adapter
    // when the fix is an environment variable, so the named code is carried through instead.
    const h = await openTestStore();
    try {
      seedBudgetCase(h.store);
      const worker = resolveProfile(controlProfileSnapshot("worker", ["task"]), createUnconfiguredControlPort());
      const handoff = resolveProfile(controlProfileSnapshot("handoff", ["handoff"]), createUnconfiguredControlPort());
      const router = createExecutionProfileRouter([worker, handoff]);
      const service = new ControlService(h.store, createUnconfiguredControlPort(), { profileRouter: router });
      await expect(service.claimProfiled(
        "g1", "T1",
        { workKind: "task", profileId: "worker", profileHash: worker.profileHash },
        { workKind: "handoff", profileId: "handoff", profileHash: handoff.profileHash },
      )).rejects.toThrow("control-port-unconfigured");
      // Row counts, not the error text: an implementation that reports the right name while still
      // opening a run is the failure this criterion exists to catch.
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes").get()?.n).toBe(0);
    } finally { await h.dispose(); }
  });
});
