import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_PATTERN } from "../control/commandClient.js";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "./envelope.js";

/**
 * CLI v2 spec §10: one tool. Its input is the CLI argv after `orca`; it runs the CLI in-process with --json, so an agent
 * on MCP meets exactly the commands, pins and refusals the CLI has. Spec §14 R9: it refuses only these domains itself;
 * the panel refuses the rest by tier.
 */
export const MCP_REFUSED_DOMAINS = ["panel", "user", "dev"] as const;

export const TOOLS = [
  {
    name: "orca",
    description: "Runs the Orca CLI with args (the argv after `orca`) and returns its --json answer. Read the orca-control skill, or call it with [\"help\"], for the commands.",
    inputSchema: { type: "object", properties: { args: { type: "array", items: { type: "string" } } }, required: ["args"], additionalProperties: false },
  },
] as const;

const invalid = (message: string): CliResponseV1 => localError(new EntryRejection("control-cli-argument-invalid", message));

/** One call of the tool: validate, refuse the closed domains, run the registry with captured output. Exported for criteria. */
export async function runTool(input: unknown, options: { client: string; stateDirFlag?: string; env: NodeJS.ProcessEnv }): Promise<{ text: string; isError: boolean }> {
  const answer = (response: CliResponseV1) => ({ text: JSON.stringify(response), isError: exitCodeFor(response) !== 0 });
  const args = (input as { args?: unknown } | null)?.args;
  if (!Array.isArray(args) || args.length === 0 || !args.every((word) => typeof word === "string")) return answer(invalid("the orca tool wants {args: string[]}, the argv after orca, e.g. [\"group\", \"list\"]"));
  if ((MCP_REFUSED_DOMAINS as readonly string[]).includes(args[0]!)) return answer(invalid(`orca ${args[0]} is not available over MCP; a person runs it in a terminal`));
  const [{ findCommand, REGISTRY }, { runRegistered, unknownCommand }] = await Promise.all([import("../commands/registry.js"), import("../commands/run.js")]);
  const found = findCommand(args, REGISTRY);
  // `orca control` keeps its own grammar (no --json flag: it always answers JSON).
  const raw = "def" in found && found.def.raw === true;
  const argv = [...args, ...(raw || args.includes("--json") ? [] : ["--json"]), ...(options.stateDirFlag === undefined || args.includes("--control-state-dir") ? [] : ["--control-state-dir", options.stateDirFlag])];
  const out: string[] = [];
  const err: string[] = [];
  // stdin carries the MCP protocol: a command never reads it; a terminal secret is never asked for.
  const io = {
    stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); },
    env: options.env, cwd: process.cwd(), stdinIsTTY: false, stdinText: "", client: options.client,
    readSecret: async () => { throw new EntryRejection("control-cli-argument-invalid", "no terminal over MCP"); },
  };
  let code: number | null;
  try { code = await runRegistered(argv, io); }
  catch (error) { return answer(localError(new EntryRejection("control-cli-crashed", error instanceof Error ? error.message : String(error)))); }
  if (code === null) {
    unknownCommand(args, io);
    return answer(invalid(err.join("").trim() || `unknown command ${JSON.stringify(args.join(" "))}; call ["help"]`));
  }
  const text = out.join("").trim() || err.join("").trim();
  return { text, isError: code !== 0 };
}

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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "orca") {
      return { content: [{ type: "text" as const, text: JSON.stringify(invalid(`unknown tool ${request.params.name}; the one tool is orca`)) }], isError: true };
    }
    const { text, isError } = await runTool(request.params.arguments ?? {}, { client: clientHeader(), env, ...(stateDirFlag === undefined ? {} : { stateDirFlag }) });
    return { content: [{ type: "text" as const, text }], isError };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.on("end", () => resolve());
  });
  return 0;
}
