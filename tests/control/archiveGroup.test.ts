import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { lookupCommandResult, updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertClarifyingGroup, newRound, writeRound } from "../../src/control/requirementRecords.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "./fixtures/requirement.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { WebFixtureTask } from "./fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const body = (h: H, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const writeBody = (h: H, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(value));
const revisionOf = (h: H, id = "g") => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });
const lastSeq = (h: H) => Number(h.store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM activity").get()!.n);

/** A confirmed group "g": ready, no run, its import estimate still queued (queued is not in flight). */
async function confirmed(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

async function claimed(h: H, service: WebControlService): Promise<string> {
  await service.start(h.command("start", {}));
  const outcome = await deliverScheduledStart(dispatch(h), "g");
  if (outcome.kind !== "claimed") throw new Error(JSON.stringify(outcome));
  return outcome.runId;
}

describe("archive-group and unarchive-group (issue-fixes spec §6.3)", () => {
  it("archives an idle group: the body says when and by whom, the summary says archived, and an archived row is written", async () => {
    const { h, service } = await confirmed();
    try {
      const before = Date.now(), seq = lastSeq(h);
      const result = service.archiveGroup(h.command("archive-group", {}));
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(result.result.groupId).toBe("g");
      expect(body(h).archived).toEqual({ at: result.result.at, actor: "human" });
      expect(result.result.at).toBeGreaterThanOrEqual(before);
      expect(result.result.at).toBeLessThanOrEqual(Date.now());
      expect(readGroupSummary(h.store, "g").archived).toBe(true);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("archived");
    } finally { await h.dispose(); }
  });

  it("unarchive removes the mark and writes an unarchived row; unarchiving a group that is not archived is a no-op refusal", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const seq = lastSeq(h);
      const result = service.unarchiveGroup(h.command("unarchive-group", {}));
      if ("error" in result || result.result.kind !== "unarchived") throw new Error(JSON.stringify(result));
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
      expect(readGroupSummary(h.store, "g").archived).toBe(false);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("unarchived");
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ error: { code: "no-op-command" } });
    } finally { await h.dispose(); }
  });

  it("archives under a pause with no active run, and under a handoff stop that is complete", async () => {
    const paused = await confirmed();
    try {
      await paused.service.pauseDispatch(paused.h.command("pause-dispatch", {}));
      expect(paused.service.archiveGroup(paused.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await paused.h.dispose(); }
    const handedOff = await confirmed();
    try {
      await handedOff.service.handoffStop(handedOff.h.command("handoff-stop", {}));
      expect(groupStopState(handedOff.h.store, "g")).toBe("handoff-complete");
      expect(handedOff.service.archiveGroup(handedOff.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await handedOff.h.dispose(); }
  });

  it("refuses while a run is active: archive-run-active", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-run-active" } });
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("refuses while a handoff stop is still settling: archive-stop-pending (ahead of the run it waits for)", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(groupStopState(h.store, "g")).not.toBe("handoff-complete");
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-stop-pending" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an agent resolves the integration: archive-integration-resolving", async () => {
    const { h, service } = await confirmed();
    try {
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      writeBody(h, { ...body(h), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "resolving" } });
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-integration-resolving" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an estimate is in flight: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.db.prepare("UPDATE estimates SET state='running' WHERE group_id='g'").run();
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:estimate" } });
    } finally { await h.dispose(); }
  });

  it("refuses while a requirement call is waiting: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
        writeRound(h.store, "r", newRound(1));
      });
      const command = h.rawCommand("archive-r", revisionOf(h, "r"), "archive-group", { kind: "group", groupId: "r" }, {}) as never;
      expect(service.archiveGroup(command)).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:requirement" } });
      expect(lookupCommandResult(h.store, "r", "archive-r")!.body).toMatchObject({ error: { code: "archive-call-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("blocks by name on an archive mark that does not parse", async () => {
    const { h } = await confirmed();
    try {
      writeBody(h, { ...body(h), archived: "yes" });
      expect(() => isGroupArchived(h.store, "g")).toThrow(ControlError);
      expect(() => isGroupArchived(h.store, "g")).toThrow(/group-archived-invalid/);
    } finally { await h.dispose(); }
  });
});
