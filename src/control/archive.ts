import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { rename, lstat, open, readFile, readdir, readlink, realpath, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, relative, isAbsolute, dirname, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { ControlStore } from "./store.js";
import type { ArtifactRef, StopProof } from "./types.js";
import { ControlError } from "./errors.js";
import { privateDirectory, assertRegular, syncDirectory } from "./paths.js";
import { idSchema } from "./schema.js";
import { readRun } from "./budget.js";
import { captureSnapshot } from "./snapshot.js";
export interface ArchiveDependencies { beforePublish?:()=>void; afterCopy?:(path:string)=>Promise<void>;syncFile?:(file:FileHandle)=>Promise<void> }
export interface TreeEntry {path:string;kind:"file"|"directory"|"symlink";mode:number;ref?:ArtifactRef;target?:string}
export function within(root:string,path:string):boolean {const rel=relative(root,path);return rel===""||(!rel.startsWith("..")&&!isAbsolute(rel));}
async function digestFile(path:string):Promise<string> {
 const hash=createHash("sha256");const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {for await(const bytes of handle.createReadStream({autoClose:false})) hash.update(bytes);return hash.digest("hex");} finally {await handle.close();}
}
async function publish(store:ControlStore,id:string,temp:string,hash:string,deps:ArchiveDependencies):Promise<ArtifactRef> {
 idSchema.parse(id);const dir=join(privateDirectory(join(store.stateDir,"artifacts")),id);const destination=join(dir,"data");
 const handle=await open(temp,"r");try {await (deps.syncFile??(file=>file.sync()))(handle);}finally{await handle.close();}
 const stagedDir=privateDirectory(join(store.stateDir,"staging",randomUUID()));
 await rename(temp,join(stagedDir,"data"));syncDirectory(stagedDir);syncDirectory(dirname(temp));deps.beforePublish?.();
 try {await rename(stagedDir,dir);}catch(error){
  if(!["EEXIST","ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code??"")) throw error;
  privateDirectory(dir);assertRegular(destination);if(await digestFile(destination)!==hash) throw new ControlError("artifact-id-conflict");
 }
 syncDirectory(dir);syncDirectory(dirname(dir));syncDirectory(dirname(temp));
 const ref={artifactId:id,hash};
 store.transaction(()=>{
  const old=store.db.prepare("SELECT hash FROM artifacts WHERE id=?").get(id);
  if(old && old.hash!==hash) throw new ControlError("artifact-id-conflict");
  store.db.prepare("INSERT INTO artifacts VALUES (?,?,?) ON CONFLICT(id) DO NOTHING").run(id,hash,JSON.stringify({path:relative(store.stateDir,destination)}));
 });
 await readArtifact(store,ref);return ref;
}
export async function writeArtifact(store:ControlStore,id:string,bytes:Buffer,deps:ArchiveDependencies={}):Promise<ArtifactRef> {
 idSchema.parse(id);const temp=join(privateDirectory(join(store.stateDir,"staging")),randomUUID());
 const fd=await open(temp,"wx",0o600);try{await fd.writeFile(bytes);}finally{await fd.close();}
 return publish(store,id,temp,createHash("sha256").update(bytes).digest("hex"),deps);
}
export async function archiveFile(store:ControlStore,path:string,deps:ArchiveDependencies={}):Promise<ArtifactRef> {
 const temp=join(privateDirectory(join(store.stateDir,"staging")),randomUUID());
 const hash=createHash("sha256");
 const source=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 const stat=await source.stat();if(!stat.isFile()){await source.close();throw new ControlError("archive-not-regular");}
 try {
  await pipeline(source.createReadStream({autoClose:false}),new Transform({transform(chunk,_enc,done){hash.update(chunk);done(null,chunk);}}),createWriteStream(temp,{flags:"wx",mode:0o600}));
 }finally{await source.close();}
 const value=hash.digest("hex");return publish(store,"sha256-"+value,temp,value,deps);
}
export async function readArtifact(store:ControlStore,ref:ArtifactRef):Promise<Buffer> {
 idSchema.parse(ref.artifactId);
 const row=store.db.prepare("SELECT hash FROM artifacts WHERE id=?").get(ref.artifactId);
 if(!row) throw new ControlError("artifact-not-found");
 if(row.hash!==ref.hash) throw new ControlError("artifact-hash-mismatch");
 const dir=join(store.stateDir,"artifacts",ref.artifactId);
 for(const path of [join(store.stateDir,"artifacts"),dir]) if((await lstat(path)).isSymbolicLink()) throw new ControlError("control-path-symlink");
 const path=join(dir,"data");assertRegular(path);
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;try{bytes=await fd.readFile();}finally{await fd.close();}
 if(createHash("sha256").update(bytes).digest("hex")!==ref.hash) throw new ControlError("artifact-hash-mismatch");return bytes;
}
export async function captureTree(store:ControlStore,root:string,prefix:string,missing:string[],deps:ArchiveDependencies={},exclude:string[]=[]):Promise<TreeEntry[]> {
 const result:TreeEntry[]=[];const observations:{path:string;hash?:string;target?:string;mtimeMs:number;mode:number}[]=[];
 async function walk(dir:string):Promise<void> {
  for(const name of (await readdir(dir)).sort()) {
   const path=join(dir,name);const rel=relative(root,path);
   if(exclude.includes(rel)) continue;
   const stat=await lstat(path);const entry={path:rel,mode:stat.mode&0o777};
   if(stat.isSymbolicLink()) {const target=await readlink(path);result.push({...entry,kind:"symlink",target});observations.push({path,target,mtimeMs:stat.mtimeMs,mode:stat.mode});}
   else if(stat.isDirectory()) {
    result.push({...entry,kind:"directory"});
    if(name===".git") {missing.push("nested-git:"+prefix+rel);continue;}
    observations.push({path,mtimeMs:stat.mtimeMs,mode:stat.mode});await walk(path);
   } else if(stat.isFile()) {
    const ref=await archiveFile(store,path,deps);result.push({...entry,kind:"file",ref});
    observations.push({path,hash:ref.hash,mtimeMs:stat.mtimeMs,mode:stat.mode});await deps.afterCopy?.(path);
    // An unresolved LFS pointer is not the bytes needed for reconstruction.
    if(stat.size<1024 && (await readArtifact(store,ref)).toString().startsWith("version https://git-lfs.github.com/spec/v1")) missing.push("lfs-pointer:"+prefix+rel);
   } else missing.push("special:"+prefix+rel);
  }
 }
 const before=(await lstat(root)).mtimeMs;await walk(root);
 for(const seen of observations) {
  try {
   const stat=await lstat(seen.path);
   if(stat.mtimeMs!==seen.mtimeMs || stat.mode!==seen.mode || (seen.hash && await digestFile(seen.path)!==seen.hash) || (seen.target!==undefined && await readlink(seen.path)!==seen.target)) missing.push("changed:"+prefix+relative(root,seen.path));
  }catch{missing.push("changed:"+prefix+relative(root,seen.path));}
 }
 if((await lstat(root)).mtimeMs!==before) missing.push("changed:"+prefix);
 return result;
}
export async function archiveRun(store:ControlStore,input:{runId:string;sourceDir:string;repoDir:string;stopProof:StopProof|null},deps:ArchiveDependencies={}):Promise<{artifacts:ArtifactRef[];snapshot:ArtifactRef|null;missing:string[]}> {
 const run=readRun(store,input.runId);const source=await realpath(input.sourceDir),repo=await realpath(input.repoDir);
 privateDirectory(input.sourceDir);privateDirectory(input.repoDir);
 if((await lstat(input.sourceDir)).isSymbolicLink() || (await lstat(input.repoDir)).isSymbolicLink()) throw new ControlError("control-path-symlink");
 if(within(source,store.stateDir) || !within(source,repo) || basename(source)!==run.runId || source===repo) throw new ControlError("archive-source-invalid");
 const sourceStat=await lstat(source,{bigint:true});
 const sourceIdentity={dev:String(sourceStat.dev),ino:String(sourceStat.ino),birthtimeNs:String(sourceStat.birthtimeNs)};
 const missing:string[]=[];
 if(!input.stopProof || !input.stopProof.isolated || input.stopProof.executionId!==run.executionId || input.stopProof.generation!==run.generation) missing.push("stop-unconfirmed");
 const logs=await captureTree(store,source,"",missing,deps,[relative(source,repo)]);
 const snapshot=await captureSnapshot(store,repo,missing,deps);
 const manifest={version:1,runId:run.runId,sourceIdentity,logs,snapshot,missing};
 const bytes=Buffer.from(JSON.stringify(manifest));const archive=await writeArtifact(store,"archive-"+createHash("sha256").update(bytes).digest("hex"),bytes,deps);
 const artifacts=[...logs.flatMap(e=>e.ref?[e.ref]:[]),archive,snapshot];
 store.transaction(()=>{
  store.db.prepare("INSERT INTO outbox VALUES (?, 'archive', ?, 0) ON CONFLICT(id) DO NOTHING").run("archive:"+archive.artifactId,JSON.stringify({runId:run.runId,sourceDir:source,sourceIdentity,repoDir:repo,runsRoot:dirname(source),artifacts,snapshot,missing}));
 });
 return {artifacts,snapshot,missing};
}
