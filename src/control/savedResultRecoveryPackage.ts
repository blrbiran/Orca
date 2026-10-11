import {createHash,randomUUID} from 'node:crypto';
import {constants,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalBytes} from './canonicalJson.js';
import {artifactSchema} from './schema.js';
import {settlementArtifact} from './usageSettlement.js';
import type {ArtifactRef} from './types.js';
import type {ControlStore} from './store.js';
import type {SavedResultSourcePackage,SavedResultPackage,SavedResultAdmission} from './savedResultProtocol.js';
import {executionFormatFailureSchema,savedExecutionSnapshotSchema,savedResultPackageSchema,savedResultFenceSchema} from './savedResultProtocol.js';

const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function assertPrivateRecoveryDirectory(path:string):void {
 const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path||(s.mode&0o7777)!==0o700||s.uid!==process.getuid?.())throw Error('saved-result-package-path-invalid');
}
export function createPrivateRecoveryDirectory(path:string):void {if(!existsSync(path))mkdirSync(path,{mode:0o700});assertPrivateRecoveryDirectory(path);}
function durable(path:string,bytes:Buffer):void {const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const parent=openSync(join(path,'..'),'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
/** Derived records belong to the command transaction. Orphaned immutable bytes grant no execution authority. */
export function persistRecoveryArtifact(store:ControlStore,value:unknown):ArtifactRef {
 const b=Buffer.isBuffer(value)?value:canonicalBytes(value),hash=digest(b),ref={artifactId:`recovery-${hash}`,hash};
 const root=join(store.stateDir,'artifacts');createPrivateRecoveryDirectory(root);
 const dir=join(root,ref.artifactId);createPrivateRecoveryDirectory(dir);const path=join(dir,'data');
 if(!existsSync(path))durable(path,b);else if(digest(readFileSync(path))!==hash)throw Error('saved-result-source-hash-mismatch');
 store.db.prepare('INSERT INTO artifacts VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(ref.artifactId,hash,JSON.stringify({path:`artifacts/${ref.artifactId}/data`}));
 settlementArtifact(store,ref);return ref;
}
/** Traverse only declared hash-bound references; no historical live path is read. */
export function recoveryClosure(store:ControlStore,roots:ArtifactRef[]):Map<string,{ref:ArtifactRef;bytes:Buffer}> {
 const entries=new Map<string,{ref:ArtifactRef;bytes:Buffer}>();
 const visit=(ref:ArtifactRef,expand=true):void=>{const old=entries.get(ref.artifactId);if(old){if(old.ref.hash!==ref.hash)throw Error('saved-result-source-hash-mismatch');return;}if(entries.size>=20000)throw Error('saved-result-evidence-too-large');
  const bytes=settlementArtifact(store,ref);entries.set(ref.artifactId,{ref,bytes});if(!expand)return;let parsed:any;try{parsed=JSON.parse(bytes.toString());}catch{return;}
  if(ref.artifactId.startsWith('evidence-')||ref.artifactId.startsWith('sha256-'))return;
  if(ref.artifactId.startsWith('report-')&&parsed.candidate){const candidate=parsed.candidate;for(const r of [...(candidate.artifacts??[]),candidate.handoff,...(candidate.snapshot?[candidate.snapshot]:[]),...(candidate.stopProof?[candidate.stopProof.source]:[])])visit(artifactSchema.parse(r),false);return;}
  // Archive file bytes include original opaque provider metadata, never declarations of new authority.
  if(ref.artifactId.startsWith('archive-')&&parsed.version===1&&Array.isArray(parsed.logs)){
    for(const log of parsed.logs)if(log.ref)visit(artifactSchema.parse(log.ref),false);if(parsed.snapshot)visit(artifactSchema.parse(parsed.snapshot));return;
  }
  if(ref.artifactId.startsWith('snapshot-')&&parsed.version===1){
    const walkSnapshot=(value:unknown):void=>{if(!value||typeof value!=='object')return;const candidate=artifactSchema.safeParse(value);if(candidate.success){visit(candidate.data,false);return;}for(const child of Object.values(value))walkSnapshot(child);};walkSnapshot(parsed);return;
  }
  if(parsed.schema==='ccloop-execution-format-failure-v1'){
    const capsule=executionFormatFailureSchema.parse(parsed),{usageObservations,...artifacts}=capsule.artifacts;
    for(const r of [capsule.verifier.proof,...Object.values(artifacts),...usageObservations.flatMap(a=>[a.source,a.copy])])visit(r,false);visit(capsule.snapshot);return;
  }
  if(parsed.schema==='ccloop-execution-snapshot-v1'){
    const snapshot=savedExecutionSnapshotSchema.parse(parsed);for(const r of [snapshot.index,snapshot.bundle,snapshot.status,...snapshot.files.map(f=>f.ref)])visit(r,false);return;
  }
  const walk=(value:unknown):void=>{if(!value||typeof value!=='object')return;const candidate=artifactSchema.safeParse(value);if(candidate.success){visit(candidate.data);return;}for(const child of Object.values(value))walk(child);};walk(parsed);
 };for(const root of roots)visit(root);return entries;
}
function publishPackage(path:string,manifest:Omit<SavedResultSourcePackage,'artifacts'>|Omit<SavedResultPackage,'artifacts'>,entries:Map<string,{ref:ArtifactRef;bytes:Buffer}>):{packageHash:string;packagePath:string} {
 createPrivateRecoveryDirectory(path);const artifacts:Array<{ref:ArtifactRef;file:string}>=[];
 for(const {ref,bytes} of entries.values()){const file=`blob-${artifacts.length}-${ref.hash}.bin`;durable(join(path,file),bytes);artifacts.push({ref,file});}
 const bytes=canonicalBytes({...manifest,artifacts});durable(join(path,'package.json'),bytes);return {packagePath:path,packageHash:digest(bytes)};
}
export function prepareRecoverySource(store:ControlStore,source:ArtifactRef,authorityKind:SavedResultSourcePackage['authorityKind']):{packageHash:string;packagePath:string;dispose():void} {
 const path=join(tmpdir(),`orca-source-${randomUUID()}`);const result=publishPackage(path,{schema:'ccloop-saved-result-source-package-v1',authorityKind,source},recoveryClosure(store,[source]));return {...result,dispose:()=>rmSync(path,{recursive:true,force:true})};
}
/** Only controller-created private authority directories; candidate permissions are handled by the consumer. */
export function materializeRecoveryPackage(store:ControlStore,sourceDir:string,record:{source:{authorityKind:SavedResultPackage['authorityKind'];source:ArtifactRef};admission:ArtifactRef;artifacts:ArtifactRef[]}):{packagePath:string;packageHash:string;admissionHash:string} {
 createPrivateRecoveryDirectory(sourceDir);const input=join(sourceDir,'input');createPrivateRecoveryDirectory(input);
 const path=join(input,'recovery');const entries=recoveryClosure(store,[record.source.source,record.admission,...record.artifacts]);
 if(existsSync(path)){
  assertPrivateRecoveryDirectory(path);const manifest=savedResultPackageSchema.parse(JSON.parse(readFileSync(join(path,'package.json'),'utf8')));
  if(manifest.admission.hash!==record.admission.hash||manifest.source.hash!==record.source.source.hash)throw Error('saved-result-package-hash-mismatch');
  for(const e of manifest.artifacts){const b=readFileSync(join(path,e.file));if(digest(b)!==e.ref.hash)throw Error('saved-result-source-hash-mismatch');}
  return {packagePath:path,packageHash:digest(readFileSync(join(path,'package.json'))),admissionHash:record.admission.hash};
 }
 return {...publishPackage(path,{schema:'ccloop-saved-result-package-v1',authorityKind:record.source.authorityKind,source:record.source.source,admission:record.admission},entries),admissionHash:record.admission.hash};
}
export function publishRecoveryFence(sourceDir:string,admission:SavedResultAdmission,packageHash:string,admissionHash:string):void {
 const control=join(sourceDir,'control');createPrivateRecoveryDirectory(control);const path=join(control,'recovery-fence.json');
 const bytes=canonicalBytes(savedResultFenceSchema.parse({schema:'ccloop-saved-result-fence-v1',admissionHash,packageHash,runId:admission.claim.runId,generation:admission.claim.generation,revision:admission.revision,currentRunId:admission.currentRunId,status:'admitted'}));
 if(existsSync(path)){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o7777)!==0o600||!readFileSync(path).equals(bytes))throw Error('saved-result-source-stale');return;}durable(path,bytes);
}
export function revokeRecoveryFence(sourceDir:string):void {const dir=join(sourceDir,'control');if(!existsSync(dir))return;assertPrivateRecoveryDirectory(dir);rmSync(join(dir,'recovery-fence.json'),{force:true});}
