import type { Candidate, Capabilities, Claim, StopProof, UsageEvent, ArtifactRef, HandoffRequest, HandoffAck } from "./types.js";
import type { InputCheckpointV1 } from "./resumeBundle.js";
import { ControlError } from "./errors.js";
import { createCcloopExecutionPort } from "./ccloopPort.js";
import type { CapabilityViewV1 } from "./webProtocol.js";
export type ProfileCapabilityProbe = CapabilityViewV1;
export interface StartEnvelope { protocol:1;claim:Claim;contractHash:string;inputCheckpoint:InputCheckpointV1|null; work:{contract:unknown;targetRepo:string;base:string;sourceDir:string} }
export type ExecutionStatus={kind:"absent"}|{kind:"accepted";executionId:string;configHash:string}|{kind:"unknown"}|{kind:"stopped";proof:StopProof};
export interface ExecutionReport {
 events:UsageEvent[];candidate:Candidate|null;
 terminal:{outcome:"succeeded"|"blocked_waiting_human"|"exhausted"|"cancelled"|"failed";attemptSha:string|null;sourceDir:string;repoDir:string}|null;
}
export interface ExecutionPort {
  /** A full V1 probe. Absence is capability-unavailable, never inferred. */
  probeProfileCapabilities?():Promise<ProfileCapabilityProbe>;
  capabilities():Promise<Capabilities>;
  readEvidence(ref:ArtifactRef):Promise<Buffer>;
  accept(input:StartEnvelope):Promise<ExecutionStatus>;
  inspect(input:StartEnvelope):Promise<ExecutionStatus>;
  requestHandoff(input:StartEnvelope,request:HandoffRequest):Promise<HandoffAck>;
  collect(input:StartEnvelope,afterSeq:number):Promise<ExecutionReport>;
}
/** No legacy runner fallback: production is enabled only by explicit immutable options. */
export function productionExecutionPort(options?:{binary:string;adapter:"codex";adapterConfigPath:string;timeoutMs:number}):ExecutionPort {
 if(!options)throw new ControlError("control-protocol-unavailable");return createCcloopExecutionPort(options);
}
