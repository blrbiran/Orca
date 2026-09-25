import { describe,expect,it } from "vitest";
import { readRun } from "../../src/control/budget.js";
import { claimContinuation } from "../../src/control/continuation.js";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { getGroup } from "../../src/control/queries.js";
import { candidateCase } from "./fixtures/candidate.js";
import { ControlService } from "../../src/control/service.js";
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
      const port:ExecutionPort={resolveAgent:async partial=>resolvedAs(caps,partial),listAgents:async()=>agentsView,readEvidence:async()=>Buffer.alloc(0),accept:async input=>(accepted=input,{kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),inspect:async input=>({kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),requestHandoff:async(_input,request)=>({kind:"latched",requestId:request.requestId}),collect:async()=>({events:[],candidate:null,terminal:null})};
      const service=new ControlService(h.store,port),first=await service.continueTask("g1","T1",{commandId:"continue-service",expectedRevision:3});
      expect(first.runId).not.toBe(h.claim.runId);expect(accepted?.inputCheckpoint).toMatchObject({predecessorRunId:h.claim.runId,checkpointId:"cp1"});expect(accepted?.work.sourceDir).toContain(first.runId);
      const replay=await service.continueTask("g1","T1",{commandId:"continue-service",expectedRevision:3});expect(replay.runId).toBe(first.runId);
      await expect(service.continueTask("g1","T1",{commandId:"another-continuation",expectedRevision:3})).rejects.toThrow("work-already-active");
      await expect(service.continueTask("g1","T1",{commandId:"stale",expectedRevision:2})).rejects.toThrow("revision-conflict");
    }finally{await h.dispose();}
  });
});
