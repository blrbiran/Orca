import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { savedResultPath, savedResultIndexPath, writeSavedBytes } from "../../src/control/savedResultEvidence.js";
const exec=promisify(execFile);
import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { resultFixture } from "./taskResultFixture.js";
import { sealCodex } from "./agentsFixture.js";
import { canonicalHash, canonicalJson } from "../../src/control/protocol.js";
import { writeAccepted } from "../../src/control/store.js";
import { atomicReplacePrivateFile } from "../../src/control/paths.js";
import { runControlWorker } from "../../src/control/worker.js";
import { readUsageEvents } from "../../src/control/usage.js";
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function world(mode="invalid") {
  const f=await resultFixture(); roots.push(f.root);
  const fake=join(f.root,"fake.mjs");
  await writeFile(join(f.repo,"delete.txt"),"delete me");
  await exec("/usr/bin/git",["add","delete.txt"],{cwd:f.repo});await exec("/usr/bin/git",["-c","core.hooksPath=/dev/null","commit","-m","tracked deletion fixture"],{cwd:f.repo});
  if(mode==="narrowed") {
    Object.assign(f.input,{protocol:4,tokenPolicy:{authoredTokenCeiling:1000,bindingCauses:["spend-cap"],inheritedUsage:{tokens:0,activeMs:0,attempts:0,sessions:0}}});
    f.input.claim.grant.work={tokens:100,activeMs:10000,attempts:1,sessions:1};
  }
  await writeFile(fake,`import {readFileSync,writeFileSync,unlinkSync,chmodSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
if(process.argv.includes('--version')){console.log('9.9.9-fake');process.exit(0);}
let prompt='';for await(const part of process.stdin)prompt+=part;
const args=process.argv, schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
const phase=schema.properties?.result?'execute':schema.properties?.approved?'verify':'plan';
if(phase==='verify')throw new Error('verifier must not enter');
const result=phase==='plan'?{summary:'write answer',primaryTargetPaths:['answer.txt']}:{result:{changedFiles:['answer.txt']}};
if(phase==='execute'){
 unlinkSync('delete.txt');
 writeFileSync('answer.txt','staged\\n');execFileSync('/usr/bin/git',['add','answer.txt']);writeFileSync('answer.txt','unstaged\\n');
 writeFileSync('new.sh','#!/bin/sh\\necho saved\\n');chmodSync('new.sh',0o4755); if((statSync('new.sh').mode & 0o7777)!==0o4755)throw new Error('special mode setup failed');
 writeFileSync('.gitignore','ignored.txt\\n');writeFileSync('ignored.txt','protected');
 if(${JSON.stringify(mode)}==='capture-failure')execFileSync('mkfifo',['pipe']);
 if(${JSON.stringify(mode)}==='rewrite-runtime') {const path=${JSON.stringify(join(f.runDir,'loop-contract.json'))};const c=JSON.parse(readFileSync(path,'utf8'));c.executionPolicy.tokenBudget=999;writeFileSync(path,JSON.stringify(c));}
 if(${JSON.stringify(mode)}==='rewrite-config') {const path=${JSON.stringify(join(f.sourceDir,'control/config.json'))};const c=JSON.parse(readFileSync(path,'utf8'));c.installation.command=[process.execPath,'/not-the-executed-provider.mjs'];writeFileSync(path,JSON.stringify(c));}
}
writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(result));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}));
`);
  const sealed=await sealCodex({command:[process.execPath,fake],model:'fixture',sandbox:'workspace-write',budgetMode:'soft',timeoutMs:10000,killGraceMs:50});
  f.input.claim.agent=sealed.selection;f.input.claim.configHash=sealed.configHash;
  f.input.contractHash='b'.repeat(64); // frozen authority differs from narrowed accepted/runtime bytes
  await atomicReplacePrivateFile(f.sourceDir,join(f.sourceDir,'control/config.json'),Buffer.from(canonicalJson(sealed.config)));
  await atomicReplacePrivateFile(f.sourceDir,join(f.sourceDir,'control/envelope.json'),Buffer.from(canonicalJson(f.input)));
  await writeAccepted(f.sourceDir,{protocol:1,envelopeHash:canonicalHash(f.input),executionId:'execution-1',configHash:sealed.configHash,generation:1,acceptedAt:new Date().toISOString(),launch:'intended',worker:null});
  await runControlWorker(['--source-dir',f.sourceDir,'--execution-id','execution-1','--nonce','nonce-1']);
  return f;
}
async function jsonRef(f:Awaited<ReturnType<typeof world>>,capsuleRef:any,ref:any){
 const r=await f.rpc('read-saved-result-evidence',{input:f.input,capsuleRef,ref});expect(r.code,r.stderr).toBe(0);
 return JSON.parse(Buffer.from(JSON.parse(r.stdout).base64,'base64').toString());
}
it('review: complete snapshot preserves special permission bits or refuses capture',async()=>{
 const f=await world(); const r=await f.rpc('saved-result-evidence',{input:f.input});expect(r.code,r.stderr).toBe(0);
 const page=JSON.parse(r.stdout); if(page.capsule===null){expect(page.reason).toBeTruthy();return;}
 const c=await jsonRef(f,page.capsule,page.capsule), snap=await jsonRef(f,page.capsule,c.snapshot);
 expect(c.completeness.complete).toBe(true);
 expect(snap.files.find((x:any)=>x.path==='new.sh').mode).toBe(0o4755);
},30000);
