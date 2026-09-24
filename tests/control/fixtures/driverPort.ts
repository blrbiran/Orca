import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ControlError } from "../../../src/control/errors.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../../src/control/executionPort.js";
import type { ArtifactRef, Candidate, UsageEvent } from "../../../src/control/types.js";
import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";

/**
 * A synthetic ccloop for the execution driver's unit criteria. It does what the real control protocol
 * does at the level the driver can observe: `accept` is idempotent per run, `collect` materialises
 * `<sourceDir>/repo` from the rewritten contract's repoPath at its HEAD, writes the task's files there
 * uncommitted, and reports two usage events (work, handoff), a candidate with a stop proof and a
 * terminal. Evidence bytes are served back by reference.
 */
export type FakeBehaviour = "succeed" | "unknown" | "forget-first-accept" | "lost-accept" | "refuse" | "wrong-config" | "exhausted";

export interface FakeCcloop {
  port: ExecutionPort;
  calls: { accept: StartEnvelope[]; inspect: number; collect: number };
}

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export function fakeCcloopPort(input: {
  capabilities: CapabilityViewV1;
  behaviour(workItemId: string): FakeBehaviour;
  files(workItemId: string): Record<string, string>;
  delayAccept?: () => Promise<void>;
  /** Final review I1: the work tokens the run reports (10 unless said otherwise), so a criterion can overspend a grant. */
  workTokens?: (workItemId: string) => number;
}): FakeCcloop {
  const calls = { accept: [] as StartEnvelope[], inspect: 0, collect: 0 };
  const executions = new Map<string, string>();
  const forgotten = new Set<string>();
  const evidence = new Map<string, Buffer>();
  const reports = new Map<string, ExecutionReport>();
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => {
    const ref = { artifactId, hash: sha(bytes) };
    evidence.set(`${ref.artifactId}:${ref.hash}`, bytes);
    return ref;
  };
  const stopSource = (runId: string, executionId: string, generation: number) =>
    put(`stop-${runId}`, Buffer.from(JSON.stringify({ isolated: true, executionId, generation })));

  const execute = (envelope: StartEnvelope, executionId: string): ExecutionReport => {
    const { claim, work } = envelope;
    const workspace = (work.contract as { context: { repoPath: string } }).context.repoPath;
    const repo = join(work.sourceDir, "repo");
    const head = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["clone", "-q", "--no-checkout", workspace, repo]);
    execFileSync("git", ["-C", repo, "checkout", "-q", "--detach", head]);
    for (const [path, content] of Object.entries(input.files(claim.workItemId))) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    const events: UsageEvent[] = [
      { runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work", cumulative: { tokens: input.workTokens?.(claim.workItemId) ?? 10, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}-1`, Buffer.from(`work usage ${claim.runId}`)) },
      { runId: claim.runId, generation: claim.generation, eventSeq: 2, bucket: "handoff", cumulative: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, source: put(`usage-${claim.runId}-2`, Buffer.from(`handoff usage ${claim.runId}`)) },
    ];
    const outcome = input.behaviour(claim.workItemId) === "exhausted" ? "exhausted" : "succeeded";
    // Fix round 1 (review Important 1): a `protocol:1` packet handoff.ts's `packetSchema` (and its
    // identity/usageHighWater check against the committed candidate) actually accepts -- the driver's
    // `stepE` carries this bytes-for-bytes into the committed candidate's own `handoff` field.
    const usageHighWater = 2;
    const handoffPacket = {
      protocol: 1 as const,
      identity: {
        groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId,
        generation: claim.generation, graphVersion: claim.graphVersion, targetVersion: claim.targetVersion,
      },
      request: null, runState: { status: outcome },
      completed: [] as string[], unfinished: [] as string[], pendingDecisions: [] as string[],
      awaitingHuman: [] as string[], validationCommands: [] as string[], rawLogs: [] as unknown[],
      usageHighWater, unresolvedRequestIds: [] as string[], artifacts: [] as unknown[],
    };
    const candidate: Candidate = {
      groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
      graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater,
      result: outcome === "succeeded" ? "complete" : "partial", artifacts: [], snapshot: null, missing: [], unresolvedRequestIds: [],
      stopProof: { executionId, generation: claim.generation, isolated: true, source: stopSource(claim.runId, executionId, claim.generation) },
      terminalOutcome: outcome, handoff: put(`handoff-${claim.runId}`, Buffer.from(JSON.stringify(handoffPacket))),
    };
    return { events, candidate, terminal: { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo } };
  };

  const port: ExecutionPort = {
    probeProfileCapabilities: async () => input.capabilities,
    capabilities: async () => ({ protocol: 2 as const, ...input.capabilities }),
    async accept(envelope) {
      calls.accept.push(structuredClone(envelope));
      await input.delayAccept?.();
      const { runId, workItemId, configHash } = envelope.claim;
      const behaviour = input.behaviour(workItemId);
      if (behaviour === "refuse") throw new ControlError("control-peer-exit", "2:control-config-hash-mismatch");
      if (behaviour === "unknown") return { kind: "unknown" };
      if (behaviour === "forget-first-accept" && !forgotten.has(runId)) { forgotten.add(runId); return { kind: "unknown" }; }
      const executionId = executions.get(runId) ?? `execution-${runId}`;
      executions.set(runId, executionId);
      if (behaviour === "lost-accept") return { kind: "unknown" };
      return { kind: "accepted", executionId, configHash: behaviour === "wrong-config" ? "f".repeat(64) : configHash };
    },
    async inspect(envelope) {
      calls.inspect += 1;
      const { runId, workItemId, configHash, generation } = envelope.claim;
      const behaviour = input.behaviour(workItemId);
      if (behaviour === "unknown") return { kind: "unknown" };
      const executionId = executions.get(runId);
      if (executionId === undefined) return { kind: "absent" };
      if (behaviour === "lost-accept") return { kind: "stopped", proof: { executionId, generation, isolated: true, source: stopSource(runId, executionId, generation) } };
      return { kind: "accepted", executionId, configHash };
    },
    async collect(envelope, afterSeq) {
      calls.collect += 1;
      const executionId = executions.get(envelope.claim.runId);
      if (executionId === undefined) return { events: [], candidate: null, terminal: null };
      let report = reports.get(envelope.claim.runId);
      if (report === undefined) { report = execute(envelope, executionId); reports.set(envelope.claim.runId, report); }
      return { ...report, events: report.events.filter((event) => event.eventSeq > afterSeq) };
    },
    async readEvidence(ref) {
      const bytes = evidence.get(`${ref.artifactId}:${ref.hash}`);
      if (bytes === undefined) throw new ControlError("control-evidence-context-missing");
      return bytes;
    },
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
  };
  return { port, calls };
}
