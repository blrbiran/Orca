import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import { withdrawCorrection } from "../../src/corrections/withdrawals.js";
import { flagDecision } from "../../src/control/flaggedDecisions.js";
import { readGroupDecisionsView } from "../../src/panel/groupDecisions.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";
import { integratePendingGroups } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { WebControlService } from "../../src/control/webService.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "../../src/panel/controlApi.js";
import { bindControlSocket, buildControlSocketApp } from "../../src/panel/controlSocket.js";
import type { Principal } from "../../src/panel/permissions.js";
import { driverHarness, type HarnessOptions } from "../control/fixtures/driverHarness.js";
import { overSocket } from "./fixtures/socketPanel.js";

// Control run decisions plan Task 8: GET /api/control/groups/:groupId/decisions, the group's decisions read from refs.
// Every run here is driven by the driver harness; every assertion reads the route's answer (or git), never a value the
// test wrote itself.
const g = (cwd: string, args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();

const LOCAL_MERGE: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const UNDO = `git revert --no-edit ${"b".repeat(40)}`;
const good = (over: Record<string, unknown> = {}) => ({
  question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: UNDO, cost: "c", blast_radius: "r" }, scope: "task", kind: "interface", ...over,
});
const SETTLED = ["landed", "settled"];

type View = {
  schema: string; groupId: string; projectKey: string | null; pendingCount: number;
  tasks: Array<{ taskId: string; runs: Array<{
    runId: string; settled: boolean; reported: string;
    decisions: Array<{ id: string; where: string; question: string; chose: string; kind: string; scope: string; importance: string }>;
    pending: Array<{ pendingId: string; reason: string; question: string | null; chose: string | null; undoHow: string | null; state: string; importance: string }>;
    unlanded: Array<{ entryIndex: number; question: string | null; chose: string | null; importance: string }>;
  }> }>;
};

/**
 * The harness's group with LOCAL_MERGE recorded but not yet frozen (so the driver's own pass integrates nothing until the
 * test says so), the target repository on another branch (so a local integration moves `main` without a checkout), and
 * a GitHub-shaped origin so the project key resolves.
 */
async function world(options: HarnessOptions = {}) {
  const t = await driverHarness([{ taskId: "a" }], options);
  g(t.repo, ["checkout", "-q", "-b", "other"]);
  g(t.repo, ["remote", "add", "origin", "https://github.com/example/decisions.git"]);
  const groupBody = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  const setGroupBody = (body: Record<string, unknown>) => t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
  setGroupBody({ ...groupBody(), integration: { ...newGroupIntegration(LOCAL_MERGE)!, frozen: false } });
  const service = new WebControlService({ ...t.h.deps, knownRepository: (id: string) => id === "repo", resolveRepository: () => t.repo });
  const deps: ControlReadApiDeps = { store: t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service };
  const app = express();
  app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "u", name: "u", roles: ["member"] } satisfies Principal; next(); });
  app.use(express.json({ verify: verifyControlJsonBody }));
  registerControlReadRoutes(app, deps, "web");
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const get = async (path = "/api/control/groups/g/decisions"): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: res.status, body: await res.json() };
  };
  const view = async (): Promise<View> => {
    const answer = await get();
    if (answer.status !== 200) throw new Error(`decisions view ${answer.status}: ${JSON.stringify(answer.body)}`);
    return answer.body as View;
  };
  const integrate = async () => {
    setGroupBody({ ...groupBody(), integration: { ...readGroupIntegration(groupBody())!, frozen: true } });
    return integratePendingGroups({
      store: t.h.store, roots: t.deps.roots, admissionGate: t.h.deps.admissionGate, repoPathOf: () => t.repo,
      now: () => Date.now(), ghBin: "/nonexistent/gh", stopped: () => false,
    });
  };
  return {
    ...t, deps, get, view, integrate,
    dispose: async () => { await new Promise((resolve) => server.close(resolve)); await t.h.dispose(); },
  };
}

// Rewritten again under the session grant (human, session 9ec98639, 2026-10-21: 「这次批准改写所有必要的判据」): kanban spec
// §9a gives every landed decision a `flag` (null when Orca flagged nothing); the exact expectations below gain `flag: null`.
// Rewritten under the session grant (human, session 3831d12f, 2026-10-20: 「这次批准改写所有必要的判据」): reported-decisions
// spec §6 has every entry of the three lists carry its `importance`; the exact expectations below gain
// `importance: "major"` (none of their entries is graded), and nothing else in them changed.
const runOf = (view: View, runId: string) => view.tasks.flatMap((task) => task.runs).find((run) => run.runId === runId)!;

describe("the group decisions view (control run decisions Task 8)", { timeout: 60_000 }, () => {
  it("shows a landed decision as group-branch before integration and as target after", async () => {
    const w = await world({ decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      const before = await w.view();
      expect(before).toMatchObject({ schema: "orca-group-decisions-v1", groupId: "g", projectKey: "github.com/example/decisions", pendingCount: 0 });
      expect(before.tasks.map((task) => task.taskId)).toEqual(["a"]);
      expect(runOf(before, runId)).toEqual({
        runId, settled: true, reported: "array",
        decisions: [{ id: `${runId}/agent-0`, where: "group-branch", question: "q", chose: "c", kind: "interface", scope: "task", importance: "major", flag: null }],
        pending: [], unlanded: [],
      });
      expect(await w.integrate()).toBe(true);
      // §7 integration criterion: the target branch itself now holds the run's ledger line.
      const onMain = g(w.repo, ["show", `main:.decisions/${runId}.jsonl`]).split("\n").map((l) => JSON.parse(l).id);
      expect(onMain).toEqual([`${runId}/agent-0`]);
      // mutation: swap the target and group-branch sources -> "group-branch", red
      expect(runOf(await w.view(), runId).decisions.map((d) => [d.id, d.where])).toEqual([[`${runId}/agent-0`, "target"]]);
    } finally { await w.dispose(); }
  });

  it("lists pending items with their reason and counts them", async () => {
    const w = await world({ decisions: () => [good({ kind: "opinion", question: "which" }), good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      const view = await w.view();
      expect(view.pendingCount).toBe(1);
      expect(runOf(view, runId)).toEqual({
        runId, settled: true, reported: "array",
        decisions: [{ id: `${runId}/agent-1`, where: "group-branch", question: "q", chose: "c", kind: "interface", scope: "task", importance: "major", flag: null }],
        pending: [{ pendingId: `pending-${runId}-0`, reason: 'kind-unknown:"opinion"', question: "which", chose: "c", undoHow: UNDO, state: "pending", importance: "major" }],
        unlanded: [],
      });
    } finally { await w.dispose(); }
  });

  it("lists an empty result's all-refused entry once, as pending, and shows its decision once approved", async () => {
    // Final review I2: such a run makes no ledger commit, so neither landedCommit nor ledgerCommit is set; its pending
    // rows say it landed (spec §10.4) -- the entry is pending, not also unlanded.
    const w = await world({ files: () => ({}), decisions: () => [good({ question: "which", undo: { how: "revert it", cost: "c", blast_radius: "r" } })] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).drive?.cleanedUp === true);
      expect([w.body(runId).state, w.body(runId).drive.landedCommit, w.body(runId).drive.ledgerCommit]).toEqual(["settled", null, null]);
      const pendingId = `pending-${runId}-0`;
      // mutation I2: drop the pending-rows clause -> the entry is listed as unlanded too, red
      expect(runOf(await w.view(), runId)).toEqual({
        runId, settled: true, reported: "array", decisions: [],
        pending: [{ pendingId, reason: 'tier-0: undo.how is not executable: "revert it"', question: "which", chose: "c", undoHow: "revert it", state: "pending", importance: "major" }],
        unlanded: [],
      });
      const approved = await w.deps.service!.approvePendingDecision(w.h.command("approve-pending-decision", { pendingId, undoHow: UNDO }));
      expect(approved).toMatchObject({ result: { kind: "pending-decision-approved" } });
      const after = runOf(await w.view(), runId);
      expect(after.decisions).toEqual([{ id: `${runId}/agent-0`, where: "group-branch", question: "which", chose: "c", kind: "interface", scope: "task", importance: "major", flag: null }]);
      expect([after.pending.map((p) => p.state), after.unlanded]).toEqual([["approved"], []]);
    } finally { await w.dispose(); }
  });

  it("says a run reported no decisions", async () => {
    const w = await world(); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      expect(runOf(await w.view(), runId)).toEqual({ runId, settled: true, reported: "absent", decisions: [], pending: [], unlanded: [] });
    } finally { await w.dispose(); }
  });

  it("lists a blocked run's reported entries as unlanded", async () => {
    const w = await world({ behaviour: () => "failed", decisions: () => [good({ question: "first" }), good({ kind: "opinion", chose: "second" })] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).state === "blocked");
      const drive = w.body(runId).drive;
      expect([drive.landedCommit, drive.ledgerCommit]).toEqual([null, null]);
      const view = await w.view();
      expect(view.pendingCount).toBe(0);
      expect(runOf(view, runId)).toEqual({
        runId, settled: true, reported: "array", decisions: [], pending: [],
        unlanded: [{ entryIndex: 0, question: "first", chose: "c", importance: "major" }, { entryIndex: 1, question: "q", chose: "second", importance: "major" }],
      });
    } finally { await w.dispose(); }
  });

  it("lists nothing as unlanded for a run whose decisions may still land, and says it is not settled", async () => {
    const w = await world({ decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).state === "collected");
      expect(w.body(runId).drive.landedCommit ?? null).toBeNull();
      // mutation: drop the not-yet-settled gate -> the collected run lists its entry as unlanded, red
      expect(runOf(await w.view(), runId)).toEqual({ runId, settled: false, reported: "array", decisions: [], pending: [], unlanded: [] });
    } finally { await w.dispose(); }
  });

  it("names a blocked run's non-array decisions malformed and lists the value as one unlanded entry", async () => {
    const w = await world({ behaviour: () => "failed", decisions: () => ({ question: "lone" }) }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).state === "blocked");
      // mutation: list nothing for a malformed value -> unlanded [], red
      expect(runOf(await w.view(), runId)).toEqual({
        runId, settled: true, reported: "malformed", decisions: [], pending: [], unlanded: [{ entryIndex: 0, question: "lone", chose: null, importance: "major" }],
      });
    } finally { await w.dispose(); }
  });

  it("keeps answering when one run's saved report cannot be read, and says so for that run", async () => {
    const w = await world({ behaviour: () => "failed", decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).state === "blocked");
      const outbox = JSON.parse(String(w.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`report:${runId}`)!.body));
      w.h.store.db.prepare("UPDATE artifacts SET hash=? WHERE id=?").run("0".repeat(64), outbox.source.artifactId);
      // mutation: rethrow an unreadable report -> the whole view answers 500, red
      const answer = await w.get();
      expect(answer.status).toBe(200);
      expect(runOf(answer.body as View, runId)).toEqual({ runId, settled: true, reported: "unreadable", decisions: [], pending: [], unlanded: [] });
    } finally { await w.dispose(); }
  });

  it("does not name a store failure an unreadable report", async () => {
    // Final review T8: only an artifact that cannot be read is "unreadable"; a database or programming error is not hidden.
    const w = await world({ behaviour: () => "failed", decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).state === "blocked");
      w.h.store.db.exec("ALTER TABLE artifacts RENAME TO artifacts_gone");
      // mutation T8: catch every error as unreadable again -> 200 with reported "unreadable", red
      expect((await w.get()).status).toBe(500);
      w.h.store.db.exec("ALTER TABLE artifacts_gone RENAME TO artifacts");
    } finally { await w.dispose(); }
  });

  it("answers on the socket channel too", async () => {
    const w = await world({ decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      const dir = await realpath(await mkdtemp(join(tmpdir(), "gd-")));
      const path = join(dir, "control.sock");
      const bound = await bindControlSocket(buildControlSocketApp(w.deps), path);
      if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}: ${bound.detail}`);
      try {
        // The agent read path (goal.md §1.2): the socket's principal is the agent, and the route answers it.
        const socket = await overSocket(path, "GET", "/api/control/groups/g/decisions", { "x-orca-client": "mcp:reader" });
        expect(socket.status).toBe(200);
        const body = JSON.parse(socket.text) as View;
        expect(runOf(body, runId).decisions.map((d) => [d.id, d.where])).toEqual([[`${runId}/agent-0`, "group-branch"]]);
        expect(body).toEqual(await w.view());
        const missing = await overSocket(path, "GET", "/api/control/groups/nope/decisions", { "x-orca-client": "mcp:reader" });
        expect([missing.status, JSON.parse(missing.text).error.code]).toEqual([404, "group-not-found"]);
      } finally { await bound.close(); await rm(dir, { recursive: true, force: true }); }
    } finally { await w.dispose(); }
  });

  // Reported-decisions spec 2026-10-20 §6 (criterion 15): each list carries the entry's grade; a pending or unlanded
  // entry's grade is read from its raw entry, and anything but exactly "minor" is major, so a refused entry with a bad
  // grade is never hidden. The needs-human count counts major pending entries only (goal.md §1.3).
  it("grades the written and pending lists and counts only major pending entries", async () => {
    const w = await world({ decisions: () => [
      good({ importance: "minor" }), good(),
      good({ kind: "opinion", importance: "minor" }), good({ importance: "critical" }), good({ kind: "opinion" }),
    ] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      const view = await w.view();
      const run = runOf(view, runId);
      expect(run.decisions.map((d) => [d.id, d.importance])).toEqual([[`${runId}/agent-0`, "minor"], [`${runId}/agent-1`, "major"]]);
      expect(run.pending.map((p) => [p.pendingId, p.state, p.importance])).toEqual([
        [`pending-${runId}-2`, "pending", "minor"], [`pending-${runId}-3`, "pending", "major"], [`pending-${runId}-4`, "pending", "major"],
      ]);
      // mutation M-Bo.11: count every pending entry -> 3, red
      expect(view.pendingCount).toBe(2);
    } finally { await w.dispose(); }
  });

  // Kanban spec 2026-10-20 §9a (session 9ec98639): a landed decision Orca flagged carries its flag; ratify clears it.
  it("shows a flagged landed decision's flag and counts it until it is ratified", async () => {
    const w = await world({ decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      const id = `${runId}/agent-0`;
      w.h.store.transaction(() => flagDecision(w.h.store, { decisionId: id, groupId: "g", runId, source: "reconcile", reason: "merged both sides", evidence: ["a.ts"], by: "orca-auto", at: "2026-10-21T00:00:00.000Z" }));
      const flagged = await w.view() as unknown as { flaggedCount: number; tasks: Array<{ runs: Array<{ runId: string; decisions: Array<{ id: string; flag: unknown }> }> }> };
      // mutation: flagOf returns null -> no flag on the line, red
      expect(flagged.tasks.flatMap((t) => t.runs).find((r) => r.runId === runId)!.decisions.map((d) => [d.id, d.flag]))
        .toEqual([[id, { state: "flagged", source: "reconcile", reason: "merged both sides", evidence: ["a.ts"] }]]);
      expect(flagged.flaggedCount).toBe(1);
      await w.deps.service!.ratifyFlaggedDecision(w.h.command("ratify-flagged-decision", { decisionId: id }));
      const ratified = await w.view() as unknown as typeof flagged;
      expect(ratified.tasks.flatMap((t) => t.runs).find((r) => r.runId === runId)!.decisions.map((d) => (d.flag as { state: string }).state)).toEqual(["ratified"]);
      // mutation: count every flag row -> 1, red
      expect(ratified.flaggedCount).toBe(0);
    } finally { await w.dispose(); }
  });

  it("lists a flag no landed line carries (an integration conflict an agent resolved) for the group", async () => {
    const w = await world({ decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      w.h.store.transaction(() => flagDecision(w.h.store, { decisionId: "integration-conflict:g:1", groupId: "g", runId: null, source: "integration-conflict", reason: "an agent resolved it", evidence: ["f.txt"], by: "orca-auto", at: "t" }));
      const view = await w.view() as unknown as { flaggedCount: number; groupFlags: unknown[] };
      // mutation: groupFlags lists nothing -> [], red
      expect(view.groupFlags).toEqual([{ decisionId: "integration-conflict:g:1", state: "flagged", source: "integration-conflict", reason: "an agent resolved it", evidence: ["f.txt"] }]);
      expect(view.flaggedCount).toBe(1);
    } finally { await w.dispose(); }
  });

  it("reads a flag as corrected, and stops counting it, once a correction names its decision", async () => {
    const w = await world({ decisions: () => [good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => SETTLED.includes(w.body(runId).state));
      const id = `${runId}/agent-0`;
      w.h.store.transaction(() => flagDecision(w.h.store, { decisionId: id, groupId: "g", runId, source: "reconcile", reason: "r", evidence: [], by: "orca-auto", at: "t" }));
      const view = await readGroupDecisionsView(w.h.store, w.repo, "g", new Set([id]));
      // mutation: drop the correctedIds clause in flagOf -> "flagged", red
      expect(view.tasks.flatMap((t) => t.runs).flatMap((r) => r.decisions).map((d) => d.flag?.state)).toEqual(["corrected"]);
      // mutation: drop it in the count -> 1, red
      expect(view.flaggedCount).toBe(0);
    } finally { await w.dispose(); }
  });

  it("names, as corrected, the decisions a recorded and not withdrawn correction names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flag-corr-"));
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
    try {
      const at = () => new Date("2026-10-21T00:00:00.000Z");
      const kept = await recordNewCorrection(dir, correctionRowFrom({ projectKey: "github.com/x/y", decisionId: "r1/agent-0", kind: "wrong", because: "no", by: "me" }, at), { again: false });
      const gone = await recordNewCorrection(dir, correctionRowFrom({ projectKey: "github.com/x/y", decisionId: "r2/agent-0", kind: "wrong", because: "no", by: "me" }, at), { again: false });
      await withdrawCorrection(dir, { correctionId: gone.id, by: "me", at: "2026-10-21T00:00:01.000Z", isClosed: () => false });
      const service = new WebControlService({ ...h.deps, correctionsDir: dir, correctionsBy: "me" });
      // mutation: drop the withdrawn filter -> r2 too, red
      expect([...await service.correctedDecisionIds()]).toEqual([kept.decisionId]);
      expect([...await new WebControlService(h.deps).correctedDecisionIds()]).toEqual([]);
    } finally { await h.dispose(); await rm(dir, { recursive: true, force: true }); }
  });

  it("grades the unlanded list from the raw entries", async () => {
    const w = await world({ behaviour: () => "failed", decisions: () => [good({ importance: "minor" }), good({ importance: "Minor" }), good()] }); try {
      const runId = await w.claim();
      await w.until(w.driver(), () => w.body(runId).state === "blocked");
      expect(runOf(await w.view(), runId).unlanded.map((u) => [u.entryIndex, u.importance])).toEqual([[0, "minor"], [1, "major"], [2, "major"]]);
    } finally { await w.dispose(); }
  });
});
