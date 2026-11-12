import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { stepA1, stepA2, write } from "../../src/control/executionDriver.js";
import { liveNotesOf, noteLiveNoteDeliveries, settleLiveNotes } from "../../src/control/liveNotes.js";
import { groupHandoffsDir, readHandoffRecords, UNDELIVERED_NOTES_HEADING } from "../../src/control/taskHandoffs.js";
import { VERB_ACCESS } from "../../src/panel/humanOnly.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";

/**
 * Tester follow-up G Part 5: a note added to a task waits in its queue, reaches the agent only at a phase start through
 * the run's live-notes.json (ccloop reads and acknowledges it), and one the task never received before it ended is marked
 * undelivered and merged into the task's handoff -- never lost, never delivered twice.
 */
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function harness() {
  const t = await driverHarness([{ taskId: "a", loop: loop("a") }]);
  cleanups.push(() => t.h.dispose());
  return t;
}
type T = Awaited<ReturnType<typeof harness>>;
const notes = (t: T) => liveNotesOf(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)));
const rows = (t: T, kind: string) => readGroupActivity(t.h.store, "g", 500).filter((row) => row.kind === kind);
const send = (t: T, text: string, actorId = "human") => t.service.addLiveNote({ ...t.h.taskCommand("add-live-note", "a", { text }), actorId });
const fileOf = (t: T, runId: string) => join(t.body(runId).drive.sourceDir, "live-notes.json");
const settle = (t: T) => settleLiveNotes(t.h.store, (action) => write(t.deps, action));

describe("live notes (Part 5)", { timeout: 60_000 }, () => {
  it("queues a note (any principal, agent:<client> included) and writes it into the running run's live-notes.json 0600", async () => {
    expect(VERB_ACCESS["add-live-note"]).toBe("any");
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    const sent = send(t, "the fixture lives in test/data", "agent:claude");
    if ("error" in sent) throw new Error(JSON.stringify(sent));
    expect(sent.result).toEqual({ kind: "live-note-queued", noteId: sent.commandId, taskId: "a" });
    expect(notes(t)).toEqual([{ noteId: sent.commandId, taskId: "a", text: "the fixture lives in test/data", at: expect.any(Number), by: "agent:claude", state: "queued" }]);
    const file = fileOf(t, runId);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ schema: "orca-live-notes-v1", notes: [{ id: sent.commandId, text: "the fixture lives in test/data", at: new Date(notes(t)[0]!.at).toISOString() }] });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  // mutation M-O4a: the queue check `>= 16` -> `> 16` -> the 17th note is accepted, red
  it("refuses a finished task (live-note-task-finished) and a 17th queued note (live-note-queue-full); 2048 bytes of 'é' pass, 2049 refused", async () => {
    const t = await harness();
    expect(send(t, "é".repeat(1024))).not.toHaveProperty("error");
    // The raw command schema refuses these before any ledger row (the route answers 400).
    expect(() => send(t, `${"é".repeat(1024)}a`)).toThrow();
    expect(() => send(t, "")).toThrow();
    for (let i = 2; i <= 16; i += 1) expect(send(t, `note ${i}`), `note ${i}`).not.toHaveProperty("error");
    expect(send(t, "note 17")).toMatchObject({ error: { code: "live-note-queue-full" } });
    expect(notes(t)).toHaveLength(16);
    const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
    t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "done" }));
    expect(send(t, "too late")).toMatchObject({ error: { code: "live-note-task-finished" } });
  });

  // mutation M-O4f: A2 does not write the run file -> the file is absent after A2, red
  // mutation M-O4b: settle ends a queued note whose task is `ready` or `blocked` too -> the waiting note is undelivered, red
  it("a note for a task that is not running waits and is written into the next run's live-notes.json at its A2", async () => {
    const t = await harness();
    const sent = send(t, "start from the README");
    if ("error" in sent) throw new Error(JSON.stringify(sent));
    expect(settle(t)).toEqual([]);
    expect(notes(t)[0]!.state).toBe("queued");
    const runId = await t.claim();
    // A2 itself writes it (not the driver round's repair pass, which only rewrites an existing run file's queue).
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    expect(JSON.parse(readFileSync(fileOf(t, runId), "utf8")).notes.map((note: { id: string }) => note.id)).toEqual([sent.commandId]);
  });

  // mutation M-O4c: noteLiveNoteDeliveries ignores the note's state -> the repeated report writes a second row, red
  it("collect deliveries mark it delivered with run, phase and attempt, one live-note-delivered row; a repeated report adds nothing", async () => {
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    const sent = send(t, "use v2");
    if ("error" in sent) throw new Error(JSON.stringify(sent));
    const delivered = [{ id: sent.commandId, phase: "execute" as const, attempt: 2, at: "2026-11-12T01:02:03.000Z" }];
    write(t.deps, () => noteLiveNoteDeliveries(t.h.store, { groupId: "g", taskId: "a", runId }, delivered));
    write(t.deps, () => noteLiveNoteDeliveries(t.h.store, { groupId: "g", taskId: "a", runId }, delivered));
    expect(notes(t)[0]).toMatchObject({ state: "delivered", delivered: { runId, phase: "execute", attempt: 2, at: "2026-11-12T01:02:03.000Z" } });
    expect(rows(t, "live-note-delivered").map((row) => [row.runId, row.body])).toEqual([[runId, { noteId: sent.commandId, phase: "execute", attempt: 2 }]]);
    // The run file is left as it was: ccloop already acknowledged the note, so it is never delivered again.
    expect(JSON.parse(readFileSync(fileOf(t, runId), "utf8")).notes).toHaveLength(1);
  });

  // mutation M-O4d: settle skips the merge -> the handoff never names the note, red
  it("a note sent after verify began on a run that then lands ends undelivered, one row, merged into that run's stored handoff", async () => {
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    const sent = send(t, "also update the changelog");
    if ("error" in sent) throw new Error(JSON.stringify(sent));
    // The synthetic ccloop never acknowledges it (verify had begun): the run lands with the note still queued.
    await t.until(t.driver(), () => t.body(runId).state === "settled" && notes(t)[0]!.state !== "queued");
    expect(notes(t)[0]).toMatchObject({ state: "undelivered", endedAt: expect.any(Number), mergedInto: runId });
    expect(rows(t, "live-note-undelivered").map((row) => row.body)).toEqual([{ noteId: sent.commandId }]);
    const handoff = readFileSync(join(groupHandoffsDir(t.h.store.stateDir, "g"), `handoff-a-${runId}.md`), "utf8");
    expect(handoff).toContain(`${UNDELIVERED_NOTES_HEADING}\n- ${new Date(notes(t)[0]!.at).toISOString()}: also update the changelog\n`);
    expect(readHandoffRecords(t.h.store.stateDir, "g")[0]!.notesMerged).toEqual([sent.commandId]);
    // A second pass changes nothing.
    expect(settle(t)).toEqual([]);
    expect(rows(t, "live-note-undelivered")).toHaveLength(1);
  });

  it("archiving the group ends its queued notes undelivered", async () => {
    const t = await harness();
    const sent = send(t, "never ran");
    if ("error" in sent) throw new Error(JSON.stringify(sent));
    const archived = t.service.archiveGroup(t.h.command("archive-group", {}));
    if ("error" in archived) throw new Error(JSON.stringify(archived));
    expect(settle(t)).toEqual(["g"]);
    expect(notes(t)[0]).toMatchObject({ state: "undelivered", mergedInto: null });
    expect(rows(t, "live-note-undelivered")).toHaveLength(1);
  });

  it("settleLiveNotes rewrites a stale run file after a crash between commit and write", async () => {
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    const sent = send(t, "late detail");
    if ("error" in sent) throw new Error(JSON.stringify(sent));
    const file = fileOf(t, runId), good = readFileSync(file, "utf8");
    writeFileSync(file, JSON.stringify({ schema: "orca-live-notes-v1", notes: [] }));
    settle(t);
    expect(readFileSync(file, "utf8")).toBe(good);
  });
});
