import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { AgentsView, ExecutionPort, ExecutionReport, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { ArtifactRef, HandoffAck, HandoffRequest } from "./types.js";
import type { AgentResolution, PartialSelection } from "./agentSelection.js";
import { ControlError, type NonDurableControlErrorCode } from "./errors.js";
import { agentSelectionSchema, artifactSchema, candidateSchema, contextWindowSchema, idSchema, safeInteger } from "./schema.js";
import { capabilityViewSchema } from "./webProtocol.js";

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
const eventSchema=z.object({runId:z.string().min(1),generation:safeInteger.positive(),eventSeq:safeInteger.positive(),bucket:z.enum(["work","handoff"]),cumulative:amountSchema.nullable(),source:artifactSchema}).strict();
const terminalSchema=z.object({status:z.enum(["succeeded","blocked_waiting_human","exhausted","cancelled","failed"]),currentAttempt:safeInteger,attemptsUsed:safeInteger,lastTransitionAt:z.string(),waitingOnHuman:z.boolean(),stopReason:z.string().nullable(),budgetSnapshot:z.object({attemptsRemaining:safeInteger,timeRemainingMs:safeInteger,tokenBudgetRemaining:safeInteger}).strict(),recentFailures:z.array(z.object({rejectCategory:z.string(),primaryTargetPaths:z.array(z.string()),failingCommand:z.string().nullable()}).strict())}).strict();
const collectionSchema=z.object({events:z.array(eventSchema),candidate:candidateSchema.nullable(),terminal:terminalSchema.nullable()}).strict();
const evidenceSchema=z.object({artifactId:z.string().min(1),hash:z.string().regex(/^[a-f0-9]{64}$/),base64:z.string()}).strict();
// Agent selection spec §4.6: capabilities protocol 3. Two shapes, chosen by the request: `agent: null` answers the
// table view, a partial selection answers that selection's resolution (its seven-key capability view carries no protocol tag).
const agentsViewSchema=z.object({protocol:z.literal(3),installations:z.array(z.object({id:idSchema,kind:z.string().min(1),defaults:z.object({model:z.string().min(1),contextWindow:contextWindowSchema}).strict(),contextOptions:z.array(contextWindowSchema).min(1),version:z.string().min(1)}).strict())}).strict();
const agentResolutionSchema=z.object({protocol:z.literal(3),selection:agentSelectionSchema,configHash:z.string().regex(/^[a-f0-9]{64}$/),timeoutMs:safeInteger.positive().max(2_147_483_647),killGraceMs:safeInteger.max(60_000),capabilities:capabilityViewSchema}).strict();

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
 */
function agentsTablePath(path:string):string {
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
 const raw=(method:string,payload:unknown)=>new Promise<unknown>((resolve,reject)=>{
   const child=execFile(binary,["control",method,"--agents",table],{encoding:"utf8",maxBuffer:MAX_OUTPUT,timeout:options.timeoutMs},(error,stdout,stderr)=>{
    if(error){const e=error as Error&{code?:number|string;killed?:boolean};if(e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER"||/maxBuffer/i.test(e.message))return reject(new ControlError("control-response-too-large"));if(e.killed)return reject(new ControlError("control-peer-timeout"));const suffix=String(stderr).trim();return reject(new ControlError("control-peer-exit",`${String(e.code)}${suffix?":"+suffix:""}`));}
    if(Buffer.byteLength(stdout)>MAX_OUTPUT||Buffer.byteLength(stderr)>MAX_OUTPUT)return reject(new ControlError("control-response-too-large"));
    try{resolve(JSON.parse(stdout));}catch{reject(new ControlError("control-response-invalid"));}
   });
   child.stdin?.end(JSON.stringify(payload));
 });
 const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ControlError("control-response-invalid");return parsed.data;};
 const port:ExecutionPort={
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
   const {protocol:_protocol,...resolution}=parse(agentResolutionSchema,answer);
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
  async accept(input){return parse(executionStatusSchema,await raw("accept",input)) as ExecutionStatus;},
  async inspect(input){return parse(executionStatusSchema,await raw("inspect",input)) as ExecutionStatus;},
  async requestHandoff(input,request){return parse(handoffAckSchema,await raw("handoff",{input,request})) as HandoffAck;},
  async collect(input,afterSeq){const response=parse(collectionSchema,await raw("collect",{input,afterSeq}));for(const ref of [...response.events.map(event=>event.source),...(response.candidate?.artifacts??[]),...(response.candidate?[response.candidate.handoff]:[]),...(response.candidate?.stopProof?[response.candidate.stopProof.source]:[])])evidenceContext.set(key(ref),input);return {events:response.events,candidate:response.candidate,terminal:response.terminal?{outcome:response.terminal.status,attemptSha:null,sourceDir:input.work.sourceDir,repoDir:join(input.work.sourceDir,"repo")}:null} as ExecutionReport;},
  async readEvidence(ref:ArtifactRef){
   const input=evidenceContext.get(key(ref));if(!input)throw new ControlError("control-evidence-context-missing");const value=parse(evidenceSchema,await raw("read-evidence",{input,ref}));
   if(value.artifactId!==ref.artifactId||value.hash!==ref.hash)throw new ControlError("artifact-hash-mismatch");
   const bytes=Buffer.from(value.base64,"base64");if(bytes.toString("base64").replace(/=+$/,"")!==value.base64.replace(/=+$/,"")||createHash("sha256").update(bytes).digest("hex")!==ref.hash)throw new ControlError("artifact-hash-mismatch");return bytes;
  },
 };
 return port;
}
