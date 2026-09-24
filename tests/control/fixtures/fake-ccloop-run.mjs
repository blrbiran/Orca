// A `ccloop run` stand-in for the execution driver's reconciliation criteria (Orca execution driver
// spec §5.3). It does exactly what runTask observes of the real one: it commits the scripted files in
// the contract's repoPath (runTask's clone of the conflict copy), publishes
// refs/ccloop/<basename of --run-dir>/attempts/1 there, and writes <run-dir>/loop-state.json.
// Each invocation appends "<run id> <pid>" to <adapter config>.runs, so a criterion can count spawns.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const configPath = flag("--adapter-config");
const contract = JSON.parse(readFileSync(flag("--contract"), "utf8"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const runDir = flag("--run-dir");
appendFileSync(`${configPath}.runs`, `${basename(runDir)} ${process.pid}\n`);

function finish() {
  const repo = contract.context.repoPath;
  const git = (...args) => execFileSync("git", ["-c", "user.name=fake", "-c", "user.email=fake@invalid", "-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { encoding: "utf8" }).trim();
  for (const [path, content] of Object.entries(config.files)) writeFileSync(join(repo, path), content);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "fake reconciliation");
  git("update-ref", `refs/ccloop/${basename(runDir)}/attempts/1`, git("rev-parse", "HEAD"));
  writeFileSync(join(runDir, "loop-state.json"), JSON.stringify({
    status: config.status,
    budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 0, tokenBudgetRemaining: contract.executionPolicy.tokenBudget - config.spent },
  }));
}

if (config.holdMs > 0) setTimeout(finish, config.holdMs); else finish();
