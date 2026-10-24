// Scheduled flows and groups spec 2026-10-24 §7.5, criterion C5 (a, b, c, d, e) and §7.2 step 0: a crash between T1 and
// T2, between the start and T2, or between R2's confirm and step 9's copy is healed by the next pass from stored facts --
// one run, never two. Temp stores only.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autoConfirmCommandId } from "../../src/control/autoConfirm.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { libraryEntryId } from "../../src/control/planLibrary/commands.js";
import { appendVersion, insertEntry } from "../../src/control/planLibrary/store.js";
import { FIRED_GROUP_ID, firedGroupId } from "../../src/control/schedules/model.js";
import { schedulesPass, type SchedulePassDeps } from "../../src/control/schedules/pass.js";
import { readSchedule } from "../../src/control/schedules/store.js";
import { applyScheduleCommand, type ScheduleCommand } from "../../src/control/schedules/commands.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { FlowRefusal, uuidOf } from "../../src/flow/kernel.js";
import type { ScheduleFire } from "../../src/control/schedules/store.js";

const REPO = "repo";
const FOLDER = "/repos/proj";
const ANA = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
const at = (day: number, hour: number): number => Date.UTC(2026, 9, 24 + day, hour, 0, 0);
type Clock = { at: number };

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function openStore(): Promise<{ s: ControlStore; clock: Clock }> {
  const root = await mkdtemp(join(tmpdir(), "schedule-crash-"));
  roots.push(root);
  const s = await openControlStore({ stateDir: join(root, "s") });
  s.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1)").run();
  return { s, clock: { at: at(0, 10) } };
}

const commandDeps = (s: ControlStore, clock: Clock) => ({
  store: s, flowProjects: () => [{ repoId: REPO, path: FOLDER }], knownRepository: () => true, now: () => new Date(clock.at),
});
function mustRun(s: ControlStore, clock: Clock, cmd: ScheduleCommand): void {
  const answer = withCommandContext(cmd.commandId, ANA, () => applyScheduleCommand(commandDeps(s, clock), cmd)) as { error?: { code: string } };
  if (answer.error !== undefined) throw new Error(`refused: ${answer.error.code}`);
}
const flowCreate = (overrides: Record<string, unknown> = {}) => ({
  projectId: REPO, name: "daily", cron: "0 9 * * *", enabled: true,
  start: { kind: "flow" as const, template: "wechat-article", params: { idea: "a topic" } }, ...overrides,
});
function createFlow(s: ControlStore, clock: Clock, scheduleId = "sch-a"): void {
  mustRun(s, clock, {
    schema: "orca-raw-command-v1", commandId: `create-${scheduleId}`, actorId: "human", expectedRevision: 0, verb: "schedule-set",
    target: { kind: "schedule", scheduleId }, payload: flowCreate(),
  } as ScheduleCommand);
}
const VERSION_ORIGIN = { kind: "import" as const, fileName: "p.json", fileSha256: "f".repeat(64), format: "orca-plan-v1" as const };
function createGroup(s: ControlStore, clock: Clock): void {
  const entryId = libraryEntryId("entry-g");
  const sha256 = s.transaction(() => {
    insertEntry(s, { id: entryId, projectId: REPO, name: "p", by: "ana", via: "web", at: clock.at });
    return appendVersion(s, { entryId, doc: '{"entry":"g"}', origin: VERSION_ORIGIN, by: "ana", via: "web", at: clock.at }).sha256;
  });
  mustRun(s, clock, {
    schema: "orca-raw-command-v1", commandId: "create-g", actorId: "human", expectedRevision: 0, verb: "schedule-set",
    target: { kind: "schedule", scheduleId: "sch-g" },
    payload: { ...flowCreate(), start: { kind: "group", entryId, sha256, tokenLimit: null, integration: null } },
  } as ScheduleCommand);
}
const disable = (s: ControlStore, clock: Clock, scheduleId: string): void => {
  const revision = readSchedule(s, scheduleId)!.revision;
  mustRun(s, clock, {
    schema: "orca-raw-command-v1", commandId: `disable-${scheduleId}`, actorId: "human", expectedRevision: revision, verb: "schedule-enable",
    target: { kind: "schedule", scheduleId }, payload: { enabled: false },
  } as ScheduleCommand);
};

const fireRows = (s: ControlStore, scheduleId: string): Array<Record<string, unknown>> =>
  s.db.prepare("SELECT * FROM schedule_fires WHERE schedule_id=? ORDER BY seq").all(scheduleId) as Array<Record<string, unknown>>;
const count = (s: ControlStore, table: "flow_runs" | "commands"): number => Number(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
const bookedCount = (s: ControlStore, scheduleId: string, slot: number): number =>
  Number(s.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id=?").get(firedGroupId(scheduleId, slot))!.n);

function writeFlowRun(s: ControlStore, fire: ScheduleFire): { flowRunId: string } {
  const commandId = fire.body.commandId!;
  const flowRunId = `fr-${uuidOf(commandId)}`;
  const groupId = `flow-${uuidOf(commandId)}`;
  s.transaction(() => {
    s.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,1,1,0,?)")
      .run(groupId, JSON.stringify({ groupId, status: "running" }));
    s.db.prepare(`INSERT INTO flow_runs(id,group_id,template_ref,template_sha256,workspace,vault_id,params_sha256,pool_tokens,pool_drawn,state,revision,body)
      VALUES (?,?,?,?,?,NULL,?,1000,0,'running',0,'{}')`)
      .run(flowRunId, groupId, "builtin/wechat-article@1", "0".repeat(64), JSON.stringify({ projectId: REPO, kind: "dir" }), "1".repeat(64));
  });
  return { flowRunId };
}

function writeBookedImport(s: ControlStore, fire: ScheduleFire): { groupId: string } {
  const groupId = firedGroupId(fire.scheduleId, fire.slot);
  const commandId = fire.body.commandId!;
  s.transaction(() => {
    s.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,1,1,0,?)")
      .run(groupId, JSON.stringify({ groupId, status: "draft" }));
    s.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result,original_status,body_json) VALUES (?,?,?,?,?,?)")
      .run(groupId, commandId, "hash", "{}", 200, JSON.stringify({ schema: "orca-command-success-v1" }));
  });
  return { groupId };
}

const passAt = (s: ControlStore, clock: Clock, when: number, starters: Omit<SchedulePassDeps, "store" | "now">): Promise<{ crashes: string[] }> => {
  clock.at = when;
  return schedulesPass({ store: s, now: () => clock.at, ...starters }, when);
};

/** A crash no longer rejects the pass: it is reported, one line naming the schedule, and the fire stays `starting`. */
const crashed = async (pass: Promise<{ crashes: string[] }>, scheduleId: string, message: string): Promise<void> => {
  const { crashes } = await pass;
  expect(crashes).toHaveLength(1);
  expect(crashes[0], scheduleId).toContain(scheduleId);
  expect(crashes[0], scheduleId).toContain(message);
};

describe("C5 crash resume", () => {
  it("(a) a throw after T1: the next pass completes it -- one flow run with the same flowRunId", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      createFlow(s, clock, "sch-b");
      let calls = 0;
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        calls += 1;
        if (fire.scheduleId === "sch-a" && calls === 1) throw new Error("crash after T1");
        return writeFlowRun(s, fire);
      };
      await crashed(passAt(s, clock, at(1, 9), { startFlow: starter }), "sch-a", "crash after T1");
      expect(fireRows(s, "sch-a")[0]!.outcome).toBe("starting");
      // The crash starved nothing: the next schedule still started in the same pass.
      expect(fireRows(s, "sch-b")[0]!.outcome).toBe("started");
      await passAt(s, clock, at(1, 9), { startFlow: starter });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("started");
      expect(count(s, "flow_runs")).toBe(2);
      const commandId = JSON.parse(String(fires[0]!.body)).commandId as string;
      expect(String(fires[0]!.flow_run_id)).toBe(`fr-${uuidOf(commandId)}`);
      expect(calls).toBe(3);
    } finally { s.close(); }
  });

  it("(a) a throw after T1: the next pass completes it -- one group, same sgrp- id, one booked row", async () => {
    const { s, clock } = await openStore();
    try {
      createGroup(s, clock);
      let calls = 0;
      const commandIds: string[] = [];
      const starter = async (fire: ScheduleFire): Promise<{ groupId: string }> => {
        calls += 1;
        commandIds.push(fire.body.commandId!);
        if (calls === 1) throw new Error("crash after T1");
        return writeBookedImport(s, fire);
      };
      await crashed(passAt(s, clock, at(1, 9), { startGroup: starter }), "sch-g", "crash after T1");
      expect(fireRows(s, "sch-g")[0]!.outcome).toBe("starting");
      await passAt(s, clock, at(1, 9), { startGroup: starter });
      const fires = fireRows(s, "sch-g");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("started");
      const groupId = firedGroupId("sch-g", at(1, 9));
      expect(FIRED_GROUP_ID.test(groupId)).toBe(true);
      expect(String(fires[0]!.group_id)).toBe(groupId);
      // The re-run is T1's own command: the same commandId and the same sgrp- group.
      expect(commandIds).toHaveLength(2);
      expect(commandIds[1]).toBe(commandIds[0]);
      expect(commandIds[1]).toBe(`orca-auto-schedule-sch-g-${at(1, 9)}`);
      expect(s.db.prepare("SELECT group_id FROM commands WHERE id=?").get(commandIds[1]!)!.group_id).toBe(groupId);
      expect(bookedCount(s, "sch-g", at(1, 9))).toBe(1);
    } finally { s.close(); }
  });

  it("(a) a refused re-run after a crash settles failed and counts; the pass starts the next schedule", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      createFlow(s, clock, "sch-b");
      const crash = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        if (fire.scheduleId === "sch-a") throw new Error("crash after T1");
        return writeFlowRun(s, fire);
      };
      await crashed(passAt(s, clock, at(1, 9), { startFlow: crash }), "sch-a", "crash after T1");
      expect(fireRows(s, "sch-a")[0]!.outcome).toBe("starting");
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        if (fire.scheduleId === "sch-a") throw new FlowRefusal("flow-param-invalid:idea", "the idea");
        return writeFlowRun(s, fire);
      };
      await passAt(s, clock, at(1, 9), { startFlow: starter });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("failed");
      expect(fires[0]!.reason).toBe("flow-param-invalid:idea");
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(1);
      expect(fireRows(s, "sch-b")[0]!.outcome).toBe("started");
      expect(count(s, "flow_runs")).toBe(1);
    } finally { s.close(); }
  });

  it("(b) a throw after the start wrote its rows, before T2: still one run, no second call", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      let calls = 0;
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        calls += 1;
        writeFlowRun(s, fire);
        throw new Error("crash before T2");
      };
      await crashed(passAt(s, clock, at(1, 9), { startFlow: starter }), "sch-a", "crash before T2");
      expect(fireRows(s, "sch-a")[0]!.outcome).toBe("starting");
      await passAt(s, clock, at(1, 9), { startFlow: starter });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("started");
      expect(count(s, "flow_runs")).toBe(1);
      expect(calls).toBe(1);
    } finally { s.close(); }
  });

  it("(b) the group variant: a booked import before the throw is recorded started", async () => {
    const { s, clock } = await openStore();
    try {
      createGroup(s, clock);
      const starter = async (fire: ScheduleFire): Promise<{ groupId: string }> => {
        writeBookedImport(s, fire);
        throw new Error("crash before T2");
      };
      await crashed(passAt(s, clock, at(1, 9), { startGroup: starter }), "sch-g", "crash before T2");
      await passAt(s, clock, at(1, 9), { startGroup: starter });
      expect(fireRows(s, "sch-g")[0]!.outcome).toBe("started");
      expect(bookedCount(s, "sch-g", at(1, 9))).toBe(1);
    } finally { s.close(); }
  });

  it("a corrupt historical body is ignored; a corrupt active body crashes only its schedule", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      createFlow(s, clock, "sch-b");
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => writeFlowRun(s, fire);
      // A settled row from long ago whose body no longer parses: history, not a decision for this pass.
      s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-a',1,?,?,'failed','x',NULL,NULL,'orca-auto','schedule:sch-a','not json')`)
        .run(at(0, 9), at(0, 9));
      await passAt(s, clock, at(1, 9), { startFlow: starter });
      expect(fireRows(s, "sch-a")[1]!.outcome).toBe("started");
      for (const scheduleId of ["sch-a", "sch-b"]) {
        s.db.prepare("UPDATE flow_runs SET state='done' WHERE id=?").run(String(fireRows(s, scheduleId).at(-1)!.flow_run_id));
      }
      // An active row whose body does not parse: that schedule is the crash, the pass still starts the other one.
      s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body)
        VALUES ('sch-b',2,?,?,'started',NULL,NULL,NULL,'orca-auto','schedule:sch-b','not json')`)
        .run(at(2, 9), at(2, 9));
      const { crashes } = await passAt(s, clock, at(3, 9), { startFlow: starter });
      expect(crashes).toHaveLength(1);
      expect(crashes[0]).toContain("sch-b");
      expect(fireRows(s, "sch-a")[2]!.outcome).toBe("started");
    } finally { s.close(); }
  });

  it("(c) a crash then the next slot: the old fire completes first, the new slot is skipped, never two runs", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      let calls = 0;
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        calls += 1;
        if (calls === 1) throw new Error("crash after T1");
        return writeFlowRun(s, fire);
      };
      await crashed(passAt(s, clock, at(1, 9), { startFlow: starter }), "sch-a", "crash after T1");
      await passAt(s, clock, at(2, 9), { startFlow: starter });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(2);
      expect(fires[0]!.outcome).toBe("started");
      expect(Number(fires[0]!.slot)).toBe(at(1, 9));
      expect(fires[1]!.outcome).toBe("skipped");
      expect(Number(fires[1]!.slot)).toBe(at(2, 9));
      expect(String(fires[1]!.reason)).toBe(`previous-active:${String(fires[0]!.flow_run_id)}`);
      expect(count(s, "flow_runs")).toBe(1);
    } finally { s.close(); }
  });

  it("(e) no run and disabled: failed schedule-disabled, streak unchanged", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      let calls = 0;
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        calls += 1;
        writeFlowRun(s, fire);
        throw new Error("crash after T1");
      };
      // A crash before any run was written: the starter never gets its row in.
      const noRun = async (): Promise<{ flowRunId: string }> => { calls += 1; throw new Error("crash after T1"); };
      await crashed(passAt(s, clock, at(1, 9), { startFlow: noRun }), "sch-a", "crash after T1");
      disable(s, clock, "sch-a");
      await passAt(s, clock, at(1, 10), { startFlow: starter });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("failed");
      expect(fires[0]!.reason).toBe("schedule-disabled");
      expect(readSchedule(s, "sch-a")!.body.state.failureStreak).toBe(0);
      expect(count(s, "flow_runs")).toBe(0);
      expect(calls).toBe(1);
    } finally { s.close(); }
  });

  it("(e) the start already happened before the disable: started, what happened is recorded", async () => {
    const { s, clock } = await openStore();
    try {
      createFlow(s, clock);
      const starter = async (fire: ScheduleFire): Promise<{ flowRunId: string }> => {
        writeFlowRun(s, fire);
        throw new Error("crash before T2");
      };
      await crashed(passAt(s, clock, at(1, 9), { startFlow: starter }), "sch-a", "crash before T2");
      disable(s, clock, "sch-a");
      await passAt(s, clock, at(1, 10), { startFlow: starter });
      const fires = fireRows(s, "sch-a");
      expect(fires).toHaveLength(1);
      expect(fires[0]!.outcome).toBe("started");
      expect(count(s, "flow_runs")).toBe(1);
    } finally { s.close(); }
  });

  it("(d) R2's confirm booked, a throw before step 9 records it: the next pass copies auto-confirmed", async () => {
    const { s, clock } = await openStore();
    try {
      createGroup(s, clock);
      const slot = at(1, 9);
      const scheduleId = "sch-g";
      const groupId = firedGroupId(scheduleId, slot);
      const bodyOf = () => JSON.parse(String(s.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
      // The import of a fired group writes an origin and an unlimited limit, which is what step 9 reads.
      const starter = async (fire: ScheduleFire): Promise<{ groupId: string }> => {
        writeBookedImport(s, fire);
        const body = { groupId, status: "draft", origin: { kind: "schedule", scheduleId, slot }, limit: { tokens: null } };
        s.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
        return { groupId };
      };
      await passAt(s, clock, at(1, 9), { startGroup: starter });
      expect(fireRows(s, scheduleId)[0]!.outcome).toBe("started");
      // R2's pass booked its success after the fire pass (the pump runs it after `schedulesPass`).
      s.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result,original_status,body_json) VALUES (?,?,?,?,?,?)")
        .run(groupId, autoConfirmCommandId(1), "hash", JSON.stringify({ schema: "orca-command-success-v1" }), 201, "{}");
      const stored = bodyOf();
      // A throw before step 9 records it: this pass cannot read the group, so the fire keeps no confirm.
      s.db.prepare("UPDATE groups SET body='not json' WHERE id=?").run(groupId);
      const thrown = await passAt(s, clock, at(1, 10), { startGroup: starter });
      expect(thrown.crashes).toHaveLength(1);
      expect(thrown.crashes[0]).toContain(scheduleId);
      expect(JSON.parse(String(fireRows(s, scheduleId)[0]!.body)).confirm).toBeUndefined();
      // Healed from the booked row, not from pass state.
      s.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(stored), groupId);
      await passAt(s, clock, at(1, 11), { startGroup: starter });
      const confirm = { state: "auto-confirmed", commandId: autoConfirmCommandId(1), code: null, at: at(1, 11) };
      expect(JSON.parse(String(fireRows(s, scheduleId)[0]!.body)).confirm).toEqual(confirm);
      // A later pass does not rewrite an existing confirm.
      await passAt(s, clock, at(1, 12), { startGroup: starter });
      expect(JSON.parse(String(fireRows(s, scheduleId)[0]!.body)).confirm).toEqual(confirm);
      expect(fireRows(s, scheduleId)[0]!.outcome).toBe("started");
    } finally { s.close(); }
  });
});
