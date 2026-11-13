// Tester follow-up K, item 2 (human ruling ①: 「还是觉得 ① 就好，这是人不设测试命令的结果，不应该替人决定必须跑pass」): Orca runs
// no full suite the person did not adopt, but an acceptance that passed without one must not read like one that ran it.
// It is labelled (`passedWithoutFullSuite`, the `full-suite-not-set` warning) -- records written before the full suite
// existed too, since none ran for them either -- in `group brief`, and as a non-blocking Overview row while the project
// still has no command. The row is a warning, never a problem: the group does not become "needs you".
import { afterAll, describe, expect, it } from "vitest";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { createHarness, get, json, GROUP } from "./fixtures/controlPanel.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm, overview } = createOverviewFixtures(h);
const OLD_PASSED = { tip: "a".repeat(40), result: "passed", commands: [{ command: "node check.js", exit: "0", ms: 5 }], at: 1 };

describe("an acceptance that passed without a full suite is labelled (item 2)", () => {
  it("labels an old passed record with no fullSuite field in the brief and on Overview, without making it needs-you", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.acceptance',json(?)) WHERE id=?").run(JSON.stringify(OLD_PASSED), GROUP);
    const brief = await json(await get(panel, `/api/control/groups/${GROUP}/brief`)) as Record<string, any>;
    expect(brief.acceptance).toMatchObject({ result: "passed", warning: "full-suite-not-set", passedWithoutFullSuite: true });
    expect(brief.warnings).toEqual(["full-suite-not-set"]);

    const body = await overview(panel);
    expect(body.steps.filter(s => s.groupId === GROUP && s.kind === "acceptance-warning")).toEqual([
      expect.objectContaining({ reason: "full-suite-not-set", destination: expect.objectContaining({ kind: "group", groupId: GROUP, region: "problem" }) }),
    ]);
    expect(body.groups.find(g => g.groupId === GROUP)?.needsYou).toBe(false);

    // Once the person adopts a command the row has nothing left to ask; the record keeps its label.
    const current = readRepositorySettingsBody(panel.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
    writeRepositorySettingsBody(panel.store, "repo", { ...current, revision: current.revision + 1, checks: { ...current.checks, integrationCheck: { command: "npm test" } } });
    expect((await overview(panel)).steps.some(s => s.groupId === GROUP && s.kind === "acceptance-warning")).toBe(false);
    const after = await json(await get(panel, `/api/control/groups/${GROUP}/brief`)) as Record<string, any>;
    expect(after.acceptance).toMatchObject({ passedWithoutFullSuite: true });
  });

  it("does not label a waived or not-run record that has no fullSuite field (no suite was its business)", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    for (const record of [{ ...OLD_PASSED, result: "waived", waived: { by: "olga", note: "known", at: 2 } }, { tip: null, result: "not-run", why: "dir", commands: [], at: 1 }]) {
      panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.acceptance',json(?)) WHERE id=?").run(JSON.stringify(record), GROUP);
      const brief = await json(await get(panel, `/api/control/groups/${GROUP}/brief`)) as Record<string, any>;
      expect(brief.acceptance.warning, record.result).toBeUndefined();
      expect(brief.acceptance.passedWithoutFullSuite, record.result).toBeUndefined();
      expect(brief.warnings, record.result).toBeUndefined();
    }
  });
});
