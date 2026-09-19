export type WorkKind = "task" | "decompose" | "reconcile" | "handoff" | "goal-review" | "memory";
export type WebWorkKind = "budget-estimate" | "task" | "handoff" | "goal-review";
export interface ExecutionProfileBinding { workKind: WebWorkKind; profileId: string; profileHash: string }
export type BudgetMode = "strict" | "soft";
export interface Amount { tokens: number; activeMs: number; attempts: number; sessions: number }
export interface Grant { work: Amount; handoff: Amount }
export interface CommandMeta { commandId: string; expectedRevision: number; by: string }
export interface Identity {
  groupId: string; workItemId: string; taskId: string | null; runId: string;
  generation: number; graphVersion: number; targetVersion: number;
}
export interface Capabilities {
  protocol: 1; durableAccept: boolean; ownershipIsolation: boolean;
  evidenceRetention: boolean;
  usageObservation: "realtime" | "phase-end" | "unavailable";
  budgetEnforcement: "bounded" | "soft" | "unsupported";
  requestBoundEvidence: string | null;
}
export interface GroupInput {
  groupId: string; projectKey: string; goal: string; successConditions: string[];
  budgetMode?: BudgetMode; limit: Amount; reviewReserve: Amount;
  deadlineAt: string | null;
}
export interface WorkBase {
  workItemId: string; taskId: string | null;
  dependsOn: string[]; contract: unknown; configHash: string; grant: Grant;
}
export type WorkInput = WorkBase & (
  | {kind:"handoff";parentRunId:string}
  | {kind:Exclude<WorkKind,"handoff">;parentRunId?:never}
);
export interface ClaimInput extends CommandMeta {
  groupId: string; workItemId: string; graphVersion: number; targetVersion: number;
  capabilities: Capabilities;
  executionProfile?: ExecutionProfileBinding;
  handoffProfile?: ExecutionProfileBinding;
}
export interface Claim extends Identity {
  commandId: string; configHash: string; grant: Grant; ownerToken: string;
}
export interface ArtifactRef { artifactId: string; hash: string }
export type HandoffReason = "budget" | "context" | "human" | "graph-change" | "shutdown";
export interface HandoffRequest {
  protocol: 1; requestId: string; runId: string; generation: number;
  reason: HandoffReason; deadlineAt: string;
}
export type HandoffAck =
  | {kind:"latched";requestId:string}
  | {kind:"complete";requestId:string;checkpointId:string}
  | {kind:"unknown";requestId:string};
export interface UsageEvent {
  runId: string; generation: number; eventSeq: number;
  bucket: "work" | "handoff";
  cumulative: Amount | null; source: ArtifactRef;
}
export interface StopProof {
  executionId: string; generation: number; isolated: true; source: ArtifactRef;
}
export interface Candidate extends Identity {
  checkpointId: string; usageHighWater: number;
  result: "complete" | "partial" | "failed";
  artifacts: ArtifactRef[]; snapshot: ArtifactRef | null;
  missing: string[]; unresolvedRequestIds: string[];
  stopProof: StopProof | null; terminalOutcome: string; handoff: ArtifactRef;
}
export interface GroupView {
  groupId: string; revision: number; graphVersion: number; stopped: boolean;
  status: "draft" | "ready" | "running" | "review" | "done" | "blocked";
  used: Amount; reserved: Amount; limit: Amount;
}
export interface RunView {
  runId: string; generation: number; executionId: string | null;
  state: "claimed" | "starting" | "accepted" | "unknown" | "settled";
  checkpointId: string | null; recoverable: boolean;
}
