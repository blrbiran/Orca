import { ControlError } from "./errors.js";
import { amountSchema } from "./schema.js";
import { budgetAmountSchema, type BudgetAmount } from "./tokenPolicy.js";
import type { Amount } from "./types.js";

/**
 * Budget arithmetic with no control-plane dependencies, so a module that needs only this (proposalReopen.ts, and through
 * it the schema migrations every ControlStore runs) does not enter the src/control import cycle. Before this module,
 * store.ts -> migrations.ts -> proposalReopen.ts -> budget.ts pulled even plain store tests into the 52-module cycle
 * (survey 2026-11-17 §1). commands.ts and budget.ts re-export these names; their callers are unchanged.
 */
export const dimensions = ["tokens","activeMs","attempts","sessions"] as const;
export function zero():Amount {return {tokens:0,activeMs:0,attempts:0,sessions:0};}

export function budgetBalance(limit:Amount,used:Amount,committed:Amount):{reserve:Amount;deficit:Amount};
export function budgetBalance(limit:BudgetAmount,used:Amount,committed:Amount):{reserve:BudgetAmount;deficit:Amount};
export function budgetBalance(limit:BudgetAmount,used:Amount,committed:Amount):{reserve:BudgetAmount;deficit:Amount} {
  budgetAmountSchema.parse(limit);[used,committed].forEach(value=>amountSchema.parse(value));
  const reserve:BudgetAmount=zero(),deficit=zero();
  for(const d of dimensions){
    if(d==="tokens"&&limit.tokens===null){reserve.tokens=null;continue;}
    const occupied=BigInt(used[d])+BigInt(committed[d]),ceiling=BigInt(limit[d]!);
    const available=ceiling>occupied?ceiling-occupied:0n,breach=occupied>ceiling?occupied-ceiling:0n;
    if(available>BigInt(Number.MAX_SAFE_INTEGER)||breach>BigInt(Number.MAX_SAFE_INTEGER))throw new ControlError("numeric-overflow");
    reserve[d]=Number(available);deficit[d]=Number(breach);
  }
  return {reserve,deficit};
}
