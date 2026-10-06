// Agent entry spec §4, §4.4 (C16): every transport outcome is one envelope -- a dropped connection, a wedged panel or an
// unsendable path never escapes as a crash (exit 3, empty stdout) or as an MCP protocol error.
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exitCodeFor } from "../../src/entry/envelope.js";
import { controlGet, controlSend } from "../../src/entry/operations.js";
import { requestOverSocket } from "../../src/entry/socketClient.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

/** A socket server whose request handler is the test's: it can drop the connection, never answer, or answer garbage. */
async function rawPanel(onRequest: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) {
  const dir = await mkdtemp(join(tmpdir(), "oc-"));
  const socketPath = join(dir, "control.sock");
  let requests = 0;
  const server: Server = createServer((req, res) => { requests += 1; onRequest(req, res); });
  await new Promise<void>((r) => server.listen(socketPath, r));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  return { socketPath, requests: () => requests };
}

describe("transport errors are envelopes (spec §4.4, C16)", () => {
  it("a panel that drops the connection mid-request is control-socket-error, retryable, and the commandId survives", async () => {
    const panel = await rawPanel((req) => req.socket.destroy());
    const out = await controlSend({ socketPath: panel.socketPath, client: "cli", route: "groups/g1/pause-dispatch", expectedRevision: 3, payload: {}, commandId: "keep-me" });
    expect(out).toMatchObject({ schema: "orca-cli-response-v1", status: 0, commandId: "keep-me", body: { error: { code: "control-socket-error", retryable: true } } });
    // The message names the transport code, so a person reading it knows it was the connection, not the command.
    expect((out.body as { error: { message: string } }).error.message).toMatch(/^ECONNRESET: /);
    expect(exitCodeFor(out)).toBe(1);
    expect(panel.requests()).toBe(1);
  });

  it("an unsendable path (http.request throws synchronously) is a rejection, not a throw", async () => {
    const panel = await rawPanel((_req, res) => res.end("{}"));
    await expect(requestOverSocket({ socketPath: panel.socketPath, method: "GET", path: "summary?x=a b", client: "cli" }))
      .rejects.toMatchObject({ code: "control-socket-error", retryable: false });
    expect(panel.requests()).toBe(0);
  });

  it("controlGet refuses a query with a space or a non-ASCII character as a path error, before any request", async () => {
    const panel = await rawPanel((_req, res) => res.end("{}"));
    for (const path of ["summary?x=a b", "summary?x=é", "summary?x=a\tb"]) {
      const out = await controlGet({ socketPath: panel.socketPath, client: "cli", path });
      expect(out, path).toMatchObject({ status: 0, body: { error: { code: "control-cli-path-invalid", retryable: false } } });
    }
    expect(panel.requests()).toBe(0);
  });

  it("D3: a panel that never answers is control-socket-timeout, retryable", async () => {
    const panel = await rawPanel(() => { /* never answers */ });
    await expect(requestOverSocket({ socketPath: panel.socketPath, method: "GET", path: "summary", client: "cli", timeoutMs: 50 }))
      .rejects.toMatchObject({ code: "control-socket-timeout", retryable: true });
  });

  it("a body that is not JSON is control-cli-response-invalid and retryable: the command may have executed, so replay its id", async () => {
    const panel = await rawPanel((_req, res) => res.writeHead(200).end("not json"));
    await expect(requestOverSocket({ socketPath: panel.socketPath, method: "POST", path: "r", client: "cli", body: {} }))
      .rejects.toMatchObject({ code: "control-cli-response-invalid", retryable: true });
  });
});
