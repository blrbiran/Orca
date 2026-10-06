import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_PATTERN } from "../control/commandClient.js";
import { discoverSocketPath } from "./discovery.js";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "./envelope.js";
import { controlGet, controlSend } from "./operations.js";

const TOOLS = [
  {
    name: "orca_read",
    description: "Read Orca control state from the running panel: summary, groups/<id>, groups/<id>/requirement, recovery, groups/<scope>/commands/<commandId>, config, agents, operator/agent-preferences. Returns {schema:'orca-cli-response-v1',status,body}.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "orca_send",
    description: "Deliver one control command to the running panel (route as in the orca-control skill, e.g. groups/<id>/requirement/answer). Read the revision first; reuse commandId when retrying. set-limit and budget limit fields are refused: a person sets them. Returns {schema,status,commandId,body}.",
    inputSchema: {
      type: "object",
      properties: { route: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 }, payload: { type: "object" }, commandId: { type: "string" } },
      required: ["route", "expectedRevision", "payload"],
      additionalProperties: false,
    },
  },
] as const;

/** Spec §8: a stdio MCP server that is only a socket client. No resources, prompts or tasks; never starts a panel. stdout carries protocol frames only. */
export async function runMcpServe(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const flag = args[0] === "serve" ? args.indexOf("--control-state-dir") : -1;
  if (args[0] !== "serve" || (args.length !== 1 && !(args.length === 3 && flag === 1))) {
    process.stderr.write("usage: orca mcp serve [--control-state-dir <dir>]\n");
    return 1;
  }
  const stateDirFlag = flag === 1 ? args[2] : undefined;
  const server = new Server({ name: "orca", version: "0.1.0" }, { capabilities: { tools: {} } });
  // Spec §4.3: x-orca-client is mcp[:<name>]; a client name the pattern refuses degrades to plain "mcp".
  const clientHeader = (): string => {
    const name = server.getClientVersion()?.name;
    return name !== undefined && CLIENT_PATTERN.test(`mcp:${name}`) ? `mcp:${name}` : "mcp";
  };
  const result = (response: CliResponseV1) => ({ content: [{ type: "text" as const, text: JSON.stringify(response) }], isError: exitCodeFor(response) !== 0 });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const input = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const socketPath = discoverSocketPath({ stateDirFlag, env });
      if (request.params.name === "orca_read") {
        if (typeof input.path !== "string") throw new EntryRejection("control-cli-argument-invalid", "path must be a string");
        return result(await controlGet({ socketPath, client: clientHeader(), path: input.path }));
      }
      if (request.params.name === "orca_send") {
        const { route, expectedRevision, payload, commandId } = input;
        if (typeof route !== "string" || typeof expectedRevision !== "number" || typeof payload !== "object" || payload === null || Array.isArray(payload) || (commandId !== undefined && typeof commandId !== "string"))
          throw new EntryRejection("control-cli-argument-invalid", "orca_send wants route (string), expectedRevision (integer), payload (object), commandId (string, optional)");
        return result(await controlSend({ socketPath, client: clientHeader(), route, expectedRevision, payload, commandId: commandId as string | undefined, commandIdPrefix: "mcp" }));
      }
      throw new EntryRejection("control-cli-argument-invalid", `unknown tool ${request.params.name}`);
    } catch (error) {
      if (error instanceof EntryRejection) return result(localError(error));
      throw error;
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.on("end", () => resolve());
  });
  return 0;
}
