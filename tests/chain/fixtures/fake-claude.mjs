// D-launch spec §8.1: a fake `claude` for the chain criteria. It never talks to a model and costs nothing.
// Its n-th invocation (counted in $FAKE_CLAUDE_DIR/count) follows $FAKE_CLAUDE_DIR/<n>.json and records what it was
// started with in call-<n>.json. Every pid it owns goes to $FAKE_CLAUDE_DIR/pids so a criterion can clean up even when
// the guard under test is gone.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, fstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const dir = process.env.FAKE_CLAUDE_DIR;
if (!dir) {
  process.stderr.write("fake claude: FAKE_CLAUDE_DIR is not set\n");
  process.exit(97);
}
const countFile = join(dir, "count");
const n = (existsSync(countFile) ? Number(readFileSync(countFile, "utf8")) : 0) + 1;
writeFileSync(countFile, String(n));
appendFileSync(join(dir, "pids"), `${process.pid}\n`);
const argv = process.argv.slice(2);
const stdin = fstatSync(0);
const devNull = statSync("/dev/null");
writeFileSync(
  join(dir, `call-${n}.json`),
  JSON.stringify({ argv, env: process.env, cwd: process.cwd(), stdinIsDevNull: stdin.rdev === devNull.rdev && stdin.ino === devNull.ino, pid: process.pid }),
);
const sid = argv[argv.indexOf("--session-id") + 1];
const scenarioFile = join(dir, `${n}.json`);
const scenario = existsSync(scenarioFile) ? JSON.parse(readFileSync(scenarioFile, "utf8")) : { steps: [] };
// The fake is not what W30 watches: its own git calls skip the target's hooks and fsmonitor, so any trace they leave
// there comes from the supervisor (plan PC-20).
const git = (...args) =>
  execFileSync("git", ["-c", "user.name=fake", "-c", "user.email=fake@invalid", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkpoint(step, withChain) {
  const runId = `orca-dev-${sid.slice(0, 8)}`;
  const rel = `.orca/checkpoints/${runId}.json`;
  const head = git("rev-parse", "HEAD");
  const now = new Date().toISOString();
  const cp = {
    v: 1,
    runId,
    runtime: "claude-code",
    sessionRef: sid,
    writtenAt: now,
    head,
    level: { kind: "no-reading", reason: "fake claude" },
    next: step.next ?? ["next step"],
    open: [],
    awaitingHuman: step.awaitingHuman ?? [],
    measurements: (step.measurements ?? []).map((m) => ({ command: m.command, exitCode: m.exitCode, commit: head, observedAt: now, outputPath: "/nonexistent/fake.txt" })),
    ...(withChain ? { chain: { status: step.status, why: step.why ?? `fake ${step.status}` } } : {}),
  };
  mkdirSync(".orca/checkpoints", { recursive: true });
  writeFileSync(rel, `${JSON.stringify(cp, null, 2)}\n`);
  git("add", "--", rel);
  git("commit", "-q", "-m", `chore(checkpoint): ${runId}`, "--", rel);
}

for (const step of scenario.steps ?? []) {
  switch (step.do) {
    case "commit":
      mkdirSync(dirname(step.file), { recursive: true });
      writeFileSync(step.file, step.content ?? `${sid} ${n}\n`);
      git("add", "--", step.file);
      git("commit", "-q", "-m", `work ${n}: ${step.file}`, "--", step.file);
      break;
    case "write":
      mkdirSync(dirname(step.file), { recursive: true });
      writeFileSync(step.file, step.content ?? "x\n");
      break;
    case "touch":
      mkdirSync(dirname(step.path), { recursive: true });
      writeFileSync(step.path, "");
      break;
    case "rm":
      rmSync(step.path, { force: true });
      break;
    case "git":
      git(...step.args);
      break;
    case "exitCheckpoint":
      checkpoint(step, true);
      break;
    case "midCheckpoint":
      checkpoint(step, false);
      break;
    case "background": {
      // Same process group as this fake: the adapter must find and end it (review M8).
      const child = spawn("sleep", [String(step.seconds ?? 3171)], { stdio: "ignore" });
      appendFileSync(join(dir, "pids"), `${child.pid}\n`);
      child.unref();
      break;
    }
    case "ignoreTerm":
      process.on("SIGTERM", () => {});
      break;
    case "sleep":
      await sleep(step.ms);
      break;
    default:
      process.stderr.write(`fake claude: unknown step ${JSON.stringify(step)}\n`);
      process.exit(98);
  }
}
if (scenario.stderr) process.stderr.write(scenario.stderr);
const result = scenario.result === undefined ? { subtype: "success", cost: 0.1 } : scenario.result;
if (result !== null) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: result.subtype, is_error: result.subtype !== "success", total_cost_usd: result.cost, session_id: sid, num_turns: 1 }));
}
process.exit(scenario.exitCode ?? 0);
