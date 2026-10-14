# #58 ccloop report (hand-backs saved by controller, session 02f047f6)
Branch codex/omp-catalog-diagnostics (worktree ccloop-wt/omp-catalog-diagnostics) on bd1ddc3: a0f4e0f feat(omp): name why the model catalog probe failed and read it once per process; 3c911c3 refactor(omp): drop the in-process catalog memo (controller ruling). Net: diagnostics only.
- runOmpJson(installation, args, timeoutMs = PROBE_TIMEOUT_MS 10 000): message `omp-model-catalog-unavailable: <timeout Nms|output-limit|spawn <errno>|signal <name>|exit <code>>` + ` · stderr: <tail>` when non-empty; keeps last 4 KiB of stderr, tail ≤ 400 bytes on whole code points, \p{Cc} → space, whitespace collapsed, trimmed; stdout/env never included. -invalid unchanged (exit 0 + bad JSON).
- readOmpCatalog(installation, { timeoutMs? } = {}); readOmpModels at bd1ddc3 signature; updates.ts and ompSingleCall.ts byte-identical to bd1ddc3.
- fake-omp.mjs: opt-in <marker>.models.json {exitCode?, stderr?, hang?}; default unchanged.
- Existing tests assert these errors only by substring (ompCatalog.test.ts:59-60 toThrow("omp-model-catalog-invalid")).
- Criteria tests/agents/ompCatalogDiagnostics.test.ts C58a (exit 3 + stderr), C58b (timeout), C58c (bounded/sanitised tail); red 3/3 on base. Mutations M1 drop tail → C58a,C58c; M2 aborted reports exit → C58b; M3 no cap → C58c; restore 0/0.
- Gates: typecheck 0, build 0, tests/agents+runtime/omp+control 498/499 (endToEnd SIGKILL-boundary marker timeout, 3/3 alone).
