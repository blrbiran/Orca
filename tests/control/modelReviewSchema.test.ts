import { describe, expect, it } from "vitest";
import { flagDecision, listFlagsInvolving, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { readAgentPreferences } from "../../src/control/agentPreferences.js";
import { systemDebugGroupId } from "../../src/control/systemDebug.js";
import { WebControlService } from "../../src/control/webService.js";
import { operatorPreferencesSchema, ratifyFlaggedDecisionPayloadSchema, systemDebugSourceSchema } from "../../src/control/webProtocol.js";
import { readGroupDecisionsView } from "../../src/panel/groupDecisions.js";
import { checksWorld } from "./fixtures/checksWorld.js";

/**
 * Checks spec 2026-10-22 §6.1, §6.6 (plan Task 7): the schema the model review needs. A review has no single source
 * group, so the system debug source becomes a union on `kind`; the three existing kinds keep their bytes and their ids
 * (a group opened before this change is still found by its id). A review's id carries its runSeq, so a retry after an
 * errored attempt is a new group, never the errored one. A finding's flag is keyed to the review group but listed on
 * every involved group; a minor one is shown, not counted (P5); a dismissal keeps the person's reason.
 */
const SHA = (c: string) => c.repeat(40);

describe("system debug sources", () => {
  it("parses the three existing kinds unchanged and keeps their ids (golden ids from before the union)", () => {
    const golden: Array<[unknown, string]> = [
      [{ kind: "ladder", groupId: "g1", taskId: "t1", runId: "r1" }, "sysdebug-ladder-da3a478c44e2de6b"],
      [{ kind: "integration-check", groupId: "g2", taskId: null, runId: "check-1" }, "sysdebug-integration-check-76e21a4518b3dfe2"],
      [{ kind: "criteria-review", groupId: "g3", taskId: "t3", runId: "r3" }, "sysdebug-criteria-review-e856348aaa25918a"],
    ];
    for (const [source, id] of golden) {
      expect(systemDebugSourceSchema.parse(source)).toEqual(source);
      expect(systemDebugGroupId(systemDebugSourceSchema.parse(source))).toBe(id);
    }
  });

  it("names a review sysreview-<16 hex>, distinct per runSeq; a finding's fix sysfinding-<16 hex>", () => {
    const review = (runSeq: number) => systemDebugSourceSchema.parse({ kind: "model-review", repoId: "repo", target: "main", from: SHA("a"), to: SHA("b"), runSeq });
    const first = systemDebugGroupId(review(1)), retry = systemDebugGroupId(review(2));
    expect(first).toMatch(/^sysreview-[a-f0-9]{16}$/);
    expect(retry).toMatch(/^sysreview-[a-f0-9]{16}$/);
    expect(retry).not.toBe(first);
    expect(systemDebugGroupId(review(1))).toBe(first);
    const finding = systemDebugGroupId(systemDebugSourceSchema.parse({ kind: "model-review-finding", repoId: "repo", reviewGroupId: first, findingId: "drift-1" }));
    expect(finding).toMatch(/^sysfinding-[a-f0-9]{16}$/);
    // Strict: a review source never carries a groupId; an unknown kind is refused.
    expect(systemDebugSourceSchema.safeParse({ kind: "model-review", repoId: "repo", target: "main", from: SHA("a"), to: SHA("b"), runSeq: 1, groupId: "g" }).success).toBe(false);
    expect(systemDebugSourceSchema.safeParse({ kind: "review", groupId: "g", taskId: null, runId: null }).success).toBe(false);
  });
});

describe("model-review flags", () => {
  it("lists a finding's flag on every involved group; a minor one is listed but not counted; ratify keeps the note", async () => {
    const w = await checksWorld(); try {
      const { h } = w;
      for (const id of ["review", "g1", "g2", "g3"]) w.land(id);
      const at = new Date(w.now()).toISOString();
      h.store.transaction(() => {
        flagDecision(h.store, { decisionId: "model-review:review:major-1", groupId: "review", runId: null, source: "model-review", reason: "two error shapes", evidence: ["a.ts:3"], by: "orca-auto", at, severity: "major", involvedGroupIds: ["g1", "g2"] });
        flagDecision(h.store, { decisionId: "model-review:review:minor-1", groupId: "review", runId: null, source: "model-review", reason: "duplicate helper", evidence: ["b.ts:9"], by: "orca-auto", at, severity: "minor", involvedGroupIds: ["g1", "g3"] });
      });
      expect(listFlagsInvolving(h.store, "g1").map((row) => [row.decisionId, row.severity, row.groupId])).toEqual([["model-review:review:major-1", "major", "review"], ["model-review:review:minor-1", "minor", "review"]]);
      expect(listFlagsInvolving(h.store, "g3").map((row) => row.decisionId)).toEqual(["model-review:review:minor-1"]);
      expect(listFlagsInvolving(h.store, "review")).toEqual([]);
      // The involved group's decisions view lists both; only the major one counts as waiting.
      const g1 = await readGroupDecisionsView(h.store, w.repo, "g1");
      expect(g1.groupFlags.map((flag) => [flag.decisionId, flag.severity, flag.ownerGroupId])).toEqual([["model-review:review:major-1", "major", "review"], ["model-review:review:minor-1", "minor", "review"]]);
      expect(g1.flaggedCount).toBe(1);
      const g3 = await readGroupDecisionsView(h.store, w.repo, "g3");
      expect([g3.groupFlags.length, g3.flaggedCount]).toEqual([1, 0]);
      // The review group itself counts its major flag only, too.
      expect((await readGroupDecisionsView(h.store, w.repo, "review")).flaggedCount).toBe(1);
      // Dismissal: ratify on the review group with a note, kept beside ratifiedBy.
      expect(ratifyFlaggedDecisionPayloadSchema.parse({ decisionId: "x", note: "both shapes are intended" })).toEqual({ decisionId: "x", note: "both shapes are intended" });
      const service = new WebControlService({ ...h.deps });
      const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='review'").get()!.revision);
      expect(service.ratifyFlaggedDecision(h.rawCommand("dismiss-1", revision, "ratify-flagged-decision", { kind: "group", groupId: "review" }, { decisionId: "model-review:review:major-1", note: "both shapes are intended" }) as never))
        .toMatchObject({ result: { kind: "flagged-decision-ratified" } });
      expect(readFlaggedDecision(h.store, "model-review:review:major-1")).toMatchObject({ state: "ratified", ratifiedBy: "human", note: "both shapes are intended" });
      expect((await readGroupDecisionsView(h.store, w.repo, "g1")).flaggedCount).toBe(0);
    } finally { await w.h.dispose(); }
  });

  it("a flag with no severity is major (today's meaning), and the card counts exclude minor flags", async () => {
    const w = await checksWorld(); try {
      const { h } = w;
      w.land("g1");
      const at = new Date(w.now()).toISOString();
      h.store.transaction(() => {
        flagDecision(h.store, { decisionId: "d-plain", groupId: "g1", runId: null, source: "reconcile", reason: "r", evidence: [], by: "orca-auto", at });
        flagDecision(h.store, { decisionId: "d-minor", groupId: "g1", runId: null, source: "model-review", reason: "r", evidence: [], by: "orca-auto", at, severity: "minor", involvedGroupIds: ["g1", "g"] });
      });
      expect(readFlaggedDecision(h.store, "d-plain")?.severity).toBe("major");
      const summary = (await import("../../src/panel/controlViews.js")).groupCardFlaggedCount(h.store, "g1");
      expect(summary).toBe(1);
    } finally { await w.h.dispose(); }
  });
});

describe("the review agent slot", () => {
  it("accepts a review selection in the operator's preferences and round-trips it through set-agent-preferences", async () => {
    const w = await checksWorld(); try {
      const { h } = w;
      expect(operatorPreferencesSchema.parse({ perAgent: {}, review: { agent: "codex", model: "gpt-5" } })).toEqual({ perAgent: {}, review: { agent: "codex", model: "gpt-5" } });
      const service = new WebControlService({ ...h.deps });
      const send = (id: string, revision: number) => service.setAgentPreferences(h.rawCommand(id, revision, "set-agent-preferences", { kind: "operator", operatorId: "human" }, { preferences: { perAgent: {}, review: { agent: "codex" } } }) as never);
      // The operator scope's revision is the ledger's (the stale answer names it).
      const stale = await send("prefs-0", 0) as { error?: { commandRevision?: number } };
      const answer = await send("prefs-1", stale.error?.commandRevision ?? 0);
      expect(answer).toMatchObject({ result: { kind: "agent-preferences-set" } });
      expect(readAgentPreferences(h.store, "human").preferences).toEqual({ perAgent: {}, review: { agent: "codex" } });
    } finally { await w.h.dispose(); }
  });
});
