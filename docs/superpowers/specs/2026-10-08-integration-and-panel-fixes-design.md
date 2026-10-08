# Integration schemes and panel fixes — design

Date: 2026-10-08. Session eaee0f2c. Status: five sections approved in conversation (2026-10-08); revised after an
independent spec review (findings C1–C2, I1–I13, M1–M15, rulings in §12); written for the human's end-of-round review.

## 1. Goal

Two things, one round:

1. **Integration schemes.** Today the execution driver lands every task on the group's work branch `orca/<groupId>`
   (execution driver spec §5.1) and stops there: merging into the default branch and pushing are shown as "waiting on a
   person" (board spec D5) and the panel has no button for either. The person wants Orca, once a task or a group is
   done, to carry the code on to where they review it — a pull request, the default branch, a remote — so code updates
   are seen promptly.
2. **Four panel fixes** the person reported: the Decisions tab shows only unreviewed high-tier decisions; the Memory
   tab's detail sits below a long list; the token-limit input shows `10000000` unformatted; the Agents section of Task
   control takes too much room.

Success: a group confirmed by an owner with a non-`keep` scheme reaches its target (branch, remote branch or pull
request) with no further human action unless a conflict needs an agent; every outward action is idempotent across
crashes; `keep` groups are unchanged. The four panel fixes behave as in §9.2. Every criterion in §10 is a command that
exits 0/non-0 (CLAUDE.md Rule 4).

⚠️ Board spec D5 and the `GitScheme.tsx` header say merging and pushing are "a person's (Rule 15)". CLAUDE.md Rule 15
governs agents **developing Orca**, not Orca at runtime on a target repository. This spec supersedes D5 for non-`keep`
groups; a correction section is appended to the board spec (Rule 13), its text is not edited.

## 2. Decisions taken in conversation (human, 2026-10-08)

| # | Decision |
|---|---|
| H1 | The trigger is a choice: **after each task** or **after the whole group**. |
| H2 | With a pull-request delivery, **one group = one PR**: each integration pushes `orca/<groupId>`; the PR is opened once and later integrations update it. |
| H3 | **Approval is the group's confirm.** The scheme is shown on the confirm step; confirming authorizes every push and merge the scheme will do for that group. Separate human acts: dispatching an agent to resolve an integration conflict, and changing a started group's scheme. No per-repository "auto" switch. |
| H4 | Conflicts are never resolved automatically. After a human approves, an Orca-dispatched agent resolves them. |
| H5 | Local integration into a branch the person has checked out: only when that worktree is clean and the update is a fast-forward does Orca run `git merge --ff-only` there; otherwise the integration is blocked with the reason and a Retry. |
| H6 | First version delivers to GitHub PRs; GitLab MR and Gerrit are a second version (new `delivery` values, same structure). |

## 3. The scheme

```ts
type IntegrationScheme =
  | { delivery: "keep" }                                                      // today's behaviour; the default
  | { delivery: "local"; trigger: Trigger; method: Method; target: string }
  | { delivery: "push-target"; trigger: Trigger; method: Method; target: string; remote: string }
  | { delivery: "push-branch" | "github-pr"; trigger: Trigger; target: string; remote: string };
type Trigger = "task" | "group";
type Method = "merge" | "squash";
```

| delivery | what an integration does |
|---|---|
| `keep` | nothing; no integration pass touches the group |
| `local` | compute `new` (§6.2) on top of local `refs/heads/<target>` and move that ref to it (§6.3 when it is checked out) |
| `push-target` | compute `new` on top of `<remote>/<target>` freshly fetched; `git push --porcelain <remote> <new>:refs/heads/<target>` (never forced) |
| `push-branch` | `git push --porcelain <remote> refs/heads/orca/<g>:refs/heads/orca/<g>` (never forced) |
| `github-pr` | as `push-branch`, then open the group's PR once (§6.4); trigger `task` opens it as a draft and marks it ready when the group completes; trigger `group` opens it ready |

- `method`: `merge` = `merge --no-ff` of the work-branch tip; `squash` = one commit whose tree is the three-way merge of
  the new work onto the target with `lastIntegrated` as merge base (§6.2). **`rebase` is not in v1** (ruling R1, §12).
- `target` / `remote`: names validated before use (§8). `remote` defaults to `origin`; `target` defaults to the branch
  `refs/remotes/<remote>/HEAD` points at, else the target repository's current branch; a detached HEAD with no remote
  HEAD leaves no default and the setter requires an explicit `target`.
- "The new work" is `lastIntegrated..tip(orca/<g>)`. Before the first integration, `lastIntegrated` is
  `git merge-base tip <base>` (base per delivery, §6.2).

### 3.1 Where it lives

- **Repository default**: an optional `integration` field in the repository's `repository_settings` body, next to
  `workspaceMode`, sharing the body's revision. Absent ⇒ `keep`. The body reader is made tolerant of the field and both
  setters (`set-workspace-mode`, new `set-integration-scheme`) read-modify-write the whole body. The workspace GET route
  keeps its strict schema by picking `workspaceMode`/`revision`, not spreading the body. **Downgrade**: once a
  repository has an integration default, an older Orca build reads that body as `repository-settings-invalid` and blocks
  that repository's runs at A1 — the same one-way character as the v7→v8 upgrade; stated in the handoff.
- **Group copy**: written into the group body as `integration` **only when the scheme is not `keep`** (absent ⇒ `keep`
  for new and old groups alike, so a `keep` group body is byte-for-byte what it is today). It is copied from the
  repository default at the point the group gets its plan: `import-plan`, or a requirement group's split acceptance
  (requirement groups integrate like any other; their exported document commit on `orca/<g>` is part of the new work).
  Until confirm, `set-group-integration` (target `group`) edits it (setting `keep` removes the field).
- **After start**: `set-group-integration` is allowed and is itself the approval (H3); it applies from the next
  integration on and never rewrites what was already pushed. Refused `integration-busy` while a resolution is running;
  in state `conflict` it resets the state to `idle`.
- `set-integration-scheme`, `set-group-integration`, `resolve-integration-conflict` and `retry-integration` are
  **human-only** (`humanOnly.ts` VERB_ACCESS `human-only`).

### 3.2 Approval binds to what an owner saw

- The group view exposes `integration.schemeHash` = sha256 of the canonical bytes of the group's scheme, computed by the
  server (as `selectionsHash` is; the browser never re-implements canonical JSON).
- The confirm payload gains an optional `integrationHash`, and `confirm: ["integrationHash"]` is added to
  `HUMAN_ONLY_FIELDS` (ruling R2): only an owner can confirm a non-`keep` group. Confirm refuses
  `integration-unapproved` when the group's scheme is not `keep` and `integrationHash` is absent or differs, and when it
  is `keep` and `integrationHash` is present. A `keep` group confirms as today without the field (existing clients — the
  agent skill, scripted confirms — unchanged; their request hashes are unchanged because an absent optional field adds
  no bytes).

### 3.3 Validation and preflight run outside the command transaction

`applyWebCommand` is a synchronous transaction. Like confirm's `resolveGroupSelections`, every check that runs git or
`gh` runs after the replay check and before the transaction; the transaction then refuses from what the check found.

- **Setters** (`set-integration-scheme`, `set-group-integration`): names valid (§8); the remote exists
  (`git remote get-url`); for `github-pr`, the remote URL parses to a GitHub `host/owner/name`.
- **Confirm preflight** (non-`keep`): the above, plus the target branch exists (local for `local`; on the remote after
  `git fetch <remote> <target>` otherwise); for `squash`, git ≥ 2.40 (`merge-tree --merge-base`); for `github-pr`,
  `gh auth status --hostname <host>` exits 0. A failure refuses `integration-preflight-failed` naming the check.

### 3.4 Protocol changes

- `commandVerbSchema` and the raw/effective command unions gain the four verbs; `commandResultSchema` gains
  `integration-scheme-set`, `group-integration-set`, `integration-resolution-started`, `integration-retried`.
- `set-integration-scheme` joins the `projectionless` list with `set-workspace-mode`.
- `groupViewSchema` gains optional `integration` (§4 view shape); absent for `keep`.
- `repositoryWorkspaceSchema` unchanged; a new `GET /api/control/repositories/:id/integration` answers
  `{ schema: "orca-repository-integration-v1", repoId, integration, revision }`.
- errors.ts: `integration-unapproved` (409), `integration-preflight-failed` (409), `integration-busy` (409),
  `integration-invalid` (400), `integration-no-checks` (409), `integration-not-blocked` (409); none retryable.
- Enumerations to extend: `controlApi.ts` routes and switch, `webService.ts`, `web/src/controlApi.ts`,
  `web/src/controlTypes.ts`, `skills/orca-control/SKILL.md` (routes, and that confirming a non-`keep` group is
  owner-only), `tests/entry/skill.test.ts` (route count and `schemaByVerb`).

## 4. Integration record

In the group body (only for non-`keep`):

```ts
interface GroupIntegration {
  scheme: IntegrationScheme; schemeHash: string; frozen: boolean;
  lastIntegrated: string | null;     // work-branch commit consumed by the last successful integration
  integratedCommit: string | null;   // what the target (local ref / remote branch / PR head) was set to
  state: "idle" | "blocked" | "conflict" | "resolving";
  reason: string | null;             // the named code of the last block / conflict
  pending: { schemeHash: string; tip: string; base: string; new: string } | null;  // write-ahead, §6.1
  conflict: { attempt: number; key: string; base: string; tip: string; paths: string[] } | null;
  resolution: ReconcileRecord | null; // §7, the same record shape a landing reconciliation keeps
  pr: { url: string; number: number; ready: boolean } | null;
  retryAfter: number | null;         // ms epoch; transient failures back off (§6.5)
}
```

The view exposes `{ scheme, schemeHash, frozen, state, reason, lastIntegrated, integratedCommit, pr }`.

## 5. When the pass runs

- `integratePendingGroups(deps)` runs once per driver round after the run steps and after `exportPendingRequirements`
  (same reasons: git side effects, once per round, after the runs). It returns early when the driver is stopped or the
  admission gate is draining.
- It first advances every group in state `resolving` (§7), then integrates due groups one at a time in group id order.
- A group is **due** when: it has a frozen non-`keep` integration in state `idle` with `retryAfter` past; it is not
  stopped and dispatch is not paused by a person (a budget-blocked group still integrates work it already landed: an
  integration spends no tokens); `refs/heads/orca/<g>` exists; and
  - trigger `task`: `tip ≠ lastIntegrated` and `tip` is not an ancestor of the base (there is landed work);
  - trigger `group`: the group is **complete** — every task-kind work item `done` and no run active or reconciling —
    and `tip ≠ lastIntegrated`;
  - `github-pr`, trigger `task`: also when the group is complete and `pr.ready` is false (it only marks ready).
- A task continued after completion (`continue-task`) makes the group incomplete again; trigger `task` integrates its
  landing as usual (the PR stays ready); trigger `group` waits for completion again.

## 6. Executing an integration

All git work happens in an Orca-owned detached worktree `<workspacesRoot>/integrate-<groupId>`, removed by its own name
before each use and after it (as landing workspaces are). `push-branch` and `github-pr` need no workspace. The person's
worktrees, index and HEAD are never touched — the single exception is §6.3.

Every git and `gh` child: argument arrays (no shell), `unsetInheritedGitEnv`, `GIT_TERMINAL_PROMPT=0`,
`GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, and a 60 s timeout
(`ORCA_INTEGRATION_TIMEOUT_MS` for criteria). Workspace git runs with `core.hooksPath=/dev/null` like landing does —
**pushes therefore skip the person's pre-push hooks** (stated deliberately; ruling R6).

### 6.1 Steps

1. Read `tip` (step-1 value; it is what `lastIntegrated` becomes — later landings wait for the next integration).
2. **Re-entry**: if `pending` is set with the current `schemeHash` and the target already holds `pending.new` (local ref
   equals or contains it; `ls-remote` equals or contains it for remote targets), skip to step 5 with it.
3. Compute `new` and record `pending = {schemeHash, tip, base, new}` in one store write (write-ahead) — for
   `push-branch`/`github-pr`, `new = tip` and base is unused.
4. Publish:
   - `local`: §6.3.
   - `push-target`: push `new`. Rejected because the remote branch moved (porcelain `!` with `[rejected] (fetch
     first)`/`non-fast-forward`) ⇒ clear `pending`, re-fetch and recompute once; moved again ⇒ `blocked`
     `integration-target-moved` (Retry). Rejected for any other reason (protected branch, hook, permission) ⇒
     `blocked` `integration-push-refused` with git's message.
   - `push-branch`/`github-pr`: if `ls-remote` already shows `tip`, skip; else push. Non-fast-forward (someone pushed
     to `orca/<g>` on the remote) ⇒ `blocked` `integration-work-branch-diverged`; the person reconciles by hand, Retry.
5. `github-pr`: §6.4.
6. Record `lastIntegrated = pending.tip`, `integratedCommit = pending.new`, `pending = null`, state `idle`, in one
   write that re-reads the group: if `schemeHash` changed meanwhile, the record is dropped (the new scheme starts over).

### 6.2 Computing `new`

Base: `refs/heads/<target>` (`local`) or `<remote>/<target>` after `git fetch <remote> refs/heads/<target>`
(`push-target`). In the integration workspace, fixed identity:

- `merge`: at base, `git merge --no-ff -m "orca: integrate <g>" <tip>`; HEAD is `new` (parents base, tip).
- `squash`: `git merge-tree --write-tree --merge-base=<lastIntegrated> <base> <tip>`; exit 0 ⇒
  `git commit-tree <tree> -p <base> -m "orca: integrate <g> (<n> landings)"` is `new`; exit 1 ⇒ conflict.
- Either way, a conflict ⇒ §7.

### 6.3 `local` into a checked-out branch (H5)

No worktree of the target repository has `<target>` checked out ⇒ `git update-ref refs/heads/<target> <new> <old>`.
One does ⇒ it must be clean (`git status --porcelain --untracked-files=all` empty) and `new` must descend from its HEAD;
then `git -C <worktree> merge --ff-only <new>`. Otherwise `blocked` `integration-worktree-dirty` or
`integration-not-fast-forward` (Retry after tidying).

### 6.4 The group's PR

`gh` always gets `--repo <host/owner/name>` parsed from the remote URL (so `gh repo set-default` or an `upstream`
remote never redirects it). `ORCA_GH_BIN` overrides the binary.

- No `pr` recorded: `gh pr list --repo R --head orca/<g> --base <target> --state all --json url,number,state,isDraft`.
  One open ⇒ record it. One closed or merged ⇒ `blocked` `integration-pr-closed` (the person decides; Retry after
  reopening, or change the scheme). None ⇒ `gh pr create --repo R --base <target> --head orca/<g> [--draft]
  --title=<first line of the group goal, ≤ 256 chars> --body-file -` (body on stdin); record the URL and number.
  Draft not allowed on the plan ⇒ `blocked` `integration-pr-refused` with gh's message.
- Recorded and the group complete and not ready (trigger `task`): `gh pr ready --repo R <number>`; record `ready`.
- A recorded PR later found closed/merged (`gh pr view --repo R <number> --json state`, read once per integration) ⇒
  `blocked` `integration-pr-closed`.

### 6.5 Failure table

| failure | state / code | recovery |
|---|---|---|
| timeout, DNS, connection refused, `gh` network error | stays `idle`, `retryAfter` = now + 30 s doubling to 10 min | automatic |
| target branch missing (local or remote) | `blocked` `integration-target-missing` | Retry or change scheme |
| remote missing | `blocked` `integration-remote-missing` | Retry or change scheme |
| `gh` missing / not authenticated | `blocked` `integration-gh-unavailable` | Retry after `gh auth login` |
| target moved twice | `blocked` `integration-target-moved` | Retry |
| push refused otherwise | `blocked` `integration-push-refused` | fix, Retry |
| work branch diverged on remote | `blocked` `integration-work-branch-diverged` | reconcile by hand, Retry |
| PR closed or merged | `blocked` `integration-pr-closed` | reopen + Retry, or change scheme |
| draft refused | `blocked` `integration-pr-refused` | change scheme (trigger `group` opens ready) |
| merge conflict | `conflict` `integration-conflict` | approve an agent (§7) or fix by hand + Retry |
| checked-out target dirty / not ff | `blocked` (§6.3) | tidy, Retry |

`retry-integration` moves `blocked` or `conflict` to `idle` (refused `integration-not-blocked` otherwise).

## 7. Conflict resolution by an agent

The landing reconciliation (execution driver spec §5.3) is run-shaped; this section reuses its pieces and names what
is new (ruling R3).

- **On conflict**: abort, remove the integration workspace, then `git clone --local --no-checkout <target repo>
  <workspacesRoot>/integration-conflict-<g>-<attempt>`, `materialiseConflict(copy, base, tip)` (for `squash` the
  conflict is materialised as the same three-way merge of `tip` onto `base`), `pinConflictCommit` with the ref passed
  in: `refs/orca/integration-conflict/<g>/<attempt>` in the **target repository** (so it survives the copy). State
  `conflict`, `conflict = {attempt, key: "integrate-<g>-<attempt>", base, tip, paths}`. Nothing is dispatched.
- **`resolve-integration-conflict`** (human-only) is the approval. It refuses `integration-no-checks` when the union of
  the group's task contracts' `requiredChecks` is empty, and `reconcile-budget` when `reconcileAffordable` says the
  group cannot afford the contract's `tokenBudget`. Otherwise it records `resolution` (a `ReconcileRecord` with
  `spawning: true`) and state `resolving`; the pass spawns.
- **New** `synthesizeIntegrationContract(group tasks, conflict)`: goal "resolve the conflict between the target branch
  `<target>` and the work of group `<g>`; the target branch's changes must survive"; targetPaths = conflicted paths;
  checks = the union above; budget = the group's reconcile slot as landing uses; agent = the group's reconcile slot.
- **New** `advanceIntegrationResolution` runs every round for `resolving` groups with the landing's
  `reconcileNextAction` rules (collect a terminal loop state; wait on a live pid; re-spawn an orphan after another
  affordability check), keyed by `integrate-<g>-<attempt>` for the copy, runs dir and outbox keys.
- **New** run-less `recordIntegrationUsage(groupId, key, tokens)`: adds to `group.used` and books one `run-work`
  `unattributed` row with `run_id NULL` (as Ruling R2 of the accounts spec books reconciliation), idempotent by the
  outbox key `integration-usage:<key>`; it never reads a run.
- **Finished, no markers**: `merge` ⇒ `new` = a merge commit with parents (base, tip) and the resolved tree; `squash`
  ⇒ `commit-tree <resolved tree> -p <base>`. If the base moved meanwhile, the result is discarded and the integration
  starts over at `idle` (it may conflict again, which needs a new approval). Then §6.1 from step 3 with this `new`.
- **Markers left / run failed / error** ⇒ `conflict` again with the reason; another approval starts attempt + 1.
- A stop, shutdown or drain does not kill a running resolution; it is collected after restart (as landing
  reconciliations are today). Conflict copies are removed when the integration that owned them succeeds or the scheme
  changes.

## 8. Safety

- Outward actions are performed by Orca's driver with the person's own git and `gh` credentials. No dispatched agent
  pushes (decision-ledger spec Tier 0); the resolution agent only edits files in its workspace.
- Only an owner can put a non-`keep` scheme on a group (human-only setters) or confirm one (human-only field, §3.2).
- Names: a branch must match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`, contain no `..`, `@{`, `//`, not end in `/`, `.` or
  `.lock`, and `git check-ref-format --branch -- <name>` must print the name unchanged. A remote must match
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`. Invalid ⇒ `integration-invalid`. A PR title is the goal's first line truncated,
  passed as `--title=<value>`; the body goes through stdin.
- Writes outside the target repository and the control root: `gh` and `ssh` may write their own state under the
  person's home (`known_hosts`, `gh` config); Orca sets `GH_NO_UPDATE_NOTIFIER=1` and writes nothing there itself.

## 9. Panel

### 9.1 Integration UI

- **Task control → repository area**: an "Integration" section beside Workspace mode: delivery, trigger, method (for
  `local`/`push-target`), target, remote (not for `local`), Save (`set-integration-scheme`). Editable by owners;
  read-only for members.
- **Confirm step**: the group's scheme in plain words (e.g. "After each task: push orca/g to origin and keep one draft
  GitHub PR into main up to date"), editable before confirm (`set-group-integration`); confirm sends the view's
  `schemeHash` as `integrationHash`. A member sees why they cannot confirm a non-`keep` group.
- **Group view → Git area**: state, reason, last integrated commit, target, PR link; owners get Retry and Resolve with
  an agent. The line "merging into main is the person's" stays for `keep` only.

### 9.2 The four fixes

1. **Decisions**: `/api/decisions` rows gain `reviewed: boolean` and `highTier: boolean` (computed with the same key
   and tier rule `unreviewedHighTier` uses; `/api/todo` unchanged). A status filter *Unreviewed / Reviewed / All*:
   *Unreviewed* = high-tier and not reviewed (the default, today's list), *Reviewed* = reviewed (any tier), *All* =
   every listed decision; filtering is client-side over `/api/decisions`. A decision opened from any filter shows the
   correction form; a second correction shows the existing `CORRECTION_ALREADY_RECORDED` refusal.
2. **Memory**: reuse the existing `.split-list` / `.split-detail` sticky layout from `styles.css`: side by side at the
   width that layout already uses, detail sticky with its own scroll; narrower, stacked, and selecting scrolls the
   detail into view.
3. **Token inputs** (RequirementsPanel requirement and group limits; BudgetEditor allocations and
   `handoffAtContextTokens`; UsagePanel spend caps): a text input (`inputMode="numeric"`) that displays the integer
   grouped by the app language (`i18n.resolvedLanguage`: `en` and `zh` both group with `,`); parsing accepts digits
   with `,`, space, U+00A0 or U+202F as separators; anything else is refused before sending. A hint shows the
   magnitude ("≈ 10M" / "约 1000 万").
4. **Agents**: a `<details>` collapsed by default; open state in `localStorage` `orca.panel.agentsOpen` (read and
   written inside try/catch).

## 10. Criteria (each a `vitest run` of a named file; each new branch with the mutation that deletes it, seen red)

| file | what |
|---|---|
| `tests/control/integrationScheme.test.ts` | setter validation, RMW of the settings body both ways, `keep` absent, human-only verbs and field, `integration-unapproved` cases, preflight failures named, `integration-busy` |
| `tests/control/integrationGit.test.ts` | real git with a bare remote: each delivery × trigger reaches its target; `merge` parents and `squash` single commit; second integration takes only new work; squash with `lastIntegrated` merge base does not re-apply hunks; failure table rows; H5 clean/dirty with worktree bytes unchanged |
| `tests/control/integrationGh.test.ts` | fake `gh` (argv log, scripted answers): one `pr create` across a crash at every step, `--repo` always present, closed PR blocks, draft/ready by trigger, title/body passing |
| `tests/control/integrationCrash.test.ts` | a crash point after each outward action then restart: no second push, no second PR, same final record |
| `tests/control/integrationResolve.test.ts` | conflict ⇒ nothing dispatched; approve ⇒ resolution (fake agent) ⇒ integrated with the right parents; markers left ⇒ conflict; usage row `run_id NULL`; budget/no-checks refusals |
| `tests/control/integrationKeep.test.ts` | a `keep` group: body has no `integration`, the pass spawns no git (spy) |
| `tests/panel/integrationApi.test.ts` | routes, views, member/agent refusals |
| web: `integrationScheme.test.tsx`, `decisionsStatusFilter.test.tsx`, `memoryLayout.test.tsx`, `tokenInput.test.tsx`, `agentsCollapsed.test.tsx` | §9 |

## 11. Out of scope

GitLab MR, Gerrit (H6); per-task / stacked PRs (H2); `rebase` method (R1); tracking a PR after it is ready beyond the
closed/merged check; deleting remote branches; running the person's pre-push hooks.

## 12. Rulings on the spec review (controller, 2026-10-08, under the human's whole-round authorization)

- R1 (C1, I6): `rebase` is cut from v1. Linearising `--no-ff` landings drops the reconciled merges' resolutions, and an
  agent-resolved rebase conflict has no single-commit shape. `squash` uses `merge-tree --merge-base=<lastIntegrated>`.
  Cost if wrong: a person who wants linear history uses `squash` until a later version.
- R2 (I1): confirming a non-`keep` group is owner-only (`HUMAN_ONLY_FIELDS.confirm = ["integrationHash"]`). H3 says
  the approval is a person's confirm; an agent computing the hash would make it an agent's. Cost if wrong: an agent
  cannot run a pushing group end to end without an owner's confirm.
- R3 (C2): the resolution is a group-level machine of its own reusing the landing's pieces; nothing is "exactly as".
- R4 (I2): the default stays in `repository_settings` (no table, no migration); the downgrade consequence is stated.
- R5 (I4): `keep` is the field's absence.
- R6 (M2): pre-push hooks are skipped, as all of Orca's workspace git is today.
- R7 (M7): a budget-blocked group still integrates; a person-paused or stopped group does not.
- R8 (M11): trigger `group` opens a ready PR directly; `local` has no `remote`.
- All other findings (I3, I5, I7–I13, M1, M3–M6, M8–M10, M12–M15) are adopted as written above.
