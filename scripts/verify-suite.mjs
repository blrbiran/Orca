// Spec 2026-10-20 §4.3: the gate's one pass over the whole root suite, carrying what the removed re-runs carried --
// ORCA_CONTROL_VERIFY=1 (verify:control: the real-ccloop file refuses to skip) and a chain session's two variables
// (verify:chain, review I5: a test missing isolateChainEnv() goes red). Arguments are forwarded, so one file can be
// run under the same conditions.
//
// Gate-speed ruling (session 308b874c, 2026-10-20), on .superpowers/sdd/2026-10-20-repin-w2-test-split/gate-speed-survey.md:
// - ⑤ vitest's JSON report (per-file start/end times) goes to ORCA_SUITE_REPORT, else a fresh path under the temp
//   directory, and the path is printed, so the next release can measure where the pass spends its time.
// - ③ the separate tests/scheduler and tests/chain runs are gone, but their reason stays (verify-scheduler.mjs:1-5:
//   "this repo has shipped a gate in an unarmed state before, and nothing noticed"): a whole-suite run whose report
//   collected no file under either directory fails, even when vitest exited 0.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ARMED = ["tests/scheduler", "tests/chain"];
const args = process.argv.slice(2);
const report = resolve(process.env.ORCA_SUITE_REPORT || join(tmpdir(), `orca-verify-suite-${Date.now()}.json`));
console.log(`verify-suite: per-file JSON report: ${report}`);
const result = spawnSync("node_modules/.bin/vitest", ["run", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    ORCA_CONTROL_VERIFY: "1",
    ORCA_CHAIN_ID: "chain-deadbeef",
    ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000",
  },
});
if (result.error) console.error(result.error);
let status = result.status ?? 1;
if (args.length > 0) {
  console.log(`verify-suite: arguments given, so the armed-directory check (${ARMED.join(", ")}) was not run`);
} else {
  let files = null;
  try {
    const cwd = realpathSync(process.cwd());
    files = JSON.parse(readFileSync(report, "utf8")).testResults.map((t) => relative(cwd, t.name));
  } catch (error) {
    console.error(`verify-suite: cannot read the JSON report ${report}: ${error.message}`);
    if (status === 0) status = 1;
  }
  for (const dir of files ? ARMED : []) {
    const count = files.filter((f) => f.startsWith(`${dir}/`)).length;
    const line = `verify-suite: ${dir}: ${count} test files collected`;
    if (count > 0) console.log(line);
    else {
      console.error(line);
      if (status === 0) status = 1;
    }
  }
}
console.log(`verify-suite: per-file JSON report: ${report}`);
process.exit(status);
