// Tester follow-up G spec §2.5 (plan Part B, O5): a task that reached its pause line -- min(10x its expectation, half the
// group limit) -- waits for a person or an orchestrating agent. "continue" moves the line to the next multiple, never
// letting the task take more than half of what the group had left at the decision, and continues the task with its work
// and the decision's note; "stop" ends the task and the group goes on. A task with no expectation never pauses.
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { readStartEnvelope } from "../../src/control/executionDriver.js";
import { pauseLineFor } from "../../src/control/expectationModel.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { VERB_ACCESS } from "../../src/panel/humanOnly.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { readControlGroup, readControlSummary } from "../../src/panel/controlViews.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;
const NOTE = { text: "finish the parser; skip the docs", scope: "next-attempt" as const };

async function paused(tasks: string[], limit: number): Promise<{ t: Harness; driver: ReturnType<Harness["driver"]>; first: string; knobs: { exhausted: boolean } }> {
  const knobs = { exhausted: true };
  const t = await driverHarness(tasks.map(taskId => ({ taskId })), {
    tokenPolicy: "optional-v1", modelVersion: "followup-g",
    behaviour: (id) => knobs.exhausted && id === "a" ? "exhausted" : "stoppable",
    workTokens: (id) => id === "a" && knobs.exhausted ? 10 * M : 10,
    liveCeilingStop: (id: string, envelope: StartEnvelope) => knobs.exhausted && id === "a" && envelope.liveCeiling !== undefined
      ? { revision: 1, tokens: envelope.liveCeiling.tokens, cause: "pause-line" as const, observedTokens: 10 * M, phase: "execute" as const, at: "mid-call" as const } : undefined,
  });
  const limitNow = readWebGroup(t.h.store, "g").ledger.groupLimit;
  t.service.setLimit(t.h.command("set-limit", { limit: { ...limitNow, tokens: limit } }));
  const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  work.tokenIntent = { tokens: M, hard: false, provenance: "human", estimateId: null };
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
  const driver = t.driver();
  let first = await t.claim();
  if (t.body(first).taskId !== "a") first = await t.claim();
  await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
  expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "blocked", usagePause: { multiple: 1 } });
  return { t, driver, first, knobs };
}
const decide = (t: Harness, payload: Record<string, unknown>, taskId = "a") => t.service.usagePauseDecide(t.h.taskCommand("usage-pause-decide", taskId, payload as never));

describe("the pause line formula (spec §2.5, plan O5)", () => {
  it("each continue moves to the next multiple of 10x, never more than half of what the group had left", () => {
    expect(pauseLineFor({ expectationTokens: M, multiple: 1, groupLimitTokens: 20 * M, taskUsedAtDecision: 0, groupUsedAtDecision: 0 })).toBe(10 * M);
    expect(pauseLineFor({ expectationTokens: M, multiple: 1, groupLimitTokens: 8 * M, taskUsedAtDecision: 0, groupUsedAtDecision: 0 })).toBe(4 * M);
    expect(pauseLineFor({ expectationTokens: M, multiple: 3, groupLimitTokens: null, taskUsedAtDecision: 0, groupUsedAtDecision: 0 })).toBe(30 * M);
    expect(pauseLineFor({ expectationTokens: M, multiple: 2, groupLimitTokens: 20 * M, taskUsedAtDecision: 10 * M, groupUsedAtDecision: 14 * M })).toBe(13 * M);
  });
  it("an orchestrating agent may decide, as it may continue a task", () => {
    expect(VERB_ACCESS["usage-pause-decide"]).toBe("any");
  });
});

describe("deciding on a paused task (spec §2.5)", { timeout: 300_000 }, () => {
  it("continue moves the line and continues the task with its work and the note", async () => {
    const { t, driver, first, knobs } = await paused(["a"], 20 * M);
    try {
      const answer = decide(t, { decision: "continue", note: NOTE });
      // used 10M, the group had 10M left: min(20M, 10M + 5M).
      expect(answer).toMatchObject({ result: { kind: "usage-pause-decided", taskId: "a", decision: "continue", nextLine: 15 * M } });
      expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "ready", pauseLine: { multiple: 2, taskUsedAtDecision: 10 * M } });
      expect(readWork(t.h.store, "g", "a")).not.toHaveProperty("usagePause");
      expect(readGroupActivity(t.h.store, "g", 50).find(e => e.kind === "usage-pause-decided")?.body).toMatchObject({ decision: "continue", nextLine: 15 * M });
      knobs.exhausted = false;
      await driver.round();
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      const second = claimed.runId;
      expect(t.body(second).liveCeiling).toMatchObject({ cause: "pause-line", tokens: 5 * M });
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true; i++) await driver.round();
      const envelope = readStartEnvelope(t.h.store, t.body(second));
      expect(envelope.work.kind === "loop" ? envelope.work.operatorNote : null).toEqual(NOTE);
      expect(envelope.inputCheckpoint).not.toBeNull();
      expect(first).not.toBe(second);
      expect(readWork(t.h.store, "g", "a")).not.toHaveProperty("pendingOperatorNote");
      // Tester #294 (follow-up J): the continued run carries the note on its top level; its group and the summary still read.
      // mutation: drop operatorNote from persistedRunSchema (controlViews.ts) -> run-invalid:<run>, red
      expect(readControlGroup(t.h.store, "epoch", "g").summary.groupId).toBe("g");
      expect(readControlSummary(t.h.store, "epoch", null)).not.toHaveProperty("unreadable");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("continue with no room left is refused by name and changes nothing", async () => {
    const { t, driver } = await paused(["a"], 20 * M);
    try {
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      group.used.tokens = group.limit.tokens;
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      const before = JSON.stringify(readWork(t.h.store, "g", "a"));
      expect(decide(t, { decision: "continue" })).toMatchObject({ error: { code: "usage-pause-no-headroom" } });
      expect(JSON.stringify(readWork(t.h.store, "g", "a"))).toBe(before);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("stop ends the task and the group goes on", async () => {
    const { t, driver } = await paused(["a", "b"], 40 * M);
    try {
      expect(decide(t, { decision: "stop" })).toMatchObject({ result: { decision: "stop", nextLine: null } });
      expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "blocked", usageStopped: { principal: expect.any(String) } });
      expect(readWork(t.h.store, "g", "a")).not.toHaveProperty("usagePause");
      expect(readGroup(t.h.store, "g").stopped).toBe(false);
      expect(readWork(t.h.store, "g", "b").status).not.toBe("blocked");
      // The stopped task is never claimed again; the group's other work is.
      for (let i = 0; i < 3; i++) {
        await driver.round();
        const claimed = await deliverScheduledStart(t.dispatch, "g");
        if (claimed.kind === "claimed") expect(t.body(claimed.runId).taskId).toBe("b");
      }
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE work_item_id='a'").get()!.n).toBe(1);
      // A second decision finds nothing waiting.
      expect(decide(t, { decision: "continue" })).toMatchObject({ error: { code: "usage-pause-not-waiting" } });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a task with no expectation never pauses: its ceiling is the group's only", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", behaviour: () => "stoppable" });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 100 * M } }));
      const runId = await t.claim();
      expect(t.body(runId).liveCeiling.cause).toBe("group");
      expect(decide(t, { decision: "continue" })).toMatchObject({ error: { code: "usage-pause-not-waiting" } });
    } finally { await t.h.dispose(); }
  });
});
