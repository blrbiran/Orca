import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
const root = fileURLToPath(new URL("../", import.meta.url));
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const binary = process.env.ORCA_CCLOOP_BIN;
const table = process.env.ORCA_AGENTS_TABLE;
if (!binary || !table) {
  console.error("verify:control requires ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE");
  process.exit(1);
}
try {
  realpathSync(binary);
  realpathSync(table);
} catch (error) {
  console.error(error);
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [vitest, "run", "tests/control", "--minWorkers=1", "--maxWorkers=4"],
  { cwd: root, stdio: "inherit", env: { ...process.env, ORCA_CONTROL_VERIFY: "1" } },
);
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
