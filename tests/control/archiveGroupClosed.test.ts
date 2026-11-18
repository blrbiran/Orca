/**
 * Tester #355 (human ruling 2026-11-19 「同意该方案，同意允许互转」): `closed` is the terminal mark's second kind -- the
 * existing `archived` body mark with `kind: "closed"`. Only a done group closes; unclose undoes only a closed mark (unarchive
 * only an archived one); archive on a closed group and close on an archived done group convert the mark. A closed group is
 * frozen exactly as an archived one: no claim, no wake, no integration, out of `orca status`'s work health.
 */
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { deliverScheduledStart, nextClaimableTask } from "../../src/control/webDispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const body = (h: H) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const writeBody = (h: H, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(value));
const lastSeq = (h: H) => Number(h.store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM activity").get()!.n);
const kindsSince = (h: H, seq: number) => readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });

/** A confirmed group "g" (ready, no run); `done` sets its stored status to done, as markGroupsDone would. */
async function group(options: { done?: boolean } = {}) {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  if (options.done === true) writeBody(h, { ...body(h), status: "done" });
  return { h, service };
}

describe("close-group and unclose-group (tester #355)", () => {
  it("closes a done group: the mark says closed, when and by whom; the summary says archived with kind closed; a closed row", async () => {
    const { h, service } = await group({ done: true });
    try {
      const seq = lastSeq(h);
      const result = service.closeGroup(h.command("close-group", {}));
      if ("error" in result || result.result.kind !== "closed") throw new Error(JSON.stringify(result));
      // mutation: write the mark without `kind` -> reads archived, red here and below
      expect(body(h).archived).toEqual({ at: result.result.at, actor: "human", kind: "closed" });
      expect(body(h).status).toBe("done");
      const summary = readGroupSummary(h.store, "g");
      expect([summary.archived, summary.archiveKind]).toEqual([true, "closed"]);
      expect(kindsSince(h, seq)).toContain("closed");
      expect(isGroupArchived(h.store, "g")).toBe(true);
    } finally { await h.dispose(); }
  });

  it("an archived group's summary says kind archived; a group with no mark has no kind", async () => {
    const { h, service } = await group();
    try {
      expect(Object.hasOwn(readGroupSummary(h.store, "g"), "archiveKind")).toBe(false);
      service.archiveGroup(h.command("archive-group", {}));
      // mutation: project archiveKind only for closed -> undefined here, red
      expect(readGroupSummary(h.store, "g").archiveKind).toBe("archived");
    } finally { await h.dispose(); }
  });

  it("refuses to close a group that is not done (group-not-done) and changes nothing", async () => {
    const { h, service } = await group();
    try {
      const before = JSON.stringify(body(h));
      // mutation: drop the status guard in applyCloseGroup -> the ready group closes, red here
      expect(service.closeGroup(h.command("close-group", {}))).toMatchObject({ error: { code: "group-not-done" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  it("unclose removes the mark and writes an unclosed row; the group is done and listed again", async () => {
    const { h, service } = await group({ done: true });
    try {
      service.closeGroup(h.command("close-group", {}));
      const seq = lastSeq(h);
      const result = service.uncloseGroup(h.command("unclose-group", {}));
      if ("error" in result || result.result.kind !== "unclosed") throw new Error(JSON.stringify(result));
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
      expect(body(h).status).toBe("done");
      expect(kindsSince(h, seq)).toEqual(expect.arrayContaining(["unclosed"]));
      expect(kindsSince(h, seq)).not.toContain("unarchived");
      expect(readGroupSummary(h.store, "g").archived).toBe(false);
      // A group that is not closed: nothing to undo.
      expect(service.uncloseGroup(h.command("unclose-group", {}))).toMatchObject({ error: { code: "no-op-command" } });
    } finally { await h.dispose(); }
  });

  it("refuses to unclose an archived group (group-archived): unclose undoes only a closed mark", async () => {
    const { h, service } = await group({ done: true });
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const before = JSON.stringify(body(h));
      // mutation: the gate admits unclose-group on an archived group -> removeTerminalMark answers no-op-command, red here
      expect(service.uncloseGroup(h.command("unclose-group", {}))).toMatchObject({ error: { code: "group-archived" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  it("converts both ways: archive on a closed group makes it archived; close on an archived done group makes it closed", async () => {
    const { h, service } = await group({ done: true });
    try {
      service.closeGroup(h.command("close-group", {}));
      // mutation: drop archive-group from the closed kind's admitted verbs -> group-closed, red here
      const archived = service.archiveGroup(h.command("archive-group", {}));
      if ("error" in archived) throw new Error(JSON.stringify(archived));
      expect(body(h).archived).toEqual({ at: archived.result.kind === "archived" ? archived.result.at : -1, actor: "human" });
      expect(readGroupSummary(h.store, "g").archiveKind).toBe("archived");
      // mutation: drop close-group from the archived kind's admitted verbs -> group-archived, red here
      const closed = service.closeGroup(h.command("close-group", {}));
      if ("error" in closed || closed.result.kind !== "closed") throw new Error(JSON.stringify(closed));
      expect(body(h).archived).toEqual({ at: closed.result.at, actor: "human", kind: "closed" });
      expect(readGroupSummary(h.store, "g").archiveKind).toBe("closed");
    } finally { await h.dispose(); }
  });

  it("refuses to close an archived group that is not done (group-not-done), keeping it archived", async () => {
    const { h, service } = await group();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const before = JSON.stringify(body(h));
      expect(service.closeGroup(h.command("close-group", {}))).toMatchObject({ error: { code: "group-not-done" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  it("refuses to close while a run is active, as archive does (archive-run-active)", async () => {
    const { h, service } = await group();
    try {
      await service.start(h.command("start", {}));
      const outcome = await deliverScheduledStart(dispatch(h), "g");
      if (outcome.kind !== "claimed") throw new Error(JSON.stringify(outcome));
      writeBody(h, { ...body(h), status: "done" });
      // mutation: drop refuseArchive from applyCloseGroup -> the group closes with a run in motion, red here
      expect(service.closeGroup(h.command("close-group", {}))).toMatchObject({ error: { code: "archive-run-active" } });
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });
});

describe("a closed group is frozen as an archived one (tester #355)", () => {
  const pending = (h: H) => h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all().map((row) => String(row.id));

  it("claims nothing from a pending start wake and offers no claimable task while closed; unclose pauses it (#370 rule)", async () => {
    const { h, service } = await group();
    try {
      await service.start(h.command("start", {}));
      const wakes = pending(h);
      expect(wakes).toHaveLength(1);
      // A done group with a start wake still queued: unusual, but the freeze must not depend on the status.
      writeBody(h, { ...body(h), status: "done" });
      service.closeGroup(h.command("close-group", {}));
      // mutation: isGroupArchived answers only for a mark without kind -> the claim goes through, red here
      expect(await deliverScheduledStart(dispatch(h), "g")).toEqual({ kind: "blocked", reason: "group-archived" });
      expect(pending(h)).toEqual(wakes);
      expect(nextClaimableTask(h.store, "g")).toBeNull();
      expect(replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate })).toEqual([]);
      // The queued start would run on its own once unclosed, so the unclose pauses the group (wouldRunOnUnarchive).
      // mutation: removeTerminalMark skips wouldRunOnUnarchive for closed -> no `paused`, red here
      expect(service.uncloseGroup(h.command("unclose-group", {}))).toMatchObject({ result: { kind: "unclosed", paused: true } });
      expect(pending(h)).toEqual(wakes);
    } finally { await h.dispose(); }
  });
});
