import { isAbsolute, relative, resolve } from "node:path";
import { EntryRejection, localError } from "../../entry/envelope.js";
import { printResponse } from "../output.js";
import type { CommandIo, ParsedArgs } from "../types.js";

/** CLI v2 spec §14 R4: the socket's plans route; the path is sent relative to the project root, as the Web form sends it. */
export async function runRegisterPlan(args: ParsedArgs, io: CommandIo): Promise<number> {
  const { contextFor, openSession } = await import("../panelCommand.js");
  const { requestOverSocket } = await import("../../entry/socketClient.js");
  const print = (response: Parameters<typeof printResponse>[0]) => printResponse(response, { json: args.global.json, quiet: args.global.quiet, format: (body) => JSON.stringify(body) }, io);
  try {
    const session = openSession(args, io);
    const project = await contextFor(args, io, session, {}).project();
    const path = relative(project.path, resolve(io.cwd, String(args.positionals.path)));
    if (path === "" || path.startsWith("..") || isAbsolute(path)) throw new EntryRejection("control-cli-argument-invalid", `${String(args.positionals.path)} is not inside the project ${project.projectKey} (${project.path})`);
    const { status, body } = await requestOverSocket({ socketPath: session.socketPath, method: "POST", path: `projects/${encodeURIComponent(project.projectKey)}/plans`, client: session.client, headers: session.headers, body: { path } });
    return print({ schema: "orca-cli-response-v1", status, body });
  } catch (error) {
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
