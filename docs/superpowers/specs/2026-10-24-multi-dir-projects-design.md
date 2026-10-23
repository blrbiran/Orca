# Multi-directory projects: several writable directories in one project (Orca + ccloop) — design

- **Status:** design only. Written 2026-10-24 by a spec-writer subagent of Orca session `ffec7b28`; not committed by the
  writer (the controller commits). Covers two repositories: Orca (`/Users/biran/code/skills/orca/Orca`, `main` at
  `fdceeb83`) and ccloop (`/Users/biran/code/skills/orca/ccloop`, `main` at `2c4f5ab`). Orca pins ccloop at `fbd3512`
  (`package.json:40`).
- **Origin.** Tester item old #55; human decision H7.
- **Builds on** `docs/superpowers/specs/2026-10-24-dir-project-requirements-design.md` ("DIR §n"). The writer read it
  uncommitted; it was then committed as `533475e1` during this writing. Its module `src/control/dirWorkspace.ts` maps one plain folder to one vault repository (DIR §4.1), and this spec calls
  it once per folder. DIR §4.1 says "H7 replaces it with a list and keeps a reader for the single object". §5.3 below does
  exactly that.
- **Extends, does not edit:** the flow engine spec (`2026-10-22-flow-engine-design.md`, "F §n") and the integration
  design the code cites as "integration spec". Both are published (Orca Rule 13). §17 lists what this spec amends.
- **Anchors (Rule 14).** Every `path:line` below was measured in this session with `nl -ba`, `cat -n`, `sed -n` and
  `rtk proxy grep -n`: Orca at `fdceeb83` (tree: the two uncommitted 2026-10-24 specs, plus an edit to the live-transcript
  spec), ccloop at `2c4f5ab` (clean). Measure them again before a plan cites them.
- **Marks.** "(writer's call)" means a decision this writer made on the Orca side, under Orca Rule 1 step 2 (the decision
  is reversible). **"(ccloop proposal)"** means a choice on the ccloop side. ccloop's Rule 1 says "If uncertain, ask
  rather than guess", and Orca's step 2 does not relax that rule (Orca Rule 16). §19 lists both kinds.
- **Proposals P1–P7: accepted, flagged for the human's review.** The controller relayed the human's standing instruction
  for this round, 「如果有问题，先按你的建议执行」, and accepted P1–P7 as proposed. P3 was then revised by review finding 7
  (§21). This is recorded as the controller's application of that instruction, not as a new ruling (ccloop Rule 18).
  The human should still confirm each proposal before the ccloop plan merges.
- **Revision 1 (2026-10-24, same writer, uncommitted).** An independent review was accepted whole. The controller's
  choices are applied in place, and §21 maps each finding to the section that answers it.

---

## 1. Human rulings implemented here (verbatim, 2026-10-24, session `ffec7b28`)

1. 「多个可写目录（多仓联动）」 — a project may have several writable directories, changed together.
2. Landing: 「先全部预检，再按固定顺序合」. Spelled out with the ruling: pre-check every directory's merge first. Only
   when every check passes, land the directories in the registered order. If one fails midway (for example, someone
   pushed), stop. Mark the group partially landed, list what landed, and wait for the person. Never automatically
   revert the directories that already landed.
3. Scope: 「git 仓库和普通文件夹都支持」 — both git repositories and plain folders can be directories of a project.
4. 「ccloop 原生支持多仓」 — ccloop's contract carries several repository paths. ccloop creates one worktree per repository
   and tracks each repository's diff itself.

Under ccloop Rule 18, nobody may announce a ruling on the human's behalf. Ruling 4 is the human's own, quoted above. The
ccloop plan must quote it verbatim and must not extend it. Every ccloop-side detail in this spec is a proposal (§19.2).

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **member** | A registered single-directory project (`repo` or `dir`, `src/panel/projectsFile.ts:21-23`) that a multi-dir project names. |
| **multi-dir project** | A new registry entry: a name and an **ordered** list of members (§4). The first member is the **primary**. |
| **dir key** | A member's project id (`PROJECT_ID_PATTERN`, `projectsFile.ts:13`). It names a directory in contracts, write sets, prompts and records. |
| **multi group** | A control group opened on a multi-dir project (only by `requirement-open`, §5.1). Its body carries `multiDir` (§5.3). |
| **dir target** | Where a member's group work lives: for a `repo` member, the member's repository; for a `dir` member, the folder's vault (DIR §2). Each dir target has its own work branch `refs/heads/orca/<groupId>` (`src/control/workspace.ts:44`). |
| **written dirs** (of a task) | The members a task declares writes for (§6.1), in registered order. The first of them is the task's **ccloop primary**; the rest are its **extra repos**. |
| **landing (run)** | Orca's step D (`src/control/driverLanding.ts:271-322`): an attempt merged onto the group's work branch. Internal to Orca. |
| **multi landing (group)** | The group-level delivery of §9: pre-check all dir targets, then carry each work branch to the person's branch or folder in registered order. It replaces integration (`src/control/integrationPass.ts:80`) and placement (DIR §8) for a multi group. |
| **partial** | Multi-landing state after at least one directory landed and a later one failed (ruling 2). |

---

## 3. As built today (measured)

### 3.1 Orca

- **Projects file.** `~/.orca/projects.json`, or `ORCA_PROJECTS_FILE` (`src/panel/projectsFile.ts:31-35`). The schema is
  strict: `{ version: 1, controlStateDir?, projects: [{ id, name, path, kind?, plans? }] }` (`:60-67`). `id`, `name` and
  `path` are each unique (`:68-75`). `kind` is absent (repo) or `"repo" | "dir"`, and an absent value stays absent
  (`:17-23`, test `tests/panel/projectsFileKind.test.ts` K1).
- **Registration.** `POST /api/projects { name, path }` (`src/panel/projects.ts:83-92`) adds a repository at a git top
  level only (`src/panel/projectRegistry.ts:104-118`, `project-path-not-repository-root`). `dir` projects are filed by
  hand and read at boot (`src/panel/server.ts:152`). The route checks no role: any signed-in Web user may add a project.
  The control socket serves only `GET /api/control/projects` and plan registration (`projects.ts:67-73`).
- **Control config.** Every registered project is a trusted repository, `repoId = controlRepoKey(id)`, with its real path
  (`src/panel/controlAssembly.ts:217`). `resolveRepository` is `vaultPathOfRepoId(env, id) ?? config.resolveRepository(id)`
  (`:229`). `knownRepository` is `config.hasRepository` (`:247-249`). `requirement-open` requires a known repository
  (`src/control/requirementCommands.ts:93`).
- **One target per group.** `groupRepoId` answers one repository id per group
  (`src/control/executionDriver.ts:217-224`). Every driver step resolves that id: A2 (`:317`), C (`:612-698`),
  D (`driverLanding.ts:280`), E (`:119`), R (`:561`), and integration (`integrationPass.ts:201`).
- **Dispatch A2** (`executionDriver.ts:301-389`): one work branch (`:330`) and one workspace (`:332`). The contract's
  `context.repoPath` becomes the run's workspace (`:362-365`). The envelope carries `targetRepo` and `base` (`:376-378`).
  Orca's own loop-work schema is strict (`src/control/schema.ts:62`).
- **Collect C.** Orca commits the attempt from ccloop's result repository `<sourceDir>/repo` (`executionDriver.ts:653`,
  `src/control/workspace.ts:113`). It judges out-of-bounds paths with `harvest(…, writeSetOf(contract))`
  (`executionDriver.ts:655`). Its collect schemas are strict (`src/control/ccloopPort.ts:45-46`).
- **Write sets.** A task's write set is `targetPaths ∪ allowlistPaths` (`src/scheduler/writeSet.ts:63-68`). Implicit
  ordering edges come from `intersect` (`src/scheduler/pathTrie.ts:55`) in `buildGraph` (`src/scheduler/graph.ts:150,178-182`).
  A split's draft is layered by the same code (`src/control/requirementSplit.ts:127-129`). Orca sets
  `allowlistPaths = targetPaths` for every loop task (`src/control/loopPlans.ts:280-285`).
- **Prompts.** Clarify is instruction version 3, "for one software repository" (`src/control/requirementClarify.ts:6,20`),
  with the fenced `repository-overview` (`:26`; frame `src/control/clarifyHost.ts:33`). Split is instruction version 1
  (`requirementSplit.ts:11-42`): "Changing it means version 2" (`:13`). The overview is one repository's commit
  (`src/control/requirementOverview.ts:258-279`).
- **Integration** (`integrationPass.ts`). It handles one group at a time, in id order (`:96`). Deliveries:
  `keep | local | push-target | push-branch | github-pr` (`src/control/webProtocol.ts:849-854`). The repository default
  is frozen per group (`src/control/integrationScheme.ts:18-21`). A delivery computes `new` on a base and publishes it
  behind a write-ahead `pending` record (`integrationPass.ts:358-389`). `local` moves the target ref by CAS, or
  fast-forwards a clean checked-out worktree (`:392-411`). `push-target` fetches and pushes without force
  (`:433-442`). A dir flow group never integrates (`:110`).
- **Prerequisites.** `deliversLocally` and `prerequisiteDone` (`src/control/groupEdges.ts:43-53`).
- **Flows** start only on a registered `dir` project's folder (`src/flow/flowCommands.ts:43-48`, `flow-dir-unregistered`).
- **Control schema** is `"18"` (`src/control/migrations.ts:4`).

### 3.2 ccloop

- **Contract** (`src/contract/schema.ts:25-82`, every level `.strict()`): `context { repoPath, targetPaths(min 1),
  relevantDocs, buildTestCommands(min 1), constraints }` (`:35-43`); `safetyPolicy { allowlistPaths, denylistPaths,
  maxFilesTouched, humanGateConditions }` (`:57-64`); `verification.requiredChecks` (min 1) (`:68`). An optional field
  added without a default leaves an old contract byte-identical. `toolRules` set the precedent (`:53-54`), and
  `tests/contract/toolRulesAbsent.test.ts` pins it.
- **Loop work** (`src/control/protocol.ts:72-86`; schemas `:261-279` for protocol 3 and `:296-309` for protocol 4):
  `{ kind, contract, targetRepo, base, sourceDir, skill dirs?, priorFailures? }`. At accept, `validateEnvelopePaths`
  checks absolute, canonical directories (`:372-409`). There is no feature key for contract shape. `features` answers
  `{ protocol: 1, tokenPolicy, savedResultRecovery, agentInstallationUpdate }` (`src/control/command.ts:275`). Two
  existing tests pin that exact object: `tests/control/protocol4.test.ts:13` and
  `tests/control/savedResultEvidence.test.ts:110`. Orca's reader is strict too (`src/control/ccloopPort.ts:226`).
- **Worktrees.** `createAttemptWorkspace(repoPath, runDir, attempt, startPoint?)` puts the worktree at
  `<runDir>/worktrees/attempt-<n>`, from `repoPath`'s HEAD (`src/workspace/worktreeManager.ts:19-29`).
  `publishAttemptCommit` commits everything and pins `refs/ccloop/<runDir basename>/attempts/<n>`. It also pins the claim's
  namespaced ref (`:59-67,77-89,103-132`). `cleanupAttemptWorkspace` removes the worktree (`:134-136`). The run loop
  creates the attempt at `src/controller/runLoop.ts:1543-1561`; it publishes and cleans at `:405`, `:458` and `:477`.
- **Diffs and path policy.** `evaluatePathPolicy` (`src/policy/pathPolicy.ts:14-39`) runs on the executor's
  `changedFiles` (`runLoop.ts:1802-1807`, `:1859-1861`, `:2251-2253`). An empty allowlist means "no check" (`:30`).
  `observeChangedPathsBestEffort` runs `git status` in one worktree (`runLoop.ts:652-662`).
- **Required checks** run with `sh -lc` in the one worktree (`runLoop.ts:202-221`).
- **Agents.** All three get exactly one directory:
  - claude: cwd = the worktree (`src/runtime/claude/claudeAgentAdapter.ts:417`). ccloop's extra args are the
    `--allowedTools` / `--disallowedTools` lists and then `--model` (`:204-209`, `:187`).
  - codex: `--sandbox <execute: installation sandbox | read-only> -C <worktree>` (`src/runtime/codex/runCodexPhase.ts:43-45`).
  - omp: `--cwd <worktree>`, tools by phase (`src/runtime/omp/runOmpPhase.ts:52-56`). Read-only phases are checked for
    mutation by a snapshot of the worktree (`src/runtime/omp/ompAdapter.ts:67,83`).
- **Prompts** (`src/runtime/claude/prompts.ts`, shared by codex and omp): the planner prompt (`:113-132`), the executor
  prompt (`:147-175`, "Allowed target paths" `:161-162`), and the verifier prompt (`:185`, required-check results
  `:36-50`). None of them names a directory.
- **Result repository.** `<sourceDir>/repo` holds the live attempt copy, the attempt ref, or a clone at `base`
  (`src/control/resultRepository.ts:53-90`). Collect's shape is `CollectionV1` (`src/control/collect.ts:25-50,143-166`).
  An optional top-level key that is absent leaves the bytes unchanged; `failureCause` and `toolRules` set the precedent.
- **Recovery paths that assume one repository.** These are continuation (`src/control/materialize.ts:159-166`), the
  saved-result comparisons that strip `repoPath` (`materialize.ts:198`, `src/control/savedResultRecovery.ts:95`),
  saved-result verify (`src/controller/verifySavedResult.ts:101`) and crash-resume cleanup
  (`src/controller/resumeLoop.ts:171,397`).

### 3.3 Agent CLIs (measured 2026-10-24; help text only, no paid call)

Commands: `codex --version; codex exec --help`, `claude --version; claude --help`, `omp --version; omp --help`. Output
was redirected to files under the session scratchpad and read back whole.

| CLI | Version | Flag (help text, verbatim) |
|---|---|---|
| codex | `codex-cli 0.163.0` | `--add-dir <DIR>  Additional directories that should be writable alongside the primary workspace`; `-C, --cd <DIR>  Tell the agent to use the specified directory as its working root` |
| claude | `2.1.309 (Claude Code)` | `--add-dir <directories...>  Additional directories to allow tool access to` |
| omp | `omp/18.10.1` | `--add-dir=<value>  Add a workspace directory beyond the working directory (repeatable)`; `--cwd=<value>  Directory to start in` |

How each agent behaves with these flags in a real run was **not measured** (no paid run, per the brief). §16 C6 pins
the arguments ccloop passes. Acceptance (§18 step O9) observes the behaviour.

---

## 4. The project model

### 4.1 The file (Rule 17: path `ORCA_PROJECTS_FILE`)

There is a new optional top-level key (writer's call: a separate list, so every existing reader of `projects[]`, which
assumes `path`, stays as it is):

```json
"multiDirProjects": [
  { "id": "shop", "name": "Shop (web + api)", "dirs": ["shop-web", "shop-api", "shop-assets"] }
]
```

- **The schema checks shape only** (review 11): `id` follows `PROJECT_ID_PATTERN`; `name` is not blank; `dirs` holds
  2 to 8 distinct strings that match `PROJECT_ID_PATTERN`, in order; `id` and `name` are unique across `projects[]` and
  `multiDirProjects[]` together. A shape error makes the file invalid, as any other shape error does today.
- **The loader checks references** (review 11). An entry is skipped **alone**, and named in `fileError` the way a broken
  plan is (`projectRegistry.ts:152-164`), when any of these hold:
  - a `dirs` id names no entry of `projects[]` (`multi-dir-member-unknown:<id>`);
  - a `dirs` id names another multi-dir project (`multi-dir-member-not-single:<id>`);
  - two members are the same directory or one is inside the other, compared by real path
    (`multi-dir-member-nested:<a>:<b>`). A nested pair would be one tree with two writers.
  The rest of the file still loads, and a skipped entry's id is unknown to the control plane, so every command on it
  fails `group-project-binding-required`.
- `dirs[0]` is the primary. A multi-dir project cannot be a member of another one.
- If the key is absent, the file parses and re-saves byte for byte, as `kind` did (K1). A file without the key is never
  given one.
- **An older Orca refuses a file that has the key.** Its file schema is strict (`projectsFile.ts:67`), so the panel
  refuses to start with `projects-file-invalid` (`src/panel/server.ts:151`). Downgrading Orca after creating a multi-dir
  project means removing the key by hand. The Web form says so once, the first time a multi-dir project is created.
- The file is written by `writeProjectsFile` as today (`projectsFile.ts:126-145`): a new file is `0600` in a `0700`
  directory, and an existing file keeps its mode.

### 4.2 Registration and editing

- `POST /api/projects { name, dirs: string[] }` creates a multi-dir project. The body takes **either** `path` (today's
  shape) **or** `dirs`; a body with both, or with neither, gets `400`. Refusals: `multi-dir-too-few` (fewer than 2),
  `multi-dir-too-many` (more than 8), `multi-dir-member-unknown:<id>`, `multi-dir-member-duplicate:<id>`,
  `multi-dir-member-not-single:<id>` (the member is itself a multi-dir project), `multi-dir-member-nested:<a>:<b>`, and
  today's `project-name-taken`.
- `PATCH /api/projects/:id` on a multi-dir project accepts `{ name }` (as today) and `{ dirs }`, which replaces the list
  under the same checks. The edit applies to groups opened **after** it. An open group keeps the list it froze (§5.3).
  No migration and no rewrite of open groups (writer's call).
- `GET /api/projects` adds rows `{ projectKey, name, kind: "multi", dirs: [{ projectKey, kind }], path: <primary's
  path>, controlRepoId }`. The `path` field is for display and keeps today's row shape for the Web. Single-dir rows
  stay byte-identical (`projects.ts:34-36`).
- The Web project registry gets a "Group several projects" form with an ordered picker and up/down arrows. Copy is in
  §13. There is no CLI verb, because projects have no CLI add today.

### 4.3 The control plane

- `controlAssembly.ts` builds `multiDirProjectOf(repoId) → { dirs: [{ key, repoId, kind, path }] } | null` from the
  registry. `knownRepository` accepts a multi-dir repo id (`controlRepoKey(id)`) in addition to `config.hasRepository`
  (`:247-249`).
- `resolveRepository(<multi id>)` **throws** `multi-dir-no-single-path`. Every code path that still resolves a multi
  group's project id directly therefore fails by name, instead of acting on one directory without saying so
  (Rule 12, §5.4).
- Repository settings stay per member: workspace mode, integration default, checks, criteria review.
  `set-workspace-mode`, `set-integration-scheme`, `set-criteria-review` and the check settings are refused on a
  multi-dir repo id with `multi-dir-project-setting-unsupported`, whose text says to set them on the member.

### 4.4 Existing single-directory projects

There is no migration and no change of behaviour. A file without `multiDirProjects`, and every group on a `repo` or
`dir` project, take today's code paths unchanged. The DIR spec's dir groups keep their single `dirWorkspace` body
field. §16 M15 pins all of this.

---

## 5. Opening a requirement on a multi-dir project

### 5.1 Scope (writer's call)

Only `requirement-open` creates a multi group. These are refused:

| Action | Code |
|---|---|
| `import-plan` with a multi-dir repo id | `multi-dir-plan-import-unsupported` (a plan file names one `targetRepo`) |
| `flow-start --project <multi>`, or a scheduled flow / group on one (sibling spec `2026-10-24-scheduled-flows-and-groups-design.md`) | `flow-project-multi-dir-unsupported`. It is checked before `registeredDirProject` (`flowCommands.ts:43-48`), so the reason is named. |
| `correction-debug-open` / system-debug groups on a multi group | `debug-multi-dir-unsupported` |

### 5.2 Open

`applyRequirementOpen` (`requirementCommands.ts:85-111`) gains the dependency `multiDirProjectOf`. For a multi-dir repo
id it writes the group body's `multiDir` (§5.3) and no `dirWorkspace`. It reads only `realpathSync`. Open writes nothing
outside the control DB: no vault and no import, as in DIR §5.1.

### 5.3 The group body (JSON, top level, outside the strict `requirementBlockSchema`)

```
multiDir: {
  project: <multi repo id>,
  dirs: [ { key, repoId: <member repo id>, kind: "repo" | "dir",
            dirWorkspace?: { dir, vaultId } } ],           // frozen at open, registered order; dirs[0] = primary
  landing: <§9.2, written at accept>
}
```

- A `dir` member's entry carries the DIR `dirWorkspace` object, frozen the same way. "H7 replaces it with a list"
  (DIR §4.1) is this list. The single-object reader stays for single dir groups.
- `requirement.repoId` stays the multi-dir repo id. The panel filters and names the group by it.
- **Target resolution** (review 9):
  - `dirTargetRepoId(store, groupId, key)` answers the member's repo id for a `repo` member, and
    `flowVaultRepoId(vaultId)` for a `dir` member (DIR §6.1).
  - `multiPrimaryRepoId(store, groupId)` is `dirTargetRepoId` of `dirs[0]`.
  - **`groupRepoId` (`executionDriver.ts:217-224`) throws `multi-dir-group-no-single-repo` for a multi group.** No
    single-target code path can act on the primary alone without saying so. Every call site is listed in §5.4 and either
    calls `multiPrimaryRepoId` on purpose or gets a multi branch.

### 5.4 Every `groupRepoId` site, with its multi-group answer (review 9)

The sites were measured with `rtk proxy grep -rn "groupRepoId(" src` at `fdceeb83`, plus the three sites DIR §6.1
switches to `groupRepoId`. The plan measures them again. Any site missing from this table hits the throw of §5.3,
which is loud (Rule 12).

| Site | What it does | Multi group |
|---|---|---|
| `executionDriver.ts:276` | workspace mode for a new drive | per written dir: the member's mode (§7.1); the primary's drive uses the ccloop primary's member |
| `executionDriver.ts:317` (A2) | dispatch target | multi branch, §7.1 |
| `executionDriver.ts:1008`, `:1029` | `cleanupRunWorkspace` after publish / settle | the ccloop primary: `cleanupRunWorkspace` as today (`workspace.ts:175-180`, unchanged). Each extra repo: a new `cleanupExtraWorkspace(target_k, roots, runId, key)` that refuses unless `basename(path) === <runId>.dir-<key>`, then calls `removeOwnPath` and `update-ref -d incomingRefOf(runId)` in that dir target. It calls **no** `removeSkillsSnapshot`, because skills live only with the primary (round 2, N1) |
| `executionDriver.ts:1347-1348` | saved-result recovery dispatch | not reached: refused `multi-dir-recovery-unsupported` (§7.4) before it |
| `driverHandoff.ts:125` | cleanup on handoff stop | per written dir, as for `:1029` |
| `driverHandoff.ts:313` | continuation target | not reached: blocked `multi-dir-continuation-unsupported` (§7.4) |
| `driverLanding.ts:123` (E) | ledger-only commit | `multiPrimaryRepoId` (§10) |
| `driverLanding.ts:280` (D) | run landing | multi branch, §8.1 |
| `driverLanding.ts:561` (R) | reconcile | not reached: D blocks `multi-dir-landing-conflict` (§8.2) |
| `integrationPass.ts:113`, `:151`, `:201` | conflict copies, correction close, integrate | not reached: the pass skips a multi group beside the dir-flow skip (`:110`) |
| `integrationResolve.ts:197`, `:300`, `:318` | conflict resolution | not reached: a multi group never has an integration record or conflict (§9.2) |
| `src/panel/controlApi.ts:230` | decisions view route | `multiPrimaryRepoId` (§10) |
| `requirementCalls.ts:143`, `:300`; `requirementExport.ts:112` (DIR §6.1) | overview, split, export | multi branches: §6.3, §6.4 |

Other places that act on one group target are handled by name:

| Place | Multi group |
|---|---|
| H token-allowance resume (`executionDriver.ts:320-336`) | blocked `multi-dir-continuation-unsupported` (§7.4) |
| DIR placement pass (DIR §8.5) | skips a multi group; its folders are placed by §9 |
| criteria base re-run (`executionDriver.ts:681-697`) | not run; the flag carries `base-run-skipped: multi-dir` (§7.2) |
| scheduled checks `checksPass` (`src/control/webService.ts:1077-1083`), which collects `plan.repoId` of every group and resolves it (`repositoryPath`) | multi repo ids are skipped **by name** when the list is built (round 2, N2): `isMultiDirRepoId(repoId)` ⇒ not a check project. Each member's own integration-check settings apply in the multi pre-check (§9.4) |
| landing worktree `landingPathOf(roots, runId)` (`driverLanding.ts:253`) | per directory: `landingPathOf(roots, runId)` for the ccloop primary, and the flat leaf `<workspacesRoot>/landing-<runId>.dir-<key>` for each extra repo (round 2, N1), each removed in `landOnTip`'s `finally` (`:261-263`) |

---

## 6. Requirements, plans and tasks

### 6.1 How a task names what it writes

A task in a multi group declares writes **per directory**:

```
writes: [ { dir: <key>, targetPaths: [..](min 1), checks: [..] } ]   // ≥ 1 entry, distinct dirs
```

- The **written dirs** are the `writes[].dir`, sorted into registered order. The first is the task's ccloop primary
  (§7.1), and its `checks` must be non-empty (`checks-primary:<task>`), because ccloop needs `requiredChecks` to have at
  least one entry (`schema.ts:68`). Other entries may have `checks: []`.
- A directory the task does not write gets **no worktree and no write grant** (writer's call; §19 W2). Orca sets
  `allowlistPaths = targetPaths` (`loopPlans.ts:285`). A mounted directory with no targets would have an empty
  allowlist, which ccloop reads as "no check" (`pathPolicy.ts:30`).
- **This is not isolation** (review 5). All three agents can read absolute paths outside their mount. The reviewer
  measured this in this session, and the codex `read-only` sandbox can read outside `-C`. W2 is about which directories
  get a worktree, a write grant and a diff judged by ccloop, never about what an agent can read. Listing the
  non-written members as read-only paths in the prompt is the direction of §20 O1.
- **Orca keeps each task's `writes`** (review 2): its directory keys and paths are stored on the task's confirmed
  record beside the contract. Write sets (§6.2), dispatch (§7.1) and collect (§7.2) read the keys from there.
- A task that writes **one** directory gets an ordinary single-repository contract (no `repoKey`, no
  `additionalRepos`), with that member as its repository, even when the member is not the project primary.
- Paths are checked per directory at the overview's commit for that directory, with `overviewPathExists`
  (`requirementOverview.ts:285-294`). A bad path is `path:<task>:<key>:<p>`, and an unknown directory is
  `dir:<task>:<key>`.

### 6.2 Write-set conflicts across directories (Rule 5: code decides)

- `writeSetOf` (`writeSet.ts:63-68`) stays byte-identical, and so does every single-directory group.
- For **every** task of a multi group, `qualifiedWriteSetOf(writes)` builds the write set from Orca's own `writes`
  record (§6.1), **never** from the contract's `context.repoKey`. A single-directory task's contract has no key at all
  (§6.1, review 2).
- Each claim, `targetPaths ∪ allowlistPaths` of its directory, is prefixed with a leading segment `\0<key>`. NUL cannot
  occur in a path, so no real path can forge it. `normalizeClaim` (`:41-47`) runs first, so `**` becomes the prefix
  `\0<key>/` (the whole directory).
- `buildGraph` (`graph.ts:178-182`) takes the qualified set for every task of a multi group. Two tasks conflict only
  when they claim overlapping paths **in the same directory**. `**` in `shop-web` does not conflict with anything in
  `shop-api`. The implicit edge record (`requirementSchemas.ts:90`) shows the conflicting claims with the prefix
  rendered as `<key>:<path>`.
- Out-of-bounds checks at collect (§7.2) use each directory's own unqualified claims against that directory's result
  repository.

### 6.3 The overview across directories

- `buildOverviewFor` (`requirementCalls.ts:142-145`) for a multi group builds one overview per member, in order. A `repo`
  member uses `HEAD` (today's `buildRepositoryOverview`). A `dir` member uses its import commit
  (DIR §6.2, `importFolder(…, reuseUnchanged: true)`). Each is cached under its own dir target id, as today
  (`requirementOverview.ts:266`).
- The pieces are composed into
  `{ schema: "orca-project-overview-v1", dirs: [ { key, name, kind, primary: bool, overview: <orca-repository-overview-v1> } ] }`.
  The call record keeps `commits: { <key>: <sha> }`.
- **Limits** (writer's call): each directory's `OVERVIEW_LIMITS` count limits are divided by the number of members
  (floor, at least 1), so the composed prompt stays within today's single-repository size order. Byte limits on single
  documents are unchanged. §20 O6.

### 6.4 Prompts

- **Clarify.** There is a new frame `MULTI_DIR_FRAME` with the instruction `CLARIFY_INSTRUCTION_MULTI_V1`, the text of V3
  with "for one software repository" replaced by "for a project made of several directories (repositories or folders),
  listed in order; the first is the primary". The fenced context is named `project-overview`. V3 and `REQUIREMENT_FRAME`
  (`clarifyHost.ts:33`) stay byte-identical. The single-repository golden criteria still pass unchanged (§16 M15).
- **Split.** There is a new `SPLIT_INSTRUCTION_MULTI_V1` with its own head line, "Orca requirement split (several
  directories), instruction version 1.", and a JSON schema in which `targetPaths` and `checks` are replaced by `writes`
  (§6.1). Rules: "`writes[].targetPaths` are relative to that directory's root"; "`writes[].checks` are shell commands
  run **in that directory**"; "name only the directories the task changes". `SPLIT_INSTRUCTION_V1`
  (`requirementSplit.ts:14-42`) and `SPLIT_JSON_SCHEMA` (`:46-54`) stay byte-identical.
- **Expansion.** `expandSplitDraft` (`:73-79`) for a multi group builds, per task, one contract through
  `expandLoopTask`. The primary directory's `targetPaths` and `checks` go into the existing fields, with
  `context.repoPath` set to that member's dir target path. The extra directories become `context.additionalRepos` (§11.1),
  with `repoPath` set to their dir target paths and `allowlistPaths = targetPaths`. A loop plan's `documentChecks`
  (`loopPlans.ts:290`) apply per directory, to that directory's targets. `context.repoKey` is set to the primary's key.
- **Accept** imports the plan with **no** integration record. Delivery is the multi landing (§9.2). The requirement
  document is exported to the primary as DIR §6.4 describes for a folder primary, or as today for a repository primary.
  Every other member's work branch is created at export too: a `repo` member at its `HEAD`, a `dir` member at a fresh
  import that becomes its `base`/`placed` (DIR §6.4 steps 1-2). All dir targets of a group are therefore based at the
  same moment.
- **The export sets `landing.lastLanded[key]` to that directory's export base for every directory** (review 3). A
  directory the group never writes keeps its work branch at that base. That base equals `lastLanded`, so the directory
  is never "due" (§9.1) and nothing is carried for it.
- **Expansion uses the ccloop primary.** In the expansion bullet above, "the primary directory" means the task's ccloop
  primary (§2: its first written dir), not the project primary.

---

## 7. Dispatch and collect (Orca)

### 7.1 A2 for a multi group's run

For every written dir of the task, in registered order:

1. Resolve the dir target (§5.3).
2. `ensureWorkBranch(target, groupId, null)`. For a `dir` member, the branch the export made must exist; otherwise the
   step blocks `dir-base-missing`, as in DIR §6.5.
3. `ensureWorkspace(target, mode(member), workspacePathOf(roots, runId, key), base, roots)`. Here `mode(member)` is
   the member's workspace mode; a vault takes the default. The primary keeps today's path; an extra repo uses
   `<workspacesRoot>/<runId>.dir-<key>` (round 2, N1). It is a flat leaf directly under the workspaces root, so
   `assertOwnPath`'s rule "its parent is the workspaces root" (`workspace.ts:48-52`), `removeOwnPath` and
   `ensureWorkspace` hold unchanged. A project id cannot contain `/`, so the leaf is always flat.

The runtime contract is the frozen one, with `context.repoPath` set to the primary's workspace (as today, `:362-365`)
and each `additionalRepos[i].repoPath` set to that directory's workspace. The envelope's `work` gains
`additionalRepos: [{ key, targetRepo, base }]` in the same order (§11.1). Orca's own strict loop-work schema
(`src/control/schema.ts:62`) gains the same optional `additionalRepos` entry; it is absent for every single-repository
envelope. The drive record gains
`dirs: [{ key, targetRepo, base, workspacePath }]`, and the primary's fields stay where they are today.

Skills inject into the primary only, as today (`:343-359`).

### 7.2 C for a multi group's run

- `commitAttempt` runs on each result repository: the primary's `<sourceDir>/repo` (unchanged), and
  `<sourceDir>/repos/<key>` for each extra repo (§11.6). It yields `attemptSha` per directory, kept in `drive.dirs[]`.
- `harvest` runs per directory with that directory's own claims. Any out-of-bounds path blocks with
  `out-of-bounds:<key>:<paths>` (today's form gains the key).
- The criteria check (`classifyCriteriaChange`) runs per directory with that directory's checks. A flagged change is
  recorded as today. The base re-run (`executionDriver.ts:681-697`) is **not** started for a multi run (writer's call).
  The flag reads `base-run-skipped: multi-dir` (§20 O4).
- `ccloopPort.ts:45-46` accepts the optional `dirs` key of collect (§11.6) and checks that its keys equal the
  envelope's.

### 7.3 Attempt identity (Orca's view)

A run's attempt is `(runId, attempt n)` with one commit per written directory, `{ <key>: attemptSha }`. The primary's
commit stays in `drive.attemptSha`, so every single-directory reader (debug input, decisions) sees today's field.

### 7.4 What a multi run cannot do in v1 (writer's call; ccloop proposal P6)

These are not offered for a multi run, and each is blocked by name:

- handoff continuation;
- token-allowance resume;
- saved-result recovery or verify;
- execution-format capture.

A2 blocks `multi-dir-continuation-unsupported`, and `verify-saved-result` on a multi run is refused
`multi-dir-recovery-unsupported`. The person may `retry-task`, which starts fresh from the current work-branch tips.
§20 O3.

---

## 8. Landing a run onto the work branches (D) — internal to Orca

### 8.1 All produced first, then swapped in registered order

`stepD` for a multi run:

1. For each written dir, in order: `old_k = tip(orca/<g>)`, and `findLanding(target_k, base_k, old_k, sha_k)`
   (`driverLanding.ts:47`). Directories that already landed are skipped. This step is the replay.
2. For each directory not yet landed, the merge commit is produced in that directory's landing worktree, as
   `landOnTip` does (`:249-264`), but **without** swapping. The ledger goes into the primary's commit (§10).
   - If the group primary is not among the written dirs, the ledger becomes a ledger-only commit on the primary's tip.
     It reuses E's algorithm (`:119`) and is recognised on replay by `.decisions/<runId>.jsonl` at the tip.
3. If any directory's merge conflicts, nothing is swapped, and the run blocks
   `multi-dir-landing-conflict:<key>:<first 20 paths>`.
4. Otherwise, one transaction writes `drive.landingPlan = [{ key, old, next }]` to the run body (the journal). Then each
   directory is swapped by CAS from `old` to `next`, in registered order (`compareAndSwap`, `workspace.ts:128`).
5. A moved tip (`moved`) ends the round. The next round starts again at step 1: directories already swapped are found
   by `findLanding` and skipped, and only the rest are produced again.
6. When every directory has landed, `markLanded` runs with the primary's commit, and `landedDirs: { <key>: commit }` is
   kept in the run body.

The work branches are Orca's own refs. A run that has landed in some directories but not yet in others is a transient
internal state that the next round finishes. It is never shown as delivered work.

### 8.2 No agent reconciliation in v1 (writer's call)

Reconciliation R (`driverLanding.ts:324-640`) works on one repository. A multi run whose landing conflicts in any
directory therefore blocks, as in step 3 above. The person answers with `retry-task`, which starts a fresh attempt on
the current tips. If an earlier round of that same run had already swapped some directories, the block's detail lists
them (`landed in: <keys>`). §20 O2.

---

## 9. Multi landing: pre-check every directory, then land in registered order

### 9.1 When it runs

There is a new driver pass, `landMultiDirGroups(deps)`. It runs once per round, right after `integratePendingGroups`
(`executionDriver.ts:1242`, as the DIR placement pass does), with the same error handling. It takes one group at a time,
in id order. A group is skipped while it is archived, stopped (`groupStopped`), reconciling, or **not complete**: the
trigger is always "group", meaning every task is done and no run is active (`integrationPass.ts:178-183`;
writer's call, §19 W6).

A group is due when some **carried** directory's work-branch tip differs from `landing.lastLanded[key]`. A carried
directory is one whose scheme is `local`, `push-target` or `place`; a `keep` directory never makes a group due
(review 3). `lastLanded` starts at each directory's export base (§6.4), so a directory no task wrote is never due.

### 9.2 What each directory delivers (frozen at accept)

`multiDir.landing.delivery = [{ key, scheme }]`, in registered order:

| Member | scheme |
|---|---|
| `dir` (a folder) | `place`: DIR §8 placement into the folder |
| `repo` | the member's repository default (`readIntegrationDefault`, `integrationScheme.ts:18-21`), frozen like a group's integration record: `keep`, `local` or `push-target` |

If a member's default is `push-branch` or `github-pr`, `requirement-draft-accept` is refused with
`multi-dir-delivery-unsupported:<key>` (writer's call: N pull requests that must merge together is a separate design;
§20 O5). `set-group-integration` on a multi group is refused `multi-dir-delivery-fixed`. A `keep` directory is never
carried; its work stays on `orca/<g>`.

### 9.3 The record

```
landing: { delivery: [...],
           state: "idle" | "prechecking" | "landing" | "landed" | "partial" | "blocked" | "folder-changed" | "folder-unwritable",
           pending: { plan: [ { key, kind, base, next, tip } ], landed: [key], startedAt } | null,   // the journal
           lastLanded: { <key>: <tip sha> },
           reason: string | null, detail: string | null, failedKey: string | null,
           movedBeforeAny: 0 | 1,
           resolution: { action: "retry-rest" | "mark-resolved", by, at, unlanded?: [key] } | null,
           at: <ms> }
```

### 9.4 Pre-check (writes nothing into any target; code only, Rule 5)

For each directory in order, with `tip_k = tip(orca/<g>)` in its dir target:

- **`keep`**: nothing.
- **`local` / `push-target`**: the existing pieces are reused without publishing.
  1. `readBase()`, which for `push-target` also fetches (`integrationPass.ts:395,435`). A missing target branch gives
     `multi-dir-target-missing:<key>`.
  2. If `tip_k` is an ancestor of `base_k`, nothing is to be carried for this directory.
  3. Otherwise `computeNew` runs with the member's method (`:330-353`). The function takes a `GroupIntegration`, and for
     a multi group it is given a per-directory stand-in: `{ lastIntegrated: lastLanded[key], integratedCommit:
     lastLanded[key], scheme: <frozen scheme>, schemeHash, pending: null, conflict: null, … }`. `lastIntegrated` is the
     only field `computeNew` and `squashMessage` read from it: it is the squash merge-base (`:318`, `:332`). A conflict gives `multi-dir-precheck-conflict:<key>:<paths>`.
  4. Publish preconditions:
     - for `local` with the target checked out, the worktree must be clean and its HEAD must equal `base_k`, so the
       later fast-forward can succeed: `integration-worktree-dirty:<key>`, `integration-not-fast-forward:<key>`
       (`:403-406`);
     - for `push-target`, the remote must be configured: `integration-remote-missing:<key>` (`:445`).
- **`place`** (review 4): DIR §8.5 steps 1–6 run under that folder's `withDirLock`, and nothing is written:
  1. `openDirWorkspace`; a refusal is `folder-missing`;
  2. any owed `placement.pending` is settled first (DIR §8.5 step 3);
  3. read the tip;
  4. compute `F′ = nextFolderCommit(T, placed)`, with Orca-own and **withheld** paths kept as DIR §8.5 step 5 says;
  5. **classify** `placed → F′` (DIR §8.3).

  Only a landing path classified `changed` stops: state `folder-changed`. Only an `unwritable` path stops: state
  `folder-unwritable`. In both cases the stop happens **before anything lands**, the paths are recorded, and the DIR
  needs-you for that directory is raised. Drift on paths the landing does not write never stops (DIR §9.1). Otherwise
  `next = F′`.
- **Integration checks** (review 8; replaces this spec's first draft of W7) are **opt-in per member**. A carried
  directory runs them only when that member's effective `integration-check` setting is enabled
  (`effectiveChecks(store, repoId).kinds["integration-check"]`, `src/control/checks/settings.ts:49-71`). The commands
  are the member's integration-check `command` when it is set. Otherwise they are the de-duplicated union of the checks
  that the group's done tasks declared for that directory, in task order and then contract order, as the setting
  means: "run instead of the landed groups' own required checks" (`webProtocol.ts:856-858`).
  - They run through **`runIntegrationCheck`** (`src/control/integrationCheck.ts:70-92`): a detached worktree under
    the workspaces root that is removed afterwards, `sh -lc`, `dispatchedEnv({ runId: checkId, personDir })` with the
    panel's `dispatched-person` directory, and `INTEGRATION_CHECK_COMMAND_TIMEOUT_MS`.
  - That function gains an optional `rev` argument (default `refs/heads/<target>`, so today's caller,
    `webService.ts:1199`, is byte-identical), and the pre-check passes `next`. For a folder member, `repo` is its vault
    and `rev` is `F′`.
  - They run off the driver round, under state `prechecking`, as `startDebugCheck` does (`executionDriver.ts:674`).
  - Any failure stops with `multi-dir-precheck-check-failed:<key>`. `detail` holds the failing commands with their
    `exit` and `tail` (`integrationCheck.ts:60`).
  - A restarted panel finds `prechecking` with no live check and simply pre-checks again; nothing was written.

Any refusal above ends the pass for this group: state `blocked`, `failedKey`, `reason`, and **nothing is landed**.

**Nothing to carry** (round 2, N3). A carried directory has nothing to carry in two cases: its tip is already in the
target (`local` / `push-target` step 2), or `tree(F′) = tree(placed)` (`place`, DIR §8.5 step 5). For such a
directory, the pre-check records `lastLanded[key] = tip` in its result and does not put it in the plan. When the plan
is empty, the pass ends as `landed`: one transaction writes those `lastLanded` values, `pending = null` and state
`landed`, and no publish happens. Otherwise the values are written with the journal (§9.5 step 1).

### 9.5 Land in registered order

1. **Journal.** One transaction writes `pending = { plan, landed: [] }` and state `landing`.
2. For each directory of `plan` in order:
   - publish with the existing delivery: `localDelivery` / `pushTargetDelivery` `.publish(next, base)`
     (`integrationPass.ts:392-411,433-442`). For `place`, DIR §8.5 steps 6–8 run under that folder's `withDirLock`:
     classify again, then the journal (`placement.pending` and the `pending` ref), the write and the swap;
   - on success, one transaction appends `key` to `pending.landed` and sets `lastLanded[key] = tip`.
3. **A failure midway** stops the sequence at once. It is one of:
   - a publish that answers `moved` (someone pushed, or moved the branch);
   - a blocked reason (a dirty worktree, or not a fast-forward);
   - a folder stop (DIR §8.5 step 9: a path classified `changed` or `unwritable` since the pre-check);
   - a thrown error.

   The state then depends on what landed:
   - `pending.landed` is non-empty: state `partial`, with `failedKey`, `reason` and `detail`. The directories that
     already landed are **never** reverted (ruling 2). `pending` is kept.
   - `pending.landed` is empty and the reason is `moved`: nothing landed, so this is a race with the pre-check. The
     state goes back to `idle` with `movedBeforeAny = 1`, so the next round pre-checks again. A second `moved` before
     anything lands gives `blocked` `multi-dir-target-moved:<key>` (as integration's "moved again", `:387`).
   - `pending.landed` is empty and the reason is anything else: `blocked`.
4. When every directory has landed: state `landed`, `pending = null`, `movedBeforeAny = 0`. When a carried `local` or
   `push-target` delivery lands, the member's integration "integrated commit" is not touched, because the member's own
   groups are unaffected.

### 9.6 Crash recovery mid-sequence (journal replay)

A round that finds state `landing` with `pending` set replays, for each directory of `pending.plan` in order:

- if `key ∈ pending.landed`, skip it;
- otherwise, if the target already holds `next`, record it as landed. "Holds" means: for `local`, the ref equals `next`
  or has `next` as an ancestor (`integrateLocal`'s re-entry, `:415-418`); for `push-target`, `remoteHas` (`:447`); for
  `place`, `placed` equals `next` after DIR §8.5 step 3 has settled any owed write;
- otherwise, continue §9.5 from this directory.

No pre-check is redone during a replay. The plan was pre-checked whole before the journal was written, so a replay is
the same sequence resumed. Crash hooks: `multi-land-after-journal`, `multi-land-after-publish:<key>` and
`multi-land-after-record:<key>`.

### 9.7 The person's verbs on `partial`, `blocked` and the folder stops

A new verb, `multi-dir-landing`, with target group and payload `{ action: "retry-rest" | "mark-resolved" }`. It is
accepted while `landing.state ∈ {partial, blocked, folder-changed, folder-unwritable}` (review 10); otherwise it is
refused `multi-dir-landing-not-pending`. Like DIR §9.2, the command only records `resolution`, and the next round does
the git and folder work.

- **`retry-rest`.** The next round pre-checks (§9.4) **only the directories not in `pending.landed`**, against fresh
  bases. Then it lands them in registered order (§9.5) under a new journal; the landed directories are untouched. On
  `blocked`, nothing landed, so this is a full retry.
- **`mark-resolved`** ("I landed the rest myself", or "leave them"). The state becomes `landed`. `resolution.unlanded`
  lists the keys that were never carried, kept with `by` and `at` (Rule 13). For those keys, `lastLanded[key]` is set to
  the current tip, so the group is not due again for the same tips.

A folder stop is answered with DIR's `resolve-folder-change` (§9.8). **Once that answer is recorded, the next round
runs the pre-check again by itself** (review 10), for the directories not yet landed. No `retry-rest` is needed.
`retry-rest` and `mark-resolved` are also accepted in a folder state: `mark-resolved` leaves that folder unplaced, and
`retry-rest` re-checks it as it stands.

### 9.8 Folders in the sequence

- The placement of a `dir` member is DIR §8.5 run as two halves:
  - steps 1–6 in the pre-check (§9.4);
  - steps 6–8 in the sequence (§9.5), both under that folder's `withDirLock`.

  Its `placement` record (DIR §8.2) moves to `multiDir.landing.placement[<key>]`, with the same fields and the same
  vault refs (`refs/orca/group/<g>/placed`, `…/pending`, `…/drift/<n>`).
- **Stop and ask.** A folder stop found in pre-check stops **before anything lands** (state `folder-changed` or
  `folder-unwritable`, nothing landed). One found during the sequence is a failure midway: state `partial`, with reason
  `dir-folder-changed` or `dir-folder-unwritable`, and the DIR needs-you for that folder. The DIR watch signature
  (DIR §8.6) re-runs the pre-check when the person undoes the edit.
- `resolve-folder-change` (DIR §9.2) gains a `dir: <key>` field, required for a multi group and refused for any other
  (`folder-change-dir-mismatch`). Its actions are DIR's, **including `withhold`** (review 4): `take-folder`, `recheck`
  and `withhold`. They act on that folder's vault and records exactly as DIR describes. A withheld path is then kept
  out of `F′` by DIR §8.5 step 5 in the next pre-check.

### 9.9 Prerequisites

- **Stacking.** A multi group is never a stack base: `stackBaseOf` (`groupEdges.ts:64-76`) skips a multi prerequisite
  explicitly, since its work is on several branches. A dependent therefore starts from its own target's HEAD.
- **Done.** `prerequisiteDone` answers true only when every task is done **and** every directory whose frozen scheme
  is `local` or `place` has `lastLanded[key]` equal to its tip, with no `pending`. Directories delivered `push-target`
  or `keep` are **not** local deliveries (review minor; today's `deliversLocally` is `local` only, `:43-45`), so they
  do not hold a dependent back, as today.

---

## 10. `.decisions/`: one ledger, in the primary

(Writer's call, §19 W8.) A multi group's decisions are recorded **only** in the primary's dir target:

- **repository primary:** on its `orca/<g>`, carried to the person's branch by its delivery as today;
- **folder primary:** on the vault's `orca/<g>`, never placed (DIR §10).

A run that did not write the primary still gets its ledger there (§8.1 step 2). Other members never receive
`.decisions/`. A `.decisions/` path in a non-primary directory's write set is refused at split validation
(`ledger-path:<task>:<key>`). The decisions view (`ledgerSources`, `src/control/ledgerAtRef.ts:82-89`) reads the
primary's sources: today's three for a repository primary, the group branch only for a folder primary (DIR §10). A
decision's `scope: cross-repo` (prompts `:140`) needs no new handling.

---

## 11. ccloop: several repositories in one run (ccloop work under ccloop's rules; Orca is the consumer, Orca Rule 16)

### 11.0 ccloop rules that constrain this part

| ccloop rule | How it binds this design |
|---|---|
| Rule 1 (ask, don't guess) | Every ccloop-side choice here is a proposal (§19.2) until the human confirms it. The writer did not decide them. |
| Rule 13 | Branches, merges and worktree removals in ccloop are the builder's. `merge --ff-only` into `main`, `branch -d` and `worktree remove` (without force) are allowed without asking each time. **Push is the human's.** Forced forms each need their own consent. |
| Rule 14 | Every gate run goes to a file and is read back whole. The vitest JSON's `RUN` path is checked, and counts are measured, never copied from a document. |
| **Rule 15** | No existing criterion may change unless the human names the test, the whole test is rewritten without being loosened, and the ruling is recorded. **This design changes none** (§11.9). A builder who finds that one must change stops and asks for a named ruling. |
| Rule 16 | ccloop history and published comments are append-only (ERRATUM). The new comments cite this spec. |
| Rule 17 | Mutations run only in a `git clone --local` copy, after `npm run build` (the handoff's note on `dist/`). Uncommitted files are copied in with `cat`. Mutations are rerun after any code change. |
| Rule 18 | The human's ruling 4 is quoted, and nothing else is presented as a ruling. |

### 11.1 Contract and envelope (additive; the field's presence is the version)

**Contract** (`src/contract/schema.ts`), all optional with **no default**:

```ts
context: { ...,
  repoKey: z.string().regex(/^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_])?$/).optional(),
  additionalRepos: z.array(z.object({
      key, repoPath: z.string().min(1), targetPaths: z.array(z.string()).min(1),
      allowlistPaths: z.array(z.string()).optional(), denylistPaths: z.array(z.string()).optional(),
      requiredChecks: z.array(z.string()).optional(),
  }).strict()).min(1).max(7).optional() }
```

Refinements:
- `repoKey` is present if and only if `additionalRepos` is present;
- keys are unique and different from `repoKey`;
- each extra repo has at least one target path.

`maxFilesTouched` counts across all repositories. A contract without either key parses to exactly today's bytes. This
is proven against the existing golden `tests/fixtures/toolRules/golden-2a2ae53/contract.json` (§16 C1).

**Envelope.** Loop work (`protocol.ts:261-279,296-301`) gains `additionalRepos?: [{ key, targetRepo, base }]`, which must
match the contract's `additionalRepos` keys in the same order. At accept, `validateEnvelopePaths` (`:386-409`) checks
every `targetRepo` (absolute) and every contract `repoPath` (canonical directory). The repositories must be pairwise
distinct and none may contain another (`control-request-invalid`).

**No feature key (ccloop proposal P1).** Orca pins ccloop by commit (`package.json:40`, `verify:ccloop-pin`), and an
older ccloop refuses the unknown key through `.strict()`, which is a loud failure. Adding a `features` key would change
`tests/control/protocol4.test.ts:13` and `tests/control/savedResultEvidence.test.ts:110`, and Rule 15 would then need a
named ruling. If the human wants a feature key anyway, those two tests are what the ruling must name.

### 11.2 One worktree per repository; attempt identity

- **Location** (review 7). At attempt start (`runLoop.ts:1543-1561`), after the primary worktree is created as today,
  ccloop creates one worktree per extra repo at **`<runDir>/dirs/attempt-<n>/<key>`**. This is outside `worktrees/`,
  so the code that reads `worktrees/` stays as it is:
  - crash resume's residual scan (`resumeLoop.ts:171-181`);
  - `attemptRefName`'s path derivation (`worktreeManager.ts:59-67`);
  - the fresh-run guard (`src/persistence/fileStore.ts:70-72`);
  - the result-repository and saved-result paths (`resultRepository.ts:71`, `savedResultRecovery.ts:301`).
- Each extra worktree starts from that repo's HEAD (Orca's workspace for it). Worktrees are created in contract order.
  A failure removes the ones already made and goes through the same infrastructure-retry path (`:1562-1589`).
- **Start sha.** Each extra worktree's HEAD at creation is recorded as its start sha (review 6).
- **New, additive checks beside the old ones:**
  - `ensureFreshRunDir` refuses a non-empty `<runDir>/dirs` in a new check placed after `fileStore.ts:70-72`, with the
    message `runDir already contains prior run data (dirs)`;
  - crash resume calls a new `cleanupResidualExtraWorktrees(contract, runDir)` after `resumeLoop.ts:397`. It removes
    each `<runDir>/dirs/attempt-*/<key>` from its own repo (publish first, as for the primary), then the empty
    directories.
- **Attempt commits.** Each extra worktree is committed and pinned **in its own repository** under the primary's ref
  names: `refs/ccloop/<runDir basename>/attempts/<n>` and the namespaced `refs/ccloop/<claimRunId>/attempts/<n>`. They
  are computed from the run directory and attempt number, not from the path (a new
  `publishExtraAttemptCommit(repoPath, worktreePath, runDir, attempt)` beside `worktreeManager.ts:103`). The attempt's
  identity is `(runId, n)` with `{ <key>: { sha, base, ref } }`. It is written to
  `run/attempts/<n>/commits.json` (`0600`), primary first.
- **Every publish/cleanup site** (`runLoop.ts:405,458,477` and their callers) publishes and cleans every extra
  worktree after the primary. As today, publish comes before cleanup. A failed extra publish is reported like a failed
  primary publish. **Normal cleanup also removes the then-empty `<runDir>/dirs/attempt-<n>`** after the attempt's
  last extra worktree is removed, and removes `<runDir>/dirs` once it is empty (round 2, N4). A finished run therefore
  leaves no `dirs/` behind, and `ensureFreshRunDir`'s new `dirs/` guard never fires on a run's own leftovers.
  Crash resume cleans residual extra worktrees through the new function above; the existing
  `cleanupResidualWorktrees` (`resumeLoop.ts:171`) is untouched.

### 11.3 Per-repository diffs and path policy (ccloop tracks them itself)

When `additionalRepos` is present (ccloop proposal P2):

- **The primary is judged as today** (review 1). The executor's `changedFiles` lists only primary paths, relative to the
  primary, exactly as now. Today's per-kind checks of that list keep running unchanged, among them omp's
  `omp-changed-files-mismatch` (`src/runtime/omp/ompAdapter.ts:116-120`, the reported list against `git status` of the
  primary) and `omp-head-mutated` (`:111-115`). The primary's policy input stays as it is today.
- **Extra repos are judged only from ccloop's own observation** (review 6). After execute, for each extra worktree:
  1. if its HEAD differs from its start sha (the agent committed or reset), the result is a human gate
     `extra-repo-head-moved: <key>`, judged like omp's `omp-head-mutated`;
  2. otherwise its changed paths are `git diff --name-only -z --no-renames <start sha>` (tracked changes, staged or
     not) together with the untracked paths of `git status --porcelain=v1 -z --untracked-files=all`
     (`observeChangedPathsBestEffort`, `runLoop.ts:652-662`).

  The executor's `changedFiles` is never consulted for an extra repo. Without `additionalRepos`, nothing changes.
- `evaluatePathPolicy` runs per repository. The primary uses `safetyPolicy`'s lists. An extra repo uses its own
  `allowlistPaths` (default: its `targetPaths`) and `denylistPaths` (default `[]`). `maxFilesTouched` applies to the
  total. The reasons gain the key: `allowlist miss: <key>:<path>`, `denylist match: <key>:<path>`.
- An unobservable worktree (git fails) is a human gate `diff unobservable: <key>`. It is never treated as "no change".
- omp's read-only-phase snapshot (`ompAdapter.ts:67,83`) covers every worktree. A mutation in any of them is the
  existing failure, with the key in the evidence file.

### 11.4 Required checks: which cwd

The primary's `verification.requiredChecks` run first, with cwd = the primary worktree (`runLoop.ts:202-221`,
unchanged). Then each extra repo's `requiredChecks` run in contract order, with cwd = that repo's worktree. Evidence
for an extra check is labelled `[<key>] <command>`; the primary's evidence bytes are unchanged. The first failure stops
the checks as today. Its failing command is reported as `[<key>] <command>` for an extra repo. The verifier receives
every result in that order (`prompts.ts:36-50`), labelled.

### 11.5 Agents and what they are told

| Kind | Arguments (only when `additionalRepos` is present; otherwise byte-identical) |
|---|---|
| claude | `--add-dir <w1> … <wk>` (the extra worktrees) on **every phase**. It is a variadic list, so it is placed with the other lists before `--model` (`claudeAgentAdapter.ts:209`). cwd stays the primary worktree. `requiredCheckAllowRules` covers the extra repos' checks too (`:205`). |
| codex | `--add-dir <wi>` once per extra worktree, on **execute only**, after `-C <primary>` (`runCodexPhase.ts:44`). `--add-dir` grants **nothing** under a `read-only` sandbox: in plan and verify, and on execute when the installation's sandbox is `read-only`. Such an installation cannot write an extra repo, and its attempt fails as a read-only installation does today. The `read-only` sandbox can read outside `-C`; the reviewer measured this in this session (§20 O7). |
| omp | `--add-dir=<wi>` per extra worktree, on **every phase**, after `--cwd <primary>` (`runOmpPhase.ts:56`). |

- **Tool rules** (`src/runtime/toolRules.ts`) are unchanged. They inspect the installation's own command (`:113-136`),
  and `--add-dir` is ccloop's argument, not the installation's. The tool-rules report is unchanged.
- **Skills** stay in the primary: codex links (`codexSkills.ts:26`), omp listing, claude `--plugin-dir`. Skill
  directories must lie outside **every** worktree (the inside-worktree checks run per worktree).

**Prompts** (planner, executor, verifier). Only with `additionalRepos` present, one section is added right after the
success condition:

```
Directories (each is a separate git worktree; write only inside the allowed paths of each):
- <repoKey> (working directory): <primary worktree>  allowed: <targetPaths>
- <key>: <absolute worktree>  allowed: <targetPaths>  checks run there: <requiredChecks or "none">
```

The executor is also told (review 1): "changedFiles lists only the paths you changed in the working directory, relative
to it. ccloop observes the other directories itself." Without `additionalRepos`, every prompt is byte-identical, and
the existing prompt and argv goldens pass unchanged.

### 11.6 Result repositories and collect

- `materializeResultRepository` (`resultRepository.ts:53-90`) runs once more per extra repo, with destination
  `<sourceDir>/repos/<key>`, using the same three cases: a live copy of `<runDir>/dirs/attempt-<n>/<key>`, the
  attempt ref in that repo, or a clone of that repo's `targetRepo` at its `base`. `<sourceDir>/repo` is unchanged.
- `CollectionV1` (`collect.ts:25-50`) gains, only when `additionalRepos` is present,
  `dirs?: [{ key, resultRepo: "repos/<key>", changedPaths: string[] }]`. The order is the contract order and
  `changedPaths` is the §11.3 observation. It is a top-level key, like `toolRules`, so the protocol-3 terminal
  projection (`:91-103`) is untouched.

### 11.7 Verify, recovery, saved results (ccloop proposal P6)

- **Verify phase**: supported (§11.4, §11.5).
- **Crash resume** (owner restart mid-attempt): supported (§11.2).
- **Refused at accept** when `additionalRepos` is present:
  - `inputCheckpoint` non-null: `control-multi-repo-continuation-unsupported`. `materializeFirstWorkspace`
    (`materialize.ts:159-166`) bundles only one repository.
  - `mode: "verify-saved-result"`: `control-multi-repo-recovery-unsupported`.
- `saved-result-source-eligibility` and `saved-result-eligibility` answer ineligible with the same code. Execution-format
  capture (`runLoop.ts:1554`, `executionFormatFailure.ts`) is not entered. The semantic-contract comparisons that strip
  `repoPath` (`materialize.ts:198`, `savedResultRecovery.ts:95`, `executionFormatFailure.ts:129`) are left as they are,
  because these paths are unreachable for a multi-repo envelope.

### 11.8 Out-of-repo writes

ccloop writes only where it writes today, with the same modes: the run directory, under Orca's control state; and
attempt refs plus worktree metadata in each repository it is given. The new writes are refs and worktree metadata in
the extra repos, the extra worktrees under `<runDir>/dirs/`, `run/attempts/<n>/commits.json` (`0600`) and `<sourceDir>/repos/<key>` (directories `0700`, as
`<sourceDir>/repo` is made).

### 11.9 Existing ccloop tests

**None change** under this design. Measured: no test names `additionalRepos`, `repoKey` or `--add-dir`
(`rtk proxy grep -rln` over `tests/`, empty). The only key-set pin on contract and work is
`tests/control/priorFailuresSchema.test.ts:28`, which asserts absence and still holds. The contract golden is pinned by
`tests/contract/toolRulesAbsent.test.ts`, and the features object by `tests/control/protocol4.test.ts:13` and
`tests/control/savedResultEvidence.test.ts:110`. The fresh-run guard's tests (`fileStore.ts:70-72`) and the
`resumeLoop` residual-worktree tests are untouched, because the extra worktrees live outside `worktrees/` (review 7).
All of these, together with the claude execute argv goldens
(commit "test(runtime): the claude execute argv goldens gain the optional flow property"), must pass **unchanged**.
§16 C12 makes "no existing test file modified" a criterion.

---

## 12. Commands and access

Today's tiers are `VERB_ACCESS` (`src/panel/humanOnly.ts:9`) and `SOCKET_TIER`; the roles come from
`src/panel/permissions.ts:32-36`, and refusals from `permissionRefusal` (`:59-82`). New verbs get registry rows in
`src/commands/domains/work.ts`, beside `group set-integration`, and `npm run gen:cli-docs` is run.

| Action | Verb / route | `VERB_ACCESS` | Socket tier | Owner (Web) | Member (Web) | Dispatched run |
|---|---|---|---|---|---|---|
| Register or edit a multi-dir project | `POST` / `PATCH /api/projects` | — (HTTP route, as today) | not on the socket (as today) | allowed | allowed (as today's add, `projects.ts:83-92`; writer's call to follow it) | not offered |
| Open a requirement on it | `requirement-open` | `any` (unchanged) | — | allowed | allowed | allowed (as today) |
| Accept its split | `requirement-draft-accept` | `any` (unchanged) | — | allowed; refused `multi-dir-delivery-unsupported:<key>` (§9.2) | same | same |
| Retry the rest / mark resolved | `multi-dir-landing {action}` | `human-only` | `token` | allowed | refused `control-verb-human-only` | refused `control-dispatched-run-refused` |
| Answer a folder stop | `resolve-folder-change {dir, action: take-folder \| recheck \| withhold}` | `human-only` (DIR §12) | `token` | allowed | refused | refused |
| Change delivery | `set-group-integration` | `human-only` (unchanged) | as today | refused `multi-dir-delivery-fixed` | refused (human-only) | refused |
| Settings on the multi id | `set-workspace-mode`, `set-integration-scheme`, `set-criteria-review`, check settings | unchanged | unchanged | refused `multi-dir-project-setting-unsupported` | same | same |
| Import a plan | `import-plan` | `any` (unchanged) | — | refused `multi-dir-plan-import-unsupported` | same | same |
| Start a flow | `flow-start --project <multi>` | unchanged | unchanged | refused `flow-project-multi-dir-unsupported` | same | same |
| Retry a blocked task | `retry-task` | `any` (unchanged) | — | allowed | allowed | as today |

CLI: `orca group multi-land <group> --retry-rest | --mark-resolved`, and `orca group folder-change <group> --dir <key>
--take-folder | --recheck | --withhold` (DIR §9.2's actions, DIR §12's spelling). `multi-dir-landing` is also accepted in `folder-changed`
and `folder-unwritable` (§9.7). `multi-dir-landing` is human-only for both actions (writer's call): ruling 2 says the
partial state "waits for the person".

---

## 13. Codes and copy (en / zh), added to `web/src/locales/en.ts` and `zh.ts`

Needs-you rows use the overview step kind `integration-review` (`src/panel/controlOverview.ts:87-88`) with these
reasons. Their destination is the group's integration region, which for a multi group shows the directory list with
each directory's state (landed / not landed / failed and why) and the buttons.

| Code | Kind | en | zh |
|---|---|---|---|
| `multi-dir-partially-landed` | needs-you | Orca updated some of this group's directories and then could not update {{key}} ({{reason}}), so it stopped. Updated: {{landed}}. Not updated: {{rest}}. Nothing was undone. Fix the cause and choose "Retry the rest", or update the rest yourself and choose "Mark resolved". | Orca 已更新这个任务组的部分目录，随后 {{key}} 无法更新（{{reason}}），因此停了下来。已更新：{{landed}}。未更新：{{rest}}。已更新的没有回退。排除原因后选「重试剩余目录」，或者自己更新剩下的目录后选「标记为已处理」。 |
| `multi-dir-precheck-failed` | needs-you | Orca checks every directory before updating any. {{key}} cannot be updated: {{reason}}. No directory was changed. | Orca 会在更新任何目录之前先检查全部目录。{{key}} 无法更新：{{reason}}。没有任何目录被改动。 |
| `multi-dir-precheck-conflict` | reason | the group's work conflicts with {{key}}'s target in: {{paths}} | 任务组的工作与 {{key}} 的目标分支在这些路径上冲突：{{paths}} |
| `multi-dir-precheck-check-failed` | reason | a check failed in {{key}}: {{command}} | {{key}} 中的检查失败：{{command}} |
| `multi-dir-target-moved` | reason | {{key}}'s target moved twice while Orca was about to update it | {{key}} 的目标分支在 Orca 将要更新时两次发生变动 |
| `multi-dir-target-missing` | reason | {{key}}'s target branch does not exist | {{key}} 的目标分支不存在 |
| `multi-dir-landing-conflict` | blocked run | This task's changes conflict with work already in the group in {{key}}. Retry the task to run it again on the group's latest work. | 这个任务的改动与任务组在 {{key}} 中已有的工作冲突。重试这个任务，让它基于任务组的最新工作重新运行。 |
| `multi-dir-continuation-unsupported` | blocked run | A task that works in several directories cannot continue from where it stopped yet. Retry it to start again. | 跨多个目录的任务暂时不能从中断处继续。请重试，从头开始。 |
| `multi-dir-delivery-unsupported` | refusal | {{key}} delivers through a pushed branch or a pull request, which a multi-directory group cannot use yet. Set that project's delivery to keep, local or push to target first. | {{key}} 的交付方式是推送分支或拉取请求，多目录任务组暂不支持。请先把该项目的交付方式改为保留、本地合并或推送到目标分支。 |
| `multi-dir-delivery-fixed` | refusal | A multi-directory group delivers with each directory's own setting, fixed when it was accepted. | 多目录任务组按各目录自己的设置交付，在接受时已固定。 |
| `multi-dir-project-setting-unsupported` | refusal | This project groups several directories. Change this setting on the directory's own project. | 这个项目由多个目录组成。请在对应目录自己的项目上修改此设置。 |
| `multi-dir-plan-import-unsupported` | refusal | Plans cannot be imported into a multi-directory project. Open a requirement on it instead. | 多目录项目不能导入计划。请在它上面开需求。 |
| `flow-project-multi-dir-unsupported` | refusal | Flows run on one folder. Choose a folder project, not a multi-directory project. | 流程只作用于一个文件夹。请选择文件夹项目，而不是多目录项目。 |
| `multi-dir-landing-not-pending` | refusal | There is no stopped landing waiting for an answer on this group. | 这个任务组没有等待答复的已停止交付。 |
| `multi-dir-too-few` / `multi-dir-too-many` | refusal | A multi-directory project needs between 2 and 8 projects. | 多目录项目需要 2 到 8 个项目。 |
| `multi-dir-member-unknown` / `-duplicate` / `-not-single` / `-nested` | refusal | {{id}} is not a registered single project / is listed twice / is itself a multi-directory project / is inside {{other}} (or the same directory). | {{id}} 不是已登记的单一项目／重复列出／本身是多目录项目／位于 {{other}} 之内（或是同一目录）。 |
| `folder-change-dir-mismatch` | refusal | Name which folder of this group you are answering for (or none, for a single-folder group). | 请指明你在答复这个任务组的哪个文件夹（单文件夹任务组则不要指明）。 |

Buttons: "Retry the rest" / 「重试剩余目录」 and "Mark resolved" / 「标记为已处理」. The form is titled "Group several
projects" / 「组合多个项目」, and the order hint reads "The first is the primary: it keeps the group's decisions." /
「第一个是主目录：任务组的决策记录在这里。」

---

## 14. Schema

There is **no control schema step** (writer's call). `multiDir`, `landing`, `drive.dirs` and `landingPlan` are group or
run body JSON (`src/control/queries.ts:28-32`), as DIR §5.1 kept `dirWorkspace`. The control schema stays `"18"`
(`migrations.ts:4`). If a builder finds that an index or column is needed, it takes the **next free number** at that
time. The two sibling specs of this round may take 19 and 20, so the number is measured then, not assumed. The projects
file stays `version: 1`, because the key is additive and optional.

## 15. Out-of-repo writes (Orca Rule 17 registration)

| Path (env redirect) | Writer / trigger | Modes | Failure residue |
|---|---|---|---|
| `ORCA_PROJECTS_FILE` (default `~/.orca/projects.json`) | `POST` / `PATCH /api/projects` with `dirs` | as today (`projectsFile.ts:126-145`) | atomic rename; a refused write leaves the file as it was |
| each `repo` member's repository (the same for each `dir` member's vault) | export (`orca/<g>` at HEAD); D (`orca/<g>` CAS; `refs/orca/incoming/<runId>` (`workspace.ts:45`) fetched into **each** written dir target and deleted by that target's cleanup (§5.4); a landing worktree registered in **each** dir target, `landing-<runId>` for the ccloop primary and `landing-<runId>.dir-<key>` for each extra repo, `workspace.ts:39`); pre-check (`computeNew` objects; `refs/orca/integration/<g>/target` for push-target, `integrationPass.ts:77`); §9.5 publish (target branch / remote) | git's own | unreferenced objects only, before a ref moves; a stop leaves a `partial` record |
| `$ORCA_VAULT_DIR/<vaultId>.git` of each `dir` member | DIR §14 writers, per folder | DIR §14 | DIR §14 |
| each `dir` member's folder | §9.5 `place` only (DIR §8) | DIR §14 | DIR §14 |
| `<workspacesRoot>/<runId>.dir-<key>`, `landing-<runId>.dir-<key>`, `integration-check-…` (`runIntegrationCheck`'s worktree) | A2; D; pre-check | as today's workspaces | removed by cleanup; a crash leaves a path the next run removes (`removeOwnPath`) |
| ccloop: `refs/ccloop/…` and worktree metadata in every extra repo; `<runDir>/dirs/attempt-<n>/<key>`; `<sourceDir>/repos/<key>` | ccloop (§11.8) | §11.8 | as today's single repo |

Criteria set `HOME`, `ORCA_PROJECTS_FILE`, `ORCA_CONTROL_DIR` and `ORCA_VAULT_DIR` to separate temporary directories and
assert that nothing appears under `HOME` (§16 M14).

---

## 16. Success criteria (Rule 4: exit codes; Rule 9: each named mutation seen red)

Mutations run only in a `git clone --local` copy of the repository under the session scratchpad. Restoration is proven
by the byte counts of `git diff` and `git diff --cached` (Orca Rule 15, ccloop Rule 17). Every criterion uses fake
agents only, with no paid run.

### 16.1 ccloop — `./node_modules/.bin/vitest run --reporter=json --outputFile=$S/vitest.json > $S/vitest.log 2>&1; echo $?` then `node scripts/check-known-reds.mjs $S/vitest.json; echo $?` (RC 0); `npm run typecheck`, `npm run build` (each to a file, read back whole; the `RUN` line names the tree under test)

| # | Criterion (new test file) | Mutations that must turn it red |
|---|---|---|
| C1 | absent ⇒ identical (`tests/contract/multiRepoAbsent.test.ts`): the toolRules golden contract parses to the golden bytes and `context` has no `repoKey`/`additionalRepos`; a protocol-4 envelope without `work.additionalRepos` has today's canonical hash | default `additionalRepos: []`; default `repoKey` |
| C2 | schema (`tests/contract/multiRepoSchema.test.ts`, `tests/control/multiRepoEnvelope.test.ts`): duplicate key, key = `repoKey`, `repoKey` without extra repos, 8 extra repos, work/contract key order mismatch, relative `targetRepo`, nested or equal repositories are each refused `control-request-invalid`; a valid one is accepted | drop the key-order refine; accept nested repos |
| C3 | worktrees and refs (`tests/workspace/multiRepoWorktrees.test.ts`): attempt n creates one worktree per extra repo at `<runDir>/dirs/attempt-<n>/<key>` from **that** repo's HEAD, and `<runDir>/worktrees/` holds only the primary's (review 7); after the run, neither `<runDir>/dirs/attempt-<n>` nor `<runDir>/dirs` exists (round 2, N4); after cleanup each repo holds `refs/ccloop/<run>/attempts/<n>` and the namespaced ref at a commit holding exactly that worktree's change; `commits.json` lists all; no worktree is left | create extra worktrees from the primary repo; skip the extra publish before cleanup; place extra worktrees under `worktrees/` (red: the `worktrees/` listing holds more than the primary); leave the empty `dirs/attempt-<n>` (red) |
| C4 | per-repo policy (`tests/controller/multiRepoPathPolicy.test.ts`, fake agent): a write outside an extra repo's allowlist ends `blocked_waiting_human` with `allowlist miss: <key>:<path>` even when the executor's `changedFiles` omits it; a total over `maxFilesTouched` across repos is refused; a single-repo contract still judges the executor's `changedFiles`; a fake agent that **commits** its extra-repo change (clean status, moved HEAD) ends `extra-repo-head-moved: <key>`, and one that stages without committing is still judged (review 6) | judge extra repos with the primary's allowlist; use `changedFiles` for extra repos; count only the primary toward the max; **observe extra repos with `git status` only** (red: the committed change slips past); drop the HEAD check |
| C5 | check cwd (`tests/controller/multiRepoChecks.test.ts`): a check `test -f marker` that passes only in the extra worktree passes there and fails if run in the primary; the failing extra check is reported `[<key>] <cmd>`; primary evidence bytes equal today's | run extra checks with the primary cwd; drop the label |
| C6 | argv (`tests/runtime/multiRepoArgv.test.ts`): claude gets `--add-dir <extras…>` before `--model` on plan, execute and verify; codex gets `--add-dir <wi>` on execute only; omp gets `--add-dir=<wi>` on every phase; a single-repo contract's argv equals the existing goldens | omit codex `--add-dir` on execute; place claude's list after the prompt; pass `--add-dir` without extra repos |
| C7 | prompts (`tests/runtime/multiRepoPrompts.test.ts`): the Directories section appears in the planner, executor and verifier prompts with every key, path and allowed path; single-repo prompts equal the existing goldens | always emit the section; leave an extra repo out of the verifier prompt |
| C8 | results and collect (`tests/control/multiRepoCollect.test.ts`): `<sourceDir>/repos/<key>` holds that repo's attempt tree; collect has `dirs` in contract order with the observed `changedPaths`; a single-repo collect has no `dirs` key | materialize extra repos from the primary; emit `dirs: []` for single repos |
| C9 | read-only phases (`tests/runtime/omp/multiRepoSnapshot.test.ts`): a plan-phase write in an extra worktree is detected | snapshot the primary only |
| C10 | crash resume and fresh run (`tests/controller/multiRepoResume.test.ts`): residual `<runDir>/dirs/attempt-*/<key>` worktrees are published and removed on resume; `ensureFreshRunDir` refuses a non-empty `dirs/` with the `(dirs)` message; the existing `cleanupResidualWorktrees` and `worktrees/` guard are unchanged (review 7) | clean the primary only; drop the `dirs/` guard |
| C11 | refusals (`tests/control/multiRepoRefusals.test.ts`): a non-null `inputCheckpoint`, the verify-saved-result mode and both eligibility methods answer the two `control-multi-repo-*` codes | accept a continuation |
| C13 | omp with an extra repo (`tests/runtime/omp/multiRepoChangedFiles.test.ts`, review 1): a fake omp that changes one primary file and one extra-repo file and reports `changedFiles: [<primary path>]` passes today's `omp-changed-files-mismatch` check and the run succeeds; the extra-repo change appears in collect's `dirs` | **keyed `changedFiles` with today's omp check**: the executor prompt asks for `<key>:<path>` entries, so the fake reports them (red: `omp-changed-files-mismatch`) |
| C12 | nothing existing changed: `git diff --name-status main...HEAD -- tests > $S/tests-diff.txt` read whole, every line `A`; the full suite and `check-known-reds` RC 0 | (structural: a modified test file fails it) |

### 16.2 Orca — `npm test` (Rule 18; it selects by change and prints what it selected and skipped, and that report is copied into the report, never read as green), and each file alone with `npx vitest run <file>`

| # | Criterion (new test file) | Mutations that must turn it red |
|---|---|---|
| M1 | projects file (`tests/panel/projectsFileMulti.test.ts`): a file without the key re-saves byte-equal; with it, it validates; id/name clash across lists, fewer than 2 or more than 8 members are each invalid by name; an unknown, multi or nested member makes **only that entry** skipped at load and named in `fileError`, while every other project and multi-dir project loads (review 11) | default `multiDirProjects: []`; skip the nesting check; check member existence in the schema (red: the whole file is invalid) |
| M2 | registry API (`tests/panel/projectsMultiApi.test.ts`): `POST` with `dirs` creates it; `path` + `dirs` and neither are `400`; `PATCH {dirs}` replaces the order; `GET` rows as §4.2; single rows unchanged | accept both `path` and `dirs`; drop `path` from the multi row |
| M3 | control config (`tests/control/multiDirConfig.test.ts`): `knownRepository(multi)` is true; `resolveRepository(multi)` throws `multi-dir-no-single-path`; the four setting verbs refuse `multi-dir-project-setting-unsupported` | resolve the multi id to the primary's path |
| M4 | open (`tests/control/multiDirOpen.test.ts`): the body has `multiDir.dirs` in registered order with realpaths and `dirWorkspace` for `dir` members; a later `PATCH` does not change it; no vault exists after open | read the order from the registry at dispatch |
| M5 | overview and prompts (`tests/control/multiDirOverview.test.ts`): `orca-project-overview-v1` with one entry per member (a folder member from its import commit; a git member's `.git` byte-equal for a `dir` member); `commits` per key; the clarify and split prompts of a single-repo group are byte-equal to today's | use `CLARIFY_INSTRUCTION_V3` for a multi group; skip the limit division |
| M6 | split and write sets (`tests/control/multiDirSplit.test.ts`): `writes` paths checked per directory (`path:<t>:<key>:<p>`, `dir:<t>:<key>`, `checks-primary:<t>`, `ledger-path:<t>:<key>`); two tasks with `**` in different directories are in one layer; the same path in the same directory gets an implicit edge; the expanded contract has `repoKey` and `additionalRepos` in registered order; **a single-directory task on a non-primary member** gets a contract with no `repoKey`, and its write set is still keyed by that member, so it conflicts with another task's same path in that member and not with the same path in the primary (review 2) | unqualified write sets for multi groups; primary = first `writes` entry instead of first in registered order; **key write sets from `context.repoKey`** (red: the single-directory task's claims are unkeyed or keyed wrong) |
| M7 | dispatch (`tests/control/multiDirDispatch.test.ts`): only written directories get workspaces; the envelope's `additionalRepos` keys and bases match `drive.dirs`; a single-directory group's envelope is byte-equal to today's | give every member a workspace; mismatch the base of one directory; **nested path, existing guard**: place the extra workspace at `<runId>.dirs/<key>` (red: `assertOwnPath` refuses it) |
| M8 | collect (`tests/control/multiDirCollect.test.ts`, pinned ccloop, fake agent): per-directory `attemptSha`; out-of-bounds in an extra repo blocks `out-of-bounds:<key>:…`; the criteria base re-run is not started and the flag says `base-run-skipped: multi-dir` | harvest the extra repo with the primary's claims |
| M9 | run landing (`tests/control/multiDirLandingD.test.ts`): a 2-directory run lands both work branches; the ledger only on the primary; a crash hook after the first CAS, then a new round, lands the second without re-merging the first (refs listed); a conflict in the second swaps nothing and blocks `multi-dir-landing-conflict` | swap before all are produced; write the ledger into each directory |
| M10 | multi landing (`tests/control/multiDirLanding.test.ts`): a complete group with a `local` repo, a `push-target` repo (bare remote) and a folder member lands all three in registered order; with directory 3's target dirty the pre-check blocks and **nothing** moved (every target ref and folder hash listed before and after); a person's edit to a folder path **no landing writes** does not stop the pre-check, while an edit to a landing path stops it `folder-changed` before anything lands, and `withhold` of that path lets the next pre-check pass (review 4) | land as each directory passes pre-check; skip the dirty check in pre-check; pre-check folders with `folderDrift` (red: the unrelated edit stops) |
| M17 | due and never-written directories (`tests/control/multiDirDue.test.ts`, review 3): after accept, `lastLanded[key]` equals each directory's export base; a group whose tasks wrote only directory 1 carries only directory 1, and the other directories' targets are untouched (refs listed); a `keep` directory with new work never makes the group due; **a due group whose only carried directory is already in its target (or whose folder change is empty) ends `landed` with `lastLanded[key] = tip` and no publish, and is not due on the next round** (round 2, N3) | leave `lastLanded` empty at accept (red: a never-written directory is carried or blocks); count `keep` directories as due; skip recording `lastLanded` for directories with nothing to carry (red: the group is due every round) |
| M11 | partial and verbs (`tests/control/multiDirPartial.test.ts`): a `beforePublish` seam moves directory 2's target after directory 1 landed ⇒ state `partial`, directory 1 not reverted, needs-you `multi-dir-partially-landed` listing it; `retry-rest` pre-checks and lands only directory 2 onward; `mark-resolved` records `unlanded` with `by`; a moved target before anything landed retries once, then blocks `multi-dir-target-moved` | revert landed directories on failure; let `retry-rest` re-carry directory 1; retry forever on moved |
| M12 | journal (`tests/control/multiDirLandingJournal.test.ts`): crash at `after-journal`, `after-publish:<k>`, `after-record:<k>` each ends `landed` with every target at `next` exactly once (no second merge commit) | record before publish; redo the pre-check in replay |
| M13 | pre-check checks (`tests/control/multiDirPrecheckChecks.test.ts`, review 8): with a member's `integration-check` disabled, no command runs for it; enabled, its command (or the union of its tasks' checks when the command is null) runs through `runIntegrationCheck` at `next` with `ORCA_PERSON_DIR` the dispatched-person directory, and a failure blocks with the command; today's integration-check caller passes no `rev` and its existing tests pass unchanged | run checks for a disabled member; run them at the target head instead of `next`; drop `dispatchedEnv` |
| M18 | folder stop then automatic pre-check (`tests/control/multiDirFolderResolve.test.ts`, review 10): in `folder-changed`, `multi-dir-landing` is accepted (not `multi-dir-landing-not-pending`); after `resolve-folder-change {dir, recheck}` the next round pre-checks again and lands with no further command | refuse the verb in `folder-changed`; require `retry-rest` after the resolution |
| M19 | `groupRepoId` sites (`tests/control/multiDirSites.test.ts`, review 9): `groupRepoId` throws `multi-dir-group-no-single-repo` for a multi group; cleanup after settle removes every extra workspace and deletes `refs/orca/incoming/<runId>` in **every** written dir target; the decisions route reads the primary | fall back to the primary in `groupRepoId`; clean only the primary target; **nested path, existing guard**: name the extra landing worktree `landing-<runId>.dirs/<key>` (red: `assertOwnPath` refuses it); call `removeSkillsSnapshot` in the extra cleanup (red: the primary's snapshot is removed twice or the extra cleanup fails); a multi repo id reaching `checksPass` (red: `multi-dir-no-single-path` is logged per round) |
| M14 | Rule 17 and access (`tests/control/multiDirAccess.test.ts`): §12 table rows; `VERB_ACCESS` for `multi-dir-landing` is `human-only`; with `HOME` and every `ORCA_*` redirect on temp directories, nothing appears under `HOME`; `flow-start` with a multi project refuses `flow-project-multi-dir-unsupported`; `import-plan` refuses by name | make the verb `any`; check `flow-dir-unregistered` first |
| M15 | single-directory unchanged: the existing `tests/panel/projectsFileKind.test.ts`, `tests/panel/projectRegistry.test.ts`, `tests/control/requirementOverview.test.ts`, `requirementE2E.test.ts`, `driverLanding.test.ts`, `tests/control/integration*.test.ts` and the DIR spec's D-criteria pass with no edit | route single groups through the multi pass |
| M16 | copy (`web/tests/multiDirCopy.test.tsx`): every §13 code has en and zh; the group's integration region shows per-directory states and both buttons in both locales | drop one zh key |

---

## 17. Amendments to published specs (they stay as written; Rule 13)

- **F §5.1** — a `dir` project may also be a member of a multi-dir project. Flows still run on one folder and refuse
  a multi-dir project (`flow-project-multi-dir-unsupported`).
- **Integration spec** — a multi group never has an integration record, and its delivery is the multi landing (§9). The
  member's repository default is read once, at accept.
- **F §20** gains the rows of §15.
- **DIR (published as `533475e1`).** Its text is not edited. These amendments are listed here for a later correction
  section of DIR to record:
  1. §4.1's single `dirWorkspace` becomes, for a multi group, the `multiDir.dirs` list (§5.3). The single-object
     reader stays.
  2. §8.5's pass skips multi groups. Their folders run §8.5 steps 1–6 in the multi pre-check and steps 6–8 in the
     ordered landing (§9.4, §9.8).
  3. §8.2's `placement` record lives at `multiDir.landing.placement[<key>]` for a multi group.
  4. §9.2's `resolve-folder-change` gains a `dir: <key>` field (required for a multi group, refused otherwise:
     `folder-change-dir-mismatch`), keeping all three actions `take-folder`, `recheck` and `withhold`.
  5. §12's table gains the `folder-change-dir-mismatch` refusal.
- **Checks spec (`2026-10-22-checks-and-triggers-design.md`)** — `runIntegrationCheck` gains an optional `rev`; its
  existing caller passes none (§9.4).
---

## 18. Build order

ccloop goes first, then Orca repins it. The landing order is: ccloop lands and **the human pushes it**; then Orca pins
the pushed commit.

**ccloop** (each package ends with the §16.1 gate green, read back whole):
- **K1** contract + envelope schema + accept path checks (C1, C2).
- **K2** worktrees under `<runDir>/dirs/`, attempt refs, publish/cleanup, crash resume and the fresh-run guard (C3, C10).
- **K3** per-repository observation (start sha, HEAD check, diff plus untracked) and path policy (C4, C9, C13).
- **K4** required checks per repository (C5).
- **K5** agent argv and prompts (C6, C7).
- **K6** result repositories and collect (C8).
- **K7** refusals (C11), then C12, then merge `--ff-only` into ccloop `main`. **The human pushes.**
- Coordinate with the in-flight live-transcript ccloop work (ccloop handoff, Orca section of session `0e13a9b7`),
  which changes stdout handling in the same adapters. Rebase onto it if it lands first.

**Orca** (each package ends green on `npm test`). The DIR spec's packages 1-5 are prerequisites for every folder-member
path.
- **O1** Repin ccloop to the pushed commit (`package.json:40`, lock); `npm test`.
- **O2** Projects file, registry, API and Web form (M1, M2).
- **O3** Control config and open (M3, M4).
- **O4** Overview, prompts, split and qualified write sets (M5, M6).
- **O5** Dispatch and collect (M7, M8).
- **O6** Run landing D and the ledger (M9).
- **O7** Multi landing: due rule, pre-check with DIR §8.5 classification and `runIntegrationCheck`, ordered landing, journal, partial, verbs, folder integration (M10–M13, M17, M18).
- **O8** `groupRepoId` sites, refusals, access, copy and protocol (`groupSummarySchema` gains a `multiDir` summary) (M14, M16, M19), then M15.
- **O9** Acceptance in a sandbox with real agents is a **separate, human-approved paid run**, not part of `npm test`.
  One requirement on a repo + repo + folder project with claude, then codex, then omp. It observes that each agent can
  write in an `--add-dir` directory (§3.3, §20 O7), plus one forced `partial`, answered by `retry-rest`.
  Reading outside the mount needs no acceptance step: the reviewer measured it in this session (§6.1).

---

## 19. Decisions made by the writer (for the human)

### 19.1 Orca side (writer's calls; Orca Rule 1 step 2, all reversible: code and JSON bodies, no schema step)

- **W1** A multi-dir project **composes registered projects** in a separate `multiDirProjects` list. The primary is the
  first member, and members keep their own settings. Alternative: a new `kind` holding its own paths.
- **W2** (reworded, review 5) A task gets a worktree, a write grant and a ccloop-judged diff **only for the directories
  it writes**. ccloop's primary is the first written directory in registered order. This is **not** isolation: every
  agent can read absolute paths outside its mount (measured by the reviewer in this session), so the other members are
  merely not granted, not hidden (§20 O1).
- **W3** Edits to a multi-dir project apply to groups opened later; open groups keep the list they froze.
- **W4** Continuation, token-allowance resume, saved-result recovery and the criteria base re-run are **off** for multi
  runs in v1.
- **W5** A run-landing conflict in any directory is **not** reconciled by an agent in v1. The task is retried.
- **W6** Delivery per directory is the member's repository default, frozen at accept, limited to keep, local or
  push-target. The trigger is always "whole group done". `set-group-integration` is refused.
- **W7** (replaced, review 8) Pre-check checks are **opt-in per member** through that member's `integration-check`
  setting. They run through `runIntegrationCheck` at `next`, with the setting's command or else the tasks' checks for
  that directory.
- **W8** The ledger is **only in the primary** directory.
- **W9** Flows, plan import and debug groups refuse multi-dir projects.
- **W10** Registration follows today's add route: owner **and member** on the Web, not on the socket.
- **W11** Overview count limits are divided across members.
- **W12** No control schema step.
- **W13** (revised, review 4) A folder stop is a DIR §8.3 classification of a landing path as `changed` or `unwritable`,
  never plain drift. Found in pre-check, it stops **before** anything lands; during the sequence it becomes `partial`.
  The person may also answer `withhold`.
- **W14** One `moved` before anything lands retries once; a second blocks.
- **W15** `multi-dir-landing` is human-only for both actions.

### 19.2 ccloop side (proposals P1–P7: accepted by the controller under the human's standing instruction 「如果有问题，先按你的建议执行」, flagged for the human's review)

ccloop's Rule 1 says ask. The controller relayed the human's standing instruction for this round and accepted P1–P7 as
proposed. P2 was refined by review findings 1 and 6, and P3 was replaced by review finding 7, as shown below. This is
the controller's application of a standing instruction, **not** a ruling announced on the human's behalf (ccloop
Rule 18). The human should review each proposal before the ccloop plan merges.

- **P1** There is no `features` key. The field's presence plus `.strict()` is the version marker. A feature key would
  need a named ruling on `protocol4.test.ts:13` and `savedResultEvidence.test.ts:110`.
- **P2** (refined, reviews 1 and 6) The primary is judged as today, from the executor's `changedFiles`, which stays
  primary-relative, with omp's existing checks. Each extra repo is judged only from ccloop's own observation: HEAD
  unchanged since the start sha, then the diff from the start sha plus untracked paths.
- **P3** (replaced, review 7) Extra worktrees live at `<runDir>/dirs/attempt-<n>/<key>`, outside `worktrees/`. Attempt
  refs in each extra repo use the primary's ref names.
- **P4** Extra repos' checks run after the primary's, each in its own worktree, labelled `[<key>]`.
- **P5** Argument placement: claude `--add-dir` on every phase; codex `--add-dir` on execute only; omp `--add-dir=` on
  every phase.
- **P6** Continuation and saved-result recovery are refused for multi-repo envelopes by the two new codes.
- **P7** The cap is 7 extra repos, so 8 directories in all, which matches Orca's member cap.

---

## 20. Open items

- **O1** (direction set, review 5) Members a task reads but does not write are listed in the prompt as **read-only
  paths**. Still open:
  - which path to list: the member's live directory, or an Orca worktree at the group's base;
  - how a write there is detected (no ccloop worktree watches it, and `[]` means "anything" to `pathPolicy.ts:30`).
- **O2** Agent reconciliation of a multi run's landing conflict, and of a pre-check conflict (integration §7's
  resolution works on one repository).
- **O3** Continuation and saved-result recovery across repositories, which needs per-repository bundles in
  `materializeFirstWorkspace`.
- **O4** The criteria base re-run for multi runs.
- **O5** `push-branch` / `github-pr` for multi groups: N pull requests that must merge together.
- **O6** Whether the divided overview limits are enough for 8 large repositories (measure in O9).
- **O7** (partly answered, review 5)
  - **Answered:** codex's `read-only` sandbox can read outside `-C`, and all three agents read absolute paths outside
    their mount. The reviewer measured both in this session.
  - **Still open:** whether claude's `acceptEdits` allows edits in `--add-dir` directories, and whether omp's
    `--add-dir` widens its edit tool. Observe both in O9 before release.
- **O8** Corrections and ccmem are keyed by one repository's remote (`src/corrections/projectKey.ts:61-81`). A multi
  group's decisions are keyed by the primary only.
- **O9** Env variables naming the other worktrees for checks that need two directories at once (for example
  `CCLOOP_DIR_<key>`): not specified (Rule 2).
- **O10** The sibling scheduled-flows spec must refuse a multi-dir project in its project resolver by name.

---

## 21. Review rounds: finding → where it is answered

### 21.1 Review round 1

Independent review of this spec, relayed by the controller on 2026-10-24 (session `ffec7b28`). Every finding was
accepted. "⇒" marks where the controller chose the answer. This section was written by the same writer, in place,
uncommitted.

| # | Finding (short) | Answer | Criteria |
|---|---|---|---|
| 1 | omp checks `changedFiles` against `git status` of the primary, so keyed `<key>:<path>` entries break it | ⇒ `changedFiles` stays primary-relative; extra-repo changes come only from ccloop's per-worktree observation; the executor prompt says so (§11.3, §11.5, P2) | C13 (mutation: keyed `changedFiles` with today's omp check) |
| 2 | Write-set keys taken from `context.repoKey` miss single-directory tasks on a non-primary member | ⇒ keys come from Orca's own task `writes` record; a one-directory task has an ordinary contract (§6.1, §6.2) | M6 (new case and mutation) |
| 3 | A directory no task wrote would be carried or judged | `lastLanded[key]` = export base for every directory at export; "due" counts only carried directories (§6.4, §9.1) | M17 |
| 4 | Folder pre-check used `folderDrift` (DIR's superseded rule) and cited DIR §8.2 | pre-check runs DIR §8.5 steps 1–6 (classify `placed → F′`); it stops only on `changed` or `unwritable`; `withhold` is supported; citations moved to §8.3, §8.5 and §8.6; DIR amendments listed in §17, not edited | M10 (new case and mutation) |
| 5 | W2 claimed isolation; O7 and O1 unanswered | W2 reworded (no isolation; reading outside the mount was measured by the reviewer); O7 answered for codex's read-only sandbox; O1's direction is read-only paths listed in the prompt (§6.1, §19 W2, §20) | none (wording) |
| 6 | An agent that commits in an extra worktree slips past a `git status` check | start sha per extra worktree; HEAD moved ⇒ `extra-repo-head-moved: <key>`; changed paths = diff from the start sha plus untracked (§11.2, §11.3) | C4 (new case and mutation) |
| 7 | Extra worktrees under `worktrees/` touch `resumeLoop`, `attemptRefName` and the `fileStore` guard | ⇒ `<runDir>/dirs/attempt-<n>/<key>`; new additive guard and resume cleanup beside the old ones (§11.2, §11.6, §11.8, §11.9, P3) | C3, C10 (new cases and mutations) |
| 8 | Pre-check checks reinvented a runner | reuse `runIntegrationCheck` (`dispatchedEnv`, `personDir`) with an optional `rev`; opt-in per member's `integration-check` setting; W7 replaced (§9.4) | M13 (rewritten as a new criterion) |
| 9 | `groupRepoId` answering the primary acts on one directory silently; the site table was incomplete | `groupRepoId` throws for a multi group; `multiPrimaryRepoId` at the named sites; complete site table; cleanup of extra workspaces and incoming refs in every dir target; per-directory landing paths (§5.3, §5.4, §15) | M19 |
| 10 | `folder-changed` could not take `multi-dir-landing`; resolution needed a second command | the verb is accepted in `folder-changed` and `folder-unwritable`; after `resolve-folder-change` the next round pre-checks again by itself (§9.7) | M18 |
| 11 | An unknown member made the whole projects file invalid | ⇒ the schema checks shape only; the loader skips and reports only that entry; an older Orca refuses a file with the key (noted) (§4.1) | M1 (new case and mutation) |
| minor | anchors | re-measured; fixed `:266` (now `requirementOverview.ts:266`), `driverLanding.ts:333-640` (now `:324-640`), and `projectRegistry.ts:151-164` (now `:152-164`); the old `criteriaProtection.ts:130-134` citation is gone with finding 8 | — |
| minor | heading wording | §11's heading reworded | — |
| minor | `computeNew` needs a `GroupIntegration` | per-directory stand-in built from `lastLanded[key]` (§9.4) | M10, M11 |
| minor | Orca's strict loop-work schema | `src/control/schema.ts:62` gains `additionalRepos` (§7.1) | M7 |
| minor | codex `--add-dir` under a read-only sandbox | grants nothing; stated (§11.5) | C6 |
| minor | push-target members are not local deliveries | `prerequisiteDone` waits only on `local` and `place` directories; multi groups are never a stack base (§9.9) | M17 |
| minor | §15 rows | incoming refs and landing worktrees per member repository added | M14 |

P1–P7 were accepted under the standing instruction recorded in the header and §19.2. They are flagged for the human's
review.

### 21.2 Review round 2 (relayed by the controller on 2026-10-24, session `ffec7b28`): 10 of 11 round-1 findings closed; new findings

| # | Finding (short) | Answer | Criteria |
|---|---|---|---|
| N1 | Nested leaves (`<runId>.dirs/<key>`, `landing-<runId>.dirs/<key>`) break `assertOwnPath` (parent must be the workspaces root, `workspace.ts:48-52`) and `cleanupRunWorkspace`'s basename rule | ⇒ flat leaves `<runId>.dir-<key>` and `landing-<runId>.dir-<key>` directly under the workspaces root, so `assertOwnPath`, `removeOwnPath` and `ensureWorkspace` hold unchanged. `cleanupRunWorkspace` itself is **unchanged**. Extra repos get a new `cleanupExtraWorkspace` with its own basename rule (`<runId>.dir-<key>`) and no `removeSkillsSnapshot` (§5.4, §7.1, §15) | M7, M19 (mutation "nested path, existing guard") |
| N2 | `checksPass` resolves every group's `plan.repoId`, and a multi id would throw there each round | multi repo ids are skipped by name when `checksPass` (`webService.ts:1077-1083`) builds its list; listed in §5.4 "other places" | M19 |
| N3 | A due group with nothing to carry never left "due" | the pre-check sets `lastLanded[key] = tip` for every directory with nothing to carry; an empty plan ends as `landed` with no publish (§9.4) | M17 (new case and mutation) |
| N4 | ccloop left empty `dirs/attempt-<n>` behind | normal cleanup removes the empty `<runDir>/dirs/attempt-<n>`, then `<runDir>/dirs` once it is empty (§11.2) | C3 (new case and mutation) |
