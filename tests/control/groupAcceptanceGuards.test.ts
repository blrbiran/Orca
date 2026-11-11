import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { write } from "../../src/control/executionDriver.js";
import { acceptGroups, type GroupAcceptanceCheck, type GroupAcceptanceDeps } from "../../src/control/groupAcceptance.js";
import { groupAcceptancePathOf } from "../../src/control/workspace.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester follow-up F §5 (#241 round E left these unwitnessed): the acceptance pass's guards. A driver stopped in the middle
// of a pass starts no check it could no longer abort, and a stopped pass changes nothing; a group whose dispatch is stopped
// has its acceptance neither started nor recorded until it resumes; and a group tip that moves while its check runs (or
// after it finished but before the pass read it) never gets the old tip's result: the old check is stopped and the new tip
// is checked again. Each criterion drives the pass itself (acceptGroups, the driver's own call) so it decides when a
// round happens; the state it starts from is a real one, reached by the driver: both tasks landed, the acceptance check
// started and the driver stopped under it (round E's criterion: nothing recorded).

type Harness = Awaited<ReturnType<typeof driverHarness>>;
type Checks = Map<string, GroupAcceptanceCheck>;
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const acceptanceRows = (t: Harness) => readGroupActivity(t.h.store, "g", 200).filter((entry) => entry.kind === "group-acceptance");
const tip = (t: Harness) => git(t.repo, "rev-parse", "refs/heads/orca/g");
const revisionOf = (t: Harness) => Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);

async function waitFor(predicate: () => boolean, what: string, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!predicate()) throw new Error(`timed out waiting for ${what}`);
}

interface Scene { t: Harness; log: string; hold: string; red: string; checks: Checks; deps: (stopped?: () => boolean) => GroupAcceptanceDeps }

/**
 * Only in the acceptance worktree: log `start <HEAD>`, wait while HOLD exists (bounded), log `end <HEAD>`, fail while RED
 * exists. Green everywhere else, so the tasks' own and post-merge checks pass.
 */
async function scene(): Promise<Scene> {
  const dir = mkdtempSync(join(tmpdir(), "orca-accg-"));
  const log = join(dir, "log"), hold = join(dir, "hold"), red = join(dir, "red");
  const check = `case "$PWD" in *group-acceptance-*) h=$(git rev-parse HEAD); echo "start $h" >> '${log}'; `
    + `i=0; while [ -f '${hold}' ] && [ $i -lt 600 ]; do sleep 0.05; i=$((i+1)); done; echo "end $h" >> '${log}'; test ! -f '${red}' ;; *) true ;; esac`;
  writeFileSync(hold, "");
  const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [check] });
  try {
    await t.claim(); await t.claim();
    const driver = t.driver();
    const deadline = Date.now() + 30_000;
    while (!lines(log).some((line) => line.startsWith("start ")) && Date.now() < deadline) {
      await driver.round();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await driver.stop();
    // The parked state: both tasks landed, the check that was running aborted and nothing recorded (round E's criterion).
    if (lines(log).length !== 1 || group(t).acceptance !== undefined || existsSync(groupAcceptancePathOf(t.deps.roots, "g"))) {
      throw new Error(`scene: not parked: ${JSON.stringify(lines(log))}`);
    }
  } catch (error) { await t.h.dispose(); throw error; }
  const checks: Checks = new Map();
  const deps = (stopped: () => boolean = () => false): GroupAcceptanceDeps => ({
    store: t.h.store, roots: t.deps.roots, resolveRepository: t.deps.resolveRepository, admissionGate: t.deps.admissionGate,
    write: (action) => write(t.deps, action), stopped,
  });
  return { t, log, hold, red, checks, deps };
}

function lines(log: string): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((line) => line !== "") : [];
}

/** A person's commit on orca/g, as round E's criterion moves the tip. */
function moveTip(t: Harness, name: string): string {
  const fix = join(t.h.root, `fix-${name}`);
  git(t.repo, "worktree", "add", "-q", fix, "orca/g");
  writeFileSync(join(fix, name), `${name}\n`);
  git(fix, "add", name);
  git(fix, "commit", "-qm", `person: ${name}`);
  git(t.repo, "worktree", "remove", fix);
  return tip(t);
}

async function settle(s: Scene): Promise<void> {
  await waitFor(() => s.checks.get("g")?.settled != null, "the acceptance check to settle");
}

async function dispose(s: Scene): Promise<void> {
  for (const check of s.checks.values()) check.controller.abort();
  await Promise.all([...s.checks.values()].map((check) => check.done));
  await s.t.h.dispose();
}

describe("the group acceptance pass's guards (tester follow-up F §5; E §5, #241)", { timeout: 120_000 }, () => {
  // mutation: drop `if (deps.stopped()) return false;` before the check starts in acceptGroup -> a check starts -> red
  it("a driver stopped while the pass is between its reads and the start starts no check and records nothing", async () => {
    const s = await scene(); try {
      let stopped = false;
      // stop() lands while the pass awaits git for this group (the tip read), after the pass's own loop check.
      const deps = { ...s.deps(() => stopped), resolveRepository: (repoId: string) => { stopped = true; return s.t.deps.resolveRepository(repoId); } };
      expect(await acceptGroups(deps, s.checks)).toBe(false);
      expect(s.checks.size).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(lines(s.log)).toHaveLength(1);
      expect(existsSync(groupAcceptancePathOf(s.t.deps.roots, "g"))).toBe(false);
      expect(group(s.t).acceptance).toBeUndefined();
    } finally { await dispose(s); }
  });

  // mutation: drop `if (deps.stopped()) break;` in acceptGroups -> the stale record is removed -> red
  it("a stopped driver's pass changes nothing, not even an acceptance recorded for an earlier tip", async () => {
    const s = await scene(); try {
      rmSync(s.hold); writeFileSync(s.red, "");
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      await settle(s);
      expect(await acceptGroups(s.deps(), s.checks)).toBe(true);
      const failed = group(s.t).acceptance;
      expect(failed).toMatchObject({ result: "failed", tip: tip(s.t) });
      moveTip(s.t, "moved");
      expect(await acceptGroups(s.deps(() => true), s.checks)).toBe(false);
      expect(group(s.t).acceptance).toEqual(failed);
      expect(s.checks.size).toBe(0);
      expect(lines(s.log).filter((line) => line.startsWith("start "))).toHaveLength(2);
    } finally { await dispose(s); }
  });

  // mutation: drop the stop_intents check in acceptGroup -> the paused group's check starts (and its result is recorded) -> red
  it("a group whose dispatch is stopped has its acceptance neither started nor recorded until it resumes", async () => {
    const s = await scene(); try {
      const command = (verb: "pause-dispatch" | "resume-dispatch", n: number) =>
        s.t.h.rawCommand(`${verb}-${n}`, revisionOf(s.t), verb, { kind: "group", groupId: "g" }, {}) as never;
      // Pending: paused before the pass starts it.
      expect(await s.t.service.pauseDispatch(command("pause-dispatch", 1))).not.toHaveProperty("error");
      for (let i = 0; i < 3; i += 1) expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      expect(s.checks.size).toBe(0);
      expect(lines(s.log)).toHaveLength(1);
      expect(group(s.t).acceptance).toBeUndefined();
      expect(await s.t.service.resumeDispatch(command("resume-dispatch", 2))).not.toHaveProperty("error");
      // Running: paused while the check runs; its answer is kept, not recorded, until the group resumes.
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      await waitFor(() => lines(s.log).length === 2, "the check to start");
      expect(await s.t.service.pauseDispatch(command("pause-dispatch", 3))).not.toHaveProperty("error");
      rmSync(s.hold);
      await settle(s);
      for (let i = 0; i < 3; i += 1) expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      expect(group(s.t).acceptance).toBeUndefined();
      expect(acceptanceRows(s.t)).toEqual([]);
      expect(await s.t.service.resumeDispatch(command("resume-dispatch", 4))).not.toHaveProperty("error");
      expect(await acceptGroups(s.deps(), s.checks)).toBe(true);
      expect(group(s.t).acceptance).toMatchObject({ result: "passed", tip: tip(s.t) });
      expect(lines(s.log).filter((line) => line.startsWith("start "))).toHaveLength(2);
    } finally { await dispose(s); }
  });

  // mutation: never abort an in-flight check whose tip moved (keep waiting on it) -> the old check ends, nothing reruns -> red
  it("a tip that moves while the check runs stops that check, records nothing for either tip, and checks the new tip", async () => {
    const s = await scene(); try {
      writeFileSync(s.red, "");
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      await waitFor(() => lines(s.log).length === 2, "the check to start");
      const old = tip(s.t);
      expect(lines(s.log)[1]).toBe(`start ${old}`);
      const moved = moveTip(s.t, "moved");
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      // The old check was killed: let it go and it never reaches its end.
      await waitFor(() => !existsSync(groupAcceptancePathOf(s.t.deps.roots, "g")), "the old check's worktree to go");
      rmSync(s.hold); rmSync(s.red);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(lines(s.log).some((line) => line === `end ${old}`)).toBe(false);
      expect(group(s.t).acceptance).toBeUndefined();
      expect(acceptanceRows(s.t)).toEqual([]);
      // The new tip is checked and recorded as its own.
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      await settle(s);
      expect(await acceptGroups(s.deps(), s.checks)).toBe(true);
      expect(lines(s.log).slice(2)).toEqual([`start ${moved}`, `end ${moved}`]);
      expect(group(s.t).acceptance).toMatchObject({ result: "passed", tip: moved });
      expect(acceptanceRows(s.t).map((row) => (row.body as { tip: string }).tip)).toEqual([moved]);
    } finally { await dispose(s); }
  });

  // mutation: drop `if (inFlight.tip !== tip) return false;` after a settled check -> the old tip's failure is recorded
  // under the new tip -> red
  it("a check that finished on a tip that moved before the pass read it is not recorded; the new tip is checked", async () => {
    const s = await scene(); try {
      rmSync(s.hold); writeFileSync(s.red, "");
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      await settle(s);
      const moved = moveTip(s.t, "moved");
      rmSync(s.red);
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      expect(group(s.t).acceptance).toBeUndefined();
      expect(acceptanceRows(s.t)).toEqual([]);
      expect(await acceptGroups(s.deps(), s.checks)).toBe(false);
      await settle(s);
      expect(await acceptGroups(s.deps(), s.checks)).toBe(true);
      expect(group(s.t).acceptance).toMatchObject({ result: "passed", tip: moved });
      expect(acceptanceRows(s.t).map((row) => (row.body as { result: string; tip: string })).map((b) => [b.result, b.tip])).toEqual([["passed", moved]]);
    } finally { await dispose(s); }
  });
});
