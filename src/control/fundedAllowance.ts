import { archivedMarkOf } from "./archivedMark.js";
import { readArtifact } from "./archive.js";
import { packetSchema } from "./handoff.js";
import type { Candidate } from "./types.js";
import type { StartEnvelope } from "./executionPort.js";
import { z } from "zod";
import { canonicalBytes } from "./canonicalJson.js";
import { add, groupUsageUnknown, isTerminalRunState, type RunRecord } from "./budget.js";
import { zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { allWork, readGroup, readWork } from "./queries.js";
import { amountSchema, budgetAmountSchema, safeInteger, grantSchema, tokenPolicySchema } from "./schema.js";
import { capStatuses, type CapStatus } from "./spendCaps.js";
import type { ControlStore } from "./store.js";
import { remainingBudget, type TokenPolicy } from "./tokenPolicy.js";
import type { Amount, Grant } from "./types.js";
import { groupRepoIdOf } from "./usageLedger.js";

export interface FundedAllowance extends TokenPolicy { grant: Grant }
export function saveTokenPolicy(store:ControlStore,groupId:string,workItemId:string,tokens:number|null,mode:"finite-legacy"|"optional-v1"="optional-v1"):void {
  if(tokens!==null)safeInteger.parse(tokens);
  store.db.prepare("INSERT INTO token_policies VALUES (?,?,?,?) ON CONFLICT(group_id,work_item_id) DO UPDATE SET mode=excluded.mode,tokens=excluded.tokens").run(groupId,workItemId,mode,tokens);
}
export function hasTokenPolicy(store:ControlStore,groupId:string):boolean {
 const policy=store.db.prepare("SELECT mode,tokens FROM token_policies WHERE group_id=? AND work_item_id=''").get(groupId);
 const group=readGroup(store,groupId),ceiling=(group as {limit?:{tokens:number|null}}).limit?.tokens;
 if((ceiling===null&&(!policy||policy.tokens!==null))||(policy?.mode==="optional-v1"&&policy.tokens!==ceiling))throw new ControlError("recovery-blocked","token-policy-identity");
 return policy?.mode==="optional-v1";
}
/** Task accounting is recorded separately from its group's current authored ceiling. */
export function hasOptionalTaskPolicy(store:ControlStore,groupId:string,workItemId:string):boolean {
 const row=store.db.prepare("SELECT mode FROM token_policies WHERE group_id=? AND work_item_id=?").get(groupId,workItemId);
 return row===undefined?hasTokenPolicy(store,groupId):row.mode==="optional-v1";
}
/** Every observation is run-local: summing settled work once carries overshoot and every non-token dimension. */
export function inheritedWorkUsage(store:ControlStore,groupId:string,workItemId:string):Amount|null {
 let total=zero();
 for(const row of store.db.prepare("SELECT body,active FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid").all(groupId,workItemId)) {
  const run=JSON.parse(String(row.body)) as RunRecord;
  if(row.active===1||!isTerminalRunState(run.state)||run.unknown.work||run.unknown.handoff)return null;
  if(store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId,run.highWater))return null;
  total=add(total,amountSchema.parse(run.cumulative.work));
 }
 return total;
}
interface Binder { id:string; cause:"group"|"spend-cap"; remaining:number; candidates:number;cap?:CapStatus }
interface Demand { groupId:string;workId:string;allowance:FundedAllowance;binders:Binder[];minimum:number;fixed:boolean }
/**
 * Token policy §6.1: use inside the claim transaction. This computes the joint prospective
 * allocation; the caller persists ONLY its own claim. No speculative reservations are written.
 */
export function allocateFundedAllowance(store:ControlStore,groupId:string,workId:string,at:number):FundedAllowance|null {
 return decideFundedAllowance(store,groupId,workId,at).allowance;
}
export interface FundedDecision {allowance:FundedAllowance|null;workItemId:string|null;reason:string;cap?:CapStatus;minimumTokens?:number}
/** Null workId chooses the first jointly funded ready task, so an unfit earlier task cannot stall its group. */
export function decideFundedAllowance(store:ControlStore,groupId:string,workId:string|null,at:number):FundedDecision {
 let blocked:FundedDecision={allowance:null,workItemId:workId,reason:"task-budget-unavailable"};
 const binders=new Map<string,Binder>(),ready:Demand[]=[];
 const binder=(id:string,cause:Binder["cause"],headroom:number,cap?:CapStatus)=>{
  let item=binders.get(id);if(!item){item={id,cause,remaining:headroom,candidates:0,...(cap?{cap}:{})};binders.set(id,item);}return item;
 };
 if(store.dispatchBlocked)return {...blocked,reason:"control-recovery-required"};
 for(const row of store.db.prepare("SELECT id FROM groups ORDER BY id").all()) {
  const id=String(row.id),group=readGroup(store,id);
  if(group.stopped||!["ready","running","review","blocked"].includes(group.status)||archivedMarkOf(group)!==null)continue;
  if("proposal" in group&&(group.proposal as {state?:string})?.state!=="confirmed")continue;
  if(store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(id)||store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id=?").get(id)||groupUsageUnknown(store,id))continue;
  const limit=budgetAmountSchema.parse(group.limit),applicable:Binder[]=[];
  if(limit.tokens!==null)applicable.push(binder(`group:${id}`,"group",limit.tokens-group.used.tokens-group.reserved.tokens));
  const repo=groupRepoIdOf(group as unknown as Record<string,unknown>);
  for(const cap of capStatuses(store,repo,at))applicable.push(binder(`cap:${cap.scope}:${cap.period}`,"spend-cap",cap.headroom,cap));
  const works=allWork(store,id).sort((a,b)=>a.workItemId<b.workItemId?-1:a.workItemId>b.workItemId?1:0);
  for(const work of works) {
   if(work.kind!=="task"||!["ready","continuing"].includes(work.status)||store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(id,work.workItemId))continue;
   if(work.dependsOn.some(dep=>works.find(w=>w.workItemId===dep)?.status!=="done"))continue;
   const fixed=!hasOptionalTaskPolicy(store,id,work.workItemId);
   const observed=inheritedWorkUsage(store,id,work.workItemId);if(observed===null)continue;
   const inheritedUsage=fixed?zero():observed;
   const authored=budgetAmountSchema.parse(work.grant.work),remaining=fixed?amountSchema.parse(authored):remainingBudget(authored,inheritedUsage),handoff=amountSchema.parse(work.grant.handoff);
   if(remaining.tokens===0||remaining.activeMs===0||remaining.attempts===0||remaining.sessions===0)continue;
   if((work as {fundingReleased?:boolean}).fundingReleased&&["activeMs","attempts","sessions"].some(key=>{const k=key as "activeMs"|"attempts"|"sessions";return group.used[k]+group.reserved[k]+remaining[k]+handoff[k]>limit[k];}))continue;
   const minimum=fixed?remaining.tokens!:1;
   // Historical confirmed Web allocations already hold their whole grant in the group reserve.
   // Credit only that group's existing allocation; global/project caps still need the full fixed minimum.
   const groupCredit=(b:Binder)=>fixed&&"planHash" in group&&b.cause==="group"?handoff.tokens+minimum:0;
   const short=applicable.find(b=>b.remaining+groupCredit(b)<handoff.tokens+minimum);
   if(short){if(id===groupId&&(workId===null||workId===work.workItemId))blocked={allowance:null,workItemId:work.workItemId,reason:short.cause==="group"?"group-budget-unavailable":"spend-cap-reached",...(short.cap?{cap:short.cap,minimumTokens:handoff.tokens+minimum}:{})};continue;}
   for(const b of applicable){b.remaining+=groupCredit(b)-handoff.tokens-minimum;if(!fixed)b.candidates++;}
   ready.push({groupId:id,workId:work.workItemId,minimum,fixed,binders:applicable,allowance:{authoredTokenCeiling:authored.tokens,bindingCauses:[...(authored.tokens===null?[]:["task" as const]),...new Set(applicable.map(b=>b.cause))],inheritedUsage,grant:{work:remaining,handoff}}});
  }
 }
 for(const demand of ready) {
  if(demand.fixed)continue;
  const max=demand.allowance.grant.work.tokens;
  let extra:number|null=max===null?null:Math.max(0,max-demand.minimum);
  for(const b of demand.binders){const share=Math.floor(Math.max(0,b.remaining)/b.candidates);extra=extra===null?share:Math.min(extra,share);}
  const tokens=extra===null?null:demand.minimum+extra;
  demand.allowance.grant.work.tokens=tokens;
  for(const b of demand.binders){b.remaining-=extra!;b.candidates--;}
 }
 const chosen=ready.find(d=>d.groupId===groupId&&(workId===null||d.workId===workId));
 return chosen?{allowance:chosen.allowance,workItemId:chosen.workId,reason:"funded"}:blocked;
}
/** Null commitments have their own record; never encode them as a finite sentinel. */
export function persistFundedAllowance(store:ControlStore,runId:string,groupId:string,workId:string,allowance:FundedAllowance):void {
 store.db.prepare("INSERT INTO funded_allowances VALUES (?,?,?,?)").run(runId,groupId,workId,JSON.stringify(allowance));
}

export function readFundedAllowance(store:ControlStore,run:{runId:string;groupId:string;workItemId:string;grant:unknown;tokenPolicy?:unknown}):FundedAllowance|null {
 const row=store.db.prepare("SELECT group_id,work_item_id,body FROM funded_allowances WHERE run_id=?").get(run.runId);
 if(!row){if(run.tokenPolicy!==undefined)throw new ControlError("recovery-blocked","funded-allowance-missing");return null;}
 const parsed=tokenPolicySchema.extend({grant:grantSchema}).safeParse(JSON.parse(String(row.body)));
 if(!parsed.success||row.group_id!==run.groupId||row.work_item_id!==run.workItemId||!canonicalBytes(parsed.data.grant).equals(canonicalBytes(run.grant)))throw new ControlError("recovery-blocked","funded-allowance-identity");
 const work=readWork(store,run.groupId,run.workItemId),authored=budgetAmountSchema.parse(work.grant.work);
 if(parsed.data.authoredTokenCeiling!==authored.tokens)throw new ControlError("recovery-blocked","funded-authored-policy");
 let inherited=zero();
 for(const previous of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND rowid<(SELECT rowid FROM runs WHERE id=?) ORDER BY rowid").all(run.groupId,run.workItemId,run.runId)){
  const source=JSON.parse(String(previous.body));if(source.unknown.work||source.unknown.handoff)throw new ControlError("recovery-blocked","funded-unknown-lineage");
  inherited=add(inherited,amountSchema.parse(source.cumulative.work));
 }
 if(!canonicalBytes(inherited).equals(canonicalBytes(parsed.data.inheritedUsage)))throw new ControlError("recovery-blocked","funded-lineage");
 const remaining=remainingBudget(authored,inherited),actual=parsed.data.grant.work;
 if((remaining.tokens!==null&&(actual.tokens===null||actual.tokens>remaining.tokens))||["activeMs","attempts","sessions"].some(d=>actual[d as keyof Amount]!==remaining[d as keyof Amount]))throw new ControlError("recovery-blocked","funded-grant-authority");
 const {grant,...policy}=parsed.data;
 if(run.tokenPolicy!==undefined&&!canonicalBytes(policy).equals(canonicalBytes(run.tokenPolicy)))throw new ControlError("recovery-blocked","funded-policy-identity");
 return parsed.data;
}

/** Validate complete saved lineage before releasing a stopped allowance for automatic renewal. */
export async function validateAllowanceCheckpoint(store:ControlStore,candidate:Candidate,envelope:StartEnvelope):Promise<void> {
 const bad=()=>{throw new ControlError("resume-handoff-invalid","allowance-evidence");};
 if(envelope.protocol!==4||!envelope.tokenPolicy||candidate.result!=="partial"||candidate.missing.length||candidate.unresolvedRequestIds.length)bad();
 const packet=packetSchema.parse(JSON.parse((await readArtifact(store,candidate.handoff)).toString()));
 for(const key of ["groupId","workItemId","taskId","runId","generation","graphVersion","targetVersion"] as const)if(packet.identity[key]!==envelope.claim[key])bad();
 const continuation=packet.allowanceContinuation;
 if(!continuation||!packet.acceptedContract||packet.contractHash!==envelope.contractHash||packet.usageHighWater!==candidate.usageHighWater)bad();
 const refs=[packet.acceptedContract!,continuation!.state,continuation!.usage,...[continuation!.plan,continuation!.execution,continuation!.verification].filter(r=>r!==null)];
 for(const ref of refs){if(!packet.artifacts.some(r=>r.artifactId===ref.artifactId&&r.hash===ref.hash)||!candidate.artifacts.some(r=>r.artifactId===ref.artifactId&&r.hash===ref.hash))bad();await readArtifact(store,ref);}
 if(envelope.work.kind!=="loop"||!canonicalBytes(JSON.parse((await readArtifact(store,packet.acceptedContract!)).toString())).equals(canonicalBytes(envelope.work.contract)))bad();
 const saved=JSON.parse((await readArtifact(store,continuation!.state)).toString());
 if(saved.waitingCause!=="token-allowance"||saved.allowanceNextPhase!==continuation!.nextPhase||saved.budgetSnapshot?.tokenRemainingStatus!=="known"||saved.budgetSnapshot?.tokenBudgetRemaining!==0)bad();
 if(continuation!.nextPhase==="execute"&&!continuation!.plan||continuation!.nextPhase==="verify"&&(!continuation!.plan||!continuation!.execution)||continuation!.nextPhase==="plan"&&!continuation!.verification)bad();
 const ledger=JSON.parse((await readArtifact(store,continuation!.usage)).toString());
 if(ledger.protocol!==1||ledger.nextSeq!==candidate.usageHighWater||!Array.isArray(ledger.events)||ledger.events.length!==ledger.nextSeq-1)bad();
 let last:Amount|null=null;
 for(const [index,event] of ledger.events.entries()){
  if(event.runId!==candidate.runId||event.generation!==candidate.generation||event.eventSeq!==index+1)bad();
  if(event.bucket==="work"){if(event.cumulative===null)bad();last=amountSchema.parse(event.cumulative);}
 }
 const row=store.db.prepare("SELECT body FROM runs WHERE id=?").get(candidate.runId);if(!row)bad();
 const run=JSON.parse(String(row!.body));
 if(last===null||!canonicalBytes(last).equals(canonicalBytes(run.cumulative.work))||!canonicalBytes(last).equals(canonicalBytes(ledger.totals.work)))bad();
}

/** An explicit nullable task edit may switch unstarted mutable bookkeeping; paid historical work is never reinterpreted. */
export function enableOptionalTokenPolicy(store:ControlStore,groupId:string):void {
 if(hasTokenPolicy(store,groupId))return;
 if(store.db.prepare("SELECT r.id FROM runs r JOIN work_items w ON w.group_id=r.group_id AND w.id=r.work_item_id WHERE r.group_id=? AND json_extract(w.body,'$.kind')='task' LIMIT 1").get(groupId))throw new ControlError("grant-amendment-unsupported","historical-task-policy-already-started");
 const group=readGroup(store,groupId);saveTokenPolicy(store,groupId,"",group.limit.tokens);
 for(const work of allWork(store,groupId))if(work.kind==="task")saveTokenPolicy(store,groupId,work.workItemId,work.grant.work.tokens);
}
