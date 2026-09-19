import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import type { ControlStore } from "./store.js";
import type { ArtifactRef } from "./types.js";
import { archiveFile, captureTree, readArtifact, writeArtifact, type ArchiveDependencies, type TreeEntry } from "./archive.js";
import { privateDirectory } from "./paths.js";
import { ControlError } from "./errors.js";
interface Snapshot {version:1;head:string;bundle:ArtifactRef;index:{path:string;mode:string;oid:string;stage:number;ref:ArtifactRef|null}[];tree:TreeEntry[];deleted:string[];missing:string[]}
function git(repo:string,...args:string[]):Buffer {return execFileSync("git",["-C",repo,...args],{maxBuffer:64*1024*1024});}
async function blobFile(repo:string,oid:string,destination:string):Promise<void> {
 const child=spawn("git",["-C",repo,"cat-file","blob",oid],{stdio:["ignore","pipe","pipe"]});let stderr="";child.stderr.on("data",b=>stderr+=b);
 const done=new Promise<void>((ok,fail)=>{child.once("error",fail);child.once("close",code=>code===0?ok():fail(new Error("snapshot-blob: "+stderr)));});
 await Promise.all([pipeline(child.stdout,createWriteStream(destination,{flags:"wx",mode:0o600})),done]);
}
export async function captureSnapshot(store:ControlStore,repo:string,missing:string[],deps:ArchiveDependencies={}):Promise<ArtifactRef> {
 const staging=privateDirectory(join(store.stateDir,"staging"));const bundlePath=join(staging,randomUUID()+".bundle");
 const head=git(repo,"rev-parse","HEAD").toString().trim();
 const initialIndex=git(repo,"ls-files","--stage","-z");const refs=git(repo,"show-ref","--head").toString();
 const oldMask=process.umask(0o077);
 try {git(repo,"bundle","create",bundlePath,"--all","HEAD");}finally{process.umask(oldMask);}
 // Git output is staging evidence, never an executable hook/config archive.
 const bundle=await archiveFile(store,bundlePath,deps);const index:Snapshot["index"]=[];
 for(const raw of initialIndex.toString().split("\0").filter(Boolean)) {
  const tab=raw.indexOf("\t"),path=raw.slice(tab+1);const [mode,oid,stage]=raw.slice(0,tab).split(" ");
  if(mode==="160000") {missing.push("submodule:"+path);index.push({path,mode,oid,stage:Number(stage),ref:null});continue;}
  const blob=join(staging,randomUUID());await blobFile(repo,oid,blob);
  const ref=await archiveFile(store,blob,deps);index.push({path,mode,oid,stage:Number(stage),ref});
 }
 const tree=await captureTree(store,repo,"repo/",missing,deps,[".git"]);
 const paths=new Set(tree.map(e=>e.path));const deleted=index.filter(e=>!paths.has(e.path)).map(e=>e.path);
 if(!initialIndex.equals(git(repo,"ls-files","--stage","-z")) || refs!==git(repo,"show-ref","--head").toString() || head!==git(repo,"rev-parse","HEAD").toString().trim()) missing.push("changed:git-state");
 const snapshot:Snapshot={version:1,head,bundle,index,tree,deleted,missing:[...missing]};
 const bytes=Buffer.from(JSON.stringify(snapshot));return writeArtifact(store,"snapshot-"+createHash("sha256").update(bytes).digest("hex"),bytes,deps);
}
export async function verifySnapshot(store:ControlStore,ref:ArtifactRef):Promise<void> {
 const snapshot=JSON.parse((await readArtifact(store,ref)).toString()) as Snapshot;
 if(snapshot.version!==1 || snapshot.missing.length) throw new ControlError("snapshot-partial");
 const bundleBytes=await readArtifact(store,snapshot.bundle);
 for(const entry of snapshot.tree) if(entry.ref) await readArtifact(store,entry.ref);
 for(const entry of snapshot.index) {
  if(!entry.ref) throw new ControlError("snapshot-partial");
  const bytes=await readArtifact(store,entry.ref);const gitHash=createHash(entry.oid.length===64?"sha256":"sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
  if(gitHash!==entry.oid) throw new ControlError("snapshot-index-hash-mismatch");
 }
 const root=await mkdtemp(join(tmpdir(),"orca-snapshot-verify-"));
 try {
  git(root,"init","--bare","-q");
  const {writeFile}=await import("node:fs/promises");await writeFile(join(root,"input.bundle"),bundleBytes,{mode:0o600});
  git(root,"bundle","verify",join(root,"input.bundle"));
  git(root,"fetch","-q",join(root,"input.bundle"),"HEAD");
  if(git(root,"rev-parse","FETCH_HEAD").toString().trim()!==snapshot.head) throw new ControlError("snapshot-head-mismatch");
 }finally{await rm(root,{recursive:true,force:true});}
}
