// Agent entry spec §8 (C17, C14), rewritten for CLI v2 spec §10 / plan Task 13 (Ruling: 这次批准改写所有必要的判据 (b37f7ce9);
// 允许改必要的test (8b1469ea)): `orca mcp serve` is a stdio MCP server with ONE tool, `orca`, whose input is the CLI argv
// after `orca`. It runs the CLI in-process with --json, as client mcp:<client name>, and refuses the panel, user and dev
// domains. Its tools/list answer is at most 800 bytes (before: two tools, 992 B at 7b585a49).
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { useFakePanels } from "../commands/fixtures/fakePanel.js";
import { world } from "../commands/fixtures/world.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

useSocketPanels();
useFakePanels();

async function connect(w: { root: string; state: string; env: Record<string, string> }) {
  const transport = new StdioClientTransport({
    command: join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: ["src/cli.ts", "mcp", "serve", "--control-state-dir", w.state],
    cwd: process.cwd(),
    // ORCA_AGENTS_TABLE / ORCA_CCLOOP_BIN empty unless the fixture configured a port (then w.env carries its values).
    env: { ...(process.env as Record<string, string>), ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "", ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json"), ORCA_PANEL_DIR: join(w.root, "no-panel") },
  });
  const client = new Client({ name: "orca-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
const envelope = (result: { content: Array<{ type: string; text?: string }> }) => JSON.parse(result.content[0]!.text!);
const call = (client: Client, args: unknown) => client.callTool({ name: "orca", arguments: { args } });

describe("orca mcp serve (CLI v2 spec §10)", () => {
  it("lists one tool, `orca`, taking {args: string[]}, in at most 800 bytes; a read and a write round-trip against the panel", async () => {
    const w = await workspace();
    await boot(w, [], { port: true });
    const client = await connect(w);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["orca"]);
      expect(listed.tools[0]!.inputSchema).toMatchObject({ type: "object", properties: { args: { type: "array", items: { type: "string" } } }, required: ["args"] });
      // Spec §10: the description is at most two sentences.
      expect(listed.tools[0]!.description!.split(/[.!?](?:\s|$)/).filter((part) => part.trim().length > 0).length).toBeLessThanOrEqual(2);
      expect(Buffer.byteLength(JSON.stringify(listed), "utf8")).toBeLessThanOrEqual(800);
      const read = await call(client, ["group", "list"]);
      expect(read.isError ?? false).toBe(false);
      expect(envelope(read as never)).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
      const sent = await call(client, ["project", "set-workspace-mode", "--mode", "clone", "--project", controlRepoKey("proj")]);
      expect(envelope(sent as never)).toMatchObject({ status: 200 });
    } finally {
      await client.close();
    }
  }, 60_000);

  it("forwards a command as client mcp:<client name>, with --json", async () => {
    const panel = await world();
    const client = await connect({ root: panel.dir, state: panel.dir, env: {} });
    try {
      const started = await call(client, ["group", "start", "g-alpha"]);
      expect(started.isError ?? false).toBe(false);
      expect(envelope(started as never)).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
      expect(panel.requests.some((request) => request.method === "POST" && request.path === "groups/g-alpha/start")).toBe(true);
      expect(panel.requests.map((request) => request.headers["x-orca-client"])).toEqual(panel.requests.map(() => "mcp:orca-test"));
    } finally {
      await client.close();
    }
  }, 60_000);

  it("refuses the panel, user and dev domains without running them, and malformed arguments", async () => {
    const panel = await world();
    const client = await connect({ root: panel.dir, state: panel.dir, env: {} });
    try {
      for (const args of [["dev", "gate", "--hook", "claude-code"], ["panel", "stop"], ["user", "list"], "group list", [1, 2], []]) {
        const refused = await call(client, args);
        expect(refused.isError, JSON.stringify(args)).toBe(true);
        expect(envelope(refused as never).body.error.code).toBe("control-cli-argument-invalid");
      }
      expect(panel.requests).toEqual([]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("C14: with no panel, a read answers panel-not-running as an error result", async () => {
    const w = await workspace();
    const client = await connect(w);
    try {
      const read = await call(client, ["group", "list"]);
      expect(read.isError).toBe(true);
      expect(envelope(read as never).body.error.code).toBe("panel-not-running");
    } finally {
      await client.close();
    }
  }, 60_000);
});
