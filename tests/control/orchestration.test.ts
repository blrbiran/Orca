import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { ORCHESTRATION_ACTOR, readGroupOrchestration } from "../../src/control/orchestration.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Kanban spec 2026-10-20 §3.1-§3.2 (goal.md §1.4): a confirmed group starts on its own when a slot is free. Every
// assertion reads the store, the summary or a command's answer after the call under test.
type H = Awaited<ReturnType<typeof webFixture>>;
const revisionOf = (h: H, id: string) => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
let sequence = 0;

async function confirm(h: H, service: WebControlService, groupId: string, hold = false) {
  const payload = {
    planHash: readArchivedPlan(h.store, groupId).planHash, proposalVersion: readBudgetProposal(h.store, groupId).proposalVersion, budgetMode: "strict" as const,
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
    profileHashes: { estimator: h.frozen.profileHash, worker: h.frozen.profileHash, handoff: h.frozen.profileHash, goalReview: h.frozen.profileHash },
    contextPolicy: { handoffAtContextTokens: 800_000 },
    selectionsHash: (await resolveGroupSelections({ store: h.store, port: h.deps.port }, groupId, "human")).selectionsHash ?? "0".repeat(64),
    ...(hold ? { hold: true as const } : {}),
  };
  const answer = await service.confirm(h.rawCommand(`confirm-${groupId}-${++sequence}`, revisionOf(h, groupId), "confirm", { kind: "group", groupId }, payload) as never);
  if ("error" in (answer as object)) throw new Error(JSON.stringify(answer));
}
const startCommands = (h: H, groupId: string) => h.store.db.prepare("SELECT id, actor_id, body_json FROM commands WHERE group_id=? ORDER BY rowid").all(groupId)
  .filter((r) => (JSON.parse(String(r.body_json)) as { verb?: unknown }).verb === "start").map((r) => [String(r.id), String(r.actor_id)]);
const startWakes = (h: H, groupId: string) => Number(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes WHERE group_id=? AND kind='start'").get(groupId)!.n);
const setCap = (h: H, service: WebControlService, maxRunningGroups: number) => service.setOrchestrationSettings(h.rawCommand(`cap-${++sequence}`,
  Number(h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups }) as never);

describe("start on confirm (kanban spec §3.1)", () => {
  it("a confirmed group is started by the next pass as orca-auto, once", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      await confirm(h, service, "g");
      expect(readGroupSummary(h.store, "g").orchestration).toEqual({ mode: "run", state: "queued", waitingFor: [], refusal: null });
      // mutation: autoStartPass skips every candidate -> started [], red
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
      expect(startCommands(h, "g")).toEqual([[expect.stringMatching(/^orca-auto-start-\d+-1$/), ORCHESTRATION_ACTOR]]);
      expect(startWakes(h, "g")).toBe(1);
      expect(readGroupSummary(h.store, "g").orchestration!.state).toBe("started");
      // mutation: recordStarted does nothing -> the second pass starts it again (refused group-execution-pending), red
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(startWakes(h, "g")).toBe(1);
    } finally { await h.dispose(); }
  });

  it("\"Confirm only\" holds the group; a person's start takes it and nothing starts it again", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      await confirm(h, service, "g", true);
      // mutation: recordConfirmed ignores hold (always "run") -> started ["g"], red
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(readGroupSummary(h.store, "g").orchestration).toMatchObject({ mode: "hold", state: "held" });
      await service.start(h.command("start", {}));
      expect(readGroupOrchestration(h.store, "g")!.startedRevision).toBe(revisionOf(h, "g"));
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(startCommands(h, "g").map(([, actor]) => actor)).toEqual(["human"]);
    } finally { await h.dispose(); }
  });

  it("a group confirmed with no orchestration row (before this existed) is never started and has no orchestration summary", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      await confirm(h, service, "g");
      h.store.db.prepare("DELETE FROM group_orchestration").run();
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(readGroupSummary(h.store, "g").orchestration).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("a paused group is not started; resume-dispatch starts it itself and no pass starts it again", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      await confirm(h, service, "g");
      const paused = await service.pauseDispatch(h.command("pause-dispatch", {}));
      if ("error" in (paused as object)) throw new Error(JSON.stringify(paused));
      // mutation: drop the stop-intent check -> started ["g"] while paused, red
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(readGroupSummary(h.store, "g").orchestration!.state).toBe("stopped");
      const resumed = await service.resumeDispatch(h.command("resume-dispatch", {}));
      if ("error" in (resumed as object)) throw new Error(JSON.stringify(resumed));
      // mutation: startSchedulerWake does not recordStarted -> once the resumed run ends the group would be started again
      expect(readGroupOrchestration(h.store, "g")!.startedRevision).toBe(revisionOf(h, "g"));
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
    } finally { await h.dispose(); }
  });

  it("a refused start backs off (30 s, then 60 s) and is persistent after five in a row; the next good pass clears it", async () => {
    let now = Date.parse("2026-10-21T00:00:00.000Z");
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService({ ...h.deps, now: () => new Date(now) });
      await confirm(h, service, "g");
      h.store.dispatchBlocked = true;
      expect(await service.autoStart()).toEqual({ started: [], refused: [{ groupId: "g", code: "recovery-blocked" }] });
      expect(readGroupOrchestration(h.store, "g")!.refusal).toMatchObject({ code: "recovery-blocked", count: 1, nextAt: now + 30_000 });
      // Inside the backoff nothing is sent.
      now += 29_000;
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      now += 2_000;
      await service.autoStart();
      // mutation: a constant delay -> nextAt now + 30 s, red
      expect(readGroupOrchestration(h.store, "g")!.refusal).toMatchObject({ count: 2, nextAt: now + 60_000 });
      for (let i = 0; i < 3; i += 1) { now += 600_000; await service.autoStart(); }
      expect(readGroupSummary(h.store, "g").orchestration!.refusal).toEqual({ code: "recovery-blocked", count: 5, persistent: true });
      h.store.dispatchBlocked = false;
      now += 600_000;
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
      expect(readGroupOrchestration(h.store, "g")!.refusal).toBeNull();
    } finally { await h.dispose(); }
  });
});

describe("running-group cap (kanban spec §3.2)", () => {
  it("defaults to 3, waits for a slot at the cap, and starts once the cap is raised", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      for (const id of ["busy-1", "busy-2", "busy-3"]) h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,'{\"status\":\"running\"}')").run(id);
      await confirm(h, service, "g");
      // mutation: the cap check reads `running <= cap` -> started at 3 running, red
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      expect(readGroupSummary(h.store, "g").orchestration!.state).toBe("waiting-slot");
      expect(setCap(h, service, 4)).toMatchObject({ result: { kind: "orchestration-settings-set", maxRunningGroups: 4, revision: 1 } });
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
    } finally { await h.dispose(); }
  });

  it("a blocked group does not hold a slot", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('stuck',1,1,'{\"status\":\"blocked\"}')").run();
      await confirm(h, service, "g");
      // mutation: groupHoldsSlot counts every non-done group -> waiting-slot, red
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
    } finally { await h.dispose(); }
  });

  it("setting the same cap is a no-op command; a stale revision is refused", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      expect(setCap(h, service, 3)).toMatchObject({ error: { code: "no-op-command" } });
      expect(setCap(h, service, 2)).toMatchObject({ result: { revision: 1 } });
      const stale = service.setOrchestrationSettings(h.rawCommand("cap-stale", 0, "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 5 }) as never);
      expect(stale).toMatchObject({ error: { code: "revision-conflict" } });
    } finally { await h.dispose(); }
  });

  it("starts a debug group before an ordinary one confirmed earlier when one slot is free", async () => {
    let now = Date.parse("2026-10-21T00:00:00.000Z");
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService({ ...h.deps, now: () => new Date(now) });
      h.importDeferred("fix");
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='fix'").get()!.body));
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='fix'").run(JSON.stringify({ ...body, debug: { correctionId: "c_0000000000000000", ordinal: 1, inputHash: "a".repeat(64), missing: [], agentFallback: null, undoHow: null, closing: null } }));
      setCap(h, service, 1);
      await confirm(h, service, "g");
      now += 1_000;
      await confirm(h, service, "fix");
      // mutation: drop the debug-first key in the sort -> started ["g"], red
      expect((await service.autoStart()).started).toEqual(["fix"]);
    } finally { await h.dispose(); }
  });
});

describe("GET /api/control/orchestration (kanban spec §3.2)", () => {
  it("answers the cap, its revision and how many groups hold a slot", async () => {
    const { default: express } = await import("express");
    const { registerControlReadRoutes } = await import("../../src/panel/controlApi.js");
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('busy',1,1,'{\"status\":\"running\"}')").run();
      setCap(h, service, 5);
      const app = express();
      registerControlReadRoutes(app, { store: h.store, epoch: "e", config: { readView: async () => ({}) } as never, service }, "web");
      const server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      try {
        const port = (server.address() as { port: number }).port;
        const res = await fetch(`http://127.0.0.1:${port}/api/control/orchestration`);
        expect([res.status, await res.json()]).toEqual([200, { schema: "orca-orchestration-v1", revision: 1, maxRunningGroups: 5, runningGroups: 1 }]);
      } finally { await new Promise((resolve) => server.close(resolve)); }
    } finally { await h.dispose(); }
  });
});
