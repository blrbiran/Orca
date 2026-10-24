/**
 * T7 (spec §10.2.4, §10.7): Orca's strict `features` / `collect` parses accept ccloop's `transcripts` (the parse-level
 * cases are tests/control/liveTranscriptProtocol.test.ts, landed with the f4de340 re-pin), and the read API keys on the
 * flag through the real ccloop port: with a ccloop answering `transcripts: "v1"` the listing is served; with one that
 * does not (an older ccloop), the listing says why and no window is served.
 */
import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { openTestStore, seedBudgetCase } from "./fixtures/store.js";

const NEW = { protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1", agentInstallationUpdate: "v1", transcripts: "v1" };
const OLD = { protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1", agentInstallationUpdate: "v1" };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()!(); });

async function panelWith(features: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-lt-schema-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), features }), { mode: 0o600 });
  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 });
  const h = await openTestStore();
  cleanups.push(() => h.dispose());
  const runId = claimWork(h.store, seedBudgetCase(h.store).t1Claim).runId;
  const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
  body.transcripts = { sourceDir: root, entries: [{ attempt: 1, phase: "plan", seq: 1, path: "codex/1/plan/call-a/transcript.jsonl", bytes: 7, final: true, truncatedAt: null }] };
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
  const app = express();
  app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "u", name: "U", roles: ["owner"] }; next(); });
  registerControlReadRoutes(app, { store: h.store, epoch: "e", config: { readView: async () => ({}) } as never, port }, "web");
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  const get = async (path: string) => { const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`); return { status: r.status, body: await r.json() as any }; };
  return { runId, get };
}

describe("T7: the read API keys on ccloop's transcripts feature, through the real port's strict parse", () => {
  it("a ccloop answering transcripts v1: the listing is served", async () => {
    const p = await panelWith(NEW);
    const answer = await p.get(`/api/control/runs/${p.runId}/transcripts`);
    expect(answer).toEqual({ status: 200, body: { schema: "orca-run-transcripts-v1", runId: p.runId, available: true, calls: [{ attempt: 1, phase: "plan", seq: 1, runtime: "codex", recorded: true, bytes: 7, final: true, truncatedAt: null }] } });
  });

  it("an older ccloop: the listing says why, and no window is served", async () => {
    const p = await panelWith(OLD);
    expect(await p.get(`/api/control/runs/${p.runId}/transcripts`)).toEqual({ status: 200, body: { schema: "orca-run-transcripts-v1", runId: p.runId, available: false, reason: "ccloop-transcripts-unsupported", calls: [] } });
    expect(await p.get(`/api/control/runs/${p.runId}/transcripts/1/plan/1?tail=1`)).toMatchObject({ status: 422, body: { error: { code: "transcript-unsupported" } } });
  });
});
