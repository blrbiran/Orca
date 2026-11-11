/**
 * CLI v2 spec §4, §6.2, §14 R1: one write. Pins come from reads of this invocation; the revision is the one just read
 * unless --if-revision gives it; a transport drop is retried once with the same bytes; an uncertain outcome hands back
 * the exact request so `orca command retry` can replay it.
 */
import { randomUUID } from "node:crypto";
import { commandArgumentsHash } from "../control/commandArguments.js";
import { ControlError } from "../control/errors.js";
import { idSchema } from "../control/schema.js";
import { EntryRejection, type CliResponseV1 } from "../entry/envelope.js";
import { controlSend } from "../entry/operations.js";
import { scopesOf, targetOf } from "./commandScope.js";
import type { SentRequest } from "./output.js";
import { PanelAnswer, type PanelSession } from "./panelCommand.js";
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
    case "corrections": case "flows": case "plan-library": return 0;
    case "schedule": {
      if (mapping.scopeId === undefined) throw new Error("a schedule-scoped row names its schedule (scopeId)");
      const scheduleId = await mapping.scopeId(context);
      // Plan B2: a schedule not yet created is revision 0 (its read answers 404).
      try { return num(fieldOf(await context.read(`schedules/${encodeURIComponent(scheduleId)}`), "revision")); }
      catch (error) { if (error instanceof PanelAnswer && error.response.status === 404) return 0; throw error; }
    }
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

/**
 * Issue #149: a re-run with the same --command-id (after a timeout, say) re-reads the revision, so its raw request is not the
 * booked one and the panel would refuse it as command-id-conflict even when the first attempt succeeded (spec §14 R1 keeps
 * replay byte-exact). So the id is looked up first: booked with the same arguments (commandArgumentsHash of verb, target and
 * the payload as it goes on the wire) -> its outcome, and nothing is sent. Booked with other arguments, not booked, or not
 * answerable -> null, and the request is sent as before, so a real conflict stays the panel's command-id-conflict.
 */
async function bookedOutcome(verb: string, route: string, payload: unknown, commandId: string, context: WriteContext, session: PanelSession): Promise<CliResponseV1 | null> {
  if (payload === undefined || !idSchema.safeParse(commandId).success) return null;
  let sent: unknown;
  let scopes: string[];
  try {
    // What the panel receives: JSON drops undefined fields, so they are not part of what it hashes either.
    sent = JSON.parse(JSON.stringify(payload));
    scopes = await scopesOf({ route, payload: sent, expectedRevision: 0, commandId }, context);
  } catch (error) {
    // A route with no known scope, or a read it needs refused: no lookup; the send decides as before.
    if (error instanceof EntryRejection || error instanceof PanelAnswer) return null;
    throw error;
  }
  for (const scope of scopes) {
    const found = await session.fresh(`groups/${scope}/commands/${commandId}`);
    if (found.status !== 200) continue;
    const lookup = found.body as { originalStatus?: unknown; body?: unknown; argumentsHash?: unknown };
    let mine: string;
    try { mine = commandArgumentsHash({ verb, target: targetOf(route, sent, scope), payload: sent }); }
    catch (error) { if (error instanceof ControlError) return null; throw error; }
    if (lookup.argumentsHash !== mine || typeof lookup.originalStatus !== "number") return null;
    return { schema: "orca-cli-response-v1", status: lookup.originalStatus, commandId, body: lookup.body };
  }
  return null;
}

export async function runWrite(_def: CommandDef, mapping: VerbMapping, context: WriteContext, session: PanelSession): Promise<{ response: CliResponseV1; request?: SentRequest; replayed?: true }> {
  const payload = await mapping.payload(context);
  const route = await mapping.route(context);
  const { commandId, ifRevision } = context.args.global;
  // Issue #149: --if-revision names the exact request already, so it is sent as given (the ledger replays or refuses it).
  if (commandId !== undefined && ifRevision === undefined) {
    const booked = await bookedOutcome(mapping.verb, route, payload, commandId, context, session);
    if (booked !== null) return { response: booked, replayed: true };
  }
  const expectedRevision = ifRevision ?? await readRevision(mapping, context);
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
