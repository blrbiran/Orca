# Tester round 2 — web part — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the
> named reason, then the code, then green.

- **Goal:** the web half of `docs/superpowers/specs/2026-10-24-tester-round2-design.md` (cited "§n"; criteria "Cn";
  §19 / §19.1 take precedence where they refine earlier text): H1/H2 banners and read-only editors (§4.2.3, §4.2.5),
  the confirm checklist and H4's unlimited lines (§7.3, §7.4), H3's agent fold (§6.2.3–5), H5 task goal summaries (§8),
  H11 hash routes (§9), H12 shortcut list (§10), and every en/zh key of §13 not yet present.
- **Base:** branch `feat/tester-round2-web` from `feat/tester-round2-server` `7726b8e6` (worktree
  `/private/tmp/orca-ffec7b28/r2w`). It reads the server's `runView.overGrant`, `groupView.autoConfirm`,
  `ledger.budgetDeficit` and the error code `auto-confirm-selections-unresolved`.
- **Author / attribution:** web implementer subagent of session `ffec7b28`, 2026-10-24.
- **Baseline (Rule 14):** `(cd web && npx vitest run) > /private/tmp/orca-ffec7b28/r2w-web-baseline.log 2>&1` at
  `7726b8e6`: 160 files, 1423 tests passed, rc 0.
- **Ruling for criterion rewrites:** 「这次批准改写所有必要的判据」 (human, session `ffec7b28`). Each rewritten web
  criterion is named in its commit body with the item it follows and why; any other red is this branch's regression first.
- **Rules:** Rule 9 (each new branch: a named mutation seen red, in a `git clone --local` copy at
  `/private/tmp/orca-ffec7b28/r2w-mut`, log `/private/tmp/orca-ffec7b28/r2w-mutations.log`, restore proved by
  `git diff | wc -c` and `git diff --cached | wc -c` = 0); Rule 14 (logs to files, read whole); Rule 18 (`npm test`).
  No `~/.orca`, no panel restart, no merge, no push.

## Known server gap (measured before planning)

The banner copy names the run's **grant** (§13 `control.group.estimateOverGrant`, `control.group.blockedBanner`), but
the run view carries `used` and `remaining` only, and `remaining` is clamped at 0 (`src/panel/controlViews.ts:892,
1034`), so the grant of an over-grant run cannot be derived in the browser. The web part strictly needs it: one
optional run-view field `grant` (the run's grant in its bucket), added beside `overGrant` in
`src/control/webProtocol.ts` and `src/panel/controlViews.ts`, with its own criterion. Reported as a deviation.

## Task 1 — run view `grant` + web types

Files: `src/control/webProtocol.ts`, `src/panel/controlViews.ts`, `web/src/controlTypes.ts` (`RunViewV1.overGrant`,
`RunViewV1.grant`, `GroupViewV1.autoConfirm`). New test `tests/control/runViewGrant.test.ts`.

- [ ] The run view's `grant` equals the stored run's `grant.work` for an estimate run. Mutation `grant-missing`.

## Task 2 — H1 web (§4.2.3, §4.2.5) — C4

Files: `web/src/ControlGroupView.tsx`, locales. New test `web/tests/estimateBanner.test.tsx`.

- [ ] Estimate run with `overGrant` ⇒ one `role="status"` line per dimension (run, dimension, used, grant). M4 `banner-missing`.
- [ ] `summary.state === "blocked"` ⇒ `role="alert"` blocked banner naming the first non-estimate over-grant run; the
  BudgetEditor and AgentSelectionEditor render read-only. M5 `blocked-editors-open`.
- [ ] A token deficit left by an estimate overrun ⇒ `control.group.estimateDeficit`. Mutation `deficit-line-missing`.

## Task 3 — confirm checklist (§7.4 items 1, 2, 4, 5) — C27, C28 (sequence part)

Files: `web/src/BudgetEditor.tsx` (`confirmBlockers`), `web/src/ControlGroupView.tsx` (static review lines removed),
locales (remove `control.preparation.agentReview/.integrationReview/.tokenPolicy/.sequence`, `budget.confirmWaits`).
New test `web/tests/confirmChecklist.test.tsx`.

- [ ] Each blocker alone shows its `data-blocker` line and disables both buttons; none ⇒ `budget.blocker.none`. M30, M31.
- [ ] The `sequence` copy is rendered nowhere on the group page. M32.

## Task 4 — H3 agent fold (§6.2.3–5) — C18

Files: `web/src/AgentSelectionEditor.tsx`, locales. New test `web/tests/agentInheritFold.test.tsx`.

- [ ] Per-task fields in a closed `<details>` (`agents.overrideTask`); open with an own override or a failed slot. M20.
- [ ] `agents.inheritLine` counts only inheriting task slots, names the worker's `agent · model`. M21.
- [ ] `agents.noWorker` with a `#global-settings` link when the worker role is `agent-unselected`. Mutation `no-worker-missing`.
- [ ] Rewrite existing criteria that click per-task fields directly (they now sit in a closed `<details>`), each named.

## Task 5 — H4 unlimited lines (§7.3, §7.4 item 3) — C28 (rest)

Files: `web/src/BudgetEditor.tsx`, `web/src/ControlGroupView.tsx`, locales. Test: `web/tests/confirmChecklist.test.tsx`.

- [ ] Unlimited + eligible: pending line replaces the starts note; estimate / own-agent / refused lines on their
  conditions; delivery scheme ⇒ integration line. M33 `refused-line-missing`; mutation `pending-line-missing`.

## Task 6 — H5 goal summary (§8) — C29

Files: `web/src/ControlGroupView.tsx`, `web/src/DependencyGraph.tsx`, `web/src/styles.css`.
New test `web/tests/taskGoalSummary.test.tsx`.

- [ ] Table: `goalSummary(goal)` with the full goal in `title`; graph: goal line at y=32, clip, `<title>`, NODE_H 104. M34, M35.

## Task 7 — H11 codec (§9.2) — C30

Files: `web/src/sections.ts`. New test `web/tests/routes.test.ts`.

- [ ] Round trip for every grammar row with characters that need encoding; every fallback. M36, M37.

## Task 8 — H11 App (§9.3, §9.4) — C31–C35, C33a–C33d

Files: `web/src/App.tsx` (`navigate`, `applyRoute`, `pendingRoute`, back line, cross-project line), `web/src/BackLine.tsx`,
`web/src/ControlPanel.tsx`, `web/src/ControlGroupView.tsx` (route region/openTask), `web/src/FlowBoard.tsx`
(`openFlowRunId`), `web/src/RunDecisions.tsx` / `TaskDetail.tsx` (origin), `web/src/Shell.tsx` (export `NAV_KEY`).
New test `web/tests/routeApp.test.tsx`.

- [ ] C31 M38, C32 M39, C33 M40, C33a M40a/M40b, C33b M40c, C33c M40d, C33d M40e, C34 M41/M42/M42a, C35 M43.

## Task 9 — H12 (§10) — C36, C37

Files: `web/src/reviewKeys.ts` (`SHORTCUTS`), `web/src/ShortcutsHelp.tsx`, `web/src/Shell.tsx`.
New test `web/tests/shortcutsHelp.test.tsx`.

- [ ] `?` opens nothing; footer button → `<dialog>` `showModal`, `aria-labelledby`, focus return. M44, M44a.
- [ ] `SHORTCUTS` letters = what `reviewKeyAction`/`isRetryKey` act on over a–z. M45.

## Task 10 — gate (C38)

- [ ] `ORCA_CCLOOP_BIN=… CCLOOP_CACHE_DIR=… npm test > /private/tmp/orca-ffec7b28/r2w-npmtest.log 2>&1; echo rc=$?`,
  read whole; selected count and skips copied as printed.
