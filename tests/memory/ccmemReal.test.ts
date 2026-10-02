import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCcmemAdapter } from "../../src/memory/ccmem.js";
import { PROJECT_KEY, memoryRepo } from "./helpers.js";

/**
 * Spec §6.3 R1 (§10 D4). Fakes only know shapes; this criterion runs a real ccmem, in a temp data root and a temp
 * HOME, so a field the real export prints differently (tags arrive as JSON text) cannot stay hidden behind the fake.
 * Gated at run time with ctx.skip() -- not describe.skipIf -- so the per-file temp root is still removed
 * (tests/setup/scopeTmpdir.ts erratum). The gate (plan Task 8) runs it with ORCA_CCMEM_REAL_BIN set and checks it passed.
 */
const REAL = process.env.ORCA_CCMEM_REAL_BIN;
let cleanups: Array<() => Promise<void>> = [];
beforeEach((ctx) => { if (REAL === undefined || REAL === "") ctx.skip(); });
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

describe("a real ccmem (spec §6.3 R1)", () => {
  it("reads back one global and one project memory through the adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-real-ccmem-"));
    const repo = await memoryRepo();
    cleanups.push(() => rm(dir, { recursive: true, force: true }), () => rm(repo, { recursive: true, force: true }));
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), CCMEM_DATA_ROOT: join(dir, "root") };
    const seed = join(dir, "seed.json");
    await writeFile(seed, JSON.stringify({ version: "0.7", exported_at: 0, memories: [
      { scope: "global", project_key: null, type: "rule", content: "real global rule", pinned: 1, tags: "[\"seeded\"]" },
      { scope: "project", project_key: null, type: "fact", content: "real project fact", pinned: 0, tags: null },
    ] }));
    execFileSync(REAL!, ["import", seed], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });

    const adapter = createCcmemAdapter({ ccmemBin: REAL!, env });
    expect(await adapter.health()).toEqual({ status: "ok" });
    const page = await adapter.search({ projectKey: "panel-key", repoPath: repo }, { query: "", limit: 50 });
    expect(page.records.map((r) => [r.scope, r.content, r.projectKey, r.tags, r.pinned])).toEqual([
      ["global", "real global rule", null, ["seeded"], true],
      ["project", "real project fact", PROJECT_KEY, [], false],
    ]);
  });
});
