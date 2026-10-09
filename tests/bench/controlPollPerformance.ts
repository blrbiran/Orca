import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { buildControlPollFixture, openExistingControlPollFixture, assertMeasurementCoverage, performanceRoot, type ControlPollFixture } from "../control/fixtures/controlPollPerformance.js";
import { installControlReadCounters, type ReadCounters } from "../control/fixtures/controlReadCounters.js";
import { readControlSummary, readControlGroup } from "../../src/panel/controlViews.js";
import { readProjectionState, projectionJournalRetention } from "../../src/control/projectionJournal.js";
import { recordActivity } from "../../src/control/activity.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { createWebWakeHandlers, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes, type WakeHandlers, type SchedulerWakeKind } from "../../src/control/dispatch.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import type { ControlStore } from "../../src/control/store.js";

export function normalizeOutput(value:unknown,ids:ReadonlyMap<string,string>):unknown {
 if(typeof value==="string") {let normalized=value;for(const [id,key] of ids) normalized=normalized.replaceAll(id,key);return normalized;}
 if(Array.isArray(value))return value.map(v=>normalizeOutput(v,ids));
 if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeOutput(v,ids)]));
 return value;
}
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
type SavedTable={name:string;rows:Record<string,any>[]};
export function captureDatabase(store:ControlStore):SavedTable[] {
 return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name='sqlite_sequence',name").all().map(r=>({name:String(r.name),rows:store.db.prepare(`SELECT rowid AS __rowid,* FROM ${quote(String(r.name))} ORDER BY rowid`).all().map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Uint8Array?{__blob:Buffer.from(v).toString("base64")}:v])))}));
}
export function restoreDatabase(store:ControlStore,tables:SavedTable[]):void {
 store.db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
 try {for(const t of tables)store.db.exec(`DELETE FROM ${quote(t.name)}`);
 for(const t of tables) {if(t.name==="sqlite_sequence")store.db.exec("DELETE FROM sqlite_sequence");if(!t.rows.length)continue;const keys=Object.keys(t.rows[0]);const statement=store.db.prepare(`INSERT INTO ${quote(t.name)} (${keys.map(k=>quote(k==="__rowid"?"rowid":k)).join(",")}) VALUES (${keys.map(()=>"?").join(",")})`);
 for(const row of t.rows)statement.run(...keys.map(k=>row[k] && typeof row[k]==="object" && "__blob" in row[k]?Buffer.from(row[k].__blob,"base64"):row[k]));}
 store.db.exec("COMMIT");store.dispatchBlocked=false;
 }catch(error){store.db.exec("ROLLBACK");throw error;}finally{store.db.exec("PRAGMA foreign_keys=ON");}
}
export function summarizeCounters(c:ReadCounters) {
 const targetSQL=(sql:string)=>/SELECT .*body FROM (work_items|runs)\b/.test(sql)||/FROM activity.*JOIN runs/.test(sql);
 const aggregate=(rows:ReadCounters["executions"])=>{const result=new Map<string,{sql:string;method:string;executions:number;rows:number}>();for(const row of rows){const key=`${row.method}:${row.sql}`,r=result.get(key)??{sql:row.sql,method:row.method,executions:0,rows:0};r.executions++;r.rows+=row.rows;result.set(key,r);}return [...result.values()];};
 const parses=[...c.parses].map(([bucket,count])=>({aliases:bucket.split("|"),count})), groupParses=[...c.groupParses].map(([bucket,count])=>({aliases:bucket.split("|"),count}));
 return {prepares:c.prepares.length,executions:c.executions.length,rows:c.executions.reduce((n,r)=>n+r.rows,0),targetPrepares:c.prepares.filter(r=>targetSQL(r.sql)),target:aggregate(c.executions.filter(r=>targetSQL(r.sql))),remaining:aggregate(c.executions.filter(r=>!targetSQL(r.sql))),targetBodyParses:parses.filter(r=>r.aliases.every(a=>a.startsWith("work_items:")||a.startsWith("runs:"))).reduce((n,r)=>n+r.count,0),groupBodyParses:groupParses.reduce((n,r)=>n+r.count,0),parses,groupParses,aliasBuckets:parses.filter(r=>r.aliases.length>1),groupAliasBuckets:groupParses.filter(r=>r.aliases.length>1)};
}
const sameIds=(actual:readonly {groupId:string}[],expected:readonly string[])=>assert.deepEqual(actual.map(g=>g.groupId).sort(),[...expected].sort());
const epoch="performance-fixed-epoch",now=1791518400000;
type Workload={name:string;prepare:()=>void;run:(handlers:WakeHandlers)=>unknown|Promise<unknown>;validate:(result:any)=>void;scope:Record<string,unknown>};
export function makeWorkloads(f:ControlPollFixture):Workload[] {
 const store=f.store,all=[...f.liveGroupIds,...f.archivedGroupIds];let cursor=0;
 const full=(r:any)=>{assert.equal(r.resetRequired,true);sameIds(r.groups,all);};
 const insertWake=(groupId:string)=>store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)").run(`mixed:${groupId}`,groupId,JSON.stringify({groupId,startRevision:3}));
 return [
 {name:"full-reset",prepare(){},run:()=>readControlSummary(store,epoch,null),validate:full,scope:{groups:200,liveTasks:5000,archivedTasks:100,resetRequired:true}},
 {name:"forced-reset",prepare(){cursor=readProjectionState(store).changeSeq;},run:()=>readControlSummary(store,epoch,cursor,true),validate:full,scope:{groups:200,liveTasks:5000,archivedTasks:100,resetRequired:true,forceComplete:true}},
 {name:"retention-reset",prepare(){cursor=readProjectionState(store).changeSeq;for(let i=0;i<projectionJournalRetention+1;i++)store.transaction(()=>recordActivity(store,{groupId:f.liveGroupIds[0],kind:"command",body:{retention:i}}));},run:()=>readControlSummary(store,epoch,cursor),validate:full,scope:{groups:200,liveTasks:5000,archivedTasks:100,resetRequired:true,transactions:projectionJournalRetention+1}},
 {name:"all-live-changed-incremental",prepare(){cursor=readProjectionState(store).changeSeq;store.transaction(()=>{for(const groupId of f.liveGroupIds)recordActivity(store,{groupId,kind:"command",body:{benchmark:"changed"}});});assert.equal(readProjectionState(store).changeSeq,cursor+1);},run:()=>readControlSummary(store,epoch,cursor),validate(r){assert.equal(r.resetRequired,false);sameIds(r.groups,f.liveGroupIds);},scope:{groups:100,tasks:5000,resetRequired:false,changeTransactions:1,changedGroups:100}},
 {name:"empty-incremental",prepare(){cursor=readProjectionState(store).changeSeq;},run:()=>readControlSummary(store,epoch,cursor),validate(r){assert.equal(r.resetRequired,false);assert.deepEqual(r.groups,[]);},scope:{groups:0,tasks:0,resetRequired:false}},
 {name:"one-group-detail",prepare(){},run:()=>readControlGroup(store,epoch,f.liveGroupIds[0]),validate(r){assert.equal(r.workItems.length,50);assert.equal(r.runs.length,1);},scope:{groups:1,tasks:50,currentRuns:1}},
 {name:"all-live-detail",prepare(){},run:()=>f.liveGroupIds.map(id=>readControlGroup(store,epoch,id)),validate(r){assert.equal(r.length,100);for(const view of r){assert.equal(view.workItems.length,50);assert.equal(view.runs.length,1);}},scope:{groups:100,tasks:5000,currentRuns:100}},
 {name:"replenish",prepare(){},run:()=>replenishStartWakes(f.driverDeps),validate(r){assert.deepEqual(r,["drive:live-000:1"]);},scope:{scannedGroups:200,armedGroups:1,armedTask:"t01"}},
 {name:"archived-only-pump",prepare(){},run:h=>deliverSchedulerWakes(store,h),validate(r){assert.deepEqual(r.delivered,[]);assert.equal(r.deferred.length,300);},scope:{pendingWakes:300,archivedGroups:100,kinds:["start","no-start","resume"]}},
 {name:"mixed-pump",prepare(){for(const id of f.liveGroupIds.slice(1))insertWake(id);},run:h=>deliverSchedulerWakes(store,h),validate(r){assert.deepEqual(r.delivered,f.liveGroupIds.slice(1).map(id=>`mixed:${id}`));assert.equal(r.deferred.length,300);},scope:{pendingWakes:399,archivedGroups:100,liveGroups:99,existingCurrentRuns:99}}
 ];
}
function hooks(f:ControlPollFixture) {
 let handler=0,probe=0,accept=0;
 const router=f.wakeDeps.profileRouter,actual=createWebWakeHandlers({...f.wakeDeps,profileRouter:{...router,probe:async(...args:Parameters<typeof router.probe>)=>{probe++;return router.probe(...args);}}});
 const handlers:WakeHandlers={};for(const [kind,fn] of Object.entries(actual))handlers[kind as SchedulerWakeKind]=async w=>{handler++;return fn!(w);};
 // These workloads call dispatch, not driver.accept; wrap the port as a guard against accidental provider entry.
 const port=f.service.deps.port as ExecutionPort,original=port.accept;port.accept=async(...args)=>{accept++;return original.apply(port,args);};
 return {handlers,reset(){handler=0;probe=0;accept=0;},snapshot:()=>({handler,probe,accept}),restore(){port.accept=original;}};
}
function assertOptimizedBounds(c:ReadCounters,name:string,f:ControlPollFixture) {
 const groups=name==="one-group-detail"?1:name==="empty-incremental"?0:100;
 if(["full-reset","forced-reset","retention-reset","all-live-changed-incremental","empty-incremental","one-group-detail","all-live-detail"].includes(name)) {
 for(const table of ["work_items","runs"]){const rows=c.executions.filter(r=>new RegExp(`SELECT .*body FROM ${table}\\b`).test(r.sql));assert.equal(rows.filter(r=>r.method==="get").length,0);assert.equal(rows.filter(r=>r.method==="all"&&/WHERE group_id=\?/.test(r.sql)).length,name.endsWith("reset")?200:groups);}
 const count=summarizeCounters(c);assert.ok(count.targetBodyParses<=(name.endsWith("reset")?5200:groups*51));for(const p of count.parses.filter(r=>r.aliases.every(a=>a.startsWith("work_items:")||a.startsWith("runs:"))))assert.ok(p.count<=p.aliases.length,JSON.stringify(p));
 }
 if(name==="archived-only-pump"){assert.equal(summarizeCounters(c).groupBodyParses,100);assert.equal(c.executions.filter(r=>r.method==="get"&&r.sql==="SELECT body FROM groups WHERE id=?").length,100);}
}
async function main() {
 const args=process.argv.slice(2),arg=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
 const output=resolve(arg("--output","/private/tmp/od9/performance-results")),warmup=Number(arg("--warmup","10")),samples=Number(arg("--samples","30")),snapshotPath=join(performanceRoot(),"initial-database.json");
 assert.ok(Number.isSafeInteger(warmup)&&warmup>=0&&Number.isSafeInteger(samples)&&samples>0);
 await mkdir(output,{recursive:true,mode:0o700});
 let f:ControlPollFixture;
 if(args.includes("--seed")){f=await buildControlPollFixture({liveGroups:100,archivedGroups:100,tasksPerGroup:50,now});await writeFile(snapshotPath,JSON.stringify(captureDatabase(f.store)),{mode:0o600});}else f=await openExistingControlPollFixture(now);
 try {
 const initial=JSON.parse(await readFile(snapshotPath,"utf8")) as SavedTable[];restoreDatabase(f.store,initial);assertMeasurementCoverage(f);
 const initialDigest=sha(captureDatabase(f.store));assert.equal(initialDigest,sha(initial));
 if(args.includes("--seed-only")){console.log(JSON.stringify({seedOnly:true,initialDigest,manifest:f.manifest(),snapshot:snapshotPath}));return;}
 const manifest=f.manifest(),workloads=makeWorkloads(f),observations:any[]=[];
 // Install before any view or pump, including the first cached statement creation. Counter pass is separate.
 const counter=installControlReadCounters(f.store),h=hooks(f);
 try {for(const w of workloads){restoreDatabase(f.store,initial);w.prepare();counter.reset();h.reset();const value=await w.run(h.handlers);w.validate(value);const counts=counter.snapshot(),callCounts=h.snapshot();if(args.includes("--expect-optimized")){assertOptimizedBounds(counts,w.name,f);if(w.name==="archived-only-pump")assert.deepEqual(callCounts,{handler:0,probe:0,accept:0});if(w.name==="mixed-pump")assert.equal(callCounts.handler,99);}
 observations.push({name:w.name,scope:w.scope,counters:summarizeCounters(counts),calls:callCounts,output:normalizeOutput(value,f.canonicalRunIds),outputDigest:sha(normalizeOutput(value,f.canonicalRunIds)),effect:{pending:storePending(f.store),runs:f.manifest().runs}});}}
 finally{counter.restore();h.restore();}
 let replayEvidence:unknown=null;
 const replayPath=arg("--replay","");
 if(replayPath){
  const previous=JSON.parse(await readFile(replayPath,"utf8"));
  const traceBytes=await readFile(arg("--trace-log",""));
  const sourceBytes=await readFile(arg("--source-manifest",""));
  const source=JSON.parse(sourceBytes.toString("utf8")),side=arg("--side","");
  assert.ok(side==="before"||side==="after");assert.equal(previous.initialDigest,initialDigest);
  const clone=source.clones[side];assert.equal(execFileSync("/usr/bin/git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),clone.commit);
  assert.equal(execFileSync("/usr/bin/git",["diff","--","src"],{encoding:"utf8"}),"");
  for(const [path,hash] of Object.entries(clone.productionSHA256))assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"),hash);
  const originalHarness=await readFile(arg("--original-harness",""));assert.equal(createHash("sha256").update(originalHarness).digest("hex"),source.tools["tests/bench/controlPollPerformance.ts"]);
  for(const path of ["tests/control/fixtures/controlPollPerformance.ts","tests/control/fixtures/controlReadCounters.ts"])assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"),source.tools[path]);
  const trace:any[]=[];for(const line of traceBytes.toString("utf8").split("\n")){try{const value=JSON.parse(line);if(value.phase||value.timing)trace.push(value);}catch{/* Native warnings/assertion text is retained in the SHA-bound full log. */}}
  assert.deepEqual([...new Set(trace.filter(row=>row.phase).map(row=>row.name))],workloads.map(w=>w.name));
  assert.equal(previous.observations.length,observations.length);
  for(const row of observations){
   const old=previous.observations.find((o:any)=>o.name===row.name);assert.ok(old);assert.deepEqual(row.scope,old.scope);assert.equal(row.outputDigest,old.outputDigest);assert.deepEqual(row.effect,old.effect);assert.deepEqual(row.counters,old.counters);assert.deepEqual(row.calls,old.calls);
   const warm=trace.filter(value=>value.name===row.name&&value.phase==="warmup"),sample=trace.filter(value=>value.name===row.name&&value.phase==="sample"),summary=trace.filter(value=>value.name===row.name&&value.timing);
   assert.deepEqual(warm.map(value=>value.index),Array.from({length:10},(_,i)=>i+1));assert.deepEqual(sample.map(value=>value.index),Array.from({length:30},(_,i)=>i+1));assert.equal(summary.length,1);
   assert.equal(old.timing.warmup,10);assert.equal(old.timing.samples,30);assert.deepEqual(sample.map(value=>value.ms),old.timing.rawMs);assert.deepEqual(summary[0].timing,old.timing);assert.equal(summary[0].outputDigest,row.outputDigest);assert.deepEqual(summary[0].calls,row.calls);
   const sorted=[...old.timing.rawMs].sort((a:number,b:number)=>a-b);assert.equal(old.timing.min,sorted[0]);assert.equal(old.timing.max,sorted.at(-1));assert.equal(old.timing.p50,sorted[14]);assert.equal(old.timing.p95,sorted[28]);row.timing=old.timing;
  }
  replayEvidence={mode:"fresh-untimed-replay-of-historical-timings",historicalCLIrc:side==="before"?0:1,side,progressPath:replayPath,progressSHA256:createHash("sha256").update(await readFile(replayPath)).digest("hex"),traceLog:arg("--trace-log",""),traceSHA256:createHash("sha256").update(traceBytes).digest("hex"),sourceManifestSHA256:createHash("sha256").update(sourceBytes).digest("hex"),originalProductCommit:clone.commit,originalToolSHA256:source.tools,initialDigest};
  console.log(JSON.stringify({replayVerified:true,replayEvidence,workloads:observations.map(row=>({name:row.name,outputDigest:row.outputDigest,scope:row.scope,calls:row.calls}))}));
 }else{
 const actualHandlers=createWebWakeHandlers(f.wakeDeps);
 for(const w of workloads){const raw:number[]=[],expected=observations.find(o=>o.name===w.name);for(let i=0;i<warmup+samples;i++){restoreDatabase(f.store,initial);assert.equal(sha(captureDatabase(f.store)),initialDigest);w.prepare();const begin=performance.now();const value=await w.run(actualHandlers);const ms=performance.now()-begin;w.validate(value);assert.equal(sha(normalizeOutput(value,f.canonicalRunIds)),expected.outputDigest);assert.deepEqual({pending:storePending(f.store),runs:f.manifest().runs},expected.effect);if(i>=warmup)raw.push(ms);console.log(JSON.stringify({phase:i<warmup?"warmup":"sample",name:w.name,index:i<warmup?i+1:i-warmup+1,ms}));}
 const sorted=[...raw].sort((a,b)=>a-b),q=(p:number)=>sorted[Math.ceil(p*sorted.length)-1];expected.timing={warmup,samples,rawMs:raw,min:sorted[0],max:sorted.at(-1),p50:q(.5),p95:q(.95)};console.log(JSON.stringify({name:w.name,timing:expected.timing,outputDigest:expected.outputDigest,calls:expected.calls}));await writeFile(join(output,"timing-progress.json"),JSON.stringify({complete:false,initialDigest,observations:observations.map(({output,...row})=>row)},null,2),{mode:0o600});}
 }
 restoreDatabase(f.store,initial);
 const refusals:any[]=[];for(const groupId of f.archivedGroupIds)refusals.push({case:"archived-blocked",groupId,result:await deliverScheduledStart(f.wakeDeps,groupId)});
 for(const kind of ["invalid-work-and-run","invalid-run","invalid-archive-mark"]) {
  restoreDatabase(f.store,initial);const groupId=kind==="invalid-archive-mark"?f.archivedGroupIds[0]:f.liveGroupIds[1];
  if(kind==="invalid-archive-mark"){const row=f.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;const body=JSON.parse(String(row.body));body.archived={at:"invalid",by:"human"};f.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body),groupId);}
  else {const row=f.store.db.prepare("SELECT id,body FROM runs WHERE group_id=?").get(groupId)!;const run=JSON.parse(String(row.body));run.workItemId="foreign";f.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run),row.id);if(kind==="invalid-work-and-run"){const row=f.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='t00'").get(groupId)!;const work=JSON.parse(String(row.body));work.dependsOn="invalid";f.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='t00'").run(JSON.stringify(work),groupId);}}
  let error:any;try{if(kind==="invalid-archive-mark")await deliverScheduledStart(f.wakeDeps,groupId);else readControlGroup(f.store,epoch,groupId);}catch(e){error=e;}
  assert.ok(error,`${kind} must refuse`);refusals.push({case:kind,error:{name:error.name,message:error.message,code:error.code??null,detail:error.detail??null}});
 }
 restoreDatabase(f.store,initial);
 const git=(...a:string[])=>execFileSync("/usr/bin/git",a,{encoding:"utf8"});
 const report={replayEvidence,command:[process.execPath,...process.argv.slice(1)],commit:git("rev-parse","HEAD").trim(),dirtyDiff:git("diff","--binary"),untracked:git("ls-files","--others","--exclude-standard"),runtime:{node:process.version,sqlite:f.store.db.prepare("SELECT sqlite_version() AS version").get()!.version,platform:platform(),release:release(),cpu:cpus()[0].model,cores:cpus().length,orcaCcloopBin:process.env.ORCA_CCLOOP_BIN,agentsTable:process.env.ORCA_AGENTS_TABLE,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME,XDG_CACHE_HOME:process.env.XDG_CACHE_HOME,XDG_DATA_HOME:process.env.XDG_DATA_HOME,XDG_STATE_HOME:process.env.XDG_STATE_HOME,CCMEM_DATA_ROOT:process.env.CCMEM_DATA_ROOT,ORCA_CORRECTIONS_DIR:process.env.ORCA_CORRECTIONS_DIR},paths:{root:performanceRoot(),repo:join(performanceRoot(),"repo"),snapshot:snapshotPath},manifest,archivedTasks:Number(f.store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE group_id LIKE 'archive-%'").get()!.n),initialDigest,refusals,refusalDigest:sha(normalizeOutput(refusals,f.canonicalRunIds)),observations};
 if(args.includes("--compare")){const before=JSON.parse(await readFile(arg("--compare",""),"utf8"));assert.deepEqual(report.manifest,before.manifest);assert.equal(report.initialDigest,before.initialDigest);assert.deepEqual(report.paths,before.paths);assert.equal(report.refusalDigest,before.refusalDigest);for(const row of observations){const b=before.observations.find((o:any)=>o.name===row.name);assert.ok(b);assert.deepEqual(row.scope,b.scope);assert.equal(row.outputDigest,b.outputDigest);assert.deepEqual(row.effect,b.effect);}}
 const canonicalOutputs=report.observations.map(row=>({name:row.name,output:row.output}));
 await writeFile(join(output,"canonical-outputs.json.gz"),gzipSync(JSON.stringify({observations:canonicalOutputs,refusals:report.refusals})),{mode:0o600});
 for(const row of report.observations){delete row.output;row.canonicalOutputFile="canonical-outputs.json.gz";}
 await writeFile(join(output,"result.json"),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({result:join(output,"result.json"),manifest,initialDigest,refusalDigest:report.refusalDigest,equivalent:args.includes("--compare")}));
 }finally{await f.dispose();}
}
export function storePending(store:ControlStore){return store.db.prepare("SELECT id,group_id,kind,body,delivered FROM scheduler_wakes ORDER BY rowid").all().map(row=>({...row}));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
