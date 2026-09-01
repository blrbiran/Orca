#!/usr/bin/env node
// Fix wave finding 3 (whole-branch review of the decision ledger validator):
// core.hooksPath is local git config, not tracked content, so a fresh clone
// has no hook armed until someone remembers `npm run hooks:install`. The
// `prepare` npm script now sets this by default after `npm install`, but
// "armed by default" is not proof it took — a machine where it silently
// failed must say so loudly rather than let check 6 (spec §3.8) go
// unenforced without anyone noticing.
import { execFileSync } from "node:child_process";

const EXPECTED = "scripts/githooks";

let hooksPath = "";
try {
  hooksPath = execFileSync("git", ["config", "core.hooksPath"], { encoding: "utf8" }).trim();
} catch {
  // No git, not a git repo, or the config key is unset — all read as "".
  hooksPath = "";
}

if (hooksPath !== EXPECTED) {
  process.stderr.write(
    `core.hooksPath is ${JSON.stringify(hooksPath)}, expected ${JSON.stringify(EXPECTED)}.\n` +
      "The pre-commit gate (spec §3.8 check 6) is disarmed on this machine.\n" +
      "Fix: npm run hooks:install\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`ok: core.hooksPath is ${EXPECTED}\n`);
}
