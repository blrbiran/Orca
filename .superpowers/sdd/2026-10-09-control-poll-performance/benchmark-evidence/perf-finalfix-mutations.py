import importlib.util,json,subprocess
spec=importlib.util.spec_from_file_location('wave','/private/tmp/od9/finalfix-wave.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
f='tests/control/fixtures/controlPollPerformance.ts';p=w.clone/f
subprocess.run(['/usr/bin/git','add',f,'tests/control/controlPollBenchmark.test.ts'],cwd=w.clone,check=True)
subprocess.run(['/usr/bin/git','-c','user.name=Codex finalfix','-c','user.email=codex@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','test: isolate final fix mutation baseline'],cwd=w.clone,check=True)
for key,sub in [('HOME','h'),('TMPDIR','t'),('XDG_CONFIG_HOME','c'),('XDG_CACHE_HOME','k'),('XDG_DATA_HOME','d'),('XDG_STATE_HOME','s'),('CCMEM_DATA_ROOT','ccm'),('ORCA_CORRECTIONS_DIR','cor')]:
    path=w.clone/sub;path.mkdir(mode=0o700,exist_ok=True);w.env[key]=str(path)
base=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=w.clone,text=True).strip()
items=[]
for name,old in [('build-entry',' await assertTemporaryFixtureRoot(root,temporaryNamespace);'),('open-entry',' await assertTemporaryFixtureRoot(performanceRoot(),temporaryNamespace);'),('restriction',' if(temporaryNamespace!==undefined && !within(await canonical(temporaryNamespace)))throw new Error("control-poll-fixture-root-not-temporary");')]:
    original=p.read_bytes()
    try:
        s=original.decode();assert s.count(old)==1;p.write_text(s.replace(old,' // finalfix independent guard deletion: '+name))
        diff=subprocess.check_output(['/usr/bin/git','diff'],cwd=w.clone);(w.logs/('perf-finalfix-mutation-'+name+'.diff')).write_bytes(diff)
        rc=w.run('mutation-'+name,['npx','vitest','run','tests/control/controlPollBenchmark.test.ts'],w.clone)
        if rc!=1:raise Exception('mutation did not meaningfully fail: '+name)
    finally:
        p.write_bytes(original)
        proof={'diffBytes':len(subprocess.check_output(['/usr/bin/git','diff'],cwd=w.clone)),'cachedDiffBytes':len(subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=w.clone))}
        assert proof=={'diffBytes':0,'cachedDiffBytes':0},proof
        items.append({'name':name,'baseline':base,'rc':rc,'restored':proof,'originalGuard':old,'clone':str(w.clone),'dataRoots':{k:w.env[k] for k in ['HOME','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','CCMEM_DATA_ROOT','ORCA_CORRECTIONS_DIR']}})
        (w.logs/'perf-finalfix-mutation-results.json').write_text(json.dumps(items,indent=2)+'\n')
print(json.dumps(items,indent=2))
