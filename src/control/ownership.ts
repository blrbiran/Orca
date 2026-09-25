import type { ControlStore } from "./store.js";
import type { Claim } from "./types.js";
import { readRun } from "./budget.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
export function assertClaimIdentity(store:ControlStore,claim:Claim):void {
 const run=readRun(store,claim.runId);
 if(run.generation!==claim.generation) throw new ControlError("run-generation-conflict");
 for(const key of ["groupId","workItemId","taskId","ownerToken","configHash","commandId","graphVersion","targetVersion"] as const) {
  if(run[key]!==claim[key]) throw new ControlError("run-owner-conflict");
 }
 // Agent selection spec I1: the frozen selection is part of the claim's identity, beside the configHash that hashes it.
 if(hashPayload(run.agent)!==hashPayload(claim.agent)) throw new ControlError("run-owner-conflict");
 if(hashPayload(run.grant)!==hashPayload(claim.grant)) throw new ControlError("run-grant-conflict");
}
