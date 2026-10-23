# Requirements on a `dir` project: the vault-backed folder workspace — design

- **Status:** design only. Written 2026-10-24 by a spec-writer subagent of Orca session `ffec7b28`; not committed by the
  writer (the controller commits).
- **Problem (measured).** Sandbox acceptance `.superpowers/sdd/2026-10-23-flow-phase1-gaps/task-11-acceptance-report.md`,
  anomaly 2 (lines 189–194): a requirement opened on a registered `dir` project (a plain folder, not a git repository) is
  blocked at once with `repository-path`; round 1 stays `drafting` with `calls: []` and 0 tokens (same report, lines
  156–158).
- **Extends:** `docs/superpowers/specs/2026-10-22-flow-engine-design.md` ("F §n"; vault §5.1–§5.4, driver reuse §6.2,
  Rule 17 table §20) and `docs/superpowers/specs/2026-10-22-flow-phase1-gaps-design.md` ("G §n"; corrections §21). Both
  are published; nothing in them is edited. §13 below lists what this spec amends.
- **Closes** the handoff's registered gap "reconcile 路径对 dir 组仍可能写 `.decisions/`" (`docs/handoff/handoff.md:263`).
- **Anchors** (Rule 14): every `path:line` below was measured on `main` at `fdceeb83` (clean tree) with `nl -ba`,
  `cat -n` and `grep -n` in this session. They must be measured again before a plan cites them.
- **Marks.** "(writer's call)" = decided by this writer under CLAUDE.md Rule 1 step 2 (reversible); each one is listed
  again in §15 for the human. Everything else follows from the human ruling (§1) or from code as built.

---

## 1. Human ruling implemented here (verbatim)

2026-10-24, session `ffec7b28`: 「要支持」. The controller's proposal was agreed with it:

1. Requirements on a `dir` project reuse the flow engine's vault: the folder is snapshotted into Orca's private git store
   (`src/flow/vault/`).
2. Tasks run against the vault in worktrees.
3. Landing places the changes back into the folder. If the folder changed meanwhile, stop and ask the person — never
   overwrite.
4. The `.decisions/` ledger of a `dir` project lives in the vault and is never written into the person's folder; the
   handoff's known gap (reconcile on dir groups may still write `.decisions/`) is closed.
5. H7 (several writable directories, git repositories and plain folders, native in ccloop) is specified next and builds
   on this design: the vault-backed folder workspace stays reusable, one folder ↔ one vault repository (§4.1).

## 2. Vocabulary

| Term | Meaning in this spec |
|---|---|
| **`dir` project** | A project-registry entry with `kind: "dir"` (`src/panel/projects.ts:33-36`; F §5.1). Its `path` is a plain folder; it may or may not be a git repository. |
| **dir group** | A control group (not a flow group) whose body carries `dirWorkspace` (§5.1). In this spec, only a requirement opened on a `dir` project becomes one. |
| **the folder** | The `dir` project's folder, as `realpath` resolved it when the requirement was opened (frozen in `dirWorkspace.dir`). |
| **the vault** | `$ORCA_VAULT_DIR/<sha256(NFC(realpath(folder)))>.git`, the bare repository of F §5.2 (`src/flow/vault/paths.ts:11-22`, `vault.ts:48-64`). One per folder, shared by every flow run and every dir group on that folder. |
| **project repo id** | The id the group is bound to: `requirement.repoId` / `plan.repoId` (= `controlRepoKey(projectKey)`). Unchanged for a dir group; the panel filters and names projects by it. |
| **target repo id** | What `groupRepoId` answers (`src/control/executionDriver.ts:217-224`): the repository the driver works in. For a dir group it is the vault's id `flow-vault-<vaultId>` (`src/flow/groups.ts:74`), resolved to the vault path by `vaultPathOfRepoId` (`groups.ts:77-82`; `src/panel/controlAssembly.ts:229`). |
| **import** | A commit `orca: import` made by code from a snapshot of the folder (`src/flow/vault/snapshot.ts:104-124`), stored at `refs/orca/import/<n>`. |
| **work branch** | `refs/heads/orca/<groupId>` (`src/control/workspace.ts:44`), in the vault for a dir group. |
| **base** | `refs/orca/group/<groupId>/base`: the import the dir group's work branch starts from (§6.4). |
| **folder commit** | A vault commit whose tree is exactly what the folder is meant to hold after a placement: the work branch's tree with the Orca-own paths (next row) taken from the previous folder commit. |
| **placed** | `refs/orca/group/<groupId>/placed`: the latest folder commit the folder was given. Initially equal to the base. |
| **Orca-own paths** | Every path under `.decisions/`, plus the requirement document's path (`requirement.export.path`, `.orca/requirements/<createdOn>-<slug>[-n].md`, `src/control/requirementDocument.ts:23-25`). Placement never writes, changes or deletes them in the folder. |
| **placement** | The driver pass of §8 that writes a dir group's landed work into the folder, path by path with no merge (§8.3–§8.4); it does not use the flow's `copyBack` (`src/flow/vault/copyBack.ts:66-111`). |
| **drift** | The folder paths that differ from a folder commit, computed by `snapshotDrift` (`src/flow/vault/drift.ts:42-56`): over-cap, special and ignored paths are not drift. Used only by `take-folder` (§9.2); collisions are decided by §8.3, not by drift. |
| **landing paths** | The paths of one placement's change `placed → F′` (§8.5 step 5), listed by `changesBetween` (`copyBack.ts:27-37`, `--no-renames`, so a rename is its old path deleted and its new path added: both are landing paths). |
| **collision** | A landing path whose folder entry equals neither side of the change (§8.3, `changed`). Only a collision stops placement as `folder-changed` (§9.1). |
| **stop-and-ask** | Placement state `folder-changed` or `folder-unwritable` (§9): no path of the change is written after the stop, the group shows a needs-you item, and only the person (owner) answers it. |

---

## 3. As built today (measured at `fdceeb83`)

### 3.1 How a `dir` project reaches the control plane

- The trusted control config lists **every** registered project, `dir` included, as a repository whose path is the
  folder: `src/panel/controlAssembly.ts:217`. So `knownRepository` accepts a `dir` project's repo id, and
  `requirement-open` accepts it (`src/control/requirementCommands.ts:93`).
- `resolveRepository(repoId)` is `vaultPathOfRepoId(env, repoId) ?? config.resolveRepository(repoId)`
  (`controlAssembly.ts:229`). For a `dir` project's repo id the first half answers null (not `flow-vault-…`), so the
  answer is **the person's folder** (`src/panel/controlConfig.ts:281-285`).
- Only flow groups are redirected to the vault: `groupRepoId` reads `flowGroupRepoId(...) ?? plan.repoId ??
  requirement.repoId` (`executionDriver.ts:221`), and `flowGroupRepoId` answers only for a group with a `flow` block
  (`src/flow/groups.ts:85-88`).

### 3.2 The path of a requirement, step by step, and where a `dir` project breaks

| Step | Code today | What happens on a `dir` project |
|---|---|---|
| open | `applyRequirementOpen` → `insertClarifyingGroup` (`requirementCommands.ts:85-111`, `src/control/requirementRecords.ts:70-87`) | succeeds; the group records `requirement.repoId` = the project's repo id and nothing about its kind |
| clarify call A2 | `stepA2SingleCall` (`executionDriver.ts:820-838`) → `prepareRequirementCall` (`src/control/requirementCalls.ts:240-254`) → `buildOverviewFor` (`requirementCalls.ts:142-145`) → `buildRepositoryOverview` (`src/control/requirementOverview.ts:258-279`) | `buildRepositoryOverview` runs `git rev-parse --verify HEAD^{commit}` in the folder (`requirementOverview.ts:265`); a non-git folder fails; the catch at `requirementCalls.ts:250` answers `{ blocked: "repository-path" }`; `stepA2SingleCall` blocks the run (`executionDriver.ts:826`). **This is anomaly 2.** A `dir` folder that *is* a git repository would instead have its own `HEAD` read — against F §5.1 ("its `.git/` is excluded and never touched"). |
| split call | `evaluateSplit` (`requirementCalls.ts:287-305`) | resolves the folder again (`:300`) and writes it into the draft plan as `targetRepo` (`src/control/requirementSplit.ts:73-79`); `validateSplitDraft` checks target paths with `git cat-file` in that repo (`requirementSplit.ts:110-112`, `requirementOverview.ts:285-294`) |
| accept | `applyRequirementDraftAccept` (`requirementCommands.ts:297-362`) → `writeImportedPlan` (`src/control/planImport.ts:326-352`) | the plan is imported with the repository's **default integration scheme** (`planImport.ts:345`); the export wake is queued (`requirementCommands.ts:354-356`) |
| export | `exportRequirementDocument` (`src/control/requirementExport.ts:106-164`) | reads `HEAD` of the folder (`:125`) and creates `orca/<groupId>` there with the document commit (`:152-156`) — fails on a non-git folder; on a git folder it writes a ref into the person's `.git` |
| dispatch A2 | `stepA2` (`executionDriver.ts:301-340`) | `targetRepo` = the folder (`:317`; refusal → `repository-path`, `:318`); `ensureWorkBranch` reads `HEAD` when the branch is absent (`workspace.ts:63-71`); `ensureWorkspace` runs `git worktree add` in it (`workspace.ts:94-106`) |
| landing D | `stepD` (`src/control/driverLanding.ts:271-322`) | target = the folder (`:280-281`, `repository-path`); merges in a detached worktree of it; writes `.decisions/<runId>.jsonl` into the merge commit (`:304-306`) |
| landing E | `recordEmptyResultDecisions` (`driverLanding.ts:119-171`) | target = the folder (`:122-124`); ledger-only commit on the work branch (`:149-158`) |
| landing R | `finishReconcile` (`driverLanding.ts:544-640`) | target = the folder (`:560-562`); **writes `.decisions/` into the reconciled tree with no dir check at all** (`:572-607`) |
| integration | `integratePendingGroups` (`src/control/integrationPass.ts:80-133`) | a dir **flow** group is skipped (`:110`); any other group with a scheme integrates — a dir requirement group would push or merge from the folder |
| decisions view | `GET /api/control/groups/:groupId/decisions` (`src/panel/controlApi.ts:227-238`) → `readGroupDecisionsView` (`src/panel/groupDecisions.ts:60-62`) → `ledgerSources` (`src/control/ledgerAtRef.ts:82-89`) | sources are the working tree of the target, the integration target ref, and the group branch |

### 3.3 The flow engine's vault, as built (what this spec reuses)

- `openVault` creates the bare vault (`git init --bare --shared=0600`, root `0700`) and rewrites `info/exclude` with
  `DEFAULT_EXCLUDES` (`src/flow/vault/vault.ts:25,48-64`). Every git call runs with `QUIET_GIT` and no inherited `GIT_*`
  (`vault.ts:28-37`).
- `snapshotTree` lists the folder with git against an empty temporary index; caps 50 MB per file, 500 MB per snapshot;
  over-cap and special files are listed, never dropped silently (`snapshot.ts:20-67`).
- `importSnapshot` numbers imports by create-only `update-ref` and writes `refs/orca/<flowRunId>/base`
  (`snapshot.ts:104-124`); its id must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (`:105`).
- `snapshotDrift(vault, dir, head)` returns the drifted paths and a drift commit, or null (`drift.ts:42-56`).
- `copyBack(vault, dir, from, to)` applies only the `from → to` change path by path; a modified file the person changed
  is merged three-way and on conflict left byte-identical; deletes only when the file equals `from`'s blob; never
  through a symlink; new files `0600`, new directories `0700` (`copyBack.ts:66-111`).
- `withDirLock(realDir, act)` serialises copy-backs per folder, in-process, key = `realDir.normalize("NFC")`
  (`src/flow/vault/dirLock.ts:10-23`).
- The flow kernel journals a copy-back before moving its head (`pendingCopyBack`, `src/flow/kernel.ts:504-524`), redoes
  an owed one first (`redoPendingCopyBack`, `kernel.ts:538-564`), and absorbs the person's drift as a person-authored
  execution before each execution (`absorbDrift`, `kernel.ts:575-638`).
- A dir flow group writes its decisions to `flow_decisions`, never `.decisions/`, in D and E
  (`driverLanding.ts:88-105,125-139,300-307`), but not in R (§3.2 row R).

---

## 4. Design overview

### 4.1 One abstraction: the folder workspace (one folder ↔ one vault)

A new module `src/control/dirWorkspace.ts` (writer's call on the path) is the only code that turns a dir group's frozen
`dirWorkspace` into vault operations. It is built on the `src/flow/vault/*` primitives, which are not moved. Its surface:

| Function | Does | Built from |
|---|---|---|
| `openDirWorkspace(env, frozen)` | checks that `realpath(frozen.dir)` (the same `realpath` from `node:fs/promises` that `openVault` uses, `vault.ts:49`) still equals `frozen.dir` after NFC on both sides and is a directory (else throws `dir-folder-missing`), then `openVault(env, frozen.dir)` and checks `vaultKeyOf(dir) === frozen.vaultId` | `vault.ts:48-64`, `paths.ts:18` |
| `importFolder(ws, { reuseUnchanged, baseRef })` | snapshots the folder with the dir-group excludes (`.decisions/`, §10); with `reuseUnchanged`, answers the newest import when its tree equals the snapshot's tree; else makes a new import; with `baseRef` non-null also writes that ref (create-only; an existing one is reused, never replaced) | `snapshot.ts:28-67,104-124` (generalised, §6.1) |
| `folderDrift(ws, folderCommit)` | `snapshotDrift` against a folder commit, same excludes; used only by `take-folder` (§9.2), never to decide a collision | `drift.ts:42-56` |
| `nextFolderCommit(ws, tip, placed, ownPaths)` | the folder commit for a work-branch tip (§8.2) | `drift.ts:25-40` (`treeWith`) |
| `classifyLandingPaths(ws, from, to)` | per landing path: `unwritable` reason, or folder state `at-from` / `at-to` / `changed`, by direct `lstat` + bytes + executable bit (§8.3) | new; `changesBetween` (`copyBack.ts:27-37`) |
| `placeChange(ws, from, to, journalTmp)` | writes only `at-from` paths, no merge (§8.4); the caller holds the folder lock | new; replaces `copyBack` for dir groups (flow keeps `copyBack`) |

**Every folder-specific piece of state is keyed by the folder's vault** (refs under `refs/orca/group/<groupId>/` live in
that folder's vault; the lock key is that folder's real path). H7 will give one group several folders; each is then one
`dirWorkspace` with its own vault, refs, lock and placement record, and this module is called once per folder. This
spec stores a single `dirWorkspace` object on the group body (Rule 2: no list until H7 needs one); H7 replaces it with a
list and keeps a reader for the single object.

### 4.2 The whole path for a dir group

| Step | Repo project (unchanged) | Dir group (this spec) |
|---|---|---|
| open | — | the group body gains `dirWorkspace = { dir, vaultId }` (§5.1); no vault is created yet |
| clarify / split A2 | overview of the folder's `HEAD` | the vault is opened (created on first use); the folder is imported (reused when unchanged); the overview is built from that import commit (§6.2); `HEAD` is never read |
| split evaluation | target paths checked in the folder at the overview commit | the same check, in the vault at the import commit; the draft plan's `targetRepo` is the vault path (§6.3) |
| accept | plan imported with the repository default scheme | plan imported with **no** integration record (delivery is fixed, §7) |
| export | document commit on `HEAD`, `orca/<groupId>` created | waits while a prerequisite is not done; then a fresh import becomes `base` and `placed`; the document commit is made on `base` in the vault (§6.4) |
| dispatch | worktree of the folder's repository | worktree of the vault at the work branch (§6.5); `ccloop` gets a git `repoPath` (the vault) as flow children do (F §6.2) |
| landing D / E / R | `.decisions/` committed on the work branch in the repo | the same algorithms, in the vault: `.decisions/` is committed on the vault's work branch (it lives in the vault) |
| delivery | integration pass per scheme | **placement** (§8): after landings, the change is written into the folder path by path with no merge (§8.3–§8.4), excluding Orca-own paths; if the person changed a path the change would write, or a path cannot be written as is, stop-and-ask (§9); changes elsewhere in the folder are left alone |
| decisions view | working tree, integration target, group branch | the vault's group branch only (§10) |

---

## 5. Open: recording the dir workspace

### 5.1 The body field

`applyRequirementOpen` (`requirementCommands.ts:91-111`) gains one dependency, `dirProjectOf(repoId): { path } | null`,
built in `controlAssembly.ts` from the same list as `flowProjects` (`controlAssembly.ts:244`, `repos.filter(kind ===
"dir")`). When it answers non-null, the group body (top level, not inside the strict `requirementBlockSchema`,
`requirementRecords.ts:20-38`) gets:

```json
"dirWorkspace": { "dir": "<realpath(path) as returned, NFC>", "vaultId": "<vaultKeyOf(that path)>" }
```

- `realpath` is the one `openVault` uses (`vault.ts:49`) and `vaultKeyOf` NFCs it (`paths.ts:18`), so a folder given
  with a different case or Unicode form names the same vault a flow run on that folder names (criterion D1).
- `realpath` is a read; open writes nothing outside the control DB (no vault, no import).
- **A run Orca dispatched may not open a requirement on a `dir` project** (it would make the folder a write target):
  `permissionRefusal` (`src/panel/permissions.ts:59-62`) gains a payload check — `requirement-open` whose `repoId` is a
  `dir` project, sent by a principal with `dispatchedRun`, is refused `control-dispatched-run-refused`, as `flow-start`
  is for every dispatched run (`humanOnly.ts:101`). The check reads the same `dirProjectOf`. Requirements on repository
  projects keep today's access.
- The field is frozen: a later rename, move or re-registration of the project does not change the group's folder.
  A folder that is gone or moved later is `dir-folder-missing` (§9.3).
- `writeImportedPlan` keeps it: the carried body is spread first (`planImport.ts:327`).
- No SQL schema change: group bodies are JSON (`src/control/queries.ts:28-32`). The control schema stays `"18"`
  (`src/control/migrations.ts:4`).

### 5.2 What is refused on a `dir` project (scope)

- **`import-plan`** with a `dir` project's repo id is refused `dir-project-plan-import-unsupported` (writer's call):
  today it would reach A2 and fail on `HEAD`; only requirement groups get a dir workspace in this spec. H7 decides
  imported plans on folders. The same refusal applies to opening a correction-debug or system-debug group on a `dir`
  project (§6.5).
- **`set-group-integration`** on a dir group and **`set-integration-scheme`** on a `dir` project's repo id are refused
  `dir-group-delivery-fixed` (§7).

---

## 6. Calls, export and dispatch on the vault

### 6.1 Target resolution (one function)

- `groupRepoId` (`executionDriver.ts:217-224`) becomes `flowGroupRepoId(store, g) ?? dirGroupRepoId(store, g) ??
  plan.repoId ?? requirement.repoId`, where `dirGroupRepoId` answers `flowVaultRepoId(dirWorkspace.vaultId)` for a body
  with `dirWorkspace`, else null. The id keeps the `flow-vault-` prefix (writer's call): it is already stored on flow
  parent groups (`src/flow/kernel.ts:228`) and resolved by `vaultPathOfRepoId`; a second prefix would add a second
  resolver for the same path.
- The two call sites that resolve `group.requirement.repoId` directly switch to `groupRepoId(store, groupId)`:
  `requirementCalls.ts:143` and `:300`. `requirementExport.ts:112` uses it too (§6.4).
- Every other resolution site already goes through `groupRepoId` (measured: `executionDriver.ts:317,1008,1029,1348`;
  `driverLanding.ts:123,280,561`; `driverHandoff.ts:125,313`; `integrationPass.ts:113,151,201`;
  `integrationResolve.ts:300,318`) and needs no change.
- `SingleCallPrepareDeps` (`src/control/singleCallPurposes.ts:21-25`) and the driver deps gain `env` (the environment
  `controlAssembly.ts:229` already passes to `vaultPathOfRepoId`), so `openDirWorkspace` resolves `$ORCA_VAULT_DIR`
  from the passed environment, never from `os.homedir()` at a call site (F §20, Rule 17).
- `importSnapshot` is generalised: its options take `baseRef: string | null` in place of deriving
  `refs/orca/<flowRunId>/base`. The flow kernel passes `baseRef(flowRunId)` (`snapshot.ts:90`), so every flow ref stays
  byte-identical. A group's refs use the namespace `refs/orca/group/<groupId>/…`, which no flow id can produce
  (`fr-…`, `snapshot.ts:105` refuses `/`).
- **`importSnapshot`'s CAS behaviour, as built and kept:** the import number `n` is taken by a create-only
  `update-ref refs/orca/import/<n> <commit> ""`; a lost race re-reads the newest import and numbers on top of it
  (`snapshot.ts:111-120`); the flow base ref replaces an orphan by CAS from the value read (`:110,121`). For a group
  `baseRef` the write is create-only and an existing ref is reused as it is (no orphan rule: a group base is never
  replaced).
- `importSnapshot` and `snapshotDrift` take the run's `excludes` (`snapshot.ts:28`, `drift.ts:42`); every dir-group
  snapshot passes `[".decisions/"]` (§10).

### 6.2 The repository overview of a dir group

- `buildRepositoryOverview` (`requirementOverview.ts:258-279`) gains an optional `commit`. When given, it is verified
  with `rev-parse --verify <commit>^{commit}` and used in place of `HEAD` (`:265`); `HEAD` is not read. Without it,
  behaviour is unchanged (repo projects).
- `buildOverviewFor` (`requirementCalls.ts:142-145`) for a dir group: `openDirWorkspace` → `importFolder(ws, {
  reuseUnchanged: true, baseRef: null })` → `buildRepositoryOverview({ repo: <vault path>, repoId: <target repo id>,
  commit: <import commit>, … })`. The cache directory is `<stateDir>.overview/flow-vault-<vaultId>/<commit>/`
  (`:266`), already under the control state dir.
- `reuseUnchanged` makes a second call on an unchanged folder name the same commit, so the overview cache hits (an
  import commit's id changes with its parent and time, a tree's does not).
- A failure of `openDirWorkspace` is still caught as `repository-path` (`requirementCalls.ts:250`), except
  `dir-folder-missing`, which is returned as its own blocked reason so the needs-you text says what is wrong.
- The call record keeps `commit` = the import commit (`callOf`, `requirementCalls.ts:191-193`).

### 6.3 Split evaluation

`evaluateSplit` passes the vault path as `targetRepo` to `expandSplitDraft` and `repo` to `validateSplitDraft`
(`requirementCalls.ts:300-302`); `overviewPathExists` runs `git cat-file -t <commit>:<path>` in the vault
(`requirementOverview.ts:285-294`), which works on a bare repository. The stored plan's `targetRepo` is the vault path,
as a flow child's contract `repoPath` is (F §6.2).

### 6.4 Export: the base, `placed`, and the document

`exportRequirementDocument` (`requirementExport.ts:106-164`) for a dir group:

1. **Wait for prerequisites.** While `waitingPrerequisites(store, groupId)` (`src/control/groupEdges.ts:56-58`) is
   non-empty, it returns a new outcome `"waiting"` **before any git child or vault access** (a DB read only);
   `exportPendingRequirements` (`requirementExport.ts:167-184`) does **not** mark that wake delivered (today every
   outcome marks it, `:174`) and does **not** count `"waiting"` as progress (`moved` stays false, `:175`), so a waiting
   export never makes the driver start another round by itself. It is looked at again in the next round some other
   progress starts — in particular the round in which the prerequisite's last placement moves its `placement` record
   (that placement counts as progress). Reason: the base must hold what a prerequisite dir group on the same folder
   placed there (§11.3).
2. **Base.** If `refs/orca/group/<groupId>/base` is absent: `importFolder(ws, { reuseUnchanged: true, baseRef: base })`.
   Then `placed` is created equal to `base` with a create-only `update-ref` (a replay finds both and makes neither).
   The base holds no `.decisions/` (excluded, §10).
3. **Document commit.** The existing algorithm runs in the vault with `base` in place of `HEAD` (`:125`); DR21's
   one-parent check (`:91`) holds with `base` as the parent. The document lives on the vault's work branch only; it is
   an Orca-own path and is never placed (§8.2). The transaction that records `export.state = "done"` also sets
   `placement = { state: "idle", tip: <base>, landedTip: <document commit>, … }` (§8.2).
4. Every git child keeps `exportGit`'s bounds and `QUIET_GIT` (`requirementExport.ts:39-46`).

### 6.5 Dispatch and landing

- `stepA2` resolves the vault (`executionDriver.ts:317`). `ensureWorkBranch` finds the branch the export made and returns
  it (`workspace.ts:65`). For a dir group with no work branch, A2 blocks `dir-base-missing` instead of calling
  `ensureWorkBranch` (which would read the vault's unborn `HEAD`, `workspace.ts:68`). This is unreachable while the
  start review waits for `exportState === "done"` (`src/panel/controlOverview.ts:102`); it is named so a broken
  invariant is loud (Rule 12).
- Workspaces are created under the control state's `.workspaces` root with git metadata in the vault, as for flow
  children (F §5.2). The workspace mode is read with the target repo id (`executionDriver.ts:276`), which has no
  setting, so the default applies — as for flow children today (§16 O4).
- D, E and R run unchanged against the vault. Their `.decisions/` files are committed on the vault's work branch: that
  is where the ledger of a dir group lives. Nothing in D, E or R writes the folder.
- **The landed tip is recorded in the DB.** For a dir group, every transaction that records a move of the work branch
  also sets `placement.landedTip` to the new tip: `markLanded` (D, `driverLanding.ts:56-65`), `finishReconcile`'s
  landed write (R, `:621-639`), `recordEmptyResultDecisions`'s write of `ledgerCommit` (E, `:163-169`; unchanged when
  no commit was made), and `take-folder` (§9.2). `prerequisiteDone` reads it without a git child (§7).
- **Debug closing (`driverLanding.ts:232-240,309-310,601`) never runs for a dir group**: it needs a debug mark
  (`:236`), and debug groups (correction debug, `src/control/debugGroup.ts`; system debug, `src/control/systemDebug.ts`)
  import a plan, so opening one on a `dir` project is refused `dir-project-plan-import-unsupported` as `import-plan` is
  (§5.2); a dir group never gets a debug mark. If a closing file were ever written, it is under `.decisions/`, an
  Orca-own path, and never placed. Criterion D10 covers the refusal.
- Reconciliation copies (`git clone --local --no-checkout <vault>`, `driverLanding.ts:371`) work on a bare repository.

---

## 7. Delivery is fixed: placement, never integration

- A dir group never has an integration record: `writeImportedPlan` skips the repository default for a body with
  `dirWorkspace` (`planImport.ts:345`); `set-group-integration` (`src/control/integrationCommands.ts:76-100`, beside the
  flow check at `:90`) and `set-integration-scheme` (`integrationCommands.ts:32`) refuse it `dir-group-delivery-fixed`.
- `integratePendingGroups` skips a dir group next to the dir flow check (`integrationPass.ts:110`). Without a record it
  would already stop at `:117`; the explicit skip keeps a stale record from ever integrating.
- `deliversLocally` (`groupEdges.ts:43-45`) answers true for a dir group (its work reaches the folder by placement), so a
  dependent never stacks on its work branch (`groupEdges.ts:71-75`). `prerequisiteDone` (`groupEdges.ts:47-53`) answers
  true for a dir group only when every task is done **and** its placement has caught up, read from the DB only: state
  `idle`, `pending === null`, and `placement.tip === placement.landedTip` (§6.5, §8.2).

---

## 8. Placement (landing places the changes back into the folder)

### 8.1 Outline

After landings, a driver pass (§8.5) writes the change between the last folder commit and the next one into the folder,
path by path, with no merge: a path is written only when the folder still holds what Orca last gave it there (§8.3).

### 8.2 The record and the refs

The group body holds `placement` (JSON):

```
placement: { state: "idle" | "folder-changed" | "folder-unwritable" | "folder-missing" | "failed",
             tip: <sha> | null,          // the work-branch tip whose folder commit `placed` is
             landedTip: <sha> | null,    // the work-branch tip the landings last recorded (§6.5); DB copy of git
             pending: { from, to, tip, tmp: string[], aside: string[], dirs: string[] } | null,  // journal, written before any folder write
             changed: string[], changedTotal: number,           // colliding paths (§9.1), first 200 kept, byte order
             unwritable: Array<{ path, reason }>,               // §8.3 reasons, first 200 kept
             withheld: Array<{ path, reason, toEntry }>,        // paths placement does not write: Orca-own, or withheld by the person (toEntry: the `to` mode+blob withheld, §9.2)
             watch: <sha256> | null,     // stat signature of the stopping paths (§8.6)
             detail: string | null,
             resolution: { id, action: "take-folder" | "recheck" | "withhold", by, at } | null,  // id = the command id
             at: <ms> }
```

Refs, all in the folder's vault: `refs/orca/group/<g>/placed` (the folder commit the folder was given),
`refs/orca/group/<g>/pending` (the folder commit being written; present only between step 6's journal and step 8's
clean-up, so its objects stay referenced), `refs/orca/group/<g>/drift/<n>` (each drift commit `take-folder` used,
create-only, kept).

### 8.3 Classifying a landing path (code, no merge)

For a change `from → to` (two folder commits), the landing paths are `changesBetween(from, to)` (`--no-renames`: a
rename is its old path deleted and its new path added). Each path `p` is classified, **in this order**, by reading the
folder directly — never through a snapshot, so a path the snapshot leaves out (over a cap, ignored, special) is judged
the same way as any other:

1. **Unwritable** (static; F′ cannot be written as is), reason:
   - `symlink` — `p`'s mode in `from` or `to` is `120000`, or a parent of `p` in the folder is a symlink (`lstat` of each
     segment, as `copyBack.ts:41-57`);
   - `type-change` — a file in `to` where the folder or `from` has a directory, a directory needed by `to` where the
     folder has a file, or a mode other than `100644`/`100755`/`120000` (a submodule `160000`). The reason covers
     **every landing path under the swapped prefix** (the path that is a file on one side and a directory on the other,
     and every landing path below it); they are listed, and withheld, together (review N4);
   - `case-clash` — an added `p` whose name, after NFC and Unicode case folding, equals an existing entry of its parent
     directory with a different spelling, or equals another landing path of the same change (checked on every file
     system, so a case-sensitive test machine catches what macOS would merge).
2. Otherwise the folder entry `e` at `p` (`lstat`, never followed) is compared with the `from` side and the `to` side.
   "Equals a side" means: the side is absent and `e` is absent; or the side is a regular file and `e` is a regular file
   with the same bytes **and** the same executable state (any `x` bit set ⇔ mode `100755`).
   - `at-to` — `e` equals the `to` side: already as the landing wants it (an identical edit by the person, or a path
     written by an earlier attempt of this placement): **skipped, not written, not a collision** (review I6).
   - `at-from` — `e` equals the `from` side: written in §8.5 step 7 (or step 3 for an owed write).
   - `changed` — neither: **a collision** (§9.1). Not written.

### 8.4 Writing an `at-from` path (`placeChange`)

- **Names (review N5).** Every name placement creates in the folder is fixed-length and short:
  `.orca-<8 lowercase hex>` (random), in `p`'s own directory; it is added to the journal (`pending.tmp` for a new
  version, `pending.aside` for a moved-aside old entry) **before** it is created.
- **Lossless replace (review N1)** — modify, delete, and the file half of an executable-bit change that also changes
  bytes:
  1. the new bytes (for a modify) are written to a temporary `t` (`wx`, mode `0600`, then `fsync`);
  2. `rename(p, a)` moves the folder's entry aside to `a` (atomic; from now on nothing can write into the old entry
     through `p`);
  3. `a` is compared with the `from` side (bytes and executable state, §8.3). **Different** (the person wrote between
     classification and step 2) ⇒ if `p` is absent, `rename(a, p)` puts the person's version back; if `p` exists again
     (the person created it meanwhile), `a` is left in place, named in `placement.detail` and kept as residue (§14),
     never deleted; `t` is removed; `p` becomes `changed`. **Equal** ⇒ step 4;
  4. modify: `link(t, p)` (fails if `p` exists: no clobber; a failure ⇒ `p` is `changed`, `a` — which holds only
     Orca's last version — and `t` are removed), then `unlink(t)`, then permission bits copied from `a` with the
     executable state of `to`; delete: nothing is put at `p`;
  5. `unlink(a)` (it equals `from`, which the vault keeps).
- **Add:** `t` is written as above, then `link(t, p)` (no clobber: a `p` the person created after classification makes
  the link fail ⇒ `t` removed, `p` `changed`), then `unlink(t)`. Parent directories it creates are added to
  `pending.dirs` before each `mkdir` (review N6).
- **Mode-only change:** `chmod` alone, after re-reading `p` and comparing it with `from` immediately before.
- A crash at any point leaves `p` either untouched, at `to`, or absent with its old entry at a journaled `a`; the redo
  (§8.5 step 3) first restores every journaled `a` whose `p` is absent and whose bytes are not `from` (the person's),
  removes every journaled `a` equal to `from` once `p` is at `to` or the change is a delete, removes every journaled `t`,
  and then classifies again. No crash point loses a byte the person wrote.
- **Mode (review C2):** a new file is given `0644` for `100644` and `0755` for `100755`, set explicitly with `chmod`
  after the write, never from umask; a new directory `0755`. A modified file keeps its permission bits, except the
  executable state follows `to`: `100755` adds `x` where `r` is set (`mode | ((mode & 0o444) >> 2)`), `100644` clears
  every `x`. A mode-only change is this `chmod` alone. These are the person's project files, not Orca's private data:
  Rule 17's `0600`/`0700` applies to what Orca keeps for itself (the vault, the temporary sibling while it exists);
  placement gives the folder the modes its own git content implies, and never changes the mode of a file the landing
  does not change. (The flow engine's copy-back keeps its own `0600`/`0700` rule, F §20.)
- **Delete:** the lossless replace above with nothing put back; an emptied directory is left in place.
- No three-way merge, no `git merge-file`, no copy of the person's bytes anywhere outside the folder (review M5:
  `copyBack`'s merge temporaries under `tmpdir()`, `copyBack.ts:114-127`, are not used by placement).

### 8.5 The pass (per group, code only — Rule 5)

`placeDirGroups(deps)` runs once per driver round after `integratePendingGroups` (`executionDriver.ts:1242`), one group
at a time in group id order, skipping a group that is archived, stopped (as integration waits,
`integrationPass.ts:119-120`), or has a reconciling run (`groupHasReconcilingRun`, `src/control/queries.ts:38-40`).
**Steps 1–8 run inside one `withDirLock(dir)`** (review I1); `placeChange` and the classifier are called directly inside
it, and nothing in them takes the lock again (`withDirLock` is not re-entrant, `dirLock.ts:10-23`).

1. `openDirWorkspace`; a refusal sets `folder-missing` (detail: the path) and ends.
2. **Stopped states.** In `folder-changed` or `folder-unwritable` with no new `resolution`, no new `landedTip`, and an
   unchanged `watch` signature (§8.6): end, **reporting no progress**. In `failed` or `folder-missing` the pass tries
   again each round but reports no progress unless the state moves (review N8), so a stuck group never makes the driver
   start rounds by itself.
3. **An owed write first.** If `pending` is set: settle every journaled `a` and `t` as §8.4's last bullet says; classify
   `pending.from → pending.to` (§8.3); `at-to` paths are done; `at-from` paths are written (§8.4); any `changed` or
   `unwritable` path ⇒ step 9 with `pending` kept; otherwise ⇒ step 8.
4. Read the work-branch tip `T` (git; if it differs from `landedTip`, git wins and `landedTip` is corrected in the same
   write, logged). `T === placement.tip` ⇒ end.
5. **Next folder commit.** `F′ = nextFolderCommit(T, placed)`: `T`'s tree with every Orca-own path and every path the
   person withheld whose entry in `T` still equals its recorded `toEntry` (§9.2) taken from `placed` (an absent entry there removes it); parent `placed`, message
   `orca: place <groupId>`, `ORCA_IDENTITY`. Paths whose entry differs between `T` and `F′` are recorded in `withheld`.
   `tree(F′) === tree(placed)` (a ledger-only landing, E) ⇒ `tip = T`, end.
6. **Classify** `placed → F′` (§8.3). Any `unwritable` or `changed` path ⇒ step 9; nothing is written.
7. **Journal and write.** `update-ref refs/orca/group/<g>/pending F′` (review I4); then one transaction writes
   `pending = { from: placed, to: F′, tip: T, tmp: [] }`; then `placeChange` writes the `at-from` paths in byte order
   (`at-to` paths are skipped).
8. **Swap.** CAS `placed` from `pending.from` to `pending.to` (already at `pending.to` counts as done); one
   transaction: `tip = pending.tip`, `pending = null`, `state = idle`, `changed = []`, `unwritable = []`,
   `watch = null`; then `update-ref -d refs/orca/group/<g>/pending`.
9. **Stop.** `changed` non-empty ⇒ `folder-changed`; else `folder-unwritable`. `changed`/`unwritable` record the paths;
   `watch` = the signature of those paths (§8.6). Paths already written stay written (they equal `F′`, and a later
   classification calls them `at-to`).
10. A thrown error (I/O, git) sets `failed` with the message as `detail`; the next round runs again from step 1.

A path the person changed that no landing writes is never read, judged or written: it keeps differing from `placed`,
and stops a later placement only if a later landing writes it.

### 8.6 The watch signature (review I2: the cheap trigger)

`watch` = SHA-256 of the canonical JSON list, in byte order of path, of `[path, lstat(path)]` for every stopping path
(`changed` and `unwritable`, all of them, not only the first 200 — the full list is kept in a canonical record named by
its hash), where `lstat` contributes `{ kind, size, mode, ino, mtimeMs, ctimeMs }` or `"absent"`, plus the same for
each stopping path's parent directory. Step 2 recomputes it: one `lstat` per stopping path and parent, no snapshot, no
git child. A different signature ⇒ classification runs again (so a person who undoes an edit is placed without
pressing anything). A new `resolution` or a new `landedTip` also re-runs it. Otherwise the stopped group costs those
`lstat` calls per round and reports no progress.

**Fail-safe direction (review N7).** The signature only decides *when to look again*, never *whether to write*: every
write still passes §8.5 step 6's classification and §8.4's aside comparison. A signature that changes without a real
change costs one extra classification. A real change the signature misses (same size, mode and inode with an mtime
within the file system's timestamp granularity) only leaves the group stopped until the next landing or the person's
`recheck` — it can delay a placement, never cause an overwrite.

### 8.7 What the folder receives, and what it never receives

- Receives: every landing path classified `at-from`, written per §8.4.
- Never receives: `.decisions/**` (the ledger lives in the vault), the requirement document, a withheld path, any path
  outside the change, anything through or as a symlink, a type change, the folder's own `.git/` (excluded from every
  snapshot, `vault.ts:25`), and no byte of a path classified `changed`.

---

## 9. Stop and ask

### 9.1 The rule (controller's ruling, 2026-10-24, session `ffec7b28`, on this spec's D3; classification by review C1)

Placement stops (`dir-folder-changed`) **only when a path the landing would write, delete or rename was changed,
created or deleted in the folder** since the folder was last given (`placed`; until the first placement, the base
snapshot). Exactly: a landing path classified `changed` by §8.3 — the folder entry equals neither the `from` side nor
the `to` side. Changes elsewhere in the folder are left alone and placement proceeds; nothing the person wrote is
overwritten, which is what the human's 「不覆盖」 asks. A created file at a path the landing adds, a deleted file at a
path the landing modifies, an edit at a path the landing deletes, and an executable-bit change at a path the landing
modifies are all collisions; an edit identical to the landing's is not (`at-to`).

**Recorded alternative (not built):** any drift of the folder against `placed` stops placement, whatever path it is on
(this spec's first draft of D3).

`folder-unwritable` (review C2) is the other stopped state: F′ cannot be written as is (§8.3 step 1). It never clears by
itself through a person's edit unless the folder change removes the reason (the watch signature, §8.6, re-runs the
check); its owner action is `withhold`.

### 9.2 The person's answers

A new verb `resolve-folder-change` (target: group; payload `{ action: "take-folder" | "recheck" | "withhold" }`).
Accepted only while `placement.state` is `folder-changed`, `folder-unwritable` or `folder-missing` (else
`folder-change-not-pending`); `take-folder` only in `folder-changed`; `withhold` whenever `changed` or `unwritable` is
non-empty (so also in `folder-changed`, review N2/N8).
The command records `placement.resolution`; the next placement round does the git and folder work under the folder lock
(git work stays out of command transactions, as integration does).

- **`recheck`** — the round clears the stopped state and runs §8.5 from step 1.
- **`withhold`** ("leave these paths out") — every path in `unwritable` and in `changed` (whole `type-change` prefixes
  together) is added to `withheld` with its reason, its `to` entry (mode + blob) as `toEntry`, and `by`/`at`; step 5
  then takes them from `placed`, so the placement proceeds without them and the person's version stays in the folder.
  The task's version stays on the vault's work branch; the group page lists it under "Kept in Orca's store, not
  written to the folder". **A withhold lasts only until that path's `to` entry changes:** a later landing that gives
  the path a different entry makes step 5 drop it from `withheld` and classify it again (review N4). No separate
  un-withhold verb is needed: the next landing that touches the path is judged afresh, and a path no later landing
  touches has nothing of Orca's left to write.
- **`take-folder`** ("keep my changes and continue"):
  0. **Replay first (review N3).** If the work-branch tip `T`, or a first-parent ancestor of it newer than
     `placement.tip`, has the trailer `Orca-Resolution: <resolution.id>`, it is adopted as `T′` (no second commit); if
     `placed` already has that trailer it is adopted as `P`. Steps 1–4 are skipped for what is adopted.
  1. **The paths are exactly `changed`** (the full list from the canonical record, §8.6), read directly — never through a
     snapshot, so caps and excludes do not apply and a path a snapshot would leave out cannot make this a no-op loop
     (review N2). For each path: `lstat`; a regular file ⇒ `hash-object -w --no-filters` into the vault with its
     executable state; absent ⇒ a deletion; a symlink or any other kind ⇒ not taken, the path stays `changed` and the
     command's result names it (the person can `withhold` it). Orca-own paths are never taken. The entries form a drift
     commit on `F* = pending?.to ?? placed` (`treeWith`, `drift.ts:25-40`), written to `refs/orca/group/<g>/drift/<n>`
     create-only (kept: review I4).
  2. **Attribution (review M6).** A taken path whose blob equals that path's blob in another owner's current record in
     the same vault — another dir group's `placed`, or a flow run's head (`refs/orca/<flowRunId>/head`) — is attributed
     to that owner; every other taken path to the person. The commit messages below carry one trailer line per
     attributed owner, `Orca-Placed-By: <groupId|flowRunId> <n paths>`, `Orca-Person-Edit: <n paths>`, and
     `Orca-Resolution: <resolution.id>`.
  3. Folder commit: `P = commitDriftOnto(vault, F*, drift, taken paths)` (`drift.ts:70-73`), with the trailers.
  4. Work branch: `T′ = commit(tree of T with the taken paths from the drift commit, parent T)`, message
     `orca: folder edit <groupId>` with the trailers, moved by `compareAndSwap` from `T` (`workspace.ts:128`); a moved
     tip ⇒ the next round tries again (and step 0 adopts nothing, since no commit carries the id yet).
  5. CAS `placed` to `P`; then one transaction: `tip = landedTip = T′`, `pending = null`, `state = idle`, `resolution`
     kept with `id`, `by` and `at` (Rule 13).
  The person's version replaces the task's version at a path both changed; the task's version stays in the vault's
  history. A later landing whose attempt conflicts with that commit has no "other side" run, so it blocks
  `reconcile-other-side:0` (`driverLanding.ts:333-352,375`); §16 O7.

### 9.3 Codes and copy (en / zh)

Added to `web/src/locales/en.ts` and `web/src/locales/zh.ts`. Needs-you rows use the existing overview step kind
`integration-review` (`src/panel/controlOverview.ts:87-88`) with these reasons and the group's integration region as
destination, which shows the placement block for a dir group in place of the scheme picker.

| Code | Kind | en | zh |
|---|---|---|---|
| `dir-folder-changed` | needs-you | Files this group's finished work would write were changed in the folder since Orca last wrote to it, so the work was not written there. Nothing in the folder was overwritten. Choose "Keep my changes and continue" to add your changes to the group's work, or undo them and choose "Check again". | 这个任务组完成的工作要写的文件，在 Orca 上次写入后被改动过，所以这次没有写进文件夹；文件夹里的内容一处都没有被覆盖。选「保留我的改动并继续」把你的改动并入任务组的工作，或者撤销改动后选「重新检查」。 |
| `dir-folder-unwritable` | needs-you | Some files of this group's finished work cannot be written into the folder as they are ({{detail}}: a symbolic link, a file that would replace a folder or the reverse, or two names that differ only in letter case). Nothing was written for this change. Choose "Leave these out" to write the rest and keep these in Orca's store, or change the folder and choose "Check again". | 这个任务组完成的工作里，有些文件不能按原样写进文件夹（{{detail}}：符号链接、文件要替换文件夹或反过来、或两个名字只差大小写）。这次改动一处都没有写。选「这些不写」把其余部分写进去、这些留在 Orca 内部，或者改好文件夹后选「重新检查」。 |
| `dir-folder-missing` | needs-you | The group's folder is gone or has moved ({{detail}}). Put it back at that path, then choose "Check again". | 这个任务组的文件夹不见了或被移走了（{{detail}}）。把它放回原路径，然后选「重新检查」。 |
| `dir-placement-failed` | needs-you | Writing the group's work into the folder failed: {{detail}}. Orca tries again on its next round. | 把任务组的工作写进文件夹时失败：{{detail}}。Orca 会在下一轮再试。 |
| `dir-base-missing` | blocked run | The group's starting snapshot of the folder is missing (an Orca fault), so the task was not started. | 这个任务组的文件夹起始快照缺失（Orca 的故障），任务没有启动。 |
| `dir-group-delivery-fixed` | refusal | This group works on a folder: its finished work is written into the folder, and its delivery cannot be changed. | 这个任务组作用于一个文件夹：完成的工作会写回文件夹，交付方式不能更改。 |
| `dir-project-plan-import-unsupported` | refusal | This project is a folder, not a git repository. Open a requirement on it instead of importing a plan. | 这个项目是文件夹，不是 git 仓库。请在它上面开需求，而不是导入计划。 |
| `folder-change-not-pending` | refusal | There is no folder change waiting for an answer on this group. | 这个任务组没有等待答复的文件夹改动。 |

Button labels: "Keep my changes and continue" / 「保留我的改动并继续」; "Check again" / 「重新检查」; "Leave these out" /
「这些不写」. Reason words for `unwritable`: `symlink` "symbolic link" / 「符号链接」, `type-change` "file and folder swap" /
「文件与文件夹互换」, `case-clash` "names differ only in case" / 「名字只差大小写」. The block lists `changed` and
`unwritable` (first 50 shown, then "and n more" / 「另有 n 个」) and, when non-empty, `withheld` under "Kept in Orca's store,
not written to the folder" / 「保存在 Orca 内部，不写入文件夹」. The requirement page's export line for a dir group reads
"Kept in Orca's store (not written to the folder)" / 「保存在 Orca 内部（不写入文件夹）」 in place of the repository path.

### 9.4 Protocol

`groupSummarySchema` (`src/control/webProtocol.ts:1334`; its `requirement` field is at `:1349`) gains `placement` (optional; the fields of §8.2
minus `pending.from/to`, plus `workspaceKind: "dir"`). The overview reads it to add the needs-you row. No DB schema change.

---

## 10. The `.decisions/` ledger of a dir group: where it is, how the panel reads it

- **Where:** in the vault, on `refs/heads/orca/<groupId>`, written by D, E and R exactly as for a repository
  (`driverLanding.ts:304-306,149-158,572-607`). Never in the folder (§8.7).
- **Only Orca's entries (review I7).** Every dir-group snapshot excludes `.decisions/` (§6.1), so the base, and
  therefore the work branch, holds no `.decisions/` file the folder had; every `.decisions/` line on the work branch
  was added by a landing of this group. A folder's own `.decisions/` (for example a git repository registered as a
  folder) is neither read by tasks nor ever written by placement.
- **How the panel reads it:** `ledgerSources` (`ledgerAtRef.ts:82-89`) answers `[{ where: "group-branch", ref:
  refs/heads/orca/<groupId> }]` for a dir group — no working-tree source (the vault is bare and the folder never holds
  Orca's ledger) and no integration target. `readLedgerAtRef` uses only `rev-parse`, `ls-tree` and `cat-file`
  (`ledgerAtRef.ts:29-44`), which work on a bare repository. The view reads only decisions added since the base: it
  reads the ledger lines of `base..refs/heads/orca/<groupId>` — with the exclusion above that is the whole
  `.decisions/` tree of the tip, and the view also asserts `ls-tree base -- .decisions/` is empty (a non-empty one is
  a broken invariant, reported as `recovery-blocked`, Rule 12).
- **The route** (`controlApi.ts:227-238`) resolves `groupRepoId(store, groupId)`; for a `flow-vault-…` id it takes the
  path from `resolveRepository` (the vault) instead of requiring `repositoryKnown` (which answers only for trusted-config
  ids, `src/control/webService.ts:1280`). Repository ids keep today's check.
- `projectKeyOf` on the vault finds no remote and the view's `projectKey` is null (`groupDecisions.ts:78-80`); see §16 O6.

### 10.1 The registered gap, closed for dir flow groups

`finishReconcile` (`driverLanding.ts:544-640`) gains the branch D and E already have: for `isDirFlowGroup`, it does not
export or write `.decisions/` into the reconciled tree (`:572,607`); it builds the run's and the reconciler's events with
`runLedgerEvents` and stages them as `stagedFlowDecisions` through `stagePending` (`:198-204`), so `landedWithPending`
writes them to `flow_decisions` in the landing's transaction (`:88-91`); a replay that finds rows for the run
(`flowDecisionsWritten`, `:102-105`) stages none. After this, no landing path writes `.decisions/` for a dir flow group,
and the flow copy-back can never carry one into the folder. Dir requirement groups keep the git ledger in the vault
(above) and placement excludes it.

---

## 11. Concurrency

### 11.1 Ownership of refs (code never moves another owner's ref)

| Ref (in the folder's vault) | Owner | Moved by |
|---|---|---|
| `refs/orca/import/<n>` | shared, append-only | create-only `update-ref` by any import (`snapshot.ts:115-119`) |
| `refs/orca/<flowRunId>/base`, `refs/orca/<flowRunId>/head` | that flow run | the flow kernel only (CAS, `compose.ts:61-75`) |
| `refs/heads/orca/flow-<…>` (flow children) | that flow child | the driver's landing for that child |
| `refs/heads/orca/<groupId>` | that dir group | the driver's D/E/R (CAS, `workspace.ts:128`) and `take-folder` (CAS) |
| `refs/orca/group/<groupId>/base`, `…/placed` | that dir group | export (create-only) and placement (CAS) |
| `refs/orca/group/<groupId>/pending`, `…/drift/<n>` | that dir group | placement (written before the journal, deleted after the swap) and `take-folder` (create-only, kept) |

### 11.2 The folder is the one shared resource

- Every write into a folder and every read that decides one runs under `withDirLock(realpath NFC)`, the same
  in-process lock with the same key: a flow copy-back (`kernel.ts:549`); a dir group's whole placement pass for that
  group (§8.5 steps 1–8) and `take-folder`; and **the flow kernel's drift snapshot** — `absorbDrift`'s
  `snapshotDrift` call (`kernel.ts:589`) is moved inside `withDirLock(run.body.dir)` (review I8), as its own
  acquisition, released before `redoPendingCopyBack` (`kernel.ts:586`) or the copy-back at `:549` takes the lock
  (the lock is not re-entrant; no acquisition is nested). One panel drives both (F §8.2), so no reader sees a
  half-done write of the other.
- Each writer judges the folder against its own record: a flow run against its flow head, a dir group against its
  `placed`. Each therefore sees the other's writes as drift:
  - a flow copy-back seen by a dir group ⇒ `dir-folder-changed` **only when** the flow left a path the group's next
    placement also writes in a state that is neither side of the change (§8.3; the flow writing exactly the group's
    `to` content is `at-to`, no stop); a flow writing other paths does not stop the group, and those paths are left as the
    flow wrote them;
  - a dir group's placement seen by a flow run ⇒ absorbed by `absorbDrift` as a person-authored `edit` (`by` the run's
    owner, `via: fs`, `kernel.ts:604-606`). Nothing is overwritten; the attribution says "person" for work a dir group
    did (writer's call to accept, §15 D6; §16 O2). The narrow rule does not change this direction: the flow kernel's
    own drift rule (`absorbDrift`, `kernel.ts:583-638`) is unchanged.
  - With the narrow rule, a flow and a dir group working on disjoint paths of one folder both proceed; they stop each
    other only where their paths meet, and there only the dir group stops (the flow absorbs, F §5.4). A later
    `take-folder` attributes the flow's paths to the flow run, not to the person (§9.2 step 2).

### 11.3 Two dir groups on one folder

Each has its own work branch, `base` and `placed`. A dir group B that depends on dir group A on the same folder exports
(and takes its base) only after A is done and placed (§6.4 step 1, §7), so B's base holds A's work and A's placement is
not drift for B. Without a prerequisite edge, whichever places second stops to ask only if the other's placement wrote
a path it also writes; on disjoint paths both place.

---

## 12. Commands and access

Today's tiers: `VERB_ACCESS` `any | human-only` and `SOCKET_TIER` `open | token` (`src/panel/humanOnly.ts`); roles
owner/member/agent (`src/panel/permissions.ts:32-36`); `permissionRefusal` (`permissions.ts:59-82`). The new verb gets a
registry row in `src/commands/domains/work.ts` beside `group set-integration` (`work.ts:157`) and `npm run gen:cli-docs`.

| Command | Verb | `VERB_ACCESS` | Socket tier | Owner (Web) | Member (Web) | Dispatched run |
|---|---|---|---|---|---|---|
| `orca requirement open … --project <dir project>` | `requirement-open` | `any` (unchanged, `humanOnly.ts:32`) | — | allowed | allowed | refused `control-dispatched-run-refused` (payload check, §5.1); on a repository project allowed as today |
| `orca group folder-change <group> --take-folder` | `resolve-folder-change` `{action: take-folder}` | `human-only` | `token` | allowed | refused `control-verb-human-only` | refused `control-dispatched-run-refused` |
| `orca group folder-change <group> --recheck` | `resolve-folder-change` `{action: recheck}` | `human-only` | `token` | allowed | refused | refused |
| `orca group folder-change <group> --withhold` | `resolve-folder-change` `{action: withhold}` | `human-only` | `token` | allowed | refused | refused |
| `orca group set-integration <dir group> …` | `set-group-integration` | `human-only` (unchanged, `humanOnly.ts:50`) | as today | refused `dir-group-delivery-fixed` | refused (human-only) | refused |
| `orca plan import … --repo <dir project>`, and opening a correction-debug or system-debug group on a `dir` project | `import-plan` / the debug open verbs | unchanged | — | refused `dir-project-plan-import-unsupported` | same | same |

`resolve-folder-change` is human-only for all three actions (writer's call): the ruling says the folder change is the
**person's** to answer, so neither a member nor an agent may answer it, and `recheck` and `withhold` have no reason to
be looser than `take-folder`.

---

## 13. Amendments to published specs (they stay as written; Rule 13)

- **F §5.1** "dir groups never integrate [IR-I7]" now covers dir requirement groups too, by `dir-group-delivery-fixed`;
  their delivery is placement (§8), not flow copy-back.
- **F §5.2** "One vault per directory, shared by every flow run on it" ⇒ shared by every flow run **and every dir group**
  on it. `importSnapshot` takes its base ref by name (§6.1); flow refs are unchanged.
- **F §6.2** "a landing writes the run's decisions to `flow_decisions`" now holds for R too (§10.1).
- **F §5.4** (flow drift): `absorbDrift`'s folder snapshot is taken under `withDirLock`, as copy-back already is (§11.2).
  Copy-back itself is unchanged for flow runs; dir groups do not use it (§8.4).
- **F §20** gains the rows of §14.

---

## 14. Out-of-repo writes (Rule 17 registration)

| Path (env redirect) | Writer / trigger | Modes | Failure residue |
|---|---|---|---|
| `$ORCA_VAULT_DIR` (default `~/.orca/vault/`), `<vaultId>.git` | **new writers:** requirement call A2 (vault creation on first use, imports); export (`refs/orca/group/<g>/base`, `…/placed`, the document commit, `refs/heads/orca/<g>`); driver D/E/R for a dir group (attempts, landings, `.decisions/` commits, as for flow children); placement (folder commits, `placed`, `pending`); `take-folder` (folder-edit commits, `drift/<n>`) | dirs `0700`, files `0600` (`--shared=0600`, root chmod, `vault.ts:40-46,55-56`); unchanged | refs are written last (create-only or CAS); the folder commit being written is held by `refs/orca/group/<g>/pending` until its swap and every drift commit by `drift/<n>`, so nothing in flight is unreferenced; objects left by a crash before a ref was written stay unreferenced, and nothing collects them yet (§16 O5) |
| the person's folder (`dirWorkspace.dir`) | placement only (§8), and nothing else | **these are the person's project files, not Orca's data** (writer's call under review C2, recorded here against Rule 17's `0600`/`0700` default): new files `0644` / `0755` by the vault mode `100644` / `100755`, new dirs `0755`, set explicitly by `chmod`, never from umask; an existing file keeps its permission bits except the executable state its change sets (§8.4); a file no landing changes keeps its mode untouched | only `at-from` paths of one `placed → F′` change, each replaced by an atomic rename; a crash can leave `.orca-<8 hex>` siblings — a new version `t` (mode `0600`, Orca's `to` bytes) or a moved-aside old entry `a` — all named in `placement.pending.tmp`/`.aside` and settled first on the next round (§8.4); an `a` holding the person's bytes is restored, never deleted, and when the person re-created `p` meanwhile it is left in place and named on the group page; **directories created for an add** (named in `placement.pending.dirs`, mode `0755`) stay, possibly empty, when the add stops or the change is withheld (review N6); a stop leaves the person's file byte-identical |
| `<stateDir>.overview/flow-vault-<vaultId>/<commit>/overview.json` | overview cache of a dir group's call | as today (`privateDirectory`, file `0600`, `requirementOverview.ts:262,266,277`) | as today |
| child workspaces under `.workspaces` | today's driver | as today | as today |

Criteria set `ORCA_VAULT_DIR`, `ORCA_CONTROL_DIR` and `HOME` to separate temp directories and assert nothing appears
under `HOME` (D12).

---

## 15. Decisions made by the writer under the Rule 1 ladder (for the human; all reversible)

Each was argued against first (step 1); each is reversible (code and body fields only, no schema step, no write outside
the vault and the placement path), so the writer decided (step 2).

- **D1 — The base is a fresh import taken at export, after prerequisites are done** (not the split's overview commit).
  Against: the split's paths were validated against an older commit. For: the base is as close as possible to dispatch,
  which makes the first placement least likely to find a collision; ccloop judges paths by pattern at run time.
- **D2 — The requirement document is not written into the folder** (it is an Orca-own path, kept on the vault branch;
  the panel shows it). Against: a repository project gets the document in the repository. For: the ruling keeps Orca's
  ledger out of the folder; the same reason holds for Orca's other record, and a folder may not be a code project.
- **D3 — RULED by the controller (2026-10-24, session `ffec7b28`), no longer a writer's call:** placement stops only on
  colliding drift (§9.1). The writer's first draft (any drift stops) is kept as the recorded alternative. Known cost of
  the ruling: an unrelated edit the person made can still break what the tasks built, and placement does not ask about
  it.
- **D4 — Placement is a per-round driver pass on the group's work-branch tip**, not a step inside D. For: it covers D, E
  and R in one place, survives crashes by its journal, and serialises with flow copy-back under one lock.
- **D4a (review C1, controller's choice) — placement never merges.** A path is written only when the folder still holds
  the `from` side; a path already at the `to` side is skipped; anything else stops. Flow copy-back's three-way merge is
  not used for dir groups.
- **D4b (review C2) — new files `0644`/`0755` and new dirs `0755` in the person's folder**, not the flow's
  `0600`/`0700`: they are the person's project files; Rule 17's private modes stay on what Orca keeps (vault,
  temporaries). Reversible to the flow's rule by one constant.
- **D5 — `resolve-folder-change` is human-only (owner) for all three actions (`take-folder`, `recheck`, `withhold`), and
  there is no "write anyway" action.**
- **D5a (review I2) — the cheap trigger is a stat signature of the stopping paths and their parents** (§8.6), not a
  top-level mtime (which misses edits in subdirectories) and not a snapshot (which costs a full listing per round).
- **D6 — A flow run and a dir group may run on one folder at the same time.** Each sees the other's writes as drift; the
  flow records a dir group's placement as a person edit (§11.2). Alternative: refuse a placement while a flow run on the
  same folder is `running`, and refuse `flow start` while a dir group on it has unplaced work.
- **D7 — Only requirement groups get a dir workspace; `import-plan` on a `dir` project is refused** until H7.
- **D8 — The target repo id keeps the `flow-vault-` prefix** for dir groups.
- **D9 — A dir requirement group keeps a git ledger in the vault (not `flow_decisions`)**, so the decisions view,
  criteria flags and reconcile decisions work unchanged; dir flow groups keep `flow_decisions`.
- **D10 — No control schema step**: `dirWorkspace` and `placement` are group-body JSON; schema stays `"18"`.

---

## 16. Open items

- **O1** D2: should the requirement document be placed into the folder after all?
- **O2** D6: the flow journal attributes a dir group's placement to the person (`via: fs`). Making `absorbDrift` tell a
  placement from a person's edit needs a record the flow kernel can read; not specified here.
- **O3** Closed by the controller's ruling on D3 (§9.1). The human may still choose the recorded alternative.
- **O4** The workspace mode of a dir group (and of flow children) is the default; no project setting is consulted.
- **O5** No vault garbage collection exists (`orca flow vault gc` of F §20 is not built); unreferenced objects stay.
- **O6** Corrections and ccmem are keyed by a repository's remote (`src/corrections/projectKey.ts:61-81`); a vault has
  none, so a dir group's decisions cannot be corrected through `orca correct`, and ccmem does not index them.
- **O7** After `take-folder`, a later landing that conflicts with the person's commit blocks `reconcile-other-side:0`;
  the person retries the task.
- **O8** Over-cap, special and ignored files of the folder are not in the base, so tasks never see them; the import
  lists them (`snapshot.ts:23`). Showing that list on the group page is not specified. (A landing path among them is
  still judged by §8.3 like any other, so an edit there is never overwritten.)
- **O9** A modify is an atomic rename, so a modified file gets a new inode (its permission bits are kept, §8.4); a tool
  that watches the old inode (or a hard link to it) sees a new file.
- **O10** An emptied directory left by a delete stays in the folder.

---

## 17. Success criteria (Rule 4: exit codes; Rule 9: each named mutation seen red; Rule 18: `npm test`)

All run by `npm test` (exit 0; it selects by change and prints what it selected — a 0-file or skipped report is copied
into the report, never read as green, Rule 18); each file also alone with `npx vitest run <file>`. Mutations are made in
a `git clone --local` copy; restoration is proven by the byte counts of `git diff` and `git diff --cached` (Rule 15).
Every criterion uses temp `ORCA_VAULT_DIR`, `ORCA_CONTROL_DIR` and `HOME` (Rule 17). Fake agents only; no paid run.

| # | Criterion (test file) | Mutations that must turn it red |
|---|---|---|
| D1 | open records the dir workspace (`tests/control/dirRequirementOpen.test.ts`): on a `dir` project the body has `dirWorkspace` with the realpath of a folder reached through a symlink and its `vaultId`; a folder name given in NFD and the same folder in NFC give one `vaultId`; on a case-insensitive file system the folder given in different letter case gives the same `vaultId` a flow run on that folder gets (on a case-sensitive one this case is skipped and the skip is printed, Rule 12); on a repo project no field; no vault directory exists after open | compute `vaultId` from the unresolved path; skip NFC on one side; use a different `realpath` than `openVault`; write `dirWorkspace` inside `requirement`; create the vault at open |
| D2 | clarify on a non-git folder (`tests/control/dirRequirementOverview.test.ts`): the first call reaches `awaiting-answers` with no `repository-path`; the stored overview's `commit` is a `refs/orca/import/<n>` commit with no `.decisions/` (a folder `.decisions/x.jsonl` exists); a second call on the unchanged folder names the same commit; a folder that is a git repository keeps `.git` byte-equal (hash of every file under it before and after) and its `HEAD` is never the overview's commit | read `HEAD` in `buildRepositoryOverview` for a dir group; resolve the folder as the repo; drop `reuseUnchanged`; drop the `.decisions/` exclude |
| D3 | split on the vault (`tests/control/dirRequirementSplit.test.ts`): a target path present in the folder passes, an absent one is `path:<task>:<p>`; the stored plan's `targetRepo` is the vault path | pass the folder path to `expandSplitDraft`; check paths at a commit other than the call's |
| D4 | export (`tests/control/dirRequirementExport.test.ts`): creates `base`, `placed` = `base`, and `orca/<g>` = one-parent document commit on `base`, all in the vault; `placement.landedTip` = that commit; the folder is byte-equal; with a prerequisite not done the wake stays undelivered, no git child runs (a fake `git` on `PATH` counts calls: 0), nothing is created and the pass reports no progress; a replay creates nothing new and an existing `base` is not replaced | commit on the vault's `HEAD`; mark the wake delivered on `waiting`; count `waiting` as progress; open the vault before the prerequisite check; re-import on replay |
| D5 | end to end (`tests/control/dirRequirementE2E.test.ts`, the pattern of `tests/flow/vaultDriverProbe.test.ts`): accept → confirm → a 2-task group runs through the real driver and the pinned ccloop (fake agent) with the vault as target; both landings are on the vault's `orca/<g>` and each recorded `landedTip`; after placement the folder holds both tasks' files, and holds no `.decisions/` and no `.orca/requirements/`; a folder `.decisions/own.jsonl` that existed before is byte-equal and not in the decisions view; the decisions view lists the landed decision with `where: "group-branch"`; the group has no integration record and the integration pass runs no git child for it | place the tip's whole tree; skip placement; apply the repository default scheme; keep the working-tree ledger source; drop the `.decisions/` exclude |
| D6 | classification and stop (`tests/control/dirPlacement.test.ts`), each case on its own folder. **Collisions** (state `folder-changed`, `changed` names exactly that path, overview row `dir-folder-changed`, every folder file keeps bytes, mode, inode and mtime): the person edits a file the landing modifies; creates a file where it adds one; deletes a file it modifies; edits a file it deletes; edits the old path of a file it renames; sets `+x` on a file it modifies; edits an **over-cap** file it modifies; edits a **`.gitignore`d** file a landing writes. **Not collisions:** an edit identical to the landing's (`at-to`: not written, mtime unchanged); edits, creations and deletions on paths no landing touches (placement proceeds, the person's paths keep their bytes; a later landing that writes one of them then stops). **Unwritable** (state `folder-unwritable`, nothing of the change written, reason named): a landing that adds a symlink; one that edits a symlink; a file replacing a folder; a folder replacing a file; an added `README.md` beside the folder's `readme.md`; `withhold` then places the rest and lists the path in `withheld`; a `type-change` of `docs` (file → directory with 3 files below) lists and withholds all 4 paths together; a later landing that changes a withheld path's `to` entry classifies it again; `withhold` in `folder-changed` keeps the person's version and places the rest. **Modes:** a landing's new `100755` file is `0755`, a new `100644` file `0644`, a new directory `0755`; a mode-only change `100644→100755` adds `x` where `r` is set and touches no byte. **Answers:** after a colliding edit is undone the next round places without any command (watch signature); `recheck` re-runs; `take-folder` makes one folder-edit commit on `orca/<g>` holding exactly the `changed` paths — including an over-cap and an ignored one, read directly — carrying `Orca-Resolution`, writes `drift/<n>`, and the next landing is placed on top; a `changed` symlink is not taken and is named. **Lossless write:** a test hook between §8.4's aside comparison and its `rename`/`link` writes new bytes to `p` (or re-creates `p` after the aside): the person's bytes end at `p` (or in the named aside), byte-equal, and the path is `changed` | overwrite with `rename(t, p)` instead of aside + `link` (red on the hook case); delete the aside without comparing it; take `take-folder`'s paths from a snapshot (red on the over-cap case); withhold only the swapped path, not the paths below it; keep a withhold after its `to` entry changed; stop on any drift (the recorded alternative); decide collisions from `snapshotDrift` (red on the over-cap and ignored cases); three-way merge instead of stopping; treat `at-to` as a collision; ignore the executable state; write new files `0600`; run case-clash only on case-insensitive file systems; drop the watch re-run; take Orca-own paths onto the work branch |
| D7 | crash journal (`tests/control/dirPlacementJournal.test.ts`), crash hooks: after `pending` ref and journal, before any write; after k of n paths written (n = 3, k = 1); inside a write after the temporary `t` is created and half-filled; after `rename(p, a)` before the comparison; after `link(t, p)` before `unlink(a)`; after the `placed` CAS, before the body update; and for `take-folder` (review N3): after the `T′` CAS before the `placed` CAS, and after the `placed` CAS before the body transaction — each replay adopts the commit carrying `Orca-Resolution` and makes no second one. Each restarted round ends `idle` with every landing path equal to `F′`, no `folder-changed`, no `.orca-*` name left except an aside holding the person's bytes (none in these cases), and `refs/orca/group/<g>/pending` deleted; while `pending` exists, `git cat-file -e <F′>` succeeds after `git gc --prune=now` in the vault | journal after the folder write; skip the owed write; write in place instead of temp + rename (red on the torn case); forget to record a temporary or aside name before creating it; skip the adoption on replay (red: two folder-edit commits); treat `placed === to` as a failed CAS; omit the `pending` ref |
| D8 | one folder, a flow run and a dir group (`tests/control/dirPlacementWithFlow.test.ts`): an instrumented `withDirLock` records enter/exit for the flow copy-back, the flow's drift snapshot, and the whole placement pass — no two overlap, and the placement holds the lock from its first `lstat` to its last write; a flow copy-back on disjoint paths does not stop the group and both writers' files end in the folder; a flow copy-back that writes a path the group modifies to other bytes stops the group with that path, and the flow's bytes stay; a later `take-folder` attributes that path to the flow run (`Orca-Placed-By: <flowRunId>`) and the person's own edit to the person; no flow ref moved by the group and no `refs/orca/group/…` or `orca/<g>` ref moved by the flow | lock placement per step instead of per pass; take the flow drift snapshot outside the lock; lock with a different key; attribute every drifted path to the person; let placement move a flow head |
| D9 | reconcile on a dir flow group (`tests/flow/reconcileFlowDecisions.test.ts`): `finishReconcile` on a reconciling run of a dir flow child writes the run's and the reconciler's decisions to `flow_decisions`; the landed tree has no `.decisions/`; a replay writes no second row | remove the `isDirFlowGroup` branch from `finishReconcile`; skip the replay probe |
| D10 | refusals and access (`tests/control/dirGroupAccess.test.ts`): `set-group-integration` and `set-integration-scheme` refused `dir-group-delivery-fixed`; `import-plan`, correction-debug open and system-debug open on a dir project refused `dir-project-plan-import-unsupported`; `requirement-open` on a dir project by a dispatched run refused `control-dispatched-run-refused`, while the same run may open one on a repository project; `resolve-folder-change` (each of the 3 actions) refused for a member (`control-verb-human-only`), a socket agent without a person token (`control-person-token-required`) and a dispatched run (`control-dispatched-run-refused`), allowed for the owner; with nothing stopped refused `folder-change-not-pending`; `take-folder` refused in `folder-unwritable`, `withhold` refused when both `changed` and `unwritable` are empty; `VERB_ACCESS` equals §12 | make the verb `any`; drop the delivery refusal; drop the dispatched-run payload check; accept `take-folder` on `folder-missing` |
| D11 | copy (`web/tests/dirPlacementCopy.test.tsx`): every §9.3 code and the three reason words have en and zh text; the group's integration region of a dir group shows the changed, unwritable and withheld paths and the three buttons in both locales | drop one zh key; show the scheme picker for a dir group |
| D12 | Rule 17 (`tests/control/dirRequirementOutOfRepo.test.ts`): the D5 path with `HOME` and every `ORCA_*` redirect on separate temp dirs leaves nothing under `HOME` and nothing under `os.tmpdir()` that holds a folder file's bytes; the vault's dirs are `0700` and files `0600`; folder modes as D6 with umask `0077` and `0022` (the same result both times); a pre-existing folder file no landing changes keeps its mode | default the vault from `os.homedir()` at the call site; inherit modes from umask; `chmod` unchanged files |
| D13 | prerequisites (`tests/control/dirGroupEdges.test.ts`): a dependent of a dir group never stacks on its branch; `prerequisiteDone` reads no git (a fake `git` counts 0 calls) and is false while the prerequisite is `folder-changed`, has `pending`, or has `tip ≠ landedTip`, true once placed | `deliversLocally` false for a dir group; read the tip from git in `prerequisiteDone`; ignore `landedTip` |
| D14 | repositories unchanged: the existing `tests/control/requirementOverview.test.ts`, `requirementExport.test.ts`, `requirementE2E.test.ts`, `driverLanding.test.ts`, `driverReconcileDecisions.test.ts`, `tests/flow/vaultDriverProbe.test.ts`, `tests/flow/vault.test.ts` and `tests/flow/copyBackLock.test.ts` pass unchanged; a new case in `requirementOverview.test.ts` compares a repo project's overview with a **golden fixture committed with the change** (`tests/fixtures/requirement-overview/repo-golden.json`, captured from `main` before the change, so a later edit of the builder cannot regenerate it) | pass a `commit` for repo projects; change `importSnapshot`'s flow base ref; regenerate the golden in the test |
| D15 | flow drift under the lock (`tests/flow/driftLock.test.ts`): `absorbDrift`'s snapshot waits while a placement of a dir group on the same folder holds the lock (instrumented lock, ordered events), and a flow run alone behaves as before (`tests/flow/driftKernel.test.ts` unchanged) | snapshot outside the lock; nest the lock (deadlock: the test's 5 s timeout fails it) |
---

## 18. Build order (each package ends green on `npm test`, Rule 18)

1. **Golden first.** Capture and commit `tests/fixtures/requirement-overview/repo-golden.json` on `main` before any change
   (D14). Then the folder workspace primitives: `importSnapshot`'s `baseRef` option and `reuseUnchanged`;
   `buildRepositoryOverview`'s `commit`; `src/control/dirWorkspace.ts` (§4.1). Criteria: D14, unit parts of D2.
2. **Open and calls.** `dirWorkspace` at open; the dispatched-run payload check; `groupRepoId`'s dir branch; `env` in
   the deps; overview and split on the vault with the `.decisions/` exclude; `import-plan` and debug-open refusals.
   Criteria: D1, D2, D3.
3. **Export and dispatch.** Prerequisite wait, `base`/`placed`, the document on `base`; `dir-base-missing`. Criterion: D4.
4. **Delivery fixed.** No integration record, the two refusals, `deliversLocally`, the decisions-view source and route.
   Criteria: D5 (without placement assertions), D10 (delivery rows), D13 (stacking row).
5. **Placement.** The classifier, the no-merge writer, the pass under one lock, the journal and `pending` ref, the watch
   signature, stop-and-ask, `resolve-folder-change` (3 actions), `landedTip`, the overview row, protocol, copy, Web
   block. Criteria: D5, D6, D7, D10, D11, D13.
6. **The reconcile gap.** `finishReconcile` for dir flow groups. Criterion: D9.
7. **Concurrency and Rule 17.** The flow drift snapshot under the lock; attribution. Criteria: D8, D12, D15.
8. **Acceptance** in a sandbox with a real agent is a separate, human-approved paid run (not part of `npm test`): a
   requirement on a non-git folder from open to placement, with one person edit answered by `take-folder`.

---

## 19. Left to the builder (decide, record in the plan's ledger)

- Exact module and function names; the CLI spelling of `orca group folder-change` within the §12 row.
- How many `changed`/`unwritable` paths the body keeps beyond the first 200 (the count is always exact; the full list is
  in the canonical record §8.6 names).
- The Unicode case folding used by `case-clash` (`String.prototype.toLowerCase` after NFC, or full case folding), recorded
  with a test case for each choice's known difference.
- Whether `placeDirGroups` lives in `integrationPass.ts` or its own module.

---

## 20. Review round 2: finding → where it is answered

Round 2 of the independent review (relayed by the controller, session `ffec7b28`, 2026-10-24) found all 18 round-1
findings closed and raised N1–N8; the controller's choices are applied.

| Finding | Answer | Where | Criterion |
|---|---|---|---|
| N1 lossless write | the old entry is moved aside first, compared with `from`, restored when it differs; new versions land by no-clobber `link`; aside names journaled | §8.4, §8.5 step 3 | D6 (hook between comparison and rename), D7 (crash after aside, after link) |
| N2 take-folder input | reads exactly the `changed` paths directly (`hash-object` each, caps and excludes ignored), no snapshot, no fallback loop; `withhold` also accepts `changed` paths | §9.2 | D6 (over-cap and ignored `take-folder`), D10 |
| N3 take-folder replay | `Orca-Resolution: <command id>` trailer on `T′` and `P`; a replay adopts them | §9.2 step 0 | D7 (both crash points) |
| N4 type-change scope and withhold lifetime | the reason covers every landing path under the swapped prefix, withheld together; a withhold lasts until that path's `to` entry changes, then the path is classified again; no un-withhold verb is needed | §8.3, §8.5 step 5, §9.2 | D6 |
| N5 temp names | fixed `.orca-<8 hex>` in `p`'s directory | §8.4 | D7 |
| N6 created directories | journaled in `pending.dirs`, registered as residue | §8.4, §14 | D12 |
| N7 watch fail-safe | the signature only schedules a re-check; a miss delays, never writes | §8.6 | D6 (watch re-run) |
| N8 no-progress states | `failed` and `folder-missing` report no progress; `withhold` accepted in `folder-changed` when `unwritable` (or `changed`) is non-empty | §8.5 step 2, §9.2 | D4/D13 pattern (pass reports no progress), D10 |

