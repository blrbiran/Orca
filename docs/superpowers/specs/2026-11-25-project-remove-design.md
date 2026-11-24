# `orca project remove`: unregistering a project, and what happens to its groups (#470 P1) — design

Status: **draft for the human's review; no code.** Author: Orca session `6add92a5` (Claude Opus 5.5), 2026-11-25, on main
after `chore(deps): repin ccloop to 276114a…`. Human, 2026-11-24: #470's `project remove` and its groups' ownership are
「以后单独设计」 (agreed). #470's P0 (a gone folder is a warning, `missingPaths`) already landed:
`fix(panel,cli): a registered project whose folder is gone is a warning, not a broken projects file (#470)`.

## 1. Problem

`~/.orca/projects.json` can only grow from Orca (`ProjectRegistry` has `list/add/rename/addMulti/setDirs/addPlan`; the
file header says "nothing is ever removed from it at runtime"). A stale entry (the tester's `git-merge-lab` →
`/private/tmp/gitmerge-lab.da8Dbl`, 13 groups under it) can only be removed by a hand edit, which the README says waits
for a restart and which leaves the 13 groups with no stated owner. The tester left the entry in place on purpose and
waits for a supported verb.

## 2. Design

### 2.1 The verb

- CLI `orca project remove <id> [--archive-groups]`; Web `DELETE /api/projects/:id` and a "Remove" action in project
  settings. A **person's** act (socket-tier person token, as `waive-acceptance`); an agent is refused
  `project-remove-person-required`.
- **Refused while the project has a group that is not archived**, naming the count by state:
  `project-has-groups: 10 done, 1 running (archive them first, or pass --archive-groups)`.
- `--archive-groups` archives every such group first through the existing `archive-group` command, one by one, and stops
  at the first refusal (a running group is refused by archive's own rule, so a project with a live run is never removed).
  Nothing new decides which groups may be archived.
- The entry is removed from `projects.json` through the registry's single writer (the base-hash check, C4). The runtime
  follows the registry's existing rule for removals: the project leaves `list()` at once, and is named in
  `pendingRestart` until the panel restarts when it was mounted (its repository stays in the running repo table until
  then; nothing is unmounted at runtime). An entry whose folder was gone at boot was never mounted, so nothing is pending.
- Multi-directory projects: the same verb and rules (their groups are archived the same way).

### 2.2 The groups afterwards

- Archived groups stay in the control store untouched (no data is deleted; `orca gc` keeps its own rules).
- Their views must still render: `group show` / `brief` of a group whose project is no longer registered answer
  normally with `project: { id, removed: true }` instead of failing on the repository lookup (criterion below).
- Re-adding a project at the same path gets the **same id** only if the name derives to the same slug
  (`deriveProjectId`); the groups then reattach. A different id leaves them archived under the removed key. This is
  stated in the output of `remove` ("re-add with the same name to reattach its N archived groups").

### 2.3 Next-step lines

`orca status` (warn line for a missing path) and `project list` name `orca project remove <id>` beside the gone path.

## 3. Not in scope

A `repath` verb (point an id at another folder) — a separate, smaller change if wanted; deleting groups or their run
data; un-registering from the Web while the panel serves that project's live run (refused above by archive's rule).

## 4. Criteria (each a command that exits 0 / non-0)

1. A project with a non-archived group: `remove` is refused by `project-has-groups` with the counts; the file is byte-for-
   byte unchanged.
2. `--archive-groups` on a project whose groups are all done: each is archived, the entry is gone from the file and from
   `project list`; `orca status` has no projects warn for it.
3. A project with a running group and `--archive-groups`: refused at that group; no group after it is archived; the file
   is unchanged.
4. An agent's `remove` is refused `project-remove-person-required`.
5. An archived group of a removed project: `group show` renders with `project.removed: true` (red today if the repository
   lookup throws — to be measured first).
6. Web: `DELETE /api/projects/:id` answers as the CLI does (same codes); the Remove button is only for the owner.

## 5. Open questions (recommended answers)

1. Default: refuse while groups remain (recommended) vs archive automatically. Refusing keeps a person's choice explicit;
   the flag makes it one command.
2. Should `remove` of a never-mounted (gone-folder) project skip the group check? Recommended **no**: the 13 groups are
   exactly the ownership question the tester raised; `--archive-groups` handles them.
3. A `repath` verb now or later? Recommended later.
