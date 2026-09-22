import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { acquireChainLock, lockState } from "../../src/chain/lock.js";
import { stopRequestPath } from "../../src/chain/paths.js";
import { commitChainRecord } from "../../src/chain/record.js";
import { readChainRecord } from "../../src/chain/recordSchema.js";
import { buildApi } from "../../src/panel/api.js";
import { CHAIN_VIEW_FIELDS } from "../../src/panel/chains.js";
import type { ChainRepoView as ServerChainRepoView, ChainView as ServerChainView } from "../../src/panel/chains.js";
import type { ChainRepoView as WebChainRepoView, ChainView as WebChainView } from "../../web/src/types.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";
import { git } from "../../src/scheduler/gitExec.js";
import { type PanelOptions, createPanelServer } from "../../src/panel/server.js";
import { controlDisabled } from "../../src/panel/controlOptions.js";
import { TOKEN_ANCHOR, loadStaticFiles } from "../../src/panel/staticFiles.js";
import { WEB_CHAIN_VIEW_FIELDS } from "../../web/src/types.js";
import { PANEL_COMMIT_RULE, offending, scanTree } from "../../scripts/forbidden-literals.js";
import { isolateChainEnv } from "../helpers/chainEnv.js";
import { recordFixture } from "../helpers/chainRecord.js";
import { ORCA_ROOT, makeChainRepo } from "../helpers/chainRepo.js";
import { type FakeClaude, fakeClaude } from "../helpers/fakeClaude.js";

let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function distFixture(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), "orca-panel-dist-"));
  await writeFile(join(dist, "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  cleanups.push(() => rm(dist, { recursive: true, force: true }));
  return dist;
}
async function setup(opts: { gate?: boolean; over?: Partial<PanelOptions> } = {}) {
  const target = await makeChainRepo({ gate: opts.gate ?? true });
  const fake = await fakeClaude();
  const store = await mkdtemp(join(tmpdir(), "orca-panel-chain-store-"));
  cleanups.push(target.cleanup, fake.teardown, () => rm(store, { recursive: true, force: true }));
  const options: PanelOptions = {
    by: "tester",
    bind: "127.0.0.1",
    port: 0,
    confirmedExternal: false,
    correctionsDir: store,
    repos: [{ projectKey: "chains", path: target.path }],
    // Assembly plan Task 1: this criterion is about chains, not about the control plane, so it
    // builds the same options a `--no-control` boot produces. Fixture shape only; no assertion moved.
    control: controlDisabled(),
    distDir: await distFixture(),
    chainEnv: fake.env(),
    ...opts.over,
  };
  const panel = await createPanelServer(options);
  cleanups.push(() => panel.close());
  return { repo: target.path, fake, panel, options };
}
const post = (p: { url: string; token: string }, path: string, body: unknown, token = p.token) =>
  fetch(`${p.url}${path}`, { method: "POST", headers: { "x-orca-token": token, "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (p: { url: string; token: string }, path: string, token = p.token) => fetch(`${p.url}${path}`, { headers: { "x-orca-token": token } });

/** Polls GET /api/chains until the repository's latest chain has stopped; then waits for the supervisor to be gone. */
async function untilStopped(p: { url: string; token: string }, repo: string, chainId: string): Promise<any> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const view = ((await (await get(p, "/api/chains")).json()) as { repos: Array<{ chain: any }> }).repos[0];
    if (view.chain?.chainId === chainId && view.chain.state === "stopped") {
      const pid = (await readChainRecord(repo, chainId)).supervisorPid;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0);
        } catch {
          return view;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`supervisor ${pid} still alive`);
    }
    if (Date.now() > deadline) throw new Error(`chain ${chainId} did not stop: ${JSON.stringify(view)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
const DONE_SCENARIO = { steps: [{ do: "commit" as const, file: "panel.txt" }, { do: "exitCheckpoint" as const, status: "done" as const, next: [] }], result: { subtype: "success", cost: 0.25 } };

describe("chains in the panel (D-launch spec §6.2, §6.3, §8.2-8)", () => {
  isolateChainEnv();

  it("C1 POST /api/chains starts a chain ONLY by spawning `orca chain start`: the supervisor is another process; the status view follows it to done", async () => {
    const s = await setup();
    await s.fake.scenario(1, DONE_SCENARIO);
    const res = await post(s.panel, "/api/chains", { repoKey: "chains", goal: "panel goal", maxSessions: 2, maxCostUsd: 1 });
    expect(res.status).toBe(200);
    const { chainId } = (await res.json()) as { chainId: string };
    expect(chainId).toMatch(/^chain-[0-9a-f]{8}$/);
    const view = await untilStopped(s.panel, s.repo, chainId);
    expect(view).toEqual({
      repoKey: "chains",
      defaultSessionTimeoutMin: 360,
      problem: null,
      chain: {
        chainId, goal: "panel goal", by: "tester", via: "panel", startedAt: view.chain.startedAt, state: "stopped", holderGone: false,
        sessionsDone: 1, costUsd: 0.25, stop: { reason: "done", category: "done", at: view.chain.stop.at, awaitingHuman: [], detail: "fake done" },
      },
    });
    const record = await readChainRecord(s.repo, chainId);
    expect(record.supervisorPid).not.toBe(process.pid);
    expect(await s.fake.call(1)).not.toBeNull();
    expect(await readFile(join(s.repo, ".orca", "chain-logs", chainId, "supervisor.log"), "utf8")).toContain(`orca chain: started ${chainId}\n`);
    expect([...Object.keys(view.chain)].sort()).toEqual([...CHAIN_VIEW_FIELDS].sort());
  }, 120_000);

  it("C2 an unknown repository is 404 and bad arguments are 400, both before anything is spawned or written", async () => {
    const s = await setup({ gate: false });
    expect((await post(s.panel, "/api/chains", { repoKey: "nope", goal: "g", maxSessions: 1, maxCostUsd: 1 })).status).toBe(404);
    const bad = await post(s.panel, "/api/chains", { repoKey: "chains", goal: " ", maxSessions: 1, maxCostUsd: 1 });
    expect([bad.status, ((await bad.json()) as { code: string }).code]).toEqual([400, "chain-args-invalid"]);
    expect(existsSync(join(s.repo, ".orca", "chain-logs"))).toBe(false);
  });

  it("C3 a refusal by the CLI comes back as soon as the CLI exits, with its code (spec §2)", async () => {
    const s = await setup();
    await writeFile(join(s.repo, "stray.txt"), "x\n");
    const started = Date.now();
    const res = await post(s.panel, "/api/chains", { repoKey: "chains", goal: "g", maxSessions: 1, maxCostUsd: 1 });
    expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([409, "worktree-dirty"]);
    // Nominal: one tsx start-up. The bound is loose for the full suite's load (review M6) but stays strictly below the
    // panel's 10 s wait, which is what a panel that ignores the child's exit (mutation MP-2) would take.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it("C4 no `started` line within the wait is 500 by name, naming the log and the pid", async () => {
    const s = await setup({ over: { chainStartWaitMs: 1_000 } });
    // A prefilter that takes 3 s per call: the CLI's own gate check keeps it busy past the panel's 1 s wait, then fails.
    await writeFile(join(s.repo, "scripts", "gate-prefilter.mjs"), "setTimeout(() => process.exit(0), 3000);\n");
    await git(s.repo, ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-am", "slow prefilter"]);
    const res = await post(s.panel, "/api/chains", { repoKey: "chains", goal: "g", maxSessions: 1, maxCostUsd: 1 });
    const body = (await res.json()) as { code: string; message: string; pid: number };
    expect([res.status, body.code]).toEqual([500, "chain-start-timeout"]);
    expect(body.message).toContain("supervisor.log");
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        process.kill(body.pid, 0);
      } catch {
        break;
      }
      if (Date.now() > deadline) {
        process.kill(-body.pid, "SIGKILL");
        throw new Error("the refused CLI did not exit by itself");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 60_000);

  it("C5 stop: shape, repository, existence and state are each refused by name; a running chain gets the request", async () => {
    const s = await setup({ gate: false });
    expect((await post(s.panel, "/api/chains/chain-XYZ/stop", { repoKey: "chains" })).status).toBe(400);
    expect((await post(s.panel, "/api/chains/chain-0000000a/stop", { repoKey: "nope" })).status).toBe(404);
    const missing = await post(s.panel, "/api/chains/chain-0000000a/stop", { repoKey: "chains" });
    expect([missing.status, ((await missing.json()) as { code: string }).code]).toEqual([404, "chain-not-found"]);
    await commitChainRecord(s.repo, recordFixture({ chainId: "chain-0000000b", state: "stopped", stop: { reason: "done", category: "done", at: "2026-09-18T01:00:00.000Z", awaitingHuman: [], detail: null } }), "m");
    expect((await post(s.panel, "/api/chains/chain-0000000b/stop", { repoKey: "chains" })).status).toBe(409);
    await commitChainRecord(s.repo, recordFixture({ chainId: "chain-0000000a" }), "m");
    const ok = await post(s.panel, "/api/chains/chain-0000000a/stop", { repoKey: "chains" });
    expect([ok.status, await ok.json()]).toEqual([200, { chainId: "chain-0000000a", stopRequested: true }]);
    expect(existsSync(await stopRequestPath(s.repo, "chain-0000000a"))).toBe(true);
  });

  it("C6 status: a running record without a live holder is shown as holder gone; with one, not; a missing cost is null", async () => {
    const s = await setup({ gate: false });
    await commitChainRecord(
      s.repo,
      recordFixture({
        sessions: [
          { n: 1, sessionRef: "s", startedAt: "2026-09-18T00:00:00.000Z", endedAt: "2026-09-18T00:01:00.000Z", outcome: "exited", exitCode: 0, subtype: "success", costUsd: null, exitCheckpoint: null, chain: null, commits: 1, leftoverProcesses: 0 },
        ],
      }),
      "m",
    );
    const gone = ((await (await get(s.panel, "/api/chains")).json()) as { repos: Array<{ chain: any }> }).repos[0].chain;
    expect([gone.holderGone, gone.costUsd, gone.sessionsDone]).toEqual([true, null, 1]);
    const lock = await acquireChainLock(s.repo, "chain-0000000a");
    cleanups.push(() => lock.release());
    const live = ((await (await get(s.panel, "/api/chains")).json()) as { repos: Array<{ chain: any }> }).repos[0].chain;
    expect(live.holderGone).toBe(false);
  });

  it("C7 every chain route needs the token", async () => {
    const s = await setup({ gate: false });
    expect((await get(s.panel, "/api/chains", "wrong")).status).toBe(401);
    expect((await post(s.panel, "/api/chains", {}, "wrong")).status).toBe(401);
    expect((await post(s.panel, "/api/chains/chain-0000000a/stop", {}, "wrong")).status).toBe(401);
  });

  it("C8 external mode opens the same routes (rulings R11, R13): an app built for a confirmed external bind starts a chain", async () => {
    // Never 0.0.0.0 (tests/panel/security.test.ts:99-108): the options SAY external, the socket stays on loopback.
    const s = await setup();
    await s.fake.scenario(1, DONE_SCENARIO);
    const token = "a".repeat(64);
    const opts: PanelOptions = { ...s.options, bind: "192.0.2.1", confirmedExternal: true };
    const app = express();
    app.use(express.json({ limit: "64kb" }));
    buildApi(app, { opts, token, reviews: new ReviewsWriter(opts.correctionsDir), statics: await loadStaticFiles(opts.distDir, token) });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    const address = server.address() as { port: number };
    const p = { url: `http://127.0.0.1:${address.port}`, token };
    const res = await post(p, "/api/chains", { repoKey: "chains", goal: "external goal", maxSessions: 1, maxCostUsd: 1 });
    expect(res.status).toBe(200);
    const { chainId } = (await res.json()) as { chainId: string };
    expect((await untilStopped(p, s.repo, chainId)).chain.stop.reason).toBe("done");
    expect(await lockState(s.repo)).toEqual({ kind: "free" });
  }, 120_000);

  it('C9 the panel process never commits (panel spec §2.1, D-launch §6.3): no "commit" literal in src/panel/**, no import of the chain\'s committing modules', async () => {
    expect(offending('await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", m]);', PANEL_COMMIT_RULE)).toEqual(["commit"]);
    expect(offending('"the correction was recorded, but the reviewed mark could not be written"', PANEL_COMMIT_RULE)).toEqual([]);
    expect(await scanTree(ORCA_ROOT, "src/panel", PANEL_COMMIT_RULE)).toEqual([]);
    const importsCommitting = /from\s+["']\.\.\/chain\/(record|run|command|launch\/claudeCode)\.js["']/;
    expect(importsCommitting.test('import { startChain } from "../chain/run.js";')).toBe(true);
    const offenders: string[] = [];
    for (const name of await readdir(join(ORCA_ROOT, "src", "panel"))) {
      if (importsCommitting.test(await readFile(join(ORCA_ROOT, "src", "panel", name), "utf8"))) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("C10 web/src/types.ts keeps the chain view's field set (task 8 ruling K2)", () => {
    expect([...WEB_CHAIN_VIEW_FIELDS].sort()).toEqual([...CHAIN_VIEW_FIELDS].sort());
  });

  it("C11 a spawn failure (bad executable path) answers 500 chain-start-failed instead of crashing the panel (review fix round 1)", async () => {
    const noTsxDir = await mkdtemp(join(tmpdir(), "orca-panel-no-tsx-"));
    cleanups.push(() => rm(noTsxDir, { recursive: true, force: true }));
    const s = await setup({ gate: false, over: { chainTsxBin: join(noTsxDir, "does-not-exist") } });
    const res = await post(s.panel, "/api/chains", { repoKey: "chains", goal: "g", maxSessions: 1, maxCostUsd: 1 });
    expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([500, "chain-start-failed"]);
    // The bug this guards against was an unhandled 'error' event that crashed the WHOLE panel process on a spawn
    // failure -- so the real assertion is that the process is still alive and serving ordinary requests afterwards.
    expect((await get(s.panel, "/api/chains")).status).toBe(200);
  });
});

// The compile-time half, the same depth as tests/panel/webParity.test.ts (review M8): `npm run typecheck` checks that
// each side is assignable to the other, nested `stop` included. Never called; the criterion is that they compile.
function chainViewServerToWeb(v: ServerChainView): WebChainView {
  return v;
}
function chainViewWebToServer(v: WebChainView): ServerChainView {
  return v;
}
function chainRepoServerToWeb(v: ServerChainRepoView): WebChainRepoView {
  return v;
}
function chainRepoWebToServer(v: WebChainRepoView): ServerChainRepoView {
  return v;
}
void [chainViewServerToWeb, chainViewWebToServer, chainRepoServerToWeb, chainRepoWebToServer];
