import subprocess,pathlib,json,hashlib
repo=pathlib.Path('/private/tmp/ccloop-task5-fix1-mutations-20261011');runner='/private/tmp/orca-followup-run.py'
ledger=pathlib.Path('/private/tmp/orca-feedback-followup-20261011/.superpowers/sdd/2026-10-11-feedback-followup')
for ready in ['t5-fix1-clone-build','t5-fix1-clone-baseline']:
 meta=json.loads((pathlib.Path('/private/tmp/orca-followup-runs')/ready/'result.json').read_text());assert meta['rc']==0 and meta['sourceTreeSHA256']=='84a998e8db7fa95eeb257653bdfc9bba6ed36f1f3541272aafda4aa2cd52c5e5'
assert (repo/'node_modules/vitest/vitest.mjs').is_file()
mutations=[
 ('base-pin','src/controller/runLoop.ts',[( ', initializedBase ?? undefined)).worktreePath;', ')).worktreePath;',1)],'tests/control/savedResultEvidence.test.ts','movement before'),
 ('base-reread','src/controller/runLoop.ts',[( 'let resolvedSourceBase = options?.firstWorkspaceInput ? null : initializedBase;', 'let resolvedSourceBase = options?.firstWorkspaceInput ? null : (await execFileAsync("/usr/bin/git", ["rev-parse","HEAD"], {cwd:contract.context.repoPath})).stdout.trim();',1)],'tests/control/savedResultEvidence.test.ts','movement after'),
 ('retry-origin','src/controller/runLoop.ts',[( '    let initializedBase: string | null = null;\n','',1),('  let observedTokens = 0;','  let observedTokens = 0;\n  let initializedBase: string | null = null;',1),('if (!(attempt === 1 && options?.firstWorkspaceInput) && options?.executionFormatCapture) {','if (!(attempt === 1 && options?.firstWorkspaceInput) && options?.executionFormatCapture && initializedBase === null) {',1)],'tests/control/savedResultEvidence.test.ts','ordinary retry choice'),
 ('immutable-base','src/controller/executionFormatFailure.ts',[( '  if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(acceptedBase))return null;\n','',1)],'tests/controller/executionBase.test.ts',None),
 ('base-ancestry','src/controller/executionFormatFailure.ts',[( '    await git(worktreePath,"--no-replace-objects","merge-base","--is-ancestor",acceptedBase,restoredHead);\n','',1)],'tests/controller/executionBase.test.ts',None),
 ('raw-ancestry','src/controller/executionFormatFailure.ts',[( 'git(worktreePath,"--no-replace-objects","merge-base"','git(worktreePath,"merge-base"',1)],'tests/controller/executionBase.test.ts',None),
 ('special-mode','src/controller/executionFormatFailure.ts',[( '  if ((mode & 0o7000) !== 0) throw new Error("saved-result-mode-unsupported");\n','',1)],'tests/control/savedResultEvidence.test.ts','fix I2 refuses unsupported'),
 ('entry-stability-mode','src/controller/executionFormatFailure.ts',[( '  const walk=async(directory:string)=>{','  let modePass=0;\n  const walk=async(directory:string)=>{\n    if(directory==="")modePass++;',1),('mode=supportedMode(stat.mode);','mode=modePass>1?stat.mode&0o777:supportedMode(stat.mode);',1)],'tests/control/savedResultEvidence.test.ts','special bits introduced during'),
 ('root-stability-mode','src/controller/executionFormatFailure.ts',[( 'supportedMode((await lstat(tree)).mode)!==rootMode','((await lstat(tree)).mode&0o777)!==rootMode',2)],'tests/control/savedResultEvidence.test.ts','root special bits introduced between'),
]
records=[]
for name,file,edits,test,pattern in mutations:
 assert not subprocess.check_output(['/usr/bin/git','diff'],cwd=repo);assert not subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=repo)
 p=repo/file;original=p.read_bytes();assert len(original)>0;s=original.decode()
 for old,new,count in edits:
  assert s.count(old)==count,(name,s.count(old),count);s=s.replace(old,new)
 p.write_text(s);logroot=f'/private/tmp/orca-followup-runs/t5-fix1-mutant-{name}'
 selector='' if pattern is None else " -t '"+pattern+"'"
 cmd=['python3',runner,str(repo),'t5-fix1-mutant-'+name,'/bin/zsh','-c',f'task_tmp=$(mktemp -d /private/tmp/t5fm.XXXXXX); chmod 700 "$task_tmp"; export TMPDIR="$task_tmp"; exec node {repo}/node_modules/vitest/vitest.mjs run {test}{selector} --reporter=default --reporter=json --outputFile={logroot}/tests.json']
 try:rc=subprocess.run(cmd).returncode
 finally:p.write_bytes(original)
 diffs=[len(subprocess.check_output(['/usr/bin/git',*args],cwd=repo)) for args in [['diff'],['diff','--cached']]];assert diffs==[0,0]
 result=json.loads(pathlib.Path(logroot+'/tests.json').read_text());failures=[{'name':t['fullName'],'messages':t['failureMessages']} for f in result['testResults'] for t in f['assertionResults'] if t['status']=='failed'];assert rc!=0 and failures
 record={'name':name,'file':file,'edits':edits,'command':cmd,'rc':rc,'failures':failures,'skippedUnselected':result['numPendingTests'],'restoredDiffBytes':diffs,'log':logroot+'/output.log'};records.append(record);print(json.dumps({'name':name,'rc':rc,'failedNames':[f['name'] for f in failures],'skippedUnselected':result['numPendingTests'],'restoredDiffBytes':diffs}),flush=True)
(ledger/'task-5-fix1-mutations.json').write_text(json.dumps(records,indent=2)+'\n')
