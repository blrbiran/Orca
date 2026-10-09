import importlib.util
spec=importlib.util.spec_from_file_location('wave','/private/tmp/od9/finalfix-wave.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
for key,sub in [('HOME','h'),('TMPDIR','t'),('XDG_CONFIG_HOME','c'),('XDG_CACHE_HOME','k'),('XDG_DATA_HOME','d'),('XDG_STATE_HOME','s'),('CCMEM_DATA_ROOT','ccm'),('ORCA_CORRECTIONS_DIR','cor')]:w.env[key]=str(w.clone/sub)
raise SystemExit(w.run('clone-restored-green',['npx','vitest','run','tests/control/controlPollBenchmark.test.ts'],w.clone))
