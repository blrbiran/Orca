/**
 * Live transcript spec Correction (session 3cfc2e73, F5): `orca run transcript` reads over the control socket through the
 * Web's own transcript handlers. Why each criterion matters:
 * - an ordinary socket caller (with or without a person token) reads, so a person can diagnose a failed run from a
 *   terminal; the answer is the Web's answer byte for byte (same redaction, same window semantics), so the CLI is never
 *   a way around what the Web hides;
 * - a principal carrying a run Orca dispatched is still refused on the socket -- a dispatched agent must not read
 *   transcripts (its own or another run's); this is the safety half of the old "the socket has no route";
 * - the O_NOFOLLOW / run-dir containment holds on the socket too;
 * - the call listing carries no source path on the socket either.
 * The last case goes through the real socket app (buildControlSocketApp), so the dispatched-run marker is read from the
 * header the CLI sends, not from a test-set principal.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import type { ControlFeatures } from "../../src/control/executionPort.js";
import type { TranscriptEntry } from "../../src/control/schema.js";
import type { ControlStore } from "../../src/control/store.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { buildControlSocketApp } from "../../src/panel/controlSocket.js";
import type { Principal } from "../../src/panel/permissions.js";
import { openTestStore, seedBudgetCase } from "../control/fixtures/store.js";
import { claude, countMark, ghp, jsonl } from "./fixtures.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()!(); });

const WHO: Record<string, Principal> = {
  owner: { kind: "user", userId: "u1", name: "Olive", roles: ["owner"] },
  socketAgent: { kind: "agent", client: "cli" },
  socketPerson: { kind: "agent", client: "cli", person: { userId: "u2", name: "Max", roles: ["member"] } },
  dispatched: { kind: "agent", client: "cli", dispatchedRun: "run-x" },
  dispatchedPerson: { kind: "agent", client: "cli", dispatchedRun: "run-x", person: { userId: "u2", name: "Max", roles: ["member"] } },
};
const features = { readFeatures: async (): Promise<ControlFeatures> => ({ protocol: 1, transcripts: "v1" }) };

async function listen(app: express.Express): Promise<{ base: string; close(): Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  cleanups.push(close);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close };
}

/** The read routes as registered on `channel`, with the principal named by x-who (as the panel's middleware sets it). */
async function serve(store: ControlStore, channel: "web" | "socket") {
  const app = express();
  app.use((req, res, next) => { res.locals.orcaPrincipal = WHO[String(req.header("x-who") ?? "owner")]; next(); });
  registerControlReadRoutes(app, { store, epoch: "epoch", config: { readView: async () => ({}) } as never, port: features as never }, channel);
  const { base } = await listen(app);
  return async (path: string, who = "owner") => {
    const response = await fetch(base + path, { headers: { "x-who": who } });
    return { status: response.status, body: await response.json() as any };
  };
}

const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({ attempt: 1, phase: "plan", seq: 1, path: "claude/1/plan/call-a/transcript.jsonl", bytes: 1, final: true, truncatedAt: null, ...over });
const callDir = (sourceDir: string, call = "call-a") => join(sourceDir, "run", "claude", "1", "plan", call);

async function world(entries: TranscriptEntry[]) {
  const h = await openTestStore();
  cleanups.push(() => h.dispose());
  const runId = claimWork(h.store, seedBudgetCase(h.store).t1Claim).runId;
  const sourceDir = mkdtempSync(join(tmpdir(), "lt-sock-"));
  cleanups.push(() => rmSync(sourceDir, { recursive: true, force: true }));
  const row = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
  const body = JSON.parse(String(row.body));
  body.transcripts = { sourceDir, entries };
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
  return { h, runId, sourceDir, web: await serve(h.store, "web"), socket: await serve(h.store, "socket") };
}

const LINES = [claude.text(`first ${ghp()}`), claude.toolUse("t1", "ls"), claude.text("second"), claude.text("third")];

describe("F5: the socket serves the Web's transcript reads", () => {
  it("an ordinary socket caller and one with a person token read the same window the Web serves, redacted, with no source path", async () => {
    const w = await world([entry({})]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl(LINES));
    const web = await w.web(`/api/control/runs/${w.runId}/transcripts/1/plan/1?tail=1`);
    expect(web.status).toBe(200);
    for (const who of ["socketAgent", "socketPerson"]) {
      const answer = await w.socket(`/api/control/runs/${w.runId}/transcripts/1/plan/1?tail=1`, who);
      expect(answer).toEqual(web);
      expect(answer.body.events.map((e: { kind: string }) => e.kind)).toEqual(["message", "tool_call", "message", "message"]);
      expect(countMark(JSON.stringify(answer.body))).toBe(0);
      expect(JSON.stringify(answer.body)).not.toContain(w.sourceDir);
    }
  });

  it("window semantics are the Web's: before/after offsets and include=thinking answer identically on both listeners", async () => {
    const w = await world([entry({})]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl(LINES));
    const tail = await w.socket(`/api/control/runs/${w.runId}/transcripts/1/plan/1?tail=1`, "socketAgent");
    const second = tail.body.events[2].at as number;
    for (const query of [`after=${second}`, `before=${second}`, `after=0&include=thinking`]) {
      const path = `/api/control/runs/${w.runId}/transcripts/1/plan/1?${query}`;
      const socket = await w.socket(path, "socketAgent");
      expect(socket.status).toBe(200);
      expect(socket).toEqual(await w.web(path));
    }
    const after = await w.socket(`/api/control/runs/${w.runId}/transcripts/1/plan/1?after=${second}`, "socketAgent");
    expect([after.body.start, after.body.events.length]).toEqual([second, 2]);
    const before = await w.socket(`/api/control/runs/${w.runId}/transcripts/1/plan/1?before=${second}`, "socketAgent");
    expect([before.body.start, before.body.end, before.body.events.length]).toEqual([0, second, 2]);
    // A malformed window is refused by the same name.
    expect(await w.socket(`/api/control/runs/${w.runId}/transcripts/1/plan/1?tail=1&after=0`, "socketAgent")).toMatchObject({ status: 400, body: { error: { code: "query-invalid" } } });
  });

  it("the call listing on the socket carries no path", async () => {
    const w = await world([entry({}), entry({ attempt: 2, phase: "execute", seq: 1, path: null, bytes: 0 })]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl(LINES));
    const answer = await w.socket(`/api/control/runs/${w.runId}/transcripts`, "socketAgent");
    expect(answer.status).toBe(200);
    expect(answer).toEqual(await w.web(`/api/control/runs/${w.runId}/transcripts`));
    expect(answer.body.calls.map((c: { recorded: boolean }) => c.recorded)).toEqual([true, false]);
    expect(JSON.stringify(answer.body)).not.toContain("path");
    expect(JSON.stringify(answer.body)).not.toContain("transcript.jsonl");
    expect(JSON.stringify(answer.body)).not.toContain(w.sourceDir);
  });

  it("a principal carrying a run Orca dispatched is refused on the socket (listing, window, expand), a person token or not", async () => {
    const w = await world([entry({})]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl(LINES));
    for (const who of ["dispatched", "dispatchedPerson"]) {
      for (const path of ["transcripts", "transcripts/1/plan/1?tail=1", "transcripts/1/plan/1/expand?at=0&i=0&field=text"]) {
        expect(await w.socket(`/api/control/runs/${w.runId}/${path}`, who)).toMatchObject({ status: 403, body: { error: { code: "control-dispatched-run-refused" } } });
      }
    }
  });

  it("a transcript replaced by a symlink, or a listing path leaving the run directory, is refused on the socket", async () => {
    const w = await world([entry({}), entry({ seq: 2, path: "../../outside/transcript.jsonl" })]);
    const elsewhere = mkdtempSync(join(tmpdir(), "lt-sock-elsewhere-"));
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    writeFileSync(join(elsewhere, "secret.jsonl"), jsonl([claude.text("not yours")]));
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    symlinkSync(join(elsewhere, "secret.jsonl"), join(callDir(w.sourceDir), "transcript.jsonl"));
    mkdirSync(join(w.sourceDir, "outside"), { recursive: true });
    writeFileSync(join(w.sourceDir, "outside", "transcript.jsonl"), jsonl([claude.text("outside")]));
    for (const seq of [1, 2]) {
      const answer = await w.socket(`/api/control/runs/${w.runId}/transcripts/1/plan/${seq}?tail=1`, "socketAgent");
      expect(answer).toMatchObject({ status: 403, body: { error: { code: "transcript-path-invalid" } } });
      expect(JSON.stringify(answer.body)).not.toContain("not yours");
    }
  });

  it("through the real socket app: the x-orca-dispatched-run header is refused, a plain cli caller reads", async () => {
    const w = await world([entry({})]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl(LINES));
    const app = buildControlSocketApp({ store: w.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, port: features as never });
    const { base } = await listen(app);
    const get = (path: string, headers: Record<string, string>) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(base + path, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      req.on("error", reject);
      req.end();
    });
    const path = `/api/control/runs/${w.runId}/transcripts/1/plan/1?tail=1`;
    const plain = await get(path, { "x-orca-client": "cli" });
    expect(plain.status).toBe(200);
    expect(plain.body.events).toHaveLength(4);
    expect(await get(path, { "x-orca-client": "cli", "x-orca-dispatched-run": w.runId })).toMatchObject({ status: 403, body: { error: { code: "control-dispatched-run-refused" } } });
    expect(await get(`/api/control/runs/${w.runId}/transcripts`, { "x-orca-client": "cli", "x-orca-dispatched-run": "run-other" })).toMatchObject({ status: 403, body: { error: { code: "control-dispatched-run-refused" } } });
  });
});
