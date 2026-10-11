import subprocess,sys
names=['actual-argv','unreleased-eof','handoff-mode','skip-paid-phases','snapshot-hash','lineage-identity','real-verifier','candidate-equality','crash-entry','checkpoint-mode','publication-fingerprint','publication-parent-tree','delivery-projection','legacy-cleanup-event','ancestor-symlink','funding-total']
for name in names:
 result=subprocess.run([sys.executable,'/private/tmp/task6-mutant-run-final04.py',name])
 if result.returncode:raise SystemExit(result.returncode)
print('All 16 intended deletion mutations rejected; every original source restored with worktree/index 0/0.',flush=True)
