// Agent entry spec §4, §12 D1: the real CLI against a real panel (C3, C6, C7, C14).
import { spawn } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlSummarySchema } from "../../src/control/webProtocol.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

useSocketPanels();

const tsx = () => join(process.cwd(), "node_modules", ".bin", "tsx");
// The developer's own execution port must not leak into a child: empty means "no port"; `boot(…, { port: true })` puts
// the fixture's values in w.env, which is spread after this and wins.
const childEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...process.env, ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "", ...env });

function cli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(tsx(), ["src/cli.ts", ...args], { cwd: process.cwd(), env: childEnv(env) });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c)); child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("orca control against a real panel (C6, C7, C14)", () => {
  it("reads the summary, sends a command, looks it up, and replays it byte-identically", async () => {
    const w = await workspace(); await boot(w, [], { port: true });
    const env = { ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") };
    const read = await cli(["control", "get", "summary", "--control-state-dir", w.state], env);
    expect(read.code).toBe(0);
    const summary = JSON.parse(read.stdout);
    expect(read.stdout.trim().split("\n")).toHaveLength(1);
    expect(controlSummarySchema.safeParse(summary.body).success).toBe(true);

    const repo = controlRepoKey("proj");
    const sendArgs = ["control", "send", `repositories/${repo}/workspace-mode`, "--expected-revision", "0", "--payload", "{\"workspaceMode\":\"clone\"}", "--command-id", "e2e-1", "--control-state-dir", w.state];
    const sent = await cli(sendArgs, env);
    expect(sent.code).toBe(0);
    const first = JSON.parse(sent.stdout);
    expect(first).toMatchObject({ status: 200, commandId: "e2e-1" });
    const lookup = await cli(["control", "get", `groups/@repository:${repo}/commands/e2e-1`, "--control-state-dir", w.state], env);
    // The lookup wraps the retained outcome (commandLedger lookupCommandResult).
    expect(JSON.parse(lookup.stdout).body).toEqual({ schema: "orca-command-lookup-v1", originalStatus: 200, body: first.body });
    const again = await cli(sendArgs, env);
    expect(JSON.parse(again.stdout).body).toEqual(first.body);
  }, 60_000);

  it("C14: with no panel the CLI says panel-not-running, exit 1, and creates nothing", async () => {
    const w = await workspace();
    const env = { ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") };
    const out = await cli(["control", "get", "summary", "--control-state-dir", w.state], env);
    expect(out.code).toBe(1);
    expect(JSON.parse(out.stdout).body.error.code).toBe("panel-not-running");
    await expect(stat(w.state)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it("C3: SIGTERM to a spawned panel removes the socket; its stderr names the socket", async () => {
    const w = await workspace();
    const env = { ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") };
    const child = spawn(tsx(), ["src/cli.ts", "panel", "--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", w.state], { cwd: process.cwd(), env: childEnv(env) });
    let stderr = "";
    const closed = new Promise((resolve) => child.on("close", resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no socket line: " + stderr)), 30_000);
        child.stderr.on("data", (c) => { stderr += c; if (/orca-panel: control socket .*control\.sock\n/.test(stderr)) { clearTimeout(timer); resolve(); } });
      });
      const path = join(await realpath(w.state), "control.sock");
      expect(stderr).toContain(`orca-panel: control socket ${path}\n`);
      expect((await lstat(path)).isSocket()).toBe(true);
      child.kill("SIGTERM");
      await closed;
      await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      child.kill("SIGKILL");
    }
  }, 60_000);
});
