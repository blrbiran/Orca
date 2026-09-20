import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { ControlStore } from "./store.js";
import type { ArtifactRef } from "./types.js";
import { archiveFile, captureTree, readArtifact, writeArtifact, type ArchiveDependencies, type TreeEntry } from "./archive.js";
import { privateDirectory } from "./paths.js";
import { ControlError } from "./errors.js";
import { artifactSchema, safeInteger } from "./schema.js";
import { canonicalBytes } from "./canonicalJson.js";

const relativeSnapshotPath = z.string().min(1).refine(path =>
 !path.startsWith("/") && !path.split("/").some(part => part === "" || part === "." || part === ".."),
 "snapshot-path-invalid",
);
const fileTreeEntrySchema = z.object({path:relativeSnapshotPath,kind:z.literal("file"),mode:safeInteger.max(0o777),ref:artifactSchema,target:z.never().optional()}).strict();
const directoryTreeEntrySchema = z.object({path:relativeSnapshotPath,kind:z.literal("directory"),mode:safeInteger.max(0o777),ref:z.never().optional(),target:z.never().optional()}).strict();
const symlinkTreeEntrySchema = z.object({path:relativeSnapshotPath,kind:z.literal("symlink"),mode:safeInteger.max(0o777),ref:z.never().optional(),target:z.string()}).strict();
export const snapshotSchema = z.object({
 version:z.literal(1),
 head:z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
 bundle:artifactSchema,
 index:z.array(z.object({path:relativeSnapshotPath,mode:z.string().regex(/^[0-7]{6}$/),oid:z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),stage:safeInteger.max(3),ref:artifactSchema.nullable()}).strict()),
 tree:z.array(z.union([fileTreeEntrySchema,directoryTreeEntrySchema,symlinkTreeEntrySchema])),
 deleted:z.array(relativeSnapshotPath),
 missing:z.array(z.string()),
}).strict();
export type SnapshotV1 = z.infer<typeof snapshotSchema>;
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
 const bundle=await archiveFile(store,bundlePath,deps);const index:SnapshotV1["index"]=[];
 for(const raw of initialIndex.toString().split("\0").filter(Boolean)) {
  const tab=raw.indexOf("\t"),path=raw.slice(tab+1);const [mode,oid,stage]=raw.slice(0,tab).split(" ");
  if(mode==="160000") {missing.push("submodule:"+path);index.push({path,mode,oid,stage:Number(stage),ref:null});continue;}
  const blob=join(staging,randomUUID());await blobFile(repo,oid,blob);
  const ref=await archiveFile(store,blob,deps);index.push({path,mode,oid,stage:Number(stage),ref});
 }
 const tree=await captureTree(store,repo,"repo/",missing,deps,[".git"]);
 const paths=new Set(tree.map(e=>e.path));const deleted=index.filter(e=>!paths.has(e.path)).map(e=>e.path);
 if(!initialIndex.equals(git(repo,"ls-files","--stage","-z")) || refs!==git(repo,"show-ref","--head").toString() || head!==git(repo,"rev-parse","HEAD").toString().trim()) missing.push("changed:git-state");
 const snapshot=snapshotSchema.parse({version:1,head,bundle,index,tree,deleted,missing:[...missing]});
 const bytes=Buffer.from(JSON.stringify(snapshot));return writeArtifact(store,"snapshot-"+createHash("sha256").update(bytes).digest("hex"),bytes,deps);
}
export async function verifySnapshot(store:ControlStore,ref:ArtifactRef):Promise<void> {
 const parsed=snapshotSchema.safeParse(JSON.parse((await readArtifact(store,ref)).toString()));
 if(!parsed.success) throw new ControlError("snapshot-invalid");
 const snapshot=parsed.data;
 if(snapshot.missing.length) throw new ControlError("snapshot-partial");
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

/** Store canonical JSON bytes in the database transaction that publishes authority. */
export function writeCanonicalRecord(store: ControlStore, groupId: string, hash: string, canonicalJson: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(canonicalJson); }
  catch { throw new ControlError("control-non-canonical-json"); }
  const bytes = canonicalBytes(parsed);
  if (bytes.toString("utf8") !== canonicalJson || createHash("sha256").update(bytes).digest("hex") !== hash) {
    throw new ControlError("control-non-canonical-json");
  }
  store.db.prepare("INSERT INTO execution_snapshots(hash,group_id,body) VALUES (?,?,?) ON CONFLICT(hash) DO NOTHING")
    .run(hash, groupId, canonicalJson);
  const row = store.db.prepare("SELECT body FROM execution_snapshots WHERE hash=?").get(hash);
  if (!row || String(row.body) !== canonicalJson) throw new ControlError("recovery-blocked");
}

/** Read and re-hash a canonical authority record. Missing or damaged authority fails closed. */
export function readCanonicalRecord(store: ControlStore, hash: string): string {
  const row = store.db.prepare("SELECT body FROM execution_snapshots WHERE hash=?").get(hash);
  if (!row) throw new ControlError("recovery-blocked");
  const body = String(row.body);
  try {
    const parsed = JSON.parse(body);
    const bytes = canonicalBytes(parsed);
    if (bytes.toString("utf8") !== body || createHash("sha256").update(bytes).digest("hex") !== hash) {
      throw new ControlError("recovery-blocked");
    }
  } catch (error) {
    if (error instanceof ControlError && error.code === "recovery-blocked") throw error;
    throw new ControlError("recovery-blocked");
  }
  return body;
}
