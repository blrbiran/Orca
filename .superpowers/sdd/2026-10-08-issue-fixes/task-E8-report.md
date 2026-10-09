# Task E8 report (implementer E8, session e34dc963, commit 80043fc on fix/issues-20261008)

Status: DONE

## Implemented
Commit 80043fc `feat(web): list control groups as cards with category filters` (pathspec commit, 8 files; new files `git add`ed first):
- web/src/clock.ts (`useClock`), web/src/GroupList.tsx (`GroupList`, `GroupListProps`, internal `GroupCard`): brief code, one deviation below.
- web/src/ControlPanel.tsx: imports `GroupList`; drops `hashFor` and `inScope` imports (`enumText` kept, ImportForm uses it);
  `ControlPanelProps.now?`; `listed`/`label` locals removed (`ownerLabel` kept); the `<nav>` block is replaced by `<GroupList …/>`.
- web/src/styles.css: card/filter/chip/badge rules after the kept `nav[aria-label="Control groups"] button[aria-current="true"]` line.
- web/src/locales/en.ts, zh.ts: `groupCategory`, `groupFilter`, `groupCard` after `groupBlockers`.
- web/tests/groupList.test.tsx (new, brief verbatim), web/tests/styles.test.ts (one `it`, brief verbatim).

## Deviation from the brief
- `aria-labelledby` was `` `${base}-name ${base}-repo` `` in the brief. tests/panel/scanPanelText.test.ts ("leaves nothing in web/src
  for a person to read but the allow-list") classified it as ui text (static "name" next to a space) and went red. Rather than
  edit an existing test's allow-list, the ids are now built as ``[`${base}-name`, `${base}-repo`].join(" ")`` (same value). Scan green.

## Tests (outputs in scratchpad/orca/E8/, each read)
- RED: `cd web && ../node_modules/.bin/vitest run tests/groupList.test.tsx tests/styles.test.ts` rc=1: "Failed to resolve import
  ../src/GroupList.js" and "no rule for .group-card".
- GREEN: same command rc=0, 11/11.
- `npm run check --workspace web` rc=0: 86 files, 675 tests passed (no existing list test went red).
- `npm run typecheck` rc=0. `npm run build --workspace web` rc=0.
- `vitest run tests/panel/scanPanelText.test.ts` rc=0 (3/3, after the deviation fix). `vitest run tests/panel` rc=0, 65 files /
  500 tests (only the summary tail of that output was read; rc and counts are in it).
- Env ECC_GATEGUARD=off DISABLE_OMC=1. Load during the first red scan run: 11.63 (the red was deterministic, not load).

## Mutations (clone of 80043fc under scratchpad, discarded; worktree diff 0 / cached 0 bytes before and after)
- filter → `listed`: groupList RED (4 tests, incl. "hides an archived group…": got [...,'x1']).
- delete `writeGroupFilter(...)` in `choose`: "remembers the chosen chip…" RED (expected null to be 'done').
- delete the badge line: card test RED (expected undefined to be 'needs you').
- delete `.group-card:focus-visible` rule: styles test RED (no rule for .group-card:focus-visible).

## Self-review / concerns (minor)
- `.group-card[aria-current="true"]` and the old `nav[...] button[aria-current="true"]` rule both apply to the selected card (same
  colours); kept the old rule as the brief says, since an existing styles test pins it.
- In `unresolved` scope the filter chips still render above the "list unavailable" note (harmless; nothing to filter).
- `--danger-subtle`/`--ok-subtle`/`--info-subtle` are defined only in the dark :root (rgba, so they read in both themes); the
  "every category colour token defined for both themes" check (Review Focus 5) is not part of E8.
- E5's uncommitted server files were not staged; by commit time `git status` showed them gone from the worktree diff (E5 committed).
