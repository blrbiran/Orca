import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, buildEstimatePrompt } from "../../src/control/estimatePrompt.js";
import { createExecutionDriver, driverRunIds, stepA1, type ExecutionDriverDeps } from "../../src/control/executionDriver.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { isEstimateRun } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, workspacePathOf } from "../../src/control/workspace.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { ArtifactRef, Candidate } from "../../src/control/types.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Single-call estimate spec §6.1-§6.4: an estimate run is the driver's, runs as one ccloop single call, and settles
// into its estimate. The synthetic ccloop below answers only single calls (a loop envelope is a test failure).
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
type Outcome = "complete" | "failed" | "aborted";
interface SingleCallOptions {
  outcome?: Outcome; tokens?: number | null; output?: (planHash: string) => unknown; tamper?: "prompt";
  /** Until a handoff request arrives, collect reports usage but no candidate (the call is still running). */
  stoppable?: boolean;
  /** Runs inside the first collect that has a candidate to give, before it answers. */
  duringCollect?: () => Promise<void>;
}
const AMOUNT = { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 };
export const estimateOutput = (planHash: string) => ({ schema: "budget-estimate-v1", planHash,
  tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: AMOUNT, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean tree"] }],
  goalReviewReserve: AMOUNT, groupRationale: "small" });

function singleCallPort(options: SingleCallOptions, planHash: () => string) {
  const evidence = new Map<string, Buffer>();
  const calls = { accept: [] as StartEnvelope[], collect: 0, handoff: 0 };
  let requested = false, hookRan = false;
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => { const ref = { artifactId, hash: sha(bytes) }; evidence.set(`${artifactId}:${ref.hash}`, bytes); return ref; };
  const accepted = (envelope: StartEnvelope) => ({ kind: "accepted" as const, executionId: `exec-${envelope.claim.runId}`, configHash: envelope.claim.configHash });
  const port: ExecutionPort = {
    resolveAgent: async () => { throw new ControlError("control-protocol-unavailable"); },
    listAgents: async () => ({ installations: [] }),
    async accept(envelope) { calls.accept.push(structuredClone(envelope)); return accepted(envelope); },
    async inspect(envelope) { return accepted(envelope); },
    async requestHandoff(_envelope, request) { calls.handoff += 1; requested = true; return { kind: "latched", requestId: request.requestId }; },
    async collect(envelope): Promise<ExecutionReport> {
      calls.collect += 1;
      const { claim, work } = envelope;
      if (work.kind !== "single-call") throw new Error("singleCallPort: single calls only");
      const outcome: Outcome = options.stoppable && requested ? "aborted" : options.outcome ?? "complete";
      const tokens = options.tokens === undefined ? 777 : options.tokens;
      const events = [{ runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work" as const,
        cumulative: tokens === null ? null : { tokens, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}-1`, Buffer.from(`usage ${claim.runId}`)) }];
      if (options.stoppable && !requested) return { events, candidate: null, terminal: null };
      if (!hookRan && options.duringCollect) { hookRan = true; await options.duringCollect(); }
      const outputRef = outcome === "complete" ? put(`output-${claim.runId}`, canonicalBytes((options.output ?? estimateOutput)(planHash()))) : null;
      const record = {
        schema: "ccloop-single-call-record-v1",
        promptSha256: sha(Buffer.from(options.tamper === "prompt" ? `${work.prompt} ` : work.prompt, "utf8")),
        responseSchemaSha256: sha256Canonical(work.responseSchema),
        outcome, outputRef, errorCode: outcome === "failed" ? "single-call-output-invalid" : null,
      };
      const executionId = `exec-${claim.runId}`;
      const candidate: Candidate = {
        groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
        graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater: 1,
        result: outcome === "complete" ? "complete" : outcome === "aborted" ? "partial" : "failed",
        artifacts: outputRef === null ? [] : [outputRef], snapshot: null, missing: [], unresolvedRequestIds: [],
        stopProof: { executionId, generation: claim.generation, isolated: true, source: put(`stop-${claim.runId}`, Buffer.from(`stop ${executionId}`)) },
        terminalOutcome: `single-call-${outcome}`, handoff: put(`call-${claim.runId}`, canonicalBytes(record)),
      };
      return { events, candidate, terminal: null };
    },
    async readEvidence(ref) {
      const bytes = evidence.get(`${ref.artifactId}:${ref.hash}`);
      if (!bytes) throw new ControlError("control-evidence-context-missing");
      return bytes;
    },
  };
  return { port, calls };
}

/**
 * An imported group whose estimate is claimed (a `starting` estimate run), a driver over a synthetic single-call
 * ccloop, and an estimator-only profile -- so a driver that resolves the run's port as a task profile is refused.
 */
export async function estimateHarness(options: SingleCallOptions = {}) {
  const snapshot: ExecutionProfileSnapshotV1 = profileSnapshot();
  snapshot.profile.allowedWorkKinds = ["budget-estimate"];
  snapshot.profile.workMaxOutputTokens = null;
  const h = await webFixture(snapshot);
  const service = new WebControlService(h.deps);
  const run = await service.claimEstimate("g", h.estimateId);
  if (run === null) throw new Error("the estimate was not claimed");
  const runId = String((run as { runId: string }).runId);
  const fake = singleCallPort(options, () => readArchivedPlan(h.store, "g").planHash);
  const deps: ExecutionDriverDeps = {
    store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
    roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => join(h.root, "repo"),
    ccloopBin: "/bin/false", agentsTablePath: join(h.root, "agents.json"),
  };
  const body = () => JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
  const active = () => Number(h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
  const estimate = () => readEstimateRecord(h.store, "g", h.estimateId);
  const driver = createExecutionDriver(deps);
  const rounds = async (predicate: () => boolean, limit = 30): Promise<void> => {
    for (let i = 0; i < limit && !predicate(); i += 1) await driver.round();
    if (!predicate()) throw new Error(`the driver did not get there: run ${JSON.stringify(body().state)} ${JSON.stringify(body().drive?.blockedReason ?? null)}, estimate ${estimate().state}`);
  };
  return { h, service, runId, fake, deps, body, active, estimate, driver, rounds };
}

describe("Task 0 item 4: an estimate run after A1 and booked usage (single-call estimate spec §8.1)", () => {
  it("reserves its attempt at A1 and then satisfies completeEstimate's conservation guard", async () => {
    const x = await estimateHarness(); try {
      expect(stepA1(x.deps, x.runId)).toBe(true);
      expect(x.body()).toMatchObject({ state: "start-pending", providerAttemptOrdinal: 1 });
      recordUsage(x.h.store, { runId: x.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1_234, activeMs: 50, attempts: 1, sessions: 1 }, source: { artifactId: "usage-t0", hash: "e".repeat(64) } });
      expect(x.body().remaining.work).toEqual({ tokens: 250_000 - 1_234, activeMs: 900_000 - 50, attempts: 0, sessions: 0 });
      // The call gave nothing (null): completeEstimate must still get past every conservation check to record that.
      x.service.completeEstimate("g", x.h.estimateId, null, () => {
        const row = x.body(); row.state = "settled-restartable";
        x.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), x.runId);
      });
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-call-failed" });
      expect(x.active()).toBe(0);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(1_234);
    } finally { await x.h.dispose(); }
  });
});

describe("the estimate chain (single-call estimate spec §6.1-§6.3)", () => {
  it("drives an estimate run from starting to a ready estimate through one single call, with no workspace", async () => {
    const x = await estimateHarness(); try {
      expect(isEstimateRun(x.h.store, x.runId)).toBe(true);
      expect(driverRunIds(x.h.store)).toEqual([x.runId]);
      await x.rounds(() => x.estimate().state !== "running");
      const plan = readArchivedPlan(x.h.store, "g");
      expect(x.estimate()).toMatchObject({ state: "ready", reasonCode: null, output: estimateOutput(plan.planHash), outputHash: sha256Canonical(estimateOutput(plan.planHash)) });
      expect(x.body()).toMatchObject({ state: "settled-restartable", cumulative: { work: { tokens: 777, activeMs: 5, attempts: 1, sessions: 1 } }, unknown: { work: false } });
      expect(x.active()).toBe(0);
      expect(driverRunIds(x.h.store)).toEqual([]);
      // Exactly one accept, and the envelope is the single call Orca assembled: the prompt byte for byte, the
      // hand-written schema, the frozen output cap, no checkpoint.
      expect(x.fake.calls.accept).toHaveLength(1);
      const sent = x.fake.calls.accept[0]!;
      const request = x.estimate().request!;
      expect(sent).toMatchObject({ protocol: 3, inputCheckpoint: null, claim: { runId: x.runId, taskId: null, workItemId: x.h.estimateId } });
      expect(sent.work).toEqual({ kind: "single-call", prompt: buildEstimatePrompt("1", canonicalBytes(request).toString("utf8")), responseSchema: BUDGET_ESTIMATE_JSON_SCHEMA, maxOutputTokens: 64_000, sourceDir: x.body().drive.sourceDir });
      // No workspace, recorded or on disk.
      expect(x.body().drive.workspacePath).toBeNull();
      expect(existsSync(workspacePathOf(x.deps.roots, x.runId))).toBe(false);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(777);
    } finally { await x.h.dispose(); }
  });

  it("blocks the run and settles nothing when ccloop's call record names another prompt", async () => {
    const x = await estimateHarness({ tamper: "prompt" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "single-call-prompt-mismatch" });
      expect(x.estimate().state).toBe("running");
      expect(x.active()).toBe(1);
    } finally { await x.h.dispose(); }
  });

  it("blocks as estimate-usage-unknown, not in a retry loop, when an aborted call observed no usage", async () => {
    const x = await estimateHarness({ outcome: "aborted", tokens: null }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });
      expect(x.body().state).toBe("blocked");
      expect(x.estimate().state).toBe("running");
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.usageUnknown).toBe(true);
      const collects = x.fake.calls.collect;
      await x.driver.round();
      expect(x.fake.calls.collect).toBe(collects);
    } finally { await x.h.dispose(); }
  });

  // Controller ruling (2026-09-28): a call that failed with no usage books a null work cumulative too, and must land in
  // the same named block -- not a C retry every round.
  it("blocks as estimate-usage-unknown, not in a retry loop, when a failed call observed no usage", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });
      expect(x.estimate().state).toBe("running");
      expect(x.body().unknown.work).toBe(true);
      const collects = x.fake.calls.collect;
      await x.driver.round();
      expect(x.fake.calls.collect).toBe(collects);
      expect(x.body().state).toBe("blocked");
    } finally { await x.h.dispose(); }
  });

  it.each([
    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed"],
    ["an answer for another plan", { output: () => estimateOutput("f".repeat(64)) }, "estimate-output-plan-mismatch"],
    ["an answer that is not an estimate", { output: () => ({ schema: "budget-estimate-v1" }) }, "estimate-output-invalid"],
  ])("fails the estimate with its reason through the driver: %s", async (_label, options, reasonCode) => {
    const x = await estimateHarness(options); try {
      await x.rounds(() => x.estimate().state !== "running");
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode, output: null });
      expect(x.body().state).toBe("settled-restartable");
    } finally { await x.h.dispose(); }
  });

  it("is not an estimate run when its claim row names another run", async () => {
    const x = await estimateHarness(); try {
      const id = `estimate:g:${x.h.estimateId}`;
      const claim = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id)!.body));
      x.h.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(JSON.stringify({ ...claim, runId: "run-other" }), id);
      expect(isEstimateRun(x.h.store, x.runId)).toBe(false);
      expect(driverRunIds(x.h.store)).toEqual([]);
    } finally { await x.h.dispose(); }
  });
});
