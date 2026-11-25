import { DISPATCHED_RUN_ENV } from "../../control/commandClient.js";
import { EntryRejection, localError } from "../../entry/envelope.js";
import { printResponse } from "../output.js";
import type { CommandIo, ParsedArgs } from "../types.js";

/**
 * Project remove spec 2026-11-25 §6 (tester #470, session 5d3d0c09): `orca project remove <id|name> [--archive-groups]`,
 * the Web's Remove over the control socket (projects.ts removeProject, the same handler). A person's act, as `project add`
 * is: refused here over MCP and under the dispatched-run marker, and by the panel without an owner's person token.
 * §6.2 a: the name is sent as given and resolved by the panel against the projects file, mounted or not -- never through
 * the CLI's project context, which drops a project whose folder is gone.
 */
export async function runRemoveProject(args: ParsedArgs, io: CommandIo): Promise<number> {
  const { openSession } = await import("../panelCommand.js");
  const { requestOverSocket } = await import("../../entry/socketClient.js");
  const print = (response: Parameters<typeof printResponse>[0]) => printResponse(response, { json: args.global.json, quiet: args.global.quiet, format: formatRemoved,
    ...(refusalNext(response.body).length === 0 ? {} : { next: refusalNext(response.body) }) }, io);
  try {
    if ((io.client ?? "cli").startsWith("mcp")) throw new EntryRejection("project-remove-not-over-mcp", "orca project remove is not available over MCP; a person removes a project in a terminal they attend, or in the Web UI");
    if ((io.env[DISPATCHED_RUN_ENV] ?? "") !== "") throw new EntryRejection("control-dispatched-run-refused", "orca project remove is not done by a run Orca dispatched; a person removes a project, from the Web UI or an attended session");
    const name = String(args.positionals.project);
    const session = openSession(args, io);
    const { status, body } = await requestOverSocket({ socketPath: session.socketPath, method: "POST", path: `projects/${encodeURIComponent(name)}/remove`,
      client: session.client, headers: session.headers, body: args.flags["archive-groups"] === true ? { archiveGroups: true } : {} });
    return print({ schema: "orca-cli-response-v1", status, body });
  } catch (error) {
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}

/** A refusal's `next` lines (project-has-groups names the command that archives and removes). */
function refusalNext(body: unknown): string[] {
  const next = (body as { code?: unknown; next?: unknown } | null)?.next;
  return (body as { code?: unknown } | null)?.code !== undefined && Array.isArray(next) ? next.filter((line): line is string => typeof line === "string") : [];
}

/** The removed project, the groups archived on the way, and what comes next. */
function formatRemoved(body: unknown): string {
  const b = body as { removed?: { projectKey?: string; kind?: string; path?: string; dirs?: string[] }; archivedGroups?: string[]; archivedBefore?: number; next?: string[] } | null;
  if (b?.removed === undefined) return "";
  const where = b.removed.kind === "multi" ? `members ${(b.removed.dirs ?? []).join(", ")}` : b.removed.path ?? "";
  const lines = [`removed project ${b.removed.projectKey ?? "?"} (${b.removed.kind ?? "repo"}): ${where}`];
  const archived = b.archivedGroups ?? [];
  if (archived.length > 0) lines.push(`archived ${archived.length} group${archived.length === 1 ? "" : "s"}: ${archived.join(", ")}`);
  if ((b.archivedBefore ?? 0) > 0) lines.push(`${b.archivedBefore} group${b.archivedBefore === 1 ? " was" : "s were"} archived already`);
  for (const line of b.next ?? []) lines.push(`next: ${line}`);
  return lines.join("\n");
}
