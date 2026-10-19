// Spec 2026-10-20 §4.3: the up-front refusal verify-control.mjs has, in front of the gate's single suite pass, so a
// missing ccloop build or agents table fails in a second instead of after the whole suite.
import { realpathSync } from "node:fs";
const binary = process.env.ORCA_CCLOOP_BIN;
const table = process.env.ORCA_AGENTS_TABLE;
if (!binary || !table) {
  console.error("the release gate requires ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE");
  process.exit(1);
}
try {
  realpathSync(binary);
  realpathSync(table);
} catch (error) {
  console.error(error);
  process.exit(1);
}
