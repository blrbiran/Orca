import os,subprocess,tempfile,json,sys
from pathlib import Path
r=Path(__file__).parent
root=Path(tempfile.mkdtemp(prefix='t3l-',dir='/tmp'));root.chmod(0o700)
report=r/'task3-fix1-final-leak.vitest.json'
argv=['./node_modules/.bin/vitest','run','tests/control/taskResultCollector.test.ts','tests/control/taskResultIsolation.test.ts','tests/control/taskResultPaired.test.ts','tests/control/settleUnknownUsage.test.ts','tests/control/handoffFailedRetry.test.ts','tests/control/driverContinuation.test.ts','tests/panel/webParity.test.ts','--maxWorkers=2','--no-cache','--reporter=default','--reporter=json','--outputFile='+str(report)]
env=dict(os.environ,TMPDIR=str(root))
print('leak child argv',json.dumps(argv),'owned TMPDIR',str(root),flush=True)
rc=subprocess.call(argv,env=env)
result=json.loads(report.read_text()) if report.exists() else {}
left=sorted(x.name for x in root.iterdir())
summary={'childRC':rc,'totalTests':result.get('numTotalTests',0),'passedTests':result.get('numPassedTests',0),'failedTests':result.get('numFailedTests',0),'pendingTests':result.get('numPendingTests',0),'ownedTMPDIR':str(root),'entries':left}
(r/'task3-fix1-final-leak-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
sys.exit(rc or (2 if not summary['totalTests'] else 1 if left else 0))
