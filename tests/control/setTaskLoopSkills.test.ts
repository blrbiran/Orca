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
import { FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
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
  // Human ruling 2026-10-03 (session 9d95e6c8): skills on a confirmed task need a claude installation, so every task here
  // is frozen with the fixture's claude one unless it names its own.
  const h = await webFixture(undefined, tasks.map(task => ({ agent: { agent: FIXTURE_OTHER_AGENT_ID }, ...task })));
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

  it("a profile on a draft task is stored by name and not looked up (confirm freezes it later)", async () => {
    const h = await fixture();
    const fake = await fakeSyncskill("profile-ok");
    expect(await serviceOf(h, fake.o).setTaskLoop(withSkills(h, "a", {}, { profile: "p" }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(effective(h).loop!.skills).toEqual({ profile: "p" });
    expect(viewPlan(h).skills).toEqual({ profile: "p" });
    expect(fake.calls()).toEqual([]);
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

  it("a draft task needs no syncskill and never asks it: names and a profile are accepted unset, a failing syncskill is not spawned", async () => {
    const h = await fixture();
    expect(await serviceOf(h).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
    expect(await serviceOf(h, { bin: null, env: {} }).setTaskLoop(withSkills(h, "a", { base: 1 }, { profile: "p" }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 2 } });
    const missing = await fakeSyncskill("profile-missing");
    expect(await serviceOf(h, missing.o).setTaskLoop(withSkills(h, "a", { base: 2 }, { profile: "q" }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 3 } });
    expect(effective(h).loop!.skills).toEqual({ profile: "q" });
    expect(missing.calls()).toEqual([]);
  });
});

/**
 * Human ruling 2026-10-03 (session 9d95e6c8): skills on a confirmed task need its frozen installation to be claude, by
 * ccloop's table view, so set-task-loop refuses them there rather than leave a run ccloop refuses at start. A draft task
 * has no frozen installation yet: confirm checks it.
 */
describe("set-task-loop refuses skills on an installation that is not claude", () => {
  const CODEX = { agent: "codex" };
  it("refuses skills added to a confirmed codex task, leaving the task and its snapshot as they were", async () => {
    const h = await fixture([{ taskId: "a", agent: CODEX, loop: loop("a") }]);
    const answer = await serviceOf(h).confirm(h.command("confirm", await h.confirmPayload()));
    if ("error" in answer) throw new Error(JSON.stringify(answer));
    const before = readBudgetProposal(h.store, "g").executionSnapshotHash;
    const ok = await fakeSyncskill("profile-ok");
    expect(errorOf(await serviceOf(h, ok.o).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] }))))
      .toMatchObject({ code: "skills-unsupported-agent", message: "skills-unsupported-agent:a:codex:codex" });
    expect(readBudgetProposal(h.store, "g").executionSnapshotHash).toBe(before);
    expect(effective(h).loop!.skills).toBeUndefined();
  });

  it("accepts skills on a draft codex task, which confirm then refuses", async () => {
    const h = await fixture([{ taskId: "a", agent: CODEX, loop: loop("a") }]);
    const ok = await fakeSyncskill("profile-ok");
    expect(await serviceOf(h, ok.o).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(errorOf(await serviceOf(h, ok.o).confirm(h.command("confirm", await h.confirmPayload()))))
      .toMatchObject({ code: "skills-unsupported-agent", message: "skills-unsupported-agent:a:codex:codex" });
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

  it("a lookup failure on a confirmed task refuses the change and leaves the snapshot as it was; names need no lookup", async () => {
    const h = await confirmed([{ taskId: "a", loop: loop("a") }]);
    const before = { hash: snapshotHash(h), work: workAllocation(h, "a").amount };
    const missing = await fakeSyncskill("profile-missing");
    expect(errorOf(await serviceOf(h, missing.o).setTaskLoop(withSkills(h, "a", { tokens: before.work.tokens - 1 }, { profile: "p" }))))
      .toMatchObject({ code: "syncskill-failed", message: "syncskill-failed:E_PROFILE_NOT_FOUND" });
    for (const syncskill of [undefined, { bin: null, env: {} }]) {
      expect(errorOf(await serviceOf(h, syncskill).setTaskLoop(withSkills(h, "a", {}, { profile: "p" })))).toMatchObject({ code: "syncskill-unconfigured" });
    }
    expect(snapshotHash(h)).toBe(before.hash);
    expect(workAllocation(h, "a").amount).toEqual(before.work);
    // Names are taken as declared: no lookup, so no spawn -- but syncskill must be configured (final review N1, below).
    const ok = await fakeSyncskill("profile-ok");
    expect(await serviceOf(h, ok.o).setTaskLoop(withSkills(h, "a", {}, { names: ["x"] }))).toMatchObject({ result: { kind: "task-loop-set" } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: null, names: ["x"] }]);
    expect(ok.calls()).toEqual([]);
  });

  // Final review N1: confirm refuses any declared skills with ORCA_SYNCSKILL_BIN unset (the run would fail at A2 with
  // skills-inject-failed:syncskill-unconfigured), so set-task-loop on a confirmed task must refuse a changed declaration
  // the same way -- names included, which need no lookup and so were let through before.
  it("refuses a changed declaration (names or profile) unset as syncskill-unconfigured and leaves the task as it was", async () => {
    const h = await confirmed([{ taskId: "a", loop: { ...loop("a"), skills: { names: ["x"] } } }], { bin: "/nonexistent/syncskill", env: {} });
    const before = { hash: snapshotHash(h), work: workAllocation(h, "a").amount, loopVersion: workBody(h, "a").loopVersion };
    for (const syncskill of [undefined, { bin: null, env: {} }]) {
      for (const skills of [{ names: ["y"] }, { names: ["x", "y"] }, { profile: "p" }]) {
        expect(errorOf(await serviceOf(h, syncskill).setTaskLoop(withSkills(h, "a", {}, skills)))).toMatchObject({ code: "syncskill-unconfigured" });
      }
    }
    expect(snapshotHash(h)).toBe(before.hash);
    expect(workAllocation(h, "a").amount).toEqual(before.work);
    expect(workBody(h, "a").loopVersion).toBe(before.loopVersion);
    expect(effective(h).loop!.skills).toEqual({ names: ["x"] });
    // Unchanged (a budget-only edit) and removed stay accepted unset.
    expect(await serviceOf(h).setTaskLoop(withSkills(h, "a", { tokens: before.work.tokens - 1 }, { names: ["x"] }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: null, names: ["x"] }]);
    expect(await serviceOf(h).setTaskLoop(withSkills(h, "a", { base: 1 }, undefined))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 2 } });
    expect(Object.keys(snapshotOf(h))).not.toContain("skills");
  });

  it("decides a lookup failure after the existing checks: a stale loop version is named first", async () => {
    const h = await confirmed([{ taskId: "a", loop: loop("a") }]);
    const missing = await fakeSyncskill("profile-missing");
    expect(errorOf(await serviceOf(h, missing.o).setTaskLoop(withSkills(h, "a", { base: 5 }, { profile: "p" })))).toMatchObject({ code: "task-loop-version-conflict" });
    expect(errorOf(await serviceOf(h).setTaskLoop(withSkills(h, "a", { base: 5 }, { profile: "p" })))).toMatchObject({ code: "task-loop-version-conflict" });
  });
});

describe("an unchanged declaration keeps its frozen entry (H3)", () => {
  /** Task a confirmed with profile p frozen as ["alpha"] (the fake's waits-for-stdin answer). */
  async function frozenProfile() {
    const first = await fakeSyncskill("waits-for-stdin");
    const h = await fixture([{ taskId: "a", loop: { ...loop("a"), skills: { profile: "p" } } }]);
    const answer = await serviceOf(h, first.o).confirm(h.command("confirm", await h.confirmPayload()));
    if ("error" in answer) throw new Error(JSON.stringify(answer));
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: "p", names: ["alpha"] }]);
    return h;
  }

  it("a budget-only edit sending the same profile keeps the frozen names and spawns nothing, though syncskill now answers otherwise", async () => {
    const h = await frozenProfile();
    const now = await fakeSyncskill("profile-ok"); // would answer ["alpha", "beta"]
    expect(await serviceOf(h, now.o).setTaskLoop(withSkills(h, "a", { tokens: workAllocation(h, "a").amount.tokens - 1 }, { profile: "p" })))
      .toMatchObject({ result: { kind: "task-loop-set" } });
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: "p", names: ["alpha"] }]);
    expect(readConfirmedTaskExecution(h.store, "g", "a").skills).toEqual({ profile: "p", names: ["alpha"] });
    expect(now.calls()).toEqual([]);
  });

  it("the same budget-only edit is accepted with ORCA_SYNCSKILL_BIN unset", async () => {
    const h = await frozenProfile();
    for (const [i, syncskill] of [undefined, { bin: null, env: {} }].entries()) {
      expect(await serviceOf(h, syncskill).setTaskLoop(withSkills(h, "a", { base: i, tokens: workAllocation(h, "a").amount.tokens - 1 }, { profile: "p" })))
        .toMatchObject({ result: { kind: "task-loop-set", loopVersion: i + 1 } });
    }
    expect(snapshotOf(h).skills).toEqual([{ taskId: "a", profile: "p", names: ["alpha"] }]);
  });

  it("a task read as a draft but confirmed before the transaction refuses a changed profile as proposal-version-conflict", async () => {
    const h = await fixture([{ taskId: "a", loop: loop("a") }]);
    const answer = await serviceOf(h).confirm(h.command("confirm", await h.confirmPayload()));
    if ("error" in answer) throw new Error(JSON.stringify(answer));
    const row = h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body;
    const fake = await fakeSyncskill("profile-ok");
    const command = withSkills(h, "a", {}, { profile: "p" });
    // The pre-transaction read happens synchronously in the call: it sees a draft, then the confirmed body is put back.
    h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(JSON.stringify({ ...JSON.parse(String(row)), state: "editable" }));
    const pending = serviceOf(h, fake.o).setTaskLoop(command);
    h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(row);
    expect(errorOf(await pending)).toMatchObject({ code: "proposal-version-conflict" });
    expect(fake.calls()).toEqual([]);
    expect(Object.keys(snapshotOf(h))).not.toContain("skills");
  });
});
