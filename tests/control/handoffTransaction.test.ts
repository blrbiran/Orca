import { describe,expect,it,vi } from "vitest";
import { putWork } from "../../src/control/commands.js";
import { claimWork } from "../../src/control/budget.js";
import { getGroup,getRun,readWork } from "../../src/control/queries.js";
import { ControlService } from "../../src/control/service.js";
import { startClaim } from "../../src/control/dispatch.js";
import { hashPayload } from "../../src/control/commands.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { candidateCase } from "./fixtures/candidate.js";
import { readArtifact } from "../../src/control/archive.js";
import { fakePeer } from "./fixtures/peer.js";
import { openTestStore,seedBudgetCase,amount } from "./fixtures/store.js";

describe("handoff transaction",{timeout:30000},()=>{
  async function started(h:Awaited<ReturnType<typeof openTestStore>>,s:ReturnType<typeof seedBudgetCase>,parent:ReturnType<typeof claimWork>,peer:ReturnType<typeof fakePeer>){const sourceDir=join(h.root,"runs",parent.runId);await mkdir(sourceDir,{recursive:true});await startClaim(h.store,peer,{protocol:2,claim:parent,contractHash:hashPayload(s.w1.contract),inputCheckpoint:null,work:{contract:s.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir}});}
  it("persists one immutable request intent before RPC and retries the same request",async()=>{
    const h=await openTestStore();try{const s=seedBudgetCase(h.store),parent=claimWork(h.store,s.t1Claim);
      const basePeer=fakePeer(join(h.root,"peer"));await started(h,s,parent,basePeer);
      putWork(h.store,"g1",{...s.w1,workItemId:"handoff-T1",kind:"handoff",parentRunId:parent.runId,grant:{work:amount(0,0,0,0),handoff:s.w1.grant.handoff}},{commandId:"register-handoff",expectedRevision:3,by:"service"});
      let calls=0;const peer={...basePeer,requestHandoff:vi.fn(async()=>{calls++;if(calls===1)throw new Error("lost-response");return {kind:"latched" as const,requestId:"request-1"};})};
      const service=new ControlService(h.store,peer);const input={requestId:"request-1",reason:"context" as const,deadlineAt:"2030-01-01T00:00:00Z"};
      await expect(service.requestHandoff("g1",parent.runId,input)).rejects.toThrow("handoff-outcome-unknown");
      expect(h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get("handoff-request:"+parent.runId)).toBeTruthy();expect(getGroup(h.store,"g1").reserved.tokens).toBe(80);
      await expect(service.requestHandoff("g1",parent.runId,input)).resolves.toMatchObject({runId:parent.runId});expect(peer.requestHandoff).toHaveBeenCalledTimes(2);
      await expect(service.requestHandoff("g1",parent.runId,{...input,reason:"shutdown"})).rejects.toThrow("handoff-request-conflict");
    }finally{await h.dispose();}}
  );
  it("keeps both reservations and ownership when no quiet proof is available",async()=>{
    const h=await openTestStore();try{const s=seedBudgetCase(h.store),parent=claimWork(h.store,s.t1Claim);
      const basePeer=fakePeer(join(h.root,"peer"));await started(h,s,parent,basePeer);
      putWork(h.store,"g1",{...s.w1,workItemId:"handoff-T1",kind:"handoff",parentRunId:parent.runId,grant:{work:amount(0,0,0,0),handoff:s.w1.grant.handoff}},{commandId:"register-handoff",expectedRevision:3,by:"service"});
      const before=getGroup(h.store,"g1").reserved,handoffBytes=Buffer.from(JSON.stringify({unfinished:["next"],pendingDecisions:[],awaitingHuman:["approval"]})),handoff={artifactId:"handoff-candidate",hash:createHash("sha256").update(handoffBytes).digest("hex")};
      const candidate={groupId:"g1",workItemId:"T1",taskId:"T1",runId:parent.runId,generation:1,graphVersion:3,targetVersion:1,checkpointId:"pending-proof",usageHighWater:0,result:"partial" as const,artifacts:[handoff],snapshot:null,missing:[],unresolvedRequestIds:["r"],stopProof:null,terminalOutcome:"cancelled",handoff};
      const peer={...basePeer,requestHandoff:async()=>({kind:"latched" as const,requestId:"r"}),collect:async()=>({events:[],candidate,terminal:null}),readEvidence:async()=>handoffBytes};
      await new ControlService(h.store,peer).requestHandoff("g1",parent.runId,{requestId:"r",reason:"human",deadlineAt:"2030-01-01T00:00:00Z"});
      expect(getGroup(h.store,"g1").reserved).toEqual(before);expect(getRun(h.store,parent.runId).state).not.toBe("settled");expect(h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(parent.runId)?.active).toBe(1);
    }finally{await h.dispose();}}
  );
  it("archives and commits a proven candidate before releasing the parent reserve",async()=>{
    const h=await candidateCase();try{
      const parentWork=readWork(h.store,"g1","T1"),{targetVersion:_targetVersion,status:_status,...workInput}=parentWork;putWork(h.store,"g1",{...workInput,workItemId:"handoff-T1",kind:"handoff",parentRunId:h.claim.runId,grant:{work:amount(0,0,0,0),handoff:parentWork.grant.handoff}},{commandId:"register-proven-handoff",expectedRevision:3,by:"service"});
      const before=getGroup(h.store,"g1").reserved.tokens,raw={...h.candidate,snapshot:null};
      const port={...fakePeer(join(h.root,"peer")),resolveAgent:async()=>{const fixtures=await import("./fixtures/store.js");return fixtures.resolvedAs(fixtures.caps);},requestHandoff:async()=>({kind:"complete" as const,requestId:"proven",checkpointId:raw.checkpointId}),collect:async()=>({events:[],candidate:raw,terminal:{outcome:"succeeded" as const,attemptSha:null,sourceDir:h.sourceDir,repoDir:h.repoDir}}),readEvidence:(ref:typeof raw.handoff)=>readArtifact(h.store,ref)};
      await new ControlService(h.store,port).requestHandoff("g1",h.claim.runId,{requestId:"proven",reason:"context",deadlineAt:"2030-01-01T00:00:00Z"});
      expect(getRun(h.store,h.claim.runId)).toMatchObject({state:"settled",checkpointId:"cp1",recoverable:true});expect(getGroup(h.store,"g1").reserved.tokens).toBeLessThan(before);expect(h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get("handoff-request:"+h.claim.runId)?.delivered).toBe(1);
    }finally{await h.dispose();}
  });
});
