// D-launch spec §8.1 / §8.2-5: the whole suite with a chain session's two variables set, because this repository's own
// tests may themselves run inside a chain session (review I5). This run is what makes a missing isolateChainEnv()
// visible; it is not a performance knob. Spec 2026-10-20 §4.3: no longer part of `verify` (verify-suite.mjs carries the
// same variables in the gate's single pass), and the separate tests/chain run is gone -- the suite includes it.
import { spawnSync } from "node:child_process";

// Bound parallel load so the full-suite chain-session check remains deterministic under CI contention.
const leak = spawnSync("npx", ["vitest", "run", "--maxWorkers=2"], {
  stdio: "inherit",
  env: { ...process.env, ORCA_CHAIN_ID: "chain-deadbeef", ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000" },
});
process.exit(leak.status ?? 1);
