import type { CommandDef } from "../types.js";

/** CLI v2 spec §14 R1(c): replay an uncertain request -- look it up first, resend its stored bytes only on a confirmed miss. */
export const COMMAND_ROWS: CommandDef[] = [{
  domain: "command", action: "retry", summary: "for an uncertain outcome: look the request up first; resend its exact bytes only on a confirmed miss",
  positionals: [], flags: [{ name: "request", type: "string", required: true, summary: "the --json envelope's request, as a file or - for stdin" }], access: "open",
  mapsTo: { kind: "local", load: async () => (await import("../local/commandRetry.js")).runCommandRetry },
  examples: ["orca group start g1 --json > out.json; jq .request out.json > req.json; orca command retry --request req.json"], format: () => "",
}];
