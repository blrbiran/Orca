import type { CommandDef } from "../types.js";

/** CLI v2 spec §4, §10: the raw socket client, kept as a hidden escape hatch with its own grammar. */
const raw = (action: "get" | "send", summary: string, positionals: CommandDef["positionals"], examples: string[]): CommandDef => ({
  domain: "control", action, hidden: true, raw: true, summary, positionals, flags: [], access: "open",
  mapsTo: { kind: "local", load: async () => (await import("../local/control.js")).runControl(action) },
  exitCodes: { 0: "the panel answered 2xx", 1: "refused here", 2: "the panel answered an error" },
  examples, format: () => "",
});

export const CONTROL_ROWS: CommandDef[] = [
  raw("get", "read one control path over the socket: get <path> [--control-state-dir <dir>] [--client-name <name>]",
    [{ name: "path", summary: "a path without /api/control/", required: true }], ["orca control get summary"]),
  raw("send", "send one control command: send <route> --expected-revision <n> (--payload <json> | --payload-file <file>) [--command-id <id>]",
    [{ name: "route", summary: "a route without /api/control/", required: true }], ["orca control send groups/g1/start --expected-revision 3 --payload '{}'"]),
];
