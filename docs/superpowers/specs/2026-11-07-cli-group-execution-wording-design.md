# Name live execution in group CLI output (dogfood D9)

## Intent

A group can store `ready` or `review` while one of its task runs is executing. In the real dogfood, `group show --json` said `ready` with two active tasks in execute. A person reading `group list` or `group show` should see that execution is in progress.

## Approaches

1. Rewrite the stored group state: changes scheduler and historical semantics. Rejected.
2. Change JSON `summary.state`: hides the stored value and alters the API contract. Rejected.
3. Keep JSON exact, but add a human CLI execution qualifier based on the summary's running count and the group's live task runs. Chosen.

## Behavior and limit

`group list` prints `ready · running 1 task` (or `review · running N tasks`) when `counts.running` is positive. `group show` appends `execution: N task run(s) in progress` for live work runs. Blocked and settled runs do not count. JSON readers continue to see the stored state and should inspect `counts`, work items and runs for execution status.
