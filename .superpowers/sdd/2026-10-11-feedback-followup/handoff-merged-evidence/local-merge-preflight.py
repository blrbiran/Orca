import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

source, candidate, output = map(Path, sys.argv[1:])
env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')

def git(repo, *args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(repo), *args], env=env)

source_head = git(source, 'rev-parse', 'HEAD').decode().strip()
candidate_head = git(candidate, 'rev-parse', 'HEAD').decode().strip()
branch = git(source, 'branch', '--show-current').decode().strip()
status = git(source, 'status', '--porcelain').decode()
ancestry = subprocess.run(['/usr/bin/git', '-C', str(candidate), 'merge-base', '--is-ancestor', source_head, candidate_head], env=env).returncode
added = [p.decode() for p in git(candidate, 'diff', '--name-only', '-z', '--diff-filter=A', source_head, candidate_head).split(b'\0') if p]
collisions = []
for name in added:
    target = source / name
    parents = [source / Path(name).parts[0]]
    for part in Path(name).parts[1:-1]:
        parents.append(parents[-1] / part)
    if any(p.is_symlink() for p in parents):
        collisions.append({'path': name, 'reason': 'existing symlink parent'})
        continue
    if not os.path.lexists(target):
        continue
    expected = git(candidate, 'show', f'{candidate_head}:{name}')
    if target.is_symlink() or not target.is_file() or target.read_bytes() != expected:
        collisions.append({'path': name, 'reason': 'existing untracked/ignored content differs'})

result = {'source': str(source), 'candidate': str(candidate), 'sourceHEADAtObservation': source_head,
          'candidateHEAD': candidate_head, 'sourceBranch': branch, 'sourcePorcelain': status,
          'ancestorRC': ancestry, 'addedTrackedPathsChecked': added, 'collisions': collisions,
          'scriptSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
result['ready'] = branch == 'main' and not status and ancestry == 0 and not collisions
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'addedTrackedPathsChecked'}, ensure_ascii=False))
print(f'checked {len(added)} newly tracked paths, including ignored-file collisions')
sys.exit(0 if result['ready'] else 1)
