/** Independently audit one isolated single-task OMP acceptance directory. */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const summaryPath = process.argv[2];
if (!summaryPath) throw new Error("usage: verify-omp-acceptance <summary.json>");
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const fail = (reason: string): never => { throw new Error(`omp-acceptance: ${reason}`); };
const safe = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
if (summary.kind !== "omp" || summary.scenario !== "single") fail("wrong-kind-or-scenario");
if (Object.values(summary.checks ?? {}).some((value) => value !== true)) fail("harness-check-failed");
const expected = summary.agents?.a?.model;
if (typeof expected !== "string" || !expected.includes("/")) fail("missing-frozen-model");
const calls = summary.providerCalls;
if (!Array.isArray(calls) || calls.length !== 3 || JSON.stringify(calls.map((call) => call.phase).sort()) !== JSON.stringify(["execute", "plan", "verify"])) fail("phase-set");
let used = 0;
for (const call of calls) {
  if (call.role !== "worker" || typeof call.file !== "string") fail("extra-call");
  const dir = dirname(call.file);
  const outcome = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"));
  if (outcome.reason !== "completed" || outcome.code !== 0 || outcome.signal !== null || outcome.neverStarted !== false) fail(`phase-outcome:${call.phase}`);
  const argv: string[] = outcome.args;
  const option = (name: string) => argv[argv.indexOf(name) + 1];
  if (option("--model") !== expected || !argv.includes("--no-extensions") || !argv.includes("--no-skills") || !argv.includes("--no-session") || !argv.includes("--no-tools")) fail(`phase-argv:${call.phase}`);
  if (option("--tools") !== (call.phase === "execute" ? "read,grep,glob,edit,write,bash" : "read,grep,glob")) fail(`phase-tools:${call.phase}`);
  const systemPath = option("--system-prompt");
  if (!systemPath || dirname(systemPath) !== dir || !readFileSync(systemPath, "utf8").includes("exactly one ccloop phase")) fail(`phase-prompt:${call.phase}`);
  if ((statSync(call.file).mode & 0o077) !== 0 || (statSync(systemPath).mode & 0o077) !== 0) fail(`phase-evidence-permissions:${call.phase}`);
  const events = readFileSync(call.file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const pending = new Map<string, string>();
  const allowed = new Set(call.phase === "execute" ? ["read", "grep", "glob", "edit", "write", "bash"] : ["read", "grep", "glob"]);
  let terminal = 0;
  let complete = false;
  let phaseTokens = 0;
  for (const row of events) {
    if (typeof row.type !== "string" || row.type.includes("subagent") || row.type === "extension_ui_request") fail(`forbidden-event:${call.phase}`);
    if (complete && row.type !== "turn_end" && row.type !== "agent_end") fail(`continuation:${call.phase}`);
    if (row.type === "tool_execution_start") {
      if (!allowed.has(row.toolName) || typeof row.toolCallId !== "string" || pending.has(row.toolCallId)) fail(`forbidden-tool:${call.phase}`);
      if (row.toolName === "bash" && typeof row.args?.command === "string" && /\bgit\s+(?:add|reset|commit|checkout|branch)\b/u.test(row.args.command)) fail(`git-metadata-command:${call.phase}`);
      pending.set(row.toolCallId, row.toolName);
    }
    if (row.type === "tool_execution_end") {
      if (pending.get(row.toolCallId) !== row.toolName) fail(`orphan-tool:${call.phase}`);
      pending.delete(row.toolCallId);
    }
    if (row.type === "message_end" && row.message?.role === "assistant") {
      const message = row.message;
      if (`${message.provider}/${message.model}` !== expected) fail(`model-mismatch:${call.phase}`);
      const usage = message.usage;
      if (![usage?.input, usage?.output, usage?.cacheRead, usage?.cacheWrite, usage?.totalTokens].every(safe)
        || usage.input + usage.output + usage.cacheRead + usage.cacheWrite !== usage.totalTokens) fail(`usage-invalid:${call.phase}`);
      phaseTokens += usage.totalTokens;
      if (message.stopReason === "stop") complete = true;
    }
    if (row.type === "agent_end") terminal += 1;
  }
  if (terminal !== 1 || !complete || pending.size !== 0 || phaseTokens <= 0 || phaseTokens !== call.total) fail(`phase-incomplete:${call.phase}`);
  used += phaseTokens;
}
if (used !== summary.ccloopReportedTokens || used !== summary.ledger?.used?.tokens || summary.ledger?.usageUnknown !== false) fail("ledger-mismatch");
const repo = join(summary.root, "target");
const changed = execFileSync("git", ["diff", "--name-only", "main", "refs/heads/orca/g"], { cwd: repo, encoding: "utf8" }).trim();
const landed = execFileSync("git", ["show", "refs/heads/orca/g:answer.txt"], { cwd: repo, encoding: "utf8" });
if (changed !== "answer.txt" || landed !== "42\n") fail("artifact-overrun-or-wrong-bytes");
console.log(JSON.stringify({ verified: true, phases: calls.map((call: { phase: string }) => call.phase).sort(), model: expected, tokens: used, changed }));
