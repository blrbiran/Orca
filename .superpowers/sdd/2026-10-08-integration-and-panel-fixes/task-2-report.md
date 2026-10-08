# Task 2 report: group copy, `set-group-integration`, confirm approval and preflight

Implementer: subagent of session eaee0f2c, 2026-10-08. Branch `feat/integration-schemes`, base `9c36d72`.
Commit: `5fc4870` feat(control): copy the integration scheme into the group and approve it at confirm.

## Implementation

- `src/control/integrationScheme.ts`: `GroupIntegration` (zod `groupIntegrationSchema`, strict, incl. `transient`,
  `resolution: reconcileRecordSchema.nullable()`), `readGroupIntegration(group)` (no own `integration` key -> null; a record
  that does not parse -> `ControlError("recovery-blocked", "group-integration-invalid")`), `newGroupIntegration(scheme)`
  (null for keep; `frozen:false, state:"idle", transient:0`, rest null), `preflightScheme(repo, scheme, ghBin)`:
  1. Task 1's `checkScheme` (names `remote-name`, `target-name`, `remote-missing`, `remote-not-github`);
  2. target: `local` -> `git rev-parse --verify --quiet refs/heads/<t>`; others -> `git fetch --quiet <r> refs/heads/<t>`;
     on fetch failure `git ls-remote --quiet <r>` decides: answers -> `target`, does not -> `remote`;
  3. `squash` -> parse `git --version`, < 2.40 -> `git-version`;
  4. `github-pr` -> `<ghBin> auth status --hostname <host>` (host from `githubRepoOf` of the raw URL) non-zero -> `gh-auth`.
  The child runner was split into `runChild(bin, cwd, args)` (same env/timeout as Task 1's `runGit`).
- Copy point: `writeImportedPlan` (`src/control/planImport.ts`) — it is the single function both `import-plan`
  (`carry === null`) and `requirement-draft-accept` (`requirementCommands.ts:232`, `carry !== null`) write the group body
  through. The copy is `newGroupIntegration(readIntegrationDefault(store, input.repoId).scheme)`, added only when non-null.
- `set-group-integration` (verb, raw/effective unions with the group target, payload `{ integration }`, result
  `{ kind: "group-integration-set", groupId, integration }`, not projectionless: group revision and projection move).
  `applySetGroupIntegration` (`integrationCommands.ts`), refusal order: `group-not-found`; clarifying -> `group-state-invalid`;
  failed setter check -> `integration-invalid:<check>`; `state:"resolving"` -> `integration-busy`; same scheme -> `no-op-command`.
  Keep deletes the field; from none -> `newGroupIntegration` with `frozen = proposal.state === "confirmed"`; replacing ->
  `{...current, scheme, schemeHash, frozen, state:"idle", reason:null, pending:null, conflict:null, retryAfter:null, transient:0}`
  (keeps `lastIntegrated`, `integratedCommit`, `pr`, `resolution`). Service `setGroupIntegration`: admission gate ->
  replay/revision preflight -> `checkScheme` against `resolveRepository(plan.repoId)` (skipped when the body has no plan) ->
  transaction. Route `POST /api/control/groups/:groupId/integration` + switch case. VERB_ACCESS `human-only`.
- Confirm (`webService.ts`): after the replay check and the existing pre-transaction lookups,
  `integrationPreflight(groupId)` runs `preflightScheme(repoPath, scheme, process.env.ORCA_GH_BIN || "gh")` for a non-keep
  copy (no git child for keep). Inside the transaction, after every existing check (after the skill-lookup failure):
  keep + `integrationHash` present, or non-keep + hash absent/different -> `integration-unapproved`; non-keep + preflight
  failure -> `integration-preflight-failed:<check>`; on success the copy is written `frozen: true`.
  `confirmPayloadSchema.integrationHash: hashSchema.optional()`; `HUMAN_ONLY_FIELDS.confirm = ["integrationHash"]`.
- `reopenProposal` (every proposal change after confirm) writes the copy back `frozen: false` — the approval is a
  confirmation-time fact like the others it drops.
- View: `readControlGroup` spreads `integration: { scheme, schemeHash, frozen, state, reason, lastIntegrated,
  integratedCommit, pr }` only when present; `groupViewSchema.integration` optional strict.
- Web types (`web/src/controlTypes.ts`): verb, result kind, `ConfirmPayloadV1.integrationHash?`, `GroupViewV1.integration?`,
  `GroupIntegrationViewV1`. SKILL.md: route row, owner-only line names `set-group-integration`, completeness note.

## TDD

RED (tests written first, fixture option `integration` added to `tests/control/fixtures/web.ts`):
`TMPDIR=/private/tmp/claude-501/ou/t ./node_modules/.bin/vitest run tests/control/integrationScheme.test.ts tests/panel/integrationApi.test.ts > $S/t2-red.txt`
rc=1, 18 failed / 39 passed: `newGroupIntegration is not a function`, `service.setGroupIntegration is not a function`,
`Cannot read properties of undefined (reading 'schemeHash')` (no view integration), panel routes `route-not-found`/no
human-only refusal. The new unknown-repository HTTP test (deferred Task 1 minor) passed at RED as expected (behaviour
already existed); its mutation M2-26 is the criterion.

GREEN at `5fc4870`:
- same two files `> $S/t2-g1.txt` rc=0, 57 passed; after adding the reopen test `$S/t2-g2.txt` rc=0, 50 passed (control file).
- `vitest run tests/entry tests/panel/humanOnly.test.ts tests/panel/permissions.test.ts tests/panel/webParity.test.ts tests/control/errorClassification.test.ts > $S/t2-e.txt` rc=0, 49 passed.
- `npm run typecheck > $S/tc2.txt` rc=0. `npm run --ws check > $S/t2-web.txt` rc=0 (74 files, 525 tests).
- Broad `vitest run tests/control tests/panel tests/entry > $S/t2-broad.txt` rc=0: 200 files passed / 8 skipped,
  1883 tests passed / 52 skipped (real-ccloop criteria, `ORCA_CCLOOP_BIN` unset). No reds, so no flake classification.
  `uptime` at end: load 10.04 7.65 8.76.

Keep-confirm hash criterion (ledger ruling): the keep test asserts `authorityCommandHash === sha256Canonical({...command,
schema:"orca-authority-command-v1"})` and `effectivePayloadHash === sha256Canonical(payload)` for a command whose payload
has no `integrationHash` key (M2-29 shows it red when the field would default to null).

## Mutation table

Clone `git clone --local` of `5fc4870` at `$S/mut-t2`. `npm ci` hung > 30 min on the ssh git dependency (ccloop) with no
output; stopped it and symlinked the worktree's `node_modules` (read-only use) and copied `web/dist`; clone baseline
`$S/mut-t2-baseline.txt` rc=0, 58 passed. Driver `$S/mut-t2-run.py`, summary `$S/mut-t2-summary.txt`, per-mutation
`$S/mut-t2-M2-<n>.txt`. Restore: `git checkout -- .`; `git diff | wc -c` / `git diff --cached | wc -c` = 0/0 for all 29.

| id | mutation | red test | assertion seen red |
|---|---|---|---|
| M2-1 | hash comparison dropped (only absence refused) | non-keep group: stale hash unapproved | `expected 'applied' to be 'integration-unapproved'` |
| M2-2 | `HUMAN_ONLY_FIELDS.confirm` removed | confirm carrying integrationHash from an agent | `expected [404,'group-not-found'] to deeply equal [403,'control-field-human-only']` |
| M2-3 | keep copied into body (`integration: null`) | import with no default writes no key | `expected true to be false` |
| M2-4 | confirm preflight skipped | refuses integration-preflight-failed | `expected {…(10)} to match object { error }` |
| M2-5 | keep group with a hash not refused | keep group: a hash is unapproved | `expected 'applied' to be 'integration-unapproved'` |
| M2-6 | confirm does not freeze | non-keep confirm freezes the copy | deep-equal mismatch (frozen) |
| M2-7 | reopen keeps `frozen: true` | reopening drops the approval | deep-equal mismatch |
| M2-8 | clarifying refusal removed | refuses … a clarifying group | `expected 'applied' to be 'group-state-invalid'` |
| M2-9 | `failedCheck` refusal removed (apply) | refuses a failed setter check | `expected {…(10)} to match object { error }` |
| M2-10 | busy refusal removed | integration-busy while resolving | `expected 'applied' to be 'integration-busy'` |
| M2-11 | group no-op removed | before confirm: edits… | `expected 'applied' to be 'no-op-command'` |
| M2-12 | keep does not delete the field | before confirm: keep removes the key | `expected true to be false` |
| M2-13 | `pending` not cleared | after confirm: the command is the approval | deep-equal mismatch |
| M2-14 | `frozen` not from confirmed proposal | confirmed keep group's new scheme frozen at once | deep-equal mismatch |
| M2-15 | conflict not reset | resets a conflict to idle | `toMatchObject` mismatch |
| M2-16 | local target check removed | preflight names the failing check | `expected null to be 'target'` |
| M2-17 | unreachable remote reported as `target` | preflight names the failing check | `expected 'target' to be 'remote'` |
| M2-18 | remote fetch check removed | preflight names the failing check | `expected null to be 'remote'` |
| M2-19 | git-version check removed | squash needs git 2.40 | `expected null to be 'git-version'` |
| M2-20 | gh-auth check removed | preflight names the failing check | `expected null to be 'gh-auth'` |
| M2-21 | `checkScheme` skipped in preflight | preflight names the failing check | `expected 'remote' to be 'remote-missing'` |
| M2-22 | view never carries integration | import copies … into body and view | `expected undefined to deeply equal {…}` |
| M2-23 | copy only when `carry === null` | requirement split acceptance copies | `expected undefined to deeply equal {…}` |
| M2-24 | route switch case removed | routes an owner's set-group-integration | `expected [404,'route-not-found'] to deeply equal [404,'group-not-found']` |
| M2-25 | VERB_ACCESS `any` | refuses set-group-integration agent/member | `expected [404,'group-not-found'] to deeply equal [403,'control-verb-human-only']` |
| M2-26 | (Task 1 deferred) `knownRepository` guard before `checkScheme` removed | books the refusal of an unknown repository | `expected [] to include 'int-u'` |
| M2-27 | invalid record read as keep | stored record that does not parse blocks | `expected [Function] to throw an error` |
| M2-28 | service skips the setter check | refuses a failed setter check | `expected {…(10)} to match object { error }` |
| M2-29 | `integrationHash` `.nullable().default(null)` | keep group … adding no bytes | `expected '766fe8…' to be 'b033ab…'` (authorityCommandHash) |

## Rewrite inventory

- `tests/entry/skill.test.ts`: route/verb/row counts 26 -> 27 and `schemaByVerb` gains `set-group-integration`
  (spec §3.4 "tests/entry/skill.test.ts (route count and schemaByVerb)"). Equally strict (exact counts, new row parsed).
- `tests/control/fixtures/web.ts`: additive option `integration` (seeds the repository settings body before import); no
  existing caller changes behaviour.

## Files changed

`src/control/integrationScheme.ts`, `src/control/integrationCommands.ts`, `src/control/planImport.ts`,
`src/control/webProtocol.ts`, `src/control/webService.ts`, `src/panel/controlApi.ts`, `src/panel/controlViews.ts`,
`src/panel/humanOnly.ts`, `web/src/controlTypes.ts`, `skills/orca-control/SKILL.md`, `tests/entry/skill.test.ts`,
`tests/control/fixtures/web.ts`, `tests/control/integrationScheme.test.ts`, `tests/panel/integrationApi.test.ts`.

## Concerns / decisions to ledger

1. Preflight `remote` vs `target` for non-local deliveries: a failed `git fetch` is split by a second child,
   `git ls-remote --quiet <remote>` (answers -> `target`, else `remote`), instead of parsing locale-dependent stderr. One
   extra child only on the failure path.
2. Confirm's preflight result is not keyed to the scheme hash: a `set-group-integration` between the pre-read and the
   transaction is caught by the group revision CAS (it bumps the revision), so no extra branch. A writer that changes the
   group body without bumping the revision before confirm would bypass this; none exists today (Task 3's pass only acts
   on frozen groups) — Task 3+ should keep it so.
3. After confirm, `set-group-integration` runs only the setter check (`checkScheme`), not the full preflight — spec §3.3
   lists preflight for confirm only. A post-start scheme whose target branch is missing will surface at integration time.
4. Replacing a scheme resets `retryAfter: null, transient: 0` (backoff belonged to the old target/remote) in addition to the
   brief's `state idle`/`pending` cleared/`conflict` null; `pr`, `resolution`, `lastIntegrated`, `integratedCommit` kept.
5. Added (not in brief): `reopenProposal` unfreezes the copy; `set-group-integration` refuses a clarifying group
   `group-state-invalid` (it would be overwritten at accept). Both tested and mutated (M2-7, M2-8).
6. `writeImportedPlan` now reads the repository settings body: a body that does not parse blocks import of that repository
   (`recovery-blocked:repository-settings-invalid`) where it previously did not matter to import.
7. No `web/src/controlApi.ts` helper for the group route yet (the UI task can add it); no new user-facing strings, so no i18n.
8. Mutation clone uses a symlinked `node_modules` (npm ci hung on the ssh ccloop dependency).
