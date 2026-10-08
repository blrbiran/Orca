---
name: orca-control
description: Use when operating Orca from an agent — reading task groups, opening requirements, answering clarifications, confirming or starting work — through the orca control CLI against a running panel.
---

# Operating Orca with `orca control`

You act as the panel's operator through two commands. The CLI is a passthrough: the panel validates everything.

```
orca control get <path> [--control-state-dir <dir>] [--client-name <name>]
orca control send <route> --expected-revision <n> (--payload '<json>' | --payload-file <file>) [--command-id <id>] [--control-state-dir <dir>] [--client-name <name>]
```

## 1. Prerequisites

- A panel must already be running. You must never start a panel: no `orca panel`, no background process.
- `orca panel install|uninstall|start|stop|restart` change the human's running service. Never run them; ask the human. `orca panel status` is read-only and safe to run.
- `panel-not-running` (exit 1, retryable) means no panel answered on the socket. Ask the human to start it, then retry. Pass `--control-state-dir` only if the human says the panel uses a custom directory.

## 2. Reading

`get` takes a path without the `/api/control/` prefix; a query string is passed through.

- `summary` (or `summary?sinceChangeSeq=<n>`), `groups`, `groups/<id>`, `groups/<id>/requirement`, `groups/<id>/agent-preview`
- `recovery`, `config`, `agents`, `operator/agent-preferences`, `repositories/<id>/workspace`, `repositories/<id>/integration`, `runs/<id>/evidence` (manifest only; artifact downloads are refused with `control-cli-binary-route`), `runs/<id>/activity` (the run's newest 200 activity rows)
- `usage?scope=all|repo:<id>[&from=<ms>&to=<ms>][&groupBy=model|repo|day|week|month]`: `get usage?scope=all` reads tokens used per model and the caps (`orca-usage-view-v1`: `.headline` total/week/month, `.range.byModel`, `.caps[]` with `used`, `committed`, `headroom`, and `.spendRevision`)
- a past command's retained result: see section 4

## 3. Writing

1. Read first and take the current revision from the body; section 9 says which read and which field, per route.
2. `orca control send <route> --expected-revision <N> --payload '<json>'`. Payload shapes are in the table (section 8).
3. `revision-conflict` (409) means state moved since you read. Re-read and decide again; do not blindly resend with a bumped number.
4. Other 4xx bodies name the panel's reason code; read it, do not retry the same payload.

## 4. Retries and idempotency

- Without `--command-id` the CLI generates `cli-<uuid>` and returns it as `commandId` in the output envelope. Keep it.
- After a timeout (`control-socket-timeout`: the CLI waits 120 s) or any `retryable: true` error, resend the same route and payload with `--command-id <the same id>`. A replay of a known id never executes twice.
- To check a result, `get` the command under its scope: group commands `groups/<groupId>/commands/<commandId>`; repository verbs (`set-workspace-mode`, `set-integration-scheme`) `groups/@repository:<repoId>/commands/<commandId>`; operator verbs (`set-agent-preferences`) `groups/@operator:<operatorId>/commands/<commandId>`; spend verbs (`set-spend-cap`, `clear-spend-cap`, `set-usage-calendar`) `groups/@spend/commands/<commandId>`.
- A lookup miss does not prove the command never ran: a group-scope miss answers `command-result-not-found`, and an `@repository:`, `@operator:` or `@spend` miss currently answers `group-not-found` (those scopes have no group row). On any miss, resend the original command with the same `--command-id` and the same payload rather than infer absence; the replay either returns the retained result or executes it once.

## 5. Long work

Runs take minutes to hours. Do not wait on a command. After `start` or `continue-task`, poll `get groups/<id>` every 30-60 s and act on what it shows.

## 6. What only a person does

The socket refuses these before anything runs (nothing is ledgered, the commandId is not burned):

- verb `set-limit` → 403 `control-verb-human-only`
- `requirement-open` with a `limit` field → 403 `control-field-human-only` (omit `limit`; the default applies)
- `proposal-edit` with a `proposedGroupLimit` field → 403 `control-field-human-only`
- the spend-cap verbs are owner-only: `set-spend-cap`, `clear-spend-cap`, `set-usage-calendar` → 403 `control-verb-human-only`
- `set-integration-scheme`, `set-group-integration`, `retry-integration` and `resolve-integration-conflict` (where a repository's or a group's finished work is carried: a local branch, a push, a GitHub PR; retrying a blocked integration; approving an agent to resolve an integration conflict) are owner-only → 403 `control-verb-human-only`. Confirming a group whose integration is not `keep` is owner-only (the `integrationHash` field is human-only).

Do not look for a way around them. Ask the human. To spend less, use `pause-dispatch` or `handoff-stop`.

The panel enforces this at every interface: the socket's agent can never do a human-only action, and the Web UI requires a logged-in owner. It is a boundary at the panel's interfaces, not against a process that edits Orca's files (accounts spec §2).

An agent's `import-plan` or `requirement-draft-accept` whose group limit would exceed the spend-cap headroom answers 403 `control-limit-over-cap-headroom`; a group waiting on a cap shows `spendCapBlock` (`spend-cap-reached`) and resumes by itself when the cap is raised or a new period starts.

## 7. Output and exit codes

stdout is exactly one JSON line:

```json
{"schema":"orca-cli-response-v1","status":200,"commandId":"cli-…","body":{…}}
```

- `status` is the panel's HTTP status, or `0` for a local refusal. `commandId` is present for `send` only. `body` is the panel's body verbatim; a local refusal is `{"error":{"code","message","retryable"}}`.
- Exit `0`: the panel answered 2xx. `1`: refused locally (bad arguments, `panel-not-running`, `control-socket-timeout`, `control-socket-error`, path problems). `2`: the panel answered non-2xx (the body names the code and `retryable`). `3`: reserved for a crash (an unexpected error; stdout may then be empty).
- `control-socket-error` is any other transport failure (`<code>: <message>`). It is retryable when the connection dropped (`ECONNRESET`, `EPIPE`): the command may have run, so resend it with the same `--command-id`. `control-cli-response-invalid` (the panel's body was not JSON) is retryable for the same reason.
- Parse stdout; stderr is free-form diagnostics.

## 8. Route table

`<param>` segments are filled with real ids. Payloads are minimal valid examples; ids, hashes and versions are placeholders (take real values from `get groups/<id>`; each `aaaa…` hash is 64 lowercase hex). `set-limit`, `repositories/<repoId>/integration`, `groups/<groupId>/integration`, `groups/<groupId>/integration/retry`, `groups/<groupId>/integration/resolve` and the three `operator/set-spend-cap`, `operator/clear-spend-cap`, `operator/set-usage-calendar` rows are listed for completeness and are owner-only (section 6).

| Route | Verb | Payload example |
| --- | --- | --- |
| `POST groups/import-plan` | import-plan | `{"groupId":"g1","repoId":"r1","planId":"p1"}` |
| `POST groups/<groupId>/proposal/edit` | proposal-edit | `{"baseProposalVersion":1,"operations":[{"target":{"scope":"task","taskId":"t1","allocation":"work","dimension":"tokens"},"value":500000,"provenance":"human"}]}` |
| `POST groups/<groupId>/proposal/agent` | proposal-set-agent | `{"baseProposalVersion":1,"scope":{"kind":"group","slot":"worker"},"partial":null}` |
| `POST groups/<groupId>/estimates` | estimate | `{"proposalVersion":1,"estimatorProfileId":"e1","estimatorProfileHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","estimateMode":"soft"}` |
| `POST groups/<groupId>/confirm` | confirm | `{"planHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","proposalVersion":1,"budgetMode":"strict","profileIds":{"estimator":"e1","worker":"w1","handoff":"h1","goalReview":"gr1"},"profileHashes":{"estimator":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","worker":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoff":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","goalReview":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"contextPolicy":{"handoffAtContextTokens":null},"selectionsHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` |
| `POST groups/<groupId>/set-limit` | set-limit | `{"limit":{"tokens":1000000,"activeMs":3600000,"attempts":10,"sessions":10}}` |
| `POST groups/<groupId>/start` | start | `{}` |
| `POST groups/<groupId>/pause-dispatch` | pause-dispatch | `{}` |
| `POST groups/<groupId>/handoff-stop` | handoff-stop | `{}` |
| `POST groups/<groupId>/resume-dispatch` | resume-dispatch | `{}` |
| `POST groups/<groupId>/resume-from-handoff` | resume-from-handoff | `{"selections":[{"taskId":"t1","predecessorRunId":"run1","checkpointId":"cp1"}]}` |
| `POST groups/<groupId>/tasks/<taskId>/continue` | continue-task | `{"predecessorRunId":"run1","checkpointId":"cp1"}` |
| `POST groups/<groupId>/tasks/<taskId>/labels` | set-task-labels | `{"labels":["area:cli"],"baseLabelsVersion":0}` |
| `POST groups/<groupId>/tasks/<taskId>/loop` | set-task-loop | `{"baseLoopVersion":0,"plan":"standard","inputs":{"goal":"g","successCondition":"s","targetPaths":["src"],"checks":["npm test"],"nonGoals":[],"relevantDocs":[],"protectedPaths":[],"maxFilesTouched":null},"work":{"tokens":500000,"activeMs":600000,"attempts":3}}` |
| `POST groups/<groupId>/retry-task` | retry-task | `{"taskId":"t1"}` |
| `POST requirements` | requirement-open | `{"groupId":"g1","repoId":"r1","idea":"what to build"}` |
| `POST groups/<groupId>/requirement/answer` | requirement-answer | `{"roundNo":1,"answers":[{"id":"R1.Q1","kind":"recommended"},{"id":"R1.Q2","kind":"text","text":"my answer"}],"glossaryDecisions":[],"adrDecisions":[]}` |
| `POST groups/<groupId>/requirement/consensus` | requirement-consensus | `{"roundNo":1}` |
| `POST groups/<groupId>/requirement/feedback` | requirement-draft-feedback | `{"draftNo":1,"feedback":"what to change"}` |
| `POST groups/<groupId>/requirement/accept` | requirement-draft-accept | `{"draftNo":1,"draftHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` |
| `POST groups/<groupId>/integration` | set-group-integration | `{"integration":{"delivery":"keep"}}` |
| `POST groups/<groupId>/integration/retry` | retry-integration | `{}` |
| `POST groups/<groupId>/integration/resolve` | resolve-integration-conflict | `{}` |
| `POST recovery/retry` | recovery-retry | `{"scope":"run","runId":"run1"}` |
| `POST repositories/<repoId>/workspace-mode` | set-workspace-mode | `{"workspaceMode":"worktree"}` |
| `POST repositories/<repoId>/integration` | set-integration-scheme | `{"integration":{"delivery":"keep"}}` |
| `POST operator/agent-preferences` | set-agent-preferences | `{"preferences":{"perAgent":{}}}` |
| `POST operator/set-spend-cap` | set-spend-cap | `{"scope":"all","period":"week","tokens":5000000}` |
| `POST operator/clear-spend-cap` | clear-spend-cap | `{"scope":"all","period":"week"}` |
| `POST operator/set-usage-calendar` | set-usage-calendar | `{"timeZone":"UTC","weekStart":1}` |

Notes: `recovery-retry` also takes `{"scope":"group","groupId":"g1"}`. `handoff-stop` takes an optional `handoffDeadlineAt` (UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`). A spend cap's `scope` is `all` or `repo:<repoId>` and its `period` is `total`, `week` or `month` (weeks and months in the usage calendar's time zone). Examples are checked against the raw payload schemas only; the panel also judges live state, so versions, hashes and ids must be real (for example a `set-task-loop` plan must exist, and a `proposal-edit` operation with provenance `model` needs an `estimateId`).

## 9. Where the expected revision comes from

`--expected-revision` is checked against the revision of the command's scope; a stale number answers `revision-conflict` (409) with the current `commandRevision` in the error body.

| Route | `--expected-revision` |
| --- | --- |
| every `groups/<groupId>/…` route | `.summary.commandRevision` of `get groups/<groupId>`; for a clarifying group (its group view is refused) `.summary.commandRevision` of `get groups/<groupId>/requirement`; or that group's `.groups[].commandRevision` in `get summary` |
| `requirements` (requirement-open) and `groups/import-plan` | `0` for a groupId that does not exist yet; otherwise that group's `commandRevision` as above |
| `recovery/retry` | the `commandRevision` of the group it acts on: with `"scope":"group"` that `groupId`; with `"scope":"run"` the run's group (`get recovery` lists `.blockers[]` with `groupId` and `runId`; a clarifying group's blocked call is `.summary.requirement.blockedRun.runId` of `get groups/<groupId>/requirement`) |
| `repositories/<repoId>/workspace-mode` | `.revision` of `get repositories/<repoId>/workspace` (`orca-repository-workspace-v1`; `0` before the first change) |
| `repositories/<repoId>/integration` | `.revision` of `get repositories/<repoId>/integration` (`orca-repository-integration-v1`; the same revision as the workspace read: both settings share it) |
| `operator/agent-preferences` | `.revision` of `get operator/agent-preferences` (`orca-agent-preferences-v1`; `0` before the first change) |
| `operator/set-spend-cap`, `operator/clear-spend-cap`, `operator/set-usage-calendar` | `.spendRevision` of `get usage?scope=all` (one revision for all three; `0` before the first change) |

Where the ids come from:

- `repoId`: `get config` `.repositories[].repoId`.
- `planId`: `get config` `.plans[].planId` (each entry also names its `repoId`).
- `operatorId` (for `groups/@operator:<operatorId>/commands/<commandId>`): `get operator/agent-preferences` `.operatorId`.
- `groupId`: `get summary` `.groups[].groupId`; for `requirements` and `groups/import-plan` you choose a new one.
