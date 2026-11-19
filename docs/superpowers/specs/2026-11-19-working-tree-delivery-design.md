# Working-tree delivery: a finished group's files land in the person's checkout, uncommitted (#365, #328) — design

- **Who:** a design subagent (Claude Opus 5.5) spawned by the Orca control session `3ba26002` on 2026-11-19. It read
  Orca `main` at `4f53a087` (`/usr/bin/git -C /Users/biran/code/skills/orca/Orca rev-parse --short HEAD`, in the
  worktree `.wt-spec-365` cut from it). Every `file:line` below is at that commit.
- **What was executed:** no Orca test. One toy-repository git check (Appendix A) in the session scratchpad.
- **Status:** design, not built. A person reviews it first. Implementation is ordered **after change-sized runs P1**
  (human ruling below); nothing here depends on P1 or P2 code (§4.6).
- **Human ruling (this session, verbatim):** 「同意你的建议」, answering the controller's proposal: add a delivery that
  writes the group's result into the registered repository's working tree **without committing**, chosen by the person
  on first use (the first group of a project, i.e. while no delivery was ever chosen for it); brainstorm, then spec;
  build after change-sized runs P1. The same session approved rewriting necessary criteria (named in §10.2).
- **Inputs:** tester bodies "Issue 365" and "Issue 328" in
  `/Users/biran/code/skills/orca/orca_archived_files/issue-20261023.md`; `docs/handoff/handoff.md` §三 3.最新, §五, §六.4;
  the integration spec `2026-10-08-integration-and-panel-fixes-design.md`; the history-delivery spec
  `2026-11-16-history-delivery-design.md`; the change-sized runs spec `2026-11-19-change-sized-runs-design.md` (§13).
- **Language:** English (repository convention; the handoff is Chinese).

---

## 1. Problem

**#365 (tester, real repository).** A group finished with the default delivery `keep`. Its three documents were on
`orca/<group>` only; `git status` in the person's own checkout was empty. The tester's words: the person's first reaction
is "the task produced nothing" or "Orca lost my files". #365(a) (on `main`, commits `6ec94831`, `fb4411ff`) now *says*
where the files are and prints `git diff --name-only HEAD...orca/<g>` / `git checkout orca/<g> -- <paths>`
(`src/commands/domains/verbs.ts:379`, `web/src/ResultsConclusion.tsx`). It does not put them there. Orca has no delivery
that does: the union is `keep | local | push-target | push-branch | github-pr` (`src/control/webProtocol.ts:1040-1044`);
`local` *commits* (merge or squash) onto a branch.

**What #328 says and what the code says.** The controller's brief, following the tester, reads "`local` in worktree mode
cannot move `main`". The code says something narrower, and the difference matters for alternative 3 (§3):

- The **run** cannot write refs in the shared git directory of a `worktree`-mode workspace (ccloop's write scope; the
  tester's two `pendingDecision`s are the evidence). An agent asked *by the requirement* to make merge commits on `main`
  therefore cannot, and in #328 it improvised (merged in a private clone, copied the tree back).
- **Orca's own** `local` delivery is not done by the run. The integration pass, in the panel process, moves
  `refs/heads/<target>` of the *registered* repository with `update-ref` (or `merge --ff-only` in the worktree that has
  it checked out) (`src/control/integrationPass.ts:415-433`). The work branch `orca/<g>` also lives in the registered
  repository in both workspace modes (`ensureWorkBranch(targetRepo, …)`, `src/control/workspace.ts:99-107`;
  `executionDriver.ts:487,515`). So `local` does not depend on the workspace mode. (Read from the code, not run.)
- The tester's 2026-11-16 re-test in `clone` mode confirms the model: `main` stays put until the group completes, then
  one group delivery moves it. The tester's item 4 under #365 ("clone mode `local` only changes the clone's branch")
  does not match `localDelivery` above.

So the gap #365 names is real and is not #328's: even when `local` works, it *commits into the person's branch* (and
refuses a dirty checkout as a whole: `integration-worktree-dirty`, `integrationPass.ts:428`). Nothing gives the person
the files to look at and commit themselves.

## 2. Goals and non-goals

**Goals**
- G1. A delivery `working-tree`: once the group is complete and accepted, the group's change is written into the
  registered repository's checkout as **uncommitted** changes (new files untracked, edits unstaged, deletions unstaged).
  No commit, no ref, no index entry of the person's is written.
- G2. **Never overwrite what the person has.** A path is written only when its current content in the person's
  checkout is content Orca can reproduce from git (what it was before this group, or already the group's result).
  Anything else is refused by name, with paths and a next step, and nothing is written.
- G3. The person chooses on first use; the choice is remembered for the project; nothing waits on the choice
  (handoff §五 5.3 and the human's 「不要卡在人这里」).
- G4. Results / `group brief` / `group show` say where the files went, or why they did not.

**Non-goals**
- N1. Changing the default (alternative 4, rejected in §3).
- N2. Any change to `local`, `push-*`, `github-pr`, history delivery or multi-directory landing. Multi-directory groups
  refuse `working-tree` by name (§4.4).
- N3. Running any command (checks, setup) in the person's checkout. Orca never executes there.
- N4. Telling an agent at confirm that a free-text requirement asks it to write refs (#328 remainder, §8).

## 3. Alternatives considered (brainstorm)

**A1. `delivery: "working-tree"` applied by the integration pass.** The group's change `from..tip` (`from` = the last
delivered tip, else the group's base) is written into the checkout path by path, each path guarded by "its current
content is `from`'s or `tip`'s".
- Dirty tree: only the paths the group touches matter. Unrelated edits, untracked files and staged work elsewhere are
  never read or written. A touched path the person edited → refused (`integration-working-tree-conflict:<paths>`),
  nothing written.
- Diverged HEAD (the person committed or switched branches since the group began): the same per-path rule covers it.
  A touched path whose committed content changed since base is "not `from`'s" → refused. Untouched paths: irrelevant.
- Untracked new files: a new path that already exists in the checkout (untracked, ignored, or tracked) → refused unless
  it already holds the tip's content.
- Deletions: removed only when the file still holds `from`'s content; an absent file is already delivered.
- Binary files, symlinks, the executable bit, `.gitattributes` filters: handled by git itself, because the files are
  produced by `git checkout-index` from a temporary index (Appendix A), not by applying a patch.
- Cost: none of the person's attention unless a guard trips; the next driver round delivers.

**A2. Materialise only on demand (`orca group deliver --to-working-tree`).** A new verb (CLI, Web button, MCP) that
writes a done group's files once. Simple to explain; no scheme change.
- Against: a second write path with its own crash and re-entry rules, outside the integration record that `close`
  (`owedDelivery`, `src/control/archiveGroup.ts:200`), the Problems surface and Retry already read. And it needs the
  person every time — exactly what the first-use choice is meant to remove.
- **Subsumed by A1 without a new verb:** `orca group set-integration <g> --delivery working-tree` on a done `keep` group
  is "deliver this one now" — `set-group-integration` on a confirmed group is its own approval and freezes at once
  (`src/control/integrationCommands.ts:84-131`), and the next pass delivers it. That is the "on demand" path of A1.

**A3. Make `local` work in worktree mode by having Orca, not the agent, advance the ref.** That is **already how `local`
works** (§1): the integration pass, not the run, moves the ref, in either workspace mode. Nothing to build. It does not
close #328's root cause either, because #328's root cause is a *requirement* that asked the *agent* to make specific
merge commits — that is what history delivery (`2026-11-16-history-delivery-design.md`, on `main`) built: Orca makes
the named-source merges itself and proves them. And it does not answer #365: `local` commits into the person's branch;
#365 asks for files to review, uncommitted.

**A4. Change the default** (absent ⇒ `working-tree`, or ⇒ `local`).
- Against: an upgrade would start writing into checkouts of every existing project whose owner never asked for it — the
  one thing G2 exists to prevent, done silently. Projects used only by agents, or where the person keeps unrelated
  work in progress, would collect untracked files from every group. And a default must be safe with nobody watching;
  `keep` is the only delivery that writes nothing outside Orca's namespace. The human's ruling chose "ask on first use"
  instead.

**A5 (considered, rejected). Patch-based apply** (`git diff --binary from tip | git apply`). `git apply` is atomic and
handles binaries, but it merges hunks into a file the person edited (context still matches) — G2 forbids mixing their
uncommitted edits with ours — and it does not run smudge filters (LFS, eol). The per-path content guard plus
`checkout-index` is both stricter and closer to what `git checkout` would produce.

**Recommendation: A1, with A2 as its natural use on a done group, no new verb; A3 is a clarification only (§1); A4
rejected.** A1 reuses the integration record, the pass, Retry, the Problems surface and `close-delivery-pending`
unchanged; its whole safety rule is one per-path predicate that can be tested by mutation (§10.1); and it never needs a
checkout of its own (§4.6).

## 4. Design

### 4.1 The scheme

```ts
| { delivery: "working-tree" }   // strict: no trigger, method, target or remote
```

- Trigger is fixed to "group": the pass delivers only when `groupComplete` holds (every task done, no active run but the
  requirement review's own call, accepted on the final tip; `integrationPass.ts` `groupComplete`). Per-task writes into
  the person's checkout would churn their tree mid-group; not offered.
- Human-only like every other non-`keep` scheme (`src/panel/humanOnly.ts:67-77`); a confirm of a group carrying it
  needs `integrationHash` (integration spec §3.2), unchanged.
- `checkScheme` / `preflightScheme` (`src/control/integrationScheme.ts:122-174`): for `working-tree`, the registered path
  must be the top level of a non-bare work tree (`git rev-parse --is-inside-work-tree` prints `true` and
  `--show-toplevel` is the registered path's realpath), else `working-tree-missing`. No other check: the checkout's state
  is judged at delivery time, not at confirm (it will change in between).
- Code that reads `scheme.target` for every non-`keep` scheme gains a `working-tree` branch. Known sites:
  `integrationScheme.ts:130` (schemeCheck), `integrationPass.ts:203` (`nothingLanded`) and `:213` (dispatch),
  `integrationCommands.ts:119` (`sameDestination`: same delivery ⇒ same destination), `ledgerAtRef.ts:81`
  (`integrationTargetRef` → `null`, as for `keep`: no target ref to read), `requirementCommands.ts:534` (multi refusal,
  §4.4), Web `IntegrationScheme.tsx:22,68-91`, `GitScheme.tsx`, CLI `src/commands/domains/settings.ts:22-46`. The
  typecheck lists any other; each is named in the plan.

### 4.2 "Never chosen", and the first-use choice

**Data.** Today `set-integration-scheme` with `keep` deletes the field (`integrationCommands.ts:63`, ruling R5), so "the
person chose keep" and "nobody ever chose" are the same bytes. Change, **for the repository default only**: a person
setting `keep` stores `integration: { delivery: "keep" }` explicitly. Then:

- `chosen(repo) := repository_settings.body.integration !== undefined`.
- `readIntegrationDefault` is unchanged (absent ⇒ `keep`), so every group gets exactly what it gets today.
- The no-op check compares against the stored field, not the default: `keep` on a never-chosen project is **applied**
  (it records the choice); `keep` again is `no-op-command`.
- The group copy keeps R5 (absent ⇒ `keep`); group bodies are byte-identical to today's.

**Where the choice is asked — never as a gate.**

1. **Results of a done `keep` group in a never-chosen project (Web), the one required place.** Auto-confirm makes most
   groups start without a person at confirm (`webService.ts` `autoConfirmUnlimitedPass`), so confirm is not a reliable
   "first use"; a done group's Results is where the person looks for the files. Under the #365(a) kept lines the card
   shows: *"Where should finished files go for this project?"* with
   - primary: **Put them in my working tree** (`<registered path>`, uncommitted) → `set-integration-scheme`
     `{delivery:"working-tree"}` for the project, then `set-group-integration` `{delivery:"working-tree"}` for this
     group; the next driver round writes them (§4.3);
   - secondary: **Keep them on the branch** → `set-integration-scheme` `{delivery:"keep"}` (stored explicitly); the
     question stops; the kept lines stay.
   - a line: "Other deliveries (merge into a branch, push, pull request): Project settings".
2. **Project settings → Delivery**: `working-tree` is a sixth option ("write into my working tree, uncommitted"); a
   never-chosen project reads "not chosen yet (groups keep their files on `orca/<group>`)".
3. **CLI**: no new verb and no new flag. `--delivery working-tree` is accepted by `orca project set-integration` and
   `orca group set-integration`. `group brief` / `group show` of a done `keep` group in a never-chosen project print,
   before the #365(a) lines:
   ```
   delivery: not chosen for this project yet
     put this group's files in your working tree (uncommitted): orca group set-integration <g> --delivery working-tree
     and for later groups: orca project set-integration --delivery working-tree   (or --delivery keep to stop asking)
   ```
   `group confirm` on such a project prints the first line and the project command once after its receipt and proceeds.
4. Agents: the setters are human-only, so an agent with an agent token cannot choose; the question waits for the
   person while the work proceeds as `keep` — nothing is held.

### 4.3 The delivery (one group, inside the existing pass)

Runs in `integrateGroup` (`integrationPass.ts:213`) after the existing gates: not archived/closed (`:112`), not a
dir/flow/multi group, frozen, `idle`, no backoff, not stopped, `groupComplete`. `repo` = the registered path.

1. `tip` = `orca/<g>`. `from` = `integration.lastIntegrated` when set, else `groupBaseCommit(store, g)`
   (`src/control/groupAcceptanceRecord.ts:193`; `null` ⇒ nothing landed ⇒ done with nothing written, as `local` does in
   delivery-tail Correction 3). `from == tip` ⇒ nothing new.
2. **Refuse while git is mid-operation** in the checkout: any of `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
   `rebase-merge/`, `rebase-apply/`, `BISECT_LOG` under `git rev-parse --git-dir` ⇒ blocked
   `integration-working-tree-busy:<which>`.
3. `paths` = `git diff --name-status --no-renames -z from tip` (added, modified, deleted, type-changed).
   Refuse with `integration-working-tree-unsupported:<kind>:<path>`: a gitlink (mode `160000`) at `from` or `tip`; a
   path that is a directory in the checkout but a file at `tip` or the reverse.
4. **The guard, per path p** (the whole safety rule). Let `want = tip:p` (absent if deleted) and `was = from:p` (absent
   if added). Read the checkout's `have`:
   - absent ⇔ no file and no symlink at p;
   - a symlink ⇔ its target string;
   - a file ⇔ `git hash-object --path=p -- p` (clean filters applied, as `git status` compares) plus the executable bit
     (ignored when `core.fileMode` is false).
   Then: `have == want` ⇒ p is **done** (skip); `have == was` ⇒ p is **writable**; otherwise p is a **conflict**.
   Before any check, a leading directory of p that is a symlink in the checkout ⇒ `integration-working-tree-unsafe-path:<p>`.
   Any conflict ⇒ blocked `integration-working-tree-conflict:<first 5 paths>[,+N]`; **nothing is written**.
5. Write-ahead: `recordPending({ schemeHash, tip, base: from, new: tip })` (the existing `pending` field;
   `integrationPass.ts` `recordPending`).
6. Stage the writable non-deleted paths in Orca's staging directory `S = <git-dir>/orca/deliver-<g>/` (created `0700`):
   `GIT_INDEX_FILE=S/index git update-index -z --index-info` from `git ls-tree -z tip -- <paths>`, then
   `GIT_INDEX_FILE=S/index git checkout-index --prefix=S/tree/ -- <paths>` (Appendix A: modes, symlinks, binaries, new
   directories; the live index is not touched). `S` is in the repository's own git directory so the final rename stays
   on one filesystem.
7. Re-check the guard for every writable path (narrows the window an editor could write in between; see O3), then for
   each path: deletions first (`unlink`; then `rmdir` each parent that became empty, up to the checkout root, never
   forced), then each staged file is `rename`d into place (parents created `0755` explicitly). Mode: a path that
   existed keeps its current mode unless the group changed the executable bit; a new path gets `0644`/`0755` from its
   git mode (§7).
8. Verify: every path in `paths` now satisfies `have == want`. Any that does not ⇒ blocked
   `integration-working-tree-write-failed:<path>` (the pending record stays; Retry re-enters at step 1).
9. Settle `done` with `tip`, `integrated: null` (no commit was made). `lastIntegrated = tip`. Remove `S`.

**Re-entry after a crash** between 5 and 9: a path already renamed holds `want` ⇒ "done" at step 4; a path not yet
renamed still holds `was` ⇒ writable. Every rename is atomic per file, so no path is ever torn. `S` left behind is removed
at step 6 of the next attempt for this group.

**Incremental re-delivery.** A reopened group whose tip moves after a delivery is delivered again from
`lastIntegrated`: files the person committed or left untouched pass the guard; files they edited are conflicts. To
re-deliver from scratch (the person threw the first delivery away): set the group to `keep` and back to `working-tree`;
a new record has `lastIntegrated: null` (`integrationCommands.ts:113-114`), so `from` is the base again.

### 4.4 Done, close, archive, dependents, multi, debug

- **Done does not wait for the delivery** (as for `push-*`; `deliversLocally` stays `local`-only,
  `src/control/groupEdges.ts:58`). Holding done on the person's checkout would hold every dependent on the person
  tidying their tree — the shape the human ruled out. A blocked delivery is an integration `blocked` state, which the
  group's Problems, `needsYou` and Retry (`retry-integration`) already surface.
- **Dependents** stack on `orca/<g>` (not delivered locally ⇒ `ensureWorkBranch` with the prerequisite's branch, kanban
  spec §9a.1), so they see the prerequisite's files through git, not through the person's checkout. An independent later
  group starts from `HEAD`, which does **not** include uncommitted files (O1).
- **Close** (#355): no code change. `owedDelivery` already reads a frozen non-`keep` record: `blocked` ⇒ refused
  `close-delivery-pending` with detail `blocked`; written-but-tip-moved ⇒ `not-delivered`; nothing landed ⇒ owes nothing
  (`archiveGroup.ts:200-213`). Only the refusal's next text gains "or not yet written into your working tree"
  (`src/commands/errorNext.ts:21`, words only).
- **Archived / closed**: the pass skips them (`integrationPass.ts:112`); a closed group never writes into the checkout.
  Unclose pauses a group that would run (#370), and a done group then delivers on the next round if it still owes.
- **Multi-directory**: a member repository whose default is `working-tree` is refused at accept with
  `multi-dir-delivery-unsupported:<key>`, the same branch as `push-branch` / `github-pr` (`requirementCommands.ts:534`).
  A multi working-tree delivery (N checkouts, all or none) is its own design.
- **Dir / flow groups**: unchanged (placement / copy-back only; their setters already refuse).
- **Debug groups**: `integrationTargetRef` → `null` ⇒ the correction-closed note waits until a person commits (the
  existing `keep` behaviour, `correctionState.ts:47`).

### 4.5 What Results / brief / show say afterwards

From the existing integration record (`state`, `reason`, `lastIntegrated`) and the registered path — no new server field
except `projectDeliveryChosen` (§5):

| state | CLI (`group brief`, `group show`) | Web Results card |
|---|---|---|
| group not complete | `delivery: working-tree -- will be written into <path> once the group is accepted` | same words |
| delivered (`lastIntegrated == tip`) | `delivery: working-tree -- written into <path> (uncommitted, tip <12>)`; `  review: git -C <path> status`; `  the same files: git diff --name-only <base12>...orca/<g>` | "Written into your working tree at <path>, not committed." + the two commands |
| blocked | `delivery: working-tree blocked: <reason words>` + `  next: …` (§6) | the existing blocked reason row with Retry |

### 4.6 Change-sized runs and the "step D without a checkout" direction

- The delivery reads only `orca/<g>`, `from` and their objects in the registered repository — both modes keep them
  there today, and P2's create-only pins `refs/orca/runs/<runId>` (change-sized spec §5.3) do not move `orca/<g>`. It
  reads no snapshot, archive or `<sourceDir>/repo`, so P1 (ccloop) and P2 (snapshot v2) change nothing here.
- It never creates a worktree and never checks out a tree: cost is `git diff` + one `ls-tree` + `checkout-index` of the
  touched paths, i.e. change-sized, the same direction as §13's "step D without a checkout". The temporary-index
  technique is the one change-sized D2 uses for kept worktrees (its Appendix A check 7).
- When step D stops writing `.decisions/` into a landing worktree, nothing here changes: the ledger rows reach
  `orca/<g>` either way, and they are part of `from..tip` (O2).

## 5. Data and protocol changes

| Where | Change |
|---|---|
| `integrationSchemeSchema` (`webProtocol.ts:1040`) | `z.object({ delivery: z.literal("working-tree") }).strict()` |
| `repository_settings.body.integration` | a person's `keep` is stored explicitly (§4.2); absent = never chosen. No schema change (`keep` already parses); **no control-schema migration**. Downgrade: an older build reads a stored `keep` as `keep` (it parses) and a stored `working-tree` as `repository-settings-invalid` for that repository — the one-way character integration spec §3.1 already states for any new scheme. |
| `repositoryIntegrationSchema` (`webProtocol.ts:2963`) | `chosen: boolean` (always sent) |
| group brief / group view | optional `projectDeliveryChosen: boolean`; absent reads as chosen (an older panel prints no question) |
| group integration record | none: `pending` is reused (`new = tip`), `integratedCommit` stays `null` |
| refusal / blocked codes | `integration-working-tree-conflict`, `-busy`, `-unsupported`, `-unsafe-path`, `-write-failed` (all `blocked` reasons with detail); `integration-invalid:working-tree-missing` (setter / preflight). en + zh words (`refusalCoverage` requires both). |
| CLI | `--delivery` summary gains `working-tree` (`settings.ts:46`); parser branch (`:26`): no other flag allowed with it; `docs/cli.md` regenerated |

## 6. Failure handling

All are integration `blocked` states (Problems row, `needsYou`, Retry), never a run failure; nothing is written when a
guard trips before step 7.

| Reason | When | Next (printed) |
|---|---|---|
| `integration-working-tree-conflict:<paths>` | a touched path holds content that is neither the group's starting point nor its result (the person edited it, or an untracked / ignored / committed file sits where a new file goes) | "commit, move or discard your copies of these paths, then Retry; or take the files yourself: `git checkout orca/<g> -- <path>`; or `orca group set-integration <g> --delivery keep`" |
| `integration-working-tree-busy:<op>` | a merge / rebase / cherry-pick / revert / bisect is in progress in the checkout | "finish or abort it, then Retry" |
| `integration-working-tree-unsupported:<kind>:<path>` | gitlink, or a file↔directory change at a path | "take these files by hand (commands above), or use `local` delivery" |
| `integration-working-tree-unsafe-path:<path>` | a leading directory of a touched path is a symlink in the checkout | "replace the symlink or take the files by hand" |
| `integration-working-tree-write-failed:<path>:<words>` | staging or rename failed (disk full, permission, a required filter missing), or step 8 found a path not at the tip | "fix the cause, then Retry; paths already written are kept and skipped" |
| `integration-invalid:working-tree-missing` | setter / confirm preflight: the registered path is not a work tree's top level | "re-register the project at its checkout" |
| transient (git did not answer) | `ChildTimeout` | backoff, as every delivery (`integration-backoff` activity) |

## 7. Rule 17 — writes outside Orca's own state

| | |
|---|---|
| **Paths** | (a) The registered repository's checkout, the path `orca project add --path` stored — only the paths in `git diff --name-only <from> <tip>` and parent directories they need (created) or emptied (removed). (b) Staging `<git-dir>/orca/deliver-<groupId>/` (`index`, `tree/`) inside that repository's own git directory. No path is derived from `os.homedir()`; tests register a temporary repository, which is the redirection (Rule 17's "can be re-routed"). |
| **Trigger** | The integration pass in a panel driver round, for a group whose frozen scheme is `working-tree`, complete and accepted, not archived / closed / stopped / backing off; or Retry / integrate-now, which only make it due. Only a person can put the scheme on a group (human-only setters). |
| **Modes** | (b): directory `0700`, explicit. (a): a **deliberate deviation** from Rule 17's `0700/0600`: files in a source checkout get git's modes — new files `0644` / `0755` (from the git mode), new directories `0755`, all set explicitly (never from umask); an existing file keeps its current mode unless the group flipped its executable bit. `0600` source files would break the repository for the person (served assets, other users, tools). Flagged for the human (Q2). |
| **Never** | the person's index, HEAD, any ref, stash, config, hooks; any path outside the diff; any command run in the checkout. |
| **Residue on failure** | A refused delivery: none. A crash mid-write: some touched paths at the tip, the rest unchanged — never a torn file (atomic rename) — finished by the next pass (§4.3 re-entry); and `S` until that pass. A group whose scheme is changed away while `S` exists: `S` stays (a few touched files' worth) until a later `working-tree` attempt of that group; named in the handoff, not swept automatically (Q4). |

## 8. What this closes, and what remains

**#365:** (b) the new delivery — closed by §4. Its acceptance "only-new-files group, working-tree: files appear as
untracked in the registered checkout, `main` has no new commit" is criterion WT-1. (c) "confirm shows the delivery
target; worktree+local refused at confirm" — the refusal half is not adopted (`local` works in both modes, §1); the
"show where" half is the kept lines (#365a) plus §4.5. (d) "re-evaluate the default; at least ask on first use" — the
first-use question (§4.2), default unchanged (§3 A4). (a) shipped earlier.

**#328, precisely:**
- Closes: the user-facing hole the tester pointed at — "a person who wants the result in their repository in worktree
  mode is left with only `keep`". They get `working-tree`, and `local` was never blocked by the mode (§1; the tester's
  proposed confirm refusal of worktree + `local` is therefore not built).
- Already closed before this spec: literal named-source merges (history delivery); a pending tier-0 decision makes the
  group need the person (`ad2391e3`).
- **Remains open:** (1) nothing tells an agent, before it spends tokens, that a free-text requirement asking *it* to
  write refs or make commits on `main` is impossible from a run (the history-delivery spec's "never infer from prose"
  stands; a contract line or a split-time warning would be its own change); (2) done and dependents are not held by a
  pending tier-0 decision ("a later ruling", `ad2391e3`); (3) no paid acceptance of #328 and no replay of the incident
  group (handoff §3.上一轮 2026-11-17).

## 9. Corrections to published specs (pointers only; those specs are not edited here)

When this is built, correction sections are appended (never in-place edits, Rule 13) to:
- `2026-10-08-integration-and-panel-fixes-design.md` §3 (the union and its table gain `working-tree`), §3.1 (ruling R5
  narrowed: the repository default stores a person's `keep`; absent means "never chosen"; the group copy unchanged),
  §6.5 (the reasons of §6), §8 Safety (Orca writes into the person's checkout under §4.3's guard).
- `2026-10-08-issue-fixes-design.md`, "Correction 2026-11-19 — #355 review": `close-delivery-pending` covers a
  `working-tree` record through its existing details; the next text names the working tree.
- `2026-10-20-kanban-and-group-orchestration-design.md` §9a.1: a `working-tree` group is not "delivered locally";
  dependents stack on its branch.
- No correction to the change-sized runs or history-delivery specs (§4.6, §8).

## 10. Criteria

### 10.1 New tests (each with the mutation that must turn it red; Rule 9 — seen red before it counts)

`tests/control/workingTreeDelivery.test.ts` (real git, a temporary registered repository, the integration pass driven
directly; no paid agent):
- WT-1 added-only group: files untracked in `git status --porcelain`, `git rev-parse HEAD` and
  `git for-each-ref refs/heads` byte-equal before/after, `.git/index` sha256 equal. *Mutations:* write through the live
  index (index sha differs); commit the result (HEAD differs).
- WT-2 modify + delete + binary + symlink + executable bit: each path's `have == want` after; the deleted file's emptied
  parent directory removed, a non-empty one kept.
- WT-3 the guard: a touched path edited by the person → blocked `integration-working-tree-conflict:<path>`, and the
  checkout's untouched *and* touched files byte-equal before/after (sha256 of every file). *Mutations:* drop the
  `have == was` comparison (file overwritten → red); compare against `HEAD:p` instead of the checkout (an uncommitted
  edit passes → red).
- WT-4 an untracked file, and separately an ignored file, sitting where a new file goes → conflict, untouched.
  *Mutation:* treat "absent at `from`" as writable without reading the checkout → red.
- WT-5 the person's unrelated dirty edits and staged changes elsewhere survive byte-for-byte and stay staged.
- WT-6 crash re-entry: a fault hook after the k-th rename; the next pass completes, `pending` cleared, no path torn.
  *Mutation:* skip the `have == want` ⇒ done branch → the second pass sees conflicts → red.
- WT-7 incremental: deliver, move the tip, the person commits the first delivery; second delivery writes only the new
  change. And: the person edited a delivered file → conflict.
- WT-8 an archived and a closed group with the scheme: never written. *Mutation:* delete the archived skip
  (`integrationPass.ts:112`) → red.
- WT-9 mid-merge checkout → `integration-working-tree-busy:merge`; symlinked leading directory → `-unsafe-path`;
  gitlink → `-unsupported:gitlink`.
- WT-10 staging: `S` absent after success and after a refusal; a planted stale `S` is removed by the next attempt;
  `S` mode is `0700`.

`tests/control/deliveryChoice.test.ts`: `chosen` false on a fresh repository; a person's `keep` on a fresh repository is
applied and stored (`chosen` true); `keep` again is `no-op-command`; `readIntegrationDefault` still answers `keep` for
both; the repository integration read carries `chosen`. *Mutation:* revert the explicit-`keep` write → red.

`tests/control/integrationScheme.test.ts` (added cases): the schema accepts `{delivery:"working-tree"}` and refuses it
with any extra field; `preflightScheme` on a bare repository and on a subdirectory answers `working-tree-missing`;
`set-group-integration` working-tree on a done `keep` group freezes at once and the next pass delivers.

`tests/control/integrationGit.test.ts` (added, beside `:733-779`): close refused `close-delivery-pending` for a blocked
`working-tree` record, allowed once delivered.

`tests/control/requirementMultiDelivery…` (the existing multi accept test file, located by the plan): a member default
`working-tree` → `multi-dir-delivery-unsupported:<key>`.

`tests/commands/workingTreeDelivery.test.ts`: `--delivery working-tree` parses and refuses `--target`; the §4.5 lines for
pending / delivered / blocked; the §4.2 question lines appear only when `projectDeliveryChosen === false` and the group
is done `keep`; absent field prints nothing new.

`web/tests/deliveryChoice.test.tsx`: the Results question appears only for a done `keep` group of a never-chosen project;
"Put them in my working tree" sends `set-integration-scheme` then `set-group-integration`, in that order, with the
working-tree scheme; "Keep them on the branch" sends only `set-integration-scheme` keep; the delivered and blocked rows;
the Settings option exists and reads "not chosen yet". *Mutation:* swap the two commands' order → red.

### 10.2 Existing criteria to rewrite (approved this session; each rewrite carries a `Ruling:` comment)

- `tests/control/integrationScheme.test.ts:68-79` "setting keep removes the field from the body…": now *setting keep
  stores it*; body `toEqual` at `:74` gains `integration: { delivery: "keep" }`.
- `tests/control/integrationScheme.test.ts:84`: `keep` on a fresh repository was `no-op-command`; it is now applied (it
  records the choice). The case moves to `deliveryChoice.test.ts`; the line asserts the new answer.
- `tests/panel/integrationApi.test.ts:58` and `:62`: the exact read shape gains `chosen: false` / `chosen: true`.
- Not rewritten (additive only): `tests/commands/keptDelivery.test.ts:21-27` (`toContain` per line — the question lines
  are new lines) and `web/tests/resultsConclusion.test.tsx:158` (the question is a new element, not inside `kept-take`).
  If the implementer finds either must change, it is reported, not silently rewritten.

### 10.3 Acceptance (each exits 0 or non-zero)

```
npx vitest run tests/control/workingTreeDelivery.test.ts tests/control/deliveryChoice.test.ts \
  tests/control/integrationScheme.test.ts tests/control/integrationGit.test.ts tests/commands/workingTreeDelivery.test.ts
(cd web && npx vitest run tests/deliveryChoice.test.tsx tests/resultsConclusion.test.tsx tests/integrationScheme.test.tsx)
npm test                 # quick tier per patch set (Rule 18); its skipped files copied into the report
npm run test:wide        # once per merge into main
```

Real-panel acceptance (only if the person allows a run; a fake agent suffices, no paid model): on a throwaway registered
repository, a group adding `docs/X.md` with the project's delivery chosen as working-tree, then

```
test "$(git -C "$REPO" rev-parse HEAD)" = "$HEAD_BEFORE" && \
git -C "$REPO" status --porcelain=v1 -- docs/X.md > "$OUT" && printf '?? docs/X.md\n' | cmp -s - "$OUT"
```

## 11. Phased delivery

| Phase | Content | Ships alone because | Gate |
|---|---|---|---|
| **P1** (after change-sized P1) | §4.1 scheme + preflight; §4.3 delivery; §4.4 multi refusal and next text; §4.2 explicit `keep` + `chosen`; §5 protocol; CLI parse and §4.2/§4.5 lines; Web Settings option, Results question, delivered/blocked rows; en+zh words; `docs/cli.md` | one self-contained delivery; no migration; old groups byte-identical | §10.1, §10.2, §10.3 |
| **P2** (only if the human asks, Q1) | a non-blocking note on the Web confirm card for a never-chosen project, with the same two buttons | P1 already asks where it always reaches the person | its own Web test |

## 12. Objections and consequences

- **O1 — uncommitted means invisible to the next independent group.** A later group branches from `HEAD`, which lacks
  the delivered files until the person commits them. If it touches the same paths, its own working-tree delivery is
  refused `-conflict` (the checkout holds the first group's content, not the second group's base). The next text tells
  the person to commit the earlier group's files first. A dependent group is unaffected (it stacks, §4.4).
- **O2 — `.decisions/` rows arrive as untracked files.** Landings commit ledger rows onto `orca/<g>`; they are part of
  `from..tip`, so they appear in the person's `git status` beside the work. Dropping them would lose the ledger from the
  target once the person commits (git is the ledger's source of truth, handoff §五 5.2.3). Kept; the Results row says
  "includes Orca's decision records under `.decisions/`".
- **O3 — a write window.** Between the step-7 re-check and the rename of a path (milliseconds), an editor saving that
  same path would be replaced. Not closable without locking the person's files; the content they saved is still in
  their editor. Stated, not hidden.
- **O4 — case-insensitive file systems.** A case-only rename in `from..tip` is a delete then an add of "the same" file
  on macOS; deletions run first, so it works, but a new path colliding by case with an unrelated existing file is
  reported as a conflict on that path. Accepted.
- **O5 — the group is `done` while its files may not be in the checkout** (blocked delivery). That is today's `push-*`
  behaviour, and the alternative holds dependents on the person. The Problems row and the Results row say it.
- **O6 — R5 narrowed.** "Keep is the field's absence" now holds for group copies only. One explicit-`keep` write per
  project; an old build reads it fine.

## 13. Open questions for the human

- **Q1.** Is the Results card (done group) enough as "the first use", or should the Web confirm card also ask (P2)? The
  spec asks on Results because auto-confirm starts most groups without a person; asking at confirm would never gate it.
- **Q2.** Rule 17 says new files `0600` / directories `0700`. For files written into a *source checkout* this spec uses
  git's modes (`0644`/`0755`, set explicitly) and keeps an existing file's mode. Approve the deviation?
- **Q3.** Done does not wait for a working-tree delivery (O5). Agree, or should done wait (and dependents with it)?
- **Q4.** A stale staging directory of a group that left `working-tree` is not swept automatically (§7). Sweep it at
  panel start, or leave it named in the handoff?

## Appendix A — toy check (run once, session `3ba26002`, Orca `main` `4f53a087`, `git version 2.50.1 (Apple Git-155)`)

In a fresh repository (scratchpad `wt-toy/r`): `base` with `a.txt`, `d.txt`; branch `orca/g` modifying `a.txt`,
deleting `d.txt`, adding `docs/new/n.md`, a binary `b.bin`, an executable `x.sh` and a symlink `link`; back on `main`.
Then `git ls-tree -z <tip> -- <paths> > S/list`, `GIT_INDEX_FILE=S/index git update-index -z --index-info < S/list`
(rc 0), `GIT_INDEX_FILE=S/index git checkout-index --prefix=S/tree/ -- <paths>` (rc 0). Observed: `S/tree` held
`a.txt` (0644), `b.bin`, `x.sh` (0755), `link -> a.txt` (a symlink) and `docs/new/n.md` with its directories;
`shasum .git/index` before and after were identical; `git status --porcelain` in the checkout was empty. Not checked
here: the rename step, filters (LFS / eol), and the symlinked-leading-path refusal — those are WT-2, WT-9 and the
plan's first task.
