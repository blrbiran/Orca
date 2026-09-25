import { archiveCase } from "./archive.js";
import { archiveRun,writeArtifact } from "../../../src/control/archive.js";
import { recordUsage } from "../../../src/control/usage.js";
import type { Candidate } from "../../../src/control/types.js";
export async function candidateCase() {
 const h=await archiveCase();
 const source=await writeArtifact(h.store,"usage-final",Buffer.from(JSON.stringify({tokens:40,activeMs:20,attempts:1,sessions:1})));
 const stopSource=await writeArtifact(h.store,"stop-final",Buffer.from(JSON.stringify({executionId:"execution-1",generation:1,isolated:true})));
 const handoffPacket={protocol:1,identity:{groupId:h.claim.groupId,workItemId:h.claim.workItemId,taskId:h.claim.taskId,runId:h.claim.runId,generation:h.claim.generation,graphVersion:h.claim.graphVersion,targetVersion:h.claim.targetVersion},request:null,runState:{status:"succeeded"},completed:["implemented"],unfinished:["follow-up"],pendingDecisions:["choose"],awaitingHuman:["approve"],validationCommands:["npm test"],rawLogs:[],usageHighWater:2,unresolvedRequestIds:[],artifacts:[]};
 const handoff=await writeArtifact(h.store,"handoff-final",Buffer.from(JSON.stringify(handoffPacket)));
 const proof={...h.stopProof,source:stopSource};
 recordUsage(h.store,{runId:h.claim.runId,generation:1,eventSeq:1,bucket:"work",cumulative:{tokens:40,activeMs:20,attempts:1,sessions:1},source});
 recordUsage(h.store,{runId:h.claim.runId,generation:1,eventSeq:2,bucket:"handoff",cumulative:{tokens:0,activeMs:0,attempts:0,sessions:0},source});
 const archive=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:proof});
 // Agent selection: the claim carries `agent` too; a candidate names the run, not its selection.
 const {commandId:_commandId,configHash:_configHash,agent:_agent,grant:_grant,ownerToken:_ownerToken,...candidateIdentity}=h.claim;
 const candidate:Candidate={...candidateIdentity,checkpointId:"cp1",usageHighWater:2,result:"complete",artifacts:[...archive.artifacts,source,stopSource,handoff],snapshot:archive.snapshot,missing:[],unresolvedRequestIds:[],stopProof:proof,terminalOutcome:"succeeded",handoff};
 return {...h,candidate};
}
