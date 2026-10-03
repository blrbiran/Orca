import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectSkills, profileMembers } from "../../src/skills/syncskill.js";

/**
 * Syncskill integration spec §10.8 C12 and C18, against a real syncskill built from its main. Gated at run time with
 * ctx.skip(), never at collection (tests/setup/scopeTmpdir.ts erratum). ORCA_SYNCSKILL_REAL_BIN is a built dist/index.js:
 * it has a node shebang but a fresh build may lack the execute bit, so this test spawns it as `node <file>` through a
 * tiny wrapper script (production's ORCA_SYNCSKILL_BIN must still be an absolute executable, and the wrapper is one).
 * Rule 17: SYNCSKILL_DIR and HOME point at temp dirs; the real ~/.syncskill is snapshotted before and after.
 */
const REAL = process.env.ORCA_SYNCSKILL_REAL_BIN;
let cleanups: Array<() => Promise<void>> = [];
beforeEach((ctx) => { if (REAL === undefined || REAL === "") ctx.skip(); });
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

/** path:size:mtime for every file below root, sorted; "absent" when root does not exist. */
function snapshot(root: string): string[] | "absent" {
  if (!existsSync(root)) return "absent";
  const walk = (dir: string, prefix: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const s = statSync(full);
    return s.isDirectory() ? [`${prefix}${entry}/`, ...walk(full, `${prefix}${entry}/`)] : [`${prefix}${entry}:${s.size}:${s.mtimeMs}:${readFileSync(full).toString("base64")}`];
  });
  return walk(root, "").sort();
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "orca-real-ss-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, "home");
  const syncDir = join(dir, "sync");
  await mkdir(join(syncDir, "skills", "alpha"), { recursive: true });
  await writeFile(join(syncDir, "skills", "alpha", "SKILL.md"), "# alpha", "utf8");
  await mkdir(join(home, ".claude", "skills"), { recursive: true });
  await writeFile(join(syncDir, "config.json"), JSON.stringify({ version: 1, conflict_resolution: "manual", agents: { claude: join(home, ".claude", "skills") }, links: {}, servers: {}, sources: {} }), "utf8");
  const bin = join(dir, "syncskill");
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${REAL}' "$@"\n`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: home, SYNCSKILL_DIR: syncDir };
  return { dir, home, syncDir, bin, env };
}

describe("a real syncskill (spec §10.8 C12, C18)", () => {
  it("profile ls leaves the sync dir byte-identical; inject's lock entries equal the lock file; ~/.syncskill is untouched", async () => {
    const w = await setup();
    const realRoot = join(homedir(), ".syncskill");
    const realBefore = snapshot(realRoot);
    execFileSync(w.bin, ["--json", "profile", "set", "p", "alpha"], { env: w.env, stdio: ["ignore", "pipe", "pipe"] });

    const before = snapshot(w.syncDir);
    expect(await profileMembers({ bin: w.bin, env: w.env }, "p")).toEqual(["alpha"]);
    expect(snapshot(w.syncDir)).toEqual(before);

    const target = join(w.dir, "target");
    await mkdir(target);
    const lock = await injectSkills({ bin: w.bin, env: w.env }, ["alpha"], target);
    const file = JSON.parse(await readFile(join(target, "syncskill-lock.json"), "utf8")) as { schema: string; skills: unknown[] };
    expect(file.schema).toBe("syncskill-lock-v1");
    expect(lock).toEqual(file.skills);
    expect(lock.map((s) => s.name)).toEqual(["alpha"]);
    expect(await readFile(join(target, "alpha", "SKILL.md"), "utf8")).toBe("# alpha");

    expect(snapshot(realRoot)).toEqual(realBefore);
  });
});
