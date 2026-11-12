import { createHash } from "node:crypto";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import type { ExecutionReport } from "../../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import type { ArtifactRef, Candidate } from "../../../src/control/types.js";
import type { driverHarness } from "./driverHarness.js";
import { profileSnapshot } from "./web.js";

type DriverHarness = Awaited<ReturnType<typeof driverHarness>>;
export interface SingleCallSeen { runId: string; purpose: string; prompt: string; responseSchema: Record<string, unknown> }
export interface SingleCallAnswer { outcome: "complete" | "failed"; output?: unknown; tokens?: number; errorCode?: string }

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * Tester follow-up G plan Task 2: the synthetic ccloop answers a group's own single calls (the goal judge, the requirement
 * review) through `answer`, once per run, exactly as tests/control/quotaRestProbe.test.ts answers its probe inline; loop
 * work goes to the harness's port as before. `calls` lists every single call the driver collected, in order.
 */
export function answerSingleCalls(t: DriverHarness, answer: (call: SingleCallSeen) => SingleCallAnswer): { calls: SingleCallSeen[] } {
  const calls: SingleCallSeen[] = [];
  const byRun = new Map<string, SingleCallAnswer>();
  const evidence = new Map<string, Buffer>();
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => { const ref = { artifactId, hash: sha(bytes) }; evidence.set(`${artifactId}:${ref.hash}`, bytes); return ref; };
  const loopCollect = t.fake.port.collect.bind(t.fake.port), loopEvidence = t.fake.port.readEvidence.bind(t.fake.port);
  t.fake.port.readEvidence = async (ref) => evidence.get(`${ref.artifactId}:${ref.hash}`) ?? loopEvidence(ref);
  t.fake.port.collect = async (envelope, afterSeq): Promise<ExecutionReport> => {
    const { claim, work } = envelope;
    if (work.kind !== "single-call") return loopCollect(envelope, afterSeq);
    let given = byRun.get(claim.runId);
    if (given === undefined) {
      const run = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(claim.runId)!.body)) as { purpose?: string };
      const seen = { runId: claim.runId, purpose: String(run.purpose), prompt: work.prompt, responseSchema: work.responseSchema as Record<string, unknown> };
      calls.push(seen);
      given = answer(seen);
      byRun.set(claim.runId, given);
    }
    const tokens = given.tokens ?? 11_000;
    const events = [{ runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work" as const,
      cumulative: { tokens, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}`, Buffer.from(`usage ${claim.runId}`)) }];
    const outputRef = given.outcome === "complete" ? put(`output-${claim.runId}`, canonicalBytes(given.output ?? {})) : null;
    const record = { schema: "ccloop-single-call-record-v1", promptSha256: sha(Buffer.from(work.prompt, "utf8")), responseSchemaSha256: sha256Canonical(work.responseSchema),
      outcome: given.outcome, outputRef, errorCode: given.outcome === "failed" ? given.errorCode ?? "codex-exit-error" : null };
    const executionId = `execution-${claim.runId}`;
    const candidate: Candidate = { groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
      graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater: 1,
      result: given.outcome === "complete" ? "complete" : "failed", artifacts: outputRef === null ? [] : [outputRef], snapshot: null,
      missing: [], unresolvedRequestIds: [], stopProof: { executionId, generation: claim.generation, isolated: true, source: put(`stop-${claim.runId}`, Buffer.from(`stop ${executionId}`)) },
      terminalOutcome: `single-call-${given.outcome}`, handoff: put(`call-${claim.runId}`, canonicalBytes(record)) };
    return { events: events.filter((event) => event.eventSeq > afterSeq), candidate, terminal: null };
  };
  // The router keeps its own copy of the port's methods: a router over the wrapped port, for every driver of this harness.
  (t.deps as { router: unknown }).router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  return { calls };
}
