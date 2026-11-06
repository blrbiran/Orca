# Plan: stop treating terminal blocked runs as live execution

Spec: `docs/superpowers/specs/2026-11-07-terminal-blocked-slot-resume-design.md`.

1. Add RED tests using a real control store: blocked run, pause, resume returns a named `resumed` response with no pending wake, and `runningGroupIds` frees the slot; a running run still holds it.
2. Update `nothingToResume`, the `resumed` result schema and the one-query slot projection. Do not import the execution driver into the stop/orchestration modules.
3. Run stop intent, orchestration, retry, panel and typecheck gates. Compare load reds with untouched main before registration; review and commit locally.
