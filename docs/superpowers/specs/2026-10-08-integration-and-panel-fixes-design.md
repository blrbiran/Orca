# Integration schemes and panel fixes — design

Date: 2026-10-08. Session eaee0f2c. Status: approved in conversation (five sections, 2026-10-08); written for review.

## 1. Goal

Two things, one round:

1. **Integration schemes.** Today the execution driver lands every task on the group's work branch `orca/<groupId>`
   (execution driver spec §5.1) and stops there: merging into the default branch and pushing are shown as "waiting on a
   person" and the panel has no button for either. The person wants Orca, once a task or a group is done, to carry the
   code on to where they review it — a pull request, the default branch, a remote — so code updates are seen promptly.
2. **Four panel fixes** the person reported: the Decisions tab shows only unreviewed high-tier decisions; the Memory
   tab's detail sits below a long list; the token-limit input shows `10000000` unformatted; the Agents section of Task
   control takes too much room.

Success: a group confirmed with a non-default scheme reaches its target (branch, remote branch or pull request) with
no further human action unless a conflict needs an agent, and every outward action is idempotent across crashes. The
four panel fixes behave as in §8. Every criterion is a command that exits 0/non-0 (CLAUDE.md Rule 4).

## 2. Decisions taken in conversation (human, 2026-10-08)

| # | Decision |
|---|---|
| H1 | The trigger is a choice: **after each task** or **after the whole group**. |
| H2 | With a pull-request delivery, **one group = one PR**: each integration pushes `orca/<groupId>`, the first push opens a draft PR, the group's completion marks it ready. |
| H3 | **Approval is the group's confirm.** The frozen scheme is shown on the confirm step; confirming authorizes every push and merge the scheme will do for that group. Two things need a separate human act: dispatching an agent to resolve an integration conflict, and changing a group's scheme after it has started. No per-repository "auto" switch. |
| H4 | Conflicts are never resolved automatically. After a human approves, an Orca-dispatched agent resolves them. |
| H5 | Local integration into a branch the person has checked out: only when their worktree is clean and the update is a fast-forward, Orca runs `git merge --ff-only` in that worktree; otherwise the integration is blocked with the reason and a Retry. |
| H6 | First version delivers to GitHub PRs; GitLab MR and Gerrit are a second version (new `delivery` values, same structure). |

## 3. The scheme

```ts
type IntegrationScheme =
  | { delivery: "keep" }                                                        // today's behaviour; the default
  | { delivery: "local" | "push-target"; trigger: Trigger; method: Method; target: string; remote: string }
  | { delivery: "push-branch" | "github-pr"; trigger: Trigger; target: string; remote: string };
type Trigger = "task" | "group";
type Method = "merge" | "squash" | "rebase";
```

| delivery | what an integration does |
|---|---|
| `keep` | nothing (no integration step runs; the group view says merging is the person's, as today) |
| `local` | integrate the new work into the local branch `target` with `method` (§5.2), updating `refs/heads/<target>` by compare-and-swap; H5 when it is checked out |
| `push-target` | as `local`, but on top of `<remote>/<target>` freshly fetched, then `git push <remote> <new>:refs/heads/<target>` (never forced) |
| `push-branch` | `git push <remote> refs/heads/orca/<g>:refs/heads/orca/<g>` |
| `github-pr` | as `push-branch`; the first time, `gh pr create --draft --base <target> --head orca/<g>`; when the group completes, `gh pr ready` |

- `target` defaults to the branch `refs/remotes/<remote>/HEAD` points at (falling back to the target repository's current
  `HEAD` branch when there is no remote HEAD), resolved when the repository default is set; `remote` defaults to `origin`.
  Names are validated as git ref names (`git check-ref-format --branch`) and a remote must exist (`git remote get-url`).
- `method` (only where Orca itself integrates): `merge` = `merge --no-ff` of the new work; `squash` = one commit holding
  the new work's net diff; `rebase` = the new work's commits replayed onto the target tip, then a fast-forward.
- "The new work" is `lastIntegrated..tip(orca/<g>)` along the first parent, where `lastIntegrated` is the work-branch
  commit the previous integration of this group consumed; before the first integration it is
  `git merge-base tip(orca/<g>) <base>` (§5.1 names the base per delivery). With trigger `task` that is normally one
  landing (more if several landed in one round); with trigger `group`, all of them.

### 3.1 Where it lives

- **Repository default**: an optional `integration` field in the repository's `repository_settings` body, next to
  `workspaceMode`, sharing its revision. Absent ⇒ `{ delivery: "keep" }`. A new verb `set-integration-scheme` (target
  `repository`) sets it; `set-workspace-mode` keeps whatever `integration` is there (and vice versa). No schema version
  change: the body is JSON and the field is optional.
- **Group copy**: at import the group body gets `integration: { scheme, frozen: false }` copied from the repository
  default. Until confirm, `set-group-integration` (target `group`) edits it. Confirm freezes it (`frozen: true`).
- **After start**: `set-group-integration` on a started group is allowed and is itself the approval (H3); it applies
  from the next integration on and never rewrites what was already pushed.
- Both setters are **human-only** (`humanOnly.ts` VERB_ACCESS `human-only`, like `set-limit`): an agent or a member
  cannot choose where code goes.

### 3.2 Approval binds to what was shown

The confirm payload gains an optional `integrationHash` (sha256 of the canonical bytes of the group's scheme). Confirm
refuses `integration-unapproved` when the group's scheme is not `keep` and `integrationHash` is absent or differs. A
`keep` group confirms as today, with or without the field — existing clients (the agent skill, scripted confirms) keep
working unchanged.

### 3.3 Preflight at confirm

For a non-`keep` scheme confirm runs, before freezing, the checks that would otherwise fail halfway: the remote exists
(`push-*`, `github-pr`); for `github-pr`, `gh auth status` exits 0 (the `gh` binary is `ORCA_GH_BIN` or `gh` on PATH);
the target branch exists locally (`local`) or on the remote (`push-target`, `github-pr`, after `git fetch <remote>
<target>`). A failed check refuses confirm with `integration-preflight-failed` and the failing check named.

## 4. Integration record and when it runs

The group body's `integration` also carries the state:

```ts
interface GroupIntegration {
  scheme: IntegrationScheme; frozen: boolean;
  lastIntegrated: string | null;      // work-branch commit consumed by the last successful integration
  integratedCommit: string | null;    // what the target (local branch / remote branch / PR head) was set to
  state: "idle" | "blocked" | "conflict" | "resolving";
  blockedReason: string | null;
  conflict: { ref: string; attempt: number } | null;
  prUrl: string | null; prReady: boolean;
}
```

- A new driver pass `integratePendingGroups(deps)` runs once per driver round, after the run steps and the requirement
  export (the same place and the same reasons as `exportPendingRequirements`: git side effects, one per round, after the
  runs so a stop issued with the round lands first).
- A group is due when its scheme is not `keep`, it is frozen, its state is `idle`, it is not stopped or held, and:
  trigger `task` — `tip(orca/<g>) ≠ lastIntegrated`; trigger `group` — the group's work is complete (every work item
  `done`) and `tip ≠ lastIntegrated`. For `github-pr`, a completed group whose PR is not yet ready is also due (it only
  runs `gh pr ready`).
- Groups are integrated one at a time per round, in group id order.

## 5. Executing an integration

All work happens in an Orca-owned detached workspace `<workspacesRoot>/integrate-<groupId>`, recreated per integration
(a crash leaves it; the next integration removes it by its own name first), exactly as landing workspaces are
(execution driver spec §5.1). The person's worktrees, index and HEAD are never touched — the single exception is H5.

### 5.1 Steps, each idempotent

1. Read `tip(orca/<g>)`. Nothing new ⇒ done.
2. Per delivery:
   - `push-branch`, `github-pr`: if `git ls-remote <remote> refs/heads/orca/<g>` already names `tip`, skip the push;
     otherwise push (never forced; a rejected push — the remote branch moved — blocks with `integration-push-rejected`).
   - `local`, `push-target`: compute `new` (§5.2) on top of the base (`refs/heads/<target>` for `local`;
     `<remote>/<target>` after a fetch for `push-target`). Then `local`: H5 rule (§5.3); `push-target`: push
     `new:refs/heads/<target>`; rejected (moved meanwhile) ⇒ re-fetch and recompute once in the same integration;
     rejected again ⇒ `blocked` (`integration-push-rejected`), Retry starts over.
3. `github-pr`, no `prUrl` yet: `gh pr list --head orca/<g> --base <target> --state open --json url` first; one ⇒ record
   it; none ⇒ `gh pr create --draft --base <target> --head orca/<g> --title <group goal> --body <generated>` and record
   the printed URL. Group complete and not `prReady` ⇒ `gh pr ready <url>`, record `prReady`.
4. Record `lastIntegrated = tip`, `integratedCommit`, in one store write. A crash between an outward action and this
   record re-runs the step, and the checks in 2–3 make the re-run a no-op for what already happened.

### 5.2 Computing `new`

In the integration workspace, at the base commit: `merge` — `git merge --no-ff -m "orca: integrate <g> (<n> landings)"`
of `tip`; `squash` — `git merge --squash` of `tip`, commit `orca: integrate <g>`; `rebase` —
with HEAD detached at `tip`, `git rebase --onto <base> <lastIntegrated>`; the resulting HEAD is `new` (no branch is
created anywhere). Fixed identity and
`core.hooksPath=/dev/null`, as landing does. Any conflict ⇒ §6.

### 5.3 H5: a checked-out local target

If no worktree of the target repository has `<target>` checked out: `git update-ref refs/heads/<target> <new> <old>`.
If one does: it must be clean (`git status --porcelain` empty, including untracked files) and `new` must be a
descendant of its HEAD; then `git -C <that worktree> merge --ff-only <new>`. Otherwise `blocked` with
`integration-worktree-dirty` or `integration-not-fast-forward`, and the person clicks Retry after tidying.

## 6. Conflicts

- A conflict while computing `new` aborts the merge or rebase, removes the integration workspace, and materializes the
  conflict as landing does (`materialiseConflict` into a `clone --local --no-checkout` copy, `pinConflictCommit`), kept
  at `refs/orca/integration-conflict/<g>/<attempt>`. State `conflict`, reason named. Nothing is dispatched.
- `resolve-integration-conflict` (target `group`, human-only) is the approval (H4). It dispatches a resolution exactly
  as a landing reconciliation does (execution driver spec §5.3 steps 3–7): `synthesizeReconcileContract` with the union
  of the group's tasks' `requiredChecks` (empty ⇒ refused `integration-no-checks`), the read-only affordability check
  (`reconcileAffordable`; short ⇒ refused `reconcile-budget`), `ccloop run` via the scheduler's `runTask` with the
  group's reconcile slot, crash recovery by recorded runs directory and pid, usage booked to the group as the landing
  reconciliation's is (one `run-work` `unattributed` row, Ruling R2 of the accounts spec). State `resolving`.
- When it finishes with no markers left, its merge commit is the `new` of §5 and the integration continues from step 2's
  publish. Markers left, a failed run or any error ⇒ `conflict` again with the reason; the person may approve another
  attempt or resolve by hand and click Retry.
- `retry-integration` (target `group`, human-only) moves `blocked` or `conflict` back to `idle`; the next round
  recomputes from the current tips.

## 7. Safety

- Outward actions (push, PR) are performed by Orca's driver code with the person's own git and `gh` credentials. No
  dispatched agent ever pushes (decision-ledger spec Tier 0); the resolution agent only edits files in its workspace.
- Confirm is the authorization (H3, §3.2); a scheme cannot reach a group without a human-only verb or a confirm that
  carried its hash.
- `gh` is spawned with an argument array, never through a shell; titles and bodies are arguments, not interpolated.
- `ORCA_GH_BIN` redirects the `gh` binary (criteria use a fake that records its argv and answers from a script).
- Nothing is written outside the target repository and Orca's control root (Rule 17 is untouched).

## 8. Panel

### 8.1 Integration UI

- **Task control → repository area**: an "Integration" section beside Workspace mode: delivery, trigger, method,
  target, remote, with Save (sends `set-integration-scheme`). Owners only (members see it read-only).
- **Confirm step**: shows the group's scheme in plain words ("After each task, open/update a draft GitHub PR from
  orca/g into main on origin") and sends its `integrationHash`. Before confirm the scheme is editable there
  (`set-group-integration`).
- **Group view, Git area**: state, last integrated commit, target, PR link, blocked/conflict reason, and buttons
  Retry / Resolve with an agent (owners). The line "merging into main is the person's" stays for `keep` only.

### 8.2 The four fixes

1. **Decisions**: a status filter *Unreviewed (high-tier) / Reviewed / All*. The list reads `/api/decisions`, whose
   rows gain `reviewed: boolean` (a `reviewed` review row exists for that projectKey+id — the same key
   `unreviewedHighTier` uses). Default stays *Unreviewed*, read from `/api/todo` as today. Any decision opened from any
   filter shows the correction form (the server already accepts corrections for every listed decision).
2. **Memory**: list and detail side by side at ≥ 900 px wide; the detail column is `position: sticky; top: 0` with its
   own scroll (`max-height: 100vh; overflow: auto`). Narrower: stacked as today, and selecting a memory scrolls the
   detail into view.
3. **Token inputs**: every token-amount input (requirement limit, group limit, spend caps) shows digits grouped with
   the reader's locale (`Intl.NumberFormat`) while keeping an integer value; typing or pasting `10,000,000`, `10 000 000`
   or `10000000` all read as 10000000; anything else is refused before sending. A short hint shows the magnitude
   ("≈ 10M" / "约 1000 万").
4. **Agents**: a `<details>` collapsed by default; its open state is remembered per browser (`localStorage`
   `orca.agentsOpen`, read and written inside try/catch).

## 9. Criteria

- Real git E2E in temporary repositories with a bare remote, fake ccloop world as the other E2Es use: each delivery ×
  trigger (task, group) reaches its target; `squash`/`merge`/`rebase` produce the expected shapes (`rev-list` counts,
  parents); a second integration takes only the new landing.
- Crash safety: a crash point after each outward action (push, PR create, PR ready, local update) followed by a
  restart performs no second push, opens no second PR (fake `gh` argv log has one `pr create`), and records the same
  final state.
- Conflicts: a target that moved with a conflicting change ⇒ `conflict`, nothing dispatched; approve ⇒ resolution run
  (fake agent) ⇒ integrated; markers left ⇒ `conflict` again.
- H5: clean checked-out target ⇒ fast-forwarded in place; dirty ⇒ blocked, worktree bytes unchanged
  (`git status --porcelain` and file hashes before/after).
- Approval: confirm without/with a stale `integrationHash` on a non-`keep` group ⇒ `integration-unapproved`; a member
  or agent principal sending any of the four new verbs ⇒ `control-verb-human-only`; preflight failures named.
- `keep` groups: behaviour and existing criteria byte-for-byte unchanged (no integration pass output, no new rows).
- Panel: web criteria for each of §8; i18n keys in both locales.
- Every new branch gets the mutation that deletes it, seen red (Rule 9); mutations only in `git clone --local` copies.

## 10. Out of scope

GitLab MR, Gerrit (H6, second version); per-task PRs / stacked PRs (H2 chose one PR per group); tracking a PR's merge
state after it is ready; deleting remote branches; integrating requirement groups (they export documents, not code).
