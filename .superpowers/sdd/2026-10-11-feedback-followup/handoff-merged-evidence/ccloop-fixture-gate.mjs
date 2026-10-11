import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const table=join(process.env.TMPDIR,'agents.json');
writeFileSync(table,JSON.stringify({schema:'ccloop-agents-table-v1',installations:{codex:{kind:'codex',command:[process.execPath,resolve('tests/fixtures/fake-codex.mjs'),'integration',join(process.env.TMPDIR,'fake-marker')],version:'9.9.9-fake',configDir:null,timeoutMs:15000,killGraceMs:100,budgetMode:'soft',sandbox:'workspace-write'}}}),{mode:0o600});
const [command,...args]=process.argv.slice(2);const r=spawnSync(command,args,{stdio:'inherit',env:{...process.env,ORCA_CCLOOP_BIN:resolve('dist/cli.js'),ORCA_AGENTS_TABLE:table}});if(r.error)throw r.error;process.exit(r.status??1);
