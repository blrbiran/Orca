// Ownership: Codex implement_archived_wakes, 2026-10-09; baseline 63d9e9b (performance Task 2).
import { describe, expect, it } from "vitest";
import { createGroup } from "../../src/control/commands.js";
import { deliverSchedulerWakes, type SchedulerWakeKind, type WakeHandlers } from "../../src/control/dispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { createWebWakeHandlers, deliverScheduledStart, nextClaimableTask } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { installControlReadCounters, type ReadCounters } from "./fixtures/controlReadCounters.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { amount } from "./fixtures/store.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const bodyOf = (h: H) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const writeBody = (h: H, body: unknown) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
const wake = (h: H, id: string, kind: SchedulerWakeKind, groupId = "g", body: unknown = { groupId, startRevision: 1 }) =>
  h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,?,?,0)").run(id, groupId, kind, JSON.stringify(body));
const pending = (h: H) => h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE delivered=0 ORDER BY rowid").all().map(row => String(row.id));
const active = (h: H) => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE active=1").get()!.n);
const groupGets = (counts: ReadCounters) => counts.executions.filter(e => e.method === "get" && /^SELECT body FROM groups WHERE id=\?$/i.test(e.sql)).length;
async function started() {
  const h = await webFixture(profileSnapshot());
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  h.store.db.prepare("DELETE FROM scheduler_wakes WHERE kind='budget-estimate'").run();
  return { h, service };
}
function countedHandlers(h: H, service: WebControlService, duringProbe?: () => void) {
  let probes = 0, calls = 0;
  const router = h.deps.profileRouter;
  const profileRouter = { ...router, probe: async (...args: Parameters<typeof router.probe>) => {
    probes++; if (probes === 1) duringProbe?.(); return router.probe(...args);
  } };
  const actual = createWebWakeHandlers({ ...h.deps, profileRouter, service });
  const handlers: WakeHandlers = {};
  for (const [kind, handler] of Object.entries(actual)) handlers[kind as SchedulerWakeKind] = async w => { calls++; return handler!(w); };
  return { handlers, calls: () => calls, probes: () => probes };
}

describe("archived wake performance at actual entry points", () => {
  // Deleting the driver's body argument must restore its extra group lookup and parse.
  it("replenishes from one parsed group body with no extra archive lookup", async () => {
    const { h, service } = await started();
    h.store.db.prepare("UPDATE scheduler_wakes SET delivered=1").run();
    const counter = installControlReadCounters(h.store);
    try {
      expect(replenishStartWakes(h.deps)).toEqual(["drive:g:1"]);
      expect(counter.snapshot().groupParses.get("groups:g")).toBe(1);
      expect(groupGets(counter.snapshot())).toBe(0);
      counter.reset();
      expect(replenishStartWakes(h.deps)).toEqual([]);
      expect(counter.snapshot().groupParses.get("groups:g")).toBe(1);
      expect(groupGets(counter.snapshot())).toBe(0);
      service.archiveGroup(h.command("archive-group", {}));
      h.store.db.prepare("UPDATE scheduler_wakes SET delivered=1").run();
      counter.reset();
      expect(replenishStartWakes(h.deps)).toEqual([]);
      expect(counter.snapshot().groupParses.get("groups:g")).toBe(1);
      expect(groupGets(counter.snapshot())).toBe(0);
    } finally { counter.restore(); await h.dispose(); }
  });

  // The pump, rather than a fake handler, must remove all 300 unnecessary authority entries.
  it("defers 100 archived groups with three wakes for three pumps, one lookup and parse per group", async () => {
    const { h, service } = await started();
    try {
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      for (let n = 0; n < 100; n++) {
        const groupId = n === 0 ? "g" : `archive-${n}`;
        if (n > 0) createGroup(h.store, { groupId, projectKey: "fixture/repo", goal: "ship", successConditions: ["checks"], budgetMode: "strict", limit: amount(100), reviewReserve: amount(1), deadlineAt: null }, { commandId: `create-${n}`, expectedRevision: 0, by: "human" });
        const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision);
        expect(service.archiveGroup(h.rawCommand(`archive-${n}`, revision, "archive-group", { kind: "group", groupId }, {}) as never)).toMatchObject({ result: { kind: "archived" } });
        for (const kind of ["start", "no-start", "resume"] as const) wake(h, `${groupId}:${kind}`, kind, groupId);
      }
      const ids = pending(h), target = countedHandlers(h, service), counter = installControlReadCounters(h.store);
      try {
        for (let pump = 0; pump < 3; pump++) {
          counter.reset();
          expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
          const counts = counter.snapshot();
          expect(target.calls()).toBe(0);
          expect(target.probes()).toBe(0);
          expect(h.accept).not.toHaveBeenCalled();
          expect(groupGets(counts)).toBe(100);
          for (let n = 0; n < 100; n++) expect(counts.groupParses.get(`groups:${n === 0 ? "g" : `archive-${n}`}`)).toBe(1);
          expect(pending(h)).toEqual(ids);
          expect(counts.prepares.filter(p => p.sql === "SELECT body FROM groups WHERE id=?")).toHaveLength(pump === 0 ? 1 : 0);
        }
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });

  it("retains optional-body and default authority results at the original archive check", async () => {
    const { h, service } = await started();
    const counter = installControlReadCounters(h.store);
    try {
      const body = bodyOf(h);
      counter.reset();
      expect(nextClaimableTask(h.store, "g", body)).toEqual({ workItemId: "a" });
      expect(groupGets(counter.snapshot())).toBe(0);
      counter.reset();
      expect(nextClaimableTask(h.store, "g")).toEqual({ workItemId: "a" });
      expect(groupGets(counter.snapshot())).toBe(1);
      service.archiveGroup(h.command("archive-group", {}));
      const archived = bodyOf(h);
      counter.reset();
      expect(nextClaimableTask(h.store, "g", archived)).toBeNull();
      expect(groupGets(counter.snapshot())).toBe(0);
      expect(() => nextClaimableTask(h.store, "g", { ...body, archived: null })).toThrow("group-archived-invalid");
    } finally { counter.restore(); await h.dispose(); }
  });

  // A bad wake has no await; all three archived wakes remain in the same synchronous segment.
  it("parses an archived group once across a malformed live wake without entering its handler", async () => {
    const { h, service } = await started();
    try {
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      service.archiveGroup(h.command("archive-group", {}));
      wake(h, "archived-first", "start");
      wake(h, "malformed", "budget-estimate");
      h.store.db.prepare("UPDATE scheduler_wakes SET body='{' WHERE id='malformed'").run();
      wake(h, "archived-next", "no-start"); wake(h, "archived-last", "resume");
      const ids = pending(h), target = countedHandlers(h, service), counter = installControlReadCounters(h.store);
      try {
        expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
        expect(target.calls()).toBe(0); expect(groupGets(counter.snapshot())).toBe(1);
        expect(counter.snapshot().groupParses.get("groups:g")).toBe(1);
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });

  // One actual (non-start) handler await splits this archived group into two segments.
  it("counts two archive reads across one actual estimate handler await in a mixed pump", async () => {
    const { h, service } = await started();
    try {
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      service.archiveGroup(h.command("archive-group", {}));
      wake(h, "archived-first", "start");
      wake(h, "estimate", "budget-estimate", "g", { estimateId: h.estimateId });
      wake(h, "archived-next", "no-start"); wake(h, "archived-last", "resume");
      const ids = pending(h), target = countedHandlers(h, service), counter = installControlReadCounters(h.store);
      try {
        expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
        const counts = counter.snapshot();
        expect(target.calls()).toBe(1); expect(target.probes()).toBe(0);
        // The estimate authority independently reads its group and archive mark (two additional reads).
        expect(groupGets(counts)).toBe(4); expect(counts.groupParses.get("groups:g")).toBe(4);
        expect(counts.prepares.filter(p => p.sql === "SELECT body FROM groups WHERE id=?")).toHaveLength(3);
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });

  // Retaining business objects across pumps would miss the unarchive command.
  it("delivers on the first pump after a real unarchive command", async () => {
    const { h, service } = await started();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const ids = pending(h), target = countedHandlers(h, service);
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
      expect(target.calls()).toBe(0);
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived" } });
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: ids, deferred: [] });
      expect(target.calls()).toBe(1); expect(target.probes()).toBeGreaterThan(0); expect(active(h)).toBe(1);
    } finally { await h.dispose(); }
  });

  // All handler outcomes yield; cached marks from before the await must be discarded.
  it.each(["true", "false", "throw"] as const)("sees same-pump unarchive after an awaited handler returns %s", async result => {
    const { h, service } = await started();
    try {
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      wake(h, "first-archived", "no-start"); wake(h, "update", "budget-estimate"); wake(h, "last-start", "start");
      service.archiveGroup(h.command("archive-group", {}));
      const target = countedHandlers(h, service);
      target.handlers["budget-estimate"] = async () => {
        await Promise.resolve();
        expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived" } });
        if (result === "throw") throw new Error("isolated-handler-error");
        return result === "true";
      };
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: result === "true" ? ["update", "last-start"] : ["last-start"], deferred: result === "true" ? ["first-archived"] : ["first-archived", "update"] });
      expect(target.calls()).toBe(1); expect(active(h)).toBe(1);
    } finally { await h.dispose(); }
  });

  it.each(["true", "false", "throw"] as const)("sees same-pump archive after an awaited handler returns %s", async result => {
    const { h, service } = await started();
    try {
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      wake(h, "update", "resume"); wake(h, "last-start", "start");
      const target = countedHandlers(h, service);
      target.handlers.resume = async () => {
        await Promise.resolve();
        expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
        if (result === "throw") throw new Error("isolated-handler-error");
        return result === "true";
      };
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: result === "true" ? ["update"] : [], deferred: result === "true" ? ["last-start"] : ["update", "last-start"] });
      expect(target.calls()).toBe(0); expect(target.probes()).toBe(0); expect(active(h)).toBe(0);
    } finally { await h.dispose(); }
  });

  it("keeps the final claim transaction archive guard when the probe awaits", async () => {
    const { h, service } = await started();
    try {
      const ids = pending(h), target = countedHandlers(h, service, () => {
        expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
      });
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
      expect(target.calls()).toBe(1); expect(target.probes()).toBeGreaterThan(0);
      expect(active(h)).toBe(0); expect(pending(h)).toEqual(ids);
      expect(await deliverScheduledStart(h.deps, "g")).toEqual({ kind: "blocked", reason: "group-archived" });
    } finally { await h.dispose(); }
  });

  // Unknown states must reach the strict authority, never masquerade as archived filter hits.
  it.each([{ mark: null }, { mark: "yes" }, { mark: [] }, { mark: { at: 1 } }, { mark: { at: 1, actor: "human", extra: true } }])("keeps invalid mark %j visible to each actual start authority", async ({ mark }) => {
    const { h, service } = await started();
    try {
      const original = bodyOf(h), target = countedHandlers(h, service);
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      for (const kind of ["start", "no-start", "resume"] as const) wake(h, `invalid:${kind}`, kind);
      writeBody(h, { ...original, archived: mark });
      const ids = pending(h);
      await expect(deliverScheduledStart(h.deps, "g")).rejects.toMatchObject({ code: "recovery-blocked", detail: "group-archived-invalid" });
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
      expect(target.calls()).toBe(3); expect(target.probes()).toBe(0); expect(active(h)).toBe(0); expect(pending(h)).toEqual(ids);
    } finally { await h.dispose(); }
  });

  it("keeps malformed group JSON visible to actual handlers and pending", async () => {
    const { h, service } = await started();
    try {
      const target = countedHandlers(h, service);
      h.store.db.prepare("UPDATE groups SET body='{' WHERE id='g'").run();
      const ids = pending(h);
      await expect(deliverScheduledStart(h.deps, "g")).rejects.toBeInstanceOf(SyntaxError);
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ids });
      expect(target.calls()).toBe(1); expect(target.probes()).toBe(0); expect(active(h)).toBe(0);
    } finally { await h.dispose(); }
  });

  it("does not share prepared archive lookups between stores", async () => {
    const first = await started(), second = await started();
    try {
      first.service.archiveGroup(first.h.command("archive-group", {}));
      const blocked = countedHandlers(first.h, first.service), live = countedHandlers(second.h, second.service);
      expect((await deliverSchedulerWakes(first.h.store, blocked.handlers)).delivered).toEqual([]);
      const ids = pending(second.h);
      expect(await deliverSchedulerWakes(second.h.store, live.handlers)).toEqual({ delivered: ids, deferred: [] });
      expect(blocked.calls()).toBe(0); expect(active(first.h)).toBe(0); expect(active(second.h)).toBe(1);
    } finally { await first.h.dispose(); await second.h.dispose(); }
  });

  it.each(["global", "missing-handler", "group"] as const)("keeps %s blocker ahead of archive parsing and wake decoding", async blocker => {
    const { h, service } = await started();
    try {
      const target = countedHandlers(h, service), ids = pending(h);
      h.store.db.prepare("UPDATE groups SET body='{' WHERE id='g'").run();
      h.store.db.prepare("UPDATE scheduler_wakes SET body='{' WHERE delivered=0").run();
      if (blocker === "global") h.store.dispatchBlocked = true;
      if (blocker === "group") h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('blocked','g',NULL,'group','fixture','{}')").run();
      const counter = installControlReadCounters(h.store);
      try {
        expect(await deliverSchedulerWakes(h.store, blocker === "missing-handler" ? {} : target.handlers)).toEqual({ delivered: [], deferred: ids });
        expect(groupGets(counter.snapshot())).toBe(0); expect(counter.snapshot().parses.size).toBe(0); expect(counter.snapshot().groupParses.size).toBe(0); expect(target.calls()).toBe(0);
      } finally { counter.restore(); }
    } finally { await h.dispose(); }
  });

  it("keeps estimate and requirement handlers on their original paths for archived groups", async () => {
    const { h, service } = await started();
    try {
      h.store.db.prepare("DELETE FROM scheduler_wakes").run();
      wake(h, "estimate", "budget-estimate", "g", { estimateId: h.estimateId });
      wake(h, "requirement", "requirement-call"); wake(h, "export", "requirement-export");
      service.archiveGroup(h.command("archive-group", {}));
      const target = countedHandlers(h, service);
      expect(await deliverSchedulerWakes(h.store, target.handlers)).toEqual({ delivered: [], deferred: ["estimate", "requirement", "export"] });
      expect(target.calls()).toBe(2); expect(target.probes()).toBe(0);
      expect(h.store.db.prepare("SELECT state FROM estimates WHERE id=?").get(h.estimateId)!.state).toBe("queued");
    } finally { await h.dispose(); }
  });
});
