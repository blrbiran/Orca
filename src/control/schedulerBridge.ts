import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Round, RoundExecution } from "../scheduler/run.js";
import type { TaskRun, DisposeOptions } from "../scheduler/ccloopRunner.js";
import { TERMINAL_OUTCOMES } from "../scheduler/ccloopRunner.js";
import { git } from "../scheduler/gitExec.js";
import type { ControlService } from "./service.js";
import type { Candidate, Claim, ArtifactRef, Identity } from "./types.js";
import type { ExecutionReport, StartEnvelope } from "./executionPort.js";
import { allWork, readGroup, readWork } from "./queries.js";
import { hasObservedUsage, readRun } from "./budget.js";
import { hashPayload } from "./commands.js";
import { startClaim, readEnvelope } from "./dispatch.js";
import { recordUsage } from "./usage.js";
import { archiveRun, writeArtifact, readArtifact } from "./archive.js";
import { commitCandidate, repairAcceptedWork } from "./checkpoints.js";
import { cleanupCommittedRun } from "./cleanup.js";
import { publishPending } from "./projection.js";
import { privateDirectory } from "./paths.js";
import { ControlError } from "./errors.js";

function claimOnly(c:Claim):Claim {
 const {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,commandId,configHash,grant,ownerToken}=c;
 return {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,commandId,configHash,grant,ownerToken};
}
function identity(c:Identity) {
 const {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion}=c;
 return {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion};
}
export async function collectControlled(service:ControlService,runId:string):Promise<ExecutionReport> {
 const {store}=service,port=service.executionPort(),envelope=readEnvelope(store,runId);
 if(!port.readEvidence) throw new ControlError("control-evidence-unavailable");
 const report=await port.collect(envelope,readRun(store,runId).highWater);
 const refs=[...report.events.map(e=>e.source),...(report.candidate?.artifacts??[])];
 if(report.candidate) refs.push(report.candidate.handoff);
 if(report.candidate?.stopProof) refs.push(report.candidate.stopProof.source);
 for(const ref of refs) {
   const bytes=await port.readEvidence(ref);
   if(createHash("sha256").update(bytes).digest("hex")!==ref.hash) throw new ControlError("artifact-hash-mismatch");
   await writeArtifact(store,ref.artifactId,bytes);
 }
 for(const event of report.events) {
  if(event.runId!==runId || event.generation!==envelope.claim.generation) throw new ControlError("report-identity-conflict");
  recordUsage(store,event);
 }
 if(report.candidate) {
  if(hashPayload(identity(report.candidate))!==hashPayload(identity(envelope.claim))) throw new ControlError("report-identity-conflict");
 }
 if(report.terminal) {
  const t=report.terminal,work=envelope.work;
  if(!work || !TERMINAL_OUTCOMES.includes(t.outcome) || t.sourceDir!==work.sourceDir || t.repoDir!==join(work.sourceDir,"repo")) throw new ControlError("report-path-conflict");
  privateDirectory(t.sourceDir);privateDirectory(t.repoDir);
  if(await realpath(t.sourceDir)!==t.sourceDir || await realpath(t.repoDir)!==t.repoDir) throw new ControlError("report-path-conflict");
  if(t.attemptSha!==null && !/^[0-9a-f]{40,64}$/.test(t.attemptSha)) throw new ControlError("report-commit-invalid");
  const bytes=Buffer.from(JSON.stringify(report)),source=await writeArtifact(store,"report-"+runId+"-"+hashPayload(report),bytes);
  store.transaction(()=>store.db.prepare("INSERT INTO outbox VALUES (?, 'report', ?, 0) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run("report:"+runId,JSON.stringify({source})));
 }
 return report;
}
async function savedReport(service:ControlService,runId:string):Promise<ExecutionReport> {
 const row=service.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='report'").get("report:"+runId);
 if(!row) throw new ControlError("control-terminal-pending");
 return JSON.parse((await readArtifact(service.store,JSON.parse(String(row.body)).source)).toString());
}
export async function archiveReport(service:ControlService,runId:string,report:ExecutionReport) {
 if(!report.terminal) throw new ControlError("control-terminal-pending");
 return archiveRun(service.store,{runId,sourceDir:report.terminal.sourceDir,repoDir:report.terminal.repoDir,stopProof:report.candidate?.stopProof??null});
}
export async function disposeControlled(service:ControlService,run:TaskRun,options:DisposeOptions) {
 const {store}=service,record=readRun(store,run.runId),report=await savedReport(service,run.runId);
 if(!report.terminal || report.terminal.sourceDir!==run.workdir) throw new ControlError("report-path-conflict");
 if(record.state!=="settled") {
  const archive=await archiveReport(service,run.runId,report),raw=report.candidate;
  const missing=[...archive.missing,...(raw?.missing??[]),...(!raw?["candidate-missing"]:[])];
  const handoff=raw?.handoff??await writeArtifact(store,"handoff-"+run.runId,Buffer.from(JSON.stringify({unfinished:[],pendingDecisions:[],awaitingHuman:[]})));
  const candidate:Candidate={...identity(record),checkpointId:"settle-"+run.runId,usageHighWater:raw?.usageHighWater??record.highWater,
   result:missing.length===0 && raw?.result==="complete"?"complete":"partial",
   artifacts:[...archive.artifacts,...(raw?.artifacts??[]),handoff],snapshot:archive.snapshot,missing,
   unresolvedRequestIds:raw?.unresolvedRequestIds??["terminal-evidence"],stopProof:raw?.stopProof??null,terminalOutcome:report.terminal.outcome,handoff};
  candidate.checkpointId="settle-"+run.runId+"-"+hashPayload(candidate).slice(0,16);
  await commitCandidate(store,candidate);
 }
 await repairAcceptedWork(store,run.runId);
 await publishPending(store);
 if(options.keepWorkdirs || options.keepBecause || run.outcome!=="succeeded") {
  options.log?.(`orca: kept controlled run ${run.runId}: ${run.workdir}`);return {removed:false,workdir:run.workdir};
 }
 const result=await cleanupCommittedRun(store,run.runId,run.workdir);return {...result,workdir:run.workdir};
}
export async function settleControlledHandoff(service:ControlService,runId:string,report:ExecutionReport):Promise<void> {
 const raw=report.candidate;if(!raw?.stopProof||!report.terminal)return;
 const {store}=service,record=readRun(store,runId);
 if(raw.unresolvedRequestIds.length||record.unknown.work||record.unknown.handoff||!hasObservedUsage(store,record)||store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId,record.highWater))return;
 const archive=await archiveReport(service,runId,report);
 const missing=[...archive.missing,...raw.missing];
 const candidate:Candidate={...identity(record),checkpointId:raw.checkpointId,usageHighWater:raw.usageHighWater,result:missing.length===0&&raw.result==="complete"?"complete":"partial",artifacts:[...archive.artifacts,...raw.artifacts,raw.handoff],snapshot:archive.snapshot,missing,unresolvedRequestIds:raw.unresolvedRequestIds,stopProof:raw.stopProof,terminalOutcome:raw.terminalOutcome,handoff:raw.handoff};
 await commitCandidate(store,candidate);await publishPending(store);
}
interface LandingIntent {repo:string;branch:string;base:string;incoming:string;runIds:string[];artifacts:ArtifactRef[];landed?:string;conflicted?:boolean}
export async function confirmLanding(service:ControlService,id:string,intent:LandingIntent):Promise<boolean> {
 const branch=(await git(intent.repo,["symbolic-ref","--short","HEAD"])).trim();
 if(branch!==intent.branch) throw new ControlError("landing-branch-conflict");
 const tip=(await git(intent.repo,["rev-parse","refs/heads/"+intent.branch])).trim();
 if(tip===intent.base) return false;
 const lines=(await git(intent.repo,["rev-list","--first-parent","--parents",`${intent.base}..${tip}`])).trim().split("\n");
 const landed=lines.map(l=>l.split(" ")).find(([sha,...parents])=>
  (sha===intent.incoming && parents[0]===intent.base) || (parents.length===2 && parents[0]===intent.base && parents[1]===intent.incoming));
 if(!landed) throw new ControlError("landing-outcome-unknown");
 for(const ref of intent.artifacts) await readArtifact(service.store,ref);
 for(const runId of intent.runIds) {
  const source=await writeArtifact(service.store,"acceptance-"+runId,Buffer.from(JSON.stringify({runId,checksPassed:true,landing:"landed",commit:landed[0],intent:id})));
  service.store.transaction(()=>service.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO NOTHING").run("acceptance:"+runId,JSON.stringify({runId,accepted:true,source})));
 }
 intent.landed=landed[0];service.store.transaction(()=>service.store.db.prepare("UPDATE outbox SET body=?,delivered=1 WHERE id=?").run(JSON.stringify(intent),id));return true;
}
export function makeControlledExecution(service:ControlService,groupId:string):RoundExecution {
 return {
  mode:"controlled",
  preflight:async(round:Round)=>{
   await service.capabilities(groupId);
   if(!service.executionPort().readEvidence) throw new ControlError("control-evidence-unavailable");
   const group=readGroup(service.store,groupId);
   if(group.stopped) throw new ControlError("group-stopped");
   if(service.store.dispatchBlocked) throw new ControlError("control-recovery-required");
   if(!service.options.targetRepo) throw new ControlError("group-project-binding-required");
   if(await realpath(round.plan.targetRepo)!==await realpath(service.options.targetRepo)) throw new ControlError("group-project-conflict");
   const registered=allWork(service.store,groupId).filter(w=>w.kind==="task");
   if(registered.length!==round.plan.tasks.length) throw new ControlError("group-graph-conflict");
   for(const task of round.plan.tasks) {
    const w=registered.find(w=>w.taskId===task.taskId);
    const dependencies=w?.dependsOn.map(id=>registered.find(parent=>parent.workItemId===id)?.taskId);
    if(!w || !dependencies || dependencies.some(id=>!id) || hashPayload(w.contract)!==hashPayload(round.contracts.get(task.taskId)) || hashPayload([...dependencies].sort())!==hashPayload([...task.dependsOn].sort())) throw new ControlError("group-graph-conflict");
   }
  },
  reconcileBudget:taskId=>service.reconcileBudget(groupId,taskId),
  execute:async({plan,task,base,kind})=>{
   const work=allWork(service.store,groupId).find(w=>w.taskId===task.taskId && w.kind===kind);
   if(!work) throw new ControlError("work-not-found");
   const contract=JSON.parse(await readFile(task.contract,"utf8"));
   const claim=claimOnly(await service.claim(groupId,work.workItemId));
   if(kind==="reconcile" && !service.store.db.prepare("SELECT id FROM outbox WHERE id=?").get("start:"+claim.runId)) {
    service.store.transaction(()=>{
     const current=readWork(service.store,groupId,work.workItemId);
     if(readRun(service.store,claim.runId).state!=="claimed") throw new ControlError("start-state-conflict");
     if(!(current.contract as {pendingReconciliation?:string}).pendingReconciliation && hashPayload(current.contract)!==hashPayload(contract)) throw new ControlError("start-contract-conflict");
     current.contract=contract;service.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(current),groupId,work.workItemId);
    });
   } else if(hashPayload(contract)!==hashPayload(work.contract)) throw new ControlError("start-contract-conflict");
   const root=privateDirectory(plan.runsDir),input:StartEnvelope={protocol:1,claim,contractHash:hashPayload(contract),inputCheckpoint:null,
    work:{contract,targetRepo:await realpath(plan.targetRepo),base,sourceDir:join(root,claim.runId)}};
   await startClaim(service.store,service.executionPort(),input);
   const report=await collectControlled(service,claim.runId);
   if(!report.terminal) throw new ControlError("control-terminal-pending");
   await archiveReport(service,claim.runId,report);
   return {runId:claim.runId,workdir:report.terminal.sourceDir,outcome:report.terminal.outcome,attemptSha:report.terminal.attemptSha};
  },
  dispose:(run,options)=>disposeControlled(service,run,options),
  land:async(plan,runs,incoming,perform)=>{
   const store=service.store,id="landing-"+hashPayload({repo:plan.targetRepo,branch:plan.workBranch,incoming,runIds:runs.map(r=>r.runId)});
   const old=store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='landing'").get(id);
   let intent:LandingIntent;
   if(old) {
    intent=JSON.parse(String(old.body));
    if(await confirmLanding(service,id,intent)) return {merged:true};
    throw new ControlError("landing-needs-review");
   }
   const artifacts:ArtifactRef[]=[];
   for(const run of runs){const report=await savedReport(service,run.runId);const archive=await archiveReport(service,run.runId,report);artifacts.push(...archive.artifacts);}
   intent={repo:plan.targetRepo,branch:plan.workBranch,base:(await git(plan.targetRepo,["rev-parse","HEAD"])).trim(),incoming,runIds:runs.map(r=>r.runId),artifacts};
   if((await git(plan.targetRepo,["symbolic-ref","--short","HEAD"])).trim()!==plan.workBranch) throw new ControlError("landing-branch-conflict");
   store.transaction(()=>store.db.prepare("INSERT INTO outbox VALUES (?, 'landing', ?, 0)").run(id,JSON.stringify(intent)));
   const result=await perform();
   if(result.merged) {if(!await confirmLanding(service,id,intent)) throw new ControlError("landing-outcome-unknown");}
   else {intent.conflicted=true;store.transaction(()=>store.db.prepare("UPDATE outbox SET body=?,delivered=1 WHERE id=?").run(JSON.stringify(intent),id));}
   return result;
  },
 };
}
