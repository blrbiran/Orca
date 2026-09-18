// Stands in for osascript (records the call, succeeds) and for orca / tsx / npx (records the call, fails): a criterion
// must never reach the real Notification Center, and a chain supervisor must never start an `orca` child
// (D-launch spec §2, review 1).
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const [name, ...argv] = process.argv.slice(2);
const dir = process.env.FAKE_CLAUDE_DIR;
if (dir) appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify({ name, argv })}\n`);
process.exit(name.startsWith("forbidden-") ? 1 : 0);
