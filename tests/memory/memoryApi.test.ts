import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { controlDisabled } from "../../src/panel/controlOptions.js";
import { MEMORY_FIXED_CODES, memoryHttpStatus, sendChecked } from "../../src/panel/memoryApi.js";
import { type PanelOptions, createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import { memoryPageResponseSchema } from "../../src/memory/wire.js";
import { zhErrors } from "../../web/src/locales/zh.js";
import { type FakeCcmem, fakeCcmem, memoryRepo } from "./helpers.js";
import { foreignKeyCookie, sessionFor } from "../panel/fixtures/auth.js";

/**
 * Spec §5.1. The routes choose a repository only from the panel's own discovery (a browser never names a path), check
 * every input before anything starts ccmem, answer each failure by name with its own status, and offer no way to
 * write (G9). These criteria go through the real server: a route that is unregistered, or registered after the
 * error handler, is what they would catch.
 */
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function panel(opts: { mode?: string; memory?: (fake: FakeCcmem) => PanelOptions["memory"] } = {}) {
  const fake = await fakeCcmem({ mode: opts.mode });
  const repo = await memoryRepo();
  const store = await mkdtemp(join(tmpdir(), "orca-mem-store-"));
  const dist = await mkdtemp(join(tmpdir(), "orca-mem-dist-"));
  await writeFile(join(dist, "index.html"), "<!doctype html><html><body></body></html>");
  cleanups.push(fake.cleanup, () => rm(repo, { recursive: true, force: true }), () => rm(store, { recursive: true, force: true }), () => rm(dist, { recursive: true, force: true }));
  const options: PanelOptions = {
    by: "tester", bind: "127.0.0.1", port: 0, confirmedExternal: false, correctionsDir: store,
    repos: [{ projectKey: "mem", path: repo }], control: controlDisabled(), distDir: dist,
    memory: opts.memory ? opts.memory(fake) : { ccmemBin: fake.bin, env: fake.env },
  };
  const p = await createPanelServer(options);
  cleanups.push(() => p.close());
  // As the logged-in browser; `wrong`: the same cookie re-signed under another key.
  const call = async (path: string, init: RequestInit = {}, wrong = false) => {
    const session = await sessionFor(p);
    return wrong ? fetch(`${p.url}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: foreignKeyCookie(session) } }) : session.fetch(path, init);
  };
  const json = async (path: string) => { const res = await call(path); return { status: res.status, body: await res.json() as any }; };
  return { fake, repo, call, json };
}

describe("the memory routes (spec §5.1)", () => {
  it("serves status without starting ccmem", async () => {
    const { fake, json } = await panel();
    const { status, body } = await json("/api/memory/status");
    expect(status).toBe(200);
    expect(body).toEqual({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] });
    expect(fake.calls()).toEqual([]);
  });

  it("lists, searches and opens one memory", async () => {
    const { json } = await panel();
    const list = await json("/api/memory/list?projectKey=mem");
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ projectKey: "mem", query: "", page: { total: 4, truncated: false } });
    expect(list.body.page.records[0].ref).toBe("1"); // pinned first
    const search = await json("/api/memory/search?projectKey=mem&q=FOUR&limit=1");
    expect(search.body).toMatchObject({ query: "FOUR", page: { total: 1, records: [{ ref: "4" }] } });
    const item = await json("/api/memory/item?projectKey=mem&ref=3");
    expect(item).toMatchObject({ status: 200, body: { record: { ref: "3", content: "project three" } } });
  });

  it("answers 404 memory-not-found for a ref this repository cannot see (M10)", async () => {
    const { json } = await panel();
    expect(await json("/api/memory/item?projectKey=mem&ref=99")).toMatchObject({ status: 404, body: { code: "memory-not-found" } });
  });

  it("answers 404 for a repository the panel did not discover, without starting ccmem (M11)", async () => {
    const { fake, json } = await panel();
    expect(await json("/api/memory/list?projectKey=nope")).toMatchObject({ status: 404, body: { code: "memory-repo-unknown" } });
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    ["/api/memory/search?projectKey=mem&q=" + "a".repeat(201)],
    ["/api/memory/search?projectKey=mem&q=a%07b"],
    ["/api/memory/list?projectKey=mem&limit=0"],
    ["/api/memory/list?projectKey=mem&limit=201"],
    ["/api/memory/item?projectKey=mem&ref=abc"],
    ["/api/memory/search?projectKey=mem&q=a&q=b"],
    ["/api/memory/list?projectKey=mem&projectKey=mem"],
    ["/api/memory/list?projectKey=mem&limit=1&limit=2"],
  ])("answers 400 memory-query-invalid for %s, without starting ccmem (M11, Review Focus 2)", async (path) => {
    const { fake, json } = await panel();
    expect(await json(path)).toMatchObject({ status: 400, body: { code: "memory-query-invalid" } });
    expect(fake.calls()).toEqual([]);
  });

  it.each([["exit:3", 502, "ccmem-failed:3"], ["garbage", 502, "ccmem-output-invalid"]])("maps fake mode %s to %i %s", async (mode, status, code) => {
    const { json } = await panel({ mode });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status, body: { code } });
  });

  it("maps a timeout to 502 ccmem-timeout", async () => {
    const { json } = await panel({ mode: "sleep", memory: (fake) => ({ ccmemBin: fake.bin, env: fake.env, timeoutMs: 200 }) });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 502, body: { code: "ccmem-timeout" } });
  });

  it("answers an unexpected failure through the shared error handler, as JSON (M-route)", async () => {
    // A symbol in the env makes execFile throw a TypeError, which is not a MemoryError, so the route hands it to next(err).
    // A route registered below the handler would not reach it: express would answer its default HTML 500.
    const { json } = await panel({ memory: (fake) => ({ ccmemBin: fake.bin, env: { ...fake.env, BAD: Symbol("bad") as unknown as string } }) });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 500, body: { code: "panel-internal-error" } });
  });

  it("has no write route and needs a session (M12, G9)", async () => {
    const { call, fake } = await panel();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await call("/api/memory/list?projectKey=mem", { method })).status, method).toBe(404);
    const anonymous = await call("/api/memory/status", {}, true);
    expect(anonymous.status).toBe(401);
    expect(fake.calls()).toEqual([]);
  });
});

describe("configuration (spec §3.4)", () => {
  it("reads ORCA_CCMEM_BIN and keeps the env object it was given (M3)", () => {
    const env = { ...process.env, ORCA_CCMEM_BIN: "/x/ccmem", CCMEM_DATA_ROOT: "/elsewhere", HOME: "/home-elsewhere" };
    const opts = parsePanelArgs(["--by", "amy", "--no-control"], env);
    expect(opts.memory?.ccmemBin).toBe("/x/ccmem");
    expect(opts.memory?.env).toBe(env);
  });

  it("reads an empty ORCA_CCMEM_BIN as not configured", () => {
    expect(parsePanelArgs(["--by", "amy", "--no-control"], { ...process.env, ORCA_CCMEM_BIN: "" }).memory?.ccmemBin).toBeNull();
  });

  it("with ORCA_CCMEM_BIN unset, says ccmem-missing and starts nothing, even with a ccmem on PATH (M4)", async () => {
    const { fake, json } = await panel({ memory: (f) => parsePanelArgs(["--by", "amy", "--no-control"], { ...f.env, PATH: `${f.dir}:${f.env.PATH ?? ""}`, ORCA_CCMEM_BIN: "" }).memory });
    expect((await json("/api/memory/status")).body.health).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 503, body: { code: "ccmem-missing" } });
    expect(fake.calls()).toEqual([]);
  });

  it("treats an options object without memory as not configured", async () => {
    const { json } = await panel({ memory: () => undefined });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 503, body: { code: "ccmem-missing" } });
  });
});

describe("the response check and the codes (spec §5.1, M13)", () => {
  it("refuses to send a response with a key the schema does not have", () => {
    const res = { json: () => { throw new Error("must not be sent"); } } as unknown as express.Response;
    const body = { projectKey: "mem", query: "", page: { records: [], total: 0, truncated: false }, extra: 1 };
    expect(() => sendChecked(res, memoryPageResponseSchema, body)).toThrow(/extra/);
  });

  it("gives every fixed code its status and a Chinese entry", () => {
    expect(MEMORY_FIXED_CODES.map((code) => [code, memoryHttpStatus(code)])).toEqual([
      ["ccmem-missing", 503], ["ccmem-timeout", 502], ["ccmem-output-too-large", 502], ["ccmem-output-invalid", 502],
      ["memory-repo-unknown", 404], ["memory-not-found", 404], ["memory-query-invalid", 400],
    ]);
    expect(memoryHttpStatus("ccmem-failed:3")).toBe(502);
    expect(MEMORY_FIXED_CODES.filter((code) => !Object.prototype.hasOwnProperty.call(zhErrors, code))).toEqual([]);
  });
});
