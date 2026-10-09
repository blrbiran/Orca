import json,sys,subprocess,time
from pathlib import Path
root=Path('/private/tmp/od9');env=json.loads((root/'env.json').read_text());results=[]
for name in ['before','after']:
 clone=root/('performance-'+name);out=root/('performance-'+name+'-final');out.mkdir(mode=0o700,exist_ok=True)
 command=['npx','tsx','tests/bench/controlPollPerformance.ts','--output',str(out),'--warmup','10','--samples','30']
 if name=='after':command+=['--expect-optimized','--compare',str(root/'performance-before-final/result.json')]
 log=root/'logs'/('perf-task3-'+name+'-final.log');print('COMMAND',command,'CWD',str(clone),'LOG',str(log),flush=True)
 start=time.monotonic()
 with log.open('w') as f:r=subprocess.run(command,cwd=clone,env=env,stdout=f,stderr=subprocess.STDOUT)
 duration=time.monotonic()-start;(root/'logs'/('perf-task3-'+name+'-final.rc')).write_text(str(r.returncode)+'\n')
 print(name,'RC',r.returncode,'ELAPSED_SECONDS',duration,flush=True)
 results.append({'name':name,'command':command,'cwd':str(clone),'log':str(log),'rc':r.returncode,'elapsedSeconds':duration});(root/'logs'/'perf-task3-serial-results.json').write_text(json.dumps(results,indent=2))
 if r.returncode:sys.exit(r.returncode)
