import { mkdir,readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fakePeer } from "./peer.js";
import { git } from "./archive.js";
import { caps } from "./store.js";
import type { ExecutionPort,StartEnvelope,ExecutionReport } from "../../../src/control/executionPort.js";
export function roundPeer(root:string):ExecutionPort {
 const peer=(input:StartEnvelope)=>fakePeer(join(root,input.claim.runId));
 return {
  capabilities:async()=>caps,
  accept:input=>peer(input).accept(input),inspect:input=>peer(input).inspect(input),
  requestHandoff:(input,request)=>peer(input).requestHandoff(input,request),
  readEvidence:async ref=>readFile(join(root,ref.artifactId)),
  collect:async(input)=>{
   const reportPath=join(root,input.claim.runId,"terminal.json");
   try{return JSON.parse(await readFile(reportPath,"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
   const work=input.work!;await mkdir(work.sourceDir,{recursive:true});
   const repo=join(work.sourceDir,"repo");git(work.targetRepo,"clone","--no-hardlinks",work.targetRepo,repo);git(repo,"checkout","--detach",work.base);
   const id=input.claim.taskId!;
   if(id==="T1") {await writeFile(join(repo,"a.txt"),"a1\n");await writeFile(join(repo,"shared.txt"),"T1 changed\n");}
   else if(id==="T2") {await writeFile(join(repo,"b.txt"),"b1\n");await writeFile(join(repo,"shared.txt"),"T2 changed\n");}
   else await writeFile(join(repo,"shared.txt"),"one and two\n");
   git(repo,"add",".");git(repo,"commit","-qm",id);const sha=git(repo,"rev-parse","HEAD").toString().trim();
   git(repo,"update-ref",`refs/ccloop/${input.claim.runId}/attempts/1`,sha);
   const evidence=async(name:string,value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));const artifactId=input.claim.runId+"-"+name;await writeFile(join(root,artifactId),bytes);return {artifactId,hash:createHash("sha256").update(bytes).digest("hex")};};
   const usage=await evidence("usage",{tokens:1,activeMs:1,attempts:1,sessions:1});
   const source=await evidence("stop",{executionId:"execution-1",generation:1,isolated:true});
   const c=input.claim;
   const handoff=await evidence("handoff",{protocol:1,identity:{groupId:c.groupId,workItemId:c.workItemId,taskId:c.taskId,runId:c.runId,generation:c.generation,graphVersion:c.graphVersion,targetVersion:c.targetVersion},request:null,runState:{status:"succeeded"},completed:[id],unfinished:[],pendingDecisions:[],awaitingHuman:[],validationCommands:[],rawLogs:[],usageHighWater:2,unresolvedRequestIds:[],artifacts:[]});
   const report:ExecutionReport={events:[{runId:c.runId,generation:1,eventSeq:1,bucket:"work",cumulative:{tokens:1,activeMs:1,attempts:1,sessions:1},source:usage},{runId:c.runId,generation:1,eventSeq:2,bucket:"handoff",cumulative:{tokens:0,activeMs:0,attempts:0,sessions:0},source:usage}],candidate:{groupId:c.groupId,workItemId:c.workItemId,taskId:c.taskId,runId:c.runId,generation:c.generation,graphVersion:c.graphVersion,targetVersion:c.targetVersion,checkpointId:"peer-"+c.runId,usageHighWater:2,result:"complete",artifacts:[usage,source,handoff],snapshot:null,missing:[],unresolvedRequestIds:[],stopProof:{executionId:"execution-1",generation:1,isolated:true,source},terminalOutcome:"succeeded",handoff},terminal:{outcome:"succeeded",attemptSha:sha,sourceDir:work.sourceDir,repoDir:repo}};
   await writeFile(join(work.sourceDir,"stdout.log"),"raw peer output\n");await writeFile(reportPath,JSON.stringify(report));return report;
  },
 };
}
