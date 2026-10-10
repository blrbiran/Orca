import {expect,it} from "vitest";
import {webFixture,profileSnapshot} from "./fixtures/web.js";
import {WebControlService} from "../../src/control/webService.js";
import {deliverScheduledStart} from "../../src/control/webDispatch.js";
import {assertCapabilities,readRun} from "../../src/control/budget.js";
import {caps} from "./fixtures/store.js";
import {stepA1} from "../../src/control/executionDriver.js";
import {controlWorkspaceRoots} from "../../src/control/workspace.js";
const activeOnly=()=>{const snapshot=profileSnapshot();snapshot.profile.capabilities.requestBoundProof!.workDimensions=["activeMs"];return snapshot;};
async function prepared(){const h=await webFixture(activeOnly(),[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});const service=new WebControlService(h.deps);expect(await service.confirm(h.command("confirm",await h.confirmPayload()))).not.toHaveProperty("error");return {h,service};}
it("requires a token proof only for an actual finite work grant while retaining bounded capability and proof descriptors",()=>{
 const capabilities={...caps,requestBoundProof:{...caps.requestBoundProof!,workDimensions:["activeMs" as const]}};
 expect(()=>assertCapabilities("strict",capabilities,null)).not.toThrow();
 expect(()=>assertCapabilities("strict",capabilities,1_600_000)).toThrow("control-capability-unsupported");
 expect(()=>assertCapabilities("strict",{...capabilities,requestBoundProof:null},null)).toThrow("control-capability-unsupported");
});
it("admits an unbounded mechanical-handoff policy preflight but still refuses strict execution at the driver",async()=>{
 const {h,service}=await prepared();try{
  expect(await service.start(h.command("start",{}))).not.toHaveProperty("error");
  const claim=await deliverScheduledStart(h.deps,"g");expect(claim.kind).toBe("claimed");if(claim.kind!=="claimed")return;
  stepA1({store:h.store,router:h.deps.profileRouter,roots:controlWorkspaceRoots(h.store.stateDir),resolveRepository:()=>h.root,ccloopBin:"/bin/false",agentsTablePath:"/not-used"},claim.runId);
  expect(readRun(h.store,claim.runId)).toMatchObject({state:"blocked",drive:{blockedReason:"strict-proof-unimplemented"}});
  expect(h.accept).not.toHaveBeenCalled();
 }finally{await h.dispose();}
});
it("requires finite token proof when an unlimited authored policy is funded by a cap",async()=>{
 const {h,service}=await prepared();try{
  h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();
  expect(await service.start(h.command("start",{}))).toMatchObject({error:{code:"control-capability-unsupported"}});
  expect(h.store.db.prepare("SELECT id FROM runs").all()).toEqual([]);
 }finally{await h.dispose();}
});
it("rechecks a cap installed while a probe is held before reserving the actual finite grant",async()=>{
 const {h,service}=await prepared();try{
  expect(await service.start(h.command("start",{}))).not.toHaveProperty("error");
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
  const router={...h.deps.profileRouter,probe:async(...args:Parameters<typeof h.deps.profileRouter.probe>)=>{enter();await held;return h.deps.profileRouter.probe(...args);}};
  const pending=deliverScheduledStart({...h.deps,profileRouter:router},"g");await entered;
  h.store.transaction(()=>h.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run());release();
  expect(await pending).toEqual({kind:"blocked",reason:"claim-capability-unavailable"});
  expect(h.store.db.prepare("SELECT id FROM runs").all()).toEqual([]);
 }finally{await h.dispose();}
});

it.each([false,true])("keeps finite model-assisted handoff proof separate from unbounded work (%s)",async handoffProven=>{
 const snapshot=activeOnly();snapshot.profile.capabilities.handoffExecution="model-assisted-v1";
 snapshot.profile.capabilities.requestBoundProof!.handoffDimensions=handoffProven?["tokens"]:[];
 const h=await webFixture(snapshot,[{taskId:"a",tokenBudget:null}],{tokenPolicy:"optional-v1"});try{
  const service=new WebControlService(h.deps);
  expect(service.editProposal(h.command("proposal-edit",{baseProposalVersion:1,operations:["attempts","sessions"].map(dimension=>({target:{scope:"task",taskId:"a",allocation:"handoff",dimension},value:1,provenance:"human"}))} as never))).not.toHaveProperty("error");
  expect(await service.confirm(h.command("confirm",await h.confirmPayload()))).not.toHaveProperty("error");
  const result=await service.start(h.command("start",{}));
  if(handoffProven)expect(result).not.toHaveProperty("error");else expect(result).toMatchObject({error:{code:"control-capability-unsupported"}});
 }finally{await h.dispose();}
});
