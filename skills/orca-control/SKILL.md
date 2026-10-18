---
name: orca-control
description: Use when operating Orca from an agent — reading task groups, opening requirements, answering clarifications, confirming or starting work — through the orca control CLI against a running panel.
---

# Operating Orca with `orca control`

You act as the panel's operator through two commands. The CLI is a passthrough: the panel validates everything.
Use the checkout's `node_modules/.bin/tsx src/cli.ts` for `orca`; this package declares no global binary. The
installed ccloop pin remains `ab824d1`, so a locally paired newer peer's saved-result features are not proof that a
running panel or the default install supports them.

```
orca control get <path> [--control-state-dir <dir>] [--client-name <name>]
orca control send <route> --expected-revision <n> (--payload '<json>' | --payload-file <file>) [--command-id <id>] [--control-state-dir <dir>] [--client-name <name>]
```

## Quick start: read, decide, send, read again

A **group** is a task plan plus its budget and execution history. A **task** is one planned work unit; a **run** is one
execution attempt. A **requirement** is the same group while an idea is clarified and split; accepting the split turns
it into a draft task group. Read the returned state rather than infer success from a command being accepted.

1. Read `config`, `summary` and `recovery`. Choose a concrete registered repository; never guess a filesystem path.
2. Open a requirement only with a single-call capable agent (the pinned Codex adapter lacks that capability), or import
   a registered plan. Read the group/requirement before each edit; use its current `commandRevision`.
3. Review task goals, acceptance, limits, optional token policy, workspace and integration. Check the effective worker,
   estimator and reconcile Agent selections, plus worker, handoff and goal-review profile bindings. Confirm the task
   plan with real profile/selection hashes from the reads, then send `groups/<id>/start` at the new revision.
   Confirmation and start are separate.
4. Poll `groups/<id>` every 30–60 seconds. The driver schedules dependencies within a started group automatically.
   A group's `state` stays `ready` while a Web-started first run is pending or executing; read `executionPending` on the group summary: while it is true the server refuses `start` with `group-execution-pending` (409); the group is already starting or running, and a second start is not needed.
5. On failure, read `groups/<id>`, `runs/<id>/activity`, `runs/<id>/evidence` and, for a saved execution failure,
   `runs/<id>/saved-result-eligibility`. Report the recorded phase, typed cause when present, raw code and run/attempt
   identity. Older unknown causes stay unknown; never infer token exhaustion from a decode error. Use only the
   evidence manifest's authorized routes. A successful command response does not prove provider completion.

Example diagnosis (replace ids with those returned by your reads):

```sh
orca control get summary
orca control get groups/<groupId>
orca control get runs/<runId>/activity
orca control get runs/<runId>/evidence
orca control get runs/<runId>/saved-result-eligibility
```

### Recovery decisions

- `revision-conflict`: read again and reconsider the action; never automatically bump a revision.
- `agent-version-drift`: ask the human to review `orca agents init`'s draft and reload the panel. Preserve their custom
  configuration; never remove the live table or restart the service yourself.
- A terminal failed task uses `groups/<groupId>/retry-task` with `{"taskId":"<taskId>"}` at the current group revision.
  A completed handoff-stopped failure may also become retryable after the stop is explicitly resumed. Unknown usage,
  pending events or insufficient budget still block it. `recovery-retry` does not substitute for failed-task retry.
- A completed handoff can be resumed with an explicit empty continuation selection when no run should continue;
  first read the current stop revision and epoch and use the payload table below. Never delete stop records in SQL.
- Unknown-usage settlement is **owner Web only**; socket/MCP operators must ask the human. Do not claim missing usage
  is zero or retry past an unresolved charge. The conservative charge is not provider-reported usage.
- Saved-result verification is a distinct action after the eligibility read says `eligible`; its source run, attempt
  and capsule hash come from that answer. It skips execution, but validation/verification may consume model usage.
  `unavailable` is a reason to inspect evidence or use an otherwise legal ordinary retry, not an invitation to guess
  source fields.
- `group-archived`: reads/evidence remain available. Unarchive deliberately before edits or new work. Never delete
  history or promise archive while a requirement call or stop remains in flight.
- A missing control plane, missing execution port, expired login and damaged recovery store are different problems;
  inspect the code/config and report the matching condition instead of recommending cookie resets for all of them.

The route and payload reference below is authoritative for this checkout. It includes access restrictions and schema
fields; a package version alone does not establish that another running panel supports the same commands.

## 1. Prerequisites

- A panel must already be running. You must never start a panel: no `orca panel`, no background process.
- `orca panel install|uninstall|start|stop|restart` change the human's running service. Never run them; ask the human. `orca panel status` is read-only and safe to run.
- `panel-not-running` (exit 1, retryable) means no panel answered on the socket. Ask the human to start it, then retry. Pass `--control-state-dir` only if the human says the panel uses a custom directory.

## 2. Reading

`get` takes a path without the `/api/control/` prefix; a query string is passed through.

- `summary` (or `summary?sinceChangeSeq=<n>`), `groups`, `groups/<id>`, `groups/<id>/requirement`, `groups/<id>/agent-preview`
- `recovery`, `config`, `agents`, `operator/agent-preferences`, `repositories/<id>/workspace`, `repositories/<id>/integration`, `runs/<id>/evidence` (manifest only; artifact downloads are refused with `control-cli-binary-route`), `runs/<id>/activity` (the newest 200 activity rows, newest first), `runs/<id>/saved-result-eligibility`
- Web owner-only read: `GET /api/control/operator/agent-installations`. The socket acts as Agent and returns `owner-required` for this route; it is not an `orca control get` path.
- `usage?scope=all|repo:<id>[&from=<ms>&to=<ms>][&groupBy=model|repo|day|week|month]`: `get usage?scope=all` reads tokens used per model and the caps (`orca-usage-view-v1`: `.headline` total/week/month, `.range.byModel`, `.caps[]` with `used`, `committed`, `headroom`, and `.spendRevision`)
- saved results: `groups/<id>/results`, `runs/<id>/results`, and `runs/<id>/results/outputs/<outputId>` (preview JSON). Binary `?download=1` is Web-only and refused by the CLI with `control-cli-binary-route`.
- a past command's retained result: see section 4

An existing run with no activity answers `{"schema":"orca-run-activity-v1","runId":"<id>","entries":[]}`. Missing
runs and malformed/unavailable rows are errors. The Web panel displays that newest window chronologically; neither
view promises the full run history.

### Saved result interpretation

In the Web panel, completed groups default to Results even when the explanation is missing. Open a task from
Progress and switch to Results for its run-specific saved read. Runs and evidence keeps the original downloads.
Task acceptance/outcome, execution, actual controller verification, Agent explanation, group goal review and Git
delivery are independent facts; do not infer pass from Agent prose or infer task failure from a missing report.
Verification `not-run` and `in-progress` require actual admitted controller lifecycle evidence. Damaged or unknown
evidence is `unavailable`.

`currentAttempt` may be null. Only the current attempt's explanation belongs in the current result; older attempts,
retry runs and continuation predecessors are saved history. A newer source attempt can remain current while its
capture/report is missing. Report the `source.status` and reason verbatim: `unsupported` means an old peer lacks the
optional result channel, while `stale`/`unavailable` describe acquisition problems, not a new missing task outcome.

Outputs are immutable execution snapshots, identified by run/generation/execution/attempt and snapshot revision;
later verifier observations can raise observation/capture revision without recapturing files. Preview is inert text,
including HTML/links/images. Safe binary or large saved outputs may still have authorized exact-byte Web downloads;
unsafe/refused outputs do not. Hidden panes make no result reads, and scope/auth/epoch changes retire requests.
Never request an extra summarizer, backfill historical acceptance, or substitute current-tree files for saved bytes.
The installed producer remains pinned at `ab824d1`; a local paired feature build is test evidence only. Producer
publication, package repin and production service changes are separate human release steps.

## 3. Writing

1. Read first and take the current revision from the body; section 9 says which read and which field, per route.
2. `orca control send <route> --expected-revision <N> --payload '<json>'`. Payload shapes are in the table (section 8).
3. `revision-conflict` (409) means state moved since you read. Re-read and decide again; do not blindly resend with a bumped number.
4. Other 4xx bodies name the panel's reason code; read it, do not retry the same payload.
5. A ccloop failure answers 424 `ccloop-failed` with ccloop's own code and detail in the message (`ccloop-failed:<code>[: <detail>]`); it is a definite refusal, not an uncertain outcome, so fix the cause that code names before sending again.

## 4. Retries and idempotency

- Without `--command-id` the CLI generates `cli-<uuid>` and returns it as `commandId` in the output envelope. Keep it.
- After a timeout (`control-socket-timeout`: the CLI waits 120 s) or any `retryable: true` error, keep the original
  command id, route, payload and expected revision. **Look up the retained result first**, even if the group appears
  missing. A found result resolves the outcome; do not send again.
- Look up the id under its original scope: group commands `groups/<groupId>/commands/<commandId>`; repository verbs
  (`set-workspace-mode`, `set-integration-scheme`) `groups/@repository:<repoId>/commands/<commandId>`; operator verbs
  (`set-agent-preferences`) `groups/@operator:<operatorId>/commands/<commandId>`; spend verbs (`set-spend-cap`,
  `clear-spend-cap`, `set-usage-calendar`) `groups/@spend/commands/<commandId>`.
- A lookup miss does not prove the command never ran. If a genuine group scope no longer exists, preserve the unknown
  outcome and do not automatically resend; a deliberate later check performs one new lookup. `@repository:`,
  `@operator:` and `@spend` are command scopes, never missing-group heuristics. After a confirmed ordinary lookup miss
  in a still-existing scope, an otherwise legal retry uses the **same** command id, route, payload and expected revision;
  a known-id replay cannot execute twice. If lookup itself fails, repeat the read before deciding on a send.

## 5. Long work

Runs take minutes to hours. Do not wait on a command. After `start` or `continue-task`, poll `get groups/<id>` every 30-60 s and act on what it shows.

## 6. What only a person does

The socket refuses these before anything runs (nothing is ledgered, the commandId is not burned):

- verb `set-limit` → 403 `control-verb-human-only`
- `requirement-open` with a `limit` field → 403 `control-field-human-only` (omit `limit`; the default applies)
- `proposal-edit` with a `proposedGroupLimit` field → 403 `control-field-human-only`
- the spend-cap verbs are owner-only: `set-spend-cap`, `clear-spend-cap`, `set-usage-calendar` → 403 `control-verb-human-only`
- `set-integration-scheme`, `set-group-integration`, `retry-integration` and `resolve-integration-conflict` (where a repository's or a group's finished work is carried: a local branch, a push, a GitHub PR; retrying a blocked integration; approving an agent to resolve an integration conflict) are owner-only → 403 `control-verb-human-only`. Confirming a group whose integration is not `keep` is owner-only (the `integrationHash` field is human-only).
- `approve-pending-decision` (giving a decision a landing refused an executable `undo.how` and writing it into the ledger) is owner-only → 403 `control-verb-human-only`.

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
- `control-socket-error` is any other transport failure (`<code>: <message>`). A dropped connection (`ECONNRESET`, `EPIPE`) and `control-cli-response-invalid` are retryable because the command may have run: retain its id and follow the result-first lookup above.
- Parse stdout; stderr is free-form diagnostics.

## 8. Route table

`<param>` segments are filled with real ids. Payloads are minimal valid examples; ids, hashes and versions are placeholders (take real values from `get groups/<id>`; each `aaaa…` hash is 64 lowercase hex). `set-limit`, `repositories/<repoId>/integration`, `groups/<groupId>/integration`, `groups/<groupId>/integration/retry`, `groups/<groupId>/integration/resolve`, `groups/<groupId>/decisions/approve` and the three `operator/set-spend-cap`, `operator/clear-spend-cap`, `operator/set-usage-calendar` rows are listed for completeness and are owner-only (section 6).

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
| `POST groups/<groupId>/tasks/<taskId>/verify-saved-result` | verify-saved-result | `{"sourceRunId":"run1","sourceAttempt":1,"capsuleHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` |
| `POST groups/<groupId>/settle-unknown-usage` | settle-unknown-usage | `{"taskId":"a","runId":"run-a","generation":1,"acknowledge":"charge-remaining-grant"}` |
| `POST requirements` | requirement-open | `{"groupId":"g1","repoId":"r1","idea":"what to build"}` |
| `POST groups/<groupId>/requirement/answer` | requirement-answer | `{"roundNo":1,"answers":[{"id":"R1.Q1","kind":"recommended"},{"id":"R1.Q2","kind":"text","text":"my answer"}],"glossaryDecisions":[],"adrDecisions":[]}` |
| `POST groups/<groupId>/requirement/consensus` | requirement-consensus | `{"roundNo":1}` |
| `POST groups/<groupId>/requirement/feedback` | requirement-draft-feedback | `{"draftNo":1,"feedback":"what to change"}` |
| `POST groups/<groupId>/requirement/accept` | requirement-draft-accept | `{"draftNo":1,"draftHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` |
| `POST groups/<groupId>/integration` | set-group-integration | `{"integration":{"delivery":"keep"}}` |
| `POST groups/<groupId>/integration/retry` | retry-integration | `{}` |
| `POST groups/<groupId>/integration/resolve` | resolve-integration-conflict | `{}` |
| `POST groups/<groupId>/archive` | archive-group | `{}` |
| `POST groups/<groupId>/unarchive` | unarchive-group | `{}` |
| `POST groups/<groupId>/decisions/approve` | approve-pending-decision | `{"pendingId":"pending-run-x-0","undoHow":"git revert --no-edit <sha>"}` |
| `POST recovery/retry` | recovery-retry | `{"scope":"run","runId":"run1"}` |
| `POST repositories/<repoId>/workspace-mode` | set-workspace-mode | `{"workspaceMode":"worktree"}` |
| `POST repositories/<repoId>/integration` | set-integration-scheme | `{"integration":{"delivery":"keep"}}` |
| `POST operator/agent-preferences` | set-agent-preferences | `{"preferences":{"perAgent":{}}}` |
| `POST operator/set-spend-cap` | set-spend-cap | `{"scope":"all","period":"week","tokens":5000000}` |
| `POST operator/clear-spend-cap` | clear-spend-cap | `{"scope":"all","period":"week"}` |
| `POST operator/set-usage-calendar` | set-usage-calendar | `{"timeZone":"UTC","weekStart":1}` |

Notes: `recovery-retry` also takes `{"scope":"group","groupId":"g1"}`. `handoff-stop` takes an optional `handoffDeadlineAt` (UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`). A spend cap's `scope` is `all` or `repo:<repoId>` and its `period` is `total`, `week` or `month` (weeks and months in the usage calendar's time zone). Examples are checked against the raw payload schemas only; the panel also judges live state, so versions, hashes and ids must be real (for example a `set-task-loop` plan must exist, and a `proposal-edit` operation with provenance `model` needs an `estimateId`). `retry-task` starts again a task whose current run ccloop ended failed (in `get groups/<groupId>`, the current run has a non-succeeded `outcome` and is either terminally `blocked`, an eligible held `settled-recoverable` failure after handoff, or an eligible released `settled-failed` failure with a valid usage settlement): the run becomes `settled-failed` and a new run starts from the group branch's current head; any other task is refused with `task-not-retryable` (409). `recovery-retry` refuses such a run with `run-terminal-failed` (409) and still resumes a run blocked for any other reason. An archived group keeps every record and refuses every command but `unarchive-group` with `group-archived` (409); reads are unchanged and it is never claimed or integrated. `archive-group` is refused while the group still has work in motion: `archive-run-active`, `archive-stop-pending` (a handoff or shutdown stop still `handoff-pending` or `handoff-unresolved`; `handoff-complete` and `handoff-partial` allow archive; a pause never blocks), `archive-integration-resolving`, `archive-call-in-flight` (an estimate or requirement call).

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

D9 (2026-10-09, Codex implement_settlement, base 2c14e73): `settle-unknown-usage` is owner-only in an authenticated Web session. Member and socket/MCP agent calls receive 403 `control-verb-human-only`. The acknowledgement is not authentication. It conservatively charges both remaining grants and cannot be undone; use the Web read preview to see the amount.
