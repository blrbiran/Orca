// Scheduled flows and groups spec 2026-10-24 §7.2-§7.6, criteria C2, C2u, C3, C4 and C10's fire rows (plan Task 6). Fake
// clock, temp stores only (Rule 17), fake starters that write the real `flow_runs` / `commands` rows they return.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { ControlError } from "../../src/control/errors.js";
import { libraryEntryId } from "../../src/control/planLibrary/commands.js";
import { appendVersion, insertEntry } from "../../src/control/planLibrary/store.js";
import { evaluateSchedule, schedulesPass, type SchedulePassDeps } from "../../src/control/schedules/pass.js";
import { firedGroupId } from "../../src/control/schedules/model.js";
import { insertFire, readFire, readSchedule, settleFire, writeScheduleState, type ScheduleFire } from "../../src/control/schedules/store.js";
import { applyScheduleCommand, type ScheduleCommand } from "../../src/control/schedules/commands.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { uuidOf, FlowRefusal } from "../../src/flow/kernel.js";

const REPO = "repo";
const FOLDER = "/repos/proj";
const ANA = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
const DAY = 24 * 3_600_000;
const at = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 9, 24 + day, hour, minute, 0);
type Clock = { at: number };

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function openStore(): Promise<{ s: ControlStore; clock: Clock }> {
  const root = await mkdtemp(join(tmpdir(), "schedule-pass-"));
  roots.push(root);
  const s = await openControlStore({ stateDir: join(root, "s") });
  // The zone is explicit here: a test never inherits the host's zone through the calendar's default.
  s.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1)").run();
  return { s, clock: { at: at(0, 10, 30) } };
}

const setZone = (s: ControlStore, zone: string): void => {
  s.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,?,1) ON CONFLICT(singleton) DO UPDATE SET time_zone=?")
    .run(zone, zone);
};
const commandDeps = (s: ControlStore, clock: Clock) => ({
  store: s, flowProjects: () => [{ repoId: REPO, path: FOLDER }], knownRepository: (repoId: string) => repoId === REPO,
  now: () => new Date(clock.at),
});
type Answer = { result?: { kind: string }; error?: { code: string; message: string } };
const command = <V extends ScheduleCommand["verb"]>(commandId: string, verb: V,
  payload: Extract<ScheduleCommand, { verb: V }>["payload"], scheduleId: string, expectedRevision = 0): ScheduleCommand =>
  ({ schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision, verb, target: { kind: "schedule", scheduleId }, payload }) as ScheduleCommand;
function runCommand(s: ControlStore, clock: Clock, cmd: ScheduleCommand): Answer {
  return withCommandContext(cmd.commandId, ANA, () => applyScheduleCommand(commandDeps(s, clock), cmd)) as Answer;
}
function mustRun(s: ControlStore, clock: Clock, cmd: ScheduleCommand): void {
  const answer = runCommand(s, clock, cmd);
  if (answer.error !== undefined) throw new Error(`refused: ${answer.error.code} ${answer.error.message}`);
}

type FlowCreate = Extract<Extract<ScheduleCommand, { verb: "schedule-set" }>["payload"], { projectId: string }>;
const flowCreate = (overrides: Partial<FlowCreate> = {}): FlowCreate => ({
  projectId: REPO, name: "daily", cron: "0 9 * * *", enabled: true,
  start: { kind: "flow", template: "wechat-article", params: { idea: "a topic" } }, ...overrides,
});
function createFlow(s: ControlStore, clock: Clock, overrides: Partial<FlowCreate> = {}, scheduleId = "sch-a"): void {
  mustRun(s, clock, command(`create-${scheduleId}`, "schedule-set", flowCreate(overrides), scheduleId));
}
const VERSION_ORIGIN = { kind: "import" as const, fileName: "p.json", fileSha256: "f".repeat(64), format: "orca-plan-v1" as const };
function createGroup(s: ControlStore, clock: Clock, scheduleId = "sch-g"): void {
  const entryId = libraryEntryId(`entry-${scheduleId}`);
  const sha256 = s.transaction(() => {
    insertEntry(s, { id: entryId, projectId: REPO, name: "p", by: "ana", via: "web", at: clock.at });
    return appendVersion(s, { entryId, doc: `{"entry":"${entryId}"}`, origin: VERSION_ORIGIN, by: "ana", via: "web", at: clock.at }).sha256;
  });
  mustRun(s, clock, command(`create-${scheduleId}`, "schedule-set", {
    ...flowCreate(), start: { kind: "group", entryId, sha256, tokenLimit: null, integration: null },
  }, scheduleId));
}

const fireRows = (s: ControlStore, scheduleId: string): Array<Record<string, unknown>> =>
  s.db.prepare("SELECT * FROM schedule_fires WHERE schedule_id=? ORDER BY seq").all(scheduleId) as Array<Record<string, unknown>>;

/** A flow starter that writes the run its commandId names, as §8 does; records its calls. */
function flowStarter(s: ControlStore, calls: string[] = [], state = "running") {
  return async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
    const commandId = fire.body.commandId!;
    calls.push(commandId);
    const flowRunId = `fr-${uuidOf(commandId)}`;
    const groupId = `flow-${uuidOf(commandId)}`;
    s.transaction(() => {
      s.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,1,1,0,?)")
        .run(groupId, JSON.stringify({ groupId, status: "running" }));
      s.db.prepare(`INSERT INTO flow_runs(id,group_id,template_ref,template_sha256,workspace,vault_id,params_sha256,pool_tokens,pool_drawn,state,revision,body)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(flowRunId, groupId, "builtin/wechat-article@1", "0".repeat(64), JSON.stringify({ projectId: REPO, kind: "dir" }), null, "1".repeat(64), 1000, 0, state, 0, "{}");
    });
    return { flowRunId };
  };
}

/** A group starter that books its import as the ledger would; records its calls. */
function groupStarter(s: ControlStore, calls: string[] = [], status = "draft") {
  return async (fire: ScheduleFire): Promise<{ groupId: string }> => {
    const commandId = fire.body.commandId!;
    calls.push(commandId);
    const groupId = firedGroupId(fire.scheduleId, fire.slot);
    s.transaction(() => {
      s.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,1,1,0,?)")
        .run(groupId, JSON.stringify({ groupId, status }));
      s.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result,original_status,body_json) VALUES (?,?,?,?,?,?)")
        .run(groupId, commandId, "hash", "{}", 200, JSON.stringify({ schema: "orca-command-success-v1" }));
    });
    return { groupId };
  };
}

const passAt = (s: ControlStore, clock: Clock, when: number, starters: Omit<SchedulePassDeps, "store" | "now"> = {}): Promise<{ crashes: string[] }> => {
  clock.at = when;
  return schedulesPass({ store: s, now: () => clock.at, ...starters }, when);
};

const flowRunState = (s: ControlStore, flowRunId: string, state: string): void => {
  s.db.prepare("UPDATE flow_runs SET state=? WHERE id=?").run(state, flowRunId);
};
const groupBody = (s: ControlStore, groupId: string, body: Record<string, unknown>): void => {
  s.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
};

describe("C2 slots", () => {
  it("created at 10:30 with 0 9 * * * fires nothing until the next 09:00", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      const calls: string[] = [];
      await passAt(s, clock, at(0, 10, 30), { startFlow: flowStarter(s, calls) });
      expect(fireRows(s, "sch-a")).toHaveLength(0);
      await passAt(s, clock, at(1, 8, 59), { startFlow: flowStarter(s, calls) });
      expect(fireRows(s, "sch-a")).toHaveLength(0);
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s, calls) });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("started");
      expect(Number(fires[0]!.slot)).toBe(at(1, 9, 0));
      expect((JSON.parse(String(fires[0]!.body)) as { commandId: string }).commandId)
        .toBe(`orca-auto-schedule-sch-a-${at(1, 9, 0)}`);
      expect(calls).toHaveLength(1);
    } finally { s.close(); }
  });

  it("disabled for 3 days then enabled: no catch-up; state.tz is stored with lastSlot", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, { enabled: false }, "sch-a");
      expect(readSchedule(s, "sch-a")!.body.state.tz).toBe("UTC");
      clock.at = at(3, 10, 0);
      mustRun(s, clock, command("en1", "schedule-enable", { enabled: true }, "sch-a", readSchedule(s, "sch-a")!.revision));
      const row = readSchedule(s, "sch-a")!;
      expect(row.body.state.tz).toBe("UTC");
      expect(row.body.state.lastSlot).toBe(at(3, 9, 0));
      const calls: string[] = [];
      await passAt(s, clock, at(3, 10, 0), { startFlow: flowStarter(s, calls) });
      expect(fireRows(s, "sch-a")).toHaveLength(0);
      await passAt(s, clock, at(4, 9, 0), { startFlow: flowStarter(s, calls) });
      expect(fireRows(s, "sch-a")).toHaveLength(1);
      expect(calls).toHaveLength(1);
    } finally { s.close(); }
  });

  it("three missed daily slots collapse into one late fire, missed = 2", async () => {
    const { s, clock } = await openStore();
    try {
      clock.at = at(0, 9, 0);
      createFlow(s, clock, {}, "sch-a");
      const when = at(3, 12, 0);
      await passAt(s, clock, when, { startFlow: flowStarter(s) });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(Number(fires[0]!.slot)).toBe(at(3, 9, 0));
      const body = JSON.parse(String(fires[0]!.body)) as { missed: number; lateMs: number };
      expect(body.missed).toBe(2);
      expect(body.lateMs).toBe(when - at(3, 9, 0));
    } finally { s.close(); }
  });

  it("a cron edit re-initialises lastSlot and stores state.tz", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      clock.at = at(1, 8, 0);
      mustRun(s, clock, command("e1", "schedule-set", { set: { cron: "0 10 * * *" } }, "sch-a", readSchedule(s, "sch-a")!.revision));
      const row = readSchedule(s, "sch-a")!;
      expect(row.body.state.tz).toBe("UTC");
      expect(row.body.state.lastSlot).toBe(at(0, 10, 0));
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")).toHaveLength(0);
      await passAt(s, clock, at(1, 10, 0), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")).toHaveLength(1);
    } finally { s.close(); }
  });

  it("DST 30 2 * * * in America/New_York: no fire on spring-forward, one on autumn", async () => {
    const { s, clock } = await openStore();
    try {
      setZone(s, "America/New_York");
      // 2026-03-07 12:00 EST; lastSlot = 2026-03-07 02:30 EST (07:30Z).
      clock.at = Date.UTC(2026, 2, 7, 17, 0);
      createFlow(s, clock, { cron: "30 2 * * *" }, "sch-a");
      expect(readSchedule(s, "sch-a")!.body.state.tz).toBe("America/New_York");
      // 2026-03-08 03:30 EDT: 02:30 does not exist that day.
      await passAt(s, clock, Date.UTC(2026, 2, 8, 7, 30), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")).toHaveLength(0);
      // 2026-11-01 03:00 EST: the single 02:30 EST (07:30Z) is due.
      await passAt(s, clock, Date.UTC(2026, 10, 1, 8, 0), { startFlow: flowStarter(s) });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(Number(fires[0]!.slot)).toBe(Date.UTC(2026, 10, 1, 7, 30));
    } finally { s.close(); }
  });

  it("a zone change re-initialises without firing, then the next London slot fires", async () => {
    const { s, clock } = await openStore();
    try {
      setZone(s, "Asia/Shanghai");
      clock.at = Date.UTC(2026, 9, 24, 10, 0); // 18:00 Shanghai; lastSlot = 01:00Z
      createFlow(s, clock, {}, "sch-a");
      const lastSlot = readSchedule(s, "sch-a")!.body.state.lastSlot;
      expect(lastSlot).toBe(Date.UTC(2026, 9, 24, 1, 0));
      setZone(s, "Europe/London");
      await passAt(s, clock, Date.UTC(2026, 9, 25, 9, 30), { startFlow: flowStarter(s) });
      const row = readSchedule(s, "sch-a")!;
      expect(row.body.state.tz).toBe("Europe/London");
      expect(row.body.state.lastSlot).toBe(Date.UTC(2026, 9, 25, 9, 0));
      expect(fireRows(s, "sch-a")).toHaveLength(0);
      await passAt(s, clock, Date.UTC(2026, 9, 26, 9, 0), { startFlow: flowStarter(s) });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(Number(fires[0]!.slot)).toBe(Date.UTC(2026, 9, 26, 9, 0));
    } finally { s.close(); }
  });
});

describe("C2u one fire per slot", () => {
  it("a direct second T1 insert for the same slot is refused and the pass records nothing new", async () => {
    const { s, clock } = await openStore();
    try {
      clock.at = at(0, 8, 0);
      createFlow(s, clock, {}, "sch-a");
      const slot = at(0, 9, 0);
      s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-a',1,?,?,'skipped','previous-active:x',NULL,NULL,'orca-auto','schedule:sch-a',?)`)
        .run(slot, slot, JSON.stringify({ creditedTo: "ana" }));
      expect(() => s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-a',2,?,?,'starting',NULL,NULL,NULL,'orca-auto','schedule:sch-a',?)`)
        .run(slot, slot, JSON.stringify({ commandId: `orca-auto-schedule-sch-a-${slot}` })))
        .toThrowError(/UNIQUE|constraint/i);
      const before = readSchedule(s, "sch-a")!.body.state.lastSlot;
      await passAt(s, clock, at(0, 9, 30), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")).toHaveLength(1);
      expect(readSchedule(s, "sch-a")!.body.state.lastSlot).toBe(before);
      expect(() => insertFire(s, {
        scheduleId: "sch-a", slot, at: slot, expectedLastSlot: readSchedule(s, "sch-a")!.body.state.lastSlot!, lastSlot: slot,
        outcome: "starting", commandId: `orca-auto-schedule-sch-a-${slot}`, lateMs: 0, missed: 0, creditedTo: "ana",
      })).toThrowError(ControlError);
    } finally { s.close(); }
  });
});

describe("C2 enable race", () => {
  it("a concurrent enable re-initialising lastSlot stops a pre-enable slot and other schedules still fire", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      createFlow(s, clock, {}, "sch-b");
      createFlow(s, clock, {}, "sch-c");
      const calls: string[] = [];
      const started = flowStarter(s, calls);
      // sch-a's start runs after the pass snapshotted every schedule: sch-b is disabled and re-enabled meanwhile,
      // already past the next day's slot, so its lastSlot moves ahead of the slot the pass computed from its snapshot.
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        if (fire.scheduleId === "sch-a") {
          clock.at = at(6, 10, 0);
          mustRun(s, clock, command("dis-b", "schedule-enable", { enabled: false }, "sch-b", readSchedule(s, "sch-b")!.revision));
          mustRun(s, clock, command("en-b", "schedule-enable", { enabled: true }, "sch-b", readSchedule(s, "sch-b")!.revision));
        }
        return started(fire);
      };
      const { crashes } = await passAt(s, clock, at(5, 9, 0), { startFlow: starter });
      expect(crashes).toEqual([]);
      expect(fireRows(s, "sch-a")[0]!.outcome).toBe("started");
      // The day-5 slot from before the enable never fires; the enable's own lastSlot (day 6) stands.
      expect(fireRows(s, "sch-b")).toHaveLength(0);
      expect(readSchedule(s, "sch-b")!.body.state.lastSlot).toBe(at(6, 9, 0));
      expect(fireRows(s, "sch-c")[0]!.outcome).toBe("started");
    } finally { s.close(); }
  });
});

describe("group fires without a starter (Task 9 not yet wired)", () => {
  it("a due group schedule writes no fire and is not paused", async () => {
    const { s, clock } = await openStore();
    try {
      createGroup(s, clock);
      const before = readSchedule(s, "sch-g")!.body.state;
      const { crashes } = await passAt(s, clock, at(1, 9, 0));
      expect(crashes).toEqual([]);
      expect(fireRows(s, "sch-g")).toHaveLength(0);
      expect(readSchedule(s, "sch-g")!.body.state).toEqual(before);
      expect(readSchedule(s, "sch-g")!.body.state.paused).toBe(false);
    } finally { s.close(); }
  });

  it("step 0 leaves a starting group fire starting instead of failing it again", async () => {
    const { s, clock } = await openStore();
    try {
      createGroup(s, clock);
      const slot = at(0, 9, 0);
      s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-g',1,?,?,'starting',NULL,NULL,NULL,'orca-auto','schedule:sch-g',?)`)
        .run(slot, slot, JSON.stringify({ commandId: `orca-auto-schedule-sch-g-${slot}` }));
      const { crashes } = await passAt(s, clock, at(1, 9, 0));
      expect(crashes).toEqual([]);
      const fires = fireRows(s, "sch-g");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("starting");
      expect(readSchedule(s, "sch-g")!.body.state.failureStreak).toBe(0);
    } finally { s.close(); }
  });
});

describe("C3 overlap", () => {
  it("a running or paused run skips with previous-active; done or stopped fires", async () => {
    for (const state of ["running", "paused", "done", "stopped"] as const) {
      const { s, clock } = await openStore();
      try {
        createFlow(s, clock, {}, "sch-a");
        const calls: string[] = [];
        await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s, calls) });
        const first = fireRows(s, "sch-a")[0]!;
        const flowRunId = String(first.flow_run_id);
        flowRunState(s, flowRunId, state);
        await passAt(s, clock, at(2, 9, 0), { startFlow: flowStarter(s, calls) });
        const fires = fireRows(s, "sch-a");
        const second = fires[1]!;
        if (state === "running" || state === "paused") {
          expect(second.outcome, state).toBe("skipped");
          expect(String(second.reason)).toBe(`previous-active:${flowRunId}`);
          expect(Number(second.slot), state).toBe(at(2, 9, 0));
        } else {
          expect(second.outcome, state).toBe("started");
          expect(calls, state).toHaveLength(2);
        }
        // The slot is consumed either way: lastSlot moves onto it, so a third pass in the same day records nothing.
        expect(readSchedule(s, "sch-a")!.body.state.lastSlot, state).toBe(at(2, 9, 0));
        const count = fireRows(s, "sch-a").length;
        await passAt(s, clock, at(2, 12, 0), { startFlow: flowStarter(s, calls) });
        expect(fireRows(s, "sch-a").length, state).toBe(count);
      } finally { s.close(); }
    }
  });

  it("group statuses: draft/ready/running/review/blocked skip; done or archived fires", async () => {
    const statuses = [["draft", true], ["ready", true], ["running", true], ["review", true], ["blocked", true], ["done", false]] as const;
    for (const [status, skips] of statuses) {
      const { s, clock } = await openStore();
      try {
        createGroup(s, clock);
        await passAt(s, clock, at(1, 9, 0), { startGroup: groupStarter(s) });
        const groupId = String(fireRows(s, "sch-g")[0]!.group_id);
        groupBody(s, groupId, { groupId, status });
        await passAt(s, clock, at(2, 9, 0), { startGroup: groupStarter(s) });
        expect(fireRows(s, "sch-g")[1]!.outcome, status).toBe(skips ? "skipped" : "started");
      } finally { s.close(); }
    }
    const { s, clock } = await openStore();
    try {
      createGroup(s, clock);
      await passAt(s, clock, at(1, 9, 0), { startGroup: groupStarter(s) });
      const groupId = String(fireRows(s, "sch-g")[0]!.group_id);
      groupBody(s, groupId, { groupId, status: "draft", archived: { at: at(1, 10, 0), actor: "ana" } });
      await passAt(s, clock, at(2, 9, 0), { startGroup: groupStarter(s) });
      expect(fireRows(s, "sch-g")[1]!.outcome).toBe("started");
    } finally { s.close(); }
  });

  it("a fire row left starting counts as active for step 4", async () => {
    const { s, clock } = await openStore();
    try {
      clock.at = at(0, 8, 0);
      createFlow(s, clock, {}, "sch-a");
      const slot = at(0, 9, 0);
      s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-a',1,?,?,'starting',NULL,NULL,NULL,'orca-auto','schedule:sch-a',?)`)
        .run(slot, slot, JSON.stringify({ commandId: "orca-auto-schedule-sch-a-1" }));
      const clockAt = at(1, 9, 30);
      clock.at = clockAt;
      await evaluateSchedule({ store: s, now: () => clockAt }, readSchedule(s, "sch-a")!, clockAt);
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(2);
      expect(fires[1]!.outcome).toBe("skipped");
      expect(Number(fires[1]!.slot)).toBe(at(1, 9, 0));
      expect(String(fires[1]!.reason)).toBe("previous-active:orca-auto-schedule-sch-a-1");
    } finally { s.close(); }
  });

  it("a hand-started run of the same template does not block", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      s.transaction(() => {
        s.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,1,1,0,?)")
          .run("flow-hand", JSON.stringify({ groupId: "flow-hand", status: "running" }));
        s.db.prepare(`INSERT INTO flow_runs(id,group_id,template_ref,template_sha256,workspace,vault_id,params_sha256,pool_tokens,pool_drawn,state,revision,body)
          VALUES ('fr-hand','flow-hand','builtin/wechat-article@1',?,?,NULL,?,1000,0,'running',0,'{}')`)
          .run("0".repeat(64), JSON.stringify({ projectId: REPO, kind: "dir" }), "1".repeat(64));
      });
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")[0]!.outcome).toBe("started");
    } finally { s.close(); }
  });

  it("a skip leaves the failure streak unchanged", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s) });
      s.transaction(() => writeScheduleState(s, "sch-a", (state) => ({ ...state, failureStreak: 2 })));
      await passAt(s, clock, at(2, 9, 0), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")[1]!.outcome).toBe("skipped");
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(2);
    } finally { s.close(); }
  });
});

describe("C4 failure streak", () => {
  const failing = () => async (): Promise<{ flowRunId: string }> => { throw new ControlError("flow-dir-unregistered", FOLDER); };

  it("three failed starts pause the schedule; no fire while paused; resume does not catch up", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      for (const day of [1, 2, 3]) await passAt(s, clock, at(day, 9, 0), { startFlow: failing() });
      const paused = readSchedule(s, "sch-a")!.body.state;
      expect(paused.paused).toBe(true);
      expect(paused.pausedReason).toBe("flow-dir-unregistered");
      expect(paused.failureStreak).toBe(3);
      expect(fireRows(s, "sch-a").every((fire) => fire.outcome === "failed")).toBe(true);
      await passAt(s, clock, at(4, 9, 0), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")).toHaveLength(3);
      clock.at = at(5, 8, 0);
      mustRun(s, clock, command("res1", "schedule-resume", {}, "sch-a", readSchedule(s, "sch-a")!.revision));
      const resumed = readSchedule(s, "sch-a")!.body.state;
      expect(resumed.paused).toBe(false);
      expect(resumed.failureStreak).toBe(0);
      expect(resumed.lastSlot).toBe(at(4, 9, 0));
      await passAt(s, clock, at(5, 9, 0), { startFlow: flowStarter(s) });
      expect(fireRows(s, "sch-a")).toHaveLength(4);
      expect(fireRows(s, "sch-a")[3]!.outcome).toBe("started");
    } finally { s.close(); }
  });

  it("a started fire resets the streak", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      await passAt(s, clock, at(1, 9, 0), { startFlow: failing() });
      await passAt(s, clock, at(2, 9, 0), { startFlow: failing() });
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(2);
      await passAt(s, clock, at(3, 9, 0), { startFlow: flowStarter(s) });
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(0);
      expect(readSchedule(s, "sch-a")!.body.state.paused).toBe(false);
    } finally { s.close(); }
  });

  it("a waiting fire neither counts nor resets", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s) });
      const fire = fireRows(s, "sch-a")[0]!;
      settleFire(s, { scheduleId: "sch-a", seq: Number(fire.seq), outcome: "waiting", reason: "auto-confirm-ineligible:8" });
      flowRunState(s, String(fire.flow_run_id), "done");
      s.transaction(() => writeScheduleState(s, "sch-a", (state) => ({ ...state, failureStreak: 1 })));
      await passAt(s, clock, at(2, 9, 0), { startFlow: failing() });
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(2);
      expect(fireRows(s, "sch-a")[1]!.outcome).toBe("failed");
    } finally { s.close(); }
  });

  it("a FlowRefusal is a failed fire that counts, and the pass still starts the next schedule", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      createFlow(s, clock, {}, "sch-b");
      const calls: string[] = [];
      const started = flowStarter(s, calls);
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        if (fire.scheduleId === "sch-a") throw new FlowRefusal("flow-param-invalid:idea", "the idea");
        return started(fire);
      };
      await passAt(s, clock, at(1, 9, 0), { startFlow: starter });
      const refused = fireRows(s, "sch-a");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.outcome).toBe("failed");
      expect(refused[0]!.reason).toBe("flow-param-invalid:idea");
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(1);
      expect(fireRows(s, "sch-b")[0]!.outcome).toBe("started");
      expect(calls).toHaveLength(1);
      await passAt(s, clock, at(2, 9, 0), { startFlow: starter });
      await passAt(s, clock, at(3, 9, 0), { startFlow: starter });
      const state = readSchedule(s, "sch-a")!.body.state;
      expect(state.failureStreak).toBe(3);
      expect(state.paused).toBe(true);
      expect(state.pausedReason).toBe("flow-param-invalid:idea");
    } finally { s.close(); }
  });
});

describe("C10 fire rows", () => {
  it("every row is by orca-auto, via schedule:<id>, credited to enabledBy; illegal moves are refused", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s) });
      flowRunState(s, String(fireRows(s, "sch-a")[0]!.flow_run_id), "done");
      await passAt(s, clock, at(2, 9, 0), { startFlow: flowStarter(s) });
      const skipPass = async (): Promise<void> => {
        await passAt(s, clock, at(3, 9, 0), { startFlow: flowStarter(s) });
      };
      // Make the day-2 run active so the day-3 slot is a skip.
      flowRunState(s, String(fireRows(s, "sch-a")[1]!.flow_run_id), "running");
      await skipPass();
      const fires = fireRows(s, "sch-a");
      expect(fires.map((fire) => fire.outcome)).toEqual(["started", "started", "skipped"]);
      for (const fire of fires) {
        expect(fire.by).toBe("orca-auto");
        expect(fire.via).toBe("schedule:sch-a");
        expect(JSON.parse(String(fire.body)).creditedTo).toBe("ana");
      }
      const first = readFire(s, "sch-a", 1)!;
      expect(first.outcome).toBe("started");
      expect(() => settleFire(s, { scheduleId: "sch-a", seq: 1, outcome: "starting" as never })).toThrowError(ControlError);
      expect(() => settleFire(s, { scheduleId: "sch-a", seq: 1, outcome: "waiting", reason: "auto-confirm-refused:x" })).not.toThrow();
      expect(() => settleFire(s, { scheduleId: "sch-a", seq: 1, outcome: "failed", reason: "x" })).toThrowError(ControlError);
      // waiting → started only for auto-confirm-ineligible:8.
      const second = fireRows(s, "sch-a")[1]!;
      settleFire(s, { scheduleId: "sch-a", seq: Number(second.seq), outcome: "waiting", reason: "auto-confirm-refused:x" });
      expect(() => settleFire(s, { scheduleId: "sch-a", seq: Number(second.seq), outcome: "started" })).toThrowError(ControlError);
    } finally { s.close(); }
  });

  it("waiting → started is accepted only for auto-confirm-ineligible:8", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      await passAt(s, clock, at(1, 9, 0), { startFlow: flowStarter(s) });
      const first = fireRows(s, "sch-a")[0]!;
      const seq = Number(first.seq);
      settleFire(s, { scheduleId: "sch-a", seq, outcome: "waiting", reason: "auto-confirm-ineligible:8" });
      expect(() => settleFire(s, { scheduleId: "sch-a", seq, outcome: "started" })).not.toThrow();
      expect(readFire(s, "sch-a", seq)!.outcome).toBe("started");
      expect(readFire(s, "sch-a", seq)!.reason).toBe("auto-confirm-ineligible:8");
      flowRunState(s, String(first.flow_run_id), "done");
      await passAt(s, clock, at(2, 9, 0), { startFlow: flowStarter(s) });
      const second = fireRows(s, "sch-a")[1]!;
      const otherSeq = Number(second.seq);
      settleFire(s, { scheduleId: "sch-a", seq: otherSeq, outcome: "waiting", reason: "auto-confirm-refused:x" });
      expect(() => settleFire(s, { scheduleId: "sch-a", seq: otherSeq, outcome: "started" })).toThrowError(ControlError);
    } finally { s.close(); }
  });

  it("insertFire refuses a creditedTo that is not the schedule's enabler and writes no fire", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock, {}, "sch-a");
      const slot = at(1, 9, 0);
      let error: unknown;
      try {
        insertFire(s, {
          scheduleId: "sch-a", slot, at: slot, expectedLastSlot: readSchedule(s, "sch-a")!.body.state.lastSlot!, lastSlot: slot,
          outcome: "starting", commandId: `orca-auto-schedule-sch-a-${slot}`, lateMs: 0, missed: 0, creditedTo: "bo",
        });
      } catch (thrown) { error = thrown; }
      expect(error).toBeInstanceOf(ControlError);
      expect((error as ControlError).code).toBe("recovery-blocked");
      expect((error as ControlError).detail).toBe("fire-credited-to");
      expect(fireRows(s, "sch-a")).toHaveLength(0);
    } finally { s.close(); }
  });
});
