/**
 * Multi-directory projects spec §9.4, criterion M13 (review 8): integration checks are opt-in per member. A disabled
 * member runs nothing; an enabled one runs its own command -- or, when the command is null, the de-duplicated union of
 * the group's done tasks' checks for that directory -- through `runIntegrationCheck` at the pre-checked `next`, with
 * `ORCA_PERSON_DIR` the panel's dispatched-person directory. A failure blocks with the command. (Today's caller passes
 * no `rev`; its own tests cover that default.)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { placementRefs } from "../../src/control/dirPlacement.js";
import { multiLandingWorld, type MultiLandingWorld } from "./fixtures/multiLandingWorld.js";

let world: MultiLandingWorld | null = null;
afterEach(async () => { await world?.dispose(); world = null; });

/** A done task whose write set names its directory's checks, as `taskWrites` reads them. */
function addTask(w: MultiLandingWorld, id: string, writes: Array<{ dir: string; checks: string[] }>, status = "done"): void {
  w.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g',?,0,?)").run(id, JSON.stringify({
    kind: "task", status,
    writes: writes.map((write) => ({ dir: write.dir, targetPaths: ["**"], checks: write.checks })),
  }));
}

describe("a multi landing's pre-check checks (§9.4, M13)", () => {
  it("runs nothing for a member whose integration check is disabled", async () => {
    world = await multiLandingWorld();
    const w = world;
    const sentinel = join(w.root, "disabled.txt");
    addTask(w, "a", [{ dir: "local", checks: [`printf ran >> ${sentinel}`] }]);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    expect(existsSync(sentinel)).toBe(false);
    // The landing itself still happened: only the check was skipped.
    expect(w.tipOf(w.local, "refs/heads/main")).not.toBe(w.localMain);
  });

  it("runs the member's command at `next`, with the dispatched-person directory", async () => {
    world = await multiLandingWorld();
    const w = world;
    const sentinel = join(w.root, "enabled.txt");
    w.setCheck("local", true, `printf '%s|%s' "$ORCA_PERSON_DIR" "$(cat local.txt)" > ${sentinel}`);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    // `next` is the merge of the work branch -- the target's own head still says "base" while the check runs.
    expect(readFileSync(sentinel, "utf8")).toBe(`${w.personDir}|landed`);
  });

  it("runs the de-duplicated union of the done tasks' checks when the command is null", async () => {
    world = await multiLandingWorld();
    const w = world;
    const sentinel = join(w.root, "union.txt");
    addTask(w, "a", [
      { dir: "local", checks: [`printf A >> ${sentinel}`, `printf S >> ${sentinel}`] },
      { dir: "remote", checks: [`printf R >> ${sentinel}`] },
    ]);
    addTask(w, "b", [{ dir: "local", checks: [`printf S >> ${sentinel}`, `printf B >> ${sentinel}`] }]);
    w.setCheck("local", true, null);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    // Task order, then contract order, de-duplicated; another member's checks are not this member's.
    expect(readFileSync(sentinel, "utf8")).toBe("ASB");
  });

  it("blocks on a failing command and lands nothing", async () => {
    world = await multiLandingWorld();
    const w = world;
    const sentinel = join(w.root, "failed.txt");
    const command = `printf ran > ${sentinel}; exit 7`;
    w.setCheck("local", true, command);
    await w.settle();
    const record = w.landing();
    expect(record).toMatchObject({ state: "blocked", pending: null, failedKey: "local", reason: "multi-dir-precheck-check-failed:local" });
    expect(record.detail).toContain(command);
    expect(record.detail).toContain("exited 7");
    expect(readFileSync(sentinel, "utf8")).toBe("ran");
    // The check ran before anything landed: no target moved.
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    expect(w.tipOf(w.vault, placementRefs("g").placed)).toBe(w.base);
  });
});
