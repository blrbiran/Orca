# Multi-directory projects (H7) — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the
> named reason, then the code, then green. One commit per task (more when a task is large). Conventional-commit
> messages in English, no `Co-Authored-By` trailer (the repository's current style, measured 2026-10-25).

- **Spec:** `docs/superpowers/specs/2026-10-24-multi-dir-projects-design.md` ("§n", criteria "Mn"). §21.2 (review
  round 2) takes precedence where it refines earlier text. Human ruling H7; the ccloop half (K1–K7) is already on
  ccloop `main` (`c205d55`, pushed) and consumed here as a pinned dependency.
- **Build order:** spec §18's O1–O8. **O9** (paid acceptance with real agents) is **not** part of this plan: it is a
  separate human-approved run. `codex` may be used when the person approves it; `claude` has no quota as of
  2026-10-25.
- **Base:** branch `feat/multi-dir` from `main` `f726d832` (control schema `"20"`), worktree
  `/private/tmp/orca-ffec7b28/multidir`. `node_modules` is **not** symlinked from the main repo after O1: the pin
  changes, so this worktree gets its own `npm ci`.
- **Author / attribution:** implementer subagents of session `ffec7b28`, 2026-10-25 (Rule 13).
- **Rules.** Rule 9 (each new criterion: a **named** mutation seen red in a `git clone --local` copy at
  `/private/tmp/orca-ffec7b28/h7-mut`, append-only log `/private/tmp/orca-ffec7b28/h7-mutations.log`, restore proven by
  `git diff | wc -c` and `git diff --cached | wc -c` both `0`); Rule 14 (logs to files, read back whole); Rule 17
  (every criterion: temp `HOME`, `ORCA_PROJECTS_FILE`, `ORCA_CONTROL_DIR`, `ORCA_VAULT_DIR`; nothing under `~/.orca`);
  Rule 18 (`npm test`, whose selection report is copied into the report and never read as green).
- **Gate environment.** Every manual gate run sets
  `ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-c205d55/dist/cli.js` and
  `CCLOOP_CACHE_DIR=/private/tmp/orca-ffec7b28/ccloop-cache-h7`; never `~/.orca` and never `~/.cache/ccloop`. Every
  `node`/`npm`/`git` command runs with `PATH=/usr/local/bin:$PATH` (the homebrew node on the default path crashes).
- **Safety boundary (gaps spec §21):** releasing a held external effect stays human-authorized. Anything touching
  marks, holds or recovery paths runs `tests/flow/heldEffectChains.test.ts` first. No paid run in this plan.
- **Mutation discipline.** Mutations are made in the clone after `npm run build`; uncommitted files are copied in with
  `cat`; every mutation is rerun after code changes. A mutation is "seen red" only when the named criterion fails for
  that reason.

## Corrections to the spec's text, measured (Rule 13: the spec is not edited)

| Spec says | Measured on `f726d832` | Meaning kept |
|---|---|---|
| §14 "the control schema stays `18`" | `src/control/migrations.ts:5` is `"20"` (dir took 19, scheduled took 20) | **no schema step**; it stays `"20"` |
| §3.1 `src/control/writeSet.ts:63-68` | the file is `src/scheduler/writeSet.ts:63` | same function |
| §5.3 `groupRepoId` at `executionDriver.ts:217-224` | moved to `src/control/dirGroup.ts:47`, re-exported by `executionDriver.ts:226` | same function |
| §5.4 `driverLanding.ts:123/280/561` | E `:122`, D `:276`, R `:566`; `landOnTip` `:254`; `markLanded` `:57` | same steps |
| §5.4 `executionDriver.ts:1008/:1029` | cleanup sites `:1019` and `:1040`; saved-result A2 `:1362` | same sites |
| §9.1 "right after `integratePendingGroups` (`executionDriver.ts:1242`)" | `integratePendingGroups` `:1253`; `placeDirGroups` `:1256-1257` | insert `landMultiDirGroups` after `:1257` |
| §9.4 `runIntegrationCheck` `integrationCheck.ts:70-92` | `:70`, 7 positional args (`repo, roots, repoId, target, commands, at, personDir`) | add an optional 8th `rev` |
| §4.3 `knownRepository` `controlAssembly.ts:247-249` | `:260-262` | same function |
| §5.1 `flowCommands.ts:43-48` | `registeredDirProject` `:44`; the multi check goes before it in the flow start path | same ordering |
| §12 `webProtocol.ts:849-854` | delivery enum now elsewhere; `folderChangeActionSchema`/`resolveFolderChangePayloadSchema` `:948-950`; `commandVerbSchema` `:608-694` | same schemas |
| §7.1 `src/control/schema.ts:62` | `loopWorkSchema` `:66` | same schema |
| §7.2 collect schemas `ccloopPort.ts:45-46` | `collectionSchema` `:47`, `collectionV4Schema` `:48` | same parsers |
| §4.2 `GET /api/projects` rows | `projects.ts:34-36` `row()` | same builder |
| §11.1 ccloop pin `package.json:40` | `package.json:41` at `f726d832`; pinned `f4de340b…` | O1 repins to `c205d550…` |

Re-measure every anchor a task cites before editing it.

## Builder's decisions (not in the spec, all reversible)

| Item | Decision |
|---|---|
| multi registry runtime hook | `RegistryControl` gains `addMulti(entry)` and `setMultiDirs(repoId, dirs)`; `assembleControlRuntime` keeps a mutable `Map<repoId, { dirs }>` that `multiDirProjectOf`, `knownRepository` and `resolveRepository` read. The registry calls the hooks at boot and on every applied edit, exactly as it calls `add`/`rename` for single projects. |
| module names | `src/control/multiGroup.ts` (body readers: `multiDirOf`, `isMultiGroup`, `dirTargetRepoId`, `multiPrimaryRepoId`, `multiLandingOf`), `src/control/multiLanding.ts` (pass, pre-check, ordered landing, journal), `src/control/multiDelivery.ts` (delivery rows + accept freeze) |
| qualified claims | `buildGraph` gains an optional `claims?: Map<string, ClaimedPath[]>`; a multi group passes `qualifiedWriteSetOf(writes)`. Without it the call is byte-identical to today. |
| extra workspace leaves | `<workspacesRoot>/<runId>.dir-<key>`; extra landing leaves `landing-<runId>.dir-<key>` (flat, per N1) |
| `multi-dir-landing` acceptance | `partial`, `blocked`, `folder-changed`, `folder-unwritable`; refused `multi-dir-landing-not-pending` otherwise |
| landing record location | `multiDir.landing` inside the group body (no schema step); placement records at `multiDir.landing.placement[<key>]` |
| checks at pre-check | member's `integration-check` setting is the switch; command when set, else the de-duplicated union of done tasks' checks for that directory; `runIntegrationCheck(..., next)` |

---

## Task O1 — repin ccloop (§18 O1)

Files: `package.json`, `package-lock.json`; nothing installed in the repo tree beyond `node_modules` (ignored).

- [ ] Verify the remote is the pushed multi-repo main: `git -C /Users/biran/code/skills/orca/ccloop ls-remote origin
  refs/heads/main` answers `c205d550ed076a8a3cf1609bc6bcd09894fded6b`. If it moved, stop and report — do not pin a
  different commit on a guess.
- [ ] `package.json` `"ccloop": "github:blrbiran/ccloop#c205d550ed076a8a3cf1609bc6bcd09894fded6b"`; run `npm install
  --package-lock-only` (or `npm install`) and confirm `package-lock.json`'s `node_modules/ccloop` resolved URL carries
  the same sha. No other dependency changes.
- [ ] `npm ci` in the worktree (fresh `node_modules`, no symlink). Confirm `node_modules/ccloop/src/contract/schema.ts`
  has `additionalRepos` and `node_modules/ccloop/dist/cli.js` exists.
- [ ] Build the pinned test binary (manual gates and M8):
  `git clone --local /Users/biran/code/skills/orca/ccloop /private/tmp/orca-ffec7b28/ccloop-c205d55` (or `git -C …
  worktree`), `npm ci && npm run build`, then `node dist/cli.js --version` into a log.
- [ ] `npm run build --workspace web && npm run verify:ccloop-pin` (log to file, read whole; requires the E2E opt-in
  the script sets itself).
- [ ] `npm test` to a file; read whole; record selected/skipped counts. Commit `chore(deps): pin ccloop to the
  multi-repository main`.

**Named mutation:** none (dependency-only task). The gate is `verify:ccloop-pin` RC 0 plus `npm test`.

---

## Task O2 — projects file, registry, HTTP routes and the Web form (§4.1–§4.2) — M1, M2

Files: `src/panel/projectsFile.ts`, `src/panel/projectRegistry.ts`, `src/panel/projects.ts`,
`src/panel/server.ts` (file-mode rows only if needed), `src/panel/controlAssembly.ts` (hook signatures only),
`web/src/project.ts`, `web/src/api.ts`, `web/src/ProjectControl.tsx`, `web/src/App.tsx`,
`web/src/locales/en.ts`, `web/src/locales/zh.ts`. Tests: `tests/panel/projectsFileMulti.test.ts` (new),
`tests/panel/projectsMultiApi.test.ts` (new), `web/tests/multiDirProjects.test.tsx` (new).

- [ ] M1: a file without `multiDirProjects` re-saves byte-equal (no key is ever added); with it, the schema accepts
  2..8 distinct member ids in order; an id/name clash across `projects[]` and `multiDirProjects[]` is invalid by name;
  fewer than 2 or more than 8 is invalid. Mutations: `default-multiDirProjects` (default `[]` ⇒ the absent-key
  byte-equality fails), `skip-nesting` (nested members accepted), `existence-in-schema` (an unknown member makes the
  whole file invalid instead of skipping one entry).
- [ ] Loader: an entry whose member is unknown / a multi project / nested (by realpath, either direction) is skipped
  **alone** and named in `fileError` (`multi-dir-member-unknown:<id>`, `-not-single:<id>`, `-nested:<a>:<b>`); every
  other project and multi entry still loads; a skipped id is unknown to the control plane.
- [ ] Registry API: `addMulti(name, dirs)` and `setDirs(id, dirs)` under the same checks; `add` keeps refusing
  multi ids; the multi entry joins no `repos[]` (it has no single path); `list()` exposes `multiDirProjects`.
- [ ] HTTP: `POST /api/projects` accepts **either** `path` or `dirs` (both or neither ⇒ `400`); refusals
  `multi-dir-too-few`, `multi-dir-too-many`, `multi-dir-member-unknown`, `-duplicate`, `-not-single`, `-nested`,
  `project-name-taken`. `PATCH /api/projects/:id` accepts `{name}` or `{dirs}`. `GET` adds rows
  `{projectKey, name, kind:"multi", dirs:[{projectKey,kind}], path:<primary>, controlRepoId}`; single rows
  byte-identical.
- [ ] `projectsDepsOf` answers `controlRepoId` for a multi id through the assembly's multi map (not through
  `opts.repos`), so the Web row carries its control id.
- [ ] Web: "Group several projects" form with an ordered picker and up/down arrows; title and order hint from §13
  ("Group several projects" / 「组合多个项目」, "The first is the primary…" / 「第一个是主目录…」); the form says once,
  the first time a multi project is created, that an older Orca refuses a file with the key. API client gains
  `addMultiProject`/`setProjectDirs` beside the existing calls.
- [ ] M2 test: create with `dirs`; `path`+`dirs` and neither ⇒ 400; `PATCH {dirs}` replaces the order; `GET` rows as
  above; single rows unchanged. Mutations: `accept-both` (accept `path` and `dirs`), `drop-path` (multi row lacks
  `path`).

---

## Task O3 — control config, open, settings refusals (§4.3, §5.1–§5.3) — M3, M4

Files: `src/panel/controlAssembly.ts`, `src/control/webService.ts` (deps type + setting handlers),
`src/control/requirementCommands.ts`, `src/control/requirementRecords.ts` (insert shape), `src/control/multiGroup.ts`
(new). Tests: `tests/control/multiDirConfig.test.ts`, `tests/control/multiDirOpen.test.ts` (both new).

- [ ] Assembly keeps `Map<repoId, { id, dirs: [{key, repoId, kind, path}] }>`; `addMulti`/`setMultiDirs` fill it;
  `knownRepository` is `config.hasRepository(id) || multiMap.has(id)`; `resolveRepository(id)` throws
  `multi-dir-no-single-path` for a multi id **before** touching the config; `listRepositories()` does not include
  multi ids.
- [ ] `multiGroup.ts`: `multiDirOf(body)` (shape read, loud `multi-dir-invalid` when malformed), `isMultiGroup`,
  `dirTargetRepoId(store, groupId, key)` (`repo` ⇒ member repo id; `dir` ⇒ `flowVaultRepoId(vaultId)`),
  `multiPrimaryRepoId`.
- [ ] `groupRepoId` throws `multi-dir-group-no-single-repo` for a multi group (replaces the "fall through to
  requirement.repoId" path for these groups only). All named sites move in O9; until then the new throw is the loud
  stop.
- [ ] Open: `applyRequirementOpen` takes `multiDirProjectOf`; on a multi id it freezes
  `multiDir: { project, dirs: [{key, repoId, kind, dirWorkspace?}], landing: null }` (registered order, realpaths) and
  no `dirWorkspace`. Reads only `realpathSync`; **no vault, no import**. A later `PATCH` does not change an open
  group's list.
- [ ] Settings on the multi id are refused `multi-dir-project-setting-unsupported`: `set-workspace-mode`,
  `set-integration-scheme`, `set-criteria-review`, `set-check-settings`/`set-check-locks` (and the flow settings when
  they name a repo id).
- [ ] M3: `knownRepository(multi)` true; `resolveRepository(multi)` throws by name; the four setting verbs refuse by
  name. Mutation `resolve-to-primary`.
- [ ] M4: body `multiDir.dirs` in registered order with realpaths and `dirWorkspace` for `dir` members; a later PATCH
  does not change it; no vault directory exists after open. Mutation `read-registry-at-dispatch` (dispatch reads the
  live registry instead of the frozen body).

---

## Task O4 — overview and prompts across directories (§6.3–§6.4) — M5

Files: `src/control/requirementOverview.ts`, `src/control/requirementCalls.ts`, `src/control/requirementClarify.ts`,
`src/control/clarifyHost.ts`, `src/control/requirementSplit.ts`, `src/control/requirementSchemas.ts`.
Test: `tests/control/multiDirOverview.test.ts` (new).

- [ ] `buildOverviewFor` for a multi group builds one overview per member in order: a `repo` member from `HEAD`; a
  `dir` member from its import commit (`importFolder(…, reuseUnchanged: true)`); each cached under its own dir target
  id. Compose `{ schema: "orca-project-overview-v1", dirs: [{ key, name, kind, primary, overview }] }`; the call
  record keeps `commits: { <key>: <sha> }`.
- [ ] A divided build's cache lives under `<repoId>/<commit>/limits-<digest>/overview.json`, so it cannot reuse a
  default build's entry (nor the other way round).
- [ ] Count limits: each directory's `OVERVIEW_LIMITS` count limits divided by the member count (floor, at least 1);
  byte limits unchanged.
- [ ] Clarify: `CLARIFY_INSTRUCTION_MULTI_V1` + `MULTI_DIR_FRAME`, fenced context named `project-overview`. V3 and
  `REQUIREMENT_FRAME` stay byte-identical.
- [ ] Split: `SPLIT_INSTRUCTION_MULTI_V1` (head "Orca requirement split (several directories), instruction version
  1.") and a JSON schema whose tasks carry `writes: [{ dir, targetPaths, checks }]`; `SPLIT_INSTRUCTION_V1` and
  `SPLIT_JSON_SCHEMA` stay byte-identical.
- [ ] M5: one overview entry per member (folder member from its import commit); `commits` per key; single-repo clarify
  and split prompts byte-equal to today's. Mutations: `use-clarify-v3` (multi group gets V3), `skip-limit-division`
  (limits undivided; the composed prompt exceeds the criterion's bound).

---

## Task O5 — split validation, qualified write sets, expanded contracts, export (§6.1–§6.2, §6.4) — M6

Files: `src/control/requirementSplit.ts`, `src/scheduler/writeSet.ts`, `src/scheduler/graph.ts`,
`src/control/requirementExport.ts`, `src/control/requirementRecords.ts` (task record keeps `writes`),
`src/control/requirementSchemas.ts` (the multi split shape), `src/control/planImport.ts` (accept path only),
`src/control/requirementCalls.ts` (a multi group's split is parsed with `multiSplitOutputSchema` in `evaluateSplit`),
`src/control/requirementCommands.ts` (accept re-expands the frozen contracts), `src/control/requirementDocument.ts`,
`src/scheduler/planFile.ts` (the archived contract's optional `repoKey`/`additionalRepos`), and the web draft types.
Test: `tests/control/multiDirSplit.test.ts` (new), `tests/control/fixtures/multiRequirement.ts` (extracted harness).

- [ ] Carry-over from O4 (the prompt and wire schema landed there; validation is here): `evaluateSplit` selects
  `multiSplitOutputSchema` for a multi group before the checks below. O4's commit leaves a multi split answer judged
  with the single schema until this lands; the branch does not merge before O5.
- [ ] `writes` validation: unknown directory `dir:<task>:<key>`; each path checked at **that directory's** overview
  commit (`path:<task>:<key>:<p>`); the ccloop primary (first written dir in registered order) must have non-empty
  `checks` (`checks-primary:<task>`); a `.decisions/` path outside the primary is `ledger-path:<task>:<key>`.
- [ ] `qualifiedWriteSetOf(writes)`: `normalizeClaim` first, then prefix every claim with `\0<key>` (`**` becomes
  `\0<key>/`). `buildGraph` takes it through the new optional `claims` parameter; two tasks conflict only within one
  directory. The implicit edge's displayed claims render the prefix as `<key>:<path>`.
- [ ] Expansion: per task one contract through `expandLoopTask`; the task's ccloop primary's paths/checks fill the
  existing fields with `context.repoPath` = that dir target's workspace path; extras become
  `context.additionalRepos` (`repoPath`, `targetPaths`, `allowlistPaths = targetPaths`, per-dir checks);
  `context.repoKey` = the primary's key. A one-directory task gets an ordinary contract with no `repoKey`.
  `documentChecks` apply per directory to that directory's targets.
- [ ] Accept/export: the plan is imported with **no** integration record; the requirement document is exported to the
  primary; every other member's work branch is created at export (`repo` at `HEAD`; `dir` at a fresh import that
  becomes its base/placed); `landing.lastLanded[key]` = each directory's export base. All dir targets are based at the
  same moment.
- [ ] M6: the five reason families; `**` in different directories shares a layer; the same path in one directory gets
  an implicit edge; the expanded contract has `repoKey` and `additionalRepos` in registered order; a single-directory
  task on a non-primary member has no `repoKey` yet is keyed by that member (conflicts there, not in the primary).
  Mutations: `unqualified-write-sets`, `primary-first-writes-entry`, `keys-from-contract-repoKey`.

---

## Task O6 — dispatch and collect (§7.1–§7.4) — M7, M8

Files: `src/control/schema.ts` (the contract/envelope agreement both ways), `src/control/startEnvelope.ts`,
`src/control/executionDriver.ts` (A2, C, cleanup), `src/control/workspace.ts`,
`src/control/ccloopPort.ts`, `src/control/executionPort.ts`, `src/control/driveRecord.ts`,
`src/control/driverLanding.ts` (the per-directory criteria flag), `src/control/driverHandoff.ts` (a restart's
cleanup), `src/scheduler/harvest.ts` (a reconciliation's claims). Tests: `tests/control/multiDirDispatch.test.ts`,
`tests/control/multiDirCollect.test.ts` (both new), `tests/control/startEnvelope.test.ts`,
`tests/control/workspace.test.ts`, `tests/control/fixtures/ccloopWorld.ts`,
`tests/control/fixtures/driverHarness.ts`, `tests/control/fixtures/web.ts`.

- [ ] A2 recomputes the ccloop primary's mode for a multi run; A1's project-primary setting is a placeholder for a
  single call / task run.
- [ ] `loopWorkSchema` gains optional `additionalRepos: [{key, targetRepo, base}]` (strict, same keys/order as the
  contract; absent for every single-repository envelope).
- [ ] A2 for a multi run: written dirs only, registered order — resolve dir target, `ensureWorkBranch` (a `dir`
  member's branch must exist; else block `dir-base-missing`), `ensureWorkspace(target, mode(member),
  <runId>.dir-<key>, base, roots)`; the primary keeps today's path. `context.repoPath` = primary workspace;
  `additionalRepos[i].repoPath` = that directory's workspace. `drive.dirs = [{key, targetRepo, base, workspacePath}]`;
  primary fields stay. Skills inject into the primary only.
- [ ] `workspace.ts`: `extraWorkspacePathOf(roots, runId, key)` = `<workspacesRoot>/<runId>.dir-<key>`;
  `extraLandingPathOf` = `landing-<runId>.dir-<key>`; `cleanupExtraWorkspace(target, roots, runId, key)` refuses
  unless `basename(path) === <runId>.dir-<key>`, then `removeOwnPath` + `update-ref -d incomingRefOf(runId)`, and
  **no** `removeSkillsSnapshot`.
- [ ] Refusals before dispatch: continuation / token-allowance resume → `multi-dir-continuation-unsupported`;
  `verify-saved-result` → `multi-dir-recovery-unsupported`; execution-format capture not entered.
- [ ] C for a multi run: `commitAttempt` per result repo (`<sourceDir>/repo`; `<sourceDir>/repos/<key>`), keeping
  `drive.dirs[].attemptSha`; `harvest` per directory with that directory's claims (`out-of-bounds:<key>:<paths>`);
  criteria per directory; the criteria base re-run is not started and its flag says `base-run-skipped: multi-dir`.
- [ ] `ccloopPort.ts` accepts collect's optional `dirs: [{key, resultRepo, changedPaths, attemptSha}]` and checks its
  keys equal the envelope's. Single-repo collects have no `dirs` key.
- [ ] M7: only written dirs get workspaces; `additionalRepos` keys/bases match `drive.dirs`; a single-directory
  group's envelope is byte-equal to today's. Mutations: `every-member-workspace`, `mismatch-base`,
  `nested-extra-workspace` (`<runId>.dirs/<key>` ⇒ `assertOwnPath` refuses).
- [ ] M8 (pinned ccloop + fake agent): per-directory `attemptSha`; an extra-repo out-of-bounds blocks
  `out-of-bounds:<key>:…`; the base re-run is not started and the flag says `base-run-skipped: multi-dir`. Mutation
  `harvest-with-primary-claims`.

---

## Task O7 — run landing D and the ledger (§8) — M9

Files: `src/control/driverLanding.ts`, `src/control/driveRecord.ts` (journal fields),
`src/control/executionDriver.ts` (new-drive defaults). Test: `tests/control/multiDirLandingD.test.ts` (new).

- [ ] `stepD` multi: (1) per written dir in order, `old_k = tip(orca/<g>)`, `findLanding` (skip already-landed);
  (2) produce each merge commit in that directory's landing worktree **without swapping**, ledger only in the
  primary's commit (if the primary is not written, a ledger-only commit on the primary's tip, recognised on replay by
  `.decisions/<runId>.jsonl`); (3) any conflict ⇒ nothing swapped, block
  `multi-dir-landing-conflict:<key>:<first 20 paths>`; (4) one transaction writes
  `drive.landingPlan = [{key, old, next}]`; (5) CAS each in registered order (`compareAndSwap`); (6) a `moved` ends
  the round, the next round starts at (1) and skips landed dirs; (7) `markLanded` with the primary's commit and
  `landedDirs: { <key>: commit }`.
- [ ] Step E (ledger-only) uses `multiPrimaryRepoId`; `recordLandedTip` is called only for the primary's dir target.
- [ ] M9: a 2-directory run lands both work branches, ledger only on the primary; a crash hook after the first CAS
  then a new round lands the second without re-merging the first (refs listed); a conflict in the second swaps
  nothing and blocks by name. Mutations: `swap-before-all-produced`, `ledger-in-each-directory`.

---

## Task O8 — multi landing pass (§9) — M10, M11, M12, M13, M17, M18

Files: `src/control/multiLanding.ts`, `src/control/multiLandingRecord.ts` (both new),
`src/control/executionDriver.ts` (pass insertion after the integration pass),
`src/control/integrationCheck.ts` (optional `rev`), `src/control/integrationPass.ts` (reuse delivery primitives),
`src/control/dirPlacement.ts` (`folderStopMoved`; reuse `prepareFolderPlacement`/`writeFolderPlacement`),
`src/control/groupEdges.ts`, `src/control/webService.ts`, `src/control/webProtocol.ts`, `src/panel/humanOnly.ts`,
`src/panel/controlApi.ts`, `src/panel/controlOverview.ts`, `src/control/folderChangeCommands.ts`,
`src/control/integrationCommands.ts`, `src/control/requirementCommands.ts`, `src/commands/domains/work.ts`,
`src/control/errors.ts`, generated `docs/cli.md` + `skills/orca-control/references/*`, `web/src/controlTypes.ts` and
both locales. Tests: `tests/control/multiDirLanding.test.ts`, `multiDirDue.test.ts`, `multiDirPartial.test.ts`,
`multiDirLandingJournal.test.ts`, `multiDirPrecheckChecks.test.ts`, `multiDirFolderResolve.test.ts`,
`fixtures/multiLandingWorld.ts` (all new); `multiDirSplit.test.ts`, `groupEdges.test.ts`, `archiveGroup.test.ts`,
`tests/panel/accessMatrix.test.ts`, `tests/entry/skill.test.ts` (updated).

- [x] Due rule: a group is due when a **carried** directory's tip differs from `landing.lastLanded[key]` (`keep` never
  makes it due); trigger is whole-group done (archived/stopped/reconciling/not-complete skipped); one group at a time
  in id order. A complete group that is never due still settles `idle → landed`, so §9.9 answers its dependents
  instead of waiting for a tip that will never move.
- [x] Accept freezes `multiDir.landing.delivery = [{key, scheme}]`: `dir` ⇒ `place`; `repo` ⇒ its repository default
  (`keep`/`local`/`push-target`); `push-branch`/`github-pr` ⇒ refuse `multi-dir-delivery-unsupported:<key>`;
  `set-group-integration` on a multi group ⇒ `multi-dir-delivery-fixed`.
- [x] Pre-check (writes nothing): `keep` nothing; `local`/`push-target` reuse `readBase`/`computeNew` (per-directory
  stand-in built from `lastLanded[key]`), with `multi-dir-target-missing:<key>`, `multi-dir-precheck-conflict:<key>:<paths>`,
  `integration-worktree-dirty:<key>`, `integration-not-fast-forward:<key>`, `integration-remote-missing:<key>`;
  `place` runs DIR §8.5 steps 1–6 under `withDirLock` and stops only on `changed`/`unwritable` (state
  `folder-changed`/`folder-unwritable`, before anything lands). Opt-in integration checks run through
  `runIntegrationCheck(..., next)` under state `prechecking`; failure ⇒ `multi-dir-precheck-check-failed:<key>`.
  A directory with nothing to carry records `lastLanded[key] = tip` and is not put in the plan; an empty plan ends
  `landed` with no publish. A stop mid-walk aborts the walk and journals nothing: a truncated plan must never look
  like a complete pre-check on replay.
- [x] Ordered landing: journal `pending = {plan, landed, startedAt}`; publish each in order (`local`/`push-target`/`place`);
  append to `pending.landed` and set `lastLanded[key]` on success; a midway failure is `partial` (never reverted) or
  `blocked`/`idle+movedBeforeAny=1` per §9.5; completion is `landed`. A folder's classify/journal/write pair is one
  `withDirLock` critical section. Every landing and placement write records the group's projection change in its own
  transaction (these writes happen outside any run's `saveRun`, so the panel's change feed would otherwise miss them).
- [x] Crash replay (§9.6): `landing` + `pending` replays per plan, skipping landed keys and recognising a target that
  already holds `next`; no pre-check redone. Crash hooks `multi-land-after-journal`, `multi-land-after-publish:<key>`,
  `multi-land-after-record:<key>`; the landed set at each point is asserted explicitly.
- [x] Verbs: `multi-dir-landing {action: retry-rest|mark-resolved}` (human-only; accepted in `partial`, `blocked`,
  `folder-changed`, `folder-unwritable`); `retry-rest` pre-checks only unlanded dirs against fresh bases;
  `mark-resolved` sets `lastLanded` to current tips and records `resolution.unlanded`. `resolve-folder-change` gains
  `dir` (required for multi, refused otherwise `folder-change-dir-mismatch`); after it, the next round pre-checks by
  itself. Its registration surfaces (access map, escape hatch, CLI rows, generated docs, en/zh copy) landed with the
  verb here; O9 keeps the needs-you copy and the other §13 codes.
- [x] §9.8 re-entry without a command: a stopped folder whose watch signature moved re-runs the pre-check; an answered
  stop is honoured once; a stopped folder that vanished — including when its stop list is truncated and reading it
  must open the folder — is recorded as `folder-missing:<key>`, not a crash.
- [x] Prerequisites: a multi group is never a stack base; `prerequisiteDone` waits on `local`/`place` dirs only, with
  no `pending`.
- [x] M17 (due/never-written): after accept `lastLanded[key]` = every export base (asserted at accept); a group that
  wrote only dir 1 carries only dir 1; a `keep` dir never makes it due; a due group with nothing to carry ends
  `landed` and is not due again.
- [x] M10 (three deliveries + folder classification), M11 (partial + verbs), M12 (journal). Mutations as listed in
  the spec rows, each seen red (the two observably-equivalent ones and the unchanged-watch short-circuit are recorded
  below).
- [x] M13: checks off for a disabled member; on for an enabled one, at `next`, with `dispatchedEnv`; failure blocks
  with the command; today's caller passes no `rev` and stays green.
- [x] M18: in `folder-changed`, `multi-dir-landing` is accepted; after `resolve-folder-change {dir, recheck}` the next
  round pre-checks and lands with no further command; so does undoing the edit (the watch moved).

Accepted gaps and observations (recorded honestly at review):

- `multi-dir-landing-failed:<kind>` and `multi-dir-landing-transient:<key>` are internal landing reasons, not command
  refusals; they intentionally have no §13 copy entry and surface in `detail`.
- `integration-not-fast-forward:<key>` at pre-check is race-only (base and HEAD are read from the same ref); the
  dirty-worktree pre-check test exercises the publish precondition below it.
- The unchanged-watch guard inside `prepareFolderPlacement` is a pure short-circuit: forcing `folderStopMoved` true
  (mutation A6) re-runs the same comparison and saves nothing, so it is GREEN and logged as such. The guard stays as
  the cheap path.
- Removing the pre-check's dirty guard (mutation PC3) falls through to the publish-time guard with the same code and
  state, so it is GREEN; PC3b renames the code and is RED.
- The `folderAnswer` guard honours only an answer that sits on a stopped placement (a successful `take-folder` keeps
  its resolution on an idle record); this is defensive and has no observable test.
- Driver wiring (pass order, stop propagation, one shared checks map) is exercised through `landMultiDirGroups`; the
  end-to-end driver path is O9's real run.

---

## Task O9 — every `groupRepoId` site, refusals, access, copy and M15 (§5.4, §12, §13) — M14, M16, M19

Files: `src/control/debugGroup.ts`, `errors.ts`, `integrationPass.ts`, `planImport.ts`, `schedules/commands.ts`,
`systemDebug.ts`, `webProtocol.ts`, `webService.ts`, `src/flow/flowCommands.ts`, `src/panel/controlApi.ts`,
`controlViews.ts`, `skills/orca-control/references/error-codes.md`, `web/src/ControlGroupView.tsx`, `controlApi.ts`,
`controlTypes.ts`, `locales/en.ts`, `locales/zh.ts`, `MultiDirLanding.tsx` (new); `tests/control/multiDirAccess.test.ts`,
`multiDirSites.test.ts`, `tests/panel/multiDirSummary.test.ts`, `web/tests/multiDirCopy.test.tsx` (all new),
`tests/panel/refusalCoverage.test.ts` (updated).

- [x] Sites from §5.4, measured again: A1/A2, the extra cleanup, `driverHandoff.ts`'s cleanup, `driverLanding.ts`'s
  primary and O7 branches, `requirementCalls.ts` and `requirementExport.ts` were already multi-aware from O4–O8. O9
  changed the remaining reachable ones: the decisions route reads `multiPrimaryRepoId` for a multi group, and the
  integration pass skips a multi group beside the dir skip. The rest stay unreachable for a multi group (stepDMulti
  owns D/R; a multi group never reconciles, has no integration copy, returns from the multi export path first, and its
  recovery/continuation are refused at A2). One probe is reachable: `driverHandoff.ts`'s `landedUnrecorded` for a
  blocked multi run at D/R -- `groupRepoId` throws, and the probe's catch answers "cannot prove the landing absent",
  leaving the request to a person, exactly the conservative branch it documents.
- [x] `checksPass` skips multi repo ids by name when it builds its list (no `multi-dir-no-single-path` per round).
- [x] Refusals: `import-plan` on a multi id ⇒ `multi-dir-plan-import-unsupported` (before the dir refusal); `flow-start`
  on a multi project ⇒ `flow-project-multi-dir-unsupported` **before** `registeredDirProject`; a scheduled flow or group
  on a multi id, and `schedule-from-group` from a multi group ⇒ the same flow code (both checks were added at review:
  the schedule's own start validation answered `flow-dir-unregistered`, and the group body is the only place a scheduled
  group's multi membership can be seen); correction (`correction-debug-open`) and system-debug on a multi project ⇒
  `debug-multi-dir-unsupported`, checked before the repository lookup would answer `correction-repository-unknown`.
  Status 422 each; `errors.ts` and the generated error-code reference carry all three.
- [x] Access: `VERB_ACCESS`/`SOCKET_TIER`/CLI rows for `multi-dir-landing` and `resolve-folder-change --dir` landed with
  O8; O9 adds the Web action union (`multi-dir-landing`, `dir` on the folder answer) and the access tests. The access
  suite relocates HOME (and every XDG/ORCA path) to a temp directory and asserts after each test that nothing appeared
  there (Rule 17).
- [x] `groupSummarySchema` gains an optional `multiDir` summary; `readGroupSummary` derives each directory's `landed`
  from the landing's own record -- a `keep` member never lands (`lastLanded` alone cannot say it, since accept seeds it
  with every export base) -- and `landedKeys` is the journal's list, empty at idle and after completion.
- [x] Copy: every §13 code in en and zh; the integration region is `MultiDirLandingBlock` in place of the scheme picker,
  showing each directory's delivery and state, the landing reason in the reader's language, "Updated in this landing"
  from the journal, both stopped-landing answers, and a folder member's three answers with the same gating as the
  single-folder region (take only `folder-changed`, recheck on any stopped state, withhold when changed + unwritable > 0).
- [x] M19 (sites): `groupRepoId` throws for a multi group; extra cleanup removes every extra workspace and its incoming
  ref; the decisions route reads the primary. Mutations `fallback-to-primary`, `clean-primary-only`, `nested-landing-leaf`
  and `multi-id-reaches-checksPass` each seen red. `remove-skills-in-extra` is GREEN (expected): extras have no skills
  snapshot, so removing it once per extra is observably equivalent; it stays out of `cleanupExtraWorkspace`.
- [x] M14 (access/Rule 17): §12 rows; `VERB_ACCESS`; temp HOME/ORCA_*; flow/import/schedule/debug refusals. Mutations
  `verb-any` and `flow-dir-unregistered-first` seen red; the debug and schedule guards added at review were mutated too
  (early debug guard removed ⇒ the open answered `correction-repository-unknown`; both schedule guards removed ⇒ the
  start reached `flow-dir-unregistered`).
- [x] M16 (copy): every §13 code has en and zh; the integration region shows the per-directory states and both buttons.
  Mutation `drop-one-zh-key` seen red. At quality review two derived states were pinned by mutations of their own: a
  `keep` member counted landed (red) and the folder answers' withhold gating collapsed to `unwritable > 0` (red).
- [x] M15: the listed suites pass with no edit; the full root suite ran to a file and was read whole: 669 files, 6308
  passed, 37 skipped, exit 0, including the real-ccloop M19 cleanup test (`removes every written directory's workspace
  and its incoming ref`) under the pinned ccloop.

Accepted gaps and observations (recorded honestly at review):

- The overview's needs-you rows for a stopped multi landing reuse the §13 refusal sentence as the row's title
  (`controlOverview.ts` adds them with `needsYou`); there is no separate "needs you" wording. Pre-existing row behavior.
- Member-list refusals are suffixed (`multi-dir-member-duplicate:<id>`), and the Web's `refusalText` looks codes up
  exactly, so the server's English sentence is shown as sent even though the en/zh entries exist; those entries are
  exercised by the copy test, not by that runtime path.
- The pseudo-locale sweep (`i18nPseudo.test.tsx`'s `AREAS`) has no multi group; the region's two locales are covered by
  `multiDirCopy.test.tsx`.
- The integration pass's multi skip has no test: a multi group never has an integration record, so removing it changes no
  observable behavior; it stays as an explicit guard beside the dir skip.
- `applyMultiDirLanding` relies on `applyWebCommand`'s projection recording; the explicit `recordProjectionChange` calls
  remain only where the pass writes outside any command (`multiLanding.ts:139/:350`).
- The first `O9-M19a` mutation entry in the log reads "GREEN (unexpected)" although the run exited 1: the runner had
  inverted its label. It was fixed and rerun immediately; the rerun entry is the evidence, and the worktree was
  byte-identical both times.

---

## Closing the branch

- [ ] Independent review: spec compliance first, then code quality; fixes through fresh subagents; re-review after
  each fix.
- [ ] Each criterion's named mutation ran in the clone and was seen red; the log is append-only; restore proof is
  `diff=0 cached=0`.
- [ ] `npm test`, `npm run build`, `npm run build --workspace web` to files, read whole. Integration tests are the
  milestone gate; end-to-end only if the person asks.
- [ ] Rebase onto `main`, then **stop**: merging, pushing, deleting branches and cleaning worktrees each need the
  person's separate authorization. Record the gate numbers in the handoff after the merge, not before.
- [ ] O9 (real-agent acceptance on a repo+repo+folder project, claude → codex → omp, plus one forced `partial`) is a
  separate paid run, requested from the person when H7 is otherwise ready.
