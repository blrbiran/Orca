from pathlib import Path
import subprocess,sys,json,os
r=Path(__file__).parent;source=Path('/private/tmp/orca-results-ccloop-20261010');sha='adbc9a9bb8c0587d64c40fb45b7680609a5f0e8f';clone=r/'result4-fix1-ccloop-proof-clone'
assert not clone.exists()
args=['/usr/bin/git','-c','core.hooksPath=/private/tmp/opr26/safe-ccloop-hooks','clone','--local','--no-hardlinks',str(source),str(clone)]
assert subprocess.call([sys.executable,str(r/'run.py'),'result4-fix1-ccloop-clone-command',*args])==0
def git(*argv):return subprocess.check_output(['/usr/bin/git','-c','core.hooksPath=/private/tmp/opr26/safe-ccloop-hooks',*argv],cwd=clone)
assert git('rev-parse','HEAD').decode().strip()==sha;assert git('diff')==b'' and git('diff','--cached')==b''
os.symlink(source/'node_modules',clone/'node_modules')
(r/'result4-fix1-ccloop-clone-assertion.json').write_text(json.dumps({'sourceCommit':sha,'cloneCommit':git('rev-parse','HEAD').decode().strip(),'cwd':str(clone),'argv':args,'workingDiffBytes':0,'cachedDiffBytes':0},indent=2)+'\n')
p=clone/'src/controller/runLoop.ts';text=p.read_text();old='await captureResult(attempt, worktreePath, completedExecution, undefined, false, true);';assert text.count(old)==1;p.write_text(text.replace(old,'/* fault: suppress actual pre-verifier handoff observation */'))
name='result4-fix1-mutant-ccloop-not-run-omitted';patch=git('diff');assert patch;(r/(name+'.full.patch')).write_bytes(patch)
try:
 rc=subprocess.call([sys.executable,str(r/'result4-fix1-gate.py'),name,'./node_modules/.bin/vitest','run','tests/controller/taskResultCapture.test.ts','--minWorkers=1','--maxWorkers=2','--no-cache','-t','handoff after execute'],cwd=clone)
 log=(r/(name+'.log')).read_text();red=rc!=0 and 'handoff after execute' in log and 'AssertionError' in log and 'Failed Suites' not in log
finally:
 subprocess.check_call(['/usr/bin/git','-c','core.hooksPath=/private/tmp/opr26/safe-ccloop-hooks','reset','--hard',sha],cwd=clone,stdout=subprocess.DEVNULL);w=git('diff');c=git('diff','--cached');assert w==b'' and c==b''
 record={'sourceCommit':sha,'cwd':str(clone),'patchBytes':len(patch),'rc':rc,'nativeBusinessRed':red,'status':'killed' if red else 'survived-or-setup-failed','restoredWorkingDiffBytes':len(w),'restoredCachedDiffBytes':len(c)}
 (r/(name+'.restore.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
assert red,'survivor/setup failure is not a kill'
