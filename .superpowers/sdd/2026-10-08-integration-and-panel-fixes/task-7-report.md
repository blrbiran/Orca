# Task 7 report: the integration UI (spec §3.1, §3.2, §6.5, §9.1)

Implementer: a subagent of session eaee0f2c, 2026-10-08. Branch `feat/integration-schemes`, base `fab1764`.
Every git command used `git -C <abs path>`. The main checkout `/Users/biran/code/skills/loop/Orca` was not touched.
`progress.md` was not edited or staged.

Commits:
- `3f81edd` feat(panel): suggest a repository's integration target and list its read
- `cac9c07` feat(web): choose, approve and follow a group's integration
- `2516fad` test(web): pin the page's read, save and suggestion of the integration

## What was implemented

### Server (controller ruling: `suggestedTarget`)
- `src/control/integrationScheme.ts` `suggestedTarget(repo)`: on the shared runner (`runChild`, quiet git, child env,
  timeout), local refs only. It returns, in order:
  - the branch that `git symbolic-ref --quiet refs/remotes/origin/HEAD` names (with the `refs/remotes/origin/` prefix removed);
  - otherwise `git symbolic-ref --quiet --short HEAD`;
  - otherwise null. Null also covers a detached HEAD and git not answering (timeout or spawn failure).
- `webService.suggestedTarget(repoId)` returns null when the repository path does not resolve.
- `GET /api/control/repositories/:id/integration` is now `asyncRoute`. It reads the suggestion before it reads the settings.
- `repositoryIntegrationSchema` gains `suggestedTarget: string | null`. The suggestion is never stored, and no command or
  transaction is involved.

### SKILL.md
- `repositories/<id>/integration` is now in the `get` list, next to `repositories/<id>/workspace`.
- The three `groups/<groupId>/integration*` rows moved below `requirement/accept`, so the five requirement rows are contiguous.

### Web
- `web/src/IntegrationScheme.tsx` (new):
  - `integrationSentence(scheme, groupId)` gives plain words for keep and for each delivery × trigger (github-pr has a separate sentence per trigger) in en and zh.
  - `integrationReasonText(reason)` uses the §6.5 code up to the first colon to pick its words and shows git's text after the colon as sent.
    An unknown code is shown as sent. All 17 codes the pass and the resolution write have words.
  - `SchemeForm` sends exactly the delivery's fields. Method appears only for local and push-target, and remote is hidden for local.
    keep sends `{delivery}` alone.
  - A repository without a scheme starts from remote `origin` and the server's `suggestedTarget`.
  - Save is disabled while a non-keep scheme has an empty target.
  - `RepositoryIntegration` is the Task control section: owners edit it, members get the sentence plus "Only an owner can change the integration.".
  - `GroupIntegrationConfirm` is the confirm step: the sentence, plus the owner's form, which sends `set-group-integration` at the group's commandRevision.
    A member of a non-keep group sees "Only an owner can confirm a group whose work Orca merges or pushes.".
  - Owner and member are told apart by `mayHumanOnly(useContext(AccountContext))`.
- `BudgetEditor.tsx`:
  - It renders `GroupIntegrationConfirm` while the proposal is editable.
  - The confirm payload spreads `integrationHash: view.integration.schemeHash` only for a non-keep group, so a keep group's payload has no such key.
  - Confirm is disabled, and sends nothing, for a member on a non-keep group.
- `GitScheme.tsx`:
  - For a keep group it keeps the "Merge into main / Push: waiting on a person" lines.
  - For a non-keep group it shows instead: the sentence, approved or not (`frozen`), the state, "Why: <reason in words>", the last integrated work commit, the commit the target was set to, and the PR link (#n, draft or ready).
  - Owners get Retry (blocked or conflict) and Resolve with an agent (conflict only). Members get neither.
  - The header comment was edited in place: the keep-case sentence is kept, and a sentence says non-keep merging and pushing are Orca's per the integration spec, with Rule 15 governing agents developing Orca.
- `ControlGroupView.tsx` passes `onCommand` to GitScheme. It also passes `integrationFor(repoId)?.suggestedTarget` to the confirm step.
- `ControlPanel.tsx` renders `RepositoryIntegration` beside `WorkspaceModeSelector` and passes `integrationFor` down.
- `App.tsx`:
  - `integrations` state and `readIntegration`, numbered per repository like `readWorkspace`. They are read for the panel repository and the open group's repository.
  - `sendRepositoryIntegration` sends the scheme. A refusal goes under `@repository:<id>`, and the page reads the scheme back afterwards.
- `web/src/controlApi.ts`:
  - New `ControlAction` variants and routes for `set-group-integration`, `retry-integration` and `resolve-integration-conflict`.
  - New `sendIntegrationScheme(repoId, integration, expectedRevision, commandId?)`.
  - The GET (`fetchRepositoryIntegration`) already existed.
- `web/src/controlTypes.ts`: `RepositoryIntegrationV1.suggestedTarget` and `SetGroupIntegrationPayloadV1`.
- Locales: `control.integration.*` in en and zh. That covers the labels, deliveries, triggers, methods, sentences, states, PR, buttons and the 17 reasons.
- Board spec `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md`: a section "Corrections (2026-10-08, session eaee0f2c)" was appended.
  The text above it is untouched: the diff is 7 insertions and 0 deletions, and the file was 5613 bytes before.

## TDD evidence

Every run was redirected to a file under `$S` and read back.
- **Server RED** (`$S/t7-red-server.txt`): `vitest run tests/panel/integrationApi.test.ts` gave rc=1, with 2 failed and 9 passed.
  - `expected { …(4) } to deeply equal { …(5) }`: suggestedTarget is missing.
  - `expected undefined to be 'trunk'`.
- **Server GREEN** (`$S/t7-green-server.txt`): rc=0, 11 passed.
- **Skill RED** (`$S/t7-red-skill.txt`): rc=1, with 2 failed.
  - The requirement rows were `expected 7 to be 4`: they were split.
  - The `get` list lacked the integration read.
- **Skill GREEN** (`$S/t7-green-skill.txt`): rc=0, 6 passed.
- **Web RED** (`$S/t7-red-web.txt`): rc=1. The test suite failed to load with `Failed to resolve import "../src/IntegrationScheme.js"`.
  That is a load failure, not a per-assertion failure; the per-assertion reds are the mutations below.
- **Web GREEN** (`$S/t7-green-web.txt`): rc=0, 25 passed. With the two page-level criteria it is 27 (`$S/t7-web2.txt`).
- **The pseudo-locale criterion found two real problems, both fixed:**
  - The en state word "conflict" is a substring of the raw code `revision-conflict` that the fixture shows. It became "merge conflict".
  - The repository sentence's literal `<group>` placeholder was untranslated. It is now `control.integration.anyGroup`: en "[group]", zh "[组名]".

Final runs at `2516fad` (and at `cac9c07` for the broad run):
- `npm run typecheck > $S/t7-tc.txt`: rc=0.
- `npm run --ws check > $S/t7-webcheck3.txt`: rc=0, 75 files and 554 tests.
- `npm run build --workspace web > $S/t7-build.txt`: rc=0. The only warning is the chunk-size warning that was already there.
- `vitest run tests/panel/integrationApi.test.ts tests/entry/skill.test.ts tests/control/integrationScheme.test.ts > $S/t7-server.txt`: rc=0, 70 passed.
- `vitest run tests/panel tests/entry > $S/t7-broad.txt` (at `cac9c07`; `2516fad` changes only a web test): rc=0, 71 files and 519 tests.
  `uptime` showed load 11.42 7.26 5.90.

## Mutation table

- **Setup:** clone `git clone --local` at `$S/mut-t7`, checked out at `2516fad`. `node_modules` and `web/node_modules` are symlinked to the worktree's, and `web/dist` was copied.
- **Baseline:** green, in `$S/mut-t7-baseline-web.txt` and `$S/mut-t7-baseline-srv.txt`.
- **Files:** the driver is `$S/t7-tools/mut.py`. The summary is in `$S/mut-t7-run.txt` and the digest in `$S/mut-t7-digest.txt`. Each mutation's output is in `$S/mut-t7-<id>.txt`.
- **Restore:** after each mutation, `git checkout -- .`. Every row has `git diff` and `git diff --cached` both at 0/0 bytes.
- **Test files:** W* rows ran `web/tests/integrationScheme.test.tsx`, S* rows ran `tests/panel/integrationApi.test.ts`, and K1 ran `tests/entry/skill.test.ts`.

| id | mutation | red test | assertion seen red |
|---|---|---|---|
| W1 (brief) | confirm always sends `integrationHash` | confirms a keep group with no integrationHash key | `expected true to be false` |
| W2 | confirm never sends it | confirms with the view's schemeHash | `expected {…} to match object { verb: 'confirm', payload: {…} }` |
| W3 | member block of confirm removed | member … sends nothing | `expected "vi.fn()" to not be called` |
| W4 | member's owner-only note removed | member … sends nothing | `Unable to find … Only an owner can confirm …` |
| W5 | note shown for keep too | lets a member confirm a keep group | `expected <p role="note"> to be null` |
| W6 | confirm-step editor shown after confirm | offers no change once confirmed | `expected <section…> to be null` |
| W7 | method shown for every delivery | pre-fills …; github-pr without a method | `expected <select> to be null` |
| W8 | remote shown for local | local without a remote | `expected <input value="origin"> to be null` |
| W9 | local payload carries remote | local payload; owner's group change | deep-equal mismatch |
| W10 | push-branch/github-pr payload carries method | 3 payload tests incl. App save | deep-equal mismatch |
| W11 | push-target drops method | github-pr / push-target payloads | deep-equal mismatch |
| W12 | keep pre-fill remote "" | pre-fills origin | `expected '' to be 'origin'` |
| W13 | suggestion ignored | pre-fill tests (6 red) | `expected '' to be 'develop'` |
| W14 | stored scheme's target replaced by suggestion | starts from the stored scheme | deep-equal mismatch |
| W15 | empty-target Save enabled | offers no Save while … no target | `expected false to be true` |
| W16 | repo form for members | read-only for a member | `… to contain 'Only an owner can change the integrat…'` |
| W17 | group form for members | member … sends nothing | `expected [ <button> ] to deeply equal []` |
| W18 | group change at revision 0 | owner change under the group's revision | deep-equal mismatch |
| W19 | keep lines for every group | Git area facts / Retry / Resolve (4 red) | `… to contain 'After each task: push orca/g …'` |
| W20 | Retry only on conflict | sends retry-integration for blocked | `Unable to find … "Retry integration"` |
| W21 | Resolve in every state | no Resolve for blocked; neither idle/resolving | `expected <button> to be null` |
| W22 | Retry/Resolve for members | member gets neither button | `expected [ …(2) ] to deeply equal []` |
| W23 | reason line removed | facts; conflict reason | `… to contain 'Why: the push was refused: …'` |
| W24 | git's words after the colon dropped | facts; reason text | `expected 'the push was refused: ' to be '…: remote: permiss…'` |
| W25 | unknown code not shown as sent | reason text | `expected 'control.integration.reason.integratio…' to be 'integration-something-new:x'` |
| W26 | PR link removed | facts | `Unable to find … link "Pull request #12 (draft)"` |
| W27 | github-pr sentence ignores trigger | spec's own example | `expected 'When the group completes: …' to be '…'` |
| W28 | retry route → `/integration` | group verbs' routes | `expected '…/integration' to be '…/integration/retry'` |
| W29 | repository POST payload not wrapped | App save; `{ integration }` post | deep-equal mismatch |
| W30 | repository section not rendered in ControlPanel | placed in Task control; App save | `Unable to find … region "Integration"` |
| W31 | approved/unapproved inverted | facts | `… to contain 'Approved when the group was confirmed'` |
| W32 | method word dropped from sentences | says each one differently | `en: expected 9 to be 13` |
| W33 | ControlGroupView drops the suggestion | suggests the open group's own repository target | `expected '' to be 'trunk-z'` |
| W34 | App never reads the panel repository's integration | App read/save/read-back | `Unable to find role="region" and name "Integration"` |
| W35 | App does not read back after a save | App read/save/read-back | `expected [ Array(1) ] to have a length of 2 but got 1` |
| W36 | resolve route → `/integration/retry` | group verbs' routes | `expected '…/retry' to be '…/resolve'` |
| W37 | Retry/Resolve at revision 0 | retry; resolve | deep-equal mismatch |
| S1 | origin/HEAD branch not used | suggests origin's HEAD first … | `expected 'trunk' to be 'develop'` |
| S2 | current-branch fallback removed | read-back body; suggestion | `expected null to be 'trunk'` |
| S3 | `head.ok` check removed (detached) | suggestion | `expected '' to be null` |
| S4 | route answers `suggestedTarget: null` | read-back body; suggestion | `expected null to be 'trunk'` |
| K1 | SKILL.md `get` list without the integration read | teaches the rules … | `… to contain '`repositories/<id>/workspace`, `repos…'` |

The skill row-order criterion's red is the pre-change SKILL.md (Skill RED above, `expected 7 to be 4`).

## Rewrite inventory

- **`tests/panel/integrationApi.test.ts`, the "reads keep at revision 0 …" test:**
  - Its two exact `toEqual` bodies gain `suggestedTarget: "trunk"`. They are still exact, and the field comes from the controller ruling for Task 7.
  - `setUp` runs `git init -b trunk` with every `GIT_*` variable stripped, so the branch name is deterministic.
- **`tests/entry/skill.test.ts`:** additive only. One phrase was added to the "teaches" list, plus a new "keeps the requirement rows together" test.
- **`web/tests/i18nPseudo.test.tsx`:** additive only. A new "integration" area renders the repository section with every field showing, the confirm step and a conflicted Git area with PR and reason. Its Chinese check is "交给 agent 解决".

## Concerns

1. **No way to change a group's scheme after confirm in the UI.**
   - Spec §6.5 offers "change scheme" as the recovery for several blocks (e.g. `integration-pr-refused`), and §3.1 allows `set-group-integration` after start.
   - §9.1 places editing only on the confirm step. An editor in the Git area of a confirmed keep group would also break the board spec's C4 criterion ("no button" in the Git section).
   - Left out as not asked. An owner can still send it through the API. To decide: add a "Change integration" control to the Git area for non-keep groups.
2. **Confirm is disabled for a member on a non-keep group.** It is disabled rather than sent and refused (403 `control-field-human-only`), and a note says why.
3. **The suggestion only exists for repositories the page has read.** The confirm step's suggested target comes from the page's read of the group's repository, made when the group is opened. In All-projects mode without that read, a keep group switched on starts with an empty target, and Save stays disabled until a target is typed.
4. **The repository sentence uses a translated placeholder for the group.** It says `orca/[group]` (zh `orca/[组名]`), since the default applies to every future group.
5. **Clone left in place:** `$S/mut-t7` was not deleted. Deleting it is the human's call, as for `mut-t1` through `mut-t6`.

## Fix round 1 of 5 (controller rulings F1-F4)

Commit: `251801a` fix(web): keep a started group's scheme an owner's to change, and apply a late suggestion.

### F1: a started group's scheme can be changed in the UI
- After confirm, `ControlGroupView` renders `GroupIntegrationConfirm` (the confirm step's editor). It sits after the Git section, outside it, so the Git section stays button-free for keep groups and board C4 holds.
- It is shown for keep and non-keep groups alike, and sends `set-group-integration` at the group's commandRevision.
- A member gets the scheme in words plus "Only an owner can change the integration.", with no Save. The confirm-only note is shown before confirm only.

### F2: a suggestion that arrives late now reaches the form
- `SchemeForm` keeps a `targetTouched` ref. When `suggestedTarget` changes, an effect copies it into `target`, but only while the target is empty and the person has not typed in it.
- An emptied field counts as touched, so a later suggestion leaves it empty.

### F3: board spec correction
- One bullet was appended to the correction section of `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md`: C4 now holds for keep groups only.
- The diff is 3 insertions and 0 deletions; nothing above the bullet was edited.

### F4: already done in the first pass
- `integration-markers-remaining`, `integration-resolution-spawn` and `integration-resolution-terminal` already have en and zh text.
- All three are already in the reason-coverage list of 17 codes. No change was needed.

### New criteria (`web/tests/integrationScheme.test.tsx`, now 32 tests)
- **F1:**
  - An owner switches a started keep group to push-branch and the exact payload is sent; the Git section still has no button.
  - An owner changes a blocked non-keep group's trigger and the exact payload is sent.
  - A member gets the read-only view with no button.
- **F2:**
  - A late suggestion fills an empty, untouched target.
  - Typed text, including an emptied field, is never overwritten.

### TDD
- **RED** (`$S/t7f-red.txt`): rc=1, with 4 failed and 28 passed.
  - The three F1 tests failed with `Unable to find … region "Integration of this group"` or a missing note.
  - The F2 fill test failed with `expected '' to be 'late'`.
  - The F2 "never overwrites" test passed at RED, because the old code never applied a late suggestion. Its red is mutation F2-2.
- **GREEN** (`$S/t7f-green.txt`): rc=0, 32 passed.

### Checks at `251801a`
| check | result |
|---|---|
| `npm run typecheck` (`$S/t7f-tc.txt`) | rc=0 |
| `npm run --ws check` (`$S/t7f-webcheck.txt`) | rc=0, 559 tests |
| `npm run build --workspace web` (`$S/t7f-build.txt`) | rc=0 |
| `vitest run tests/panel/integrationApi.test.ts tests/entry/skill.test.ts` (`$S/t7f-server.txt`) | rc=0 |

No server source changed in this round.

### Mutations
- Run in clone `$S/mut-t7` at `251801a` with driver `$S/t7-tools/mutf.py`.
- The summary is in `$S/mut-t7f-run.txt`; each mutation's output is in `$S/mut-t7f-<id>.txt`.
- Restore is 0/0 bytes for every row.

| id | mutation | red test | assertion seen red |
|---|---|---|---|
| F1-1 | no editor after confirm | the three F1 tests | `Unable to find … region "Integration of this group"` |
| F1-2 | member's after-confirm note removed | member read-only | `… to contain 'Only an owner can change the integrat…'` |
| F1-3 | group form shown to members | member read-only; member at confirm | `expected [ <button> ] to deeply equal []` |
| F2-1 | late suggestion never applied | fills the target … | `expected '' to be 'late'` |
| F2-2 | touched flag ignored | never overwrites … emptied | `expected 'later' to be ''` |
| F2-3 | suggestion overwrites a non-empty target | starts from the stored scheme | deep-equal mismatch of the field values |

### Rewrite inventory (this round)
- None. The new tests are additive, and no existing test changed.
