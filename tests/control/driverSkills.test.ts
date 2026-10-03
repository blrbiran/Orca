import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExecutionDriver, stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { SyncskillOptions } from "../../src/skills/syncskill.js";
import { FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { requestState, stop, type Harness } from "./fixtures/handoffHarness.js";
import { loop } from "./fixtures/taskLoop.js";

/**
 * Syncskill integration spec §10.6 / §10.8 C5, C6, C10, C11, C17 (plan Task 6). A2 injects the task's frozen skill set
 * into `<workspacesRoot>/skills-<runId>` through the (fake) syncskill, makes the snapshot read-only, records the lock on
 * the drive record and hands ccloop the directory as `work.skillPluginDir`. A run without skills spawns nothing and its
 * envelope has no such key (the golden hash is pinned in startEnvelope.test.ts). Any failure blocks at A2 by name.
 * The directory is removed by runId wherever the run's workspace is: step E, a continuation's predecessor cleanup,
 * and restartRun -- including for a run blocked before A2 recorded `skills`.
 */
const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const CLAUDE = { agent: FIXTURE_OTHER_AGENT_ID };
let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  const pending = cleanups.reverse();
  cleanups = [];
  const errors: unknown[] = [];
  for (const c of pending) { try { await c(); } catch (error) { errors.push(error); } }
  if (errors.length > 0) throw errors[0];
});

/** A2 leaves a snapshot read-only; a scenario that stops before the run is cleaned gives write back so the harness can dispose. */
function restoreWrite(path: string): void {
  let stat;
  try { stat = lstatSync(path); } catch { return; }
  if (stat.isSymbolicLink()) return;
  chmodSync(path, (stat.mode & 0o777) | 0o200 | (stat.isDirectory() ? 0o100 : 0));
  if (stat.isDirectory()) for (const entry of readdirSync(path)) restoreWrite(join(path, entry));
}

/** Push after the harness's own dispose, so it runs before it. */
function disposeWithSnapshots(t: Harness): void {
  cleanups.push(() => t.h.dispose());
  cleanups.push(() => restoreWrite(`${t.h.store.stateDir}.workspaces`));
}

/** A fake syncskill (tests/skills/fixtures/fake-syncskill.mjs) answering in `mode` (changeable), its argv logged per call. */
async function fakeSyncskill(initial: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-driver-skills-")));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const bin = join(dir, "syncskill");
  const modeFile = join(dir, "mode");
  await writeFile(modeFile, initial);
  // The mode is read per call, so one harness can confirm, then have A2's inject fail.
  await writeFile(bin, `#!/bin/sh\nexport FAKE_SYNCSKILL_MODE="$(cat '${modeFile}')"\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const log = join(dir, "calls.jsonl");
  const o: SyncskillOptions = { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_LOG: log } };
  const calls = (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]) : []);
  return { o, calls, mode: (next: string) => writeFileSync(modeFile, next) };
}

const withSkills = (taskId: string, skills: unknown) => ({ ...loop(taskId), skills });
const modeOf = (path: string): number => statSync(path).mode & 0o777;
const skillsDirOf = (t: Harness, runId: string): string => `${t.h.store.stateDir}.workspaces/skills-${runId}`;
const envelopeOf = (t: Harness, runId: string) => JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash));

async function skillsHarness(mode = "inject-ok", names: string[] = ["alpha"]) {
  const fake = await fakeSyncskill(mode);
  const t = await driverHarness([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { names }) }], { syncskill: fake.o });
  disposeWithSnapshots(t);
  return { t, fake };
}

describe("A2 injects the frozen skill set (C5, C6)", { timeout: 60_000 }, () => {
  it("writes the snapshot and the plugin manifest, read-only and private, records the lock and hands ccloop the directory", async () => {
    const { t, fake } = await skillsHarness();
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    const dir = realpathSync(skillsDirOf(t, runId));
    const drive = t.body(runId).drive;
    expect(drive.prepared).toBe(true);
    // The fake was asked for exactly the frozen names, into <dir>/skills.
    expect(fake.calls()).toEqual([["--json", "inject", "--skills", "alpha", "--target", join(dir, "skills")]]);
    expect(readFileSync(join(dir, "skills", "alpha", "SKILL.md"), "utf8")).toBe("# alpha\n");
    expect(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).toBe(JSON.stringify({ name: "orca-run-skills", version: "0.0.0" }));
    expect(modeOf(join(dir, ".claude-plugin", "plugin.json"))).toBe(0o600);
    expect(modeOf(dir)).toBe(0o700);
    expect(modeOf(join(dir, ".claude-plugin"))).toBe(0o700);
    // The agent cannot edit the snapshot it is given: no write bit anywhere under <dir>/skills, and a write is refused.
    for (const path of [join(dir, "skills"), join(dir, "skills", "alpha"), join(dir, "skills", "alpha", "SKILL.md")]) expect(modeOf(path) & 0o222).toBe(0);
    expect(() => writeFileSync(join(dir, "skills", "alpha", "extra.md"), "x")).toThrow(/EACCES/);
    // The recorded lock is syncskill's answer, which is what its lock file holds -- not something rebuilt from the frozen names.
    const lockFile = JSON.parse(readFileSync(join(dir, "skills", "syncskill-lock.json"), "utf8")) as { skills: unknown[] };
    expect(drive.skills).toEqual({ dir, profile: null, lock: lockFile.skills });
    expect(drive.skills.lock[0].content_md5).toBe("md5-alpha");
    expect(envelopeOf(t, runId).work.skillPluginDir).toBe(dir);
  });

  it("gives a run without skills no directory, no syncskill spawn and no skillPluginDir key", async () => {
    const fake = await fakeSyncskill("inject-ok");
    const t = await driverHarness([{ taskId: "a", agent: CLAUDE, loop: loop("a") }], { syncskill: fake.o });
    disposeWithSnapshots(t);
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    expect(t.body(runId).drive).toMatchObject({ prepared: true, skills: null });
    expect(Object.keys(envelopeOf(t, runId).work).sort()).toEqual(["base", "contract", "kind", "sourceDir", "targetRepo"]);
    expect(existsSync(skillsDirOf(t, runId))).toBe(false);
    expect(fake.calls()).toEqual([]);
  });

  it("replaces a leftover snapshot from an A2 that died after injecting, rather than reusing it", async () => {
    const { t } = await skillsHarness();
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    // What a crashed A2 leaves: a read-only snapshot of something else, and no recorded `skills`.
    const dir = skillsDirOf(t, runId);
    mkdirSync(join(dir, "skills", "stale"), { recursive: true });
    writeFileSync(join(dir, "skills", "stale", "SKILL.md"), "stale\n");
    for (const path of [join(dir, "skills", "stale", "SKILL.md"), join(dir, "skills", "stale"), join(dir, "skills")]) chmodSync(path, 0o500);
    expect(await stepA2(t.deps, runId)).toBe(true);
    expect(t.body(runId).drive.prepared).toBe(true);
    expect(existsSync(join(dir, "skills", "stale"))).toBe(false);
    expect(existsSync(join(dir, "skills", "alpha", "SKILL.md"))).toBe(true);
  });
});

describe("A2 blocks a run whose skills cannot be injected (C10)", { timeout: 60_000 }, () => {
  it("blocks by syncskill's error code when the inject fails, and sends nothing to ccloop", async () => {
    const { t, fake } = await skillsHarness();
    fake.mode("inject-not-found");
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "blocked");
    expect(t.body(runId).drive).toMatchObject({ blockedAt: "A2", blockedReason: "skills-inject-failed:syncskill-failed:E_SKILL_NOT_FOUND", prepared: false, skills: null, envelopeHash: null });
    expect(t.fake.calls.accept).toHaveLength(0);
  });

  it("blocks a snapshot whose lock does not name exactly the frozen skills, rather than run with other ones", async () => {
    const { t, fake } = await skillsHarness();
    fake.mode("inject-renamed");
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "blocked");
    expect(t.body(runId).drive).toMatchObject({ blockedAt: "A2", blockedReason: "skills-inject-failed:syncskill-output-invalid", prepared: false, skills: null });
    expect(t.fake.calls.accept).toHaveLength(0);
  });

  // Fix round 1 (review I2c): a failure that is not syncskill's is blocked by its own words, not swallowed or renamed.
  it("blocks by the error's own text when the snapshot directory cannot be made", async () => {
    const { t, fake } = await skillsHarness();
    const runId = await t.claim();
    const root = `${t.h.store.stateDir}.workspaces`;
    // The crash seam runs right after the workspace exists: the workspaces root then refuses the snapshot's mkdir.
    const driver = createExecutionDriver({ ...t.deps, crash: (at) => { if (at === "A2-after-workspace") chmodSync(root, 0o500); } });
    try { await t.until(driver, () => t.body(runId).state === "blocked"); } finally { chmodSync(root, 0o700); }
    expect(t.body(runId).drive).toMatchObject({ blockedAt: "A2", blockedReason: `skills-inject-failed:EACCES: permission denied, mkdir '${skillsDirOf(t, runId)}'`, prepared: false, skills: null });
    expect(fake.calls()).toEqual([]);
  });

  it("blocks as unconfigured when the driver has no ORCA_SYNCSKILL_BIN, never running without the skills", async () => {
    const { t, fake } = await skillsHarness();
    const runId = await t.claim();
    const { syncskill: _configured, ...unconfigured } = t.deps;
    const driver = createExecutionDriver(unconfigured);
    await t.until(driver, () => t.body(runId).state === "blocked");
    expect(t.body(runId).drive).toMatchObject({ blockedAt: "A2", blockedReason: "skills-inject-failed:syncskill-unconfigured", prepared: false, skills: null });
    expect(t.fake.calls.accept).toHaveLength(0);
    expect(fake.calls()).toEqual([]);
  });
});

describe("the snapshot goes with the run's workspace, by runId (C11, C17)", { timeout: 60_000 }, () => {
  it("is removed, read-only as it is, once the run settles (step E)", async () => {
    const { t } = await skillsHarness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "settled" && t.body(runId).drive.cleanedUp === true);
    expect(t.body(runId).drive.cleanupError).toBe(null);
    expect(t.body(runId).drive.skills).not.toBe(null);
    expect(existsSync(skillsDirOf(t, runId))).toBe(false);
  });

  it("is removed by restartRun for a run blocked at A2 before it recorded any `skills`", async () => {
    const { t, fake } = await skillsHarness();
    fake.mode("inject-not-found");
    const runId = await t.claim();
    const driver = t.driver();
    await t.until(driver, () => t.body(runId).state === "blocked");
    expect(t.body(runId).drive.skills).toBe(null);
    // The residue spec §10.9 names: the blocked run keeps its directory until its workspace is cleaned.
    expect(existsSync(skillsDirOf(t, runId))).toBe(true);
    const [requestId] = await stop(t);
    await t.until(driver, () => requestState(t, requestId!) === "settled-restartable");
    expect(t.body(runId).drive.cleanupError).toBe(null);
    expect(existsSync(skillsDirOf(t, runId))).toBe(false);
  });

  it("a continuation removes its predecessor's snapshot and injects its own", async () => {
    const fake = await fakeSyncskill("inject-ok");
    let behaviour: "stoppable" | "succeed" = "stoppable";
    const t = await driverHarness([{ taskId: "a", agent: CLAUDE, loop: withSkills("a", { names: ["alpha"] }) }], { syncskill: fake.o, behaviour: () => behaviour });
    disposeWithSnapshots(t);
    const predecessor = await t.claim();
    const driver = t.driver();
    await t.until(driver, () => t.body(predecessor).state === "accepted");
    const [requestId] = await stop(t);
    await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
    // Parked held: the predecessor's snapshot is still there (ccloop may re-read its envelope until the workspace goes).
    expect(existsSync(skillsDirOf(t, predecessor))).toBe(true);
    behaviour = "succeed";
    const registered = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: predecessor, checkpointId: t.body(predecessor).checkpointId }] } as never));
    if ("error" in registered) throw new Error(JSON.stringify(registered.error));
    const claimed = await deliverScheduledStart(t.dispatch, "g");
    if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
    const continuation = claimed.runId;
    await t.until(driver, () => t.body(continuation).drive?.prepared === true);
    expect(existsSync(skillsDirOf(t, predecessor))).toBe(false);
    expect(t.body(predecessor).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
    const dir = realpathSync(skillsDirOf(t, continuation));
    expect(existsSync(join(dir, "skills", "alpha", "SKILL.md"))).toBe(true);
    expect(t.body(continuation).drive.skills.dir).toBe(dir);
    expect(envelopeOf(t, continuation).work.skillPluginDir).toBe(dir);
    // Injected afresh (spec §10.6): one inject per run.
    expect(fake.calls().filter((argv) => argv.includes("inject"))).toHaveLength(2);
  });
});
