import type { SavedResultSourcePackage,SavedResultSourceEligibility,SavedResultSettlement,RecoveryOf } from "./savedResultProtocol.js";
import type { TokenPolicy } from "./tokenPolicy.js";
import type { ToolRulesReport } from "./toolRules.js";
import type { Candidate, Claim, StopProof, UsageEvent, ArtifactRef, HandoffRequest, HandoffAck } from "./types.js";
import type { TaskResultCollectionV1 } from './taskResultProtocol.js';
import type { OperatorNote, PriorFailure, RunProgress, TranscriptEntry } from "./schema.js";
import type { InputCheckpointV1 } from "./resumeBundle.js";
import { ControlError } from "./errors.js";
import type { LastFailure, RunFailureCause } from "./driveRecord.js";
import type { PathPolicyMissV1 } from "./pathPolicyMisses.js";
import { createCcloopExecutionPort } from "./ccloopPort.js";
import type { AgentResolution, ContextWindow, PartialSelection } from "./agentSelection.js";
import type { AgentApplyRequest, AgentObservation, AgentPreview, AgentReceipt } from "./agentInstallationProtocol.js";
import type { VersionRefresh } from "../agents/versionRefresh.js";
/** Single-call estimate spec §4.1: protocol 3's two kinds of work. */
// Syncskill integration spec §10.6: skillPluginDir only for a run with skills (ccloop protocol 3, additive).
export interface LoopWork { kind:"loop";contract:unknown;targetRepo:string;base:string;sourceDir:string;skillPluginDir?:string;codexSkillsDir?:string;ompSkillsDir?:string;priorFailures?:PriorFailure[];operatorNote?:OperatorNote;additionalRepos?:Array<{key:string;targetRepo:string;base:string}>;handoff?:{inputDir:string;outputDir:string} }
export interface SingleCallWork { kind:"single-call";prompt:string;responseSchema:Record<string,unknown>;maxOutputTokens:number;sourceDir:string }
/** Tester follow-up G spec §2.1: the live token ceiling ccloop stops the run at (ccloop live-ceiling spec, protocol 4 only). */
export interface LiveCeilingWire { protocol:1;revision:number;tokens:number;cause:"group"|"pause-line"|"task-cap" }
export interface StartEnvelope { protocol:3|4;mode?:"verify-saved-result";savedResultRecovery?:{packagePath:string;packageHash:string;admissionHash:string;recoveryOf:RecoveryOf};tokenPolicy?:TokenPolicy;liveCeiling?:LiveCeilingWire;claim:Claim;contractHash:string;inputCheckpoint:InputCheckpointV1|null; work:LoopWork|SingleCallWork }
export type ExecutionStatus={kind:"absent"}|{kind:"accepted";executionId:string;configHash:string}|{kind:"unknown"}|{kind:"stopped";proof:StopProof};
export interface ExecutionReport {
 events:UsageEvent[];candidate:Candidate|null;
 terminal:{tokenRemainingStatus?:"known"|"unlimited"|"unknown";waitingCause?:"token-allowance";allowanceNextPhase?:"plan"|"execute"|"verify";outcome:"succeeded"|"blocked_waiting_human"|"exhausted"|"cancelled"|"failed";attemptSha:string|null;sourceDir:string;repoDir:string;stopReason?:string|null;failureCause?:RunFailureCause;lastFailure?:LastFailure;budgetSnapshot?:{attemptsRemaining:number;timeRemainingMs:number;tokenBudgetRemaining:number|null}}|null;
 /** Labels and progress spec §3.2 (§8 R5): optional so the synthetic ports need no edit; absent reads as null. */
 progress?:RunProgress|null;
 /** Decisions the agent reported: optional like `progress`; read only through reportedDecisions.ts. */
 decisions?:unknown;
 /** A debug run's reproduction and closing values: optional like `decisions`; read only through reportedDecisions.ts. */
 debug?:unknown;
 /** A flow step's report (ccloop flow-answer-key spec §4 item 7, opaque there): read only through reportedFlowOf. */
 flow?:unknown;
 /** ccloop per-contract tool rules spec §5: the run's tool-rule report, present iff the contract had rules and ccloop wrote it. */
 toolRules?:ToolRulesReport;
 /** Live transcript spec §10.2.4: one entry per agent call, present iff ccloop listed at least one; no consumer yet. */
 transcripts?:TranscriptEntry[];
 /** Tester round 3 spec §3: the observed floor of calls that ended without a usage report. Shown to a person, never booked. */
 usageLowerBound?:{tokens:number};
 /** Exact Git-observed paths a human-blocked ccloop attempt could not write under its allowlist. */
 pathPolicyMisses?:PathPolicyMissV1[];
 /** Tester follow-up G §10.2 (ccloop C4): the two handoff files in the run's output directory, present iff the envelope had work.handoff. */
 handoffFiles?:{handoff:{present:boolean;bytes:number|null};summary:{present:boolean;bytes:number|null}};
 /** Tester follow-up G Part 5 (ccloop C4): the live notes ccloop acknowledged, present iff its ack file exists. */
 liveNotes?:{delivered:Array<{id:string;phase:"plan"|"execute"|"verify";attempt:number;at:string}>};
 /**
  * Worker-lost recovery spec 2026-11-12 §5 (as built, ccloop half item 2): present only for a claimed loop run with no
  * candidate and no terminal whose worker is not alive -- `lost` (confirmed dead) or `undetermined`. Absent = alive or n/a.
  * Tester follow-up I (ccloop branch i/worker-lost-fixes): also beside a loop run's candidate that has no stop proof.
  */
 worker?:{state:"lost"|"undetermined";reason:string};
 /** Tester follow-up G spec §2.1: present iff ccloop stopped the run at its live ceiling (ccloop live-ceiling spec). */
 liveCeilingStop?:{revision:number;tokens:number;cause:"group"|"pause-line"|"task-cap";observedTokens:number;phase:"plan"|"execute"|"verify";at:"mid-call"|"boundary"};
}
/** Agent selection spec §4.6: `control capabilities` with `agent: null` -- the installation table as ccloop reads it. */
export interface AgentsView { installations: Array<{ id: string; kind: string; defaults: { model: string; contextWindow: ContextWindow }; contextOptions: ContextWindow[]; version: string }> }
/** Spec 2026-10-15 §5 (part C): `control models` -- one installation's models, as ccloop's catalog cache or probe answers them. */
export interface AgentModelsView { installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: Array<{ model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }> }
export interface ControlFeatures { protocol:1;tokenPolicy?:"optional-v1";savedResultRecovery?:"v1";agentInstallationUpdate?:"v1";transcripts?:"v1" }
export interface ExecutionPort {
  readFeatures?():Promise<ControlFeatures>;
  observeAgentInstallations?():Promise<AgentObservation>;
  /** Agent version auto-refresh spec 2026-10-20 §3.1: record the installed versions ccloop observes (one, or all). */
  refreshAgentVersions?(only?:string):Promise<VersionRefresh>;
  previewAgentInstallations?():Promise<AgentPreview>;
  /** Handoff §4.0 item 5 (seat G1): nothing is at the installation table's path yet (a first-use machine). */
  agentsTableAbsent?():boolean;
  applyAgentInstallations?(request:AgentApplyRequest):Promise<AgentReceipt>;
  savedResultSourceEligibility?(input:{source:StartEnvelope;sourceAttempt:number;packagePath:string;packageHash:string}):Promise<SavedResultSourceEligibility>;
  savedResultEligibility?(input:StartEnvelope):Promise<{status:"eligible";authorityKind:Exclude<SavedResultSourcePackage["authorityKind"],"execution-without-final-v1">;normalizedExecutionHash:string}|{status:"eligible";authorityKind:"execution-without-final-v1";verificationOnly:true}|{status:"unavailable";reason:string}>;
  collectSavedResultEvidence?(input:StartEnvelope):Promise<{schema:"ccloop-saved-result-evidence-v1";identity:unknown;attempt:number;capsule:ArtifactRef|null;reason:string|null}>;
  readSavedResultEvidence?(input:StartEnvelope,capsule:ArtifactRef,ref:ArtifactRef):Promise<Buffer>;
  settleSavedResult?(input:StartEnvelope):Promise<{ref:ArtifactRef;settlement:SavedResultSettlement}>;
  /** Worker-lost recovery spec §5: ccloop ends a run whose worker is confirmed dead as a failed terminal (`worker-lost`) with a stop proof. */
  settleLostWorker?(input:StartEnvelope):Promise<{candidate:Candidate}>;
  readSavedResultSettlement?(input:StartEnvelope,settlementRef:ArtifactRef,ref:ArtifactRef):Promise<Buffer>;
  /**
   * Agent selection spec §4.6 (capabilities protocol 3 with a selection). ccloop fills the descriptor's
   * defaults, validates, materializes and answers the configHash: Orca never computes one (spec I3).
   * There is no capability probe without a selection -- a gate asks about the selection it will dispatch.
   */
  collectTaskResults?(input:StartEnvelope,afterRevision:number):Promise<TaskResultCollectionV1>;
  readTaskResultEvidence?(input:StartEnvelope,manifestRef:ArtifactRef,ref:ArtifactRef):Promise<Buffer>;
  resolveAgent(partial:PartialSelection):Promise<AgentResolution>;
  /** Capabilities protocol 3 with `agent: null`: the installations the panel may offer. */
  listAgents():Promise<AgentsView>;
  /** Spec 2026-10-15 §5: one installation's models; `refresh` skips ccloop's catalog cache. Optional: older ports lack it. */
  listModels?(installation:string,refresh:boolean):Promise<AgentModelsView>;
  readEvidence(ref:ArtifactRef):Promise<Buffer>;
  accept(input:StartEnvelope):Promise<ExecutionStatus>;
  inspect(input:StartEnvelope):Promise<ExecutionStatus>;
  requestHandoff(input:StartEnvelope,request:HandoffRequest):Promise<HandoffAck>;
  collect(input:StartEnvelope,afterSeq:number):Promise<ExecutionReport>;
  /** Tester follow-up G spec §2.1: raise a running run's live ceiling (ccloop `live-ceiling`); optional, as older ports lack it. */
  setLiveCeiling?(input:StartEnvelope,ceiling:LiveCeilingWire):Promise<{revision:number;tokens:number}>;
}
/** No legacy runner fallback: production is enabled only by explicit immutable options. */
export function productionExecutionPort(options?:{binary:string;agentsTablePath:string;timeoutMs:number}):ExecutionPort {
 if(!options)throw new ControlError("control-protocol-unavailable");return createCcloopExecutionPort(options);
}
