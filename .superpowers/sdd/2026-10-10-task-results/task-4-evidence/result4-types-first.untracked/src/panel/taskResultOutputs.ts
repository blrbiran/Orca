import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import type { ControlStore } from '../control/store.js';
import type { ArtifactRef } from '../control/types.js';
import { idSchema } from '../control/schema.js';
import { ControlError } from '../control/errors.js';
import { sha256Canonical } from '../control/canonicalJson.js';
import { MAX_TASK_RESULT_EVIDENCE_BYTES, MAX_TASK_RESULT_FILE_BYTES, MAX_TASK_RESULT_PREVIEW_BYTES, safeTaskResultPath } from '../control/taskResultProtocol.js';
import { resultOutputSchema, type ResultOutputV1 } from '../control/webProtocol.js';
import { resultAuthority, ownedResultManifest, type ResultReadContext } from './taskResults.js';
const unavailable=()=>new ControlError('recovery-blocked','task-result-output-unavailable');
const fileIdentity=(s:Stats)=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
/** Private saved bytes only. Callers must establish admitted manifest membership before this bounded read. */
export async function readSavedResultArtifact(store:ControlStore,ref:ArtifactRef,maxBytes=MAX_TASK_RESULT_EVIDENCE_BYTES):Promise<Buffer>{
 idSchema.parse(ref.artifactId);const row=store.db.prepare('SELECT hash FROM artifacts WHERE id=?').get(ref.artifactId);if(!row||row.hash!==ref.hash)throw unavailable();
 const root=join(store.stateDir,'artifacts'),dir=join(root,ref.artifactId),path=join(dir,'data');
 const directories=await Promise.all([lstat(root),lstat(dir)]);if(directories.some(s=>!s.isDirectory()||s.isSymbolicLink()))throw unavailable();
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await fd.stat();if(!before.isFile()||before.nlink!==1||before.size>maxBytes)throw unavailable();
  const buffer=Buffer.alloc(before.size+1);let n=0;while(n<buffer.length){const r=await fd.read(buffer,n,buffer.length-n,null);if(r.bytesRead===0)break;n+=r.bytesRead;}
  const after=await fd.stat(),named=await lstat(path),parents=await Promise.all([lstat(root),lstat(dir)]);
  if(n!==before.size||fileIdentity(before)!==fileIdentity(after)||fileIdentity(after)!==fileIdentity(named)||named.isSymbolicLink()||parents.some((s,i)=>!s.isDirectory()||s.isSymbolicLink()||s.dev!==directories[i].dev||s.ino!==directories[i].ino))throw unavailable();
  const bytes=buffer.subarray(0,n);if(createHash('sha256').update(bytes).digest('hex')!==ref.hash)throw unavailable();return bytes;
 }finally{await fd.close();}
}
export const resultOutputId=(runId:string,attempt:number,sourceOutputId:string)=>'output-'+sha256Canonical({runId,attempt,sourceOutputId});
export const resultDownloadUrl=(runId:string,outputId:string)=>`/api/control/runs/${encodeURIComponent(runId)}/results/outputs/${encodeURIComponent(outputId)}?download=1`;
export async function readResultOutputBytes(store:ControlStore,runId:string,outputId:string,context:ResultReadContext):Promise<{view:ResultOutputV1;bytes:Buffer|null}>{
 const authority=resultAuthority(store,runId,context),observation=authority.observations.find(o=>o.manifest.outputs.some(output=>resultOutputId(runId,o.manifest.attempt,output.id)===outputId));if(!observation)throw unavailable();
 const manifest=await ownedResultManifest(store,authority,observation),output=manifest.outputs.find(o=>resultOutputId(runId,manifest.attempt,o.id)===outputId)!;
 const base={schema:'orca-result-output-v1' as const,runId,groupId:authority.group.summary.groupId,attempt:manifest.attempt,outputId,path:output.path,status:output.status,byteLength:output.byteLength,content:null,downloadUrl:null};
 if(!safeTaskResultPath(output.path))return {view:resultOutputSchema.parse({...base,status:'unsafe'}),bytes:null};
 if(!output.ref||!['available','binary'].includes(output.status))return {view:resultOutputSchema.parse(base),bytes:null};
 try{const bytes=await readSavedResultArtifact(store,output.ref,MAX_TASK_RESULT_FILE_BYTES);if(bytes.length!==output.byteLength)throw unavailable();
  let status:string=output.status,content:string|null=null;
  if(status==='available'){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))status='binary';else if(bytes.length>MAX_TASK_RESULT_PREVIEW_BYTES)status='too-large';else content=text;}catch{status='binary';}}
  return {view:resultOutputSchema.parse({...base,status,content,downloadUrl:resultDownloadUrl(runId,outputId)}),bytes};
 }catch{return {view:resultOutputSchema.parse({...base,status:'unavailable'}),bytes:null};}
}
export async function readResultOutput(store:ControlStore,runId:string,outputId:string,context:ResultReadContext):Promise<ResultOutputV1>{return (await readResultOutputBytes(store,runId,outputId,context)).view;}
