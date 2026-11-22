# 2026-11-23 tester round: #393(b), #385 v9, syncskill backup/build

Session `032cc670`. Human: allow-push; 尽量做完；不考虑 context；「这次批准改写所有必要的判据。这一轮允许必要的付费真跑」；
临时允许 push ccloop／Orca；完成后允许 push 四仓。**No paid provider call this round.**

## Rulings (controller, reversible; human to review)
- **#385 v9**: implemented (spec `docs/superpowers/specs/2026-11-23-split-instruction-v9-design.md`). v9 adds an optional
  `deliveryGraph` answer key + instruction rule; `validateSplitDraft` keeps a draft to its own claimed graph (4 hand-back
  reasons). Code cannot compare the graph to prose — that stays a paid evaluation, deferred to the human (§5 of the spec).
  Kept the two existing hints (requirementUnits / requirementDelivery) as backstops.
- **#393(b)**: request-scoped `GroupSourceCache` shared by readControlSummary and readControlOverview on the two routes.
  Review caught a regression (overview reader is stricter than summary; a readable group became unreadable) — fixed with a
  fallback to the summary's own reader on a recovery-blocked refusal, criterion added.
- **syncskill `.backup-*` recovery**: receiver `recover-backup` (restores the only backup when live is gone; never replaces
  live; refuses to guess between two); transport + CLI `prune --recover-backups` (dry-run unless `--apply`).
- **syncskill build bug**: `shx cp -r src/receiver dist/receiver` nested when the target existed ⇒ every rebuild after the
  first left dist/receiver stale; the new verb never reached dist. Fixed with `rm -rf dist/receiver` before the copy.
- **ccmem #395 tail-bound**: NOT done — 2 MB upper bound still awaits the human (§八). Fix 1 (parse once) already landed.

## Criteria changed (human approved all necessary rewrites this round)
- `tests/control/splitRequirementConflicts.test.ts`: default version V7/V8 → V9, schema → SPLIT_JSON_SCHEMA_V9, template
  ordering (deliveryGraph line sits above notes). Ruling lines added.
- `tests/control/multiDirOverview.test.ts`: single-repo split schema → V9, head → version 9. Ruling lines added.
- `tests/control/fixtures/requirementHarness.ts`: split head list gains v9.

## New criteria
- `tests/panel/summaryOverviewSharedRead.test.ts` (3): shared-read parse count; same bytes with/without cache; a group the
  overview reader refuses stays readable in the summary.
- `tests/control/splitDeliveryGraph.test.ts` (6): v9 head/rule/v8 bytes; no-graph passes; unassigned; edge outside order
  (bad + good); independent edge; final-verification (bad + good).
- `tests/integration/transport.test.ts`: recover-backup receiver (2) + transport (1).
- `tests/unit/build-receiver-assets.test.ts`: rm-before-cp order + no nested receiver.

## Gates
- Orca quick: after #393(b) commits, `taskNoteOldReviewRun` red → fixed → green; 1463 pass. New + adjacent panel tests green.
- Orca wide: started at load ~159 over 938 files; result pending at handoff-write time (see handoff §3 for the number).
- syncskill `npm test` **855/855** green; build RC0. (Two 5 s timeouts at load 159 on a rerun; green on the next full run.)

## Mutations (each turns only its own criterion red, restored to 0 B diff)
- #393(b): summary ignores cache → work-body parse count 1→2 red.
- #393(b) review: drop the fallback → the readable-group criterion red.
- v9: unassigned / edge / independent / final-verification each → 1 failed / 5 passed.
- syncskill: drop recover-backup wiring → 2 red; drop rm-before-cp → 1 red.
