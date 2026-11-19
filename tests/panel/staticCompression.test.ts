import { createServer, request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStaticFiles, registerStaticRoutes } from "../../src/panel/staticFiles.js";

/**
 * Tester #394 (human decision: gzip now, with node:zlib and no npm dependency).
 * The fixture is served through the SAME handler the panel registers
 * (`registerStaticRoutes`), so these criteria exercise the route itself rather
 * than a reimplementation of its branch conditions.
 */
describe("static gzip (tester #394)", () => {
  const largeHtml = `<html><body>${"compressible page body ".repeat(120)}</body></html>`;
  const largeJs = `export const payload = "${"javascript payload ".repeat(120)}";\n`;
  const largeJson = JSON.stringify({ rows: Array.from({ length: 120 }, (_, i) => ({ i })) });
  const font = Buffer.alloc(4096, 7);
  // Exactly at the threshold: 1024 bytes is NOT compressed (the rule is `> 1024`),
  // so a mutation to `>=` is visible here rather than sliding under a tiny body.
  const smallJson = `"${"s".repeat(1022)}"`;

  let root: string;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "orca-gzip-"));
    const dist = join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "index.html"), largeHtml);
    await writeFile(join(dist, "app.js"), largeJs);
    await writeFile(join(dist, "data.json"), largeJson);
    await writeFile(join(dist, "font.woff2"), font);
    await writeFile(join(dist, "small.json"), smallJson);

    const app = express();
    registerStaticRoutes(app, await loadStaticFiles(dist));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server has no port");
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  interface RawResponse {
    status: number;
    headers: IncomingHttpHeaders;
    body: Buffer;
  }

  /** node:http, never fetch: fetch decompresses transparently and would hide the encoding under test. */
  function rawGet(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method, headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("gzips a text asset when Accept-Encoding names gzip, with matching length and encoding", async () => {
    const res = await rawGet("/index.html", { "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers.vary).toContain("Accept-Encoding");
    // The bytes on the wire really are the gzip stream, and they really are the page.
    expect(gunzipSync(res.body).toString("utf8")).toBe(largeHtml);
    // Content-Length describes the encoded body, not the source bytes.
    expect(Number(res.headers["content-length"])).toBe(res.body.length);
    expect(res.body.length).toBeLessThan(Buffer.byteLength(largeHtml));
  });

  it("serves the identity body when the request does not ask for gzip", async () => {
    const res = await rawGet("/index.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers.vary).toContain("Accept-Encoding");
    expect(res.body.toString("utf8")).toBe(largeHtml);
    expect(Number(res.headers["content-length"])).toBe(Buffer.byteLength(largeHtml));
  });

  it("does not compress a body of 1024 bytes or less", async () => {
    const res = await rawGet("/small.json", { "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString("utf8")).toBe(smallJson);
  });

  it("never compresses an already-compressed type (woff2), even above the size threshold", async () => {
    const res = await rawGet("/font.woff2", { "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.equals(font)).toBe(true);
  });

  it("gives the two encodings different ETags, so a proxy cannot answer one with the other", async () => {
    const gz = await rawGet("/app.js", { "accept-encoding": "gzip" });
    const identity = await rawGet("/app.js");
    expect(gz.headers.etag).toBeTruthy();
    expect(identity.headers.etag).toBeTruthy();
    expect(gz.headers.etag).not.toBe(identity.headers.etag);
  });

  it("compresses application/json as well as text/*", async () => {
    const res = await rawGet("/data.json", { "accept-encoding": "gzip" });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(res.body).toString("utf8")).toBe(largeJson);
  });

  it("skips gzip for HEAD: the headers describe the body a plain GET would send", async () => {
    const res = await rawGet("/index.html", { "accept-encoding": "gzip" }, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(Number(res.headers["content-length"])).toBe(Buffer.byteLength(largeHtml));
    expect(res.body.length).toBe(0);
  });

  it("skips gzip when the request carries a Range", async () => {
    const res = await rawGet("/index.html", { "accept-encoding": "gzip", range: "bytes=0-10" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString("utf8")).toBe(largeHtml);
  });

  it("honors gzip;q=0 instead of compressing anyway", async () => {
    const res = await rawGet("/index.html", { "accept-encoding": "gzip;q=0" });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("still answers 404 for a name that is not in the map", async () => {
    const res = await rawGet("/../../etc/passwd");
    expect(res.status).toBe(404);
    expect(res.body.toString("utf8")).toBe("not found");
  });
});
