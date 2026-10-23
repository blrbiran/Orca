import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { resolveGroupSelections, taskSlotKey } from "../../src/control/agentFreeze.js";
import { readDraft, writeDraft } from "../../src/control/requirementRecords.js";
import { FIXTURE_AGENT_ID, FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Tester round 2 spec §6.2.1 (ruling H3): the agent the person picked on New requirement (stored as the estimator
 * override) becomes the group's worker default at accept -- only when no worker override exists and the accepted plan
 * names no group agent. The operator's own default ("codex" here) is what the tasks would otherwise resolve to, so a
 * resolution to the pick with provenance `group` can only come from the seed.
 */
type Harness = Awaited<ReturnType<typeof requirementHarness>>;
async function reviewed(overrides: Record<string, unknown>, planAgent?: Record<string, unknown>): Promise<Harness> {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  const body = JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body));
  body.agentOverrides = overrides;
  x.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(body));
  if (planAgent !== undefined) {
    const draft = readDraft(x.store, "r", 1);
    const plan = { ...(draft.plan as Record<string, unknown>), agent: planAgent };
    writeDraft(x.store, "r", { ...draft, plan, draftHash: sha256Canonical(plan) });
  }
  return x;
}
const accept = async (x: Harness) => {
  const answer = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
  if ("error" in (answer as object)) throw new Error(JSON.stringify(answer));
};
const overridesOf = (x: Harness) => JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)).agentOverrides;
async function taskAgents(x: Harness): Promise<Array<{ agent: string; provenance: string }>> {
  const resolution = await resolveGroupSelections({ store: x.store, port: x.fake.port }, "r", "orca-auto");
  return ["exporter", "images"].map(taskId => {
    const slot = resolution.slots.find(entry => entry.key === taskSlotKey(taskId))!;
    if (slot.outcome.kind !== "resolved") throw new Error(JSON.stringify(slot.outcome));
    return { agent: slot.outcome.frozen.selection.agent, provenance: slot.outcome.frozen.provenance.agent };
  });
}

describe("H3: the requirement's agent is the group's worker default", () => {
  it("C16: accept seeds agentOverrides.worker from the opener's pick; the tasks resolve to it from the group layer", async () => {
    const x = await reviewed({ estimator: { agent: FIXTURE_OTHER_AGENT_ID } }); try {
      await accept(x);
      expect(overridesOf(x)).toEqual({ estimator: { agent: FIXTURE_OTHER_AGENT_ID }, worker: { agent: FIXTURE_OTHER_AGENT_ID } });
      expect(await taskAgents(x)).toEqual([{ agent: FIXTURE_OTHER_AGENT_ID, provenance: "group" }, { agent: FIXTURE_OTHER_AGENT_ID, provenance: "group" }]);
    } finally { await x.dispose(); }
  });

  it("C17: an existing worker override is kept", async () => {
    const x = await reviewed({ estimator: { agent: FIXTURE_OTHER_AGENT_ID }, worker: { agent: FIXTURE_AGENT_ID, model: "kept-model" } }); try {
      await accept(x);
      expect(overridesOf(x)).toEqual({ estimator: { agent: FIXTURE_OTHER_AGENT_ID }, worker: { agent: FIXTURE_AGENT_ID, model: "kept-model" } });
    } finally { await x.dispose(); }
  });

  it("C17: no pick leaves no worker key", async () => {
    const x = await reviewed({}); try {
      await accept(x);
      expect(overridesOf(x)).toEqual({});
    } finally { await x.dispose(); }
  });

  it("C17: a split plan with a group agent keeps it -- no worker key, the tasks resolve to the plan's agent", async () => {
    const x = await reviewed({ estimator: { agent: FIXTURE_OTHER_AGENT_ID } }, { agent: FIXTURE_AGENT_ID }); try {
      await accept(x);
      expect(overridesOf(x)).toEqual({ estimator: { agent: FIXTURE_OTHER_AGENT_ID } });
      expect(await taskAgents(x)).toEqual([{ agent: FIXTURE_AGENT_ID, provenance: "group-plan" }, { agent: FIXTURE_AGENT_ID, provenance: "group-plan" }]);
    } finally { await x.dispose(); }
  });
});
