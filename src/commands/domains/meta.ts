import type { CommandDef } from "../types.js";

/** CLI v2 spec §4, §8: the commands that are not a domain's action. */
export const META_ROWS: CommandDef[] = [
  {
    domain: "status", action: null, summary: "one screen: is the panel answering, and the facts around it (read-only, starts nothing)",
    positionals: [], flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../status.js")).runStatus },
    exitCodes: { 0: "every check ok (warnings allowed)", 1: "a check failed" },
    examples: ["orca status", "orca status --json"], format: () => "",
  },
  {
    domain: "help", action: null, summary: "this list, or one domain's or one command's help",
    positionals: [{ name: "topic", summary: "a domain, or a domain and an action", required: false, variadic: true }],
    flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../help.js")).runHelp },
    examples: ["orca help", "orca help group", "orca help group start"], format: () => "",
  },
];
