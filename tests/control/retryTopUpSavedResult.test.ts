import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { profileSnapshot } from "./fixtures/web.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readFundedAllowance } from "../../src/control/fundedAllowance.js";
import { appendTopUp } from "../../src/control/workTopUp.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { ArtifactRef } from "../../src/control/types.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

/**
 * Retry work top-up spec 2026-11-06 §2 "Saved-result recovery", criterion T11: a recovery of a topped-up task is funded
 * from the sum like any later run -- its run's tokenPolicy names the authored ceiling plus the top-up, and its
 * readFundedAllowance passes (the saved-recovery check compares the policy artifact's confirmed base, unchanged).
 */
const hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/**
 * (Copied from savedResultUnmeteredLineage.test.ts, with a finite task token budget so the top-up's token ceiling shows;
 * a finite remainder is settled by charging it, `charge-remaining-grant`, not released unmetered.)
 * An optional-v1 world whose task has a finite work token budget and whose synthetic ccloop also speaks the saved-result
 * channel: a failed run leaves an execution-format-failure capsule, and a verification run can be interrupted.
 */
async function world() {
  // Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据。」 -- a finite task token budget, its top-up and
  // its saved-result recovery exist only in a group created before the follow-up G release (spec G §2.6, §10.5); since
  // new groups default to the expectation model, this world names that model (`modelVersion: null`).
  const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: null, behaviour: () => "failed", stopReason: () => "provider crashed" });
  const port = t.fake.port as any, evidence = new Map<string, Buffer>();
  const put = (artifactId: string, value: unknown): ArtifactRef => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)), ref = { artifactId, hash: hex(bytes) };
    evidence.set(`${ref.artifactId}:${ref.hash}`, bytes); return ref;
  };
  const identity = (e: StartEnvelope) => ({ groupId: e.claim.groupId, workItemId: e.claim.workItemId, taskId: e.claim.taskId, runId: e.claim.runId, generation: e.claim.generation,
    graphVersion: e.claim.graphVersion, targetVersion: e.claim.targetVersion, executionId: `execution-${e.claim.runId}`, envelopeHash: sha256Canonical(e) });
  const capsules = new Map<string, ArtifactRef>();
  const capsuleOf = (e: StartEnvelope): ArtifactRef => {
    const id = e.claim.runId, known = capsules.get(id); if (known) return known;
    const r = (name: string) => put(`cap-${name}-${id}`, `${name} ${id}`), oid = "1".repeat(40);
    const snapshot = put(`execsnap-${id}`, { schema: "ccloop-execution-snapshot-v1", head: oid, indexTree: oid, indexCommit: oid, bundleRefName: `refs/ccloop/${id}`, index: r("index"), bundle: r("bundle"), status: r("status"), rootMode: 0o755, files: [], directories: [], deleted: [] });
    const names = ["envelope", "config", "acceptedContract", "runtimeContract", "final", "events", "schema", "decodeError", "normalization", "outcome", "process", "plan", "usage", "usageLedger", "owner"];
    const capsule = put(`capsule-${id}`, { schema: "ccloop-execution-format-failure-v1", identity: identity(e), attempt: 1, executor: { kind: "codex", configHash: "c".repeat(64) }, frozenContractHash: e.contractHash,
      acceptedBase: "main", resolvedBase: oid, attemptStartHead: oid, decoder: "strict-execution-v1", classification: "execution-format-failure-v1",
      process: { reason: "completed", code: 0, signal: null, isolated: true }, usage: { tokenUsage: 10, highWater: 1 }, verifier: { entered: false, proof: r("verifier") },
      artifacts: { ...Object.fromEntries(names.map(n => [n, r(n)])), usageObservations: [] }, snapshot,
      completeness: { complete: true, parts: ["original-process", "original-stream", "actual-usage", "successful-plan", "verifier-not-entered", "tree-index-bundle-files"] },
      capturedAt: "2026-10-13T00:00:00.000Z", captureOwner: "fixture" });
    capsules.set(id, capsule); return capsule;
  };
  const verifying = (e: StartEnvelope) => e.mode === "verify-saved-result";
  // A verification run's ccloop died: no terminal until the controller settles it, then an interrupted terminal.
  const settled = new Set<string>();
  // This copy only: whether a failed run loses its work usage (the original always does); the top-up's source run keeps it.
  const loseUsage = { value: true };
  const collect = port.collect.bind(port), readEvidence = port.readEvidence.bind(port), inspect = port.inspect.bind(port);
  port.collect = async (e: StartEnvelope, after: number) => {
    const report = structuredClone(await collect(e, after));
    if (verifying(e) && !settled.has(e.claim.runId)) return { events: [], candidate: null, terminal: null };
    if (report.candidate?.stopProof) report.candidate.stopProof.source = put(`stop-${e.claim.runId}`, { isolated: true, executionId: `execution-${e.claim.runId}`, generation: e.claim.generation, ownerLeaseReleased: true, workerSealed: true });
    if (report.terminal && verifying(e)) report.terminal.stopReason = "saved-result-verification-interrupted";
    // The provider observed one work event, then lost the work usage (reported partial, as unknownFailure does).
    if (loseUsage.value && report.candidate && report.terminal && report.events.length) {
      const first = report.events.find((ev: any) => ev.eventSeq === 1);
      if (first && verifying(e)) first.cumulative = { tokens: 7, activeMs: 3, attempts: 1, sessions: 1 };
      report.events.push({ ...report.events[0]!, eventSeq: 3, bucket: "work", cumulative: null });
      report.candidate.usageHighWater = 3;
    }
    return report;
  };
  port.readEvidence = async (ref: ArtifactRef) => evidence.get(`${ref.artifactId}:${ref.hash}`) ?? readEvidence(ref);
  port.inspect = async (e: StartEnvelope) => verifying(e) && !settled.has(e.claim.runId) ? { kind: "unknown" } : inspect(e);
  port.readFeatures = async () => ({ protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1" });
  port.collectSavedResultEvidence = async (e: StartEnvelope) => ({ schema: "ccloop-saved-result-evidence-v1", identity: identity(e), attempt: 1, capsule: capsuleOf(e), reason: null });
  port.readSavedResultEvidence = async (_e: StartEnvelope, _capsule: ArtifactRef, ref: ArtifactRef) => evidence.get(`${ref.artifactId}:${ref.hash}`)!;
  port.savedResultSourceEligibility = async (input: { source: StartEnvelope; sourceAttempt: number }) => {
    const capsule = capsuleOf(input.source);
    return { status: "eligible", authorityKind: "execution-format-failure-v1", sourceIdentity: identity(input.source), rawExecutionTokens: 10,
      recoveryOf: { sourceRunId: input.source.claim.runId, sourceAttempt: input.sourceAttempt, capsuleHash: capsule.hash, snapshotHash: "2".repeat(64), normalizedExecutionHash: "3".repeat(64) },
      limitation: "published-candidate-only; current membership and settled accounting require controller admission" };
  };
  port.settleSavedResult = async (e: StartEnvelope) => {
    settled.add(e.claim.runId);
    const r = (name: string) => put(`settle-${name}-${e.claim.runId}`, `${name} ${e.claim.runId}`);
    const page = { schema: "ccloop-saved-result-settlement-v1", identity: identity(e), recoveryOf: e.savedResultRecovery!.recoveryOf, disposition: "interrupted", usageStatus: "unknown",
      state: r("state"), lifecycle: r("lifecycle"), accepted: r("accepted"), envelope: r("envelope"), usage: r("usage"), stopProof: r("stop"), usageObservations: [] };
    return { ref: put(`settlement-${e.claim.runId}`, page), settlement: page };
  };
  port.readSavedResultSettlement = async (_e: StartEnvelope, _ref: ArtifactRef, ref: ArtifactRef) => evidence.get(`${ref.artifactId}:${ref.hash}`)!;
  const router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), port)]);
  t.deps.router = router;
  // The verify command reads eligibility and probes through the service's router: the same saved-result-speaking ccloop.
  const service = new WebControlService({ ...(t.service as any).deps, profileRouter: router });
  return { t, service, loseUsage };
}

const release = (t: Harness, service: WebControlService, runId: string) => {
  const c = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
  return withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (service as any).settleUnknownUsage(c));
};
async function verify(t: Harness, service: WebControlService, sourceRunId: string) {
  const evidence = await service.savedResultEligibility(sourceRunId);
  if (evidence.status !== "eligible") throw new Error(JSON.stringify(evidence));
  const c = t.h.taskCommand("verify-saved-result", "a", { sourceRunId, sourceAttempt: 1, capsuleHash: evidence.recoveryOf.capsuleHash });
  const result: any = await service.verifySavedResult(c);
  if (result.result?.kind !== "saved-result-verification-started") throw new Error(JSON.stringify(result));
  return String(result.result.runId);
}
// The group books the conservative non-token charge (ruling 2026-10-13), so a recovery needs group headroom, as the unmetered retry criterion grants.
const raiseLimit = (t: Harness) => {
  const limit = readControlGroup(t.h.store, "epoch", "g").ledger.groupLimit;
  expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, activeMs: limit.activeMs * 4, attempts: limit.attempts * 4, sessions: limit.sessions * 4 } }))).not.toHaveProperty("error");
};

describe("T11: a saved-result recovery after a top-up", () => {
  let oldTmp: string | undefined, short = "";
  beforeEach(() => { oldTmp = process.env.TMPDIR; short = mkdtempSync(join(realpathSync("/private/tmp"), "orca-tus-")); process.env.TMPDIR = short; });
  afterEach(() => { if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp; rmSync(short, { recursive: true, force: true }); });
  it("is funded from the sum, names it as its token ceiling, and its funded-allowance check passes", async () => {
    const { t, service, loseUsage } = await world(); const driver = t.driver(); try {
      const base = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).grant.work.tokens as number;
      expect(base).not.toBeNull();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "blocked");
      expect(await release(t, service, first)).not.toHaveProperty("error");
      raiseLimit(t);
      const owner = { kind: "user" as const, userId: "u-owner", name: "ana", roles: ["owner" as const] };
      // The charge books the run's whole remaining grant onto its lineage, so every dimension needs the top-up.
      const command = t.h.command("retry-task", { taskId: "a", work: { tokens: 1000, activeMs: 1_000_000, attempts: 2, sessions: 2 } } as never);
      const retried = withCommandContext(command.commandId, routedCommandContext("web", owner, { by: "ana", via: "web" }), () => t.service.retryTask(command));
      expect(retried).not.toHaveProperty("error");
      loseUsage.value = false;
      await driver.round();
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      if (claimed.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(claimed)}`);
      const source = claimed.runId;
      await t.until(driver, () => t.body(source).state === "blocked");
      expect(t.body(source).unknown.work).toBe(false);
      const recovery = await verify(t, service, source);
      expect(t.body(recovery).tokenPolicy.authoredTokenCeiling).toBe(base + 1000);
      expect(readFundedAllowance(t.h.store, t.body(recovery))).not.toBeNull();
      expect(readFundedAllowance(t.h.store, t.body(first))).not.toBeNull();
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);
});

/** V1–V9: exercise the real command ledger against a saved-result-speaking synthetic port, without a paid provider. */
describe('verify-only work top-up admission', () => {
  let oldTmp: string | undefined, short = '';
  beforeEach(() => { oldTmp = process.env.TMPDIR; short = mkdtempSync(join(realpathSync('/private/tmp'), 'orca-vtu-')); process.env.TMPDIR = short; });
  afterEach(() => { if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp; rmSync(short, { recursive: true, force: true }); });
  const addition = { tokens: 100_000, activeMs: 1_000_000, attempts: 2, sessions: 2 };
  async function exhaustedAllowance() {
    const { t, service } = await world();
    const first = await t.claim(), driver = t.driver();
    await t.until(driver, () => t.body(first).state === 'blocked');
    expect(await release(t, service, first)).not.toHaveProperty('error');
    raiseLimit(t);
    return { t, service, driver, first };
  }
  async function verifyWith(t: Harness, service: WebControlService, first: string, work?: Record<string, number>, context: {client:string;principal:string;personAuthority?:boolean;dispatchedRun?:string} = {client: 'web', principal: 'user:owner', personAuthority: true}) {
    const eligible = await service.savedResultEligibility(first);
    if (eligible.status !== 'eligible') throw new Error(JSON.stringify(eligible));
    const c = t.h.taskCommand('verify-saved-result', 'a', {sourceRunId: first, sourceAttempt: 1, capsuleHash: eligible.recoveryOf.capsuleHash, ...(work === undefined ? {} : {work})});
    return {c, result: await withCommandContext(c.commandId, context, () => service.verifySavedResult(c))};
  }
  const rows = (t: Harness) => Number(t.h.store.db.prepare('SELECT count(*) AS n FROM work_grant_top_ups').get()!.n);
  const activities = (t: Harness) => Number(t.h.store.db.prepare("SELECT count(*) AS n FROM activity WHERE kind='saved-result-top-up'").get()!.n);

  it('V1: a person funds only the new verification run, keeping the source allowance and failure unchanged', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      const before = JSON.stringify(readFundedAllowance(t.h.store, t.body(first)));
      const {c, result} = await verifyWith(t, service, first, addition);
      expect(result).toHaveProperty('result.kind', 'saved-result-verification-started');
      if (!('result' in result) || result.result.kind !== 'saved-result-verification-started') return;
      const run = t.body(result.result.runId);
      expect(rows(t)).toBe(1);
      expect(readFundedAllowance(t.h.store, run)).not.toBeNull();
      expect(JSON.stringify(readFundedAllowance(t.h.store, t.body(first)))).toBe(before);
      expect(run.tokenPolicy.authoredTokenCeiling).toBe((t.body(first).grant.work.tokens as number) + addition.tokens);
      expect(t.body(first).drive.outcome).toBe('failed');
      expect(await withCommandContext(c.commandId, {client:'web',principal:'user:owner',personAuthority:true}, () => service.verifySavedResult(c))).toEqual(result);
      expect(rows(t)).toBe(1);
      expect(activities(t)).toBe(1);
      expect(readGroupActivity(t.h.store, 'g', 10).find(a => a.kind === 'saved-result-top-up')?.body).toEqual({sourceRunId:first,amount:addition,by:'user:owner',commandId:c.commandId});
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('V2: without work, spent authored work refuses and writes no top-up or run', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      const {result} = await verifyWith(t, service, first);
      expect(result).toHaveProperty('error.message', 'saved-result-unavailable:saved-result-authored-budget-exhausted');
      expect(rows(t)).toBe(0);
      expect(t.h.store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.mode')='verify-saved-result'").all()).toEqual([]);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('V3/V5: an agent without a cap and a dispatched run cannot add work, with booked refusals', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      const agent = await verifyWith(t, service, first, addition, {client:'cli',principal:'agent:cli',personAuthority:false});
      expect(agent.result).toHaveProperty('error.code', 'saved-result-top-up-not-authorized');
      const dispatched = await verifyWith(t, service, first, addition, {client:'cli',principal:'agent:cli',personAuthority:false,dispatchedRun:'run-owner'});
      expect(dispatched.result).toHaveProperty('error.code', 'saved-result-top-up-dispatched-run');
      expect(rows(t)).toBe(0);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('V4: an agent cap counts the group total while a person may still fund verification', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      const command = t.h.rawCommand('set-cap-v4', 0, 'set-orchestration-settings', {kind:'orchestration'}, {maxRunningGroups: 3, agentTopUpCap: {tokens: 100_000, activeMs: 1_000_000, attempts: 2, sessions: 2}});
      expect(t.service.setOrchestrationSettings(command as never)).not.toHaveProperty('error');
      appendTopUp(t.h.store, 'g', 'a', first, {amount:{tokens:60_000,activeMs:0,attempts:0,sessions:0},commandId:'earlier-agent',by:'agent:cli',personAuthority:false,at:1});
      const request = {tokens:50_000,activeMs:1_000_000,attempts:2,sessions:2};
      expect((await verifyWith(t,service,first,request,{client:'cli',principal:'agent:cli'})).result).toHaveProperty('error.code','saved-result-top-up-cap-exceeded');
      expect(rows(t)).toBe(1);
      expect((await verifyWith(t,service,first,request)).result).toHaveProperty('result.kind','saved-result-verification-started');
      expect(rows(t)).toBe(2);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('V8: insufficient group headroom rolls back the appended grant and source release', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      const group=JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      const limit={...group.limit,attempts:group.used.attempts+group.reserved.attempts+addition.attempts-1};
      expect(t.service.setLimit(t.h.command('set-limit',{limit}))).not.toHaveProperty('error');
      const before=JSON.stringify(t.body(first));
      const answer=(await verifyWith(t,service,first,addition)).result;
      expect(answer,JSON.stringify(answer)).toHaveProperty('error.code','saved-result-unavailable');
      expect(answer).toHaveProperty('error.message','saved-result-unavailable:saved-result-authored-budget-exhausted');
      expect(rows(t)).toBe(0);
      expect(JSON.stringify(t.body(first))).toBe(before);
      expect(t.h.store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.mode')='verify-saved-result'").all()).toEqual([]);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('V6: empty and ineffectual grants are refused by name', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      expect((await verifyWith(t, service, first, {})).result).toHaveProperty('error.code', 'saved-result-top-up-empty');
      const task = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      task.grant.work.tokens = null;
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(task));
      expect((await verifyWith(t, service, first, {tokens: 1})).result).toHaveProperty('error.code', 'saved-result-top-up-no-effect');
      expect(rows(t)).toBe(0);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('V7: a finite-legacy policy refuses a verification top-up without changing the grant', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      t.h.store.db.prepare("UPDATE token_policies SET mode='finite-legacy' WHERE group_id='g' AND work_item_id='a'").run();
      const grant=JSON.stringify(t.body(first).grant);
      const answer=(await verifyWith(t,service,first,addition)).result;
      expect(answer,JSON.stringify(answer)).toHaveProperty('error.code','saved-result-top-up-unsupported');
      expect(rows(t)).toBe(0);
      expect(JSON.stringify(t.body(first).grant)).toBe(grant);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);

  it('rejects a forged source attempt before adding a work grant', async () => {
    const {t, service, driver, first} = await exhaustedAllowance(); try {
      const evidence = await service.savedResultEligibility(first);
      if(evidence.status!=='eligible')throw Error(JSON.stringify(evidence));
      const c=t.h.taskCommand('verify-saved-result','a',{sourceRunId:first,sourceAttempt:2,capsuleHash:evidence.recoveryOf.capsuleHash,work:addition});
      expect(await withCommandContext(c.commandId,{client:'web',principal:'user:owner',personAuthority:true},()=>service.verifySavedResult(c))).toHaveProperty('error.code','saved-result-source-stale');
      expect(rows(t)).toBe(0);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 60_000);
});
