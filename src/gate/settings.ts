/**
 * D-launch spec §2.1 (review 2): the ONE source of the expected Tier 0 gate wiring. tests/gate/settings.test.ts and
 * the chain's per-session gate check (src/chain/gateCheck.ts) both read it from here. Moved verbatim from
 * tests/gate/settings.test.ts:10-22 at 96cae2b; that test pins the bytes with a sha256 taken before the move.
 */
export const GATE_HOOK_COMMAND =
  'in=$(cat); printf \'%s\' "$in" | node "$CLAUDE_PROJECT_DIR"/scripts/gate-prefilter.mjs && exit 0; printf \'%s\' "$in" | "$CLAUDE_PROJECT_DIR"/node_modules/.bin/tsx "$CLAUDE_PROJECT_DIR"/src/cli.ts gate --hook claude-code || { rc=$?; [ "$rc" -eq 2 ] && exit 2; echo "orca gate: hook failed (exit $rc) — blocked" >&2; exit 2; }';
export const GATE_HOOK_TIMEOUT_S = 10;
export const GATE_DENY_BASE: string[] = [
  "git push*",
  "git branch -d*",
  "git branch -D*",
  "git branch --delete*",
  "git worktree remove*",
  "git worktree prune*",
  "gh pr merge*",
  "gh repo sync*",
];
export const GATE_DENY: string[] = GATE_DENY_BASE.flatMap((p) => [`Bash(${p})`, `Bash(rtk ${p})`, `Bash(rtk proxy ${p})`]);
export const GATE_PRE_TOOL_USE: Array<{ matcher: "Bash"; hooks: Array<{ type: "command"; command: string; timeout: number }> }> = [
  { matcher: "Bash", hooks: [{ type: "command", command: GATE_HOOK_COMMAND, timeout: GATE_HOOK_TIMEOUT_S }] },
];
