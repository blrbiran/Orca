// CLI v2 spec §4, §5 (plan Task 1): help is generated from the registry; `dev` and `control` stay out of the top level.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderHelp } from "../../src/commands/help.js";
import { main } from "../../src/cli.js";
import { captureStreams } from "../scheduler/sandbox.js";

describe("orca help (spec §4, §5)", () => {
  it("the top level lists user commands and omits the hidden dev and control domains", () => {
    const text = renderHelp([]);
    expect(text).toContain("orca status");
    expect(text).not.toContain("orca dev gate");
    expect(text).not.toContain("orca control get");
    expect(text).toContain("orca help dev");
  });

  it("orca help dev lists the dev commands; orca help control lists the escape hatch", () => {
    expect(renderHelp(["dev"])).toContain("orca dev gate --hook <hook>");
    expect(renderHelp(["control"])).toContain("orca control get");
  });

  it("orca help <domain> <action> prints that command's flags and examples", () => {
    const text = renderHelp(["dev", "gate"]);
    expect(text).toContain("--hook <hook>");
    expect(text).toContain("exit 2");
  });

  it("an unknown help topic is exit 1 with a suggestion", async () => {
    const { result, stderr } = await captureStreams(() => main(["help", "dvv"]));
    expect(result).toBe(1);
    expect(stderr).toContain("did you mean orca help dev?");
  });

  // Tester #272 (5)/(6): an agent parsed ~28 KB of help text to find a command's flags; --json gives the same rows as data.
  it("orca help --json lists the rows the text lists, with their positionals and flags, and the global flags", async () => {
    const top = await captureStreams(() => main(["help", "--json"]));
    expect(top.result).toBe(0);
    const body = (JSON.parse(top.stdout) as { schema: string; status: number; body: { schema: string; commands: Array<Record<string, any>>; globalFlags: Array<{ name: string }> } });
    expect([body.schema, body.status, body.body.schema]).toEqual(["orca-cli-response-v1", 200, "orca-help-v1"]);
    const names = body.body.commands.map((c) => c.command);
    expect(names).toContain("group show");
    expect(names).not.toContain("dev gate");
    expect(body.body.globalFlags.map((f) => f.name)).toContain("json");
    expect(body.body.commands.find((c) => c.command === "group show")).toMatchObject({
      usage: "orca group show <group> [--runs <runs>]", access: "open",
      positionals: [{ name: "group", required: true }], flags: [{ name: "runs", type: "string", required: false }],
    });
    const one = JSON.parse((await captureStreams(() => main(["help", "dev", "gate", "--json"]))).stdout) as { body: { commands: Array<{ command: string; exitCodes?: unknown }> } };
    expect(one.body.commands.map((c) => c.command)).toEqual(["dev gate"]);
    expect(one.body.commands[0]!.exitCodes).toBeDefined();
    const domain = JSON.parse((await captureStreams(() => main(["help", "dev", "--json"]))).stdout) as { body: { commands: Array<{ command: string }> } };
    expect(domain.body.commands.length).toBeGreaterThan(1);
    expect(domain.body.commands.every((c) => c.command.startsWith("dev "))).toBe(true);
    const unknown = await captureStreams(() => main(["help", "dvv", "--json"]));
    expect(unknown.result).toBe(1);
    expect(JSON.parse(unknown.stdout).body.error.message).toContain("did you mean orca help dev?");
    // Without --json the text is unchanged.
    expect((await captureStreams(() => main(["help"]))).stdout).toBe(renderHelp([]));
  });

  // Tester #342: `panel`, `user` and `mcp` keep their own grammar outside the registry (cli.ts), and `orca help <domain>`
  // answered "no help" for them. Every domain cli.ts dispatches has a help page, and the top level points to it.
  it("orca help panel, user and mcp print their commands and exit 0; the top level names them instead of listing them", async () => {
    // mutation: drop the service domains from renderHelp -> "no help for panel", red
    for (const [domain, texts] of [
      ["panel", ["orca panel run --by <who>", "orca panel install", "orca panel status", "orca panel logs [-f] [-n <lines>]", "ask the person"]],
      ["user", ["orca user add <name> [--role owner|member] | passwd <name> | disable <name> | list | rotate-key", "never passed as arguments"]],
      ["mcp", ["orca mcp serve"]],
    ] as const) {
      const { result, stdout } = await captureStreams(() => main(["help", domain]));
      expect(result, domain).toBe(0);
      for (const text of texts) expect(stdout, `${domain}: ${text}`).toContain(text);
      expect(stdout, domain).not.toContain("orca control get"); // only that domain's block
    }
    const top = renderHelp([]);
    // mutation: keep the hard-coded one-line panel/user summary -> red
    expect(top).not.toContain("orca panel run|install");
    for (const domain of ["panel", "user", "mcp"]) expect(top).toContain(`orca help ${domain}`);
    const json = JSON.parse((await captureStreams(() => main(["help", "panel", "--json"]))).stdout) as { status: number; body: { commands: unknown[]; text?: string } };
    expect(json.status).toBe(200);
    expect(json.body.text).toContain("orca panel install");
    // The CLI reference lists them too (generated; drift.test.ts keeps the file equal). mutation: drop them from generate.ts -> red
    const doc = readFileSync(join(process.cwd(), "docs/cli.md"), "utf8");
    for (const domain of ["panel", "user", "mcp"]) expect(doc).toContain(`### \`orca ${domain}\``);
  });

  it("orca help and orca --help print to stdout and exit 0", async () => {
    for (const argv of [["help"], ["--help"], ["dev", "gate", "--help"]]) {
      const { result, stdout } = await captureStreams(() => main(argv));
      expect([result, stdout.startsWith("usage:") || stdout.startsWith("orca ")], JSON.stringify(argv)).toEqual([0, true]);
    }
  });
});
