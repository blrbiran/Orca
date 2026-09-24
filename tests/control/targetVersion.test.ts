import { describe, expect, it } from "vitest";
import { loadPlan } from "../../src/scheduler/planFile.js";
import { controlPlanSchema, dispatchEnvelopeSchema, workItemViewSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { scheduleStart, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ControlError } from "../../src/control/errors.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import type { ControlStore } from "../../src/control/store.js";
import { webFixture, profileSnapshot } from "./fixtures/web.js";

// Seam B (spec docs/superpowers/specs/2026-09-24-g1-seam-b-target-version-design.md): one
// targetVersion, a positive safe integer, from the human-written plan to the start envelope.

const planWith = (targetVersion: unknown) => ({
  targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs", workBranch: "orca/w/x",
  policy: "local-merge", ledgerMode: "in-repo",
  tasks: [{ taskId: "T1", contract: "/abs/t1.json", dependsOn: [], targetVersion, configHash: "a".repeat(64) }],
});

function malformedAt(result: ReturnType<typeof loadPlan>): string[] {
  if (!("rejections" in result)) return [];
  return result.rejections.filter((r) => r.code === "malformed").map((r) => r.message);
}

/** The error a rejected call threw, or a failure if it did not throw a ControlError at all. */
function thrown(run: () => unknown): ControlError {
  try { run(); } catch (error) { if (error instanceof ControlError) return error; throw error; }
  throw new Error("expected a ControlError, the call returned");
}

function setBody(store: ControlStore, table: "work_items" | "runs", where: string, id: string, patch: Record<string, unknown>): void {
  const row = store.db.prepare(`SELECT body FROM ${table} WHERE ${where}=?`).get(id)!;
  store.db.prepare(`UPDATE ${table} SET body=? WHERE ${where}=?`).run(JSON.stringify({ ...JSON.parse(String(row.body)), ...patch }), id);
}

/** A confirmed group "g" whose only task "a" was imported with targetVersion 3 (not 1, so a hard-coded 1 is visible). */
async function importedAt3() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a", targetVersion: 3 }]);
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", h.confirmPayload()));
  return h;
}

async function claimedAt3() {
  const h = await importedAt3();
  const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
  await scheduleStart(deps, h.command("start", {}));
  const outcome = await deliverScheduledStart(deps, "g");
  if (outcome.kind !== "claimed") throw new Error(`claim did not start a run: ${outcome.kind}`);
  return { h, runId: outcome.runId };
}

const contract = {
  objective: { taskId: "a", goal: "ship", successCondition: "passes", nonGoals: [] },
  context: { repoPath: ".", targetPaths: ["a.ts"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
  verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
};

describe("plan file targetVersion (seam B)", () => {
  it("N0 accepts a positive integer, so the refusals below are about the value and not the fixture", () => {
    expect(malformedAt(loadPlan(planWith(1), "main"))).toEqual([]);
  });

  it("N1 refuses a string by name, at the field", () => {
    const messages = malformedAt(loadPlan(planWith("v1"), "main"));
    expect(messages).toHaveLength(1);
    expect(messages[0].startsWith("tasks.0.targetVersion:")).toBe(true);
  });

  it.each([["zero", 0], ["a fraction", 1.5], ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1]])("N2 refuses %s", (_label, value) => {
    const messages = malformedAt(loadPlan(planWith(value), "main"));
    expect(messages).toHaveLength(1);
    expect(messages[0].startsWith("tasks.0.targetVersion:")).toBe(true);
  });
});

describe("imported targetVersion reaches the column, the body and the wire (seam B)", () => {
  it("N3 writes the plan's value into the column and the body alike", async () => {
    const h = await importedAt3(); try {
      const row = h.store.db.prepare("SELECT target_version, body FROM work_items WHERE group_id='g' AND id='a'").get()!;
      expect(Number(row.target_version)).toBe(3);
      expect(JSON.parse(String(row.body)).targetVersion).toBe(3);
    } finally { await h.dispose(); }
  });

  it("N4 carries it onto the run row and into the start envelope's claim", async () => {
    const { h, runId } = await claimedAt3(); try {
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(run.targetVersion).toBe(3);
      const outbox = h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:g:${runId}`)!;
      const envelope = dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(h.store, JSON.parse(String(outbox.body)).envelopeHash)));
      const built = toStartEnvelope(envelope, run, { sourceDir: "/tmp/src", targetRepo: "/tmp/src", base: "main" }, contract);
      expect(built.claim.targetVersion).toBe(3);
    } finally { await h.dispose(); }
  });
});

describe("the panel refuses a targetVersion that is not the plan's integer (seam B)", () => {
  it("N5 refuses a string in the work body as invalid, not as an authority mismatch", async () => {
    const h = await importedAt3(); try {
      setBody(h.store, "work_items", "id", "a", { targetVersion: "3" });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail?.startsWith("work-item-invalid:a:")).toBe(true);
    } finally { await h.dispose(); }
  });

  it("N6 refuses a work body whose integer differs from the plan", async () => {
    const h = await importedAt3(); try {
      setBody(h.store, "work_items", "id", "a", { targetVersion: 2 });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail).toBe("work-item-authority:a");
    } finally { await h.dispose(); }
  });

  it("N8 refuses a string in the run body as invalid", async () => {
    const { h, runId } = await claimedAt3(); try {
      setBody(h.store, "runs", "id", runId, { targetVersion: "3" });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail?.startsWith(`run-invalid:${runId}:`)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("N9 refuses a run whose integer differs from its work item", async () => {
    const { h, runId } = await claimedAt3(); try {
      setBody(h.store, "runs", "id", runId, { targetVersion: 2 });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail).toBe(`run-work-identity:${runId}`);
    } finally { await h.dispose(); }
  });

  it("N0b the unmodified group reads, so N5/N6/N8/N9 are refusals of the edit and not of the fixture", async () => {
    const { h } = await claimedAt3(); try {
      const view = readControlGroup(h.store, "epoch-test", "g");
      expect(view.workItems.map((w) => w.targetVersion)).toEqual([3]);
    } finally { await h.dispose(); }
  });
});

describe("wire schemas refuse a string targetVersion (seam B)", () => {
  const task = { taskId: "a", dependencyTaskIds: [], configHash: "c".repeat(64), originalContractHash: "c".repeat(64), originalContractCanonicalJson: '{"schema":"orca-task-contract-v1"}' };
  const plan = (targetVersion: unknown) => ({ schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["checks pass"], tasks: [{ ...task, targetVersion }] });

  it("N7 ControlPlanV1 takes 3 and refuses \"3\"", () => {
    expect(controlPlanSchema.safeParse(plan(3)).success).toBe(true);
    expect(controlPlanSchema.safeParse(plan("3")).success).toBe(false);
  });

  it("N7b WorkItemViewV1 takes the view the panel built and refuses it with a string", async () => {
    const h = await importedAt3(); try {
      const item = readControlGroup(h.store, "epoch-test", "g").workItems[0];
      expect(workItemViewSchema.safeParse(item).success).toBe(true);
      expect(workItemViewSchema.safeParse({ ...item, targetVersion: "3" }).success).toBe(false);
    } finally { await h.dispose(); }
  });
});
