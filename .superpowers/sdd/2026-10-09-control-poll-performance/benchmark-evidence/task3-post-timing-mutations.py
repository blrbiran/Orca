from pathlib import Path
import json
source=Path('/private/tmp/od9/task1-mutations.py').read_text();prefix=source[:source.index("run('work-scope'")].replace('/private/tmp/od9/performance-task1-mutation-verified','/private/tmp/od9/performance-task3-mutation').replace('perf-task1-mutation','perf-task3-post-mutation').replace("'tests/panel/controlPollPerformance.test.ts'","'tests/control/controlPollBenchmark.test.ts'")
exec(prefix)
run('nonempty-root','refuses a nonempty temporary root',[('tests/control/fixtures/controlPollPerformance.ts',' if(existingRoot && (!existingRoot.isDirectory() || (await readdir(root)).length > 0)) throw new Error("control-poll-fixture-root-not-empty");',' void existingRoot;')])
run('cached-restore','builds one legal store',[('tests/control/fixtures/controlReadCounters.ts','if (live) Object.defineProperty(live, method, { configurable: true, value: original });','void live;')])
run('sqlite-wire','builds one legal store',[('tests/bench/controlPollPerformance.ts','.all().map(row=>({...row}));','.all();')])
print('ALL RESTORED',json.dumps({'diffBytes':len(subprocess.check_output(['/usr/bin/git','diff'],cwd=root)),'stagedDiffBytes':len(subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=root))}),flush=True)
