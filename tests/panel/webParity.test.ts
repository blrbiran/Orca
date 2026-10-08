import { describe, expect, it } from "vitest";
import type { PanelCoverage as ServerPanelCoverage } from "../../src/panel/coverage.js";
import type { DecisionListRow as ServerDecisionListRow } from "../../src/panel/listProjection.js";
import { LIST_FIELDS } from "../../src/panel/listProjection.js";
import type { MetricsReport as ServerMetricsReport } from "../../src/metrics/types.js";
import { METRICS_FIELDS } from "../../src/metrics/types.js";
import type { CorrectionKind as ServerCorrectionKind } from "../../src/corrections/schema.js";
import type {
  CorrectionKind as WebCorrectionKind,
  DecisionListRow as WebDecisionListRow,
  MetricsReport as WebMetricsReport,
  PanelCoverage as WebPanelCoverage,
} from "../../web/src/types.js";
import { WEB_CORRECTION_KINDS, WEB_LIST_FIELDS, WEB_REPORT_FIELDS } from "../../web/src/types.js";
import { CORRECTION_KINDS } from "../../src/corrections/schema.js";
import { CUSTOM_LABEL_PREFIX, SYSTEM_LABELS } from "../../src/control/labels.js";
import { CUSTOM_LABEL_PREFIX as WEB_CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS, WEB_WORK_ITEM_CATEGORIES } from "../../web/src/controlTypes.js";
import { WORK_ITEM_CATEGORIES } from "../../src/control/workItemCategory.js";
import type {
  AgentPreferencesViewV1 as ServerAgentPreferencesViewV1,
  AgentSelectionPreviewV1 as ServerAgentSelectionPreviewV1,
  AgentsViewV1 as ServerAgentsViewV1,
  CommandEnvelopeV1 as ServerCommandEnvelopeV1,
  CommandErrorV1 as ServerCommandErrorV1,
  CommandLookupV1 as ServerCommandLookupV1,
  CommandSuccessV1 as ServerCommandSuccessV1,
  ConfirmPayload as ServerConfirmPayload,
  ContinueTaskPayload as ServerContinueTaskPayload,
  ControlConfigV1 as ServerControlConfigV1,
  ControlSummaryV1 as ServerControlSummaryV1,
  EvidenceManifestV1 as ServerEvidenceManifestV1,
  GroupViewV1 as ServerGroupViewV1,
  HandoffStopPayload as ServerHandoffStopPayload,
  ImportPlanPayload as ServerImportPlanPayload,
  ProposalEditPayload as ServerProposalEditPayload,
  ProposalSetAgentPayload as ServerProposalSetAgentPayload,
  RecoveryRetryPayload as ServerRecoveryRetryPayload,
  RecoveryViewV1 as ServerRecoveryViewV1,
  RetryTaskPayload as ServerRetryTaskPayload,
  ReestimatePayload as ServerReestimatePayload,
  RequirementAnswerPayload as ServerRequirementAnswerPayload,
  RequirementConsensusPayload as ServerRequirementConsensusPayload,
  RequirementDraftAcceptPayload as ServerRequirementDraftAcceptPayload,
  RequirementDraftFeedbackPayload as ServerRequirementDraftFeedbackPayload,
  RequirementOpenPayload as ServerRequirementOpenPayload,
  RequirementViewV1 as ServerRequirementViewV1,
  RunActivityV1 as ServerRunActivityV1,
  ResumeFromHandoffPayload as ServerResumeFromHandoffPayload,
  SetAgentPreferencesPayload as ServerSetAgentPreferencesPayload,
  SetLimitPayload as ServerSetLimitPayload,
  SetTaskLabelsPayload as ServerSetTaskLabelsPayload,
  SetTaskLoopPayload as ServerSetTaskLoopPayload,
  UsageViewV1 as ServerUsageViewV1,
} from "../../src/control/webProtocol.js";
import type {
  AgentPreferencesViewV1 as WebAgentPreferencesViewV1,
  AgentSelectionPreviewV1 as WebAgentSelectionPreviewV1,
  AgentsViewV1 as WebAgentsViewV1,
  CommandEnvelopeV1 as WebCommandEnvelopeV1,
  CommandErrorV1 as WebCommandErrorV1,
  CommandLookupV1 as WebCommandLookupV1,
  CommandSuccessV1 as WebCommandSuccessV1,
  ConfirmPayloadV1 as WebConfirmPayloadV1,
  ContinueTaskPayloadV1 as WebContinueTaskPayloadV1,
  ControlConfigV1 as WebControlConfigV1,
  ControlSummaryV1 as WebControlSummaryV1,
  EstimatePayloadV1 as WebEstimatePayloadV1,
  EvidenceManifestV1 as WebEvidenceManifestV1,
  GroupViewV1 as WebGroupViewV1,
  HandoffStopPayloadV1 as WebHandoffStopPayloadV1,
  ImportPlanPayloadV1 as WebImportPlanPayloadV1,
  ProposalEditPayloadV1 as WebProposalEditPayloadV1,
  ProposalSetAgentPayloadV1 as WebProposalSetAgentPayloadV1,
  RecoveryRetryPayloadV1 as WebRecoveryRetryPayloadV1,
  RecoveryViewV1 as WebRecoveryViewV1,
  RetryTaskPayloadV1 as WebRetryTaskPayloadV1,
  RequirementAnswerPayloadV1 as WebRequirementAnswerPayloadV1,
  RequirementConsensusPayloadV1 as WebRequirementConsensusPayloadV1,
  RequirementDraftAcceptPayloadV1 as WebRequirementDraftAcceptPayloadV1,
  RequirementDraftFeedbackPayloadV1 as WebRequirementDraftFeedbackPayloadV1,
  RequirementOpenPayloadV1 as WebRequirementOpenPayloadV1,
  RequirementViewV1 as WebRequirementViewV1,
  RunActivityV1 as WebRunActivityV1,
  ResumeFromHandoffPayloadV1 as WebResumeFromHandoffPayloadV1,
  SetAgentPreferencesPayloadV1 as WebSetAgentPreferencesPayloadV1,
  SetLimitPayloadV1 as WebSetLimitPayloadV1,
  SetTaskLabelsPayloadV1 as WebSetTaskLabelsPayloadV1,
  SetTaskLoopPayloadV1 as WebSetTaskLoopPayloadV1,
  UsageViewV1 as WebUsageViewV1,
} from "../../web/src/controlTypes.js";

/**
 * task 8 ruling K2. `web/` cannot import `src/` (a browser bundle cannot ship
 * the server's module graph), so it keeps its own copies of the three shapes
 * the panel's UI touches. Parity is enforced from the ROOT side, twice: this
 * file's `it`s below are the RUNTIME half (field-set equality); the bare
 * functions after them are the COMPILE-TIME half -- `npm run typecheck` type
 * -checks this file, so a diverging field on either side fails the build, not
 * a test run. Neither function is ever called: the criterion is that they
 * compile at all.
 *
 * METRICS_FIELDS' own comment says its order is deliberately NOT declaration
 * order, so both sides are sorted before compare -- an order-sensitive
 * equality would be pinning an accident, not the field set.
 */
describe("web/src/types.ts stays in lockstep with the server shapes (task 8 ruling K2)", () => {
  it("WEB_REPORT_FIELDS is the same SET as METRICS_FIELDS", () => {
    expect([...WEB_REPORT_FIELDS].sort()).toEqual([...METRICS_FIELDS].sort());
  });

  it("WEB_LIST_FIELDS is the same SET as LIST_FIELDS", () => {
    expect([...WEB_LIST_FIELDS].sort()).toEqual([...LIST_FIELDS].sort());
  });

  // Final review I-3 / ruling R66: the correction form's `kind` select offers
  // exactly the kinds correctionSchema accepts -- a missing one is a kind the
  // person cannot record, an extra one is a select option the seam refuses.
  it("WEB_CORRECTION_KINDS is the same SET as CORRECTION_KINDS", () => {
    expect([...WEB_CORRECTION_KINDS].sort()).toEqual([...CORRECTION_KINDS].sort());
  });

  // Labels and progress spec §2.1 (plan finding F1): the editor's system-label select offers exactly the vocabulary the
  // server's input doors accept -- a missing word cannot be chosen, an extra one would be refused as labels-invalid.
  it("WEB_SYSTEM_LABELS is the same list as SYSTEM_LABELS, and the custom prefix is the same", () => {
    expect([...WEB_SYSTEM_LABELS]).toEqual([...SYSTEM_LABELS]);
    expect(WEB_CUSTOM_LABEL_PREFIX).toBe(CUSTOM_LABEL_PREFIX);
  });

  // Issue-fixes spec §6.1: the web's category list is the server's table, in order (the graph legend draws it).
  it("WEB_WORK_ITEM_CATEGORIES is the same list as WORK_ITEM_CATEGORIES", () => {
    expect([...WEB_WORK_ITEM_CATEGORIES]).toEqual([...WORK_ITEM_CATEGORIES]);
  });
});

// --- compile-time mutual-assignability checks (never called at runtime) ---

function reportServerToWeb(x: ServerMetricsReport): WebMetricsReport {
  return x;
}
// Rewritten under human ruling H18 (2026-10-01) for panel i18n: the metrics note codes are optional on the Web side so
// literal fixtures need no edit (spec §3.4); an absent code is normalised here, so the rest is still checked both ways.
function reportWebToServer(x: WebMetricsReport): ServerMetricsReport {
  return {
    ...x,
    correction_rate: { ...x.correction_rate, caveatCodes: x.correction_rate.caveatCodes ?? [] },
    repair_rate: {
      ...x.repair_rate,
      caveatCodes: x.repair_rate.caveatCodes ?? [],
      stale_only: { ...x.repair_rate.stale_only, knownBiasCode: x.repair_rate.stale_only.knownBiasCode ?? "stale-bias" },
    },
    review_coverage: { ...x.review_coverage, reasonCode: x.review_coverage.reasonCode ?? "no-review-coverage" },
  };
}
function coverageServerToWeb(x: ServerPanelCoverage): WebPanelCoverage {
  return x;
}
// Rewritten under human ruling H18 (2026-10-01) for panel i18n.
function coverageWebToServer(x: WebPanelCoverage): ServerPanelCoverage {
  return { ...x, caveatCode: x.caveatCode ?? "reviewed-is-deliberate" };
}
function listRowServerToWeb(x: ServerDecisionListRow): WebDecisionListRow {
  return x;
}
function listRowWebToServer(x: WebDecisionListRow): ServerDecisionListRow {
  return x;
}
function correctionKindServerToWeb(x: ServerCorrectionKind): WebCorrectionKind {
  return x;
}
function correctionKindWebToServer(x: WebCorrectionKind): ServerCorrectionKind {
  return x;
}
function controlConfigServerToWeb(x: ServerControlConfigV1): WebControlConfigV1 { return x; }
function controlConfigWebToServer(x: WebControlConfigV1): ServerControlConfigV1 { return x; }
function controlSummaryServerToWeb(x: ServerControlSummaryV1): WebControlSummaryV1 { return x; }
function controlSummaryWebToServer(x: WebControlSummaryV1): ServerControlSummaryV1 { return x; }
function controlGroupServerToWeb(x: ServerGroupViewV1): WebGroupViewV1 { return x; }
// Execution driver spec §7.4: `blockedReason` is optional on the Web side only so the existing
// literal run fixtures in evidenceLink/controlPanel/controlCommandRecovery need no edit (D7's
// zero-rewrite principle); normalize it here so the rest of the shape still gets checked both ways.
// Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): `continuable` is
// optional on the Web side for the same reason as `blockedReason`, and an absent flag reads as "not continuable".
// Agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"; W6-9): a work item's `agent` and
// `agentProvenance` are optional on the Web side for the same reason, and an absent value reads as null. The
// server's new fields still have same-typed mirrors, so assignability is checked both ways as before.
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): plan T14 fix round 1 (wave 3 M-5) adds the
// group's frozen reconcile slot, `agents`, optional on the Web side for the same reason and normalised to
// `{ reconcile: null }` when absent; every other field, and `agents` itself when present, is still checked both ways.
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return { ...x,
    agents: x.agents ?? { reconcile: null },
    runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null, continuable: run.continuable ?? false })),
    workItems: x.workItems.map((item) => ({ ...item, agent: item.agent ?? null, agentProvenance: item.agentProvenance ?? null })) };
}
function recoveryServerToWeb(x: ServerRecoveryViewV1): WebRecoveryViewV1 { return x; }
function recoveryWebToServer(x: WebRecoveryViewV1): ServerRecoveryViewV1 { return x; }
function evidenceServerToWeb(x: ServerEvidenceManifestV1): WebEvidenceManifestV1 { return x; }
function evidenceWebToServer(x: WebEvidenceManifestV1): ServerEvidenceManifestV1 { return x; }
// Issue-fixes spec §5.2: the run-activity read, checked both ways like the evidence manifest.
function runActivityServerToWeb(x: ServerRunActivityV1): WebRunActivityV1 { return x; }
function runActivityWebToServer(x: WebRunActivityV1): ServerRunActivityV1 { return x; }
function commandLookupServerToWeb(x: ServerCommandLookupV1): WebCommandLookupV1 { return x; }
function commandLookupWebToServer(x: WebCommandLookupV1): ServerCommandLookupV1 { return x; }
function commandErrorServerToWeb(x: ServerCommandErrorV1): WebCommandErrorV1 { return x; }
function commandErrorWebToServer(x: WebCommandErrorV1): ServerCommandErrorV1 { return x; }
// Accounts Task 11 (add-only): the Usage panel's read, checked both ways like the other views.
function usageServerToWeb(x: ServerUsageViewV1): WebUsageViewV1 { return x; }
function usageWebToServer(x: WebUsageViewV1): ServerUsageViewV1 { return x; }

// Task 9: the commands the browser may send. A payload mirror that drifts from the
// server's schema is a command the ledger will refuse (or, worse, one it will
// accept with a different meaning), so both directions are checked at compile time.
function envelopeServerToWeb(x: ServerCommandEnvelopeV1): WebCommandEnvelopeV1 { return x; }
function envelopeWebToServer(x: WebCommandEnvelopeV1): ServerCommandEnvelopeV1 { return x; }
function successServerToWeb(x: ServerCommandSuccessV1): WebCommandSuccessV1 { return x; }
function successWebToServer(x: WebCommandSuccessV1): ServerCommandSuccessV1 { return x; }
function importPlanServerToWeb(x: ServerImportPlanPayload): WebImportPlanPayloadV1 { return x; }
function importPlanWebToServer(x: WebImportPlanPayloadV1): ServerImportPlanPayload { return x; }
function proposalEditServerToWeb(x: ServerProposalEditPayload): WebProposalEditPayloadV1 { return x; }
function proposalEditWebToServer(x: WebProposalEditPayloadV1): ServerProposalEditPayload { return x; }
function estimateServerToWeb(x: ServerReestimatePayload): WebEstimatePayloadV1 { return x; }
function estimateWebToServer(x: WebEstimatePayloadV1): ServerReestimatePayload { return x; }
function confirmServerToWeb(x: ServerConfirmPayload): WebConfirmPayloadV1 { return x; }
function confirmWebToServer(x: WebConfirmPayloadV1): ServerConfirmPayload { return x; }
function setLimitServerToWeb(x: ServerSetLimitPayload): WebSetLimitPayloadV1 { return x; }
function setLimitWebToServer(x: WebSetLimitPayloadV1): ServerSetLimitPayload { return x; }
function handoffStopServerToWeb(x: ServerHandoffStopPayload): WebHandoffStopPayloadV1 { return x; }
function handoffStopWebToServer(x: WebHandoffStopPayloadV1): ServerHandoffStopPayload { return x; }
function resumeFromHandoffServerToWeb(x: ServerResumeFromHandoffPayload): WebResumeFromHandoffPayloadV1 { return x; }
function resumeFromHandoffWebToServer(x: WebResumeFromHandoffPayloadV1): ServerResumeFromHandoffPayload { return x; }
function continueTaskServerToWeb(x: ServerContinueTaskPayload): WebContinueTaskPayloadV1 { return x; }
function continueTaskWebToServer(x: WebContinueTaskPayloadV1): ServerContinueTaskPayload { return x; }
function recoveryRetryServerToWeb(x: ServerRecoveryRetryPayload): WebRecoveryRetryPayloadV1 { return x; }
function recoveryRetryWebToServer(x: WebRecoveryRetryPayloadV1): ServerRecoveryRetryPayload { return x; }
// Issue fixes spec §4.2(2): the retry-task command's payload.
function retryTaskServerToWeb(x: ServerRetryTaskPayload): WebRetryTaskPayloadV1 { return x; }
function retryTaskWebToServer(x: WebRetryTaskPayloadV1): ServerRetryTaskPayload { return x; }
// Agent selection plan T10: the proposal's selection layer command (spec §6.2).
function proposalSetAgentServerToWeb(x: ServerProposalSetAgentPayload): WebProposalSetAgentPayloadV1 { return x; }
function proposalSetAgentWebToServer(x: WebProposalSetAgentPayloadV1): ServerProposalSetAgentPayload { return x; }
// Agent selection plan T14 (spec §6.8): the agent UI's three reads and the operator preferences command.
function agentsViewServerToWeb(x: ServerAgentsViewV1): WebAgentsViewV1 { return x; }
function agentsViewWebToServer(x: WebAgentsViewV1): ServerAgentsViewV1 { return x; }
function agentPreferencesServerToWeb(x: ServerAgentPreferencesViewV1): WebAgentPreferencesViewV1 { return x; }
function agentPreferencesWebToServer(x: WebAgentPreferencesViewV1): ServerAgentPreferencesViewV1 { return x; }
function agentPreviewServerToWeb(x: ServerAgentSelectionPreviewV1): WebAgentSelectionPreviewV1 { return x; }
function agentPreviewWebToServer(x: WebAgentSelectionPreviewV1): ServerAgentSelectionPreviewV1 { return x; }
function setAgentPreferencesServerToWeb(x: ServerSetAgentPreferencesPayload): WebSetAgentPreferencesPayloadV1 { return x; }
function setAgentPreferencesWebToServer(x: WebSetAgentPreferencesPayloadV1): ServerSetAgentPreferencesPayload { return x; }
// Labels and progress spec §3.1: the set-task-labels command's payload.
function setTaskLabelsServerToWeb(x: ServerSetTaskLabelsPayload): WebSetTaskLabelsPayloadV1 { return x; }
function setTaskLabelsWebToServer(x: WebSetTaskLabelsPayloadV1): ServerSetTaskLabelsPayload { return x; }
// Loop plans spec §5.2: the set-task-loop command's payload.
function setTaskLoopServerToWeb(x: ServerSetTaskLoopPayload): WebSetTaskLoopPayloadV1 { return x; }
function setTaskLoopWebToServer(x: WebSetTaskLoopPayloadV1): ServerSetTaskLoopPayload { return x; }
// Rewritten under controller ruling PR-I7 (N1 Task 12, 2026-10-02): the requirement view (spec §11.2) and the five
// requirement command payloads (spec §11.1, Task 9) are checked both ways like every other wire type; the run view's
// `single-call` phase and `purpose` ride the group view's pair above.
function requirementViewServerToWeb(x: ServerRequirementViewV1): WebRequirementViewV1 { return x; }
function requirementViewWebToServer(x: WebRequirementViewV1): ServerRequirementViewV1 { return x; }
function requirementOpenServerToWeb(x: ServerRequirementOpenPayload): WebRequirementOpenPayloadV1 { return x; }
function requirementOpenWebToServer(x: WebRequirementOpenPayloadV1): ServerRequirementOpenPayload { return x; }
function requirementAnswerServerToWeb(x: ServerRequirementAnswerPayload): WebRequirementAnswerPayloadV1 { return x; }
function requirementAnswerWebToServer(x: WebRequirementAnswerPayloadV1): ServerRequirementAnswerPayload { return x; }
function requirementConsensusServerToWeb(x: ServerRequirementConsensusPayload): WebRequirementConsensusPayloadV1 { return x; }
function requirementConsensusWebToServer(x: WebRequirementConsensusPayloadV1): ServerRequirementConsensusPayload { return x; }
function requirementFeedbackServerToWeb(x: ServerRequirementDraftFeedbackPayload): WebRequirementDraftFeedbackPayloadV1 { return x; }
function requirementFeedbackWebToServer(x: WebRequirementDraftFeedbackPayloadV1): ServerRequirementDraftFeedbackPayload { return x; }
function requirementAcceptServerToWeb(x: ServerRequirementDraftAcceptPayload): WebRequirementDraftAcceptPayloadV1 { return x; }
function requirementAcceptWebToServer(x: WebRequirementDraftAcceptPayloadV1): ServerRequirementDraftAcceptPayload { return x; }

// Referenced so nothing above is dead code the compiler is free to ignore;
// never invoked for its behavior, only so the assignments above are real
// return statements the type checker has to verify.
export const __webParityAssignabilityChecks__ = [
  reportServerToWeb,
  reportWebToServer,
  coverageServerToWeb,
  coverageWebToServer,
  listRowServerToWeb,
  listRowWebToServer,
  correctionKindServerToWeb,
  correctionKindWebToServer,
  controlConfigServerToWeb,
  controlConfigWebToServer,
  controlSummaryServerToWeb,
  controlSummaryWebToServer,
  controlGroupServerToWeb,
  controlGroupWebToServer,
  recoveryServerToWeb,
  recoveryWebToServer,
  evidenceServerToWeb,
  evidenceWebToServer,
  runActivityServerToWeb,
  runActivityWebToServer,
  commandLookupServerToWeb,
  commandLookupWebToServer,
  commandErrorServerToWeb,
  commandErrorWebToServer,
  envelopeServerToWeb,
  envelopeWebToServer,
  successServerToWeb,
  successWebToServer,
  importPlanServerToWeb,
  importPlanWebToServer,
  proposalEditServerToWeb,
  proposalEditWebToServer,
  estimateServerToWeb,
  estimateWebToServer,
  confirmServerToWeb,
  confirmWebToServer,
  setLimitServerToWeb,
  setLimitWebToServer,
  handoffStopServerToWeb,
  handoffStopWebToServer,
  resumeFromHandoffServerToWeb,
  resumeFromHandoffWebToServer,
  continueTaskServerToWeb,
  continueTaskWebToServer,
  recoveryRetryServerToWeb,
  recoveryRetryWebToServer,
  retryTaskServerToWeb, retryTaskWebToServer,
  proposalSetAgentServerToWeb,
  proposalSetAgentWebToServer,
  agentsViewServerToWeb,
  agentsViewWebToServer,
  agentPreferencesServerToWeb,
  agentPreferencesWebToServer,
  agentPreviewServerToWeb,
  agentPreviewWebToServer,
  setAgentPreferencesServerToWeb,
  setAgentPreferencesWebToServer,
  setTaskLabelsServerToWeb,
  setTaskLabelsWebToServer,
  setTaskLoopServerToWeb,
  setTaskLoopWebToServer,
  requirementViewServerToWeb,
  requirementViewWebToServer,
  requirementOpenServerToWeb,
  requirementOpenWebToServer,
  requirementAnswerServerToWeb,
  requirementAnswerWebToServer,
  requirementConsensusServerToWeb,
  requirementConsensusWebToServer,
  requirementFeedbackServerToWeb,
  requirementFeedbackWebToServer,
  requirementAcceptServerToWeb,
  requirementAcceptWebToServer,
  usageServerToWeb,
  usageWebToServer,
] as const;
