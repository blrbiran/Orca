# Plan: preserve complete requirement goals in the library

Spec: `docs/superpowers/specs/2026-11-07-plan-library-requirement-length-design.md`.

1. Add codec and library round-trip tests with a 2,231-character goal and 23 distinct success conditions; see them RED on the current 2,000/20 caps.
2. Remove only those two per-field ceilings in `src/control/planLibrary/codec.ts`. Keep nonempty validation, the task limit, canonical 2 MiB bound and import normalization.
3. Run focused plan-library and requirement split tests plus typecheck. Review the changed shape and commit locally; Orca push remains the owner's.
