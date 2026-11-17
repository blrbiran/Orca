import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { deliveredAcceptanceSatisfied } from "../../src/control/groupAcceptanceRecord.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { groupNeedsYou } from "../../src/panel/controlOverview.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Delivery tail spec D3 (tester #336 addendum, human ruling 3 of session 2026-11-17): after a local delivery whose tree
 * differs from the accepted tip's -- the target moved meanwhile, so the merge commit is a tree no check ran on -- the same
 * configured commands run on the delivered commit. Same tree: nothing runs. A red result keeps the group from done and is
 * a problem; a person may waive it. Driven by the real driver (acceptance, integration, delivered acceptance passes).
 */
// Green on every tree except one holding poison.txt, which only the person's commit on main adds.
const CHECK = "test ! -f poison.txt";
const LOCAL = { delivery: "local", trigger: "group", method: "merge", target: "main" } as const;
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const body = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

/** Two tasks land on orca/g; then `onMain` (if any) is committed to main by the person; the driver runs until `until`. */
async function deliver(onMain: string | null, until: (t: Harness) => boolean) {
  const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [CHECK], integration: LOCAL });
  try {
    await t.claim(); await t.claim();
    const driver = t.driver();
    for (let i = 0; i < 400 && JSON.parse(String(t.h.store.db.prepare("SELECT count(*) AS n FROM work_items WHERE group_id='g' AND json_extract(body,'$.status')='done'").get()!.n)) < 2; i += 1) await driver.round();
    if (onMain !== null) {
      writeFileSync(join(t.repo, onMain), "the person's\n");
      git(t.repo, "add", onMain);
      git(t.repo, "commit", "-qm", `person: ${onMain}`);
    }
    // The harness's checkout holds untracked files; with main checked out there the delivery would (rightly) refuse
    // integration-worktree-dirty. Detached, main is a plain ref the delivery moves.
    git(t.repo, "checkout", "-q", "--detach");
    for (let i = 0; i < 400 && !until(t); i += 1) { await driver.round(); await new Promise((resolve) => setTimeout(resolve, 20)); }
    await driver.stop();
    return t;
  } catch (error) { await t.h.dispose(); throw error; }
}

describe("acceptance on the delivered commit (delivery tail D3)", { timeout: 240_000 }, () => {
  it("runs the configured commands on a merge whose tree differs, and the group is done when they pass", async () => {
    const t = await deliver("notes.txt", (x) => body(x).status === "done");
    try {
      const integration = body(t).integration;
      expect(integration.integratedCommit).not.toBeNull();
      // mutation: skip the delivered acceptance pass -> no record, red
      expect(body(t).deliveredAcceptance).toMatchObject({ tip: integration.lastIntegrated, commit: integration.integratedCommit, result: "passed",
        commands: expect.arrayContaining([expect.objectContaining({ command: CHECK, exit: "0" })]) });
      expect(body(t).status).toBe("done");
      expect(readGroupActivity(t.h.store, "g", 200).filter((row) => row.kind === "delivered-acceptance")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("runs nothing when the delivered tree is the accepted tip's", async () => {
    const t = await deliver(null, (x) => body(x).status === "done");
    try {
      // mutation: drop the tree comparison -> commands run, red
      expect(body(t).deliveredAcceptance).toMatchObject({ result: "not-needed", why: "same-tree", commands: [] });
    } finally { await t.h.dispose(); }
  });

  it("a check red only on the delivered commit keeps the group from done, is a problem, and a person's waiver clears it", async () => {
    const t = await deliver("poison.txt", (x) => body(x).deliveredAcceptance?.result === "failed");
    try {
      expect(body(t).deliveredAcceptance).toMatchObject({ result: "failed", commands: expect.arrayContaining([expect.objectContaining({ command: CHECK, exit: "1" })]) });
      // mutation: drop the done gate -> done, red
      expect(body(t).status).not.toBe("done");
      expect(groupNeedsYou(t.h.store, "g")).toBe(true);
      // mutation: drop deliveredAcceptance from the group summary -> undefined, red
      expect(readGroupSummary(t.h.store, "g").deliveredAcceptance).toMatchObject({ result: "failed", problem: `delivered-acceptance-failed:${CHECK}` });
      const command = t.h.command("waive-acceptance", { note: "poison.txt is the person's own fixture" });
      const answer = withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () => t.service.waiveAcceptance(command as never));
      expect(answer).toMatchObject({ result: { kind: "acceptance-waived" } });
      expect(body(t).deliveredAcceptance).toMatchObject({ result: "waived", waived: { note: "poison.txt is the person's own fixture" } });
      const driver = t.driver();
      for (let i = 0; i < 100 && body(t).status !== "done"; i += 1) await driver.round();
      await driver.stop();
      expect(body(t).status).toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("a group already done before this record existed stays satisfied (no record, status done)", () => {
    const integration = { scheme: LOCAL, frozen: true, state: "idle", pending: null, lastIntegrated: "a".repeat(40), integratedCommit: "b".repeat(40), integratedFor: "a".repeat(40) };
    // mutation: require a record for a done group -> false, red
    expect(deliveredAcceptanceSatisfied({ status: "done", integration })).toBe(true);
    expect(deliveredAcceptanceSatisfied({ status: "review", integration })).toBe(false);
    expect(deliveredAcceptanceSatisfied({ status: "review", integration: { ...integration, scheme: { ...LOCAL, delivery: "push-target", remote: "o" } } })).toBe(true);
  });
});
