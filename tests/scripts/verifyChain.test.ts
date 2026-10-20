import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Gate-speed ruling ① (session 308b874c, 2026-10-20): `npm run verify:chain` keeps review I5's net -- a test that
 * spawns a child without isolateChainEnv() leaks a chain session's variables into it -- but runs only the test files
 * that can leak (they spawn a child process) or that read the chain variables, not the whole suite again. The
 * selection is code, and an empty one must refuse: `vitest run` with no files runs the whole suite and looks green.
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// Records the argv and the chain variables the one vitest it spawns was given, then exits 0.
const FAKE_VITEST = String.raw`#!/usr/bin/env node
const fs = require("fs");
const env = { ORCA_CHAIN_ID: process.env.ORCA_CHAIN_ID ?? null, ORCA_CHAIN_SESSION: process.env.ORCA_CHAIN_SESSION ?? null };
fs.appendFileSync(process.env.FAKE_VITEST_LOG, JSON.stringify({ argv: process.argv.slice(2), env }) + "\n");
`;

function fixture(tests: Record<string, string> | "real"): { root: string; log: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vchain-")));
  roots.push(root);
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "vitest"), FAKE_VITEST, { mode: 0o755 });
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
  if (tests === "real") symlinkSync(resolve("tests"), join(root, "tests"));
  else for (const [path, text] of Object.entries(tests)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, log: join(root, "vitest.log") };
}

function run(root: string, log: string) {
  const r = spawnSync(process.execPath, [resolve("scripts", "verify-chain.mjs")], {
    cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", FAKE_VITEST_LOG: log },
  });
  let calls: { argv: string[]; env: Record<string, string | null> }[] = [];
  try { calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch {}
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

describe("scripts/verify-chain.mjs", () => {
  it("runs, with two workers and a chain session's variables, exactly the test files that spawn a child or read the chain variables", () => {
    const { root, log } = fixture({
      "tests/a/spawner.test.ts": `import { execFileSync } from "node:child_process";\nexecFileSync("git", ["status"]);\n`,
      "tests/b/forker.test.ts": `const child = spawn(process.execPath, ["x.js"]);\n`,
      "tests/c/reader.test.ts": `const id = process.env.ORCA_CHAIN_SESSION;\n`,
      "tests/c/isolated.test.ts": `import { isolateChainEnv } from "../helpers/chainEnv.js";\nisolateChainEnv();\n`,
      "tests/d/pure.test.ts": `const m = /x/.exec("x"); expect(m).toBeTruthy();\n`,
      "tests/helpers/spawnHelper.ts": `export const run = () => spawnSync("git");\n`,
    });
    const r = run(root, log);
    expect(r.code, r.out).toBe(0);
    expect(r.calls).toEqual([{
      argv: ["run", "--maxWorkers=2", "tests/a/spawner.test.ts", "tests/b/forker.test.ts", "tests/c/isolated.test.ts", "tests/c/reader.test.ts"],
      env: { ORCA_CHAIN_ID: "chain-deadbeef", ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000" },
    }]);
    expect(r.out).toContain("4 test files selected");
  });

  it("refuses an empty selection without invoking vitest, which would otherwise run the whole suite and look green", () => {
    const { root, log } = fixture({ "tests/d/pure.test.ts": `expect(1).toBe(1);\n` });
    const r = run(root, log);
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.out).toContain("verify-chain: 0 test files selected");
  });

  it("on this repository selects both a spawner and an in-process chain-variable reader, and leaves a pure file out", () => {
    const { root, log } = fixture("real");
    const r = run(root, log);
    expect(r.code, r.out).toBe(0);
    const files = r.calls[0]!.argv.slice(2);
    // gateCheck spawns `sleep` children; checkpoint/write calls writeCheckpoint in-process and is spec §5 criterion
    // 10's I5 witness; gate/classify only calls RegExp.prototype.exec.
    expect(files).toContain("tests/chain/gateCheck.test.ts");
    expect(files).toContain("tests/checkpoint/write.test.ts");
    expect(files).not.toContain("tests/gate/classify.test.ts");
  });
});
