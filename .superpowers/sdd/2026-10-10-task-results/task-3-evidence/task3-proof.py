import subprocess,sys,json,hashlib
from pathlib import Path
r=Path(__file__).parent;c=Path(sys.argv[1]);source=sys.argv[2]
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=c,text=True).strip()==source
cases=[]
def one(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
def block(s,start,end):
 a=s.index(start);b=s.index(end,a);return s[:a]+s[b:]
def add(name,file,transform,criterion,test='tests/control/taskResultCollector.test.ts'):cases.append((name,file,transform,criterion,test))
add('namespace','src/control/archive.ts',lambda s:one(s,',...TASK_RESULT_SOURCE_EXCLUSIONS',''),'ignores missing, special and changing','tests/control/taskResultIsolation.test.ts')
add('ancestor-filter','src/control/archive.ts',lambda s:one(s,"const containsExclusion=(dir:string)=>exclude.some(path=>path.startsWith(relative(root,dir)+'/'));","const containsExclusion=(_dir:string)=>false;"),'ignores missing, special and changing','tests/control/taskResultIsolation.test.ts')
add('snapshot','src/control/taskResultCollector.ts',lambda s:block(s,"                    if (manifest.stage === 'verification'","                    if (manifest.stage === 'execution'"),'immutable execution snapshot successors')
add('monotonic','src/control/taskResultCollector.ts',lambda s:one(one(one(s,'                validatePage(page, old);',''),'                    validatePage(page, current);',''),"                    if (current.revision !== old.revision || current.sourceRevision > page.revision)\n                        throw new Error('task-result-page-stale');\n                    validateCurrentFact(page, current);",''),'never admits a partial/corrupt page')
add('owner','src/control/taskResultCollector.ts',lambda s:block(s,'        deps.store.assertOwner();\n        const current','    };\n    const admitted'),'rejects late writes after owner fence')
add('lease','src/control/taskResultCollector.ts',lambda s:one(s,' || run.ownerToken !== owner.input.claim.ownerToken',''),'rejects late writes after lease fence')
add('registration','src/control/archive.ts',lambda s:one(s,'  deps.assertHeld?.();',''),'owner changes after publication admission')
add('flush','src/control/cleanup.ts',lambda s:one(s,'const assertTaskResultOwner=await flushTaskResults(store,runId);','const assertTaskResultOwner=()=>{};'),'flushes owned queued results before actual source deletion')
add('last-rm','src/control/cleanup.ts',lambda s:one(s,'assertTaskResultOwner();await rm','await rm'),'last source deletion fence')
add('core-wait','src/control/executionDriver.ts',lambda s:one(s,'  deps.taskResults?.schedule(runId);','  deps.taskResults?.schedule(runId);\n  await deps.taskResults?.flush(runId);'),'core usage and terminal settle independently')
add('concurrency','src/control/taskResultCollector.ts',lambda s:one(s,'while (active < 2 && queue.length)','while (active < 3 && queue.length)'),'permits at most two process-wide jobs')
add('per-run','src/control/taskResultCollector.ts',lambda s:one(s,'if (stopped || jobs.has(runId))','if (stopped)'),'permits at most two process-wide jobs')
add('handover','src/control/taskResultCollector.ts',lambda s:one(s,'void existing.collector.stop().catch(() => { });','return existing.collector;'),'observes the old RPC but lets the new assembly')
add('profile','src/control/profiles.ts',lambda s:one(s,'    ...(collectTaskResults?{collectTaskResults:(input,afterRevision)=>collectTaskResults(input,afterRevision)}:{}),',''),'retains evidence through the real frozen router')
add('hash','src/control/taskResultCollector.ts',lambda s:one(one(s," || createHash('sha256').update(bytes).digest('hex') !== ref.hash",''),' || saved.hash !== ref.hash',''),'never admits a partial/corrupt page')
add('membership','src/control/taskResultStore.ts',lambda s:one(s,' || ![manifestRef, ...taskResultManifestRefs(observation.manifest)].some(r => sameTaskResultRef(r, ref))',''),'retains manifest-owned hashes')
add('attempt-owner','src/control/taskResultStore.ts',lambda s:one(s,'o.manifest.attempt === attempt && ',''),'retains manifest-owned hashes')
add('started','src/control/taskResultProtocol.ts',lambda s:one(s,"return started.data.attempt === manifest.attempt ? 'in-progress' : 'unavailable';","return 'passed';"),'separates actual verifier start')
add('cache-identity','src/control/ccloopPort.ts',lambda s:one(s,"if(identity===unsupportedIdentity)throw new TaskResultUnsupportedError();","if(unsupportedIdentity!==null)throw new TaskResultUnsupportedError();"),'caches only old command refusal')
add('deadline-queue','src/control/taskResultCollector.ts',lambda s:one(s,'}, TASK_RESULT_FLUSH_TIMEOUT_MS);','}, TASK_RESULT_FLUSH_TIMEOUT_MS + 1);'),'flush deadline with available')
add('deadline-authority','src/control/taskResultCollector.ts',lambda s:one(s,"const failure = Promise.resolve().then(() => { const owner = deps.resolve(runId); return owner ? diagnostic(job, owner, new Error('task-result-flush-timeout')) : undefined; });","const owner=deps.resolve(runId); const failure=owner?diagnostic(job,owner,new Error('task-result-flush-timeout')):Promise.resolve();"),'flush deadline with unavailable')
add('incremental-staging','src/control/taskResultCollector.ts',lambda s:one(s,'const saved = await writeArtifact(deps.store, ref.artifactId, bytes, { assertHeld: () => valid(job, owner), admit: operation => admitted(job, owner, operation) });','const saved = ref;'),'stages one owned reference before the next read')
add('independent-fact','src/control/taskResultCollector.ts',lambda s:one(s,"                    saveTaskResultState(deps.store, job.runId, page.identity.groupId, { ...current, currentAttemptFact: { schema: 'orca-task-result-current-attempt-v1', identity: page.identity, revision: page.revision, currentAttempt: page.currentAttempt } });",''),'keeps validated source attempt two')
add('fact-freshness','src/control/taskResultCollector.ts',lambda s:one(one(s,'    validateCurrentFact(page, old);',''),' || page.currentAttempt < old.currentAttempt',''),'records same-index-revision attempt growth')
add('fact-lease','src/control/taskResultStore.ts',lambda s:one(s,"        if (envelope.claim.ownerToken !== run.ownerToken || envelope.claim.runId !== runId || envelope.claim.generation !== run.generation)\n            return null;",''),'checks incremental lease ownership')
add('dynamic-deps','src/control/executionDriver.ts',lambda s:one(s," const deps=new Proxy(options,{get(target,key){\n  if(key==='taskResults')return taskResults;\n  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;\n }});",' const deps={...options,taskResults};'),'repository the run cannot resolve','tests/control/driverRequirementClarify.test.ts')
start=int(sys.argv[3]) if len(sys.argv)>3 else 0
rows=json.loads((r/'task3-fault-map.json').read_text()) if start else []
for name,file,transform,criterion,test in cases[start:]:
 path=c/file;original=path.read_text();updated=transform(original);assert updated!=original
 assert not subprocess.check_output(['git','diff'],cwd=c);assert not subprocess.check_output(['git','diff','--cached'],cwd=c)
 path.write_text(updated);patch=subprocess.check_output(['git','diff'],cwd=c);(r/f'task3-mutant-{name}.patch').write_bytes(patch)
 argv=['./node_modules/.bin/vitest','run',test,'--maxWorkers=2','--no-cache','-t',criterion]
 cmd=[sys.executable,str(r/'task3-gate.py'),f'task3-mutant-{name}',*argv]
 try:
  rc=subprocess.call(cmd,cwd=c)
  log=(r/f'task3-mutant-{name}.log').read_text();row={'name':name,'file':file,'criterion':criterion,'source':source,'command':cmd,'rc':rc,'patchBytes':len(patch),'patchSHA256':hashlib.sha256(patch).hexdigest(),'rawLogSHA256':hashlib.sha256((r/f'task3-mutant-{name}.log').read_bytes()).hexdigest()}
  if rc==0:row['survived']=True
 finally:
  subprocess.check_call(['git','restore','--source='+source,'--worktree','--',file],cwd=c)
  restoration={k:len(subprocess.check_output(a,cwd=c)) for k,a in [('working',['git','diff']),('cached',['git','diff','--cached'])]}
  assert restoration=={'working':0,'cached':0};(r/f'task3-mutant-{name}.restored.json').write_text(json.dumps(restoration)+'\n')
 row['restore']=restoration;rows.append(row);(r/'task3-fault-map.json').write_text(json.dumps(rows,indent=2)+'\n');print('fault',name,'RC',rc,'restore',restoration,flush=True)
 if rc==0:raise SystemExit('SURVIVED '+name)
