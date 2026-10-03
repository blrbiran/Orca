import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { expandRecipe, type LoopSkills } from "../../src/control/loopPlans.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { effectivePlanTask, writeTaskAmendment } from "../../src/control/taskAmendments.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { SyncskillOptions } from "../../src/skills/syncskill.js";
import { change, errorOf, loop, snapshotOf, workAllocation, workBody, writeWork, type Change, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Syncskill integration spec §10.4, §10.5 / §10.8 C13, C15 (plan Task 5). set-task-loop carries the task's skill set:
 * the payload is the full desired state, like `inputs` (a payload without `skills` removes them). A skills-only change
 * is not a no-op, and -- because `skills` is left out of the "kept" comparison -- it keeps a v1 recipe at v1 with the
 * same contract bytes. On a confirmed task it rewrites, adds or removes that task's snapshot entry (a profile is
 * re-resolved through syncskill), dropping the top-level key when no task has skills. Declared skills need syncskill
 * configured, and a lookup failure refuses the command, draft or confirmed, after every existing check.
 */
const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}
/** A fake syncskill (tests/skills/fixtures/fake-syncskill.mjs) answering in `mode`, its argv logged per call. */
async function fakeSyncskill(mode: string) {
  const dir = await tempDir("orca-stl-skills-");
  const bin = join(dir, "syncskill");
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const log = join(dir, "calls.jsonl");
  const o: SyncskillOptions = { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_MODE: mode, FAKE_SYNCSKILL_LOG: log } };
  const calls = (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]) : []);
  return { o, calls };
}
async function fixture(tasks: Parameters<typeof webFixture>[1] = [{ taskId: "a", loop: loop("a") }, { taskId: "c" }]): Promise<Fixture> {
  const h = await webFixture(undefined, tasks);
  cleanups.push(() => h.dispose());
  return h;
}
const serviceOf = (h: Fixture, syncskill?: SyncskillOptions) => new WebControlService(syncskill === undefined ? h.deps : { ...h.deps, syncskill });
/** change() with a skill set in the payload (or none). */
const withSkills = (h: Fixture, taskId: string, c: Change, skills: unknown) => {
  const command = change(h, taskId, c);
  return { ...command, payload: { ...command.payload, ...(skills === undefined ? {} : { skills: skills as LoopSkills }) } };
};
/** The panel's loop plan view of task a: the card sends its `skills` back (C14), so the view must carry them. */
const viewPlan = (h: Fixture) => readControlGroup(h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!.loopPlan!;
const effective = (h: Fixture, taskId = "a") =>
  effectivePlanTask(h.store, "g", readArchivedPlan(h.store, "g").plan.tasks.find((task) => task.taskId === taskId)!, workBody(h, taskId));

/** Gives task a a v1 recipe, as a set-task-loop before v2 existed would have left it (setTaskLoopVersion.test.ts). */
function makeV1(h: Fixture): void {
  const archived = readArchivedPlan(h.store, "g").plan.tasks.find((task) => task.taskId === "a")!;
  const repoPath = JSON.parse(archived.originalContractCanonicalJson).context.repoPath;
  const recipe = { ...archived.loop!, planVersion: 1, chosenBy: "explicit" as const };
  const expanded = expandRecipe("a", repoPath, recipe);
  if (!expanded.ok) throw new Error(expanded.reason);
  writeCanonicalRecord(h.store, "g", expanded.hash, expanded.canonicalJson);
  const amendmentHash = writeTaskAmendment(h.store, "g", { schema: "orca-task-amendment-v1", groupId: "g", taskId: "a", loopVersion: 1,
    previousContractHash: archived.originalContractHash, recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson });
  writeWork(h, "a", { amendmentHash, loopVersion: 1, originalContractHash: expanded.hash, contract: { contentAddressedHash: expanded.hash } });
}

describe("set-task-loop changes a draft task's skill set (C13)", () => {
  it("a skills-only change on a v1 task is accepted, keeps v1 and the contract bytes; the same skills again is a no-op", async () => {
    const h = await fixture();
    const fake = await fakeSyncskill("profile-ok");
    makeV1(h);
    const before = effective(h);
    expect(await serviceOf(h, fake.o).setTaskLoop(withSkills(h, "a", { base: 1 }, { names: ["y", "x", "y"] })))
      .toMatchObject({ result: { kind: "task-loop-set", loopVersion: 2 } });
    const after = effective(h);
    expect(after.loop).toMatchObject({ planVersion: 1, skills: { names: ["x", "y"] } });
    expect(after.originalContractCanonicalJson).toBe(before.originalContractCanonicalJson);
    expect(workBody(h, "a").planChanged).toBeUndefined();
    // Compared normalised: the same set in another order changes nothing.
    expect(errorOf(await serviceOf(h, fake.o).setTaskLoop(withSkills(h, "a", { base: 2 }, { names: ["x", "y"] })))).toMatchObject({ code: "no-op-command" });
    expect(fake.calls()).toEqual([]);
  });

  it("a payload without skills removes them (the payload is the full desired state); no syncskill needed to remove", async () => {
    const h = await fixture([{ taskId: "a", loop: { ...loop("a"), skills: { names: ["x"] } } }]);
    expect(effective(h).loop!.skills).toEqual({ names: ["x"] });
    expect(await serviceOf(h).setTaskLoop(withSkills(h, "a", {}, undefined))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
    expect(Object.keys(effective(h).loop!)).not.toContain("skills");
    expect(Object.keys(viewPlan(h))).not.toContain("skills");
  });

  it("a profile is looked up and stored by name; a profile change is accepted", async () => {
    const h = await fixture();
    const fake = await fakeSyncskill("profile-ok");
    expect(await serviceOf(h, fake.o).setTaskLoop(withSkills(h, "a", {}, { profile: "p" }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(effective(h).loop!.skills).toEqual({ profile: "p" });
    expect(viewPlan(h).skills).toEqual({ profile: "p" });
    expect(fake.calls()).toEqual([["--json", "--no-refresh", "profile", "ls", "p"]]);
  });

  it("refuses names that break the name rule as loop-plan-invalid:skills-shape, whether or not the plan is kept", async () => {
    const h = await fixture();
    const fake = await fakeSyncskill("profile-ok");
    for (const c of [{}, { inputs: { goal: "write a, changed" } }]) {
      expect(errorOf(await serviceOf(h, fake.o).setTaskLoop(withSkills(h, "a", c, { names: ["a,b"] }))))
        .toMatchObject({ code: "loop-plan-invalid", message: "loop-plan-invalid:skills-shape" });
    }
    expect(Object.keys(effective(h).loop!)).not.toContain("skills");
  });

  it("refuses syncskill-unconfigured for declared names, and a lookup failure by name, on a draft task", async () => {
    const h = await fixture();
    for (const syncskill of [undefined, { bin: null, env: {} }]) {
      expect(errorOf(await serviceOf(h, syncskill).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] })))).toMatchObject({ code: "syncskill-unconfigured" });
    }
    const missing = await fakeSyncskill("profile-missing");
    expect(errorOf(await serviceOf(h, missing.o).setTaskLoop(withSkills(h, "a", {}, { profile: "p" }))))
      .toMatchObject({ code: "syncskill-failed", message: "syncskill-failed:E_PROFILE_NOT_FOUND" });
    expect(workBody(h, "a").loopVersion).toBeUndefined();
    expect(Object.keys(effective(h).loop!)).not.toContain("skills");
  });

  it("decides a lookup failure after the existing checks: a stale loop version is named first", async () => {
    const h = await fixture();
    const missing = await fakeSyncskill("profile-missing");
    expect(errorOf(await serviceOf(h, missing.o).setTaskLoop(withSkills(h, "a", { base: 5 }, { profile: "p" })))).toMatchObject({ code: "task-loop-version-conflict" });
    expect(errorOf(await serviceOf(h).setTaskLoop(withSkills(h, "a", { base: 5 }, { names: ["x"] })))).toMatchObject({ code: "task-loop-version-conflict" });
  });
});

describe("set-task-loop on a confirmed task rewrites its snapshot entry (C15)", () => {
  async function confirmed(tasks: Parameters<typeof webFixture>[1], syncskill?: SyncskillOptions) {
    const h = await fixture(tasks);
    const answer = await serviceOf(h, syncskill).confirm(h.command("confirm", await h.confirmPayload()));
    if ("error" in answer) throw new Error(JSON.stringify(answer));
    return h;
  }
  const snapshotHash = (h: Fixture) => readBudgetProposal(h.store, "g").executionSnapshotHash!;

  it("adds, re-resolves, changes and removes the entry; removing the last drops the key and restores the snapshot hash", async () => {
    const h = await confirmed([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    const golden = snapshotHash(h);
    expect(Object.keys(snapshotOf(h))).not.toContain("skills");
    const ok = await fakeSyncskill("profile-ok"), other = await fakeSyncskill("profile-other");
    // Add names.
    expect(await serviceOf(h, ok.o).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: null, names: ["x"] }]);
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: null, names: ["x"] });
    // Change to a profile: its members as syncskill answers them, normalised.
    expect(await serviceOf(h, ok.o).setTaskLoop(withSkills(h, "a", { base: 1 }, { profile: "p" }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: "p", names: ["alpha", "beta"] }]);
    // Change to another profile, re-resolved through the fake.
    expect(await serviceOf(h, other.o).setTaskLoop(withSkills(h, "a", { base: 2 }, { profile: "other" }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: "other", names: ["alpha"] }]);
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: "other", names: ["alpha"] });
    expect(other.calls()).toEqual([["--json", "--no-refresh", "profile", "ls", "other"]]);
    // Remove: the last entry goes, and with it the key -- the snapshot is the one confirmed without skills.
    expect(await serviceOf(h).setTaskLoop(withSkills(h, "a", { base: 3 }, undefined))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(Object.keys(snapshotOf(h))).not.toContain("skills");
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toBe(null);
    expect(snapshotHash(h)).toBe(golden);
  });

  it("keeps the other task's entry, sorted by taskId, when one task's skills are added or removed", async () => {
    const h = await confirmed([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: { ...loop("b"), skills: { names: ["z"] } } }], { bin: "/nonexistent/syncskill", env: {} });
    const ok = await fakeSyncskill("profile-ok");
    expect(await serviceOf(h, ok.o).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: null, names: ["x"] }, { taskId: "b", profile: null, names: ["z"] }]);
    expect(await serviceOf(h).setTaskLoop(withSkills(h, "a", { base: 1 }, undefined))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "b", profile: null, names: ["z"] }]);
    expect(readConfirmedTaskExecution(h.store, "g", "b").skills).toEqual({ profile: null, names: ["z"] });
  });

  it("a lookup failure on a confirmed task refuses the change and leaves the snapshot as it was", async () => {
    const h = await confirmed([{ taskId: "a", loop: loop("a") }]);
    const before = { hash: snapshotHash(h), work: workAllocation(h, "a").amount };
    const missing = await fakeSyncskill("profile-missing");
    expect(errorOf(await serviceOf(h, missing.o).setTaskLoop(withSkills(h, "a", { tokens: before.work.tokens - 1 }, { profile: "p" }))))
      .toMatchObject({ code: "syncskill-failed", message: "syncskill-failed:E_PROFILE_NOT_FOUND" });
    expect(errorOf(await serviceOf(h).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] })))).toMatchObject({ code: "syncskill-unconfigured" });
    expect(snapshotHash(h)).toBe(before.hash);
    expect(workAllocation(h, "a").amount).toEqual(before.work);
  });
});
