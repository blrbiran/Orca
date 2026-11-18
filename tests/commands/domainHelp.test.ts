// Tester #374 (a, b) (batch D C2): `orca project --help` answered `unknown command "project"` and `orca run --help` the
// top-level usage, both exit 1, while `orca help project` worked; and `orca project show <project>` was refused as an
// unexpected argument though `--project <project>` names the same thing. A domain's --help is now its help page, and
// project show takes the project as an optional positional.
import { describe, expect, it } from "vitest";
import { runRegistered, unknownCommand } from "../../src/commands/run.js";
import type { CommandIo } from "../../src/commands/types.js";
import { fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

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

describe("a domain's --help is its help page (#374a)", () => {
  it("orca project --help and orca run --help print what orca help <domain> prints, exit 0", async () => {
    for (const domain of ["project", "run"]) {
      const help = await run(["help", domain]);
      expect(help.code, domain).toBe(0);
      expect(help.stdout, domain).toContain(`usage: orca ${domain} <action>`);
      // mutation: drop the domain --help branch in runRegistered -> null (unknown command) here, red.
      expect(await run([domain, "--help"]), domain).toEqual(help);
      expect(await run(["--help", domain]), domain).toEqual(help);
    }
  });

  it("an unknown domain with --help is still not a command: did-you-mean, exit 1", async () => {
    expect((await run(["projet", "--help"])).code).toBeNull();
    const err: string[] = [];
    expect(unknownCommand(["projet", "--help"], { stderr: (text) => { err.push(text); } })).toBe(1);
    expect(err.join("")).toContain("did you mean orca ");
  });
});

describe("project show takes the project as an argument (#374b)", () => {
  // Two projects and cwd "/": with no project named the read is ambiguous, so only the argument can choose one.
  const RAW: Record<string, unknown> = {
    "projects": { source: "command-line", projects: [
      { projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" },
      { projectKey: "other", name: "other", path: "/repos/other", controlRepoId: "repo-2" },
    ] },
    "repositories/repo-1/workspace": { schema: "orca-repository-workspace-v1", repoId: "repo-1", workspaceMode: "worktree", revision: 7 },
    "repositories/repo-1/integration": { schema: "orca-repository-integration-v1", repoId: "repo-1", integration: { delivery: "keep" }, revision: 7 },
  };
  const panel = () => fakePanel(Object.fromEntries(Object.entries(RAW).map(([path, body]) => [`GET ${path}`, { status: 200, body }])));

  it("orca project show proj answers exactly as orca --project proj project show", async () => {
    const p = await panel();
    const state = ["--control-state-dir", p.dir];
    const flagged = await run(["--project", "proj", "project", "show", ...state]);
    expect(flagged.code).toBe(0);
    // mutation: drop the positional's mapping to --project -> "unexpected argument" or ambiguous, red.
    expect(await run(["project", "show", "proj", ...state])).toEqual(flagged);
    expect(await run(["project", "show", "proj", "--json", ...state])).toEqual(await run(["--project", "proj", "project", "show", "--json", ...state]));
  });

  it("the argument and --project together are refused, exit 1", async () => {
    const p = await panel();
    const both = await run(["project", "show", "proj", "--project", "other", "--control-state-dir", p.dir]);
    expect(both.code).toBe(1);
    expect(both.stderr).toContain("control-cli-argument-invalid");
  });
});
