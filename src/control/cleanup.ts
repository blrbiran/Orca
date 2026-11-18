import { flushTaskResults } from './taskResultCollector.js';
import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ControlStore } from "./store.js";
import { ControlError } from "./errors.js";
import { isTerminalRunState, readRun } from "./budget.js";
import { acceptanceEvidence, readCommittedCheckpoint, verifyCandidateArtifacts } from "./checkpoints.js";
import { within } from "./archive.js";
import { privateDirectory } from "./paths.js";
export async function cleanupCommittedRun(store:ControlStore,runId:string,sourceDir:string,deps:{beforeCleanup?:()=>Promise<void>;admit?<T>(operation:()=>Promise<T>):Promise<T>}={}):Promise<{removed:boolean}> {
 const c=await readCommittedCheckpoint(store,runId),run=readRun(store,runId);
 if(!run.recoverable || run.state!=="settled" || !c.stopProof || c.unresolvedRequestIds.length || c.result!=="complete") throw new ControlError("cleanup-not-recoverable");
 if(c.terminalOutcome==="succeeded" && !await acceptanceEvidence(store,runId)) throw new ControlError("landing-not-confirmed");
 const archives=store.db.prepare("SELECT body FROM outbox WHERE kind='archive'").all().map(row=>JSON.parse(String(row.body)));
 const archive=archives.find(a=>a.runId===runId && a.snapshot?.artifactId===c.snapshot?.artifactId);
 const canonicalSource=join(await realpath(dirname(sourceDir)),basename(sourceDir));
 privateDirectory(dirname(sourceDir));
 if(!archive || basename(sourceDir)!==runId || canonicalSource!==archive.sourceDir || dirname(archive.sourceDir)!==archive.runsRoot || !within(archive.runsRoot,archive.sourceDir)) throw new ControlError("cleanup-path-invalid");
 await verifyCandidateArtifacts(store,c);
 privateDirectory(archive.runsRoot);
 const assertSource=async()=>{
  const stat=await lstat(sourceDir,{bigint:true});
  if(stat.isSymbolicLink() || !stat.isDirectory() || await realpath(sourceDir)!==archive.sourceDir) throw new ControlError("cleanup-path-invalid");
  const actual={dev:String(stat.dev),ino:String(stat.ino),birthtimeNs:String(stat.birthtimeNs)};
  if(JSON.stringify(actual)!==JSON.stringify(archive.sourceIdentity)) throw new ControlError("cleanup-source-reused");
 };
 try {await assertSource();}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT") {
  const finish=async()=>store.transaction(()=>store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=? AND kind='cleanup'").run("cleanup:"+runId));await (deps.admit?deps.admit(finish):finish());return {removed:false};
 }throw error;}
 const intent=async()=>store.transaction(()=>store.db.prepare("INSERT INTO outbox VALUES (?, 'cleanup', ?, 0) ON CONFLICT(id) DO NOTHING").run("cleanup:"+runId,JSON.stringify({runId,sourceDir})));
 await (deps.admit?deps.admit(intent):intent());
 await deps.beforeCleanup?.();
 const assertTaskResultOwner=await flushTaskResults(store,runId);
 const finish=async()=>{await assertSource();assertTaskResultOwner();await rm(sourceDir,{recursive:true});return store.transaction(()=>store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run("cleanup:"+runId));};
 await (deps.admit?deps.admit(finish):finish());return {removed:true};
}

/**
 * Change-sized runs spec 2026-11-19 §5.6 (P0): the one way a run's result copy (`<sourceDir>/repo`, and with `extras`
 * `<sourceDir>/repos`) is deleted. Only once the run's latest archive row is complete (`missing: []` and a snapshot: it
 * holds all of the copy), only for a terminal run (no further ccloop control call reads the copy), and only inside the
 * exact source directory that archive recorded (path and identity, as cleanupCommittedRun checks them). A partial archive
 * keeps the copy by design. Absent copies are not an error, so every caller can repeat it after a crash.
 */
export async function removeResultCopies(store:ControlStore,runId:string,sourceDir:string,options:{extras:boolean}):Promise<{removed:string[];kept:"archive-partial"|null}> {
 const row=store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC LIMIT 1").get(runId);
 if(row===undefined) throw new ControlError("result-copy-unarchived");
 const archive=JSON.parse(String(row.body)) as {sourceDir:string;sourceIdentity:unknown;snapshot:unknown;missing:string[]};
 if(archive.missing.length>0 || archive.snapshot===null || archive.snapshot===undefined) return {removed:[],kept:"archive-partial"};
 if(!isTerminalRunState(readRun(store,runId).state)) throw new ControlError("result-copy-run-active");
 if(basename(sourceDir)!==runId || join(await realpath(dirname(sourceDir)),basename(sourceDir))!==archive.sourceDir) throw new ControlError("cleanup-path-invalid");
 let stat;
 try {stat=await lstat(sourceDir,{bigint:true});}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT") return {removed:[],kept:null};throw error;}
 if(stat.isSymbolicLink() || !stat.isDirectory() || await realpath(sourceDir)!==archive.sourceDir) throw new ControlError("cleanup-path-invalid");
 if(JSON.stringify({dev:String(stat.dev),ino:String(stat.ino),birthtimeNs:String(stat.birthtimeNs)})!==JSON.stringify(archive.sourceIdentity)) throw new ControlError("cleanup-source-reused");
 const present:string[]=[];
 for(const path of [join(sourceDir,"repo"),...(options.extras?[join(sourceDir,"repos")]:[])]) {
  let entry;
  try {entry=await lstat(path);}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT") continue;throw error;}
  if(entry.isSymbolicLink() || !entry.isDirectory()) throw new ControlError("cleanup-path-invalid",basename(path));
  present.push(path);
 }
 // No `force`: anything but a clean removal surfaces to the caller.
 for(const path of present) await rm(path,{recursive:true});
 return {removed:present,kept:null};
}
