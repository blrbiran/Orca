import subprocess,sys,json
from pathlib import Path
r=Path(__file__).parent; name=sys.argv[1]; cwd=Path.cwd()
sha=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],text=True).strip()
paths=['src','tests','web/src','scripts','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','vitest.config.ts']
w=subprocess.check_output(['/usr/bin/git','diff','--',*paths]); c=subprocess.check_output(['/usr/bin/git','diff','--cached','--',*paths])
u=subprocess.check_output(['/usr/bin/git','ls-files','--others','--exclude-standard','--',*paths],text=True).splitlines()
record={'cwd':str(cwd),'sourceCommit':sha,'workingSourceDiffBytes':len(w),'cachedSourceDiffBytes':len(c),'untrackedSource':u,'argv':sys.argv[2:]}
(r/(name+'.source.json')).write_text(json.dumps(record,indent=2)+'\n');(r/(name+'.patch')).write_bytes(w);(r/(name+'.cached.patch')).write_bytes(c)
for p in u:
 target=r/(name+'.untracked')/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(Path(p).read_bytes())
print(name,sha,len(w),len(c),len(u),flush=True)
if name.startswith(('result4-final-','result4-fix1-final-','result4-fix2-final-','result4-fix3-final-')) and (w or c or u):raise SystemExit('source not frozen')
sys.exit(subprocess.call([sys.executable,str(r/'run.py'),*sys.argv[1:]]))
