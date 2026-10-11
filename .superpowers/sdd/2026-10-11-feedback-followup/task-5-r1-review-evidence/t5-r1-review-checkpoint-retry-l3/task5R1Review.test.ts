import { appendUsageObservation } from "../../src/control/usage.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBundle } from "./optionalMaterializeFixture.js";
import { readAllowanceContinuation } from "../../src/control/materialize.js";
import {resultFixture} from "./taskResultFixture.js";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {sealCodex} from "./agentsFixture.js";
import {atomicReplacePrivateFile} from "../../src/control/paths.js";
import {writeAccepted} from "../../src/control/store.js";
import {runControlWorker} from "../../src/control/worker.js";
const exec=promisify(execFile),roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
import { canonicalHash } from "../../src/control/protocol.js";

async function saved(nextPhase:"plan"|"execute"|"verify"="verify") {
 const h=await buildBundle();const f=await resultFixture();roots.push(h.root,f.root);const envelope=f.input;
 const original=String(h.snapshot.head);
 await exec('/usr/bin/git',['fetch',h.sourceRepo,'HEAD'],{cwd:h.targetRepo});
 await exec('/usr/bin/git',['reset','--hard',original],{cwd:h.targetRepo});
 await exec('/usr/bin/git',['config','user.name','Review'],{cwd:h.targetRepo});await exec('/usr/bin/git',['config','user.email','review@invalid'],{cwd:h.targetRepo});
 envelope.work.targetRepo=h.targetRepo;envelope.work.base=original;envelope.work.contract.executionPolicy.maxAttempts=3;envelope.work.contract.executionPolicy.autonomyLevel="L3";
 envelope.protocol=4;envelope.tokenPolicy={authoredTokenCeiling:null,bindingCauses:["spend-cap"],inheritedUsage:{tokens:20,activeMs:100,attempts:1,sessions:1}};envelope.inputCheckpoint=h.input;envelope.work.sourceDir=f.sourceDir;
 envelope.work.contract.context.repoPath=h.targetRepo;
 const put=async(value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));const hash=createHash("sha256").update(bytes).digest("hex");const ref={artifactId:`sha256-${hash}`,hash};const file=`artifacts/${ref.artifactId}.bin`;await writeFile(join(h.input.bundlePath,file),bytes,{mode:0o600});h.manifest.artifacts.push({ref,file});return ref;};
 const plan={summary:"saved plan",primaryTargetPaths:[],tokenUsage:10};
 const execution={changedFiles:[],diffPatch:"",commandOutputs:[],stdoutStderrLog:"",tokenUsage:10};
 const planRef=await put(plan),executionRef=await put(execution),acceptedContract=await put({...envelope.work.contract,context:{...envelope.work.contract.context,repoPath:h.sourceRepo}});
 const recentFailures=nextPhase==="plan"?[{rejectCategory:"fix",primaryTargetPaths:[],failingCommand:null}]:[];
 const runState={currentAttempt:1,attemptsUsed:1,budgetSnapshot:{attemptsRemaining:2,timeRemainingMs:100,tokenBudgetRemaining:0,tokenRemainingStatus:"known"},recentFailures,waitingCause:"token-allowance",allowanceNextPhase:nextPhase};
 const state=await put(runState),verification=nextPhase==="plan"?await put({approved:false,rejectCategory:"fix",primaryTargetPaths:[],failingCommand:null,safeToRetry:true,pauseSignals:[],stopSignals:[]}):null;
 const usageDir=join(h.root,"usage-source");await mkdir(usageDir);
 await appendUsageObservation(usageDir,{runId:h.input.predecessorRunId,generation:envelope.claim.generation,bucket:"work",observationId:"settled",threadTotalTokens:20,elapsedMs:100,attempts:1,sessions:1,evidence:{phase:"execute"}});
 const ledger=JSON.parse(await readFile(join(usageDir,"control/usage.json"),"utf8"));
 const usage=await put(ledger);
 const packet={usageHighWater:2,identity:{...envelope.claim,runId:h.input.predecessorRunId},tokenPolicy:{authoredTokenCeiling:null,bindingCauses:["spend-cap"],inheritedUsage:{tokens:0,activeMs:0,attempts:0,sessions:0}},contractHash:envelope.contractHash,acceptedContract,runState,allowanceContinuation:{nextPhase,plan:nextPhase==="plan"?null:planRef,execution:nextPhase==="verify"?executionRef:null,verification,state,usage},artifacts:[planRef,executionRef,acceptedContract,state,usage,...(verification?[verification]:[])]};
 const update=async()=>{const handoff=await put(packet);const checkpoint={checkpointId:h.input.checkpointId,snapshot:h.manifest.snapshot,handoff};const bytes=Buffer.from(JSON.stringify(checkpoint));const hash=createHash("sha256").update(bytes).digest("hex");await writeFile(join(h.input.bundlePath,"checkpoint.json"),bytes,{mode:0o600});const ref={artifactId:`checkpoint-cp1-${hash}`,hash};h.manifest.artifacts[0]={ref,file:"checkpoint.json"};h.manifest.checkpoint=ref;h.manifest.checkpointHash=hash;h.input.checkpointHash=hash;await writeFile(h.manifestPath,JSON.stringify(h.manifest),{mode:0o600});};
 await update();
 const bundlePath=join(f.sourceDir,'input','cp1');await mkdir(join(f.sourceDir,'input'),{recursive:true});await cp(h.input.bundlePath,bundlePath,{recursive:true});envelope.inputCheckpoint={...h.input,bundlePath};
 return{h,f,envelope,packet,plan,execution,ledger,put,update,original};
}

it("review I1: fresh retry after checkpoint uses its own actual initialization base",async()=>{
 const {h,f,envelope,original}=await saved();
 const fake=join(f.root,'fake.mjs');await writeFile(fake,`import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
 if(process.argv.includes('--version')){console.log('9.9.9-fake');process.exit(0);}
 let prompt='';for await(const part of process.stdin)prompt+=part;
 const args=process.argv,schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
 const phase=schema.properties?.result?'execute':schema.properties?.approved?'verify':'plan';
 if(phase==='verify'){
 execFileSync('/usr/bin/git',['add','-A']);
 execFileSync('/usr/bin/git',['-C',${JSON.stringify(h.targetRepo)},'-c','core.hooksPath=/dev/null','commit','--allow-empty','-m','target advances before fresh retry']);
 }
 const result=phase==='verify'?{approved:false,rejectCategory:'retry',primaryTargetPaths:[],failingCommand:null,safeToRetry:true,evidence:[],pauseSignals:[],stopSignals:[]}:phase==='plan'?{summary:'retry plan',primaryTargetPaths:[]}:{result:{changedFiles:[]}};
 writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(result));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}));`);
 const sealed=await sealCodex({command:[process.execPath,fake],model:'fixture',sandbox:'workspace-write',budgetMode:'soft',timeoutMs:10000,killGraceMs:50});
 envelope.claim.agent=sealed.selection;envelope.claim.configHash=sealed.configHash;
 await atomicReplacePrivateFile(f.sourceDir,join(f.sourceDir,'control/config.json'),Buffer.from(JSON.stringify(sealed.config)));
 await atomicReplacePrivateFile(f.sourceDir,join(f.sourceDir,'control/envelope.json'),Buffer.from(JSON.stringify(envelope)));
 await writeAccepted(f.sourceDir,{protocol:1,envelopeHash:canonicalHash(envelope),executionId:'execution-1',configHash:sealed.configHash,generation:1,acceptedAt:new Date().toISOString(),launch:'intended',worker:null});
 await runControlWorker(['--source-dir',f.sourceDir,'--execution-id','execution-1','--nonce','nonce-1']);
 const response=await f.rpc('saved-result-evidence',{input:envelope});expect(response.code,response.stderr).toBe(0);
 const page=JSON.parse(response.stdout);expect(page.capsule,await readFile(join(f.runDir,'events.jsonl'),'utf8')).not.toBeNull();
 const read=await f.rpc('read-saved-result-evidence',{input:envelope,capsuleRef:page.capsule,ref:page.capsule});expect(read.code,read.stderr).toBe(0);
 const c=JSON.parse(Buffer.from(JSON.parse(read.stdout).base64,'base64').toString());
 const current=(await exec('/usr/bin/git',['rev-parse','HEAD'],{cwd:h.targetRepo})).stdout.trim();
 expect(c.attempt).toBe(2);expect(c.attemptStartHead).toBe(current);expect(current).not.toBe(original);
 expect(c.resolvedBase).toBe(c.attemptStartHead);
},30000);
