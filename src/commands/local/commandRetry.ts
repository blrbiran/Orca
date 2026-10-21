/**
 * CLI v2 spec §14 R1(c): `orca command retry --request <file|->`. The retained result is looked up under the request's
 * scope first; a found result is printed and nothing is sent. Only a confirmed miss (404 command-result-not-found) resends
 * -- the stored bytes exactly, so the panel replays a command id it already holds instead of refusing command-id-conflict.
 * No local journal: the request travels in the caller's hands (the --json envelope).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EntryRejection, localError, type CliResponseV1 } from "../../entry/envelope.js";
import { printResponse, type SentRequest } from "../output.js";
import type { CommandIo, ParsedArgs, WriteContext } from "../types.js";
import { readStdin } from "./stdin.js";

const invalid = (message: string) => new EntryRejection("control-cli-argument-invalid", message);

function parseRequest(text: string): SentRequest {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw invalid("--request is not JSON"); }
  const r = value as Partial<SentRequest> | null;
  if (r === null || typeof r !== "object" || typeof r.route !== "string" || typeof r.commandId !== "string" || !Number.isSafeInteger(r.expectedRevision) || (r.expectedRevision as number) < 0 || !("payload" in r)) {
    throw invalid("--request wants the envelope's request: {route, expectedRevision, payload, commandId}");
  }
  return { route: r.route, expectedRevision: r.expectedRevision as number, payload: r.payload, commandId: r.commandId };
}

/** The scopes a request's command id is booked under (controlApi.ts controlCommandRoutes). */
async function scopesOf(request: SentRequest, context: WriteContext): Promise<string[]> {
  const route = request.route;
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (route === "groups/import-plan" || route === "requirements") return [String(payload.groupId)];
  const debug = /^corrections\/([^/]+)\/debug-group$/.exec(route);
  if (debug) {
    const base = `debug-${debug[1]}`;
    const groups = ((await context.read("summary")) as { groups: Array<{ groupId: string }> }).groups.map((g) => g.groupId);
    const ids = groups.filter((id) => id === base || id.startsWith(`${base}-`));
    return ids.length === 0 ? [base] : ids;
  }
  if (route.startsWith("corrections")) return ["@corrections"];
  const groupRoute = /^groups\/([^/]+)\//.exec(route);
  if (groupRoute) return [groupRoute[1]!];
  const repository = /^repositories\/([^/]+)\//.exec(route);
  if (repository) return [`@repository:${repository[1]}`];
  if (route === "operator/agent-preferences" || route === "operator/apply-agent-update") {
    return [`@operator:${String(((await context.read("operator/agent-preferences")) as { operatorId: unknown }).operatorId)}`];
  }
  if (["operator/set-spend-cap", "operator/clear-spend-cap", "operator/set-usage-calendar"].includes(route)) return ["@spend"];
  if (route === "operator/set-orchestration-settings") return ["@orchestration"];
  if (route === "recovery/retry") {
    if (payload.scope === "group") return [String(payload.groupId)];
    const { groupOfRunId } = await import("../domains/settings.js");
    return [await groupOfRunId(context, String(payload.runId))];
  }
  throw invalid(`no command scope is known for route ${JSON.stringify(route)}`);
}

const codeOf = (response: CliResponseV1): unknown => (response.body as { error?: { code?: unknown } } | null)?.error?.code;

export async function runCommandRetry(args: ParsedArgs, io: CommandIo): Promise<number> {
  const print = (response: CliResponseV1, request?: SentRequest) => printResponse(response, { json: args.global.json, quiet: args.global.quiet, format: (body) => JSON.stringify(body) }, io, request);
  try {
    const source = String(args.flags.request);
    let text: string;
    if (source === "-") text = io.stdinText ?? await readStdin();
    else { try { text = readFileSync(resolve(io.cwd, source), "utf8"); } catch (error) { throw invalid(`--request: cannot read ${source}: ${(error as Error).message}`); } }
    const request = parseRequest(text);
    const { contextFor, openSession } = await import("../panelCommand.js");
    const { sendExactly, uncertain, withCurrentRevision } = await import("../write.js");
    const session = openSession(args, io);
    const context = contextFor(args, io, session, {});
    let firstOther: CliResponseV1 | null = null;
    for (const scope of await scopesOf(request, context)) {
      const found = await session.fresh(`groups/${scope}/commands/${request.commandId}`);
      if (found.status === 200) {
        const lookup = found.body as { originalStatus: number; body: unknown };
        return print({ schema: "orca-cli-response-v1", status: lookup.originalStatus, commandId: request.commandId, body: lookup.body });
      }
      if (!(found.status === 404 && codeOf(found) === "command-result-not-found")) firstOther ??= found;
    }
    // Not a confirmed miss (the lookup failed, or the outcome is still being reconciled): say so, send nothing.
    if (firstOther !== null) return print(firstOther, request);
    const response = withCurrentRevision(await sendExactly(session, request));
    return print(response, uncertain(response) ? request : undefined);
  } catch (error) {
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
