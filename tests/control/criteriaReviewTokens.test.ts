import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orchestrationRevision, readOrchestrationSettings } from "../../src/control/orchestration.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { CRITERIA_REVIEW_TOKEN_BUDGET, systemDebugGroupId } from "../../src/control/systemDebug.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { SOCKET_TIER } from "../../src/panel/humanOnly.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester #174: the criteria-review judge's 200k grant (over a contract with no token ceiling) was a constant. It is now
// the orchestration setting `criteriaReviewTokens`; never set, the judge gets exactly the old 200000.
const TEST = "import { expect, it } from 'vitest';\nit('adds', () => {\n  expect(1 + 1).toBe(2);\n  expect(2 + 2).toBe(4);\n});\n";
const WEAKENED = TEST.replace("  expect(2 + 2).toBe(4);\n", "");

/** A flagged test change, then the judge the system-debug pass opens; answers the judge's work-token grant. */
async function judgeGrant(setting: number | undefined): Promise<number | null> {
  const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "a"], tokenBudget: null }], { tokenPolicy: "optional-v1", files: (id): Record<string, string> => id === "a" ? { "tests/add.test.ts": WEAKENED } : {} });
  try {
    const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
    const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
    if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
    await mkdir(join(t.repo, "tests"), { recursive: true });
    await writeFile(join(t.repo, "tests", "add.test.ts"), TEST);
    git(t.repo, "add", "tests/add.test.ts"); git(t.repo, "commit", "-qm", "tests");
    const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
    if (setting !== undefined) {
      const set = service.setOrchestrationSettings(t.h.rawCommand("judge-tokens", orchestrationRevision(t.h.store), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, criteriaReviewTokens: setting }) as never);
      expect("error" in set).toBe(false);
      expect(readOrchestrationSettings(t.h.store).criteriaReviewTokens).toBe(setting);
    }
    const driver = t.driver();
    const runId = await t.claim();
    await t.until(driver, () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked", 120);
    const judgeId = systemDebugGroupId({ kind: "criteria-review", groupId: "g", taskId: "a", runId });
    expect((await service.systemDebugPass()).opened).toEqual([judgeId]);
    const work = readBudgetProposal(t.h.store, judgeId).allocations.find((a) => a.ownerKind === "task" && a.bucket === "work");
    return (work?.amount as { tokens: number | null } | undefined)?.tokens ?? null;
  } finally { await t.h.dispose(); }
}

describe("the criteria-review judge's grant is a setting (#174)", { timeout: 180_000 }, () => {
  it("never set: the judge gets the built-in 200000, as before", async () => {
    expect(CRITERIA_REVIEW_TOKEN_BUDGET).toBe(200_000);
    expect(await judgeGrant(undefined)).toBe(200_000);
  });

  it("set: the judge gets the setting", async () => {
    expect(await judgeGrant(123_456)).toBe(123_456);
  });

  it("is a person's on the control socket; the verb's other fields stay open", () => {
    const tier = SOCKET_TIER["set-orchestration-settings"] as (payload: Record<string, unknown>) => string;
    expect(tier({ maxRunningGroups: 3, criteriaReviewTokens: 1 })).toBe("token");
    expect(tier({ maxRunningGroups: 3 })).toBe("open");
  });
});
