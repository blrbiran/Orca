/** Agent entry spec §4.4: the one JSON object the CLI prints and the MCP bridge returns. */
export interface CliResponseV1 { schema: "orca-cli-response-v1"; status: number; commandId?: string; body: unknown }

/** A refusal made on this side of the socket; `status` 0 in the envelope. */
export class EntryRejection extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message); }
}

export function localError(error: EntryRejection, commandId?: string): CliResponseV1 {
  return { schema: "orca-cli-response-v1", status: 0, ...(commandId === undefined ? {} : { commandId }), body: { error: { code: error.code, message: error.message, retryable: error.retryable } } };
}

/** 0: the panel answered 2xx. 1: refused here. 2: the panel answered an error (its body names it). */
export function exitCodeFor(response: CliResponseV1): 0 | 1 | 2 {
  if (response.status === 0) return 1;
  return response.status >= 200 && response.status < 300 ? 0 : 2;
}
