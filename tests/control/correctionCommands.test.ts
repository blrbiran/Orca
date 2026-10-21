import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixRunIdOf } from "../../src/control/correctionState.js";
import { applyCorrectionRecord, applyCorrectionWithdraw, type ArchiveDebugGroups, type PanelCorrections } from "../../src/control/correctionCommands.js";
import type { WebServiceDeps } from "../../src/control/webService.js";
import { closeExistingCorrection } from "../../src/corrections/correct.js";
import { writeFile } from "node:fs/promises";
import { openTestStore } from "./fixtures/store.js";
import { correctionsFile, withdrawalsFile } from "../../src/corrections/paths.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import { readCorrections } from "../../src/corrections/store.js";
import type { Correction } from "../../src/corrections/schema.js";
import { controlRepoKey, controlRoot } from "../../src/panel/controlOptions.js";
import { reviewsFile } from "../../src/panel/paths.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { ORIGINAL, makeTargetRepo, type TargetRepo } from "../corrections/harness.js";
import { login, seedUser, sessionFor } from "../panel/fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

/**
 * Debug task plan Task 11: correction-record, correction-close and correction-withdraw, through the shipped panel (its
 * routes, its control service, its corrections store and reviews file). ORCA_CONTROL_DIR and ORCA_CORRECTIONS_DIR are
 * temp paths (Rule 17). Every assertion reads the stores, the control DB or git, not only a verb's answer.
 */
const PANEL_KEY = "mykey";
const REPO_ID = controlRepoKey(PANEL_KEY);
const NOW = new Date("2026-10-19T00:00:00.000Z");
const SHA = "a".repeat(40);
const RECORD = { repoId: REPO_ID, decisionId: ORIGINAL.id, kind: "not_my_taste", because: "进程内互斥跨进程无效", chose_instead: "改用文件租约" } as const;

interface Ctx {
  panel: StartedPanel; repo: TargetRepo; corrections: string; stateDir: string;
  post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  /** A command on the `@corrections` scope (revision 0) or a group's, by route. */
  command(path: string, payload: unknown, commandId: string, expectedRevision?: number): Promise<{ status: number; body: Record<string, unknown> }>;
  db<T = Record<string, unknown>>(sql: string, ...params: Array<string | number>): T | undefined;
}

async function withPanel(fn: (ctx: Ctx) => Promise<void>, options: { repo?: TargetRepo } = {}): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-cc-")));
  const repo = options.repo ?? await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
  try {
    const corrections = join(root, "corrections");
    await mkdir(corrections, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections };
    // One clock for both paths, so a row's `at` is a value the criterion chose.
    const panel = await createPanelServer({ ...parsePanelArgs(["--by", "tester", "--repo", `${PANEL_KEY}=${repo.path}`], env), now: () => NOW }, env);
    try {
      const session = await sessionFor(panel, env);
      const post = async (path: string, body: unknown) => {
        const response = await session.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const stateDir = join(root, "control", REPO_ID);
      const db = <T,>(sql: string, ...params: Array<string | number>): T | undefined => {
        const handle = new DatabaseSync(join(stateDir, "control.sqlite"));
        try { handle.exec("PRAGMA busy_timeout=5000"); const statement = handle.prepare(sql); return (/^\s*select/i.test(sql) ? statement.get(...params) : statement.run(...params)) as T; }
        finally { handle.close(); }
      };
      const command = (path: string, payload: unknown, commandId: string, expectedRevision = 0) => post(path, { commandId, expectedRevision, payload });
      await fn({ panel, repo, corrections, stateDir, post, command, db });
    } finally { await panel.close(); }
  } finally {
    if (options.repo === undefined) await repo.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}

const read = (path: string): Promise<string | null> => readFile(path, "utf8").catch(() => null);
const gitShow = (repo: string, path: string): string | null => {
  try { return execFileSync("git", ["show", `HEAD:${path}`], { cwd: repo, encoding: "utf8", stdio: "pipe" }); } catch { return null; }
};
const errorCode = (body: Record<string, unknown>): unknown => (body.error as { code?: unknown } | undefined)?.code;

async function recordByVerb(ctx: Ctx, commandId = "rec-1"): Promise<Correction> {
  const recorded = await ctx.command("/api/control/corrections", RECORD, commandId);
  expect([recorded.status, recorded.body]).toEqual([200, expect.anything()]);
  const rows = await readCorrections(ctx.corrections);
  expect(recorded.body.result).toEqual({ kind: "correction-recorded", correctionId: rows.at(-1)!.id });
  return rows.at(-1)!;
}

async function openDebugGroup(ctx: Ctx, cid: string): Promise<string> {
  const opened = await ctx.command(`/api/control/corrections/${cid}/debug-group`, { correctionId: cid, checks: ["npm test"] }, `open-${cid}`);
  expect([opened.status, (opened.body.result as { kind?: unknown } | undefined)?.kind]).toEqual([201, "debug-group-opened"]);
  return `debug-${cid}`;
}

const closePayload = (cid: string, extra: Record<string, unknown> = {}) => ({ correctionId: cid, undoHow: `git revert --no-edit ${SHA}`, ...extra });

describe("correction-record (debug task plan Task 11)", { timeout: 60_000 }, () => {
  it("stores the same row and the same reviewed mark as /api/corrections", async () => {
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const stores: Array<{ corrections: string | null; reviews: string | null }> = [];
      await withPanel(async (ctx) => {
        const viaRoute = await ctx.post("/api/corrections", { projectKey: PANEL_KEY, decisionId: RECORD.decisionId, kind: RECORD.kind, because: RECORD.because, chose_instead: RECORD.chose_instead });
        expect(viaRoute.status).toBe(200);
        stores.push({ corrections: await read(correctionsFile(ctx.corrections)), reviews: await read(reviewsFile(ctx.corrections)) });
      }, { repo });
      await withPanel(async (ctx) => {
        await recordByVerb(ctx);
        stores.push({ corrections: await read(correctionsFile(ctx.corrections)), reviews: await read(reviewsFile(ctx.corrections)) });
      }, { repo });
      // One clock, and `by` is the same person on both paths (the logged-in owner is the panel's --by here). Mutations "by =
      // actorId" and "drop the reviewed mark" each make the second store differ. CLI v2 spec §16: both paths name the Web
      // as the channel (the route since the controller's follow-up, session b37f7ce9), so the rows -- ids included -- are
      // byte-identical again (Ruling: 这次批准改写所有必要的判据 (b37f7ce9); 允许改必要的test (8b1469ea)).
      expect(stores[0]!.reviews).toContain('"action":"reviewed"');
      expect(stores[0]!.corrections).toContain('"via":"web"');
      expect(stores[0]!.corrections!.trim().split("\n")).toHaveLength(1);
      expect(stores[1]).toEqual(stores[0]);
    } finally { await repo.cleanup(); }
  });

  it("refuses a decision the repository's ledger does not hold, recording nothing", async () => {
    await withPanel(async (ctx) => {
      const refused = await ctx.command("/api/control/corrections", { ...RECORD, decisionId: "orca-dev-1/9" }, "rec-x");
      expect([refused.status, errorCode(refused.body)]).toEqual([404, "original-decision-not-found"]);
      expect(await read(correctionsFile(ctx.corrections))).toBeNull();
    });
  });

  it("refuses a corrections store with a line that does not parse, by name", async () => {
    await withPanel(async (ctx) => {
      await writeFile(correctionsFile(ctx.corrections), "not json\n", { mode: 0o600 });
      const refused = await ctx.command("/api/control/corrections", RECORD, "rec-x");
      // Mutation "drop readCorrectionsOrRefuse in record": recordNewCorrection's SyntaxError is a 500 -> red.
      expect([refused.status, errorCode(refused.body), await read(correctionsFile(ctx.corrections))]).toEqual([409, "corrections-store-unreadable", "not json\n"]);
    });
  });
});

describe("correction-close (debug task plan Task 11)", { timeout: 60_000 }, () => {
  it("is refused while a draft debug group is live, and closes after it is archived", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const groupId = await openDebugGroup(ctx, correction.id);
      const relPath = `.decisions/${fixRunIdOf(correction)}.jsonl`;
      const refused = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id), "close-1");
      // Mutations M-11.2 (drop the live-group guard) and M-11.3 (a draft is not live): the close lands -> red.
      expect([refused.status, errorCode(refused.body), gitShow(ctx.repo.path, relPath)]).toEqual([409, "debug-group-active", null]);
      const revision = Number(ctx.db<{ revision: number }>("SELECT revision FROM groups WHERE id=?", groupId)!.revision);
      const archived = await ctx.command(`/api/control/groups/${groupId}/archive`, {}, "archive-1", revision);
      expect(archived.status).toBe(200);
      const closed = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id), "close-2");
      expect([closed.status, closed.body.result]).toEqual([200, { kind: "correction-closed", correctionId: correction.id, relPath, alreadyClosed: false }]);
      const lines = gitShow(ctx.repo.path, relPath)!.trim().split("\n").map((line) => JSON.parse(line) as { ev: string; evidence?: string[] });
      expect(lines.map((line) => line.ev)).toEqual(["decision", "overturned"]);
      // CLI v2 spec §16 (review I3, session b37f7ce9): the closing row names the Web account and channel, last.
      expect(lines[0]!.evidence).toEqual([`correction ${correction.id}`, `overturns ${ORIGINAL.id}`, "closed by tester via web correction-close close-2"]);
    });
  });

  it("closes after the live group is stopped", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const groupId = await openDebugGroup(ctx, correction.id);
      ctx.db("UPDATE groups SET body=json_set(body,'$.stopped',json('true')) WHERE id=?", groupId);
      const closed = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id), "close-1");
      expect([closed.status, (closed.body.result as { kind?: unknown } | undefined)?.kind]).toEqual([200, "correction-closed"]);
      expect(gitShow(ctx.repo.path, `.decisions/${fixRunIdOf(correction)}.jsonl`)).not.toBeNull();
    });
  });

  it("closes on the current branch when only a stopped group's work refs carry a closing row", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const groupId = await openDebugGroup(ctx, correction.id);
      const relPath = `.decisions/${fixRunIdOf(correction)}.jsonl`;
      // Task 9's landing commit: the closing row on orca/<groupId>, never integrated. The same commit is also held by the
      // pinned integration-conflict ref and a ccloop attempt ref, the other work namespaces a stopped group leaves behind.
      const run = (args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", ...args], { cwd: ctx.repo.path, encoding: "utf8", stdio: "pipe" });
      const main = run(["symbolic-ref", "--short", "HEAD"]).trim();
      run(["checkout", "-q", "-B", `orca/${groupId}`]);
      await mkdir(join(ctx.repo.path, ".decisions"), { recursive: true });
      await writeFile(join(ctx.repo.path, relPath), `${JSON.stringify({ ev: "overturned", evidence: [`correction ${correction.id}`] })}\n`);
      run(["add", "--", relPath]);
      run(["commit", "-q", "-m", "orca: debug landing", "--", relPath]);
      const landing = run(["rev-parse", "HEAD"]).trim();
      run(["update-ref", `refs/orca/integration-conflict/${groupId}/1`, landing]);
      run(["update-ref", "refs/ccloop/run-d/attempts/1", landing]);
      run(["checkout", "-q", main]);
      ctx.db("UPDATE groups SET body=json_set(body,'$.stopped',json('true')) WHERE id=?", groupId);
      const closed = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id), "close-1");
      // M-F.1 (drop the work-ref excludes from alreadyCommitted): the landing commit answers alreadyClosed true and nothing
      // lands on the current branch -> red. Read back from git: HEAD is still `main` and holds the rows the verb wrote.
      expect([closed.status, closed.body.result]).toEqual([200, { kind: "correction-closed", correctionId: correction.id, relPath, alreadyClosed: false }]);
      expect(run(["symbolic-ref", "--short", "HEAD"]).trim()).toBe(main);
      const lines = gitShow(ctx.repo.path, relPath)!.trim().split("\n").map((line) => JSON.parse(line) as { ev: string });
      expect(lines.map((line) => line.ev)).toEqual(["decision", "overturned"]);
    });
  });

  it("closes a pending-target correction with one decision row and no overturned row; the CLI still refuses it", async () => {
    await withPanel(async (ctx) => {
      const pendingId = "pending-run-1-0";
      const entry = {
        question: "which lock", chose: "in-process mutex", alternatives: [{ option: "file lease", why_not: "heavy" }], because: "fast",
        undo: { how: "revert it", cost: "c", blast_radius: "r" }, scope: "task", kind: "interface",
      };
      ctx.db("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)", JSON.stringify({ groupId: "g" }));
      ctx.db("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-1','g','a',1,0,?)", JSON.stringify({ runId: "run-1", groupId: "g", taskId: "a", state: "settled" }));
      ctx.db("INSERT INTO pending_decisions(id,group_id,run_id,ledger_run,entry_index,state,body) VALUES (?,?,?,?,?,'rejected',?)", pendingId, "g", "run-1", "run-1", 0,
        JSON.stringify({ pendingId, ledgerRun: "run-1", entryIndex: 0, entry, reason: "tier-0: undo.how", at: "2026-10-18T00:00:00.000Z", evidence: [] }));
      const correction = await recordNewCorrection(ctx.corrections, correctionRowFrom({
        projectKey: PANEL_KEY, runId: "run-1", pendingId, kind: "wrong", because: "the premise was false", by: "tester",
      }, () => NOW), { again: false });
      const relPath = `.decisions/${fixRunIdOf(correction)}.jsonl`;
      const cli = await closeExistingCorrection({ repo: ctx.repo.path, correctionId: correction.id, choseInstead: "file lease", undo: { how: `git revert --no-edit ${SHA}` }, dir: ctx.corrections })
        .then(() => "closed", (error: { code?: string }) => error.code);
      expect(cli).toBe("correction-target-not-a-decision");
      const closed = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id, { choseInstead: "file lease", undoCost: "one ledger line", undoBlastRadius: "this repository" }), "close-1");
      expect([closed.status, closed.body.result]).toEqual([200, { kind: "correction-closed", correctionId: correction.id, relPath, alreadyClosed: false }]);
      const lines = gitShow(ctx.repo.path, relPath)!.trim().split("\n").map((line) => JSON.parse(line) as { ev: string; chose: string; evidence: string[]; undo: unknown });
      // Mutation "close a pending target through closeExistingCorrection": refused target-not-a-decision -> red. Mutation
      // "drop derivePendingRows' cost/blast-radius overrides": the inherited values are written instead -> red.
      expect(lines.map((line) => [line.ev, line.chose, line.evidence, line.undo])).toEqual([["decision", "file lease", [`correction ${correction.id}`, `pending ${pendingId}`, "closed by tester via web correction-close close-1"],
        { how: `git revert --no-edit ${SHA}`, cost: "one ledger line", blast_radius: "this repository" }]]);
    });
  });

  it("refuses a withdrawn correction, leaving the ledger and the corrections file as they were", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const withdrawn = await ctx.command(`/api/control/corrections/${correction.id}/withdraw`, { correctionId: correction.id }, "wd-1");
      expect([withdrawn.status, withdrawn.body.result]).toEqual([200, { kind: "correction-withdrawn", correctionId: correction.id, review: "written", debugGroups: [] }]);
      const before = await read(correctionsFile(ctx.corrections));
      const refused = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id), "close-1");
      // Mutation "drop the withdrawn refusal": the overturn lands -> red.
      expect([refused.status, errorCode(refused.body), gitShow(ctx.repo.path, `.decisions/${fixRunIdOf(correction)}.jsonl`), await read(correctionsFile(ctx.corrections))])
        .toEqual([409, "correction-withdrawn", null, before]);
    });
  });

  it("refuses a withdrawn correction as withdrawn even while a started debug group of it is live", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const groupId = await openDebugGroup(ctx, correction.id);
      ctx.db("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)", "run-d", groupId, "debug", 1, JSON.stringify({ runId: "run-d", groupId, taskId: "debug", state: "running" }));
      const withdrawn = await ctx.command(`/api/control/corrections/${correction.id}/withdraw`, { correctionId: correction.id }, "wd-1");
      expect((withdrawn.body.result as { debugGroups?: unknown } | undefined)?.debugGroups).toEqual([{ groupId, state: "started: left running" }]);
      const refused = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id), "close-1");
      // Mutation "check the live group before the withdrawal": debug-group-active -> red.
      expect([refused.status, errorCode(refused.body)]).toEqual([409, "correction-withdrawn"]);
    });
  });

  it("refuses a path that names another correction than the payload, booking nothing", async () => {
    await withPanel(async (ctx) => {
      const other = "c_0123456789abcdef";
      const refused = await ctx.command(`/api/control/corrections/${other}/close`, closePayload("c_fedcba9876543210"), "close-x");
      // Mutation "drop the path/payload id check": the close is routed and refused correction-not-found (404) -> red.
      expect([refused.status, errorCode(refused.body)]).toEqual([400, "control-non-json-payload"]);
      expect(ctx.db("SELECT id FROM commands WHERE id='close-x'")).toBeUndefined();
    });
  });

  it("answers an undo.how the ledger refuses by name, not a 500", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const refused = await ctx.command(`/api/control/corrections/${correction.id}/close`, closePayload(correction.id, { undoHow: "just undo it somehow" }), "close-1");
      expect([refused.status, errorCode(refused.body), gitShow(ctx.repo.path, `.decisions/${fixRunIdOf(correction)}.jsonl`)]).toEqual([400, "closing-row-refused", null]);
    });
  });
});

describe("correction-withdraw (debug task plan Task 11, withdraw Amendment 7)", { timeout: 60_000 }, () => {
  it("refuses, as the panel route does, a correction whose decision the panel's discovery no longer lists", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      await rm(join(ctx.repo.path, ".decisions"), { recursive: true, force: true });
      const viaRoute = await ctx.post("/api/corrections/withdraw", { correctionId: correction.id });
      const viaVerb = await ctx.command(`/api/control/corrections/${correction.id}/withdraw`, { correctionId: correction.id }, "wd-1");
      // Mutation "drop the verb's not-listed refusal": the verb withdraws it -> red.
      expect([viaRoute.status, viaRoute.body.code, viaVerb.status, errorCode(viaVerb.body), await read(withdrawalsFile(ctx.corrections))])
        .toEqual([404, "decision-not-found", 404, "decision-not-found", null]);
    });
  });

  it("withdraws, archives the unstarted debug group, and takes the review with it", async () => {
    await withPanel(async (ctx) => {
      const correction = await recordByVerb(ctx);
      const groupId = await openDebugGroup(ctx, correction.id);
      const withdrawn = await ctx.command(`/api/control/corrections/${correction.id}/withdraw`, { correctionId: correction.id }, "wd-1");
      expect([withdrawn.status, withdrawn.body.result]).toEqual([200, { kind: "correction-withdrawn", correctionId: correction.id, review: "written", debugGroups: [{ groupId, state: "archived" }] }]);
      expect(Object.hasOwn(JSON.parse(String(ctx.db<{ body: string }>("SELECT body FROM groups WHERE id=?", groupId)!.body)), "archived")).toBe(true);
      expect(JSON.parse((await read(withdrawalsFile(ctx.corrections)))!.trim())).toEqual({ correctionId: correction.id, projectKey: PANEL_KEY, by: "tester", at: NOW.toISOString(), via: "web" });
      const reviews = (await read(reviewsFile(ctx.corrections)))!.trim().split("\n").map((line) => JSON.parse(line) as { action: string; by: string });
      expect(reviews.map((row) => [row.action, row.by])).toEqual([["reviewed", "tester"], ["withdrawn", "tester"]]);
    });
  });
});

useSocketPanels();

const commandIds = (state: string): string[] => {
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};

// Past the gate, each is the service's own refusal of an unknown decision or correction.
const SOCKET_ANSWERS = [[404, "original-decision-not-found"], [404, "correction-not-found"], [404, "correction-not-found"]];
describe("the three correction verbs are an owner's", { timeout: 60_000 }, () => {
  // CLI v2 spec §15.1 (plan Task 10; Ruling: 这次批准改写所有必要的判据 (b37f7ce9); 允许改必要的test (8b1469ea)): the three
  // verbs are open to the socket agent (no token): each passes the gate, reaches the service and is booked. A Web member
  // is refused as before (I3).
  it("refuses a member, booking nothing and writing no correction; routes the socket agent's to the service", async () => {
    const w = await workspace();
    execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" } });
    const panel = await boot(w, [], { port: true });
    seedUser(controlRoot(w.env), "amy", "member");
    const amy = await login(panel.url, "amy");
    const cid = "c_0123456789abcdef";
    const routes: Array<[string, unknown]> = [
      ["/api/control/corrections", { ...RECORD, repoId: controlRepoKey("proj") }],
      [`/api/control/corrections/${cid}/close`, closePayload(cid)],
      [`/api/control/corrections/${cid}/withdraw`, { correctionId: cid }],
    ];
    const answers: Array<{ route: string; socketAgent: unknown; webMember: unknown }> = [];
    for (const [at, [route, payload]] of routes.entries()) {
      const socket = await overSocket(panel.socketPath!, "POST", route, { "x-orca-client": "cli:test" }, { commandId: `ca-${at}`, expectedRevision: 0, payload });
      const member = await amy.fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "cc-m", expectedRevision: 0, payload }) });
      answers.push({ route, socketAgent: [socket.status, JSON.parse(socket.text).error.code], webMember: [member.status, ((await member.json()) as { error: { code: string } }).error.code] });
    }
    // Mutations M-11.1 / "withdraw is any" (VERB_ACCESS -> "any"): that verb's member answer is no longer 403 -> red;
    // "withdraw is token" (SOCKET_TIER): its socket answer is 403 control-person-token-required -> red.
    expect(answers).toEqual(routes.map(([route], at) => ({ route, socketAgent: SOCKET_ANSWERS[at], webMember: [403, "control-verb-human-only"] })));
    expect(commandIds(w.state).filter((id) => id.startsWith("cc-"))).toEqual([]);
    expect(commandIds(w.state).filter((id) => id.startsWith("ca-"))).toEqual(["ca-0", "ca-1", "ca-2"]);
    expect(await read(correctionsFile(join(w.root, "corrections")))).toBeNull();
  });
});

/**
 * The verbs' partial outcomes and their configuration refusal, through the exported handlers with a one-off fake of the
 * panel's side (a real control store under a temp root; the corrections store a temp dir).
 */
describe("the correction verbs' partial outcomes (fake panel side)", { timeout: 60_000 }, () => {
  const coded = (code: string) => Object.assign(new Error(code), { code });
  async function direct(panel: Partial<PanelCorrections> | null) {
    const h = await openTestStore();
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    const dir = join(h.root, "corrections");
    await mkdir(dir, { mode: 0o700 });
    const fake: PanelCorrections = {
      projectKeyOf: () => PANEL_KEY, now: () => NOW, markReviewed: async () => undefined,
      withdrawPrecondition: async () => ({ kind: "ok", closed: new Set<string>() }), withdrawReview: async () => "written", ...panel,
    };
    const deps = { store: h.store, correctionsDir: dir, correctionsBy: "tester", listRepositories: () => [{ repoId: REPO_ID, path: repo.path }],
      ...(panel === null ? {} : { panelCorrections: fake }) } as unknown as WebServiceDeps;
    const command = <V extends "correction-record" | "correction-withdraw">(verb: V, payload: unknown, commandId: string) =>
      ({ schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb, target: { kind: "corrections" }, payload }) as never;
    const recorded = async () => recordNewCorrection(dir, correctionRowFrom({ projectKey: PANEL_KEY, decisionId: ORIGINAL.id, kind: "wrong", because: "no", by: "tester" }, () => NOW), { again: false });
    const noArchive: ArchiveDebugGroups = () => ({ debugGroups: [], failure: null });
    const dispose = async () => { await repo.cleanup(); await h.dispose(); };
    return { deps, dir, command, recorded, noArchive, dispose };
  }
  const errorOf = (body: unknown) => (body as { error?: { code: string; message: string } }).error;

  it("answers a reviewed mark that fails after the correction is recorded beside it", async () => {
    const t = await direct({ markReviewed: async () => { throw coded("reviews-store-busy"); } }); try {
      const body = await applyCorrectionRecord(t.deps, t.command("correction-record", RECORD, "rec-1"));
      const rows = await readCorrections(t.dir);
      // Mutation "drop the reviewed-mark catch": the PanelRejection-like error escapes (a 500) -> red.
      expect([errorOf(body)?.code, errorOf(body)?.message, rows.length]).toEqual(["correction-recorded-unreviewed", `correction-recorded-unreviewed:${rows[0]?.id}:reviewed-mark:reviews-store-busy`, 1]);
    } finally { await t.dispose(); }
  });

  it("books the panel scan's gate refusal and withdraws nothing", async () => {
    const t = await direct({ withdrawPrecondition: async () => { throw coded("unresolved-project-keys"); } }); try {
      const correction = await t.recorded();
      const body = await applyCorrectionWithdraw(t.deps, t.command("correction-withdraw", { correctionId: correction.id }, "wd-1"), t.noArchive);
      // Mutation "rethrow the scan's refusal": a 500 -> red.
      expect([errorOf(body)?.code, await read(withdrawalsFile(t.dir))]).toEqual(["correction-closed-state-unknown", null]);
    } finally { await t.dispose(); }
  });

  it("answers a failed review withdrawal beside the withdrawal", async () => {
    const t = await direct({ withdrawReview: async () => { throw coded("reviews-store-busy"); } }); try {
      const correction = await t.recorded();
      const body = await applyCorrectionWithdraw(t.deps, t.command("correction-withdraw", { correctionId: correction.id }, "wd-1"), t.noArchive);
      // Mutation "read a failed review withdrawal as skipped": success -> red.
      expect([errorOf(body)?.message, (await read(withdrawalsFile(t.dir)))?.includes(correction.id)])
        .toEqual([`correction-withdrawn-incomplete:${correction.id}:review-withdrawal:reviews-store-busy`, true]);
    } finally { await t.dispose(); }
  });

  it("answers an archive that fails, or throws, beside the withdrawal", async () => {
    const t = await direct({}); try {
      const first = await t.recorded();
      const refused = await applyCorrectionWithdraw(t.deps, t.command("correction-withdraw", { correctionId: first.id }, "wd-1"),
        () => ({ debugGroups: [], failure: { groupId: "debug-x", code: "archive-run-active", message: "busy" } }));
      const second = await recordNewCorrection(t.dir, correctionRowFrom({ projectKey: PANEL_KEY, decisionId: ORIGINAL.id, kind: "wrong", because: "again", by: "tester" }, () => NOW), { again: true });
      const thrown = await applyCorrectionWithdraw(t.deps, t.command("correction-withdraw", { correctionId: second.id }, "wd-2"), () => { throw coded("panel-draining"); });
      // Mutation "drop the archive-failure answer": both succeed -> red.
      expect([errorOf(refused)?.message, errorOf(thrown)?.message]).toEqual([
        `correction-withdrawn-incomplete:${first.id}:debug-group-archive:debug-x:archive-run-active`,
        `correction-withdrawn-incomplete:${second.id}:debug-group-archive:(unknown):panel-draining`,
      ]);
    } finally { await t.dispose(); }
  });

  it("refuses record and withdraw by name on a service the panel gave no corrections side", async () => {
    const t = await direct(null); try {
      const record = await applyCorrectionRecord(t.deps, t.command("correction-record", RECORD, "rec-1"));
      const withdraw = await applyCorrectionWithdraw(t.deps, t.command("correction-withdraw", { correctionId: "c_0123456789abcdef" }, "wd-1"), t.noArchive);
      // Mutation "drop the panel check in configured()": a TypeError escapes -> red.
      expect([errorOf(record)?.code, errorOf(withdraw)?.code, await read(correctionsFile(t.dir))]).toEqual(["corrections-store-unconfigured", "corrections-store-unconfigured", null]);
    } finally { await t.dispose(); }
  });
});
