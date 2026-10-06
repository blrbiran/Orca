import { request } from "node:http";
import { CLIENT_HEADER } from "../control/commandClient.js";
import { socketPathTooLong } from "../panel/controlSocket.js";
import { EntryRejection } from "./envelope.js";

/** Spec §4: HTTP over the panel's socket. Connection: close, so the panel's shutdown never waits on an idle client. */
export function requestOverSocket(input: { socketPath: string; method: "GET" | "POST"; path: string; client: string; body?: unknown; timeoutMs?: number }): Promise<{ status: number; body: unknown }> {
  if (socketPathTooLong(input.socketPath)) return Promise.reject(new EntryRejection("control-socket-path-too-long", `${Buffer.byteLength(input.socketPath)} bytes: ${input.socketPath}`));
  return new Promise((resolve, reject) => {
    const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
    const req = request({
      socketPath: input.socketPath, method: input.method, path: `/api/control/${input.path}`,
      headers: { connection: "close", [CLIENT_HEADER]: input.client, ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown }); }
        catch { reject(new EntryRejection("control-cli-response-invalid", `the panel answered ${res.statusCode} with a body that is not JSON`)); }
      });
    });
    req.setTimeout(input.timeoutMs ?? 120_000, () => req.destroy(new EntryRejection("control-socket-timeout", "the panel did not answer in time", true)));
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof EntryRejection) reject(error);
      else if (error.code === "ENOENT" || error.code === "ECONNREFUSED") reject(new EntryRejection("panel-not-running", `no panel is listening at ${input.socketPath}; start it with: orca panel --by <who>`, true));
      else reject(error);
    });
    req.end(payload);
  });
}
