import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CorrectionListItemV1 } from "../../src/control/correctionState.js";
import { readCorrectionList } from "../../src/control/correctionState.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { deriveRows } from "../../src/corrections/derive.js";
import { deriveFixRunId } from "../../src/corrections/fields.js";
import { projectKeyOf } from "../../src/corrections/projectKey.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import type { Correction } from "../../src/corrections/schema.js";
import { withdrawCorrection } from "../../src/corrections/withdrawals.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import {
  EXPORTS_FILE, MEMORY_MAX_CHARS, callCcmemCorrection, correctionMemoryText, createCorrectionExporter, exportCorrectionsPass,
  readExports, sha256, type CcmemCallResult, type CorrectionExporterDeps,
} from "../../src/memory/correctionExport.js";
import { parsePanelArgs } from "../../src/panel/server.js";
import { webFixture } from "../control/fixtures/web.js";

// Corrections-to-ccmem spec 2026-10-21 As-built. Why these matter: a closed correction is the person's own ruling and must
// reach their memory once (not duplicated, not lost); a withdrawn one must leave it; ccmem trouble must never block Orca
// and must not be retried in a loop it cannot win (exit 64). Every ccmem here is a fake or a relocated real one (Rule 17).

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });
const tempDir = async (prefix: string): Promise<string> => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const correction = (over: Partial<Correction> = {}): Correction => ({
  id: "c1", projectKey: "example.invalid/o/r", decisionId: "run-1/agent-0", kind: "not_my_taste", chose_instead: "file lease",
  because: "the mutex does not survive a restart", at: "2026-10-21T00:00:00.000Z", by: "owner@example.invalid", ...over,
} as Correction);

const item = (c: Correction, over: Partial<CorrectionListItemV1> = {}): CorrectionListItemV1 => ({
  correction: c, repoId: "repo", debugGroups: [], closed: { state: "closed", ref: "refs/heads/main", via: "by-hand" }, closing: null, withdrawn: null, ...over,
});

/** A pass world: `items` is what readCorrectionList would answer; `answers` is what each ccmem call returns, in order. */
async function passWorld(items: () => CorrectionListItemV1[], answers: CcmemCallResult[] = []) {
  const dir = await tempDir("orca-corr-exports-");
  const repo = await tempDir("orca-corr-repo-");
  const calls: Array<{ verb: string; input: Record<string, unknown>; cwd: string }> = [];
  let clock = 1_000_000;
  const deps: CorrectionExporterDeps = {
    ccmemBin: "/fake/ccmem", env: {}, correctionsDir: dir, listCorrections: async () => items(),
    repositoryPath: (repoId) => (repoId === "repo" ? repo : null), now: () => clock,
    call: async (_bin, _env, cwd, verb, input) => {
      calls.push({ verb, input: input as Record<string, unknown>, cwd });
      return answers.shift() ?? { kind: "ok", body: { action: "inserted", memoryId: 7 } };
    },
  };
  return { dir, repo, calls, deps, advance: (ms: number) => { clock += ms; }, pass: () => exportCorrectionsPass(deps) };
}

describe("the memory text (As-built template)", () => {
  it("names the agent's choice, the person's choice and the reason, and the correction", () => {
    const text = correctionMemoryText(correction(), { question: "which lock", chose: "in-process mutex" });
    expect(text).toBe('Orca correction: for "which lock" an agent chose "in-process mutex"; the person ruled it not to the person\'s taste.' +
      ' Instead: "file lease". Because: the mutex does not survive a restart. [decision run-1/agent-0; correction c1]');
  });

  it("never exceeds ccmem's default limit, and long fields cannot crowd out the reason", () => {
    const long = "x".repeat(2000);
    const text = correctionMemoryText(correction({ chose_instead: long, because: `KEEP ${long}` }), { question: long, chose: long });
    expect(text.length).toBeLessThanOrEqual(MEMORY_MAX_CHARS);
    expect(text).toContain("Because: KEEP");
    expect(text).toMatch(/\[decision run-1\/agent-0; correction c1\]$/);
  });

  it("a pending-decision correction without a ledger row names the run and the pending item", () => {
    const text = correctionMemoryText(correction({ decisionId: undefined, runId: "run-9", pendingId: "p-2", kind: "wrong", chose_instead: undefined }), null);
    expect(text).toBe("Orca correction: the person ruled an agent's pending decision p-2 of run run-9 wrong. Because: the mutex does not survive a restart." +
      " [pending decision p-2 of run run-9; correction c1]");
  });
});

describe("one export pass", () => {
  it("writes a closed correction once, and again only when its text changes", async () => {
    let because = "first reason";
    const w = await passWorld(() => [item(correction({ because }))]);
    expect(await w.pass()).toEqual({ upserted: ["c1"], withdrawn: [], refused: [], failed: [] });
    expect(w.calls).toEqual([{ verb: "upsert", cwd: w.repo, input: { version: 1, id: "c1", content: expect.stringContaining("Because: first reason.") } }]);
    // M-I1: no hash check (resend every pass) -> a second call here.
    expect((await w.pass()).upserted).toEqual([]);
    expect(w.calls).toHaveLength(1);
    because = "second reason";
    expect((await w.pass()).upserted).toEqual(["c1"]);
    expect(w.calls[1]!.input.content).toEqual(expect.stringContaining("Because: second reason."));
    const rows = (await readExports(w.dir)).rows;
    expect(rows.c1).toEqual({ state: "exported", sha256: sha256(String(w.calls[1]!.input.content)), memoryId: 7, at: expect.any(Number) });
  });

  it("an open correction, or one whose repository is not configured, is not written", async () => {
    const w = await passWorld(() => [item(correction(), { closed: { state: "open" } }), item(correction({ id: "c2" }), { repoId: null }), item(correction({ id: "c3" }), { repoId: "elsewhere" })]);
    // M-I2: drop the closed-state check -> c1 is written.
    expect(await w.pass()).toEqual({ upserted: [], withdrawn: [], refused: [], failed: [] });
    expect(w.calls).toEqual([]);
  });

  it("a refusal (exit 64) is recorded and not resent until the text changes", async () => {
    let because = "first";
    const w = await passWorld(() => [item(correction({ because }))], [{ kind: "refused", detail: "content is longer than 300 characters" }]);
    expect((await w.pass()).refused).toEqual(["c1"]);
    w.advance(24 * 60 * 60_000);
    // M-I3: treat refused as failed -> retried here after the backoff.
    expect(await w.pass()).toEqual({ upserted: [], withdrawn: [], refused: [], failed: [] });
    expect(w.calls).toHaveLength(1);
    because = "second";
    expect((await w.pass()).upserted).toEqual(["c1"]);
  });

  it("a failure is retried only after its backoff, which doubles", async () => {
    const failed: CcmemCallResult = { kind: "failed", detail: "exited 1: database is locked" };
    const w = await passWorld(() => [item(correction())], [failed, failed]);
    expect((await w.pass()).failed).toEqual(["c1"]);
    expect((await readExports(w.dir)).rows.c1).toMatchObject({ state: "failed", attempts: 1, nextAttemptAt: 1_000_000 + 5 * 60_000 });
    w.advance(5 * 60_000 - 1);
    // M-I4: ignore nextAttemptAt -> a second call here.
    await w.pass(); expect(w.calls).toHaveLength(1);
    w.advance(1);
    expect((await w.pass()).failed).toEqual(["c1"]);
    expect((await readExports(w.dir)).rows.c1).toMatchObject({ state: "failed", attempts: 2, nextAttemptAt: 1_000_000 + 5 * 60_000 + 10 * 60_000 });
    w.advance(10 * 60_000);
    expect((await w.pass()).upserted).toEqual(["c1"]);
    expect(w.calls).toHaveLength(3);
  });

  it("a withdrawn correction that was written is archived once; one never written is left alone", async () => {
    let withdrawn: CorrectionListItemV1["withdrawn"] = null;
    const w = await passWorld(() => [item(correction(), { withdrawn }), item(correction({ id: "c2" }), { withdrawn: { by: "o", at: "t" } })]);
    await w.pass();
    expect(w.calls.map((c) => [c.verb, c.input.id])).toEqual([["upsert", "c1"]]);
    withdrawn = { by: "owner", at: "2026-10-21T02:00:00.000Z" };
    // M-I5: skip withdrawals -> no withdraw call; M-I6: withdraw whatever is withdrawn -> a call for c2 too.
    expect(await w.pass()).toEqual({ upserted: [], withdrawn: ["c1"], refused: [], failed: [] });
    expect(w.calls.slice(1)).toEqual([{ verb: "withdraw", cwd: w.repo, input: { version: 1, id: "c1" } }]);
    await w.pass();
    expect(w.calls).toHaveLength(2);
    expect((await readExports(w.dir)).rows.c1).toEqual({ state: "withdrawn", at: expect.any(Number) });
  });

  it("a withdrawal after a failed write is still sent: the write may have committed", async () => {
    let withdrawn: CorrectionListItemV1["withdrawn"] = null;
    const w = await passWorld(() => [item(correction(), { withdrawn })], [{ kind: "failed", detail: "timeout" }]);
    await w.pass();
    withdrawn = { by: "owner", at: "t" };
    w.advance(5 * 60_000);
    expect((await w.pass()).withdrawn).toEqual(["c1"]);
  });

  it("creates its record file 0600 and refuses one it cannot read rather than overwrite it", async () => {
    const w = await passWorld(() => [item(correction())]);
    await w.pass();
    // Rule 17: an explicit mode, not the umask's.
    expect((await stat(join(w.dir, EXPORTS_FILE))).mode & 0o777).toBe(0o600);
    await writeFile(join(w.dir, EXPORTS_FILE), "{not json");
    await expect(w.pass()).rejects.toThrow();
    expect(await readFile(join(w.dir, EXPORTS_FILE), "utf8")).toBe("{not json");
  });
});

describe("the exporter", () => {
  it("runs at most one pass per interval and never throws into the pump", async () => {
    let lists = 0;
    let clock = 0;
    const logs: string[] = [];
    const exporter = createCorrectionExporter({
      ccmemBin: "/fake", env: {}, correctionsDir: "/nonexistent/never", now: () => clock, log: (line) => logs.push(line),
      listCorrections: async () => { lists += 1; throw new Error("store unreadable"); }, repositoryPath: () => null,
    }, 1000);
    expect(await exporter.maybeRun()).toBeNull();
    expect(lists).toBe(1);
    expect(logs).toEqual(["orca-ccmem: correction export pass failed: store unreadable\n"]);
    clock = 999;
    // M-I7: no interval -> a second listing here.
    await exporter.maybeRun(); expect(lists).toBe(1);
    clock = 1000;
    await exporter.maybeRun(); expect(lists).toBe(2);
  });
});

describe("one ccmem call", () => {
  /** A ccmem stand-in: records argv and stdin, answers per `mode`. */
  async function stub(mode: "ok" | "refuse" | "fail" | "garbage") {
    const dir = await tempDir("orca-corr-stub-");
    const bin = join(dir, "ccmem");
    await writeFile(bin, `#!/bin/sh\necho "$@" > '${dir}/argv'\ncat > '${dir}/stdin'\npwd > '${dir}/cwd'\n` + {
      ok: `echo '{"action":"inserted","memoryId":3}'\nexit 0\n`, refuse: `echo 'content too long' >&2\nexit 64\n`,
      fail: `echo 'database is locked' >&2\nexit 1\n`, garbage: `echo 'not json'\nexit 0\n` }[mode], { mode: 0o755 });
    return { bin, dir, read: (name: string) => readFile(join(dir, name), "utf8") };
  }

  it("sends one JSON object on stdin, in the repository, and maps exit codes", async () => {
    const s = await stub("ok");
    const answer = await callCcmemCorrection(s.bin, { PATH: process.env.PATH }, s.dir, "upsert", { version: 1, id: "c1", content: "x" });
    expect(answer).toEqual({ kind: "ok", body: { action: "inserted", memoryId: 3 } });
    expect((await s.read("argv")).trim()).toBe("orca-correction upsert");
    expect(JSON.parse(await s.read("stdin"))).toEqual({ version: 1, id: "c1", content: "x" });
    expect((await s.read("cwd")).trim()).toBe(s.dir);
    expect(await callCcmemCorrection((await stub("refuse")).bin, {}, s.dir, "upsert", {})).toEqual({ kind: "refused", detail: expect.stringContaining("exited 64: content too long") });
    // M-I8: map every non-zero exit to refused -> a lock would never be retried.
    expect(await callCcmemCorrection((await stub("fail")).bin, {}, s.dir, "withdraw", {})).toEqual({ kind: "failed", detail: expect.stringContaining("exited 1: database is locked") });
    expect(await callCcmemCorrection((await stub("garbage")).bin, {}, s.dir, "upsert", {})).toEqual({ kind: "failed", detail: expect.stringContaining("not one JSON object") });
    expect(await callCcmemCorrection(join(s.dir, "missing"), {}, s.dir, "upsert", {})).toEqual({ kind: "failed", detail: expect.stringContaining("ENOENT") });
  });
});

describe("--ccmem-corrections", () => {
  const base = ["--by", "owner", "--repo", "k=/tmp/x", "--no-control"];
  it("is off unless asked for, and refused by name without ccmem or without the control plane", () => {
    expect(parsePanelArgs(base, { ORCA_CCMEM_BIN: "/abs/ccmem" }).ccmemCorrections).toBeUndefined();
    expect(() => parsePanelArgs([...base, "--ccmem-corrections"], {})).toThrow(expect.objectContaining({ code: "ccmem-corrections-need-ccmem" }));
    expect(() => parsePanelArgs([...base, "--ccmem-corrections"], { ORCA_CCMEM_BIN: "relative/ccmem" })).toThrow(expect.objectContaining({ code: "ccmem-corrections-need-ccmem" }));
    expect(() => parsePanelArgs([...base, "--ccmem-corrections"], { ORCA_CCMEM_BIN: "/abs/ccmem" })).toThrow(expect.objectContaining({ code: "ccmem-corrections-need-control" }));
  });
});

// The chain end to end with Orca's real pieces: a correction recorded in the store, closed by hand on the repository's
// current branch (the closing rows deriveRows writes), read by readCorrectionList, written through a ccmem stand-in.
const RUN = "run-1";
const DECISION: DecisionEvent = {
  ev: "decision", id: `${RUN}/agent-0`, at: "2026-10-21T00:00:00.000Z", run: RUN, question: "which lock", chose: "in-process mutex",
  alternatives: [{ option: "file lease", why_not: "too heavy" }], because: "fastest",
  undo: { how: "git revert x", cost: "one repo", blast_radius: "one repo" }, scope: "repo", kind: "interface",
};
const g = (cwd: string, args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
  { cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();

describe("closed corrections reach ccmem through readCorrectionList", { timeout: 60_000 }, () => {
  it("a correction closed by hand is written with the decision's text; withdrawing it archives it", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }], { preferences: { defaultAgent: "claude", perAgent: {} } });
    cleanups.push(async () => { await h.dispose(); });
    const repo = join(h.root, "target");
    await mkdir(repo);
    g(repo, ["init", "-q", "-b", "main"]);
    g(repo, ["remote", "add", "origin", "https://example.invalid/o/r.git"]);
    await mkdir(join(repo, ".decisions"));
    await writeFile(join(repo, ".decisions", "run-1.jsonl"), `${JSON.stringify(DECISION)}\n`);
    g(repo, ["add", ".decisions"]); g(repo, ["commit", "-qm", "ledger"]);
    const dir = join(h.root, "corrections");
    await mkdir(dir, { mode: 0o700 });
    const recorded = await recordNewCorrection(dir, correctionRowFrom({ projectKey: await projectKeyOf(repo), decisionId: DECISION.id, kind: "not_my_taste",
      chose_instead: "file lease", because: "it must survive a restart", by: "owner@example.invalid" }, () => new Date("2026-10-21T01:00:00.000Z")), { again: false });
    const listRepositories = () => [{ repoId: "repo", path: repo }];
    const calls: Array<{ verb: string; input: unknown }> = [];
    const deps: CorrectionExporterDeps = {
      ccmemBin: "/fake", env: {}, correctionsDir: dir, repositoryPath: (repoId) => listRepositories().find((r) => r.repoId === repoId)?.path ?? null,
      listCorrections: () => readCorrectionList({ store: h.store, correctionsDir: dir, listRepositories }),
      call: async (_b, _e, _c, verb, input) => { calls.push({ verb, input }); return { kind: "ok", body: { memoryId: 1 } }; },
    };
    // Open: nothing is written.
    expect((await exportCorrectionsPass(deps)).upserted).toEqual([]);
    const { id, ...row } = recorded;
    const fixRunId = deriveFixRunId(row, id);
    const { decision, overturned } = deriveRows({ correction: recorded, original: DECISION, choseInstead: "file lease", undo: { how: "git revert --no-edit HEAD" }, at: "2026-10-21T02:00:00.000Z", runId: fixRunId });
    await writeFile(join(repo, ".decisions", `${fixRunId}.jsonl`), `${JSON.stringify(decision)}\n${JSON.stringify(overturned)}\n`);
    g(repo, ["add", ".decisions"]); g(repo, ["commit", "-qm", "close"]);
    expect((await exportCorrectionsPass(deps)).upserted).toEqual([recorded.id]);
    expect(calls).toEqual([{ verb: "upsert", input: { version: 1, id: recorded.id, content: expect.stringContaining('for "which lock" an agent chose "in-process mutex"') } }]);
    // Orca refuses to withdraw a closed correction (withdrawals.ts), so the withdraw path is reached only after the
    // closing left the branch (here: the closing commit is reset away) and the person then withdrew it.
    g(repo, ["reset", "-q", "--hard", "HEAD~1"]);
    await withdrawCorrection(dir, { correctionId: recorded.id, by: "owner@example.invalid", at: "2026-10-21T03:00:00.000Z", isClosed: () => false });
    expect((await exportCorrectionsPass(deps)).withdrawn).toEqual([recorded.id]);
    expect(calls.at(-1)).toEqual({ verb: "withdraw", input: { version: 1, id: recorded.id } });
  });
});

// Spec §6.3-style real ccmem (gated like tests/memory/ccmemReal.test.ts: runs only with ORCA_CCMEM_REAL_BIN, in a temp data
// root and temp HOME), so the stdin/exit/stdout contract cannot drift behind the stand-ins above.
const REAL = process.env.ORCA_CCMEM_REAL_BIN;
describe("a real ccmem", () => {
  it("upserts once, reports unchanged on a resend, and withdraws", async (ctx) => {
    if (REAL === undefined || REAL === "") { ctx.skip(); return; }
    const dir = await tempDir("orca-real-ccmem-corr-");
    const repo = join(dir, "repo");
    await mkdir(repo);
    g(repo, ["init", "-q", "-b", "main"]);
    g(repo, ["remote", "add", "origin", "https://example.invalid/o/r.git"]);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), CCMEM_DATA_ROOT: join(dir, "root") };
    const input = { version: 1, id: "corr-1", content: "Orca correction: prefer a file lease. Because: restarts." };
    const first = await callCcmemCorrection(REAL, env, repo, "upsert", input);
    expect(first).toEqual({ kind: "ok", body: expect.objectContaining({ action: "inserted", externalRef: "orca:correction:corr-1" }) });
    expect(await callCcmemCorrection(REAL, env, repo, "upsert", input)).toEqual({ kind: "ok", body: expect.objectContaining({ action: "unchanged" }) });
    expect(await callCcmemCorrection(REAL, env, repo, "upsert", { ...input, content: "x".repeat(MEMORY_MAX_CHARS + 1) })).toEqual({ kind: "refused", detail: expect.any(String) });
    const exported = JSON.parse(execFileSync(REAL, ["export", "--json", "--scope", "project"], { cwd: repo, env, encoding: "utf8" })) as { memories: Array<{ content: string; tags: string }> };
    expect(exported.memories.filter((m) => m.content === input.content).map((m) => JSON.parse(m.tags))).toEqual([["orca-correction", "orca:correction:corr-1", "retrieval_only"]]);
    expect(await callCcmemCorrection(REAL, env, repo, "withdraw", { version: 1, id: "corr-1" })).toEqual({ kind: "ok", body: expect.objectContaining({ action: "withdrawn" }) });
    expect(await callCcmemCorrection(REAL, env, repo, "withdraw", { version: 1, id: "corr-1" })).toEqual({ kind: "ok", body: expect.objectContaining({ action: "absent" }) });
  });
});

describe("the control runtime", () => {
  it("starts an export pass from the pump only with --ccmem-corrections", async () => {
    const { assembleControlRuntime } = await import("../../src/panel/controlAssembly.js");
    const { resolveControlOptions } = await import("../../src/panel/controlOptions.js");
    const { correctionsFile } = await import("../../src/corrections/paths.js");
    const { vi } = await import("vitest");
    const root = await tempDir("orca-corr-runtime-");
    const repo = join(root, "repo"); await mkdir(repo);
    const dir = join(root, "corrections"); await mkdir(dir, { mode: 0o700 });
    // An unreadable store makes the pass fail loudly; the failure line is what shows a pass ran.
    await writeFile(correctionsFile(dir), "{not a row\n");
    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control") };
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { writes.push(String(chunk)); return true; });
    try {
      for (const on of [false, true]) {
        const { rejection, ...control } = resolveControlOptions([], { ...env, ORCA_CONTROL_DIR: join(root, `control-${on}`) }, [{ projectKey: "proj", path: repo }]);
        expect(rejection).toBe(null);
        const runtime = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: `epoch-${on}`, env,
          corrections: { dir, by: "owner" }, ...(on ? { ccmemCorrections: { ccmemBin: "/fake/ccmem", env: {} } } : {}) });
        if (runtime === null) throw new Error("no runtime");
        try {
          await runtime.pump();
          await new Promise((settle) => setTimeout(settle, 200));
        } finally { runtime.close(); }
        // M-I9: the pump never starts the exporter -> no line with the flag on.
        expect(writes.some((line) => line.startsWith("orca-ccmem: correction export pass failed:"))).toBe(on);
      }
    } finally { spy.mockRestore(); }
  });
});
