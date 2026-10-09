import json,subprocess,sys
from pathlib import Path
root=Path('/private/tmp/od9/performance-task3-mutation')
logs=Path('/private/tmp/od9/logs')
env=json.loads(Path('/private/tmp/od9/env.json').read_text())
base=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=root,text=True).strip()
summary=json.loads((logs/"perf-task3-mutation-results.json").read_text())

def run(name,test,changes):
    originals={}
    try:
        for file,old,new in changes:
            path=root/file
            if file not in originals: originals[file]=path.read_text()
            s=path.read_text()
            if s.count(old)!=1: raise Exception(f'{name} replacement matches {s.count(old)} in {file}: {old}')
            path.write_text(s.replace(old,new))
        diff=subprocess.check_output(['/usr/bin/git','diff'],cwd=root)
        (logs/f'perf-task3-mutation-{name}.diff').write_bytes(diff)
        command=['npx','vitest','run','tests/control/controlPollBenchmark.test.ts','-t',test,'--reporter=dot']
        with (logs/f'perf-task3-mutation-{name}.log').open('w') as f:
            r=subprocess.run(command,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
        print(name, 'RC',r.returncode,flush=True)
        result={'name':name,'commit':base,'test':test,'command':command,'rc':r.returncode,'diffBytes':len(diff)}
        summary.append(result)
    finally:
        for file,s in originals.items(): (root/file).write_text(s)
        proof={'diffBytes':len(subprocess.check_output(['/usr/bin/git','diff'],cwd=root)),'stagedDiffBytes':len(subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=root))}
        if summary: summary[-1]['restored']=proof
        if any(proof.values()): raise Exception(f'Not restored: {proof}')
        (logs/'perf-task3-mutation-results.json').write_text(json.dumps(summary,indent=2))
    if r.returncode==0: raise Exception(f'Mutation survived: {name}')


run('cached-restore','builds one legal store',[('tests/control/fixtures/controlReadCounters.ts','if (live) Object.defineProperty(live, method, { configurable: true, value: original });','void live;')])
