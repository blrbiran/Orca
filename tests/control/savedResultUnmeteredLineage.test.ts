import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { profileSnapshot } from "./fixtures/web.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { ArtifactRef } from "../../src/control/types.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

// Human ruling 2026-10-13: a task lineage inherits only provider-observed usage, never the conservative charge an owner's
// unmetered release (settle-unknown-usage, acknowledge "release-unmetered") books. The saved-result admission sums the
// lineage in two places (savedResultRecovery.ts): from the source run when no recovery precedes it, and from the
// interrupted predecessor recovery otherwise. Each `it` pins one of them against the observed usage as literals.

const hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/**
 * An optional-v1 world whose task has an unlimited work token budget and whose synthetic ccloop also speaks the saved-result
 * channel: a failed run leaves an execution-format-failure capsule, and a verification run can be interrupted.
 */
async function world() {
  const t = await driverHarness([{ taskId: "a", tokenBudget: null } as never], { tokenPolicy: "optional-v1", behaviour: () => "failed", stopReason: () => "provider crashed" });
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
  const collect = port.collect.bind(port), readEvidence = port.readEvidence.bind(port), inspect = port.inspect.bind(port);
  port.collect = async (e: StartEnvelope, after: number) => {
    const report = structuredClone(await collect(e, after));
    if (verifying(e) && !settled.has(e.claim.runId)) return { events: [], candidate: null, terminal: null };
    if (report.candidate?.stopProof) report.candidate.stopProof.source = put(`stop-${e.claim.runId}`, { isolated: true, executionId: `execution-${e.claim.runId}`, generation: e.claim.generation, ownerLeaseReleased: true, workerSealed: true });
    if (report.terminal && verifying(e)) report.terminal.stopReason = "saved-result-verification-interrupted";
    // The provider observed one work event, then lost the work usage (reported partial, as unknownFailure does).
    if (report.candidate && report.terminal && report.events.length) {
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
  return { t, service };
}

const release = (t: Harness, service: WebControlService, runId: string) => {
  const c = t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "release-unmetered" });
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

describe("a saved-result lineage after an unmetered release inherits observed usage only", () => {
  // Recovery packages refuse a path that is not its own realpath (savedResultRecoveryPackage.ts); macOS's default TMPDIR is a symlink.
  let oldTmp: string | undefined, short = "";
  beforeEach(() => { oldTmp = process.env.TMPDIR; short = mkdtempSync(join(realpathSync("/private/tmp"), "orca-srl-")); process.env.TMPDIR = short; });
  afterEach(() => { if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp; rmSync(short, { recursive: true, force: true }); });
  it("admits a recovery of a released source run with the source's observed work usage, not its charge", async () => {
    const { t, service } = await world(); const driver = t.driver(); try {
      const source = await t.claim();
      await t.until(driver, () => t.body(source).state === "blocked");
      expect(t.body(source).savedSource).toMatchObject({ authorityKind: "execution-format-failure-v1" });
      expect(t.body(source).unknown.work).toBe(true);
      expect(t.body(source).cumulative.work).toEqual({ tokens: 10, activeMs: 5, attempts: 1, sessions: 1 });
      expect(await release(t, service, source)).not.toHaveProperty("error");
      // The release books the conservative non-token remainder onto the run's cumulative work; the lineage must not.
      expect(t.body(source).usageSettlement).toMatchObject({ method: "owner-acknowledged-unmetered", charged: { work: { tokens: null, activeMs: 14_399_995, attempts: 2, sessions: 2 } } });
      raiseLimit(t);
      const recovery = await verify(t, service, source);
      expect(t.body(recovery).savedRecovery.predecessor).toBeNull();
      expect(t.body(recovery).savedRecovery.funding.inheritedUsage).toEqual({ tokens: 10, activeMs: 5, attempts: 1, sessions: 1 });
      expect(t.body(recovery).tokenPolicy.inheritedUsage).toEqual({ tokens: 10, activeMs: 5, attempts: 1, sessions: 1 });
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30_000);

  it("admits a recovery after an interrupted, released recovery with both runs' observed work usage, not their charges", async () => {
    const { t, service } = await world(); const driver = t.driver(); try {
      const source = await t.claim();
      await t.until(driver, () => t.body(source).state === "blocked");
      expect(await release(t, service, source)).not.toHaveProperty("error");
      raiseLimit(t);
      const first = await verify(t, service, source);
      await t.until(driver, () => t.body(first).state === "blocked");
      expect(t.body(first).drive.stopReason).toBe("saved-result-verification-interrupted");
      expect(t.body(first).unknown.work).toBe(true);
      expect(t.body(first).cumulative.work).toEqual({ tokens: 7, activeMs: 3, attempts: 1, sessions: 1 });
      expect(await release(t, service, first)).not.toHaveProperty("error");
      expect(t.body(first).usageSettlement).toMatchObject({ method: "owner-acknowledged-unmetered", charged: { work: { tokens: null, activeMs: 14_399_992, attempts: 1, sessions: 1 } } });
      expect(t.body(first).savedInterruption).toBeTruthy();
      raiseLimit(t);
      const second = await verify(t, service, source);
      expect(t.body(second).savedRecovery.predecessor).toMatchObject({ runId: first, outcome: "interrupted" });
      // Source observed {10,5,1,1}, the interrupted recovery observed {7,3,1,1}: neither run's release charge is inherited.
      expect(t.body(second).savedRecovery.funding.inheritedUsage).toEqual({ tokens: 17, activeMs: 8, attempts: 2, sessions: 2 });
      expect(t.body(second).tokenPolicy.inheritedUsage).toEqual({ tokens: 17, activeMs: 8, attempts: 2, sessions: 2 });
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30_000);

  // ccloop error codes spec (2026-10-15) §4.3, criterion 4: the saved-result `unavailable` reason names ccloop's code.
  it("names ccloop's code when the saved-result eligibility read fails with a peer exit", async () => {
    const { t, service } = await world(); const driver = t.driver(); try {
      const source = await t.claim();
      await t.until(driver, () => t.body(source).state === "blocked");
      expect(await release(t, service, source)).not.toHaveProperty("error");
      const failing = { ...(t.fake.port as object), readFeatures: async () => { throw new ControlError("control-peer-exit", "2:control-features-failed: lost"); } };
      const failingService = new WebControlService({ ...(t.service as any).deps, profileRouter: createExecutionProfileRouter([resolveProfile(profileSnapshot(), failing as never)]) });
      expect(await failingService.savedResultEligibility(source)).toEqual({ status: "unavailable", reason: "control-features-failed" });
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30_000);
});
