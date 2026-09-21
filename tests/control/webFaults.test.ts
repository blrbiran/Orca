/**
 * Task 10 step 3: the commit boundaries a crash can land on.
 *
 * Several boundaries have a production hook (`beforeCommit` -- the instant just before a write
 * transaction is made durable) and arm a fault there: if the process dies at that line, nothing
 * may be half-booked, and the identical command issued again has to produce exactly one effect.
 * The boundaries without a hook are the ones where the request is already durable and the
 * scheduler has not run yet, so the crash point is reached by simply not delivering: the ledger
 * has to be complete, and delivery has to be repeatable. Both halves are read back from the same
 * tables the production dispatcher consumes, never from a returned body.
 */
import { describe, expect, it } from "vitest";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { importControlPlan } from "../../src/control/planImport.js";
import { acceptContextObservation } from "../../src/control/contextControl.js";
import { beginProviderAttempt, deliverScheduledStart, recordProofAck, recoverAttempt } from "../../src/control/webDispatch.js";
import { recoverControl } from "../../src/control/recovery.js";
import { WebControlService } from "../../src/control/webService.js";
import { applyPanelShutdown, runControlPanelStartup, shutdownCommandId } from "../../src/panel/controlLifecycle.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
import type { ControlStore } from "../../src/control/store.js";

const ACCEPTED_AT = "2026-09-20T10:00:00.000Z";
const hash64 = (seed: string) => sha256Canonical({ seed });

/** Arm the fault at the commit boundary; clearing it lets the very same command through. */
function commitFault() {
  let armed = false;
  return {
    arm: () => { armed = true; },
    clear: () => { armed = false; },
    hook: () => { if (armed) throw new Error("fault-before-commit"); },
  };
}

const count = (store: ControlStore, table: string, where = "") =>
  Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where === "" ? "" : ` WHERE ${where}`}`).get()!.n);

const estimateOutput = (planHash: string) => ({
  schema: "budget-estimate-v1", planHash,
  tasks: [{ taskId: "a", complexity: "M" as const, confidence: "high" as const, work: { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean tree"] }],
  goalReviewReserve: { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 }, groupRationale: "small",
});

const proposalBody = (store: ControlStore): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM budget_proposals WHERE group_id=?").get("g")!.body)) as Record<string, unknown>;

/** A confirmed group whose single ready task has been claimed by the real dispatcher. */
function contextCapableSnapshot() {
  const snapshot = structuredClone(profileSnapshot());
  snapshot.profile.capabilities.contextObservation = "realtime";
  snapshot.profile.contextTokenizer = { tokenizerId: "tiktoken-lite", tokenizerVersion: "1" };
  snapshot.resolved.tokenizerArtifactHashes = [{ purpose: "context", contentHash: hash64("context") }];
  return snapshot;
}

/** A confirmed group whose single ready task has been claimed by the real dispatcher. */
async function claimed(snapshot = profileSnapshot()) {
  const h = await webFixture(snapshot, [{ taskId: "a" }]);
  const fault = commitFault();
  const service = new WebControlService({ ...h.deps, beforeCommit: fault.hook });
  const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
  const confirmed = service.confirm(h.command("confirm", h.confirmPayload()));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  const started = await service.start(h.command("start", {}));
  if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  const delivery = await deliverScheduledStart(deps, "g");
  if (delivery.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivery)}`);
  return { h, fault, service, deps, runId: delivery.runId };
}

describe("commit boundaries (task 10 step 3)", () => {
  it("dies before the import commit with nothing booked, and the identical command then imports once", async () => {
    const h = await webFixture();
    try {
      const fault = commitFault();
      const command = h.rawCommand("crash-import", 0, "import-plan", { kind: "group", groupId: "g2" }, { groupId: "g2", repoId: "repo", planId: "plan" }) as Extract<RawAuthorityCommandV1, { verb: "import-plan" }>;
      const deps = { ...h.deps, beforeCommit: fault.hook, estimatorObservation: () => ({ profile: h.frozen, observed: h.frozen.snapshot.profile.capabilities, probeFailureCode: null }) };
      fault.arm();
      expect(() => importControlPlan(deps, command)).toThrow("fault-before-commit");
      // Half an import is not a state the ledger may hold: no group, no estimate, no command record.
      expect(count(h.store, "groups", "id='g2'")).toBe(0);
      expect(count(h.store, "estimates", "group_id='g2'")).toBe(0);
      expect(count(h.store, "commands", "id='crash-import'")).toBe(0);

      fault.clear();
      const imported = importControlPlan(deps, command);
      expect("error" in imported ? JSON.stringify(imported.error) : imported.result.kind).toBe("imported");
      expect(count(h.store, "groups", "id='g2'")).toBe(1);
      expect(count(h.store, "estimates", "group_id='g2'")).toBe(1);
      expect(count(h.store, "scheduler_wakes", "group_id='g2' AND delivered=0")).toBe(1);
    } finally { await h.dispose(); }
  });

  it("leaves a queued estimate durable before its wake is delivered, and claiming it twice books one run", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService(h.deps);
      // The answer to the request was already lost at this point: the request is durable, nothing ran.
      expect(count(h.store, "scheduler_wakes", "kind='budget-estimate' AND delivered=0")).toBe(1);
      expect(count(h.store, "runs")).toBe(0);
      const run = await service.claimEstimate("g", h.estimateId);
      expect(run).toMatchObject({ phase: "estimate", state: "starting" });
      expect(await service.claimEstimate("g", h.estimateId)).toEqual(run);
      expect(count(h.store, "runs")).toBe(1);
      expect(count(h.store, "outbox", "kind='estimate-claim'")).toBe(1);
      expect(count(h.store, "scheduler_wakes", "kind='budget-estimate'")).toBe(1);
    } finally { await h.dispose(); }
  });

  it("refuses a non-V1 estimate answer before anything is published, then publishes the valid one once", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService(h.deps);
      const run = await service.claimEstimate("g", h.estimateId);
      const before = readBudgetProposal(h.store, "g");
      const state = () => String(JSON.parse(String(h.store.db.prepare("SELECT body FROM estimates WHERE group_id=? AND id=?").get("g", h.estimateId)!.body)).state);
      expect(() => service.completeEstimate("g", h.estimateId, { schema: "budget-estimate-v1" })).toThrow();
      expect(readBudgetProposal(h.store, "g")).toEqual(before);
      expect(state()).toBe("running");

      // The scheduler's verified terminal boundary is what makes an answer acceptable at all.
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      const output = estimateOutput(readArchivedPlan(h.store, "g").planHash);
      service.completeEstimate("g", h.estimateId, output);
      expect(state()).toBe("ready");
      const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      service.completeEstimate("g", h.estimateId, output);
      expect(Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision)).toBe(revision);
    } finally { await h.dispose(); }
  });

  it("dies before the confirmation commit with an editable proposal, and the retry confirms once", async () => {
    const h = await webFixture();
    try {
      const fault = commitFault();
      const service = new WebControlService({ ...h.deps, beforeCommit: fault.hook });
      const command = h.command("confirm", h.confirmPayload(), "crash-confirm");
      fault.arm();
      expect(() => service.confirm(command)).toThrow("fault-before-commit");
      // The canonical records a prepared confirm wrote are content-addressed bytes that nothing
      // references; what must not survive is the authority to dispatch.
      expect(proposalBody(h.store)).toMatchObject({ state: "editable", executionSnapshotHash: null });
      expect(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).toContain('"status":"draft"');
      expect(count(h.store, "commands", "id='crash-confirm'")).toBe(0);
      fault.clear();
      service.confirm(command);
      expect(proposalBody(h.store)).toMatchObject({ state: "confirmed", executionSnapshotHash: expect.any(String) });
      expect(count(h.store, "commands", "id='crash-confirm'")).toBe(1);
    } finally { await h.dispose(); }
  });

  it("keeps a start intent durable until it is delivered, and one delivery claims one run", async () => {
    const { h, deps, runId } = await claimed();
    try {
      // The wake the start command committed is now consumed rather than dangling, and the claim
      // it booked is the only active run a second delivery could find.
      expect(count(h.store, "scheduler_wakes", "kind='start' AND delivered=0")).toBe(0);
      expect(count(h.store, "runs", "active=1")).toBe(1);
      // A delivery with no wake left reports the run that is already open rather than opening
      // a second one: the claim it names is the same run, byte for byte.
      const again = await deliverScheduledStart(deps, "g");
      expect(again.kind === "claimed" && again.runId).toBe(runId);
      expect(count(h.store, "runs", "active=1")).toBe(1);
      expect(count(h.store, "outbox", "kind='work-claim'")).toBe(1);
    } finally { await h.dispose(); }
  });

  it("reads an attempt with no proof either way as unknown and blocked, never as a clean no-start", async () => {
    const { h, deps, runId } = await claimed();
    try {
      const generation = Number(h.store.db.prepare("SELECT generation FROM runs WHERE id=?").get(runId)!.generation);
      const reserved = beginProviderAttempt(deps, runId, "work");
      expect(reserved.kind).toBe("reserved");
      const ordinal = (reserved as { providerAttemptOrdinal: number }).providerAttemptOrdinal;
      // Nothing reached the provider's own durable marker, so recovery may infer neither outcome.
      expect(recoverAttempt(deps, { runId, generation, phase: "work", providerAttemptOrdinal: ordinal })).toEqual({ result: "unknown" });
      expect(h.store.dispatchBlocked).toBe(true);

      const envelopeHash = String(JSON.parse(String(h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`work:g:${runId}`)!.body)).envelopeHash);
      const proof = { runId, generation, phase: "work" as const, providerAttemptOrdinal: ordinal, dispatchEnvelopeHash: envelopeHash };
      const start = { ...proof, schema: "orca-provider-start-v1" as const, artifactHash: null, startedAt: ACCEPTED_AT };
      recordProofAck(deps, { runId, phase: "work", providerAttemptOrdinal: ordinal, record: start });
      expect(recoverAttempt(deps, { runId, generation, phase: "work", providerAttemptOrdinal: ordinal })).toEqual({ result: "started" });
      // A byte-identical repeat is idempotent; a contradictory record for the same tuple is
      // contradictory evidence, and the ledger goes back to unknown rather than picking a winner.
      recordProofAck(deps, { runId, phase: "work", providerAttemptOrdinal: ordinal, record: start });
      expect(count(h.store, "attempt_evidence")).toBe(1);
      recordProofAck(deps, { runId, phase: "work", providerAttemptOrdinal: ordinal, record: { ...proof, schema: "orca-no-provider-start-v1" as const, artifactHash: null, adapterExecutionId: "exec-1", providerInvoked: false as const, terminalObservationHash: hash64("terminal"), stopProofHash: hash64("stop"), observedAt: ACCEPTED_AT } });
      expect(recoverAttempt(deps, { runId, generation, phase: "work", providerAttemptOrdinal: ordinal })).toEqual({ result: "unknown" });
    } finally { await h.dispose(); }
  });

  it("latches a context gap once, keeps the gap observation out of the ledger, and suppresses the provider", async () => {
    const { h, deps, runId } = await claimed(contextCapableSnapshot());
    try {
      const generation = Number(h.store.db.prepare("SELECT generation FROM runs WHERE id=?").get(runId)!.generation);
      const observation = (sequence: number, occupiedInputTokens: number) => ({
        schema: "orca-context-observation-v1", runId, generation, workerSessionOrdinal: 1, sequence,
        occupiedInputTokens, requestMaxOutputTokens: 1_000, tokenizerId: "tiktoken-lite", tokenizerVersion: "1", observedAt: ACCEPTED_AT,
      });
      const input = (sequence: number, occupied: number) => ({ observation: observation(sequence, occupied) as never, policy: { handoffAtContextTokens: 800_000 }, profile: h.frozen });
      expect(acceptContextObservation(deps, input(1, 100_000)).kind).toBe("observed");
      // Sequence 2 never arrived, so the watermark can no longer be trusted: the gap is latched and
      // the unverified observation is not booked. The provider is then never asked again.
      expect(acceptContextObservation(deps, input(3, 900_000)).kind).toBe("invalid");
      expect(String(h.store.db.prepare("SELECT reason FROM context_latches WHERE run_id=?").get(runId)!.reason)).toBe("context-observation-gap");
      expect(count(h.store, "context_observations", `run_id='${runId}'`)).toBe(1);
      expect(beginProviderAttempt(deps, runId, "work")).toMatchObject({ kind: "suppressed" });
      // A repeat of the observation that did arrive stays idempotent, and the latch stays single.
      expect(acceptContextObservation(deps, input(1, 100_000)).kind).toBe("observed");
      expect(count(h.store, "context_observations", `run_id='${runId}'`)).toBe(1);
      expect(count(h.store, "context_latches", `run_id='${runId}'`)).toBe(1);
    } finally { await h.dispose(); }
  });

  it("dies before the handoff-stop commit with no stop row, no request and no outbox entry", async () => {
    const { h, fault, service } = await claimed();
    try {
      fault.arm();
      await expect(service.handoffStop(h.command("handoff-stop", {}, "crash-stop"))).rejects.toThrow("fault-before-commit");
      expect(count(h.store, "stop_intents")).toBe(0);
      expect(count(h.store, "handoff_requests")).toBe(0);
      expect(count(h.store, "outbox", "kind='handoff-stop'")).toBe(0);
      expect(Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision)).toBe(3);

      fault.clear();
      const stopped = await service.handoffStop(h.command("handoff-stop", {}, "crash-stop"));
      expect("error" in stopped ? JSON.stringify(stopped.error) : "committed").toBe("committed");
      expect(count(h.store, "stop_intents")).toBe(1);
      expect(count(h.store, "handoff_requests")).toBe(1);
      // The same run may hold exactly one open request, whatever the retry count.
      await service.handoffStop(h.command("handoff-stop", {}, "crash-stop-again"));
      expect(count(h.store, "stop_intents")).toBe(1);
      expect(count(h.store, "handoff_requests")).toBe(1);
    } finally { await h.dispose(); }
  });

  it("applies a cross-group shutdown to every group or to none, and an epoch replays it once", async () => {
    const { h, deps } = await claimed();
    try {
      const imports = { ...h.deps, estimatorObservation: () => ({ profile: h.frozen, observed: h.frozen.snapshot.profile.capabilities, probeFailureCode: null }) };
      const second = importControlPlan(imports, h.rawCommand("shutdown-second", 0, "import-plan", { kind: "group", groupId: "g2" }, { groupId: "g2", repoId: "repo", planId: "plan" }) as Extract<RawAuthorityCommandV1, { verb: "import-plan" }>);
      expect("error" in second ? JSON.stringify(second.error) : second.result.kind).toBe("imported");
      const epoch = "epoch-crash";
      const fault = commitFault();
      fault.arm();
      await expect(applyPanelShutdown({ ...deps, epoch, now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 1_000, beforeCommit: fault.hook })).rejects.toThrow("fault-before-commit");
      // One cross-group transaction: a death before it may not leave one group paused only.
      expect(count(h.store, "stop_intents")).toBe(0);
      fault.clear();
      const applied = await applyPanelShutdown({ ...deps, epoch, now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 1_000 });
      expect(applied.commandId).toBe(shutdownCommandId(epoch));
      expect(h.store.db.prepare("SELECT group_id FROM stop_intents ORDER BY group_id").all().map((row) => String(row.group_id))).toEqual(["g", "g2"]);
      // The same epoch reboots with the same command id, so the second call is a replay of the
      // recorded answer rather than a second shutdown with a fresh window.
      await expect(applyPanelShutdown({ ...deps, epoch, now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 1_000 })).resolves.toMatchObject({ commandId: shutdownCommandId(epoch) });
      expect(count(h.store, "stop_intents")).toBe(2);
    } finally { await h.dispose(); }
  });

  it("recovers an open run before anything listens, so the first request already sees a blocked store", async () => {
    const { h, deps, service } = await claimed();
    try {
      expect(count(h.store, "runs", "active=1")).toBe(1);
      const order: string[] = [];
      const port = { capabilities: async () => ({ protocol: 1, durableAccept: true, ownershipIsolation: true, evidenceRetention: true, usageObservation: "realtime", budgetEnforcement: "bounded", requestBoundEvidence: "proof" }), inspect: async () => ({ kind: "unknown" as const }), collect: async () => ({ events: [], candidate: null, terminal: null }) } as never;
      await runControlPanelStartup({
        recover: async () => { order.push("recover"); await recoverControl(h.store, port); },
        listen: async () => { order.push("listen"); },
      });
      expect(order).toEqual(["recover", "listen"]);
      // Recovery ran while nothing could be served, so no read ever saw an unblocked store.
      expect(h.store.dispatchBlocked).toBe(true);
      // A blocked store never books two concurrent runs, and a fresh start command is refused
      // outright rather than queued behind the run recovery is still uncertain about.
      await deliverScheduledStart(deps, "g");
      expect(count(h.store, "runs", "active=1")).toBe(1);
      const refused = await service.start(h.command("start", {}, "post-recovery-start"));
      expect("error" in refused).toBe(true);
      expect(count(h.store, "scheduler_wakes", "kind='start' AND delivered=0")).toBe(0);
      expect(count(h.store, "runs", "active=1")).toBe(1);
    } finally { await h.dispose(); }
  });
});
