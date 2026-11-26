import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { baseCheckNoteId, checkBases, runBaseCheck, type BaseCheckRun } from "../../src/control/baseCheck.js";
import { BASE_CHECK_EVIDENCE_PREFIX, baseCheckEvidence, baseCheckLine, baseCheckScopeOf, listBaseChecks, readBaseCheck, requestBaseCheck } from "../../src/control/baseCheckRecord.js";
import { replenishStartWakes, write } from "../../src/control/executionDriver.js";
import { liveNotesOf, LIVE_NOTES_FILE } from "../../src/control/liveNotes.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { openControlStore } from "../../src/control/store.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Pre-existing failures spec 2026-11-18 L3 (#341): after a task run ends `required-check-failed`, Orca runs that one command
 * once at the group's base commit (cached by repository, base and command) and the next attempt's prior failure says so when
 * it was red there. Green adds nothing; a base run that cannot run is "could not tell", never red; no retry rule changes.
 * Fix round 1 (Task 3 review): the newest asker owns a pending row (I-1); an `error:` unknown is asked again once (I-2); a
 * red answer reaches the task's running run as a live note (I-3).
 */

// Ruling (2026-11-18 tester batch D review 3, M3): this world was a one-attempt run that ended on its required check with
// that check as lastFailure -- a shape ccloop never reports (a rejection is in recentFailures only when it retries after
// it), and step C no longer asks for a run that ended on a verification rejection (A2 asks the final attempt's). C's ask is
// now played in ccloop's shape: attempt 1 was rejected on the check (lastFailure), attempt 2 ended on its budget.
const CAUSE = { cause: "budget-exhausted", phase: "execute" as const, retries: 0, detail: null };
const TAIL = "base.txt is here";
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
/** A directory outside every repository, removed after the file's tests. */
const tempDir = (): string => { const dir = mkdtempSync(join(tmpdir(), "base-check-")); temps.push(dir); return dir; };

/** A check that counts its own runs in `counter` and prints TAIL; red or green at the base; with `gate`, it waits until the gate exists. */
function counted(counter: string, atBase: "red" | "green", gate?: string): string {
  return `echo run >> '${counter}';${gate === undefined ? "" : ` [ -e '${gate}' ] || sleep 600;`} echo '${TAIL}' >&2; test ${atBase === "red" ? "!" : ""} -e base.txt`;
}
const runsOf = (counter: string): number => existsSync(counter) ? readFileSync(counter, "utf8").split("\n").filter(Boolean).length : 0;
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

async function world(check: string, options: { failingCommand?: string; setup?: string[]; behaviour?: () => FakeBehaviour } = {}) {
  const lastFailure = { rejectCategory: "required-check-failed", failingCommand: options.failingCommand ?? check, primaryTargetPaths: ["a"] };
  const t = await driverHarness([{ taskId: "a", requiredChecks: [check], ...(options.setup ? { contextExtra: { setupCommands: options.setup } } : {}) }],
    { behaviour: options.behaviour ?? (() => "failed"), workAttempts: () => 2, failure: () => ({ failureCause: CAUSE, lastFailure, currentAttempt: 2 }) });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const driver = t.driver();
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo, scheduleTaskResults: () => undefined });
  const blocked = async (runId: string, on = driver) => { await t.until(on, () => t.body(runId).state === "blocked", 120); return runId; };
  const redispatched = async (): Promise<string> => {
    replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
    const delivered = await deliverScheduledStart(t.dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => t.body(delivered.runId).drive?.prepared === true, 120);
    return delivered.runId;
  };
  const priorFailures = (runId: string) => (JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash)) as { work: { priorFailures?: Array<{ runId: string; evidence: string[] | null }> } }).work.priorFailures;
  /** Driver rounds, with a pause for the base run that goes on off the round, until `predicate`. */
  const settle = async (predicate: () => boolean, on = driver, max = 150): Promise<void> => {
    for (let i = 0; i < max && !predicate(); i += 1) { await on.round(); await pause(); }
    if (!predicate()) throw new Error("the expected state was not reached");
  };
  const row = () => listBaseChecks(t.h.store)[0];
  const base = () => git(t.repo, "rev-parse", "main");
  const notes = () => liveNotesOf(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)));
  const passDeps = () => ({ store: t.h.store, roots: t.deps.roots, resolveRepository: t.deps.resolveRepository, write: <T>(action: () => T) => write(t.deps, action), stopped: () => false });
  const sql = (statement: string, ...args: Array<string | number | null>) => write(t.deps, () => t.h.store.db.prepare(statement).run(...args));
  const pending = (key: { base: string; command: string; groupId?: string; taskId?: string; runId: string; why?: string | null; result?: string; attempts?: number }) =>
    sql("INSERT INTO base_check_results(repo_id,base,command,result,why,group_id,task_id,run_id,requested_at,attempts) VALUES ('repo',?,?,?,?,?,?,?,1,?)",
      key.base, key.command, key.result ?? "pending", key.why ?? null, key.groupId ?? "g", key.taskId ?? "a", key.runId, key.attempts ?? 1);
  return { t, driver, service, blocked, redispatched, priorFailures, settle, row, base, notes, passDeps, sql, pending };
}

/** checkBases rounds until no row is pending (or `max`). */
async function drain(deps: Parameters<typeof checkBases>[0], runs: Map<string, BaseCheckRun>, max = 200): Promise<void> {
  for (let i = 0; i < max && listBaseChecks(deps.store).some((row) => row.result === "pending"); i += 1) { await checkBases(deps, runs); await pause(); }
}

describe("L3: a failed check is run once at the group's base", { timeout: 180_000 }, () => {
  it("red at the base: one run, the row names who asked, and the next attempt carries the evidence line; the same failure again runs nothing", async () => {
    const counter = join(tempDir(), "runs");
    const w = await world(counted(counter, "red")); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.settle(() => w.row()?.result === "red");
      // Durable, attributed (Task 2 lists it): repository, base, command, result, tail, the asking task run, when.
      expect(w.row()).toMatchObject({ repoId: "repo", base: w.base(), command: counted(counter, "red"), result: "red", tail: TAIL, why: null, groupId: "g", taskId: "a", runId: first, attempts: 1 });
      expect(typeof w.row()!.requestedAt).toBe("number");
      expect(typeof w.row()!.at).toBe("number");
      expect(runsOf(counter)).toBe(1);
      // No run of the task is running: no live note (the next attempt is told through its prior failures).
      expect(w.notes()).toEqual([]);
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      const second = await w.redispatched();
      // mutation "drop the evidence line" (priorFailureOf never reads the base check) -> evidence null, red here.
      expect(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: first, evidence: [`${BASE_CHECK_EVIDENCE_PREFIX}${TAIL}`] })]);
      // Focus 3: the second attempt fails the same command at the same base -- nothing runs again.
      await w.blocked(second);
      for (let i = 0; i < 10; i += 1) { await w.driver.round(); await pause(); }
      // mutation "drop the cache" (the request re-opens an answered row) -> a second base run, red here.
      expect(runsOf(counter)).toBe(1);
      expect(listBaseChecks(t.h.store)).toHaveLength(1);
      expect(w.row()).toMatchObject({ result: "red", runId: first });
    } finally { await t.h.dispose(); }
  });

  it("stores parsed red test identities under the exact base command and setup key", async () => {
    const output = [
      "TAP version 13", "# Subtest: tests/base-check.test.mjs", "    # Subtest: base failure",
      "    not ok 1 - is recognized", "      ---", "      error: AssertionError", "      actual: 1", "      expected: 2",
      "      operator: strictEqual", "      ...", "not ok 1 - tests/base-check.test.mjs", "  ---",
      "  error: 1 subtest failed", "  failureType: subtestsFailed", "  ...", "# tests 1", "# pass 0", "# fail 1",
    ].join("\n");
    const check = `node -e 'process.stdout.write(${JSON.stringify(output)});process.exit(1)'`;
    const w = await world(check); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.settle(() => w.row()?.result === "red");
      const rows = t.h.store.db.prepare("SELECT * FROM acceptance_failure_baselines").all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        repo_id: "repo", base: w.base(), command: check, setup_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        reporter: "node-test-tap-v1", identity: expect.stringMatching(/^[a-f0-9]{64}$/), source: "task-base-check",
        group_id: "g", run_id: first,
      });
      expect(Number(rows[0]!.first_seen_at)).toBe(Number(rows[0]!.last_seen_at));
    } finally { await t.h.dispose(); }
  });

  it("green at the base is recorded and adds nothing to the next attempt", async () => {
    const counter = join(tempDir(), "runs");
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

  it("no retry rule changes: the ladder re-dispatches while the base run is still going; red arriving then reaches that run as a live note (I-3)", async () => {
    const counter = join(tempDir(), "runs");
    let failing = true;
    const w = await world(counted(counter, "red"), { behaviour: () => failing ? "failed" : "stoppable-silent" }); const { t } = w; try {
      let release!: () => void, entered = false;
      const held = new Promise<void>((resolve) => { release = resolve; });
      t.deps.beforeScratchRemoved = async () => { entered = true; await held; };
      const first = await w.blocked(await t.claim());
      await w.settle(() => entered);
      expect(w.row()?.result).toBe("pending");
      expect((await w.service.systemDebugPass()).redispatched).toEqual(["g:a"]);
      failing = false;
      const second = await w.redispatched();
      // A2 does not wait: the attempt prepared before the answer is told nothing in its prior failures.
      expect(w.priorFailures(second)).toEqual([expect.objectContaining({ runId: first, evidence: null })]);
      release();
      await w.settle(() => w.row()?.result === "red");
      const line = `${BASE_CHECK_EVIDENCE_PREFIX}${TAIL}`;
      // mutation "no live note on red" -> [], red here.
      expect(w.notes()).toEqual([expect.objectContaining({ noteId: baseCheckNoteId(second), taskId: "a", text: line, by: "orca", state: "queued" })]);
      const file = JSON.parse(readFileSync(join(t.body(second).drive.sourceDir, LIVE_NOTES_FILE), "utf8")) as { notes: Array<{ id: string; text: string }> };
      expect(file.notes).toEqual([expect.objectContaining({ id: baseCheckNoteId(second), text: line })]);
    } finally { await t.h.dispose(); }
  });

  it("a driver stopped mid base run records nothing; the next driver runs it exactly once (I-4)", async () => {
    const dir = tempDir(), counter = join(dir, "runs"), gate = join(dir, "gate");
    const check = counted(counter, "red", gate);
    const w = await world(check); const { t } = w; try {
      await w.blocked(await t.claim());
      await w.settle(() => runsOf(counter) === 1);
      // stop() aborts the base run (its command sleeps 600 s; the task's per-attempt bound is 60 s) rather than waiting it out.
      const stopping = Date.now();
      await w.driver.stop();
      // mutation "stop() never aborts a base run" -> stop() waits for the 60 s bound, red here.
      expect(Date.now() - stopping).toBeLessThan(30_000);
      // mutation "an abort records an answer" (the aborted run read as unknown) -> not pending, red here.
      expect(w.row()).toMatchObject({ result: "pending", at: null });
      await import("node:fs/promises").then((fs) => fs.writeFile(gate, ""));
      const next = t.driver();
      await w.settle(() => w.row()?.result === "red", next);
      for (let i = 0; i < 5; i += 1) { await next.round(); await pause(); }
      expect(runsOf(counter)).toBe(2);
    } finally { await t.h.dispose(); }
  });

  it("a setup that fails at the base is unknown -- recorded, never red, and nothing is claimed", async () => {
    const counter = join(tempDir(), "runs");
    const w = await world(counted(counter, "red"), { setup: ["echo no-setup >&2; exit 3"] }); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.settle(() => w.row()?.result !== undefined && w.row()!.result !== "pending");
      // mutation "setup failure read as the check's" -> red, red here.
      expect(w.row()).toMatchObject({ result: "unknown", why: "setup-failed", tail: "no-setup", runId: first });
      expect(runsOf(counter)).toBe(0);
      expect(baseCheckEvidence(t.h.store, "g", counted(counter, "red"), 4096)).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("who asks: only a required-check-failed of a task's own run on its confirmed check; the newest asker owns a pending row; an error unknown is asked once more", async () => {
    const counter = join(tempDir(), "runs");
    const check = counted(counter, "red");
    // The run's rejection names a command that is not the task's required check: nothing is asked.
    const w = await world(check, { failingCommand: "node other.js" }); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      await w.driver.stop();
      // mutation "any failing command is run" -> one row, red here.
      expect(listBaseChecks(t.h.store)).toEqual([]);
      const run = { groupId: "g", taskId: "a", runId: first };
      const ask = (who: typeof run & { mode?: unknown; recoveryOf?: unknown }, last: { rejectCategory: string; failingCommand: string | null }) => write(t.deps, () => requestBaseCheck(t.h.store, who, last));
      const failed = { rejectCategory: "required-check-failed", failingCommand: check };
      // mutation "any rejection category asks" -> true, red here.
      expect(ask(run, { rejectCategory: "agent-rejected", failingCommand: check })).toBe(false);
      expect(ask(run, { rejectCategory: "required-check-failed", failingCommand: null })).toBe(false);
      // mutation "a saved-result verification or a recovery run asks" -> true, red here.
      expect(ask({ ...run, mode: "verify-saved-result" }, failed)).toBe(false);
      expect(ask({ ...run, recoveryOf: { runId: "run-old" } }, failed)).toBe(false);
      expect(listBaseChecks(t.h.store)).toEqual([]);
      const base = w.base(), key = { repoId: "repo", base, command: check };
      const deps = w.passDeps(), runs = new Map<string, BaseCheckRun>();
      // I-1: an archived group asked first; its pending row waits (nothing runs for an archived asker) ...
      w.sql("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g-old',1,1,?)", JSON.stringify({ archived: { at: 1, actor: "t" } }));
      w.pending({ base, command: check, groupId: "g-old", runId: "run-old" });
      for (let i = 0; i < 3; i += 1) { await checkBases(deps, runs); await pause(); }
      // mutation "the pass runs an archived asker's row" -> a run starts, red here.
      expect([runs.size, runsOf(counter)]).toEqual([0, 0]);
      // ... until a live group asks: it becomes the asker and the row runs for it.
      // mutation "ON CONFLICT DO NOTHING (the first asker keeps it)" -> false and the row never runs, red here.
      expect(ask(run, failed)).toBe(true);
      expect(readBaseCheck(t.h.store, key)).toMatchObject({ result: "pending", groupId: "g", runId: first, attempts: 1 });
      await drain(deps, runs);
      expect(readBaseCheck(t.h.store, key)).toMatchObject({ result: "red", groupId: "g", tail: TAIL });
      // An answered row is not asked again (the cache).
      expect(ask({ ...run, runId: "run-later" }, failed)).toBe(false);
      // I-2: an `error:` unknown is asked again by a different run, at most once more; the same run never re-asks it.
      w.sql("UPDATE base_check_results SET result='unknown', why='error: index.lock exists', tail=NULL WHERE command=?", check);
      expect(ask(run, failed)).toBe(false);
      // mutation "an error unknown stays cached" -> false, red here.
      expect(ask({ ...run, runId: "run-2" }, failed)).toBe(true);
      expect(readBaseCheck(t.h.store, key)).toMatchObject({ result: "pending", why: null, runId: "run-2", attempts: 2 });
      await drain(deps, runs);
      expect(readBaseCheck(t.h.store, key)?.result).toBe("red");
      w.sql("UPDATE base_check_results SET result='unknown', why='error: again' WHERE command=?", check);
      // mutation "no attempts cap" -> true, red here.
      expect(ask({ ...run, runId: "run-3" }, failed)).toBe(false);
      // A timeout or a failed setup stays cached whoever asks.
      for (const why of ["timeout", "setup-failed", "not-runnable"]) {
        w.sql("UPDATE base_check_results SET result='unknown', why=?, attempts=1 WHERE command=?", why, check);
        expect(ask({ ...run, runId: `run-${why}` }, failed)).toBe(false);
      }
      expect(runsOf(counter)).toBe(2);
    } finally { await t.h.dispose(); }
  });

  it("the pass: a different base or command runs once each, one per repository at a time; a stopped asker, an unresolvable contract and an unusable base never run red", async () => {
    const counter = join(tempDir(), "runs");
    const check = counted(counter, "red");
    const w = await world(check, { failingCommand: "node other.js" }); const { t } = w; try {
      const first = await w.blocked(await t.claim());
      await w.driver.stop();
      const base = w.base(), deps = w.passDeps(), runs = new Map<string, BaseCheckRun>();
      git(t.repo, "commit", "-q", "--allow-empty", "-m", "later");
      const later = git(t.repo, "rev-parse", "HEAD");
      const other = `echo run >> '${counter}'; true`;
      // A stopped asker's row waits.
      w.sql("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES ('g','stop',1,'{}')");
      w.pending({ base, command: check, runId: first });
      await checkBases(deps, runs);
      // mutation "the pass runs a stopped asker's row" -> one run, red here.
      expect(runs.size).toBe(0);
      w.sql("DELETE FROM stop_intents WHERE group_id='g'");
      // An archived asker's row waits too (I-1: it runs again once a live group asks).
      const live = String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body);
      w.sql("UPDATE groups SET body=? WHERE id='g'", JSON.stringify({ ...JSON.parse(live), archived: { at: 1, actor: "t" } }));
      await checkBases(deps, runs);
      // mutation "the pass runs an archived asker's row" -> one run, red here.
      expect(runs.size).toBe(0);
      w.sql("UPDATE groups SET body=? WHERE id='g'", live);
      // A row whose asking task has no confirmed contract (reachable only by a row written outside step C) waits, logged.
      w.pending({ base: later, command: other, taskId: "no-such-task", runId: first });
      w.pending({ base: later, command: check, runId: first });
      w.pending({ base, command: other, runId: first });
      w.pending({ base: "0".repeat(40), command: check, runId: first });
      await checkBases(deps, runs);
      // M-5: one base run per repository in flight.
      // mutation "no per-repository bound" -> 4 in flight, red here.
      expect(runs.size).toBe(1);
      for (let i = 0; i < 300 && listBaseChecks(t.h.store).filter((row) => row.result === "pending").length > 1; i += 1) { await checkBases(deps, runs); await pause(); }
      expect(readBaseCheck(t.h.store, { repoId: "repo", base, command: check })?.result).toBe("red");
      expect(readBaseCheck(t.h.store, { repoId: "repo", base: later, command: check })?.result).toBe("red");
      expect(readBaseCheck(t.h.store, { repoId: "repo", base, command: other })?.result).toBe("green");
      // mutation "error => red" -> red, red here.
      expect(readBaseCheck(t.h.store, { repoId: "repo", base: "0".repeat(40), command: check })).toMatchObject({ result: "unknown", why: expect.stringMatching(/^error: /) });
      // mutation "an unresolvable contract runs with no setup" -> answered, red here.
      expect(readBaseCheck(t.h.store, { repoId: "repo", base: later, command: other })?.result).toBe("pending");
      expect(runsOf(counter)).toBe(3);
      // Answered rows are never run again.
      for (let i = 0; i < 3; i += 1) await checkBases(deps, runs);
      expect([runs.size, runsOf(counter)]).toEqual([0, 3]);
      const signal = new AbortController().signal;
      // Focus 4: a timeout, and a command sh cannot run (M-2), are unknown, never red.
      // mutation "treat unknown as red" (a timeout read as a red exit) -> red, red here.
      expect(await runBaseCheck(deps, t.repo, { base, command: "sleep 5", groupId: "g" }, [], 300, signal)).toEqual({ result: "unknown", tail: null, why: "timeout" });
      // mutation "126/127 read as red" -> red, red here.
      expect(await runBaseCheck(deps, t.repo, { base, command: "no-such-command-341", groupId: "g" }, [], 5000, signal)).toMatchObject({ result: "unknown", why: "not-runnable" });
      expect(await runBaseCheck(deps, t.repo, { base, command: "exit 126", groupId: "g" }, [], 5000, signal)).toMatchObject({ result: "unknown", why: "not-runnable" });
      expect(await runBaseCheck(deps, t.repo, { base, command: "exit 2", groupId: "g" }, [], 5000, signal)).toMatchObject({ result: "red" });
    } finally { await t.h.dispose(); }
  });

  it("a group with no single tree (multi-directory, dir, dir flow) has no base-check scope", async () => {
    const w = await world("true"); const { t } = w; try {
      await w.blocked(await t.claim());
      await w.driver.stop();
      const original = String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body);
      const withBody = (extra: Record<string, unknown>) => w.sql("UPDATE groups SET body=? WHERE id='g'", JSON.stringify({ ...JSON.parse(original), ...extra }));
      expect(baseCheckScopeOf(t.h.store, "g")).toEqual({ repoId: "repo", base: w.base() });
      // mutation "scope ignores the group kind" -> a scope, red here (each of the three).
      withBody({ multiDir: { project: "p", dirs: [{ key: "a", repoId: "repo", kind: "repo" }, { key: "b", repoId: "repo-2", kind: "repo" }] } });
      expect(baseCheckScopeOf(t.h.store, "g")).toBeNull();
      withBody({ dirWorkspace: { dir: "/folder", vaultId: "a".repeat(64) } });
      expect(baseCheckScopeOf(t.h.store, "g")).toBeNull();
      w.sql("INSERT INTO flow_runs(id,group_id,template_ref,template_sha256,workspace,vault_id,params_sha256,pool_tokens,state,revision,body) VALUES ('fr','g','t','x','{\"kind\":\"dir\"}',NULL,'x',0,'running',0,'{}')");
      withBody({ flow: { role: "parent", flowRunId: "fr" } });
      expect(baseCheckScopeOf(t.h.store, "g")).toBeNull();
      w.sql("UPDATE groups SET body=? WHERE id='g'", original);
      w.sql("DELETE FROM flow_runs WHERE id='fr'");
    } finally { await t.h.dispose(); }
  });

  it("the evidence line keeps the end of a long tail, within the bound (M-1)", () => {
    const tail = `${"é".repeat(3000)}\nError: the real failure`;
    const line = baseCheckLine(tail, 4096);
    expect(line.startsWith(BASE_CHECK_EVIDENCE_PREFIX)).toBe(true);
    // mutation "cut from the end (headBytes)" -> the end is lost, red here.
    expect(line.endsWith("Error: the real failure")).toBe(true);
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(4096);
    expect(line).toMatch(/…\[\d+ bytes omitted\]/);
    expect(baseCheckLine("short", 4096)).toBe(`${BASE_CHECK_EVIDENCE_PREFIX}short`);
  });
});

// Ruling: the user authorized rewriting necessary criteria in this session (2026-11-26); opening a v24 store now upgrades through schema 26.
describe("schema 24 -> 26: the base check table", () => {
  it("a v24 store opens at the current schema with an empty base_check_results table that takes only the four results", async () => {
    const root = mkdtempSync(join(tmpdir(), "s25-")), dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir, now: () => 1000 })).close();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      raw.exec("DROP TABLE base_check_results");
      raw.prepare("UPDATE meta SET value='24' WHERE key='schemaVersion'").run();
      raw.close();
      const store = await openControlStore({ stateDir: dir, now: () => 2000 });
      try {
        expect(schemaVersion).toBe("26");
        expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("26");
        expect(store.db.prepare("SELECT COUNT(*) AS n FROM base_check_results").get()).toMatchObject({ n: 0 });
        const insert = (result: string) => () => store.db.prepare("INSERT INTO base_check_results(repo_id,base,command,result,group_id,task_id,run_id,requested_at) VALUES ('r',?,'c',?,'g','a','run-1',1)").run(result, result);
        for (const result of ["pending", "red", "green", "unknown"]) expect(insert(result)).not.toThrow();
        expect(insert("flaky")).toThrow(/CHECK/);
        expect(store.db.prepare("SELECT attempts FROM base_check_results WHERE base='red'").get()).toEqual({ attempts: 1 });
      } finally { store.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
