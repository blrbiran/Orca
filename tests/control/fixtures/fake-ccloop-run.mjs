// A `ccloop run` stand-in for the execution driver's reconciliation criteria (Orca execution driver
// spec §5.3). It does exactly what runTask observes of the real one: it commits the scripted files in
// the contract's repoPath (runTask's clone of the conflict copy), publishes
// refs/ccloop/<basename of --run-dir>/attempts/1 there, and writes <run-dir>/loop-state.json.
// Each invocation appends "<run id> <pid>" to <agents table>.runs, so a criterion can count spawns.
//
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): it is spawned in the
// `--agents <table> --agent-selection <file>` form (agent selection spec §4.9) and refuses the retired
// `--adapter` form by name, so a reconciliation that fell back to it would fail rather than pass. The script
// lives where the table would; each spawn also appends the selection file's bytes and its mode, as one JSON
// line, to <agents table>.selections. Like real `ccloop run --agents` (ccloop T6) it exits 1 on any refusal, with the
// refusal on stderr (an agent error's code first), and 2 for a run that completed without succeeding; a `refuse` knob
// in the table makes it refuse after recording the spawn, writing no loop state.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
if (argv.includes("--adapter") || argv.includes("--adapter-config")) {
  process.stderr.write("fake-ccloop-run: the --adapter form is retired for the driver's reconciliation\n");
  process.exit(1);
}
const flag = (name) => argv[argv.indexOf(name) + 1];
const configPath = flag("--agents");
const selectionPath = flag("--agent-selection");
const contract = JSON.parse(readFileSync(flag("--contract"), "utf8"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const runDir = flag("--run-dir");
appendFileSync(`${configPath}.runs`, `${basename(runDir)} ${process.pid}\n`);
appendFileSync(`${configPath}.selections`, `${JSON.stringify({ selection: JSON.parse(readFileSync(selectionPath, "utf8")), mode: statSync(selectionPath).mode & 0o777 })}\n`);

if (config.refuse) { process.stderr.write(`${config.refuse}\n`); process.exit(1); }
// Wave-2 review I-2 (2026-09-26): like real `ccloop run --agents` for a codex installation (the reconciliation's, in
// every world this stand-in serves), the soft-budget notice goes to stderr after the refusals above and before the
// contract is loaded -- so it is the first stderr line of every later failure. A `fail` knob is such a failure: a
// non-refusal exit 1 after the notice (a bad contract, a crash inside the run), writing no loop state.
process.stderr.write("Codex budgetMode=soft: token usage is accounted after each phase; no strict token cap is guaranteed.\n");
if (config.fail) { process.stderr.write(`${config.fail}\n`); process.exit(1); }

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
  process.exitCode = config.status === "succeeded" ? 0 : 2;
}

if (config.holdMs > 0) setTimeout(finish, config.holdMs); else finish();
