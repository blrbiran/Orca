# Task 14 report — the model drop-down, refresh, and the unavailable reason (spec §5)

Implementer: Orca session a852f96a subagent, 2026-10-16. Worktree /Users/biran/code/skills/orca/Orca-wt/every-agent-chain
(branch codex/every-agent-chain), base 3b811679. LOGS = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs.

Status: DONE_WITH_CONCERNS (concerns are minor, listed at the end).

## Commits
- 727fbdc6 `fix(control): refuse a models answer that does not echo the requested installation` (the Task 13 review Minor, promoted by ruling)
- 468fc969 `feat(web): offer omp and codex models as a datalist with refresh and the unavailable reason`

## Part 1 — installation echo (727fbdc6)
- `src/control/ccloopPort.ts` listModels: after the schema parse, `view.installation !== installation` ⇒
  `ControlError("control-response-invalid","installation-not-echoed")`, the same pattern as resolveAgent's `selection-not-echoed`.
- `tests/control/fixtures/fake-ccloop-control.mjs` (fixture change, add-only): a new `models` method branch (answers
  `ccloop-models-v1` for the requested installation, or `config.modelsInstallation` when set). Other methods unchanged.
- `tests/control/ccloopPort.test.ts`: new `it("refuses a models answer that does not echo the requested installation")`.
- RED: `$LOGS/t14-echo-red.log`: RC=1, the new test fails with "promise resolved { installation: 'omp' … } instead of rejecting".
- GREEN: `$LOGS/t14-echo-green.log`: ccloopPort + ccloopModels (real ccloop, ORCA_CCLOOP_BIN set, not skipped) + agentModelsApi, 3 files / 29 tests, RC=0.
- Mutation (`if(false&&view.installation!==installation)`), clone /private/tmp/mut14-JXIg/repo:
  `ed78be663d24cb2cdc257add49b0a5650739acd49c874c58b8e7be37e74ffbed  src/control/ccloopPort.ts`; red seen in the new test: yes
  (`$LOGS/t14-echo-mut.log`, RC=1). Restore: clone diff 3857 bytes = worktree diff 3857, cached 0 / 0.

## Part 2 — Task 14 (468fc969)
Files: web/src/controlTypes.ts (`AgentModelsViewV1`, `ModelListState`), web/src/controlApi.ts (`fetchAgentModels`),
web/src/AgentFields.tsx (datalist, loading line, `role="note"` reason, Refresh button), web/src/AgentSelectionEditor.tsx,
web/src/AgentSettings.tsx, web/src/ControlGroupView.tsx, web/src/ControlPanel.tsx (props threaded; the last two were not
named in the brief, but the editor is mounted through them: App → ControlPanel → ControlGroupView → AgentSelectionEditor),
web/src/App.tsx (state, `loadModels`, a read per omp/codex row after `setAgents`, `onRefreshModels` only for an owner),
web/src/locales/en.ts + zh.ts (`agents.models.*` and the three ccloop codes, texts copied from the brief), tests:
web/tests/agentModelsDatalist.test.tsx (new, 5 tests), tests/panel/refusalCoverage.test.ts (only-add: one new `it`).

Differences from the brief:
- The Refresh button is rendered just **after** the `</label>`, not inside it. In the M14.5 run's DOM dump, a button inside the
  label made the input's accessible name "模型 Refresh models", and HTML allows a label only one control. The logic and the
  mutation line are unchanged; M14.4 was re-run after the move (below).
- On failure, App reads the ccloop detail with `refusalDetail(refusal)` (as `explainRefusal` does), not
  `message.slice("ccloop-failed:".length)`. It gives the same result for the server's `ccloop-failed:<code>: <detail>` message.
  Other codes keep detail "" as the brief says, so `agent-installation-missing` reads "…has no installation of this agent."
- The test for case 3 asserts the en.ts text for omp-model-catalog-unavailable (now at en.ts:1359, it was :1358) with the detail filled in.

RED (before implementation): `$LOGS/t14-red-web.log`: RC=1, 4 of 5 failed (tests 1, 3, 4, 5; test 2 passes on the old code
because claude never had a list, and M14.2 below shows it can go red). `$LOGS/t14-red-cov.log`: RC=1, new `it` lists the 3 missing codes.

GREEN:
- `$LOGS/t14-g1-web.log` (5/5), `$LOGS/t14-g1-cov.log` (7/7).
- `$LOGS/t14-build3.log` web build RC=0; `$LOGS/t14-ws-check3.log` `npm run --ws check` (tsc + whole web suite) 132 files / 1134 tests RC=0.
- `$LOGS/t14-root-named2.log` refusalCoverage + scanPanelText + tests/metrics: 11 files / 75 tests RC=0.
- Extra: `$LOGS/t14-root-tsc.log` root tsc RC=0; `$LOGS/t14-root-panel.log` whole tests/panel + ccloopPort + ccloopModels: 82 files / 652 tests RC=0
  (this ran before the button move. The move touches web only and the web suite was re-run after it).

Mutations (clone /private/tmp/mut14-JXIg/repo, each run of web/tests/agentModelsDatalist.test.tsx, log `$LOGS/t14-mut-all.log`):
| # | mutation | sha256 of mutated file | red seen in named test | restore (clone diff / cached / worktree diff) |
|---|---|---|---|---|
| M14.1 | `list={undefined}` | 697604648767f002d79bc9e0bd65ec751f1afa40426adc34ad539331ece0e955 AgentFields.tsx | yes, test 1 (and 4) | 33179 / 0 / 33179 |
| M14.2 | `effective.kind !== "claude-never"` | 7da8f3d5d48fef024671f72b7f783a9b0770f11c531c80ca944dcfa54caaa800 AgentFields.tsx | yes, test 2 | 33179 / 0 / 33179 |
| M14.3 | `unavailable` line removed | 4a45c22223eca6e16f0bf52d53d5e56ea8649c9693fce0aaf10bd95ff4a34d7e AgentFields.tsx | yes, test 3 | 33179 / 0 / 33179 |
| M14.4 | `props.onRefreshModels !== undefined &&` removed | 9a6a7e8b8108dc30d5fbbfabf725e364115637817a6cec263daa141d2a06ec3f AgentFields.tsx | yes, test 4 (no-button half) | 33179 / 0 / 33179 |
| M14.4b | same, re-run after the button move (`$LOGS/t14-M14.4b.log`) | 140fdabda973d3183e68b29069d96fe277610d43fdb0eadcc669e1c4e2503346 AgentFields.tsx | yes, test 4 | 33333 / 0 / 33333 |
| M14.5 | zh `refresh` → "Refresh models" | c327c7d52613b85edc8dd9a448d0dc00c30439f495fb4405d2af54ce733e08ac zh.ts | yes, test 5 | 33179 / 0 / 33179 |

Clone left in place: /private/tmp/mut14-JXIg/repo (its node_modules and web/node_modules symlinks removed). Holds the
uncommitted copy of both commits' changes.

Wording rule (§6.2): `git diff -U0 | grep -i '^+.*\(bounded\|capped\|caps \|cap \)'`: no match (rc=1).
DESIGN.md: no new colour or tone. The reason is `role="note"` with no data-tone (a fact beside a box that still works,
like the existing missingAgent note). The Refresh button is a plain secondary `type="button"`. No new font size. No section is
conditionally mounted (only inline hints/controls inside the always-mounted fieldset).

## Rewritten criteria
None.

## Self-review
Read both diffs ($LOGS/t14-c1.diff and the final diff). Found and fixed: the button sat inside the label, and `loadModels` sat
between `loadAgents`'s doc comment and `loadAgents`. Moved both (re-verified).

## Concerns (minor)
1. No web↔server parity pair for `AgentModelsViewV1` in tests/panel/webParity.test.ts. It is outside the brief's file list,
   so the web type is a hand mirror of `agentModelsViewSchema` that no test checks.
2. `loadModels` has no sequence guard. If an older read answers after a Refresh, it can overwrite the newer list (the
   workspace reads in App use a `*Seq` ref for this). Likely rare, because both answers come from ccloop's cache or a probe of the same installation.
3. Every `loadAgents` call (initial, retry, after an agent update) re-reads each omp/codex list, one ccloop spawn each, which ccloop's
   file cache serves. This follows the brief. It is noted because each read spawns a process.
4. Whether an unavailable model list should carry `data-tone="warn"` is a taste call. The brief's markup (no tone) was kept.

## Fix round 1 (2026-10-16, Orca session a852f96a subagent): commit e2bfdc0e
`fix(web): number model-list reads, skip a background read in flight, keep a read list on screen`

Changes:
1. web/src/App.tsx `loadModels`: `modelsSeq = useRef<Record<string, number>>({})` is bumped on each call. An answer whose number has
   moved on is dropped (same pattern as `workspaceSeq`/`integrationSeq`).
2+3. `modelsInFlight = useRef<Record<string, boolean>>({})`: a background read (`refresh` false, which is every loadAgents path,
   including the focus/visibility `returnNonce` reloads) returns early while that installation's newest read is in flight.
   The loading reset now leaves a `ready` entry in place, so the datalist stays on screen until the new answer lands.
   An owner's Refresh (`refresh` true) always reads.
4. tests/panel/webParity.test.ts: `agentModelsServerToWeb`/`agentModelsWebToServer` pair (imports + the reference list) beside the
   agents-view pair.

New criteria: web/tests/agentModelsApp.test.tsx. It drives App against a fake panel and releases model answers by hand. Three tests:
(a) owner Refresh while the first read is in flight, then the newer answer lands first and the older one second ⇒ the list stays the newer one;
(b) after a ready list, two focus events in a row ⇒ agents read twice, models requested once more (2 in total);
(c) after a ready list, a focus-driven re-read is pending ⇒ the datalist is still rendered and "Reading the model list…" is absent; its answer then replaces the list.

RED before the fix (`$LOGS/t14f-red2.log`, RC=1): (a) got `["gpt-6-old"]`, (b) got 3 requests, (c) got no datalist (null).
(`$LOGS/t14f-red.log` is the first run. Test (a) failed there on a harness ambiguity: several codex fieldsets each offer Refresh.
It was fixed to click the first. I read that log through a filter, which breaks Rule 14. `t14f-red2.log` was read whole.)
GREEN: `$LOGS/t14f-green.log` (agentModelsApp + agentModelsDatalist, 8/8). `$LOGS/t14f-build.log` RC=0. `$LOGS/t14f-ws-check.log`
(`npm run --ws check`: web tsc + 133 files / 1137 tests) RC=0. `$LOGS/t14f-root.log` (webParity + refusalCoverage, 12 tests) RC=0. Root tsc RC=0.

Mutations (clone /private/tmp/mut14-JXIg/repo, synced to the worktree and cmp-checked per file; the restore baseline is the clone's
own pre-mutation `git diff` = 36675 bytes, cached 0; all logs in `$LOGS/t14f-mut-all.log`):
| # | mutation | sha256 | red seen | restore |
|---|---|---|---|---|
| F1 | seq check `if (modelsSeq.current[id] !== seq) return;` removed | 189d7d9597c5b6007a0e4513220c3fa996f725b4165e8108776fde3c76d24d25 App.tsx | yes, (a) got gpt-6-old | 36675 / 0 |
| F2 | in-flight skip removed | d6dc9e51356fed9cf9a99d113f7e14fe4cf672dd292751df91e0cb14acfff026 App.tsx | yes, (b) got 3 requests | 36675 / 0 |
| F3 | loading reset unconditional | fdd0a0e8c53a7aa840028cab81e6f420412a346a4fc40c72ed0d722729bfd881 App.tsx | yes, (c) datalist null | 36675 / 0 |
| F4 | web `source` loses `"none"` (parity drift) | cd930a526b65517818ced2b5102f13359f0f4bc76440344e74cafc7b59762edb controlTypes.ts | yes, root tsc TS2322 at webParity.test.ts:247 | 36675 / 0 |

Clone symlinks removed again. No existing criterion rewritten.
One design choice beyond the letter: an owner's Refresh also keeps a ready list on screen while it reads. The "Reading…" line
shows only when there is no list yet. That keeps one rule for both kinds of read.
