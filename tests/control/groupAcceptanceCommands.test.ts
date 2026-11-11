/**
 * Tester follow-up E §5 (#241): the two ways out of a failed group acceptance besides a moved tip. `recheck-acceptance`
 * (any principal) removes the failed record, so the next driver round checks the same tip again; `waive-acceptance` (a
 * person) records who accepted the failed tip and why, with a `group-acceptance` activity row, and the group may then be
 * done. Both refuse a record that has not failed. The record is written straight onto the group body (as the pass writes
 * it); groupAcceptance.test.ts drives the pass itself.
 */
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { acceptanceSatisfied } from "../../src/control/groupAcceptanceRecord.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const TIP = "c".repeat(40);
const FAILED = { tip: TIP, result: "failed", commands: [{ command: "npm test", exit: "1", ms: 12 }], tail: "1 failed", at: 1 };

const body = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
function setAcceptance(t: Harness, acceptance: unknown): void {
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(t), acceptance }));
}
const rows = (t: Harness) => readGroupActivity(t.h.store, "g", 200).filter((entry) => entry.kind === "group-acceptance");
const asOwner = <T>(commandId: string, action: () => T): T => withCommandContext(commandId, { client: "web", principal: "user:owner" }, action);

describe("recheck and waive a failed group acceptance (tester follow-up E §5)", () => {
  it("recheck removes the failed record (the next round checks the tip again) and writes no acceptance row", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      setAcceptance(t, FAILED);
      const answer = t.service.recheckAcceptance(t.h.command("recheck-acceptance", {}));
      expect(answer).toMatchObject({ result: { kind: "acceptance-recheck-requested", groupId: "g", tip: TIP } });
      expect(body(t).acceptance).toBeUndefined();
      expect(rows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("waive records who and why on the failed tip, writes one activity row, and lets the group's acceptance gate pass", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      setAcceptance(t, FAILED);
      const command = t.h.command("waive-acceptance", { note: "the red test is a known flake" });
      const answer = asOwner(command.commandId, () => t.service.waiveAcceptance(command));
      expect(answer).toMatchObject({ result: { kind: "acceptance-waived", groupId: "g", tip: TIP } });
      const waived = body(t).acceptance as Record<string, unknown>;
      expect(waived).toMatchObject({ ...FAILED, result: "waived", waived: { by: "user:owner", note: "the red test is a known flake" } });
      expect(rows(t).map((row) => row.body)).toEqual([waived]);
    } finally { await t.h.dispose(); }
  });

  it("waive without a person behind the command is refused and leaves the failed record", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      setAcceptance(t, FAILED);
      expect(t.service.waiveAcceptance(t.h.command("waive-acceptance", { note: "n" }))).toMatchObject({ error: { code: "group-acceptance-person-required" } });
      expect(body(t).acceptance).toEqual(FAILED);
      expect(rows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it.each([["passed"], ["not-needed"], ["waived"], [null]] as const)("recheck and waive refuse a %s acceptance (group-acceptance-not-failed)", async (result) => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const record = result === null ? undefined : { ...FAILED, result };
      if (record !== undefined) setAcceptance(t, record);
      expect(t.service.recheckAcceptance(t.h.command("recheck-acceptance", {}))).toMatchObject({ error: { code: "group-acceptance-not-failed" } });
      const command = t.h.command("waive-acceptance", { note: "n" });
      expect(asOwner(command.commandId, () => t.service.waiveAcceptance(command))).toMatchObject({ error: { code: "group-acceptance-not-failed" } });
      expect(body(t).acceptance).toEqual(record);
    } finally { await t.h.dispose(); }
  });

  // §5: the failure is a problem the Board, Problems and `group show` read from the group summary, named by its command.
  it("the group summary carries the record, and a failed one names its problem group-acceptance-failed:<command>", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      expect(readGroupSummary(t.h.store, "g").acceptance).toBeUndefined();
      setAcceptance(t, FAILED);
      expect(readGroupSummary(t.h.store, "g").acceptance).toEqual({ ...FAILED, problem: "group-acceptance-failed:npm test" });
      setAcceptance(t, { ...FAILED, result: "passed", tail: undefined });
      const passed = readGroupSummary(t.h.store, "g").acceptance;
      expect(passed?.result).toBe("passed");
      expect(passed?.problem).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("a failed acceptance does not satisfy the done gate; the waiver does", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      setAcceptance(t, FAILED);
      expect(acceptanceSatisfied(t.h.store, "g", body(t))).toBe(false);
      const command = t.h.command("waive-acceptance", { note: "known flake" });
      asOwner(command.commandId, () => t.service.waiveAcceptance(command));
      expect(acceptanceSatisfied(t.h.store, "g", body(t))).toBe(true);
    } finally { await t.h.dispose(); }
  });
});
