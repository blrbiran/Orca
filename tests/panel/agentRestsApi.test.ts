/**
 * Quota failover spec 2026-11-03 §3 "Show: … the agents page shows each installation's rest and when it ends" (session
 * 3cfc2e73, batch FB): a person deciding whether to wait or re-pick an agent needs to see which installation is out of quota,
 * since when, until when, and the CLI's own words -- from the same derivation failover uses (quotaRest.ts), over a real
 * panel. Only installations the table lists; nothing at all when none rests (the view keeps its old shape).
 */
import { afterAll, describe, expect, it } from "vitest";
import { agentsViewSchema } from "../../src/control/webProtocol.js";
import { CLAUDE_CODEX_AGENTS, GROUP, claudeCodexResolveAgent, command, createHarness, get, json } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

describe("the agents view lists each resting installation (§3 Show)", () => {
  it("gives a listed installation's rest with since, until, source and the CLI's text, and no unlisted one", async () => {
    const panel = await h.boot("epoch-agent-rests", await h.workspace(), { resolveAgent: claudeCodexResolveAgent, agents: CLAUDE_CODEX_AGENTS, seedPreferences: false });
    try {
      const imported = await command(panel, "/api/control/groups/import-plan", { commandId: "rests-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
      expect(imported.status).toBe(201);
      // Two consecutive quota failures on codex (the rest doubles from the first), one on an installation the table does not list.
      const first = Date.now() - 60_000, second = first + 1_000;
      const insert = (id: string, agent: string, endedAt: number, detail: string) => panel.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES(?,?,?,?,0,?)")
        .run(id, GROUP, `w-${id}`, 1, JSON.stringify({ agent: { agent }, endedAt, drive: { outcome: "failed", failureCause: { cause: "quota", detail } } }));
      insert("r-1", "codex", first, "You've hit your usage limit");
      insert("r-2", "codex", second, "You've hit your usage limit again");
      insert("r-3", "omp-unlisted", second, "quota");
      const answer = agentsViewSchema.parse(await json(await get(panel, "/api/control/agents")));
      expect(answer.installations).toEqual(CLAUDE_CODEX_AGENTS.installations);
      expect(answer.rests).toEqual([{ installation: "codex", since: first, until: second + 30 * 60_000, source: "default", detail: "You've hit your usage limit again" }]);
    } finally { await panel.close(); }
  });
});
