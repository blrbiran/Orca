// D-launch spec §8.1 / §8.2-5. Same shape as verify-scheduler.mjs: the chain's criteria by name, so `verify` can depend
// on them — and then the whole suite again with a chain session's two variables set, because this repository's own
// tests may themselves run inside a chain session (review I5). The second run is what makes a missing
// isolateChainEnv() visible; it is not a performance knob.
import { spawnSync } from "node:child_process";

const chain = spawnSync("npx", ["vitest", "run", "tests/chain"], { stdio: "inherit" });
if (chain.status !== 0) process.exit(chain.status ?? 1);
const leak = spawnSync("npx", ["vitest", "run"], {
  stdio: "inherit",
  env: { ...process.env, ORCA_CHAIN_ID: "chain-deadbeef", ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000" },
});
process.exit(leak.status ?? 1);
