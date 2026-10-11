import subprocess,sys
names=['actual-argv','unreleased-eof','handoff-mode','skip-paid-phases','snapshot-hash','lineage-identity','real-verifier','candidate-equality','crash-entry','checkpoint-mode','publication-fingerprint','publication-parent-tree','delivery-projection','legacy-cleanup-event','ancestor-symlink','funding-total','r1-handoff-integrity','r1-private-mode','r1-input-boundary','r1-revoked-control','r1-timeout-precedence']
for name in names:
 result=subprocess.run([sys.executable,'/private/tmp/task6-r1-mutant-run.py',name])
 if result.returncode:raise SystemExit(result.returncode)
print('All 21 intended deletion mutations rejected; original source restored with worktree/index 0/0.',flush=True)
