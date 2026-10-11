import {spawnSync,execFileSync} from 'node:child_process';
import {statSync,realpathSync,mkdtempSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const fail=reason=>{console.error(`saved-result-integration-unavailable:${reason}`);process.exit(1);};
if(!['darwin','linux'].includes(process.platform))fail('platform');
const root=fileURLToPath(new URL('../',import.meta.url));
const configured=['ORCA_SAVED_RESULT_OLD_ORCA_ROOT','ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT','ORCA_SAVED_RESULT_CCLOOP_BIN'];
for(const key of configured){const path=process.env[key];try{if(!path||!isAbsolute(path)||realpathSync(path)!==path)fail(key);}catch{fail(key);}}
const oldOrca=process.env.ORCA_SAVED_RESULT_OLD_ORCA_ROOT,oldCcloop=process.env.ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT,paired=process.env.ORCA_SAVED_RESULT_CCLOOP_BIN;
for(const [path,commit] of [[oldOrca,'c2a1f4220006ca22b620bd81f390a728e5d07b8c'],[oldCcloop,'5b0adea413b885a1151259d5eb88d21eedcc2ce0']]){
 try{if(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8'}).trim()!==commit)fail('old-producer-commit');execFileSync('/usr/bin/git',['diff','--exit-code','HEAD'],{cwd:path,stdio:'pipe'});}catch{fail('old-producer-source');}
}
for(const path of [join(oldOrca,'dist/control/webService.js'),join(oldCcloop,'dist/cli.js'),paired]){
 try{if(!statSync(path).isFile())fail('built-producer');}catch{fail('built-producer');}
}
try{const result=JSON.parse(execFileSync(paired,['control','features','--agents',process.env.ORCA_AGENTS_TABLE],{input:'{}',encoding:'utf8'}));if(result.protocol!==1||result.savedResultRecovery!=='v1')fail('paired-features');}catch{fail('paired-features');}
// Produce an actual immutable schema11 reader from existing local Git objects. No fetch/install.
const commit='f00bfdb797ee3f5de130585557fdf77dc421d535',reader=mkdtempSync('/private/tmp/t7-s11-');
try{
 execFileSync('/usr/bin/git',['cat-file','-e',`${commit}^{commit}`],{cwd:root,stdio:'pipe'});
 execFileSync('/usr/bin/git',['clone','--no-hardlinks','--no-checkout',root,reader],{stdio:'pipe'});
 execFileSync('/usr/bin/git',['checkout','--detach',commit],{cwd:reader,stdio:'pipe'});
 symlinkSync(realpathSync(join(root,'node_modules')),join(reader,'node_modules'),'dir');
 const argv=[join(reader,'node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'];
 const build=spawnSync(process.execPath,argv,{cwd:reader,stdio:'inherit'});
 if(build.status!==0||build.error)throw Error('saved-result-integration-unavailable:schema11-reader-build');
 execFileSync('/usr/bin/git',['diff','--exit-code','HEAD'],{cwd:reader,stdio:'pipe'});
 console.log(JSON.stringify({schema11Reader:reader,commit,buildArgv:[process.execPath,...argv],rc:build.status,trackedDiff:'clean',storeSHA256:createHash('sha256').update(readFileSync(join(reader,'dist/control/store.js'))).digest('hex')}));
 const result=spawnSync(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run','tests/control/savedResultRecovery.paired.test.ts','--maxWorkers=1'],{cwd:root,stdio:'inherit',env:{...process.env,ORCA_SAVED_RESULT_VERIFY:'1',ORCA_SAVED_RESULT_SCHEMA11_ROOT:reader}});
 if(result.error)console.error(result.error);process.exitCode=result.status??1;
}catch(error){console.error(String(error));process.exitCode=1;console.error('saved-result-integration-unavailable:schema11-reader');}
finally{rmSync(reader,{recursive:true,force:true});}
