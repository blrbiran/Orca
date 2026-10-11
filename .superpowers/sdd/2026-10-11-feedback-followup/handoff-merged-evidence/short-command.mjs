import {realpathSync,mkdirSync,lstatSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const argv=process.argv.slice(2);if(argv.length===0)throw Error('command-required');console.log(JSON.stringify({actualArgv:argv}));
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
 const result=spawnSync(argv[0],argv.slice(1),{cwd:process.cwd(),env:{...process.env,TMPDIR:temp},stdio:'inherit'});
 if(result.error)console.error(result.error);process.exitCode=result.status??1;
}finally{rmSync(temp,{recursive:true,force:true});}
