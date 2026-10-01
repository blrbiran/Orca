import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { normalizeControlPlan } from "../../src/control/planImport.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { CLARIFY_PROMPT_HEAD } from "../../src/control/requirementClarify.js";
import { readDraft, readRequirementGroup, readRound } from "../../src/control/requirementRecords.js";
import { SPLIT_PROMPT_HEAD } from "../../src/control/requirementSplit.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { readWebGroup } from "../../src/control/webService.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";
import { ccloopWorlds, g, noBlocked, raw, realBinary, until, workRuns } from "./fixtures/ccloopWorld.js";
import { INVALID_SPLIT, ROUND_ONE, ROUND_TWO, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * N1 spec §12.3 against the real ccloop build (ORCA_CCLOOP_BIN, which must contain ccloop's plan Task C1) with its
 * CLI-level fake claude (single calls from a queue) and fake codex (the tasks): open -> two rounds -> consensus ->
 * draft 1 invalid, automatic retry -> valid -> accept -> import -> export -> estimate -> confirm -> start -> land on
 * orca/<groupId>, and the landed history contains the document commit.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-requirement-e2e-", epochPrefix: "epoch-requirement-e2e-" });
afterAll(removeRoots);
const CODEX = { exporter: { files: { "src/export.ts": "export const exported = true;\n" } }, images: { files: { "src/images.ts": "export const images = true;\n" } } };
const estimateFor = (planHash: string) => ({ schema: "budget-estimate-v1", planHash, groupRationale: "two small tasks",
  goalReviewReserve: { tokens: 50_000, activeMs: 60_000, attempts: 1, sessions: 1 },
  tasks: ["exporter", "images"].map((taskId) => ({ taskId, complexity: "S", confidence: "high", work: { tokens: 180_000, activeMs: 200_000, attempts: 1, sessions: 1 },
    handoff: { tokens: 10_000, activeMs: 30_000, attempts: 0, sessions: 0 }, rationale: "one new file", assumptions: ["the file does not exist yet"] })) });
const answerAll = (runtime: ControlRuntime, roundNo: number, commandId: string) => {
  const result = readRound(runtime.store, "g", roundNo).result!;
  return runtime.service.answerRequirement(raw(runtime, commandId, "requirement-answer", { roundNo,
    answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) }));
};
/**
 * Preflight ruling PR-I10: the estimate's queue entry is written before the accept that queues the estimate, so the
 * running pump can never claim it first. Its answer must echo the plan hash the accept will archive, which is known
 * only from the draft -- derived here the way requirement-draft-accept derives it (requirementCommands.ts), and checked
 * against the archive right after the accept, so a divergence is red there and not a timeout.
 */
const planHashOfDraft = (runtime: ControlRuntime, draftNo: number): string => {
  const stored = readDraft(runtime.store, "g", draftNo).plan as { targetRepo: string };
  return sha256Canonical(normalizeControlPlan({ ...schedulerControlPlanSourceOf(stored, stored.targetRepo), repoId: readRequirementGroup(runtime.store, "g").requirement.repoId, planId: `requirement-draft-${draftNo}` }));
};

describe("a requirement from idea to landed work, against real ccloop (N1 spec §12.3)", { timeout: 420_000 }, () => {
  relocateHome("orca-requirement-e2e-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("lands both tasks on orca/<groupId> on top of the requirement document's commit", async () => {
    const w = await world([], CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    await mkdir(join(w.repo, "src"));
    await writeFile(join(w.repo, "README.md"), "# Notes\nA note-taking tool.\n");
    await writeFile(join(w.repo, "src", "a.ts"), "export const a = 1;\n");
    g(w.repo, "add", "-A"); g(w.repo, "commit", "-qm", "notes");
    const queue = [
      { match: CLARIFY_PROMPT_HEAD, output: ROUND_ONE }, { match: CLARIFY_PROMPT_HEAD, output: ROUND_TWO },
      { match: SPLIT_PROMPT_HEAD, output: INVALID_SPLIT }, { match: SPLIT_PROMPT_HEAD, output: VALID_SPLIT },
    ];
    await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call-queue": queue }));
    const runtime = await w.boot();
    try {
      const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
        { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }));
      expect("error" in prefs ? prefs.error : "set").toBe("set");
      const opened = await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
        target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: w.repoId, idea: "Let people export their notes as Markdown.", contentLanguage: "en" } } as never);
      expect(opened).toMatchObject({ result: { kind: "requirement-opened" } });
      runtime.startPump(50);
      await until(() => readRound(runtime.store, "g", 1).state === "awaiting-answers", 90_000, "round 1", 50);
      answerAll(runtime, 1, "answer-1");
      await until(() => readRound(runtime.store, "g", 2).state === "awaiting-answers", 90_000, "round 2", 50);
      expect(answerAll(runtime, 2, "answer-2")).toMatchObject({ result: { nextRoundNo: null } });
      expect(runtime.service.requirementConsensus(raw(runtime, "consensus", "requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { draftNo: 1 } });
      await until(() => { try { return readDraft(runtime.store, "g", 2).state === "awaiting-review"; } catch { return false; } }, 90_000, "draft 2", 50);
      expect(readDraft(runtime.store, "g", 1)).toMatchObject({ state: "invalid", reasons: ["path:exporter:missing/dir/x.ts"] });
      const usedBeforeAccept = readWebGroup(runtime.store, "g").used;
      // Four single calls (two rounds, two drafts), each booked as fake claude's 12 input + 3 output tokens.
      expect(usedBeforeAccept.tokens).toBe(4 * 15);
      const planHash = planHashOfDraft(runtime, 2);
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call-queue": [...queue, { match: "budget-estimate-request-v1", output: estimateFor(planHash) }] }));
      const accepted = await runtime.service.acceptRequirementDraft(raw(runtime, "accept", "requirement-draft-accept", { draftNo: 2, draftHash: readDraft(runtime.store, "g", 2).draftHash! }));
      expect(accepted).toMatchObject({ result: { kind: "requirement-draft-accepted", estimateState: "queued" } });
      expect(readArchivedPlan(runtime.store, "g").planHash).toBe(planHash);
      // N1 spec §9.1: the clarifying spend is carried over unchanged.
      expect(readWebGroup(runtime.store, "g").used).toEqual(usedBeforeAccept);
      const estimateId = (accepted as { result: { estimateId: string } }).result.estimateId;
      await until(() => readEstimateRecord(runtime.store, "g", estimateId).state === "ready" && readRequirementGroup(runtime.store, "g").requirement.export.state === "done", 120_000, "the estimate and the export", 50);
      const requirement = readRequirementGroup(runtime.store, "g").requirement;
      const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
      const profile = runtime.router.list()[0]!, hash = profile.profileHash;
      const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", { planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
        budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: profile.snapshot.profile.capabilities.contextWindowTokens }, selectionsHash: selections.selectionsHash }));
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      const started = await runtime.service.start(raw(runtime, "start", "start", {}));
      expect("error" in started ? started.error : "started").toBe("started");
      await until(() => { noBlocked(runtime); return ["exporter", "images"].every((taskId) => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status === "done")
        && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 300_000, "both tasks to land", 100);
      // The landed history: main, then the document commit, then the landings.
      const firstOnBranch = g(w.repo, "rev-list", "--reverse", "--first-parent", "main..refs/heads/orca/g").split("\n")[0];
      expect(firstOnBranch).toBe(requirement.export.commit);
      expect(g(w.repo, "log", "-1", "--format=%s", firstOnBranch!)).toBe("docs(requirements): markdown-export");
      const text = (JSON.parse(readCanonicalRecord(runtime.store, requirement.document!.recordHash)) as { text: string }).text;
      expect(createHash("sha256").update(w.show(requirement.export.path!) + "\n", "utf8").digest("hex")).toBe(requirement.document!.sha256);
      expect(w.show(requirement.export.path!)).toBe(text.trimEnd());
      expect(w.show("src/export.ts")).toBe("export const exported = true;");
      expect(w.show("src/images.ts")).toBe("export const images = true;");
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
