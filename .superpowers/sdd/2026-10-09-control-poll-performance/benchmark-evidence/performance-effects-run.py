from pathlib import Path
import json,subprocess,sys
root=Path('/private/tmp/od9');env=json.loads((root/'env.json').read_text());results=[]
for side in ['before','after']:
 output=root/'logs'/('perf-task3-'+side+'-complete-db-effects.json');log=root/'logs'/('perf-task3-'+side+'-complete-db-effects.log');cmd=['npx','tsx',str(root/'performance-operation-effects.ts'),str(root/('performance-'+side)),str(output)]
 with log.open('w') as f:r=subprocess.run(cmd,cwd=root/('performance-'+side),env=env,stdout=f,stderr=subprocess.STDOUT)
 (log.with_suffix('.rc')).write_text(str(r.returncode)+'\n');results.append({'side':side,'command':cmd,'rc':r.returncode});print(side,'RC',r.returncode,flush=True)
 if r.returncode:sys.exit(r.returncode)
before=json.loads((root/'logs'/'perf-task3-before-complete-db-effects.json').read_text());after=json.loads((root/'logs'/'perf-task3-after-complete-db-effects.json').read_text());assert before['initialDigest']==after['initialDigest'];assert before['cases']==after['cases']
proof={'initialDigest':before['initialDigest'],'products':{'before':before['commit'],'after':after['commit']},'cases':[{key:case[key] for key in ['name','completeStateDigest','scope']}|{'changedRowCount':len(case['changedRows'])} for case in after['cases']],'commands':results,'everyFullDatabaseRowAndRowidAndSqliteSequenceEffectEqual':True};(root/'logs'/'perf-task3-complete-db-effects-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof),flush=True)
