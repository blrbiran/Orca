// Completed-but-unsettled acceptance (spec 2026-11-16): a ceiling stop during verify leaves a complete
// archive snapshot and an `exhausted` run; `task accept-attempt` must admit it without a provider call.
// Tester #230 adds the E-block shape (outcome=succeeded, blocked at E, already landed).
import { describe, expect, it } from "vitest";
import { readWork } from "../../src/control/queries.js";
import { readGroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { observeHistorySource, recordHistoryBinding } from "../../src/control/historySource.js";
import { readWebGroup } from "../../src/control/webService.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";

type T = Awaited<ReturnType<typeof driverHarness>>;
const OWNER = { client: "web", principal: "user:owner" } as const;
const M = 1_000_000;

function exhaustedHarness(integration?: IntegrationScheme): Promise<T> {
  const options: HarnessOptions = {
    ...(integration === undefined ? {} : { integration }),
    tokenPolicy: "optional-v1", modelVersion: "followup-g",
    behaviour: () => "exhausted",
    workTokens: () => 2 * M,
    liveCeilingStop: (_id: string, envelope: StartEnvelope) => envelope.liveCeiling === undefined ? undefined : {
      revision: envelope.liveCeiling.revision, tokens: envelope.liveCeiling.tokens, cause: "pause-line",
      observedTokens: 2 * M, phase: "execute", at: "mid-call",
    },
    stopReason: () => "live token ceiling reached",
  };
  return driverHarness([{ taskId: "a" }], options);
}

function setLimit(t: T, tokens: number): void {
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const answer = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens } }));
  if ("error" in answer) throw new Error(JSON.stringify(answer.error));
}

const accept = (t: T, runId: string) => withCommandContext("acc-completed", OWNER, () =>
  t.service.acceptAttempt(t.h.command("accept-attempt", { taskId: "a", runId, note: "reviewed the attempt; the checks decide" }, "acc-completed") as never));

describe("accept-attempt admits a completed but unsettled run (spec 2026-11-16)", { timeout: 300_000 }, () => {
  it("a ceiling stop during verify: the command converts the row, the driver lands it, the task is done", async () => {
    const t = await exhaustedHarness();
    try {
      setLimit(t, 3 * M);
      const driver = t.driver();
      const runId = await t.claim();
      await t.until(driver, () => t.body(runId).state === "settled-recoverable", 400);
      expect(t.body(runId).drive.outcome).toBe("exhausted");
      const answer = await accept(t, runId);
      expect(answer).toMatchObject({ result: { kind: "attempt-accept-requested", runId, taskId: "a" } });
      expect(t.body(runId)).toMatchObject({
        state: "settled-failed",
        operatorSettlement: { kind: "completed-attempt", outcome: "exhausted", principal: "user:owner" },
      });
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)).toEqual({ active: 0 });
      await t.until(driver, () => (readWork(t.h.store, "g", "a") as unknown as { status: string }).status === "done", 600);
    } finally { await t.h.dispose(); }
  });

  it("an operator-accepted source task still binds its named branch before becoming done (#328)", async () => {
    const integration: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main",
      historyExpectation: { version: 1, targetRef: "refs/heads/main", directSecondParent: true,
        sourceRefs: [{ taskId: "a", ref: "refs/heads/feature/source" }] } };
    const t = await exhaustedHarness(integration);
    try {
      git(t.repo, "branch", "feature/source", "main");
      const sourceSha = git(t.repo, "rev-parse", "refs/heads/feature/source");
      setLimit(t, 3 * M);
      const driver = t.driver(), runId = await t.claim();
      await t.until(driver, () => t.body(runId).state === "settled-recoverable", 400);
      expect(await accept(t, runId)).toMatchObject({ result: { kind: "attempt-accept-requested" } });
      await t.until(driver, () => (readWork(t.h.store, "g", "a") as { status: string }).status === "done", 600);
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      expect(readGroupIntegration(group)?.historyBindings).toMatchObject([{ taskId: "a", runId, sourceSha,
        landedCommit: t.body(runId).operatorAcceptance.landedCommit }]);
    } finally { await t.h.dispose(); }
  });

  it("an E-block source keeps its original binding when later group work advanced the tip (#328)", async () => {
    const integration: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main",
      historyExpectation: { version: 1, targetRef: "refs/heads/main", directSecondParent: true,
        sourceRefs: [{ taskId: "a", ref: "refs/heads/feature/source" }] } };
    const t = await exhaustedHarness(integration);
    try {
      git(t.repo, "branch", "feature/source", "main");
      setLimit(t, 3 * M);
      const driver = t.driver(), runId = await t.claim();
      await t.until(driver, () => t.body(runId).state === "settled-recoverable", 400);
      const original = git(t.repo, "rev-parse", "orca/g");
      const observed = await observeHistorySource(t.h.store, t.repo, "g", "a", runId, undefined);
      if (!observed.observation) throw new Error("source missing in fixture");
      t.h.store.transaction(() => {
        recordHistoryBinding(t.h.store, "g", "a", runId, original, observed.observation!);
        const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
        const body = JSON.parse(String(row.body)) as Record<string, unknown> & { drive: Record<string, unknown> };
        body.state = "blocked";
        body.drive = { ...body.drive, historySource: observed.observation, blockedAt: "E", blockedReason: "archive-failed", outcome: "succeeded", landedCommit: original };
        body.remaining = { work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } };
        t.h.store.db.prepare("UPDATE runs SET body=?, active=1 WHERE id=?").run(JSON.stringify(body), runId);
        const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as { status: string };
        work.status = "blocked";
        t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      });
      const advanced = git(t.repo, "commit-tree", `${original}^{tree}`, "-p", original, "-m", "later sibling");
      git(t.repo, "update-ref", "refs/heads/orca/g", advanced, original);
      expect(await accept(t, runId)).toMatchObject({ result: { kind: "attempt-accept-requested" } });
      await t.until(driver, () => ["landed", "refused"].includes(t.body(runId).operatorAcceptance?.state ?? ""), 600);
      expect(t.body(runId).operatorAcceptance.state, t.body(runId).operatorAcceptance.reason).toBe("landed");
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      expect(readGroupIntegration(group)?.historyBindings).toMatchObject([{ taskId: "a", runId, landedCommit: original,
        sourceSha: observed.observation.sourceSha }]);
    } finally { await t.h.dispose(); }
  });

  it("an E-block whose attempt already landed finishes without a second merge commit", async () => {
    const t = await exhaustedHarness();
    try {
      setLimit(t, 3 * M);
      const driver = t.driver();
      const runId = await t.claim();
      await t.until(driver, () => t.body(runId).state === "settled-recoverable", 400);
      const tip = git(t.repo, "rev-parse", "orca/g");
      // The E-block shape (#230): the work landed, the archive/checkpoint step never completed.
      t.h.store.transaction(() => {
        const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
        const body = JSON.parse(String(row.body)) as Record<string, unknown> & { drive: Record<string, unknown> };
        body.state = "blocked";
        body.drive = { ...body.drive, blockedAt: "E", blockedReason: "archive-failed", outcome: "succeeded", landedCommit: tip };
        body.remaining = {
          work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 },
          handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 },
        };
        t.h.store.db.prepare("UPDATE runs SET body=?, active=1 WHERE id=?").run(JSON.stringify(body), runId);
        const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as { status: string };
        work.status = "blocked";
        t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      });
      const answer = await accept(t, runId);
      expect(answer).toMatchObject({ result: { kind: "attempt-accept-requested", runId, taskId: "a" } });
      expect(t.body(runId)).toMatchObject({ operatorSettlement: { kind: "completed-attempt", outcome: "succeeded" } });
      await t.until(driver, () => (readWork(t.h.store, "g", "a") as unknown as { status: string }).status === "done", 600);
      expect(git(t.repo, "rev-parse", "orca/g")).toBe(tip);
      expect(t.body(runId).operatorAcceptance).toMatchObject({ state: "landed", landedCommit: tip });
    } finally { await t.h.dispose(); }
  });
});