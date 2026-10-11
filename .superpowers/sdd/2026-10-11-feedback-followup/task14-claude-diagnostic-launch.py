import os,sys,tempfile,subprocess
os.environ['TMPDIR']=tempfile.mkdtemp(prefix='t14.',dir='/private/tmp')
os.environ['T14_OUTPUT']='/private/tmp/orca-followup-runs/'+sys.argv[1]+'/probe'
raise SystemExit(subprocess.run(['node','/private/tmp/ccloop-task14-claude-diagnostic-20261011/node_modules/tsx/dist/cli.mjs','/private/tmp/task14-probe.mts',sys.argv[2]],env=os.environ).returncode)
