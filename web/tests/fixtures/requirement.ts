/**
 * N1 spec §11.2 (plan Task 13): one requirement, group `r` at revision 3, in the four shapes the Requirements section
 * criteria render. The classified round is ROUND_ONE (tests/control/fixtures/requirementOutputs.ts) as
 * src/control/requirementClarify.ts classifies it for round 1, and the draft is VALID_SPLIT; both are copied literally,
 * since web criteria do not import server code -- except that "file" and "Statement" are i18n values (enums.decisionScope.file,
 * requirements.statement), so the pseudo-locale rule changed those words in the copied data (wording only, same shape).
 */
import type { Amount, ClarifyResultV1, ControlConfigV1, ControlSummaryV1, DraftViewV1, RequirementSummaryV1, RequirementViewV1, RoundBodyV1 } from "../../src/controlTypes.js";

export const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "e-1", repositories: [{ repoId: "repo", displayName: "Repo R" }], plans: [], profiles: [],
  defaults: null, executionPort: "configured", errorCatalog: [],
};

const amount = (tokens: number): Amount => ({ tokens, activeMs: 0, attempts: 0, sessions: 0 });

const ROUND_ONE: ClarifyResultV1 = {
  slug: "markdown-export",
  statement: "People can export a note as Markdown.",
  acceptanceCriteria: [{ id: "AC1", text: "An exported note opens as Markdown." }],
  questions: [
    { id: "R1.Q1", key: "format", question: "Which Markdown flavour?", recommendedAnswer: "CommonMark", why: "Most readers accept it.", dependsOn: [] },
    { id: "R1.Q2", key: "images", question: "Are images exported?", recommendedAnswer: "As links", why: "It keeps one output per note.", dependsOn: ["R1.Q1"] },
  ],
  frontierEmpty: false,
  openBranches: ["sync to a cloud drive"],
  glossary: [{ id: "R1.G1", term: "note", definition: "One page of text a person wrote." }],
  adrs: [{ id: "R1.ADR1", title: "One output per note", context: "Notes are independent.", decision: "Export each note on its own.", consequences: "Many notes make many outputs." }],
};

const VALID_SPLIT: NonNullable<DraftViewV1["output"]> = {
  tasks: [
    { taskId: "exporter", title: "Write the exporter", labels: ["feature"], goal: "Export a note as CommonMark.", successCondition: "src/export.ts exports a note.", targetPaths: ["src/export.ts", "answer.txt"], checks: ["true"], dependsOn: [], traces: ["AC1"] },
    { taskId: "images", title: "Export images as links", labels: ["feature"], goal: "Write images as links.", successCondition: "src/images.ts turns images into links.", targetPaths: ["src/images.ts", "answer.txt"], checks: ["true"], dependsOn: ["exporter"], traces: ["AC2"] },
  ],
  notes: "Two tasks; the second needs the first.",
};

const round = (over: Partial<RoundBodyV1>): RoundBodyV1 => ({
  roundNo: 1, state: "awaiting-answers", retries: 0, lastInvalidReason: null, waiting: null, result: ROUND_ONE, answers: null,
  glossaryDecisions: null, adrDecisions: null, answeredAt: null, closedByConsensus: false, reasonCode: null, calls: [], ...over,
});
const ANSWERED: Partial<RoundBodyV1> = {
  state: "answered",
  answers: [{ id: "R1.Q1", kind: "recommended", text: "CommonMark" }, { id: "R1.Q2", kind: "text", text: "As relative links" }],
  glossaryDecisions: [{ id: "R1.G1", accept: true }], adrDecisions: [{ id: "R1.ADR1", accept: true }], answeredAt: "2026-10-02T10:00:00.000Z",
};

export type RequirementFixtureState = "awaiting-answers" | "answered" | "awaiting-review" | "failed";

export function requirementView(state: RequirementFixtureState): RequirementViewV1 {
  const rounds = state === "awaiting-answers" ? [round({})]
    : state === "failed" ? [round({ state: "failed", result: null, retries: 2, lastInvalidReason: "no-output", reasonCode: "clarify-output-invalid" })]
    : [round({ ...ANSWERED, closedByConsensus: state === "awaiting-review" })];
  const drafts: DraftViewV1[] = state !== "awaiting-review" ? [] : [{
    draftNo: 1, state: "awaiting-review", autoRetry: 0, waiting: null, feedback: null, output: VALID_SPLIT, draftHash: "d".repeat(64), reasons: [],
    layers: [["exporter"], ["images"]], implicitEdges: [{ from: "exporter", to: "images", conflicts: [{ a: "src/**", b: "src/**" }] }], reasonCode: null, calls: [],
  }];
  const last = rounds.at(-1)!;
  const requirement: RequirementSummaryV1 = {
    roundNo: last.roundNo, roundState: last.state, openQuestions: last.state === "awaiting-answers" ? 2 : 0,
    draftNo: drafts.at(-1)?.draftNo ?? null, draftState: drafts.at(-1)?.state ?? null, waiting: null,
    reasonCode: state === "failed" ? "clarify-output-invalid" : null, exportState: "not-due",
    used: amount(120_000), reserved: amount(0), limit: amount(10_000_000), usageUnknown: false, blockedRun: null,
  };
  return {
    schema: "orca-requirement-view-v1", epoch: "e-1", changeSeq: 7,
    summary: { groupId: "r", state: "clarifying", commandRevision: 3, projectionSeq: 7, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0, requirement },
    requirement: {
      requirementId: "req-1", repoId: "repo", slug: state === "failed" ? null : "markdown-export", contentLanguage: "en", createdOn: "2026-10-02",
      idea: "Let people take a note out as Markdown.",
      consensus: state === "awaiting-review" ? { roundNo: 1, at: "2026-10-02T11:00:00.000Z", openBranches: ["sync to a cloud drive"], openQuestions: [] } : null,
      acceptedDraftNo: null, document: null, export: { state: "not-due", path: null, commit: null, parent: null, detail: null },
    },
    ledger: { limit: amount(10_000_000), used: amount(120_000), reserved: amount(0), usageUnknown: false },
    rounds, drafts,
    document: "# markdown-export\n\nPeople can export a note as Markdown.\n",
  };
}

export function summaryWith(view: RequirementViewV1): ControlSummaryV1 {
  return { schema: "orca-control-summary-v1", epoch: view.epoch, changeSeq: view.changeSeq, resetRequired: false, dispatchBlocked: false, groups: [view.summary] };
}
