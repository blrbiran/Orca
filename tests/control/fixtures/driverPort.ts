import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ControlError } from "../../../src/control/errors.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../../src/control/executionPort.js";
import type { ArtifactRef, Candidate, HandoffRequest, UsageEvent } from "../../../src/control/types.js";
import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";

/**
 * A synthetic ccloop for the execution driver's unit criteria. It does what the real control protocol
 * does at the level the driver can observe: `accept` is idempotent per run, `collect` materialises
 * `<sourceDir>/repo` from the rewritten contract's repoPath at its HEAD, writes the task's files there
 * uncommitted, and reports two usage events (work, handoff), a candidate with a stop proof and a
 * terminal. Evidence bytes are served back by reference.
 */
export type FakeBehaviour = "succeed" | "unknown" | "forget-first-accept" | "lost-accept" | "refuse" | "wrong-config" | "exhausted"
  // Handoff delivery (Task 4): runs until a handoff request arrives, then stops at a boundary with a candidate and
  // no terminal; `-silent` latches the request but never produces anything; `orphan-candidate` reports a proved
  // stop with no terminal and no request at all (criterion X1); `stoppable-usage-unknown` stops like `stoppable`
  // but its work phase was aborted before any usage was observed (cumulative null, handoff spec §13.1 C-3).
  | "stoppable" | "stoppable-silent" | "orphan-candidate" | "stoppable-usage-unknown"
  // Task 4 fix round 1: stoppable runs whose candidate fails exactly one of Web spec §6.2's hard conditions --
  // an open request id, a missing piece of evidence, a usage event past a gap (seq 3 never arrives), a handoff
  // usage that turned unknown after it was observed -- and one whose ccloop acknowledges some other request id.
  | "stoppable-unresolved" | "stoppable-missing" | "stoppable-usage-gap" | "stoppable-handoff-usage-unknown" | "stoppable-wrong-ack";

/** Task 4 fix round 1: the behaviours above that stop like `stoppable` once a request arrives. */
const STOPPABLE_VARIANTS: ReadonlySet<FakeBehaviour> = new Set<FakeBehaviour>(["stoppable-unresolved", "stoppable-missing", "stoppable-usage-gap", "stoppable-handoff-usage-unknown", "stoppable-wrong-ack"]);

export interface FakeCcloop {
  port: ExecutionPort;
  calls: { accept: StartEnvelope[]; inspect: number; collect: number; handoff: HandoffRequest[] };
}

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export function fakeCcloopPort(input: {
  capabilities: CapabilityViewV1;
  behaviour(workItemId: string): FakeBehaviour;
  files(workItemId: string): Record<string, string>;
  delayAccept?: () => Promise<void>;
  /** Final review I1: the work tokens the run reports (10 unless said otherwise), so a criterion can overspend a grant. */
  workTokens?: (workItemId: string) => number;
  /** Handoff delivery (Task 4): runs inside every `collect` that found an execution, before it answers. */
  duringCollect?: () => Promise<void>;
  /** Audit 2026-09-26 (seat B): what `accept` answers as the execution's configHash; absent, the claim's is echoed. */
  acceptedConfigHash?: (envelope: StartEnvelope) => string;
}): FakeCcloop {
  const calls = { accept: [] as StartEnvelope[], inspect: 0, collect: 0, handoff: [] as HandoffRequest[] };
  const handoffs = new Map<string, HandoffRequest>();
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

  const execute = (envelope: StartEnvelope, executionId: string, stop: { request: HandoffRequest | null; terminal: boolean } = { request: null, terminal: true }): ExecutionReport => {
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
      { runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work", cumulative: input.behaviour(claim.workItemId) === "stoppable-usage-unknown" ? null : { tokens: input.workTokens?.(claim.workItemId) ?? 10, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}-1`, Buffer.from(`work usage ${claim.runId}`)) },
      { runId: claim.runId, generation: claim.generation, eventSeq: 2, bucket: "handoff", cumulative: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, source: put(`usage-${claim.runId}-2`, Buffer.from(`handoff usage ${claim.runId}`)) },
    ];
    const variant = input.behaviour(claim.workItemId);
    if (variant === "stoppable-usage-gap") events.push({ runId: claim.runId, generation: claim.generation, eventSeq: 4, bucket: "handoff", cumulative: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, source: put(`usage-${claim.runId}-4`, Buffer.from(`handoff usage ${claim.runId} 4`)) });
    if (variant === "stoppable-handoff-usage-unknown") events.push({ runId: claim.runId, generation: claim.generation, eventSeq: 3, bucket: "handoff", cumulative: null, source: put(`usage-${claim.runId}-3`, Buffer.from(`handoff usage ${claim.runId} 3`)) });
    const unresolvedRequestIds = variant === "stoppable-unresolved" ? ["open-question-1"] : [];
    const outcome = input.behaviour(claim.workItemId) === "exhausted" ? "exhausted" : "succeeded";
    // Fix round 1 (review Important 1): a `protocol:1` packet handoff.ts's `packetSchema` (and its
    // identity/usageHighWater check against the committed candidate) actually accepts -- the driver's
    // `stepE` carries this bytes-for-bytes into the committed candidate's own `handoff` field.
    const usageHighWater = variant === "stoppable-handoff-usage-unknown" ? 3 : 2;
    const handoffPacket = {
      protocol: 1 as const,
      identity: {
        groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId,
        generation: claim.generation, graphVersion: claim.graphVersion, targetVersion: claim.targetVersion,
      },
      request: stop.request, runState: { status: stop.terminal ? outcome : "executing" },
      completed: [] as string[], unfinished: [] as string[], pendingDecisions: [] as string[],
      awaitingHuman: [] as string[], validationCommands: [] as string[], rawLogs: [] as unknown[],
      usageHighWater, unresolvedRequestIds, artifacts: [] as unknown[],
    };
    const candidate: Candidate = {
      groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
      graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater,
      result: outcome === "succeeded" ? "complete" : "partial", artifacts: [], snapshot: null, missing: variant === "stoppable-missing" ? ["evidence-lost"] : [], unresolvedRequestIds,
      stopProof: { executionId, generation: claim.generation, isolated: true, source: stopSource(claim.runId, executionId, claim.generation) },
      terminalOutcome: stop.terminal ? outcome : "executing", handoff: put(`handoff-${claim.runId}`, Buffer.from(JSON.stringify(handoffPacket))),
    };
    return { events, candidate, terminal: stop.terminal ? { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo } : null };
  };

  const port: ExecutionPort = {
    // Agent selection spec §4.6: capabilities protocol 3 -- the selection asked about, echoed and filled.
    resolveAgent: async (partial) => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: "c".repeat(64), timeoutMs: 120_000, killGraceMs: 0, capabilities: input.capabilities }),
    listAgents: async () => ({ installations: [] }),
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
      return { kind: "accepted", executionId, configHash: behaviour === "wrong-config" ? "f".repeat(64) : input.acceptedConfigHash?.(envelope) ?? configHash };
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
      const behaviour = input.behaviour(envelope.claim.workItemId);
      if (report === undefined && (behaviour === "stoppable" || behaviour === "stoppable-silent" || behaviour === "stoppable-usage-unknown" || STOPPABLE_VARIANTS.has(behaviour))) {
        const request = handoffs.get(envelope.claim.runId);
        if (request === undefined || behaviour === "stoppable-silent") return { events: [], candidate: null, terminal: null };
        report = execute(envelope, executionId, { request, terminal: false });
        reports.set(envelope.claim.runId, report);
      }
      if (report === undefined && behaviour === "orphan-candidate") { report = execute(envelope, executionId, { request: null, terminal: false }); reports.set(envelope.claim.runId, report); }
      if (report === undefined) { report = execute(envelope, executionId); reports.set(envelope.claim.runId, report); }
      await input.duringCollect?.();
      return { ...report, events: report.events.filter((event) => event.eventSeq > afterSeq) };
    },
    async readEvidence(ref) {
      const bytes = evidence.get(`${ref.artifactId}:${ref.hash}`);
      if (bytes === undefined) throw new ControlError("control-evidence-context-missing");
      return bytes;
    },
    // ccloop's control handoff (ccloop src/control/handoff.ts): an accepted execution latches the request, a replay
    // of the same request is answered again (`complete` once a candidate exists), a different one is a conflict.
    async requestHandoff(envelope, request) {
      calls.handoff.push(structuredClone(request));
      const runId = envelope.claim.runId;
      if (!executions.has(runId)) throw new ControlError("control-peer-exit", "2:control-handoff-not-accepted");
      const existing = handoffs.get(runId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(request)) throw new ControlError("control-peer-exit", "2:control-handoff-conflict");
      handoffs.set(runId, request);
      if (input.behaviour(envelope.claim.workItemId) === "stoppable-wrong-ack") return { kind: "latched", requestId: `not-${request.requestId}` };
      return reports.has(runId) ? { kind: "complete", requestId: request.requestId, checkpointId: `candidate-${runId}` } : { kind: "latched", requestId: request.requestId };
    },
  };
  return { port, calls };
}
