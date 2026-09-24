import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { runViewSchema } from "../../src/control/webProtocol.js";
import { RESUME_STATE, resumeBlockedDriverRun, type DriveStep } from "../../src/control/driveRecord.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ControlError } from "../../src/control/errors.js";
import type { ControlStore } from "../../src/control/store.js";
import { webFixture } from "./fixtures/web.js";

// Execution driver spec §7.4: the run body's new states and its `drive` record are closed schema.

const drive = (over: Record<string, unknown> = {}) => ({
  workspaceMode: "worktree", sourceDir: "/x/state.runs/r", workspacePath: "/x/state.workspaces/r", targetRepo: null,
  prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
  reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false, ...over,
});

async function claimedSoft() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: "soft" }));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
  return { h, runId: claim.runId };
}

function patchRun(store: ControlStore, runId: string, patch: Record<string, unknown>): void {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), ...patch }), runId);
}

function thrown(run: () => unknown): ControlError {
  try { run(); } catch (error) { if (error instanceof ControlError) return error; throw error; }
  throw new Error("expected a ControlError, the call returned");
}

describe("driver run states in the read model (execution driver §7.4)", () => {
  it("shows a blocked driver run under its own state with its reason, and the group still reads", async () => {
    const { h, runId } = await claimedSoft(); try {
      patchRun(h.store, runId, { state: "blocked", providerAttemptOrdinal: 1, drive: drive({ blockedAt: "B'", blockedReason: "inspect-unknown" }) });
      const run = readControlGroup(h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)!;
      expect(run.state).toBe("blocked");
      expect(run.blockedReason).toBe("inspect-unknown");
      expect(runViewSchema.safeParse(run).success).toBe(true);
    } finally { await h.dispose(); }
  });

  it.each([["start-pending", "starting"], ["collected", "collected"], ["landed", "landed"], ["reconciling", "reconciling"]])(
    "shows the persisted state %s as %s, with no blocked reason", async (persisted, shown) => {
      const { h, runId } = await claimedSoft(); try {
        patchRun(h.store, runId, { state: persisted, providerAttemptOrdinal: 1, drive: drive() });
        const run = readControlGroup(h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)!;
        expect(run.state).toBe(shown);
        expect(run.blockedReason).toBe(null);
      } finally { await h.dispose(); }
    });

  it("refuses a drive record carrying a field the closed schema does not know", async () => {
    const { h, runId } = await claimedSoft(); try {
      patchRun(h.store, runId, { state: "start-pending", providerAttemptOrdinal: 1, drive: { ...drive(), stray: true } });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail?.startsWith(`run-invalid:${runId}:`)).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("recovery-retry on a blocked driver run (execution driver §2.3)", () => {
  // Literal table, not RESUME_STATE itself: the expectation must not be computed by the code under test.
  const expected: Array<[DriveStep, string]> = [["A1", "starting"], ["A2", "start-pending"], ["B", "start-pending"], ["B'", "unknown"], ["C", "accepted"], ["D", "collected"], ["R", "reconciling"], ["E", "landed"]];

  it.each(expected)("resumes a run blocked at %s in %s, reason cleared and the unknown count reset", async (step, state) => {
    const { h, runId } = await claimedSoft(); try {
      patchRun(h.store, runId, { state: "blocked", providerAttemptOrdinal: 1, drive: drive({ prepared: true, inspectUnknown: 10, blockedAt: step, blockedReason: "why" }) });
      expect(resumeBlockedDriverRun(h.store, runId)).toBe(true);
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(body.state).toBe(state);
      expect(body.drive).toMatchObject({ blockedAt: null, blockedReason: null, inspectUnknown: 0, prepared: step !== "A2" });
      expect(RESUME_STATE[step]).toBe(state);
    } finally { await h.dispose(); }
  });

  it("leaves a run that is not blocked exactly as it was", async () => {
    const { h, runId } = await claimedSoft(); try {
      const before = String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body);
      expect(resumeBlockedDriverRun(h.store, runId)).toBe(false);
      expect(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).toBe(before);
    } finally { await h.dispose(); }
  });
});
