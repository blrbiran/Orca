import { z } from 'zod';
import type { ControlStore } from '../control/store.js';
import { ControlError } from '../control/errors.js';
import { idSchema } from '../control/schema.js';
import { readArchivedPlan } from '../control/queries.js';
import { readCanonicalRecord } from '../control/snapshot.js';
import { sha256Canonical } from '../control/canonicalJson.js';
import { readTaskResultState, readTaskResultCurrentAttemptFact, type TaskResultObservation } from '../control/taskResultStore.js';
import { safeTaskResultPath, taskResultManifestSchema, taskResultVerification, type TaskResultManifestV1, type TaskResultVerification } from '../control/taskResultProtocol.js';
import { resultExplanationContentSchema, runResultsSchema, groupResultsSchema, type RunResultsV1, type GroupResultsV1, type GroupViewV1 } from '../control/webProtocol.js';
import { readControlGroup } from './controlViews.js';
import { readSavedResultArtifact, resultOutputId } from './taskResultOutputs.js';
export interface ResultReadContext { epoch:string }
interface ResultAuthority {group:GroupViewV1;run:GroupViewV1['runs'][number];body:Record<string,any>;state:ReturnType<typeof readTaskResultState>;observations:TaskResultObservation[]}
const refuse=()=>new ControlError('recovery-blocked','task-result-identity-invalid');
/** Original group/run guards remain authoritative; admitted optional facts cannot repair core damage. */
export function resultAuthority(store:ControlStore,runId:string,context:ResultReadContext,knownGroup?:GroupViewV1):ResultAuthority{
 const row=idSchema.safeParse(runId).success?store.db.prepare('SELECT group_id,body FROM runs WHERE id=?').get(runId):null;if(!row)throw new ControlError('run-not-found');
 const group=knownGroup??readControlGroup(store,context.epoch,String(row.group_id)),run=group.runs.find(r=>r.runId===runId);if(!run||group.summary.groupId!==row.group_id)throw refuse();
 const body=JSON.parse(String(row.body));let state:ReturnType<typeof readTaskResultState>=null;try{state=readTaskResultState(store,runId);}catch{}
 const expected={groupId:body.groupId,workItemId:body.workItemId,taskId:body.taskId,runId:body.runId,generation:body.generation,graphVersion:body.graphVersion,targetVersion:body.targetVersion,executionId:body.executionId,envelopeHash:body.drive?.envelopeHash};
 if(state?.identity){try{const envelope=JSON.parse(readCanonicalRecord(store,state.identity.envelopeHash));if(sha256Canonical(state.identity)!==sha256Canonical(expected)||envelope.claim.ownerToken!==body.ownerToken||envelope.claim.runId!==runId)state=null;}catch{state=null;}}
 const observations=state?.identity?state.observations.filter(o=>{const m=taskResultManifestSchema.safeParse(o.manifest);return m.success&&m.data.revision<=state!.revision&&sha256Canonical(m.data.identity)===sha256Canonical(state!.identity);}):[];
 return {group,run,body,state,observations};
}
/** Saved manifest bytes must match the already-admitted observation exactly. */
export async function ownedResultManifest(store:ControlStore,authority:ResultAuthority,observation:TaskResultObservation):Promise<TaskResultManifestV1>{
 if(!authority.observations.includes(observation))throw refuse();
 const manifest=taskResultManifestSchema.parse(JSON.parse((await readSavedResultArtifact(store,observation.manifestRef)).toString('utf8')));
 if(sha256Canonical(manifest)!==sha256Canonical(observation.manifest))throw refuse();return manifest;
}
const missingExplanation=(status:'missing'|'unavailable'='missing')=>({status,reason:status==='unavailable'?'current-attempt-unavailable':null,content:null});
export async function readRunResults(store:ControlStore,runId:string,context:ResultReadContext,knownGroup?:GroupViewV1):Promise<RunResultsV1>{
 const a=resultAuthority(store,runId,context,knownGroup),fact=readTaskResultCurrentAttemptFact(store,runId),currentAttempt=fact?.currentAttempt??null;
 const attempts:RunResultsV1['attempts']=[];
 for(const attempt of [...new Set(a.observations.map(o=>o.manifest.attempt))].sort((x,y)=>x-y)){
  const history=a.observations.filter(o=>o.manifest.attempt===attempt).sort((x,y)=>x.manifest.revision-y.manifest.revision),latest=history.at(-1)!;
  let explanation:RunResultsV1['currentExplanation']=missingExplanation('unavailable');
  const observations:RunResultsV1['attempts'][number]['observations']=[];let execution:'complete'|'partial'|'unavailable'='unavailable',verification:TaskResultVerification='unavailable';
  try{const manifest=await ownedResultManifest(store,a,latest);
   explanation={status:manifest.explanation.status,reason:manifest.explanation.reason,content:null};
   if(manifest.explanation.status==='available'){
    try{if(!manifest.explanation.ref)throw refuse();const bytes=await readSavedResultArtifact(store,manifest.explanation.ref,65536);explanation.content=resultExplanationContentSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{explanation={status:'unavailable',reason:'explanation-evidence-unavailable',content:null};}
   }
   if(manifest.executionRef){try{const value=JSON.parse((await readSavedResultArtifact(store,manifest.executionRef)).toString('utf8'));if(value&&Array.isArray(value.changedFiles)&&value.changedFiles.every((p:unknown)=>typeof p==='string')&&typeof value.diffPatch==='string'&&Array.isArray(value.commandOutputs)&&value.commandOutputs.every((s:unknown)=>typeof s==='string')&&typeof value.stdoutStderrLog==='string')execution=value.completionStatus==='partial'?'partial':'complete';}catch{}}
  }catch{}
  for(const observation of history){let actual:TaskResultVerification='unavailable';try{const m=await ownedResultManifest(store,a,observation);if(m.verificationRef)actual=taskResultVerification(m,await readSavedResultArtifact(store,m.verificationRef));}catch{}observations.push({revision:observation.manifest.revision,stage:observation.manifest.stage,verification:actual});if(observation.manifest.stage==='verification')verification=actual;}
  if(verification==='in-progress'&&(attempt!==currentAttempt||a.run.outcome||!['running','starting'].includes(a.run.state)))verification='unavailable';
  attempts.push({attempt,current:attempt===currentAttempt,revision:latest.manifest.revision,execution,verification,explanation,outputs:latest.manifest.outputs.map(o=>({outputId:resultOutputId(runId,attempt,o.id),path:o.path,label:o.label,origin:o.origin,status:safeTaskResultPath(o.path)?o.status:'unsafe',byteLength:o.byteLength})),observations});
 }
 const current=attempts.find(a=>a.current),source=a.state?{status:a.state.status,reason:a.state.reason}:{status:'missing' as const,reason:'result-source-missing'};
 const availability=!attempts.length?(source.status==='missing'||source.status==='unsupported'?'missing':'unavailable'):!current||source.status!=='available'||current.explanation.status!=='available'||current.outputs.some(o=>o.status!=='available')?'partial':'available';
 return runResultsSchema.parse({schema:'orca-run-results-v1',epoch:context.epoch,changeSeq:a.group.changeSeq,runId,groupId:a.group.summary.groupId,taskId:a.run.taskId,generation:a.run.generation,executionId:a.body.executionId,run:a.run,currentAttempt,captureRevision:a.state?.revision??0,source,availability,currentExplanation:current?.explanation??missingExplanation(currentAttempt===null?'unavailable':'missing'),attempts});
}
export async function readGroupResults(store:ControlStore,groupId:string,context:ResultReadContext):Promise<GroupResultsV1>{
 const group=readControlGroup(store,context.epoch,groupId),plan=readArchivedPlan(store,groupId).plan,tasks:GroupResultsV1['tasks']=[];
 for(const task of plan.tasks){const item=group.workItems.find(i=>i.taskId===task.taskId)!;const runs:RunResultsV1[]=[];for(const run of group.runs.filter(r=>r.taskId===task.taskId&&r.phase==='work'))runs.push(await readRunResults(store,run.runId,context,group));
  const current=runs.find(r=>r.runId===item.currentRunId);tasks.push({taskId:task.taskId,status:item.status,currentRunId:item.currentRunId,pendingRunId:item.pendingRunId,lineageRunIds:item.lineageRunIds,availability:runs.length?(current?.availability??'unavailable'):'not-produced',runs});}
 const coverage={total:tasks.length,available:0,partial:0,missing:0,unavailable:0,notProduced:0};for(const task of tasks){const key=task.availability==='not-produced'?'notProduced':task.availability;coverage[key]++;}
 return groupResultsSchema.parse({schema:'orca-group-results-v1',epoch:context.epoch,changeSeq:group.changeSeq,groupId,goal:plan.goal,successConditions:plan.successConditions,status:group.summary.state,review:{runs:group.runs.filter(r=>r.taskId===null&&r.phase==='work')},delivery:group.integration??null,tasks,coverage});
}
