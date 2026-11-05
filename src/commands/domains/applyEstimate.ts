import type { CommandDef } from "../types.js";
import { GROUP } from "./verbs.js";

/**
 * Issue #156 (session 3cfc2e73): the CLI's "Apply all suggestions" -- the commands the panel's budget editor sends for a
 * ready estimate, in its order. Each is an ordinary proposal-edit / set-task-loop the panel checks as usual.
 */
export const APPLY_ESTIMATE_ROWS: CommandDef[] = [{
  domain: "group", action: "apply-estimate",
  summary: "apply the newest ready estimate's suggestions to the proposal, as the panel's \"Apply all\" does (a loop task's sessions are never set: R10)",
  positionals: [GROUP], flags: [{ name: "dry-run", type: "boolean", summary: "print the commands it would send; send nothing" }], access: "open",
  mapsTo: { kind: "local", load: async () => (await import("../local/applyEstimate.js")).runApplyEstimate },
  examples: ["orca group apply-estimate g1 --dry-run", "orca group apply-estimate g1"],
  format: () => "",
}];
