import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { GATE_DEADLINE_MS, gitBranchOf } from "../gate/branch.js";
import { blockMessage, classify } from "../gate/classify.js";
import { CheckpointRejection } from "./schema.js";

/**
 * Runs one measurement exactly as the agent would type it (a shell command, D spec 9 item 3) and keeps its
 * whole output — stdout and stderr interleaved as they arrived — in a new file. Returns the exit code;
 * a signal is 128, never 0.
 *
 * Tier 0 gate spec 4 (named authorization by the person, 2026-09-18): the PreToolUse gate only sees
 * `tsx … resume`, so a command recorded in a checkpoint is gated here, before it is spawned. This is the
 * single entry point for both `checkpoint write` and `resume`.
 */
export async function runMeasurement(repo: string, command: string, outputPath: string): Promise<number> {
  const verdict = await classify(command, repo, gitBranchOf(Date.now() + GATE_DEADLINE_MS));
  if (verdict.kind === "block") {
    throw new CheckpointRejection("measurement-gated", `measurement ${JSON.stringify(command)} was not run: ${blockMessage(verdict)}`);
  }
  const chunks: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 128));
  });
  await writeFile(outputPath, Buffer.concat(chunks), { flag: "wx", mode: 0o600 });
  return exitCode;
}
