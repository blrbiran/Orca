import subprocess,json,pathlib
repo='/private/tmp/ccloop-task14-claude-diagnostic-20261011'
ledger=[]
for mode,count in [('runner-graceful',2),('runner-original',5),('adapter-marker',3),('adapter-preexit',1),('adapter-exit',2)]:
 for i in range(1,count+1):
  name='t14-claude-'+mode+str(i)
  cmd=['python3','/private/tmp/orca-followup-run.py',repo,name,'python3','/private/tmp/task14-launch.py',name,mode]
  rc=subprocess.run(cmd).returncode
  ledger.append({'command':['rtk','proxy']+cmd,'rc':rc})
  pathlib.Path('/private/tmp/task14-probe-commands.json').write_text(json.dumps(ledger,indent=2)+'\n')
