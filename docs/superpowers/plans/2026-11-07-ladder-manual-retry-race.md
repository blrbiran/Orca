# Plan: serialize explicit retry with a confirmed ladder fix

Spec: `docs/superpowers/specs/2026-11-07-ladder-manual-retry-race-design.md`.

1. Add RED `systemDebug` criteria: no authored work for an automatic retry skips the ladder; a pre-existing debug fix does not fold into an unfundable parent. A confirmed or completed-but-unfolded ladder refuses a competing manual retry; a draft ladder remains supersedable. Reproduce archive during an awaited fold and manual retry during awaited draft confirmation.
2. Share the optional-v1 funding check with `retryTask`. Pass the ladder guard through Web service dependencies, keeping the control import cycle unchanged. Coordinate source identity across asynchronous fold work and recheck it in the debug confirmation transaction.
3. Run system-debug, retry, dogfood-related regressions and typecheck; review and commit. Keep the scratch dogfood's failure evidence unchanged.
