// Working-tree delivery spec 2026-11-19 §4.2, §5 (#365): the group brief and the group view carry
// `projectDeliveryChosen: false` exactly where the first-use question is asked -- a done group kept on its branch in a
// project nobody chose a delivery for -- and nothing anywhere else, so every other read keeps its bytes.
import { afterAll, describe, expect, it } from "vitest";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { createHarness, get, json, GROUP } from "./fixtures/controlPanel.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm } = createOverviewFixtures(h);

describe("projectDeliveryChosen on the brief and the view (spec §4.2)", () => {
  it("is false for a done keep group of a never-chosen project, and absent before done and once a person chose", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    // The shared fixture's service has no repository resolver (the panel's assembly always gives one); this read needs it.
    const checkout = "/registered/checkout";
    Object.assign(panel.service.deps, { resolveRepository: (repoId: string) => { if (repoId !== "repo") throw new Error(repoId); return checkout; } });
    const reads = async () => ({
      brief: await json(await get(panel, `/api/control/groups/${GROUP}/brief`)) as Record<string, unknown>,
      view: await json(await get(panel, `/api/control/groups/${GROUP}`)) as Record<string, unknown>,
    });
    // Not done yet: nothing is asked.
    const running = await reads();
    expect(running.brief).not.toHaveProperty("projectDeliveryChosen");
    expect(running.view).not.toHaveProperty("projectDeliveryChosen");

    panel.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id=?").run(GROUP);
    panel.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','done') WHERE id=?").run(GROUP);
    const done = await reads();
    expect((done.brief as { state?: string }).state).toBe("done");
    // mutations: drop deliveryQuestionView from the brief route, or from readControlGroup -> red here (each separately)
    expect(done.brief.projectDeliveryChosen).toBe(false);
    expect(done.view.projectDeliveryChosen).toBe(false);
    // #365 review (controller ruling Q2): the registered checkout's path rides with the question, so the Web question and
    // the CLI can name it. mutation: drop checkoutPathOf from the view route, or from the brief -> red here (each)
    expect(done.view.checkoutPath).toBe(checkout);
    expect(done.brief.checkoutPath).toBe(checkout);
    expect(running.view).not.toHaveProperty("checkoutPath");

    // A person stores keep: chosen, so the key is gone from both reads.
    const current = readRepositorySettingsBody(panel.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
    writeRepositorySettingsBody(panel.store, "repo", { ...current, revision: current.revision + 1, integration: { delivery: "keep" } });
    const chosen = await reads();
    // mutation: ignore integrationChosen in deliveryQuestionView -> red here
    expect(chosen.brief).not.toHaveProperty("projectDeliveryChosen");
    expect(chosen.view).not.toHaveProperty("projectDeliveryChosen");
    expect(chosen.brief).not.toHaveProperty("checkoutPath");
    expect(chosen.view).not.toHaveProperty("checkoutPath");
  });
});
