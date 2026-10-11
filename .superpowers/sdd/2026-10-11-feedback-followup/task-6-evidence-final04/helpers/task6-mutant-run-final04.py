import pathlib,subprocess,sys,json,hashlib
repo=pathlib.Path('/private/tmp/ccloop-task6-mutants-final')
name=sys.argv[1]
subprocess.run(["/usr/bin/git","diff","--check"],cwd=repo,check=True)
specs={
 'actual-argv':('src/control/savedResultRecovery.ts',[('||!same(outcome.args,expectedArgs)||outcome.evidenceDir!==evidenceDir','')],['tests/control/savedResultRecovery.test.ts','-t','actual legacy argv drift']),
 'unreleased-eof':('src/controller/verifySavedResult.ts',[('if(s.length===0)process.exit(1);','')],['tests/control/savedResultRecovery.native.test.ts','-t','owner death before validation command release']),
 'handoff-mode':('src/control/handoff.ts',[('runState:coreRunState,','runState,')],['WIRE']),
 'skip-paid-phases':('src/controller/runLoop.ts', [('const continuation = recovery ? {nextPhase:', 'const continuation = recovery && false ? {nextPhase:')], ['tests/controller/verifySavedResult.test.ts','-t','restores the archived candidate']),
 'snapshot-hash':('src/control/savedResultRecovery.ts',[('||(expected.snapshotHash!==undefined&&archive.snapshot.hash!==expected.snapshotHash)','')],['tests/control/savedResultRecovery.test.ts','-t','changed snapshot']),
 'lineage-identity':('src/control/savedResultRecovery.ts', [('for(const key of ["groupId","workItemId","taskId","graphVersion","targetVersion"] as const)if(admission.source[key]!==input.claim[key])fail("saved-result-source-stale");','')],['tests/control/savedResultRecovery.test.ts','-t','changed task']),
 'real-verifier':('src/controller/runLoop.ts',[('const verification = await adapter.verify(context);','const verification = {approved:true,rejectCategory:"",primaryTargetPaths:["answer.txt"],failingCommand:null,safeToRetry:false,evidence:["mutant"],pauseSignals:[],stopSignals:[],tokenUsage:7};')],['tests/controller/verifySavedResult.test.ts','-t','restores the archived candidate']),
 'candidate-equality':('src/controller/verifySavedResult.ts',[('const entry=state.savedResult?.entry;','return; const entry=state.savedResult?.entry;')],['tests/controller/verifySavedResult.test.ts','-t','candidate modification by verifier']),
 'crash-entry':('src/controller/runLoop.ts',[('if(recovery && (state.savedResult?.entry || await hasSavedResultEntry(runDir)))','if(false && recovery && (state.savedResult?.entry || await hasSavedResultEntry(runDir)))'),('if(recovery && state.attemptsUsed > 0 && !await hasPreparedSavedResultProof(runDir,state))throw new Error("saved-result-lifecycle-unavailable");','')],['tests/control/savedResultRecovery.native.test.ts','-t','native crash at entry-fsynced']),
 'publication-fingerprint':('src/controller/verifySavedResult.ts',[('try{await lstat(tree);await assertSavedResultUnmodified(runDir,tree,loaded,state);return;}','try{await lstat(tree);return;}')],['tests/control/savedResultRecovery.native.test.ts','-t','terminal-fsynced approval']),
 'publication-parent-tree':('src/controller/verifySavedResult.ts',[('  if(parents.length!==2||parents[1]!==loaded.snapshot.head||(await savedGit(repo,"rev-parse",`${commit}^{tree}`)).toString()!==(await savedGit(repo,"rev-parse",`${loaded.snapshot.head}^{tree}`)).toString())throw Error("publication mismatch");','')],['tests/control/savedResultRecovery.native.test.ts','-t','publication even when the ref exists']),
 'delivery-projection':('src/controller/verifySavedResult.ts',[(' const publication=await savedResultPublication(loaded);',' return; const publication=await savedResultPublication(loaded);')],['tests/control/savedResultRecovery.native.test.ts','-t','poisoned outside the candidate']),
 'legacy-cleanup-event':('src/control/savedResultRecovery.ts',[('"workspace_cleanup_failed",','')],['tests/control/savedResultRecovery.test.ts','-t','actual legacy workspace_cleanup_failed']),
 'ancestor-symlink':('src/controller/verifySavedResult.ts',[(' if(await realpath(tree)!==tree)throw Error("saved-result-modified-during-verification");','')],['tests/controller/verifySavedResult.test.ts','-t','moved behind']),
 'funding-total':('src/control/savedResultRecovery.ts',[('||f.fundedTotal[d]!==total','')],['tests/control/savedResultRecovery.test.ts','-t','changed total recovery authority']),
 'checkpoint-mode':('src/control/materialize.ts',[(' refuseRecoveryCheckpoint(checkpointRecord,manifest,bytes);','')],['tests/control/savedResultCheckpoint.test.ts']),
}
file,replacements,tests=specs[name];p=repo/file;original=p.read_bytes();s=original.decode()
for old,new in replacements:
 assert s.count(old)==1,(name,old,s.count(old));s=s.replace(old,new)
try:
 p.write_text(s)
 if name in ['unreleased-eof','handoff-mode','publication-fingerprint','publication-parent-tree','delivery-projection']:
  subprocess.run(['python3','/private/tmp/orca-followup-run.py',str(repo),'task6-final04-mutant-'+name+'-build','sh','-c','TASK_TMP=$(mktemp -d /private/tmp/t6mb.XXXXXX); chmod 700 "$TASK_TMP"; export TMPDIR="$TASK_TMP"; npm run build'],check=True)
 cmd=['python3','/private/tmp/orca-followup-run.py',str(repo),'task6-final04-mutant-'+name+'-01','sh','-c','TASK_TMP=$(mktemp -d /private/tmp/t6m.XXXXXX); chmod 700 "$TASK_TMP"; export TMPDIR="$TASK_TMP"; exec "$@"','sh','node','/Users/biran/code/skills/loop/ccloop/node_modules/vitest/vitest.mjs','run',*tests,'--maxWorkers=1','--minWorkers=1']
 if tests==['WIRE']:
  cmd=cmd[:8]+['node','--import',str(repo/'node_modules/tsx/dist/loader.mjs'),'/private/tmp/task6-clone-wire-mutant-final04.mts']
 result=subprocess.run(cmd)
 if result.returncode==0:raise RuntimeError('mutant survived')
finally:
 p.write_bytes(original)
 if name in ['unreleased-eof','handoff-mode','publication-fingerprint','publication-parent-tree','delivery-projection']:
  subprocess.run(['python3','/private/tmp/orca-followup-run.py',str(repo),'task6-final04-mutant-'+name+'-restore-build','sh','-c','TASK_TMP=$(mktemp -d /private/tmp/t6mb.XXXXXX); chmod 700 "$TASK_TMP"; export TMPDIR="$TASK_TMP"; npm run build'],check=True)
 tracked=subprocess.check_output(['/usr/bin/git','diff'],cwd=repo);index=subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=repo)
 assert len(tracked)==len(index)==0,(len(tracked),len(index))
 print(json.dumps({'mutant':name,'intendedRefusalRC':result.returncode,'restoredSHA256':hashlib.sha256(original).hexdigest(),'trackedDiffBytes':len(tracked),'indexDiffBytes':len(index)}),flush=True)
