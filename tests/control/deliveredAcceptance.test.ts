import { mkdirSync, writeFileSync } from "node:fs";
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
async function deliver(onMain: string | null, until: (t: Harness) => boolean, options: { check?: string; existingTest?: boolean } = {}) {
  const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [options.check ?? CHECK], integration: LOCAL });
  try {
    if (options.existingTest === true) {
      const path = join(t.repo, "tests", "existing.test.ts");
      mkdirSync(join(t.repo, "tests"), { recursive: true });
      writeFileSync(path, "it('works', () => { expect(1).toBe(1); });\n");
      git(t.repo, "add", "tests/existing.test.ts"); git(t.repo, "commit", "-qm", "test base");
    }
    await t.claim(); await t.claim();
    const driver = t.driver();
    for (let i = 0; i < 400 && JSON.parse(String(t.h.store.db.prepare("SELECT count(*) AS n FROM work_items WHERE group_id='g' AND json_extract(body,'$.status')='done'").get()!.n)) < 2; i += 1) await driver.round();
    if (onMain !== null) {
      writeFileSync(join(t.repo, onMain), onMain === "tests/existing.test.ts"
        ? "it('works', () => { expect(1).toBe(1); });\n// the delivered test changed\n"
        : "the person's\n");
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
  it("does not let a tip waiver cover a measured delivered-tree shortfall", async () => {
    const module = await import("../../src/control/deliveredAcceptance.js");
    const classify = (module as unknown as { classifyDeliveredAcceptance?: (...args: unknown[]) => unknown }).classifyDeliveredAcceptance;
    expect(typeof classify).toBe("function");
    if (classify === undefined) return;
    const identity = { key: "k", file: "tests/test.js", testPath: ["known flaky test"], diagnosticHash: "d" };
    const outcome = {
      failure: { command: "npm test", exit: "1", tail: "known flaky test" },
      commands: [{ command: "npm test", exit: "1", ms: 1 }],
      suiteExits: ["1"], tests: 79,
      evidence: { cwd: null, head: null, trackedFiles: null, testFiles: null, tests: 79, baselineTests: 552,
        baselineCount: { state: "counted", tests: 552, source: "base-suite" }, shortfall: { tests: 79, baselineTests: 552 } },
      identityComparisons: [{ command: "npm test", base: "base", setupDigest: "setup", reporter: "node-test-tap-v1",
        baselineSource: "stored", tipAttempts: [{ exit: "1", failureIdentityStatus: "complete", failureIdentities: [identity] }],
        baseIdentities: [identity], tipIdentities: [identity] }],
    };
    const accepted = { tip: "tip", result: "waived", waived: { by: "owner", note: "known flake", at: 1 } };
    const result = classify({ tip: "tip", commit: "commit" }, outcome, accepted, 2, { paths: [], weakeningSignals: [], digest: "digest" }) as { result: string; evidence?: unknown };
    expect(result).toMatchObject({ result: "failed", evidence: { shortfall: { tests: 79, baselineTests: 552 } } });
  });

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
      // #359 review I2: the group's own problem names it too, with the delivered acceptance's answers (the card shows it).
      // mutation: drop the delivered branch of groupProblemOf -> absent, red here
      expect(readGroupSummary(t.h.store, "g").groupProblem).toEqual({ code: `delivered-acceptance-failed:${CHECK}`, why: "delivered-acceptance-failed",
        next: ["orca group recheck-acceptance g", "orca group waive-acceptance g --note '<why the delivered tree is accepted>'"] });
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

  it("a delivery's new failing identity is compared at the group's base instead of inheriting the tip pass", async () => {
    const failure = [
      "TAP version 13", "# Subtest: tests/delivery.test.ts", "    not ok 1 - new delivery failure", "      ---",
      "      error: AssertionError", "      actual: 1", "      expected: 2", "      operator: strictEqual", "      ...",
      "    1..1", "    # tests 1", "    # pass 0", "    # fail 1", "not ok 1 - tests/delivery.test.ts", "  ---",
      "  error: 1 subtest failed", "  failureType: subtestsFailed", "  ...", "# tests 1", "# pass 0", "# fail 1", "",
    ].join("\n");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const check = `if [ -f delivery-failure ]; then printf '%s' ${quote(failure)}; exit 1; else true; fi`;
    const t = await deliver("delivery-failure", (x) => body(x).deliveredAcceptance?.result === "failed", { check });
    try {
      expect(body(t).acceptance.result).toBe("passed");
      expect(body(t).deliveredAcceptance).toMatchObject({ result: "failed", identityComparisons: [{ reason: "new-failure", baselineSource: "collected" }] });
    } finally { await t.h.dispose(); }
  });

  it("a changed existing test on the delivered commit requires its own disposition", async () => {
    const t = await deliver("tests/existing.test.ts", (x) => body(x).deliveredAcceptance?.result === "test-change-pending", { existingTest: true });
    try {
      expect(body(t).acceptance.result).toBe("passed");
      expect(body(t).deliveredAcceptance).toMatchObject({ result: "test-change-pending", testChanges: { paths: ["tests/existing.test.ts"] } });
      expect(deliveredAcceptanceSatisfied(body(t))).toBe(false);
      expect(body(t).status).not.toBe("done");
      const pending = body(t).deliveredAcceptance as { commit: string; testChanges: { digest: string } };
      const command = t.h.command("accept-test-changes", { note: "the delivered test expansion is intentional", tip: pending.commit, digest: pending.testChanges.digest });
      const answer = await withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () => t.service.acceptTestChanges(command));
      expect(answer).toMatchObject({ result: { kind: "test-changes-accepted" } });
      expect(body(t).deliveredAcceptance).toMatchObject({ result: "passed", testChanges: { disposition: { by: "user:owner", note: "the delivered test expansion is intentional" } } });
      expect(deliveredAcceptanceSatisfied(body(t))).toBe(true);
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
