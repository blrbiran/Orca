// Scheduled flows and groups spec 2026-10-24 §9.2, criterion C7a (plan Task 9): both passes together, in the real pump
// order -- `schedulesPass → autoConfirmUnlimitedPass → autoStart` -- so R2's confirm (or its booked refusal) is what step 9
// copies and a confirmed group starts in the same pump. Fake agents only; temp stores only.
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autoConfirmCommandId } from "../../src/control/autoConfirm.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { applyPlanLibraryCommand, type PlanLibraryCommand } from "../../src/control/planLibrary/commands.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { firedGroupId } from "../../src/control/schedules/model.js";
import { applyScheduleCommand, type ScheduleCommand } from "../../src/control/schedules/commands.js";
import { WebControlService, type ConfirmCommand } from "../../src/control/webService.js";
import type { IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ImportDefaults } from "../../src/control/planImport.js";
import type { PartialSelection } from "../../src/control/agentSelection.js";
import { groupScheduleStarter } from "../../src/panel/controlAssembly.js";
import { FIXTURE_AGENT_ID } from "./fixtures/agents.js";
import { profileSnapshot, webFixture, type WebFixtureOptions } from "./fixtures/web.js";

const REPO = "repo";
const ANA = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
const PERSON = { client: "web", principal: "user:owner", personAuthority: true };
const PLAN_AGENT = { agent: { agent: FIXTURE_AGENT_ID } };
const LOCAL: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main" };
const PUSH: IntegrationScheme = { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" };
const at = (day: number, hour: number): number => Date.UTC(2026, 9, 24 + day, hour, 0, 0);

type Fixture = Awaited<ReturnType<typeof webFixture>>;
type Answer = { result?: { entryId?: string; sha256?: string }; error?: { code: string; message: string } };
const fixtures: Fixture[] = [];
afterEach(async () => { while (fixtures.length) await fixtures.pop()!.dispose(); });

const repoOf = (h: Fixture): string => join(h.root, "repo");
const fireRows = (h: Fixture): Array<Record<string, unknown>> =>
  h.store.db.prepare("SELECT * FROM schedule_fires WHERE schedule_id='sch-g' ORDER BY seq").all() as Array<Record<string, unknown>>;
const fireAt = (h: Fixture, slot: number): Record<string, unknown> => fireRows(h).find((row) => Number(row.slot) === slot)!;
const fireBody = (row: Record<string, unknown>): { commandId?: string; confirm?: unknown } => JSON.parse(String(row.body));
const commandsOf = (h: Fixture, groupId: string, like: string): Array<Record<string, unknown>> =>
  h.store.db.prepare("SELECT id, actor_id, verb, result FROM commands WHERE group_id=? AND id LIKE ? ORDER BY rowid").all(groupId, like) as Array<Record<string, unknown>>;

interface WorldOptions {
  defaults?: "configured" | "null";
  planAgents?: WebFixtureOptions["planAgents"];
  tasks?: Parameters<typeof webFixture>[1];
  snapshot?: ReturnType<typeof profileSnapshot>;
}

/** A fixture whose group "g" is the library source; the clock, the defaults and the schedule service share this world. */
async function world(options: WorldOptions = {}) {
  const h = await webFixture(options.snapshot, options.tasks ?? [{ taskId: "a" }], {
    tokenPolicy: "optional-v1", importContext: PERSON, planAgents: options.planAgents ?? PLAN_AGENT,
  });
  fixtures.push(h);
  h.store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1)").run();
  const clock = { at: at(0, 10) };
  let defaults: ImportDefaults | null = options.defaults === "null" ? null : h.deps.defaults();
  const service = new WebControlService({ ...h.deps, defaults: () => defaults, now: () => new Date(clock.at), resolveRepository: () => repoOf(h) });
  const save = (): { entryId: string; sha256: string } => {
    const command = {
      schema: "orca-raw-command-v1", commandId: "save-1", actorId: "human", expectedRevision: 0, verb: "plan-library-save",
      target: { kind: "plan-library" }, payload: { source: { kind: "group", groupId: "g" }, name: "weekly" },
    } as PlanLibraryCommand;
    const answer = withCommandContext(command.commandId, ANA, () => applyPlanLibraryCommand({ store: h.store, resolveRepository: () => repoOf(h) }, command)) as Answer;
    if (answer.error !== undefined) throw new Error(`${answer.error.code}: ${answer.error.message}`);
    return { entryId: answer.result!.entryId!, sha256: answer.result!.sha256! };
  };
  const schedule = (start: { entryId: string; sha256: string; tokenLimit: number | null; integration: IntegrationScheme | null }): void => {
    const command = {
      schema: "orca-raw-command-v1", commandId: "create-sch-g", actorId: "human", expectedRevision: 0, verb: "schedule-set",
      target: { kind: "schedule", scheduleId: "sch-g" },
      payload: { projectId: REPO, name: "fired", cron: "0 9 * * *", enabled: true, start: { kind: "group", ...start } },
    } as ScheduleCommand;
    const answer = withCommandContext(command.commandId, ANA, () => applyScheduleCommand({
      store: h.store, knownRepository: (repoId: string) => repoId === REPO, now: () => new Date(clock.at),
    }, command)) as { error?: { code: string; message: string } };
    if (answer.error !== undefined) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  };
  /** One pump in the panel's order; the flow pass is skipped because a group fire starts no flow run. */
  const pump = async (when: number): Promise<{ crashes: string[]; confirmed: string[]; started: string[] }> => {
    clock.at = when;
    const pass = await service.schedulesPass({ startGroup: groupScheduleStarter((command, origin) => service.importPlan(command, origin)) });
    const confirmed = await service.autoConfirmUnlimitedPass();
    const started = await service.autoStart();
    return { crashes: pass.crashes, confirmed: confirmed.confirmed, started: started.started };
  };
  const confirmFired = async (groupId: string): Promise<void> => {
    const base = await h.confirmPayload();
    const command = {
      schema: "orca-raw-command-v1", commandId: `confirm-${groupId}`, actorId: "human",
      expectedRevision: Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision),
      verb: "confirm", target: { kind: "group", groupId },
      payload: {
        ...base, planHash: readArchivedPlan(h.store, groupId).planHash, proposalVersion: readBudgetProposal(h.store, groupId).proposalVersion,
        selectionsHash: (await resolveGroupSelections({ store: h.store, port: h.deps.port }, groupId, "human")).selectionsHash ?? "0".repeat(64),
      },
    } as ConfirmCommand;
    const answer = await withCommandContext(command.commandId, ANA, () => service.confirm(command)) as { error?: { code: string } };
    if (answer.error !== undefined) throw new Error(answer.error.code);
  };
  return { h, clock, service, save, schedule, pump, confirmFired, configureDefaults: () => { defaults = h.deps.defaults(); } };
}

const fired = (): string => firedGroupId("sch-g", at(1, 9));
const skippedNext = (h: Fixture): Record<string, unknown> => {
  const row = fireAt(h, at(2, 9));
  expect(row.outcome).toBe("skipped");
  expect(row.reason).toBe(`previous-active:${fired()}`);
  return row;
};

describe("C7a: a fired group meets R2's pass in the real pump order", () => {
  it("confirms an unlimited group as orca-auto, starts it in the same pump, and copies the confirm next pass", async () => {
    const w = await world();
    const { entryId, sha256 } = w.save();
    w.schedule({ entryId, sha256, tokenLimit: null, integration: null });
    // Pump 1: import, R2's confirm, autoStart. Step 9 ran before R2, so the fire reads started without a confirm yet.
    const first = await w.pump(at(1, 9));
    expect(first.crashes).toEqual([]);
    expect(first.confirmed).toContain(fired());
    expect(first.started).toContain(fired());
    expect(fireAt(w.h, at(1, 9)).outcome).toBe("started");
    expect(fireBody(fireAt(w.h, at(1, 9))).confirm).toBeUndefined();
    const booked = commandsOf(w.h, fired(), "orca-auto-confirm-unlimited-v%");
    expect(booked.map((row) => row.id)).toEqual([autoConfirmCommandId(1)]);
    expect(booked[0]).toMatchObject({ actor_id: "orca-auto", verb: "confirm" });
    // Pump 2 (the next slot, the group not done): the fire copies R2's booked success and the slot is skipped.
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(second.confirmed).not.toContain(fired());
    expect(fireBody(fireAt(w.h, at(1, 9))).confirm).toEqual({
      state: "auto-confirmed", commandId: autoConfirmCommandId(1), code: null, at: at(2, 9),
    });
    skippedNext(w.h);
  });

  it("never confirms a limited group in either pass; the owner's one click confirms it and the fire stays waiting limited", async () => {
    const w = await world();
    const { entryId, sha256 } = w.save();
    // A fresh import commits 1,000,000 tokens, so a smaller limit would be refused group-budget-unavailable.
    w.schedule({ entryId, sha256, tokenLimit: 5_000_000, integration: null });
    const first = await w.pump(at(1, 9));
    expect(first.crashes).toEqual([]);
    expect(first.confirmed).not.toContain(fired());
    expect(first.started).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "limited" });
    expect(commandsOf(w.h, fired(), "orca-auto-confirm-unlimited-v%")).toEqual([]);
    await w.confirmFired(fired());
    expect(readBudgetProposal(w.h.store, fired()).state).toBe("confirmed");
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(second.started).toContain(fired());
    // §22.2: only a condition-8 waiting is re-evaluated; this one is write-once.
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "limited" });
    skippedNext(w.h);
  });

  it.each([
    ["local", LOCAL, "local"],
    ["push", PUSH, "push-branch"],
  ])("never confirms a group with a %s delivery scheme and records delivery-needs-person", async (_name, integration, delivery) => {
    const w = await world();
    const { entryId, sha256 } = w.save();
    w.schedule({ entryId, sha256, tokenLimit: null, integration });
    const first = await w.pump(at(1, 9));
    expect(first.crashes).toEqual([]);
    expect(first.confirmed).not.toContain(fired());
    expect(first.started).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: `delivery-needs-person:${delivery}` });
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(second.confirmed).not.toContain(fired());
    expect(commandsOf(w.h, fired(), "orca-auto-confirm-unlimited-v%")).toEqual([]);
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: `delivery-needs-person:${delivery}` });
    skippedNext(w.h);
  });

  it("records R2's refusal as auto-confirm-refused with the booked code", async () => {
    // Model-assisted handoffs need every handoff dimension >= 1; the default grant has 0, so R2's confirm is refused.
    const snapshot = profileSnapshot();
    snapshot.profile.capabilities.handoffExecution = "model-assisted-v1";
    const w = await world({ snapshot });
    const { entryId, sha256 } = w.save();
    w.schedule({ entryId, sha256, tokenLimit: null, integration: null });
    // Pump 1: step 9 sees no booked row yet; R2 books the refusal.
    const first = await w.pump(at(1, 9));
    expect(first.crashes).toEqual([]);
    expect(first.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9)).outcome).toBe("started");
    // Pump 2: step 9 reads the booked error row -- a started fire stops at auto-confirm-refused.
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(second.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "auto-confirm-refused:handoff-grant-insufficient" });
    expect(fireBody(fireAt(w.h, at(1, 9))).confirm).toEqual({
      state: "auto-confirm-refused", commandId: autoConfirmCommandId(1), code: "handoff-grant-insufficient", at: at(2, 9),
    });
    skippedNext(w.h);
  });

  it("waits auto-confirm-ineligible:8 while defaults are missing, and starts the fire once they are configured", async () => {
    const w = await world({ defaults: "null" });
    const { entryId, sha256 } = w.save();
    w.schedule({ entryId, sha256, tokenLimit: null, integration: null });
    const first = await w.pump(at(1, 9));
    expect(first.crashes).toEqual([]);
    expect(first.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "auto-confirm-ineligible:8" });
    expect(commandsOf(w.h, fired(), "orca-auto-confirm-unlimited-v%")).toEqual([]);
    // Defaults configured: R2's pass confirms in the next pump; step 9 copies it in the pass after that.
    w.configureDefaults();
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(second.confirmed).toContain(fired());
    expect(second.started).toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "auto-confirm-ineligible:8" });
    skippedNext(w.h);
    const third = await w.pump(at(3, 9));
    expect(third.crashes).toEqual([]);
    expect(third.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9)).outcome).toBe("started");
    expect(fireBody(fireAt(w.h, at(1, 9))).confirm).toEqual({
      state: "auto-confirmed", commandId: autoConfirmCommandId(1), code: null, at: at(3, 9),
    });
  });

  it("reads R2's attempt for the current proposal version, never an older version's refusal", async () => {
    // Model-assisted handoffs make R2's confirm fail; the refusal is booked under the version it tried.
    const snapshot = profileSnapshot();
    snapshot.profile.capabilities.handoffExecution = "model-assisted-v1";
    const w = await world({ snapshot });
    const { entryId, sha256 } = w.save();
    w.schedule({ entryId, sha256, tokenLimit: null, integration: null });
    // Pump 1: R2 books its refusal for proposal v1 after step 9 has looked.
    await w.pump(at(1, 9));
    expect(fireAt(w.h, at(1, 9)).outcome).toBe("started");
    const firedGroup = fired();
    const edited = w.service.editProposal({
      schema: "orca-raw-command-v1", commandId: "edit-fired-proposal", actorId: "human",
      expectedRevision: Number(w.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(firedGroup)!.revision),
      verb: "proposal-edit", target: { kind: "group", groupId: firedGroup },
      payload: { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: 900_000, provenance: "human" }] },
    } as Parameters<typeof w.service.editProposal>[0]) as { error?: unknown; result?: { proposalVersion?: number } };
    expect(edited.error).toBeUndefined();
    expect(edited.result?.proposalVersion).toBe(2);
    // Pump 2: v1's refusal cannot speak for v2, so step 9 leaves the fire started; R2 books v2's own refusal.
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(fireAt(w.h, at(1, 9)).outcome).toBe("started");
    // Pump 3: the copied refusal names the attempt R2 actually made for the standing proposal.
    await w.pump(at(3, 9));
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "auto-confirm-refused:handoff-grant-insufficient" });
    expect(fireBody(fireAt(w.h, at(1, 9))).confirm).toEqual({
      state: "auto-confirm-refused", commandId: autoConfirmCommandId(2), code: "handoff-grant-insufficient", at: at(3, 9),
    });
    skippedNext(w.h);
  });

  it("records a booked selections-unresolved as auto-confirm-ineligible:10, and it stays after defaults change", async () => {
    // The pinned plan names the estimator's agent, but task a names an installation orca-auto cannot resolve.
    const w = await world({ tasks: [{ taskId: "a", agent: { agent: "not-installed" } as PartialSelection }] });
    const { entryId, sha256 } = w.save();
    w.schedule({ entryId, sha256, tokenLimit: null, integration: null });
    const first = await w.pump(at(1, 9));
    expect(first.crashes).toEqual([]);
    expect(first.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9)).outcome).toBe("started");
    expect(commandsOf(w.h, fired(), "orca-auto-confirm-unlimited-v%")).toHaveLength(1);
    const second = await w.pump(at(2, 9));
    expect(second.crashes).toEqual([]);
    expect(second.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "auto-confirm-ineligible:10" });
    skippedNext(w.h);
    // A later defaults change books nothing new (condition 9) and cannot move this waiting fire (§22.2).
    w.configureDefaults();
    const third = await w.pump(at(3, 9));
    expect(third.crashes).toEqual([]);
    expect(third.confirmed).not.toContain(fired());
    expect(fireAt(w.h, at(1, 9))).toMatchObject({ outcome: "waiting", reason: "auto-confirm-ineligible:10" });
    expect(commandsOf(w.h, fired(), "orca-auto-confirm-unlimited-v%")).toHaveLength(1);
  });
});
