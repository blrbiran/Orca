import importlib.util
spec=importlib.util.spec_from_file_location('wave','/private/tmp/od9/finalfix-wave.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
raise SystemExit(w.run('formal-tmp-leak',['node','scripts/check-tmp-leak.mjs','tests/control/controlPollBenchmark.test.ts'],w.managed,{'ORCA_OUTER_LEAK_CHECK':'1'}))
