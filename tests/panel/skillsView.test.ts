import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { chmodSync, lstatSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { SyncskillOptions } from "../../src/skills/syncskill.js";
import { FIXTURE_OTHER_AGENT_ID } from "../control/fixtures/agents.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { loop } from "../control/fixtures/taskLoop.js";

/**
 * Syncskill integration spec §4.6 / §10.8 C19 (plan Task 7): the group view carries the task's frozen skill names on its
 * loop plan view, and a run's view carries the lock its drive record holds -- but never the snapshot's local path.
 */
const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { const pending = cleanups.reverse(); cleanups = []; for (const c of pending) await c(); });
function restoreWrite(path: string): void {
  let stat;
  try { stat = lstatSync(path); } catch { return; }
  if (stat.isSymbolicLink()) return;
  chmodSync(path, (stat.mode & 0o777) | 0o200 | (stat.isDirectory() ? 0o100 : 0));
  if (stat.isDirectory()) for (const entry of readdirSync(path)) restoreWrite(join(path, entry));
}
async function harness(skills: unknown | undefined) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-sv-")));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const bin = join(dir, "syncskill");
  await writeFile(bin, `#!/bin/sh\nexport FAKE_SYNCSKILL_MODE=inject-ok\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const o: SyncskillOptions = { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_LOG: join(dir, "calls.jsonl") } };
  const t = await driverHarness([{ taskId: "a", agent: { agent: FIXTURE_OTHER_AGENT_ID }, loop: skills === undefined ? loop("a") : { ...loop("a"), skills } }], { syncskill: o });
  cleanups.push(() => t.h.dispose());
  cleanups.push(() => restoreWrite(`${t.h.store.stateDir}.workspaces`));
  return t;
}

describe("the group view's skills (C19)", { timeout: 60_000 }, () => {
  it("gives a confirmed task's frozen names on its loop plan view, and the run's lock without the local directory", async () => {
    const t = await harness({ names: ["alpha"] });
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    const view = readControlGroup(t.h.store, "epoch", "g");
    expect(view.workItems[0]!.loopPlan!.frozenSkillNames).toEqual(["alpha"]);
    const recorded = t.body(runId).drive.skills as { dir: string; lock: unknown[] };
    expect(recorded.lock.length).toBe(1);
    const shown = view.runs.find((run) => run.runId === runId)!.skills;
    expect(shown).toEqual({ profile: null, lock: recorded.lock });
    expect(JSON.stringify(view)).not.toContain(recorded.dir);
  });

  it("gives no skills on either view for a task and run without them", async () => {
    const t = await harness(undefined);
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    const view = readControlGroup(t.h.store, "epoch", "g");
    expect(Object.keys(view.workItems[0]!.loopPlan!)).not.toContain("frozenSkillNames");
    expect(Object.keys(view.runs.find((run) => run.runId === runId)!)).not.toContain("skills");
  });
});
