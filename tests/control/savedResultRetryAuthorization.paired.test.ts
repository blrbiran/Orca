import {beforeEach,describe,it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {savedResultWorld} from './fixtures/savedResultWorld.js';
import {readDriverRun,replenishStartWakes} from '../../src/control/executionDriver.js';
import {deliverScheduledStart,nextClaimableTask} from '../../src/control/webDispatch.js';
import {hasSavedOrdinaryRetryAuthorization} from '../../src/control/savedResultNoDispatch.js';
import {withCommandContext} from '../../src/control/commandClient.js';

describe('explicit ordinary retry after unsuccessful saved verification',()=>{
 beforeEach(ctx=>{if(process.env.ORCA_SAVED_RESULT_VERIFY!=='1')ctx.skip();});
 it.each(['reject','modify','delay'] as const)('authorizes a distinct normal run after %s only through the actual successful retry receipt',async verify=>{
  const f=await savedResultWorld({verify,...(verify==='delay'?{timeoutMs:3000}:{})});try{
   const e=await f.service.savedResultEligibility(f.source.runId);if(e.status!=='eligible')throw Error(JSON.stringify(e));
   const admitted=await f.service.verifySavedResult(f.command('verify-saved-result',{sourceRunId:f.source.runId,sourceAttempt:1,capsuleHash:e.recoveryOf.capsuleHash},{kind:'task',groupId:'g',taskId:'a'}));
   if(!('result' in admitted)||admitted.result.kind!=='saved-result-verification-started')throw Error(JSON.stringify(admitted));const id=admitted.result.runId;
   for(let i=0;i<150&&readDriverRun(f.store,id).state!=='blocked';i++){await f.driver.round();await new Promise(r=>setTimeout(r,30));}
   const failed=readDriverRun(f.store,id),unknown=failed.unknown as {work:boolean;handoff:boolean};expect(failed.state).toBe('blocked');expect(failed.drive?.outcome).toBe(verify==='delay'?'exhausted':'failed');expect(unknown.work).toBe(false);
   const dispatch={store:f.store,profileRouter:f.deps.router,admissionGate:f.deps.admissionGate};
   const beforeRetry=f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()!.n;expect(nextClaimableTask(f.store,'g')).toBeNull();replenishStartWakes(dispatch);expect(await deliverScheduledStart(dispatch,'g')).toEqual({kind:'claimed',runId:id});expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get()!.n).toBe(beforeRetry);expect(f.calls()).toEqual(['plan','execute','verify']);
   const original=f.store.db.prepare('SELECT body FROM runs WHERE id=?').get(id)!.body;
   if(verify==='reject'){
    f.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify({...failed,unknown:{...unknown,work:true}}),id);
    expect(f.service.retryTask(f.command('retry-task',{taskId:'a'}))).toHaveProperty('error.code','task-not-retryable');f.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(original,id);
    expect(await f.service.pauseDispatch(f.command('pause-dispatch',{}))).not.toHaveProperty('error');expect(f.service.retryTask(f.command('retry-task',{taskId:'a'}))).toHaveProperty('error.code','stop-mode-conflict');expect(await f.service.resumeDispatch(f.command('resume-dispatch',{}))).not.toHaveProperty('error');
   }
   const c=f.command('retry-task',{taskId:'a'}),retried=f.service.retryTask(c);expect(retried).not.toHaveProperty('error');const reserved=JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
   expect(f.service.retryTask(c)).toEqual(retried);expect(JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved).toEqual(reserved);
   const retired=readDriverRun(f.store,id);expect(retired.mode).toBe('verify-saved-result');expect(retired.drive?.outcome).toBe(failed.drive?.outcome);expect(retired.cumulative).toEqual(failed.cumulative);expect(retired.savedNoDispatchConsumedBy).toBeUndefined();
   expect(hasSavedOrdinaryRetryAuthorization(f.store,retired)).toBe(true);expect(nextClaimableTask(f.store,'g')).toEqual({workItemId:'a'});
   if(verify==='reject'){
    const good=f.store.db.prepare('SELECT body FROM runs WHERE id=?').get(id)!.body;
    for(const commandId of [undefined,'missing',failed.commandId]){const changed={...retired,savedOrdinaryRetryCommandId:commandId};f.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(changed),id);expect(nextClaimableTask(f.store,'g')).toBeNull();f.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(good,id);}
    const receipt=f.store.db.prepare('SELECT original_status,body_json,raw_request_json FROM commands WHERE id=? AND group_id=?').get(c.commandId,'g')!;
    for(const changes of [{original_status:409},{body_json:JSON.stringify({...retried,result:{kind:'task-retried',taskId:'a',fromRunId:'foreign'}})},{raw_request_json:JSON.stringify({...c,payload:{taskId:'foreign'}})}]){for(const [column,value] of Object.entries(changes))f.store.db.prepare(`UPDATE commands SET ${column}=? WHERE id=? AND group_id='g'`).run(value,c.commandId);expect(nextClaimableTask(f.store,'g')).toBeNull();f.store.db.prepare("UPDATE commands SET original_status=?,body_json=?,raw_request_json=? WHERE id=? AND group_id='g'").run(receipt.original_status,receipt.body_json,receipt.raw_request_json,c.commandId);}
    f.store.db.prepare('UPDATE runs SET generation=2 WHERE id=?').run(id);expect(nextClaimableTask(f.store,'g')).toBeNull();f.store.db.prepare('UPDATE runs SET generation=1 WHERE id=?').run(id);
    const cap=f.command('set-spend-cap',{scope:'all',period:'total',tokens:1},{kind:'spend'});cap.expectedRevision=0;expect(withCommandContext(cap.commandId,{client:'web',principal:'user:owner'},()=>f.service.setSpendCap(cap))).not.toHaveProperty('error');replenishStartWakes(dispatch);expect(await deliverScheduledStart(dispatch,'g')).toEqual({kind:'blocked',reason:'spend-cap-reached'});expect(f.calls()).toEqual(['plan','execute','verify']);
    const clear=f.command('clear-spend-cap',{scope:'all',period:'total'},{kind:'spend'});clear.expectedRevision=1;expect(withCommandContext(clear.commandId,{client:'web',principal:'user:owner'},()=>f.service.clearSpendCap(clear))).not.toHaveProperty('error');
   }
   // The later explicit ordinary intent uses a now-approving fake provider; the failed paid verification remains fact.
   const fake=join(f.w.root,'fake.mjs'),script=await readFile(fake,'utf8');await writeFile(fake,script.replaceAll(JSON.stringify(verify),'"approve"').replace('approved:false','approved:true'));
   replenishStartWakes(dispatch);const claimed=await deliverScheduledStart(dispatch,'g');if(claimed.kind!=='claimed')throw Error(JSON.stringify(claimed));expect(claimed.runId).not.toBe(id);expect(readDriverRun(f.store,claimed.runId).mode).toBeUndefined();expect(hasSavedOrdinaryRetryAuthorization(f.store,retired)).toBe(false);
   const afterClaim=JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;expect(f.service.retryTask(c)).toEqual(retried);expect(JSON.parse(String(f.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved).toEqual(afterClaim);
   for(let i=0;i<150&&readDriverRun(f.store,claimed.runId).state!=='settled';i++){await f.driver.round();await new Promise(r=>setTimeout(r,30));}
   expect(readDriverRun(f.store,claimed.runId).state).toBe('settled');expect(f.calls()).toEqual(['plan','execute','verify','plan','execute','verify']);expect(readDriverRun(f.store,id).drive?.outcome).toBe(failed.drive?.outcome);expect(readDriverRun(f.store,id).cumulative).toEqual(failed.cumulative);expect(readDriverRun(f.store,f.source.runId).drive?.outcome).toBe('failed');
  }finally{await f.cleanup();}
 },60000);
});
