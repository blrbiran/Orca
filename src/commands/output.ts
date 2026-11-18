import { exitCodeFor, type CliResponseV1 } from "../entry/envelope.js";
import { nextForCode } from "./errorNext.js";

/** Spec §14 R1(b): what was sent, so an uncertain outcome can be replayed byte-for-byte by `orca command retry`. */
export interface SentRequest { route: string; expectedRevision: number; payload: unknown; commandId: string }

/** Spec §7: `orca-cli-response-v1` generalised; `request` only when the outcome is uncertain. */
export type CliEnvelope = CliResponseV1 & { request?: SentRequest };

export function envelope(response: CliResponseV1, request?: SentRequest): CliEnvelope {
  return request === undefined ? response : { ...response, request };
}

export function errorOf(body: unknown): { code: string; message: string } | null {
  // The control routes answer {error:{code,message}}; the plans route answers {code,message} like the HTTP API.
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error ?? body as { code?: unknown; message?: unknown } | null;
  return error && typeof error.code === "string" ? { code: error.code, message: typeof error.message === "string" ? error.message : "" } : null;
}

/**
 * Tester #373: the panel's message is `code` or `code:detail` (ControlError.message, kept as stored in command results), so
 * `code: message` named the code twice. The code once, then the whole detail (it may hold colons); any other message as is.
 */
function refusalLine(error: { code: string; message: string }): string {
  if (error.message === error.code || error.message === "") return error.code;
  if (error.message.startsWith(`${error.code}:`)) return `${error.code}: ${error.message.slice(error.code.length + 1)}`;
  return `${error.code}: ${error.message}`;
}

/**
 * Spec §7: `--json` prints exactly one line; otherwise the command's formatter for a 2xx body, or one named error line on
 * stderr. No automatic JSON when stdout is not a TTY. Exit 0 answered 2xx, 1 refused here, 2 the panel answered an error.
 */
export function printResponse(
  response: CliResponseV1,
  options: { json: boolean; quiet: boolean; format(body: unknown): string; hint?(error: { code: string; message: string }): string | undefined; next?: readonly string[]; groupId?: string },
  io: { stdout(text: string): void; stderr(text: string): void },
  request?: SentRequest,
): number {
  const code = exitCodeFor(response);
  if (options.json) {
    io.stdout(`${JSON.stringify(envelope(response, request))}\n`);
    return code;
  }
  if (code === 0) {
    if (!options.quiet) {
      const text = options.format(response.body);
      if (text.length > 0) io.stdout(text.endsWith("\n") ? text : `${text}\n`);
    }
    return code;
  }
  const error = errorOf(response.body);
  io.stderr(`orca: ${error === null ? `status ${response.status}` : refusalLine(error)}\n`);
  const hint = error === null ? undefined : options.hint?.(error);
  // Tester #373: a common refusal no verb explains, and whose response names no next command, says the next step from
  // one table (with the group's id when the CLI knows it).
  const shownHint = hint ?? (error === null || (options.next?.length ?? 0) > 0 ? null : nextForCode(error.code, options.groupId));
  if (shownHint != null) io.stderr(`orca: ${shownHint}\n`);
  for (const command of options.next ?? []) io.stderr(`orca: next: ${command}\n`);
  if (response.commandId !== undefined) io.stderr(`orca: command id ${response.commandId}\n`);
  // Issue #149 (session 3cfc2e73): a reused --command-id naming other arguments, or another --if-revision, is a different
  // request (spec §14 R1 keeps the replay identity byte-exact; a re-run with the same arguments is replayed by runWrite);
  // name the two commands that do look up or replay what that id already holds.
  if (error?.code === "command-id-conflict" && response.commandId !== undefined) {
    io.stderr(`orca: this command id already names a different request (other arguments, or another --if-revision); see what it did with orca command show ${response.commandId} --group <group> (or its other scope flag), or replay the exact saved request with orca command retry --request <file|->\n`);
  }
  if (request !== undefined) io.stderr(`orca: the outcome is uncertain; re-run with --json to keep the request for orca command retry\n`);
  return code;
}
