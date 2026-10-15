import { describe, expect, it } from "vitest";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { recordUsage } from "../../src/control/usage.js";
import { createWebWakeHandlers, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.2, criteria 1-6 (feedback #53): a second start while the group's execution is pending
// used to be accepted -- a revision bump, an activity row and a redundant wake -- over HTTP, the socket, the CLI and MCP.
// It is refused by name before the agent is asked, ledgered, and checked again inside the transaction.
type Fixture = Awaited<ReturnType<typeof webFixture>>;
async function confirmed(tasks = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}
const fingerprint = (h: Fixture): string => JSON.stringify({
  groups: h.store.db.prepare("SELECT id,revision,projection_seq,body FROM groups ORDER BY id").all(),
  activity: h.store.db.prepare("SELECT * FROM activity ORDER BY seq").all(),
  wakes: h.store.db.prepare("SELECT id,kind,body,delivered FROM scheduler_wakes ORDER BY rowid").all(),
  allowances: h.store.db.prepare("SELECT * FROM funded_allowances ORDER BY rowid").all(),
  work: h.store.db.prepare("SELECT id,body FROM work_items ORDER BY id").all(),
});
const setWork = (h: Fixture, patch: Record<string, unknown>) => {
  const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, ...patch }));
};

describe("a second start is refused while execution is pending (spec B §3.2)", () => {
  it("C1: refuses before asking the agent, changes nothing, and replays the same refusal from the ledger", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const before = fingerprint(h), asked = h.asked.length;
      const second = h.command("start", {}, "second-start");
      const refused = await service.start(second);
      expect(refused).toEqual({ error: { code: "group-execution-pending", message: "group-execution-pending", commandRevision: expect.any(Number), evidenceIds: [], retryable: false } });
      expect([h.asked.length - asked, fingerprint(h) === before]).toEqual([0, true]);
      expect(lookupCommandResult(h.store, "g", "second-start")).toMatchObject({ originalStatus: 409, body: refused });
      expect(await service.start(second)).toEqual(refused);
      expect(h.asked.length - asked).toBe(0);
    } finally { await h.dispose(); }
  });

  it.each(["no-start", "resume"])("C2: refuses on an undelivered %s wake alone", async (kind) => {
    const { h, service } = await confirmed(); try {
      h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,?,?,0)").run(`injected-${kind}`, "g", kind, "{}");
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it.each(["running", "active", "starting", "start-unknown", "held", "continuing"])("C2: refuses on a %s task alone", async (status) => {
    const { h, service } = await confirmed(); try {
      setWork(h, { status });
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C2: refuses on an active work run alone", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      setWork(h, { status: "ready" });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get()!.n).toBe(0);
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C2: refuses on a held task left by a settled handoff and a resume with no selection (a real state)", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const claimed = await deliverScheduledStart(h.deps, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      recordUsage(h.store, { runId: claimed.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 10, activeMs: 10, attempts: 1, sessions: 1 }, source: { artifactId: `usage-${claimed.runId}`, hash: "e".repeat(64) } });
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(claimed.runId)!.id);
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { requestId, outcome: "settled-recoverable" });
      expect(await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }))).toMatchObject({ result: { kind: "resumed-from-handoff" } });
      // The driver delivers the resume wake that armed: with no selection and no other task it claims nothing.
      expect(await deliverScheduledStart(h.deps, "g")).toEqual({ kind: "idle" });
      // The premise (production state, not written by this test): the held task is the only pending fact.
      expect([h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get()!.n,
        h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1 AND json_extract(body,'$.phase')='work'").get()!.n]).toEqual([0, 0]);
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C3: an active estimate run alone is not execution: start answers estimate-in-flight", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "estimate-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("C3: a clarifying group with a call in flight still answers requirement-not-split", async () => {
    const x = await requirementHarness({ answers: [] });
    try {
      await x.deliver();
      expect(x.runs()).toEqual([expect.objectContaining({ state: "starting", phase: "single-call", active: 1 })]);
      expect(await x.service.start(x.command("start", {}))).toMatchObject({ error: { code: "requirement-not-split" } });
    } finally { await x.dispose(); }
  });

  it("C4: catches a start wake that arrives while the frozen profiles are probed", async () => {
    const { h, service } = await confirmed(); try {
      const original = h.resolveAgent.getMockImplementation()!;
      let injected = false;
      h.resolveAgent.mockImplementation(async (partial) => {
        if (!injected) { injected = true; h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('raced-start','g','start','{}',0)").run(); }
        return original(partial);
      });
      expect(await service.start(h.command("start", {}, "raced"))).toMatchObject({ error: { code: "group-execution-pending" } });
      expect([injected, h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get()!.n]).toEqual([true, 1]);
    } finally { await h.dispose(); }
  });

  it("C6: after retry-task returns the only task to ready, and before any driver round re-arms a wake, start is accepted", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried", taskId: "a" } });
      expect(await t.service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await t.h.dispose(); }
  }, 30_000);
});
