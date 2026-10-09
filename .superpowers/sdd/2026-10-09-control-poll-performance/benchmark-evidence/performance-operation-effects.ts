import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
async function main(){
 const clone=process.argv[2],output=process.argv[3];
 const benchmark=await import(pathToFileURL(join(clone,'tests/bench/controlPollPerformance.ts')).href);
 const fixture=await import(pathToFileURL(join(clone,'tests/control/fixtures/controlPollPerformance.ts')).href);
 const dispatch=await import(pathToFileURL(join(clone,'src/control/webDispatch.ts')).href);
 const initial=JSON.parse(await readFile('/private/tmp/od9/performance-fixture/initial-database.json','utf8'));
 const f=await fixture.openExistingControlPollFixture(1791518400000);
 const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const cases=[];
 try {
  for(const w of benchmark.makeWorkloads(f).filter((w:any)=>['replenish','archived-only-pump','mixed-pump'].includes(w.name))){
   benchmark.restoreDatabase(f.store,initial);assert.equal(sha(benchmark.captureDatabase(f.store)),sha(initial));w.prepare();
   const result=await w.run(dispatch.createWebWakeHandlers(f.wakeDeps));w.validate(result);
   const completeState=benchmark.captureDatabase(f.store),changedRows=[];
   for(const table of completeState){const original=initial.find((t:any)=>t.name===table.name);const byRowid=new Map(original.rows.map((r:any)=>[r.__rowid,r]));const seen=new Set();
    for(const row of table.rows){seen.add(row.__rowid);const previous=byRowid.get(row.__rowid);if(JSON.stringify(row)!==JSON.stringify(previous))changedRows.push({table:table.name,before:previous??null,after:row});}
    for(const row of original.rows)if(!seen.has(row.__rowid))changedRows.push({table:table.name,before:row,after:null});
   }
   cases.push({name:w.name,scope:w.scope,output:benchmark.normalizeOutput(result,f.canonicalRunIds),completeStateDigest:sha(completeState),changedRows});
  }
  benchmark.restoreDatabase(f.store,initial);
  const commit=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:clone,encoding:'utf8'}).trim();
  const report={command:[process.execPath,...process.argv.slice(1)],clone,commit,initialDigest:sha(initial),cases};
  await writeFile(output,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({commit,initialDigest:report.initialDigest,cases:cases.map(r=>({name:r.name,completeStateDigest:r.completeStateDigest,changedRows:r.changedRows.length}))}));
 }finally{await f.dispose();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
