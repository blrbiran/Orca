/**
 * Review-exit spec 2026-11-05 §3.4, §4 criteria 17-19 (D4, human ruling 「上限满了时，显式 start 进入排队，有空位就自动开跑；
 * 回复里写明『已排队，前面有几个』。」): the cap is checked inside the start's transaction, last; a queued group is started by
 * orca-auto once a slot frees. Every assertion reads a command's answer, the store or the activity feed after the call.
 */
import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { ORCHESTRATION_ACTOR, readGroupOrchestration, runningGroupIds } from "../../src/control/orchestration.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

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
const setCap = (h: H, service: WebControlService, maxRunningGroups: number) => service.setOrchestrationSettings(h.rawCommand(`cap-${++sequence}`,
  Number(h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups }) as never);
/** A group holding a slot by an active run; `free` ends the run. */
const busy = (h: H) => {
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('busy',1,1,'{\"status\":\"running\"}')").run();
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('rb','busy','a',1,1,'{\"phase\":\"work\"}')").run();
  return { free: () => h.store.db.prepare("UPDATE runs SET active=0 WHERE id='rb'").run() };
};
const start = (h: H, service: WebControlService, groupId = "g", commandId = `start-${groupId}-${++sequence}`) =>
  service.start(h.rawCommand(commandId, revisionOf(h, groupId), "start", { kind: "group", groupId }, {}) as never);
const startWakes = (h: H, groupId: string) => Number(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes WHERE group_id=? AND kind='start'").get(groupId)!.n);
const setBody = (h: H, id: string, patch: Record<string, unknown>) => {
  const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
  h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, ...patch }), id);
};

describe("an explicit start at the cap is queued (review-exit spec §3.4)", () => {
  it("with the cap full an explicit start answers queued-for-slot with ahead and starts once a slot frees, never exceeding the cap", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      const slot = busy(h);
      await confirm(h, service, "g", true);
      // mutation: skip the cap check in scheduleStart -> scheduled, red
      expect(await start(h, service, "g", "person-start")).toMatchObject({ result: { kind: "queued-for-slot", operation: "start", ahead: 0 } });
      expect(startWakes(h, "g")).toBe(0);
      // Recorded as wanting to run ("Confirm only" cleared), not as started.
      expect(readGroupOrchestration(h.store, "g")).toMatchObject({ mode: "run", startedRevision: null, queued: { commandId: "person-start", actorId: "human" } });
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      slot.free();
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
      expect(startWakes(h, "g")).toBe(1);
      expect(runningGroupIds(h.store).length).toBeLessThanOrEqual(1);
      // The start that took the slot is orca-auto's and names the queued command.
      const rows = h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind='command'").all().map((row) => JSON.parse(String(row.body)) as Record<string, unknown>)
        .filter((body) => body.verb === "start");
      expect(rows).toEqual([{ verb: "start", actor: "human" }, { verb: "start", actor: ORCHESTRATION_ACTOR, queuedCommandId: "person-start", queuedBy: "human" }]);
      expect(readGroupOrchestration(h.store, "g")!.queued).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("ahead counts the groups before it in the pass's order that wait only for a slot", async () => {
    let now = Date.parse("2026-11-05T00:00:00.000Z");
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService({ ...h.deps, now: () => new Date(now) });
      setCap(h, service, 1);
      busy(h);
      h.importDeferred("o");
      h.importDeferred("b");
      await confirm(h, service, "o");
      now += 1_000;
      await confirm(h, service, "b");
      // `b` is in backoff: not counted.
      h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.refusal',json('{\"code\":\"x\",\"detail\":null,\"count\":1,\"at\":0,\"nextAt\":9999999999999}')) WHERE group_id='b'").run();
      now += 1_000;
      await confirm(h, service, "g", true);
      // mutation: count every candidate before it -> 2, red; count none -> 0, red
      expect(await start(h, service)).toMatchObject({ result: { kind: "queued-for-slot", ahead: 1 } });
    } finally { await h.dispose(); }
  });

  it("a flow child is never queued", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      busy(h);
      await confirm(h, service, "g", true);
      setBody(h, "g", { flow: { role: "child", flowRunId: "fr-1" } });
      // mutation: drop the flow-child exemption -> queued-for-slot, red
      expect(await start(h, service)).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await h.dispose(); }
  });

  it("group-dependency-unmet wins over queueing", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      busy(h);
      h.importDeferred("p");
      await service.addGroupDependency(h.rawCommand(`edge-${++sequence}`, revisionOf(h, "g"), "add-group-dependency", { kind: "group", groupId: "g" }, { dependsOn: "p" }) as never);
      await confirm(h, service, "g", true);
      // mutation: check the cap first (before the refusals) -> queued-for-slot, red
      expect(await start(h, service)).toMatchObject({ error: { code: "group-dependency-unmet" } });
      expect(readGroupOrchestration(h.store, "g")).toMatchObject({ mode: "hold" });
    } finally { await h.dispose(); }
  });

  it("a group with no orchestration row queues and starts", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      const slot = busy(h);
      await confirm(h, service, "g");
      h.store.db.prepare("DELETE FROM group_orchestration").run();
      const answer = await start(h, service) as { commandRevision: number };
      expect(answer).toMatchObject({ result: { kind: "queued-for-slot", ahead: 0 } });
      // mutation: skip writing the row -> null and the pass never starts it, red
      expect(readGroupOrchestration(h.store, "g")).toMatchObject({ mode: "run", confirmRevision: answer.commandRevision, startedRevision: null, refusal: null });
      slot.free();
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
    } finally { await h.dispose(); }
  });

  it("an existing row keeps its refusal when queued", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      busy(h);
      await confirm(h, service, "g");
      h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.refusal',json('{\"code\":\"x\",\"detail\":null,\"count\":2,\"at\":0,\"nextAt\":0}')) WHERE group_id='g'").run();
      await start(h, service);
      expect(readGroupOrchestration(h.store, "g")!.refusal).toMatchObject({ code: "x", count: 2 });
    } finally { await h.dispose(); }
  });

  it("resuming a paused group that never started is queued at the cap", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      setCap(h, service, 1);
      const slot = busy(h);
      await confirm(h, service, "g", true);
      const paused = await service.pauseDispatch(h.command("pause-dispatch", {}));
      if ("error" in (paused as object)) throw new Error(JSON.stringify(paused));
      // mutation: resume arms its start wake without the cap check -> scheduled, red
      expect(await service.resumeDispatch(h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "queued-for-slot", operation: "resume-dispatch", ahead: 0 } });
      expect(startWakes(h, "g")).toBe(0);
      slot.free();
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
    } finally { await h.dispose(); }
  });
});

describe("the cap under a race (criterion 19)", () => {
  it("a concurrent pass start and person start never exceed the cap", async () => {
    let now = Date.parse("2026-11-05T00:00:00.000Z");
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService({ ...h.deps, now: () => new Date(now) });
      setCap(h, service, 1);
      h.importDeferred("o");
      await confirm(h, service, "o");
      now += 1_000;
      await confirm(h, service, "g", true);
      // Both pass their pre-checks before either commits: the pass's start of `o` and the person's start of `g`.
      const [pass, person] = await Promise.all([service.autoStart(), start(h, service)]);
      // mutation: check the cap before the transaction (before the probe) -> both scheduled, 2 slots, red
      expect(runningGroupIds(h.store)).toHaveLength(1);
      const personQueued = (person as { result?: { kind?: string } }).result?.kind === "queued-for-slot";
      expect(personQueued ? pass.started : [], "exactly one starts").toEqual(personQueued ? ["o"] : []);
      if (!personQueued) {
        // The pass lost: not started, no refusal, and its next start goes out under a new command id.
        expect(pass).toEqual({ started: [], refused: [] });
        expect(readGroupOrchestration(h.store, "o")).toMatchObject({ refusal: null, slotRaces: 1 });
      }
    } finally { await h.dispose(); }
  });
});
