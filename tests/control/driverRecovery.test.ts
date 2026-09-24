import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { applyPanelShutdown } from "../../src/panel/controlLifecycle.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";

// Execution driver spec §4 and §2.3. Each switch is judged on both sides: on (a driver exists) and off
// (today's behaviour, byte for byte -- deviation D7).

async function claimedSoft() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: "soft" }));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
  return { h, service, runId: claim.runId };
}

type SqlArg = string | number | bigint | null | Buffer;
const count = (h: Awaited<ReturnType<typeof webFixture>>, sql: string, ...args: SqlArg[]) => Number(h.store.db.prepare(sql).get(...args)!.n);

describe("startup recovery and driver-owned runs (spec §4)", () => {
  it("leaves a Web work run to the driver when the driver exists: not blocked, no recovery error, dispatch open", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await recoverControl(h.store, {} as never, undefined, { driverOwnsWebRuns: true });
      expect(result.blockedRunIds).toEqual([]);
      expect(h.store.dispatchBlocked).toBe(false);
      expect(count(h, "SELECT COUNT(*) AS n FROM outbox WHERE id=?", `recovery-error:${runId}`)).toBe(0);
    } finally { await h.dispose(); }
  });

  it("blocks it exactly as before when no driver exists", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await recoverControl(h.store, {} as never);
      expect(result.blockedRunIds).toEqual([runId]);
      expect(h.store.dispatchBlocked).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("panel shutdown and driver-owned runs (spec §4)", () => {
  const window = { epoch: "epoch-driver", now: () => new Date("2026-09-25T00:00:00.000Z"), shutdownGraceMs: 1_000 };

  it("freezes no driver-owned run and writes no handoff request for it when the driver exists", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate, ...window, exemptDriverRuns: true });
      const entry = (result.result as { kind: "shutdown"; groups: Array<{ groupId: string; frozenRunIds: string[] }> }).groups.find((group) => group.groupId === "g")!;
      expect(entry.frozenRunIds).toEqual([]);
      expect(count(h, "SELECT COUNT(*) AS n FROM handoff_requests WHERE run_id=?", runId)).toBe(0);
      expect(count(h, "SELECT COUNT(*) AS n FROM outbox WHERE kind='handoff-request'")).toBe(0);
    } finally { await h.dispose(); }
  });

  it("freezes it exactly as before when no driver exists", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate, ...window });
      const entry = (result.result as { kind: "shutdown"; groups: Array<{ groupId: string; frozenRunIds: string[] }> }).groups.find((group) => group.groupId === "g")!;
      expect(entry.frozenRunIds).toEqual([runId]);
      expect(count(h, "SELECT COUNT(*) AS n FROM handoff_requests WHERE run_id=?", runId)).toBe(1);
    } finally { await h.dispose(); }
  });
});

describe("a person's recovery-retry on a blocked driver run (spec §2.3)", () => {
  it("sends the run back to the step it was blocked at and reports it resolved", async () => {
    const { h, service, runId } = await claimedSoft(); try {
      const row = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
      const body = JSON.parse(String(row.body));
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "blocked", providerAttemptOrdinal: 1, drive: {
        workspaceMode: "worktree", sourceDir: "/x/s", workspacePath: "/x/w", targetRepo: null, prepared: true, base: null, envelopeHash: null, inspectUnknown: 10,
        outcome: null, attemptSha: null, landedCommit: null, reconcile: null, blockedAt: "B'", blockedReason: "inspect-unknown", cleanedUp: false,
      } }), runId);
      const retried = await service.recoveryRetry(h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body))).toMatchObject({ state: "unknown", drive: { blockedAt: null, blockedReason: null, inspectUnknown: 0 } });
    } finally { await h.dispose(); }
  });

  it("resumes a driver run to its blocked step even when a run-level blocker was already resolved (evaluation order, ruling P1)", async () => {
    // Review round 1, Important 1: a short-circuited `blockers.resolved || rearm !== null || resumeBlockedDriverRun(...)`
    // never calls `resumeBlockedDriverRun` once `blockers.resolved` is already true -- so a run that has BOTH a
    // resolved run-level blocker AND a driver `blockedAt` must still get its driver state resumed.
    const { h, service, runId } = await claimedSoft(); try {
      const row = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
      const body = JSON.parse(String(row.body));
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "blocked", providerAttemptOrdinal: 1, drive: {
        workspaceMode: "worktree", sourceDir: "/x/s", workspacePath: "/x/w", targetRepo: null, prepared: true, base: null, envelopeHash: null, inspectUnknown: 10,
        outcome: null, attemptSha: null, landedCommit: null, reconcile: null, blockedAt: "B'", blockedReason: "inspect-unknown", cleanedUp: false,
      } }), runId);
      h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,?,?,?)")
        .run(`test-run-blocker:${runId}`, "g", runId, "run", "test-run-blocker", JSON.stringify({ evidenceIds: [] }));
      const retried = await service.recoveryRetry(h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      // `blockers.resolved` alone already makes this true; the load-bearing assertion is the drive state below.
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body))).toMatchObject({ state: "unknown", drive: { blockedAt: null, blockedReason: null, inspectUnknown: 0 } });
    } finally { await h.dispose(); }
  });

  it("reports nothing resolved, and changes nothing, for a run that is not blocked", async () => {
    const { h, service, runId } = await claimedSoft(); try {
      const before = String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body);
      const retried = await service.recoveryRetry(h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: false } });
      expect(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).toBe(before);
    } finally { await h.dispose(); }
  });

  it("drives a retried run on from where it was blocked, to settled", async () => {
    let mode: FakeBehaviour = "unknown";
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => mode }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      mode = "succeed";
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).state).toBe("settled");
      expect(t.fake.calls.accept).toHaveLength(2);
    } finally { await t.h.dispose(); }
  });
});
