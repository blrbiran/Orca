import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlStore } from "../../../src/control/store.js";
export async function openTestStore() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-control-")));
  const store = await openControlStore({ stateDir: join(root, "state") });
  return { root, store, async dispose() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createGroup, putWork } from "../../../src/control/commands.js";
import type { ControlStore } from "../../../src/control/store.js";
import type { ClaimInput, WorkInput } from "../../../src/control/types.js";
import type { AgentResolution, AgentSelection, PartialSelection } from "../../../src/control/agentSelection.js";
import type { AgentsView } from "../../../src/control/executionPort.js";
import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";
// Human authorization (2026-09-24, ruling-88): upgraded to the v2 wire vocabulary (G1 seam A
// Task 3) so callers exercise a strict-capable answer rather than the retired v1 shape.
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the view carries no protocol
// tag any more -- capabilities protocol 3 answers it inside one selection's resolution (spec §4.6).
export const caps:CapabilityViewV1={usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"realtime",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:200000,requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["activeMs","tokens"],handoffDimensions:["activeMs","tokens"],evidenceKind:"offline-peer-v1"}};
/** Agent selection spec §3: the complete selection every legacy fixture work item is frozen with. */
export const fixtureAgent:AgentSelection={agent:"codex",model:"fixture-model",contextWindow:"agent-default"};
/** A capabilities-v3 answer for `partial`: the given fields echoed (spec M5), the fixture's defaults for the rest. */
export const resolvedAs=(capabilities:CapabilityViewV1,partial:PartialSelection={}):AgentResolution=>({selection:{...fixtureAgent,...partial},configHash:"config1",timeoutMs:120_000,killGraceMs:5_000,capabilities});
export const agentsView:AgentsView={installations:[{id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture"}]};
export const amount=(tokens:number,activeMs=10000,attempts=10,sessions=10)=>({tokens,activeMs,attempts,sessions});
export function seedBudgetCase(store:ControlStore,mode:"strict"|"soft"="strict") {
  createGroup(store,{groupId:"g1",projectKey:"example/repo",goal:"Ship",successConditions:["checks pass"],budgetMode:mode,limit:amount(100,1000000,100,100),reviewReserve:amount(10,100,1,1),deadlineAt:null},{commandId:"create",expectedRevision:0,by:"human"});
  const w1:WorkInput={workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract:{scope:{allowedPaths:["one"]}},configHash:"config1",agent:fixtureAgent,grant:{work:amount(60,100000,2,2),handoff:amount(10,1000,0,0)}};
  const w2:WorkInput={...w1,workItemId:"T2",taskId:"T2",contract:{scope:{allowedPaths:["two"]}},grant:{work:amount(25,100000,2,2),handoff:amount(5,1000,0,0)}};
  putWork(store,"g1",w1,{commandId:"w1",expectedRevision:1,by:"human"});
  putWork(store,"g1",w2,{commandId:"w2",expectedRevision:2,by:"human"});
  const t1Claim:ClaimInput={groupId:"g1",workItemId:"T1",commandId:"claim1",expectedRevision:3,by:"service",graphVersion:3,targetVersion:1,capabilities:caps};
  const t2Claim:ClaimInput={...t1Claim,workItemId:"T2",commandId:"claim2"};
  const bytes=Buffer.from('{"source":"offline-peer","cumulative":40}');
  writeFileSync(join(store.stateDir,"usage-source.json"),bytes,{mode:0o600});
  const usageRef={artifactId:"usage-source",hash:createHash("sha256").update(bytes).digest("hex")};
  return {t1Claim,t2Claim,usageRef,w1,w2};
}
