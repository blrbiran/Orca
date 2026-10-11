import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {resultFixture} from '/private/tmp/ccloop-feedback-followup-20261011/tests/control/taskResultFixture.ts';
import {sealCodex} from '/private/tmp/ccloop-feedback-followup-20261011/tests/control/agentsFixture.ts';
import {canonicalHash,canonicalJson} from '/private/tmp/ccloop-feedback-followup-20261011/src/control/protocol.ts';
import {writeAccepted} from '/private/tmp/ccloop-feedback-followup-20261011/src/control/store.ts';
import {atomicReplacePrivateFile} from '/private/tmp/ccloop-feedback-followup-20261011/src/control/paths.ts';
import {ccloopCollectionSchema} from '/private/tmp/orca-feedback-followup-20261011/src/control/ccloopPort.ts';
const exec=promisify(execFile),roots:string[]=[];
async function world(mode="invalid") {
  const f=await resultFixture(); roots.push(f.root);
  const fake=join(f.root,"fake.mjs");
  await writeFile(join(f.repo,"delete.txt"),"delete me");
  await exec("/usr/bin/git",["add","delete.txt"],{cwd:f.repo});await exec("/usr/bin/git",["-c","core.hooksPath=/dev/null","commit","-m","tracked deletion fixture"],{cwd:f.repo});
  if(mode==="narrowed") {
    Object.assign(f.input,{protocol:4,tokenPolicy:{authoredTokenCeiling:1000,bindingCauses:["spend-cap"],inheritedUsage:{tokens:0,activeMs:0,attempts:0,sessions:0}}});
    f.input.claim.grant.work={tokens:100,activeMs:10000,attempts:1,sessions:1};
  }
  await writeFile(fake,`import {readFileSync,writeFileSync,unlinkSync,chmodSync} from 'node:fs';
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
 writeFileSync('new.sh','#!/bin/sh\\necho saved\\n');chmodSync('new.sh',0o755);
 writeFileSync('.gitignore','ignored.txt\\n');writeFileSync('ignored.txt','protected');
 if(${JSON.stringify(mode)}==='capture-failure')execFileSync('mkfifo',['pipe']);
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
  await exec(process.execPath,['/private/tmp/ccloop-feedback-followup-20261011/dist/src/control/worker.js','--source-dir',f.sourceDir,'--execution-id','execution-1','--nonce','nonce-1']);
  return f;
}
const f=await world();
const table=join(f.root,'agents.json');
await writeFile(table,JSON.stringify({schema:'ccloop-agents-table-v1',installations:{codex:{kind:'codex',command:[process.execPath,join(f.root,'fake.mjs')],version:'9.9.9-fake',configDir:null,timeoutMs:10000,killGraceMs:50,budgetMode:'soft',sandbox:'workspace-write'}}}),{mode:0o600});
const rpc=(method:string,payload:unknown)=>{const r=spawnSync(process.execPath,['/private/tmp/ccloop-feedback-followup-20261011/dist/cli.js','control',method,'--agents',table],{input:JSON.stringify(payload),encoding:'utf8',env:process.env});if(r.error)throw r.error;return {rc:r.status,stdout:r.stdout,stderr:r.stderr};};
const pageResponse=rpc('saved-result-evidence',{input:f.input});assert.equal(pageResponse.rc,0,pageResponse.stderr);const page=JSON.parse(pageResponse.stdout);assert.ok(page.capsule);
const core=rpc('collect',{input:f.input,afterSeq:0});assert.equal(core.rc,0,core.stderr);const raw=JSON.parse(core.stdout);assert.deepEqual(ccloopCollectionSchema.parse(raw),raw);
assert.equal(raw.terminal.status,'failed');assert.ok(raw.candidate.artifacts.every((r:any)=>!r.artifactId.startsWith('saved-result-')));
const capsuleThroughCore=rpc('read-evidence',{input:f.input,ref:page.capsule});assert.equal(capsuleThroughCore.rc,2);assert.match(capsuleThroughCore.stderr,/control-evidence-ref-invalid/);
const capsuleRead=rpc('read-saved-result-evidence',{input:f.input,capsuleRef:page.capsule,ref:page.capsule});assert.equal(capsuleRead.rc,0,capsuleRead.stderr);
const capsule=JSON.parse(Buffer.from(JSON.parse(capsuleRead.stdout).base64,'base64').toString());
const snapshotThroughCore=rpc('read-evidence',{input:f.input,ref:capsule.snapshot});assert.equal(snapshotThroughCore.rc,2);assert.match(snapshotThroughCore.stderr,/control-evidence-ref-invalid/);
const manifests=[];for(const ref of raw.candidate.artifacts){const r=rpc('read-evidence',{input:f.input,ref});assert.equal(r.rc,0,r.stderr);const bytes=Buffer.from(JSON.parse(r.stdout).base64,'base64').toString();assert.ok(!bytes.includes(page.capsule.artifactId));assert.ok(!bytes.includes(capsule.snapshot.artifactId));manifests.push(ref);}
const aliases=capsule.artifacts.usageObservations;
for(const alias of aliases){const r=rpc('read-saved-result-evidence',{input:f.input,capsuleRef:page.capsule,ref:alias.source});assert.equal(r.rc,0,r.stderr);}
const alias=aliases[0],originalPath=join(f.sourceDir,'control','evidence',alias.source.artifactId+'.bin');
const originalBytes=await readFile(originalPath);
try {
 await writeFile(originalPath,'mutable original tampered');
 const r=rpc('read-saved-result-evidence',{input:f.input,capsuleRef:page.capsule,ref:alias.source});assert.equal(r.rc,0,r.stderr);
 assert.deepEqual(Buffer.from(JSON.parse(r.stdout).base64,'base64'),originalBytes);
 const coreTamper=rpc('read-evidence',{input:f.input,ref:alias.source});assert.equal(coreTamper.rc,2);assert.match(coreTamper.stderr,/control-evidence-hash-mismatch/);
} finally {await writeFile(originalPath,originalBytes);}
const evidence={root:f.root,input:f.input,table,page,core:raw,capsule,capsuleThroughCore,snapshotThroughCore,coreRefsChecked:manifests.length,aliasesChecked:aliases.length,mutableOriginalIgnored:true};
await writeFile('/private/tmp/orca-feedback-followup-20261011/.superpowers/sdd/2026-10-11-feedback-followup/task-5-native-wire-evidence-final.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({root:f.root,acceptedOldConsumer:true,failedSourcePreserved:true,capsuleRef:page.capsule,coreRefsChecked:manifests.length,coreCapsuleRead:capsuleThroughCore.rc,coreSnapshotRead:snapshotThroughCore.rc,aliasesChecked:aliases.length,mutableOriginalIgnored:true}));
