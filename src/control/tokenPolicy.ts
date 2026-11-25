import type { CapabilityViewV1 } from "./webProtocol.js";
import type { Amount } from "./types.js";
import type { BudgetShortfall } from "./errors.js";
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
/**
 * Tester #499: every dimension `used + reserved` does not fit under `ceiling`, with what it holds and what the ceiling
 * allows. An unbounded token ceiling can never be short, so it never appears. THE one rule: `budgetFits` is this answer
 * being empty (the writers that refuse -- commands.ts setGroupLimit, webService.ts setLimit -- throw it with the gap).
 */
const budgetDimensions=["tokens","activeMs","attempts","sessions"] as const;
export function budgetShortfall(used:Amount,reserved:Amount,ceiling:BudgetAmount):BudgetShortfall {
  amountSchema.parse(used);amountSchema.parse(reserved);budgetAmountSchema.parse(ceiling);
  const shortfall:BudgetShortfall={};
  for(const dimension of budgetDimensions){
    const need=ceiling[dimension];
    if(need===null)continue;
    const have=used[dimension]+reserved[dimension];
    if(have>need)shortfall[dimension]={have,need};
  }
  return shortfall;
}
/** `attempts:+20,tokens:+5`: each short dimension and how much more it needs (the #311 refusal detail form). */
export function budgetShortfallDetail(shortfall:BudgetShortfall):string {
  return Object.entries(shortfall).map(([dimension,{have,need}])=>`${dimension}:+${(have??0)-need}`).join(",");
}
export function budgetFits(used:Amount,ceiling:BudgetAmount):boolean {
  return Object.keys(budgetShortfall(used,{tokens:0,activeMs:0,attempts:0,sessions:0},ceiling)).length===0;
}
export function tokenRemainingStatus(ceiling:number|null,usageUnknown:boolean):"known"|"unlimited"|"unknown" {
  return usageUnknown?"unknown":ceiling===null?"unlimited":"known";
}

export function finiteCommitment(allowance:BudgetAmount):Amount {
 budgetAmountSchema.parse(allowance);
 return {...allowance,tokens:allowance.tokens===null?0:allowance.tokens};
}

/**
 * Tester #437: how much of an allocation the group's reserve holds, given the owner's stored status — THE one rule the
 * writer (groupTaskAppend.ts) and the reader (webService.ts assertKnownConservation) both use.
 *
 * In a token-policy group a `draft`/`ready` task's grant is an expectation: nothing is held until a claim funds it from
 * headroom (#212). Before this existed the writer counted the appended fix task's finite grant and the reader counted
 * zero, so `group.reserved` could never be re-derived and every budget command answered 423 forever. Every other status
 * is a real commitment; an allocation already settled terminal holds nothing.
 */
export function allocationCommitment(allowance:BudgetAmount, input:{status:string; terminal:boolean; tokenPolicy:boolean}):Amount {
 if (input.terminal) return {tokens:0,activeMs:0,attempts:0,sessions:0};
 if (input.tokenPolicy && (input.status === "draft" || input.status === "ready")) return {...allowance,tokens:0};
 return finiteCommitment(allowance);
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
