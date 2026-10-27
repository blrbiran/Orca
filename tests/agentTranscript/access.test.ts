/**
 * T5 (spec §10.6.3, §12.3 "Access"): who reads and what is opened. An owner and a member read on the Web; a principal
 * carrying a run Orca dispatched is refused; the socket listener has no route. Paths come only from the stored listing,
 * resolve under `<sourceDir>/run/`, every directory component is lstat-checked and the file is opened O_NOFOLLOW: a
 * transcript replaced by a symlink is refused, and so is a listing path that leaves the run directory. No served answer
 * carries the source path.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { finalNow } from "../../src/agentTranscript/listing.js";
import type { TranscriptEntry } from "../../src/control/schema.js";
import { openTestStore, seedBudgetCase } from "../control/fixtures/store.js";
import { claude, jsonl } from "./fixtures.js";
import { serve, type Served } from "./http.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()!(); });

async function world(entries: (sourceDir: string) => TranscriptEntry[]) {
  const h = await openTestStore();
  cleanups.push(() => h.dispose());
  const seed = seedBudgetCase(h.store);
  const runId = claimWork(h.store, seed.t1Claim).runId;
  const sourceDir = mkdtempSync(join(tmpdir(), "lt-run-"));
  cleanups.push(() => rmSync(sourceDir, { recursive: true, force: true }));
  const row = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
  const body = JSON.parse(String(row.body));
  body.transcripts = { sourceDir, entries: entries(sourceDir) };
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
  const web = await serve(h.store, "web"), socket = await serve(h.store, "socket");
  cleanups.push(() => web.close(), () => socket.close());
  return { h, runId, sourceDir, web, socket };
}
const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({ attempt: 1, phase: "plan", seq: 1, path: "claude/1/plan/call-a/transcript.jsonl", bytes: 1, final: true, truncatedAt: null, ...over });
const callDir = (sourceDir: string, call = "call-a") => join(sourceDir, "run", "claude", "1", "plan", call);
const tail = (served: Served, runId: string, seq = 1, who: "owner" | "member" | "dispatched" | "socketAgent" = "owner") => served.get(`/api/control/runs/${runId}/transcripts/1/plan/${seq}?tail=1`, who);

describe("T5: who reads", () => {
  it("an owner and a member read on the Web; a dispatched run is refused; the socket listener has no route", async () => {
    const w = await world(() => [entry({})]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl([claude.text("hello"), claude.toolUse("t1", "ls")]));
    for (const who of ["owner", "member"] as const) {
      const answer = await tail(w.web, w.runId, 1, who);
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ schema: "orca-transcript-window-v1", runId: w.runId, attempt: 1, phase: "plan", seq: 1, runtime: "claude", source: "run", final: true, start: 0 });
      expect(answer.body.events.map((e: { kind: string }) => e.kind)).toEqual(["message", "tool_call"]);
      expect(JSON.stringify(answer.body)).not.toContain(w.sourceDir);
    }
    expect(await tail(w.web, w.runId, 1, "dispatched")).toMatchObject({ status: 403, body: { error: { code: "control-dispatched-run-refused" } } });
    expect(await tail(w.socket, w.runId, 1, "socketAgent")).toMatchObject({ status: 404, body: { error: { code: "route-not-found" } } });
    expect(await w.socket.get(`/api/control/runs/${w.runId}/transcripts/1/plan/1/expand?at=0&i=0&field=text`, "socketAgent")).toMatchObject({ status: 404, body: { error: { code: "route-not-found" } } });
    expect(await w.web.get(`/api/control/runs/${w.runId}/transcripts/1/plan/1/expand?at=0&i=0&field=text`, "dispatched")).toMatchObject({ status: 403 });
  });
});

describe("T5: what is opened", () => {
  it("a transcript replaced by a symlink is refused, and so is a symlinked call directory", async () => {
    const w = await world(() => [entry({}), entry({ seq: 2, path: "claude/1/plan/call-b/transcript.jsonl" })]);
    const elsewhere = mkdtempSync(join(tmpdir(), "lt-elsewhere-"));
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    writeFileSync(join(elsewhere, "secret.jsonl"), jsonl([claude.text("not yours")]));
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    symlinkSync(join(elsewhere, "secret.jsonl"), join(callDir(w.sourceDir), "transcript.jsonl"));
    expect(await tail(w.web, w.runId)).toMatchObject({ status: 403, body: { error: { code: "transcript-path-invalid" } } });
    mkdirSync(join(elsewhere, "call-b"));
    writeFileSync(join(elsewhere, "call-b", "transcript.jsonl"), jsonl([claude.text("not yours either")]));
    symlinkSync(join(elsewhere, "call-b"), callDir(w.sourceDir, "call-b"));
    expect(await tail(w.web, w.runId, 2)).toMatchObject({ status: 403, body: { error: { code: "transcript-path-invalid" } } });
  });

  it("a listing path outside the run directory is refused", async () => {
    const w = await world(() => [entry({ path: "../../outside/transcript.jsonl" }), entry({ seq: 2, path: "claude/1/plan/call-a/../../../../x.jsonl" })]);
    mkdirSync(join(w.sourceDir, "outside"), { recursive: true });
    writeFileSync(join(w.sourceDir, "outside", "transcript.jsonl"), jsonl([claude.text("outside")]));
    expect(await tail(w.web, w.runId, 1)).toMatchObject({ status: 403, body: { error: { code: "transcript-path-invalid" } } });
    expect(await tail(w.web, w.runId, 2)).toMatchObject({ status: 403, body: { error: { code: "transcript-path-invalid" } } });
  });

  it("refuses malformed requests by name", async () => {
    const w = await world(() => [entry({})]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl([claude.text("x")]));
    for (const query of ["", "?tail=1&after=0", "?tail=2", "?after=-1", "?after=1", "?before=0&include=deltas", "?tail=1&path=/etc"]) {
      const answer = await w.web.get(`/api/control/runs/${w.runId}/transcripts/1/plan/1${query}`);
      expect([400]).toContain(answer.status);
    }
    expect(await w.web.get(`/api/control/runs/${w.runId}/transcripts/1/plan/9?tail=1`)).toMatchObject({ status: 404, body: { error: { code: "transcript-not-found" } } });
  });
});

describe("review 7753e97d: a live call's size and `final` are read now, through the component walk", () => {
  it("the listing reports a non-final call's size on disk now (D1), and never follows a symlinked call directory", async () => {
    const w = await world(() => [entry({ final: false, bytes: 1 }), entry({ seq: 2, path: "claude/1/plan/call-b/transcript.jsonl", final: false, bytes: 7 })]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    const bytes = jsonl([claude.text("grown since the last collect")]);
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), bytes);
    const elsewhere = mkdtempSync(join(tmpdir(), "lt-elsewhere-"));
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    writeFileSync(join(elsewhere, "transcript.jsonl"), "x".repeat(5000));
    symlinkSync(elsewhere, callDir(w.sourceDir, "call-b"));
    const answer = await w.web.get(`/api/control/runs/${w.runId}/transcripts`);
    expect(answer.status).toBe(200);
    expect(answer.body.calls.map((c: { bytes: number }) => c.bytes)).toEqual([bytes.length, 7]);
  });

  it("a non-final call is served final once its outcome.json appears, and an outcome behind a symlinked directory is not", async () => {
    const w = await world(() => [entry({ final: false })]);
    mkdirSync(callDir(w.sourceDir), { recursive: true });
    writeFileSync(join(callDir(w.sourceDir), "transcript.jsonl"), jsonl([claude.text("working")]));
    expect((await tail(w.web, w.runId)).body.final).toBe(false);
    writeFileSync(join(callDir(w.sourceDir), "outcome.json"), "{}");
    expect((await tail(w.web, w.runId)).body.final).toBe(true);
    const elsewhere = mkdtempSync(join(tmpdir(), "lt-elsewhere-"));
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    writeFileSync(join(elsewhere, "outcome.json"), "{}");
    symlinkSync(elsewhere, callDir(w.sourceDir, "call-b"));
    const linked = entry({ seq: 2, path: "claude/1/plan/call-b/transcript.jsonl", final: false });
    expect(await finalNow({ sourceDir: w.sourceDir, entries: [linked] }, linked, "run")).toBe(false);
  });
});
