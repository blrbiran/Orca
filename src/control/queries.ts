import type { ControlStore } from "./store.js";
import type { Amount, GroupInput, GroupView, RunView, WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
export type GroupRecord = GroupView & GroupInput & {budgetVersion:number;reviewRemaining:Amount;proposal?:{work:WorkInput;commandId:string}};
export type WorkRecord = WorkInput & {targetVersion:number;status:"ready"|"running"|"done"|"blocked"};
export function readGroup(store:ControlStore,id:string):GroupRecord {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(id);
  if (!row) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body));
}
export function saveGroup(store:ControlStore,group:GroupRecord):void {
  store.db.prepare("UPDATE groups SET revision=?,graph_version=?,body=? WHERE id=?").run(group.revision,group.graphVersion,JSON.stringify(group),group.groupId);
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
