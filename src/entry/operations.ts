import { randomUUID } from "node:crypto";
import { idSchema } from "../control/schema.js";
import { EntryRejection, localError, type CliResponseV1 } from "./envelope.js";
import { requestOverSocket } from "./socketClient.js";

const SEGMENT = /^[A-Za-z0-9@:._-]+$/;
const BINARY = /^runs\/[^/?]+\/evidence\/[^/?]+/;

/** Spec §4.1: the CLI checks only what it needs to build a request; the panel's schemas judge the rest. */
function checkPath(path: string, allowQuery: boolean): void {
  const [route, query] = path.split("?", 2) as [string, string | undefined];
  if (query !== undefined && !allowQuery) throw new EntryRejection("control-cli-path-invalid", "a command route takes no query string");
  // Printable ASCII only: a space or a non-ASCII byte cannot travel in a request line unencoded (final review I1).
  if (query !== undefined && !/^[\x21-\x7e]*$/.test(query)) throw new EntryRejection("control-cli-path-invalid", `the query string must be printable ASCII with no spaces (percent-encode the rest): ${JSON.stringify(path)}`);
  const segments = route.split("/");
  if (route.length === 0 || segments.some((segment) => !SEGMENT.test(segment) || segment === "." || segment === ".."))
    throw new EntryRejection("control-cli-path-invalid", `not a control path: ${JSON.stringify(path)} (no leading /, no .., ASCII segments)`);
  if (allowQuery && BINARY.test(route)) throw new EntryRejection("control-cli-binary-route", "evidence artifacts are binary; read runs/<id>/evidence for the manifest");
}

export async function controlGet(input: { socketPath: string; client: string; path: string }): Promise<CliResponseV1> {
  try {
    checkPath(input.path, true);
    const { status, body } = await requestOverSocket({ socketPath: input.socketPath, method: "GET", path: input.path, client: input.client });
    return { schema: "orca-cli-response-v1", status, body };
  } catch (error) {
    if (error instanceof EntryRejection) return localError(error);
    throw error;
  }
}

/** D9: the owner-only settlement route is recognized by the panel; socket/MCP senders receive its 403 permission refusal. */
export async function controlSend(input: { socketPath: string; client: string; route: string; expectedRevision: number; payload: unknown; commandId?: string; commandIdPrefix?: "cli" | "mcp" }): Promise<CliResponseV1> {
  const commandId = input.commandId ?? `${input.commandIdPrefix ?? "cli"}-${randomUUID()}`;
  try {
    checkPath(input.route, false);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new EntryRejection("control-cli-argument-invalid", "--expected-revision wants a non-negative integer");
    if (!idSchema.safeParse(commandId).success) throw new EntryRejection("control-cli-argument-invalid", "--command-id must start with a letter or digit, at most 200 characters");
    const { status, body } = await requestOverSocket({ socketPath: input.socketPath, method: "POST", path: input.route, client: input.client, body: { commandId, expectedRevision: input.expectedRevision, payload: input.payload } });
    return { schema: "orca-cli-response-v1", status, commandId, body };
  } catch (error) {
    if (error instanceof EntryRejection) return localError(error, commandId);
    throw error;
  }
}
