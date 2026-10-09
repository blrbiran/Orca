# Task A7 report
Status: DONE. Commit eb6269c "docs: list what Web import requires, and give the README example its targetVersion" (README.md, docs/cli.md only).
- Implemented per brief: README §5 requirements list + `"targetVersion": 1` in the example; docs/cli.md new section "What Web import also requires" before "### Exit codes". Item names verified against src/scheduler/planFile.ts (all present).
- RED: `tsx $S/readme-plan.mjs` -> rc=1 `ControlError: control-plan-rejected:missing-target-version:a`. GREEN after edit: rc=0 `accepted`.
- Mutation (clone, README line deleted): rc=1 `missing-target-version:a`. Clone is under scratchpad/orca/A7/mut; worktree untouched by it.
- Deviation: script takes optional argv[2] README path (for the mutation run). Scratch script not committed.
- Concern: none. Other implementer's web/src changes were left uncommitted and unstaged (commit used --only on the two files).
