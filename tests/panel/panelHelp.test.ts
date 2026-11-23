import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Tester #450: `orca panel --help` did not print help — it STARTED a panel and never
 * returned. `--help` is not one of SERVICE_SUBCOMMANDS, so cli.ts's `panel` arm fell
 * through to the alias `runPanel(rest)`, where parsePanelArgs silently ignores unknown
 * flags and `await started.closed` hangs. The live run bound a random port, printed
 * "open http://127.0.0.1:56197", and left a second unmanaged panel only kill could
 * stop. The rest of the CLI refuses an unknown flag by name; this arm must too.
 */
function runCli(args: string[], deadlineMs = 20_000): Promise<{ code: number | null; stdout: string; stderr: string; hung: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("./node_modules/.bin/tsx", ["src/cli.ts", ...args], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ORCA_STATE_DIR: `/tmp/orca-help-${process.pid}-${Math.random().toString(36).slice(2)}` },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));
    const done = (code: number | null, hung = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, hung });
    };
    // The old code never exits: the deadline is what turns "it started a server" into a
    // failing criterion instead of a hung suite, and the whole process group is killed.
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      }
      done(null, true);
    }, deadlineMs);
    child.on("exit", (code) => done(code));
    child.on("error", () => done(null));
  });
}

describe("orca panel --help prints usage and starts nothing (#450)", () => {
  it("prints the usage line and exits 0", async () => {
    const result = await runCli(["panel", "--help", "--by", "tester"]);
    // mutation: treat --help as an unknown flag that falls through to runPanel -> the child hangs, red
    expect(result.hung, "the CLI must exit instead of starting a panel").toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^usage: orca panel <run\|install/m);
    expect(result.stdout).not.toMatch(/open http:\/\/127\.0\.0\.1/);
  }, 30_000);

  it("-h does the same", async () => {
    const result = await runCli(["panel", "-h", "--by", "tester"]);
    expect(result.hung).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^usage: orca panel/m);
  }, 30_000);

  it("an unknown flag on the alias form is refused by name, not ignored", async () => {
    const result = await runCli(["panel", "--not-a-flag", "--by", "tester"]);
    // mutation: leave parsePanelArgs ignoring unknown flags -> a panel starts and hangs, red
    expect(result.hung, "the CLI must refuse instead of starting a panel").toBe(false);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/--not-a-flag/);
  }, 30_000);
});