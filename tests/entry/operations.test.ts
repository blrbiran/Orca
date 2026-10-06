import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { idSchema } from "../../src/control/schema.js";
import { exitCodeFor } from "../../src/entry/envelope.js";
import { controlGet, controlSend } from "../../src/entry/operations.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function fakePanel(handler: (method: string, url: string, headers: Record<string, unknown>, body: string) => { status: number; body: unknown }) {
  const dir = await mkdtemp(join(tmpdir(), "of-"));
  const socketPath = join(dir, "control.sock");
  const seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const out = handler(req.method!, req.url!, req.headers, body);
      res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  cleanups.push(async () => { await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  return { socketPath, seen };
}

describe("controlGet / controlSend (spec §4)", () => {
  it("C6-shape: wraps a 200 read verbatim, exit 0, with the client header and the /api/control prefix", async () => {
    const panel = await fakePanel(() => ({ status: 200, body: { schema: "orca-control-summary-v1" } }));
    const out = await controlGet({ socketPath: panel.socketPath, client: "cli", path: "summary?sinceChangeSeq=3" });
    expect(out).toEqual({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-control-summary-v1" } });
    expect(exitCodeFor(out)).toBe(0);
    expect(panel.seen[0]).toMatchObject({ method: "GET", url: "/api/control/summary?sinceChangeSeq=3" });
    expect(panel.seen[0]!.headers["x-orca-client"]).toBe("cli");
  });

  it("C8: a generated commandId matches idSchema and is in the envelope even when the panel answers an error", async () => {
    const panel = await fakePanel(() => ({ status: 409, body: { error: { code: "revision-conflict", retryable: false } } }));
    const out = await controlSend({ socketPath: panel.socketPath, client: "cli", route: "groups/g1/pause-dispatch", expectedRevision: 4, payload: {} });
    expect(out.status).toBe(409);
    expect(idSchema.safeParse(out.commandId).success).toBe(true);
    expect(out.commandId).toMatch(/^cli-[0-9a-f-]{36}$/);
    expect(exitCodeFor(out)).toBe(2);
    expect(JSON.parse(panel.seen[0]!.body)).toEqual({ commandId: out.commandId, expectedRevision: 4, payload: {} });
  });

  it("keeps a given commandId and uses the mcp prefix when asked", async () => {
    const panel = await fakePanel(() => ({ status: 200, body: {} }));
    expect((await controlSend({ socketPath: panel.socketPath, client: "mcp", route: "r", expectedRevision: 0, payload: {}, commandId: "keep-1" })).commandId).toBe("keep-1");
    expect((await controlSend({ socketPath: panel.socketPath, client: "mcp", route: "r", expectedRevision: 0, payload: {}, commandIdPrefix: "mcp" })).commandId).toMatch(/^mcp-/);
  });

  it("C14-lib: no socket is panel-not-running, retryable, exit 1", async () => {
    const out = await controlGet({ socketPath: join(tmpdir(), "nope-" + process.pid, "control.sock"), client: "cli", path: "summary" });
    expect(out).toMatchObject({ status: 0, body: { error: { code: "panel-not-running", retryable: true } } });
    expect(exitCodeFor(out)).toBe(1);
  });

  it("refuses bad paths, binary routes and bad arguments locally, before any request", async () => {
    const panel = await fakePanel(() => ({ status: 200, body: {} }));
    for (const path of ["/summary", "groups/../x", "", "groups/a b"]) {
      expect((await controlGet({ socketPath: panel.socketPath, client: "cli", path })).body).toMatchObject({ error: { code: "control-cli-path-invalid" } });
    }
    expect((await controlGet({ socketPath: panel.socketPath, client: "cli", path: "runs/r1/evidence/a1" })).body).toMatchObject({ error: { code: "control-cli-binary-route" } });
    const sends = [
      await controlSend({ socketPath: panel.socketPath, client: "cli", route: "r", expectedRevision: -1, payload: {} }),
      await controlSend({ socketPath: panel.socketPath, client: "cli", route: "r", expectedRevision: 0, payload: {}, commandId: "-bad" }),
      await controlSend({ socketPath: panel.socketPath, client: "cli", route: "summary?x=1", expectedRevision: 0, payload: {} }),
    ];
    expect(sends.map((out) => (out.body as { error: { code: string } }).error.code)).toEqual(["control-cli-argument-invalid", "control-cli-argument-invalid", "control-cli-path-invalid"]);
    // spec §4.4: the envelope carries the commandId even on a local error
    for (const out of sends) expect(out.commandId).toBeDefined();
    expect(panel.seen).toEqual([]);
  });

  it("C15-lib: a socket path over the limit is refused by name", async () => {
    const out = await controlGet({ socketPath: "/" + "a".repeat(120) + "/control.sock", client: "cli", path: "summary" });
    expect(out.body).toMatchObject({ error: { code: "control-socket-path-too-long" } });
  });
});
