import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { acceptanceSetupDigest, failureIdentitiesOf } from "../../src/control/acceptanceFailureIdentity.js";
import { listFlaggedDecisions, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

const BASE_TEST = [
  "import { expect, it } from 'vitest';",
  "it('keeps the existing behavior', () => {",
  "  expect(1 + 1).toBe(2);",
  "  expect(2 + 2).toBe(4);",
  "});",
  "",
].join("\n");
const WEAK_TEST = BASE_TEST.replace("  expect(2 + 2).toBe(4);\n", "");
const REVIEW_FIX_TEST = `${WEAK_TEST}// review-fix changed this existing test\n`;

const TAP_FAILURE = (name: string) => [
  "TAP version 13", "# Subtest: tests/acceptance.test.js", `    not ok 1 - ${name}`, "      ---",
  "      error: AssertionError", "      actual: 1", "      expected: 2", "      operator: strictEqual", "      ...",
  "    1..1", "    # tests 1", "    # pass 0", "    # fail 1", "not ok 1 - tests/acceptance.test.js", "  ---",
  "  error: 1 subtest failed", "  failureType: subtestsFailed", "  ...", "# tests 1", "# pass 0", "# fail 1", "",
].join("\n");
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function untilDeadline(driver: ReturnType<Awaited<ReturnType<typeof driverHarness>>["driver"]>, predicate: () => boolean, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

const groupBody = (t: Awaited<ReturnType<typeof driverHarness>>) =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const asOwner = <T>(commandId: string, action: () => T): T =>
  withCommandContext(commandId, { client: "web", principal: "user:owner" }, action);

async function driveCriteriaReview(w: Awaited<ReturnType<typeof reviewWorld>>): Promise<void> {
  const t = w.t;
  const opened = await t.service.systemDebugPass();
  expect(opened.opened).toHaveLength(1);
  const judgeId = opened.opened[0]!;
  const source = listFlaggedDecisions(t.h.store, "g")[0]!;
  expect(source.state).toBe("flagged");
  await t.service.autoStart();
  const delivered = await deliverScheduledStart(t.dispatch, judgeId);
  if (delivered.kind !== "claimed") throw new Error(`criteria-review claim refused: ${JSON.stringify(delivered)}`);
  await t.until(w.driver, () => ["settled", "blocked"].includes(t.body(delivered.runId).state), 120);
  const settled = await t.service.systemDebugPass();
  expect(settled.settled).toEqual([judgeId]);
}

describe("acceptance test-change gate through the execution driver", { timeout: 240_000 }, () => {
  it("keeps a review-fix test edit pending after its criteria flag is auto-ratified, until a person dispositions it", async () => {
    let reviewCalls = 0;
    const answer = () => {
      reviewCalls += 1;
      const met = reviewCalls > 1;
      return { outcome: "complete" as const, output: {
        criteria: [{ id: "TEST", verdict: met ? "met" as const : "not-met" as const,
          evidence: [
            { path: "a", line: 1 },
            { path: "tests/existing.test.ts", line: 1 },
          ],
          missing: met ? null : "the code and test change need correction", fixableBy: "work" as const }],
        summary: met ? "the test is acceptable" : "the test needs a fix",
      } };
    };
    const w = await reviewWorld({
      tasks: [
        { taskId: "a", targetPaths: ["a", "tests/**"] },
        { taskId: "b", targetPaths: ["b", "tests/**"] },
      ],
      criteria: [{ id: "TEST", text: "the existing test remains trustworthy" }],
      harness: {
        requiredChecks: ["true"],
        files: (taskId): Record<string, string | null> => {
          if (taskId === "a") return { a: "a\n", "tests/existing.test.ts": WEAK_TEST };
          if (taskId === "review-fix-1") return { "tests/existing.test.ts": REVIEW_FIX_TEST };
          return { [taskId]: `${taskId}\n` };
        },
      },
      answer,
    });
    try {
      mkdirSync(join(w.t.repo, "tests"), { recursive: true });
      writeFileSync(join(w.t.repo, "tests", "existing.test.ts"), BASE_TEST);
      git(w.t.repo, "add", "tests/existing.test.ts");
      git(w.t.repo, "commit", "-qm", "test baseline");

      await w.runAll();
      try { await w.t.until(w.driver, () => w.review()?.state === "fixing", 120); }
      catch (error) { throw new Error(`${String(error)}; reviewCalls=${reviewCalls}; calls=${JSON.stringify(w.calls.map((call) => ({ purpose: call.purpose, prompt: call.prompt.slice(0, 80) })))}; review=${JSON.stringify(w.review())}`); }
      await driveCriteriaReview(w);
      const acceptedDecision = listFlaggedDecisions(w.t.h.store, "g")[0]!;
      expect(readFlaggedDecision(w.t.h.store, acceptedDecision.decisionId)).toMatchObject({
        state: "ratified", ratifiedBy: "orca-auto",
      });

      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      await untilDeadline(w.driver, () => (groupBody(w.t).acceptance as { result?: string } | undefined)?.result === "test-change-pending");

      const acceptance = groupBody(w.t).acceptance as { tip: string; result: string; commands: Array<{ exit: string }>; testChanges: { paths: string[]; pendingResult: string; digest: string } };
      expect(acceptance).toMatchObject({ result: "test-change-pending", testChanges: { pendingResult: "passed", paths: ["tests/existing.test.ts"] } });
      expect(acceptance.commands.every((command) => command.exit === "0")).toBe(true);
      expect(acceptance.tip).toBe(git(w.t.repo, "rev-parse", "refs/heads/orca/g"));
      expect(git(w.t.repo, "show", "refs/heads/orca/g:tests/existing.test.ts") + "\n").toBe(REVIEW_FIX_TEST);
      expect(readGroupSummary(w.t.h.store, "g").acceptance).toMatchObject({ result: "test-change-pending" });
      expect(w.review()).toMatchObject({ state: "passed" });

      const disposition = w.t.h.command("accept-test-changes", { note: "reviewed the review-fix test edit",
        tip: acceptance.tip, digest: acceptance.testChanges.digest });
      const answer = await asOwner(disposition.commandId, () => w.t.service.acceptTestChanges(disposition));
      expect(answer).toMatchObject({ result: { kind: "test-changes-accepted" } });
      await untilDeadline(w.driver, () => groupBody(w.t).status === "done");
    } finally { await w.t.h.dispose(); }
  });

  it("fails when a tip adds a test failure absent from the exact base run", async () => {
    const known = TAP_FAILURE("known base failure");
    const added = TAP_FAILURE("new tip failure");
    const command = `if [ -f a ]; then printf '%s' ${shellQuote(added)}; else printf '%s' ${shellQuote(known)}; fi; exit 1`;
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: ["true"] });
    try {
      await t.claim();
      await t.claim();
      const settings = readRepositorySettingsBody(t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(t.h.store, "repo", {
        ...settings, revision: settings.revision + 1, checks: { ...settings.checks, integrationCheck: { command } },
      });
      const driver = t.driver();
      await untilDeadline(driver, () => (groupBody(t).acceptance as { result?: string } | undefined)?.result === "failed");
      const record = groupBody(t).acceptance as { identityComparisons: Array<{ reason: string; baseIdentities: Array<{ testPath: string[] }>; tipIdentities: Array<{ testPath: string[] }> }> };
      expect(record.identityComparisons[0]).toMatchObject({ reason: "new-failure", baseIdentities: [{ testPath: ["known base failure"] }], tipIdentities: [{ testPath: ["new tip failure"] }] });
    } finally { await t.h.dispose(); }
  });

  it("accepts only the identical parsed known-flake identity relative to its exact base", async () => {
    const known = TAP_FAILURE("known flaky test");
    const command = `printf '%s' ${shellQuote(known)}; exit 1`;
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: ["true"] });
    try {
      await t.claim();
      await t.claim();
      const settings = readRepositorySettingsBody(t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(t.h.store, "repo", { ...settings, revision: settings.revision + 1, checks: { ...settings.checks, integrationCheck: { command } } });
      const parsed = failureIdentitiesOf(known, "node-test-tap-v1", t.repo);
      expect(parsed.parseStatus).toBe("complete");
      expect(parsed.identities.map((identity) => identity.testPath)).toEqual([["known flaky test"]]);
      const driver = t.driver();
      await untilDeadline(driver, () => groupBody(t).status === "done");
      const record = groupBody(t).acceptance as { result: string; identityComparisons: Array<{ command: string; setupDigest: string; reason?: string; baselineSource: string; tipIdentities: Array<{ testPath: string[] }> }> };
      expect(record.result).toBe("passed-relative");
      expect(record.identityComparisons[0]).toMatchObject({ command, setupDigest: acceptanceSetupDigest([]), baselineSource: "collected", tipIdentities: [{ testPath: ["known flaky test"] }] });
      expect(record.identityComparisons[0]?.reason).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});
