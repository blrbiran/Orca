import fs from 'node:fs';import path from 'node:path';
const root=fs.mkdtempSync('/private/tmp/t5-mode-proof-');fs.writeFileSync(path.join(root,'file'),'x');const rows=[];
for(const p of [root,path.join(root,'file')]){const before=fs.statSync(p);fs.chmodSync(p,0o2755);const inherited=fs.statSync(p);fs.chownSync(p,process.getuid(),process.getgid());fs.chmodSync(p,0o2755);const owned=fs.statSync(p);rows.push({path:p,before:{gid:before.gid,mode:before.mode&0o7777},inherited:{gid:inherited.gid,mode:inherited.mode&0o7777},owned:{gid:owned.gid,mode:owned.mode&0o7777}});if((owned.mode&0o7777)!==0o2755)throw new Error('own-group setgid did not persist');}
console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),rows}));
