import {expect,it} from "vitest";

import {webFixture} from "./fixtures/web.js";
import {readControlGroup} from "../../src/panel/controlViews.js";
import {WebControlService} from "../../src/control/webService.js";
it("finite optional task ceiling can exceed free group reserve",async()=>{
 const h=await webFixture(undefined,[{taskId:"a",loop:{goal:"ship",successCondition:"passes",targetPaths:["a"],checks:["true"],tokenBudget:99000}}],{tokenPolicy:"optional-v1"});
 try {
  const service=new WebControlService(h.deps);let view=readControlGroup(h.store,"epoch","g");
  // Tester round 2 (ruling H2, spec §5.2.2; 「这次批准改写所有必要的判据」): the queued estimate now commits the 1,000,000-token
  // cap (was 250,000), so the finite limit is 2,500,000 (was 1,500,000) to leave the same kind of small free reserve
  // (500,000) that the 1,000,000-token task ceiling below exceeds.
  expect(service.editProposal(h.command("proposal-edit",{baseProposalVersion:view.proposal.proposalVersion,operations:[],proposedGroupLimit:{...view.ledger.groupLimit,tokens:2500000}}))).not.toHaveProperty("error");
  view=readControlGroup(h.store,"epoch","g");expect(view.workItems[0]).toMatchObject({tokenAccountingMode:"optional-v1"});
  const current=view.allocations.find(a=>a.ownerId==="a"&&a.bucket==="work")!.amount;
  const result=await service.setTaskLoop(h.taskCommand("set-task-loop","a",{baseLoopVersion:0,plan:"standard",inputs:view.workItems[0]!.loopPlan!.inputs,work:{tokens:1000000,activeMs:current.activeMs,attempts:current.attempts}}));
  expect(result).not.toHaveProperty("error");
  const updated=readControlGroup(h.store,"epoch","g");expect(updated.workItems[0]).toMatchObject({tokenAccountingMode:"optional-v1"});expect(updated.ledger.committedRemaining).toEqual(view.ledger.committedRemaining);expect(updated.ledger.explicitUnallocatedReserve).toEqual(view.ledger.explicitUnallocatedReserve);expect(updated.allocations.find(a=>a.ownerId==="a"&&a.bucket==="work")!.amount.tokens).toBe(1_000_000);
 }finally{await h.dispose();}
});
it("reports legacy task accounting even after the owner clears the group token ceiling",async()=>{
 const h=await webFixture();try{const service=new WebControlService(h.deps);expect(await service.confirm(h.command("confirm",await h.confirmPayload()))).not.toHaveProperty("error");const before=readControlGroup(h.store,"epoch","g");expect(service.setLimit(h.command("set-limit",{limit:{...before.ledger.groupLimit,tokens:null}}))).not.toHaveProperty("error");const after=readControlGroup(h.store,"epoch","g");expect(after.ledger.groupLimit.tokens).toBeNull();expect(after.workItems[0]).toMatchObject({tokenAccountingMode:"finite-legacy"});}finally{await h.dispose();}
});
