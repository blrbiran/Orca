import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { join } from 'node:path';
import { driverHarness } from '../../control/fixtures/driverHarness.js';
import { createTaskResultCollector } from '../../../src/control/taskResultCollector.js';
import { readStartEnvelope } from '../../../src/control/executionDriver.js';
import { sha256Canonical } from '../../../src/control/canonicalJson.js';
import type { ArtifactRef } from '../../../src/control/types.js';
import type { TaskResultManifestV1 } from '../../../src/control/taskResultProtocol.js';
import { buildApi } from '../../../src/panel/api.js';
import { ReviewsWriter } from '../../../src/panel/reviewsStore.js';
import { login, quietPanelAuth, seedUser } from './auth.js';
export const context = { epoch: 'task4-real-panel-fixture' };
export async function resultFixture(tasks = [{taskId:'a'}]) {
 const t = await driverHarness(tasks), runId = await t.claim(), driver=t.driver();
 await t.until(driver,()=>t.body(runId).state==='accepted'); await driver.stop();
 const input=readStartEnvelope(t.h.store,t.body(runId));
 const {groupId,workItemId,taskId,generation,graphVersion,targetVersion}=input.claim;
 const identity={groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,executionId:t.body(runId).executionId,envelopeHash:sha256Canonical(input)};
 const files=new Map<string,Buffer>();
 const add=(value:unknown):ArtifactRef=>{const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));const hash=createHash('sha256').update(b).digest('hex');const ref={artifactId:'task-result-'+hash,hash};files.set(ref.artifactId,b);return ref;};
 const output=add(Buffer.from('<script>alert(1)</script>'));
 const execution=add({outcome:'complete',changedFiles:['a'],diffPatch:'',commandOutputs:[],stdoutStderrLog:''});
 const report=add({schema:'task-result-v1',goal:'Ship a',completedWork:['Saved work'],conclusions:['Agent claims success'],outputs:[],limitations:[]});
 const manifest=(revision=1,attempt=1):TaskResultManifestV1=>({schema:'ccloop-task-result-manifest-v1',identity,attempt,revision,stage:'execution',explanation:{status:'available',reason:null,ref:report},executionRef:execution,verificationRef:null,outputs:[{id:'output-1',path:'a.html',label:'Saved',origin:'reported',status:'available',byteLength:24,ref:output}]});
 let page={schema:'ccloop-task-results-v1' as const,identity,currentAttempt:1,revision:1,manifests:[{revision:1,ref:add(manifest())}],nextRevision:1};
 const port={...t.fake.port,collectTaskResults:async()=>page,readTaskResultEvidence:async(_i:unknown,_m:unknown,r:ArtifactRef)=>{const bytes=files.get(r.artifactId);if(!bytes)throw Error('missing');return bytes;}};
 const collector=createTaskResultCollector({store:t.h.store,resolve:()=>({input,executionId:identity.executionId,port}),admissionGate:t.deps.admissionGate});
 const capture=async(manifests:TaskResultManifestV1[],currentAttempt=manifests.at(-1)!.attempt)=>{const revision=manifests.at(-1)!.revision;page={...page,revision,nextRevision:revision,currentAttempt,manifests:manifests.map(m=>({revision:m.revision,ref:add(m)}))};collector.schedule(runId);await collector.flush(runId);};
 const core=(update:Record<string,unknown>)=>{const body={...t.body(runId),...update};t.h.store.db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(body),runId);};
 return {t,store:t.h.store,runId,identity,files,add,manifest,output,report,execution,collector,port,capture,core,dispose:async()=>{await collector.stop();await t.h.dispose();}};
}
export async function resultHttp(f:Awaited<ReturnType<typeof resultFixture>>) {
 const app=express(),reviews=new ReviewsWriter(f.t.h.root);await reviews.load();
 const accounts=join(f.t.h.root,'task4-accounts'),auth=quietPanelAuth(accounts);
 buildApi(app,{opts:{by:'operator',bind:'127.0.0.1',port:0,confirmedExternal:false,correctionsDir:f.t.h.root,repos:[]},reviews,statics:{get:()=>undefined,indexHtml:undefined,names:[]},auth,control:{store:f.store,epoch:context.epoch,config:{readView(){throw Error('unneeded');}}}} as never);
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('no-port');
 const url=`http://127.0.0.1:${address.port}`;seedUser(accounts,'tester');const session=await login(url);
 return {session,url,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));auth.close();}};
}
