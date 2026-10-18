import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectKeyOf } from "../../src/corrections/projectKey.js";
import { acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { ORIGINAL, makeTargetRepo, type TargetRepo } from "../corrections/harness.js";
import { sessionFor } from "./fixtures/auth.js";

/**
 * Debug task plan Task 6, through the shipped panel: a correction recorded on the panel names the PANEL's project key
 * (a `--repo` key or a projects-file slug), never the remote-derived one; its debug group opens through the control
 * route; withdrawing the correction archives the unstarted group (withdraw Amendment 2). ORCA_CONTROL_DIR,
 * ORCA_CORRECTIONS_DIR and ORCA_PROJECTS_FILE are temp paths (Rule 17).
 */
type Mode = "repo-flag" | "projects-file";
const PANEL_KEY = "mykey";

interface Ctx {
  panel: StartedPanel; repo: TargetRepo; corrections: string; root: string; stateDir: string;
  post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  get(path: string): Promise<Record<string, unknown>>;
}

async function withPanel(fn: (ctx: Ctx) => Promise<void>, options: { mode?: Mode; noControl?: boolean } = {}): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-wdg-")));
  const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
  try {
    // The criterion is only about the panel key when that key is not the remote-derived one.
    expect(await projectKeyOf(repo.path)).not.toBe(PANEL_KEY);
    const corrections = join(root, "corrections");
    await mkdir(corrections, { mode: 0o700 });
    const projectsFile = join(root, "projects.json");
    const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections, ORCA_PROJECTS_FILE: projectsFile };
    let args: string[];
    if (options.mode === "projects-file") {
      await writeFile(projectsFile, JSON.stringify({ version: 1, projects: [{ id: PANEL_KEY, name: "My project", path: repo.path }] }));
      args = ["--by", "tester", "--projects-file", projectsFile];
    } else args = ["--by", "tester", "--repo", `${PANEL_KEY}=${repo.path}`];
    if (options.noControl) args.push("--no-control");
    const panel = await createPanelServer(parsePanelArgs(args, env), env);
    try {
      const session = await sessionFor(panel, env);
      const post = async (path: string, body: unknown) => {
        const response = await session.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const get = async (path: string) => (await (await session.fetch(path)).json()) as Record<string, unknown>;
      await fn({ panel, repo, corrections, root, stateDir: join(root, "control", controlRepoKey(PANEL_KEY)), post, get });
    } finally { await panel.close(); }
  } finally {
    await repo.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}

/** Records a correction on the panel and opens its debug group through the control route; returns the correction id. */
async function recordAndOpen(ctx: Ctx): Promise<string> {
  const recorded = await ctx.post("/api/corrections", { projectKey: PANEL_KEY, decisionId: ORIGINAL.id, kind: "wrong", because: "the premise was false" });
  expect(recorded.status).toBe(200);
  const cid = (recorded.body.correction as { id: string; projectKey: string }).id;
  expect((recorded.body.correction as { projectKey: string }).projectKey).toBe(PANEL_KEY);
  const opened = await ctx.post(`/api/control/corrections/${cid}/debug-group`, { commandId: "open-1", expectedRevision: 0, payload: { correctionId: cid, checks: ["npm test"] } });
  expect([opened.status, opened.body.result]).toEqual([201, { kind: "debug-group-opened", groupId: `debug-${cid}`, correctionId: cid, created: true }]);
  return cid;
}

/** A write into the shipped panel's own control store (its temp ORCA_CONTROL_DIR), for a state no route can make. */
function controlDb(ctx: Ctx, sql: string, ...params: Array<string | number>): void {
  const db = new DatabaseSync(join(ctx.stateDir, "control.sqlite"));
  try { db.exec("PRAGMA busy_timeout=5000"); db.prepare(sql).run(...params); } finally { db.close(); }
}

const archived = async (ctx: Ctx, cid: string): Promise<boolean> => ((await ctx.get(`/api/control/groups/debug-${cid}`)).summary as { archived: boolean }).archived;
/** The stored body's archive mark, read from the store itself (a group view refuses the fabricated run row below). */
function archivedInStore(ctx: Ctx, cid: string): boolean {
  const db = new DatabaseSync(join(ctx.stateDir, "control.sqlite"), { readOnly: true });
  try { return Object.hasOwn(JSON.parse(String(db.prepare("SELECT body FROM groups WHERE id=?").get(`debug-${cid}`)!.body)), "archived"); } finally { db.close(); }
}

describe("a panel-recorded correction opens its debug group, and withdrawing it archives the group", { timeout: 60_000 }, () => {
  it.each(["repo-flag", "projects-file"] as const)("matches the repository by the panel's key (%s) and archives on withdraw", async (mode) => {
    await withPanel(async (ctx) => {
      const cid = await recordAndOpen(ctx);
      const withdrawn = await ctx.post("/api/corrections/withdraw", { correctionId: cid });
      expect(withdrawn.status).toBe(200);
      expect(withdrawn.body.debugGroups).toEqual([{ groupId: `debug-${cid}`, state: "archived" }]);
      expect((withdrawn.body.withdrawal as { correctionId: string }).correctionId).toBe(cid);
      expect(await archived(ctx, cid)).toBe(true);
    }, { mode });
  });

  it("archives even when the review step then fails, and names the group in that 409", async () => {
    await withPanel(async (ctx) => {
      const cid = await recordAndOpen(ctx);
      const held = await acquireReviewsLock(ctx.corrections);
      let withdrawn: Awaited<ReturnType<Ctx["post"]>>;
      try { withdrawn = await ctx.post("/api/corrections/withdraw", { correctionId: cid }); } finally { await held.release(); }
      expect(withdrawn.status).toBe(409);
      expect(withdrawn.body.code).toBe("reviews-store-busy");
      expect(withdrawn.body.debugGroups).toEqual([{ groupId: `debug-${cid}`, state: "archived" }]);
      expect(await archived(ctx, cid)).toBe(true);
    });
  });

  it("answers an archive the group refuses as a 409 beside the withdrawal", async () => {
    await withPanel(async (ctx) => {
      const cid = await recordAndOpen(ctx);
      // An active run that is not a task's (an estimate's): the group is unstarted, and archive refuses it.
      controlDb(ctx, "INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,1,?)", "run-x", `debug-${cid}`, "estimate-x", 1, JSON.stringify({ runId: "run-x", taskId: null }));
      const withdrawn = await ctx.post("/api/corrections/withdraw", { correctionId: cid });
      expect(withdrawn.status).toBe(409);
      expect(withdrawn.body.code).toBe("archive-run-active");
      expect(withdrawn.body.debugGroupFailure).toMatchObject({ groupId: `debug-${cid}`, code: "archive-run-active" });
      expect((withdrawn.body.withdrawal as { correctionId: string }).correctionId).toBe(cid);
      expect(withdrawn.body.review).toBe("written");
      expect(archivedInStore(ctx, cid)).toBe(false);
    });
  });

  it("answers a failure inside the archive walk as the same 409 shape, not a 500", async () => {
    await withPanel(async (ctx) => {
      const cid = await recordAndOpen(ctx);
      // A debug mark that does not parse: the walk throws (recovery-blocked) after the withdrawal is written.
      controlDb(ctx, "UPDATE groups SET body=json_set(body,'$.debug.ordinal','x') WHERE id=?", `debug-${cid}`);
      const withdrawn = await ctx.post("/api/corrections/withdraw", { correctionId: cid });
      expect(withdrawn.status).toBe(409);
      expect(withdrawn.body.code).toBe("panel-internal-error");
      expect(String(withdrawn.body.message)).toContain("debug-mark-invalid");
      expect((withdrawn.body.withdrawal as { correctionId: string }).correctionId).toBe(cid);
    });
  });

  it("withdraws as before on a panel with no control plane", async () => {
    await withPanel(async (ctx) => {
      const recorded = await ctx.post("/api/corrections", { projectKey: PANEL_KEY, decisionId: ORIGINAL.id, kind: "wrong", because: "the premise was false" });
      const cid = (recorded.body.correction as { id: string }).id;
      const withdrawn = await ctx.post("/api/corrections/withdraw", { correctionId: cid });
      expect([withdrawn.status, Object.keys(withdrawn.body).sort()]).toEqual([200, ["review", "withdrawal"]]);
    }, { noControl: true });
  });
});
