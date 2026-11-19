// Tester #368 (b): a confirmed task had no supported way to change its model -- `task retry --agent` resolved only the
// installation, so the retry froze the installation's default model (in the field, a model the provider had withdrawn).
// `retry-task` now takes `model` (with or without `agent`): ccloop resolves that selection before the transaction, a
// model the installation's read catalog does not list is refused as requirement set-agent refuses one
// (agent-selection-invalid, naming the listed models), and the switch is recorded as a person's.
import { describe, expect, it } from "vitest";
import { resolveAgentSwitch } from "../../src/control/agentSwitch.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { applyRetryTask } from "../../src/control/retryTask.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { permissionRefusal } from "../../src/panel/permissions.js";
import { createServer } from "node:http";
import express from "express";
import { registerControlMutationRoutes } from "../../src/panel/controlApi.js";
import { driverHarness } from "./fixtures/driverHarness.js";

async function world() {
  let failing = true;
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: (id) => (id === "a" && failing ? "failed" : "succeed"),
    failure: (id) => (id === "a" && failing ? { failureCause: { cause: "model-unavailable", phase: "plan", retries: 0, detail: "404 model withdrawn" } } : undefined),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  const work = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  const revision = () => Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
  let n = 0;
  const retry = (payload: Record<string, unknown>) => service.retryTaskOnAgent({ schema: "orca-raw-command-v1", commandId: `retry-${++n}`, actorId: "operator",
    expectedRevision: revision(), verb: "retry-task", target: { kind: "group", groupId: "g" }, payload: { taskId: "a", runId, ...payload } } as never);
  return { t, runId, work, retry, service, revision, succeedNext: () => { failing = false; } };
}
const errorOf = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error;

describe("task retry --model: a confirmed task's model changes on its retry (#368 b)", { timeout: 120_000 }, () => {
  it("model alone: the task stays on its installation with the named model; the next run carries it", async () => {
    const w = await world(); try {
      const before = w.work();
      expect(before.agent).toMatchObject({ agent: "codex", model: "fixture-model" });
      // mutation: retryTaskOnAgent sends a model-only payload to the plain retry -> refused, red (the route: next test)
      expect(errorOf(await w.retry({ model: "gpt-new" }))).toBeUndefined();
      const after = w.work();
      expect(after.agent).toEqual({ ...before.agent, model: "gpt-new" });
      // mutation: freeze the model's provenance as "descriptor" -> red
      expect(after.agentProvenance).toMatchObject({ agent: "task", model: "task" });
      expect(after.agentSwitches).toEqual([expect.objectContaining({ afterRunId: w.runId, reason: "person", by: "operator", previous: expect.objectContaining({ agent: before.agent }) })]);
      expect(() => readConfirmedTaskExecution(w.t.h.store, "g", "a")).not.toThrow();
      // Review M5: the activity names the model left and taken (installation alone would read codex -> codex).
      // mutation: applyAgentSwitch returns installations only -> no model pair, red
      const activity = w.t.h.store.db.prepare("SELECT body FROM activity WHERE kind='task-retried' AND run_id=?").get(w.runId);
      expect(JSON.parse(String(activity!.body))).toEqual({ fromRunId: w.runId, agent: { from: "codex", to: "codex", model: { from: "fixture-model", to: "gpt-new" } } });
      expect(readControlGroup(w.t.h.store, "e", "g").runs.map((run) => run.runId)).toContain(w.runId);
      w.succeedNext();
      const next = await w.t.claim();
      expect((w.t.body(next) as { agent: { agent: string; model: string } }).agent).toMatchObject({ agent: "codex", model: "gpt-new" });
    } finally { await w.t.h.dispose(); }
  });

  it("through the panel's own route: POST groups/g/retry-task with a model alone succeeds (review I2)", async () => {
    const w = await world(); try {
      const app = express(); app.use(express.json());
      app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "owner-1", name: "owner", roles: ["owner"] }; next(); });
      registerControlMutationRoutes(app, w.t.h.store, w.service, "web");
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const port = (server.address() as { port: number }).port;
        const r = await fetch(`http://127.0.0.1:${port}/api/control/groups/g/retry-task`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: "route-model", expectedRevision: w.revision(), payload: { taskId: "a", runId: w.runId, model: "gpt-new" } }) });
        // mutation: the route sends a payload without agent to service.retryTask -> recovery-blocked, red
        expect([r.status, await r.json()]).toMatchObject([200, { result: { kind: "task-retried" } }]);
        expect(w.work().agent.model).toBe("gpt-new");
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { await w.t.h.dispose(); }
  });

  it("agent and model together: the other installation with that model", async () => {
    const w = await world(); try {
      expect(errorOf(await w.retry({ agent: "claude", model: "claude-big" }))).toBeUndefined();
      expect(w.work().agent).toMatchObject({ agent: "claude", model: "claude-big" });
    } finally { await w.t.h.dispose(); }
  });

  it("the model the task already has: agent-unchanged; a model the read catalog does not list: agent-selection-invalid naming the list", async () => {
    const w = await world(); try {
      // mutation: compare installations only (as before) for a model retry -> gpt-new on codex is "unchanged", red in test 1
      expect(errorOf(await w.retry({ model: "fixture-model" }))).toMatchObject({ code: "task-not-retryable", message: expect.stringContaining("agent-unchanged") });
      (w.t.h.deps.port as { listModels?: unknown }).listModels = async (installation: string) => ({ installation, kind: "codex", source: "cache", observedAt: null,
        models: [{ model: "gpt-5", contextWindowTokens: 1, maxOutputTokens: 1, singleCallExecution: "v1" }] });
      const before = w.work();
      // mutation: drop the catalog check -> the retry succeeds, red
      expect(errorOf(await w.retry({ model: "gpt-gone" }))).toMatchObject({ code: "agent-selection-invalid", message: expect.stringContaining("gpt-gone (listed: gpt-5)") });
      expect(w.work()).toEqual(before);
      expect(errorOf(await w.retry({ model: "gpt-5" }))).toBeUndefined();
      expect(w.work().agent.model).toBe("gpt-5");
    } finally { await w.t.h.dispose(); }
  });

  it("the retry's own check: a selection resolved for another model than the payload names is refused", async () => {
    const w = await world(); try {
      const before = w.work();
      const frozen = await resolveAgentSwitch({ store: w.t.h.store, port: w.t.h.deps.port, profileRouter: w.t.h.deps.profileRouter as never }, "g", "codex", "task", "model-a");
      const answer = applyRetryTask({ store: w.t.h.store, switchTo: { frozen, source: "task" } }, { schema: "orca-raw-command-v1", commandId: "mismatch", actorId: "operator",
        expectedRevision: Number(w.t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision), verb: "retry-task",
        target: { kind: "group", groupId: "g" }, payload: { taskId: "a", runId: w.runId, model: "model-b" } } as never);
      // mutation: drop the model half of the check -> model-a frozen for a model-b request, red
      expect(errorOf(answer)).toMatchObject({ code: "recovery-blocked", message: expect.stringContaining("agent-switch-unresolved") });
      expect(w.work()).toEqual(before);
    } finally { await w.t.h.dispose(); }
  });

  it("auto with a model is refused (auto lets orca-auto choose); a run Orca dispatched may not choose a model", async () => {
    const w = await world(); try {
      const before = w.work();
      // mutation: drop the auto+model refusal -> auto runs and the model is silently ignored, red
      expect(errorOf(await w.retry({ agent: "auto", model: "gpt-new" }))).toMatchObject({ code: "agent-selection-invalid", message: expect.stringContaining("auto-with-model") });
      expect(w.work()).toEqual(before);
    } finally { await w.t.h.dispose(); }
    // mutation: leave `model` out of the dispatched-run check -> null, red
    expect(permissionRefusal({ kind: "agent", dispatchedRun: "run-x" } as never, "retry-task", { taskId: "a", model: "m" }))
      .toMatchObject({ code: "control-dispatched-run-refused" });
  });
});
