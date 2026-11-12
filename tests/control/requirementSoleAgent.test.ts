import { describe, expect, it } from "vitest";
import type { AgentsView } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readGroupAgentOverrides } from "../../src/control/agentFreeze.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { seedPreferences } from "./fixtures/agents.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// #246 (human: 「#246 => 同意」): `requirement open` with no --agent and no defaultAgent refused agent-unselected even when
// only one agent is installed -- the one it could only have meant. It now picks that one, recorded as if named; with
// none or several installed, the refusal stands.
const open = (groupId: string) => ({
  schema: "orca-raw-command-v1", commandId: `open-${groupId}`, actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId },
  payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown.", contentLanguage: "en" },
}) as never;

const installation = (id: string): AgentsView["installations"][number] =>
  ({ id, kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.0.0-fixture" });

async function opened(installed: string[] | "unreadable") {
  const x = await requirementHarness({ answers: [], startAt: "none" });
  // No defaultAgent: no layer names an agent (the harness seeds one; this takes it away).
  seedPreferences(x.store, "human", { perAgent: {} }, 1);
  const port = { ...x.fake.port, listAgents: async (): Promise<AgentsView> => {
    if (installed === "unreadable") throw new Error("table unreadable");
    return { installations: installed.map(installation) };
  } };
  const profile = resolveProfile(profileSnapshot(), port);
  const service = new WebControlService({ ...x.service.deps, profileRouter: createExecutionProfileRouter([profile]),
    defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: profile.profileHash, estimateMode: "soft" as const }) });
  return { x, answer: await service.openRequirement(open("g")) as { result?: unknown; error?: { code: string; message: string } } };
}

describe("requirement open picks the one installed agent when none is named (#246)", { timeout: 60_000 }, () => {
  it("one installed: opens on it, and records it as the requirement's agent", async () => {
    const { x, answer } = await opened(["codex"]); try {
      expect(answer).toMatchObject({ result: { kind: "requirement-opened" } });
      const group = readRequirementGroup(x.store, "g");
      expect(group.requirement.agentSlot.selection.agent).toBe("codex");
      expect(readGroupAgentOverrides(group)).toEqual({ estimator: { agent: "codex" } });
    } finally { await x.dispose(); }
  });

  it.each([["none installed", []], ["two installed", ["codex", "other"]], ["the table unreadable", "unreadable" as const]])("%s: the agent-unselected refusal stands", async (_name, installed) => {
    const { x, answer } = await opened(installed as string[] | "unreadable"); try {
      expect(answer.error).toMatchObject({ code: "agent-selection-rejected", message: expect.stringContaining("estimator:agent-unselected") });
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM groups WHERE id='g'").get()!.n).toBe(0);
    } finally { await x.dispose(); }
  });
});
