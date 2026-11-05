// Issue #142 (session 3cfc2e73): a global flag written before the command (`orca --json group list`) must mean exactly
// what it means after the command. Before the fix, findCommand matched argv from argv[0], so the leading flag broke
// lookup ("unknown command"), and `orca --help group list` printed the top-level help instead of that command's help.
import { describe, expect, it } from "vitest";
import { runRegistered, unknownCommand } from "../../src/commands/run.js";
import type { CommandIo } from "../../src/commands/types.js";
import { runTool } from "../../src/entry/mcp.js";
import { fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const RAW: Record<string, unknown> = {
  "summary": { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] },
  "projects": { source: "command-line", projects: [{ projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" }] },
  "repositories/repo-1/workspace": { schema: "orca-repository-workspace-v1", repoId: "repo-1", workspaceMode: "worktree", revision: 7 },
  "groups/g-alpha": { schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 }, workItems: [], runs: [] },
  "repositories/repo-1/integration": { schema: "orca-repository-integration-v1", repoId: "repo-1", integration: { delivery: "keep" }, revision: 7 },
};
const panel = () => fakePanel(Object.fromEntries(Object.entries(RAW).map(([path, body]) => [`GET ${path}`, { status: 200, body }])));

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIo = {
    stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); },
    env: { ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json" }, cwd: "/", stdinIsTTY: false,
  };
  const code = await runRegistered(argv, io);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

describe("global flags before the command (#142)", () => {
  it("each leading form answers exactly like its trailing form, against the same panel", async () => {
    const p = await panel();
    const state = ["--control-state-dir", p.dir];
    const pairs: Array<[string[], string[]]> = [
      [["--json", "group", "list"], ["group", "list", "--json"]],
      [["--quiet", "group", "list"], ["group", "list", "--quiet"]],
      [["--project", "proj", "project", "show"], ["project", "show", "--project", "proj"]],
      [["--project=proj", "--json", "project", "show"], ["project", "show", "--project=proj", "--json"]],
      [[...state, "--json", "group", "list"], ["group", "list", "--json"]],
    ];
    for (const [leading, trailing] of pairs) {
      const withState = (argv: string[]) => (argv.includes("--control-state-dir") ? argv : [...argv, ...state]);
      const before = p.requests.length;
      const lead = await run(withState(leading));
      const leadPaths = p.requests.slice(before).map((r) => `${r.method} ${r.path}`);
      const mid = p.requests.length;
      const trail = await run(withState(trailing));
      const trailPaths = p.requests.slice(mid).map((r) => `${r.method} ${r.path}`);
      expect(lead.code, JSON.stringify(leading)).toBe(0);
      expect([lead, leadPaths], JSON.stringify(leading)).toEqual([trail, trailPaths]);
    }
  });

  it("--json before the command really is --json: one JSON line", async () => {
    const p = await panel();
    const { code, stdout } = await run(["--json", "group", "list", "--control-state-dir", p.dir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ schema: "orca-cli-response-v1", status: 200, body: RAW.summary });
  });

  it("a moved flag lands before a `--`, so it stays a flag and is not read as a positional", async () => {
    const p = await panel();
    const { code, stdout } = await run(["--json", "group", "show", "--control-state-dir", p.dir, "--", "g-alpha"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: 200, body: { summary: { groupId: "g-alpha" } } });
  });

  it("orca --help group list prints the group list help, not the top-level help", async () => {
    const lead = await run(["--help", "group", "list"]);
    const trail = await run(["group", "list", "--help"]);
    expect(lead.code).toBe(0);
    expect(lead.stdout).toBe(trail.stdout);
    expect(lead.stdout).not.toBe((await run(["--help"])).stdout);
  });

  it("orca --help alone still prints the top-level help; an unknown leading flag is not moved", async () => {
    const top = await run(["--help"]);
    expect([top.code, top.stdout.startsWith("usage:") || top.stdout.startsWith("orca ")]).toEqual([0, true]);
    expect(await run(["--bogus", "group", "list"])).toEqual({ code: null, stdout: "", stderr: "" });
  });

  it("a typo after a leading flag gets its did-you-mean from the command words, not from the flag's value", () => {
    const err: string[] = [];
    expect(unknownCommand(["--project", "foo", "group", "lst"], { stderr: (text) => { err.push(text); } })).toBe(1);
    expect(err.join("")).toContain("did you mean orca group list?");
  });

  it("MCP: a leading flag cannot slip a refused domain past the refusal", async () => {
    for (const args of [["--json", "dev", "gate", "--hook", "claude-code"], ["--quiet", "panel", "status"], ["--project", "x", "user", "list"]]) {
      const answer = await runTool({ args }, { client: "t", env: {} });
      expect([answer.isError, JSON.parse(answer.text).body?.error?.code ?? JSON.parse(answer.text)], JSON.stringify(args)).toEqual([true, "control-cli-argument-invalid"]);
      expect(answer.text, JSON.stringify(args)).toContain("is not available over MCP");
    }
  });
});
