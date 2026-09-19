import { randomUUID } from "node:crypto";
import { open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ControlStore } from "./store.js";
import { privateDirectory, syncDirectory } from "./paths.js";
import { readRun } from "./budget.js";
import { readCommittedCheckpoint } from "./checkpoints.js";
import { buildGroupHandoff,buildTaskHandoff } from "./handoff.js";
async function writeProjection(path:string,bytes:Buffer):Promise<void> {
 const dir=privateDirectory(dirname(path)),temp=join(dir,randomUUID()+".tmp");const file=await open(temp,"wx",0o600);
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 await rename(temp,path);syncDirectory(dir);
}
export type ProjectionDependencies={writeProjection?:(path:string,bytes:Buffer)=>Promise<void>};
const publications=new WeakMap<ControlStore,Promise<void>>();
export function publishPending(store:ControlStore,deps:ProjectionDependencies={}):Promise<void> {
 const previous=publications.get(store)??Promise.resolve();
 const result=previous.catch(()=>{}).then(()=>drainPending(store,deps));
 publications.set(store,result);return result;
}
async function drainPending(store:ControlStore,deps:ProjectionDependencies):Promise<void> {
 for(const row of store.db.prepare("SELECT id,kind,body FROM outbox WHERE kind IN ('projection','task-handoff','group-handoff') AND delivered=0 ORDER BY rowid").all()) {
  const reference=JSON.parse(String(row.body));
  if(row.kind==="projection") {const run=readRun(store,reference.runId);if(run.checkpointId===reference.checkpointId) {
   const c=await readCommittedCheckpoint(store,run.runId);
   if(c.checkpointId!==reference.checkpointId) continue;
   await (deps.writeProjection??writeProjection)(join(store.stateDir,"projections",run.runId,"latest.json"),Buffer.from(JSON.stringify({...c,hash:reference.hash})));
  }} else if(row.kind==="task-handoff") {
   const built=await buildTaskHandoff(store,reference.groupId,reference.taskId),data=JSON.parse(built.json.toString());
   if(data.runId===reference.runId&&data.checkpointId===reference.checkpointId&&data.checkpointHash===reference.checkpointHash){const root=join(store.stateDir,"exports","groups",reference.groupId,"tasks",reference.taskId);await (deps.writeProjection??writeProjection)(join(root,"checkpoints",reference.checkpointId+".json"),built.json);await (deps.writeProjection??writeProjection)(join(root,"handoff.md"),built.markdown);}
  } else if(row.kind==="group-handoff") {
   const built=await buildGroupHandoff(store,reference.groupId),data=JSON.parse(built.json.toString());
   if((reference.groupCheckpointId&&data.groupCheckpointId===reference.groupCheckpointId)||(!reference.groupCheckpointId&&data.revision===reference.revision&&data.budgetVersion===reference.budgetVersion)){const root=join(store.stateDir,"exports","groups",reference.groupId);await (deps.writeProjection??writeProjection)(join(root,"checkpoints",data.groupCheckpointId+".json"),built.json);await (deps.writeProjection??writeProjection)(join(root,"handoff.md"),built.markdown);}
  }
  store.transaction(()=>store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(String(row.id)));
 }
}
