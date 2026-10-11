import {recoverControl} from "../../../src/control/recovery.js";
import {expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir,mkdtemp,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openControlStore} from '../../../src/control/store.js';
import {createCcloopExecutionPort} from '../../../src/control/ccloopPort.js';
import {createExecutionProfileRouter,resolveProfile} from '../../../src/control/profiles.js';
import {WebControlService} from '../../../src/control/webService.js';
import {createExecutionDriver,readDriverRun,type ExecutionDriverDeps} from '../../../src/control/executionDriver.js';
import {controlWorkspaceRoots} from '../../../src/control/workspace.js';
import {archiveRun,readArtifact} from '../../../src/control/archive.js';
import {withCommandContext} from '../../../src/control/commandClient.js';
import {hasValidUsageSettlement} from '../../../src/control/usageSettlement.js';
import {readBudgetProposal} from '../../../src/control/queries.js';
const oldOrca=process.env.ORCA_SAVED_RESULT_OLD_ORCA_ROOT??'';
const oldCcloop=join(process.env.ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT??'', 'dist/cli.js');
export const pairedCcloop=process.env.ORCA_SAVED_RESULT_CCLOOP_BIN??'';
const schema11Root=process.env.ORCA_SAVED_RESULT_SCHEMA11_ROOT??'';
export async function schema11Reader(){
 if(!schema11Root||git(schema11Root,'rev-parse','HEAD')!=='f00bfdb797ee3f5de130585557fdf77dc421d535')throw Error('saved-result-schema11-reader-unavailable');
 return import(`${schema11Root}/src/control/store.ts`);
}
const git=(cwd:string,...args:string[])=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/private/tmp/orca-empty-hooks','-c','user.name=fixture','-c','user.email=fixture@invalid',...args],{cwd,encoding:'utf8'}).trim();
export async function savedResultWorld(options:{completeArchive?:boolean;verify?:'approve'|'reject'|'modify'|'delay';optional?:boolean;taskResult?:unknown;currentCapsule?:boolean;timeoutMs?:number}={}) {
 if(!oldOrca||!process.env.ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT||!pairedCcloop)throw Error('saved-result-integration-prerequisites-missing');
 const oldEnv=process.env.ORCA_CCLOOP_BIN,oldTmp=process.env.TMPDIR,short=await mkdtemp('/private/tmp/t7-');process.env.TMPDIR=short;const sourceBinary=options.currentCapsule?pairedCcloop:oldCcloop;process.env.ORCA_CCLOOP_BIN=sourceBinary;
 const producer=(options.optional||options.currentCapsule)?process.cwd():oldOrca;
 const oldWorld=await import(`${producer}/tests/control/fixtures/ccloopWorld.ts`),oldContext=await import(`${producer}/src/control/commandClient.ts`);
 const worlds=oldWorld.ccloopWorlds({rootPrefix:'w-',epochPrefix:'historical'});
 const check=`node -e "const f=require('fs');f.appendFileSync('${join(short,'checks')}', 'check\\n');if(f.readFileSync('answer.txt','utf8')!=='saved candidate\\n')process.exit(1)"`;
 const w=await worlds.world([{taskId:'a',targetPaths:['answer.txt'],requiredChecks:[check]}],{},(options.optional||options.currentCapsule)?{tokenPolicy:'optional-v1',env:{ORCA_CCLOOP_BIN:sourceBinary}}:{});
 if(options.timeoutMs){const path=join(w.root,'contracts/a.json'),contract=JSON.parse(await readFileText(path));contract.executionPolicy.perAttemptTimeoutMs=options.timeoutMs;await writeFile(path,JSON.stringify(contract));}
 const marker=join(w.root,'calls'),fake=join(w.root,'fake.mjs');
 await writeFile(fake,`import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
 if(process.argv.includes('--version')){console.log('9.9.9-fake');process.exit(0)}
 for await(const part of process.stdin){}
 const args=process.argv,s=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8')),phase=s.properties.result?'execute':s.properties.approved?'verify':'plan';
 appendFileSync(${JSON.stringify(marker)},phase+'\\n');
 if(phase==='execute')writeFileSync('answer.txt','saved candidate\\n');
 if(phase==='verify'&&${JSON.stringify(options.verify)}==='delay'){console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}));await new Promise(r=>setTimeout(r,30000));}
 if(phase==='verify'&&${JSON.stringify(options.verify)}==='modify')writeFileSync('answer.txt','modified\\n');
 const result=phase==='plan'?{summary:'save answer',primaryTargetPaths:['answer.txt']}:phase==='execute'?{changedFiles:['answer.txt'],diffPatch:'',commandOutputs:[],stdoutStderrLog:'done',...${JSON.stringify(options.currentCapsule?{unexpected:true}:{})},...${JSON.stringify(options.taskResult===undefined?{}:{taskResult:options.taskResult})}}:{approved:${JSON.stringify(options.verify!=='reject')},rejectCategory:'test_failure',primaryTargetPaths:['answer.txt'],failingCommand:null,safeToRetry:false,evidence:[],pauseSignals:[],stopSignals:[]};
 writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(result));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}));`);
 w.agentsTable.installations.codex.command=[process.execPath,fake];w.agentsTable.installations.codex.timeoutMs=60000;w.agentsTable.installations.codex.killGraceMs=50;await writeFile(w.table,JSON.stringify(w.agentsTable),{mode:0o600});
 let old:any=await w.boot();let store:any=null;
 const oldCommand=(verb:string,payload:unknown)=>oldWorld.raw(old,`old-${verb}`,verb,payload);
 await old.service.setWorkspaceMode(oldWorld.raw(old,'clone','set-workspace-mode',{workspaceMode:'clone'},{kind:'repository',repoId:w.repoId}));
 await oldWorld.startGroup(old,w.repoId,0,async()=>{
  const group=JSON.parse(String(old.store.db.prepare("SELECT body FROM groups WHERE id='g'").get().body)),limit=group.limit;
  const c=oldCommand('set-limit',{limit:{tokens:limit.tokens+30_000_000,activeMs:limit.activeMs+160_000_000,attempts:limit.attempts+30,sessions:limit.sessions+30}});
  expect(await oldContext.withCommandContext(c.commandId,{client:'web',principal:'user:owner'},()=>old.service.setLimit(c))).not.toHaveProperty('error');
 });
 await old.pump();let source:any;
 for(let i=0;i<120;i++) {await old.driver.round();source=oldWorld.workRuns(old).find((x:any)=>x.task==='a')?.body;if(source?.state==='blocked')break;await new Promise(r=>setTimeout(r,50));}
 if(source?.drive?.outcome!=='failed')throw Error(`not historical format failure: ${JSON.stringify(source)}`);
 const input=JSON.parse(await readArtifactEnvelope(old.store,source.drive.envelopeHash)),port=old.port;
 const report=await port.collect(input,0);if(!report.candidate?.stopProof)throw Error('old worker not stopped');
 // Ordinary old result clone is separately archived unchanged; its missing ref remains unavailable.
 await archiveRun(old.store,{runId:source.runId,sourceDir:source.drive.sourceDir,repoDir:join(source.drive.sourceDir,'repo'),stopProof:report.candidate.stopProof});
 if(options.completeArchive!==false&&!options.currentCapsule){
  const runtimeRepo=source.drive.workspacePath,publication=`refs/ccloop/${source.runId}/attempts/1`,head=git(runtimeRepo,'rev-parse',publication);
  await rename(join(source.drive.sourceDir,'repo'),join(w.root,'standard-old-result'));
  const candidate=join(source.drive.sourceDir,'repo');await mkdir(candidate,{mode:0o700});git(candidate,'clone','--mirror',runtimeRepo,join(candidate,'.git'));git(candidate,'config','core.bare','false');git(candidate,'checkout','--detach',publication);
  expect(git(candidate,'rev-parse','HEAD')).toBe(head);
  const complete=await archiveRun(old.store,{runId:source.runId,sourceDir:source.drive.sourceDir,repoDir:candidate,stopProof:report.candidate.stopProof});expect(complete.missing).toEqual([]);
 }
 const historical=old.store.db.prepare("SELECT id,body FROM groups UNION ALL SELECT id,body FROM work_items UNION ALL SELECT id,body FROM runs").all();
 const stateDir=old.store.stateDir,oldDeps=(old.service as any).deps,profile=old.router.list()[0].snapshot;expect(old.store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get().value).toBe((options.optional||options.currentCapsule)?'13':'10');
 w.die(old);old=null;
 let prior:any;
 if(!options.optional&&!options.currentCapsule){
  const reader=await schema11Reader();prior=await reader.openControlStore({stateDir,now:()=>Date.now()});
  expect(prior.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get().value).toBe('11');
  expect(prior.db.prepare("SELECT id,body FROM groups UNION ALL SELECT id,body FROM work_items UNION ALL SELECT id,body FROM runs").all()).toEqual(historical);
  expect(prior.db.prepare("SELECT mode FROM token_policies WHERE group_id='g' AND work_item_id='a'").get().mode).toBe('finite-legacy');
 }
 const tables=prior?.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'meta' ORDER BY name").all().map((r:any)=>String(r.name)),before=tables?.map((t:string)=>prior.db.prepare(`SELECT * FROM ${t}`).all());prior?.close();
 store=await openControlStore({stateDir,now:()=>Date.now()});expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe('13');
 if(tables){const afterTables=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'meta' ORDER BY name").all().map((r:any)=>String(r.name));expect(afterTables.filter((t:string)=>!tables.includes(t))).toEqual(['agent_update_outbox','agent_update_state']);expect(tables.map((t:string)=>store.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);}
 expect(store.db.prepare("SELECT id,body FROM groups UNION ALL SELECT id,body FROM work_items UNION ALL SELECT id,body FROM runs").all()).toEqual(historical);
 expect(store.db.prepare("SELECT mode FROM token_policies WHERE group_id='g' AND work_item_id='a'").get()!.mode).toBe((options.optional||options.currentCapsule)?'optional-v1':'finite-legacy');
 const newPort=createCcloopExecutionPort({binary:pairedCcloop,agentsTablePath:w.table,timeoutMs:60000}),router=createExecutionProfileRouter([resolveProfile(profile,newPort)]);
 const deps:ExecutionDriverDeps={store,router,admissionGate:oldDeps.admissionGate,roots:controlWorkspaceRoots(stateDir),resolveRepository:()=>w.repo,ccloopBin:pairedCcloop,agentsTablePath:w.table};
 await recoverControl(store,newPort,undefined,{driverOwnsWebRuns:true});
 const service=new WebControlService({...oldDeps,store,profileRouter:router,port:newPort});
 let sequence=0;const command=(verb:string,payload:unknown,target:any={kind:'group',groupId:'g'})=>({schema:'orca-raw-command-v1',commandId:`new-${++sequence}`,actorId:'human',verb,target,payload,expectedRevision:Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision)} as any);
 const settleCommand=command('settle-unknown-usage',{taskId:'a',runId:source.runId,generation:1,acknowledge:'charge-remaining-grant'});
 if(!options.currentCapsule){const settlement=await withCommandContext(settleCommand.commandId,{client:'web',principal:'user:owner'},()=>service.settleUnknownUsage(settleCommand));expect(settlement).not.toHaveProperty('error');expect(hasValidUsageSettlement(store,readDriverRun(store,source.runId))).toBe(true);}
 process.env.ORCA_CCLOOP_BIN=oldEnv;if(oldEnv===undefined)delete process.env.ORCA_CCLOOP_BIN;
 const cleanup=async()=>{store?.close();await w.teardown();await worlds.removeRoots();await rm(short,{recursive:true,force:true});if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;};
 return {w,store,service,deps,source:readDriverRun(store,source.runId),driver:createExecutionDriver(deps),command,marker,checks:join(short,'checks'),calls:()=>existsSync(marker)?readFileSync(marker,'utf8').trim().split('\n'):[],cleanup};
}
async function readArtifactEnvelope(store:any,hash:string){const {readCanonicalRecord}=await import('../../../src/control/snapshot.js');return readCanonicalRecord(store,hash);}

async function readFileText(path:string){return (await import("node:fs/promises")).readFile(path,"utf8");}
