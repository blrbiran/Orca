import importlib.util,subprocess
spec=importlib.util.spec_from_file_location('wave','/private/tmp/od9/finalfix-wave.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
p=w.clone/'tests/control/controlPollBenchmark.test.ts';original=p.read_bytes()
try:
    p.write_bytes(subprocess.check_output(['/usr/bin/git','show','HEAD:tests/control/controlPollBenchmark.test.ts'],cwd=w.clone))
    rc=w.run('old-temp-qualified-red',['npx','vitest','run','tests/control/controlPollBenchmark.test.ts'],w.clone)
finally:p.write_bytes(original)
raise SystemExit(rc)

