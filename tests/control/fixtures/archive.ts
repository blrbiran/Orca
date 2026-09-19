import { mkdir, writeFile, chmod, symlink, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { openTestStore, seedBudgetCase } from "./store.js";
import { claimWork } from "../../../src/control/budget.js";
import { startClaim } from "../../../src/control/dispatch.js";
import { hashPayload } from "../../../src/control/commands.js";
import { fakePeer } from "./peer.js";
export function git(repo:string,...args:string[]):Buffer {return execFileSync("git",["-C",repo,...args],{env:{...process.env,GIT_AUTHOR_NAME:"Control Test",GIT_AUTHOR_EMAIL:"test@example.invalid",GIT_COMMITTER_NAME:"Control Test",GIT_COMMITTER_EMAIL:"test@example.invalid"}});}
export async function archiveCase() {
 const h=await openTestStore();const seed=seedBudgetCase(h.store);const claim=claimWork(h.store,seed.t1Claim);
 await startClaim(h.store,fakePeer(join(h.root,"peer")),{protocol:1,claim,contractHash:hashPayload(seed.w1.contract),inputCheckpoint:null});
 const sourceDir=join(h.root,"runs",claim.runId),repoDir=join(sourceDir,"repo");await mkdir(repoDir,{recursive:true});
 git(repoDir,"init","-q");
 await writeFile(join(repoDir,"tracked"),"HEAD\n");await writeFile(join(repoDir,"deleted"),"delete me\n");
 git(repoDir,"add",".");git(repoDir,"commit","-qm","base");git(repoDir,"checkout","--detach","-q");
 await writeFile(join(repoDir,"tracked"),"INDEX\n");git(repoDir,"add","tracked");await writeFile(join(repoDir,"tracked"),"WORKTREE\n");
 await unlink(join(repoDir,"deleted"));await writeFile(join(repoDir,"binary"),Buffer.from([0,255,128,1]));
 await writeFile(join(repoDir,"executable"),"#!/bin/sh\n");await chmod(join(repoDir,"executable"),0o755);
 await symlink("/outside/not-followed",join(repoDir,"link"));
 await writeFile(join(repoDir,".gitignore"),"ignored\n");await writeFile(join(repoDir,"ignored"),"kept ignored\n");
 for(const file of ["stdout.log","stderr.log","usage.json","verification.log","contract.json","config.json"]) await writeFile(join(sourceDir,file),"raw "+file+"\n");
 const stopProof={executionId:"execution-1",generation:1,isolated:true as const,source:seed.usageRef};
 return {...h,claim,sourceDir,repoDir,stopProof};
}
