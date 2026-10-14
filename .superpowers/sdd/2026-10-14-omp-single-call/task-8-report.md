# Task 8 report (Orca): the estimate is sized and sent with the bound (criteria 8, 9)

Who: Task 8 implementer subagent, session 01NCgRiQLh17ENJdrmuJDcKL. When: 2026-10-14. BASE d6bdc9b3 -> commit 39f994c9.

## Status
DONE. Commit 39f994c9 `feat(control): size and send the estimate with the agent's own output cap when larger`
(files: src/control/estimator.ts, tests/control/singleCallOutputCap.test.ts; nothing else; worktree clean after commit).

## Changes
- src/control/estimator.ts: `import type { AgentResolution } from "./agentSelection.js"`; new export
  `singleCallOutputBound(preflightMaxOutputTokens, resolution)` = `Math.max(preflight, resolution?.singleCallOutputCap ?? 0)`;
  in `buildBudgetEstimateRequest`, `bound` feeds both `requiredRequestTokens` and the contract's `maxOutputTokens`.
  `tooLarge` line unchanged. Applied by anchor text (python exact-match, count==1 asserted).
- tests/control/singleCallOutputCap.test.ts: brief's four tests verbatim, plus (ruling I1) a NEW test
  "C8: the single-call envelope ESTIMATE.prepare sends carries the raised bound": copies the fixture's estimate record
  under id `estimate-cap` (estimateVersion 2, canonical body), persists the raised contract via persistEstimateArtifacts,
  calls `singleCallHandler("estimate").prepare(...)` and asserts the envelope's `maxOutputTokens` is 100 000.

## Evidence (commands redirected, read whole)
- RED: `./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts > /private/tmp/osc/logs/t8-red.log` rc=1;
  4 failed / 4 passed. Reds: C8 raised (64000 received), C8 envelope (envelope maxOutputTokens 64000 received -- red on
  the envelope assertion itself), C9 (state "queued"), bound fn ("singleCallOutputBound is not a function").
  "C8: no cap..." green pre-implementation as ruling m8 expects.
- GREEN: vitest on singleCallOutputCap, estimator, estimatePrompt, estimateSingleCallGate, estimatorCompatibility,
  driverEstimate, planImport, ccloopPort > /private/tmp/osc/logs/t8-green.log rc=0; 8 files, 111 passed, 0 failed, 0 skipped.
- `npm run typecheck > /private/tmp/osc/logs/t8-tc.log` rc=0.
- Staged diff: /private/tmp/osc/logs/t8-diff.log (8907 bytes).

## Concerns
- No existing test edited or reddened.
- The envelope test builds the second estimate record by copying the fixture's row (SQL insert in the test) rather than via
  a web command; it relies on the record decoder accepting the copied body (it does). Task 10's Menv should red it.
- The envelope test passes `{ store }` cast to SingleCallPrepareDeps (ESTIMATE.prepare reads only the store).
