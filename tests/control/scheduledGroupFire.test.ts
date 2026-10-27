// Scheduled flows and groups spec 2026-10-24 §9.1, §9.2, criterion C7 (plan Task 9): a group schedule's fire is one
// booked `import-plan` through the service's own import path, as `orca-auto`, from the pinned library version -- and the
// schedule's code sends no confirm. R2's pass is not run here; C7a (scheduleWithAutoConfirm) runs both. Temp stores only.
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { canonicalPlanDoc } from "../../src/control/planLibrary/codec.js";
import { applyPlanLibraryCommand, type PlanLibraryCommand } from "../../src/control/planLibrary/commands.js";
import { appendVersion, readVersion } from "../../src/control/planLibrary/store.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { firedGroupId } from "../../src/control/schedules/model.js";
import { applyScheduleCommand, type ScheduleCommand } from "../../src/control/schedules/commands.js";
import { readSchedule } from "../../src/control/schedules/store.js";
import { WebControlService, type ConfirmCommand } from "../../src/control/webService.js";
import type { IntegrationScheme } from "../../src/control/integrationScheme.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { groupScheduleStarter } from "../../src/panel/controlAssembly.js";
import { FIXTURE_AGENT_ID } from "./fixtures/agents.js";
import { webFixture } from "./fixtures/web.js";

const REPO = "repo";
const ANA = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
const PERSON = { client: "web", principal: "user:owner", personAuthority: true };
const PLAN_AGENT = { planAgents: { agent: { agent: FIXTURE_AGENT_ID } } };
const VERSION_ORIGIN = { kind: "import" as const, fileName: "p.json", fileSha256: "f".repeat(64), format: "orca-plan-v1" as const };
const at = (day: number, hour: number): number => Date.UTC(2026, 9, 24 + day, hour, 0, 0);

type Fixture = Awaited<ReturnType<typeof webFixture>>;
type Answer = { result?: { entryId?: string; sha256?: string; version?: number }; error?: { code: string; message: string } };
const fixtures: Fixture[] = [];
afterEach(async () => { while (fixtures.length) await fixtures.pop()!.dispose(); });

const repoOf = (h: Fixture): string => join(h.root, "repo");
const groupBody = (h: Fixture, groupId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
const fireRows = (h: Fixture, scheduleId: string): Array<Record<string, unknown>> =>
  h.store.db.prepare("SELECT * FROM schedule_fires WHERE schedule_id=? ORDER BY seq").all(scheduleId) as Array<Record<string, unknown>>;
const fireBody = (row: Record<string, unknown>): { commandId?: string; confirm?: unknown } => JSON.parse(String(row.body));

/** A fixture whose imported group "g" is the library source; the clock and the schedule service share `clock`. */
async function world(options: { planAgent?: boolean } = {}) {
  const h = await webFixture(undefined, [{ taskId: "a" }], {
    tokenPolicy: "optional-v1", importContext: PERSON, ...(options.planAgent === false ? {} : PLAN_AGENT),
  });
  fixtures.push(h);
  h.store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1)").run();
  const clock = { at: at(0, 10) };
  const service = new WebControlService({ ...h.deps, now: () => new Date(clock.at), resolveRepository: () => repoOf(h) });
  const save = (commandId = "save-1"): { entryId: string; sha256: string } => {
    const command = {
      schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb: "plan-library-save",
      target: { kind: "plan-library" }, payload: { source: { kind: "group", groupId: "g" }, name: "weekly" },
    } as PlanLibraryCommand;
    const answer = withCommandContext(commandId, ANA, () => applyPlanLibraryCommand({ store: h.store, resolveRepository: () => repoOf(h) }, command)) as Answer;
    if (answer.error !== undefined) throw new Error(`${answer.error.code}: ${answer.error.message}`);
    return { entryId: answer.result!.entryId!, sha256: answer.result!.sha256! };
  };
  const schedule = (scheduleId: string, start: { entryId: string; sha256: string; tokenLimit: number | null; integration: IntegrationScheme | null }): void => {
    const command = {
      schema: "orca-raw-command-v1", commandId: `create-${scheduleId}`, actorId: "human", expectedRevision: 0, verb: "schedule-set",
      target: { kind: "schedule", scheduleId },
      payload: { projectId: REPO, name: "fired", cron: "0 9 * * *", enabled: true, start: { kind: "group", ...start } },
    } as ScheduleCommand;
    const answer = withCommandContext(command.commandId, ANA, () => applyScheduleCommand({
      store: h.store, knownRepository: (repoId: string) => repoId === REPO, now: () => new Date(clock.at),
    }, command)) as { error?: { code: string; message: string } };
    if (answer.error !== undefined) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  };
  const fire = async (when: number): Promise<{ crashes: string[] }> => {
    clock.at = when;
    return service.schedulesPass({ startGroup: groupScheduleStarter((command, origin) => service.importPlan(command, origin)) });
  };
  const confirmFired = async (groupId: string): Promise<void> => {
    const command = {
      schema: "orca-raw-command-v1", commandId: `confirm-${groupId}`, actorId: "human",
      expectedRevision: Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision),
      verb: "confirm", target: { kind: "group", groupId },
      payload: { ...(await h.confirmPayload()), planHash: readArchivedPlan(h.store, groupId).planHash },
    } as ConfirmCommand;
    const answer = await withCommandContext(command.commandId, ANA, () => service.confirm(command)) as { error?: { code: string } };
    if (answer.error !== undefined) throw new Error(answer.error.code);
  };
  return { h, clock, service, save, schedule, fire, confirmFired };
}

describe("C7: a group fire is one booked import", () => {
  it("books one import-plan as orca-auto under the fire's command id, with the origin and the pinned limit", async () => {
    const { h, clock, save, schedule, fire } = await world();
    const { entryId, sha256 } = save();
    schedule("sch-g", { entryId, sha256, tokenLimit: 5_000_000, integration: null });
    const groupId = firedGroupId("sch-g", at(1, 9));
    expect(h.store.db.prepare("SELECT id FROM groups WHERE id=?").get(groupId)).toBeUndefined();
    expect(await fire(at(1, 9))).toEqual({ crashes: [] });
    const rows = fireRows(h, "sch-g");
    expect(rows).toHaveLength(1);
    // §9.2: a group with a finite limit is a limited group, so step 9 records it waiting for the person even before R2.
    expect(rows[0]!.outcome).toBe("waiting");
    expect(rows[0]!.reason).toBe("limited");
    expect(rows[0]!.group_id).toBe(groupId);
    const commandId = fireBody(rows[0]!).commandId!;
    expect(commandId).toBe(`orca-auto-schedule-sch-g-${at(1, 9)}`);
    // One booked row, the fire's own command: no direct writeImportedPlan call would have booked it (M-C7e).
    const booked = h.store.db.prepare("SELECT id,actor_id,verb FROM commands WHERE group_id=?").all(groupId) as Array<Record<string, unknown>>;
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ id: commandId, actor_id: "orca-auto", verb: "import-plan" });
    const body = groupBody(h, groupId);
    expect(body.origin).toEqual({ kind: "schedule", scheduleId: "sch-g", slot: at(1, 9) });
    expect((body.limit as { tokens: unknown }).tokens).toBe(5_000_000);
    expect(Object.hasOwn(body, "integration")).toBe(false);
    const archived = readArchivedPlan(h.store, groupId).plan;
    expect(archived.planId).toBe(`lib-${entryId}-${sha256.slice(0, 12)}`);
    const shape = (plan: typeof archived) => plan.tasks.map((task) => ({ taskId: task.taskId, deps: task.dependencyTaskIds, hash: task.originalContractHash }));
    expect(shape(archived)).toEqual(shape(readArchivedPlan(h.store, "g").plan));
    // C7: no confirm is sent from any schedule path.
    expect(Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE verb='confirm'").get()!.n)).toBe(0);
  });

  it("imports the pinned version, not the entry's head (M-C7a)", async () => {
    const { h, clock, save, schedule, fire } = await world();
    const first = save();
    const v1 = readVersion(h.store, first.entryId, first.sha256)!;
    const second = canonicalPlanDoc({ ...(JSON.parse(v1.doc) as Record<string, unknown>), goal: "ship more" }, repoOf(h));
    const v2 = h.store.transaction(() => appendVersion(h.store, {
      entryId: first.entryId, doc: second.bytes, origin: VERSION_ORIGIN, by: "ana", via: "web", at: clock.at,
    }));
    expect(v2).toMatchObject({ version: 2, appended: true });
    schedule("sch-g", { entryId: first.entryId, sha256: first.sha256, tokenLimit: null, integration: null });
    expect(await fire(at(1, 9))).toEqual({ crashes: [] });
    const groupId = firedGroupId("sch-g", at(1, 9));
    const rows = fireRows(h, "sch-g");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("started");
    const archived = readArchivedPlan(h.store, groupId).plan;
    expect(archived.goal).toBe("ship");
    expect(archived.planId).toBe(`lib-${first.entryId}-${first.sha256.slice(0, 12)}`);
    // The group's limit is unlimited when the schedule says null: no import default fills it (M-C7a2).
    expect((groupBody(h, groupId).limit as { tokens: unknown }).tokens).toBeNull();
  });

  it("a version whose stored bytes were altered fails the fire plan-library-hash-mismatch and writes no group (M-C7b)", async () => {
    const { h, clock, save, schedule, fire } = await world();
    const { entryId, sha256 } = save();
    schedule("sch-g", { entryId, sha256, tokenLimit: null, integration: null });
    h.store.db.prepare("UPDATE plan_library_versions SET doc=replace(doc,'\"goal\":\"ship\"','\"goal\":\"sh1p\"') WHERE entry_id=? AND sha256=?")
      .run(entryId, sha256);
    expect(await fire(at(1, 9))).toEqual({ crashes: [] });
    const rows = fireRows(h, "sch-g");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("failed");
    expect(rows[0]!.reason).toBe("plan-library-hash-mismatch");
    expect(h.store.db.prepare("SELECT id FROM groups WHERE id=?").get(firedGroupId("sch-g", at(1, 9)))).toBeUndefined();
    expect(readSchedule(h.store, "sch-g")!.body.state.failureStreak).toBe(1);
  });

  const LOCAL = { delivery: "local" as const, trigger: "group" as const, method: "merge" as const, target: "main" };
  it.each([
    ["local", LOCAL, { delivery: "push-branch" as const, trigger: "task" as const, target: "main", remote: "origin" }, LOCAL],
    ["keep", null, LOCAL, null],
  ])("pins the schedule's %s integration at fire time, never the project default (M-C7c)", async (_name, pinned, projectDefault, expected) => {
    const { h, clock, save, schedule, fire } = await world();
    const { entryId, sha256 } = save();
    schedule("sch-g", { entryId, sha256, tokenLimit: null, integration: pinned });
    // The project default changes after the schedule stored its own answer.
    writeRepositorySettingsBody(h.store, REPO, { workspaceMode: "worktree", revision: 1, integration: projectDefault });
    expect(await fire(at(1, 9))).toEqual({ crashes: [] });
    const body = groupBody(h, firedGroupId("sch-g", at(1, 9)));
    if (expected === null) expect(Object.hasOwn(body, "integration")).toBe(false);
    else expect((body.integration as { scheme: unknown }).scheme).toEqual(expected);
  });

  // Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27. Review finding 6: with
  // nothing port-free blocking R2 the first pass must leave the fire to R2's booked attempt, so `estimate-failed` is
  // only recorded once R2 cannot try -- here a hand-written estimate row left `start-unknown` (R2 condition 7).
  it("an estimate that ended in failure while R2 cannot try leaves the fire waiting estimate-failed, the streak unchanged, and the group in needs-you (M-C7g)", async () => {
    // No plan agent: orca-auto has no operator default, so the import's estimator slot is rejected as blocked-capability.
    const { h, clock, save, schedule, fire } = await world({ planAgent: false });
    const { entryId, sha256 } = save();
    schedule("sch-g", { entryId, sha256, tokenLimit: null, integration: null });
    expect(await fire(at(1, 9))).toEqual({ crashes: [] });
    const groupId = firedGroupId("sch-g", at(1, 9));
    // R2 has not run in this file: nothing blocks it, so step 9 leaves the row for R2's attempt.
    expect(fireRows(h, "sch-g")[0]).toMatchObject({ outcome: "started", reason: null });
    h.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,0,'start-unknown','{}')").run(groupId, "est-stale");
    expect(await fire(at(1, 10))).toEqual({ crashes: [] });
    const reason = "estimate-failed:blocked-capability:agent-selection-rejected:estimator:agent-unselected";
    const rows = fireRows(h, "sch-g");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("waiting");
    expect(rows[0]!.reason).toBe(reason);
    expect(readSchedule(h.store, "sch-g")!.body.state.failureStreak).toBe(0);
    // The hand-written stale row is not a body the group readers accept; drop it. The recorded reason is write-once.
    h.store.db.prepare("DELETE FROM estimates WHERE id='est-stale'").run();
    expect(await fire(at(1, 11))).toEqual({ crashes: [] });
    expect(fireRows(h, "sch-g")[0]).toMatchObject({ outcome: "waiting", reason });
    const step = readControlOverview(h.store, "epoch").steps.find((entry) => entry.kind === "budget-review" && entry.groupId === groupId);
    expect(step).toMatchObject({ reason: `scheduled-waiting:${reason}`, destination: { kind: "group", groupId, region: "preparation" } });
  });
});
