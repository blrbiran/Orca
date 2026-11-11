import { isAbsolute, resolve } from "node:path";
import { DISPATCHED_RUN_ENV } from "../../control/commandClient.js";
import { EntryRejection, localError } from "../../entry/envelope.js";
import { printResponse } from "../output.js";
import type { CommandIo, ParsedArgs } from "../types.js";

/**
 * Tester follow-up E §9 (D21): `orca project add <name> --path <dir> | --dirs <id,id>`, the Web's add-project form over the
 * control socket (projects.ts addProject, the same handler). A new project is a new directory Orca and its agents write
 * in, so a person adds it: the panel wants an owner's person token (--as-person) and refuses a run Orca dispatched. As
 * `orca auth login` does (CLI browser login spec §6.7, §6.8), it is refused here, before anything is sent, over MCP and
 * under the dispatched-run marker. A relative --path is taken from cwd; the panel wants an absolute one.
 */
export async function runAddProject(args: ParsedArgs, io: CommandIo): Promise<number> {
  const { openSession } = await import("../panelCommand.js");
  const { requestOverSocket } = await import("../../entry/socketClient.js");
  const print = (response: Parameters<typeof printResponse>[0]) => printResponse(response, { json: args.global.json, quiet: args.global.quiet, format: formatAdded }, io);
  try {
    if ((io.client ?? "cli").startsWith("mcp")) throw new EntryRejection("project-add-not-over-mcp", "orca project add is not available over MCP; a person registers a project in a terminal they attend, or in the Web UI");
    if ((io.env[DISPATCHED_RUN_ENV] ?? "") !== "") throw new EntryRejection("control-dispatched-run-refused", "orca project add is not done by a run Orca dispatched; a person registers a project, from the Web UI or an attended session");
    const path = typeof args.flags.path === "string" ? args.flags.path : undefined;
    const dirs = typeof args.flags.dirs === "string" ? args.flags.dirs : undefined;
    if ((path === undefined) === (dirs === undefined)) throw new EntryRejection("control-cli-argument-invalid", "give exactly one of --path <dir> and --dirs <id,id>");
    const body = path !== undefined
      ? { name: String(args.positionals.name), path: isAbsolute(path) ? path : resolve(io.cwd, path) }
      : { name: String(args.positionals.name), dirs: dirs!.split(",").map((id) => id.trim()).filter((id) => id.length > 0) };
    const session = openSession(args, io);
    const { status, body: answer } = await requestOverSocket({ socketPath: session.socketPath, method: "POST", path: "projects", client: session.client, headers: session.headers, body });
    return print({ schema: "orca-cli-response-v1", status, body: answer });
  } catch (error) {
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}

/** The added project's row (projects.ts row/multiRow): its key and kind, and its root or members. */
function formatAdded(body: unknown): string {
  const p = (body as { project?: { projectKey?: string; kind?: string; path?: string; dirs?: Array<{ projectKey: string }>; controlRepoId?: string | null } } | null)?.project;
  if (p === undefined) return "";
  const where = p.kind === "multi" ? `members ${(p.dirs ?? []).map((d) => d.projectKey).join(", ")}` : p.path ?? "";
  return `added project ${p.projectKey ?? "?"} (${p.kind ?? "repo"}): ${where}`;
}
