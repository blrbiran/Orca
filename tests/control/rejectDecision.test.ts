import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { applyRejectPendingDecision, prepareApproval, prepareRejection } from "../../src/control/decisionCommands.js";
import { recordNewCorrection } from "../../src/corrections/record.js";
import { readPendingDecision } from "../../src/control/pendingDecisions.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { controlRepoKey, controlRoot } from "../../src/panel/controlOptions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { login, seedUser, sessionFor } from "../panel/fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Control run decisions plan Task 10: an owner rejects a decision a landing refused. The rejection is a `wrong`-kind
// correction naming { runId, pendingId } (debug-task design §12.3), recorded in the corrections store under the panel's
// own identity (cross-plan resolution 1), and the item is marked rejected with that correction's id. Every criterion
// reads the store (a mkdtemp dir, Rule 17) and the pending row, not only the command's answer.
const LANDED = ["landed", "settled"];
const BY = "owner@example.invalid";
const tier0 = (n: number) => ({
  question: `q${n}`, chose: `c${n}`, alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: "revert it", cost: "c", blast_radius: "r" }, scope: "task", kind: "interface",
});

async function landedWithPending(options: { remote?: boolean } = {}) {
  const t = await driverHarness([{ taskId: "a" }], { decisions: () => [tier0(0)] });
  const runId = await t.claim();
  await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
  if (options.remote !== false) git(t.repo, "remote", "add", "origin", "https://example.invalid/o/r.git");
  const dir = await mkdtemp(join(tmpdir(), "orca-corrections-"));
  /** null leaves the field out, as a panel built without it would. */
  const serviceAs = (by: string | null, correctionsDir: string | null = dir) => new WebControlService({
    ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo,
    ...(correctionsDir === null ? {} : { correctionsDir }), ...(by === null ? {} : { correctionsBy: by }),
  });
  const service = serviceAs(BY);
  const reject = (payload: { pendingId: string; because?: string }, commandId?: string, via = service) =>
    via.rejectPendingDecision(t.h.command("reject-pending-decision", payload, commandId));
  const pendingId = `pending-${runId}-0`;
  const state = () => readPendingDecision(t.h.store, pendingId)!.state;
  const dispose = async () => { await rm(dir, { recursive: true, force: true }); await t.h.dispose(); };
  return { ...t, runId, dir, service, serviceAs, reject, pendingId, state, dispose };
}

describe("reject-pending-decision (control run decisions Task 10)", { timeout: 60_000 }, () => {
  it("reject records a wrong-kind correction naming the run and the pending item", async () => {
    const t = await landedWithPending(); try {
      const r = await t.reject({ pendingId: t.pendingId, because: "the premise was false" });
      const rows = await readCorrections(t.dir);
      expect(rows).toHaveLength(1);
      expect(r).toMatchObject({ result: { kind: "pending-decision-rejected", pendingId: t.pendingId, correctionId: rows[0]!.id } });
      // `by` is the panel's identity, not the command's actorId (cross-plan resolution 1); the target is the run and the
      // pending item, never a decision id.
      expect(rows[0]).toMatchObject({ projectKey: "example.invalid/o/r", runId: t.runId, pendingId: t.pendingId, kind: "wrong", by: BY });
      expect(rows[0]!.decisionId).toBeUndefined();
      expect(rows[0]!.because).toBe("the premise was false\nquestion: q0\nchose: c0");
      expect(readPendingDecision(t.h.store, t.pendingId)).toMatchObject({ state: "rejected", correctionId: rows[0]!.id });
      // The command's actor is on the group's activity row.
      const activity = t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind='command' ORDER BY seq DESC LIMIT 1").get()!;
      expect(JSON.parse(String(activity.body))).toEqual({ verb: "reject-pending-decision", actor: "human" });
    } finally { await t.dispose(); }
  });

  it("a second reject finds the first correction instead of recording another", async () => {
    const t = await landedWithPending(); try {
      const first = await t.reject({ pendingId: t.pendingId, because: "no" }) as { result: { correctionId: string } };
      const again = await t.reject({ pendingId: t.pendingId });
      // A crash between the store write and the transaction leaves the correction and a pending item (§10.5); a second
      // reject, by another person, finds the first instead of recording another.
      t.h.store.db.prepare("UPDATE pending_decisions SET state='pending' WHERE id=?").run(t.pendingId);
      const recovered = await t.reject({ pendingId: t.pendingId }, undefined, t.serviceAs("someone-else@example.invalid"));
      // Mutation "drop the existing-row lookup": the other person's row is recorded, length 2 and a new id -> red.
      const resultOf = (r: unknown) => (r as { result?: unknown; error?: unknown }).result ?? (r as { error?: unknown }).error;
      expect({ rows: (await readCorrections(t.dir)).length, again: resultOf(again), recovered: resultOf(recovered) }).toEqual({
        rows: 1,
        again: { kind: "pending-decision-rejected", pendingId: t.pendingId, correctionId: first.result.correctionId },
        recovered: { kind: "pending-decision-rejected", pendingId: t.pendingId, correctionId: first.result.correctionId },
      });
      expect(readPendingDecision(t.h.store, t.pendingId)).toMatchObject({ state: "rejected", correctionId: first.result.correctionId });
    } finally { await t.dispose(); }
  });

  it("answers the same identity's double submit with its first correction, not a refusal", async () => {
    // Review fix 2: two submits by one identity can both pass the existing-row lookup; the second's append is then
    // refused by the store's "already corrected" check. The seam records the first submit's row in that window.
    const t = await landedWithPending(); try {
      const command = t.h.command("reject-pending-decision", { pendingId: t.pendingId });
      let first = "";
      const beforeRecord = async () => {
        first = (await recordNewCorrection(t.dir, { projectKey: "example.invalid/o/r", runId: t.runId, pendingId: t.pendingId, kind: "wrong", because: "first", at: "2026-10-18T00:00:00.000Z", by: BY }, { again: false })).id;
      };
      const prepared = await prepareRejection(t.h.store, t.repo, { dir: t.dir, by: BY }, command, () => new Date("2026-10-18T00:00:01.000Z"), { beforeRecord });
      // Mutation "drop the already-recorded branch": refused pending-decision-correction-failed:correction-already-recorded -> red.
      expect({ prepared, rows: (await readCorrections(t.dir)).map((row) => row.id) }).toEqual({ prepared: { kind: "recorded", correctionId: first }, rows: [first] });
      expect(applyRejectPendingDecision({ store: t.h.store }, command, prepared)).toMatchObject({ result: { kind: "pending-decision-rejected", correctionId: first } });
      expect(readPendingDecision(t.h.store, t.pendingId)).toMatchObject({ state: "rejected", correctionId: first });
    } finally { await t.dispose(); }
  });

  it("rejects with no line of the human's", async () => {
    const t = await landedWithPending(); try {
      await t.reject({ pendingId: t.pendingId });
      expect((await readCorrections(t.dir))[0]!.because).toBe("question: q0\nchose: c0");
    } finally { await t.dispose(); }
  });

  it("names a repository with no remote", async () => {
    const t = await landedWithPending({ remote: false }); try {
      const r = await t.reject({ pendingId: t.pendingId });
      expect(r).toMatchObject({ error: { code: "pending-decision-correction-failed" } });
      expect((r as { error: { message: string } }).error.message).toMatch(/^pending-decision-correction-failed:target-has-no-remote$/);
      expect(t.state()).toBe("pending");
      expect(await readCorrections(t.dir)).toEqual([]);
    } finally { await t.dispose(); }
  });

  it("refuses a decision whose line is already written, recording no correction", async () => {
    // Task 9 review: approve commits before its transaction, so a refused or crashed approve can leave the line on
    // orca/<g> while the item is still pending. Rejecting it would contradict the ledger.
    const t = await landedWithPending(); try {
      const approve = t.h.command("approve-pending-decision", { pendingId: t.pendingId, undoHow: `git revert --no-edit ${"e".repeat(40)}` });
      expect(await prepareApproval(t.h.store, controlWorkspaceRoots(t.h.store.stateDir), t.repo, approve)).toMatchObject({ kind: "committed" });
      expect(t.state()).toBe("pending");
      const r = await t.reject({ pendingId: t.pendingId });
      // Mutation "skip findDecision in reject": the correction is recorded and the item rejected -> red.
      expect({ error: (r as { error?: { code: string; message: string } }).error, rows: await readCorrections(t.dir), state: t.state() }).toEqual({
        error: expect.objectContaining({ code: "pending-decision-settled", message: `pending-decision-settled:decision-recorded:${t.runId}/agent-0@group-branch` }),
        rows: [], state: "pending",
      });
    } finally { await t.dispose(); }
  });

  it("refuses an unknown item, an approved one, and a panel with no corrections store, by name", async () => {
    const t = await landedWithPending(); try {
      expect(await t.reject({ pendingId: "pending-nope-0" })).toMatchObject({ error: { code: "pending-decision-not-found" } });
      expect(await t.reject({ pendingId: t.pendingId }, undefined, t.serviceAs(null))).toMatchObject({ error: { code: "corrections-store-unconfigured" } });
      expect(await t.reject({ pendingId: t.pendingId }, undefined, t.serviceAs(BY, null))).toMatchObject({ error: { code: "corrections-store-unconfigured" } });
      t.h.store.db.prepare("UPDATE pending_decisions SET state='approved' WHERE id=?").run(t.pendingId);
      expect(await t.reject({ pendingId: t.pendingId })).toMatchObject({ error: { code: "pending-decision-settled" } });
      expect(await readCorrections(t.dir)).toEqual([]);
    } finally { await t.dispose(); }
  });
});

useSocketPanels();

const commandIds = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};

describe("rejecting a pending decision is an owner's (control run decisions Task 10)", () => {
  it("refuses reject from an agent with the human-only code", async () => {
    const w = await workspace();
    execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" } });
    const panel = await boot(w, [], { port: true });
    seedUser(controlRoot(w.env), "amy", "member");
    const amy = await login(panel.url, "amy");
    const route = "/api/control/groups/g/decisions/reject";
    const payload = { pendingId: "pending-run-x-0", because: "no" };
    const socket = await overSocket((panel as StartedPanel).socketPath!, "POST", route, { "x-orca-client": "cli:test" }, { commandId: "rd-a", expectedRevision: 0, payload });
    const member = await amy.fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "rd-m", expectedRevision: 0, payload }) });
    // One assertion over both principals (mutation: VERB_ACCESS "any" -> both red).
    expect({
      socketAgent: [socket.status, JSON.parse(socket.text).error.code],
      webMember: [member.status, ((await member.json()) as { error: { code: string } }).error.code],
    }).toEqual({ socketAgent: [403, "control-verb-human-only"], webMember: [403, "control-verb-human-only"] });
    expect(commandIds(w.state).filter((id) => id.startsWith("rd-"))).toEqual([]);
    // The route is the verb's: an owner's is routed to the service, refused there by name and booked.
    const owner = await sessionFor(panel, w.env);
    const routed = await owner.fetch("/api/control/groups/nogroup/decisions/reject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "rd-o", expectedRevision: 0, payload }) });
    expect([routed.status, ((await routed.json()) as { error: { code: string } }).error.code]).toEqual([404, "group-not-found"]);
    expect(commandIds(w.state)).toContain("rd-o");
    // Review fix 1: the panel hands its corrections store and identity to the service (server.ts -> assembly ->
    // WebServiceDeps). A group with a plan repository reaches prepareRejection, which answers an unknown item by name;
    // without the plumbing the answer is corrections-store-unconfigured.
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(join(w.state, "control.sqlite"));
    try {
      db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('pg',0,1,?)").run(JSON.stringify({ groupId: "pg", plan: { repoId: controlRepoKey("proj") } }));
    } finally { db.close(); }
    const planned = await owner.fetch("/api/control/groups/pg/decisions/reject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "rd-p", expectedRevision: 0, payload }) });
    expect([planned.status, ((await planned.json()) as { error: { code: string } }).error.code]).toEqual([404, "pending-decision-not-found"]);
  });
});
