import { describe, expect, it } from "vitest";
import { acceptanceEvidence } from "../../src/control/checkpoints.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { reopenTaskPayloadSchema } from "../../src/control/webProtocol.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up G spec §1.4-§1.5 (human: 「希望这个任务直接在同一组里带你写的一句说明重新跑一次」): a person or an
 * orchestrating agent revokes a no-change completion with a note; the task returns to ready in the same group, its next
 * run carries the note as its operator note, and a done group runs again. Dependents already landed are not rolled back.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const NOTE = "the goal also needs README.md to say how to run it";
const workOf = (t: Harness, taskId = "a") => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const groupStatus = (t: Harness) => String(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).status);
const rowsOf = (t: Harness, kind: string) => t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind=? ORDER BY seq").all(kind).map((r) => JSON.parse(String(r.body)));
const reopen = (t: Harness, runId: string, taskId = "a", note = NOTE) => t.service.reopenTask(t.h.command("reopen-task", { taskId, runId, note }));
const refusal = (answer: unknown) => { const error = (answer as { error?: { code: string; message: string } }).error; return error === undefined ? null : { code: error.code, message: error.message }; };
/** The driver arms a start wake for the ready task (replenishStartWakes); delivering it claims the next run. */
async function claimAgain(t: Harness): Promise<string> {
  replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}

/** A one-task (or given) group whose task `a` completes as no change (agent verifier, empty attempt). */
async function noChangeDone(tasks: Parameters<typeof driverHarness>[0] = [{ taskId: "a", verifierType: "agent" }], files?: (id: string) => Record<string, string | null>) {
  const t = await driverHarness(tasks, { files: files ?? (() => ({})) });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
  if (workOf(t).status !== "done") throw new Error("fixture: task a did not complete as no change");
  return { t, runId };
}

describe("task reopen: revoke a no-change completion and run it again with a note (tester follow-up G §1.4)", () => {
  it("reopen withdraws the no-change acceptance, returns the task to ready and the next run carries the note", async () => {
    const { t, runId } = await noChangeDone();
    try {
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(true);
      expect(reopen(t, runId)).toMatchObject({ result: { kind: "task-reopened", taskId: "a", fromRunId: runId } });
      // mutation M4a: skip the outbox rewrite -> the acceptance still counts, red
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(false);
      expect(workOf(t)).toMatchObject({ status: "ready", reopenNote: { text: NOTE, scope: "remaining-attempts" } });
      expect(workOf(t).noChangeCompletion).toBeUndefined();
      expect(rowsOf(t, "no-change-revoked")).toEqual([expect.objectContaining({ runId, note: NOTE, withdrawn: true })]);
      const next = await claimAgain(t);
      // mutation M4b: drop the operatorNote copy in createStartingRun -> undefined, red
      expect(t.body(next).operatorNote).toEqual({ text: NOTE, scope: "remaining-attempts" });
      expect(workOf(t).reopenNote).toBeUndefined();
    } finally { await t.h.dispose(); }
  }, 60000);

  it("a done group goes back to running", async () => {
    const { t, runId } = await noChangeDone();
    try {
      expect(groupStatus(t)).toBe("done");
      reopen(t, runId);
      // mutation M4c: skip the group status write -> still done, red
      expect(groupStatus(t)).toBe("running");
    } finally { await t.h.dispose(); }
  }, 60000);

  it("reopen leaves a landed dependent done", async () => {
    const { t, runId } = await noChangeDone([{ taskId: "a", verifierType: "agent" }, { taskId: "b", dependsOn: ["a"] }], (id) => (id === "a" ? {} : { b: "b\n" }));
    try {
      const b = await claimAgain(t);
      await t.until(t.driver(), () => t.body(b).drive?.cleanedUp === true);
      expect(workOf(t, "b").status).toBe("done");
      expect(reopen(t, runId)).toMatchObject({ result: { kind: "task-reopened" } });
      expect(workOf(t, "a").status).toBe("ready");
      expect(workOf(t, "b").status).toBe("done");
      expect(git(t.repo, "show", "refs/heads/orca/g:b")).toBe("b");
    } finally { await t.h.dispose(); }
  }, 90000);

  it("reopen is refused while the group is stopped, and on a task that did not complete as no change", async () => {
    const { t, runId } = await noChangeDone();
    try {
      const paused = await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect("error" in paused ? paused.error : "paused").toBe("paused");
      // mutation M4d: drop the stop check -> reopened, red
      expect(refusal(reopen(t, runId))?.code).toBe("stop-mode-conflict");
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(true);
      expect(workOf(t).status).toBe("done");
    } finally { await t.h.dispose(); }
    const landed = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await landed.claim();
      await landed.until(landed.driver(), () => landed.body(runId).drive?.cleanedUp === true);
      expect(refusal(reopen(landed, runId))).toEqual({ code: "task-not-reopenable", message: "task-not-reopenable:not-no-change" });
      expect(refusal(reopen(landed, "run-stale"))).toEqual({ code: "task-not-reopenable", message: "task-not-reopenable:run-moved" });
      expect(await acceptanceEvidence(landed.h.store, runId)).toBe(true);
      expect(workOf(landed).status).toBe("done");
    } finally { await landed.h.dispose(); }
  }, 90000);

  it("a note over 2048 bytes or blank is refused by the payload", () => {
    const parse = (note: string) => reopenTaskPayloadSchema.safeParse({ taskId: "a", runId: "run-a", note }).success;
    expect(parse("x".repeat(2049))).toBe(false);
    expect(parse("   ")).toBe(false);
    expect(parse("x".repeat(2048))).toBe(true);
    // mutation M4e: .max(2048) on characters -> 683 three-byte characters (2049 bytes) accepted, red
    expect(parse("改".repeat(683))).toBe(false);
    expect(parse("改".repeat(682))).toBe(true);
  });

  it("a finite group with no token remainder refuses reopen with the exhaustion refusal", async () => {
    const { t, runId } = await noChangeDone();
    try {
      // The group's whole token limit is used or reserved (limit and its ledger mirror lowered together).
      t.h.store.transaction(() => t.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.limit.tokens',json_extract(body,'$.used.tokens')+json_extract(body,'$.reserved.tokens'),'$.ledger.groupLimit.tokens',json_extract(body,'$.used.tokens')+json_extract(body,'$.reserved.tokens')) WHERE id='g'").run());
      // mutation M4f: drop the token-remainder check -> reopened, red
      expect(refusal(reopen(t, runId))).toEqual({ code: "group-budget-unavailable", message: "group-budget-unavailable:tokens" });
      expect(workOf(t).status).toBe("done");
    } finally { await t.h.dispose(); }
  }, 60000);
});
