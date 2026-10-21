// CLI v2 spec §16 (replaces §15.2), plan Task 9: every writer an opened verb reaches records `by`, the accountable person
// (the panel owner for a socket call, the logged-in account on the Web), and `via`, the channel (web, cli:<c>, mcp:<c>).
// Where a store holds one line of text it reads `by <person> via <channel>`. Every assertion reads the store or git.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { applyCorrectionClose, applyCorrectionRecord, type PanelCorrections } from "../../src/control/correctionCommands.js";
import { fixRunIdOf } from "../../src/control/correctionState.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import { flagDecision, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { WebControlService, type WebServiceDeps } from "../../src/control/webService.js";
import { readCorrections } from "../../src/corrections/store.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { attributionOf, principalLabel, type Principal } from "../../src/panel/permissions.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import { ORIGINAL, makeTargetRepo } from "../corrections/harness.js";
import { login, seedUser, sessionFor } from "../panel/fixtures/auth.js";
import { overSocket } from "../panel/fixtures/socketPanel.js";
import { controlRoot } from "../../src/panel/controlOptions.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { openTestStore } from "./fixtures/store.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

const OWNER = "tester";
const PANEL_KEY = "mykey";
const REPO_ID = controlRepoKey(PANEL_KEY);
const NOW = new Date("2026-10-22T00:00:00.000Z");
const RECORD = { repoId: REPO_ID, decisionId: ORIGINAL.id, kind: "wrong", because: "the premise was false" } as const;

/** What the control routes run a command under (controlApi.ts): the client, the ledger label and the attribution. */
const as = <T>(principal: Principal, commandId: string, fn: () => T): T => withCommandContext(commandId, {
  client: principal.kind === "agent" ? principal.client : "web", principal: principalLabel(principal), attribution: attributionOf(principal, OWNER),
}, fn);

describe("attributionOf (spec §16)", () => {
  it("names a person in by and the channel in via", () => {
    expect(attributionOf({ kind: "agent", client: "cli:claude" }, OWNER)).toEqual({ by: OWNER, via: "cli:claude" });
    expect(attributionOf({ kind: "agent", client: "mcp:x" }, OWNER)).toEqual({ by: OWNER, via: "mcp:x" });
    expect(attributionOf({ kind: "user", userId: "u1", name: "ana", roles: ["owner"] }, OWNER)).toEqual({ by: "ana", via: "web" });
  });
});

describe("the writers an opened verb reaches (spec §16 criterion)", { timeout: 60_000 }, () => {
  it("an approve sent by cli:claude writes `undo.how by <owner> via cli:claude` on the ledger line", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [{
      question: "q0", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b", undo: { how: "revert it", cost: "c", blast_radius: "r" }, scope: "task", kind: "interface",
    }] });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => ["landed", "settled"].includes(t.body(runId).state));
      const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
      const command = t.h.command("approve-pending-decision", { pendingId: `pending-${runId}-0`, undoHow: `git revert --no-edit ${"e".repeat(40)}` });
      const answer = await as({ kind: "agent", client: "cli:claude" }, command.commandId, () => service.approvePendingDecision(command));
      expect(answer).toMatchObject({ result: { kind: "pending-decision-approved" } });
      const line = JSON.parse(git(t.repo, "show", `refs/heads/orca/g:.decisions/${runId}.jsonl`).trim().split("\n").at(-1)!) as { evidence: string[] };
      expect(line.evidence.at(-1)).toBe(`undo.how by ${OWNER} via cli:claude approve-pending-decision ${command.commandId}`);
    } finally { await t.h.dispose(); }
  });

  it("a correction recorded by mcp:x is stored with by=<owner> and via=mcp:x", async () => {
    const h = await openTestStore();
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const dir = join(h.root, "corrections");
      await mkdir(dir, { mode: 0o700 });
      const panel: PanelCorrections = {
        projectKeyOf: () => PANEL_KEY, now: () => NOW, markReviewed: async () => undefined,
        withdrawPrecondition: async () => ({ kind: "ok", closed: new Set<string>() }), withdrawReview: async () => "written",
      };
      const deps = { store: h.store, correctionsDir: dir, correctionsBy: OWNER, panelCorrections: panel, listRepositories: () => [{ repoId: REPO_ID, path: repo.path }] } as unknown as WebServiceDeps;
      const command = { schema: "orca-raw-command-v1", commandId: "rec-mcp", actorId: "operator-x", expectedRevision: 0, verb: "correction-record", target: { kind: "corrections" }, payload: RECORD } as never;
      const answer = await as({ kind: "agent", client: "mcp:x" }, "rec-mcp", () => applyCorrectionRecord(deps, command));
      expect(answer).toMatchObject({ result: { kind: "correction-recorded" } });
      expect((await readCorrections(dir)).map((row) => [row.by, row.via])).toEqual([[OWNER, "mcp:x"]]);
    } finally { await repo.cleanup(); await h.dispose(); }
  });

  // Review I3 (session b37f7ce9): the manual close's closing row, through the socket.
  it("a correction closed by cli:claude writes `closed by <owner> via cli:claude correction-close <id>` on the decision row", async () => {
    const h = await openTestStore();
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const dir = join(h.root, "corrections");
      await mkdir(dir, { mode: 0o700 });
      const row = await recordNewCorrection(dir, correctionRowFrom({ projectKey: PANEL_KEY, decisionId: ORIGINAL.id, kind: "wrong", chose_instead: "a file lease", because: "b", by: OWNER }, () => NOW), { again: false });
      const deps = { store: h.store, correctionsDir: dir, listRepositories: () => [{ repoId: REPO_ID, path: repo.path }], repoIdOfProjectKey: () => REPO_ID } as unknown as WebServiceDeps;
      const command = { schema: "orca-raw-command-v1", commandId: "close-cli", actorId: "operator-x", expectedRevision: 0, verb: "correction-close", target: { kind: "corrections" },
        payload: { correctionId: row.id, undoHow: `git revert --no-edit ${"a".repeat(40)}` } } as never;
      const answer = await as({ kind: "agent", client: "cli:claude" }, "close-cli", () => applyCorrectionClose(deps, command));
      expect(answer).toMatchObject({ result: { kind: "correction-closed", relPath: `.decisions/${fixRunIdOf(row)}.jsonl` } });
      const [decision] = git(repo.path, "show", `HEAD:.decisions/${fixRunIdOf(row)}.jsonl`).trim().split("\n").map((line) => JSON.parse(line) as { id: string; evidence: string[] });
      // The id is the fix run's, as before; mutation "the verb drops the routed attribution" -> two lines -> red.
      expect([decision!.id, decision!.evidence.at(-1)]).toEqual([`${fixRunIdOf(row)}/1`, `closed by ${OWNER} via cli:claude correction-close close-cli`]);
    } finally { await repo.cleanup(); await h.dispose(); }
  });

  it("a ratify sent by cli:claude records ratifiedBy=<owner>, ratifiedVia=cli:claude", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      h.store.transaction(() => flagDecision(h.store, { decisionId: "r1/agent-0", groupId: "g", runId: null, source: "reconcile", reason: "r", evidence: [], by: "orca-auto", at: NOW.toISOString() }));
      const command = h.command("ratify-flagged-decision", { decisionId: "r1/agent-0" });
      as({ kind: "agent", client: "cli:claude" }, command.commandId, () => new WebControlService(h.deps).ratifyFlaggedDecision(command));
      expect(readFlaggedDecision(h.store, "r1/agent-0")).toMatchObject({ state: "ratified", ratifiedBy: OWNER, ratifiedVia: "cli:claude" });
    } finally { await h.dispose(); }
  });

  it("the Web route records the logged-in owner with via=web (controlApi passes the principal's attribution)", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-attr-")));
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const corrections = join(root, "corrections");
      await mkdir(corrections, { mode: 0o700 });
      const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections };
      const panel = await createPanelServer({ ...parsePanelArgs(["--by", "panel-owner", "--repo", `${PANEL_KEY}=${repo.path}`], env), now: () => NOW }, env);
      try {
        // The account is "tester"; the panel's --by is "panel-owner": the Web row names the account.
        const session = await sessionFor(panel, env);
        const response = await session.fetch("/api/control/corrections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "rec-web", expectedRevision: 0, payload: RECORD }) });
        expect(response.status).toBe(200);
        const [row] = await readCorrections(corrections);
        expect([row!.by, row!.via]).toEqual(["tester", "web"]);
        // The debug group's undo.how (a human-only field) records who gave it, the same way.
        const opened = await session.fetch(`/api/control/corrections/${row!.id}/debug-group`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: "open-web", expectedRevision: 0, payload: { correctionId: row!.id, checks: ["npm test"], undoHow: `git revert --no-edit ${"a".repeat(40)}` } }) });
        expect(opened.status).toBe(201);
        const db = new DatabaseSync(join(root, "control", REPO_ID, "control.sqlite"), { readOnly: true });
        try { expect(JSON.parse(String(db.prepare("SELECT body FROM groups WHERE id=?").get(`debug-${row!.id}`)!.body)).debug.undoHowBy).toEqual({ by: "tester", via: "web" }); }
        finally { db.close(); }
      } finally { await panel.close(); }
    } finally { await repo.cleanup(); await rm(root, { recursive: true, force: true }); }
  });
});

// Controller's call (session b37f7ce9, ledgered): correction-withdraw is the author's -- the requester's `by` equals the
// row's recorded `by` (the account name on the Web, the panel's --by on the socket) -- or the panel owner's (its --by).
// Before, the verb compared the row against the panel's --by only, so a Web owner whose name is not --by could never
// withdraw the row §16 now records in their name.
describe("who may withdraw a correction (spec §16, controller's call)", { timeout: 60_000 }, () => {
  it("its author on the Web may; another account may not; the panel owner on the socket may; a member is refused as before", async () => {
    // A short root: the control socket's path must fit (control-socket-path-too-long otherwise).
    const root = await realpath(await mkdtemp(join(tmpdir(), "wd-")));
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const corrections = join(root, "corrections");
      await mkdir(corrections, { mode: 0o700 });
      const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections };
      const panel = await createPanelServer({ ...parsePanelArgs(["--by", "panel-owner", "--repo", `${PANEL_KEY}=${repo.path}`, "--control-state-dir", join(root, "s")], env), now: () => NOW }, env);
      try {
        const post = (s: { fetch: (path: string, init?: RequestInit) => Promise<Response> }, path: string, commandId: string, payload: unknown) =>
          s.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId, expectedRevision: 0, payload }) });
        const code = async (r: Response): Promise<[number, string]> => [r.status, r.status === 200 ? "ok" : ((await r.json()) as { error: { code: string } }).error.code];
        // "tester" is a Web owner whose account name is not the panel's --by.
        const tester = await sessionFor(panel, env);
        seedUser(controlRoot(env), "bob", "owner");
        seedUser(controlRoot(env), "amy", "member");
        const [bob, amy] = [await login(panel.url, "bob"), await login(panel.url, "amy")];
        expect((await post(tester, "/api/control/corrections", "rec-1", RECORD)).status).toBe(200);
        const [first] = await readCorrections(corrections);
        expect(first!.by).toBe("tester");
        const withdraw = `/api/control/corrections/${first!.id}/withdraw`;
        expect({
          otherOwner: await code(await post(bob, withdraw, "wd-bob", { correctionId: first!.id })),
          member: await code(await post(amy, withdraw, "wd-amy", { correctionId: first!.id })),
          author: await code(await post(tester, withdraw, "wd-tester", { correctionId: first!.id })),
        }).toEqual({ otherOwner: [409, "correction-not-yours"], member: [403, "control-verb-human-only"], author: [200, "ok"] });
        // The panel owner (the socket's person) withdraws a row recorded in another account's name.
        expect((await post(tester, "/api/control/corrections", "rec-2", { ...RECORD, because: "the premise was still false" })).status).toBe(200);
        const second = (await readCorrections(corrections)).at(-1)!;
        expect([second.id === first!.id, second.by]).toEqual([false, "tester"]);
        const socket = await overSocket(panel.socketPath!, "POST", `/api/control/corrections/${second.id}/withdraw`, { "x-orca-client": "cli:test" }, { commandId: "wd-owner", expectedRevision: 0, payload: { correctionId: second.id } });
        expect([socket.status, socket.status === 200 ? "ok" : JSON.parse(socket.text).error.code]).toEqual([200, "ok"]);
      } finally { await panel.close(); }
    } finally { await repo.cleanup(); await rm(root, { recursive: true, force: true }); }
  });
});
