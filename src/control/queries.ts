import type { ControlStore } from "./store.js";
import type { ArtifactRef, Amount, GroupInput, GroupView, RunView, WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readCanonicalRecord } from "./snapshot.js";
import { controlPlanSchema, type ControlPlanV1 } from "./webProtocol.js";
import { sha256Canonical } from "./canonicalJson.js";
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

export function readArchivedPlan(store: ControlStore, groupId: string): { planHash: string; canonicalJson: string; plan: ControlPlanV1 } {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  let planHash: unknown;
  try { planHash = (JSON.parse(String(row.body)) as { planHash?: unknown }).planHash; }
  catch { throw new ControlError("recovery-blocked"); }
  if (typeof planHash !== "string") throw new ControlError("recovery-blocked");
  const canonicalJson = readCanonicalRecord(store, planHash);
  try {
    const plan = controlPlanSchema.parse(JSON.parse(canonicalJson));
    if (sha256Canonical(plan) !== planHash) throw new ControlError("recovery-blocked");
    return { planHash, canonicalJson, plan };
  } catch (error) {
    if (error instanceof ControlError && error.code === "recovery-blocked") throw error;
    throw new ControlError("recovery-blocked");
  }
}

export function readArchivedContract(store: ControlStore, contractHash: string): { contractHash: string; canonicalJson: string; contract: unknown } {
  const canonicalJson = readCanonicalRecord(store, contractHash);
  try { return { contractHash, canonicalJson, contract: JSON.parse(canonicalJson) }; }
  catch { throw new ControlError("recovery-blocked"); }
}

export interface BudgetProposalRecord {
  proposalVersion: number;
  state: "editable" | "confirmed";
  planHash: string;
  groupLimit: Amount;
  explicitUnallocatedReserve: Amount;
  allocations: unknown[];
}

export function readBudgetProposal(store: ControlStore, groupId: string): BudgetProposalRecord {
  const row = store.db.prepare("SELECT body FROM budget_proposals WHERE group_id=?").get(groupId);
  if (!row) throw new ControlError("recovery-blocked");
  try { return JSON.parse(String(row.body)) as BudgetProposalRecord; }
  catch { throw new ControlError("recovery-blocked"); }
}

export interface EstimateRecord {
  estimateId: string;
  estimateVersion: number;
  state: "queued" | "blocked-capability" | "input-too-large";
  reasonCode: string | null;
}

export function readEstimateRecord(store: ControlStore, groupId: string, estimateId: string): EstimateRecord {
  const row = store.db.prepare("SELECT body FROM estimates WHERE group_id=? AND id=?").get(groupId, estimateId);
  if (!row) throw new ControlError("recovery-blocked");
  try { return JSON.parse(String(row.body)) as EstimateRecord; }
  catch { throw new ControlError("recovery-blocked"); }
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
