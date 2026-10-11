import {currentSavedResultSource} from "../../src/control/savedResultRecovery.js";
import {describe,it as test,expect} from 'vitest';
import {savedResultWorld,schema11Reader} from './fixtures/savedResultWorld.js';
import {readDriverRun,readStartEnvelope,replenishStartWakes} from '../../src/control/executionDriver.js';

const it=test.skipIf(process.env.ORCA_SAVED_RESULT_VERIFY!=='1');
describe.skipIf(process.env.ORCA_SAVED_RESULT_VERIFY!=='1')('genuine schema10 owner → paired saved verification',()=>{
 it('keeps the standard old detached archive unavailable after real owner settlement',async()=>{
  const f=await savedResultWorld({completeArchive:false});try{expect(await f.service.savedResultEligibility(f.source.runId)).toMatchObject({status:'unavailable',reason:'saved-result-legacy-ref-missing'});expect(f.calls()).toEqual(['plan','execute']);}finally{await f.cleanup();}
 },60000);
 it('reserves a distinct linked verifier run, skips plan/execute, books only new usage and lands normally',async()=>{
  const f=await savedResultWorld();try{
   currentSavedResultSource(f.store,f.source.runId);
   const eligible=await f.service.savedResultEligibility(f.source.runId);expect(eligible.status).toBe('eligible');if(eligible.status!=='eligible')throw Error(JSON.stringify(eligible));
   const old=readDriverRun(f.store,f.source.runId),oldUsed=(old.cumulative as any).work;
   const c=f.command('verify-saved-result',{sourceRunId:old.runId,sourceAttempt:1,capsuleHash:eligible.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'});
   const result=await f.service.verifySavedResult(c);expect(result).not.toHaveProperty('error');if(!('result' in result)||result.result.kind!=='saved-result-verification-started')throw Error(JSON.stringify(result));
   const id=result.result.runId;expect(id).not.toBe(old.runId);expect(await f.service.verifySavedResult(c)).toEqual(result);
   for(let i=0;i<120;i++){await f.driver.round();if(readDriverRun(f.store,id).state==='settled')break;await new Promise(r=>setTimeout(r,50));}
   const newRun=readDriverRun(f.store,id);expect(newRun.state).toBe('settled');expect(newRun.recoveryOf).toEqual(eligible.recoveryOf);expect((newRun.cumulative as any).work).toMatchObject({tokens:15,attempts:1,sessions:1});
   expect((newRun.savedRecovery as any).funding.inheritedUsage).toEqual(oldUsed);expect(f.calls()).toEqual(['plan','execute','verify']);expect(readFileSync(f.checks,'utf8')).toBe('check\n');expect(readDriverRun(f.store,old.runId).drive?.outcome).toBe('failed');expect((readDriverRun(f.store,old.runId).cumulative as any).work).toEqual(oldUsed);expect(f.w.show('answer.txt')).toBe('saved candidate');
  }finally{await f.cleanup();}
 },60000);
});

import {existsSync,readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {WebControlService} from '../../src/control/webService.js';
import {withCommandContext} from '../../src/control/commandClient.js';
import {readControlGroup} from '../../src/panel/controlViews.js';

async function admit(f:Awaited<ReturnType<typeof savedResultWorld>>){const evidence=await f.service.savedResultEligibility(f.source.runId);if(evidence.status!=='eligible')throw Error(JSON.stringify(evidence));const c=f.command('verify-saved-result',{sourceRunId:f.source.runId,sourceAttempt:evidence.recoveryOf.sourceAttempt,capsuleHash:evidence.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'});const result=await f.service.verifySavedResult(c);if(!('result' in result)||result.result.kind!=='saved-result-verification-started')throw Error(JSON.stringify(result));return {id:result.result.runId,command:c,evidence};}
async function driveUntil(f:Awaited<ReturnType<typeof savedResultWorld>>,predicate:()=>boolean){for(let i=0;i<150&&!predicate();i++){await f.driver.round();await new Promise(r=>setTimeout(r,30));}if(!predicate())throw Error('driver predicate failed');}

it('fences the actual immutable old11 owner before any unprepared saved run can dispatch',async()=>{
 const f=await savedResultWorld();try{
  const {id}=await admit(f),run=readDriverRun(f.store,id);expect(run.state).toBe('starting');expect(run.drive?.prepared).not.toBe(true);expect(f.calls()).toEqual(['plan','execute']);
  const stateDir=f.store.stateDir;f.store.close();const before=readFileSync(join(stateDir,'control.sqlite')),reader=await schema11Reader();
  await expect(reader.openControlStore({stateDir})).rejects.toThrow('control-schema-unsupported');
  expect(readFileSync(join(stateDir,'control.sqlite'))).toEqual(before);expect(f.calls()).toEqual(['plan','execute']);
 }finally{await f.cleanup();}
},60000);

it('rechecks the actual revision and current membership when ordinary retry wins async preparation',async()=>{
 const f=await savedResultWorld();try{
  let ready!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>ready=r),held=new Promise<void>(r=>release=r),router=f.deps.router;
  const delayed=new WebControlService({... (f.service as any).deps,profileRouter:{...router,probe:async(...args:any[])=>{ready();await held;return (router.probe as any)(...args);}}});
  const e=await f.service.savedResultEligibility(f.source.runId);if(e.status!=='eligible')throw Error(JSON.stringify(e));const c=f.command('verify-saved-result',{sourceRunId:f.source.runId,sourceAttempt:1,capsuleHash:e.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'});
  const pending=delayed.verifySavedResult(c);await entered;expect(f.service.retryTask(f.command('retry-task',{taskId:'a'}))).not.toHaveProperty('error');release();expect(await pending).toHaveProperty('error.code','revision-conflict');
  expect(f.store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.mode')='verify-saved-result'").all()).toEqual([]);expect(f.calls()).toEqual(['plan','execute']);
 }finally{await f.cleanup();}
},60000);

it('refuses the actual current spend cap without a run or commitment leak',async()=>{
 const f=await savedResultWorld();try{
  const cap=f.command('set-spend-cap',{scope:'all',period:'total',tokens:1},{kind:'spend'});cap.expectedRevision=0;
  expect(withCommandContext(cap.commandId,{client:'web',principal:'user:owner'},()=>f.service.setSpendCap(cap))).not.toHaveProperty('error');
  const before=f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get(),e=await f.service.savedResultEligibility(f.source.runId);if(e.status!=='eligible')throw Error(JSON.stringify(e));
  const c=f.command('verify-saved-result',{sourceRunId:f.source.runId,sourceAttempt:1,capsuleHash:e.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'});expect(await f.service.verifySavedResult(c)).toHaveProperty('error.code','saved-result-unavailable');
  expect(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()).toEqual(before);expect(f.store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.mode')='verify-saved-result'").all()).toEqual([]);expect(f.calls()).toEqual(['plan','execute']);
 }finally{await f.cleanup();}
},60000);

it.each(['reject','modify'] as const)('ends %s without executor retry, landing or an interrupted-source exception',async verify=>{
 const f=await savedResultWorld({verify});try{
  const {id}=await admit(f);await driveUntil(f,()=>readDriverRun(f.store,id).state==='blocked');const run=readDriverRun(f.store,id);
  expect(f.calls()).toEqual(['plan','execute','verify']);expect(f.w.landings()).toBe(0);expect(run.savedInterruption).toBeUndefined();expect((await f.service.savedResultEligibility(f.source.runId)).status).toBe('unavailable');expect(readDriverRun(f.store,f.source.runId).drive?.outcome).toBe('failed');
  if(verify==='modify')expect(run.drive?.stopReason).toBe('Error: saved-result-modified-during-verification');
 }finally{await f.cleanup();}
},60000);

it.each(['before-entry','usage-settled'] as const)('mechanically reaps %s and admits a new explicit successor with each inherited WORK charge once',async point=>{
 const f=await savedResultWorld();let worker:number|undefined;
 const keys=['CCLOOP_CONTROL_TEST_CRASH_POINT','CCLOOP_CONTROL_TEST_CRASH_MARKER'] as const,saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  const marker=join(f.w.root,'crash-ready');process.env.CCLOOP_CONTROL_TEST_CRASH_POINT=`saved-result-${point}`;process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER=marker;
  const first=await admit(f);await driveUntil(f,()=>existsSync(marker));const run=readDriverRun(f.store,first.id);worker=JSON.parse(readFileSync(join(run.drive!.sourceDir,'control/accepted.json'),'utf8')).worker.pid;
  process.kill(worker!,'SIGKILL');worker=undefined;delete process.env.CCLOOP_CONTROL_TEST_CRASH_POINT;delete process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER;
  await driveUntil(f,()=>readDriverRun(f.store,first.id).state==='blocked');const interrupted=readDriverRun(f.store,first.id);expect(interrupted.savedInterruption).toBeTruthy();expect(interrupted.unknown).toEqual({work:false,handoff:false});
  const calls=f.calls();expect(await f.service.verifySavedResult(first.command)).toHaveProperty('result.runId',first.id);expect(f.calls()).toEqual(calls);
  const second=await admit(f);await driveUntil(f,()=>readDriverRun(f.store,second.id).state==='settled');const recovered=readDriverRun(f.store,second.id),a=(interrupted.cumulative as any).work,b=(f.source.cumulative as any).work;
  expect((recovered.savedRecovery as any).funding.inheritedUsage).toEqual({tokens:a.tokens+b.tokens,activeMs:a.activeMs+b.activeMs,attempts:a.attempts+b.attempts,sessions:a.sessions+b.sessions});expect((recovered.cumulative as any).work).toMatchObject({tokens:15,attempts:1,sessions:1});expect(f.calls()).toEqual(point==='before-entry'?['plan','execute','verify']:['plan','execute','verify','verify']);expect(readDriverRun(f.store,f.source.runId).drive?.outcome).toBe('failed');
 }finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}if(worker)try{process.kill(worker,'SIGKILL');}catch{}await f.cleanup();}
},60000);

it('preserves authored optional cumulative exhaustion in every dimension after an actual old-worker settlement',async()=>{
 const f=await savedResultWorld({optional:true});try{
  const e=await f.service.savedResultEligibility(f.source.runId);expect(e.status).toBe('eligible');if(e.status!=='eligible')throw Error(JSON.stringify(e));
  const result=await f.service.verifySavedResult(f.command('verify-saved-result',{sourceRunId:f.source.runId,sourceAttempt:1,capsuleHash:e.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'}));expect(result).toHaveProperty('error.code','saved-result-unavailable');
  expect(f.store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.mode')='verify-saved-result'").all()).toEqual([]);expect(f.calls()).toEqual(['plan','execute']);
 }finally{await f.cleanup();}
},60000);

it('keeps post-entry unknown usage blocked until a genuine owner settlement, then preserves the same original lineage',async()=>{
 const f=await savedResultWorld();let worker:number|undefined;try{
  const marker=join(f.w.root,'unknown-entry');process.env.CCLOOP_CONTROL_TEST_CRASH_POINT='saved-result-entry-fsynced';process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER=marker;
  const first=await admit(f);await driveUntil(f,()=>existsSync(marker));const r=readDriverRun(f.store,first.id);worker=JSON.parse(readFileSync(join(r.drive!.sourceDir,'control/accepted.json'),'utf8')).worker.pid;process.kill(worker!,'SIGKILL');worker=undefined;delete process.env.CCLOOP_CONTROL_TEST_CRASH_POINT;delete process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER;
  await driveUntil(f,()=>readDriverRun(f.store,first.id).state==='blocked');expect((readDriverRun(f.store,first.id).unknown as any).work).toBe(true);expect(await f.service.savedResultEligibility(f.source.runId)).toMatchObject({status:'unavailable',reason:'saved-result-usage-unsettled'});
  const settlement=f.command('settle-unknown-usage',{taskId:'a',runId:first.id,generation:1,acknowledge:'charge-remaining-grant'});expect(await withCommandContext(settlement.commandId,{client:'web',principal:'user:owner'},()=>f.service.settleUnknownUsage(settlement))).not.toHaveProperty('error');
  const settled=readDriverRun(f.store,first.id);expect(settled.savedInterruption).toBeTruthy();const next=await admit(f);await driveUntil(f,()=>readDriverRun(f.store,next.id).state==='settled');expect(f.calls()).toEqual(['plan','execute','verify']);expect((readDriverRun(f.store,next.id).savedRecovery as any).funding.inheritedUsage.tokens).toBe((f.source.cumulative as any).work.tokens+(settled.cumulative as any).work.tokens);
 }finally{delete process.env.CCLOOP_CONTROL_TEST_CRASH_POINT;delete process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER;if(worker)try{process.kill(worker,'SIGKILL');}catch{}await f.cleanup();}
},60000);

it('missing prepared/entry markers never infer zero spend or permit a successor, even after owner charging',async()=>{
 const f=await savedResultWorld();let worker:number|undefined;try{
  const marker=join(f.w.root,'missing-entry');process.env.CCLOOP_CONTROL_TEST_CRASH_POINT='saved-result-before-entry';process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER=marker;
  const first=await admit(f);await driveUntil(f,()=>existsSync(marker));const run=readDriverRun(f.store,first.id);worker=JSON.parse(readFileSync(join(run.drive!.sourceDir,'control/accepted.json'),'utf8')).worker.pid;process.kill(worker!,'SIGKILL');worker=undefined;delete process.env.CCLOOP_CONTROL_TEST_CRASH_POINT;delete process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER;
  await rm(join(run.drive!.sourceDir,'run/saved-result-lifecycle.json'));await rm(join(run.drive!.sourceDir,'run/saved-result-entry.json'),{force:true});await driveUntil(f,()=>readDriverRun(f.store,first.id).state==='blocked');
  expect((readDriverRun(f.store,first.id).unknown as any).work).toBe(true);expect(readDriverRun(f.store,first.id).savedInterruption).toBeUndefined();
  const c=f.command('settle-unknown-usage',{taskId:'a',runId:first.id,generation:1,acknowledge:'charge-remaining-grant'});expect(await withCommandContext(c.commandId,{client:'web',principal:'user:owner'},()=>f.service.settleUnknownUsage(c))).not.toHaveProperty('error');expect(readDriverRun(f.store,first.id).savedInterruption).toBeUndefined();expect((await f.service.savedResultEligibility(f.source.runId)).status).toBe('unavailable');expect(f.calls()).toEqual(['plan','execute']);
 }finally{delete process.env.CCLOOP_CONTROL_TEST_CRASH_POINT;delete process.env.CCLOOP_CONTROL_TEST_CRASH_MARKER;if(worker)try{process.kill(worker,'SIGKILL');}catch{}await f.cleanup();}
},60000);

it('revokes a prepared but unaccepted fence and resolves its held reservation through the actual stop path',async()=>{
 const f=await savedResultWorld();try{
  const {id}=await admit(f);await f.driver.round();await f.driver.round();const prepared=readDriverRun(f.store,id);expect(prepared.drive?.prepared).toBe(true);expect(f.calls()).toEqual(['plan','execute']);
  expect(await f.service.pauseDispatch(f.command('pause-dispatch',{}))).not.toHaveProperty('error');expect(existsSync(join(prepared.drive!.sourceDir,'control/recovery-fence.json'))).toBe(false);
  expect(await f.service.handoffStop(f.command('handoff-stop',{}))).not.toHaveProperty('error');await driveUntil(f,()=>readDriverRun(f.store,id).state==='settled-restartable');
  expect(f.store.db.prepare('SELECT active FROM runs WHERE id=?').get(id)!.active).toBe(0);expect(f.calls()).toEqual(['plan','execute']);
  const work=JSON.parse(String(f.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));expect(work.status).toBe('ready');
  expect(await f.service.resumeFromHandoff(f.command('resume-from-handoff',{selections:[]}))).not.toHaveProperty('error');
  const before=f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()!.n,reserved=JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
  await f.driver.round();expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()!.n).toBe(before);expect(f.calls()).toEqual(['plan','execute']);
  const {deliverScheduledStart}=await import('../../src/control/webDispatch.js'),dispatch={store:f.store,profileRouter:f.deps.router,admissionGate:f.deps.admissionGate};
  expect(await deliverScheduledStart(dispatch,'g')).toEqual({kind:'idle'});replenishStartWakes(dispatch);expect(await deliverScheduledStart(dispatch,'g')).toEqual({kind:'idle'});
  expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()!.n).toBe(before);expect(f.calls()).toEqual(['plan','execute']);
  expect(readControlGroup(f.store,'current','g').runs.find(r=>r.runId===id)?.savedResultOrdinaryRetry).toBe(true);
  const genuine=f.store.db.prepare('SELECT body FROM runs WHERE id=?').get(id)!.body,baseline=JSON.parse(String(genuine));
  for(const altered of [{...baseline,savedDispatch:{...baseline.savedDispatch,state:'submitted'}},{...baseline,savedNoDispatch:persistRecoveryArtifact(f.store,{...JSON.parse(settlementArtifact(f.store,baseline.savedNoDispatch).toString()),fundingHash:'f'.repeat(64)})}]){
    f.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(altered),id);expect(f.service.retryTask(f.command('retry-task',{taskId:'a'}))).toHaveProperty('error.code','task-not-retryable');f.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(genuine,id);
  }
  const c=f.command('retry-task',{taskId:'a'}),result=f.service.retryTask(c);expect(result).not.toHaveProperty('error');expect(f.service.retryTask(c)).toEqual(result);
  expect(JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved).toEqual(reserved);
  replenishStartWakes(dispatch);const delivered=await deliverScheduledStart(dispatch,'g');if(delivered.kind!=='claimed')throw Error(JSON.stringify(delivered));
  expect(readDriverRun(f.store,delivered.runId).mode).toBeUndefined();await driveUntil(f,()=>readDriverRun(f.store,delivered.runId).state==='settled');expect(f.calls()).toEqual(['plan','execute','plan','execute','verify']);expect(readDriverRun(f.store,f.source.runId).drive?.outcome).toBe('failed');
 }finally{await f.cleanup();}
},60000);


it('keeps original taskResult metadata opaque instead of treating answer-shaped artifact references as controller authority',async()=>{
 const f=await savedResultWorld({taskResult:{artifactId:'external-model-text',hash:'a'.repeat(64)}});try{expect((await f.service.savedResultEligibility(f.source.runId)).status).toBe('eligible');const {id}=await admit(f);await driveUntil(f,()=>readDriverRun(f.store,id).state==='settled');expect(f.calls()).toEqual(['plan','execute','verify']);}finally{await f.cleanup();}
},60000);

import {readFundedAllowance} from '../../src/control/fundedAllowance.js';
import {persistRecoveryArtifact,assertPrivateRecoveryDirectory} from '../../src/control/savedResultRecoveryPackage.js';
import {savedResultAdmissionSchema} from '../../src/control/savedResultProtocol.js';
import {settlementArtifact} from '../../src/control/usageSettlement.js';
import {chmodSync} from 'node:fs';

it('refuses forged settlement receipts and changed current graph/target/frozen semantics without touching source failure',async()=>{
 const f=await savedResultWorld();try{
  const source=f.source as any,receipt=f.store.db.prepare('SELECT * FROM commands WHERE id=?').get(source.usageSettlement.commandId)!;
  f.store.db.prepare('UPDATE commands SET principal=? WHERE id=?').run('user:forged',source.usageSettlement.commandId);expect(await f.service.savedResultEligibility(source.runId)).toMatchObject({status:'unavailable',reason:'saved-result-usage-unsettled'});f.store.db.prepare('UPDATE commands SET principal=? WHERE id=?').run(receipt.principal,source.usageSettlement.commandId);
  const row=f.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!,work=JSON.parse(String(row.body));
  for(const altered of [{...work,targetVersion:2},{...work,derivedContractHash:'f'.repeat(64)}]){
   f.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(altered));expect((await f.service.savedResultEligibility(source.runId)).status).toBe('unavailable');f.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(row.body);
  }
  const groupRow=f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!,group=JSON.parse(String(groupRow.body));for(const changed of [{...group,graphVersion:group.graphVersion+1},{...group,plan:{...group.plan,goal:'changed'}}]){f.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(changed));expect(await f.service.savedResultEligibility(source.runId)).toMatchObject({status:'unavailable',reason:'saved-result-source-stale'});f.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(groupRow.body);}
  expect(readDriverRun(f.store,source.runId).drive?.outcome).toBe('failed');expect(f.calls()).toEqual(['plan','execute']);
 }finally{await f.cleanup();}
},60000);

it('rechecks every finite reserve dimension using real owner limit commands',async()=>{
 const f=await savedResultWorld();try{
  const original=JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)),grant=(f.source as any).grant;
  for(const dimension of ['tokens','activeMs','attempts','sessions']){
   const current=JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)),limit={...original.limit,[dimension]:current.used[dimension]+current.reserved[dimension]+grant.work[dimension]+grant.handoff[dimension]-1};
   const lower=f.command('set-limit',{limit});expect(withCommandContext(lower.commandId,{client:'web',principal:'user:owner'},()=>f.service.setLimit(lower))).not.toHaveProperty('error');const e=await f.service.savedResultEligibility(f.source.runId);if(e.status!=='eligible')throw Error(JSON.stringify(e));
   expect(await f.service.verifySavedResult(f.command('verify-saved-result',{sourceRunId:f.source.runId,sourceAttempt:1,capsuleHash:e.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'}))).toHaveProperty('error.code','group-reserve-insufficient');
   const restore=f.command('set-limit',{limit:original.limit});expect(withCommandContext(restore.commandId,{client:'web',principal:'user:owner'},()=>f.service.setLimit(restore))).not.toHaveProperty('error');
  }
  expect(f.store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.mode')='verify-saved-result'").all()).toEqual([]);expect(f.calls()).toEqual(['plan','execute']);
 }finally{await f.cleanup();}
},60000);

it('refuses hash-valid substituted reservation identities and never repairs supplied private authority modes',async()=>{
 const f=await savedResultWorld();try{
  const {id}=await admit(f),row=f.store.db.prepare('SELECT body FROM runs WHERE id=?').get(id)!,run=JSON.parse(String(row.body)),admission=savedResultAdmissionSchema.parse(JSON.parse(settlementArtifact(f.store,run.savedRecovery.admission).toString()));
  for(const reservation of [{...admission.funding.reservation,runId:'foreign'},{...admission.funding.reservation,revision:999},{...admission.funding.reservation,workAllocationId:admission.funding.reservation.handoffAllocationId}]){
   const altered=structuredClone(run),record=structuredClone(admission);record.funding.reservation=reservation;altered.savedRecovery.funding=record.funding;altered.savedRecovery.admission=persistRecoveryArtifact(f.store,record);
   expect(()=>readFundedAllowance(f.store,altered)).toThrow();
  }
  await f.driver.round();await f.driver.round();const prepared=readDriverRun(f.store,id),path=join(prepared.drive!.sourceDir,'input');chmodSync(path,0o755);expect(()=>assertPrivateRecoveryDirectory(path)).toThrow('saved-result-package-path-invalid');expect((await f.deps.router.resolve('task',(prepared.executionProfile as any).profileId,(prepared.executionProfile as any).profileHash).port.savedResultEligibility!(readStartEnvelope(f.store,prepared))).status).toBe('unavailable');
  expect(f.calls()).toEqual(['plan','execute']);chmodSync(path,0o700);
 }finally{await f.cleanup();}
},60000);

import {execFileSync} from 'node:child_process';
it('keeps the original candidate/base through harmless target-tip drift and uses ordinary reconciliation',async()=>{
 const f=await savedResultWorld();try{
  const {id}=await admit(f),git=(...args:string[])=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/private/tmp/orca-empty-hooks','-c','user.name=fixture','-c','user.email=fixture@invalid',...args],{cwd:f.w.repo,encoding:'utf8'}).trim(),old=git('rev-parse','refs/heads/orca/g'),tree=git('rev-parse',`${old}^{tree}`),drift=git('commit-tree',tree,'-p',old,'-m','human tip movement');git('update-ref','refs/heads/orca/g',drift,old);
  await driveUntil(f,()=>readDriverRun(f.store,id).state==='settled');expect(readDriverRun(f.store,id).drive?.base).toBe(f.source.drive?.base);expect(f.w.show('answer.txt')).toBe('saved candidate');expect(f.calls()).toEqual(['plan','execute','verify']);
 }finally{await f.cleanup();}
},60000);


it('archives the current malformed capsule through the private channel but keeps original normalization failure unavailable',async()=>{
 const f=await savedResultWorld({currentCapsule:true});try{expect(f.source.savedSource).toBeTruthy();expect(await f.service.savedResultEligibility(f.source.runId)).toMatchObject({status:'unavailable',reason:'execution-format-invalid'});expect((f.source.cumulative as any).work.tokens).toBe(30);expect(f.calls()).toEqual(['plan','execute']);}finally{await f.cleanup();}
},60000);

it('ends a known real verifier timeout without executing, landing or admitting an interrupted exception',async()=>{
 const f=await savedResultWorld({verify:'delay',timeoutMs:3000});try{const {id}=await admit(f);await driveUntil(f,()=>readDriverRun(f.store,id).state==='blocked');const run=readDriverRun(f.store,id);expect(run.drive?.outcome).toBe('exhausted');expect((run.unknown as any).work).toBe(false);expect((run.cumulative as any).work.tokens).toBe(15);expect(run.savedInterruption).toBeUndefined();expect((await f.service.savedResultEligibility(f.source.runId)).status).toBe('unavailable');expect(f.calls()).toEqual(['plan','execute','verify']);expect(f.w.landings()).toBe(0);}finally{await f.cleanup();}
},60000);
