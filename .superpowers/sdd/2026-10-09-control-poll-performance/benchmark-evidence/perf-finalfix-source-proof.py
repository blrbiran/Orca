from pathlib import Path
import subprocess,json,hashlib
m=Path('/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca');c=Path('/private/tmp/od9/ff/clone');logs=Path('/private/tmp/od9/logs');base='91a0f725bd255998834d91ebfe0668a4a09d7bc0'
def git(*args,root=m):return subprocess.check_output(['/usr/bin/git',*args],cwd=root)
def sha(b):return hashlib.sha256(b).hexdigest()
def before(f):return git('show',base+':'+f)
proof={'owner':'Codex /root/fix_performance_portability','date':'2026-10-10 Asia/Shanghai','base':base,'observedHEAD':git('rev-parse','HEAD').decode().strip(),'srcDiffBytes':len(git('diff',base,'--','src')),'cloneRestoredDiffBytes':len(git('diff',root=c)),'cloneRestoredCachedDiffBytes':len(git('diff','--cached',root=c)),'sourceFiles':[],'unchangedFiles':[]}
for f in git('ls-files','src').decode().splitlines():
    old=before(f);current=(m/f).read_bytes();assert old==current;proof['sourceFiles'].append({'path':f,'sha256':sha(current),'bytes':len(current)})
for f in ['tests/bench/controlPollPerformance.ts','tests/control/fixtures/controlReadCounters.ts','tests/panel/controlPollPerformance.test.ts','tests/control/archivedWakePerformance.test.ts']:
    old=before(f);current=(m/f).read_bytes();assert old==current;proof['unchangedFiles'].append({'path':f,'sha256':sha(current),'bytes':len(current)})
f='tests/control/fixtures/controlPollPerformance.ts';old=before(f).decode();new=(m/f).read_text();start=old.index('/** Writable fixture');end=old.index('export interface ControlPollFixture');patched=new[:new.index('/** Writable fixture')]+old[start:end]+new[new.index('export interface ControlPollFixture'):]
patched=patched.replace('tasksPerGroup:number;now:number},temporaryNamespace?:string): Promise<ControlPollFixture> {','tasksPerGroup:number;now:number}): Promise<ControlPollFixture> {').replace('await assertTemporaryFixtureRoot(root,temporaryNamespace);','await assertTemporaryFixtureRoot(root);').replace('openExistingControlPollFixture(now:number,temporaryNamespace?:string):Promise<ControlPollFixture> {','openExistingControlPollFixture(now:number):Promise<ControlPollFixture> {').replace('await assertTemporaryFixtureRoot(performanceRoot(),temporaryNamespace);','await assertTemporaryFixtureRoot(performanceRoot());')
assert patched==old
proof['fixtureOutsideSetupDeltaIdentical']=True
getter=next(line for line in old.splitlines() if line.startswith('export const performanceRoot'));assert getter in new.splitlines();proof['getterSha256']=sha(getter.encode())
proof['ownedFiles']=[{'path':f,'baseSha256':sha(before(f)),'currentSha256':sha((m/f).read_bytes()),'cloneSha256':sha((c/f).read_bytes())} for f in ['tests/control/fixtures/controlPollPerformance.ts','tests/control/controlPollBenchmark.test.ts']]
assert all(x['currentSha256']==x['cloneSha256'] for x in proof['ownedFiles'])
callers=subprocess.check_output(['rg','-n','buildControlPollFixture|openExistingControlPollFixture','tests'],cwd=m);(logs/'perf-finalfix-callers.log').write_bytes(callers);proof['callerInventorySha256']=sha(callers)
diff=git('diff',base,'--','tests/control/fixtures/controlPollPerformance.ts','tests/control/controlPollBenchmark.test.ts');(logs/'perf-finalfix-source.diff').write_bytes(diff);proof['ownedDiffSha256']=sha(diff)
proof['cloneCommand']=['/usr/bin/git','clone','--local','--no-hardlinks',str(m),str(c)]
proof['cloneGitDir']=str(c/'.git');proof['sourceGitCommonDir']=git('rev-parse','--git-common-dir').decode().strip()
proof['pinnedCcloop']={'path':'/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js','sha256':sha(Path('/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js').read_bytes()),'cloneHEAD':subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd='/private/tmp/orca-d9-ccloop-ab824d1',text=True).strip()}
(logs/'perf-finalfix-source-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items() if k!='sourceFiles'},indent=2))
