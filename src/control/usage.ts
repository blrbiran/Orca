import { z } from "zod";
import type { ControlStore } from "./store.js";
import type { UsageEvent } from "./types.js";
import { ControlError } from "./errors.js";
import { amountSchema, idSchema, safeInteger } from "./schema.js";
import { dimensions, hashPayload } from "./commands.js";
import { add, componentMin, isTerminalRunState, readRun, saveRun, subtract, syncWebBudget } from "./budget.js";
import { readGroup, saveGroup } from "./queries.js";
import { bookUsageDelta, byModelSchema } from "./usageLedger.js";
const eventSchema=z.object({runId:idSchema,generation:safeInteger.positive(),eventSeq:safeInteger.positive(),bucket:z.enum(["work","handoff"]),cumulative:amountSchema.nullable(),source:z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),byModel:byModelSchema.nullable().optional()}).strict();
/** Accounts spec §5.1: `appliedAt` (ms) stamps the usage-ledger rows this call books; callers with a clock pass it. */
export function recordUsage(store:ControlStore,event:UsageEvent,appliedAt:number=Date.now()):{applied:boolean;highWater:number} {
  eventSchema.parse(event);const hash=hashPayload(event);
  return store.transaction(()=>{
    const run=readRun(store,event.runId);
    if(event.generation!==run.generation) throw new ControlError("run-generation-conflict");
    const prior=store.db.prepare("SELECT payload_hash FROM usage_events WHERE run_id=? AND seq=?").get(event.runId,event.eventSeq);
    if(prior){
      if(prior.payload_hash!==hash) throw new ControlError("usage-event-conflict");
      return {applied:false,highWater:run.highWater};
    }
    if((run as {usageSettlement?:unknown}).usageSettlement!==undefined) throw new ControlError("run-usage-settled");
    if(isTerminalRunState(run.state)) throw new ControlError("run-already-settled");
    store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(event.runId,event.eventSeq,hash,JSON.stringify(event));
    const group=readGroup(store,run.groupId);
    for(;;){
      const row=store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq=?").get(event.runId,run.highWater+1);
      if(!row) break;
      const next=JSON.parse(String(row.body)) as UsageEvent;
      if(next.cumulative===null) run.unknown[next.bucket]=true;
      else {
        const delta=subtract(next.cumulative,run.cumulative[next.bucket]);
        bookUsageDelta(store,{run:run as typeof run&{phase?:string;purpose?:string},groupBody:group as unknown as Record<string,unknown>,event:next,deltaTokens:delta.tokens,appliedAt});
        const released=componentMin(delta,run.remaining[next.bucket]);
        group.used=add(group.used,delta);group.reserved=subtract(group.reserved,released);
        run.remaining[next.bucket]=subtract(run.remaining[next.bucket],released);
        run.cumulative[next.bucket]=next.cumulative;run.unknown[next.bucket]=false;
        if(dimensions.some(k=>next.cumulative![k]>run.grant[next.bucket][k])) {
          run.breaches.push(next.eventSeq);
          // N1 DR18: on a clarifying group the claim-time fit is the cap; a breach is recorded on the run only.
          if((group as {status?:string}).status!=="clarifying"){if("planHash" in group)group.status="blocked";else group.stopped=true;}
        }
      }
      run.highWater=next.eventSeq;
    }
    syncWebBudget(store,group,run);
    if(group.budgetVersion===Number.MAX_SAFE_INTEGER)throw new ControlError("numeric-overflow");
    group.budgetVersion=Number(BigInt(group.budgetVersion)+1n);saveGroup(store,group);saveRun(store,run);store.db.prepare("INSERT INTO outbox VALUES (?, 'group-handoff', ?, 0) ON CONFLICT(id) DO NOTHING").run(`group-handoff:${group.groupId}:budget:${group.revision}:${group.budgetVersion}`,JSON.stringify({groupId:group.groupId,revision:group.revision,budgetVersion:group.budgetVersion}));
    return {applied:true,highWater:run.highWater};
  });
}
