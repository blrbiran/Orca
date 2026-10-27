// Scheduled flows and groups spec 2026-10-24 §6, §7.2, criterion C1 (plan Task 5: the schedule model and its verbs; the
// `schedule-from-group` integration/sha rows are Task 9's) and C10's schedule rows: every write's checks and the person it
// stamps. Temp stores only (Rule 17).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { libraryEntryId } from "../../src/control/planLibrary/commands.js";
import { appendVersion, insertEntry, readVersion } from "../../src/control/planLibrary/store.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { applyScheduleCommand, type ScheduleCommand } from "../../src/control/schedules/commands.js";
import { FIRED_GROUP_ID, SCHEDULE_ID, firedGroupId, scheduleIdFor } from "../../src/control/schedules/model.js";
import { latestFire, readSchedule } from "../../src/control/schedules/store.js";
import { scheduleDetailView, scheduleFiresView, scheduleListView } from "../../src/control/schedules/views.js";
import { idSchema } from "../../src/control/schema.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import type { IntegrationScheme } from "../../src/control/integrationScheme.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { loadBuiltin } from "../../src/flow/template/load.js";
import { webFixture } from "./fixtures/web.js";

const REPO = "repo";
const FOLDER = "/repos/proj";
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const ANA = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
type Who = { client: string; principal: string; attribution: { by: string; via: string } };
type Answer = { result?: { kind: string; scheduleId?: string; enabled?: boolean }; error?: { code: string; message: string } };

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function store(): Promise<ControlStore> {
  const root = await mkdtemp(join(tmpdir(), "schedule-model-"));
  roots.push(root);
  return openControlStore({ stateDir: join(root, "s") });
}

const depsFor = (s: ControlStore, clock: { at: number }) => ({
  store: s,
  flowProjects: () => [{ repoId: REPO, path: FOLDER }],
  knownRepository: (repoId: string) => repoId === REPO,
  now: () => new Date(clock.at),
});

/** One raw schedule command; the target names the schedule (a create and an edit share it). */
const command = <V extends ScheduleCommand["verb"]>(commandId: string, verb: V,
  payload: Extract<ScheduleCommand, { verb: V }>["payload"],
  options: { scheduleId?: string; expectedRevision?: number; actorId?: string } = {}): ScheduleCommand =>
  ({ schema: "orca-raw-command-v1", commandId, actorId: options.actorId ?? "human", expectedRevision: options.expectedRevision ?? 0, verb,
    target: { kind: "schedule", scheduleId: options.scheduleId ?? "sch-a" }, payload }) as ScheduleCommand;

const run = (s: ControlStore, cmd: ScheduleCommand, who: Who = ANA, clock: { at: number } = { at: NOW }): Answer =>
  withCommandContext(cmd.commandId, who, () => applyScheduleCommand(depsFor(s, clock), cmd)) as Answer;

/** The refusal the write books, or a failure naming the outcome when it was not refused. */
const refused = (s: ControlStore, cmd: ScheduleCommand, who?: Who, clock?: { at: number }): { code: string; message: string } => {
  const answer = run(s, cmd, who, clock);
  if (answer.error === undefined) throw new Error(`not refused: ${JSON.stringify(answer.result)}`);
  return answer.error;
};

/** A create: the project-named arm of `schedule-set`'s payload, and its two start arms. */
type CreatePayload = Extract<Extract<ScheduleCommand, { verb: "schedule-set" }>["payload"], { projectId: string }>;
type GroupStart = Extract<CreatePayload["start"], { kind: "group" }>;

const flowCreate = (overrides: Partial<CreatePayload> = {}): CreatePayload => ({
  projectId: REPO, name: "weekly", cron: "0 9 * * *", enabled: false,
  start: { kind: "flow", template: "wechat-article", params: { idea: "a topic" } }, ...overrides,
});
const groupCreate = (start: GroupStart, overrides: Partial<CreatePayload> = {}): CreatePayload => flowCreate({ start, ...overrides });

const VERSION_ORIGIN = { kind: "import" as const, fileName: "p.json", fileSha256: "f".repeat(64), format: "orca-plan-v1" as const };
const version = (s: ControlStore, entryId: string, projectId: string, doc = `{"entry":"${entryId}"}`): string =>
  s.transaction(() => {
    insertEntry(s, { id: entryId, projectId, name: "p", by: "ana", via: "web", at: NOW });
    return appendVersion(s, { entryId, doc, origin: VERSION_ORIGIN, by: "ana", via: "web", at: NOW }).sha256;
  });

describe("the schedule model's write checks (§6, C1)", () => {
  it("refuses a cron that fires twice an hour (check-schedule-too-frequent) and writes nothing", async () => {
    const s = await store();
    try {
      const answer = refused(s, command("c1", "schedule-set", flowCreate({ cron: "0,30 9 * * *" })));
      expect(answer.code).toBe("check-schedule-too-frequent");
      expect(readSchedule(s, "sch-a")).toBeNull();
    } finally { s.close(); }
  });

  it("refuses a zone the host cannot read (check-time-zone-invalid) and writes nothing", async () => {
    const s = await store();
    try {
      s.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,?,1)").run("Mars/Olympus");
      const answer = refused(s, command("c1", "schedule-set", flowCreate()));
      expect(answer.code).toBe("check-time-zone-invalid");
      expect(readSchedule(s, "sch-a")).toBeNull();
    } finally { s.close(); }
  });

  it("refuses a 9th live schedule (schedule-limit); a removed one frees a place", async () => {
    const s = await store();
    try {
      for (let i = 0; i < 8; i += 1) {
        expect(run(s, command(`new-${i}`, "schedule-set", flowCreate(), { scheduleId: `sch-s${i}` })).error, `create ${i}`).toBeUndefined();
      }
      const ninth = refused(s, command("new-8", "schedule-set", flowCreate(), { scheduleId: "sch-s8" }));
      expect(ninth.code).toBe("schedule-limit");
      expect(ninth.message).toContain("schedule-limit:8");
      expect(readSchedule(s, "sch-s8")).toBeNull();
      // A removed schedule does not count: the ninth place is free again.
      expect(run(s, command("rm-0", "schedule-remove", {}, { scheduleId: "sch-s0", expectedRevision: 1 })).error).toBeUndefined();
      expect(run(s, command("new-8-retry", "schedule-set", flowCreate(), { scheduleId: "sch-s8" })).error).toBeUndefined();
      expect(readSchedule(s, "sch-s8")).not.toBeNull();
    } finally { s.close(); }
  });

  it("refuses a flow schedule on a project that is not a registered dir project (flow-dir-unregistered)", async () => {
    const s = await store();
    try {
      const answer = refused(s, command("c1", "schedule-set", flowCreate({ projectId: "other" })));
      expect(answer.code).toBe("flow-dir-unregistered");
      expect(readSchedule(s, "sch-a")).toBeNull();
    } finally { s.close(); }
  });

  it("refuses a param that is not the template's type and an absolute image param", async () => {
    const s = await store();
    try {
      const wrongType = refused(s, command("c1", "schedule-set",
        flowCreate({ start: { kind: "flow", template: "wechat-article", params: { idea: "a topic", illustrations: "yes" } } })));
      expect(wrongType.code).toBe("flow-param-invalid");
      expect(wrongType.message).toContain("illustrations");
      // The image param is a folder-relative path at every fire, so a preset-style absolute one is refused at write.
      const absolute = refused(s, command("c2", "schedule-set",
        flowCreate({ start: { kind: "flow", template: "wechat-article", params: { idea: "a topic", coverImage: "/tmp/cover.png" } } })));
      expect(absolute.code).toBe("schedule-param-absolute");
      expect(absolute.message).toContain("coverImage");
      expect(readSchedule(s, "sch-a")).toBeNull();
    } finally { s.close(); }
  });

  it("refuses a param that is only the prototype chain (toString is not a template parameter)", async () => {
    const s = await store();
    try {
      const answer = refused(s, command("c1", "schedule-set",
        flowCreate({ start: { kind: "flow", template: "wechat-article", params: { toString: "x" } } })));
      expect(answer.code).toBe("flow-param-invalid");
      expect(answer.message).toContain("toString");
      expect(readSchedule(s, "sch-a")).toBeNull();
    } finally { s.close(); }
  });

  it("refuses a write whose schedule id is not sch- (control-argument-invalid)", async () => {
    const s = await store();
    try {
      const answer = refused(s, command("c1", "schedule-set", flowCreate(), { scheduleId: "weekly" }));
      expect(answer.code).toBe("control-argument-invalid");
      expect(readSchedule(s, "weekly")).toBeNull();
    } finally { s.close(); }
  });

  it("stores a template named without a version at the version the build ships", async () => {
    const s = await store();
    try {
      const shipped = loadBuiltin("wechat-article").template.version;
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      expect(readSchedule(s, "sch-a")!.body.start).toMatchObject({ kind: "flow", template: `builtin/wechat-article@${shipped}` });
    } finally { s.close(); }
  });

  it("refuses a group start with no sha256 (schema), an unknown entry or version, and another project's entry", async () => {
    const s = await store();
    try {
      const entryId = "pl-0123456789abcdef";
      const sha256 = version(s, entryId, REPO);
      // §6.1: a group start always names the version's sha256; the raw command schema refuses one without it.
      const noSha = command("g0", "schedule-set", groupCreate({ kind: "group", entryId, tokenLimit: null, integration: null } as unknown as GroupStart));
      expect(rawAuthorityCommandSchema.safeParse(noSha).success).toBe(false);
      const complete = groupCreate({ kind: "group", entryId, sha256, tokenLimit: null, integration: null });
      expect(rawAuthorityCommandSchema.safeParse(command("g0b", "schedule-set", complete)).success).toBe(true);
      // An entry no row names, and a version the entry does not have.
      const unknownEntry = refused(s, command("g1", "schedule-set",
        groupCreate({ kind: "group", entryId: "pl-0000000000000000", sha256, tokenLimit: null, integration: null })));
      expect(unknownEntry.code).toBe("plan-library-entry-not-found");
      expect(unknownEntry.message).toContain("pl-0000000000000000");
      const unknownVersion = refused(s, command("g2", "schedule-set",
        groupCreate({ kind: "group", entryId, sha256: "0".repeat(64), tokenLimit: null, integration: null })));
      expect(unknownVersion.code).toBe("plan-library-entry-not-found");
      expect(unknownVersion.message).toContain(`${entryId}@${"0".repeat(64)}`);
      // An entry of another project.
      const otherId = "pl-fedcba9876543210";
      const otherSha = version(s, otherId, "other");
      const mismatch = refused(s, command("g3", "schedule-set",
        groupCreate({ kind: "group", entryId: otherId, sha256: otherSha, tokenLimit: null, integration: null })));
      expect(mismatch.code).toBe("plan-library-project-mismatch");
      expect(mismatch.message).toContain(otherId);
      // The same start of this project's entry is stored with its version.
      expect(run(s, command("g4", "schedule-set", complete)).error).toBeUndefined();
      expect(readSchedule(s, "sch-a")!.body.start).toMatchObject({ kind: "group", entryId, sha256 });
    } finally { s.close(); }
  });

  it("names a schedule sch-, a fired group sgrp- and a library entry pl-, each a valid id", () => {
    const scheduleId = scheduleIdFor("Weekly Article");
    const fired = firedGroupId(scheduleId, NOW);
    const entry = libraryEntryId("cmd-1");
    expect(scheduleId).toMatch(SCHEDULE_ID);
    expect(fired).toMatch(FIRED_GROUP_ID);
    expect(entry).toMatch(/^pl-/);
    for (const id of [scheduleId, fired, entry]) expect(idSchema.safeParse(id).success, id).toBe(true);
  });

  it("slugs a name: empty is sch-schedule, edges trimmed, the slug capped at 59", () => {
    expect(scheduleIdFor("  ")).toBe("sch-schedule");
    expect(scheduleIdFor("  Weekly  ")).toBe("sch-weekly");
    const capped = scheduleIdFor("x".repeat(100));
    expect(capped).toBe(`sch-${"x".repeat(59)}`);
    expect(capped).toMatch(SCHEDULE_ID);
  });

  it("never ends a capped slug in a dash (the cut lands inside a separator)", () => {
    const id = scheduleIdFor(`${"a".repeat(58)} b`);
    expect(id.endsWith("-")).toBe(false);
    expect(id).toBe(`sch-${"a".repeat(58)}`);
    expect(id).toMatch(SCHEDULE_ID);
  });
});

describe("the schedule reads (§13.1, B2): revision, guarded bodies", () => {
  it("exposes the row's revision: 1 after a create, 2 after an edit, in the detail and the list", async () => {
    const s = await store();
    try {
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      expect(scheduleDetailView(s, "sch-a", NOW).revision).toBe(1);
      expect(scheduleListView(s, REPO, NOW).schedules.map((row) => row.revision)).toEqual([1]);
      expect(run(s, command("e1", "schedule-set", { set: { name: "renamed" } }, { expectedRevision: 1 })).error).toBeUndefined();
      expect(scheduleDetailView(s, "sch-a", NOW).revision).toBe(2);
      expect(scheduleListView(s, REPO, NOW).schedules.map((row) => row.revision)).toEqual([2]);
    } finally { s.close(); }
  });

  it("refuses a corrupt fire body as schedule-fire-body-invalid, never a SyntaxError", async () => {
    const s = await store();
    try {
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      // Not JSON, and JSON that parses to something the views cannot dereference (`null`, an array).
      for (const body of ["not json", "null", "[]"]) {
        s.db.prepare("DELETE FROM schedule_fires WHERE schedule_id=?").run("sch-a");
        s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run("sch-a", 1, NOW, NOW, "skipped", null, null, null, "orca-auto", "schedule:sch-a", body);
        expect(() => scheduleFiresView(s, "sch-a", 10), body).toThrow("recovery-blocked:schedule-fire-body-invalid");
        expect(() => latestFire(s, "sch-a"), body).toThrow("recovery-blocked:schedule-fire-body-invalid");
      }
    } finally { s.close(); }
  });

  // Review finding 5 (session 7753e97d): the list builds each schedule's last fire; one fire body that does not parse is
  // that schedule's corrupt row, while every other schedule of the project is still listed.
  it("lists a schedule whose newest fire body is unreadable under corrupt, and still lists the others", async () => {
    const s = await store();
    try {
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      expect(run(s, command("c2", "schedule-set", flowCreate(), { scheduleId: "sch-b" })).error).toBeUndefined();
      s.db.prepare(`INSERT INTO schedule_fires(schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,"by",via,body) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run("sch-b", 1, NOW, NOW, "failed", "x", null, null, "orca-auto", "schedule:sch-b", "not json");
      const view = scheduleListView(s, REPO, NOW);
      expect(view.schedules.map((row) => row.id)).toEqual(["sch-a"]);
      expect(view.corrupt).toEqual([{ id: "sch-b", code: "recovery-blocked", message: "recovery-blocked:schedule-fire-body-invalid" }]);
    } finally { s.close(); }
  });

  it("reports a hand-edited body whose cron no longer parses as a corrupt row, not a failed list", async () => {
    const s = await store();
    try {
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      const row = readSchedule(s, "sch-a")!;
      // §6's at-most-hourly rule holds of the stored body too: every minute is not a valid stored cron.
      for (const cron of ["nope", "* * * * *"]) {
        s.db.prepare("UPDATE schedules SET body=? WHERE id=?").run(JSON.stringify({ ...row.body, cron }), "sch-a");
        expect(() => readSchedule(s, "sch-a"), cron).toThrow("recovery-blocked:schedule-body-invalid");
        expect(scheduleListView(s, REPO, NOW), cron).toEqual({
          schema: "orca-schedules-v1", repoId: REPO, schedules: [],
          corrupt: [{ id: "sch-a", code: "recovery-blocked", message: "recovery-blocked:schedule-body-invalid" }],
        });
      }
    } finally { s.close(); }
  });

  it("removes a corrupt schedule without parsing it, keeping its body bytes; a parseable row is unchanged", async () => {
    const s = await store();
    try {
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      s.db.prepare("UPDATE schedules SET body=? WHERE id=?").run("not json", "sch-a");
      expect(run(s, command("rm-corrupt", "schedule-remove", {}, { expectedRevision: 1 })).error).toBeUndefined();
      const row = s.db.prepare("SELECT revision,removed,body FROM schedules WHERE id='sch-a'").get()!;
      expect([Number(row.revision), Number(row.removed), String(row.body)]).toEqual([2, 1, "not json"]);
      expect(refused(s, command("rm-again", "schedule-remove", {}, { expectedRevision: 2 })).code).toBe("no-op-command");
      // Removed rows are not live, so the live list carries neither the corrupt row nor a corrupt entry for it.
      expect(scheduleListView(s, REPO, NOW)).toEqual({ schema: "orca-schedules-v1", repoId: REPO, schedules: [], corrupt: [] });
      // A live parseable row still lists and removes through the stamped path.
      expect(run(s, command("c2", "schedule-set", flowCreate(), { scheduleId: "sch-b" })).error).toBeUndefined();
      expect(scheduleListView(s, REPO, NOW).schedules.map((candidate) => candidate.id)).toEqual(["sch-b"]);
      expect(run(s, command("rm-b", "schedule-remove", {}, { scheduleId: "sch-b", expectedRevision: 1 })).error).toBeUndefined();
      expect(readSchedule(s, "sch-b")).toMatchObject({ removed: true, revision: 2, body: { updatedBy: "ana" } });
    } finally { s.close(); }
  });
});

describe("C10: every schedule write stamps the routed person, never the actor", () => {
  it("stamps the creator on create and the editor on edit", async () => {
    const s = await store();
    const clock = { at: NOW };
    try {
      const bo = { client: "cli:claude", principal: "agent:cli:claude", attribution: { by: "bo", via: "cli:claude" } };
      expect(run(s, command("c1", "schedule-set", flowCreate(), { actorId: "human" }), ANA, clock).error).toBeUndefined();
      let body = readSchedule(s, "sch-a")!.body;
      expect([body.createdBy, body.createdVia, body.createdAt, body.updatedBy, body.updatedVia, body.enabledBy, body.enabledVia])
        .toEqual(["ana", "web", NOW, "ana", "web", "ana", "web"]);
      clock.at = NOW + 1_000;
      expect(run(s, command("e1", "schedule-set", { set: { name: "renamed" } }, { expectedRevision: 1 }), bo, clock).error).toBeUndefined();
      body = readSchedule(s, "sch-a")!.body;
      expect([body.name, body.createdBy, body.createdVia, body.updatedBy, body.updatedVia, body.updatedAt])
        .toEqual(["renamed", "ana", "web", "bo", "cli:claude", NOW + 1_000]);
      expect([body.enabledBy, body.enabledVia]).toEqual(["ana", "web"]);
    } finally { s.close(); }
  });

  it("stamps the person who enabled, removed and resumed", async () => {
    const s = await store();
    const clock = { at: NOW };
    try {
      const cy = { client: "mcp:orca", principal: "agent:mcp:orca", attribution: { by: "cy", via: "mcp:orca" } };
      const di = { client: "web", principal: "web", attribution: { by: "di", via: "web" } };
      expect(run(s, command("c1", "schedule-set", flowCreate())).error).toBeUndefined();
      clock.at = NOW + 1_000;
      expect(run(s, command("en1", "schedule-enable", { enabled: true }, { expectedRevision: 1 }), cy, clock).error).toBeUndefined();
      let body = readSchedule(s, "sch-a")!.body;
      expect([body.enabled, body.enabledBy, body.enabledVia, body.enabledAt, body.updatedBy, body.updatedVia])
        .toEqual([true, "cy", "mcp:orca", NOW + 1_000, "cy", "mcp:orca"]);
      clock.at = NOW + 2_000;
      expect(run(s, command("rm1", "schedule-remove", {}, { expectedRevision: 2 }), di, clock).error).toBeUndefined();
      body = readSchedule(s, "sch-a")!.body;
      expect([body.updatedBy, body.updatedVia, body.updatedAt, body.enabledBy]).toEqual(["di", "web", NOW + 2_000, "cy"]);
      // A paused schedule, resumed by another person.
      expect(run(s, command("c2", "schedule-set", flowCreate(), { scheduleId: "sch-p" })).error).toBeUndefined();
      const paused = readSchedule(s, "sch-p")!;
      s.db.prepare("UPDATE schedules SET body=? WHERE id=?").run(
        JSON.stringify({ ...paused.body, state: { ...paused.body.state, paused: true, pausedReason: "flow-param-invalid" } }), "sch-p");
      clock.at = NOW + 3_000;
      expect(run(s, command("res1", "schedule-resume", {}, { scheduleId: "sch-p", expectedRevision: 1 }), ANA, clock).error).toBeUndefined();
      body = readSchedule(s, "sch-p")!.body;
      expect([body.state.paused, body.updatedBy, body.updatedVia, body.updatedAt]).toEqual([false, "ana", "web", NOW + 3_000]);
    } finally { s.close(); }
  });
});

describe("C1: schedule-from-group pins the source scheme and the saved version (§6.1, §11.1)", () => {
  const LOCAL: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main" };
  const PUSH: IntegrationScheme = { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" };

  it.each([
    ["local", LOCAL, PUSH, LOCAL],
    ["keep", undefined, LOCAL, null],
  ])("the source's %s scheme is pinned, never the project default set after the import", async (_name, imported, later, expected) => {
    const h = await webFixture(undefined, [{ taskId: "a" }], {
      tokenPolicy: "optional-v1", ...(imported === undefined ? {} : { integration: imported }),
    });
    try {
      // The repository default changes after the source group was imported.
      writeRepositorySettingsBody(h.store, REPO, { workspaceMode: "worktree", revision: 2, integration: later });
      const commandId = "from-g-1";
      const groupRevision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const fromGroup = {
        schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: groupRevision, verb: "schedule-from-group",
        target: { kind: "group", groupId: "g" },
        payload: { scheduleId: "sch-from", name: "weekly", cron: "0 9 * * *", enabled: false, tokenLimit: 2_000_000 },
      } as ScheduleCommand;
      const answer = withCommandContext(commandId, ANA, () => applyScheduleCommand({
        store: h.store, knownRepository: (repoId: string) => repoId === REPO,
        resolveRepository: () => join(h.root, "repo"), now: () => new Date(NOW),
      }, fromGroup)) as Answer;
      expect(answer.error).toBeUndefined();
      const start = readSchedule(h.store, "sch-from")!.body.start;
      expect(start).toMatchObject({ kind: "group", entryId: libraryEntryId(commandId), tokenLimit: 2_000_000, integration: expected });
      if (start.kind !== "group") throw new Error("the schedule's start is not a group");
      // The source group's recorded scheme is what the schedule pins (keep is no field/ null, not a scheme).
      const source = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      expect(start.integration).toEqual(source.integration?.scheme ?? null);
      // §11.1: the start pins the version this command just appended, not the group's head by name.
      const version = readVersion(h.store, libraryEntryId(commandId), start.sha256)!;
      expect(version).not.toBeNull();
      expect(version.origin).toEqual({ kind: "group", groupId: "g", planHash: readArchivedPlan(h.store, "g").planHash });
    } finally { await h.dispose(); }
  });
});
