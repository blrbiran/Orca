import type { Candidate, Capabilities, Claim, StopProof, UsageEvent } from "./types.js";
import { ControlError } from "./errors.js";
export interface StartEnvelope { protocol:1;claim:Claim;contractHash:string;inputCheckpoint:{checkpointId:string;hash:string}|null }
export type ExecutionStatus={kind:"absent"}|{kind:"accepted";executionId:string;configHash:string}|{kind:"unknown"}|{kind:"stopped";proof:StopProof};
export interface ExecutionReport {
 events:UsageEvent[];candidate:Candidate|null;
 terminal:{outcome:"succeeded"|"blocked_waiting_human"|"exhausted"|"cancelled"|"failed";attemptSha:string|null;sourceDir:string;repoDir:string}|null;
}
export interface ExecutionPort {
 capabilities():Promise<Capabilities>;
 accept(input:StartEnvelope):Promise<ExecutionStatus>;
 inspect(input:StartEnvelope):Promise<ExecutionStatus>;
 collect(input:StartEnvelope,afterSeq:number):Promise<ExecutionReport>;
}
/** No legacy runner fallback: this factory enables no production execution. */
export function productionExecutionPort():ExecutionPort { throw new ControlError("control-protocol-unavailable"); }
