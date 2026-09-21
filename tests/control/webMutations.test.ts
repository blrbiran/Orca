/**
 * Task 10 step 3: guards that have to fail when the invariant they protect is inverted.
 *
 * A green suite only proves the happy path is wired up. These tests therefore attack the ledger
 * from underneath -- corrupting a row the way a bug or a hostile process would, or sending the
 * exact envelope a lost answer would make a client replay -- and require the code to *notice*.
 * Every deliberate mutation is undone in the same test, because the point is that the guard, not
 * the fixture, is what rejects it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readBudgetProposal } from "../../src/control/queries.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { lookupCommandResult, lookupWebCommandReplay } from "../../src/control/commandLedger.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { ControlError } from "../../src/control/errors.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { GROUP, command, createHarness, revision } from "../panel/fixtures/controlPanel.js";
import type { ControlStore } from "../../src/control/store.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

type SqlArg = string | number | bigint | null | Buffer;
const row = (store: ControlStore, sql: string, ...args: SqlArg[]) => store.db.prepare(sql).get(...args) as Record<string, unknown>;
const mutate = (store: ControlStore, sql: string, ...args: SqlArg[]) => store.db.prepare(sql).run(...args);
const proposalBody = (store: ControlStore): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM budget_proposals WHERE group_id=?").get("g")!.body)) as Record<string, unknown>;
const editTokens = (tokens: number) => ({ baseProposalVersion: 1, operations: [{ target: { scope: "goal-review" as const, dimension: "tokens" as const }, value: tokens, provenance: "human" as const }] });

/** A confirmed group with one ready task; the caller claims it when the test needs a run. */
async function ready(budgetMode: "strict" | "soft" = "strict") {
  const f = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const service = new WebControlService(f.deps);
  const confirmed = service.confirm(f.command("confirm", { ...f.confirmPayload(), budgetMode }));
  if ("error" in confirmed) throw new Error("confirm refused: " + confirmed.error.code);
  const deps = { store: f.store, profileRouter: f.deps.profileRouter, admissionGate: f.deps.admissionGate };
  return { f, service, deps, capable: () => f.setObserved({ ...f.frozen.snapshot.profile.capabilities }), unproven: () => f.setObserved({ ...f.frozen.snapshot.profile.capabilities, requestBoundProof: null }) };
}

const zero = () => ({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });

describe("inverted invariants (task 10 step 3)", () => {
  it("refuses a recorded answer whose request identity has been inverted, and serves it again once restored", async () => {
    const f = await webFixture();
    try {
      const service = new WebControlService(f.deps);
      const command = f.command("proposal-edit", editTokens(123_456), "identity-edit");
      service.editProposal(command);
      const stored = String(row(f.store, "SELECT raw_request_hash AS v FROM commands WHERE group_id='g' AND id='identity-edit'").v);
      expect(lookupCommandResult(f.store, "g", "identity-edit")?.originalStatus).toBe(200);

      // A row whose named hash is no longer the hash of the request it answers must not be
      // allowed to vouch for that request: the replay becomes a conflict, not a cached 200.
      mutate(f.store, "UPDATE commands SET raw_request_hash=? WHERE group_id='g' AND id='identity-edit'", sha256Canonical({ forged: true }));
      expect(() => lookupWebCommandReplay(f.store, command)).toThrow("command-id-conflict");
      mutate(f.store, "UPDATE commands SET raw_request_hash=? WHERE group_id='g' AND id='identity-edit'", stored);
      expect(() => lookupWebCommandReplay(f.store, command)).not.toThrow();
      expect(lookupCommandResult(f.store, "g", "identity-edit")?.originalStatus).toBe(200);
    } finally { await f.dispose(); }
  });

  it("gives the stale revision precedence over the second tab's write, durably and without a second effect", async () => {
    const f = await webFixture();
    try {
      const service = new WebControlService(f.deps);
      // Both tabs read the same revision; only one of them can be the next write.
      const first = f.command("proposal-edit", editTokens(111_111), "tab-one");
      const stale = f.command("proposal-edit", editTokens(222_222), "tab-two");
      service.editProposal(first);
      const after = proposalBody(f.store);
      const refused = service.editProposal(stale);
      expect("error" in refused).toBe(true);
      if ("error" in refused) expect(refused.error.code).toBe("revision-conflict");
      expect(proposalBody(f.store)).toEqual(after);
      // The refusal is itself durable, and its replay is byte-identical: no client retry can
      // turn a lost answer into a second write. One row per commandId -- the third is the
      // fixture's own import -- and the replay adds none.
      expect(countCommands(f.store)).toBe(3);
      const replay = service.editProposal(stale);
      expect(JSON.stringify(replay)).toBe(JSON.stringify(refused));
      expect(countCommands(f.store)).toBe(3);
    } finally { await f.dispose(); }
  });

  it("rejects an out-of-range budget number instead of clamping it into the ledger", async () => {
    const f = await webFixture();
    try {
      const service = new WebControlService(f.deps);
      const before = proposalBody(f.store);
      for (const value of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, Number.NaN]) {
        // The envelope is validated before the ledger is opened, so an out-of-range number never
        // reaches a write -- it is refused by throwing out of command handling, which is exactly
        // what keeps it from being clamped into a safe integer.
        const refused = (): boolean => {
          try {
            return "error" in service.editProposal(f.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value, provenance: "human" }] } as never));
          } catch {
            return true;
          }
        };
        expect(refused(), String(value)).toBe(true);
      }
      expect(proposalBody(f.store)).toEqual(before);
      expect(Number(row(f.store, "SELECT revision AS v FROM groups WHERE id='g'").v)).toBe(1);
    } finally { await f.dispose(); }
  });

  it("gates a strict claim on proof the profile cannot produce, while soft mode keeps claiming", async () => {
    const strict = await ready("strict");
    try {
      // The profiles were capable when the start was accepted, so the degradation is found by the
      // dispatcher -- which is the only place a strict group's missing proof becomes a blocker.
      await strict.service.start(strict.f.command("start", {}));
      strict.unproven();
      expect((await deliverScheduledStart(strict.deps, "g")).kind).toBe("blocked");
      expect(String(row(strict.f.store, "SELECT code AS v FROM recovery_blockers WHERE group_id='g'").v)).toBe("claim-capability-unavailable");
      expect(countRows(strict.f.store, "runs", "active=1")).toBe(0);
      strict.capable();
      expect((await deliverScheduledStart(strict.deps, "g")).kind).toBe("claimed");
    } finally { await strict.f.dispose(); }

    const soft = await ready("soft");
    try {
      await soft.service.start(soft.f.command("start", {}));
      soft.unproven();
      expect((await deliverScheduledStart(soft.deps, "g")).kind).toBe("claimed");
    } finally { await soft.f.dispose(); }
  });

  it("keeps a run whose usage went unknown booked to its reserve rather than quietly releasing it", async () => {
    const { f, deps, service } = await ready("soft");
    try {
      await service.start(f.command("start", {}));
      const runId = String((await deliverScheduledStart(deps, "g") as { runId: string }).runId);
      const before = JSON.stringify(readBudgetProposal(f.store, "g"));
      const initial = readControlGroup(f.store, "epoch", "g");
      const reserveBefore = initial.ledger.committedRemaining;
      const grantBefore = initial.runs.find((run) => run.runId === runId)!.remaining;
      const body = JSON.parse(String(row(f.store, "SELECT body AS v FROM runs WHERE id=?", runId).v)) as Record<string, unknown>;
      // Usage went unknown, and someone tried to release the grant it was booked against: an
      // unaccounted run may not have its money moved back to the reserve.
      const released = { ...body, unknown: { work: true, handoff: true }, remaining: { work: zero(), handoff: zero() } };
      mutate(f.store, "UPDATE runs SET body=? WHERE id=?", JSON.stringify(released), runId);
      expect(() => readControlGroup(f.store, "epoch", "g")).toThrow(ControlError);
      mutate(f.store, "UPDATE runs SET body=? WHERE id=?", JSON.stringify({ ...body, unknown: { work: true, handoff: true } }), runId);
      const view = readControlGroup(f.store, "epoch", "g");
      // Unknown usage keeps the grant booked against the run: the view still reports the same
      // remaining amount and the same committed reserve, so clearing it later has to be a
      // decision a person makes rather than a subtraction the projection performs on its own.
      expect(view.runs.find((run) => run.runId === runId)!.remaining).toEqual(grantBefore);
      expect(view.ledger.committedRemaining).toEqual(reserveBefore);
      expect(JSON.stringify(readBudgetProposal(f.store, "g"))).toBe(before);
      mutate(f.store, "UPDATE runs SET body=? WHERE id=?", canonicalBytes(body).toString("utf8"), runId);
      expect(() => readControlGroup(f.store, "epoch", "g")).not.toThrow();
    } finally { await f.dispose(); }
  });

  it("holds exactly one context latch per run generation, whatever reason a writer claims", async () => {
    const { f, deps, runId } = await (async () => {
      const r = await ready("soft");
      await r.service.start(r.f.command("start", {}));
      const id = String((await deliverScheduledStart(r.deps, "g") as { runId: string }).runId);
      return { ...r, runId: id };
    })();
    try {
      const generation = Number(row(f.store, "SELECT generation AS v FROM runs WHERE id=?", runId).v);
      mutate(f.store, "INSERT INTO context_latches VALUES (?,?,?,?)", runId, generation, "context-threshold-crossed", null);
      expect(f.store.db.prepare("SELECT COUNT(*) AS n FROM context_latches").get()!.n).toBe(1);
      // The latch is keyed by (run, generation): a second reason for the same generation is a
      // contradiction about whether this context may still call a provider, not a new fact.
      expect(() => mutate(f.store, "INSERT INTO context_latches VALUES (?,?,?,?)", runId, generation, "context-observation-gap", null)).toThrow(/UNIQUE|PRIMARY/i);
      expect(() => mutate(f.store, "INSERT INTO context_latches VALUES (?,?,?,?)", runId, generation, "context-guess", null)).toThrow(/CHECK/i);
      expect(f.store.db.prepare("SELECT COUNT(*) AS n FROM context_latches").get()!.n).toBe(1);
    } finally { await f.dispose(); }
  });

  it("strengthens a stop intent but never weakens it, whichever order the tabs click in", async () => {
    const { f, service } = await ready("soft");
    try {
      await service.start(f.command("start", {}));
      expect("error" in service.pauseDispatch(f.command("pause-dispatch", {}, "pause-first"))).toBe(false);
      expect(String(row(f.store, "SELECT mode AS v FROM stop_intents WHERE group_id='g'").v)).toBe("pause");
      expect("error" in await service.handoffStop(f.command("handoff-stop", {}, "to-handoff"))).toBe(false);
      expect(String(row(f.store, "SELECT mode AS v FROM stop_intents WHERE group_id='g'").v)).toBe("handoff");
      // A pause that arrives afterwards cannot un-latch a handoff someone already asked for.
      // A pause that arrives afterwards cannot un-latch a handoff someone already asked for:
      // it is refused, not silently downgraded.
      const weaker = await service.pauseDispatch(f.command("pause-dispatch", {}, "pause-second"));
      expect("error" in weaker ? weaker.error.code : "applied").toBe("stop-mode-conflict");
      expect(String(row(f.store, "SELECT mode AS v FROM stop_intents WHERE group_id='g'").v)).toBe("handoff");
    } finally { await f.dispose(); }
  });

  it("registers a continuation for all of a batch or none of it", async () => {
    const { f, deps, service } = await ready("soft");
    try {
      await service.start(f.command("start", {}));
      const runId = String((await deliverScheduledStart(deps, "g") as { runId: string }).runId);
      await service.handoffStop(f.command("handoff-stop", {}, "stop-for-continue"));
      const predecessor = f.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: runId, checkpointId: "cp-missing" }] }, "continue-missing");
      const refused = await service.resumeFromHandoff(predecessor);
      expect("error" in refused).toBe(true);
      expect(String(JSON.parse(String(row(f.store, "SELECT body AS v FROM work_items WHERE group_id='g' AND id='a'").v)).pendingRunId)).toBe("null");
      expect(f.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE kind='resume'").get()!.n).toBe(0);
    } finally { await f.dispose(); }
  });

  it("refuses to project a change sequence that has been moved backwards, and recovers once it is restored", async () => {
    const f = await webFixture();
    try {
      const state = row(f.store, "SELECT change_seq AS seq, oldest_retained_seq AS old FROM projection_state WHERE singleton=1");
      const before = Number(row(f.store, "SELECT revision AS v FROM groups WHERE id='g'").v);
      mutate(f.store, "UPDATE projection_state SET change_seq=0, oldest_retained_seq=0 WHERE singleton=1");
      expect(() => new WebControlService(f.deps).editProposal(f.command("proposal-edit", editTokens(321_321), "rewound-edit"))).toThrow();
      expect(Number(row(f.store, "SELECT revision AS v FROM groups WHERE id='g'").v)).toBe(before);
      expect(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE id='rewound-edit'").get()!.n).toBe(0);
      mutate(f.store, "UPDATE projection_state SET change_seq=?, oldest_retained_seq=? WHERE singleton=1", Number(state.seq), Number(state.old));
      expect("error" in new WebControlService(f.deps).editProposal(f.command("proposal-edit", editTokens(321_321), "rewound-edit"))).toBe(false);
      expect(Number(row(f.store, "SELECT revision AS v FROM groups WHERE id='g'").v)).toBe(before + 1);
    } finally { await f.dispose(); }
  });

  it("offers no route that skips a checkpoint, releases usage or kills a run in place", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-no-kill", paths);
    try {
      await command(panel, "/api/control/groups/import-plan", { commandId: "guard-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
      expect(await revision(panel)).toBeGreaterThan(0);
      const before = await revision(panel);
      for (const path of [
        `/api/control/groups/${GROUP}/skip-usage`, `/api/control/groups/${GROUP}/force-complete`,
        `/api/control/runs/run-1/kill`, `/api/control/runs/run-1/mark-checkpointed`,
        `/api/control/recovery/trust`, `/api/control/groups/${GROUP}/reset-ledger`,
      ]) {
        const refused = await command(panel, path, { commandId: "guard-attempt", expectedRevision: await revision(panel), payload: {} });
        expect(refused.status).toBe(404);
        expect(refused.body.error).toMatchObject({ code: "route-not-found" });
      }
      // Six refused requests changed nothing: no route exists that writes a fact a browser
      // could not have asked for.
      expect(await revision(panel)).toBe(before);
      // The only sanctioned way through a blocker is the named observation command, and it is
      // itself one durable ledger entry -- not a reset.
      expect((await command(panel, "/api/control/recovery/retry", { commandId: "guard-retry", expectedRevision: await revision(panel), payload: { scope: "group", groupId: GROUP } })).status).toBe(200);
      expect(await revision(panel)).toBe(before + 1);
    } finally { await panel.close(); }
  });
});

function countRows(store: ControlStore, table: string, where: string): number {
  return Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get()!.n);
}

function countCommands(store: ControlStore): number {
  return Number(store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id='g'").get()!.n);
}
