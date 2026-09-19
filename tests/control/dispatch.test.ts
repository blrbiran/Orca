import { describe,it,expect } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { claimWork } from "../../src/control/budget.js";
import { startClaim,reconcileStart } from "../../src/control/dispatch.js";
import { productionExecutionPort } from "../../src/control/executionPort.js";
import { getGroup,getRun } from "../../src/control/queries.js";
import { hashPayload,setGroupStopped } from "../../src/control/commands.js";
import { openTestStore,seedBudgetCase } from "./fixtures/store.js";
import { fakePeer } from "./fixtures/peer.js";
const setup=async()=>{const h=await openTestStore();const s=seedBudgetCase(h.store);const claim=claimWork(h.store,s.t1Claim);return {...h,envelope:{protocol:1 as const,claim,contractHash:hashPayload(s.w1.contract),inputCheckpoint:null}};};
describe("durable starts",()=>{
 it("recovers the accepted identity after the peer drops its response, without another launch",async()=>{
  const h=await setup();try{
   const root=join(h.root,"peer");await expect(startClaim(h.store,fakePeer(root,"drop"),h.envelope)).rejects.toThrow("start-outcome-unknown");
   expect(getRun(h.store,h.envelope.claim.runId).state).toBe("unknown");
   const recovered=await reconcileStart(h.store,fakePeer(root),h.envelope.claim.runId);
   expect(recovered.executionId).toBe("execution-1");
   await startClaim(h.store,fakePeer(root),h.envelope);
   expect(await readFile(join(root,"launches"),"utf8")).toBe("1\n");
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(80);
  }finally{await h.dispose();}
 });
 it("writes the full immutable intent before handing off to the peer and rejects altered identity",async()=>{
  const h=await setup();try{
   const root=join(h.root,"peer");const real=fakePeer(root);
   await startClaim(h.store,{...real,accept:async input=>{
    const row=h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get("start:"+input.claim.runId);
    expect(JSON.parse(String(row?.body))).toEqual(input);
    expect(getRun(h.store,input.claim.runId).state).toBe("starting");
    return real.accept(input);
   }},h.envelope);
   await expect(startClaim(h.store,real,{...h.envelope,claim:{...h.envelope.claim,generation:2}})).rejects.toThrow("run-generation-conflict");
   for(const patch of [{configHash:"changed"},{ownerToken:"other"}]) await expect(startClaim(h.store,real,{...h.envelope,claim:{...h.envelope.claim,...patch}})).rejects.toThrow();
   await expect(startClaim(h.store,real,{...h.envelope,contractHash:"different"})).rejects.toThrow("start-envelope-conflict");
   expect(await readFile(join(root,"launches"),"utf8")).toBe("1\n");
  }finally{await h.dispose();}
 });
 it("keeps unknown ownership despite a dead service PID, expired clock or unavailable inspect",async()=>{
  const h=await setup();try{
   const root=join(h.root,"peer");await expect(startClaim(h.store,fakePeer(root,"drop"),h.envelope)).rejects.toThrow();
   const before=getGroup(h.store,"g1");
   await reconcileStart(h.store,fakePeer(root,"unknown"),h.envelope.claim.runId);
   expect(getRun(h.store,h.envelope.claim.runId).state).toBe("unknown");
   expect(getGroup(h.store,"g1").reserved).toEqual(before.reserved);
   expect(h.store.db.prepare("SELECT active FROM runs").get()?.active).toBe(1);
   expect(await readFile(join(root,"launches"),"utf8")).toBe("1\n");
  }finally{await h.dispose();}
 });
 it("does not send an absent start after stop is latched",async()=>{
  const h=await setup();try{
   const root=join(h.root,"peer");const peer=fakePeer(root);
   await expect(startClaim(h.store,{...peer,accept:async()=>{throw new Error("connection-before-send");}},h.envelope)).rejects.toThrow();
   setGroupStopped(h.store,"g1",true,{commandId:"stop",expectedRevision:3,by:"human"});
   await reconcileStart(h.store,peer,h.envelope.claim.runId);
   await expect(readFile(join(root,"launches"))).rejects.toThrow();
   expect(getGroup(h.store,"g1").reserved.tokens).toBe(80);
  }finally{await h.dispose();}
 });
 it("has a launch counter positive control that detects a deliberately non-idempotent peer",async()=>{
  const h=await setup();try{
   const root=join(h.root,"peer");const bad=fakePeer(root,"non-idempotent");
   await bad.accept(h.envelope);expect(await readFile(join(root,"launches"),"utf8")).toBe("1\n");
   await bad.accept(h.envelope);expect(await readFile(join(root,"launches"),"utf8")).toBe("2\n");
  }finally{await h.dispose();}
 });
 it("refuses production adapters until ccloop implements the public control protocol",()=>{expect(()=>productionExecutionPort()).toThrow("control-protocol-unavailable");});
});
