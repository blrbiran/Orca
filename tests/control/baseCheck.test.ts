import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBases, runBaseCheck, type BaseCheckRun } from "../../src/control/baseCheck.js";
import { BASE_CHECK_EVIDENCE_PREFIX, baseCheckEvidence, listBaseChecks, readBaseCheck, requestBaseCheck } from "../../src/control/baseCheckRecord.js";
import { replenishStartWakes, write } from "../../src/control/executionDriver.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Pre-existing failures spec 2026-11-18 L3 (#341): after a task run ends `required-check-failed`, Orca runs that one command
 * once at the group's base commit (cached by repository, base and command) and the next attempt's prior failure says so when
 * it was red there. Green adds nothing; a base run that cannot run is "could not tell", never red; no retry rule changes.
 */

const CAUSE = { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null };
const TAIL = "base.txt is here";

/** A check that counts its own runs in `counter` (outside every repository) and prints TAIL; red or green at the base. */
function counted(counter: string, atBase: "red" | "green"): string {
  return `echo run >> '${counter}'; echo '${TAIL}' >&2; test ${atBase === "red" ? "!" : ""} -e base.txt`;
}
const runsOf = (counter: string): number => existsSync(counter) ? readFileSync(counter, "utf8").split("\n").filter(Boolean).length : 0;

async function world(check: string, options: { failingCommand?: string; rejectCategory?: string; setup?: string[] } = {}) {
  const lastFailure = { rejectCategory: options.rejectCategory ?? "required-check-failed", failingCommand: options.failingCommand ?? check, primaryTargetPaths: ["a"] };
  const t = await driverHarness([{ taskId: "a", requiredChecks: [check], ...(options.setup ? { contextExtra: { setupCommands: options.setup } } : {}) }],
    { behaviour: () => "failed", failure: () => ({ failureCause: CAUSE, lastFailure }) });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const driver = t.driver();
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo, scheduleTaskResults: () => undefined });
  const blocked = async (runId: string) => { await t.until(driver, () => t.body(runId).state === "blocked", 120); return runId; };
  const redispatched = async (): Promise<string> => {
    replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
    const delivered = await deliverScheduledStart(t.dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => t.body(delivered.runId).drive?.prepared === true, 120);
    return delivered.runId;
  };
  const priorFailures = (runId: string) => (JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash)) as { work: { priorFailures?: Array<{ runId: string; evidence: string[] | null }> } }).work.priorFailures;
  /** Driver rounds, with a pause for the base run that goes on off the round, until `predicate`. */
  const settle = async (predicate: () => boolean, max = 150): Promise<void> => {
    for (let i = 0; i < max && !predicate(); i += 1) { await driver.round(); await new Promise((resolve) => setTimeout(resolve, 20)); }
    if (!predicate()) throw new Error("the expected state was not reached");
  };
  const row = () => listBaseChecks(t.h.store)[0];
  const base = () => git(t.repo, "rev-parse", "main");
  return { t, driver, service, blocked, redispatched, priorFailures, settle, row, base };
}

const counterPath = () => join(mkdtempSync(join(tmpdir(), "base-check-")), "runs");

describe("L3: a failed check is run once at the group's base", { timeout: 180_000 }, () => {
  it("red at the base: one run, the row names who asked, and the next attempt carries the evidence line; the same failure again runs nothing", async () => {
    const counter = counterPath();
    const w = await world(counted(counter, "red")); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.settle(() => w.row()?.result === "red");
      // Durable, attributed (Task 2 lists it): repository, base, command, result, tail, the asking task run, when.
      expect(w.row()).toMatchObject({ repoId: "repo", base: w.base(), command: counted(counter, "red"), result: "red", tail: TAIL, why: null, groupId: "g", taskId: "a", runId: first });
      expect(typeof w.row()!.requestedAt).toBe("number");
      expect(typeof w.row()!.at).toBe("number");
      expect(runsOf(counter)).toBe(1);
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      const second = await w.redispatched();
      // mutation "drop the evidence line" (priorFailureOf never reads the base check) -> evidence null, red here.
      expect(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: first, evidence: [`${BASE_CHECK_EVIDENCE_PREFIX}${TAIL}`] })]);
      // Focus 3: the second attempt fails the same command at the same base -- nothing runs again.
      await w.blocked(second);
      for (let i = 0; i < 10; i += 1) { await w.driver.round(); await new Promise((resolve) => setTimeout(resolve, 20)); }
      // mutation "drop the cache" (the request re-opens an answered row) -> a second base run, red here.
      expect(runsOf(counter)).toBe(1);
      expect(listBaseChecks(t.h.store)).toHaveLength(1);
      expect(w.row()).toMatchObject({ result: "red", runId: first });
    } finally { await t.h.dispose(); }
  });

  it("green at the base is recorded and adds nothing to the next attempt", async () => {
    const counter = counterPath();
    const w = await world(counted(counter, "green")); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.settle(() => w.row()?.result === "green");
      expect(w.row()).toMatchObject({ result: "green", tail: null, runId: first });
      await w.service.systemDebugPass();
      const second = await w.redispatched();
      expect(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: first, evidence: null })]);
      expect(runsOf(counter)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("no retry rule changes: the ladder re-dispatches while the base run is still going, and that attempt is told nothing", async () => {
    const counter = counterPath();
    const w = await world(counted(counter, "red")); const { t } = w; try {
      let release!: () => void, entered = false;
      const held = new Promise<void>((resolve) => { release = resolve; });
      t.deps.beforeScratchRemoved = async () => { entered = true; await held; };
      const first = await w.blocked(await t.claim());
      await w.settle(() => entered);
      expect(w.row()?.result).toBe("pending");
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      const second = await w.redispatched();
      expect(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: first, evidence: null })]);
      release();
      await w.settle(() => w.row()?.result === "red");
    } finally { await t.h.dispose(); }
  });

  it("a setup that fails at the base is unknown -- recorded, never red, and nothing is claimed", async () => {
    const counter = counterPath();
    const w = await world(counted(counter, "red"), { setup: ["echo no-setup >&2; exit 3"] }); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.settle(() => w.row()?.result !== undefined && w.row()!.result !== "pending");
      // mutation "setup failure read as the check's" -> red, red here.
      expect(w.row()).toMatchObject({ result: "unknown", why: "setup-failed", tail: "no-setup", runId: first });
      expect(runsOf(counter)).toBe(0);
      expect(baseCheckEvidence(t.h.store, "g", counted(counter, "red"))).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("only a required-check-failed on the task's own confirmed check asks; a different base or command runs once each; a run that cannot run is unknown", async () => {
    const counter = counterPath();
    const check = counted(counter, "red");
    // The run's rejection names a command that is not the task's required check: nothing is asked.
    const w = await world(check, { failingCommand: "node other.js" }); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      // mutation "any failing command is run" -> one row, red here.
      expect(listBaseChecks(t.h.store)).toEqual([]);
      const run = { groupId: "g", taskId: "a", runId: first };
      // mutation "any rejection category asks" -> true, red here.
      expect(write(t.deps, () => requestBaseCheck(t.h.store, run, { rejectCategory: "agent-rejected", failingCommand: check }))).toBe(false);
      expect(write(t.deps, () => requestBaseCheck(t.h.store, run, { rejectCategory: "required-check-failed", failingCommand: null }))).toBe(false);
      expect(write(t.deps, () => requestBaseCheck(t.h.store, run, { rejectCategory: "required-check-failed", failingCommand: check }))).toBe(true);
      // The same triple again: cached, not asked twice.
      expect(write(t.deps, () => requestBaseCheck(t.h.store, run, { rejectCategory: "required-check-failed", failingCommand: check }))).toBe(false);
      // Focus 3: another base (another group's, on a later commit) and another command are each their own row.
      git(t.repo, "commit", "-q", "--allow-empty", "-m", "later");
      const later = git(t.repo, "rev-parse", "HEAD"), base = w.base();
      const other = `echo run >> '${counter}'; true`;
      const pending = (key: { base: string; command: string }) => t.h.store.db.prepare("INSERT INTO base_check_results(repo_id,base,command,result,group_id,task_id,run_id,requested_at) VALUES ('repo',?,?,'pending','g','a',?,1)").run(key.base, key.command, first);
      write(t.deps, () => { pending({ base: later, command: check }); pending({ base, command: other }); pending({ base: "0".repeat(40), command: check }); });
      const runs = new Map<string, BaseCheckRun>();
      const deps = { store: t.h.store, roots: t.deps.roots, resolveRepository: t.deps.resolveRepository, write: <T>(action: () => T) => write(t.deps, action), stopped: () => false };
      for (let i = 0; i < 200 && listBaseChecks(t.h.store).some((row) => row.result === "pending"); i += 1) { await checkBases(deps, runs); await new Promise((resolve) => setTimeout(resolve, 20)); }
      expect(readBaseCheck(t.h.store, { repoId: "repo", base, command: check })?.result).toBe("red");
      expect(readBaseCheck(t.h.store, { repoId: "repo", base: later, command: check })?.result).toBe("red");
      expect(readBaseCheck(t.h.store, { repoId: "repo", base, command: other })?.result).toBe("green");
      // Focus 4: a base that cannot be checked out is unknown, never red.
      expect(readBaseCheck(t.h.store, { repoId: "repo", base: "0".repeat(40), command: check })).toMatchObject({ result: "unknown", why: expect.stringMatching(/^error: /) });
      expect(runsOf(counter)).toBe(3);
      // Answered rows are never run again.
      for (let i = 0; i < 3; i += 1) await checkBases(deps, runs);
      expect(runs.size).toBe(0);
      expect(runsOf(counter)).toBe(3);
      // Focus 4: a check that times out at the base is unknown, never red.
      const signal = new AbortController().signal;
      // mutation "treat unknown as red" (a timeout read as a red exit) -> red, red here.
      expect(await runBaseCheck(deps, t.repo, { base, command: "sleep 5", groupId: "g" }, [], 300, signal)).toEqual({ result: "unknown", tail: null, why: "timeout" });
      expect(await runBaseCheck(deps, t.repo, { base, command: other, groupId: "g" }, [], 5000, signal)).toEqual({ result: "green", tail: null, why: null });
    } finally { await t.h.dispose(); }
  });
});

describe("schema 24 -> 25: the base check table", () => {
  it("a v24 store opens at 25 with an empty base_check_results table that takes only the four results", async () => {
    const root = mkdtempSync(join(tmpdir(), "s25-")), dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir, now: () => 1000 })).close();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      raw.exec("DROP TABLE base_check_results");
      raw.prepare("UPDATE meta SET value='24' WHERE key='schemaVersion'").run();
      raw.close();
      const store = await openControlStore({ stateDir: dir, now: () => 2000 });
      try {
        expect(schemaVersion).toBe("25");
        expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("25");
        expect(store.db.prepare("SELECT COUNT(*) AS n FROM base_check_results").get()).toMatchObject({ n: 0 });
        const insert = (result: string) => () => store.db.prepare("INSERT INTO base_check_results(repo_id,base,command,result,group_id,task_id,run_id,requested_at) VALUES ('r',?,'c',?,'g','a','run-1',1)").run(result, result);
        for (const result of ["pending", "red", "green", "unknown"]) expect(insert(result)).not.toThrow();
        expect(insert("flaky")).toThrow(/CHECK/);
      } finally { store.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
