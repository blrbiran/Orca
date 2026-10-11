#!/usr/bin/env python3
import os,sys,subprocess,pathlib,json,shutil,time,hashlib
repo,name,*cmd=sys.argv[1:]
root=pathlib.Path('/private/tmp/orca-followup-runs')/name
root.mkdir(parents=True,exist_ok=True,mode=0o700)
env=dict(os.environ)
for key,leaf in [('HOME','h'),('XDG_CONFIG_HOME','c'),('XDG_CACHE_HOME','k'),('XDG_DATA_HOME','d'),('XDG_STATE_HOME','s'),('TMPDIR','t'),('CCMEM_DATA_ROOT','m')]:
    p=root/leaf;p.mkdir(exist_ok=True,mode=0o700);env[key]=str(p)
for key in ['CCMEM_CONFIG_PATH','ORCA_CCMEM_REAL_BIN','ORCA_SYNCSKILL_REAL_BIN']:
    env.pop(key,None)
env.update(ECC_GATEGUARD='off',DISABLE_OMC='1',NPM_CONFIG_UPDATE_NOTIFIER='false')
table=root/'agents.json'
node_path=subprocess.check_output([shutil.which('node'),'-p','process.execPath'],text=True).strip()
table.write_text(json.dumps({'schema':'ccloop-agents-table-v1','installations':{'codex':{'kind':'codex','command':[node_path,'/private/tmp/orca-d9-ccloop-ab824d1/tests/fixtures/fake-codex.mjs','integration',str(root/'fake-marker')],'version':'9.9.9-fake','configDir':None,'timeoutMs':15000,'killGraceMs':100,'budgetMode':'soft','sandbox':'workspace-write'}}}))
env.setdefault('ORCA_CCLOOP_BIN','/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js')
env.setdefault('ORCA_AGENTS_TABLE',str(table))
log=root/'output.log'
tree_hash=hashlib.sha256()
repo_path=pathlib.Path(repo)
source_files=[]
for folder in ['src','web/src','tests','web/tests','scripts']:
    d=repo_path/folder
    if d.exists(): source_files.extend(p for p in d.rglob('*') if p.is_file() and not p.is_symlink())
for name in ['package.json','package-lock.json','tsconfig.json','tsconfig.build.json','vitest.config.ts','web/package.json','web/tsconfig.json','web/vite.config.ts']:
    p=repo_path/name
    if p.is_file(): source_files.append(p)
for p in sorted(set(source_files)):
    tree_hash.update(str(p.relative_to(repo_path)).encode()+b'\0'+p.read_bytes()+b'\0')
source_hash=tree_hash.hexdigest()
start=time.time()
with log.open('wb') as f:
    result=subprocess.run(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT)
meta={'repo':repo,'command':cmd,'rc':result.returncode,'elapsedSeconds':time.time()-start,'log':str(log),'source':subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'sourceTreeSHA256':source_hash,'sourceFiles':len(set(source_files))}
(root/'result.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta),flush=True)
sys.exit(result.returncode)
