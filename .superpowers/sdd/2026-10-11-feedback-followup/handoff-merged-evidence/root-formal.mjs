import {realpathSync,mkdirSync,lstatSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const binary=process.env.ORCA_CCLOOP_BIN,table=process.env.ORCA_AGENTS_TABLE;
if(!binary||!table)throw Error('formal-control-binary-table-missing');
const paths={binary:realpathSync(binary),table:realpathSync(table)};
console.log(JSON.stringify({formalControlPreflight:{binary,table,realpaths:paths,rc:0}}));
const argv=[join(process.cwd(),'node_modules/vitest/vitest.mjs'),'run','--maxWorkers=4','--reporter=default','--reporter=json',`--outputFile.json=${process.argv[2]}`];
console.log(JSON.stringify({combinedRootControlArgv:[process.execPath,...argv],scope:'all root tests, including every tests/control file without name filters',ORCA_CONTROL_VERIFY:'1'}));
let temp;
for(let i=0;i<4096;i++){
 const candidate='/private/tmp/g'+randomBytes(2).toString('hex').slice(0,2);
 try{mkdirSync(candidate,{mode:0o700});temp=candidate;break;}catch(error){if(error.code!=='EEXIST')throw error;}
}
if(!temp)throw Error('owned-short-tmpdir-exhausted');
const stat=lstatSync(temp);
if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o7777)!==0o700||realpathSync(temp)!==temp)throw Error('owned-short-tmpdir-invalid');
console.log(JSON.stringify({ownedShortTMPDIR:temp,bytes:Buffer.byteLength(temp),mode:(stat.mode&0o7777).toString(8),uid:stat.uid}));
try{
 const result=spawnSync(process.execPath,argv,{cwd:process.cwd(),env:{...process.env,TMPDIR:temp,ORCA_CONTROL_VERIFY:'1'},stdio:'inherit'});
 if(result.error)console.error(result.error);process.exitCode=result.status??1;
}finally{rmSync(temp,{recursive:true,force:true});}
