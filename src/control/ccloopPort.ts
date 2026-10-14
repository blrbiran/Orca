import { savedResultCollectionSchema,savedResultSourceEligibilitySchema,savedResultEligibilitySchema,savedResultSettlementSchema } from "./savedResultProtocol.js";
import { taskResultCollectionSchema,TaskResultUnsupportedError,TASK_RESULT_RPC_TIMEOUT_MS,MAX_TASK_RESULT_EVIDENCE_BYTES } from './taskResultProtocol.js';
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ControlFeatures, AgentsView, ExecutionPort, ExecutionReport, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { ArtifactRef, HandoffAck, HandoffRequest } from "./types.js";
import type { AgentResolution, PartialSelection } from "./agentSelection.js";
import { ControlError, type NonDurableControlErrorCode } from "./errors.js";
import { agentSelectionSchema, artifactSchema, candidateSchema, contextWindowSchema, idSchema, runProgressSchema, safeInteger } from "./schema.js";
import { capabilityViewSchema } from "./webProtocol.js";
import { byModelSchema } from "./usageLedger.js";
import { boundStopReason } from "./driveRecord.js";
import { agentObservationSchema, agentPreviewSchema, agentReceiptSchema } from "./agentInstallationProtocol.js";

const MAX_OUTPUT=24*1024*1024;
const executionStatusSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("absent")}).strict(),z.object({kind:z.literal("unknown")}).strict(),
 z.object({kind:z.literal("accepted"),executionId:z.string().min(1),configHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({kind:z.literal("stopped"),proof:z.object({executionId:z.string().min(1),generation:safeInteger.positive(),isolated:z.literal(true),source:artifactSchema}).strict()}).strict(),
]);
const handoffAckSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("latched"),requestId:z.string().min(1)}).strict(),
 z.object({kind:z.literal("complete"),requestId:z.string().min(1),checkpointId:z.string().min(1)}).strict(),
 z.object({kind:z.literal("unknown"),requestId:z.string().min(1)}).strict(),
]);
const amountSchema=z.object({tokens:safeInteger,activeMs:safeInteger,attempts:safeInteger,sessions:safeInteger}).strict();
// Accounts spec §14 / D7: `byModel` is optional so this Orca reads a ccloop that emits it and one that does not (the
// re-pin must not make every collect fail); its entries are strict, sorted and unique, so a malformed one refuses the answer.
const eventSchema=z.object({runId:z.string().min(1),generation:safeInteger.positive(),eventSeq:safeInteger.positive(),bucket:z.enum(["work","handoff"]),cumulative:amountSchema.nullable(),source:artifactSchema,byModel:byModelSchema.nullable().optional()}).strict();
const terminalSchema=z.object({status:z.enum(["succeeded","blocked_waiting_human","exhausted","cancelled","failed"]),currentAttempt:safeInteger,attemptsUsed:safeInteger,lastTransitionAt:z.string(),waitingOnHuman:z.boolean(),stopReason:z.string().nullable(),budgetSnapshot:z.object({attemptsRemaining:safeInteger,timeRemainingMs:safeInteger,tokenBudgetRemaining:safeInteger.nullable()}).strict(),recentFailures:z.array(z.object({rejectCategory:z.string(),primaryTargetPaths:z.array(z.string()),failingCommand:z.string().nullable()}).strict())}).strict();
// Labels and progress spec §3.2 (§8 R4, R5): progress is optional, so an Orca landed before ccloop emits it still reads
// every answer (push Orca first); its shape is strict, so a wrong one refuses the whole answer.
const collectionSchema=z.object({events:z.array(eventSchema),candidate:candidateSchema.nullable(),terminal:terminalSchema.nullable(),progress:runProgressSchema.nullable().optional()}).strict();
const collectionV4Schema=collectionSchema.extend({terminal:terminalSchema.extend({waitingCause:z.literal("token-allowance").optional(),allowanceNextPhase:z.enum(["plan","execute","verify"]).optional(),budgetSnapshot:z.object({attemptsRemaining:safeInteger,timeRemainingMs:safeInteger,tokenBudgetRemaining:safeInteger.nullable(),tokenRemainingStatus:z.enum(["known","unlimited","unknown"])}).strict()}).nullable()});

const evidenceSchema=z.object({artifactId:z.string().min(1),hash:z.string().regex(/^[a-f0-9]{64}$/),base64:z.string()}).strict();
// Agent selection spec §4.6: capabilities protocol 3. Two shapes, chosen by the request: `agent: null` answers the
// table view, a partial selection answers that selection's resolution (its seven-key capability view carries no protocol tag).
const agentsViewSchema=z.object({protocol:z.literal(3),installations:z.array(z.object({id:idSchema,kind:z.string().min(1),defaults:z.object({model:z.string().min(1),contextWindow:contextWindowSchema}).strict(),contextOptions:z.array(contextWindowSchema).min(1),version:z.string().min(1)}).strict())}).strict();
// Single-call estimate spec §4.4: a selection's resolution also answers singleCallExecution, beside the view, never in it.
// Accounts D8: `usageBreakdown` is accepted beside it when ccloop states it; Orca consumes no behavior from it.
// OMP single call (spec 2026-10-14 §4): `singleCallOutputCap`, when ccloop states it, is the cap the agent's call runs
// under; optional (an older ccloop omits it), nullable, never frozen (frozenSlotOf copies field by field).
const agentResolutionSchema=z.object({protocol:z.literal(3),selection:agentSelectionSchema,configHash:z.string().regex(/^[a-f0-9]{64}$/),timeoutMs:safeInteger.positive().max(2_147_483_647),killGraceMs:safeInteger.max(60_000),capabilities:capabilityViewSchema,singleCallExecution:z.enum(["v1"]).nullable(),singleCallOutputCap:safeInteger.positive().nullable().optional(),usageBreakdown:z.enum(["per-model","unavailable"]).optional()}).strict();
export const ccloopCollectionSchema=collectionSchema;
export const ccloopResolutionSchema=agentResolutionSchema;

/**
 * The ccloop error code inside a `control-peer-exit` (ccloop prints `<code>[:detail]` on stderr and exits non-zero),
 * or null for any other failure. Agent selection spec §7: `agent-selection-rejected:<taskId|slot>:<ccloop code>`
 * names the code, so it is read here, where the peer's output is parsed, and nowhere else.
 */
export function peerErrorCode(error:unknown):string|null {
 if(!(error instanceof ControlError)||error.code!=="control-peer-exit"||error.detail===undefined)return null;
 const match=/^[^:]*:([a-z][a-z0-9-]*)/.exec(error.detail);return match?match[1]!:null;
}
/** Agent selection spec §7: ccloop's refusals of a selection or table, which a caller must be able to tell apart. */
// Wave-2 review m-1 (2026-09-26): agent-unselected too -- ccloop refuses a partial selection with no agent by that name
// (exit 2), and it is a selection refusal like the others, not a transient peer exit.
const NAMED_REFUSALS=new Set(["agent-installation-missing","agent-context-unsupported","agent-selection-invalid","agent-version-drift","agents-table-invalid","agent-unselected"] as const);
type NamedRefusal=typeof NAMED_REFUSALS extends Set<infer T>?T:never;
/** A capabilities call's failure: one of ccloop's named refusals is rethrown under its own name, anything else as it was. */
function named(error:unknown):unknown {
 const code=peerErrorCode(error);
 return code!==null&&NAMED_REFUSALS.has(code as NamedRefusal)?new ControlError(code as NamedRefusal,(error as ControlError).detail):error;
}

function regularAbsolute(path:string,code:NonDurableControlErrorCode,executable=false):string {
 try {const stat=lstatSync(path);if(!isAbsolute(path)||realpathSync(path)!==path||!stat.isFile()||stat.isSymbolicLink()||(executable&&(stat.mode&0o111)===0))throw new Error();return path;}
 catch{throw new ControlError(code);}
}
/**
 * Wave-2 review I-1 (2026-09-26): the agents table's path is checked for its shape only, as ccloop's own
 * assertAgentsTablePath does -- absolute, and if anything is there, a canonical regular file (a symlink, dangling or
 * not, is refused). A path with nothing at it passes: a deleted table must not keep the port from being built, or no
 * run already in flight could be inspected, collected or handed off (ccloop T5 fix I-1, spec §12 I4). Whether the
 * table exists and holds is ccloop's to say, at capabilities and accept (agents-table-invalid).
 *
 * Exported for final review I-1 (2026-09-26): `createTrustedControlConfig` (src/panel/controlConfig.ts) has its own,
 * separate existence check on this same path at assembly, which the port-level fix above never reached. It reuses
 * this same shape check rather than a second copy of it, so the two checks cannot drift again.
 */
export function agentsTablePath(path:string):string {
 const invalid=()=>new ControlError("control-agents-table-invalid");
 if(!isAbsolute(path))throw invalid();
 let stat;
 try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return path;throw invalid();}
 try{if(stat.isSymbolicLink()||!stat.isFile()||realpathSync(path)!==path)throw new Error();}catch{throw invalid();}
 return path;
}
export function createCcloopExecutionPort(options:{binary:string;agentsTablePath:string;timeoutMs:number}):ExecutionPort {
 const binary=regularAbsolute(options.binary,"control-binary-invalid",true),table=agentsTablePath(options.agentsTablePath);
 if(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0)throw new ControlError("control-port-options-invalid");
 const evidenceContext=new Map<string,StartEnvelope>(),key=(ref:ArtifactRef)=>`${ref.artifactId}:${ref.hash}`;
 const raw=(method:string,payload:unknown,timeoutMs=options.timeoutMs)=>new Promise<unknown>((resolve,reject)=>{
   const child=execFile(binary,["control",method,"--agents",table],{encoding:"utf8",maxBuffer:MAX_OUTPUT,timeout:timeoutMs},(error,stdout,stderr)=>{
    if(error){const e=error as Error&{code?:number|string;killed?:boolean};if(e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER"||/maxBuffer/i.test(e.message))return reject(new ControlError("control-response-too-large"));if(e.killed)return reject(new ControlError("control-peer-timeout"));const suffix=String(stderr).trim();return reject(new ControlError("control-peer-exit",`${String(e.code)}${suffix?":"+suffix:""}`));}
    if(Buffer.byteLength(stdout)>MAX_OUTPUT||Buffer.byteLength(stderr)>MAX_OUTPUT)return reject(new ControlError("control-response-too-large"));
    try{resolve(JSON.parse(stdout));}catch{reject(new ControlError("control-response-invalid"));}
   });
   child.stdin?.end(JSON.stringify(payload));
 });
 const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ControlError("control-response-invalid");return parsed.data;};
 let unsupportedIdentity:string|null=null;
 const optionalIdentity=()=>{regularAbsolute(binary,'control-binary-invalid',true);const stat=lstatSync(binary,{bigint:true});return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');};
 const optionalRaw=async(method:string,payload:unknown)=>{
  const identity=optionalIdentity();if(identity===unsupportedIdentity)throw new TaskResultUnsupportedError();
  try{return await raw(method,payload,Math.min(options.timeoutMs,TASK_RESULT_RPC_TIMEOUT_MS));}
  catch(error){if(peerErrorCode(error)==='control-command-invalid'&&optionalIdentity()===identity){unsupportedIdentity=identity;throw new TaskResultUnsupportedError();}throw error;}
 };
 const featuresSchema=z.object({protocol:z.literal(1),tokenPolicy:z.literal("optional-v1").optional(),savedResultRecovery:z.literal("v1").optional(),agentInstallationUpdate:z.literal("v1").optional()}).strict();
 let featuresCache:{identity:string;value:ControlFeatures}|null=null;
 const readFeatures=async():Promise<ControlFeatures>=>{
  const identity=optionalIdentity();if(featuresCache?.identity===identity)return {...featuresCache.value};
  let value:ControlFeatures;
  try{value=parse(featuresSchema,await raw("features",{}));}
  catch(error){if(peerErrorCode(error)!=="control-command-invalid")throw error;value={protocol:1};}
  if(optionalIdentity()!==identity)throw new ControlError("control-binary-invalid","changed-during-feature-probe");
  featuresCache={identity,value};return {...value};
 };
 const requireRecovery=async()=>{if((await readFeatures()).savedResultRecovery!=="v1")throw new ControlError("control-saved-result-unsupported");};
 const requireAgentUpdates=async()=>{if((await readFeatures()).agentInstallationUpdate!=="v1")throw new ControlError("control-agent-update-unsupported");};
 const requireFeatures=async(input:StartEnvelope)=>{if(input.mode==="verify-saved-result")await requireRecovery();if(input.protocol===4&&(input.mode===undefined||input.tokenPolicy!==undefined)&&(await readFeatures()).tokenPolicy!=="optional-v1")throw new ControlError("control-token-policy-unsupported");};
 const privateRead=async(method:string,payload:unknown,ref:ArtifactRef)=>{await requireRecovery();const value=parse(evidenceSchema,await raw(method,payload));const bytes=Buffer.from(value.base64,"base64");if(value.artifactId!==ref.artifactId||value.hash!==ref.hash||bytes.toString("base64").replace(/=+$/," ").trim()!==value.base64.replace(/=+$/," ").trim()||createHash("sha256").update(bytes).digest("hex")!==ref.hash)throw new ControlError("artifact-hash-mismatch");return bytes;};
 const port:ExecutionPort={
  readFeatures,
  async observeAgentInstallations(){await requireAgentUpdates();return parse(agentObservationSchema,await raw("agent-installation-observe",{}));},
  async previewAgentInstallations(){await requireAgentUpdates();return parse(agentPreviewSchema,await raw("agent-installation-preview",{}));},
  async applyAgentInstallations(request){await requireAgentUpdates();try{return parse(agentReceiptSchema,await raw("agent-installation-apply",request));}catch(error){
    const code=peerErrorCode(error);
    if(code==="agent-installation-update-stale"||code==="agent-installation-update-conflict"||code==="agent-installation-update-invalid")throw new ControlError(code);
    throw error;
  }},
  async savedResultSourceEligibility(input){await requireRecovery();return parse(savedResultSourceEligibilitySchema,await raw("saved-result-source-eligibility",{input}));},
  async savedResultEligibility(input){await requireRecovery();return parse(savedResultEligibilitySchema,await raw("saved-result-eligibility",{input}));},
  async collectSavedResultEvidence(input){await requireRecovery();return parse(savedResultCollectionSchema,await raw("saved-result-evidence",{input}));},
  async readSavedResultEvidence(input,capsuleRef,ref){return privateRead("read-saved-result-evidence",{input,capsuleRef,ref},ref);},
  async settleSavedResult(input){await requireRecovery();return parse(z.object({ref:artifactSchema,settlement:savedResultSettlementSchema}).strict(),await raw("settle-saved-result",{input}));},
  async readSavedResultSettlement(input,settlementRef,ref){return privateRead("read-saved-result-settlement",{input,settlementRef,ref},ref);},
  async collectTaskResults(input,afterRevision){return parse(taskResultCollectionSchema,await optionalRaw('task-results',{input,afterRevision}));},
  async readTaskResultEvidence(input,manifestRef,ref){
   const value=parse(evidenceSchema,await optionalRaw('read-task-result-evidence',{input,manifestRef,ref}));
   const bytes=Buffer.from(value.base64,'base64');
   if(value.artifactId!==ref.artifactId||value.hash!==ref.hash||bytes.length>MAX_TASK_RESULT_EVIDENCE_BYTES||bytes.toString('base64').replace(/=+$/,'')!==value.base64.replace(/=+$/,'')||createHash('sha256').update(bytes).digest('hex')!==ref.hash)throw new ControlError('artifact-hash-mismatch');return bytes;
  },
  /**
   * Agent selection spec §4.6. The request's own fields come back verbatim (spec M5: an alias is not
   * normalised), which is what lets a caller tell a layer's value from a descriptor default; an answer that
   * changed one is not this selection's answer, so it is refused rather than passed on.
   *
   * The standing rule of the retired `probeProfileCapabilities` still holds: Orca does not invent a substitute
   * for a field ccloop did not state -- the view is the peer's, unaltered (criterion in ccloopPort.test.ts).
   */
  async resolveAgent(partial:PartialSelection):Promise<AgentResolution>{
   let answer:unknown;
   try{answer=await raw("capabilities",{agent:partial});}catch(error){throw named(error);}
   const {protocol:_protocol,usageBreakdown:_usageBreakdown,...resolution}=parse(agentResolutionSchema,answer);
   for(const key of ["agent","model","contextWindow"] as const){
    if(partial[key]!==undefined&&resolution.selection[key]!==partial[key])throw new ControlError("control-response-invalid",`selection-not-echoed:${key}`);
   }
   return resolution;
  },
  async listAgents():Promise<AgentsView>{
   let answer:unknown;
   try{answer=await raw("capabilities",{agent:null});}catch(error){throw named(error);}
   const {protocol:_protocol,...view}=parse(agentsViewSchema,answer);return view;
  },
  async accept(input){await requireFeatures(input);return parse(executionStatusSchema,await raw("accept",input)) as ExecutionStatus;},
  async inspect(input){await requireFeatures(input);return parse(executionStatusSchema,await raw("inspect",input)) as ExecutionStatus;},
  async requestHandoff(input,request){await requireFeatures(input);return parse(handoffAckSchema,await raw("handoff",{input,request})) as HandoffAck;},
  async collect(input,afterSeq){await requireFeatures(input);const response=parse(input.protocol===4?collectionV4Schema:collectionSchema,await raw("collect",{input,afterSeq}));for(const ref of [...response.events.map(event=>event.source),...(response.candidate?.artifacts??[]),...(response.candidate?[response.candidate.handoff]:[]),...(response.candidate?.stopProof?[response.candidate.stopProof.source]:[])])evidenceContext.set(key(ref),input);return {events:response.events,candidate:response.candidate,terminal:response.terminal?{outcome:response.terminal.status,...(input.protocol===4?{tokenRemainingStatus:(response.terminal.budgetSnapshot as {tokenRemainingStatus?:string}).tokenRemainingStatus,...("waitingCause" in response.terminal?{waitingCause:response.terminal.waitingCause,allowanceNextPhase:(response.terminal as {allowanceNextPhase?:string}).allowanceNextPhase}:{})}:{}),attemptSha:null,sourceDir:input.work.sourceDir,repoDir:join(input.work.sourceDir,"repo"),...(response.terminal.stopReason?{stopReason:boundStopReason(response.terminal.stopReason)}:{})}:null,progress:response.progress??null} as ExecutionReport;},
  async readEvidence(ref:ArtifactRef){
   const input=evidenceContext.get(key(ref));if(!input)throw new ControlError("control-evidence-context-missing");const value=parse(evidenceSchema,await raw("read-evidence",{input,ref}));
   if(value.artifactId!==ref.artifactId||value.hash!==ref.hash)throw new ControlError("artifact-hash-mismatch");
   const bytes=Buffer.from(value.base64,"base64");if(bytes.toString("base64").replace(/=+$/,"")!==value.base64.replace(/=+$/,"")||createHash("sha256").update(bytes).digest("hex")!==ref.hash)throw new ControlError("artifact-hash-mismatch");return bytes;
  },
 };
 return port;
}
