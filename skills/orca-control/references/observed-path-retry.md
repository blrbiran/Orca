# Observed path retry and bugfix split

Orca does not automatically retry a `blocked_waiting_human` run. Inspect `orca run show <run> --group <group>`.
If it lists `observed path misses`, review every repo-qualified path and then use
`orca task retry <group> <task> --allow-observed-paths`. The command adds exactly those reported paths under the
denylist, file-count and overlap checks. The caller cannot choose paths. Ordinary `task retry` keeps the old path
scope. If there is no typed evidence (for example an older ccloop), report this to the person instead of guessing
paths or blindly retrying. An Orca-dispatched run cannot use path expansion.

To let the same paths through for every task of the group, use `orca decision allow-paths <group> --run <run>`: it retries
this task now and records an allowance naming exactly those paths; Orca then retries any later task of the group blocked
on paths the allowance covers, once per run. `--one` retries only this task (as `--allow-observed-paths`). The group
detail lists the allowance; `orca decision revoke-allowance <group> <allow-n>` stops it for later tasks.

For a `bugfix` requirement split that asks for a new regression test, include a writable test path as well as the
source path. If that scope cannot be granted, choose a loop without reproduce-first or correct the split before
accepting it. A check command never grants write access.
