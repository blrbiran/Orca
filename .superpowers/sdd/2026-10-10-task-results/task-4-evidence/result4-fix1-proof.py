import sys,json,subprocess,os,re
from pathlib import Path
r=Path(__file__).parent;source=Path(sys.argv[1]);sha=sys.argv[2];clone=r/'result4-fix1-proof-clone'
def git(*args,cwd=clone):return subprocess.check_output(['/usr/bin/git',*args],cwd=cwd)
def run(name,*argv,cwd=clone):return subprocess.call([sys.executable,str(r/'result4-fix1-gate.py'),name,*argv],cwd=cwd)
assert not clone.exists(), 'proof clone already exists; use a distinct proof directory'
rc=subprocess.call([sys.executable,str(r/'run.py'),'result4-fix1-proof-clone-command','/usr/bin/git','clone','--local','--no-hardlinks',str(source),str(clone)])
assert rc==0
assert git('rev-parse','HEAD').decode().strip()==sha, 'clone HEAD differs from frozen source'
assert git('diff')==b'' and git('diff','--cached')==b''
os.symlink(source/'node_modules',clone/'node_modules')
(r/'result4-fix1-proof-clone-assertion.json').write_text(json.dumps({'cwd':str(clone),'source':str(source),'sourceCommit':sha,'cloneCommit':git('rev-parse','HEAD').decode().strip(),'argv':['/usr/bin/git','clone','--local','--no-hardlinks',str(source),str(clone)],'workingDiffBytes':0,'cachedDiffBytes':0},indent=2)+'\n')
outputs='src/panel/taskResultOutputs.ts';models='src/panel/taskResults.ts';api='src/panel/controlApi.ts'
def replace(path,old,new):
 p=clone/path;s=p.read_text();assert s.count(old)==1,(path,old,s.count(old));p.write_text(s.replace(old,new))
def fault_cross():replace(outputs,'sha256Canonical({ runId, attempt, sourceOutputId })','sha256Canonical({ attempt, sourceOutputId })')
def fault_hash():replace(outputs,'if (!observation)\n        throw unavailable();',"if (!observation) { const registered=store.db.prepare('SELECT id,hash FROM artifacts WHERE id=? OR hash=?').get(outputId,outputId);if(!registered)throw unavailable();const bytes=await readSavedResultArtifact(store,{artifactId:String(registered.id),hash:String(registered.hash)},MAX_TASK_RESULT_FILE_BYTES);return {view:{schema:'orca-result-output-v1',runId,groupId:authority.group.summary.groupId,attempt:1,outputId,path:'saved',status:'available',byteLength:bytes.length,content:bytes.toString('utf8'),downloadUrl:null},bytes};}")
def fault_html():replace(api,'}else res.json(view);',"}else res.type('html').send(view.content);")
def fault_stale():
 p=clone/models;s=p.read_text();s,n=re.subn(r'const sourceAttempt = [^;]+;',"const sourceAttempt = fact?.currentAttempt ?? null;",s);assert n==1;p.write_text(s)
def fault_bound():replace(models,'fact.currentAttempt < bounds.attempt || fact.revision < bounds.revision','fact.currentAttempt < bounds.attempt && fact.revision < bounds.revision')
def fault_independent():replace(models,'const sourceFresh = fact !== null && !staleHint','const sourceFresh = fact !== null && a.state !== null && !staleHint')
def fault_upgrade():replace(models,"if (verification === 'in-progress'","if (a.observations.some(o=>o.verification==='passed')) verification='passed';\n        if (verification === 'in-progress'")
def fault_partial():replace(models,"value.completionStatus === 'partial' && (value.failureType === 'timeout' || value.partialOrigin === 'runner' || value.changedFiles.length === 0)","value.completionStatus === 'partial'")
def fault_core_guess():replace(models,"if (verifierBypassed &&","if (a.body.progress?.status==='verifying') verification='in-progress';\n        if (verifierBypassed &&")
def fault_snapshot():replace(models,'snapshotRevision = m.revision;','snapshotRevision = latest.manifest.revision;')
faults=[
 ('cross-owner',fault_cross,'tests/panel/taskResultOutputs.test.ts','cross-owner, hash-only'),
 ('hash-only',fault_hash,'tests/panel/taskResultOutputs.test.ts','cross-owner, hash-only'),
 ('unsafe-html',fault_html,'tests/panel/taskResultApi.test.ts','serves inert HTML'),
 ('stale-current',fault_stale,'tests/panel/taskResults.test.ts','transport failure makes'),
 ('stale-bound',fault_bound,'tests/panel/taskResults.test.ts','fix1 rejects older same-owner hint'),
 ('independent-fact-loss',fault_independent,'tests/panel/taskResults.test.ts','fix1 malformed capture bounds'),
 ('prior-upgrade',fault_upgrade,'tests/panel/taskResults.test.ts','isolates rejected attempt'),
 ('partial-guess',fault_partial,'tests/panel/taskResults.test.ts','error partial with changed'),
 ('core-verifier-guess',fault_core_guess,'tests/panel/taskResults.test.ts','actual started evidence'),
 ('snapshot-upgrade',fault_snapshot,'tests/panel/taskResults.test.ts','isolates rejected attempt'),
]
results=[]
for label,mutate,file,criterion in faults:
 name='result4-fix1-mutant-'+label;record={'name':name,'criterion':criterion,'sourceCommit':sha}
 try:
  mutate();patch=git('diff');assert patch,'empty mutant patch';(r/(name+'.full.patch')).write_bytes(patch);record['patchBytes']=len(patch)
  rc=run(name,'./node_modules/.bin/vitest','run',file,'--maxWorkers=2','--no-cache','-t',criterion);record['rc']=rc
  log=(r/(name+'.log')).read_text();record['nativeBusinessRed']=rc!=0 and criterion in log and 'AssertionError' in log and 'Failed Suites' not in log
  record['status']='killed' if record['nativeBusinessRed'] else 'survived-or-setup-failed'
 except BaseException as e:record.update(status='setup-failed',error=str(e))
 finally:
  subprocess.check_call(['/usr/bin/git','reset','--hard',sha],cwd=clone,stdout=subprocess.DEVNULL)
  w=git('diff');c=git('diff','--cached');record['restoredWorkingDiffBytes']=len(w);record['restoredCachedDiffBytes']=len(c);assert w==b'' and c==b''
  (r/(name+'.restore.json')).write_text(json.dumps(record,indent=2)+'\n');results.append(record);print(json.dumps(record),flush=True)
(r/'result4-fix1-proof-summary.json').write_text(json.dumps({'sourceCommit':sha,'clone':str(clone),'mutants':results},indent=2)+'\n')
assert all(x['status']=='killed' for x in results),'survivor/setup failure retained, not counted as kill'
