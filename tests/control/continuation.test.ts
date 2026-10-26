import { describe,expect,it } from "vitest";
import { readRun } from "../../src/control/budget.js";
import { continuationWakeBody, claimContinuation, resumeFlowChildInTransaction } from "../../src/control/continuation.js";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { getGroup } from "../../src/control/queries.js";
import { candidateCase } from "./fixtures/candidate.js";
import { ControlService } from "../../src/control/service.js";
import { WebControlService } from "../../src/control/webService.js";
import { createStartingRun, readFrozenSnapshot } from "../../src/control/webDispatch.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
import { agentsView, caps, resolvedAs } from "./fixtures/store.js";
import type { ExecutionPort,StartEnvelope } from "../../src/control/executionPort.js";
import { recordUsage } from "../../src/control/usage.js";

describe("continuation claims",{timeout:30000},()=>{
  it("creates a fresh run and reserves predecessor grant minus cumulative without resetting used",async()=>{
    const h=await candidateCase();try{await commitCandidate(h.store,h.candidate);const before=getGroup(h.store,"g1");
      const next=claimContinuation(h.store,{groupId:"g1",predecessorRunId:h.claim.runId,workItemId:"T1",taskId:"T1",graphVersion:3,targetVersion:1,commandId:"continue-1",expectedRevision:3,by:"human"});
      expect(next.runId).not.toBe(h.claim.runId);expect(next.generation).toBe(1);expect(next.grant.work.tokens).toBe(20);expect(next.grant.handoff.tokens).toBe(10);
      expect(getGroup(h.store,"g1").used).toEqual(before.used);expect(getGroup(h.store,"g1").reserved.tokens).toBe(before.reserved.tokens+30);
      expect(readRun(h.store,next.runId)).toMatchObject({predecessorRunId:h.claim.runId,checkpointId:null,recoverable:false});
      expect(claimContinuation(h.store,{groupId:"g1",predecessorRunId:h.claim.runId,workItemId:"T1",taskId:"T1",graphVersion:3,targetVersion:1,commandId:"continue-1",expectedRevision:3,by:"human"})).toEqual(next);
    }finally{await h.dispose();}}
  );
  it("refuses active, stale, mismatched, unrecoverable, and zero-work predecessors",async()=>{
    const active=await candidateCase();try{expect(()=>claimContinuation(active.store,{groupId:"g1",predecessorRunId:active.claim.runId,workItemId:"T1",taskId:"T1",graphVersion:3,targetVersion:1,commandId:"c",expectedRevision:3,by:"human"})).toThrow("continuation-predecessor-unrecoverable");}finally{await active.dispose();}
    const h=await candidateCase();try{await commitCandidate(h.store,h.candidate);const base={groupId:"g1",predecessorRunId:h.claim.runId,workItemId:"T1",taskId:"T1",graphVersion:3,targetVersion:1,commandId:"c",expectedRevision:3,by:"human"};
      expect(()=>claimContinuation(h.store,{...base,taskId:"T2"})).toThrow("continuation-identity-conflict");expect(()=>claimContinuation(h.store,{...base,targetVersion:2,commandId:"c2"})).toThrow("target-version-conflict");
    }finally{await h.dispose();}
    const exhausted=await candidateCase();try{recordUsage(exhausted.store,{runId:exhausted.claim.runId,generation:1,eventSeq:3,bucket:"work",cumulative:{tokens:60,activeMs:20,attempts:1,sessions:1},source:exhausted.candidate.handoff});await commitCandidate(exhausted.store,{...exhausted.candidate,usageHighWater:3});
      expect(()=>claimContinuation(exhausted.store,{groupId:"g1",predecessorRunId:exhausted.claim.runId,workItemId:"T1",taskId:"T1",graphVersion:3,targetVersion:1,commandId:"zero",expectedRevision:3,by:"human"})).toThrow("continuation-budget-unavailable");
    }finally{await exhausted.dispose();}
  });
  it("exports and binds the verified resume bundle before starting and replays one new run",async()=>{
    const h=await candidateCase();try{await commitCandidate(h.store,h.candidate);let accepted:StartEnvelope|undefined;
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
      const port:ExecutionPort={resolveAgent:async partial=>resolvedAs(caps,partial),listAgents:async()=>agentsView,readEvidence:async()=>Buffer.alloc(0),accept:async input=>(accepted=input,{kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),inspect:async input=>({kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),requestHandoff:async(_input,request)=>({kind:"latched",requestId:request.requestId}),collect:async()=>({events:[],candidate:null,terminal:null})};
      const service=new ControlService(h.store,port),first=await service.continueTask("g1","T1",{commandId:"continue-service",expectedRevision:3});
      expect(first.runId).not.toBe(h.claim.runId);expect(accepted?.inputCheckpoint).toMatchObject({predecessorRunId:h.claim.runId,checkpointId:"cp1"});expect(accepted?.work.sourceDir).toContain(first.runId);
      const replay=await service.continueTask("g1","T1",{commandId:"continue-service",expectedRevision:3});expect(replay.runId).toBe(first.runId);
      await expect(service.continueTask("g1","T1",{commandId:"another-continuation",expectedRevision:3})).rejects.toThrow("work-already-active");
      await expect(service.continueTask("g1","T1",{commandId:"stale",expectedRevision:2})).rejects.toThrow("revision-conflict");
    }finally{await h.dispose();}
  });

  it("a flow continuation carries its operator note into the wake and the starting run (live transcript §10.5.2)",async()=>{
    const h=await webFixture(profileSnapshot(),[{taskId:"a"}]);try{
      await new WebControlService(h.deps).confirm(h.command("confirm",await h.confirmPayload()));
      const work=JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as {grant:{work:unknown;handoff:unknown};targetVersion:number};
      const runId="run-predecessor",checkpointId="cp-note",revision=Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision)+1;
      h.store.transaction(()=>{
        h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,0,?)").run(runId,"g","a",JSON.stringify({
          runId,groupId:"g",workItemId:"a",taskId:"a",generation:1,state:"settled-recoverable",recoverable:true,checkpointId,
          grant:work.grant,remaining:{work:{tokens:0,activeMs:0,attempts:0,sessions:0},handoff:{tokens:0,activeMs:0,attempts:0,sessions:0}},
          cumulative:{work:{tokens:0,activeMs:0,attempts:0,sessions:0},handoff:{tokens:0,activeMs:0,attempts:0,sessions:0}},unknown:{work:false,handoff:false},
        }));
        const candidate={checkpointId,groupId:"g",workItemId:"a",taskId:"a",runId,generation:1,graphVersion:1,targetVersion:work.targetVersion,usageHighWater:0,result:"partial",artifacts:[],snapshot:null,missing:[],unresolvedRequestIds:[],stopProof:null,terminalOutcome:"cancelled"};
        h.store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)").run(checkpointId,runId,sha256Canonical(candidate),canonicalBytes(candidate).toString("utf8"));
        h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({...JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)),status:"held",currentRunId:runId,pendingRunId:null}));
      });
      const note={text:"please also update the changelog",scope:"next-attempt"} as const,resumed=resumeFlowChildInTransaction(h.store,"g",revision,note);
      expect(resumed.pendingRunId).not.toBe(null);
      const wake=continuationWakeBody(h.store,"g");
      expect(wake).toMatchObject({resumeRevision:revision,continuations:[{pendingRunId:resumed.pendingRunId,operatorNote:note}]});
      const registered=wake!.continuations[0]!;
      expect(registered.operatorNote).toEqual(note);
      const run=h.store.transaction(()=>createStartingRun(h.store,"g",{workItemId:"a"},readFrozenSnapshot(h.store,"g"),revision,registered));
      expect(run.operatorNote).toEqual(note);
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(registered.pendingRunId)!.body)).operatorNote).toEqual(note);
    }finally{await h.dispose();}
  });
});
