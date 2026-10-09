from pathlib import Path
import json,subprocess,sys
source=Path('/private/tmp/od9/task1-mutations.py').read_text();prefix=source[:source.index("run('work-scope'")].replace('/private/tmp/od9/performance-task1-mutation-verified','/Users/biran/.codex/visualizations/2026/10/09/01a11eeb-8e72-7e43-aa92-c90f72786fe3/guard-mutation-clone').replace('perf-task1-mutation','perf-task3-outside-temp-mutation').replace("'tests/panel/controlPollPerformance.test.ts'","'tests/control/controlPollBenchmark.test.ts'")
exec(prefix)
(root/'node_modules').symlink_to('/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca/node_modules',target_is_directory=True)
command=['npx','vitest','run','tests/control/controlPollBenchmark.test.ts']
with (logs/'perf-task3-outside-temp-clone-baseline.log').open('w') as f:r=subprocess.run(command,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
(logs/'perf-task3-outside-temp-clone-baseline.rc').write_text(str(r.returncode)+'\n');print('BASELINE RC',r.returncode,flush=True)
if r.returncode:sys.exit(r.returncode)
run('build-entry','refuses a nontemporary sandbox',[('tests/control/fixtures/controlPollPerformance.ts',' await assertTemporaryFixtureRoot(root);',' void root;')])
run('open-entry','refuses a nontemporary sandbox',[('tests/control/fixtures/controlPollPerformance.ts',' await assertTemporaryFixtureRoot(performanceRoot());',' void performanceRoot;')])
print('ALL RESTORED',json.dumps({'diffBytes':len(subprocess.check_output(['/usr/bin/git','diff'],cwd=root)),'stagedDiffBytes':len(subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=root))}),flush=True)
