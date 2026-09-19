import type { ControlStore } from "./store.js";
import type { ArtifactRef, Amount, GroupInput, GroupView, RunView, WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
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
export function allWork(store:ControlStore,groupId:string):WorkRecord[] {
  return store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY id").all(groupId).map(r=>JSON.parse(String(r.body)));
}
export function getRun(store:ControlStore,id:string):RunView {
  const row=store.db.prepare("SELECT body FROM runs WHERE id=?").get(id);
  if(!row) throw new ControlError("run-not-found");
  const r=JSON.parse(String(row.body));
  return {runId:r.runId,generation:r.generation,executionId:r.executionId,state:r.state,checkpointId:r.checkpointId,recoverable:r.recoverable};
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
