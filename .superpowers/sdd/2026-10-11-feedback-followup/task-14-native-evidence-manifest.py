#!/usr/bin/env python3
"""Hash Task 14 native gate evidence without changing product checkouts."""
import hashlib
import json
from pathlib import Path

report = Path(__file__).resolve().parent
runs = Path('/private/tmp/orca-followup-runs')
entries = []
for root in sorted(runs.glob('t14-native-*')):
    if not root.is_dir():
        continue
    entry = {'name': root.name, 'files': {}}
    for name in ('result.json', 'output.log', 'tests.json'):
        path = root / name
        if not path.is_file():
            continue
        data = path.read_bytes()
        entry['files'][name] = {
            'path': str(path), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
        }
    result = root / 'result.json'
    if result.is_file():
        entry['result'] = json.loads(result.read_text())
    tests = root / 'tests.json'
    if tests.is_file():
        payload = json.loads(tests.read_text())
        entry['testCounts'] = {key: payload.get(key) for key in (
            'numTotalTests', 'numPassedTests', 'numFailedTests',
            'numPendingTests', 'numTodoTests')}
        entry['failedNames'] = [
            ' > '.join([*test.get('ancestorTitles', []), test.get('title', '')])
            for file in payload.get('testResults', [])
            for test in file.get('assertionResults', [])
            if test.get('status') == 'failed'
        ]
        entry['skippedNames'] = [
            ' > '.join([*test.get('ancestorTitles', []), test.get('title', '')])
            for file in payload.get('testResults', [])
            for test in file.get('assertionResults', [])
            if test.get('status') == 'skipped'
        ]
    entries.append(entry)

target = report / 'task-14-native-evidence-manifest.json'
target.write_text(json.dumps(entries, indent=2) + '\n')
print(f'{len(entries)} native evidence directories -> {target}')
