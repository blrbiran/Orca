/**
 * D-launch spec §2.1 (review 2): the ONE source of the expected Tier 0 gate wiring. tests/gate/settings.test.ts and
 * the chain's per-session gate check (src/chain/gateCheck.ts) both read it from here. Moved verbatim from
 * tests/gate/settings.test.ts:10-22 at 96cae2b; that test pins the bytes with a sha256 taken before the move.
 */
export const GATE_HOOK_COMMAND =
  'in=$(cat); printf \'%s\' "$in" | node "$CLAUDE_PROJECT_DIR"/scripts/gate-prefilter.mjs && exit 0; printf \'%s\' "$in" | "$CLAUDE_PROJECT_DIR"/node_modules/.bin/tsx "$CLAUDE_PROJECT_DIR"/src/cli.ts dev gate --hook claude-code || { rc=$?; [ "$rc" -eq 2 ] && exit 2; echo "orca gate: hook failed (exit $rc) — blocked" >&2; exit 2; }';
export const GATE_HOOK_TIMEOUT_S = 10;
// CLI v2 plan Task 7: the PostToolUse level hook's command, held here beside the gate's so one test pins both against
// .claude/settings.json (tests/gate/hookCommand.test.ts).
export const LEVEL_HOOK_COMMAND =
  '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/tsx "$CLAUDE_PROJECT_DIR"/src/cli.ts dev level --hook claude-code || { rc=$?; echo "orca level: no reading — hook command failed (exit $rc)" >&2; exit 2; }';
// Human ruling 2026-10-18 (Orca session a3b2a7a7): `git branch -d`, `git branch --delete` and `git worktree remove`
// left this list; their forced forms are blocked by the hook (src/gate/classify.ts), which a prefix rule cannot tell apart.
export const GATE_DENY_BASE: string[] = [
  "git push*",
  "git branch -D*",
  "git worktree prune*",
  "gh pr merge*",
  "gh repo sync*",
];
export const GATE_DENY: string[] = GATE_DENY_BASE.flatMap((p) => [`Bash(${p})`, `Bash(rtk ${p})`, `Bash(rtk proxy ${p})`]);
export const GATE_PRE_TOOL_USE: Array<{ matcher: "Bash"; hooks: Array<{ type: "command"; command: string; timeout: number }> }> = [
  { matcher: "Bash", hooks: [{ type: "command", command: GATE_HOOK_COMMAND, timeout: GATE_HOOK_TIMEOUT_S }] },
];
