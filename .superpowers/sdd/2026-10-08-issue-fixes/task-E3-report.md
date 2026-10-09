# Task E3 report — archive-group / unarchive-group (spec §6.3)

Implementer E3, session e34dc963, 2026-10-09. Base 585fb72; commit **bcf5584** `feat(control): archive and unarchive a group, refused while its work is in motion`.
Scratch outputs: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/E3/`.

## Implemented
- `src/control/errors.ts`: `archive-call-in-flight`, `archive-integration-resolving`, `archive-run-active`, `archive-stop-pending` (after `agent-selection-changed`), `group-archived` (after `group-already-exists`), all 409.
- `src/control/webProtocol.ts`: verbs in `commandVerbSchema`; raw + effective variants (group target, empty payload); results `{kind:"archived",groupId,at}` and `{kind:"unarchived",groupId}`.
- `src/control/archiveGroup.ts` (new): `applyArchiveGroup`, `applyUnarchiveGroup`, `ArchiveGroupCommand`, `UnarchiveGroupCommand`. Guard order: estimate `running`/`start-unknown` → clarifying group's pending requirement call → non-pause stop intent not `handoff-complete` → integration `resolving` → active run. Archive writes `archived:{at: store.now(), actor}` and an `archived` activity row; unarchive of an unmarked group → `no-op-command`; otherwise deletes the mark and writes `unarchived`.
- `src/control/webService.ts`: `archiveGroup`, `unarchiveGroup` (through `mutate`).
- `src/panel/controlApi.ts`: routes `POST /api/control/groups/:groupId/archive` and `/unarchive`, switch cases.
- `src/panel/humanOnly.ts`: both verbs `"any"`.
- `web/src/controlTypes.ts`: verb union + result union.
- `web/src/locales/en.ts`, `zh.ts`: five entries each, alphabetical (zh uses `{{detail}}` as the brief gives).

## Deviations (and why)
1. **Amendment 6 — skill table moved in from E6.** The two new routes make `tests/entry/skill.test.ts` red (30 rows vs 32 routes). To keep this commit green, E3 also took E6's route-table half: the two `SKILL.md` rows, the two `schemaByVerb` entries, the three counts 30→32, and the comment line `Issue-fixes spec §6.3 added …`; I also corrected the stale comment "30 routes carry the 31 verbs" → "32 routes carry the 33 verbs". **E6 must not redo these**; E6 keeps only the Notes sentence + the phrase-list additions (the Notes sentence describes E4's gate, which does not exist yet). Mutation m12 (delete the archive row → "lists exactly the panel's mutation routes" red) covers E6's first mutation now.
2. **Stop guard reads the derived state, not the stored body's `state`.** The brief read `JSON.parse(stop.body).state`; I use `readStopIntent` + `deriveStopState` (what `groupStopState` returns — the test asserts via `groupStopState`). The stored state is only rewritten opportunistically (`rewriteStopIntentState`), so it can lag; `readStopIntent` also fails loud on an invalid body. Detail stays `<mode>:<state>`.
3. `tests/panel/controlApi.test.ts` new `it`: added `await panel.close()` and a `30_000` timeout like its neighbour in the same describe.

## Tests
- RED (HEAD source + new tests, scratch clone): `vitest run tests/control/archiveGroup.test.ts tests/panel/permissions.test.ts tests/panel/controlApi.test.ts` → rc=1; 8 archiveGroup tests `TypeError: service.archiveGroup is not a function`; HTTP test `expected 404 to be 200`. ("blocks by name" and the permissions assertion pass at HEAD: E2 already exists, and an unknown verb is not human-only; both are pinned by mutations m9/m10 below.) File `e3-red.txt`.
- GREEN: same three files + `tests/entry/skill.test.ts` → rc=0, 23/23 (`e3.txt`); `refusalCoverage`, `humanOnly`, `webParity` → rc=0, 12/12 (`e3-wide.txt`); `npm run typecheck` rc=0 (`e3-tc.txt`); web dist rebuilt first (`build.txt`, rc=0).
- Suites: `vitest run tests/control tests/panel tests/entry` → 2082 passed, 54 skipped, 1 failed: `controlShutdown` "makes it exit cleanly…" `expected 143 to be +0` — registered flake (handoff.md), load 7.8–11; alone rc=0 6/6 (`suites.txt`, `shutdown-alone.txt`, `uptime.txt`). `npm run --workspace web check` rc=0, 83 files / 649 tests (`webcheck.txt`).

## Mutations (clone of bcf5584, each `-t` on the named test; outputs `m*.txt`)
| Mutation | Result |
|---|---|
| m1 delete estimate loop | RED (no error returned) |
| m2 delete requirement line | RED |
| m3 delete stop throw | RED — answered `archive-run-active` (as the brief predicts) |
| m4 `state !== "handoff-complete"` → `true` | RED "under a handoff stop that is complete" |
| m5 delete integration line | RED |
| m6 delete run line | RED |
| m7 delete `archived` recordActivity | RED first test |
| m7b delete `unarchived` recordActivity | RED unarchive test |
| m8 delete `no-op-command` throw | RED |
| m9 `archivedMarkOf` throw → `return null` | RED "blocks by name" |
| m10 `archive-group` access → `human-only` | RED permissions test |
| m11 delete unarchive route | RED HTTP test |
| m12 delete SKILL.md archive row | RED skill route test |
| m4b drop `intent.mode !== "pause"` | **GREEN — equivalent mutant**: a pause intent always freezes `[]`, which derives `handoff-complete`, so the exemption is unobservable today. Kept: it mirrors `groupStopState`'s pause special case and keeps the rule correct if a pause ever freezes runs. |

Worktree proof: `/usr/bin/git diff | wc -c` = 4030 before, 4288 after; `--cached` 0/0. The non-zero diff is **not mine**: it is D7's in-progress `tests/control/executionDriverE2E.test.ts` (sole file in `git diff --stat`), growing while I ran; no E3 path was touched by the mutation step (it ran only in the clone).

## Self-review / concerns
- E4 will gate `archive-group` itself on an archived group (`group-archived`); until then re-archiving an archived group re-stamps the mark (no guard here by design — E4's CALLS table lists `archive-group`).
- zh `archive-*` use `{{detail}}` per brief (most zh entries use `{{message}}`; already a recorded minor pattern).
- Equivalent mutant m4b above.
