import { randomUUID } from "node:crypto";
import { open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ControlStore } from "./store.js";
import { privateDirectory, syncDirectory } from "./paths.js";
import { readRun } from "./budget.js";
import { readCommittedCheckpoint } from "./checkpoints.js";
async function writeProjection(path:string,bytes:Buffer):Promise<void> {
 const dir=privateDirectory(dirname(path)),temp=join(dir,randomUUID()+".tmp");const file=await open(temp,"wx",0o600);
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 await rename(temp,path);syncDirectory(dir);
}
export async function publishPending(store:ControlStore,deps:{writeProjection?:(path:string,bytes:Buffer)=>Promise<void>}={}):Promise<void> {
 for(const row of store.db.prepare("SELECT id,body FROM outbox WHERE kind='projection' AND delivered=0 ORDER BY rowid").all()) {
  const reference=JSON.parse(String(row.body));const run=readRun(store,reference.runId);
  if(run.checkpointId===reference.checkpointId) {
   const c=await readCommittedCheckpoint(store,run.runId);
   await (deps.writeProjection??writeProjection)(join(store.stateDir,"projections",run.runId,"latest.json"),Buffer.from(JSON.stringify({...c,hash:reference.hash})));
  }
  store.transaction(()=>store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(String(row.id)));
 }
}
