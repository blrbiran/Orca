import {savedRecoveryFixture} from '/private/tmp/ccloop-feedback-followup-20261011/tests/control/savedRecoveryFixture.ts';
import {readSavedResultEligibility,readSavedResultSourceEligibility} from '/private/tmp/ccloop-feedback-followup-20261011/src/control/savedResultRecovery.ts';
import {runLoop} from '/private/tmp/ccloop-feedback-followup-20261011/src/controller/runLoop.ts';
import {verified} from '/private/tmp/ccloop-feedback-followup-20261011/tests/control/taskResultFixture.ts';
import {chmod,readFile,writeFile,rm,mkdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalJson} from '/private/tmp/ccloop-feedback-followup-20261011/src/control/protocol.ts';
import {createHash} from 'node:crypto';
const f=await savedRecoveryFixture();
try {
 console.log('baseline eligibility',await readSavedResultEligibility(f.input));
 await chmod(f.input.savedResultRecovery!.packagePath,0o777);
 console.log('0777 execution-package eligibility',await readSavedResultEligibility(f.input));
 await chmod(f.input.savedResultRecovery!.packagePath,0o700);
 const probe=join(f.root,'public-source-probe');await mkdir(probe,{mode:0o777});await chmod(probe,0o777);
 const {admission,...rest}=f.manifest;const manifest={...rest,schema:'ccloop-saved-result-source-package-v1'};
 for(const e of manifest.artifacts)await cp(join(f.input.savedResultRecovery!.packagePath,e.file),join(probe,e.file));
 const b=Buffer.from(canonicalJson(manifest));await writeFile(join(probe,'package.json'),b,{mode:0o600});
 console.log('0777 source-package eligibility',await readSavedResultSourceEligibility({source:f.source,sourceAttempt:1,packagePath:probe,packageHash:createHash('sha256').update(b).digest('hex')}));
 const phaseAbort=new AbortController();const observations:any[]=[];let checks=0,plan=0,execute=0;
 const state=await runLoop(f.input.work.contract,f.runDir,{plan:async()=>{plan++;throw Error('plan replay');},execute:async()=>{execute++;throw Error('execute replay');},verify:async c=>{checks++;await writeFile(join(c.worktreePath,'answer.txt'),'modified during handoff');phaseAbort.abort();return {...verified,tokenUsage:7};}},{savedResultRecovery:f.input,phaseSignal:phaseAbort.signal,onPhaseSettled:async o=>{observations.push(o);}});
 console.log('mutated-then-handoff result',JSON.stringify({state,observations,plan,execute,verifier:checks,candidateBytes:await readFile(join(f.runDir,'worktrees/attempt-1/answer.txt'),'utf8').catch(()=>'(cleaned)')}));
}finally{await rm(f.root,{recursive:true,force:true});}
