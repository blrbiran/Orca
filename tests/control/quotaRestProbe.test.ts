import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import type { ExecutionReport } from "../../src/control/executionPort.js";
import { installationRests, REST_DEFAULT_MS } from "../../src/control/quotaRest.js";
import { quotaProbeWorkItemId } from "../../src/control/quotaProbeCall.js";
import { quotaProbeCandidates } from "../../src/control/systemDebug.js";
import { readWebGroup } from "../../src/control/webService.js";
import type { ArtifactRef, Candidate } from "../../src/control/types.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";

/**
 * Quota rest probe spec 2026-11-06 §2, §5 (human: 「可以先跑一个测试限额是否恢复的小探针run，再决定正式run是否跑」 and
 * 「都同意按你的建议走」): a quota-failed task failover did not move stays with the person today. Once its installation's
 * rest ends, Orca sends one small probe call there -- on a work item of its own, funded by the group -- and retries the
 * task on the same installation only when the provider answered. A probe that hit quota again starts the next rest; any
 * other failure (including a ccloop that names no typed cause) leaves the task for the person and says why.
 */
type ProbeAnswer = { outcome: "complete" | "failed" | "aborted"; failureCause?: { cause: string; detail: string | null }; errorCode?: string | null; tokens?: number | null };
const QUOTA = { cause: "quota", phase: "plan" as const, retries: 0, detail: "You've hit your usage limit" };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function world(options: { tasks?: string[]; answers?: ProbeAnswer[] } = {}) {
  const clock = { value: Date.UTC(2026, 10, 6, 12, 0, 0) };
  const failing = new Set(options.tasks ?? ["a"]);
  // The plan names codex for every task: a statement failover never switches (D2), so the probe is the task's only way back.
  const t = await driverHarness([...failing].map((taskId) => ({ taskId, agent: { agent: "codex" } })), {
    storeNow: () => clock.value,
    behaviour: (id) => (failing.has(id) ? "failed" : "succeed"),
    failure: (id) => (failing.has(id) ? { failureCause: QUOTA } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  // The fixture port answers loop work only; a probe's single call is answered from `answers`, in order.
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
  // The router keeps its own copy of the port's methods: a router over the wrapped port, for every driver of this world.
  (t.deps as { router: unknown }).router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  const failed: Record<string, string> = {};
  for (const taskId of failing) {
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "blocked");
    failed[(t.body(runId) as { taskId: string }).taskId] = runId;
  }
  const db = t.h.store.db;
  const probes = () => db.prepare("SELECT id, work_item_id, body FROM runs WHERE json_extract(body,'$.purpose')='quota-probe' ORDER BY rowid").all()
    .map((row) => ({ runId: String(row.id), workItemId: String(row.work_item_id), body: JSON.parse(String(row.body)) as Record<string, unknown> }));
  const retries = () => db.prepare("SELECT id, original_status AS status FROM commands WHERE group_id='g' AND id LIKE 'orca-auto-quota-probe-retry-%' ORDER BY rowid").all().map((r) => [String(r.id), Number(r.status)]);
  const notes = () => db.prepare("SELECT run_id, body FROM activity WHERE kind='quota-probe' ORDER BY seq").all().map((r) => ({ runId: String(r.run_id), ...JSON.parse(String(r.body)) }));
  /** One pass, then the driver until no probe is active. */
  const pass = async () => {
    await t.service.systemDebugPass();
    const driver = t.driver();
    for (let i = 0; i < 40 && db.prepare("SELECT 1 FROM runs WHERE json_extract(body,'$.purpose')='quota-probe' AND active=1 AND json_extract(body,'$.state')!='blocked'").get() !== undefined; i += 1) await driver.round();
  };
  return { t, clock, failed, probes, retries, notes, pass, restEnds: () => { clock.value += REST_DEFAULT_MS + 60_000; } };
}

describe("quota rest probe (spec 2026-11-06 §5)", { timeout: 180_000 }, () => {
  it("P1: rest ended, failover did not move the task: one probe on its own work item, then one retry on the installation, which applies", async () => {
    const w = await world(); try {
      const runId = w.failed.a!;
      w.restEnds();
      await w.pass();
      const [probe, ...more] = w.probes();
      expect(more).toEqual([]);
      expect({ state: probe!.body.state, reason: (probe!.body.drive as { blockedReason?: string }).blockedReason }).toEqual({ state: "settled-restartable", reason: null });
      expect(probe).toMatchObject({ workItemId: quotaProbeWorkItemId("codex", runId), body: { taskId: null, agent: { agent: "codex" }, probeVerdict: { verdict: "back" } } });
      expect(w.retries()).toEqual([]);
      await w.pass();
      expect(w.retries()).toEqual([[`orca-auto-quota-probe-retry-a-${runId}`, 200]]);
      const work = JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      expect(work.agent.agent).toBe("codex");
    } finally { await w.t.h.dispose(); }
  });

  it("P2: still resting -- no probe", async () => {
    const w = await world(); try {
      await w.pass();
      expect(w.probes()).toEqual([]);
      expect(w.retries()).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("P3: a switchable task with a target and no failover command is failover's; one whose failover was refused is the probe's", async () => {
    const w = await world(); try {
      const runId = w.failed.a!, db = w.t.h.store.db;
      const work = JSON.parse(String(db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, agentProvenance: { ...work.agentProvenance, agent: "operator" } }));
      const read = (unmoved: string[]) => quotaProbeCandidates(w.t.h.store, { waiting: new Set(), resting: new Set(), unmoved: new Set(unmoved) }).map((c) => c.runId);
      expect(read([])).toEqual([]);
      expect(read([runId])).toEqual([runId]);
      const row = db.prepare("SELECT * FROM commands WHERE group_id='g' ORDER BY rowid DESC LIMIT 1").get()!;
      const columns = Object.keys(row);
      db.prepare(`INSERT INTO commands(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((c) => c === "id" ? `orca-auto-failover-a-${runId}` : c === "original_status" ? 409 : row[c] as never));
      expect(read([])).toEqual([runId]);
    } finally { await w.t.h.dispose(); }
  });

  it("P5, P9: a probe that hits quota again sends no retry and starts the next rest from the probe; at its end a second probe runs", async () => {
    const w = await world({ answers: [{ outcome: "failed", failureCause: { cause: "quota", detail: "You've hit your usage limit" } }, { outcome: "complete" }] }); try {
      w.restEnds();
      await w.pass(); await w.pass();
      const [first] = w.probes();
      expect(first!.body).toMatchObject({ probeVerdict: { verdict: "quota" } });
      expect(w.retries()).toEqual([]);
      expect(installationRests(w.t.h.store, w.clock.value).get("codex")).toMatchObject({ runId: first!.runId });
      w.clock.value += 2 * REST_DEFAULT_MS + 60_000;
      await w.pass();
      expect(w.probes().map((p) => p.workItemId)).toEqual([quotaProbeWorkItemId("codex", w.failed.a!), quotaProbeWorkItemId("codex", first!.runId)]);
    } finally { await w.t.h.dispose(); }
  });

  it("P6, P19: a probe that fails otherwise -- auth, or no typed cause from an older ccloop -- sends no retry, never probes again, and says why on the task", async () => {
    for (const answer of [{ outcome: "failed" as const, failureCause: { cause: "auth", detail: "last status: 401" } }, { outcome: "failed" as const }]) {
      const w = await world({ answers: [answer] }); try {
        w.restEnds();
        await w.pass(); await w.pass(); await w.pass();
        const probes = w.probes();
        expect(probes).toHaveLength(1);
        expect(w.retries()).toEqual([]);
        expect(w.notes()).toEqual([{ runId: w.failed.a, reason: "quota-probe-failed", probeRunId: probes[0]!.runId, cause: answer.failureCause?.cause ?? null, errorCode: "codex-exit-error" }]);
      } finally { await w.t.h.dispose(); }
    }
  });

  it("P7, P10: two passes at one rest end and two scoped tasks: one probe run, one retry row per task", async () => {
    const w = await world({ tasks: ["a", "b"] }); try {
      // Two quota failures in a row: the rest doubles to 30 minutes.
      w.clock.value += 2 * REST_DEFAULT_MS + 60_000;
      // Two passes before the driver runs: the second finds the first's probe pending on its work item.
      await w.t.service.systemDebugPass();
      await w.pass(); await w.pass(); await w.pass();
      expect(w.probes()).toHaveLength(1);
      expect(w.retries().map(([id]) => id).sort()).toEqual([`orca-auto-quota-probe-retry-a-${w.failed.a}`, `orca-auto-quota-probe-retry-b-${w.failed.b}`].sort());
    } finally { await w.t.h.dispose(); }
  });

  it("P15, P16: an aborted probe is not an outcome (the key probes again); an output-invalid probe means the quota is back", async () => {
    const w = await world({ answers: [{ outcome: "aborted" }, { outcome: "failed", errorCode: "single-call-output-invalid" }] }); try {
      w.restEnds();
      await w.pass(); await w.pass();
      const probes = w.probes();
      expect(probes.map((p) => p.workItemId)).toEqual([quotaProbeWorkItemId("codex", w.failed.a!), quotaProbeWorkItemId("codex", w.failed.a!)]);
      await w.pass();
      expect(w.retries()).toEqual([[`orca-auto-quota-probe-retry-a-${w.failed.a}`, 200]]);
    } finally { await w.t.h.dispose(); }
  });

  it("P4: an installation set to wait keeps the quota-wait retry -- no probe", async () => {
    const w = await world(); try {
      const revision = Number(w.t.h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0);
      const set = w.t.service.setOrchestrationSettings(w.t.h.rawCommand("wait", revision, "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, quotaWait: ["codex"] }) as never);
      expect("error" in (set as object)).toBe(false);
      w.restEnds();
      await w.pass();
      expect(w.probes()).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("P17: a run on the installation succeeded after the failure -- the retry is sent at once, with no probe", async () => {
    const w = await world(); try {
      const db = w.t.h.store.db, failedBody = w.t.body(w.failed.a!) as Record<string, unknown>;
      db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-elsewhere','g','elsewhere',1,0,?)")
        .run(JSON.stringify({ runId: "run-elsewhere", agent: failedBody.agent, endedAt: w.clock.value + 60_000, drive: { outcome: "succeeded" } }));
      w.clock.value += 120_000;
      await w.pass();
      expect(w.probes()).toEqual([]);
      expect(w.retries()).toEqual([[`orca-auto-quota-probe-retry-a-${w.failed.a}`, 200]]);
    } finally { await w.t.h.dispose(); }
  });

  const limitTokens = (w: Awaited<ReturnType<typeof world>>, headroom: number) => {
    const group = readWebGroup(w.t.h.store, "g");
    const used = group.ledger.used.tokens + group.ledger.committedRemaining.tokens;
    const raised = w.t.service.setLimit(w.t.h.command("set-limit", { limit: { ...group.ledger.groupLimit, tokens: used + headroom } }));
    if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  };
  const taskRuns = (w: Awaited<ReturnType<typeof world>>) => Number(w.t.h.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id='g' AND work_item_id='a'").get()!.n);

  it("P8: a paused group gets no probe; a group paused after its probe answered gets no retry", async () => {
    const before = await world(); try {
      expect(await before.t.service.pauseDispatch(before.t.h.command("pause-dispatch", {}))).toMatchObject({ result: { kind: "paused" } });
      before.restEnds();
      await before.pass();
      expect(before.probes()).toEqual([]);
    } finally { await before.t.h.dispose(); }
    const after = await world(); try {
      after.restEnds();
      await after.pass();
      expect(after.probes()).toHaveLength(1);
      expect(await after.t.service.pauseDispatch(after.t.h.command("pause-dispatch", {}))).toMatchObject({ result: { kind: "paused" } });
      await after.pass();
      expect(after.retries()).toEqual([]);
    } finally { await after.t.h.dispose(); }
  });

  it("P12: a limited group without room for the grant is not probed, and the task says why", async () => {
    const w = await world(); try {
      limitTokens(w, 10_000);
      w.restEnds();
      await w.pass();
      expect(w.probes()).toEqual([]);
      expect(w.notes()).toEqual([{ runId: w.failed.a, reason: "quota-probe-unfunded:tokens", key: quotaProbeWorkItemId("codex", w.failed.a!) }]);
    } finally { await w.t.h.dispose(); }
  });

  it("P13: a probe over its grant in a limited group never blocks the group", async () => {
    const w = await world({ answers: [{ outcome: "complete", tokens: 60_000 }] }); try {
      limitTokens(w, 500_000);
      w.restEnds();
      const status = readWebGroup(w.t.h.store, "g").status;
      await w.pass();
      expect(w.probes()[0]!.body).toMatchObject({ breaches: [1], probeVerdict: { verdict: "back" } });
      expect(readWebGroup(w.t.h.store, "g").status).toBe(status);
    } finally { await w.t.h.dispose(); }
  });

  it("P14: a person retries the task while the probe runs -- orca-auto adds no second retry and no second run", async () => {
    const w = await world(); try {
      w.restEnds();
      await w.t.service.systemDebugPass();
      expect(w.probes()).toHaveLength(1);
      expect(w.t.service.retryTask(w.t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      await w.pass(); await w.pass();
      const sent = w.retries();
      expect(sent.every(([, status]) => Number(status) >= 400)).toBe(true);
      await w.t.claim();
      expect(taskRuns(w)).toBe(2);
    } finally { await w.t.h.dispose(); }
  });

  it("gap 5: a probe refused for quota with unknown usage books 0 and completes in a limited group; unknown usage for another cause stays blocked", async () => {
    const quota = await world({ answers: [{ outcome: "failed", failureCause: { cause: "quota", detail: "You've hit your usage limit" }, tokens: null }] }); try {
      limitTokens(quota, 500_000);
      quota.restEnds();
      await quota.pass();
      const [probe] = quota.probes();
      expect(probe!.body).toMatchObject({ state: "settled-restartable", unknown: { work: false }, cumulative: { work: { tokens: 0 } }, probeVerdict: { verdict: "quota" } });
      expect(readWebGroup(quota.t.h.store, "g").ledger.usageUnknown).toBe(false);
    } finally { await quota.t.h.dispose(); }
    const auth = await world({ answers: [{ outcome: "failed", failureCause: { cause: "auth", detail: "last status: 401" }, tokens: null }] }); try {
      limitTokens(auth, 500_000);
      auth.restEnds();
      await auth.pass();
      expect(auth.probes()[0]!.body).toMatchObject({ state: "blocked", drive: { blockedReason: "quota-probe-usage-unknown:codex-exit-error" }, probeVerdict: { verdict: "failed", cause: "auth" } });
    } finally { await auth.t.h.dispose(); }
  });

  it("P18: a completed probe ends the streak -- the next quota failure on the installation rests 15 minutes, not 30", async () => {
    const w = await world(); try {
      w.restEnds();
      await w.pass(); await w.pass();
      const retried = await w.t.claim();
      await w.t.until(w.t.driver(), () => w.t.body(retried).state === "blocked");
      const rest = installationRests(w.t.h.store, w.clock.value).get("codex")!;
      expect(rest.runId).toBe(retried);
      expect(rest.until - w.clock.value).toBe(REST_DEFAULT_MS);
    } finally { await w.t.h.dispose(); }
  });
});
