#!/usr/bin/env node
// Tier 0 gate plan PC-1: the dependency-free first step of the PreToolUse gate in .claude/settings.json.
// Exit 0 only when the Bash command provably names neither git nor gh, so a checkout without node_modules
// can still run `npm ci`. Anything else (including input it cannot read) exits 1 and falls through to the gate.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let command;
  try {
    command = JSON.parse(input).tool_input.command;
  } catch {
    process.exit(1);
  }
  process.exit(typeof command === "string" && !/git|gh/.test(command) ? 0 : 1);
});
