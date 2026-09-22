"""Reusable mutation battery. Clones the repo, copies the working tree's dirty files in,
proves them byte-identical, then applies one exact-full-line mutation at a time and records
whether the named criteria go red. Restores the pristine text after every run."""
import json,os,shutil,subprocess,sys,filecmp
SRC="/Users/biran/code/skills/loop/Orca"
def clone(copy):
    if os.path.exists(copy): shutil.rmtree(copy)
    subprocess.run(["git","clone","--local",SRC,copy],check=True,capture_output=True)
    os.symlink(os.path.join(SRC,"node_modules"),os.path.join(copy,"node_modules"))
    # web/dist is gitignored, so a clone has none, and a criterion that spawns the real CLI is
    # refused by name before it can be judged. Linked rather than rebuilt: the bytes are identical
    # and a rebuild per battery costs minutes for no extra evidence.
    for extra in ("web/dist","web/node_modules"):
        src=os.path.join(SRC,extra)
        if os.path.exists(src):
            dst=os.path.join(copy,extra)
            os.makedirs(os.path.dirname(dst),exist_ok=True)
            if not os.path.exists(dst): os.symlink(src,dst)
    dirty=subprocess.run(["git","status","--porcelain"],cwd=SRC,capture_output=True,text=True).stdout.split("\n")
    carried=[]
    for line in dirty:
        if not line.strip(): continue
        path=line[3:].strip()
        s,d=os.path.join(SRC,path),os.path.join(copy,path)
        if not os.path.isfile(s): continue
        os.makedirs(os.path.dirname(d),exist_ok=True)
        shutil.copyfile(s,d)
        assert filecmp.cmp(s,d,shallow=False), path
        carried.append(path)
    return carried
def run(copy,targets):
    env={**os.environ,"PATH":"/usr/local/bin:"+os.environ["PATH"]}
    p=subprocess.run(["node","node_modules/.bin/vitest","run",*targets,"--reporter=json","--outputFile=/tmp/.mutbat.json"],
                     cwd=copy,capture_output=True,text=True,env=env)
    failed=[]
    try:
        j=json.load(open("/tmp/.mutbat.json"))
        for f in j["testResults"]:
            for a in f["assertionResults"]:
                if a["status"]=="failed": failed.append(a["fullName"])
    except Exception as e: failed=[f"<json unreadable: {e}>"]
    return p.returncode,failed
def battery(copy,targets,muts,out):
    res=[]
    for name,relpath,old,new in muts:
        f=os.path.join(copy,relpath); pristine=open(f).read()
        assert pristine.count(old)==1, (name,relpath,pristine.count(old))
        open(f,"w").write(pristine.replace(old,new))
        rc,failed=run(copy,targets)
        open(f,"w").write(pristine)
        assert open(f).read()==pristine
        res.append({"mutation":name,"file":relpath,"rc":rc,"failedCount":len(failed),"failed":failed})
        print(f"{name}: rc={rc} failed={len(failed)}")
    json.dump(res,open(out,"w"),indent=1)
    return res
