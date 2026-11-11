import type { CommandDef } from "../types.js";

/** CLI v2 spec §4, §8: the commands that are not a domain's action. */
export const META_ROWS: CommandDef[] = [
  {
    domain: "status", action: null, summary: "one screen: is the panel answering, what work waits on a person, and the facts around it (read-only, starts nothing)",
    positionals: [], flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../status.js")).runStatus },
    exitCodes: { 0: "every check ok (warnings allowed)", 1: "a check failed" },
    examples: ["orca status", "orca status --json"], format: () => "",
  },
  {
    domain: "doctor", action: null, summary: "status's checks plus slower ones (agent CLIs on the service PATH, ~/.orca modes, stale sockets), with one fix line per failure (read-only)",
    positionals: [], flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../doctor.js")).runDoctor },
    exitCodes: { 0: "every check ok (warnings allowed)", 1: "a check failed" },
    examples: ["orca doctor"], format: () => "",
  },
  {
    domain: "version", action: null, summary: "the CLI's version (the orca-control skill's version: should equal it)",
    positionals: [], flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../status.js")).runVersion },
    examples: ["orca version", "orca version --json"], format: () => "",
  },
  // CLI browser login spec (2026-11-11) §6: the person token, approved by an owner in the browser (sent only with --as-person).
  {
    domain: "auth", action: "login", summary: "store a person token for this terminal: an owner approves its code in the browser where they are signed in; used only with --as-person",
    positionals: [], flags: [
      { name: "no-browser", type: "boolean", summary: "print the code and URL only; do not open a browser (also the case over SSH on macOS and on Linux without a display)" },
    ], access: "open",
    mapsTo: { kind: "local", load: async () => (await import("../person.js")).runAuthLogin },
    exitCodes: { 2: "the panel refused, the request was denied or expired, or its URL was not a loopback URL", 130: "interrupted; the request was cancelled" },
    examples: ["orca auth login", "orca auth login --no-browser", "orca usage set-cap --scope all --period week --tokens 500000 --as-person"], format: () => "",
  },
  {
    domain: "auth", action: "logout", summary: "revoke the stored person token and remove it (the same as orca logout)",
    positionals: [], flags: [], access: "open",
    mapsTo: { kind: "local", load: async () => (await import("../person.js")).runLogout },
    examples: ["orca auth logout"], format: () => "",
  },
  {
    domain: "auth", action: "status", summary: "the stored person token's account and expiry (never the token)",
    positionals: [], flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../person.js")).runAuthStatus },
    examples: ["orca auth status"], format: () => "",
  },
  // CLI v2 spec §15.3: a person token for an attended terminal session (sent only with --as-person).
  {
    domain: "login", action: null, summary: "store a person token by typing the panel account's password here (members and isolated test panels; otherwise prefer orca auth login); used only with --as-person",
    positionals: [], flags: [
      { name: "name", type: "string", required: true, summary: "the panel account to log in as" },
      { name: "password-stdin", type: "boolean", summary: "an isolated test panel only: read the password as one line from stdin (refused for any path under the real ~/.orca)" },
    ], access: "open",
    mapsTo: { kind: "local", load: async () => (await import("../person.js")).runLogin },
    examples: ["orca login --name ana", "printf '%s\\n' \"$PW\" | orca login --name tester --password-stdin --control-state-dir /tmp/test-panel/state", "orca usage set-cap --scope all --period week --tokens 500000 --as-person"], format: () => "",
  },
  {
    domain: "logout", action: null, summary: "revoke the stored person token and remove it",
    positionals: [], flags: [], access: "open",
    mapsTo: { kind: "local", load: async () => (await import("../person.js")).runLogout },
    examples: ["orca logout"], format: () => "",
  },
  {
    domain: "help", action: null, summary: "this list, or one domain's or one command's help",
    positionals: [{ name: "topic", summary: "a domain, or a domain and an action", required: false, variadic: true }],
    flags: [], access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../help.js")).runHelp },
    examples: ["orca help", "orca help group", "orca help group start"], format: () => "",
  },
];
