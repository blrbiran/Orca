import { exitCodeFor, type CliResponseV1 } from "../entry/envelope.js";

/** Spec §14 R1(b): what was sent, so an uncertain outcome can be replayed byte-for-byte by `orca command retry`. */
export interface SentRequest { route: string; expectedRevision: number; payload: unknown; commandId: string }

/** Spec §7: `orca-cli-response-v1` generalised; `request` only when the outcome is uncertain. */
export type CliEnvelope = CliResponseV1 & { request?: SentRequest };

export function envelope(response: CliResponseV1, request?: SentRequest): CliEnvelope {
  return request === undefined ? response : { ...response, request };
}

function errorOf(body: unknown): { code: string; message: string } | null {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return error && typeof error.code === "string" ? { code: error.code, message: typeof error.message === "string" ? error.message : "" } : null;
}

/**
 * Spec §7: `--json` prints exactly one line; otherwise the command's formatter for a 2xx body, or one named error line on
 * stderr. No automatic JSON when stdout is not a TTY. Exit 0 answered 2xx, 1 refused here, 2 the panel answered an error.
 */
export function printResponse(
  response: CliResponseV1,
  options: { json: boolean; quiet: boolean; format(body: unknown): string },
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
  io.stderr(`orca: ${error === null ? `status ${response.status}` : `${error.code}: ${error.message}`}\n`);
  if (response.commandId !== undefined) io.stderr(`orca: command id ${response.commandId}\n`);
  if (request !== undefined) io.stderr(`orca: the outcome is uncertain; re-run with --json to keep the request for orca command retry\n`);
  return code;
}
