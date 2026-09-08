# Orca

Orca is subsystem C of the A′ decision-ledger design: a scheduler that runs a
plan of tasks over ccloop (a sibling repository), reconciles their results
against a shared work branch, and records every scheduling and reconciliation
choice it makes into an append-only decision ledger (`.decisions/*.jsonl`).

## `orca plan` and `orca run`

```
orca plan <path> [--verbose]
orca run <path> --adapter-config <path> [--adapter scripted|claude] [--keep-workdirs] [--serial] [--verbose]
```

`orca plan` reads a plan file, computes every task's write set, builds the
task graph, layers it, and prints a report — write sets, intersecting pairs,
layers, and any up-front rejections. It touches nothing in the target
repository beyond read-only git calls (`git rev-parse`, `git status
--porcelain`) — no branch is created, no commit is made, no ref moves.

`orca run` prints that exact same report first (`plan` is not a second
implementation of `run`'s front half — it *is* that front half, so the two
can never drift apart), then actually executes: it spawns ccloop once per
task, harvests and reconciles each result, lands what can be landed onto the
work branch, and reports the round's outcome. `--serial` turns all
parallelism off (a v1 correctness criterion, not a performance knob) so a
serial run's result can be checked against a parallel one on the same plan.
`--keep-workdirs` keeps every task's copy on disk, including the successful
ones, instead of deleting only the successful ones once their result has
landed.

### The plan file's shape

```jsonc
{
  "targetRepo": "/absolute/path/to/the/repo/orca/schedules",
  "ccloopBin": "/absolute/path/to/ccloop/dist/cli.js",
  "runsDir": "/absolute/path/outside/targetRepo/for/run/copies",
  "workBranch": "orca/w/some-round",
  "policy": "local-merge",
  "ledgerMode": "in-repo",
  "tasks": [
    { "taskId": "T1", "contract": "/absolute/path/to/T1-contract.json", "dependsOn": [] },
    { "taskId": "T2", "contract": "/absolute/path/to/T2-contract.json", "dependsOn": ["T1"] }
  ]
}
```

- `targetRepo` — the repository the round lands work into. Orca checks this
  repository's own worktree out onto `workBranch` and merges into it; it
  never touches the base branch it cut `workBranch` from.
- `ccloopBin` — ccloop's `dist/cli.js`, spawned as a subprocess (ccloop's
  `package.json` is `private: true` and its `bin` is never an npm
  dependency).
- `runsDir` — outside `targetRepo`, where each task's throwaway clone and any
  escalation files live.
- `workBranch` — the branch every task's result is merged into (`W`). It is
  cut from **the branch the target repository currently has checked out** —
  Orca does not resolve the repository's true default branch, so running it
  while sitting on `feature/x` cuts `W` from `feature/x`. It must not already
  exist and must not be that base branch.
- `ledgerMode` — `"in-repo"` is implemented. `"out-of-repo"` is accepted by
  the schema (spec §8.5) but rejected at run time with exit 1, the same
  treatment an unsupported `policy` value gets: recognised but not yet
  built, refused loudly rather than silently downgraded.
- `tasks[].contract` — every contract file must live outside `targetRepo`
  (one of the up-front rejections below); Orca reads it as opaque,
  unvalidated JSON and derives each task's write set from
  `context.targetPaths ∪ safetyPolicy.allowlistPaths`.

### The up-front rejections

Seven are evaluated purely from the plan file's own content, before any git
call is made against the target repository. (Spec §9.1(4) counts nine
altogether; `unusable-task-id` was added by the final whole-branch review as
a seventh plan-level check, so the count is now ten — recorded here as an
erratum against the spec's number rather than left to be discovered.)

| Code | Meaning |
|---|---|
| `relative-path` | a path field (`ccloopBin`, `runsDir`, a task's `contract`) is not absolute |
| `duplicate-task-id` | two tasks in the plan share a `taskId` |
| `cycle` | the task graph (explicit `dependsOn` plus implicit write-set edges) has a cycle |
| `contract-inside-target-repo` | a task's contract file lives inside `targetRepo` |
| `work-branch-is-default` | `workBranch` names the base branch (the one the target repository currently has checked out) |
| `unsupported-policy` | `policy` is anything other than `"local-merge"` |
| `unusable-task-id` | a `taskId` cannot become a run id (spec §2.1 derives `orca-<taskId>-<hash8>`, and the ledger requires `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`) |

An eighth plan-level rejection, `unreadable-contract`, is reported the same
way and at the same point: a task's `contract` path that cannot be read, or
whose content is not valid JSON. It is not in the table above because it is
not decidable from the plan file's own bytes — it needs one `readFile` per
task.

Three more are runtime checks — a read-only `git rev-parse` or `git status
--porcelain` against the target repository, which does not count as
"touching" it, so `orca plan` evaluates these for real too, not just
`orca run`:

| Code | Meaning |
|---|---|
| `work-branch-already-exists` | `workBranch` already exists in the target repository |
| `base-not-a-commit` | the base branch does not resolve to a real commit yet |
| `dirty-worktree` | the target repository's worktree has uncommitted changes, or its cleanliness cannot be read at all (`targetRepo` is not a git repository) |

A plan file that fails to parse at all (malformed JSON, or the wrong shape)
is reported as `malformed` and is not one of these — it means there is no
plan to evaluate them against yet.

Any rejection, plan-level or runtime, makes both `orca plan` and `orca run`
exit 1 (spec §9.3). A *warning* — a plan that is legal but fully serial, say
— does not affect the exit code.

### Exit codes

Every task and every round-level event contributes one of four values, and
the round's exit code is whichever contribution is the most severe, in the
order **3 > 2 > 1 > 0**:

- **0** — nothing failed and nothing needed a human. The round completed
  cleanly.
- **1** — the round was refused before it started: an unreadable or
  malformed plan file, a missing `--adapter-config`, an unimplemented
  `ledgerMode`, a repository lock that could not be acquired (another `orca`
  process already holds it), or any of the up-front rejections above.
- **2** — an ordinary failure, or a decision that was still safe to make on
  its own: a task's net change set was empty (`succeeded_but_empty`), a task
  failed or exhausted its attempts, or a task landed despite writing outside
  its declared write set but touched nobody else's declared claims (a
  tier-1 `boundary` decision, recorded in the ledger).
- **3** — an escalation: a human has to come back and look. This covers an
  out-of-bounds write that collides with a sibling task's declared write set
  in the same layer, a merge conflict whose reconciliation could not be
  synthesized or verified, a task ccloop reports `blocked_waiting_human`
  (which is a terminal, non-resumable state in ccloop — not something Orca
  retries), or an exception that escaped the round entirely.

### The escalation file

Whenever a round contributes exit code 3 for a reason that has both sides'
intent and conflict blocks to report — a merge conflict Orca could not
reconcile automatically, or a task that wrote outside its declared write set
into a path a sibling task also declared — Orca writes
`<runsDir>/escalations/<runId>.md` and prints its path. It contains, in this
order: why a human has to look, what each side's contract declared as its
goal and success condition, the conflicted paths or blocks, and an
executable `undo.how`/cost/blast-radius for cleaning up the kept copies. It
is written under `runsDir`, never onto the work branch — the work branch is
a code branch, and this is a process file for a human, not a decision to
bind a commit to.

A round that escalates because a task reported `blocked_waiting_human` gets
**no** escalation file: the file's mandated content — both sides' intent and
the conflict blocks — does not exist for a single task that is simply
waiting on a person, so there is nothing honest to put in one. The round
still contributes exit code 3, keeps the task's copy, and prints where it
is.

## `orca correct`

```
orca correct --decision <run-id>/<n> --kind wrong|not_my_taste|stale --because <text>
             [--repo <path>] [--by <who>] [--again] [--record-only]
             [--chose-instead <text> --undo-how <text> [--undo-cost <text>] [--undo-blast-radius <text>]]
orca correct --close <correctionId> --undo-how <text> [--repo <path>] [--chose-instead <text>]
```

A correction records a human overturning a past decision. There are two
modes:

- **Record-only** — write the correction into the corrections store and stop
  there. This is what happens when neither `--chose-instead` nor
  `--undo-how` is given, or when `--record-only` is passed explicitly (which
  forces record-only even if `--chose-instead` is given alongside it, for
  the case where the alternative is already known but the undo plan is
  not). `--decision` names the decision being corrected
  (`<run-id>/<n>`, the same id a `decision` ledger row carries); `--again`
  says "yes, record a second correction against the same decision by the
  same person on purpose" — without it, a repeat is refused rather than
  silently duplicated. `--by` defaults to `git config user.name`.
- **Closing the loop** — giving *either* `--chose-instead` or `--undo-how`
  expresses the intent to close, and then both are required (a typo in one
  no longer silently falls back to record-only). Closing derives two rows —
  a new `decision` and an `overturned` referencing the one it replaces —
  writes them to the target repository's `.decisions/orca-fix-<hash8>.jsonl`
  in one append, and commits just that one file on the branch the repository
  currently has checked out, leaving the rest of the person's staging area
  untouched.
- **`--close <correctionId>`** re-opens the closing half of a correction that
  was already recorded (by a prior record-only run, or by a `--close` that
  landed the ledger rows but failed to commit — see exit 5 below). It cannot
  be combined with `--decision`, `--kind`, `--because`, or `--again` — those
  already live on the stored row — and `--chose-instead` may only supply a
  value the stored row is missing, not override one it already has.

Running the same closing command twice is safe: the second run recognises
the correction is already recorded (or already committed) and refuses or
no-ops rather than writing a second `overturned` row into the append-only
ledger.

### Exit codes

- **0** — the correction was recorded, or the loop was closed and committed
  (including the no-op case: this exact correction was already closed).
- **1** — the input was refused: bad or missing arguments, an unknown
  `--decision`, a correction already recorded (without `--again`), a
  `--close` argument conflict, the target repository mid-merge/rebase/
  cherry-pick or on a detached HEAD, or any other named rejection — the
  message says which.
- **3** — an exception nobody anticipated (the same top-level handler `orca
  plan`/`orca run` share).
- **4** — another `orca` process holds the target repository's lock;
  transient, retry later.
- **5** — the ledger rows landed on disk and were staged, but the commit
  itself was refused (e.g. a hook rejected it); re-run the exact same
  `--close` command to finish just the commit, without writing the rows a
  second time.

This scale is `orca correct`'s own — it does not reuse `orca plan`/`orca
run`'s 0/1/2/3. `orca validate` has a separate scale of its own too: 0 (all
ledger files ok), 1 (a file was rejected or none were found), and 2 (a
decision was downgraded to tier 0 — legal, but not an agent's to decide).

### The corrections store

Corrections live outside any git repository, by design — the point of a
correction is to feed a memory layer that spans repositories, not to be
another line item in one repository's ledger. By default the store is
`~/.orca/corrections.jsonl`; set `ORCA_CORRECTIONS_DIR` to redirect it to a
different directory (its file is always named `corrections.jsonl` inside
that directory). A directory or file this program creates for the first
time is created `0700`/`0600` respectively, never inherited from the
process's umask; a directory or file that already exists keeps whatever
mode it has — that is a person's data, and this program does not get to
change it.

## Known gaps (spec §10.4)

These are registered, not hidden, straight from the design's own accounting:

1. The `scripted` adapter means v1 has not verified how accurate a real
   agent's declarations are. What v1 verifies is a structural property (the
   system stays correct even when a write-set criterion is wrong), not
   whether criteria are accurate.
2. Layer-by-layer progress means the slowest task in a layer blocks the
   whole layer (dispatching as soon as a task is ready is a pure
   optimisation and does not change criteria semantics).
3. The work branch's base is read once, at round start, from the HEAD of
   whatever branch the target repository has checked out; a long-running
   round does not pick up updates to that branch made while it runs.
   Resolving the repository's *true* default branch (rather than using the
   checked-out one) is registered as post-v1 work.
4. Escalation is terminal — there is no incremental resume. A human who
   resolves an escalation reruns the whole plan, and every task that already
   finished runs again for nothing. Harmless while v1 spends nothing
   (`scripted` adapter); the leading candidate for post-v1 work.
5. Until the corresponding change lands in ccloop (see §4.4), the patch path
   has three channels that can silently collapse into an empty patch.
6. As long as that change has not landed, §7's second direction (declared
   but not produced) degrades to "is the patch empty or not."
7. There is no "stop just one task" — orca has no way to end one task and
   let the round continue. (The reason given here used to be that
   `cancelled` only comes from a signal to the whole process group. That is
   incomplete, measured 2026-09-05: ccloop also returns `cancelled` when the
   verification's `stopSignals` meet the contract's `escalationAndExit.stopOn`,
   which is per-contract and is how `cancelledRound.test.ts` produces a real
   one. It is still not a handle orca holds — the signal comes from the
   task's own verification — so the limitation stands and its reason does
   not.)
8. `ledgerMode: out-of-repo` inherits the weakness A′ §3.7 already
   acknowledges about itself: it has no immutable anchor.
9. The shell does not distinguish between exit codes 1, 2, and 3 — to a
   shell they are all simply "non-zero."
10. Squash-commit detection is a heuristic, not a proof.
11. The reasons worktree-based approaches were rejected are reasoning, not
   measurement (and do not need to be measured).
12. The `--serial` consistency criterion (S10) runs the entire plan twice —
   it is a v1 criterion, not a production switch.

## Contributing to `.decisions/`

`npm run verify` runs the whole suite — typecheck, unit and scenario tests,
ledger validation, the CLAUDE.md line-count check, the hooks-path check, and
the scheduler scenario suite — and is the full gate for a change. The
pre-commit hook (`scripts/githooks/pre-commit`) is deliberately narrower: it
only re-checks `.decisions/**` for append-only violations when a commit
actually touches that directory, which is why it stays fast regardless of
how large `npm run verify` grows.
