# Working-tree delivery: a finished group's files land in the person's checkout, uncommitted (#365, #328) — design

- **Who:** a design subagent (Claude Opus 5.5) spawned by the Orca control session `3ba26002` on 2026-11-19. It read
  Orca `main` at `4f53a087` (`/usr/bin/git -C /Users/biran/code/skills/orca/Orca rev-parse --short HEAD`, in the
  worktree `.wt-spec-365` cut from it). Every `file:line` below is at that commit.
- **Revision 2 (same author, same session):** after an independent review (verdict "implement after resolutions"; it
  confirmed §1's claim that `local` does not depend on the workspace mode) and the controller's rulings on it. Each
  finding's resolution is listed in §14; each cited line was re-read at `4f53a087` before this revision. The spec is not
  published (branch `docs/spec-365` only), so it is revised in place.
- **What was executed:** no Orca test. One toy-repository git check (Appendix A) in the session scratchpad.
- **Status:** design, not built. A person reviews it first. Implementation is ordered **after change-sized runs P1**
  (human ruling below); nothing here depends on P1 or P2 code (§4.7).
- **Human ruling (this session, verbatim):** 「同意你的建议」, answering the controller's proposal: add a delivery that
  writes the group's result into the registered repository's working tree **without committing**, chosen by the person
  on first use (the first group of a project, i.e. while no delivery was ever chosen for it); brainstorm, then spec;
  build after change-sized runs P1. The same session approved rewriting necessary criteria (named in §10.2). For the
  review round the human said 「先按你的建议执行…最后报给我审核」: the controller's rulings listed in §13 are
  **controller rulings awaiting the human's review**.
- **Inputs:** tester bodies "Issue 365" and "Issue 328" in
  `/Users/biran/code/skills/orca/orca_archived_files/issue-20261023.md`; `docs/handoff/handoff.md` §三 3.最新, §五, §六.4;
  the integration spec `2026-10-08-integration-and-panel-fixes-design.md`; the history-delivery spec
  `2026-11-16-history-delivery-design.md`; the change-sized runs spec `2026-11-19-change-sized-runs-design.md` (§13); the
  tester round 2 spec `2026-10-24-tester-round2-design.md` (§7.2); the CLI v2 spec `2026-10-21-cli-v2-design.md` (§15.1).
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

**What #328 says and what the code says.** The controller's brief, following the tester, read "`local` in worktree mode
cannot move `main`". The code says something narrower (the review confirmed it), and the difference matters for A3 (§3):

- The **run** cannot write refs in the shared git directory of a `worktree`-mode workspace (ccloop's write scope; the
  tester's two `pendingDecision`s are the evidence). An agent asked *by the requirement* to make merge commits on `main`
  therefore cannot, and in #328 it improvised (merged in a private clone, copied the tree back).
- **Orca's own** `local` delivery is not done by the run. The integration pass, in the panel process, moves
  `refs/heads/<target>` of the *registered* repository with `update-ref` (or `merge --ff-only` in the worktree that has
  it checked out) (`src/control/integrationPass.ts:415-433`). The work branch `orca/<g>` also lives in the registered
  repository in both workspace modes (`ensureWorkBranch(targetRepo, …)`, `src/control/workspace.ts:99-107`;
  `executionDriver.ts:487,515`). So `local` does not depend on the workspace mode.
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
- G2. **Never overwrite what the person has.** A path is written only when its current entry in the person's checkout
  (type, mode, content) is one Orca can reproduce from git (what it was before this group, or already the group's
  result). Anything else is refused by name, with paths and a next step, and nothing is written.
- G3. The person chooses on first use; the choice is remembered for the project; nothing waits on the choice
  (handoff §五 5.3 and the human's 「不要卡在人这里」), and choosing `working-tree` does not make later groups wait
  either (§4.2, C1).
- G4. Results / `group brief` / `group show` say where the files went, or why they did not.

**Non-goals**
- N1. Changing the default (alternative 4, rejected in §3).
- N2. Any change to `local`, `push-*`, `github-pr`, history delivery or multi-directory landing. Multi-directory groups
  refuse `working-tree` by name (§4.5).
- N3. Running any of the person's or the project's commands (checks, setup, hooks) in the person's checkout. Git's own
  configured filters (clean / smudge, eol, LFS) **do** run, exactly as `git status` and `git checkout` would run them.
- N4. Telling an agent at confirm that a free-text requirement asks it to write refs (#328 remainder, §8).

## 3. Alternatives considered (brainstorm)

**A1. `delivery: "working-tree"` applied by the integration pass.** The group's change `from..tip` (`from` = the last
delivered tip, else the group's base) is written into the checkout path by path, each path guarded by "its current entry
is `from`'s or `tip`'s".
- Dirty tree: only the paths the group touches matter. Unrelated edits, untracked files and staged work elsewhere are
  never read or written. A touched path the person edited → refused (`integration-working-tree-conflict:<paths>`),
  nothing written.
- Diverged HEAD (the person committed or switched branches since the group began): the same per-path rule covers it.
  A touched path whose content changed since base is "not `from`'s" → refused. Untouched paths: irrelevant.
- Untracked new files: a new path that already exists in the checkout (untracked, ignored, or tracked) → refused unless
  it already holds the tip's entry.
- Deletions: removed only when the file still holds `from`'s entry; an absent file is already delivered.
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
  (`src/control/integrationCommands.ts:84-131`), and the next pass delivers it.

**A3. Make `local` work in worktree mode by having Orca, not the agent, advance the ref.** That is **already how `local`
works** (§1). Nothing to build. It does not close #328's root cause either: a *requirement* asked the *agent* to make
specific merge commits — what history delivery (`2026-11-16-history-delivery-design.md`, on `main`) built. And it does
not answer #365: `local` commits into the person's branch; #365 asks for files to review, uncommitted.

**A4. Change the default** (absent ⇒ `working-tree`, or ⇒ `local`).
- Against: an upgrade would start writing into checkouts of every existing project whose owner never asked for it — the
  one thing G2 exists to prevent, done silently. Projects used only by agents, or where the person keeps unrelated
  work in progress, would collect untracked files from every group. A default must be safe with nobody watching;
  `keep` is the only delivery that writes nothing outside Orca's namespace. The human's ruling chose "ask on first use".

**A5 (considered, rejected). Patch-based apply** (`git diff --binary from tip | git apply`). `git apply` is atomic and
handles binaries, but it merges hunks into a file the person edited (context still matches) — G2 forbids mixing their
uncommitted edits with ours — and it does not run smudge filters (LFS, eol). The per-path entry guard plus
`checkout-index` is both stricter and closer to what `git checkout` would produce.

**Recommendation: A1, with A2 as its natural use on a done group, no new verb; A3 is a clarification only (§1); A4
rejected.** A1 reuses the integration record, the pass, Retry, the Problems surface and `close-delivery-pending`
unchanged; its whole safety rule is one per-path predicate whose every clause has its own criterion (§10.1); and it
never needs a checkout of its own (§4.7).

## 4. Design

### 4.1 The scheme

```ts
| { delivery: "working-tree" }   // strict: no trigger, method, target or remote
```

- Trigger is fixed to "group": the pass delivers only when `groupComplete` holds (every task done, no active run but the
  requirement review's own call, accepted on the final tip; `integrationPass.ts` `groupComplete`). Per-task writes into
  the person's checkout would churn their tree mid-group; not offered.
- Who may set it: `set-group-integration` / `set-integration-scheme` with a non-`keep` scheme are `token` tier on the
  socket (`deliveryTier`, `src/panel/humanOnly.ts:192-195,256-257`) and human-only for Web members; unchanged. The
  repository-level `keep` changes tier in §4.2.
- `checkScheme` / `preflightScheme` (`src/control/integrationScheme.ts:122-174`): for `working-tree`, the registered path
  must be the top level of a non-bare work tree (`git rev-parse --is-inside-work-tree` prints `true` and
  `--show-toplevel` is the registered path's realpath), else `working-tree-missing`. The checkout's state is judged at
  delivery time, not at confirm.
- Code that reads `scheme.target` for every non-`keep` scheme gains a `working-tree` branch. Known sites:
  `integrationScheme.ts:130` (schemeCheck), `integrationPass.ts:213-245` (dispatch, §4.3), `integrationCommands.ts:119`
  (`sameDestination`: same delivery ⇒ same destination), `ledgerAtRef.ts:81` (`integrationTargetRef` → `null`, as for
  `keep`), `requirementCommands.ts:534` (multi refusal, §4.5), Web `IntegrationScheme.tsx:22,68-91`, `GitScheme.tsx`, CLI
  `src/commands/domains/settings.ts:22-46`. The typecheck lists any other; each is named in the plan.

### 4.2 "Never chosen", the first-use choice, and auto-confirm

**Data.** Today `set-integration-scheme` with `keep` deletes the field (`integrationCommands.ts:63`, ruling R5), so "the
person chose keep" and "nobody ever chose" are the same bytes. Change, **for the repository default only**: setting
`keep` stores `integration: { delivery: "keep" }` explicitly. Then:

- `chosen(repo) := repository_settings.body.integration !== undefined`.
- `readIntegrationDefault` is unchanged (absent ⇒ `keep`), so every group gets exactly what it gets today.
- The no-op check compares against the stored field, not the default: `keep` on a never-chosen project is **applied**
  (it records the choice); `keep` again is `no-op-command`.
- The group copy keeps R5 (absent ⇒ `keep`); group bodies are byte-identical to today's.

**Only a person records the choice (review I2; controller ruling, awaiting the human).** Today `deliveryTier` makes a
`keep` payload `open` for **both** setters (`humanOnly.ts:192-195,256-257`), so the socket agent could store `keep` and
silence the question for good. Ruling: `set-integration-scheme` becomes `token` for every payload (the repository
default is where work goes for every later group: a person's act); `set-group-integration` keeps `deliveryTier` (an
agent may still set *one group* to `keep`). Web members are unchanged (the setters are human-only there already).
Consequence: `tests/panel/accessMatrix.test.ts:84` is rewritten (§10.2).

**Auto-confirm must not start waiting (review C1; controller ruling, awaiting the human).** Every new group copies the
repository default (`src/control/planImport.ts:412-419`). Auto-confirm condition 6 refuses any non-`keep` record
(`src/control/autoConfirm.ts:67`, code `delivery-scheme`), and the automatic confirmer never sends `integrationHash`
(`src/control/webService.ts:907`; the payload is built at `:1539`). So choosing `working-tree` for the project would
make every later group wait for a person at confirm — the opposite of G3. Ruling:
- Condition 6 passes when the group's scheme is `working-tree` **and** canonical-byte-equal to the repository's stored
  default (which, after the tier change above, only a person can have stored). `local` / `push-*` / `github-pr` keep
  condition 6 unchanged: they publish to a branch or a remote, which an owner approves per group (integration spec §3.2).
- For such a group the automatic confirmer sends `integrationHash = schemeHash` (the server's hash of the group's
  record), so confirm's `integration-unapproved` check (`webService.ts:2574`) passes. The socket already admits
  `confirm.integrationHash` as `open` (`humanOnly.ts:255`).
- This amends tester round 2 §7.2 condition 6 / ruling H4 (Correction pointer in §9).

**Where the choice is asked — never as a gate.**

1. **Results of a done `keep` group in a never-chosen project (Web) — the one required place (Q1, controller ruling
   awaiting the human).** Auto-confirm starts most groups without a person at confirm, so confirm is not a reliable
   "first use"; a done group's Results is where the person looks for the files. Under the #365(a) kept lines the card
   shows *"Where should finished files go for this project?"* with
   - primary: **Put them in my working tree** (`<registered path>`, uncommitted) → `set-integration-scheme`
     `{delivery:"working-tree"}` for the project, then `set-group-integration` `{delivery:"working-tree"}` for this
     group; the next driver round writes them (§4.4);
   - secondary: **Keep them on the branch** → `set-integration-scheme` `{delivery:"keep"}` (stored explicitly); the
     question stops; the kept lines stay;
   - a line: "Other deliveries (merge into a branch, push, pull request): Project settings".
   **The two-command flow:** the first answering `no-op-command` (the project already holds that scheme — a second tab)
   counts as success and the second is still sent. The second failing leaves the project chosen and this group `keep`:
   the card then shows the kept lines plus a single "Put this group's files in my working tree" button
   (`set-group-integration` only) and the error words. Both paths have criteria (§10.1).
2. **Project settings → Delivery**: `working-tree` is a sixth option ("write into my working tree, uncommitted"); a
   never-chosen project reads "not chosen yet (groups keep their files on `orca/<group>`)".
3. **CLI**: no new verb and no new flag. `--delivery working-tree` is accepted by `orca project set-integration` and
   `orca group set-integration`. `group brief` / `group show` of a done `keep` group in a never-chosen project print,
   before the #365(a) lines:
   ```
   delivery: not chosen for this project yet (a person's choice; needs a person token)
     put this group's files in your working tree (uncommitted): orca group set-integration <g> --delivery working-tree
     and for later groups: orca project set-integration --delivery working-tree   (or --delivery keep)
   ```
   `group confirm` on such a project prints the first line and the project command once after its receipt and proceeds.
4. **Agents** cannot choose (token tier, above). The question waits for the person while the work proceeds as `keep`;
   nothing is held.
5. **Existing projects:** a project whose owner chose `keep` before this change has no stored field (R5 deleted it), so
   it is asked once (O6).

### 4.3 Dispatch inside the pass (review I4)

In `integrateGroup` (`integrationPass.ts:213`), directly after the history branch (`:220-223`) and before `caughtUp`
(`:227`), so `scheme.trigger` (`:236`) and `nothingLanded` (`:240`) are never reached for this scheme:

```ts
if (scheme.delivery === "working-tree") {
  if (!groupComplete(deps.store, groupId)) return null;
  if (tip === integration.lastIntegrated && reentry(integration) === null) return null;
  return integrateWorkingTree(deps, repo, groupId, integration, tip);
}
```

The outer gates still apply first: not archived / closed (`:112`), not a dir / flow / multi group, frozen, `idle`, no
backoff, not stopped (`:126-129`).

### 4.4 The delivery (`integrateWorkingTree`)

`repo` = the registered path. Every git child that takes paths runs with `--literal-pathspecs`; path lists go through
`-z` / `--stdin -z`, never the command line.

1. **Prerequisites (review I3; controller ruling, awaiting the human).** A dependent stacks on a prerequisite's branch
   whenever the prerequisite does not deliver locally (`stackBaseOf`, `src/control/groupEdges.ts:122-134`), and the pass
   visits groups in id order (`integrationPass.ts:100`), so a dependent could be written without its prerequisite. For
   each prerequisite `P` of this group that does not deliver locally:
   - `P` is `working-tree` and not yet delivered (`lastIntegrated != tip(orca/P)`, or `pending` set, or not `idle`) ⇒
     **not due** (`return null`); the read side shows "waiting for `<P>` to be written into your working tree first".
     The next round re-checks, so dependent-first ids cost one round.
   - `P` is `keep`, `push-*`, `github-pr`, or anything else ⇒ blocked `integration-working-tree-prerequisite:<P>` (next:
     deliver `<P>` to the working tree too, or take this group's files by hand, or set this group to `keep`).
2. `from` = `integration.lastIntegrated` when set, else `groupBaseCommit(store, g)`
   (`src/control/groupAcceptanceRecord.ts:193`; `null` ⇒ nothing landed ⇒ settle done with nothing written, as `local`
   does in delivery-tail Correction 3). `from == tip` and no `pending` ⇒ nothing new.
3. **Busy checkout.** Under `git rev-parse --git-dir`: any of `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
   `rebase-merge/`, `rebase-apply/`, `sequencer/`, `BISECT_LOG` ⇒ blocked `integration-working-tree-busy:<which>`.
   `index.lock` present ⇒ **transient** (another git is running; backoff), not blocked.
4. **Same device.** `S = <git-dir>/orca/deliver-<g>/` must be on the same device as the checkout root (`stat().dev`);
   otherwise blocked `integration-working-tree-unsupported:cross-device` (a `.git` file pointing to another volume —
   `rename` would fail with `EXDEV`).
5. **Paths.** `git diff --raw -z --no-renames <from> <tip>` gives each path with its old and new (mode, oid). Each path
   is validated: relative, non-empty components, no `.` / `..` component, no component equal to `.git` compared
   case-insensitively ⇒ otherwise `integration-working-tree-unsafe-path:<p>`. Refused as
   `integration-working-tree-unsupported:<kind>:<p>`: a gitlink (`160000`) at either side (`gitlink`); **a case-only
   rename** — two paths in the set that differ only by case (`case-rename`; review I1, controller ruling awaiting the
   human). Refusing is chosen over pairing the delete with the add: on a case-insensitive filesystem the two are one
   file, and pairing would need its own guard.
6. **The guard, per path p** — the whole safety rule (review I5). Let `want` = the tip's entry and `was` = the set
   {`from`'s entry, and `pending.tip`'s entry when a write-ahead record exists (a crash may have renamed some paths to an
   older tip; review M1)}; an entry is `(type, mode, oid)` or *absent*.
   - **Leading components first:** every leading directory of p in the checkout is `lstat`ed and must be a real
     directory — a symlink, a regular file, or a directory holding `.git` (a nested repository) ⇒
     `integration-working-tree-unsafe-path:<p>`.
   - **`have` from `lstat(p)`, never following a link:** absent ⇒ *absent*; a symlink ⇒ `(link, 120000, oid of its
     target string hashed as a blob)` (`hash-object <path>` would follow the link, so the target string is hashed
     through `git hash-object --stdin` without filters); a regular file ⇒ `(file, 100755 if executable else 100644,
     oid)` with the oid from `git hash-object --stdin-paths` (clean filters applied by path, as `git status` compares);
     a directory ⇒ `(dir)`, which matches nothing at the tip ⇒ `integration-working-tree-unsupported:dir:<p>`.
   - With `core.fileMode=false` the executable bit is not compared (git semantics) and is not written (step 9).
   - `have == want` ⇒ p is **done**; `have ∈ was` ⇒ p is **writable**; otherwise p is a **conflict**.
   Any conflict ⇒ blocked `integration-working-tree-conflict:<first 5 paths>[,+N]`; **nothing is written**.
7. Write-ahead: `recordPending({ schemeHash, tip, base: from, new: tip })` (the existing `pending` field).
8. Stage the writable non-deleted paths in `S` (created `0700`): `GIT_INDEX_FILE=S/index git update-index -z
   --index-info` from `git ls-tree -z <tip>` of those paths, then `GIT_INDEX_FILE=S/index git checkout-index -z --stdin
   --prefix=S/tree/` (Appendix A: modes, symlinks, binaries, new directories; the live index is not touched).
9. **Re-check every path in the set** (done and writable) with step 6's guard immediately before the first write
   (review M10; narrows the editor window, O3); a path that turned into a conflict ⇒ blocked `-conflict`, nothing
   written yet. Then: deletions (`unlink`); then each staged file is `rename`d into place (parents created `0755`
   explicitly). **Modes (review I8, controller ruling awaiting the human):** the group's change of the executable bit is
   applied (git semantics, except under `core.fileMode=false`); Orca never changes any other mode — an existing file
   keeps its permission bits except that one bit when the group flipped it; a new file gets `0644` / `0755` from its git
   mode, set explicitly.
10. **Empty directories (review M2):** for every path deleted by `from..tip` — on every pass, not only the one that
    deleted it — `rmdir` each parent up to the checkout root while it is empty (never forced; `ENOTEMPTY` stops).
11. Verify: every path in the set satisfies `have == want`. Any that does not ⇒ blocked
    `integration-working-tree-write-failed:<path>` (the pending record stays; Retry re-enters at step 1).
12. Settle `done` with `tip`, `integrated: null` (no commit was made); `lastIntegrated = tip`. Remove `S`.

**Errors are caught where they happen (review I9).** Steps 8–11 wrap every filesystem and git call: an `fs` error
(`ENOSPC`, `EACCES`, `EXDEV`, `EPERM`) or a failing git child ends **blocked** `integration-working-tree-write-failed:
<path>:<code>` with the written-so-far count and the first written paths (review M7). Left uncaught, the pass would map
it to a transient backoff (`integrationPass.ts:131-138`) and retry a disk-full write every few minutes. Only
`ChildTimeout` and `index.lock` stay transient.

**Re-entry after a crash** between 7 and 12: a path already renamed holds `want` ⇒ done; a path renamed to an older
`pending.tip` is in `was` ⇒ writable; a path not yet renamed still holds `from`'s entry ⇒ writable. Every rename is
atomic per file, so no path is ever torn. `S` is removed at step 8 of the next attempt for this group and at panel start
(§7).

**Incremental re-delivery.** A reopened group whose tip moves after a delivery is delivered again from
`lastIntegrated`: files the person committed or left untouched pass the guard; files they edited are conflicts. To
re-deliver from scratch (the person threw the first delivery away): set the group to `keep` and back to `working-tree`;
a new record has `lastIntegrated: null` (`integrationCommands.ts:113-114`), so `from` is the base again.

### 4.5 Done, close, archive, dependents, multi, debug, checks

- **Done does not wait for the delivery (Q3, controller ruling awaiting the human)** — as for `push-*`;
  `deliversLocally` stays `local`-only (`src/control/groupEdges.ts:58`). Holding done on the person's checkout would hold
  every dependent on the person tidying their tree. A blocked delivery is an integration `blocked` state, which the
  group's Problems, `needsYou` and Retry (`retry-integration`) already surface.
- **Dependents** stack on `orca/<g>` (kanban spec §9a.1), so they *run* on the prerequisite's files through git; their
  own working-tree delivery waits for the prerequisite's (§4.4 step 1). An independent later group starts from `HEAD`,
  which does **not** include uncommitted files (O1).
- **Close** (#355): no code change. `owedDelivery` already reads a frozen non-`keep` record: `blocked` ⇒ refused
  `close-delivery-pending` with detail `blocked`; tip moved since the last write ⇒ `not-delivered`; nothing landed ⇒
  owes nothing (`archiveGroup.ts:200-213`). Only the refusal's next text gains "or not yet written into your working
  tree" (`src/commands/errorNext.ts:21`, words only).
- **Archived / closed**: the pass skips them (`integrationPass.ts:112`); a closed group never writes into the checkout.
  Unclose pauses a group that would run (#370), and a done group then delivers on the next round if it still owes.
- **Multi-directory**: a member repository whose default is `working-tree` is refused at accept with
  `multi-dir-delivery-unsupported:<key>`, beside `push-branch` / `github-pr` (`requirementCommands.ts:534`).
- **Dir / flow groups**: unchanged (placement / copy-back only; their setters already refuse).
- **Debug groups**: `integrationTargetRef` → `null`; the correction-closed note waits until a person commits (the
  existing `keep` behaviour, `correctionState.ts:47`).
- **Project checks** watch only `local` targets (`src/control/checks/pass.ts:19-30`): a `working-tree` group's result is
  not watched by project checks until the person commits it to a watched branch (review M8).

### 4.6 What Results / brief / show say afterwards

From the existing integration record (`state`, `reason`, `lastIntegrated`) and the registered path — no new server field
except `projectDeliveryChosen` (§5):

| state | CLI (`group brief`, `group show`) | Web Results card |
|---|---|---|
| group not complete | `delivery: working-tree -- will be written into <path> once the group is accepted` | same words |
| waiting on a prerequisite | `delivery: working-tree -- waiting for <P> to be written first` | same words |
| delivered (`lastIntegrated == tip`) | `delivery: working-tree -- written into <path> (uncommitted, tip <12>), including Orca's decision records under .decisions/`; `  review: git -C <path> status`; `  the same files: git diff --name-only <base12>...orca/<g>` | "Written into your working tree at <path>, not committed." + the two commands |
| blocked | `delivery: working-tree blocked: <reason words>` + `  next: …` (§6); for `-write-failed`, the paths already written | the existing blocked reason row with Retry |

### 4.7 Change-sized runs and the "step D without a checkout" direction

- The delivery reads only `orca/<g>`, `from` and their objects in the registered repository — both modes keep them
  there today, and P2's create-only pins `refs/orca/runs/<runId>` (change-sized spec §5.3) do not move `orca/<g>`. It
  reads no snapshot, archive or `<sourceDir>/repo`, so P1 (ccloop) and P2 (snapshot v2) change nothing here.
- It never creates a worktree and never checks out a tree: cost is one `git diff --raw` + one `ls-tree` +
  `checkout-index` of the touched paths, i.e. change-sized, the direction of §13's "step D without a checkout". The
  temporary-index technique is the one change-sized D2 uses for kept worktrees (its Appendix A check 7).
- When step D stops writing `.decisions/` into a landing worktree, nothing here changes: the ledger rows reach
  `orca/<g>` either way, and they are part of `from..tip` (O2).

## 5. Data and protocol changes

| Where | Change |
|---|---|
| `integrationSchemeSchema` (`webProtocol.ts:1040`) | `z.object({ delivery: z.literal("working-tree") }).strict()` |
| `repository_settings.body.integration` | `keep` is stored explicitly (§4.2); absent = never chosen. No schema change (`keep` already parses); **no control-schema migration**. Downgrade: an older build reads a stored `keep` as `keep` and a stored `working-tree` as `repository-settings-invalid` for that repository — the one-way character integration spec §3.1 already states for any new scheme. |
| `repositoryIntegrationSchema` (`webProtocol.ts:2963`) | `chosen: boolean` (always sent) |
| group brief / group view | optional `projectDeliveryChosen: boolean`; absent reads as chosen (an older panel prints no question) |
| group integration record | none: `pending` is reused (`new = tip`), `integratedCommit` stays `null` |
| socket tier (`humanOnly.ts:256`) | `set-integration-scheme`: `token` for every payload; `set-group-integration` unchanged |
| auto-confirm (`autoConfirm.ts:67`, the automatic confirmer in `webService.ts`) | condition 6 exemption and `integrationHash` for a `working-tree` copy equal to the stored default (§4.2) |
| blocked / refusal codes | `integration-working-tree-conflict`, `-busy`, `-unsupported`, `-unsafe-path`, `-write-failed`, `-prerequisite` (all `blocked` reasons with detail); `integration-invalid:working-tree-missing` (setter / preflight). en + zh words (`refusalCoverage` requires both). |
| words | `integration-worktree-dirty`'s text gains "(files a working-tree delivery wrote count too: commit or move them)" (`web/src/locales/en.ts:1205`, `zh.ts:1030`) — review I6 |
| CLI | `--delivery` summary gains `working-tree` (`settings.ts:46`); parser branch (`:26`): no other flag allowed with it; `docs/cli.md` regenerated |

## 6. Failure handling

All are integration `blocked` states (Problems row, `needsYou`, Retry), never a run failure; nothing is written when a
guard trips before step 9.

| Reason | When | Next (printed) |
|---|---|---|
| `integration-working-tree-conflict:<paths>` | a touched path's entry is neither the group's starting point nor its result (the person edited it or changed only its executable bit, or an untracked / ignored / committed file or a symlink sits where the tip has something else) | "commit, move or discard your copies of these paths, then Retry; or take the files yourself: `git checkout orca/<g> -- <path>`; or `orca group set-integration <g> --delivery keep`" |
| `integration-working-tree-busy:<op>` | merge / rebase / cherry-pick / revert / sequencer / bisect in progress | "finish or abort it, then Retry" |
| `integration-working-tree-unsupported:<kind>:<path>` | `gitlink`, `dir` (a directory where the tip has a file), `case-rename`, `cross-device` | "take these files by hand (commands above), or use `local` delivery" |
| `integration-working-tree-unsafe-path:<path>` | a leading component is a symlink, a file or a nested repository; or a path fails validation | "replace that component or take the files by hand" |
| `integration-working-tree-unsafe-path:<dir>/<path>` (accepted limit, §16) | the group turns a file into a directory (`a` deleted, `a/b` added): the checkout's `a` is still a file, a leading component | "take these files by hand: `git rm a` (or move it), then `git checkout orca/<g> -- a/b`; or set this group to `keep`" |
| `integration-working-tree-unsupported:dir:<path>` (accepted limit, §16) | the group turns a directory into a file (`a/b` deleted, `a` added): the checkout's `a` is still a directory | "take these files by hand: remove the directory `a`, then `git checkout orca/<g> -- a`; or set this group to `keep`" |
| `integration-working-tree-unsafe-path:<path with U+FFFD>` (§16) | a path that is not valid UTF-8 (git prints raw bytes; read as UTF-8 they turn into U+FFFD), or a valid path that holds U+FFFD itself | "take that file by hand: `git checkout orca/<g> -- <path>` in a shell that passes the bytes" |
| `integration-working-tree-prerequisite:<P>` | a prerequisite this group stacks on is not delivered to the working tree | "deliver `<P>` to the working tree, take this group's files by hand, or set it to `keep`" |
| `integration-working-tree-write-failed:<path>:<code>` | staging or rename failed (disk full, permission, a required filter missing), or step 11 found a path not at the tip | "fix the cause, then Retry; written so far: <n> (<paths>), they are kept and skipped" |
| `integration-invalid:working-tree-missing` | setter / confirm preflight: the registered path is not a work tree's top level | "re-register the project at its checkout" |
| transient | `ChildTimeout`, or `index.lock` present | backoff, as every delivery (`integration-backoff` activity) |

## 7. Rule 17 — writes outside Orca's own state

| | |
|---|---|
| **Paths** | (a) The registered repository's checkout, the path `orca project add --path` stored — only the paths in `git diff --raw <from> <tip>` and parent directories they need (created) or emptied (removed). (b) Staging `<git-dir>/orca/deliver-<groupId>/` (`index`, `tree/`) inside that repository's own git directory. No path is derived from `os.homedir()`; tests register a temporary repository, which is the redirection. |
| **Trigger** | (a)+(b): the integration pass in a panel driver round, for a group whose frozen scheme is `working-tree`, complete and accepted, not archived / closed / stopped / backing off, its stacked prerequisites delivered; Retry / integrate-now only make it due. (b) removal also **at panel start** (Q4, controller ruling awaiting the human), before the driver's first round, for every registered repository whose path resolves: every `<git-dir>/orca/deliver-*` is removed (no pass is running then, and re-entry never reads `S` — it reads the checkout). |
| **Modes** | (b): directory `0700`, explicit. (a): a **deliberate deviation** from Rule 17's `0700/0600` (I8, controller ruling awaiting the human): new files `0644` / `0755` from the git mode and new directories `0755`, all set explicitly (never from umask); an existing file's permission bits are never changed except the executable bit when the group changed it (git semantics; not under `core.fileMode=false`). |
| **Never** | the person's index, HEAD, any ref, stash, config, hooks; any path outside the diff; any of the person's commands. |
| **Residue on failure** | A refused delivery: none. A crash mid-write: some touched paths at the tip, the rest unchanged — never a torn file (atomic rename) — finished by the next pass (§4.4 re-entry); `S` until that pass or the next panel start. A panel-start sweep that fails for one repository (path gone, permission) is logged per repository and leaves its `S`; it never stops the panel. A repository no longer registered keeps its `S` (Orca no longer knows the path); named in the handoff. |

## 8. What this closes, and what remains

**#365:** (b) the new delivery — closed by §4. Its acceptance "only-new-files group, working-tree: files appear as
untracked in the registered checkout, `main` has no new commit" is criterion WT-1. (c) "confirm shows the delivery
target; worktree+local refused at confirm" — the refusal half is not adopted (`local` works in both modes, §1); the
"show where" half is the kept lines (#365a) plus §4.6. (d) "re-evaluate the default; at least ask on first use" — the
first-use question (§4.2), default unchanged (§3 A4). (a) shipped earlier.

**#328, precisely:**
- Closes: the user-facing hole the tester pointed at — "a person who wants the result in their repository in worktree
  mode is left with only `keep`". They get `working-tree`, and `local` was never blocked by the mode (§1; the tester's
  proposed confirm refusal of worktree + `local` is therefore not built).
- Already closed before this spec: literal named-source merges (history delivery); a pending tier-0 decision makes the
  group need the person (`ad2391e3`).
- **Remains open:** (1) nothing tells an agent, before it spends tokens, that a free-text requirement asking *it* to
  write refs or make commits on `main` is impossible from a run; (2) done and dependents are not held by a pending
  tier-0 decision ("a later ruling", `ad2391e3`); (3) no paid acceptance of #328 and no replay of the incident group.

## 9. Corrections to published specs (pointers only; those specs are not edited here)

When this is built, correction sections are appended (never in-place edits, Rule 13) to:
- `2026-10-08-integration-and-panel-fixes-design.md` §3 (the union and its table gain `working-tree`), §3.1 (ruling R5
  narrowed: the repository default stores `keep`; absent means "never chosen"; the group copy unchanged), §6.5 (the
  reasons of §6), §8 Safety (Orca writes into the person's checkout under §4.4's guard).
- `2026-10-24-tester-round2-design.md` §7.2 condition 6 and ruling H4: a `working-tree` copy equal to the stored default
  passes condition 6, and the automatic confirmer sends its `integrationHash` (§4.2, C1).
- `2026-10-21-cli-v2-design.md` §15.1: `set-integration-scheme` is `token` for every payload (I2).
- `2026-10-08-issue-fixes-design.md`, "Correction 2026-11-19 — #355 review": `close-delivery-pending` covers a
  `working-tree` record through its existing details; the next text names the working tree.
- `2026-10-20-kanban-and-group-orchestration-design.md` §9a.1: a `working-tree` group is not "delivered locally";
  dependents stack on its branch, and their working-tree delivery waits for the prerequisite's.
- No correction to the change-sized runs or history-delivery specs (§4.7, §8).

## 10. Criteria

### 10.1 New tests (each names the mutation that must turn it red; Rule 9 — seen red before it counts)

`tests/control/workingTreeDelivery.test.ts` (real git, a temporary registered repository, the pass driven directly; no
paid agent):
- WT-1 added-only group: files untracked in `git status --porcelain`, `git rev-parse HEAD` and
  `git for-each-ref refs/heads` byte-equal before/after, `.git/index` sha256 equal. *Mutations:* write through the live
  index (index sha differs); commit the result (HEAD differs).
- WT-2 modify + delete + binary + symlink + an executable-bit flip: each path's `have == want` after; a planted `0640`
  file whose executable bit the group adds becomes `0750` (its other bits kept); the deleted file's emptied parent is
  removed, a non-empty one kept. *Mutation:* chmod from the git mode alone (`0755`) → red.
- WT-3 content edit by the person → `-conflict:<path>`, every file of the checkout byte-equal before/after (sha256 of
  each). *Mutations:* drop the `have ∈ was` comparison → red; compare against `HEAD:p` instead of the checkout → red.
- WT-4 untracked file, and separately an ignored file, where a new file goes → conflict, untouched. *Mutation:* treat
  "absent at `from`" as writable without reading the checkout → red.
- WT-5 unrelated dirty edits and staged changes elsewhere survive byte-for-byte and stay staged.
- WT-6 crash re-entry: a fault hook after the k-th rename; the next pass completes, `pending` cleared, no path torn.
  *Mutation:* drop the `have == want` ⇒ done branch → red. Second case: the tip moves between crash and re-entry; a path
  renamed to `pending.tip` is writable. *Mutation:* drop `pending.tip` from `was` → red.
- WT-7 incremental: deliver, move the tip, the person commits the first delivery; the second writes only the new change.
  The person edited a delivered file → conflict.
- WT-8 an archived and a closed group with the scheme: never written. *Mutation:* delete the archived skip
  (`integrationPass.ts:112`) → red.
- WT-9 guard clauses, one case each (review I9): the person changed **only** the executable bit → conflict;
  `core.fileMode=false` and the same → treated as unchanged, mode untouched; a symlink where the tip has a file, and a
  file where the tip has a symlink (the file's content equal to the link's target string) → conflict both ways
  (*mutation:* hash with `hash-object <path>`, which follows the link → red); a directory where the tip has a file →
  `-unsupported:dir`; each busy marker (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge/`, `rebase-apply/`,
  `sequencer/`, `BISECT_LOG`) → `-busy:<op>`; `index.lock` → transient; symlinked, regular-file and nested-repository
  leading components → `-unsafe-path`; a `.GIT` component → `-unsafe-path`; gitlink → `-unsupported:gitlink`; a
  case-only rename → `-unsupported:case-rename` (review I1); a `.git` file pointing to another device →
  `-unsupported:cross-device`.
- WT-10 a fault hook between the step-6 guard and the step-9 re-check edits a writable path → `-conflict`, nothing
  written. *Mutation:* drop the re-check → red.
- WT-11 an injected `ENOSPC` from the rename and a failing `checkout-index` → **blocked** `-write-failed` with the count
  and paths written, not a backoff. *Mutation:* remove the catch → the record shows `retryAfter` set → red.
- WT-12 dispatch (review I4): an incomplete group and a complete but not-yet-accepted group write nothing. *Mutation:*
  drop the `groupComplete` line → red.
- WT-13 prerequisites (review I3), with the dependent's id sorting **before** its prerequisite's: round 1 writes the
  prerequisite's files and nothing for the dependent; round 2 the dependent's. A `keep` prerequisite → the dependent
  blocks `-prerequisite:<P>`. *Mutation:* drop step 1 → round 1 writes the dependent first → red.
- WT-14 empty directories (review M2): a crash between `unlink` and `rmdir`; the next pass removes the empty parent.
- WT-15 staging: `S` absent after success and after a refusal; a planted stale `S` removed by the next attempt; `S`
  mode `0700`; the panel-start sweep removes `<git-dir>/orca/deliver-*` in two temporary registered repositories and
  logs (does not throw) for a third whose path is gone (Q4). *Mutation:* skip the sweep → red.
- WT-16 ledger rows (review I7): after a delivery, `ledgerSources` reports the delivered `.decisions/` rows with
  `where: "working-tree"` (`src/control/ledgerAtRef.ts:102-106`) and the debug input reads them
  (`src/control/debugInput.ts:175`) — a pin of the behaviour O2 accepts, so a later change to it is seen.
- WT-17 a `local` group whose target is checked out at the same path blocks `integration-worktree-dirty` because of a
  delivered untracked file (review I6) — pins O7.

`tests/control/deliveryChoice.test.ts`: `chosen` false on a fresh repository; `keep` on a fresh repository applied and
stored (`chosen` true); `keep` again `no-op-command`; `readIntegrationDefault` still `keep` for both; the repository
read carries `chosen`. *Mutation:* revert the explicit-`keep` write → red.

`tests/control/autoConfirm.test.ts` (added cases; C1): a draft whose record is `working-tree` equal to the stored default
is auto-confirmed and its confirm carried `integrationHash`; a `working-tree` record when the stored default is `keep`
(a person set only that group) is refused `delivery-scheme`; a `local` record equal to the default is still refused.
*Mutations:* remove the exemption → the first case red; drop the equality check → the second red; send no hash → the
first red with `integration-unapproved`.

`tests/panel/accessMatrix.test.ts` (I2): `set-integration-scheme` with `keep` is `token`; `set-group-integration` with
`keep` stays `open`.

`tests/control/integrationScheme.test.ts` (added cases): the schema accepts `{delivery:"working-tree"}` and refuses it
with any extra field; `preflightScheme` on a bare repository and on a subdirectory answers `working-tree-missing`;
`set-group-integration` working-tree on a done `keep` group freezes at once and the next pass delivers.

`tests/control/integrationGit.test.ts` (added, beside `:733-779`): close refused `close-delivery-pending` for a blocked
`working-tree` record, allowed once delivered.

The existing multi-directory accept test file (located by the plan): a member default `working-tree` →
`multi-dir-delivery-unsupported:<key>`.

`tests/commands/workingTreeDelivery.test.ts`: `--delivery working-tree` parses and refuses `--target`; the §4.6 lines for
pending / waiting / delivered / blocked (with written paths); the §4.2 question lines only when
`projectDeliveryChosen === false` and the group is done `keep`; absent field prints nothing new.

`web/tests/deliveryChoice.test.tsx`: the Results question only for a done `keep` group of a never-chosen project; "Put
them in my working tree" sends `set-integration-scheme` then `set-group-integration`, in that order; a `no-op-command`
answer to the first still sends the second; a failing second shows the single per-group button and the error; "Keep them
on the branch" sends only `set-integration-scheme` keep; the delivered, waiting and blocked rows; the Settings option
reads "not chosen yet". *Mutations:* swap the two commands → red; stop after a no-op first → red.

### 10.2 Existing criteria to rewrite (approved this session; each rewrite carries a `Ruling:` comment)

- `tests/control/integrationScheme.test.ts:68-79` "setting keep removes the field from the body…": now *setting keep
  stores it*; the body `toEqual` at `:74` gains `integration: { delivery: "keep" }`.
- `tests/control/integrationScheme.test.ts:84`: `keep` on a fresh repository was `no-op-command`; it is now applied (it
  records the choice).
- `tests/panel/integrationApi.test.ts:58` and `:62`: the exact read shape gains `chosen: false` / `chosen: true`.
- `tests/panel/accessMatrix.test.ts:84`: `set-integration-scheme` with `keep` moves from `open` to `token` (I2).
- Additive only: `tests/commands/keptDelivery.test.ts:21-27` (`toContain` per line) and
  `web/tests/resultsConclusion.test.tsx:158` (the question is a new element, not inside `kept-take`). If either must
  change, it is reported, not silently rewritten.

### 10.3 Acceptance (each exits 0 or non-zero)

```
npx vitest run tests/control/workingTreeDelivery.test.ts tests/control/deliveryChoice.test.ts \
  tests/control/autoConfirm.test.ts tests/control/integrationScheme.test.ts tests/control/integrationGit.test.ts \
  tests/panel/accessMatrix.test.ts tests/panel/integrationApi.test.ts tests/commands/workingTreeDelivery.test.ts
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
| **P1** (after change-sized P1) | §4.1 scheme + preflight; §4.3 dispatch; §4.4 delivery; §4.5 multi refusal and next text; §4.2 explicit `keep`, `chosen`, socket tier, auto-confirm exemption; §5 protocol; §7 panel-start sweep; CLI parse and lines; Web Settings option, Results question, rows; en+zh words; `docs/cli.md` | one self-contained delivery; no migration; old groups byte-identical | §10.1, §10.2, §10.3 |
| **P2** (only if the human asks, §13) | a non-blocking note on the Web confirm card for a never-chosen project, with the same two buttons | P1 already asks where it always reaches the person | its own Web test |

## 12. Objections and consequences

- **O1 — uncommitted means invisible to the next independent group.** A later group branches from `HEAD`, which lacks
  the delivered files until the person commits them. If it touches the same paths, its own working-tree delivery is
  refused `-conflict`; the next text tells the person to commit the earlier group's files first. A dependent group runs
  on its prerequisite's branch and is delivered after it (§4.4 step 1).
- **O2 — `.decisions/` rows arrive as untracked files, and read as working-tree decisions.** Landings commit ledger rows
  onto `orca/<g>`; they are part of `from..tip`, so they appear in the person's `git status`. Dropping them would lose
  the ledger from the target once the person commits (git is the ledger's source of truth, handoff §五 5.2.3). Once
  written, `ledgerSources` reads the working tree first (`ledgerAtRef.ts:102-106`), so those decisions are labelled
  `working-tree` (and offered as correctable, `web/src/RunDecisions.tsx:133-137`) instead of `group-branch`
  ("not integrated"), and a debug group's input, which reads only the working tree (`debugInput.ts:175`), sees them.
  That is literally where they now are; accepted and pinned by WT-16. The Results row says the records are included.
- **O3 — a write window.** Between the step-9 re-check and a path's rename (milliseconds), an editor saving that path
  would be replaced. Not closable without locking the person's files; the content they saved is still in their editor.
- **O4 — case-insensitive filesystems.** A case-only rename is refused by name (`-unsupported:case-rename`) instead of
  being written as a delete plus an add of what the filesystem treats as one file. A new path colliding by case with an
  unrelated existing file reads as that file at step 6 and is a conflict. Both are tested (WT-9).
- **O5 — the group is `done` while its files may not be in the checkout** (blocked delivery). Today's `push-*`
  behaviour; the alternative holds dependents on the person. The Problems and Results rows say it.
- **O6 — R5 narrowed, and an old `keep` is asked again once.** "Keep is the field's absence" now holds for group copies
  only. A project whose owner chose `keep` before this change stored nothing, so it reads as never chosen and is asked
  once; answering stores it.
- **O7 — delivered files dirty the checkout for `local` (review I6).** A `local` group whose target branch is checked
  out at the same path refuses any untracked file (`integrationPass.ts:428`, `integration-worktree-dirty`), so files a
  working-tree delivery wrote block it until committed or moved. The refusal's words now name the cause (§5); WT-17
  pins it.
- **O8 — auto-confirm now confirms one non-`keep` scheme (C1).** Only `working-tree`, only when equal to a default a
  person stored, and its writes are guarded per path; publishing deliveries still need an owner's confirm.

## 13. Decisions for the human

Controller rulings made under 「先按你的建议执行…最后报给我审核」, each reversible, **awaiting the human's review**:
- **C1** auto-confirm passes condition 6 and carries `integrationHash` for a `working-tree` copy equal to the stored
  default (§4.2); otherwise choosing `working-tree` would make every later group wait at confirm.
- **I2** `set-integration-scheme` is `token` for every payload, so only a person records the project's choice (§4.2).
- **I3** a dependent's working-tree delivery waits for its stacked prerequisite's; a non-working-tree prerequisite blocks
  it by name (§4.4 step 1).
- **I1** case-only renames are refused by name, not paired (§4.4 step 5).
- **I8 / Q2** files take git's modes (`0644`/`0755`, set explicitly), the group's executable-bit change is applied, and
  Orca changes no other mode — a deviation from Rule 17's `0600`/`0700` for files in a source checkout (§7).
- **Q1** the first-use question lives on the done group's Results card; the confirm-card note is P2, built only if the
  human asks.
- **Q3** done does not wait for a working-tree delivery (§4.5).
- **Q4** the staging directories are swept at panel start (§7).

## 14. Review resolutions (revision 2)

| Finding | Resolution |
|---|---|
| C1 auto-confirm | §4.2 exemption + hash; §9 pointer; `autoConfirm.test.ts` cases with three mutations |
| I1 case rename | refused `-unsupported:case-rename` (§4.4 step 5); O4 rewritten; WT-9 |
| I2 agent `keep` | `set-integration-scheme` token for every payload; `accessMatrix.test.ts:84` rewritten; CLI hint says "a person's choice" |
| I3 stacked dependent | §4.4 step 1 (wait / block `-prerequisite`); WT-13 with dependent-first ids |
| I4 dispatch | §4.3 before `caughtUp`; WT-12 |
| I5 guard | `(type, mode, oid)` from `lstat`, symlink target hashed via stdin, leading-component and path validation, `diff --raw -z --no-renames` (§4.4 steps 5–6) |
| I6 `local` dirty | O7, refusal words (§5), WT-17 |
| I7 ledger relabel | O2, WT-16 |
| I8 / Q2 modes | §4.4 step 9, §7, WT-2 |
| I9 per-clause criteria | WT-9, WT-10, WT-11; fs errors caught (§4.4) |
| M1 pending tip | `was` includes `pending.tip` (§4.4 step 6); WT-6 second case |
| M2 rmdir | every pass (§4.4 step 10); WT-14 |
| M3 EXDEV | §4.4 step 4 `-unsupported:cross-device`; WT-9 |
| M4 N3 | reworded (git filters run) |
| M5 busy markers | `sequencer/` added; `index.lock` transient |
| M6 path plumbing | `--literal-pathspecs`, `checkout-index -z --stdin`, `hash-object --stdin-paths` |
| M7 written paths | `-write-failed` detail and rows list them (§4.4, §4.6, §6) |
| M8 project checks | §4.5 |
| M9 O6 | asked once (§4.2 item 5, O6) |
| M10 re-check all | step 9 re-checks every path before the first write |
| M11 Web two commands | §4.2 item 1; `deliveryChoice.test.tsx` cases |
| Q1, Q3, Q4 | §13; Q4 registered in §7 with WT-15 |

## Appendix A — toy check (run once, session `3ba26002`, Orca `main` `4f53a087`, `git version 2.50.1 (Apple Git-155)`)

In a fresh repository (scratchpad `wt-toy/r`): `base` with `a.txt`, `d.txt`; branch `orca/g` modifying `a.txt`,
deleting `d.txt`, adding `docs/new/n.md`, a binary `b.bin`, an executable `x.sh` and a symlink `link`; back on `main`.
Then `git ls-tree -z <tip> -- <paths> > S/list`, `GIT_INDEX_FILE=S/index git update-index -z --index-info < S/list`
(rc 0), `GIT_INDEX_FILE=S/index git checkout-index --prefix=S/tree/ -- <paths>` (rc 0). Observed: `S/tree` held
`a.txt` (0644), `b.bin`, `x.sh` (0755), `link -> a.txt` (a symlink) and `docs/new/n.md` with its directories;
`shasum .git/index` before and after were identical; `git status --porcelain` in the checkout was empty. Not checked
here: the rename step, filters (LFS / eol), the `--stdin -z` forms, and the leading-component refusals — those are WT-2,
WT-9 and the plan's first task.

## 15. Implementation notes (P1, partial) — 2026-11-19

- **Who / where:** an implementer subagent (Claude Opus 5.5) of the Orca control session `3ba26002`, branch
  `feat/working-tree-365` (commits named in its report). The sections above are unchanged.
- **Built:** §4.1 scheme + check/preflight; §4.3 dispatch; §4.4 delivery (`src/control/workingTreeDelivery.ts`); §4.2
  explicit `keep`, `integrationChosen`, the read's `chosen`, the socket tier, the auto-confirm exemption and hash; §7 panel-start
  sweep (`src/panel/controlAssembly.ts` `startPump`, before `driver.start`); §5 CLI parse; en + zh reason words and the
  Settings form option; §9 Corrections appended.
- **Deviations (each reversible):**
  - A path containing a newline is refused `-unsafe-path` (step 5): `git hash-object --stdin-paths` reads one path per line.
  - `chosen` is a separate reader (`integrationChosen`), not a field of `readIntegrationDefault`, so its exact-shape
    criteria did not need rewriting; the Web type marks `chosen` optional (absent = chosen, an older panel).
  - A blocked working-tree record keeps its `pending` (any reason, not only `-write-failed`): it only widens `was` to an
    entry Orca itself wrote.
  - `-write-failed` detail: `<path>:<code>:written <n> (<first five>)`; a failing `update-index` / `checkout-index` names
    the step as both path and code.
  - The Rule 17 table (§7) holds as written; staging's parent `<git-dir>/orca` is also created `0700`.
- **Not built yet:** see the report of this run (Results question and rows on the Web, the CLI §4.6 / §4.2 lines and
  `projectDeliveryChosen`, the multi-directory refusal at accept, WT-related Web criteria).

## 16. Implementation notes (P1, continued) — 2026-11-19

- **Who / where:** a second implementer subagent (Claude Opus 5.5) of the Orca control session `3ba26002`, branch
  `feat/working-tree-365` (commits named in its report). §1–§14 unchanged except the three §6 rows marked "§16" (this
  spec is not published, so it is revised in place).
- **Built in this round:** the Web first-use question (`web/src/DeliveryChoice.tsx`, beside the Results conclusion card,
  which itself still sends no command), the conclusion card's working-tree row, "not chosen yet" in Project settings; the
  CLI question lines (show, brief, after `group confirm`), brief's working-tree lines, the waiting row; the panel-start
  sweep's wiring criterion; the fix of a settings-body loss
  (below).
- **Server fields (deviation from §4.6 "no new server field except `projectDeliveryChosen`"):**
  - `projectDeliveryChosen` is sent only as `false`, only where the question is asked (a done group with no record or a
    `keep` record, not dir, not multi, project never chosen); absent everywhere else, so every other brief / view keeps its
    bytes. The brief carries it too.
  - The group view's integration record gains `waitingFor` (the stacked prerequisite whose working-tree delivery comes
    first), and the brief carries a working-tree group's record as `integration`. `waitingFor` is read from the store
    alone (no git on a read): a prerequisite counts as written when its record is idle, has no `pending`, and its
    `lastIntegrated` is set and equals its accepted tip — or, when its acceptance names no tip (`not-needed`, `not-run`),
    is merely set. The pass itself still decides from `orca/<P>` (§4.4 step 1); the two can differ for one round after a
    prerequisite's tip moved without a new acceptance.
- **Web words:** the question says "your working tree", not the registered path: the group view does not carry the path.
- **Accepted limits (item 6 of the round's brief):**
  - A file turned into a directory, or a directory into a file, is refused by name (rows in §6). Orca does not remove the
    person's old file or directory to make room: that would delete something it did not write in this attempt. Pinned by
    criteria in `tests/control/workingTreeDelivery.test.ts` (guard clauses).
  - A path that is not valid UTF-8 is refused `-unsafe-path` rather than written under a mangled name: `safePath` refuses
    any path containing U+FFFD (built; criterion seen red before the fix — the pass wrote the mangled name and settled
    done). A valid UTF-8 path that contains U+FFFD itself is refused too; accepted.
- **Bug found and fixed (not of this spec):** `applySetIntegrationScheme` rebuilt the repository settings body from four
  fields, dropping a stored `criteriaReview` or `flows` whenever the delivery was set; it now carries the body over whole.

## 17. Review notes (#365 review) — 2026-11-19

- **Who / where:** an independent reviewer-and-fixer subagent (Claude Opus 5.5) of the Orca control session `3ba26002`,
  branch `feat/working-tree-365`, on top of `bac70f25`. §1–§16 are unchanged; where a line there no longer holds, this
  section says so.
- **Fixed (each with a criterion seen red under its mutation in the `.wt-365-mut` clone):**
  - A path a crashed or write-failed attempt wrote to `pending.tip`, which a moved tip no longer changes, is now part of
    the set (`want` = the tip's entry = `from`'s, `was` = `pending.tip`'s): before, it stayed at the old attempt's bytes
    while the group settled done (§4.4 step 6 widened; "Re-entry after a crash" holds for a moved tip too).
  - The working-tree write-ahead re-reads the archived mark and the stop in its own transaction: a group archived or
    paused after the pass read its row is dropped, never written (§4.5 "Archived / closed").
  - `<git-dir>/orca` is `lstat`ed before staging and by the sweep: a symlink or a file there is never followed — the
    delivery blocks `integration-working-tree-write-failed:<git-dir>/orca:not-a-directory:written 0` and the sweep logs
    the repository (§7 Paths (b)).
  - Steps 5–6 (reads of the checkout and git) are inside the catch: a failing read (a required clean filter, a
    permission error) is blocked `-write-failed:-:<code>:written 0`, never a backoff (§4.4 I9 now covers steps 5–11).
  - The panel-start sweep runs in `recover`, awaited, before its `driver.kick()` — the driver's real first round; §15's
    "`startPump`, before `driver.start`" no longer holds (`startPump` is as on `main`).
  - Controller ruling Q2: the group view and the brief carry `checkoutPath` (the registered path) beside the first-use
    question or a working-tree record, only when it resolves; the Web question's button reads "Put them in <path>
    (uncommitted)", the Web written row and the CLI's §4.6 lines name it. §16's "Web words" line is superseded.
- **Kept (controller rulings):** Q1 store-only `waitingFor` may lag one round (§16 note stands); Q3 the landing-schema
  refine stays as a documented redundant guard.
- **Accepted limits found, not fixed (Minor):** O3's window also covers a leading directory swapped for a symlink between
  the step-9 re-check and a rename (the rename would follow it); on a case-insensitive volume a tree holding two paths
  that differ only by case at `from` can let a deletion of one remove the person's file under the other name (reasoned, not reproduced); HFS+-only
  ignorable code points in a `.git` component (APFS does not ignore them; checked on this machine) are not refused; a
  second `pending` overwrite after two crashes on two moved tips reads the first attempt's paths as conflicts (refused,
  never written); the sweep of a registered path that is no longer a repository but sits inside another one sweeps that
  repository's `orca/deliver-*`.
