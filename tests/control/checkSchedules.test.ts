import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCheckState, writeCheckState } from "../../src/control/checks/state.js";
import type { ScheduledCheck } from "../../src/control/checks/settingsSchema.js";
import { readOrchestrationSettings, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { readRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { checksWorld, g } from "./fixtures/checksWorld.js";

/**
 * Checks spec 2026-10-22 §2.4, §5.4 (plan Task 6): scheduled checks share their kind's watermark; a kind's `enabled`
 * governs its event trigger only; missed slots collapse to the latest; a slot that falls during a run stays pending; a
 * new schedule starts counting from now (it never runs a slot from before it existed); three errored ends pause the kind
 * for the project until a person resumes it; a person's "run now" ignores the trigger and the pause but not the
 * watermark or the in-flight rule. Slots are read in the usage-calendar zone (UTC here).
 */
type World = Awaited<ReturnType<typeof checksWorld>>;
const HOUR = 3_600_000;
const at = (iso: string) => Date.parse(iso);
const daily = (id: string, hour: number, kind: ScheduledCheck["kind"] = "integration-check", enabled = true): ScheduledCheck =>
  ({ id, kind, cron: `0 ${hour} * * *`, enabled, params: {} });
const utc = (w: World) => w.h.store.db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,'UTC',1) ON CONFLICT(singleton) DO UPDATE SET time_zone='UTC'").run();
const ic = (w: World) => readCheckState(w.h.store, "repo", "integration-check", "main")!;
const mr = (w: World) => readCheckState(w.h.store, "repo", "model-review", "main");
let n = 0;
const raw = (w: World, verb: string, kind: string) => ({
  schema: "orca-raw-command-v1", commandId: `cmd-${++n}`, actorId: "owner", verb, target: { kind: "repository", repoId: "repo" },
  payload: { kind }, expectedRevision: readRepositorySettingsBody(w.h.store, "repo")?.revision ?? 0,
}) as never;
const runNow = (w: World, kind = "integration-check") => w.service.runCheckNow(raw(w, "run-check-now", kind));
const resume = (w: World, kind = "integration-check") => w.service.resumeCheck(raw(w, "resume-check", kind));
const advanceTo = (w: World, iso: string) => w.advance(at(iso) - w.now());

describe("scheduled checks", () => {
  it("a kind whose event trigger is off still runs its schedule; the slot is consumed by the run", async () => {
    const w = await checksWorld(); try {
      utc(w);
      w.setProjectChecks({ integrationCheck: { enabled: false, command: "true" }, scheduled: [daily("nightly", 9)] });
      expect((await w.pass()).started).toEqual([]);
      // First evaluation: W := H and the new schedule's lastSlot := the latest slot <= now, no run.
      expect(ic(w)).toMatchObject({ runSeq: 0, lastSlot: { nightly: at("2026-10-20T09:00:00Z") }, last: { state: "initialised" } });
      await w.commitLand("g1", { "a.txt": "1\n" });
      const head = await w.commitLand("g2", { "b.txt": "2\n" });
      // The built-in event trigger would fire (2 landed, queue idle) -- but the kind's event trigger is off.
      w.advance(HOUR);
      expect((await w.pass()).started).toEqual([]);
      expect(ic(w).runSeq).toBe(0);
      advanceTo(w, "2026-10-21T09:00:00Z");
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ watermark: head, runSeq: 1, lastSlot: { nightly: at("2026-10-21T09:00:00Z") }, last: { state: "passed", groups: ["g1", "g2"] } });
    } finally { await w.h.dispose(); }
  });

  it("the model review's event trigger off: a due trigger never starts it, its schedule does", async () => {
    const w = await checksWorld(); try {
      utc(w);
      w.setProjectChecks({ modelReview: { enabled: false }, scheduled: [daily("weekly", 9, "model-review")] });
      await w.pass();
      await w.commitLand("g1", { "shared.ts": "1\n" });
      await w.commitLand("g2", { "shared.ts": "2\n" });
      w.flag("g2", "integration-conflict"); // the built-in trigger holds: conflict, and no start yet
      w.advance(HOUR);
      await w.pass();
      expect(mr(w)!.runSeq).toBe(0);
      advanceTo(w, "2026-10-21T09:00:00Z");
      await w.pass();
      expect(mr(w)).toMatchObject({ runSeq: 1, lastSlot: { weekly: at("2026-10-21T09:00:00Z") } });
    } finally { await w.h.dispose(); }
  });

  it("two schedules of one kind keep their own lastSlot; a slot with nothing new is consumed and recorded skipped", async () => {
    const w = await checksWorld(); try {
      utc(w);
      w.setProjectChecks({ integrationCheck: { enabled: false, command: "true" }, scheduled: [daily("morning", 9), daily("noon", 12)] });
      await w.pass();
      expect(ic(w).lastSlot).toEqual({ morning: at("2026-10-20T09:00:00Z"), noon: at("2026-10-20T12:00:00Z") });
      await w.commitLand("g1", { "a.txt": "1\n" });
      advanceTo(w, "2026-10-21T09:00:00Z");
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ runSeq: 1, lastSlot: { morning: at("2026-10-21T09:00:00Z"), noon: at("2026-10-20T12:00:00Z") } });
      advanceTo(w, "2026-10-21T12:00:00Z");
      const out = await w.pass();
      expect([out.started, out.skipped]).toEqual([[], ["repo"]]);
      expect(ic(w)).toMatchObject({ runSeq: 1, lastSlot: { morning: at("2026-10-21T09:00:00Z"), noon: at("2026-10-21T12:00:00Z") }, last: { state: "skipped", detail: "nothing new" } });
      // Consumed: the same slot does not come back.
      w.advance(60_000);
      expect((await w.pass()).skipped).toEqual([]);
    } finally { await w.h.dispose(); }
  });

  it("missed slots collapse to the latest: three days away ⇒ one run, lastSlot = the newest slot", async () => {
    const w = await checksWorld(); try {
      utc(w);
      w.setProjectChecks({ integrationCheck: { enabled: false, command: "true" }, scheduled: [daily("nightly", 9)] });
      await w.pass();
      await w.commitLand("g1", { "a.txt": "1\n" });
      advanceTo(w, "2026-10-24T10:00:00Z");
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ runSeq: 1, lastSlot: { nightly: at("2026-10-24T09:00:00Z") } });
      w.advance(60_000);
      expect(await w.pass()).toMatchObject({ started: [], skipped: [] });
    } finally { await w.h.dispose(); }
  });

  it("a schedule added to a check with a due range counts from now: no run for a slot from before it existed", async () => {
    const w = await checksWorld(); try {
      utc(w);
      // The event trigger is on but never holds here (50 landed groups), so the kind is evaluated and W is set.
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true", trigger: { all: [{ any: [{ kind: "landed-groups", min: 50 }] }] } } });
      await w.pass(); // W := H
      await w.commitLand("g1", { "a.txt": "1\n" });
      advanceTo(w, "2026-10-21T10:00:00Z");
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true", trigger: { all: [{ any: [{ kind: "landed-groups", min: 50 }] }] } }, scheduled: [daily("nightly", 9)] });
      expect((await w.pass()).started).toEqual([]);
      expect(ic(w)).toMatchObject({ runSeq: 0, lastSlot: { nightly: at("2026-10-21T09:00:00Z") } });
      advanceTo(w, "2026-10-22T09:00:00Z");
      expect((await w.pass()).started).toEqual(["repo"]);
    } finally { await w.h.dispose(); }
  });

  it("a global schedule runs in the project; the project's entry with the same id and enabled:false turns it off there", async () => {
    const w = await checksWorld(); try {
      utc(w);
      w.h.store.transaction(() => writeOrchestrationSettings(w.h.store, { ...readOrchestrationSettings(w.h.store), checks: { scheduled: [daily("nightly", 9)] } }, 1));
      w.setProjectChecks({ integrationCheck: { enabled: false, command: "true" } });
      await w.pass();
      expect(ic(w).lastSlot).toEqual({ nightly: at("2026-10-20T09:00:00Z") });
      await w.commitLand("g1", { "a.txt": "1\n" });
      advanceTo(w, "2026-10-21T09:00:00Z");
      expect((await w.pass()).started).toEqual(["repo"]);
      w.setProjectChecks({ integrationCheck: { enabled: false, command: "true" }, scheduled: [daily("nightly", 9, "integration-check", false)] });
      await w.commitLand("g2", { "b.txt": "2\n" });
      advanceTo(w, "2026-10-22T09:00:00Z");
      expect((await w.pass()).started).toEqual([]);
      expect(ic(w)).toMatchObject({ runSeq: 1, lastSlot: { nightly: at("2026-10-21T09:00:00Z") } });
    } finally { await w.h.dispose(); }
  });

  it("a slot that falls while a run is in flight stays pending; the next start consumes it", async () => {
    const w = await checksWorld(); try {
      utc(w);
      const gate = join(w.h.root, "go");
      w.setProjectChecks({ integrationCheck: { enabled: false, command: `while [ ! -f '${gate}' ]; do sleep 0.05; done` }, scheduled: [daily("nightly", 9)] });
      await w.pass();
      await w.commitLand("g1", { "a.txt": "1\n" });
      advanceTo(w, "2026-10-21T08:00:00Z");
      runNow(w);
      expect((await w.service.checksPass()).started).toEqual(["repo"]); // in flight until the gate file exists
      advanceTo(w, "2026-10-21T09:00:00Z");
      expect((await w.service.checksPass()).started).toEqual([]);
      expect(ic(w)).toMatchObject({ runSeq: 1, lastSlot: { nightly: at("2026-10-20T09:00:00Z") }, last: { state: "running" } });
      const head = await w.commitLand("g2", { "b.txt": "2\n" });
      await writeFile(gate, "");
      await w.service.checksSettled();
      expect(ic(w).last?.state).toBe("passed");
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ watermark: head, runSeq: 2, lastSlot: { nightly: at("2026-10-21T09:00:00Z") }, last: { state: "passed", groups: ["g2"] } });
    } finally { await w.h.dispose(); }
  });
});

describe("run now", () => {
  it("with no watermark records initialised; over an empty range records skipped; else starts though the trigger is off", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: false, command: "true" } });
      await w.pass();
      expect(readCheckState(w.h.store, "repo", "integration-check", "main")).toBeNull(); // off and nothing asked: not evaluated
      expect(runNow(w)).toMatchObject({ result: { kind: "check-run-requested" } });
      expect(await w.pass()).toMatchObject({ started: [], initialised: ["repo"] });
      expect(ic(w)).toMatchObject({ pendingRun: null, runSeq: 0, last: { state: "initialised" } });
      runNow(w);
      expect(await w.pass()).toMatchObject({ started: [], skipped: ["repo"] });
      expect(ic(w)).toMatchObject({ pendingRun: null, runSeq: 0, last: { state: "skipped", detail: "nothing new" } });
      const head = await w.commitLand("g1", { "a.txt": "1\n" });
      expect((await w.pass()).started).toEqual([]); // the kind is off: nothing starts it but a person
      runNow(w);
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ pendingRun: null, watermark: head, runSeq: 1, last: { state: "passed", groups: ["g1"] } });
    } finally { await w.h.dispose(); }
  });

  it("waits for the run in flight and then starts", async () => {
    const w = await checksWorld(); try {
      const gate = join(w.h.root, "go");
      w.setProjectChecks({ integrationCheck: { enabled: false, command: `while [ ! -f '${gate}' ]; do sleep 0.05; done` } });
      runNow(w);
      await w.pass();
      await w.commitLand("g1", { "a.txt": "1\n" });
      runNow(w);
      expect((await w.service.checksPass()).started).toEqual(["repo"]);
      await w.commitLand("g2", { "b.txt": "2\n" });
      runNow(w);
      expect((await w.service.checksPass()).started).toEqual([]);
      expect(ic(w).pendingRun).not.toBeNull();
      await writeFile(gate, "");
      await w.service.checksSettled();
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ pendingRun: null, runSeq: 2, last: { state: "passed", groups: ["g2"] } });
    } finally { await w.h.dispose(); }
  });
});

describe("failure streak and pause (§5.4)", () => {
  it("three errored ends pause the kind: neither trigger nor schedule starts it; run now does; resume re-arms the trigger", async () => {
    const w = await checksWorld(); try {
      utc(w);
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true", trigger: { all: [{ any: [{ kind: "landed-groups", min: 1 }] }] } }, scheduled: [daily("nightly", 9)] });
      await w.pass();
      await w.commitLand("g1", { "a.txt": "1\n" });
      // Errored: the check's worktree cannot be made (its root is a file).
      const roots = controlWorkspaceRoots(w.h.store.stateDir);
      g(w.repo, "worktree", "prune");
      await rm(roots.workspacesRoot, { recursive: true, force: true });
      await writeFile(roots.workspacesRoot, "not a directory\n");
      for (let i = 1; i <= 3; i += 1) {
        w.advance(HOUR);
        expect((await w.pass()).started).toEqual(["repo"]);
        expect(ic(w)).toMatchObject({ failureStreak: i, paused: i === 3, last: { state: "errored" } });
      }
      // Paused: the trigger still holds and a slot falls -- nothing starts.
      advanceTo(w, "2026-10-21T09:00:00Z");
      expect((await w.pass()).started).toEqual([]);
      expect(ic(w)).toMatchObject({ runSeq: 3, paused: true, lastSlot: { nightly: at("2026-10-20T09:00:00Z") } });
      // A person's run now still runs while paused.
      runNow(w);
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ runSeq: 4, failureStreak: 4, paused: true });
      // Resume re-arms it: the next due trigger starts it.
      await rm(roots.workspacesRoot, { force: true });
      expect(resume(w)).toMatchObject({ result: { kind: "check-resumed", targets: ["main"] } });
      expect(ic(w)).toMatchObject({ paused: false, failureStreak: 0 });
      w.advance(60_000);
      expect((await w.pass()).started).toEqual(["repo"]);
      expect(ic(w)).toMatchObject({ runSeq: 5, paused: false, failureStreak: 0, last: { state: "passed" } });
    } finally { await w.h.dispose(); }
  });

  it("an interruption does not count toward the pause", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true", trigger: { all: [{ any: [{ kind: "landed-groups", min: 1 }] }] } } });
      await w.pass();
      await w.commitLand("g1", { "a.txt": "1\n" });
      const s = ic(w);
      w.h.store.transaction(() => writeCheckState(w.h.store, "repo", "integration-check", "main", { ...s, failureStreak: 2, runSeq: 2, last: { state: "running", at: w.now(), from: s.watermark, to: s.watermark, groups: [], detail: null, reviewGroupId: null, debugGroupIds: [], recordHash: null } }));
      const out = await w.service.checksPass();
      expect(ic(w)).toMatchObject({ failureStreak: 2, paused: false });
      expect(out.started).toEqual(["repo"]);
      await w.service.checksSettled();
    } finally { await w.h.dispose(); }
  });
});
