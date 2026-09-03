// Deliberately a thin wrapper rather than a second test runner: the scheduler
// scenarios are vitest tests like everything else. What this script exists for
// is to be a name in package.json that `verify` can depend on, so the gate is
// armed from the first task instead of at the end — this repo has shipped a
// gate in an unarmed state before, and nothing noticed.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["vitest", "run", "tests/scheduler"], { stdio: "inherit" });
process.exit(r.status ?? 1);
