# Troubleshooting

Hand-written. Find the code (`body.error.code` under `--json`, or the `orca: <code>:` line on stderr), then:

| You see | What it means | What to do |
|---|---|---|
| `panel-not-running`, `control-socket-error` on connect | no panel answers on the socket | `orca status`; tell the person. Never start the panel yourself. |
| `fail …` from `orca status` | a check failed | `orca doctor` prints one fix line per failure; pass it on to the person. |
| `revision-conflict` (409) | the state moved after your read (or your `--if-revision`) | Read again (`group show` …) and decide again. Never just bump the number. |
| `command-id-conflict` (409) | that command id was already used for a different request | Use a new id for a new request; to retry an uncertain one, `orca command retry --request` with the saved JSON. |
| a `request` field in the `--json` answer, `control-socket-timeout`, `retryable: true` | the outcome is uncertain: the command may have run | `orca command retry --request -` with that JSON on stdin. Do not re-run the command. |
| `control-person-token-required` (403) | a person's action (budget, caps, where work goes, …) | Ask the person: `orca login`, then the command with `--as-person`. |
| `control-person-token-invalid` (401) | the stored person token expired or was revoked | The person runs `orca login` again. |
| `control-dispatched-run-refused` (403) | you are a run Orca dispatched; it may not act as the person | Report what you would have done; do not retry. |
| `control-verb-human-only`, `control-field-human-only` (403) | a Web member, or an old surface, asked for an owner's action | Ask an owner. |
| `group-execution-pending` (409) on `group start` | the group is already starting or running | Poll `orca group show`; no second start is needed. |
| `group-archived` | archived groups refuse everything but `group unarchive` | Unarchive only if the person wants it back. |
| `task-run-moved` (409) on `task retry` | the task's current run changed since your read | `orca task show`, then decide again. |
| `run-terminal-failed`, `task-not-retryable` | which retry the failure takes | `orca run show` / `run eligibility`; see references/task.md. |
| `ccloop-failed` (424) | ccloop refused; its own code is in the message | Fix what that code names before sending again; it is not uncertain. |
| `spend-cap-reached`, `control-limit-over-cap-headroom` | a spend cap blocks the group or the import | Wait for the next period, or ask the person to raise the cap. |
| `agent-version-drift` | an agent CLI changed under the table | Ask the person to review `orca agent init`'s draft; never edit or remove the table yourself. |
| `did you mean orca …?` (exit 1) | an unknown command | Use the suggested command; `orca help` lists them. |

Every refusal code and its HTTP status: error-codes.md. Exit codes and the `--json` envelope: output-and-exit-codes.md.
