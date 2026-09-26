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
import type {
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
  ReestimatePayload as ServerReestimatePayload,
  ResumeFromHandoffPayload as ServerResumeFromHandoffPayload,
  SetLimitPayload as ServerSetLimitPayload,
} from "../../src/control/webProtocol.js";
import type {
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
  ResumeFromHandoffPayloadV1 as WebResumeFromHandoffPayloadV1,
  SetLimitPayloadV1 as WebSetLimitPayloadV1,
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
});

// --- compile-time mutual-assignability checks (never called at runtime) ---

function reportServerToWeb(x: ServerMetricsReport): WebMetricsReport {
  return x;
}
function reportWebToServer(x: WebMetricsReport): ServerMetricsReport {
  return x;
}
function coverageServerToWeb(x: ServerPanelCoverage): WebPanelCoverage {
  return x;
}
function coverageWebToServer(x: WebPanelCoverage): ServerPanelCoverage {
  return x;
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
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return { ...x, runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null, continuable: run.continuable ?? false })) };
}
function recoveryServerToWeb(x: ServerRecoveryViewV1): WebRecoveryViewV1 { return x; }
function recoveryWebToServer(x: WebRecoveryViewV1): ServerRecoveryViewV1 { return x; }
function evidenceServerToWeb(x: ServerEvidenceManifestV1): WebEvidenceManifestV1 { return x; }
function evidenceWebToServer(x: WebEvidenceManifestV1): ServerEvidenceManifestV1 { return x; }
function commandLookupServerToWeb(x: ServerCommandLookupV1): WebCommandLookupV1 { return x; }
function commandLookupWebToServer(x: WebCommandLookupV1): ServerCommandLookupV1 { return x; }
function commandErrorServerToWeb(x: ServerCommandErrorV1): WebCommandErrorV1 { return x; }
function commandErrorWebToServer(x: WebCommandErrorV1): ServerCommandErrorV1 { return x; }

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
// Agent selection plan T10: the proposal's selection layer command (spec §6.2).
function proposalSetAgentServerToWeb(x: ServerProposalSetAgentPayload): WebProposalSetAgentPayloadV1 { return x; }
function proposalSetAgentWebToServer(x: WebProposalSetAgentPayloadV1): ServerProposalSetAgentPayload { return x; }

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
  proposalSetAgentServerToWeb,
  proposalSetAgentWebToServer,
] as const;
