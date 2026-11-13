// Tester follow-up K, item 1: Overview's problem rows and the Tasks list's "needs you" filter disagreed (the server
// counted a completed handoff stop and every blocked task, the page counted a spend-cap block nowhere). They must list
// the same groups, because a person who sees "needs you" in one place and nothing in the other cannot tell which to trust.
import { afterAll, describe, expect, it } from "vitest";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { createHarness, get, json, GROUP } from "./fixtures/controlPanel.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { systemDebugGroupId } from "../../src/control/systemDebug.js";
import { needsAttention } from "../../web/src/groupCategory.js";
import type { GroupSummaryV1 } from "../../web/src/controlTypes.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm, overview, seedZeroQuestion } = createOverviewFixtures(h);
const PROBLEM_KINDS = ["requirement-attention", "task-attention", "stop-review", "recovery-review", "integration-review"];

describe("one needs-you rule for Overview and Tasks", () => {
  it("lists the same groups in Overview's problems and the Tasks needs-you filter, state by state", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    const db = panel.store.db;
    async function both(): Promise<{ overview: string[]; tasks: string[] }> {
      const steps = (await overview(panel)).steps;
      const problems = [...new Set(steps.filter(s => PROBLEM_KINDS.includes(s.kind) && s.groupId !== null).map(s => String(s.groupId)))].sort();
      const summary = await json(await get(panel, "/api/control/summary")) as { groups: GroupSummaryV1[] };
      const tasks = summary.groups.filter(g => g.archived !== true && needsAttention(g)).map(g => g.groupId).sort();
      return { overview: problems, tasks };
    }
    async function expectBoth(listed: boolean, state: string) {
      const seen = await both();
      expect(seen.tasks, state).toEqual(seen.overview);
      expect(seen.tasks.includes(GROUP), state).toBe(listed);
    }
    await expectBoth(false, "baseline");

    db.prepare("UPDATE work_items SET body=json_set(body,'$.status','blocked') WHERE group_id=? AND id='a'").run(GROUP);
    await expectBoth(true, "a blocked task no one is handling");

    // The escalation ladder took the blocked task over (a debug group still debugging): not yet the person's.
    const ladderId = systemDebugGroupId({ kind: "ladder", groupId: GROUP, taskId: "a", runId: "r-ladder" } as never);
    seedZeroQuestion(panel, ladderId);
    db.prepare("UPDATE groups SET body=json_set(body,'$.systemDebug',json(?)) WHERE id=?").run(JSON.stringify({
      source: { kind: "ladder", groupId: GROUP, taskId: "a", runId: "r-ladder" }, stackOn: null, inputHash: "a".repeat(64), settled: null,
    }), ladderId);
    await expectBoth(false, "a blocked task the ladder is still handling");
    db.prepare("UPDATE work_items SET body=json_set(body,'$.status','ready') WHERE group_id=? AND id='a'").run(GROUP);

    // A stop that completed its handoff asks for no decision.
    db.prepare("UPDATE groups SET body=json_set(body,'$.stopped',json('true')) WHERE id=?").run(GROUP);
    db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,'handoff',1,?)").run(GROUP, canonicalBytes({ mode: "handoff", state: "handoff-complete", frozenRunIds: [], acceptedAt: "2026-10-10T00:00:00.000Z", deadlineAt: "2026-10-10T00:01:00.000Z" }).toString());
    await expectBoth(false, "a completed handoff stop");
    db.prepare("DELETE FROM stop_intents WHERE group_id=?").run(GROUP);
    db.prepare("UPDATE groups SET body=json_set(body,'$.stopped',json('false')) WHERE id=?").run(GROUP);

    // A group stopped at its spend cap waits for a top-up: that is the person's.
    db.prepare("INSERT INTO spend_cap_blocks(group_id,body) VALUES (?,'{\"code\":\"spend-cap-reached\",\"claim\":\"start\"}')").run(GROUP);
    await expectBoth(true, "a group blocked at its spend cap");
    db.prepare("DELETE FROM spend_cap_blocks WHERE group_id=?").run(GROUP);

    // A blocked group is the person's on both pages (the page always said so; Overview had no row for it).
    db.prepare("UPDATE groups SET body=json_set(body,'$.status','blocked') WHERE id=?").run(GROUP);
    await expectBoth(true, "a blocked group");
  });
});
