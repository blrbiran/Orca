// Spec 2026-10-20 §4.3: the gate's one pass over the whole root suite, carrying what the removed re-runs carried --
// ORCA_CONTROL_VERIFY=1 (verify:control: the real-ccloop file refuses to skip) and a chain session's two variables
// (verify:chain, review I5: a test missing isolateChainEnv() goes red). Arguments are forwarded, so one file can be
// run under the same conditions.
import { spawnSync } from "node:child_process";
const result = spawnSync("node_modules/.bin/vitest", ["run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    ORCA_CONTROL_VERIFY: "1",
    ORCA_CHAIN_ID: "chain-deadbeef",
    ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000",
  },
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
