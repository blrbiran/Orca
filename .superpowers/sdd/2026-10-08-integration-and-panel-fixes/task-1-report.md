# Task 1 report: scheme model, repository default, `set-integration-scheme`

Implementer: subagent of session eaee0f2c, 2026-10-08. Branch `feat/integration-schemes`, base `3ed8447`.
Commits: `e018413` feat(control): store a repository's integration scheme beside its workspace mode;
`9c36d72` fix(web): give the six integration refusal codes their Chinese entries.

## What was implemented

- `src/control/integrationScheme.ts` (new): `IntegrationScheme`/`Trigger`/`Method` types, re-export of
  `integrationSchemeSchema`, `readIntegrationDefault`, `validBranchName`, `checkBranchName`, `validRemoteName`,
  `schemeHash` (`sha256Canonical` = sha256 hex of `canonicalBytes`), `checkScheme`, `githubRepoOf`. The git child runs
  `execFile("git", [...QUIET_GIT, ...])` with `unsetInheritedGitEnv()`, `GIT_TERMINAL_PROMPT=0`,
  `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, 10 s timeout (Task 3 moves it
  onto the shared runner).
  - `checkScheme` order: keep -> null (no git); `remote-name`; `target-name` (pattern + `git check-ref-format --branch`);
    `remote-missing` (`git config --get remote.<r>.url` non-zero); `remote-not-github` (github-pr, raw URL via
    `githubRepoOf`). The raw config value is used, not `git remote get-url` (insteadOf), per controller clarification.
  - `githubRepoOf`: `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, `ssh://git@github.com/o/r(.git)` only;
    host must be exactly `github.com`.
- `src/control/integrationCommands.ts` (new): `applySetIntegrationScheme(deps, command, failedCheck = null)`, mirroring
  `applySetWorkspaceMode`: unknown repo -> `control-target-not-allowed`; failed check -> `integration-invalid:<check>`;
  same scheme -> `no-op-command`; keep removes the field; result `{ kind: "integration-scheme-set", repoId, integration }`.
  Shaped as "the integration verbs' apply functions" so Task 2/6 verbs slot in.
- `src/control/workspaceSettings.ts`: body schema `{ workspaceMode, revision, integration?: scheme }.strict()`;
  `readRepositorySettingsBody` / `writeRepositorySettingsBody` (single writer); `readWorkspaceSetting` returns only
  `{ workspaceMode, revision }`; `applySetWorkspaceMode` read-modify-writes the body.
- `src/control/webProtocol.ts`: `integrationSchemeSchema` (strict variants; names are plain strings so an invalid name is
  refused as `integration-invalid` naming the check, not as a parse failure), `setIntegrationSchemePayloadSchema`, verb in
  `commandVerbSchema`, raw + effective unions (repository target), result kind, `projectionless`,
  `repositoryIntegrationSchema` / `RepositoryIntegrationV1`, `SetIntegrationSchemePayload`.
- `src/control/errors.ts`: `integration-invalid` 400; `integration-busy`, `-no-checks`, `-not-blocked`,
  `-preflight-failed`, `-unapproved` 409 (durable, so never retryable).
- `src/control/webService.ts`: `setIntegrationScheme` = admission gate -> `preflightWebCommand` (replay + revision) ->
  `checkScheme(resolveRepository(repoId))` only for a known repository -> transaction. New optional dep
  `resolveRepository`; a known repo without it fails loud.
- `src/panel/controlAssembly.ts`: wires `resolveRepository: config.resolveRepository` (the trusted config's repoId->path
  witness, the same the driver uses).
- `src/panel/controlApi.ts`: `POST /api/control/repositories/:repoId/integration` (ledger key `@repository:<id>`), switch
  case, `GET .../integration` -> `{ schema: "orca-repository-integration-v1", repoId, integration, revision }`; workspace
  GET picks `workspaceMode`/`revision` explicitly.
- `src/panel/humanOnly.ts`: `"set-integration-scheme": "human-only"`.
- `web/src/controlTypes.ts` (verb, result kind, `IntegrationSchemeV1`, `RepositoryIntegrationV1`), `web/src/controlApi.ts`
  (`fetchRepositoryIntegration`, `integrationSchemePath`), `web/src/locales/zh.ts` (six error entries).
- `skills/orca-control/SKILL.md`: route row, section 6 owner-only line incl. the verbatim sentence
  "Confirming a group whose integration is not `keep` is owner-only (the `integrationHash` field is human-only).",
  section 9 revision row, `@repository:` lookup mention.

## TDD evidence

RED (before any source):
- `./node_modules/.bin/vitest run tests/control/integrationScheme.test.ts tests/panel/integrationApi.test.ts > $S/t1a.txt` rc=1:
  `Cannot find module '../../src/control/integrationCommands.js'`; panel file failed on missing `web/dist` (built it with
  `npm run build --workspace web`, gitignored).
- Rerun `tests/panel/integrationApi.test.ts > $S/t1b.txt` rc=1, 4/4 failed: `expected [ 404, 'route-not-found' ] to deeply
  equal [ 403, 'control-verb-human-only' ]`, GET answered `route-not-found`, POST answered 404 not 400, unknown repo
  `route-not-found` not `control-target-not-allowed`.

GREEN (at `e018413`):
- `vitest run tests/control/integrationScheme.test.ts tests/control/workspaceSettings.test.ts tests/entry/skill.test.ts
  tests/panel/workspaceModeApi.test.ts tests/panel/integrationApi.test.ts tests/panel/humanOnly.test.ts
  tests/panel/permissions.test.ts tests/control/errorClassification.test.ts tests/panel/webParity.test.ts > $S/t1c.txt`
  rc=0, 9 files, 70 tests passed.
- `npm run typecheck > $S/tc.txt` rc=0; `npm run --ws check > $S/webcheck.txt` rc=0 (74 files, 525 tests).
- Broad `vitest run tests/control tests/panel tests/entry > $S/t1-broad.txt` at `e018413`: rc=1, 3 failed / 1860 passed /
  52 skipped. (a) `refusalCoverage` — real: the six new codes had no zh entry -> fixed in `9c36d72`. (b)
  `driverRequirementSplit` and (c) `controlShutdown` "makes it exit cleanly" — both on the known load-flake list; re-run
  alone (`$S/t1-flake.txt`, `uptime` 10:22 load 9.01 14.45 15.69) both passed.
- Broad rerun at `9c36d72` (`$S/t1-broad2.txt`): rc=0, 200 files passed / 8 skipped, 1863 tests passed / 52 skipped. The
  52 skips are the real-ccloop criteria (`ORCA_CCLOOP_BIN` unset in this run).

## Mutation table

Clone: `git clone --local` of `e018413` at `$S/mut-t1` (`npm ci`, web built). Driver `$S/mut-t1-run.py`, summary
`$S/mut-t1-summary.txt`, per-mutation output `$S/mut-t1-M1-<n>.txt`. Restore after each: `git checkout -- .`, then
`git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0 (all 21 rows).

| id | mutation | red test | assertion seen red |
|---|---|---|---|
| M1-1 | `applySetWorkspaceMode` drops the body spread (no RMW) | each setter keeps the other's field | `expected { scheme: { delivery: 'keep' } … } to deeply equal { scheme: {…4}, revision: 2 }` |
| M1-2 | body schema strict without `integration` | 4 store tests incl. the tolerance test | `ZodError` (the writer's parse refuses the field) |
| M1-3 | remove `..` clause | refuses branch "a..b" | `expected true to be false` |
| M1-4 | VERB_ACCESS `any` | refuses an agent on the socket and a member | `TypeError … reading 'code'` (no error body: accepted) |
| M1-5 | remove `//` clause | refuses branch "a//b" | `expected true to be false` |
| M1-6 | remove ends-with `/` | refuses branch "a/" | `expected true to be false` |
| M1-7 | remove ends-with `.` | refuses branch "a." | `expected true to be false` |
| M1-8 | remove ends-with `.lock` | refuses branch "a.lock" | `expected true to be false` |
| M1-9 | keep stored as a field | setting keep removes the field | `expected {…3} to deeply equal { workspaceMode: 'worktree', … }` |
| M1-10 | ignore `failedCheck` | unit refusal + HTTP integration-invalid | `expected {…10} to deeply equal { error: … }`; `expected [ 200, undefined ] to deeply equal [ 400, … ]` |
| M1-11 | no-op check removed | keep-again no-op; same-scheme no-op | `expected 'applied' to be 'no-op-command'` |
| M1-12 | remote existence check removed | names the failing check; HTTP refusal | `expected null to be 'remote-missing'` |
| M1-13 | GitHub identity check removed | names the failing check | `expected null to be 'remote-not-github'` |
| M1-14 | `checkBranchName` skips git | check-ref-format half (`HEAD`) | `expected true to be false` |
| M1-15 | `git remote get-url` instead of raw config | names the failing check (insteadOf rewrites gitlab->github) | `expected null to be 'remote-not-github'` |
| M1-16 | `set-integration-scheme` not projectionless | 4 store tests | `ControlError: control-command-result-invalid` |
| M1-17 | keep early return removed | accepts keep without running git | `TypeError … reading 'includes'` |
| M1-18 | unknown-repository refusal removed | refuses … an unknown repository | `expected 'applied' to be 'control-target-not-allowed'` |
| M1-19 | remote-name check removed | names the failing check | `expected 'remote-missing' to be 'remote-name'` |
| M1-20 | GET integration unknown-repo guard removed | answers an unknown repository 404 on read | `TypeError … reading 'code'` |
| M1-21 | target-name check removed | names the failing check | `expected null to be 'target-name'` |

## Rewrite inventory

- `tests/entry/skill.test.ts`: route/verb/row counts 25 -> 26 and `schemaByVerb` gains `set-integration-scheme`
  (spec §3.4 "tests/entry/skill.test.ts (route count and schemaByVerb)"); two phrases added to the "teaches" list. Equally
  strict (exact counts, every new row parsed by its schema).
- `tests/control/workspaceSettings.test.ts`: not changed (no `toEqual` shape had to widen).

## Files changed

New: `src/control/integrationScheme.ts`, `src/control/integrationCommands.ts`, `tests/control/integrationScheme.test.ts`,
`tests/panel/integrationApi.test.ts`.
Modified: `src/control/workspaceSettings.ts`, `src/control/webProtocol.ts`, `src/control/errors.ts`,
`src/control/webService.ts`, `src/panel/controlApi.ts`, `src/panel/controlAssembly.ts`, `src/panel/humanOnly.ts`,
`web/src/controlTypes.ts`, `web/src/controlApi.ts`, `web/src/locales/zh.ts`, `skills/orca-control/SKILL.md`,
`tests/entry/skill.test.ts`.

## Deviations and concerns

1. `git check-ref-format --branch -- <name>` (spec §8, Global Constraints) does not work: git 2.50.1 prints usage and
   exits 129 for `--` with `--branch`. Implemented as `git check-ref-format --branch <name>`; safe because the pattern
   already refuses a leading `-`. Spec text should get a correction section (spec is published; not edited here).
2. The `@{` clause is not coded: the pattern's character class admits neither `@` nor `{`, so a clause could never fire
   and no mutation could be seen red. Commented in `validBranchName`.
3. `integrationSchemeSchema` is defined in `webProtocol.ts` and re-exported from `integrationScheme.ts` (interface kept).
   Defining it in `integrationScheme.ts` would create an import cycle at module init
   (`webProtocol -> integrationScheme -> workspace -> archive -> budget -> webProtocol`). Types are `z.infer`, structurally
   the interface's union. The body schema stays in `workspaceSettings.ts` as the brief says.
4. Files outside the brief's list: `src/panel/controlAssembly.ts` (wire `resolveRepository`, needed for the repo path per
   controller clarification) and `web/src/locales/zh.ts` (the refusal-coverage criterion requires zh entries for every
   catalog code; Global Constraints also require i18n).
5. `checkScheme` checks the remote for `push-target`/`push-branch`/`github-pr` and the target name for every non-keep
   delivery; it does not check the target branch exists (that is confirm preflight, Task 2). Target default resolution
   (§3: remote HEAD / current branch) is not implemented here: the schema requires an explicit `target`; the brief does
   not ask for defaults.
6. The admission gate is held during the pre-transaction git checks (up to 3 children x 10 s), as confirm holds it during
   its port calls.
7. Ledger: `progress.md` has the controller's uncommitted edits, so I did not write to it; the mutation table is above for
   the controller to record.
8. M1-2 turns red through the writer's `settingsBodySchema.parse` (ZodError) rather than the reader, because every write
   goes through the same schema; the tolerance test is among the four red.
