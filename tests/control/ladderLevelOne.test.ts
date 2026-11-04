import { describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { boundLastFailure } from "../../src/control/driveRecord.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { COLLECTOR_HOLD_MS } from "../../src/control/ladderSkip.js";
import { systemDebugGroupId } from "../../src/control/systemDebug.js";
import { buildPriorFailures, headBytes, predecessorPriorFailures, priorFailureOf, priorFailuresAtPrepare } from "../../src/control/priorFailures.js";
import { startEnvelopeSchema } from "../../src/control/schema.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../../src/control/snapshot.js";
import { readTaskResultState, saveTaskResultState } from "../../src/control/taskResultStore.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Kanban spec §6 level 1, ccloop priorFailures spec 2026-10-21 §3: a started group's task whose run ended failed is first
 * re-dispatched once as orca-auto, and that fresh run's envelope carries what Orca stored about the earlier failed runs of
 * the task -- category, command, cause, and evidence only from the collector's stored copy that matches the fingerprint.
 */
const CAUSE = { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null };
const LAST = { rejectCategory: "required-check-failed", failingCommand: "node check.js", primaryTargetPaths: ["src/a.js"] };

async function levelOneWorld(failure: () => { failureCause?: typeof CAUSE | { cause: string; phase: "setup" | null; retries: number; detail: null }; lastFailure?: { rejectCategory: string; failingCommand: string | null; primaryTargetPaths?: string[] } } | undefined, options: { stopReason?: () => string | null; storeNow?: () => number } = {}) {
  let failing = true;
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => (failing ? "failed" : "succeed"), failure, ...options });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const driver = t.driver();
  // Final-review fix wave (I1): the runs the ladder pass asked to collect again; `collectFor` hands them to the driver.
  const scheduled: string[] = [];
  const collect = { real: false };
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo,
    scheduleTaskResults: (runId: string) => { scheduled.push(runId); if (collect.real) driver.scheduleTaskResults(runId); } });
  const blockedRun = async (runId: string) => { await t.until(driver, () => t.body(runId).state === "blocked", 120); return runId; };
  const redispatched = async (): Promise<string> => {
    replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
    const delivered = await deliverScheduledStart(t.dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => t.body(delivered.runId).drive?.prepared === true, 120);
    return delivered.runId;
  };
  const envelopeWork = (runId: string) => (JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash)) as { work: Record<string, unknown> }).work;
  return { t, service, driver, blockedRun, redispatched, envelopeWork, scheduled, collect, succeedNext: () => { failing = false; } };
}

describe("ladder level 1: one re-dispatch carrying the earlier failures (kanban spec §6, priorFailures spec §3)", { timeout: 180_000 }, () => {
  it("re-dispatches the failed task once as orca-auto, and the fresh run's envelope names the failed run", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      const first = await w.blockedRun(await t.claim());
      // The first run carried nothing: there was no earlier failure (absent keeps the envelope's bytes).
      expect("priorFailures" in w.envelopeWork(first)).toBe(false);
      const pass = await w.service.systemDebugPass();
      // mutation: skip level 1 (open the ladder group at once) -> redispatched [] and opened [ladder], red
      expect([pass.redispatched, pass.opened]).toEqual([["g:a"], []]);
      const row = t.h.store.db.prepare("SELECT actor_id FROM commands WHERE group_id='g' AND id='orca-auto-ladder-l1-a'").get();
      expect(row?.actor_id).toBe("orca-auto");
      // A second pass while the re-dispatch is pending does nothing more.
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
      const second = await w.redispatched();
      // mutation: A2 never builds priorFailures -> key absent, red
      expect(w.envelopeWork(second).priorFailures).toEqual([
        { runId: first, rejectCategory: "required-check-failed", failingCommand: "node check.js", evidence: null, failureCause: "required-check-failed" },
      ]);
    } finally { await t.h.dispose(); }
  });

  it("does not re-dispatch a task whose run failed on auth (the person's, failure-cause spec §5)", async () => {
    const w = await levelOneWorld(() => ({ failureCause: { cause: "auth", phase: null, retries: 0, detail: null } })); const { t } = w; try {
      await w.blockedRun(await t.claim());
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a run that failed without a rejection is named by its cause, or as unknown", async () => {
    const w = await levelOneWorld(() => undefined); const { t } = w; try {
      const first = await w.blockedRun(await t.claim());
      await w.service.systemDebugPass();
      const second = await w.redispatched();
      // mutation: a run without lastFailure is skipped -> [], red
      expect(w.envelopeWork(second).priorFailures).toEqual([{ runId: first, rejectCategory: "run-failed:unknown", failingCommand: null, evidence: null }]);
    } finally { await t.h.dispose(); }
  });
});

/**
 * Task setup and check retry spec 2026-11-04 §4.7: another try cannot fix a run whose setup failed or whose failing check
 * could not run at all, so the ladder leaves it out -- both levels -- and records why once, for the task page. Every other
 * failure keeps the ladder, and so does a run whose stored rejection cannot be read (fail open).
 */
describe("the ladder leaves out what another try cannot fix (spec §4.7)", { timeout: 180_000 }, () => {
  const LADDER = systemDebugGroupId({ kind: "ladder", groupId: "g", taskId: "a", runId: null });
  const SETUP = { cause: "setup-failed", phase: "setup" as const, retries: 0, detail: null };
  const NOT_FOUND = "command output | required check failed: node check.js | stderr=sh: node: command not found | exit=127";
  /** The collector's stored copy of the run's last rejection (taskResultStore), as the driver keeps it. */
  const storeRejection = async (t: Awaited<ReturnType<typeof levelOneWorld>>["t"], runId: string, bytes: Buffer) => {
    const ref = await writeArtifact(t.h.store, `verify-${runId}`, bytes);
    t.h.store.transaction(() => saveTaskResultState(t.h.store, runId, "g", {
      schema: "orca-task-result-store-v1", identity: { runId } as never, revision: 1, sourceRevision: 1, currentAttempt: 1, reason: null,
      observations: [{ manifestRef: ref, manifest: { attempt: 1, stage: "verification", verificationRef: ref }, verification: "failed" }] as never, status: "available",
    }));
  };
  const rejection = (failingCommand: string | null, evidence: string[], rejectCategory = "required-check-failed") =>
    Buffer.from(JSON.stringify({ approved: false, rejectCategory, primaryTargetPaths: ["src/a.js"], failingCommand, safeToRetry: false, evidence, pauseSignals: [], stopSignals: [] }));
  const skippedRows = (t: Awaited<ReturnType<typeof levelOneWorld>>["t"]) => t.h.store.db.prepare("SELECT run_id, task_id, body FROM activity WHERE group_id='g' AND kind='ladder-skipped' ORDER BY seq").all()
    .map((row) => [String(row.run_id), String(row.task_id), JSON.parse(String(row.body))]);
  /** As if the collector's job for the run had not run yet (the harness's own collector settles it at once). */
  const uncollected = (t: Awaited<ReturnType<typeof levelOneWorld>>["t"], runId: string) => { t.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run(`task-results:${runId}`); };
  const levelOneIssued = (t: Awaited<ReturnType<typeof levelOneWorld>>["t"]) => t.h.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND id='orca-auto-ladder-l1-a'").get() !== undefined;

  it("a run whose setup failed gets neither level, and one row says why", async () => {
    const w = await levelOneWorld(() => ({ failureCause: SETUP })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      const pass = await w.service.systemDebugPass();
      // mutation A5-M5: setup-failed out of LADDER_EXEMPT_CAUSES -> level 1 re-dispatches it, red
      expect([pass.redispatched, pass.opened, levelOneIssued(t)]).toEqual([[], [], false]);
      expect(skippedRows(t)).toEqual([[run, "a", { reason: "setup-failed" }]]);
    } finally { await t.h.dispose(); }
  });

  it("a run whose failing check could not run gets neither level, and a second pass writes no second row", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      await storeRejection(t, run, rejection("node check.js", ["command output | required check passed: true", NOT_FOUND]));
      const pass = await w.service.systemDebugPass();
      expect([pass.redispatched, pass.opened, levelOneIssued(t)]).toEqual([[], [], false]);
      // Final-review fix wave (I4): the row names the failing command for the task page. Mutation I4-M4 (no command) -> red.
      expect(skippedRows(t)).toEqual([[run, "a", { reason: "could-not-run", command: "node check.js" }]]);
      const again = await w.service.systemDebugPass();
      expect([again.redispatched, again.opened]).toEqual([[], []]);
      // mutation: write the row on every pass -> two rows, red
      expect(skippedRows(t)).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("the level-1 retry whose check could not run opens no debug group", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      await w.blockedRun(await t.claim());
      // The first run failed ordinarily (no stored copy: the ladder keeps it), so level 1 re-dispatches.
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      const retry = await w.blockedRun(await w.redispatched());
      await storeRejection(t, retry, rejection("node check.js", [NOT_FOUND]));
      const pass = await w.service.systemDebugPass();
      // mutation A5-M2: skip only at level 1 -> the ladder group opens, red
      expect(pass.opened).toEqual([]);
      expect(t.h.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(LADDER)).toBeUndefined();
      expect(skippedRows(t)).toEqual([[retry, "a", { reason: "could-not-run", command: "node check.js" }]]);
    } finally { await t.h.dispose(); }
  });

  it("two verifier rejections that ccloop stopped as a repeated pattern still get the level-1 retry", async () => {
    const verifier = { rejectCategory: "scope-violation", failingCommand: null, primaryTargetPaths: ["src/a.js"] };
    const w = await levelOneWorld(() => ({ failureCause: { ...CAUSE, cause: "verifier-rejected" }, lastFailure: verifier }), { stopReason: () => "repeated failure pattern detected" }); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      await storeRejection(t, run, rejection(null, ["the change touches files outside the task"], "scope-violation"));
      expect(t.body(run).drive?.stopReason).toBe("repeated failure pattern detected");
      // mutation A5-M4: skip on the repeated-failure stop reason -> [], red
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      expect(skippedRows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  // Ruling: 2026-11-04 session af2ceee1, human 「这次批准改写所有必要的判据」: the final-review fix wave (I1) holds a run whose
  // stored rejection is not readable yet, since "not stored yet" and "stored but unreadable" read the same; the fail-open
  // this case pins now comes after the hold (COLLECTOR_HOLD_MS), so the clock is moved past it before the pass.
  it("a stored rejection that cannot be read keeps the ladder (fail open, Review Focus 5)", async () => {
    const clock = { value: 1_000_000 };
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST }), { storeNow: () => clock.value }); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      // The collector settled, but the stored copy's bytes do not parse.
      await storeRejection(t, run, Buffer.from(`{"evidence": ["${NOT_FOUND}"`));
      clock.value += COLLECTOR_HOLD_MS;
      // mutation A5-M3: treat unreadable as could-not-run -> [], red
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      expect(skippedRows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  // Ruling: fix round 1, controller ruling (session af2ceee1) -- this case pinned "an unsettled copy keeps the ladder"; the
  // ladder may run before the final verification is collected, so it now pins the hold: no level, no row, until the
  // collector settles, failing open COLLECTOR_HOLD_MS after the run blocked.
  it("holds a required-check-failed run while the collector has not settled, and fails open after ten minutes", async () => {
    const clock = { value: 1_000_000 };
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST }), { storeNow: () => clock.value }); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      // Nothing collected yet (no state), then a collection under way (a page admitted, the next not yet).
      uncollected(t, run);
      // mutation: no hold (fail open while unsettled) -> ["g:a"], red
      expect([(await w.service.systemDebugPass()).redispatched, levelOneIssued(t), skippedRows(t)]).toEqual([[], false, []]);
      t.h.store.transaction(() => saveTaskResultState(t.h.store, run, "g", { schema: "orca-task-result-store-v1", identity: { runId: run } as never, revision: 2, sourceRevision: 1, currentAttempt: 1, observations: [], status: "available", reason: null }));
      clock.value += COLLECTOR_HOLD_MS - 1;
      expect([(await w.service.systemDebugPass()).redispatched, levelOneIssued(t), skippedRows(t)]).toEqual([[], false, []]);
      // mutation: no bound (hold forever) -> [], red
      clock.value += 1;
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      expect(skippedRows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("holds a run whose collected state looks settled before its final verification is stored, and collects it again", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      // The state a live round's collection leaves before the final verification exists: `missing`, revision 0 of 0.
      t.h.store.transaction(() => saveTaskResultState(t.h.store, run, "g", { schema: "orca-task-result-store-v1", identity: { runId: run } as never, revision: 0, sourceRevision: 0, currentAttempt: 0, observations: [], status: "missing", reason: null }));
      // mutation I1-M1: hold only while the state is unsettled (revision != sourceRevision) -> ["g:a"], red
      expect([(await w.service.systemDebugPass()).redispatched, levelOneIssued(t), skippedRows(t)]).toEqual([[], false, []]);
      // mutation I1-M2: the pass does not re-schedule the held run's collection -> [], red
      expect(w.scheduled).toEqual([run]);
      await storeRejection(t, run, rejection("node check.js", [NOT_FOUND]));
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
      expect([levelOneIssued(t), skippedRows(t)]).toEqual([false, [[run, "a", { reason: "could-not-run", command: "node check.js" }]]]);
    } finally { await t.h.dispose(); }
  });

  it("the held run's collection really runs again: a collector that gives up ends the hold", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      t.h.store.transaction(() => saveTaskResultState(t.h.store, run, "g", { schema: "orca-task-result-store-v1", identity: { runId: run } as never, revision: 0, sourceRevision: 0, currentAttempt: 0, observations: [], status: "missing", reason: null }));
      w.collect.real = true;
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
      // The harness's port cannot collect task results, so the driver's collector, scheduled by the pass, settles it
      // `unsupported`; the next pass fails open at once instead of waiting out the hold.
      for (let i = 0; i < 200 && readTaskResultState(t.h.store, run)?.status !== "unsupported"; i++) await new Promise((r) => setTimeout(r, 10));
      // mutation I1-M3: Driver.scheduleTaskResults does nothing -> still `missing`, red
      expect(readTaskResultState(t.h.store, run)?.status).toBe("unsupported");
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
    } finally { await t.h.dispose(); }
  });

  // Scoped fix (re-review item 1): a rejection over its path bound is stored without primaryTargetPaths, so no stored copy
  // can ever match it; the run is not held for nothing.
  it("a rejection without paths is not held: the ladder decides at once", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: { rejectCategory: "required-check-failed", failingCommand: "node check.js" } })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      expect(t.body(run).drive?.lastFailure?.primaryTargetPaths).toBeUndefined();
      t.h.store.transaction(() => saveTaskResultState(t.h.store, run, "g", { schema: "orca-task-result-store-v1", identity: { runId: run } as never, revision: 0, sourceRevision: 0, currentAttempt: 0, observations: [], status: "missing", reason: null }));
      // Mutation S1-M1 (hold without paths too) -> [], red.
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      expect(w.scheduled).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  // Scoped fix (re-review item 3): a setup-failed row names no command (the reason line shows the setup's detail).
  it("a setup-failed row carries no failing command", async () => {
    const w = await levelOneWorld(() => ({ failureCause: SETUP, lastFailure: LAST })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      await w.service.systemDebugPass();
      // Mutation S3-M1 (command for every reason) -> command "node check.js", red.
      expect(skippedRows(t)).toEqual([[run, "a", { reason: "setup-failed" }]]);
    } finally { await t.h.dispose(); }
  });

  it("decides once the collector settles: the held run whose copy shows the check could not run is left out", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      const run = await w.blockedRun(await t.claim());
      // The harness's collector settled at once (`unsupported`); as if its job had not run yet, there is no state.
      uncollected(t, run);
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
      await storeRejection(t, run, rejection("node check.js", [NOT_FOUND]));
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
      expect([levelOneIssued(t), skippedRows(t)]).toEqual([false, [[run, "a", { reason: "could-not-run", command: "node check.js" }]]]);
    } finally { await t.h.dispose(); }
  });
});

describe("priorFailures.ts: what an earlier failed run contributes (priorFailures spec §2.1, §3)", () => {
  it("headBytes keeps at most the bound in UTF-8 bytes, cut on a code point, with the omitted count", () => {
    const text = "中".repeat(2000); // 6000 bytes
    const cut = headBytes(text, 4096);
    // mutation: count UTF-16 units (text.length) -> 2000 <= 4096, returned whole, red
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(4096);
    expect(cut).toMatch(/^(中)+…\[\d+ bytes omitted\]$/);
    const kept = Buffer.byteLength(cut.slice(0, cut.indexOf("…")), "utf8");
    expect(cut).toContain(`…[${6000 - kept} bytes omitted]`);
    expect(headBytes("short", 4096)).toBe("short");
  });

  it("takes evidence only from a stored verification whose fingerprint matches, and only once the collector settled", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const store = t.h.store;
      const verification = (paths: string[], evidence: string[]) => Buffer.from(JSON.stringify({ approved: false, rejectCategory: "required-check-failed", primaryTargetPaths: paths, failingCommand: "node check.js", safeToRetry: false, evidence, pauseSignals: [], stopSignals: [] }));
      const match = await writeArtifact(store, "verify-match", verification(["src/a.js"], ["stdout=boom", ""]));
      const other = await writeArtifact(store, "verify-other", verification(["src/b.js"], ["from another fingerprint"]));
      const manifest = (attempt: number, ref: { artifactId: string; hash: string }) => ({ manifestRef: ref, manifest: { attempt, stage: "verification", verificationRef: ref }, verification: "failed" });
      const save = (status: string, observations: unknown[]) => saveTaskResultState(store, "run-x", "g", { schema: "orca-task-result-store-v1", identity: { runId: "run-x" } as never, revision: 1, sourceRevision: 1, currentAttempt: 2, observations: observations as never, status: status as never, reason: null });
      const run = { runId: "run-x", drive: { failureCause: CAUSE, lastFailure: LAST } as never };
      // The latest attempt does not match; an earlier one does.
      save("available", [manifest(1, match), manifest(2, other)]);
      // mutation: drop the fingerprint test -> attempt 2's copy taken; mutation: keep empty entries -> ["stdout=boom", ""], red
      expect((await priorFailureOf(store, run)).evidence).toEqual(["stdout=boom"]);
      save("stale", [manifest(1, match)]);
      // mutation: ignore the collector's status -> evidence taken, red
      expect((await priorFailureOf(store, run)).evidence).toBeNull();
      save("available", [manifest(1, match)]);
      // An empty recorded category is named unknown (ccloop refuses an empty string). mutation: pass it through -> "", red
      expect((await priorFailureOf(store, { runId: "run-x", drive: { lastFailure: { rejectCategory: "", failingCommand: "" } } as never }))).toMatchObject({ rejectCategory: "unknown", failingCommand: null });
      // A last rejection recorded without its paths (an older record) matches nothing.
      expect((await priorFailureOf(store, { runId: "run-x", drive: { lastFailure: { rejectCategory: LAST.rejectCategory, failingCommand: LAST.failingCommand } } as never })).evidence).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("the stored last rejection keeps its whole fingerprint, or none of the paths", () => {
    // mutation: boundLastFailure drops primaryTargetPaths -> the evidence match can never succeed, red
    expect(boundLastFailure({ rejectCategory: "c", failingCommand: null, primaryTargetPaths: ["a", "b"] })).toEqual({ rejectCategory: "c", failingCommand: null, primaryTargetPaths: ["a", "b"] });
    // A fingerprint that does not fit is dropped whole, never cut (a cut one would match the wrong copy).
    // mutation: slice to the first 64 paths -> 64 kept, red
    expect("primaryTargetPaths" in boundLastFailure({ rejectCategory: "c", failingCommand: null, primaryTargetPaths: Array.from({ length: 65 }, (_, i) => `p${i}`) })).toBe(false);
  });

  it("carries the latest three earlier failed runs of the same task, oldest first", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const store = t.h.store;
      const body = (runId: string, taskId: string, failed: boolean) => JSON.stringify({ runId, taskId, state: failed ? "blocked" : "settled", drive: { blockedAt: failed ? "C" : null, outcome: failed ? "failed" : "succeeded" } });
      const insert = store.db.prepare("INSERT INTO runs(id, group_id, work_item_id, generation, active, body) VALUES (?, 'g', 'a', 1, 0, ?)");
      for (const [runId, taskId, failed] of [["r1", "a", true], ["r2", "b", true], ["r3", "a", true], ["r4", "a", false], ["r5", "a", true], ["r6", "a", true]] as const) insert.run(runId, body(runId, taskId, failed));
      // mutation: newest first -> [r6, r5, r3], red; mutation: no cap -> four entries, red; mutation: any task -> r2 included, red
      expect((await buildPriorFailures(store, "g", "a", "now"))?.map((entry) => entry.runId)).toEqual(["r3", "r5", "r6"]);
      // The run being prepared is never its own earlier failure, and a task with none gets none (no key on the wire).
      expect(await buildPriorFailures(store, "g", "c", "now")).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("a continuation copies its predecessor's frozen entries byte for byte", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const store = t.h.store;
      const entries = [{ runId: "r1", rejectCategory: "run-failed:stalled", failingCommand: null, evidence: null, failureCause: "stalled" }];
      const work = { kind: "loop", priorFailures: entries };
      const canonical = canonicalBytes({ work }).toString("utf8");
      const hash = sha256Canonical({ work });
      writeCanonicalRecord(store, "g", hash, canonical);
      store.db.prepare("INSERT INTO runs(id, group_id, work_item_id, generation, active, body) VALUES ('pred', 'g', 'a', 1, 0, ?)").run(JSON.stringify({ runId: "pred", drive: { envelopeHash: hash } }));
      // mutation: rebuild instead of copy (or drop on successor) -> undefined, red
      expect(predecessorPriorFailures(store, "pred")).toEqual(entries);
      // At A2 (priorFailuresAtPrepare): a continuation copies, a saved-result recovery carries none, a fresh run builds.
      // mutation: A2 ignores the predecessor (always builds) -> undefined (task "a" has no failed run here), red
      expect(await priorFailuresAtPrepare(store, { groupId: "g", taskId: "a", runId: "now" }, { recovery: false, predecessorRunId: "pred" })).toEqual(entries);
      // mutation: a recovery copies too -> entries, red
      expect(await priorFailuresAtPrepare(store, { groupId: "g", taskId: "a", runId: "now" }, { recovery: true, predecessorRunId: "pred" })).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("the start envelope refuses them with a saved-result recovery, and bounds them in UTF-8 bytes", () => {
    const hx = (v: string) => v.repeat(64);
    const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
    const claim = {
      groupId: "g", workItemId: "w", taskId: "a", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c",
      configHash: hx("a"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(0) }, ownerToken: "owner",
    };
    const entry = { runId: "r1", rejectCategory: "required-check-failed", failingCommand: null, evidence: null };
    const envelope = (priorFailures: unknown, extra: Record<string, unknown> = {}) => ({ protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, ...extra,
      work: { kind: "loop", contract: {}, targetRepo: "/r", base: "b", sourceDir: "/s", priorFailures } });
    const ok = (value: unknown) => startEnvelopeSchema.safeParse(value).success;
    expect(ok(envelope([entry]))).toBe(true);
    expect(ok(envelope([]))).toBe(false);
    expect(ok(envelope([entry, entry, entry, entry]))).toBe(false);
    // 1366 × "中" is 1366 UTF-16 units but 4098 UTF-8 bytes. mutation: .max(4096) instead of the byte refine -> accepted, red
    expect(ok(envelope([{ ...entry, evidence: ["中".repeat(1366)] }]))).toBe(false);
    expect(ok(envelope([{ ...entry, evidence: ["中".repeat(1365)] }]))).toBe(true);
    // A saved-result recovery builds no prompt: ccloop refuses them there. mutation: drop the refusal -> accepted, red
    const recovery = { mode: "verify-saved-result", protocol: 4, savedResultRecovery: { packagePath: "/p", packageHash: hx("c"), admissionHash: hx("d"), recoveryOf: { sourceRunId: "r0", sourceAttempt: 1, capsuleHash: hx("e"), snapshotHash: hx("f"), normalizedExecutionHash: hx("1") } } };
    expect(ok({ ...envelope(undefined, recovery), work: { kind: "loop", contract: {}, targetRepo: "/r", base: "b", sourceDir: "/s" } })).toBe(true);
    expect(ok(envelope([entry], recovery))).toBe(false);
  });
});
