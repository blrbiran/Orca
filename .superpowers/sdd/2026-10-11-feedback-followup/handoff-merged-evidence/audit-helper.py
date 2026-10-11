import sys,json,hashlib
from pathlib import Path
run=Path(sys.argv[1]);out=Path(sys.argv[2])
meta=json.loads((run/'result.json').read_text());raw=(run/'output.log').read_bytes()
a={'metadata':meta,'rawBytes':len(raw),'rawLines':raw.count(b"\n"),'rawSHA256':hashlib.sha256(raw).hexdigest(),'completeRawRead':True,'jsonReports':[]}
for p in sorted(run.glob('*.json')):
 if p.name=='result.json':continue
 try:j=json.loads(p.read_text())
 except (ValueError,UnicodeDecodeError):continue
 if not isinstance(j,dict) or not isinstance(j.get('testResults'),list):continue
 counts={};skips=[];failures=[];files=[];control={'files':0,'passed':0,'skipped':0,'failed':0}
 for f in j['testResults']:
  assertions=f.get('assertionResults',[]);fs={}
  for t in assertions:
   s=t['status'];counts[s]=counts.get(s,0)+1;fs[s]=fs.get(s,0)+1
   if s!='passed':(failures if s=='failed' else skips).append({'file':f['name'],'fullName':t.get('fullName'),'status':s,'failureMessages':t.get('failureMessages',[])})
   if s=='passed' and t.get('failureMessages'):raise RuntimeError('passed assertion has failures')
  if '/tests/control/' in f['name']:
   control['files']+=1;control['passed']+=fs.get('passed',0);control['skipped']+=sum(n for s,n in fs.items() if s not in ['passed','failed']);control['failed']+=fs.get('failed',0)
  files.append({'file':f['name'],'status':f['status'],'assertions':len(assertions),'statuses':fs})
 a['jsonReports'].append({'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'success':j.get('success'),'reported':{k:v for k,v in j.items() if k.startswith('num')},'counts':counts,'fileCount':len(files),'files':files,'skips':skips,'failures':failures,'control':control})
 if j.get('success') is not True or failures:raise RuntimeError('test failure')
if meta['rc']!=0:raise RuntimeError('nonzero run')
out.write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'run':run.name,'rc':meta['rc'],'source':meta['source'],'sourceTreeSHA256':meta['sourceTreeSHA256'],'rawBytes':len(raw),'rawSHA256':a['rawSHA256'],'reports':[{'counts':j['counts'],'files':j['fileCount'],'control':j['control'],'skips':j['skips']} for j in a['jsonReports']]},ensure_ascii=False))
