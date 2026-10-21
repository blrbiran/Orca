import type { CommandDef, FlagDef, LocalHandler } from "../types.js";

type Local = typeof import("../local/dev.js");
const local = (pick: (module: Local) => LocalHandler): CommandDef["mapsTo"] => ({ kind: "local", load: async () => pick(await import("../local/dev.js")) });
const HOOK: FlagDef = { name: "hook", type: "string", required: true, summary: "the hook protocol; only claude-code" };
const REPO_PATH: FlagDef = { name: "repo", type: "string", summary: "the repository (default: cwd)" };
const REPO_PAIRS: FlagDef = { name: "repo", type: "string", repeatable: true, summary: "<projectKey>=<path>, repeatable" };
const ROOT: FlagDef = { name: "root", type: "string", summary: "a directory whose git repositories are read" };
const CHAIN_FLAGS: Record<"start" | "stop" | "unlock", FlagDef[]> = {
  start: [
    { name: "repo", type: "string", required: true, summary: "the repository" }, { name: "by", type: "string", summary: "who starts it" },
    { name: "goal", type: "string", required: true, summary: "the whole authorization" }, { name: "max-sessions", type: "integer", required: true, summary: "at most this many sessions" },
    { name: "max-cost-usd", type: "string", required: true, summary: "a soft cost limit in USD" }, { name: "session-timeout-min", type: "integer", summary: "per-session timeout" },
    { name: "chain-id", type: "string", summary: "the chain's id" }, { name: "via", type: "string", summary: "cli (default) or panel" },
  ],
  stop: [{ name: "repo", type: "string", required: true, summary: "the repository" }, { name: "chain-id", type: "string", summary: "default: the chain holding the lock" }],
  unlock: [{ name: "repo", type: "string", required: true, summary: "the repository" }],
};
const CHAIN_SUMMARY = {
  start: "start an unattended chain of sessions toward --goal under four hard limits",
  stop: "ask the running chain to stop after its current session ends",
  unlock: "after checking its supervisor is gone: remove a chain's lock and record the chain as stopped (unlocked-by-human)",
} as const;
const AGENT_SUMMARY = {
  init: "detect the installed agents (ccloop agents detect) and write the installation table; an existing table is never overwritten (the detection goes to <table>.draft.json)",
  show: "validate the installation table and print what each installation resolves to; exit 1 if any entry is refused",
  refresh: "record the version each installed CLI answers now in the table (only the version fields change)",
} as const;

/**
 * CLI v2 spec §5: tools for developing Orca itself; out of the top-level help (`orca help dev` lists them).
 * `correct` and `chain` keep their own argument grammar (raw rows): their parsers' named refusals and exit codes are
 * pinned by their own criteria; the flags listed on them are for help and the references.
 */
export const DEV_ROWS: CommandDef[] = [
  {
    domain: "dev", action: "gate", hidden: true,
    summary: "Tier 0 gate: read a Claude Code PreToolUse hook's JSON on stdin; exit 2 with one line on stderr when the Bash command would push, merge into main, delete a branch or remove a worktree, or when it cannot decide",
    positionals: [], flags: [HOOK], access: "panel-local", mapsTo: local((m) => m.runGate),
    exitCodes: { 0: "allowed", 1: "refused here (bad arguments)", 2: "block" },
    examples: ["orca dev gate --hook claude-code < pretooluse.json"], format: () => "",
  },
  {
    domain: "dev", action: "level", hidden: true,
    summary: "context level: read a Claude Code PostToolUse hook's JSON on stdin and print the reading (and a checkpoint request past T1) as additional context",
    positionals: [], flags: [HOOK], access: "panel-local", mapsTo: local((m) => m.runLevel),
    exitCodes: { 0: "answered (a missing reading is answered too)", 1: "refused here (bad arguments)" },
    examples: ["orca dev level --hook claude-code < posttooluse.json"], format: () => "",
  },
  {
    domain: "dev", action: "checkpoint write", hidden: true,
    summary: "write and commit a checkpoint for this session from a draft file outside the repository",
    positionals: [],
    flags: [REPO_PATH, { name: "session", type: "string", required: true, summary: "the session id" },
      { name: "transcript", type: "string", summary: "the session's transcript (left out in a chain)" },
      { name: "draft", type: "string", required: true, summary: "the draft JSON {next,open,awaitingHuman,measure[,chain]}" }],
    access: "panel-local", mapsTo: local((m) => m.runCheckpointWrite),
    exitCodes: { 0: "written and committed", 1: "refused by name" },
    examples: ["orca dev checkpoint write --session <id> --transcript <path> --draft /tmp/draft.json"], format: () => "",
  },
  {
    domain: "dev", action: "resume", hidden: true,
    summary: "print the latest checkpoint and re-run the shell commands it recorded",
    positionals: [], flags: [REPO_PATH, { name: "checkpoint", type: "string", summary: "a checkpoint file (default: the latest)" }],
    access: "panel-local", mapsTo: local((m) => m.runResume),
    exitCodes: { 0: "every measurement as recorded", 1: "refused by name", 2: "a re-run measurement changed its exit code" },
    examples: ["orca dev resume", "orca dev resume --repo ../other"], format: () => "",
  },
  ...(["start", "stop", "unlock"] as const).map((sub): CommandDef => ({
    domain: "dev", action: `chain ${sub}`, hidden: true, raw: true, summary: CHAIN_SUMMARY[sub],
    positionals: [], flags: CHAIN_FLAGS[sub], access: "panel-local", mapsTo: local((m) => m.runChain(sub)),
    exitCodes: sub === "start"
      ? { 0: "done", 1: "refused before anything was written", 2: "an anomaly", 3: "blocked on a person", 4: "a limit was reached" }
      : { 0: "done", 1: "refused by name", 2: "an anomaly" },
    examples: [sub === "start" ? "orca dev chain start --repo . --goal 'two files' --max-sessions 3 --max-cost-usd 5" : `orca dev chain ${sub} --repo .`],
    format: () => "",
  })),
  {
    domain: "dev", action: "check-append-only", hidden: true,
    summary: "read a git diff on stdin; refuse it if it deletes any line",
    positionals: [], flags: [], access: "panel-local", mapsTo: local((m) => m.runCheckAppendOnly),
    exitCodes: { 0: "append-only", 1: "the diff deletes a line" },
    examples: ["git diff --cached -- .decisions | orca dev check-append-only"], format: () => "",
  },
  {
    domain: "dev", action: "correct", hidden: true, raw: true,
    summary: "offline ledger writer: record a correction of a decision; with --chose-instead/--undo-how also close the loop (writes and commits the two ledger rows)",
    positionals: [],
    flags: [
      ...["decision", "kind", "because", "repo", "by", "chose-instead", "undo-how", "undo-cost", "undo-blast-radius", "close"].map((name): FlagDef => ({
        name, type: "string", summary: name === "kind" ? "wrong|not_my_taste|stale" : name === "close" ? "finish closing a correction already recorded" : `the correction's ${name}`,
      })),
      { name: "again", type: "boolean", summary: "a second correction of the same decision by the same person" },
      { name: "record-only", type: "boolean", summary: "record without closing" },
    ],
    access: "panel-local", mapsTo: local((m) => m.runCorrect),
    exitCodes: { 0: "recorded (and closed)", 1: "the input is wrong", 4: "a lock is held; retry later", 5: "the ledger is written but not committed; re-run the same --close" },
    examples: ["orca dev correct --decision <run-id>/<n> --kind wrong --because <text>", "orca dev correct --close <correctionId> --undo-how <text>"],
    format: () => "",
  },
];

/** CLI v2 spec §4: the ledger file tools (no panel needed) and the installation-table tools, under their domains. */
export const TOOL_ROWS: CommandDef[] = [
  {
    domain: "decision", action: "validate", summary: "validate ledger file(s) or a directory (its top-level *.jsonl only)",
    positionals: [{ name: "path", summary: "a ledger file or directory", required: true, variadic: true }], flags: [],
    access: "panel-local", mapsTo: local((m) => m.runValidate),
    exitCodes: { 0: "every line valid", 1: "a line rejected, or nothing found to validate", 2: "downgraded (nothing rejected)" },
    examples: ["orca decision validate .decisions"], format: () => "",
  },
  {
    domain: "decision", action: "metrics", summary: "read-only: the correction rate, the repair rate and the backlog (--json: the report as JSON)",
    positionals: [], flags: [ROOT, REPO_PAIRS, { name: "as-of", type: "string", summary: "an ISO 8601 instant: read what existed then" }],
    access: "panel-local", mapsTo: local((m) => m.runMetrics),
    exitCodes: { 0: "reported", 1: "refused by name", 6: "reported in full, and some lines were malformed" },
    examples: ["orca decision metrics --root ~/code", "orca decision metrics --repo orca=. --json"], format: () => "",
  },
  {
    domain: "decision", action: "compact-reviews", summary: "compact the reviews store: a dry-run report, or --apply",
    positionals: [], flags: [{ name: "apply", type: "boolean", summary: "write the compaction" }, ROOT, REPO_PAIRS],
    access: "panel-local", mapsTo: local((m) => m.runCompactReviews),
    exitCodes: { 0: "reported (and applied)", 1: "refused by name" },
    examples: ["orca decision compact-reviews --repo orca=.", "orca decision compact-reviews --apply --repo orca=."], format: () => "",
  },
  {
    domain: "plan", action: "preview", summary: "print the plan's write sets, conflicts and layering, and the runtime preflight; execute nothing (--verbose: more)",
    positionals: [{ name: "path", summary: "the plan file", required: true }], flags: [],
    access: "panel-local", mapsTo: local((m) => m.runPlanPreview),
    exitCodes: { 0: "the plan is legal", 1: "rejected (the report says why)" },
    examples: ["orca plan preview plans/round.json"], format: () => "",
  },
  ...(["init", "show", "refresh"] as const).map((sub): CommandDef => ({
    domain: "agent", action: sub, summary: AGENT_SUMMARY[sub],
    positionals: [], flags: [], access: "panel-local", mapsTo: local((m) => m.runAgents(sub)),
    exitCodes: { 0: "done", 1: "refused by name" },
    examples: [`orca agent ${sub}`], format: () => "",
  })),
];
