import { describe, expect, it } from "vitest";
import { autoConfirmBlocker, autoConfirmCommandId } from "../../src/control/autoConfirm.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readGroupOrchestration } from "../../src/control/orchestration.js";
import { readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import type { ImportDefaults } from "../../src/control/planImport.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { FIXTURE_AGENT_ID } from "./fixtures/agents.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";
import { profileSnapshot, webFixture, type WebFixtureOptions } from "./fixtures/web.js";

/**
 * Tester round 2 spec §7.2, §7.3 (ruling H4): an unlimited-token group a person created is confirmed -- and so started --
 * by `orca-auto` once nothing blocks it, one attempt per proposal version, through the unchanged confirm path. The pass's
 * only predicate is `autoConfirmBlocker` (C22b); condition 10 (agent slots resolve as orca-auto) is booked when it fails.
 * Security boundary (§2.2): never `integrationHash`, never a flow child, never a held effect.
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const PERSON = { client: "web", principal: "user:owner", personAuthority: true };
const PLAN_AGENT = { planAgents: { agent: { agent: FIXTURE_AGENT_ID } } };
/** An unlimited-token group "g" a person imported, whose plan names the group agent (so orca-auto resolves every slot). */
const unlimited = (extra: WebFixtureOptions = {}) => webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1", importContext: PERSON, ...PLAN_AGENT, ...extra });
const body = (h: Fixture, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const patch = (h: Fixture, fields: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(h), ...fields }));
const attemptRow = (h: Fixture) => h.store.db.prepare("SELECT actor_id, result, effective_payload_json FROM commands WHERE group_id='g' AND id=?").get(autoConfirmCommandId(readBudgetProposal(h.store, "g").proposalVersion));
const defaultsOf = (h: Fixture): ImportDefaults => h.deps.defaults()!;
const count = (h: Fixture, table: string) => Number(h.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

/** C22b's single source: the predicate says "attempt" iff the pass attempted (confirmed or booked condition 10). */
async function passWithPredicate(h: Fixture, service: WebControlService, defaults: ImportDefaults | null = defaultsOf(h)) {
  const blocker = autoConfirmBlocker(h.store, body(h), defaults);
  const before = attemptRow(h);
  const result = await service.autoConfirmUnlimitedPass(() => defaults);
  const attempted = before === undefined && result.confirmed.concat(result.refused.map(r => r.groupId)).includes("g");
  expect([blocker === null, attempted]).toEqual([blocker === null, blocker === null]);
  return { blocker, result };
}

describe("H4: the automatic confirm of unlimited-token groups", () => {
  it("C19: confirms as orca-auto with start authorized, and the same pump pass starts it", async () => {
    const h = await unlimited(); try {
      const service = new WebControlService(h.deps);
      expect(body(h).createdByPerson).toBe(true);
      const { blocker, result } = await passWithPredicate(h, service);
      expect(blocker).toBeNull();
      expect(result).toEqual({ confirmed: ["g"], refused: [] });
      expect(readBudgetProposal(h.store, "g").state).toBe("confirmed");
      const row = h.store.db.prepare("SELECT actor_id, result FROM commands WHERE group_id='g' AND id=?").get(autoConfirmCommandId(1))!;
      expect(row.actor_id).toBe("orca-auto");
      expect(JSON.parse(String(row.result))).toMatchObject({ result: { kind: "confirmed" } });
      expect(readGroupOrchestration(h.store, "g")).toMatchObject({ mode: "run" });
      expect((await service.autoStart()).started).toEqual(["g"]);
    } finally { await h.dispose(); }
  });

  it("C20: a limited group is never confirmed automatically", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }], { importContext: PERSON, ...PLAN_AGENT }); try {
      const service = new WebControlService(h.deps);
      const { blocker, result } = await passWithPredicate(h, service);
      expect(blocker).toEqual({ condition: 2, code: "limited" });
      expect(result).toEqual({ confirmed: [], refused: [] });
      expect(attemptRow(h)).toBeUndefined();
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
    } finally { await h.dispose(); }
  });

  it("C21: a group with a delivery scheme is never confirmed automatically and nothing is booked", async () => {
    const h = await unlimited({ integration: { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" } }); try {
      const service = new WebControlService(h.deps);
      const { blocker } = await passWithPredicate(h, service);
      expect(blocker).toEqual({ condition: 6, code: "delivery-scheme" });
      expect(attemptRow(h)).toBeUndefined();
      expect(h.store.db.prepare("SELECT count(*) AS n FROM commands WHERE group_id='g' AND effective_payload_json LIKE '%integrationHash%'").get()!.n).toBe(0);
      expect(readControlGroup(h.store, "epoch", "g").autoConfirm).toEqual({ eligible: false, refusedCode: null });
    } finally { await h.dispose(); }
  });

  it.each([
    ["a flow child", { flow: { role: "child" } }, { condition: 4, code: "flow-child" }],
    ["a system-debug group", { systemDebug: { source: { kind: "ladder", groupId: "x", taskId: "a", runId: "run-1" }, stackOn: "x", inputHash: "a".repeat(64), settled: null } }, { condition: 4, code: "system-debug" }],
    ["a correction-debug group", { debug: { correctionId: "c1" } }, { condition: 4, code: "correction-debug" }],
  ])("C22: %s is skipped, and the pass writes no effect record or flow message", async (_name, fields, expected) => {
    const h = await unlimited(); try {
      patch(h, fields);
      const service = new WebControlService(h.deps);
      const effects = count(h, "effect_records"), messages = count(h, "flow_messages");
      const { blocker, result } = await passWithPredicate(h, service);
      expect(blocker).toEqual(expected);
      expect(result).toEqual({ confirmed: [], refused: [] });
      expect(attemptRow(h)).toBeUndefined();
      expect([count(h, "effect_records"), count(h, "flow_messages")]).toEqual([effects, messages]);
    } finally { await h.dispose(); }
  });

  it.each([
    ["an agent's socket import", { client: "cli", principal: "agent:cli" }, false],
    ["a dispatched run's import (no person authority)", { client: "cli", principal: "agent:cli", personAuthority: false }, false],
    ["a Web user's import", { client: "web", principal: "user:member" }, true],
    ["a legacy web principal", { client: "web", principal: "web" }, true],
    ["C22d: a socket import with an owner's person token", { client: "cli", principal: "agent:cli", personAuthority: true }, true],
  ])("C22a: condition 11 -- %s", async (_name, importContext, confirmed) => {
    const h = await unlimited({ importContext }); try {
      const service = new WebControlService(h.deps);
      const { blocker, result } = await passWithPredicate(h, service);
      expect(blocker).toEqual(confirmed ? null : { condition: 11, code: "not-person-created" });
      expect(result.confirmed).toEqual(confirmed ? ["g"] : []);
      if (!confirmed) expect(attemptRow(h)).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("C22a: a group a person's schedule fired (origin.kind = schedule), imported by orca-auto, is confirmed", async () => {
    const h = await unlimited({ importContext: { client: "panel", principal: "orca-auto" } }); try {
      expect(body(h).createdByPerson).toBe(false);
      patch(h, { origin: { kind: "schedule" } });
      const { result } = await passWithPredicate(h, new WebControlService(h.deps));
      expect(result.confirmed).toEqual(["g"]);
    } finally { await h.dispose(); }
  });

  it("C22a: an unstamped (older) group falls back to its creating command's principal", async () => {
    for (const [principal, confirmed] of [["user:owner", true], ["agent:cli", false]] as const) {
      const h = await unlimited({ importContext: { client: "web", principal } }); try {
        const { createdByPerson: _drop, ...rest } = body(h);
        h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(rest));
        const { result } = await passWithPredicate(h, new WebControlService(h.deps));
        expect(result.confirmed).toEqual(confirmed ? ["g"] : []);
      } finally { await h.dispose(); }
    }
  });

  it("C22a: requirement-draft-accept stamps who accepted it", async () => {
    for (const [context, stamped] of [[PERSON, true], [{ client: "cli", principal: "agent:cli" }, false]] as const) {
      const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" }); try {
        await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
        const command = x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }) as { commandId: string };
        const answer = await withCommandContext(command.commandId, context, () => x.service.acceptRequirementDraft(command as never));
        expect(answer).not.toHaveProperty("error");
        expect(JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)).createdByPerson).toBe(stamped);
      } finally { await x.dispose(); }
    }
  });

  it("C22c: an unresolved slot is booked once, shown, and not re-resolved; the predicate then names condition 9", async () => {
    // No plan agent: orca-auto has no operator default, so the slots do not resolve.
    const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1", importContext: PERSON }); try {
      const service = new WebControlService(h.deps);
      const { blocker, result } = await passWithPredicate(h, service);
      expect(blocker).toBeNull();
      expect(result).toEqual({ confirmed: [], refused: [{ groupId: "g", code: "auto-confirm-selections-unresolved" }] });
      expect(JSON.parse(String(attemptRow(h)!.result))).toMatchObject({ error: { code: "auto-confirm-selections-unresolved" } });
      expect(readControlGroup(h.store, "epoch", "g").autoConfirm).toEqual({ eligible: true, refusedCode: "auto-confirm-selections-unresolved" });
      expect(autoConfirmBlocker(h.store, body(h), defaultsOf(h))).toEqual({ condition: 9, code: "already-attempted", booked: "auto-confirm-selections-unresolved" });
      const asked = h.asked.length;
      expect(await service.autoConfirmUnlimitedPass(() => defaultsOf(h))).toEqual({ confirmed: [], refused: [] });
      expect(h.asked.length).toBe(asked);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM commands WHERE group_id='g' AND id LIKE 'orca-auto-confirm-unlimited-%'").get()!.n).toBe(1);
    } finally { await h.dispose(); }
  });

  it("C22c: missing defaults (condition 8) book nothing, and the first pass after they are set confirms", async () => {
    const h = await unlimited(); try {
      const service = new WebControlService(h.deps);
      const { blocker, result } = await passWithPredicate(h, service, null);
      expect(blocker).toEqual({ condition: 8, code: "defaults-missing" });
      expect(result).toEqual({ confirmed: [], refused: [] });
      expect(attemptRow(h)).toBeUndefined();
      expect((await passWithPredicate(h, service)).result.confirmed).toEqual(["g"]);
    } finally { await h.dispose(); }
  });

  it("C23: a running estimate holds the confirm; a queued one is withdrawn by it with no run", async () => {
    const running = await unlimited(); try {
      const service = new WebControlService(running.deps);
      expect(await service.claimEstimate("g", running.estimateId)).not.toBeNull();
      const { blocker, result } = await passWithPredicate(running, service);
      expect(blocker).toEqual({ condition: 7, code: "estimate-running" });
      expect(result.confirmed).toEqual([]);
    } finally { await running.dispose(); }
    const queued = await unlimited(); try {
      const service = new WebControlService(queued.deps);
      expect(readEstimateRecord(queued.store, "g", queued.estimateId).state).toBe("queued");
      expect((await passWithPredicate(queued, service)).result.confirmed).toEqual(["g"]);
      expect(await service.claimEstimate("g", queued.estimateId)).toBeNull();
      expect(readEstimateRecord(queued.store, "g", queued.estimateId)).toMatchObject({ state: "withdrawn", reasonCode: "estimate-withdrawn:proposal-confirmed" });
      expect(count(queued, "runs")).toBe(0);
    } finally { await queued.dispose(); }
  });

  it("C24: a refused confirm is booked once per proposal version; an edit allows one new attempt", async () => {
    // A profile whose handoffs are model-assisted needs every handoff dimension >= 1; the default handoff grant has 0
    // attempts, so confirm refuses it by name (handoff-grant-insufficient, a durable 422).
    const snapshot = profileSnapshot(); snapshot.profile.capabilities.handoffExecution = "model-assisted-v1";
    const h = await webFixture(snapshot, [{ taskId: "a" }], { tokenPolicy: "optional-v1", importContext: PERSON, ...PLAN_AGENT }); try {
      const service = new WebControlService(h.deps);
      expect((await passWithPredicate(h, service)).result.refused).toEqual([{ groupId: "g", code: "handoff-grant-insufficient" }]);
      const asked = h.asked.length;
      expect(await service.autoConfirmUnlimitedPass(() => defaultsOf(h))).toEqual({ confirmed: [], refused: [] });
      expect(h.asked.length).toBe(asked);
      expect(readControlGroup(h.store, "epoch", "g").autoConfirm!.refusedCode).toBe("handoff-grant-insufficient");
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: 900_000, provenance: "human" }] }))).not.toHaveProperty("error");
      expect(readControlGroup(h.store, "epoch", "g").autoConfirm!.refusedCode).toBeNull();
      expect((await service.autoConfirmUnlimitedPass(() => defaultsOf(h))).refused).toEqual([{ groupId: "g", code: "handoff-grant-insufficient" }]);
      expect(h.store.db.prepare("SELECT id FROM commands WHERE group_id='g' AND id LIKE 'orca-auto-confirm-unlimited-%' ORDER BY rowid").all().map(r => r.id)).toEqual([autoConfirmCommandId(1), autoConfirmCommandId(2)]);
    } finally { await h.dispose(); }
  });

  it("C25: agents that resolve only through the person's own default agent are not used (D6); the failure is booked (N5)", async () => {
    // webFixture seeds the importing person's default agent; the plan names none.
    const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1", importContext: PERSON }); try {
      const service = new WebControlService(h.deps);
      const { result } = await passWithPredicate(h, service);
      expect(result).toEqual({ confirmed: [], refused: [{ groupId: "g", code: "auto-confirm-selections-unresolved" }] });
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
    } finally { await h.dispose(); }
  });

  it.each([
    ["archived", { archived: { at: 1, actor: "human" } }, { condition: 3, code: "archived" }],
    ["stopped", { stopped: true }, { condition: 3, code: "stopped" }],
  ])("C26: an %s group is skipped", async (_name, fields, expected) => {
    const h = await unlimited(); try {
      patch(h, fields);
      const { blocker, result } = await passWithPredicate(h, new WebControlService(h.deps));
      expect(blocker).toEqual(expected);
      expect(result).toEqual({ confirmed: [], refused: [] });
      expect(attemptRow(h)).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("C26: a group with a stop intent is skipped", async () => {
    const h = await unlimited(); try {
      const service = new WebControlService(h.deps);
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      patch(h, { stopped: false });
      const { blocker, result } = await passWithPredicate(h, service);
      expect(blocker).toEqual({ condition: 3, code: "stop-intent" });
      expect(result).toEqual({ confirmed: [], refused: [] });
    } finally { await h.dispose(); }
  });

  it("§7.3: an eligible group's view says so; an absent attempt has no refused code", async () => {
    const h = await unlimited(); try {
      expect(readControlGroup(h.store, "epoch", "g").autoConfirm).toEqual({ eligible: true, refusedCode: null });
    } finally { await h.dispose(); }
  });
});
