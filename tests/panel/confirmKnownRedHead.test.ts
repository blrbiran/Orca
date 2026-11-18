// Pre-existing failures spec 2026-11-18 L4 (#341), Task 4 review I-1 (controller ruling): most groups start at their
// target's HEAD, so before their first run the store knows no base. The confirm step's own read (never `group brief`) may
// then run ONE `git rev-parse` in the target checkout -- only when the group has no recorded or predicted base, no
// prerequisite is still waiting, and the store already holds a red record for that repository (checked before any child
// starts). Its line is a prediction: "At the target's current HEAD". Running a check before a start stays forbidden.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { WebControlService } from "../../src/control/webService.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

/** Every way a child process starts, counted around each request. */
const started = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const counted = <F extends (...args: never[]) => unknown>(fn: F): F => ((...args: Parameters<F>) => { started.count += 1; return fn(...args); }) as F;
  const execFile = Object.assign(counted(actual.execFile), { [promisify.custom]: counted((actual.execFile as unknown as Record<symbol, (...args: never[]) => unknown>)[promisify.custom]!) });
  const exec = Object.assign(counted(actual.exec), { [promisify.custom]: counted((actual.exec as unknown as Record<symbol, (...args: never[]) => unknown>)[promisify.custom]!) });
  return { ...actual, spawn: counted(actual.spawn), spawnSync: counted(actual.spawnSync), execFileSync: counted(actual.execFileSync), execSync: counted(actual.execSync), fork: counted(actual.fork), execFile, exec };
});

const DAY = Date.UTC(2026, 10, 17, 9, 30);
const OTHER = "c".repeat(40);
const red = (tip: string, at = DAY) => ({ tip, result: "failed", at, commands: [{ command: "npm test", exit: "1", ms: 1 }] });
const workRun = (base: string) => JSON.stringify({ taskId: "a", phase: "work", state: "landed", failureCode: null, startedAt: 1, endedAt: 2, unknown: { work: false, handoff: false },
  cumulative: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, drive: { base } });

type H = Awaited<ReturnType<typeof webFixture>>;
async function world() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const repo = join(h.root, "repo");
  const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  g("init", "-q"); writeFileSync(join(repo, "f.txt"), "x\n"); g("add", "f.txt");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  const head = g("rev-parse", "HEAD");
  const service = new WebControlService({ ...h.deps, resolveRepository: () => repo });
  const server = createServer((() => { const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service }, "web"); return app; })());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const get = async (path: string) => {
    started.count = 0;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/${path}`);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    return { body, spawned: started.count };
  };
  return { h, head, confirm: () => get("confirm-known-red"), brief: () => get("brief"),
    done: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); } };
}
const group = (h: H, id: string, body: Record<string, unknown>) =>
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,?)").run(id, JSON.stringify(body));

describe("the confirm step predicts at the target's HEAD (#341 L4, review I-1)", () => {
  it("no base known, nothing waiting, a red record for the repository: one rev-parse, and the line names HEAD", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: red(w.head) });
      const { body, spawned } = await w.confirm();
      // mutation: the route never asks for HEAD -> no atHead -> red
      expect(body).toEqual({ schema: "orca-confirm-known-red-v1", atHead: { head: w.head, known: [{ command: "npm test", base: w.head, source: "acceptance", groupId: "old", at: DAY }] } });
      expect(spawned).toBe(1);
      // The brief stays spawn-free and says nothing: HEAD is not this group's base.
      const brief = await w.brief();
      expect(brief.spawned).toBe(0);
      expect(brief.body).not.toHaveProperty("knownRedAtBase");
    } finally { await w.done(); }
  });

  it("no red record for the repository: nothing starts", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: { ...red(w.head), result: "passed", commands: [{ command: "npm test", exit: "0", ms: 1 }] } });
      group(w.h, "elsewhere", { status: "done", plan: { repoId: "repo-2" }, acceptance: red(w.head) });
      w.h.store.db.prepare(`INSERT INTO base_check_results(repo_id,base,command,result,tail,why,group_id,task_id,run_id,requested_at,at,attempts)
        VALUES ('repo',?,'npm test','green',NULL,NULL,'sib','t2','run-sib',1,2,1)`).run(w.head);
      // mutation: drop the DB pre-check -> one rev-parse -> red
      // mutation: the pre-check ignores the repository -> one rev-parse -> red
      expect(await w.confirm()).toEqual({ body: { schema: "orca-confirm-known-red-v1" }, spawned: 0 });
    } finally { await w.done(); }
  });

  it("a red L3 record for the repository is enough for the pre-check", async () => {
    const w = await world();
    try {
      w.h.store.db.prepare(`INSERT INTO base_check_results(repo_id,base,command,result,tail,why,group_id,task_id,run_id,requested_at,at,attempts)
        VALUES ('repo',?,'npm run lint','red','t',NULL,'sib','t2','run-sib',1,?,1)`).run(w.head, DAY);
      // mutation: the pre-check reads acceptances only -> nothing starts -> red
      expect(await w.confirm()).toEqual({ body: { schema: "orca-confirm-known-red-v1", atHead: { head: w.head,
        known: [{ command: "npm run lint", base: w.head, source: "base-check", groupId: "sib", taskId: "t2", at: DAY }] } }, spawned: 1 });
    } finally { await w.done(); }
  });

  it("a base already known (recorded): the base's answer, and nothing starts", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: red(OTHER) });
      w.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-a','g','a',1,0,?)").run(workRun(OTHER));
      // mutation: ask for HEAD whenever the base answer is empty, or always -> spawned 1 -> red
      expect(await w.confirm()).toEqual({ body: { schema: "orca-confirm-known-red-v1", knownRedAtBase: [{ command: "npm test", base: OTHER, source: "acceptance", groupId: "old", at: DAY }] }, spawned: 0 });
      w.h.store.db.prepare("UPDATE runs SET body=? WHERE id='run-a'").run(workRun("d".repeat(40)));
      // mutation: drop the "no recorded base" condition -> one rev-parse -> red
      expect(await w.confirm()).toEqual({ body: { schema: "orca-confirm-known-red-v1" }, spawned: 0 });
    } finally { await w.done(); }
  });

  it("a prerequisite still waiting: HEAD may move before this group starts, so nothing starts", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: red(w.head) });
      // A prerequisite that delivers to the target locally: not stacked, but HEAD moves when it delivers.
      group(w.h, "pre", { status: "running", plan: { repoId: "repo" }, integration: newGroupIntegration({ delivery: "local", trigger: "group", method: "merge", target: "main" }) });
      w.h.store.db.prepare("INSERT INTO group_edges(from_group,to_group,body) VALUES ('pre','g','{}')").run();
      // mutation: drop the "every prerequisite done" condition -> one rev-parse -> red
      expect(await w.confirm()).toEqual({ body: { schema: "orca-confirm-known-red-v1" }, spawned: 0 });
      w.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','done') WHERE id='pre'").run();
      expect((await w.confirm()).spawned).toBe(1);
    } finally { await w.done(); }
  });

  it("a group stacked on another starts from that group's branch, not HEAD: nothing starts", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: red(w.head) });
      // A done stacked prerequisite whose accepted tip had nothing red: the predicted base answers (empty), HEAD is not read.
      group(w.h, "pre", { status: "done", plan: { repoId: "repo" }, acceptance: { tip: OTHER, result: "passed", at: DAY, commands: [{ command: "npm test", exit: "0", ms: 1 }] } });
      w.h.store.db.prepare("INSERT INTO group_edges(from_group,to_group,body) VALUES ('pre','g','{}')").run();
      // mutation: drop the "not stacked" condition -> one rev-parse -> red
      expect(await w.confirm()).toEqual({ body: { schema: "orca-confirm-known-red-v1" }, spawned: 0 });
    } finally { await w.done(); }
  });
});
