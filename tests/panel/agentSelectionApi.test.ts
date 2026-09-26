/**
 * Agent selection spec §6.8 (plan T14): the three reads and two commands the panel's agent UI stands on, over a
 * real Panel. The preview is the confirm's own resolution (W6-1), so the pair that matters most is "a confirm
 * carrying the preview's selectionsHash is accepted" / "one the preferences have moved under is refused" -- a
 * preview computed a second way would fail one of the two.
 */
import { afterAll, describe, expect, it } from "vitest";
import { selectionsHash } from "../../src/control/agentSelection.js";
import { readConfirmedReconcileSlot } from "../../src/control/executionSnapshot.js";
import {
  agentPreferencesViewSchema,
  agentSelectionPreviewSchema,
  agentsViewSchema,
  commandSuccessSchema,
  controlConfigSchema,
} from "../../src/control/webProtocol.js";
import {
  CLAUDE_CODEX_AGENTS,
  GROUP,
  claudeCodexResolveAgent,
  command,
  createHarness,
  get,
  json,
  revision,
  view,
  type Panel,
} from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

const PREFS = "/api/control/operator/agent-preferences";
/** Every criterion here asks the claude/codex double, from a panel whose operator has no preferences yet (P8). */
const boot = async (epoch: string, options: { agents?: typeof CLAUDE_CODEX_AGENTS } = {}) =>
  h.boot(epoch, await h.workspace(), { resolveAgent: claudeCodexResolveAgent, agents: options.agents ?? CLAUDE_CODEX_AGENTS, seedPreferences: false });

async function preview(panel: Panel) {
  const response = await get(panel, `/api/control/groups/${GROUP}/agent-preview`);
  const body = await json(response);
  if (!response.ok) throw new Error(`preview refused (${response.status}): ${JSON.stringify(body)}`);
  return agentSelectionPreviewSchema.parse(body);
}

/** P5/W6-8: the revision travels in the envelope only; the payload is `{ preferences }`. */
async function setPreferences(panel: Panel, commandId: string, preferences: Record<string, unknown>) {
  const current = agentPreferencesViewSchema.parse(await json(await get(panel, PREFS)));
  return command(panel, PREFS, { commandId, expectedRevision: current.revision, payload: { preferences } });
}

async function importPlan(panel: Panel): Promise<void> {
  const imported = await command(panel, "/api/control/groups/import-plan", {
    commandId: "agents-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" },
  });
  expect(imported.status).toBe(201);
}

async function confirm(panel: Panel, commandId: string, hash: string) {
  const config = controlConfigSchema.parse(await json(await get(panel, "/api/control/config")));
  const current = await view(panel);
  const profileHash = config.profiles[0]!.profileHash;
  return command(panel, `/api/control/groups/${GROUP}/confirm`, {
    commandId, expectedRevision: current.summary.commandRevision,
    payload: {
      planHash: current.plan.planHash, proposalVersion: current.proposal.proposalVersion, budgetMode: "soft",
      profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
      profileHashes: { estimator: profileHash, worker: profileHash, handoff: profileHash, goalReview: profileHash },
      contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: hash,
    },
  });
}

type Preview = Awaited<ReturnType<typeof preview>>;
const frozenOf = (answer: Preview, key: string) => {
  const slot = answer.slots.find((entry) => entry.key === key)!;
  if (slot.outcome.kind !== "resolved") throw new Error(`${key} rejected: ${slot.outcome.code}`);
  return slot.outcome.frozen;
};
const resolvedFrozen = (answer: Preview) => Object.fromEntries(answer.slots.map((slot) => [slot.key, frozenOf(answer, slot.key)]));

describe("agent selection over a real panel (agent selection spec §6.8)", () => {
  it("serves the installation table view from the port, sorted by id, and only with the panel token", async () => {
    const panel = await boot("epoch-agents-view", { agents: { installations: [...CLAUDE_CODEX_AGENTS.installations].reverse() } });
    const answer = agentsViewSchema.parse(await json(await get(panel, "/api/control/agents")));
    expect(answer).toEqual({ schema: "orca-agents-view-v1", installations: CLAUDE_CODEX_AGENTS.installations });
    expect((await get(panel, "/api/control/agents", "")).status).toBe(401);
    await panel.close();
  });

  it("reads the operator's preferences at revision 0, sets them under that revision, reads them back, and refuses a stale revision by name", async () => {
    const panel = await boot("epoch-agents-prefs");
    const initial = agentPreferencesViewSchema.parse(await json(await get(panel, PREFS)));
    expect(initial).toMatchObject({ schema: "orca-agent-preferences-v1", revision: 0, preferences: { perAgent: {} } });
    expect(initial.operatorId).toMatch(/^operator-[0-9a-f-]{36}$/);
    const preferences = { defaultAgent: "claude", perAgent: { claude: { contextWindow: 1_000_000 } }, reconcile: { agent: "codex" } };
    const set = await command(panel, PREFS, { commandId: "prefs-1", expectedRevision: 0, payload: { preferences } });
    expect(set.status).toBe(200);
    expect(commandSuccessSchema.parse(set.body)).toMatchObject({
      verb: "set-agent-preferences", actorId: initial.operatorId, target: { kind: "operator", operatorId: initial.operatorId },
      projectionSeq: null, result: { kind: "agent-preferences-set", operatorId: initial.operatorId, revision: 1 },
    });
    expect(agentPreferencesViewSchema.parse(await json(await get(panel, PREFS)))).toEqual({ ...initial, revision: 1, preferences });
    const stale = await command(panel, PREFS, { commandId: "prefs-2", expectedRevision: 0, payload: { preferences: { perAgent: {} } } });
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe("revision-conflict");
    await panel.close();
  });

  it("previews every task's worker slot and the reconcile slot with the layer each field came from, and a confirm carrying that selectionsHash is accepted", async () => {
    const panel = await boot("epoch-agents-preview");
    expect((await setPreferences(panel, "prefs-a", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const answer = await preview(panel);
    const claude = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };
    expect(answer.slots.map((slot) => [slot.key, slot.slot, slot.taskId])).toEqual([["reconcile", "reconcile", null], ["task:a", "worker", "a"]]);
    for (const slot of answer.slots) {
      expect(slot.outcome).toMatchObject({
        kind: "resolved",
        frozen: { selection: claude, partial: { agent: "claude" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" } },
      });
    }
    expect(answer.proposalVersion).toBe((await view(panel)).proposal.proposalVersion);
    expect(answer.selectionsHash).toBe(selectionsHash(resolvedFrozen(answer)));
    const confirmed = await confirm(panel, "agents-confirm", answer.selectionsHash!);
    expect(confirmed.status).toBe(200);
    expect(commandSuccessSchema.parse(confirmed.body).result).toMatchObject({ kind: "confirmed" });
    await panel.close();
  });

  // T11 review carry-over (spec §12 I13): the expected frozen values are the ones the panel showed BEFORE the confirm,
  // not a resolution computed afterwards from the state the confirm itself wrote.
  it("freezes onto the work item and the reconcile slot exactly what the preview fetched before the confirm showed", async () => {
    const panel = await boot("epoch-agents-frozen");
    expect((await setPreferences(panel, "prefs-f", { defaultAgent: "claude", perAgent: { claude: { contextWindow: 1_000_000 } }, reconcile: { agent: "codex" } })).status).toBe(200);
    await importPlan(panel);
    const seen = await preview(panel);
    const task = frozenOf(seen, "task:a"), reconcile = frozenOf(seen, "reconcile");
    // The two slots differ, so a confirm that froze one slot's answer into the other is told apart.
    expect(task.selection).toEqual({ agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 });
    expect(reconcile.selection.agent).toBe("codex");
    expect((await view(panel)).workItems[0]).toMatchObject({ agent: null, agentProvenance: null, configHash: null });
    expect((await confirm(panel, "agents-confirm-frozen", seen.selectionsHash!)).status).toBe(200);
    const item = (await view(panel)).workItems.find((row) => row.taskId === "a")!;
    expect({ agent: item.agent, agentProvenance: item.agentProvenance, configHash: item.configHash })
      .toEqual({ agent: task.selection, agentProvenance: task.provenance, configHash: task.configHash });
    expect(readConfirmedReconcileSlot(panel.store, GROUP)).toEqual(reconcile);
    await panel.close();
  });

  it("names a slot it cannot resolve by its code and answers no selectionsHash -- before any default agent, and for a context the agent cannot express", async () => {
    const panel = await boot("epoch-agents-rejected");
    await importPlan(panel);
    const unselected = await preview(panel);
    expect(unselected.slots.map((slot) => slot.outcome)).toEqual([
      { kind: "rejected", code: "agent-unselected" }, { kind: "rejected", code: "agent-unselected" },
    ]);
    expect(unselected.selectionsHash).toBeNull();
    expect((await setPreferences(panel, "prefs-r", { defaultAgent: "codex", perAgent: { codex: { contextWindow: 1_000_000 } } })).status).toBe(200);
    const unsupported = await preview(panel);
    expect(unsupported.slots.map((slot) => slot.outcome)).toEqual([
      { kind: "rejected", code: "agent-context-unsupported" }, { kind: "rejected", code: "agent-context-unsupported" },
    ]);
    expect(unsupported.selectionsHash).toBeNull();
    await panel.close();
  });

  it("a proposal-set-agent on one task moves proposalVersion, and that task alone now takes its agent from the task layer", async () => {
    const panel = await boot("epoch-agents-task");
    expect((await setPreferences(panel, "prefs-t", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const before = await view(panel);
    expect((await preview(panel)).taskOverrides).toEqual({ a: null });
    const set = await command(panel, `/api/control/groups/${GROUP}/proposal/agent`, {
      commandId: "agent-task-a", expectedRevision: await revision(panel),
      payload: { baseProposalVersion: before.proposal.proposalVersion, scope: { kind: "task", taskId: "a" }, partial: { agent: "codex" } },
    });
    expect(set.status).toBe(200);
    expect(commandSuccessSchema.parse(set.body)).toMatchObject({
      verb: "proposal-set-agent", result: { kind: "proposal-edited", proposalVersion: before.proposal.proposalVersion + 1 },
    });
    const after = await preview(panel);
    expect(after.proposalVersion).toBe(before.proposal.proposalVersion + 1);
    expect(after.taskOverrides).toEqual({ a: { agent: "codex" } });
    expect(after.slots.find((slot) => slot.key === "task:a")!.outcome).toMatchObject({
      kind: "resolved", frozen: { selection: { agent: "codex", model: "gpt-6-sol" }, provenance: { agent: "task", model: "descriptor" } },
    });
    expect(after.slots.find((slot) => slot.key === "reconcile")!.outcome).toMatchObject({
      kind: "resolved", frozen: { selection: { agent: "claude" }, provenance: { agent: "operator" } },
    });
    await panel.close();
  });

  it("refuses a confirm whose selectionsHash the operator's preferences have moved under since the preview, and accepts the new preview's", async () => {
    const panel = await boot("epoch-agents-changed");
    expect((await setPreferences(panel, "prefs-c1", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const seen = await preview(panel);
    // Preferences do not move proposalVersion (spec §6.4 step 3): only the hash can tell the confirm they moved.
    expect((await setPreferences(panel, "prefs-c2", { defaultAgent: "claude", perAgent: { claude: { model: "claude-fable-5" } } })).status).toBe(200);
    const fresh = await preview(panel);
    expect(fresh.proposalVersion).toBe(seen.proposalVersion);
    expect(fresh.selectionsHash).not.toBe(seen.selectionsHash);
    const stale = await confirm(panel, "agents-confirm-stale", seen.selectionsHash!);
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe("agent-selection-changed");
    const accepted = await confirm(panel, "agents-confirm-fresh", fresh.selectionsHash!);
    expect(accepted.status).toBe(200);
    await panel.close();
  });

  it("the preview schema refuses a selectionsHash beside a rejected slot, and a slot key that does not name its task", () => {
    const rejected = {
      schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 1, groupOverrides: {}, taskOverrides: { a: null },
      slots: [{ key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "rejected", code: "agent-unselected" } }], selectionsHash: null,
    };
    // The unmutated document passes, so each refusal below is the property's own.
    expect(agentSelectionPreviewSchema.safeParse(rejected).success).toBe(true);
    expect(agentSelectionPreviewSchema.safeParse({ ...rejected, selectionsHash: "a".repeat(64) }).success).toBe(false);
    expect(agentSelectionPreviewSchema.safeParse({ ...rejected, slots: [{ ...rejected.slots[0], key: "task:b" }] }).success).toBe(false);
  });
});
