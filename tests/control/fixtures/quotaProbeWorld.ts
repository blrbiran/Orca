import { createHash } from "node:crypto";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import type { ExecutionReport } from "../../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { REST_DEFAULT_MS } from "../../../src/control/quotaRest.js";
import type { ArtifactRef, Candidate } from "../../../src/control/types.js";
import { readWebGroup } from "../../../src/control/webService.js";
import { driverHarness } from "./driverHarness.js";
import type { WebFixtureTask } from "./web.js";
import { profileSnapshot } from "./web.js";

/**
 * Tester #348: a group in which a quota-failed task's installation rested and Orca's probe call ran (quota rest probe spec
 * 2026-11-06 §2) -- the shape tests/control/quotaRestProbe.test.ts drives, trimmed to what a reader of the group needs:
 * every task in `failing` fails with ccloop's typed quota cause; each probe call is answered from `answers`, in order.
 */
export type ProbeAnswer = { outcome: "complete" | "failed" | "aborted"; failureCause?: { cause: string; detail: string | null }; errorCode?: string | null; tokens?: number | null };
const QUOTA = { cause: "quota", phase: "plan" as const, retries: 0, detail: "You've hit your usage limit" };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function quotaProbeWorld(options: { tasks: WebFixtureTask[]; failing: string[]; answers?: ProbeAnswer[] }) {
  const clock = { value: Date.UTC(2026, 10, 18, 12, 0, 0) };
  const failing = new Set(options.failing);
  const t = await driverHarness(options.tasks, {
    storeNow: () => clock.value,
    behaviour: (id) => (failing.has(id) ? "failed" : "succeed"),
    failure: (id) => (failing.has(id) ? { failureCause: QUOTA } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const answers = [...(options.answers ?? [{ outcome: "complete" }])];
  const byRun = new Map<string, ProbeAnswer>();
  const evidence = new Map<string, Buffer>();
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => { const ref = { artifactId, hash: sha(bytes) }; evidence.set(`${artifactId}:${ref.hash}`, bytes); return ref; };
  const loopCollect = t.fake.port.collect.bind(t.fake.port), loopEvidence = t.fake.port.readEvidence.bind(t.fake.port);
  t.fake.port.readEvidence = async (ref) => evidence.get(`${ref.artifactId}:${ref.hash}`) ?? loopEvidence(ref);
  t.fake.port.collect = async (envelope, afterSeq): Promise<ExecutionReport> => {
    const { claim, work } = envelope;
    if (work.kind !== "single-call") return loopCollect(envelope, afterSeq);
    let answer = byRun.get(claim.runId);
    if (answer === undefined) { answer = answers.shift() ?? { outcome: "complete" }; byRun.set(claim.runId, answer); }
    const tokens = answer.tokens === undefined ? 11_000 : answer.tokens;
    const events = [{ runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work" as const,
      cumulative: tokens === null ? null : { tokens, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}`, Buffer.from(`usage ${claim.runId}`)) }];
    const outputRef = answer.outcome === "complete" ? put(`output-${claim.runId}`, canonicalBytes({ ok: true })) : null;
    const record = { schema: "ccloop-single-call-record-v1", promptSha256: sha(Buffer.from(work.prompt, "utf8")), responseSchemaSha256: sha256Canonical(work.responseSchema),
      outcome: answer.outcome, outputRef, errorCode: answer.outcome === "failed" ? answer.errorCode ?? "codex-exit-error" : null, ...(answer.failureCause === undefined ? {} : { failureCause: answer.failureCause }) };
    const executionId = `execution-${claim.runId}`;
    const candidate: Candidate = { groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
      graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater: 1,
      result: answer.outcome === "complete" ? "complete" : answer.outcome === "aborted" ? "partial" : "failed", artifacts: outputRef === null ? [] : [outputRef], snapshot: null,
      missing: [], unresolvedRequestIds: [], stopProof: { executionId, generation: claim.generation, isolated: true, source: put(`stop-${claim.runId}`, Buffer.from(`stop ${executionId}`)) },
      terminalOutcome: `single-call-${answer.outcome}`, handoff: put(`call-${claim.runId}`, canonicalBytes(record)) };
    return { events: events.filter((event) => event.eventSeq > afterSeq), candidate, terminal: null };
  };
  (t.deps as { router: unknown }).router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  const failed: Record<string, string> = {};
  for (const _ of failing) {
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "blocked");
    failed[(t.body(runId) as { taskId: string }).taskId] = runId;
  }
  const db = t.h.store.db;
  const probes = () => db.prepare("SELECT id, work_item_id, body FROM runs WHERE json_extract(body,'$.purpose')='quota-probe' ORDER BY rowid").all()
    .map((row) => ({ runId: String(row.id), workItemId: String(row.work_item_id), body: JSON.parse(String(row.body)) as Record<string, unknown> }));
  /** One system pass, then the driver until no probe is active. */
  const pass = async () => {
    await t.service.systemDebugPass();
    const driver = t.driver();
    for (let i = 0; i < 40 && db.prepare("SELECT 1 FROM runs WHERE json_extract(body,'$.purpose')='quota-probe' AND active=1 AND json_extract(body,'$.state')!='blocked'").get() !== undefined; i += 1) await driver.round();
  };
  return { t, clock, failed, probes, pass, restEnds: () => { clock.value += REST_DEFAULT_MS + 60_000; } };
}
