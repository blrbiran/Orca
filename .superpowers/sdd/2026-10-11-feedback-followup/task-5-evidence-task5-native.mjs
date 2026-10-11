import {writeFileSync,mkdtempSync,chmodSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync('/private/tmp/t5v.');chmodSync(root,0o700);process.env.TMPDIR=root;
const table=root+'/agents.json';
writeFileSync(table,JSON.stringify({schema:'ccloop-agents-table-v1',installations:{codex:{kind:'codex',command:[process.execPath,'/private/tmp/ccloop-feedback-followup-20261011/tests/fixtures/fake-codex.mjs','integration',root+'/marker'],version:'9.9.9-fake',configDir:null,timeoutMs:15000,killGraceMs:100,budgetMode:'soft',sandbox:'workspace-write'}}}),{mode:0o600});
process.env.ORCA_CCLOOP_BIN='/private/tmp/ccloop-feedback-followup-20261011/dist/cli.js';process.env.ORCA_AGENTS_TABLE=table;
console.log(JSON.stringify({TMPDIR:root,ORCA_CCLOOP_BIN:process.env.ORCA_CCLOOP_BIN,ORCA_AGENTS_TABLE:table}));
const result=spawnSync(process.execPath,['scripts/verify-control-protocol.mjs'],{stdio:'inherit',env:process.env});
if(result.error)throw result.error;process.exit(result.status??1);
