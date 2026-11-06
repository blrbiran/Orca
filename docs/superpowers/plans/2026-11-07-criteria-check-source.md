# Plan: classify check sources by command role

Spec: `docs/superpowers/specs/2026-11-07-criteria-check-source-design.md`.

1. Add a real-commit regression to `tests/control/criteriaProtection.test.ts`: `grep -q 'npm link' README.md` with a README edit returns `none`, while `node check.js`, test files and setup scripts remain protected. Run it RED.
2. Replace the path-token sweep in `src/control/criteriaProtection.ts` with a small command-role parser. Do not infer a file is a check definition just because a check reads it. Run the focused suite GREEN.
3. Run `tests/control/criteriaBaseRun.test.ts`, root typecheck and affected tests. Compare any load red on the changed tree and untouched main clone before registration. Commit locally; Orca push remains the owner's.
