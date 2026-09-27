import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseReadyLine } from "../../scripts/verify-panel.js";

/**
 * Human ruling (session f8281a60, 2026-09-27): after the ready line, tell a person to open the url
 * in a browser -- `/` needs no token, the server injects it into index.html. The hint goes to
 * STDERR: stdout keeps its ONE machine-readable line (spec §7), which verify-panel and
 * controlShutdown read back. So both halves are judged: stdout is exactly the ready line, and
 * stderr names the SAME url.
 */

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

describe("orca panel's human hint", () => {
  it("prints the ready line alone on stdout and the open-in-a-browser hint for that url on stderr", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-hint-")));
    roots.push(root);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });

    // Rule 17: both user-data roots redirected, so this never touches a real ~/.orca.
    const child = spawn("./node_modules/.bin/tsx", ["src/cli.ts", "panel", "--by", "tester", "--repo", `proj=${repo}`, "--port", "0"], {
      cwd: process.cwd(),
      env: { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no hint within 30s; stdout: ${stdout} stderr: ${stderr}`)), 30_000);
        const check = (): void => {
          if (stdout.includes("\n") && stderr.includes("in a browser")) { clearTimeout(timer); resolve(); }
        };
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); check(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); check(); });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`exited ${code}; stderr: ${stderr}`)); });
      });
    } finally {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
    }

    const { url } = parseReadyLine(stdout);
    // Exactly one line on stdout: a hint that drifted onto stdout would add a second one.
    expect(stdout.split("\n").filter((l) => l !== "")).toHaveLength(1);
    expect(stderr).toContain(`open ${url} in a browser`);
  }, 60_000);
});
