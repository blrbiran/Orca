// D-launch spec §8.1 / §8.2-5: test files with a chain session's two variables set, because this repository's own
// tests may themselves run inside a chain session (review I5). This run is what makes a missing isolateChainEnv()
// visible; it is not a performance knob. Spec 2026-10-20 §4.3: no longer part of `verify` (verify-suite.mjs carries the
// same variables in the gate's single pass), and the separate tests/chain run is gone -- the suite includes it.
//
// Gate-speed ruling ① (session 308b874c, 2026-10-20): not the whole suite any more, only the test files that can show
// the leak -- a file that spawns a child process (the child inherits the variables unless isolateChainEnv() strips
// them) or that reads the chain variables itself -- chosen by code, the survey's categorize regexes. `exec` alone is
// left out: it mostly matches RegExp.prototype.exec, and every file importing child_process already matches. Known
// gap: a test that spawns only through a helper module, without naming a spawn function itself, is not selected; the
// release gate's single pass (verify-suite.mjs) still runs it under the same variables. An empty selection refuses:
// `vitest run` with no files would run the whole suite and look green.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SPAWNS = /\b(execFile|execFileSync|spawn|spawnSync|fork|execSync)\b/;
const CHAIN_ENV = /ORCA_CHAIN_ID|ORCA_CHAIN_SESSION|isolateChainEnv|chainEnv/;

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return testFiles(path);
    return path.endsWith(".test.ts") ? [path] : [];
  });
}

const files = testFiles("tests")
  .filter((file) => {
    const text = readFileSync(file, "utf8");
    return SPAWNS.test(text) || CHAIN_ENV.test(text);
  })
  .sort();
if (files.length === 0) {
  console.error("verify-chain: 0 test files selected (none spawns a child process or reads the chain variables); refusing to run");
  process.exit(1);
}
console.log(`verify-chain: ${files.length} test files selected (spawn a child process or read the chain variables)`);
// Bound parallel load so the chain-session check remains deterministic under CI contention.
const leak = spawnSync(join("node_modules", ".bin", "vitest"), ["run", "--maxWorkers=2", ...files], {
  stdio: "inherit",
  env: { ...process.env, ORCA_CHAIN_ID: "chain-deadbeef", ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000" },
});
if (leak.error) console.error(leak.error);
process.exit(leak.status ?? 1);
