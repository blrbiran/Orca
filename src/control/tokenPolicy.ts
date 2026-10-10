import type { CapabilityViewV1 } from "./webProtocol.js";
import type { Amount } from "./types.js";
import { amountSchema, budgetAmountSchema, safeInteger, tokenPolicySchema } from "./schema.js";
import { z } from "zod";

/** A ceiling, never an observation. Only tokens may be unbounded. */
export interface BudgetAmount { tokens: number | null; activeMs: number; attempts: number; sessions: number }
export { budgetAmountSchema } from "./schema.js";
export { tokenPolicySchema } from "./schema.js";
export type TokenPolicy = z.infer<typeof tokenPolicySchema>;
export function minTokenCeiling(left:number|null,right:number|null):number|null {
  if(left!==null)safeInteger.parse(left);if(right!==null)safeInteger.parse(right);
  return left===null?right:right===null?left:Math.min(left,right);
}
export function remainingBudget(ceiling:BudgetAmount,used:Amount):BudgetAmount {
  budgetAmountSchema.parse(ceiling);amountSchema.parse(used);
  return {tokens:ceiling.tokens===null?null:Math.max(0,ceiling.tokens-used.tokens),activeMs:Math.max(0,ceiling.activeMs-used.activeMs),attempts:Math.max(0,ceiling.attempts-used.attempts),sessions:Math.max(0,ceiling.sessions-used.sessions)};
}
export function budgetFits(used:Amount,ceiling:BudgetAmount):boolean {
  amountSchema.parse(used);budgetAmountSchema.parse(ceiling);
  return (ceiling.tokens===null||used.tokens<=ceiling.tokens)&&used.activeMs<=ceiling.activeMs&&used.attempts<=ceiling.attempts&&used.sessions<=ceiling.sessions;
}
export function tokenRemainingStatus(ceiling:number|null,usageUnknown:boolean):"known"|"unlimited"|"unknown" {
  return usageUnknown?"unknown":ceiling===null?"unlimited":"known";
}

export function finiteCommitment(allowance:BudgetAmount):Amount {
 budgetAmountSchema.parse(allowance);
 return {...allowance,tokens:allowance.tokens===null?0:allowance.tokens};
}

/** Independent bounded reconciliation default; source task ceilings never make this call unbounded. */
export const DEFAULT_RECONCILE_TOKENS=3_000_000;
export function finiteReconcileTokens(ceilings:readonly(number|null)[]):number {
 if(ceilings.length===0)throw new Error("reconcile-budget-missing");
 return Math.max(...ceilings.map(ceiling=>ceiling===null?DEFAULT_RECONCILE_TOKENS:safeInteger.parse(ceiling)));
}

/** Old callers remain finite by default. Null removes only this request's token-dimension proof requirement. */
export function tokenProofCovers(capability:CapabilityViewV1,actualTokens:number|null=0,bucket:"work"|"handoff"="work"):boolean {
 const proof=capability.requestBoundProof;
 return proof!==null&&(actualTokens===null||(bucket==="work"?proof.workDimensions:proof.handoffDimensions).includes("tokens"));
}
