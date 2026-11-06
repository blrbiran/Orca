# Check inputs are not check definitions (#198)

## Intent

A task that writes `README.md` and checks it with `grep ... README.md` should not pay for an automatic criteria review merely because its checked content changed. Orca must still flag a task that weakens a test, a package script, a workflow, or an actual check/setup script.

## Approaches

1. Exempt paths in the task's `targetPaths`: simple, but a task can also target and weaken its own test script. Rejected.
2. Decide from filename extensions: misses extensionless scripts and mistakes source files named in a check for check definitions. Rejected.
3. Read each command's role for path arguments: a path run directly or passed to a known interpreter is a check source; a path supplied to `grep` or another check as data is a checked input. Chosen. Dedicated test files, package scripts and CI workflows retain their existing independent guards.

## Behavior

- `checkPaths` identifies direct path commands, scripts passed to Node, Python, shell and similar interpreters, and explicit check configuration arguments. It ignores path-like data arguments such as `README.md` in `grep -q 'npm link' README.md`.
- `classifyCriteriaChange` and `runChecksAtBase` keep their existing signatures and decision semantics. A README-only edit under that check is `none`; changing `check.js` under `node check.js` remains `modified` or `weakening` as appropriate.
- A test file is always protected by its path shape even when a command only names it as data. A `package.json` script and CI workflow keep their special treatment.

## Limits

This is a bounded shell-command parser for common invocation forms, not a shell interpreter. Compound shell programs that dynamically construct or source a check file may need explicit project review. No existing flagged decision is rewritten.
