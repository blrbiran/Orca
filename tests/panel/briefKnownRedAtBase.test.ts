// Pre-existing failures spec 2026-11-18 L4 (#341): before a group runs anything, Orca may already know a check is red at
// exactly its base -- an earlier group's acceptance found the full suite red there, or a task's base run did (L3). The
// confirm step and `group brief` name it, so the person learns it before the first task meets it; nothing runs to learn it
// (human ruling quoted in the spec: no check is run before a start), and a group with nothing to show keeps its bytes
// (review focus 5).
import { createServer } from "node:http";
import { promisify } from "node:util";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

/** Every way a child process starts (git, a check's shell), counted: the brief must start none. */
const started = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const counted = <F extends (...args: never[]) => unknown>(fn: F): F => ((...args: Parameters<F>) => { started.count += 1; return fn(...args); }) as F;
  const execFile = Object.assign(counted(actual.execFile), { [promisify.custom]: counted((actual.execFile as unknown as Record<symbol, (...args: never[]) => unknown>)[promisify.custom]!) });
  const exec = Object.assign(counted(actual.exec), { [promisify.custom]: counted((actual.exec as unknown as Record<symbol, (...args: never[]) => unknown>)[promisify.custom]!) });
  return { ...actual, spawn: counted(actual.spawn), spawnSync: counted(actual.spawnSync), execFileSync: counted(actual.execFileSync), execSync: counted(actual.execSync), fork: counted(actual.fork), execFile, exec };
});

const BASE = "b".repeat(40), OTHER = "c".repeat(40), EARLIER_BASE = "a".repeat(40);
const DAY = Date.UTC(2026, 10, 17, 9, 30);
/** An earlier group's acceptance: the union green, the full suite red twice at its tip, and red twice at its own base. */
const acceptance = (tip: string, baseline: string) => ({
  tip, result: "passed-relative", at: DAY,
  commands: [{ command: "setup: npm ci", exit: "1", ms: 1 }, { command: "node check.js", exit: "0", ms: 1 }, { command: "npm test", exit: "1", ms: 1 }, { command: "npm test", exit: "1", ms: 1 },
    { command: "baseline: npm test", exit: "1", ms: 1 }, { command: "baseline: npm test", exit: "1", ms: 1 }],
  fullSuite: { command: "npm test", suggestion: null, exits: ["1", "1"], flaky: false, baseline: { tip: baseline, exits: ["1", "1"] } },
});
const workRun = (base: string) => JSON.stringify({ taskId: "a", phase: "work", state: "landed", failureCode: null, startedAt: 1, endedAt: 2, unknown: { work: false, handoff: false },
  cumulative: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, drive: { base } });

type H = Awaited<ReturnType<typeof webFixture>>;
async function world(): Promise<{ h: H; brief: () => Promise<Record<string, unknown>>; done: () => Promise<void> }> {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const server = createServer((() => { const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return {
    h,
    brief: async () => {
      started.count = 0;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/brief`);
      const body = await response.json() as Record<string, unknown>;
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(started.count, "the brief started a child process").toBe(0);
      return body;
    },
    done: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); },
  };
}
const group = (h: H, id: string, body: Record<string, unknown>) =>
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,?)").run(id, JSON.stringify(body));
const workRunAt = (h: H, base: string) => h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-a','g','a',1,0,?)").run(workRun(base));
const baseCheck = (h: H, repoId: string, base: string, command: string, result: string, at: number) =>
  h.store.db.prepare(`INSERT INTO base_check_results(repo_id,base,command,result,tail,why,group_id,task_id,run_id,requested_at,at,attempts)
    VALUES (?,?,?,?,'t',NULL,'sib','t2','run-sib',?,?,1)`).run(repoId, base, command, result, at - 5, at);

describe("group brief names a check already known red at this group's base (#341 L4)", () => {
  it("an earlier group's acceptance found the full suite red at its tip, which is this group's recorded base", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: acceptance(BASE, EARLIER_BASE) });
      workRunAt(w.h, BASE);
      // mutation: drop `...(knownRed.length === 0 ? {} : { knownRedAtBase: knownRed })` from the brief route -> red
      // A setup that failed is not a check that was red; the green union command is not either: only `npm test`.
      expect((await w.brief()).knownRedAtBase).toEqual([{ command: "npm test", base: BASE, source: "acceptance", groupId: "old", at: DAY }]);
    } finally { await w.done(); }
  });

  it("the same group's full suite red at its own base counts too, when that base is this group's", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: acceptance(OTHER, BASE) });
      workRunAt(w.h, BASE);
      // mutation: drop the `baseline: ` branch (read every command at the record's tip) -> nothing -> red
      expect((await w.brief()).knownRedAtBase).toEqual([{ command: "npm test", base: BASE, source: "acceptance", groupId: "old", at: DAY }]);
    } finally { await w.done(); }
  });

  it("at confirm (no run yet): a draft stacked on a done group takes that group's accepted tip as its base", async () => {
    const w = await world();
    try {
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: acceptance(BASE, EARLIER_BASE) });
      w.h.store.db.prepare("INSERT INTO group_edges(from_group,to_group,body) VALUES ('old','g','{}')").run();
      // mutation: knownBaseOf returns null before a work run (no stacked start point) -> nothing -> red
      expect((await w.brief()).knownRedAtBase).toEqual([{ command: "npm test", base: BASE, source: "acceptance", groupId: "old", at: DAY }]);
      // Not done yet: its branch may still move, so the draft's base is not known and nothing is claimed.
      w.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','running') WHERE id='old'").run();
      // mutation: drop `prerequisite?.status === "done"` -> the line stays -> red
      expect(await w.brief()).not.toHaveProperty("knownRedAtBase");
    } finally { await w.done(); }
  });

  it("a task's base run (L3) answered red at this base is named with its task; one line per command, the earliest", async () => {
    const w = await world();
    try {
      workRunAt(w.h, BASE);
      baseCheck(w.h, "repo", BASE, "npm run lint", "red", DAY + 1_000);
      baseCheck(w.h, "repo", BASE, "npm test", "red", DAY + 2_000);
      baseCheck(w.h, "repo", BASE, "npm run build", "green", DAY);
      baseCheck(w.h, "repo", BASE, "npm run e2e", "unknown", DAY);
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: acceptance(BASE, EARLIER_BASE) });
      // mutation: drop `result='red'` from redBaseChecksAt -> build and e2e appear -> red
      // mutation: drop the dedupe by command -> `npm test` twice -> red
      expect((await w.brief()).knownRedAtBase).toEqual([
        { command: "npm test", base: BASE, source: "acceptance", groupId: "old", at: DAY },
        { command: "npm run lint", base: BASE, source: "base-check", groupId: "sib", taskId: "t2", at: DAY + 1_000 },
      ]);
    } finally { await w.done(); }
  });

  it("a different base, another repository, a flaky suite, or nothing known: no key, and the brief's bytes do not change", async () => {
    const w = await world();
    try {
      workRunAt(w.h, BASE);
      const before = JSON.stringify(await w.brief());
      // mutation: match on repository only (drop the base from both reads) -> red
      group(w.h, "old", { status: "done", plan: { repoId: "repo" }, acceptance: acceptance(OTHER, EARLIER_BASE) });
      baseCheck(w.h, "repo", OTHER, "npm test", "red", DAY);
      // mutation: drop the repository check (`groupRepoId(...) !== repoId`, `repo_id=?`) -> red
      group(w.h, "elsewhere", { status: "done", plan: { repoId: "repo-2" }, acceptance: acceptance(BASE, EARLIER_BASE) });
      baseCheck(w.h, "repo-2", BASE, "npm test", "red", DAY);
      // mutation: read the first exit of a command instead of its last (flaky: red then green) -> red
      group(w.h, "flaky", { status: "done", plan: { repoId: "repo" }, acceptance: { ...acceptance(BASE, EARLIER_BASE),
        commands: [{ command: "npm test", exit: "1", ms: 1 }, { command: "npm test", exit: "0", ms: 1 }, { command: "npm run slow", exit: "timeout 60000 ms", ms: 1 }, { command: "nope", exit: "127", ms: 1 }] } });
      expect(JSON.stringify(await w.brief())).toBe(before);
    } finally { await w.done(); }
  });
});
