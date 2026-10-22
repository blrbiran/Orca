/**
 * CLI v2 spec §4, §6.2, §14 R1: one write. Pins come from reads of this invocation; the revision is the one just read
 * unless --if-revision gives it; a transport drop is retried once with the same bytes; an uncertain outcome hands back
 * the exact request so `orca command retry` can replay it.
 */
import { randomUUID } from "node:crypto";
import type { CliResponseV1 } from "../entry/envelope.js";
import { controlSend } from "../entry/operations.js";
import type { SentRequest } from "./output.js";
import type { PanelSession } from "./panelCommand.js";
import type { CommandDef, VerbMapping, WriteContext } from "./types.js";

const num = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) ? value : 0);
const fieldOf = (body: unknown, key: string): unknown => (body !== null && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);

/** Spec §6.1: the counter the panel checks `expectedRevision` against, read now. A group not yet created is 0. */
export async function readRevision(mapping: VerbMapping, context: WriteContext): Promise<number> {
  switch (typeof mapping.scope === "function" ? mapping.scope(context) : mapping.scope) {
    case "group": {
      const groupId = mapping.scopeId === undefined ? context.ids.group : await mapping.scopeId(context);
      const summary = await context.read("summary") as { groups: Array<{ groupId: string; commandRevision: number }> };
      return num(summary.groups.find((g) => g.groupId === groupId)?.commandRevision);
    }
    case "repository": {
      const repoId = mapping.scopeId === undefined ? (await context.project()).repoId : await mapping.scopeId(context);
      return num(fieldOf(await context.read(`repositories/${repoId}/workspace`), "revision"));
    }
    case "operator": return num(fieldOf(await context.read("operator/agent-preferences"), "revision"));
    case "spend": return num(fieldOf(await context.read("usage?scope=all"), "spendRevision"));
    case "orchestration": return num(fieldOf(await context.read("orchestration"), "revision"));
    case "corrections": case "flows": return 0;
  }
}

const errorOf = (response: CliResponseV1): { code?: string; retryable?: boolean; commandRevision?: number | null } | undefined =>
  fieldOf(response.body, "error") as { code?: string; retryable?: boolean; commandRevision?: number | null } | undefined;

/** Spec §14 R1(b): timeout, dropped connection, or any retryable answer -- the command may have run. */
export function uncertain(response: CliResponseV1): boolean {
  const error = errorOf(response);
  if (error?.retryable !== true) return false;
  return !["panel-not-running", "control-socket-path-too-long"].includes(String(error.code));
}

/** Send exactly these bytes; a dropped connection is retried once, the same bytes again (spec §14 R1(a)). */
export async function sendExactly(session: PanelSession, request: SentRequest): Promise<CliResponseV1> {
  const send = () => controlSend({ socketPath: session.socketPath, client: session.client, headers: session.headers, ...request });
  const first = await send();
  return first.status === 0 && errorOf(first)?.code === "control-socket-error" && errorOf(first)?.retryable === true ? send() : first;
}

/** Spec §6.3: a revision-conflict answer names the current revision at the top of the body. */
export function withCurrentRevision(response: CliResponseV1): CliResponseV1 {
  const error = errorOf(response);
  if (error?.code !== "revision-conflict" || typeof response.body !== "object" || response.body === null) return response;
  return { ...response, body: { ...(response.body as object), currentRevision: error.commandRevision ?? null } };
}

export async function runWrite(_def: CommandDef, mapping: VerbMapping, context: WriteContext, session: PanelSession): Promise<{ response: CliResponseV1; request?: SentRequest }> {
  const payload = await mapping.payload(context);
  const route = await mapping.route(context);
  const expectedRevision = context.args.global.ifRevision ?? await readRevision(mapping, context);
  // Review M4 (session b37f7ce9): a command id names its entry, as controlSend's commandIdPrefix does -- `mcp-` when the
  // MCP server runs the CLI in-process (client `mcp` or `mcp:<name>`), `cli-` otherwise.
  const prefix = session.client === "mcp" || session.client.startsWith("mcp:") ? "mcp" : "cli";
  const request: SentRequest = { route, expectedRevision, payload, commandId: context.args.global.commandId ?? `${prefix}-${randomUUID()}` };
  let response = withCurrentRevision(await sendExactly(session, request));
  if (mapping.conflictDocument !== undefined && fieldOf(response.body, "currentRevision") !== undefined) {
    // Spec §6.3 (builder's choice): the panel cannot list changed fields cheaply, so the answer carries the document now.
    session.forget();
    response = { ...response, body: { ...(response.body as object), current: await mapping.conflictDocument(context) } };
  }
  return uncertain(response) ? { response, request } : { response };
}
