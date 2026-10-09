from pathlib import Path
import subprocess,json,sys
root=Path('/private/tmp/od9');env=json.loads((root/'env.json').read_text());env['ORCA_OUTER_LEAK_CHECK']='1';cmd=['npx','vitest','run','tests/control/controlPollBenchmark.test.ts'];log=root/'logs'/'perf-task3-temp-namespace-leak.log'
print('COMMAND',cmd,'FLAG ORCA_OUTER_LEAK_CHECK=1',flush=True)
with log.open('w') as f:r=subprocess.run(cmd,cwd='/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca',env=env,stdout=f,stderr=subprocess.STDOUT)
log.with_suffix('.rc').write_text(str(r.returncode)+'\n');print('RC',r.returncode,flush=True);sys.exit(r.returncode)
