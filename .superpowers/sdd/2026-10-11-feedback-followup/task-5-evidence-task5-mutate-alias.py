import subprocess,pathlib,json,hashlib,sys
repo=pathlib.Path('/private/tmp/ccloop-task5-mutations-20261011')
runner='/private/tmp/orca-followup-run.py'
ledger=pathlib.Path('/private/tmp/orca-feedback-followup-20261011/.superpowers/sdd/2026-10-11-feedback-followup')
mutations=[
 ('alias-pair','src/control/savedResultEvidence.ts','aliases.find(alias=>same(alias.source,ref))','aliases.find(alias=>alias.source.hash===ref.hash)', 'tests/control/savedResultEvidence.test.ts'),
 ('actual-config','src/controller/executionFormatFailure.ts','||canonicalHash(config)!==canonicalHash(input.actualConfig)','', 'tests/control/savedResultEvidence.test.ts'),
 ('actual-contract','src/controller/executionFormatFailure.ts','canonicalHash(actual)!==canonicalHash(input.runtimeContract)||','', 'tests/control/savedResultEvidence.test.ts'),
 ('wrapping','src/runtime/codex/protocol.ts','const semantic = strictExecution && executeEnvelope.safeParse(node).success ? node.result : node;','const semantic = node;','tests/runtime/executionNormalizer.test.ts'),
 ('ambiguity','src/runtime/codex/protocol.ts','shaped.size === 1 && counts.valid === 1','shaped.size >= 1 && counts.valid === 1','tests/runtime/executionNormalizer.test.ts'),
 ('usage','src/controller/runLoop.ts',',modelUsage:error.formatFailure.modelUsage','','tests/control/savedResultEvidence.test.ts'),
 ('identity','src/control/savedResultEvidence.ts','canonicalHash(c.identity)!==canonicalHash(identity)||','', 'tests/control/savedResultEvidence.test.ts'),
 ('capture-before-cleanup','src/controller/runLoop.ts','          await heartbeat.runExclusive(() => captureExecutionFormatFailure({input:options.taskResultInput!,runDir,worktreePath:worktreePath!,attempt,attemptStartHead:attemptStartHead!,resolvedBase:resolvedSourceBase!,runtimeContract:contract,actualConfig:options.executionFormatCapture!.config,failure:error.formatFailure!,verifierEntered,assertHeld:()=>heartbeat.assertHeld()}));','', 'tests/control/savedResultEvidence.test.ts'),
 ('nested-hash','src/control/savedResultEvidence.ts','  if(taskResultDigest(bytes)!==ref.hash)throw new ControlProtocolError("control-saved-result-hash-mismatch");','', 'tests/control/savedResultEvidence.test.ts'),
 ('v3-leak','src/control/collect.ts','    events,\n    candidate:', '    events, capsule: {schema:"ccloop-execution-format-failure-v1"},\n    candidate:', 'tests/control/savedResultEvidence.test.ts'),
]
records=[]
for name,file,old,new,test in mutations:
 p=repo/file;original=p.read_bytes();s=original.decode();assert s.count(old)==1,(name,s.count(old));p.write_text(s.replace(old,new))
 logroot=f'/private/tmp/orca-followup-runs/t5-final-mutation-{name}'
 cmd=['python3',runner,str(repo),'t5-final-mutation-'+name,'/bin/zsh','-c',f'task_tmp=$(mktemp -d /private/tmp/t5x.XXXXXX); chmod 700 "$task_tmp"; export TMPDIR="$task_tmp"; exec node {repo}/node_modules/vitest/vitest.mjs run {test} --reporter=default --reporter=json --outputFile={logroot}/tests.json']
 try: rc=subprocess.run(cmd).returncode
 finally:p.write_bytes(original)
 unstaged=subprocess.check_output(['/usr/bin/git','diff'],cwd=repo);staged=subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=repo)
 assert len(unstaged)==len(staged)==0
 report=json.loads(pathlib.Path(logroot+'/tests.json').read_text())
 failures=[{'name':t['fullName'],'messages':t['failureMessages']} for f in report['testResults'] for t in f['assertionResults'] if t['status']=='failed']
 record={'name':name,'file':file,'removed':old,'replacement':new,'rc':rc,'failures':failures,'restoredDiffBytes':[len(unstaged),len(staged)],'sourceSHA256':hashlib.sha256(original).hexdigest(),'log':logroot+'/output.log'}
 records.append(record);print(json.dumps({'name':name,'rc':rc,'failedNames':[f['name'] for f in failures],'restoredDiffBytes':[0,0]}),flush=True)
 assert rc!=0 and failures,(name,rc)
(ledger/'task-5-mutations-alias-final.json').write_text(json.dumps(records,indent=2)+'\n')
