// Ruling: human 2026-11-17 (test pruning) -- some slow cases run only in the release gate's one whole-suite pass
// (scripts/verify-suite.mjs sets ORCA_RELEASE_GATE=1). Use as `it.runIf(releaseOnly)` / `describe.runIf(releaseOnly)`
// so a daily run still reports them as skipped, and name next to each such case the daily test that covers the same
// behaviour.
export const releaseOnly = process.env.ORCA_RELEASE_GATE === "1";
