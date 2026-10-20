import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criteriaReviewEnabled } from "../../src/control/criteriaReview.js";
import { flagDecision, listFlaggedDecisions, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { orchestrationRevision, readOrchestrationSettings } from "../../src/control/orchestration.js";
import { readSystemDebugMark, systemDebugGroupId } from "../../src/control/systemDebug.js";
import { readRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Protect-acceptance-criteria spec 2026-10-21 §5 as built (§9): a red test-change flag is judged by Orca's own debug group
 * (source criteria-review) before a person sees it. An empty attempt clears the flag as justified; a landed fix is folded
 * into the flagged group's branch and clears it as restored; a failed judge leaves it red. The reviewer can be switched
 * off per repository and globally (on by default); a flag on a judge's own landing is never judged again (§7a.5).
 * Driven through the driver's synthetic ccloop over a real repository; every assertion reads the store or git.
 */
const TEST = "import { expect, it } from 'vitest';\nit('adds', () => {\n  expect(1 + 1).toBe(2);\n  expect(2 + 2).toBe(4);\n});\n";
const WEAKENED = TEST.replace("  expect(2 + 2).toBe(4);\n", "");

async function reviewWorld(judge: "justified" | "restored" | "fails") {
  const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "a"] }], {
    files: (id): Record<string, string> => id === "a" ? { "tests/add.test.ts": WEAKENED } : judge === "restored" ? { "tests/add.test.ts": TEST } : {},
    behaviour: (id) => id === "debug" && judge === "fails" ? "failed" : "succeed",
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  await mkdir(join(t.repo, "tests"), { recursive: true });
  await writeFile(join(t.repo, "tests", "add.test.ts"), TEST);
  git(t.repo, "add", "tests/add.test.ts"); git(t.repo, "commit", "-qm", "tests");
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const driver = t.driver();
  const runId = await t.claim();
  await t.until(driver, () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked", 120);
  const judgeId = systemDebugGroupId({ kind: "criteria-review", groupId: "g", taskId: "a", runId });
  const body = (groupId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  /** Start the judge as the pump would (start-on-confirm), deliver its wake and drive it until its task settles. */
  const driveJudge = async (): Promise<string> => {
    expect((await service.autoStart()).started).toContain(judgeId);
    const delivered = await deliverScheduledStart(t.dispatch, judgeId);
    if (delivered.kind !== "claimed") throw new Error(`judge claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => ["settled", "blocked"].includes(t.body(delivered.runId).state), 120);
    return delivered.runId;
  };
  return { t, service, runId, judgeId, driveJudge, body, decisionId: `${runId}/orca-criteria` };
}

describe("the automatic reviewer of a flagged test change (spec §5)", { timeout: 180_000 }, () => {
  it("opens a judge stacked on the group as orca-auto; an empty attempt clears the flag as justified", async () => {
    const w = await reviewWorld("justified"); const { t } = w; try {
      expect(readFlaggedDecision(t.h.store, w.decisionId)?.state).toBe("flagged");
      const first = await w.service.systemDebugPass();
      expect(first.opened).toEqual([w.judgeId]);
      expect(first.confirmed).toEqual([w.judgeId]);
      expect(readSystemDebugMark(w.body(w.judgeId))).toEqual({ source: { kind: "criteria-review", groupId: "g", taskId: "a", runId: w.runId }, stackOn: "g", inputHash: expect.stringMatching(/^[a-f0-9]{64}$/), settled: null });
      const goal = (JSON.parse(readArchivedPlan(t.h.store, w.judgeId).plan.tasks[0]!.originalContractCanonicalJson) as { objective: { goal: string } }).objective.goal;
      expect(goal).toContain("fewer-assertions:tests/add.test.ts:2->1");
      expect(goal).toContain("If it did, change nothing.");
      expect(readBudgetProposal(t.h.store, w.judgeId).state).toBe("confirmed");
      // One judge per flagged run.
      expect((await w.service.systemDebugPass()).opened).toEqual([]);

      const gHead = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const judgeRun = await w.driveJudge();
      const settle = await w.service.systemDebugPass();
      expect(settle.settled).toEqual([w.judgeId]);
      expect(readSystemDebugMark(w.body(w.judgeId))?.settled?.state).toBe("justified");
      expect(readFlaggedDecision(t.h.store, w.decisionId)).toEqual(expect.objectContaining({ state: "ratified", ratifiedBy: "orca-auto" }));
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(gHead);

      // §7a.5: a flag on the judge's own landing goes to the person -- no judge of a judge.
      t.h.store.transaction(() => flagDecision(t.h.store, { decisionId: `${judgeRun}/orca-criteria`, groupId: w.judgeId, runId: judgeRun, source: "test-change", reason: "x", evidence: [], by: "orca-auto", at: new Date().toISOString() }));
      expect((await w.service.systemDebugPass()).opened).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a judge that restores the criteria is folded into the group's branch and clears the flag as restored", async () => {
    const w = await reviewWorld("restored"); const { t } = w; try {
      await w.service.systemDebugPass();
      await w.driveJudge();
      expect((await w.service.systemDebugPass()).settled).toEqual([w.judgeId]);
      expect(readSystemDebugMark(w.body(w.judgeId))?.settled?.state).toBe("restored");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(git(t.repo, "rev-parse", `refs/heads/orca/${w.judgeId}`));
      expect(git(t.repo, "show", "refs/heads/orca/g:tests/add.test.ts") + "\n").toBe(TEST);
      expect(readFlaggedDecision(t.h.store, w.decisionId)).toEqual(expect.objectContaining({ state: "ratified", ratifiedBy: "orca-auto" }));
    } finally { await t.h.dispose(); }
  });

  it("a failed judge leaves the flag red for the person", async () => {
    const w = await reviewWorld("fails"); const { t } = w; try {
      await w.service.systemDebugPass();
      await w.driveJudge();
      expect((await w.service.systemDebugPass()).settled).toEqual([w.judgeId]);
      expect(readSystemDebugMark(w.body(w.judgeId))?.settled?.state).toBe("debug-failed");
      expect(readFlaggedDecision(t.h.store, w.decisionId)?.state).toBe("flagged");
    } finally { await t.h.dispose(); }
  });

  it("starts from the target when the flagged group delivers locally (its change is there already)", async () => {
    const w = await reviewWorld("justified"); const { t } = w; try {
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...w.body("g"), integration: newGroupIntegration({ delivery: "local", trigger: "task", method: "merge", target: "main" }) }));
      expect((await w.service.systemDebugPass()).opened).toEqual([w.judgeId]);
      expect(readSystemDebugMark(w.body(w.judgeId))?.stackOn).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("is on by default and can be switched off per repository and globally; a repository's own setting wins", async () => {
    const w = await reviewWorld("justified"); const { t } = w; try {
      const repoRevision = () => readRepositorySettingsBody(t.h.store, "repo")?.revision ?? 0;
      expect(criteriaReviewEnabled(t.h.store, "repo")).toBe(true);
      const off = w.service.setCriteriaReview(t.h.rawCommand("review-off", repoRevision(), "set-criteria-review", { kind: "repository", repoId: "repo" }, { enabled: false }) as never);
      expect("error" in off).toBe(false);
      expect((await w.service.systemDebugPass()).opened).toEqual([]);
      expect(listFlaggedDecisions(t.h.store, "g")[0]?.state).toBe("flagged");

      const global = w.service.setOrchestrationSettings(t.h.rawCommand("review-global-off", orchestrationRevision(t.h.store), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, criteriaReview: false }) as never);
      expect("error" in global).toBe(false);
      const on = w.service.setCriteriaReview(t.h.rawCommand("review-on", repoRevision(), "set-criteria-review", { kind: "repository", repoId: "repo" }, { enabled: true }) as never);
      expect("error" in on).toBe(false);
      expect(criteriaReviewEnabled(t.h.store, "repo")).toBe(true);
      expect((await w.service.systemDebugPass()).opened).toEqual([w.judgeId]);
      // Setting only the cap keeps the stored default.
      const cap = w.service.setOrchestrationSettings(t.h.rawCommand("cap-only", orchestrationRevision(t.h.store), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 4 }) as never);
      expect("error" in cap).toBe(false);
      expect(readOrchestrationSettings(t.h.store)).toEqual({ maxRunningGroups: 4, criteriaReview: false });
    } finally { await t.h.dispose(); }
  });

  it("the global default alone switches it off for a repository without its own setting", async () => {
    const w = await reviewWorld("justified"); const { t } = w; try {
      const global = w.service.setOrchestrationSettings(t.h.rawCommand("review-global-off", orchestrationRevision(t.h.store), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, criteriaReview: false }) as never);
      expect("error" in global).toBe(false);
      expect((await w.service.systemDebugPass()).opened).toEqual([]);
      expect(readFlaggedDecision(t.h.store, w.decisionId)?.state).toBe("flagged");
    } finally { await t.h.dispose(); }
  });
});
