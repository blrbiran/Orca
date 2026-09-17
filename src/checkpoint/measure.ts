import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

/**
 * Runs one measurement exactly as the agent would type it (a shell command, D spec 9 item 3) and keeps its
 * whole output — stdout and stderr interleaved as they arrived — in a new file. Returns the exit code;
 * a signal is 128, never 0.
 */
export async function runMeasurement(repo: string, command: string, outputPath: string): Promise<number> {
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
