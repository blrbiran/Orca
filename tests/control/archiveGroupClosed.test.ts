/**
 * Tester #355 (human ruling 2026-11-19 「同意该方案，同意允许互转」): `closed` is the terminal mark's second kind -- the
 * existing `archived` body mark with `kind: "closed"`. Only a done group closes; unclose undoes only a closed mark (unarchive
 * only an archived one); archive on a closed group and close on an archived done group convert the mark. A closed group is
 * frozen exactly as an archived one: no claim, no wake, no integration, out of `orca status`'s work health.
 */
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const body = (h: H) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const writeBody = (h: H, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(value));
const lastSeq = (h: H) => Number(h.store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM activity").get()!.n);
const kindsSince = (h: H, seq: number) => readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind);

/**
 * A confirmed group "g" (ready, no run); `done` marks its task done and its stored status done, as markGroupsDone would
 * (#355 review: the task too, so the group is done as the done pass leaves one, not a done status over open work).
 */
async function group(options: { done?: boolean } = {}) {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  if (options.done === true) {
    for (const row of h.store.db.prepare("SELECT id, body FROM work_items WHERE group_id='g'").all()) {
      const work = JSON.parse(String(row.body)) as Record<string, unknown>;
      if (work.kind === "task") h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...work, status: "done" }), String(row.id));
    }
    writeBody(h, { ...body(h), status: "done" });
  }
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

  // Ruling (2026-11-20, #370): the human approved the read-side plus clear-wakes scope, which extends to close: closing
  // marks a done group's pending start-family wakes delivered (the row stays for audit), so recovery list names no
  // group-archived row for it.
  it("closing clears a pending start wake and keeps the row for audit (#370)", async () => {
    const { h, service } = await group({ done: true });
    try {
      const wakeId = "scheduler-wake:g:queued-start";
      h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?, 'g','start','{}',0)").run(wakeId);
      service.closeGroup(h.command("close-group", {}));
      // mutation: drop the wake-clearing write from applyCloseGroup -> delivered is 0 and recovery names it, red here
      expect(h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(wakeId)).toEqual({ delivered: 1 });
      expect(readControlRecovery(h.store, "e").deferredWakes).toBeUndefined();
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

  // Ruling (2026-11-19 #355 review): this case was "refuses to close while a run is active", on a done group with an
  // active run -- a shape no done group has. The archive refusals close shares are pinned on a real one instead: a flow's
  // child group that finished is its flow's to drive (refuseFlowChild), and close refuses it as archive does.
  it("refuses to close a done flow child, as archive does (flow-child-managed)", async () => {
    const { h, service } = await group({ done: true });
    try {
      writeBody(h, { ...body(h), flow: { role: "child", flowRunId: "fr-1", parentGroupId: "flow-1", stepKey: "to-draft-box", seq: 1, baseCommit: "a".repeat(40), effectRecordId: "eff-1" } });
      // mutation: drop refuseArchive from applyCloseGroup -> the flow child closes, red here
      expect(service.closeGroup(h.command("close-group", {}))).toMatchObject({ error: { code: "flow-child-managed" } });
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });
});

describe("a closed group is frozen as an archived one (tester #355)", () => {
  // Ruling (2026-11-19 #355 review): this case was "claims nothing from a pending start wake ... unclose pauses it", on a
  // done group with a start wake still queued -- a shape no done group has (and a done group has no claimable task, so the
  // claim side said nothing about the mark). It now pins what a real closed group meets: a command of its own is refused by
  // the gate as group-closed, and the unclose of a done group pauses nothing.
  it("refuses a group command on a closed group (group-closed); the unclose pauses nothing", async () => {
    const { h, service } = await group({ done: true });
    try {
      service.closeGroup(h.command("close-group", {}));
      const before = JSON.stringify(body(h));
      // mutation: terminalGateRefusal answers group-archived for both kinds -> red here
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ error: { code: "group-closed" } });
      expect(JSON.stringify(body(h))).toBe(before);
      const unclosed = service.uncloseGroup(h.command("unclose-group", {}));
      if ("error" in unclosed) throw new Error(JSON.stringify(unclosed));
      // mutation: removeTerminalMark pauses whenever it unmarks -> `paused` present and a stop intent, red here
      expect(unclosed.result).toEqual({ kind: "unclosed", groupId: "g" });
      expect(h.store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id='g'").get()).toBeUndefined();
      expect(body(h).stopped).not.toBe(true);
    } finally { await h.dispose(); }
  });
});
