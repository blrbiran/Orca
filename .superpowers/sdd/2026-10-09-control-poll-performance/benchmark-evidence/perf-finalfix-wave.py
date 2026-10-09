from pathlib import Path
import json,os,subprocess,sys,hashlib
managed=Path('/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca')
root=Path('/private/tmp/od9/ff'); clone=root/'clone'; logs=Path('/private/tmp/od9/logs')
env=json.loads(Path('/private/tmp/od9/env.json').read_text())
for key,sub in [('HOME','h'),('TMPDIR','t'),('XDG_CONFIG_HOME','c'),('XDG_CACHE_HOME','k'),('XDG_DATA_HOME','d'),('XDG_STATE_HOME','s'),('CCMEM_DATA_ROOT','ccm'),('ORCA_CORRECTIONS_DIR','cor')]:
    path=root/sub;path.mkdir(mode=0o700,parents=True,exist_ok=True);env[key]=str(path)
def run(name,cmd,cwd,extra=None):
    e={**env,**(extra or {})};log=logs/('perf-finalfix-'+name+'.log')
    if log.exists():raise Exception('unique evidence exists: '+str(log))
    print('COMMAND',cmd,'CWD',str(cwd),'LOG',str(log),flush=True)
    with log.open('w') as f:r=subprocess.run(cmd,cwd=cwd,env=e,stdout=f,stderr=subprocess.STDOUT)
    log.with_suffix('.rc').write_text(str(r.returncode)+'\n')
    item={'name':name,'command':cmd,'cwd':str(cwd),'base':subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=cwd,text=True).strip(),'rc':r.returncode,'log':log.name,'bytes':log.stat().st_size,'sha256':hashlib.sha256(log.read_bytes()).hexdigest(),'environment':{k:e[k] for k in ['HOME','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','CCMEM_DATA_ROOT','ORCA_CORRECTIONS_DIR','ORCA_CCLOOP_BIN']}}
    ledger=logs/'perf-finalfix-commands.json';items=json.loads(ledger.read_text()) if ledger.exists() else [];items.append(item);ledger.write_text(json.dumps(items,indent=2)+'\n')
    print('RC',r.returncode,flush=True);return r.returncode
if __name__=='__main__':
    phase=sys.argv[1]
    if phase=='clone':
        rc=run('clone',['/usr/bin/git','clone','--local','--no-hardlinks',str(managed),str(clone)],managed)
        if rc:sys.exit(rc)
        (clone/'node_modules').symlink_to(managed/'node_modules',target_is_directory=True)
    elif phase=='run':sys.exit(run(sys.argv[2],sys.argv[4:],managed if sys.argv[3]=='normal' else clone))
