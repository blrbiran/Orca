# Retry a human-blocked task with observed path additions

Approved design, Codex session 2026-11-06. Base: Orca `c65fe9d5`, ccloop `a49ab7b` (Orca's pinned version). The owner chose the
agent-capable option on 2026-11-06: an authorized agent may add only concrete paths the preceding run reported as
missing, within the target repository and still subject to the denylist, file limit and conflict checks. A person may
use the same route. An independent subagent reviewed the design and its revised invariants; the owner approved the
revised version on 2026-11-06. This design also covers dogfood D2/D3 and tester issues #188/#189.

## Intent and boundaries

A task that needs to change a test outside its frozen `targetPaths` currently ends `blocked_waiting_human`. Retrying the
unchanged contract spends another run and reaches the same gate. The operator must be able to see the exact reason and
retry under a new, auditable contract without rebuilding the group. The original run's grant, contract, result and
evidence remain immutable. An arbitrary new path, a denylisted path or an already running task is not authorized by this
route. The path flag itself cannot change checks, budgets, agent selection or the group's goal. A simultaneous `work`
top-up retains the existing retry top-up authorization and accounting rules.

## Approaches

1. Improve split prompts only. Cheap, but one missed path still strands a started task (#188).
2. Let `set-task-loop` edit a started task. Its current refusal protects the claim envelope and confirmed snapshot;
   removing it would make an old run appear to have used the new contract.
3. **Chosen:** extend `retry-task` with an explicit `allowObservedPaths` action. It settles the old run using its old
   identity and, in the same transaction, creates a new contract version for the next claim. The action can be invoked
   by an authorized agent or person, but its paths come only from the terminal report, not from a caller supplied list.

## Producer evidence

ccloop's current `stopReason` is a human string such as `allowlist miss: test/math-add.test.js`; its path policy returns
only the first miss. ccloop will add an optional, bounded **top-level collect** `pathPolicyMisses` list (parallel to
`failureCause`, outside the frozen protocol-3 `terminal` projection), with
each entry containing a repository key (null for the primary repository) and an exact relative path. It gathers all
observed misses across the primary and additional repositories in the attempt, but emits this list **only when the
terminal outcome is `blocked_waiting_human` because an allowlist miss won the existing path-policy precedence**.
The primary repository's evidence comes from ccloop's Git status observation; an executor's `changedFiles` text alone
cannot authorize a path. If Git cannot observe the primary worktree, or its observed misses do not include the path
named by the existing stop reason, the field is omitted. The terminal verdict and its text do not change.
The list has at most 128 entries; each path is at most 4,096 UTF-8 bytes and each repository key at most 128 UTF-8
bytes. If any bound is exceeded, ccloop omits the field rather than truncating an authorization path.
Max-files and denylist gates retain their current priority and emit no allowlist authorization evidence. The private
ccloop state retains the list so a later collect can report it; the protocol-3 terminal bytes remain unchanged. Orca
accepts the optional top-level field only with that terminal state, stores it on that run's drive record, and exposes it in `run show`,
`group show` and the Web task view. An older ccloop without the field yields a named
`observed-paths-unavailable` refusal; Orca does not parse the presentation string as authority.

## Atomic command

`retry-task` gains `allowObservedPaths: true` (CLI: `orca task retry <group> <task> --allow-observed-paths`; Web: show the
exact paths and a corresponding retry action). It requires the current run id, `state=blocked`, `blockedAt=C`,
`outcome=blocked_waiting_human`, a stopped worker, known accounted usage and a nonempty typed miss list. The
existing run-id and revision checks apply. An Orca dispatched run cannot send this flag. `orca-auto` never sends it.

For each miss, the server resolves the named repository from the **source run's frozen contract**, checks a plain
relative path without glob or traversal syntax, rejects a symlink escape, and rechecks denylist and max-files policy.
It adds exactly the reported paths to that repository's `targetPaths` and matching allowlist, deduplicated. Existing
required checks, setup, goal, agent and safety limits stay byte-identical. It refuses a new overlap with an unfinished
sibling task unless the existing frozen `dependsOn` already orders those tasks safely; the work item's actual
`dependsOn` is the dispatch authority, so merely recomputing a graph is insufficient. It also refuses a new overlap
with an active group in the same repository. Refusals name the conflicting task or group and do not silently edit
dependencies. No existing run or archived plan is rewritten.

**A dedicated observed-path amendment is required.** The existing `taskAmendments.ts` record proves a loop recipe
re-expands to the exact contract. Adding a target path there may also add a generated document check, and a multi-dir
task's `additionalRepos` are not generated by that recipe. The new record therefore stores the source run, previous and
next contract hashes, the repository-qualified paths, actor and command id. A leaf validator first verifies the
current loop recipe (if any), then verifies that applying only these observed path additions yields the new canonical
contract; it checks every other field, including checks, is unchanged. It works for primary and additional repositories.
`effectivePlanTask` and `readConfirmedTaskExecution` apply this verified overlay when deriving the **next** contract.
The transaction writes both original and derived canonical records, replaces the task's derived reference in a new
confirmed execution snapshot and updates `proposal.executionSnapshotHash`. It also updates the work item's
`originalContractHash`, `contract.contentAddressedHash` and `derivedContractHash` to those exact new records, and
increments a separate `observedPathsVersion`. `targetVersion` and the archived graph version do not change. Before
commit, `readConfirmedTaskExecution` and the group projection must both accept the new state; the next claim reads the
new derived hash from the work item.

**Historical retry proof is versioned.** `retryTask` first verifies and settles the old run against its original claim
and grant, then applies the path amendment before marking the task ready, all in one transaction. Today
`validateRetryGrantSource` compares every historical run's claim hash to the current work hash, which would reject this
transition. It must instead verify each historical run against its own immutable claim envelope and the recorded
amendment chain, while checking the current work hash only against the next claim. The old grant, usage settlement,
lineage, agent and profile checks remain. The retry's optional `work` top-up uses today's cap and grant checks in the
same transaction. A retry of the same command id replays the original answer without another amendment.

An ordinary `retry-task` on `blocked_waiting_human` remains available to a person as today, but the CLI and Web call out
that it retains the same paths. A paused group must be resumed before the retry command, as the existing stop guard
requires. D1 prevents Orca from choosing that ordinary retry automatically.

## Split and feedback

Split instructions (D5) require each task's writable paths to include tests that its checks may need to update. A
`bugfix` loop must include a writable regression-test path or use a loop that does not require reproduce-first. The
split validator reports this contradiction before acceptance, with the task id and missing test scope; it does not
silently widen paths. The CLI/skill (D4) tell an agent to inspect the split's writable paths before confirm and, after
an allowlist block, inspect `run show` then use `--allow-observed-paths` when the reported additions are appropriate.

## Acceptance

- A blocked run reporting two concrete test misses leads to one agent-authorized command and one new run whose contract
  includes only those two paths; its checks remain byte-identical. The old run's hashes, grant, evidence and result
  remain byte-identical. The next run claims and passes `validateRetryGrantSource`.
- A missing/stale run id, no typed misses, denylisted path, symlink escape, wrong repository, concurrent claim, or new
  same-group or active-group write conflict refuses without changing the task, snapshot or amendment log. A repeated
  command id is a replay. A second path extension verifies the full historical chain.
- A multi-directory task may extend an explicitly reported path in an additional repository without changing any
  other directory's paths or checks.
- The CLI and Web show the blocked reason and exact paths before offering the action. No automatic retry or debug group
  is opened for `blocked_waiting_human` (D1).
- A split with `bugfix` and no writable test scope is rejected before confirm; a corrected split is accepted.
- ccloop and Orca tests use synthetic runs and isolated data. A paid live dogfood run needs separate owner approval.

## Correction (Codex implementation, 2026-11-07) — multi-directory work-item mirror

The original transaction list above named the contract, snapshot and work hashes but omitted the multi-directory
work item's stored `writes[]`. The driver uses this array to choose the directories it prepares. The path amendment
also verifies each entry's old `targetPaths` against the prior contract and updates only the matching entry's
`targetPaths` in the same transaction. `writes[].checks` and directory order stay unchanged. This keeps the stored
dispatch mirror consistent with the amended primary or additional repository contract.
