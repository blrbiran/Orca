import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { shutdownCommandId } from "../../src/panel/controlLifecycle.js";

/**
 * Assembly plan Task 7 (spec §6). A shutdown writes one identity for the epoch. "One" is judged by
 * counting the ledger rows that carry that identity, never by the log or by the return value alone:
 * an implementation that reorders its logging would pass the second and fail the first.
 */

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function runtime(epoch = "epoch-shutdown") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-shutdown-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const repos = [{ projectKey: "proj", path: repo }];
  const { rejection, ...control } = resolveControlOptions(["--by", "t"], { ORCA_CONTROL_DIR: join(root, "control") }, repos);
  expect(rejection).toBe(null);
  const assembled = await assembleControlRuntime({ control, repos, epoch, env: {} });
  expect(assembled).not.toBe(null);
  return assembled!;
}

const commandRows = (control: Awaited<ReturnType<typeof runtime>>, id: string): number =>
  Number(control.store.db.prepare("SELECT count(*) AS n FROM commands WHERE id=?").get(id)?.n ?? 0);

describe("a panel shuts its control plane down once per epoch", () => {
  it("writes exactly one command row for the epoch's shutdown identity", async () => {
    const control = await runtime();
    try {
      expect(await control.shutdown()).toBe(true);
      expect(commandRows(control, shutdownCommandId("epoch-shutdown"))).toBe(1);
    } finally { control.close(); }
  });

  it("does not write a second identity when a second signal arrives", async () => {
    const control = await runtime();
    try {
      const [first, second] = await Promise.all([control.shutdown(), control.shutdown()]);
      // Row count first, return value second: the count is what a duplicate would actually corrupt.
      expect(commandRows(control, shutdownCommandId("epoch-shutdown"))).toBe(1);
      expect([first, second].filter(Boolean)).toHaveLength(1);
    } finally { control.close(); }
  });

  it("does not write a second identity for a signal that arrives after the first finished", async () => {
    // Different from the racing case above: a latch that only guards concurrent calls would pass
    // that one and fail this one.
    const control = await runtime();
    try {
      expect(await control.shutdown()).toBe(true);
      expect(await control.shutdown()).toBe(false);
      expect(commandRows(control, shutdownCommandId("epoch-shutdown"))).toBe(1);
    } finally { control.close(); }
  });

  it("gives a different epoch its own identity, because a restart is not the same shutdown", async () => {
    const a = await runtime("epoch-a");
    try { await a.shutdown(); } finally { a.close(); }
    const b = await runtime("epoch-b");
    try {
      await b.shutdown();
      expect(commandRows(b, shutdownCommandId("epoch-b"))).toBe(1);
      expect(shutdownCommandId("epoch-a")).not.toBe(shutdownCommandId("epoch-b"));
    } finally { b.close(); }
  });

  it("stops the wake pump, so nothing keeps writing after the gate has closed", async () => {
    const control = await runtime();
    try {
      expect(control.startPump(1_000)).toBe(true);
      await control.shutdown();
      // Armed again means the timer really was cleared: startPump answers false while one is live.
      expect(control.startPump(1_000)).toBe(true);
    } finally { control.close(); }
  });
});

import { spawn } from "node:child_process";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { openControlStore } from "../../src/control/store.js";

/**
 * The plan's Task 7 Step 1: a real signal delivered to a real process. The judgements above exercise
 * `shutdown()`; this one exercises the handler, which is the part a wrong `process.on` would break
 * while every one of them stayed green.
 */
async function signalPanel() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-signal-")));
  roots.push(root);
  const repo = join(root, "repo"), controlRoot = join(root, "control");
  await mkdir(repo, { recursive: true });
  await mkdir(join(root, "corrections"), { recursive: true });
  // Judge the panel process itself, not tsx's independently timed signal relay.
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "panel", "--by", "tester", "--repo", `proj=${repo}`, "--port", "0"], {
    cwd: process.cwd(),
    env: { ...process.env, ORCA_CONTROL_DIR: controlRoot, ORCA_CORRECTIONS_DIR: join(root, "corrections") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "", stdout = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve => child.once("exit", (code,signal) => resolve({code,signal})));
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ready line within 30s; stderr: ${stderr}`)), 30_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();const match = /orca-panel ready url=(\S+)/.exec(stdout);
        if (match) { clearTimeout(timer); resolve(match[1]!); }
      });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`exited ${code} before ready; stderr: ${stderr}`)); });
    });
    return {child,exited,url,stateDir:join(controlRoot,controlRepoKey("proj")),stderr:()=>stderr};
  } catch(error) { child.kill("SIGKILL"); throw error; }
}
async function assertOneShutdown(stateDir:string):Promise<void> {
  const store = await openControlStore({ stateDir, recovery: true });
  try { expect(store.db.prepare("SELECT id FROM commands WHERE id LIKE 'shutdown-%'").all()).toHaveLength(1); }
  finally { store.close(); }
}

describe("a real SIGTERM to a real panel", () => {
  it("makes it exit cleanly, having written one shutdown row for its epoch", async () => {
    const panel = await signalPanel();
    try { panel.child.kill("SIGTERM"); expect(await panel.exited).toEqual({code:0,signal:null}); }
    finally { if (panel.child.exitCode === null) panel.child.kill("SIGKILL"); }
    await assertOneShutdown(panel.stateDir);
  }, 60_000);

  it("a second observed signal forces exit 1 during a real HTTP drain without duplicating the shutdown row", async () => {
    const panel = await signalPanel();
    const held = http.request(`${panel.url}/api/auth/login`, {method:"POST",headers:{"Content-Type":"application/json","Content-Length":"1024","Expect":"100-continue"}});
    held.on("error",()=>{}); // Force exit resets this deliberately incomplete, owned request.
    let contention:DatabaseSync|null=null;
    let unlock:ReturnType<typeof setTimeout>|null=null;
    let transactionHeld=false;
    const releaseContention=()=>{const owner=contention;contention=null;if(owner){try{if(transactionHeld)owner.exec("ROLLBACK");}finally{transactionHeld=false;owner.close();}}};
    try {
      await new Promise<void>((resolve,reject)=>{held.once("continue",resolve);held.once("error",reject);held.flushHeaders();});
      held.write('{"username":"');
      // Exercise the observer's real DELETE-journal contention path without changing any stored data.
      contention=new DatabaseSync(join(panel.stateDir,"control.sqlite"));
      contention.exec("PRAGMA busy_timeout=1000; BEGIN EXCLUSIVE");
      transactionHeld=true;
      unlock=setTimeout(releaseContention,100);
      panel.child.kill("SIGTERM");
      // Observe the first durable identity while the real HTTP request keeps server.close pending.
      const db = new DatabaseSync(join(panel.stateDir,"control.sqlite"),{readOnly:true});
      try {
        const deadline=Date.now()+5000;
        let written=false;
        while(!written){
          if(panel.child.exitCode!==null||Date.now()>=deadline)throw new Error(`first shutdown did not drain HTTP; stderr: ${panel.stderr()}`);
          try {
            const count=Number(db.prepare("SELECT count(*) AS n FROM commands WHERE id LIKE 'shutdown-%'").get()?.n);
            expect(count).toBeLessThanOrEqual(1);written=count===1;
          } catch(error) {
            // DELETE journaling can briefly exclude a concurrent reader. Busy is pending evidence, not zero rows.
            const code=(error as {errcode?:number}).errcode;
            if(code!==5&&code!==6)throw error;
          }
          if(!written)await new Promise(resolve=>setTimeout(resolve,10));
        }
      } finally { db.close(); }
      expect(panel.child.exitCode).toBeNull();
      panel.child.kill("SIGTERM");
      const forced = await new Promise<Awaited<typeof panel.exited>>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("second signal did not force panel exit within 5s")),5000);
        panel.exited.then(result=>{clearTimeout(timer);resolve(result);});
      });
      expect(forced).toEqual({code:1,signal:null});
      expect(panel.stderr()).toContain("orca-panel: second signal; exiting without draining. The next start may be recovery blocked.\n");
    } finally { if(unlock!==null)clearTimeout(unlock);releaseContention();held.destroy();if(panel.child.exitCode===null)panel.child.kill("SIGKILL"); }
    await assertOneShutdown(panel.stateDir);
  },60_000);
});
