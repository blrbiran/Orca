import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { frozenWorkAgent, RECONCILE_SLOT_KEY } from "../../src/control/agentFreeze.js";
import type { AgentSelection, OperatorPreferences, PartialSelection, ProvenanceSource } from "../../src/control/agentSelection.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { readDriverRun, readStartEnvelope } from "../../src/control/executionDriver.js";
import { readConfirmedReconcileSlot } from "../../src/control/executionSnapshot.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readStopIntent } from "../../src/control/stopIntent.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup, readSelectionPreview } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, raw, realBinary, until, workRuns, type RunRow, type ScriptEntry, type Task, type World } from "./fixtures/ccloopWorld.js";

/**
 * Agent selection spec §9 criteria 8 and 11 against the real ccloop build (ORCA_CCLOOP_BIN, which must contain
 * ccloop T1-T6: the agents table, envelope v2, capabilities v3, the ClaudeAgentAdapter, the CLI-level fake claude
 * with `.argv`, fake codex's `.argv` and `--version`, and `ccloop run --agents`). Everything is relocated under a
 * temporary root, HOME and the four XDG roots included (relocateHome). The honest claim: with the CLI-level fake
 * claude and fake codex, a soft group and an estimator that is blocked-capability, the selection frozen at confirm
 * reaches each CLI's argv -- the reconcile run's included -- and a later change of the operator's default reaches
 * nothing the confirmed group dispatches (not the envelope, not ccloop's materialized config, not the argv, not the
 * gates' probes); and ④'s handoff, continuation (both paths) and three-way conflict run once each under fake claude.
 * Real claude is not claimed (spec §11: its paid run is the next round's).
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-agents-e2e-", epochPrefix: "epoch-agents-e2e-" });
afterAll(removeRoots);

/** raw()'s actorId (ccloopWorld.ts): the operator whose preferences confirm reads (W6-16). */
const OPERATOR = "human";
let seq = 0;

const modelOf = (args: string[]): string | null => {
  const index = args.indexOf("--model");
  return index < 0 ? null : args[index + 1] ?? null;
};
const tally = (values: Array<string | null>): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [String(value)]: (counts[String(value)] ?? 0) + 1 }), {});
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
const runsOf = (runtime: ControlRuntime, taskId: string): RunRow[] => workRuns(runtime).filter((run) => run.task === taskId);
const settledAll = (runtime: ControlRuntime, taskIds: string[]): boolean =>
  taskIds.every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true);
/** The selection in the claim Orca sent ccloop, as the store recorded the envelope. */
const claimAgent = (runtime: ControlRuntime, run: RunRow): unknown =>
  (readStartEnvelope(runtime.store, run.body as never) as unknown as { claim: { agent: unknown } }).claim.agent;
/** ccloop's own record of the configuration it materialized at accept (spec §4.6) -- not Orca's store. */
const materialized = (run: RunRow): { selection: unknown } =>
  JSON.parse(readFileSync(join(run.body.drive.sourceDir, "control", "config.json"), "utf8")) as { selection: unknown };

/** set-agent-preferences through the service, under the operator row's own revision (0 while none exists; P5: payload is `{ preferences }`). */
async function setPreferences(runtime: ControlRuntime, preferences: OperatorPreferences): Promise<void> {
  const row = runtime.store.db.prepare("SELECT revision FROM agent_preferences WHERE operator_id=?").get(OPERATOR);
  const revision = row === undefined ? 0 : Number(row.revision);
  const answer = await runtime.service.setAgentPreferences({
    schema: "orca-raw-command-v1", commandId: `prefs-${++seq}`, actorId: OPERATOR, verb: "set-agent-preferences",
    target: { kind: "operator", operatorId: OPERATOR }, expectedRevision: revision, payload: { preferences },
  } as never);
  if ("error" in answer) throw new Error(`set-agent-preferences refused: ${JSON.stringify(answer)}`);
}

type Frozen = { selection: AgentSelection; provenance: Record<"agent" | "model" | "contextWindow", ProvenanceSource> };

/**
 * Import (the estimator degrades to blocked-capability: no preferences exist yet), set the operator's preferences,
 * preview as the panel would (T14), confirm soft on that preview's hash. Answers what the confirm FROZE, read back from
 * the store -- each work item's frozen fields and the snapshot's reconcile slot -- never the preview it was bound to.
 */
async function confirmAgentGroup(runtime: ControlRuntime, repoId: string, preferences: OperatorPreferences): Promise<Record<string, Frozen>> {
  const imported = await runtime.service.importPlan(raw(runtime, `import-${++seq}`, "import-plan", { groupId: "g", repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
  await setPreferences(runtime, preferences);
  const preview = await readSelectionPreview(runtime.store, runtime.port, OPERATOR, "g");
  if (preview.selectionsHash === null) throw new Error(`preview rejected: ${JSON.stringify(preview.slots)}`);
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = await runtime.service.confirm(raw(runtime, `confirm-${++seq}`, "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: preview.proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null }, selectionsHash: preview.selectionsHash,
  }));
  expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
  const frozen: Record<string, Frozen> = {};
  for (const { taskId } of readArchivedPlan(runtime.store, "g").plan.tasks) {
    const { agent, agentProvenance } = frozenWorkAgent(JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)));
    frozen[`task:${taskId}`] = { selection: agent, provenance: agentProvenance };
  }
  const reconcile = readConfirmedReconcileSlot(runtime.store, "g");
  frozen[RECONCILE_SLOT_KEY] = { selection: reconcile.selection, provenance: reconcile.provenance };
  return frozen;
}

/** Optionally widen the token ceiling (execution driver deviation D12), then start. */
async function startConfirmed(runtime: ControlRuntime, raiseTokens = 0): Promise<void> {
  if (raiseTokens > 0) {
    const limit = readControlGroup(runtime.store, runtime.epoch, "g").ledger.groupLimit;
    const raised = runtime.service.setLimit(raw(runtime, `raise-${++seq}`, "set-limit", { limit: { ...limit, tokens: limit.tokens + raiseTokens } }));
    expect("error" in raised ? raised.error : "raised").toBe("raised");
  }
  const started = await runtime.service.start(raw(runtime, `start-${++seq}`, "start", {}));
  expect("error" in started ? started.error : "started").toBe("started");
}

async function handoffStop(runtime: ControlRuntime): Promise<string[]> {
  const stopped = await runtime.service.handoffStop(raw(runtime, `stop-${++seq}`, "handoff-stop", {}));
  if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
  return stopped.result.requestIds;
}

/** The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`) applied to the server's read model. */
function panelSelections(runtime: ControlRuntime): Array<{ taskId: string; predecessorRunId: string; checkpointId: string }> {
  const view = readControlGroup(runtime.store, runtime.epoch, "g");
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
  });
}

const requestState = (runtime: ControlRuntime, requestId: string): string =>
  String(runtime.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);

async function inExecute(w: World, runtime: ControlRuntime, taskIds: string[]): Promise<void> {
  await until(() => { noBlocked(runtime); return taskIds.every((id) => w.scriptedOf("claude").includes(`execute ${id}`)); }, 120_000, `${taskIds.join(",")} to enter execute`, 20);
}

/** ④'s one-task halves (handoffE2E.test.ts HALVES), under fake claude. */
const HALVES: Record<string, ScriptEntry> = { a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 6_000 } }, "a#continuation": { files: { "a2.txt": "A2\n" } } };
const HALVES_TASKS: Task[] = [{ taskId: "a", targetPaths: ["a1.txt", "a2.txt"] }];
const HALVES_SCRIPTED = ["plan a", "execute a", "plan a#continuation", "execute a#continuation", "verify a"];
const CLAUDE: AgentSelection = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };
/** A default set after confirm that nothing already frozen may pick up: the same agent, another model. */
const POISONED: OperatorPreferences = { defaultAgent: "claude", perAgent: { claude: { model: "claude-poisoned" } } };

describe.skipIf(!realBinary)("agent selection against real ccloop (spec §9 criteria 8 and 11)", { timeout: 420_000 }, () => {
  relocateHome("orca-agents-e2e-home-");

  it("M1: a mixed group runs claude and codex side by side, and the model each slot froze -- the reconcile run's included -- reaches its CLI", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"] },
      { taskId: "b", targetPaths: ["shared.txt"], agent: { agent: "codex" } },
      { taskId: "c", targetPaths: ["c.txt"], verifierType: "command", agent: { contextWindow: 1_000_000 } },
    ], {
      b: { files: { "shared.txt": "B\n" } },
      "reconcile-a-b": { files: { "shared.txt": "A\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "A\nB\n" } },
    }, { claudeScript: { a: { files: { "shared.txt": "A\n" } }, c: { files: { "c.txt": "C\n" } } } });
    const runtime = await w.boot(); try {
      const frozen = await confirmAgentGroup(runtime, w.repoId,
        { defaultAgent: "claude", perAgent: { claude: { model: "claude-opus-5-5" } }, reconcile: { agent: "codex", model: "gpt-6-reconcile" } });
      expect(Object.keys(frozen).sort()).toEqual(["reconcile", "task:a", "task:b", "task:c"]);
      expect(frozen["task:a"]!.selection).toEqual(CLAUDE);
      expect(frozen["task:b"]!.selection).toEqual({ agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" });
      expect(frozen["task:b"]!.provenance).toEqual({ agent: "task", model: "descriptor", contextWindow: "descriptor" });
      expect(frozen["task:c"]!.selection).toEqual({ ...CLAUDE, contextWindow: 1_000_000 });
      expect(frozen.reconcile!.selection).toEqual({ agent: "codex", model: "gpt-6-reconcile", contextWindow: "agent-default" });
      await startConfirmed(runtime, 10_000_000);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a", "b", "c"]); }, 360_000, "every task to settle");
      expect(w.show("shared.txt")).toBe("A\nB");
      expect(w.show("c.txt")).toBe("C");
      expect(workRuns(runtime).filter((run) => run.body.drive.reconcile !== null)).toHaveLength(1);
      // a: plan, execute, verify (agent verifier); c: plan, execute (command verifier) with the 1M suffix (spec §4.1).
      expect(tally(w.argv("claude").map(modelOf))).toEqual({ "claude-opus-5-5": 3, "claude-opus-5-5[1m]": 2 });
      // b: plan, execute, verify; the reconciliation (whichever task landed second): plan, execute, with the reconcile slot's model.
      expect(tally(w.argv("codex").map(modelOf))).toEqual({ "gpt-6-sol": 3, "gpt-6-reconcile": 2 });
      expect(w.scriptedOf("codex").filter((line) => / reconcile-/.test(line))).toHaveLength(2);
      for (const run of workRuns(runtime)) {
        expect(claimAgent(runtime, run)).toEqual(frozen[`task:${run.task}`]!.selection);
        expect(materialized(run).selection).toEqual(frozen[`task:${run.task}`]!.selection);
      }
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("F1: once confirmed, a change of the operator's default reaches nothing the group dispatches -- not the envelope, not ccloop's materialized config, not the CLI, not the gates' capability probes", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], {}, { claudeScript: { a: { files: { "shared.txt": "A\n" } } } });
    const probes: PartialSelection[] = [];
    const recording = (port: ExecutionPort): ExecutionPort => ({
      ...port,
      resolveAgent: async (partial: PartialSelection) => { probes.push(structuredClone(partial)); return port.resolveAgent(partial); },
    });
    const runtime = await w.boot(undefined, recording); try {
      const frozen = await confirmAgentGroup(runtime, w.repoId, { defaultAgent: "claude", perAgent: {} });
      expect(frozen["task:a"]!.selection).toEqual(CLAUDE);
      // A default no dispatch may use: another agent, and a model ccloop refuses (spec §4.1), so a gate that
      // read it would either probe with it -- recorded below -- or block the run.
      await setPreferences(runtime, { defaultAgent: "codex", perAgent: { codex: { model: "-poisoned" }, claude: { model: "claude-poisoned" } } });
      const mark = probes.length;
      await startConfirmed(runtime);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "a to settle");
      const [run] = runsOf(runtime, "a");
      expect(claimAgent(runtime, run!)).toEqual(CLAUDE);
      expect(materialized(run!).selection).toEqual(CLAUDE);
      expect(w.argv("claude").map(modelOf)).toEqual(["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5"]);
      expect(w.argv("codex")).toEqual([]);
      const gates = probes.slice(mark);
      expect(gates.length).toBeGreaterThan(0);
      for (const partial of gates) expect(partial).toEqual(CLAUDE);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("CH: under fake claude, a run stopped mid-execute parks its half, the panel's resume continues it with the same frozen selection, and the task lands whole", async () => {
    const w = await world(HALVES_TASKS, {}, { claudeScript: HALVES });
    const runtime = await w.boot(); try {
      await confirmAgentGroup(runtime, w.repoId, { defaultAgent: "claude", perAgent: {} });
      await startConfirmed(runtime);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [predecessor] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime);
      await until(() => { noBlocked(runtime); return requestState(runtime, requestId!) === "settled-recoverable"; }, 120_000, "the request to settle recoverable");
      const parked = readDriverRun(runtime.store, predecessor!.runId) as unknown as Record<string, any>;
      expect(parked).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(readStopIntent(runtime.store, "g")!.state).toBe("handoff-complete");
      // The operator's default moves while the run is parked; the continuation must not pick it up (spec §3 I1).
      await setPreferences(runtime, POISONED);
      const selections = panelSelections(runtime);
      expect(selections).toEqual([{ taskId: "a", predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId }]);
      const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "the continuation to land and settle");
      const continuation = runsOf(runtime, "a").find((run) => run.runId !== predecessor!.runId)!;
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(w.landings()).toBe(1);
      // spec §3 I1: the continuation inherits its predecessor's selection, and ccloop materialized the same one.
      expect(claimAgent(runtime, predecessor!)).toEqual(CLAUDE);
      expect(claimAgent(runtime, continuation)).toEqual(CLAUDE);
      expect(materialized(continuation).selection).toEqual(CLAUDE);
      expect(w.scriptedOf("claude")).toEqual(HALVES_SCRIPTED);
      expect(w.argv("claude").map(modelOf)).toEqual(Array(5).fill("claude-opus-5-5"));
      expect(w.argv("codex")).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("CC: under fake claude, a held task is continued by continue-task after an empty resume, with the same frozen selection", async () => {
    const w = await world(HALVES_TASKS, {}, { claudeScript: HALVES });
    const runtime = await w.boot(); try {
      await confirmAgentGroup(runtime, w.repoId, { defaultAgent: "claude", perAgent: {} });
      await startConfirmed(runtime);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [predecessor] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime);
      await until(() => { noBlocked(runtime); return requestState(runtime, requestId!) === "settled-recoverable"; }, 120_000, "the request to settle recoverable");
      const parked = readDriverRun(runtime.store, predecessor!.runId) as unknown as Record<string, any>;
      await setPreferences(runtime, POISONED);
      // continue-task needs a dispatch-enabled group (continuation.ts applyContinueTask): an empty resume reopens it
      // and leaves a held (continuation.ts applyResumeFromHandoff registers nothing for an empty selection).
      const reopened = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections: [] }));
      expect("error" in reopened ? reopened.error : reopened.result.kind).toBe("resumed-from-handoff");
      expect(workStatus(runtime, "a")).toBe("held");
      const continued = await runtime.service.continueTask(raw(runtime, `continue-${++seq}`, "continue-task",
        { predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId }, { kind: "task", groupId: "g", taskId: "a" }));
      expect("error" in continued ? continued.error : continued.result.kind).toBe("task-continuing");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "the continuation to land and settle");
      const continuation = runsOf(runtime, "a").find((run) => run.runId !== predecessor!.runId)!;
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(claimAgent(runtime, continuation)).toEqual(CLAUDE);
      expect(materialized(continuation).selection).toEqual(CLAUDE);
      expect(w.scriptedOf("claude")).toEqual(HALVES_SCRIPTED);
      expect(w.argv("claude").map(modelOf)).toEqual(Array(5).fill("claude-opus-5-5"));
      expect(w.argv("codex")).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("C3: under fake claude, three parallel runs stopped mid-execute all continue, and both reconciliations run with the reconcile slot's own model", async () => {
    const own = (id: string): ScriptEntry => ({ files: { "shared.txt": `${id.toUpperCase()}\n`, [`${id}.txt`]: `${id.toUpperCase()}\n` }, delayMs: { execute: 8_000 } });
    const script: Record<string, ScriptEntry> = {
      a: own("a"), b: own("b"), d: own("d"),
      "a#continuation": { files: { "a.txt": "A2\n" } }, "b#continuation": { files: { "b.txt": "B2\n" } }, "d#continuation": { files: { "d.txt": "D2\n" } },
    };
    for (const [self, other] of [["a", "b"], ["b", "a"], ["a", "d"], ["d", "a"], ["b", "d"], ["d", "b"]] as const) {
      script[`reconcile-${self}-${other}`] = { files: { "shared.txt": [self, other].sort().map((id) => `${id.toUpperCase()}\n`).join("") } };
    }
    for (const [self, x, y] of [["a", "b", "d"], ["b", "a", "d"], ["d", "a", "b"]] as const) script[`reconcile-${self}-${x}-${y}`] = { files: { "shared.txt": "A\nB\nD\n" } };
    const w = await world(["a", "b", "d"].map((id) => ({ taskId: id, targetPaths: ["shared.txt", `${id}.txt`] })), {}, { claudeScript: script });
    const runtime = await w.boot(); try {
      const frozen = await confirmAgentGroup(runtime, w.repoId, { defaultAgent: "claude", perAgent: {}, reconcile: { model: "claude-fable-5" } });
      expect(frozen.reconcile!.selection).toEqual({ ...CLAUDE, model: "claude-fable-5" });
      await startConfirmed(runtime, 10_000_000);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a", "b", "d"]);
      const requestIds = await handoffStop(runtime);
      expect(requestIds).toHaveLength(3);
      await until(() => requestIds.every((id) => requestState(runtime, id) === "settled-recoverable"), 120_000, "three requests to settle recoverable");
      const selections = panelSelections(runtime);
      expect(selections.map((selection) => selection.taskId).sort()).toEqual(["a", "b", "d"]);
      const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a", "b", "d"]); }, 360_000, "three continuations to land");
      expect(w.show("shared.txt")).toBe("A\nB\nD");
      expect(w.landings()).toBe(3);
      expect(w.scriptedOf("claude").filter((line) => line.startsWith("execute reconcile-"))).toHaveLength(2);
      // ④ H2's count (handoffE2E.test.ts): 3 stopped (plan, execute) + 3 continuations (plan, execute, verify) = 15
      // worker calls at the worker model; 2 reconciliations (plan, execute) = 4 calls at the reconcile slot's model.
      expect(tally(w.argv("claude").map(modelOf))).toEqual({ "claude-opus-5-5": 15, "claude-fable-5": 4 });
      expect(w.argv("codex")).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
