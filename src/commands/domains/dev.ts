import type { CommandDef } from "../types.js";

/** CLI v2 spec §5: tools for developing Orca itself; out of the top-level help (`orca help dev` lists them). */
export const DEV_ROWS: CommandDef[] = [
  {
    domain: "dev", action: "gate", hidden: true,
    summary: "Tier 0 gate: read a Claude Code PreToolUse hook's JSON on stdin; exit 2 with one line on stderr when the Bash command would push, merge into main, delete a branch or remove a worktree, or when it cannot decide",
    positionals: [], flags: [{ name: "hook", type: "string", required: true, summary: "the hook protocol; only claude-code" }],
    access: "panel-local",
    mapsTo: { kind: "local", load: async () => (await import("../local/dev.js")).runGate },
    exitCodes: { 0: "allowed", 1: "refused here (bad arguments)", 2: "block" },
    examples: ["orca dev gate --hook claude-code < pretooluse.json"], format: () => "",
  },
];
