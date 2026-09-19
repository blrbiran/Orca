import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest,"run","tests/control"], {cwd:root,stdio:"inherit"});
if(result.error) console.error(result.error);
process.exit(result.status ?? 1);
