import subprocess,sys,json,hashlib
from pathlib import Path
r=Path(__file__).parent;name=sys.argv[1];cwd=Path.cwd()
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
paths=['src','tests','web/src','scripts','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','vitest.config.ts']
working=subprocess.check_output(['git','diff','--',*paths]);cached=subprocess.check_output(['git','diff','--cached','--',*paths])
record={'cwd':str(cwd),'sourceCommit':sha,'workingSourceDiffBytes':len(working),'cachedSourceDiffBytes':len(cached),'argv':sys.argv[2:]}
if name.startswith('task3-mutant-'):
 (r/(name+'.patch')).write_bytes(working)
 (r/(name+'.cached.patch')).write_bytes(cached)
(r/(name+'.source.json')).write_text(json.dumps(record,indent=2)+'\n')
print(name,'cwd='+str(cwd),'source='+sha,'sourceDiff='+str(len(working))+'/'+str(len(cached)),flush=True)
if (working or cached) and not name.startswith('task3-mutant-'):raise SystemExit('source is not frozen')
sys.exit(subprocess.call([sys.executable,str(r/'run.py'),*sys.argv[1:]]))
