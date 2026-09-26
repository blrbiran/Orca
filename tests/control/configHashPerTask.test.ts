import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AgentSelection } from "../../src/control/agentSelection.js";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { FIXTURE_AGENT_ID, FIXTURE_OTHER_AGENT_ID, fixtureConfigHashOf } from "./fixtures/agents.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { FIXTURE_AGENT, profileSnapshot, webFixture } from "./fixtures/web.js";

// Audit 2026-09-26 (seat B, findings K1-K4): every fixture resolver answered ONE constant configHash for every
// selection, so a production slip that hands a task another task's configHash (or the reconciliation a worker's) was
// invisible. These criteria opt into `distinctConfigHash` -- the stand-in answers each complete selection its own hash,
// as ccloop does -- and read the expected hash off the stand-in (`fixtureConfigHashOf`), never off what Orca stored.

/** Task b's complete selection as the fixture's ccloop fills it: the other installation with its descriptor default model. */
const OTHER_AGENT: AgentSelection = { agent: FIXTURE_OTHER_AGENT_ID, model: "fixture-claude-model", contextWindow: "agent-default" };
const TWO_SELECTIONS = [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT_ID } }];

const workBody = (store: { db: { prepare(sql: string): { get(...args: unknown[]): unknown } } }, taskId: string) =>
  JSON.parse(String((store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId) as { body: string }).body));

describe("per-task configHash, with a distinct configHash per selection (audit 2026-09-26 K1-K4)", () => {
  // Guards webService.ts confirm: each task's work item is frozen with ccloop's answer for ITS OWN slot. A confirm that
  // froze the first task's (or any other slot's) configHash onto every task would send ccloop a hash that does not
  // hash the selection beside it -- refused at dispatch at best, run under the wrong config at worst.
  it("confirm freezes onto each of two tasks with different selections the configHash ccloop answered for that task's own selection", async () => {
    const h = await webFixture(profileSnapshot(), TWO_SELECTIONS, { distinctConfigHash: true }); try {
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
      expect({ a: workBody(h.store, "a").configHash, b: workBody(h.store, "b").configHash })
        .toEqual({ a: fixtureConfigHashOf(FIXTURE_AGENT), b: fixtureConfigHashOf(OTHER_AGENT) });
      // The two answers must differ, or the criterion above could not tell the tasks apart.
      expect(fixtureConfigHashOf(FIXTURE_AGENT)).not.toBe(fixtureConfigHashOf(OTHER_AGENT));
    } finally { await h.dispose(); }
  });

  // Guards webDispatch.ts createStartingRun (the run takes its OWN work item's frozen configHash) and startEnvelope.ts
  // (the claim ccloop receives carries the run's): with two tasks frozen under different selections, each start
  // envelope's claim pairs the task's selection with that selection's hash, never the other task's / the first task's.
  it("sends each of two runs whose tasks froze different selections a start envelope carrying its own task's configHash and selection", async () => {
    const t = await driverHarness(TWO_SELECTIONS, { distinctConfigHash: true }); try {
      const ids = [await t.claim(), await t.claim()];
      await t.until(t.driver(), () => ids.every((id) => t.fake.calls.accept.some((envelope) => envelope.claim.runId === id)));
      const sent = Object.fromEntries(ids.map((id) => {
        const envelope = t.fake.calls.accept.find((candidate) => candidate.claim.runId === id)!;
        return [envelope.claim.taskId, { configHash: envelope.claim.configHash, agent: envelope.claim.agent }];
      }));
      expect(sent).toEqual({
        a: { configHash: fixtureConfigHashOf(FIXTURE_AGENT), agent: FIXTURE_AGENT },
        b: { configHash: fixtureConfigHashOf(OTHER_AGENT), agent: OTHER_AGENT },
      });
      // The runs ccloop accepted are the ones Orca recorded: neither was blocked on a configHash mismatch.
      expect(ids.map((id) => t.body(id).drive?.blockedReason ?? null)).toEqual([null, null]);
    } finally { await t.h.dispose(); }
  });

  // Guards executionDriver.ts step B: an accepted execution whose configHash is not the run's blocks the run. With
  // distinct hashes the mix-up is realistic -- ccloop answers the OTHER task's hash -- rather than a sentinel value.
  it("blocks only the run ccloop accepted under the other task's configHash, and lets the other run through", async () => {
    const t = await driverHarness(TWO_SELECTIONS, {
      distinctConfigHash: true,
      acceptedConfigHash: (envelope) => envelope.claim.taskId === "b" ? fixtureConfigHashOf(FIXTURE_AGENT) : envelope.claim.configHash,
    }); try {
      const ids = [await t.claim(), await t.claim()];
      const byTask = (taskId: string) => ids.find((id) => t.body(id).taskId === taskId)!;
      // Wait until ccloop has answered both runs (either blocked or accepted), then say which way each went: a driver that
      // let the mismatch through leaves b accepted, which the assertion below names, rather than a timeout.
      const answered = (runId: string) => t.body(runId).state === "blocked" || t.body(runId).executionId !== null;
      await t.until(t.driver(), () => answered(byTask("a")) && answered(byTask("b")));
      expect(t.body(byTask("b"))).toMatchObject({ executionId: null, drive: { blockedAt: "B", blockedReason: "config-hash-mismatch" } });
      expect(t.body(byTask("a")).state).not.toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  // Guards panel/controlViews.ts workViews (spec §6.4 step 4, §12 I3): a confirmed work item carries exactly its task's
  // entry in the confirmed snapshot. A work item whose configHash is another task's -- the mix-up the constant hash made
  // indistinguishable -- is not displayed as if it were confirmed; the read fails closed on it by name.
  it("fails the read model closed on a confirmed work item that carries another task's configHash", async () => {
    const h = await webFixture(profileSnapshot(), TWO_SELECTIONS, { distinctConfigHash: true }); try {
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
      expect(() => readControlGroup(h.store, "epoch-test", "g")).not.toThrow();
      const b = workBody(h.store, "b");
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='b'").run(JSON.stringify({ ...b, configHash: workBody(h.store, "a").configHash }));
      expect(() => readControlGroup(h.store, "epoch-test", "g")).toThrow("work-item-agent:b");
    } finally { await h.dispose(); }
  });

  // Guards executionSnapshot.ts readConfirmedTaskExecution (driver step A2): the confirmed snapshot is the authority for
  // a task's frozen selection and its work item must agree with it, configHash included. A work item moved onto another
  // task's configHash after confirmation is blocked before its start envelope exists, so ccloop is never asked to run it.
  it("blocks at A2, before ccloop is asked, a run whose work item was moved onto another task's configHash after confirmation", async () => {
    const t = await driverHarness(TWO_SELECTIONS, { distinctConfigHash: true }); try {
      const b = workBody(t.h.store, "b");
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='b'").run(JSON.stringify({ ...b, configHash: workBody(t.h.store, "a").configHash }));
      const ids = [await t.claim(), await t.claim()];
      const runOfB = ids.find((id) => t.body(id).taskId === "b")!;
      await t.until(t.driver(), () => t.body(runOfB).state === "blocked" || t.body(runOfB).executionId !== null);
      expect(t.body(runOfB)).toMatchObject({ state: "blocked", drive: { blockedAt: "A2" } });
      expect(t.body(runOfB).drive.blockedReason).toContain("recovery-blocked");
      expect(t.fake.calls.accept.map((envelope) => envelope.claim.runId)).not.toContain(runOfB);
    } finally { await t.h.dispose(); }
  });

  // Guards driverLanding.ts (the reconciliation's selection file): it carries the group's frozen reconcile slot's
  // configHash, not the conflicted run's. The existing criterion checks this under the constant hash, where the two
  // are equal; here the reconcile slot's selection (another model) has its own hash.
  it("hands the reconciliation the group's reconcile slot's own configHash, distinct from both conflicted runs'", { timeout: 30_000 }, async () => {
    const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
    const t = await driverHarness(conflicting, {
      distinctConfigHash: true, planAgents: { reconcileAgent: { model: "reconcile-model" } },
      files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }),
    }); try {
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      // As driverReconcile.test.ts: the default reserve is smaller than one task's budget, so the ceiling is raised.
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const ids = [await t.claim(), await t.claim()];
      const selectionsFile = `${t.deps.agentsTablePath}.selections`;
      // As driverReconcile.test.ts: wait for both runs to finish (the reconciliation is a background process that must
      // not be cut short by the fixture's cleanup), then read the one spawn's selection file.
      await untilDeadline(t.driver(), () => ids.every((id) => ["landed", "settled", "blocked"].includes(t.body(id).state)));
      expect(existsSync(selectionsFile)).toBe(true);
      const [spawned] = readFileSync(selectionsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { selection: { selection: AgentSelection; configHash: string } });
      const reconcileSelection: AgentSelection = { agent: FIXTURE_AGENT_ID, model: "reconcile-model", contextWindow: "agent-default" };
      expect(spawned!.selection).toEqual({ selection: reconcileSelection, configHash: fixtureConfigHashOf(reconcileSelection) });
      expect(ids.map((id) => t.body(id).configHash)).not.toContain(fixtureConfigHashOf(reconcileSelection));
    } finally { await t.h.dispose(); }
  });
});

/** As driverReconcile.test.ts: the reconciliation is a background process, so progress is wall-clock time. */
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}
