import type { Candidate, Claim, StopProof, UsageEvent, ArtifactRef, HandoffRequest, HandoffAck } from "./types.js";
import type { InputCheckpointV1 } from "./resumeBundle.js";
import { ControlError } from "./errors.js";
import { createCcloopExecutionPort } from "./ccloopPort.js";
import type { AgentResolution, ContextWindow, PartialSelection } from "./agentSelection.js";
export interface StartEnvelope { protocol:2;claim:Claim;contractHash:string;inputCheckpoint:InputCheckpointV1|null; work:{contract:unknown;targetRepo:string;base:string;sourceDir:string} }
export type ExecutionStatus={kind:"absent"}|{kind:"accepted";executionId:string;configHash:string}|{kind:"unknown"}|{kind:"stopped";proof:StopProof};
export interface ExecutionReport {
 events:UsageEvent[];candidate:Candidate|null;
 terminal:{outcome:"succeeded"|"blocked_waiting_human"|"exhausted"|"cancelled"|"failed";attemptSha:string|null;sourceDir:string;repoDir:string}|null;
}
/** Agent selection spec §4.6: `control capabilities` with `agent: null` -- the installation table as ccloop reads it. */
export interface AgentsView { installations: Array<{ id: string; kind: string; defaults: { model: string; contextWindow: ContextWindow }; contextOptions: ContextWindow[]; version: string }> }
export interface ExecutionPort {
  /**
   * Agent selection spec §4.6 (capabilities protocol 3 with a selection). ccloop fills the descriptor's
   * defaults, validates, materializes and answers the configHash: Orca never computes one (spec I3).
   * There is no capability probe without a selection -- a gate asks about the selection it will dispatch.
   */
  resolveAgent(partial:PartialSelection):Promise<AgentResolution>;
  /** Capabilities protocol 3 with `agent: null`: the installations the panel may offer. */
  listAgents():Promise<AgentsView>;
  readEvidence(ref:ArtifactRef):Promise<Buffer>;
  accept(input:StartEnvelope):Promise<ExecutionStatus>;
  inspect(input:StartEnvelope):Promise<ExecutionStatus>;
  requestHandoff(input:StartEnvelope,request:HandoffRequest):Promise<HandoffAck>;
  collect(input:StartEnvelope,afterSeq:number):Promise<ExecutionReport>;
}
/** No legacy runner fallback: production is enabled only by explicit immutable options. */
export function productionExecutionPort(options?:{binary:string;agentsTablePath:string;timeoutMs:number}):ExecutionPort {
 if(!options)throw new ControlError("control-protocol-unavailable");return createCcloopExecutionPort(options);
}
