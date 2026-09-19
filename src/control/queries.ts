import type { ControlStore } from "./store.js";
import type { ArtifactRef, Amount, GroupInput, GroupView, RunView, WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readCanonicalRecord } from "./snapshot.js";
import {
  amountProvenanceSchema,
  budgetEstimateRequestSchema,
  budgetEstimateSchema,
  controlPlanSchema,
  profileBindingSchema,
  type BudgetEstimateRequestV1,
  type BudgetEstimateV1,
  type ControlPlanV1,
  type ProfileBindingV1,
} from "./webProtocol.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { amountSchema, idSchema, safeInteger } from "./schema.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { z } from "zod";
export type GroupRecord = GroupView & GroupInput & {budgetVersion:number;reviewRemaining:Amount;proposal?:{work:WorkInput;commandId:string}};
export type WorkRecord = WorkInput & {targetVersion:number;status:"ready"|"running"|"done"|"blocked"};
export function readGroup(store:ControlStore,id:string):GroupRecord {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(id);
  if (!row) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body));
}
export function saveGroup(store:ControlStore,group:GroupRecord):void {
  store.db.prepare("UPDATE groups SET revision=?,graph_version=?,body=? WHERE id=?").run(group.revision,group.graphVersion,JSON.stringify(group),group.groupId);
  recordProjectionChange(store,[group.groupId]);
}
export function readVersions(store:ControlStore,id:string):{commandRevision:number;projectionSeq:number} {
  const row=store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(id);
  if(!row)throw new ControlError("group-not-found");
  return {commandRevision:Number(row.revision),projectionSeq:Number(row.projection_seq)};
}
export function getGroup(store:ControlStore,id:string):GroupView {
  const g=readGroup(store,id);
  return {groupId:g.groupId,revision:g.revision,graphVersion:g.graphVersion,stopped:g.stopped,status:g.status,used:g.used,reserved:g.reserved,limit:g.limit};
}
export function readWork(store:ControlStore,groupId:string,id:string):WorkRecord {
  const row=store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId,id);
  if(!row) throw new ControlError("work-not-found");return JSON.parse(String(row.body));
}
export function saveWork(store:ControlStore,groupId:string,work:WorkRecord):void {
  const body=JSON.stringify(work);
  const changed=store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=? AND body<>?").run(body,groupId,work.workItemId,body).changes;
  if(changed===0) {
    if(!store.db.prepare("SELECT id FROM work_items WHERE group_id=? AND id=?").get(groupId,work.workItemId))throw new ControlError("work-not-found");
    return;
  }
  recordProjectionChange(store,[groupId]);
}
export function allWork(store:ControlStore,groupId:string):WorkRecord[] {
  return store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY id").all(groupId).map(r=>JSON.parse(String(r.body)));
}
export function getRun(store:ControlStore,id:string):RunView {
  const row=store.db.prepare("SELECT body FROM runs WHERE id=?").get(id);
  if(!row) throw new ControlError("run-not-found");
  const r=JSON.parse(String(row.body));
  return {runId:r.runId,generation:r.generation,executionId:r.executionId,state:r.state,checkpointId:r.checkpointId,recoverable:r.recoverable};
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const profileSetSchema = z.object({
  estimator: profileBindingSchema, worker: profileBindingSchema, handoff: profileBindingSchema, goalReview: profileBindingSchema,
}).strict();
const groupAuthoritySchema = z.object({
  groupId: idSchema,
  graphVersion: safeInteger.positive(),
  planHash: hashSchema,
  plan: z.object({
    repoId: idSchema, planId: idSchema, planHash: hashSchema,
    goal: z.string().min(1), successConditions: z.array(z.string().min(1)),
  }).strict(),
  proposal: z.object({
    state: z.enum(["editable", "confirmed"]), proposalVersion: safeInteger.positive(), planHash: hashSchema,
    budgetMode: z.enum(["strict", "soft"]).nullable(), contextPolicy: z.object({ handoffAtContextTokens: safeInteger.positive().nullable() }).strict(),
    profiles: profileSetSchema.nullable(), executionSnapshotHash: hashSchema.nullable(),
  }).strict(),
  ledger: z.object({ groupLimit: amountSchema }).passthrough(),
}).passthrough();

function recoveryBlocked(): never { throw new ControlError("recovery-blocked"); }

function parseJson(body: unknown): unknown {
  try { return JSON.parse(String(body)); }
  catch { return recoveryBlocked(); }
}

function readGroupAuthority(store: ControlStore, groupId: string): z.infer<typeof groupAuthoritySchema> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const parsed = groupAuthoritySchema.safeParse(parseJson(row.body));
  if (!parsed.success || parsed.data.groupId !== groupId || parsed.data.plan.planHash !== parsed.data.planHash
    || parsed.data.proposal.planHash !== parsed.data.planHash) return recoveryBlocked();
  return parsed.data;
}

export interface ArchivedPlanAuthority { groupId: string; graphVersion: number; planHash: string; canonicalJson: string; plan: ControlPlanV1 }

export function readArchivedPlan(store: ControlStore, groupId: string): ArchivedPlanAuthority {
  const group = readGroupAuthority(store, groupId);
  const planHash = group.planHash;
  const canonicalJson = readCanonicalRecord(store, planHash);
  try {
    const plan = controlPlanSchema.parse(JSON.parse(canonicalJson));
    if (canonicalBytes(plan).toString("utf8") !== canonicalJson || sha256Canonical(plan) !== planHash
      || plan.repoId !== group.plan.repoId || plan.planId !== group.plan.planId || plan.goal !== group.plan.goal
      || canonicalBytes(plan.successConditions).compare(canonicalBytes(group.plan.successConditions)) !== 0) return recoveryBlocked();
    for (const task of plan.tasks) {
      const contract = taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson));
      if (contract.objective.taskId !== task.taskId
        || canonicalBytes(contract).toString("utf8") !== task.originalContractCanonicalJson
        || sha256Canonical(contract) !== task.originalContractHash) return recoveryBlocked();
      if (readCanonicalRecord(store, task.originalContractHash) !== task.originalContractCanonicalJson) return recoveryBlocked();
    }
    return { groupId, graphVersion: group.graphVersion, planHash, canonicalJson, plan };
  } catch (error) {
    if (error instanceof ControlError && error.code === "recovery-blocked") throw error;
    return recoveryBlocked();
  }
}

export function readArchivedContract(store: ControlStore, groupId: string, taskId: string): {
  groupId: string; taskId: string; contractHash: string; canonicalJson: string; contract: z.infer<typeof taskContractSchema>;
} {
  const archivedPlan = readArchivedPlan(store, groupId);
  const task = archivedPlan.plan.tasks.find(candidate => candidate.taskId === taskId);
  if (!task) return recoveryBlocked();
  const canonicalJson = readCanonicalRecord(store, task.originalContractHash);
  try {
    const contract = taskContractSchema.parse(JSON.parse(canonicalJson));
    if (contract.objective.taskId !== taskId || canonicalJson !== task.originalContractCanonicalJson
      || sha256Canonical(contract) !== task.originalContractHash) return recoveryBlocked();
    return { groupId, taskId, contractHash: task.originalContractHash, canonicalJson, contract };
  } catch (error) {
    if (error instanceof ControlError && error.code === "recovery-blocked") throw error;
    return recoveryBlocked();
  }
}

const proposalAllocationSchema = z.object({
  ownerKind: z.enum(["task", "goal-review", "reserve"]), ownerId: z.string().min(1),
  bucket: z.enum(["work", "handoff", "review", "reserve"]),
  state: z.enum(["draft-encumbered", "confirmed", "active", "held", "continuing", "terminal", "unknown"]),
  amount: amountSchema, fieldProvenance: amountProvenanceSchema,
}).strict();
const budgetProposalRecordSchema = z.object({
  proposalVersion: safeInteger.positive(), state: z.enum(["editable", "confirmed"]), planHash: hashSchema,
  groupLimit: amountSchema, explicitUnallocatedReserve: amountSchema,
  allocations: z.array(proposalAllocationSchema), budgetMode: z.enum(["strict", "soft"]).nullable(),
  contextPolicy: z.object({ handoffAtContextTokens: safeInteger.positive().nullable() }).strict(),
  profiles: profileSetSchema.nullable(), executionSnapshotHash: hashSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  for (let index = 1; index < value.allocations.length; index += 1) {
    const previous = value.allocations[index - 1], current = value.allocations[index];
    const left = `${previous.ownerKind}\0${previous.ownerId}\0${previous.bucket}`;
    const right = `${current.ownerKind}\0${current.ownerId}\0${current.bucket}`;
    if (left >= right) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["allocations", index], message: "allocation-order-invalid" });
  }
});

export type BudgetProposalRecord = z.infer<typeof budgetProposalRecordSchema>;

export function readBudgetProposal(store: ControlStore, groupId: string): BudgetProposalRecord {
  const row = store.db.prepare("SELECT proposal_version,body FROM budget_proposals WHERE group_id=?").get(groupId);
  if (!row) throw new ControlError("recovery-blocked");
  const group = readGroupAuthority(store, groupId);
  const archivedPlan = readArchivedPlan(store, groupId);
  const body = String(row.body);
  const parsed = budgetProposalRecordSchema.safeParse(parseJson(body));
  if (!parsed.success) throw new ControlError("recovery-blocked", parsed.error.issues[0]?.message);
  if (canonicalBytes(parsed.data).toString("utf8") !== body) throw new ControlError("recovery-blocked", "proposal-noncanonical");
  if (parsed.data.planHash !== group.planHash || parsed.data.proposalVersion !== Number(row.proposal_version)
    || parsed.data.proposalVersion !== group.proposal.proposalVersion || parsed.data.state !== group.proposal.state) {
    throw new ControlError("recovery-blocked", "proposal-identity");
  }
  const proposal = parsed.data;
  if (canonicalBytes(proposal.groupLimit).compare(canonicalBytes(group.ledger.groupLimit)) !== 0
    || proposal.budgetMode !== group.proposal.budgetMode
    || canonicalBytes(proposal.contextPolicy).compare(canonicalBytes(group.proposal.contextPolicy)) !== 0
    || canonicalBytes(proposal.profiles).compare(canonicalBytes(group.proposal.profiles)) !== 0
    || proposal.executionSnapshotHash !== group.proposal.executionSnapshotHash) return recoveryBlocked();
  const taskIds = new Set(archivedPlan.plan.tasks.map(task => task.taskId));
  const taskBuckets = new Set<string>();
  let reviewCount = 0, reserveCount = 0;
  for (const allocation of proposal.allocations) {
    if (allocation.ownerKind === "task") {
      if (!taskIds.has(allocation.ownerId) || !["work", "handoff"].includes(allocation.bucket)) return recoveryBlocked();
      taskBuckets.add(`${allocation.ownerId}\0${allocation.bucket}`);
    } else if (allocation.ownerKind === "goal-review") {
      reviewCount += 1;
      if (allocation.ownerId !== `${groupId}:goal-review` || allocation.bucket !== "review") return recoveryBlocked();
    } else {
      reserveCount += 1;
      if (allocation.ownerId !== `${groupId}:reserve` || allocation.bucket !== "reserve"
        || canonicalBytes(allocation.amount).compare(canonicalBytes(proposal.explicitUnallocatedReserve)) !== 0) return recoveryBlocked();
    }
  }
  if (reviewCount !== 1 || reserveCount !== 1
    || [...taskIds].some(taskId => !taskBuckets.has(`${taskId}\0work`) || !taskBuckets.has(`${taskId}\0handoff`))) return recoveryBlocked();
  const confirmed = proposal.state === "confirmed";
  if (confirmed !== (proposal.budgetMode !== null && proposal.profiles !== null && proposal.executionSnapshotHash !== null)) return recoveryBlocked();
  return proposal;
}

const estimateRecordSchema = z.object({
  estimateId: idSchema, estimateVersion: safeInteger.positive(),
  state: z.enum(["queued", "running", "start-unknown", "ready", "failed", "interrupted", "blocked-capability", "input-too-large"]),
  profile: profileBindingSchema, mode: z.enum(["strict", "soft"]), requestHash: hashSchema.nullable(),
  request: budgetEstimateRequestSchema.nullable(), outputHash: hashSchema.nullable(), output: budgetEstimateSchema.nullable(),
  reasonCode: z.string().min(1).nullable(), grant: amountSchema,
}).strict().superRefine((value, ctx) => {
  if ((value.request === null) !== (value.requestHash === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["request"], message: "estimate-request-hash-mismatch" });
  }
  if ((value.output === null) !== (value.outputHash === null) || (value.state === "ready") !== (value.output !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["output"], message: "estimate-output-state-mismatch" });
  }
});

export interface EstimateRecord {
  estimateId: string; estimateVersion: number;
  state: "queued" | "running" | "start-unknown" | "ready" | "failed" | "interrupted" | "blocked-capability" | "input-too-large";
  profile: ProfileBindingV1; mode: "strict" | "soft"; requestHash: string | null; request: BudgetEstimateRequestV1 | null;
  outputHash: string | null; output: BudgetEstimateV1 | null; reasonCode: string | null; grant: Amount;
}

export function readEstimateRecord(store: ControlStore, groupId: string, estimateId: string): EstimateRecord {
  const row = store.db.prepare("SELECT estimate_version,state,body FROM estimates WHERE group_id=? AND id=?").get(groupId, estimateId);
  if (!row) throw new ControlError("recovery-blocked");
  const archivedPlan = readArchivedPlan(store, groupId);
  const body = String(row.body);
  const parsed = estimateRecordSchema.safeParse(parseJson(body));
  if (!parsed.success || canonicalBytes(parsed.data).toString("utf8") !== body
    || parsed.data.estimateId !== estimateId || parsed.data.estimateVersion !== Number(row.estimate_version)
    || parsed.data.state !== String(row.state)) return recoveryBlocked();
  const estimate = parsed.data;
  if ((estimate.request === null) !== (estimate.requestHash === null)
    || (estimate.request && (estimate.requestHash !== sha256Canonical(estimate.request)
      || estimate.request.planHash !== archivedPlan.planHash
      || estimate.request.planSnapshotCanonicalJson !== archivedPlan.canonicalJson
      || canonicalBytes(estimate.request.estimatorProfile).compare(canonicalBytes(estimate.profile)) !== 0))
    || (estimate.output === null) !== (estimate.outputHash === null)
    || (estimate.output && (estimate.outputHash !== sha256Canonical(estimate.output) || estimate.output.planHash !== archivedPlan.planHash))) {
    return recoveryBlocked();
  }
  if ((estimate.state === "queued" && (estimate.request === null || estimate.reasonCode !== null))
    || (estimate.state === "input-too-large" && (estimate.request === null || estimate.reasonCode !== "estimate-input-too-large"))
    || (estimate.state === "blocked-capability" && estimate.reasonCode !== "estimate-blocked-capability")) return recoveryBlocked();
  if (estimate.output) {
    const expectedTaskIds = archivedPlan.plan.tasks.map(task => task.taskId);
    if (estimate.output.tasks.map(task => task.taskId).join("\0") !== expectedTaskIds.join("\0")) return recoveryBlocked();
  }
  return estimate;
}

function artifactsForRuns(store:ControlStore,runIds:Set<string>):ArtifactRef[] {
 const refs=new Map<string,ArtifactRef>();
 const add=(ref:ArtifactRef|undefined|null)=>{if(ref)refs.set(ref.artifactId+":"+ref.hash,ref);};
 for(const row of store.db.prepare("SELECT run_id,body FROM checkpoints").all()) {
  if(!runIds.has(String(row.run_id)))continue;
  const c=JSON.parse(String(row.body));for(const ref of c.artifacts)add(ref);add(c.snapshot);add(c.stopProof?.source);
 }
 for(const row of store.db.prepare("SELECT run_id,body FROM usage_events").all())if(runIds.has(String(row.run_id)))add(JSON.parse(String(row.body)).source);
 for(const row of store.db.prepare("SELECT id,kind,body FROM outbox WHERE kind IN ('archive','report','acceptance')").all()) {
  const body=JSON.parse(String(row.body));
  const runId=body.runId??(row.kind==="report"?String(row.id).slice("report:".length):null);
  if(!runIds.has(runId))continue;
  for(const ref of body.artifacts??[])add(ref);add(body.snapshot);add(body.source);
 }
 return [...refs.values()].sort((a,b)=>a.artifactId.localeCompare(b.artifactId));
}
export function listGroupArtifacts(store:ControlStore,groupId:string):ArtifactRef[] {
 readGroup(store,groupId);
 return artifactsForRuns(store,new Set(store.db.prepare("SELECT id FROM runs WHERE group_id=?").all(groupId).map(r=>String(r.id))));
}
export function listTaskArtifacts(store:ControlStore,groupId:string,taskId:string):ArtifactRef[] {
 readGroup(store,groupId);
 return artifactsForRuns(store,new Set(store.db.prepare("SELECT id,body FROM runs WHERE group_id=?").all(groupId).filter(row=>JSON.parse(String(row.body)).taskId===taskId).map(row=>String(row.id))));
}
