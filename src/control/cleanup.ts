import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ControlStore } from "./store.js";
import { ControlError } from "./errors.js";
import { readRun } from "./budget.js";
import { acceptanceEvidence, readCommittedCheckpoint, verifyCandidateArtifacts } from "./checkpoints.js";
import { within } from "./archive.js";
import { privateDirectory } from "./paths.js";
export async function cleanupCommittedRun(store:ControlStore,runId:string,sourceDir:string,deps:{beforeCleanup?:()=>Promise<void>}={}):Promise<{removed:boolean}> {
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
  store.transaction(()=>store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=? AND kind='cleanup'").run("cleanup:"+runId));return {removed:false};
 }throw error;}
 store.transaction(()=>store.db.prepare("INSERT INTO outbox VALUES (?, 'cleanup', ?, 0) ON CONFLICT(id) DO NOTHING").run("cleanup:"+runId,JSON.stringify({runId,sourceDir})));
 await deps.beforeCleanup?.();await assertSource();await rm(sourceDir,{recursive:true});
 store.transaction(()=>store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run("cleanup:"+runId));return {removed:true};
}
