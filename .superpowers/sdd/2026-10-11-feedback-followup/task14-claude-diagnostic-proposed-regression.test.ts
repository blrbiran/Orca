// Diagnostic proposal only. No product edits; runner is restored to immutable HEAD bytes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it("Task14: publishes exactly one successful execute when SIGTERM becomes exit0 before retained stdout closes", async () => {
  const { stdout } = await exec("python3", ["/private/tmp/task14-launch.py", "t14-claude-regression-red1", "runner-graceful"]);
  const actual = JSON.parse(stdout) as { code: number | null; signal: string | null; stdout: string };
  expect(actual.code).toBe(0);
  expect(actual.signal).toBeNull();
  const payload = JSON.parse(actual.stdout);
  expect(payload.changedFiles).toEqual(["inner-success.txt"]);
  expect(payload.commandOutputs).toEqual(["inner-success"]);
  expect(payload).not.toHaveProperty("completionStatus");
}, 30_000);
