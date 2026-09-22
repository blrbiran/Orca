import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ExecutionPort, ExecutionReport, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { ArtifactRef, Capabilities, HandoffAck, HandoffRequest } from "./types.js";
import { ControlError, type NonDurableControlErrorCode } from "./errors.js";
import { artifactSchema, candidateSchema, capabilitiesSchema, safeInteger } from "./schema.js";

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

function regularAbsolute(path:string,code:NonDurableControlErrorCode,executable=false):string {
 try {const stat=lstatSync(path);if(!isAbsolute(path)||realpathSync(path)!==path||!stat.isFile()||stat.isSymbolicLink()||(executable&&(stat.mode&0o111)===0))throw new Error();return path;}
 catch{throw new ControlError(code);}
}
export function createCcloopExecutionPort(options:{binary:string;adapter:"codex";adapterConfigPath:string;timeoutMs:number}):ExecutionPort {
 const binary=regularAbsolute(options.binary,"control-binary-invalid",true),config=regularAbsolute(options.adapterConfigPath,"control-adapter-config-invalid");
 if(options.adapter!=="codex"||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0)throw new ControlError("control-port-options-invalid");
 const evidenceContext=new Map<string,StartEnvelope>(),key=(ref:ArtifactRef)=>`${ref.artifactId}:${ref.hash}`;
 const raw=(method:string,payload:unknown)=>new Promise<unknown>((resolve,reject)=>{
   const child=execFile(binary,["control",method,"--adapter",options.adapter,"--adapter-config",config],{encoding:"utf8",maxBuffer:MAX_OUTPUT,timeout:options.timeoutMs},(error,stdout,stderr)=>{
    if(error){const e=error as Error&{code?:number|string;killed?:boolean};if(e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER"||/maxBuffer/i.test(e.message))return reject(new ControlError("control-response-too-large"));if(e.killed)return reject(new ControlError("control-peer-timeout"));const suffix=String(stderr).trim();return reject(new ControlError("control-peer-exit",`${String(e.code)}${suffix?":"+suffix:""}`));}
    if(Buffer.byteLength(stdout)>MAX_OUTPUT||Buffer.byteLength(stderr)>MAX_OUTPUT)return reject(new ControlError("control-response-too-large"));
    try{resolve(JSON.parse(stdout));}catch{reject(new ControlError("control-response-invalid"));}
   });
   child.stdin?.end(JSON.stringify(payload));
 });
 const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ControlError("control-response-invalid");return parsed.data;};
 const port:ExecutionPort={
  /**
   * Assembly plan Task 3. The router needs this method to exist (`profiles.ts:67-69,150`), and
   * without it every Web claim is reported as `control-capability-probe-failed` -- a probe that was
   * never attempted, blamed on the adapter.
   *
   * ⚠️ *** ccloop's control protocol has no V1 profile probe. *** `control capabilities` answers
   * seven fields (ccloop `src/control/command.ts`, the `method === "capabilities"` arm) and none of
   * them covers `contextObservation`, `handoffControl`, `handoffExecution`, `contextWindowTokens` or
   * a `requestBoundProof` descriptor. So this translates what ccloop states and says `unavailable` /
   * `null` for what it does not -- it does NOT infer them, per `ExecutionPort`'s own contract and the
   * standing rule that Orca may not invent a substitute source for a peer's observation.
   *
   * The consequence is deliberate and fail-closed: a claim through this port reaches
   * `control-capability-unsupported` (`service.ts`'s `profiledCapabilities` requires
   * `handoffControl === "durable"`), which is accurate. Dispatching Web work to real ccloop needs
   * ccloop's `capabilities` to grow these fields first; that is a ccloop-side change, recorded in
   * both handoffs, and nothing on this side may paper over it.
   */
  async probeProfileCapabilities(){
   const stated=parse(capabilitiesSchema,await raw("capabilities",{})) as Capabilities;
   return {
    usageObservation:stated.usageObservation,
    budgetEnforcement:stated.budgetEnforcement==="unsupported"?"unavailable":stated.budgetEnforcement,
    contextObservation:"unavailable",
    handoffControl:"unavailable",
    handoffExecution:null,
    contextWindowTokens:null,
    requestBoundProof:null,
   };
  },
  async capabilities(){return parse(capabilitiesSchema,await raw("capabilities",{})) as Capabilities;},
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
