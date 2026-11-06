# Terminal blocked runs do not occupy execution slots (#172)

## Intent

A paused group with a terminal blocked work run must not answer `group resume` with a scheduled wake that immediately becomes idle. A blocked run is not driven by the execution driver, so it must not reserve a scarce group execution slot while waiting for a person or agent to settle usage or retry the task.

## Approaches

1. Settle every terminal failure in the driver (#169 root fix): desirable, but changes reservation, retry and saved-result accounting together. Separate work.
2. Treat a blocked run as waiting for action in resume and slot queries, without rewriting its historical run or its accounting. Chosen for #172 and the slot deadlock.
3. Automatically retry when the wake is idle: repeats the same failure and violates the blocked-waiting-human rule. Rejected.

## Behavior

- An active run whose stored state is `blocked` counts as no currently executing run. A busy task whose sole current active run is blocked likewise counts as no execution-slot holder. A malformed run body stays conservatively counted.
- `resume-dispatch` lifts a pause on such a started group and returns `resumed` with `waitingOn: "blocked-task"`, without arming a start wake. A started group with live work still follows its existing scheduled path; a group with claimable ready work still gets a wake.
- `retry-task` and usage settlement retain their existing guards and release rules. This change does not rewrite old run rows or alter their `active` bit. A later explicit retry makes the task ready and the existing scheduler may claim it under the normal slot cap.

## Limits

This closes the silent resume and occupied-slot behavior. A blocked run still needs the separate #169 settlement/archive design before `group archive` can accept its active row.
