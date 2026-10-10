# Task 3 fix round 1 — independent scoped re-review

Reviewed `91c0a7559b50a35f34a70a33f300e62ee0693dd3..5b0adea413b885a1151259d5eb88d21eedcc2ce0` in `/private/tmp/ccloop-feedback-followup-20261011`. Scope: the six-file fix diff, original Important I1/I2, and new breakage in those changes. Read the Task 3 brief/global constraints, full fix-report appendix, fix evidence manifest, actual changed tests and immediate producer/reader call paths. No source/index/HEAD modifications, new test runs, suites, or subagents were used.

**SPEC: ✅ Approved for this scoped fix. QUALITY: Approved.**

- **Important I1: ADDRESSED.** `src/control/materialize.ts:208` now rejects a saved handoff whose workItemId differs from the new claim. The new named test changes only that work-item value while preserving the other authority. Its passing evidence and the work-item deletion mutant directly cover the original omission.
- **Important I2: ADDRESSED.** `src/control/worker.ts:286` freezes the known source usage ledger after phase settlement and before repository materialization or the mechanical handoff event. `src/control/handoff.ts:337` places the new required `allowanceContinuation.usage` ref into the same handoff artifact closure. `src/control/materialize.ts:224` reads that ref through the existing closure and manifest/hash checks. `src/control/usage.ts:240` validates finite usage schema, source run/generation, contiguous sequence/high-water, known work observations and final cumulative agreement with work totals; the reader also binds attempts to saved state. `src/control/materialize.ts:231` checks all four inherited dimensions against source inherited plus source-local usage and rejects unsafe sums. Replayed plan/execution token fields are not added again.

The actual tests now cover foreign work item; token/time rollback below prior lineage; omitted local token/time consumption and exact covered totals; unknown, foreign-run/generation, unsafe-sum and unreachable usage evidence; and reuse without charging saved phase usage. The real fake-provider worker case retains 1,600,000 observed tokens under a 1,500,000 allowance, verifying that the retained ledger preserves soft overshoot. The approved v4 usage-ref refinement is recorded in the report. Consumers must archive this ref with the already-required handoff closure.

**Critical:** None found.

**Important:** No remaining findings in the scoped fix.

**Minor:** None raised.

## Evidence

The review package's diff payload matches the exact Git diff with its ten-line context. All six file SHA256 values match the manifest. Recomputed full runner source digest is `0f4a924fd2f9cc08f7761dac5685064b09acfb5b691d7f709a8012441ae415ae`, matching all final gates. HEAD is the stated fix commit; source status remains only `?? node_modules`.

Read the supplied full/native/typecheck/targeted raw logs and inspected actual test assertions. All recorded raw-log hashes and sizes match the manifest. Full-suite JSON independently confirms 1,424 passed, zero failed/pending; native build/control evidence records 670 passed, zero skipped; typecheck RC 0; targeted cases 33 passed. The six scoped deletion mutation results record RC 1 and restored tracked/staged diff sizes 0/0, covering identity, token/time dimensions, source-local and prior contributions, and usage-ref closure membership. Existing tests were strengthened without relaxing their assertions.

No named unresolved code doubt required another test run. This approval closes I1/I2 and reports no new breakage in the six-file fix; final integration and cross-repository acceptance remain the controller's subsequent gates.
