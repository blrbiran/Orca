# Requirements on a `dir` project — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the
> named reason, then the code, then green. One commit per task (more when a task is large), trailer
> `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

- **Spec:** `docs/superpowers/specs/2026-10-24-dir-project-requirements-design.md` ("§n", criteria "Dn"). **§20 maps
  review round 2 and takes precedence** where it refines earlier text. Human rulings: 「要支持」; never overwrite the
  person's edits (narrow collision rule §9.1, controller's call); `.decisions/` stays in the vault.
- **Not built here:** H7 (`docs/superpowers/specs/2026-10-24-multi-dir-projects-design.md`). Its §17 lists amendments it
  will make to this design (a `multiDir.dirs` list, §8.5 steps 1–6 / 6–8 run per folder from a multi pass, a `dir: <key>`
  field on `resolve-folder-change`). So `src/control/dirWorkspace.ts` takes one frozen `{ dir, vaultId }` and a
  placement record as arguments and never reads the group body itself; the placement pass is split into
  `prepareFolderPlacement` (steps 1–6) and `writeFolderPlacement` (steps 6–8) so a multi pass can call them per folder.
- **Base:** branch `feat/dir-requirements` from `main` `6ec49411` (schema `"19"`), worktree
  `/private/tmp/orca-ffec7b28/dirreq`, `node_modules` and `web/node_modules` symlinked from the main repo.
- **Author / attribution:** implementer subagent of session `ffec7b28`, 2026-10-24 (Rule 13).
- **Rules:** Rule 9 (each new branch: a named mutation seen red, made in the `git clone --local` copy
  `/private/tmp/orca-ffec7b28/dirreq-mut`, log `/private/tmp/orca-ffec7b28/dirreq-mutations.log`, restore proven by
  `git diff | wc -c` and `git diff --cached | wc -c` both 0); Rule 14 (logs redirected to files, read whole); Rule 17
  (every criterion: temp `HOME`, `ORCA_VAULT_DIR`, `ORCA_CONTROL_DIR`, `ORCA_PROJECTS_FILE` …; nothing under `~/.orca`);
  Rule 18 (`npm test`). No paid runs, no panel restart, no merge, no push.
- **Criterion rewrites:** under the human's 「这次批准改写所有必要的判据」 an existing test that goes red only because the
  ruled behaviour changed may be rewritten; each is named in its commit body with the reason. Any other red is this
  branch's regression first.
- **Safety boundary (gaps spec §21):** Task 7 touches the flow kernel's drift snapshot locking (I8), so
  `tests/flow/heldEffectChains.test.ts` is run in that task and must stay green.

## Corrections to the spec's text, measured (Rule 13: the spec is not edited)

- §5.1 / D10 say the control schema "stays `"18"`". `main` is at `"19"` (`src/control/migrations.ts:5`, measured at
  `6ec49411`). Meaning kept: **no schema step**; the schema stays `"19"`.
- Anchors drifted since `fdceeb83` (e.g. `writeImportedPlan`'s default scheme is `planImport.ts:366`, not `:345`). Each
  task re-measures the anchors it cites.

## Builder's decisions (§19)

| Item | Decision |
|---|---|
| module names | `src/control/dirWorkspace.ts` (primitives, §4.1), `src/control/dirPlacement.ts` (classifier, writer, pass, `placeDirGroups`), `src/control/dirGroup.ts` (body readers: `dirWorkspaceOf`, `placementOf`, `isDirGroup`, `dirGroupRepoId`) |
| CLI spelling | `orca group folder-change <group> --take-folder | --recheck | --withhold` (exactly one) |
| full stop list | body keeps the first 200 `changed` / `unwritable`; the full canonical list (JSON, byte order) is a blob in the vault, referenced by `refs/orca/group/<g>/stop` and named in `placement.stopRecord` (its blob id is the hash the spec asks for); referenced, so gc keeps it |
| case folding (`case-clash`) | `s.normalize("NFC").toLowerCase()`; known difference from full folding (`"ß"` vs `"SS"` / `"ss"`) recorded in a test case that names it |
| `placeDirGroups` location | its own module `src/control/dirPlacement.ts`, called from `executionDriver.ts` right after `integratePendingGroups` |
| crash hooks | a `dirPlacementCrash?: (point) => void` driver dep, like `IntegrationCrashPoint`; absent in production |

---

## Task 1 — golden, vault primitives, overview commit (§18.1) — D14, unit parts of D2

Files: `tests/fixtures/requirement-overview/repo-golden.json` (new), `tests/control/requirementOverview.test.ts`,
`src/flow/vault/snapshot.ts`, `src/flow/kernel.ts` (caller of `importSnapshot`), `src/control/requirementOverview.ts`,
`src/control/dirWorkspace.ts` (new), `tests/control/dirWorkspace.test.ts` (new).

- [ ] **Golden first, on unchanged code**: capture a repo project's overview from a fixed fixture repository and
  commit `repo-golden.json` in its own commit before any `src/` change; a new case in `requirementOverview.test.ts`
  compares against the committed file (never regenerates it; Rule 9 inference 2). Mutation `repo-gets-commit` (repo
  projects pass an explicit commit that is not `HEAD`) red; mutation `overview-field-dropped` (one field of the
  overview builder's output removed) red.
- [ ] `importSnapshot` options take `baseRef: string | null` instead of deriving from `flowRunId`; the flow kernel passes
  `baseRef(flowRunId)` (flow refs byte-identical: `tests/flow/vault.test.ts`, `copyBackLock.test.ts`,
  `vaultDriverProbe.test.ts` unchanged and green). For a non-flow base ref the write is create-only and an existing ref
  is reused, never replaced. Mutation `flow-base-ref-changed` (kernel passes another ref name) red;
  mutation `group-base-replaced` (group base written with CAS from the value read) red.
- [ ] `buildRepositoryOverview({ …, commit })`: verified with `rev-parse --verify <commit>^{commit}`, used instead of
  `HEAD`; without it unchanged. Mutation `commit-ignored` (reads `HEAD` anyway) red on a bare vault (no `HEAD`).
- [ ] `dirWorkspace.ts`: `openDirWorkspace(env, frozen)` (realpath check NFC both sides, directory check →
  `dir-folder-missing`; `openVault`; `vaultKeyOf(dir) === frozen.vaultId`), `importFolder(ws, { reuseUnchanged,
  baseRef })` with excludes `[".decisions/"]`, `folderDrift(ws, folderCommit)`, `nextFolderCommit(ws, tip, placed,
  keepFromPlaced)`. Mutations: `no-reuse` (always a new import), `decisions-not-excluded`, `missing-not-detected`
  (moved folder still opens) — each red.

## Task 2 — open and calls (§5, §6.1–6.3, §5.2 import refusals) — D1, D2, D3, D10 (import rows)

Files: `src/control/requirementCommands.ts`, `src/panel/controlAssembly.ts` (`dirProjectOf`), `src/panel/permissions.ts`
(payload check), `src/control/dirGroup.ts` (new), `src/control/executionDriver.ts` (`groupRepoId` dir branch, `env` in
deps), `src/control/singleCallPurposes.ts`, `src/control/requirementCalls.ts` (`:143`, `:300` → `groupRepoId`; dir
overview via `importFolder`; `dir-folder-missing` blocked reason), `src/control/planImport.ts` / plan-import command and
the correction-debug / system-debug open paths (refusal `dir-project-plan-import-unsupported`). Tests (new):
`tests/control/dirRequirementOpen.test.ts` (D1), `dirRequirementOverview.test.ts` (D2), `dirRequirementSplit.test.ts`
(D3), `dirGroupAccess.test.ts` (D10: import/debug refusals and the dispatched-run payload check; more rows in Tasks 4–5).

- [ ] D1 as written in §17, with its five mutations: `vaultid-unresolved-path`, `nfc-one-side`, `other-realpath`,
  `dirworkspace-inside-requirement`, `vault-at-open`.
- [ ] D2 as written, mutations `overview-reads-head`, `folder-as-repo`, `no-reuse-unchanged`, `decisions-not-excluded`.
- [ ] D3 as written, mutations `split-folder-target`, `split-other-commit`.
- [ ] D10 rows: `import-plan`, correction-debug open, system-debug open on a dir project refused
  `dir-project-plan-import-unsupported`; `requirement-open` on a dir project by a dispatched run refused
  `control-dispatched-run-refused`, allowed on a repository project. Mutation `drop-dispatched-payload-check`; mutation
  `drop-import-refusal`.

## Task 3 — export and dispatch (§6.4, §6.5) — D4

Files: `src/control/requirementExport.ts`, `src/control/executionDriver.ts` (`stepA2`: `dir-base-missing`),
`tests/control/dirRequirementExport.test.ts` (new).

- [ ] D4 as written (prerequisite wait counted with a fake `git` on `PATH`: 0 calls; wake undelivered; no progress;
  `base`, `placed` = `base`, one-parent document commit on `base` in the vault; `placement.landedTip`; folder
  byte-equal; replay creates nothing and an existing `base` is not replaced). Mutations: `commit-on-vault-head`,
  `waiting-marks-delivered`, `waiting-is-progress`, `vault-before-prereq-check`, `reimport-on-replay`.
- [ ] `dir-base-missing`: a dir group with no work branch blocks A2 with that reason, never calls `ensureWorkBranch`.
  Mutation `ensure-work-branch-on-dir` red.

## Task 4 — delivery fixed, decisions view (§7, §10) — D5 (no placement asserts), D10 (delivery rows), D13 (stacking)

Files: `src/control/planImport.ts` (no integration record for a `dirWorkspace` body), `src/control/integrationCommands.ts`
(`dir-group-delivery-fixed` for `set-group-integration` on a dir group and `set-integration-scheme` on a dir project's
repo id), `src/control/integrationPass.ts` (skip), `src/control/groupEdges.ts` (`deliversLocally`, `prerequisiteDone`
from the DB only), `src/control/ledgerAtRef.ts` (`ledgerSources` for a dir group: group branch only; base `.decisions/`
must be empty, else `recovery-blocked`), `src/panel/controlApi.ts` (route resolves `flow-vault-…` via
`resolveRepository`). Tests: `tests/control/dirGroupAccess.test.ts` (delivery rows), `tests/control/dirGroupEdges.test.ts`
(new, D13), `tests/control/dirRequirementE2E.test.ts` (new, D5 minus placement).

- [ ] Mutations: `apply-default-scheme`, `drop-delivery-refusal`, `delivers-locally-false`, `prereq-reads-git`,
  `ignore-landed-tip`, `keep-working-tree-ledger-source`.

## Task 5 — placement (§8, §9) — D5, D6, D7, D10 (verb rows), D11, D13

Split into commits 5a–5d.

- **5a classifier + writer** (`src/control/dirPlacement.ts`, `tests/control/dirPlacement.test.ts`): §8.3 in order
  (unwritable: symlink / type-change with whole prefix / case-clash on every FS; then at-to / at-from / changed by
  `lstat` + bytes + executable state, never through a snapshot), §8.4 (journaled `.orca-<8 hex>` names, lossless
  replace with aside + compare + no-clobber `link`, add with journaled dirs, mode-only `chmod`, modes `0644`/`0755`,
  dirs `0755` set explicitly, executable bit arithmetic, test hook between aside comparison and `link`).
- **5b pass + journal + watch** (`placeDirGroups`, `prepareFolderPlacement` / `writeFolderPlacement`; steps 1–10 under
  one `withDirLock`; `pending` ref before journal; CAS `placed`; watch signature; `landedTip` writes in D / E / R and
  export; no progress for stopped / `failed` / `folder-missing`); `tests/control/dirPlacementJournal.test.ts` (D7).
- **5c verb** `resolve-folder-change` (protocol, `VERB_ACCESS` human-only, `SOCKET_TIER` token, registry row in
  `src/commands/domains/work.ts`, `npm run gen:cli-docs`; refusals `folder-change-not-pending`; `take-folder` with
  replay adoption, direct reads of exactly `changed`, attribution trailers, `drift/<n>`; `withhold` with `toEntry` and
  whole type-change prefixes; `recheck`), overview row (`integration-review` with the §9.3 reasons), `groupSummarySchema`
  `placement`. Tests: D6 answers, D10 verb rows.
- **5d web** copy en/zh for every §9.3 code, reasons and labels; the integration region of a dir group shows the
  placement block (changed / unwritable / withheld lists, three buttons) instead of the scheme picker; the requirement
  export line. Test `web/tests/dirPlacementCopy.test.tsx` (D11). Then D5's placement asserts in
  `dirRequirementE2E.test.ts`.
- [ ] D6 mutations: `rename-over-p` (overwrite with `rename(t, p)`), `aside-deleted-uncompared`,
  `take-folder-from-snapshot`, `withhold-only-swapped-path`, `withhold-sticky`, `stop-on-any-drift`,
  `collide-by-snapshotDrift`, `three-way-merge`, `at-to-is-collision`, `ignore-exec-state`, `new-files-0600`,
  `case-clash-only-insensitive`, `no-watch-rerun`, `take-orca-own-paths`.
- [ ] D7 mutations: `journal-after-write`, `skip-owed-write`, `write-in-place`, `name-recorded-after-create`,
  `no-replay-adoption`, `placed-equals-to-is-failure`, `no-pending-ref`.
- [ ] D10 mutations: `verb-any`, `take-folder-on-missing`.
- [ ] D11 mutations: `drop-zh-key`, `scheme-picker-for-dir`.
- [ ] D5 mutations: `place-whole-tree`, `skip-placement`, plus Task 4's.
- [ ] D13 mutations: Task 4's, re-run with the placement states.

## Task 6 — the reconcile gap (§10.1) — D9

Files: `src/control/driverLanding.ts` (`finishReconcile` dir-flow branch), `tests/flow/reconcileFlowDecisions.test.ts`
(new). Mutations: `drop-finishReconcile-dir-branch`, `skip-replay-probe`.

## Task 7 — concurrency and Rule 17 (§11, §14) — D8, D12, D15

Files: `src/flow/kernel.ts` (`absorbDrift`'s `snapshotDrift` inside its own `withDirLock`, released before
`redoPendingCopyBack` / copy-back), `src/flow/vault/dirLock.ts` (an instrumentation seam for tests only, no behaviour
change), `src/control/dirPlacement.ts` (attribution already in 5c). Tests (new): `tests/control/dirPlacementWithFlow.test.ts`
(D8), `tests/control/dirRequirementOutOfRepo.test.ts` (D12), `tests/flow/driftLock.test.ts` (D15); unchanged and green:
`tests/flow/driftKernel.test.ts`, `tests/flow/heldEffectChains.test.ts`.

- [ ] D8 mutations: `lock-per-step`, `drift-snapshot-unlocked`, `lock-other-key`, `attribute-all-to-person`,
  `placement-moves-flow-head`.
- [ ] D12 mutations: `vault-from-homedir`, `modes-from-umask`, `chmod-unchanged`.
- [ ] D15 mutations: `drift-snapshot-unlocked`, `nested-lock` (deadlock: 5 s timeout red).

## Task 8 — final

- [ ] `ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-f4de340/dist/cli.js CCLOOP_CACHE_DIR=/private/tmp/orca-ffec7b28/ccloop-cache npm test > /private/tmp/orca-ffec7b28/dirreq-npmtest.log 2>&1; echo rc=$?`;
  every red file rerun alone and against untouched `main` (known shapes: `docs/handoff/known-load-flakes.md`).
- [ ] Acceptance with a real agent (§18.8) is a separate, human-approved paid run: **not** done here.
