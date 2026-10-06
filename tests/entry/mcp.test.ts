// Agent entry spec §8 (C17, C14): orca mcp serve is a stdio MCP server that is only a client of the panel socket.
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

useSocketPanels();

async function connect(w: { root: string; state: string; env: Record<string, string> }) {
  const transport = new StdioClientTransport({
    command: join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: ["src/cli.ts", "mcp", "serve", "--control-state-dir", w.state],
    cwd: process.cwd(),
    env: { ...(process.env as Record<string, string>), ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") },
  });
  const client = new Client({ name: "orca-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
const envelope = (result: { content: Array<{ type: string; text?: string }> }) => JSON.parse(result.content[0]!.text!);

describe("orca mcp serve (spec §8, C17, C14)", () => {
  it("lists exactly orca_read and orca_send, and both round-trip against the panel", async () => {
    const w = await workspace();
    await boot(w, [], { port: true });
    const client = await connect(w);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["orca_read", "orca_send"]);
      const read = await client.callTool({ name: "orca_read", arguments: { path: "summary" } });
      expect(read.isError ?? false).toBe(false);
      expect(envelope(read as never)).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
      const repo = controlRepoKey("proj");
      const sent = await client.callTool({ name: "orca_send", arguments: { route: `repositories/${repo}/workspace-mode`, expectedRevision: 0, payload: { workspaceMode: "clone" } } });
      expect(envelope(sent as never)).toMatchObject({ status: 200, commandId: expect.stringMatching(/^mcp-/) });
      const refused = await client.callTool({ name: "orca_send", arguments: { route: "groups/g1/set-limit", expectedRevision: 0, payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } } });
      expect(refused.isError).toBe(true);
      expect(envelope(refused as never).body.error.code).toBe("control-verb-human-only");
    } finally {
      await client.close();
    }
  }, 60_000);

  it("C14: with no panel, orca_read answers panel-not-running as an error result", async () => {
    const w = await workspace();
    const client = await connect(w);
    try {
      const read = await client.callTool({ name: "orca_read", arguments: { path: "summary" } });
      expect(read.isError).toBe(true);
      expect(envelope(read as never).body.error.code).toBe("panel-not-running");
    } finally {
      await client.close();
    }
  }, 60_000);

  it("refuses malformed tool arguments as an error result, without a request", async () => {
    const w = await workspace();
    const client = await connect(w);
    try {
      const bad = await client.callTool({ name: "orca_send", arguments: { route: "r", expectedRevision: "zero", payload: {} } });
      expect(bad.isError).toBe(true);
      expect(envelope(bad as never).body.error.code).toBe("control-cli-argument-invalid");
      // A non-object payload would otherwise travel to the panel; the bridge must refuse it first.
      const badPayload = await client.callTool({ name: "orca_send", arguments: { route: "r", expectedRevision: 0, payload: "nope" } });
      expect(badPayload.isError).toBe(true);
      expect(envelope(badPayload as never).body.error.code).toBe("control-cli-argument-invalid");
    } finally {
      await client.close();
    }
  }, 60_000);
});
