import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, chmodSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { FIXTURE_OTHER_AGENT_ID } from "./fixtures/agents.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";

/**
 * Syncskill integration spec §10.8 C5 against a real syncskill built from its main (fix round 1, review I1). Gated at run
 * time with ctx.skip() on ORCA_SYNCSKILL_REAL_BIN (a built dist/index.js), as tests/skills/syncskillReal.test.ts is, and
 * spawned through the same wrapper. Rule 17: SYNCSKILL_DIR and HOME are temp dirs; the real ~/.syncskill is snapshotted
 * before and after.
 */
const REAL = process.env.ORCA_SYNCSKILL_REAL_BIN;
let cleanups: Array<() => Promise<void> | void> = [];
beforeEach((ctx) => { if (REAL === undefined || REAL === "") ctx.skip(); });
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

/** path:size:mtime:content for every file below root, sorted; "absent" when root does not exist (syncskillReal.test.ts). */
function snapshot(root: string): string[] | "absent" {
  if (!existsSync(root)) return "absent";
  const walk = (dir: string, prefix: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const s = statSync(full);
    return s.isDirectory() ? [`${prefix}${entry}/`, ...walk(full, `${prefix}${entry}/`)] : [`${prefix}${entry}:${s.size}:${s.mtimeMs}:${readFileSync(full).toString("base64")}`];
  });
  return walk(root, "").sort();
}

function restoreWrite(path: string): void {
  let stat;
  try { stat = lstatSync(path); } catch { return; }
  if (stat.isSymbolicLink()) return;
  chmodSync(path, (stat.mode & 0o777) | 0o200 | (stat.isDirectory() ? 0o100 : 0));
  if (stat.isDirectory()) for (const entry of readdirSync(path)) restoreWrite(join(path, entry));
}

describe("A2 with a real syncskill (spec §10.8 C5)", { timeout: 60_000 }, () => {
  it("injects the frozen skill, private and read-only, and records exactly the lock file's entries", async () => {
    const realRoot = join(homedir(), ".syncskill");
    const realBefore = snapshot(realRoot);
    const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-real-a2-")));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const home = join(dir, "home");
    const syncDir = join(dir, "sync");
    await mkdir(join(syncDir, "skills", "alpha"), { recursive: true });
    await writeFile(join(syncDir, "skills", "alpha", "SKILL.md"), "# alpha", "utf8");
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    await writeFile(join(syncDir, "config.json"), JSON.stringify({ version: 1, conflict_resolution: "manual", agents: { claude: join(home, ".claude", "skills") }, links: {}, servers: {}, sources: {} }), "utf8");
    const bin = join(dir, "syncskill");
    await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${REAL}' "$@"\n`, { mode: 0o755 });
    const syncskill = { bin, env: { ...process.env, HOME: home, SYNCSKILL_DIR: syncDir } };

    const t = await driverHarness([{ taskId: "a", agent: { agent: FIXTURE_OTHER_AGENT_ID }, loop: { ...loop("a"), skills: { names: ["alpha"] } } }], { syncskill });
    cleanups.push(() => t.h.dispose());
    cleanups.push(() => restoreWrite(`${t.h.store.stateDir}.workspaces`));
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    const drive = t.body(runId).drive;
    expect(drive).toMatchObject({ prepared: true, blockedReason: null });
    const skillsDir = realpathSync(`${t.h.store.stateDir}.workspaces/skills-${runId}`);
    expect(readFileSync(join(skillsDir, "skills", "alpha", "SKILL.md"), "utf8")).toBe("# alpha");
    expect(readFileSync(join(skillsDir, ".claude-plugin", "plugin.json"), "utf8")).toBe(JSON.stringify({ name: "orca-run-skills", version: "0.0.0" }));
    expect(statSync(skillsDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(skillsDir, ".claude-plugin")).mode & 0o777).toBe(0o700);
    expect(statSync(join(skillsDir, "skills", "alpha")).mode & 0o222).toBe(0);
    const lockFile = JSON.parse(readFileSync(join(skillsDir, "skills", "syncskill-lock.json"), "utf8")) as { schema: string; skills: unknown[] };
    expect(lockFile.schema).toBe("syncskill-lock-v1");
    expect(drive.skills).toEqual({ dir: skillsDir, profile: null, lock: lockFile.skills });
    expect(drive.skills.lock.map((entry: { name: string }) => entry.name)).toEqual(["alpha"]);
    // Printed for the fix report: what the real syncskill recorded.
    console.log(`C5 real lock file: ${JSON.stringify(lockFile)}`);
    expect(snapshot(realRoot)).toEqual(realBefore);
  });
});
