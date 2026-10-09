import json,hashlib,shutil,subprocess
from pathlib import Path
source=Path('/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca'); logs=Path('/private/tmp/od9/logs')
files=['tests/bench/controlPollPerformance.ts','tests/control/fixtures/controlPollPerformance.ts','tests/control/fixtures/controlReadCounters.ts']
manifest={'toolSourceCommit':subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=source,text=True).strip(),'tools':{},'clones':{}}
for rel in files:manifest['tools'][rel]=hashlib.sha256((source/rel).read_bytes()).hexdigest()
for name,expected in [('before','1fd19a3d49778d0809f96af49a7ef51647a6c0fe'),('after','4fd2b266006c90fd5084b750a4e63c587451f69d')]:
 root=Path('/private/tmp/od9/performance-'+name); actual=subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=root,text=True).strip(); assert actual==expected,(actual,expected)
 for rel in files:
  dst=root/rel;dst.parent.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copyfile(source/rel,dst);assert hashlib.sha256(dst.read_bytes()).hexdigest()==manifest['tools'][rel]
 if not (root/'node_modules').exists():(root/'node_modules').symlink_to(source/'node_modules',target_is_directory=True)
 productdiff=subprocess.check_output(['/usr/bin/git','diff','--','src'],cwd=root);assert len(productdiff)==0
 dirty=subprocess.check_output(['/usr/bin/git','diff','--binary'],cwd=root);(logs/('perf-task3-'+name+'-dirty.diff')).write_bytes(dirty)
 untracked=subprocess.check_output(['/usr/bin/git','ls-files','--others','--exclude-standard'],cwd=root,text=True)
 production={rel:hashlib.sha256((root/rel).read_bytes()).hexdigest() for rel in subprocess.check_output(['/usr/bin/git','ls-files','src'],cwd=root,text=True).splitlines() if (root/rel).is_file()}
 manifest['clones'][name]={'path':str(root),'commit':actual,'productDirtyBytes':len(productdiff),'dirtyDiffBytes':len(dirty),'untracked':untracked,'productionSHA256':production}
manifest['initialSnapshotSHA256']=hashlib.sha256(Path('/private/tmp/od9/performance-fixture/initial-database.json').read_bytes()).hexdigest()
(logs/'perf-task3-source-manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k!='clones'},indent=2));print('Product dirty bytes before/after',*[manifest['clones'][n]['productDirtyBytes'] for n in ['before','after']])
