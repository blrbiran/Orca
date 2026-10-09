import ast,json,subprocess
from pathlib import Path
source=Path('/private/tmp/od9/task1-mutations.py').read_text();tree=ast.parse(source);prefix=source[:source.index("run('work-scope'")]
prefix=prefix.replace('/private/tmp/od9/performance-task1-mutation-verified','/private/tmp/od9/performance-task3-mutation').replace('perf-task1-mutation','perf-task3-mutation')
chosen={'decode-refresh','decode-once','point-reads','work-statement-reuse','counter-alias'}
parts=[]
for node in tree.body:
 if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and getattr(node.value.func,'id',None)=='run' and node.value.args[0].value in chosen:parts.append(ast.get_source_segment(source,node))
root=Path('/private/tmp/od9/performance-task3-mutation');(root/'node_modules').symlink_to('/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca/node_modules',target_is_directory=True)
exec(prefix+'\n'+ '\n'.join(parts))
run('cached-restore','builds one legal store', [('tests/control/fixtures/controlReadCounters.ts','if (live) Object.defineProperty(live, method, { configurable: true, value: original });','// mutation: omit restoration of cached methods')]) if False else None
# A new real benchmark integrity criterion detects still-live cached method restoration.
run('cached-restore','cached-restore-unused-pattern',[]) if False else None
base_test='tests/panel/controlPollPerformance.test.ts'
# Use the same restore/proof runner but its exact integrity file for this one mutation.
old_run=run
exec(prefix[prefix.index('def run('):].replace("'tests/panel/controlPollPerformance.test.ts'","'tests/control/controlPollBenchmark.test.ts'"))
run('cached-restore','builds one legal store', [('tests/control/fixtures/controlReadCounters.ts','if (live) Object.defineProperty(live, method, { configurable: true, value: original });','// mutation: omit restoration of cached methods')])
exec(prefix[prefix.index('def run('):].replace("'tests/panel/controlPollPerformance.test.ts'","'tests/control/archivedWakePerformance.test.ts'"))
run('group-category','defers 100 archived groups', [('tests/control/fixtures/controlReadCounters.ts','const groupKey = groupBodies.get(text);','const groupKey = undefined;')])
print('ALL RESTORED',json.dumps({'diffBytes':len(subprocess.check_output(['/usr/bin/git','diff'],cwd=root)),'stagedDiffBytes':len(subprocess.check_output(['/usr/bin/git','diff','--cached'],cwd=root))}),flush=True)
