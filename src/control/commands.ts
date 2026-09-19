import { createHash } from "node:crypto";
import type { ControlStore } from "./store.js";
import type { Amount, CommandMeta, GroupInput, GroupView, WorkInput } from "./types.js";
import { ControlError } from "./errors.js";
import { amountSchema, commandSchema, groupSchema, idSchema, workSchema } from "./schema.js";
import { allWork, getGroup, readGroup, saveGroup, type GroupRecord } from "./queries.js";
import { controlGraph } from "./graph.js";
export const dimensions = ["tokens","activeMs","attempts","sessions"] as const;
export function zero():Amount {return {tokens:0,activeMs:0,attempts:0,sessions:0};}
export function canonical(value:unknown):string {
  if(value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if(typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if(Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if(typeof value === "object" && Object.getPrototypeOf(value)===Object.prototype) return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical((value as Record<string,unknown>)[k])).join(",")+"}";
  throw new ControlError("control-non-json-payload");
}
export function hashPayload(value:unknown):string {return createHash("sha256").update(canonical(value)).digest("hex");}
export function fits(used:Amount,reserved:Amount,limit:Amount):boolean {
  return dimensions.every(k=>Number.isSafeInteger(used[k]+reserved[k]) && used[k]+reserved[k]<=limit[k]);
}
export function applyCommand<T>(store:ControlStore,groupId:string,meta:CommandMeta,payload:unknown,mutate:()=>T):T {
  idSchema.parse(groupId);commandSchema.parse(meta);
  const hash=hashPayload({groupId,...meta,payload});
  return store.transaction(()=>{
    const previous=store.db.prepare("SELECT payload_hash,result FROM commands WHERE group_id=? AND id=?").get(groupId,meta.commandId);
    if(previous){
      if(previous.payload_hash!==hash) throw new ControlError("command-id-conflict");
      return JSON.parse(String(previous.result)) as T;
    }
    const revision=store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision ?? 0;
    if(revision!==meta.expectedRevision) throw new ControlError("revision-conflict");
    const result=mutate();
    store.db.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(groupId,meta.commandId,hash,JSON.stringify(result));
    return result;
  });
}
export function createGroup(store:ControlStore,input:GroupInput,meta:CommandMeta):GroupView {
  const data=groupSchema.parse(input);
  return applyCommand(store,data.groupId,meta,{verb:"create",body:data},()=>{
    if(store.db.prepare("SELECT id FROM groups WHERE id=?").get(data.groupId)) throw new ControlError("group-already-exists");
    if(!fits(zero(),data.reviewReserve,data.limit)) throw new ControlError("group-budget-unavailable");
    const group:GroupRecord={...data,revision:1,graphVersion:1,stopped:false,status:"draft",used:zero(),reserved:{...data.reviewReserve},reviewRemaining:{...data.reviewReserve},budgetVersion:1};
    store.db.prepare("INSERT INTO groups VALUES (?,?,?,?)").run(group.groupId,group.revision,group.graphVersion,JSON.stringify(group));
    return getGroup(store,group.groupId);
  });
}
export function putWork(store:ControlStore,groupId:string,input:WorkInput,meta:CommandMeta):GroupView {
  const work=workSchema.parse(input) as WorkInput;
  const result=applyCommand(store,groupId,meta,{verb:"put-work",body:work},()=>{
    const group=readGroup(store,groupId);
    const existing=allWork(store,groupId);const old=existing.find(w=>w.workItemId===work.workItemId);
    controlGraph([...existing.filter(w=>w.workItemId!==work.workItemId),work]);
    const active=store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(groupId);
    const auxiliaryAppend = !old && work.kind !== "task";
    if((active && !auxiliaryAppend) || group.proposal){
      group.proposal={work,commandId:meta.commandId};group.stopped=true;group.revision++;saveGroup(store,group);
      return {view:getGroup(store,groupId),rejected:true};
    }
    const record={...work,targetVersion:(old?.targetVersion??0)+1,status:"ready"};
    store.db.prepare("INSERT INTO work_items VALUES (?,?,?,?) ON CONFLICT(group_id,id) DO UPDATE SET target_version=excluded.target_version,body=excluded.body").run(groupId,work.workItemId,record.targetVersion,JSON.stringify(record));
    group.revision++;if(!active || !auxiliaryAppend) group.graphVersion++;group.status="ready";saveGroup(store,group);
    return {view:getGroup(store,groupId),rejected:false};
  });
  if(result.rejected) throw new ControlError("graph-change-needs-handoff");return result.view;
}
export function setGroupStopped(store:ControlStore,groupId:string,stopped:boolean,meta:CommandMeta):GroupView {
  if(typeof stopped!=="boolean") throw new ControlError("control-invalid-stop");
  return applyCommand(store,groupId,meta,{verb:"stop",body:stopped},()=>{
    const group=readGroup(store,groupId);
    if(!stopped && group.proposal) throw new ControlError("graph-change-needs-handoff");
    group.stopped=stopped;group.revision++;saveGroup(store,group);store.db.prepare("INSERT INTO outbox VALUES (?, 'group-handoff', ?, 0) ON CONFLICT(id) DO NOTHING").run(`group-handoff:${groupId}:state:${group.revision}:${group.budgetVersion}`,JSON.stringify({groupId,revision:group.revision,budgetVersion:group.budgetVersion}));return getGroup(store,groupId);
  });
}
export function setGroupLimit(store:ControlStore,groupId:string,limit:Amount,meta:CommandMeta):GroupView {
  amountSchema.parse(limit);
  return applyCommand(store,groupId,meta,{verb:"limit",body:limit},()=>{
    const group=readGroup(store,groupId);
    if(!fits(group.used,group.reserved,limit)) throw new ControlError("group-budget-unavailable");
    group.limit=limit;group.revision++;saveGroup(store,group);store.db.prepare("INSERT INTO outbox VALUES (?, 'group-handoff', ?, 0) ON CONFLICT(id) DO NOTHING").run(`group-handoff:${groupId}:state:${group.revision}:${group.budgetVersion}`,JSON.stringify({groupId,revision:group.revision,budgetVersion:group.budgetVersion}));return getGroup(store,groupId);
  });
}
