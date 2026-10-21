import { readFileSync } from "node:fs";
import { parseFindings } from "./modelReview/findings.js";

/**
 * Checks spec 2026-10-22 §6.1 step 2: the model review's required check, run by ccloop inside the review's worktree as
 * `node <Orca>/dist/control/validateFindings.js .orca-review/findings.json <from> <to>` (by absolute path, so the target
 * repository needs nothing installed). Exit 0: the file parses against orca-model-review-findings-v1 and names this
 * range; exit 1 with the reason on stderr otherwise (ccloop's in-run retry shows it to the agent). Schema only: the
 * evidence is checked by Orca after the run (§6.4).
 */
const [file, from, to] = process.argv.slice(2);
if (file === undefined || from === undefined || to === undefined) {
  process.stderr.write("usage: validateFindings <findings.json> <from> <to>\n");
  process.exit(1);
}
let value: unknown;
try { value = JSON.parse(readFileSync(file, "utf8")); }
catch (error) { process.stderr.write(`findings unreadable: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); }
const parsed = parseFindings(value, { from, to });
if (!parsed.ok) { process.stderr.write(`findings invalid: ${parsed.reason}\n`); process.exit(1); }
