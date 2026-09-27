import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { ControlError } from "../../../src/control/errors.js";
import { createExecutionDriver, type ExecutionDriverDeps } from "../../../src/control/executionDriver.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { readArchivedPlan, readEstimateRecord } from "../../../src/control/queries.js";
import { WebControlService } from "../../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../../src/control/workspace.js";
import type { ArtifactRef, Candidate } from "../../../src/control/types.js";
import type { ExecutionProfileSnapshotV1 } from "../../../src/control/webProtocol.js";
import { profileSnapshot, webFixture } from "./web.js";

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
