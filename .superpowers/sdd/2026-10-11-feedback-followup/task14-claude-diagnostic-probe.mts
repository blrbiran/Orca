import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexFixture } from '/private/tmp/ccloop-task14-claude-diagnostic-20261011/tests/runtime/codex/fixture.ts';
import { ClaudeAgentAdapter, readObservedTokens } from '/private/tmp/ccloop-task14-claude-diagnostic-20261011/src/runtime/claude/claudeAgentAdapter.ts';
const owned='/private/tmp/ccloop-task14-claude-diagnostic-20261011';
const root=process.env.T14_OUTPUT!; await mkdir(root,{recursive:true});
const trace=join(root,'trace.jsonl'); process.env.T14_TRACE=trace;
const log=(event:string,detail={})=>appendFileSync(trace,JSON.stringify({role:'probe',pid:process.pid,t:process.hrtime.bigint().toString(),event,...detail})+'\n');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn:()=>boolean|Promise<boolean>,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(2);}throw Error('probe poll deadline');}
const mode=process.argv[2];
if(mode==='adapter-marker'||mode==='adapter-preexit'||mode==='adapter-exit') {
 const f=await codexFixture('unused');const marker=join(f.dir,'claude-marker');
 if(mode==='adapter-preexit')process.env.T14_PREEXIT_MS='150';else delete process.env.T14_PREEXIT_MS;
 const config:any={schema:'ccloop-agent-config-v1',kind:'claude',installation:{kind:'claude',command:[process.execPath,join(owned,'tests/fixtures/fake-claude-cli.mjs'),'answer-then-linger',marker],version:'9.9.9-fake',configDir:null,timeoutMs:20000,killGraceMs:300},selection:{agent:'claude',model:'claude-opus-5-5',contextWindow:'agent-default'}};
 const abort=new AbortController();const running=new ClaudeAgentAdapter(config).execute({...f.context,abortSignal:abort.signal});
 const settled=running.then(result=>({result}),error=>({error:{name:error.name,message:error.message,observedTokens:error.observedTokens,evidenceDir:error.evidenceDir}}));
 await poll(()=>existsSync(marker+'.answered'));log('caller-marker-observed',{fake:JSON.parse(readFileSync(marker,'utf8')).pid});
 const calls=join(f.runDir,'claude','1','execute');
 await poll(async()=>{try{const {readdir}=await import('node:fs/promises');const [call]=await readdir(calls);return await readObservedTokens(join(calls,call,'observed-usage.json'))===1109;}catch{return false;}});
 log('caller-observed-1109');
 if(mode==='adapter-exit')await poll(()=>readFileSync(trace,'utf8').split('\n').filter(Boolean).some(s=>{const x=JSON.parse(s);return x.event==='inner-exit'&&x.code===0&&x.signal===null;}));
 log('caller-abort');abort.abort();
 const outcome=await settled;writeFileSync(join(root,'probe-result.json'),JSON.stringify({mode,fixture:f.dir,marker,outcome},null,2)+'\n');
 console.log(JSON.stringify({mode,fixture:f.dir,outcome}));
} else {
 const f=await codexFixture('unused');await writeFileSync(join(f.repo,'answer.txt'),'dirty\n');
 const marker=join(f.dir,'marker');const fake=join(f.dir,'fake.cjs');
 const envelope=JSON.stringify({structured_output:{changedFiles:['inner-success.txt'],diffPatch:'diff --git a/inner-success.txt b/inner-success.txt',commandOutputs:['inner-success'],stdoutStderrLog:'ok'}});
 const source=mode==='runner-graceful'?`
 const fs=require('node:fs'); const cp=require('node:child_process');
 process.on('SIGTERM',()=>{fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({role:'graceful-fake',pid:process.pid,event:'SIGTERM-exit0',t:process.hrtime.bigint().toString()})+'\\n');process.exit(0);});
 process.stdout.write(${JSON.stringify(envelope)});
 cp.spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),100)'],{stdio:['ignore','inherit','ignore']});
 fs.writeFileSync(${JSON.stringify(marker)},'started'); setInterval(()=>{},1000);
 `:`
 const fs=require('node:fs'); const cp=require('node:child_process');const envelope=${JSON.stringify(envelope)};
 fs.writeFileSync(${JSON.stringify(marker)},'started');const splitAt=envelope.length-8;process.stdout.write(envelope.slice(0,splitAt));
 const tail='const fs=require("node:fs"); setTimeout(()=>{process.stdout.write(process.argv[1]);fs.appendFileSync(process.env.T14_MARKER,"tail");},25);setTimeout(()=>process.exit(0),35);';
 cp.spawn(process.execPath,['-e',tail,envelope.slice(splitAt)],{stdio:['ignore','inherit','ignore'],env:{...process.env,T14_MARKER:${JSON.stringify(marker)}}});process.exit(0);
 `;
 writeFileSync(fake,source);process.env.CCLOOP_CLAUDE_COMMAND=JSON.stringify([process.execPath,fake]);
 const child=spawn(process.execPath,[join(owned,'scripts/claude-phase-runner.mjs')],{env:process.env,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b.toString();log('caller-stdout-chunk',{base64:b.toString('base64')});});child.stderr.on('data',b=>stderr+=b.toString());
 const done=new Promise<any>(resolve=>child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr})));
 child.stdin.end(JSON.stringify({phase:'execute',prompt:'run execute',attempt:1,runDir:f.runDir,worktreePath:f.repo,partialOutcomeRecoveryWindowMs:1000}));
 await poll(()=>existsSync(marker));if(mode==='runner-original')await sleep(10);log('caller-SIGTERM',{child:child.pid});child.kill('SIGTERM');
 const timeout=setTimeout(()=>child.kill('SIGKILL'),3000);const result=await done;clearTimeout(timeout);
 writeFileSync(join(root,'stdout.raw'),result.stdout);writeFileSync(join(root,'stderr.raw'),result.stderr);
 let decoded;try{decoded={parsed:JSON.parse(result.stdout)};}catch(error){decoded={decodeError:String(error)};}
 writeFileSync(join(root,'probe-result.json'),JSON.stringify({mode,fixture:f.dir,result,decoded},null,2)+'\n');console.log(JSON.stringify({mode,...result,...decoded}));
}
