import { request, type ClientRequest, type IncomingMessage } from "node:http";
import { CLIENT_HEADER } from "../control/commandClient.js";
import { socketPathTooLong } from "../panel/controlSocket.js";
import { EntryRejection } from "./envelope.js";

/** A dropped connection may be the panel restarting; resending the same commandId is safe (spec §4.4). */
const RETRYABLE_TRANSPORT = new Set(["ECONNRESET", "EPIPE"]);

/** Final review I1: every transport failure is an envelope, never a crash -- the caller keeps the commandId. */
function transportRejection(error: unknown): EntryRejection {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
  return new EntryRejection("control-socket-error", `${code}: ${error instanceof Error ? error.message : String(error)}`, RETRYABLE_TRANSPORT.has(code));
}

/** Spec §4: HTTP over the panel's socket. Connection: close, so the panel's shutdown never waits on an idle client. */
export function requestOverSocket(input: { socketPath: string; method: "GET" | "POST"; path: string; client: string; body?: unknown; timeoutMs?: number }): Promise<{ status: number; body: unknown }> {
  if (socketPathTooLong(input.socketPath)) return Promise.reject(new EntryRejection("control-socket-path-too-long", `${Buffer.byteLength(input.socketPath)} bytes: ${input.socketPath}`));
  return new Promise((resolve, reject) => {
    const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
    const onResponse = (res: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown }); }
        // Retryable: the command may have executed, so the agent replays it under the same commandId (final review H6).
        catch { reject(new EntryRejection("control-cli-response-invalid", `the panel answered ${res.statusCode} with a body that is not JSON`, true)); }
      });
    };
    let req: ClientRequest;
    try {
      req = request({
        socketPath: input.socketPath, method: input.method, path: `/api/control/${input.path}`,
        headers: { connection: "close", [CLIENT_HEADER]: input.client, ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }) },
      }, onResponse);
    } catch (error) {
      // http.request throws synchronously for a path it cannot send (ERR_UNESCAPED_CHARACTERS).
      reject(transportRejection(error));
      return;
    }
    req.setTimeout(input.timeoutMs ?? 120_000, () => req.destroy(new EntryRejection("control-socket-timeout", "the panel did not answer in time", true)));
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof EntryRejection) reject(error);
      else if (error.code === "ENOENT" || error.code === "ECONNREFUSED") reject(new EntryRejection("panel-not-running", `no panel is listening at ${input.socketPath}; start it with: orca panel --by <who>`, true));
      else reject(transportRejection(error));
    });
    req.end(payload);
  });
}
