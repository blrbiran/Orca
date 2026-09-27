import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, raw, realBinary, until, type World } from "./fixtures/ccloopWorld.js";

/**
 * Single-call estimate spec §8.3 E1-E3 against the real ccloop build (ORCA_CCLOOP_BIN, containing the ccloop half of
 * this round) and ccloop's CLI-level fake claude, relocated as agentSelectionE2E.test.ts is. The operator's layers put
 * the workers on the fake codex and the estimator on fake claude with the 1M window, which is what makes an estimate
 * queue (spec §1). The fake's single-call answer is written after the import (the plan hash is known then) and before
 * the pump starts (nothing claims the estimate before that).
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-estimate-e2e-", epochPrefix: "epoch-estimate-e2e-" });
afterAll(removeRoots);

const TASKS = [{ taskId: "a", targetPaths: ["a.txt"], verifierType: "command" as const }];
const CODEX = { a: { files: { "a.txt": "A\n" } } };
export const SUGGESTED_WORK = { tokens: 180_000, activeMs: 200_000, attempts: 1, sessions: 1 };
export const estimateOutput = (planHash: string) => ({
  schema: "budget-estimate-v1", planHash,
  tasks: [{ taskId: "a", complexity: "S", confidence: "high", work: SUGGESTED_WORK, handoff: { tokens: 10_000, activeMs: 30_000, attempts: 0, sessions: 0 }, rationale: "one new file", assumptions: ["a.txt does not exist yet"] }],
  goalReviewReserve: { tokens: 50_000, activeMs: 60_000, attempts: 1, sessions: 1 }, groupRationale: "a single small task",
});

/** Preferences, then the import; answers the queued estimate's id and the plan hash. */
export async function importWithClaudeEstimator(runtime: ControlRuntime, w: World): Promise<{ estimateId: string; planHash: string }> {
  const preferences = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
    { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }));
  expect("error" in preferences ? preferences.error : "set").toBe("set");
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId: w.repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "queued" } });
  return { estimateId: (imported as { result: { estimateId: string } }).result.estimateId, planHash: readArchivedPlan(runtime.store, "g").planHash };
}
export const estimateRun = (runtime: ControlRuntime) => {
  const row = runtime.store.db.prepare("SELECT id,active,body FROM runs WHERE group_id='g' AND json_extract(body,'$.phase')='estimate'").get();
  return row === undefined ? null : { runId: String(row.id), active: Number(row.active), body: JSON.parse(String(row.body)) };
};
export async function confirmSoft(runtime: ControlRuntime, commandId: string) {
  const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
  const profile = runtime.router.list()[0]!;
  const hash = profile.profileHash;
  // O5 fix (measured 2026-09-28, session f341f05f): the world's one profile binds every role, including the
  // worker, so a non-null declaredContextWindowTokens (E1/E2/E3's 1M) makes webService.ts:433 require a
  // non-null handoffAtContextTokens no greater than that window; null only clears when the window itself is
  // null. Read the profile's declared window and echo it back, rather than hardcoding null.
  const window = profile.snapshot.profile.capabilities.contextWindowTokens;
  return runtime.service.confirm(raw(runtime, commandId, "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: window }, selectionsHash: selections.selectionsHash,
  }));
}

describe.skipIf(!realBinary)("the estimate chain against real ccloop and fake claude (single-call estimate spec §8.3)", { timeout: 420_000 }, () => {
  relocateHome("orca-estimate-e2e-home-");

  it("E2: a handoff-stop while the call runs interrupts the estimate, returns its commitment, and completes the stop", async () => {
    const w = await world(TASKS, CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    try {
      const worktreesBefore = w.worktrees();
      const runtime = await w.boot();
      const { estimateId, planHash } = await importWithClaudeEstimator(runtime, w);
      const atImport = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call": { output: estimateOutput(planHash), delayMs: { "single-call": 30_000 }, usageBeforeDelay: true } }));
      runtime.startPump(50);
      await until(() => estimateRun(runtime)?.body.state === "accepted" && w.argv("claude").length === 1, 60_000, "the single call to start", 50);
      const stopped = await runtime.service.handoffStop(raw(runtime, "stop", "handoff-stop", {}));
      if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
      const [requestId] = stopped.result.requestIds;
      const request = () => String(runtime.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);
      await until(() => request() !== "request-pending" && request() !== "latched" && request() !== "collecting", 60_000, "the request to settle", 50);
      expect(request()).toBe("settled-restartable");
      expect(readEstimateRecord(runtime.store, "g", estimateId)).toMatchObject({ state: "interrupted", output: null });
      expect(estimateRun(runtime)!.active).toBe(0);
      expect(groupStopState(runtime.store, "g")).toBe("handoff-complete");
      const after = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
      expect(after.committedRemaining.tokens).toBe(atImport.committedRemaining.tokens - 250_000);
      expect(after.used.tokens).toBe(estimateRun(runtime)!.body.cumulative.work.tokens);
      expect(w.worktrees()).toEqual(worktreesBefore);
    } finally { await w.teardown(); }
  });

  it("E3: a restart with the call in flight leaves dispatch open, and the driver reconciles the estimate to ready", async () => {
    const w = await world(TASKS, CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    try {
      const first = await w.boot();
      const { estimateId, planHash } = await importWithClaudeEstimator(first, w);
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call": { output: estimateOutput(planHash), delayMs: { "single-call": 5_000 } } }));
      first.startPump(50);
      await until(() => estimateRun(first)?.body.state === "accepted", 60_000, "the single call to be accepted", 50);
      w.die(first);
      const second = await w.boot();
      expect(second.store.dispatchBlocked).toBe(false);
      second.startPump(50);
      await until(() => readEstimateRecord(second.store, "g", estimateId).state !== "running", 90_000, "the estimate to settle after the restart", 50);
      expect(readEstimateRecord(second.store, "g", estimateId)).toMatchObject({ state: "ready", output: estimateOutput(planHash) });
      expect(estimateRun(second)!.body.state).toBe("settled-restartable");
    } finally { await w.teardown(); }
  });

  it("E1: an imported plan's estimate runs to ready, one suggestion is applied as the model's, and the group starts", async () => {
    const w = await world(TASKS, CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    try {
      const worktreesBefore = w.worktrees();
      const runtime = await w.boot();
      const { estimateId, planHash } = await importWithClaudeEstimator(runtime, w);
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call": { output: estimateOutput(planHash) } }));
      runtime.startPump(50);
      try {
        await until(() => readEstimateRecord(runtime.store, "g", estimateId).state !== "running" && readEstimateRecord(runtime.store, "g", estimateId).state !== "queued", 90_000, "the estimate to settle", 50);
      } catch (error) {
        // Spec §1 and §8.4: what a stuck estimate costs the person is a refused start -- report that, not only a timeout.
        const confirmed = await confirmSoft(runtime, "stuck-confirm");
        const started = await runtime.service.start(raw(runtime, "stuck-start", "start", {}));
        throw new Error(`${String(error)}; estimate ${readEstimateRecord(runtime.store, "g", estimateId).state}; confirm ${"error" in confirmed ? confirmed.error.code : "confirmed"}; start answered ${"error" in started ? started.error.code : "started"}`);
      }
      expect(readEstimateRecord(runtime.store, "g", estimateId)).toMatchObject({ state: "ready", output: estimateOutput(planHash) });
      const run = estimateRun(runtime)!;
      expect(run.body).toMatchObject({ state: "settled-restartable", unknown: { work: false }, drive: { workspacePath: null } });
      // F15: fake claude's result usage, 12 input + 3 output, booked as ccloop reported it.
      expect(run.body.cumulative.work.tokens).toBe(15);
      // What the fake claude CLI received: one call, tools off, the frozen output cap in its environment (F15).
      expect(w.argv("claude")).toHaveLength(1);
      const argv = w.argv("claude")[0]!;
      expect(argv[argv.indexOf("--tools") + 1]).toBe("");
      expect(JSON.parse(readFileSync(w.claudeMarker, "utf8")).maxOutputTokensEnv).toBe("64000");
      expect(w.worktrees()).toEqual(worktreesBefore);

      // Apply one suggestion as the model's (Web spec §5.5): only the work tokens of task a.
      const applied = runtime.service.editProposal(raw(runtime, "apply", "proposal-edit", {
        baseProposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
        operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: SUGGESTED_WORK.tokens, provenance: "model", estimateId }],
      }));
      expect("error" in applied ? applied.error : applied.result.kind).toBe("proposal-edited");
      const work = readBudgetProposal(runtime.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === "a" && a.bucket === "work")!;
      expect(work.amount.tokens).toBe(180_000);
      expect(work.fieldProvenance.tokens).toEqual({ provenance: "model", estimateId });

      const confirmed = await confirmSoft(runtime, "confirm");
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      const started = await runtime.service.start(raw(runtime, "start", "start", {}));
      expect("error" in started ? started.error.code : "started").toBe("started");
      await until(() => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status === "done", 120_000, "task a to land", 50);
      expect(w.show("a.txt")).toBe("A");
    } finally { await w.teardown(); }
  });
});
