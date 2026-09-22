import json,os,re,subprocess,sys,shutil
COPY=sys.argv[1]; OUT=sys.argv[2]
MOD=os.path.join(COPY,"src/panel/controlOptions.ts")
pristine=open(MOD).read()
M=[
 ("M1 --no-control ignored",
  '  if (args.includes("--no-control") || repos.length === 0) return off();',
  '  if (repos.length === 0) return off();'),
 ("M2 zero-repo no longer turns control off",
  '  if (args.includes("--no-control") || repos.length === 0) return off();',
  '  if (args.includes("--no-control")) return off();'),
 ("M3 explicit --control-state-dir ignored",
  '  if (nonEmpty(explicitStateDir)) {',
  '  if (false && nonEmpty(explicitStateDir)) {'),
 ("M4 multi-repo rejection replaced by a guessed key",
  '    return { ...off(), enabled: true, rejection: "control-state-dir-required" };',
  '    stateDir = join(controlRoot(env), repos[0]!.projectKey);'),
 ("M5 wake interval accepted unvalidated",
  '    if (!Number.isSafeInteger(parsed) || parsed <= 0) {',
  '    if (false) {'),
 ("M6 estimator profile no longer required",
  '  if (!nonEmpty(estimatorProfileId)) {',
  '  if (false) {'),
 ("M7 estimate mode no longer required",
  '  if (!nonEmpty(estimateModeText)) {',
  '  if (false) {'),
 ("M8 unrecognised estimate mode accepted",
  '  if (estimateModeText !== "strict" && estimateModeText !== "soft") {',
  '  if (false) {'),
 ("M9 either ccloop variable counts as configured",
  '  const executionPort = nonEmpty(env.ORCA_CCLOOP_BIN) && nonEmpty(env.ORCA_CCLOOP_ADAPTER_CONFIG) ? "configured" : "unconfigured";',
  '  const executionPort = nonEmpty(env.ORCA_CCLOOP_BIN) || nonEmpty(env.ORCA_CCLOOP_ADAPTER_CONFIG) ? "configured" : "unconfigured";'),
 ("M10 empty ORCA_CONTROL_DIR treated as set",
  '  if (override !== undefined && override.length > 0) return override;',
  '  if (override !== undefined) return override;'),
 ("M11 home fallback drops the control segment",
  '  return join(homedir(), ".orca", "control");',
  '  return join(homedir(), ".orca");'),
]
results=[]
for name,old,new in M:
    assert pristine.count(old)==1, (name, pristine.count(old))
    open(MOD,"w").write(pristine.replace(old,new))
    p=subprocess.run(["node","node_modules/.bin/vitest","run","tests/panel/controlOptions.test.ts","--reporter=json","--outputFile=/tmp/.t1mut.json"],
                     cwd=COPY,capture_output=True,text=True,
                     env={**os.environ,"PATH":"/usr/local/bin:"+os.environ["PATH"]})
    failed=[]
    try:
        j=json.load(open("/tmp/.t1mut.json"))
        for f in j["testResults"]:
            for a in f["assertionResults"]:
                if a["status"]=="failed": failed.append(a["fullName"])
    except Exception as e: failed=[f"<json unreadable: {e}>"]
    results.append({"mutation":name,"rc":p.returncode,"failedCount":len(failed),"failed":failed})
    print(f"{name}: rc={p.returncode} failed={len(failed)}")
open(MOD,"w").write(pristine)
print("restored:", open(MOD).read()==pristine)
json.dump(results,open(OUT,"w"),indent=1)
