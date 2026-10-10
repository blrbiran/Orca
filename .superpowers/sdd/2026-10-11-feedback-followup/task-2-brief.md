### Task 2: Deterministic preview-backoff clock criteria

**Files:** `web/tests/agentPreviewRefresh.test.tsx`, optional focused test-only clock helper; no product polling/reducer rewrite.
**Interfaces:** Consumes baseline/diagnosis logs; preserves actual 10/20/40/80/160-second retry behavior, five retries, stopped state, manual read and renewed round.
- [ ] Step1: Instrument in independent clone the exact long-advance boundary and unrelated polling count; preserve baseline full-Web two named timeout logs. Establish expected failure/mechanism before helper change, not deadline raise.
- [ ] Step2: Use explicit React act/flush; asynchronous advancement where next retry effect must schedule, synchronous advancement with settled microtasks for stopped/successful long quiescence. Do not run all perpetual timers or stub business preview timers.
- [ ] Step3: Preserve every business assertion; name both rewritten tests in report and their original ruling. Mutate retry delay, bound and manual read in clone; each intended criterion must fail.
- [ ] Step4: Run focused file and full Web unchanged15s deadline/no skips, typecheck. Commit `test(web): advance preview backoff without unrelated async clock churn`, independent review.

