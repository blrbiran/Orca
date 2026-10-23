# Tester round 2 — server part — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the
> named reason, then the code, then green.

- **Goal:** the server half of `docs/superpowers/specs/2026-10-24-tester-round2-design.md` (cited "§n"; criteria "Cn";
  §19 / §19.1 take precedence where they refine earlier text): H1 (an estimate breach never changes a group's status;
  non-token growth; proposed-limit conservation; `overGrant` on the run view), the schema 18 → 19 repair, H2 (input
  bound = context window; `estimateGrantFor`), H3 (worker seed at accept), H4 (`autoConfirmBlocker`, the
  `autoConfirmUnlimitedPass`, the `createdByPerson` stamp, the booked condition-10 failure, `groupView.autoConfirm`).
- **Not here:** every web change (H5, H11, H12, the checklist, banners, read-only editors, the agent fold) — a second
  implementer builds them on the view fields this plan adds (`runView.overGrant`, `groupView.autoConfirm`). Web
  criteria C4, C18, C27–C37 are theirs. Exception: the en/zh copy of the new error code
  `auto-confirm-selections-unresolved` (§13), which belongs to the error catalog.
- **Author / anchors:** server implementer subagent of session `ffec7b28`, 2026-10-24, on branch
  `feat/tester-round2-server` from `main` `b8cf5079`. Anchors are the spec's (`fdceeb83`) unless re-measured in a task.
- **Ruling for criterion rewrites:** 「这次批准改写所有必要的判据」 (human, session `ffec7b28`). Each rewrite is named in
  the commit body with the ruling it follows (H1 / H2 / schema 19 / H4 stamp) and why. A test red for any other
  reason is treated as this branch's regression first.
- **Rules:** Rule 9 (each new branch: a named mutation seen red, in a `git clone --local` copy at
  `/private/tmp/orca-ffec7b28/r2s-mut`, log `/private/tmp/orca-ffec7b28/r2s-mutations.log`, restore proved by
  `git diff | wc -c` = 0); Rule 14 (logs redirected to files, read whole); Rule 17 (stores only in `mkdtemp` dirs);
  Rule 18 (`npm test`, never `npm run verify`). Safety boundary §2.2: the pass never sends `flow-effect`, never
  `integrationHash`, never touches a flow child.

## Task 1 — H1 server (§4.2.1, §4.2.2, §4.2.5) — criteria C1, C1a, C1b, C1c, C2, C3

Files: `src/control/usage.ts`, `src/control/budget.ts` (or a new `estimateOverrun.ts`: `growForEstimateOverrun`),
`src/control/webService.ts` (`assertKnownConservation(…, proposedLimit?)`, `editProposal`), `src/control/webProtocol.ts`
(`runViewSchema.overGrant`), `src/panel/controlViews.ts` (`overGrant`). New test `tests/control/estimateBreachAdvisory.test.ts`.

- [ ] C1: estimate run over its grant leaves `draft` `draft` and `ready` `ready`; breach on `run.breaches`. M1 `estimate-breach-blocks`.
- [ ] C2: a work run over its grant still sets `blocked`. M2 `no-breach-blocks`.
- [ ] C3: `overGrant` names exactly the over dimensions (tokens; tokens + activeMs), sorted in `dimensions` order. M3 `overGrant-empty`.
- [ ] C1a: limited → overrun → plain `proposal-edit` / `confirm` refused `recovery-blocked`; raise with `proposedGroupLimit` covering the deficit accepted and clears it; confirm then succeeds; a short raise refused. M1a `old-conservation-order`.
- [ ] C1b: unlimited + activeMs overrun: no deficit; the three limits grow by exactly the excess; one `estimateOverrunGrowth` entry per growing event, never twice; `proposal-set-agent` + `confirm` accepted; a work run's overrun grows nothing. M1b `no-nontoken-growth`, M1c `proposal-not-mirrored`, M1d `grows-for-work-runs`.
- [ ] C1c: every path that books an estimate run's cumulative calls `growForEstimateOverrun` (measure: which paths exist; `settle-unknown-usage` is checked for whether it can reach an estimate run at all). M1e `settle-path-skips-growth` where the path is reachable.
- [ ] Rewrites (H1): `tests/control/estimator.test.ts:184` (`blocked` → `draft`, deficit assertions kept), `tests/control/estimateRetry.test.ts:253-254` (`blocked`/`group-not-prestart` → `draft`/`budget-deficit`).

## Task 2 — schema 18 → 19 repair (§4.3) — criteria C5–C10, C7a, C9a, C9b

Files: `src/control/webService.ts` (extract the body transformation of `reopenProposal` into a pure exported function
over group / proposal / work-item bodies, reserve by `budgetBalance`), `src/control/migrations.ts` (`schemaVersion`
`"19"`, `migrateSchema(store, from, now)`, `repairEstimateBreachedGroups`), `src/control/store.ts` (accept `"18"`, pass
`now`). New test `tests/control/estimateBreachRepairMigration.test.ts`.

- [ ] C5 draft stuck group → `draft`, `statusRepairs` entry (`by`, `at` from the injected clock, sorted `runIds`), revision unchanged. M6 `no-attribution`.
- [ ] C6 confirmed stuck → `draft`, proposal `editable` v+1, tasks `draft`, no `group_orchestration` row; auto-start does not start it. M7 `repair-to-ready`, M7a `orchestration-kept`.
- [ ] C7 work-run breach keeps `blocked`. M8 `repair-any-breach`. C7a clarify/split breaches ignored, flow-draft single-call counts. M8a `count-clarify-breach`, M8b `ignore-other-single-call`.
- [ ] C8 a `work` run present keeps `blocked`. M9 `repair-started-group`.
- [ ] C9 one backup; second open adds none, `groups` bytes equal. M10 `marker-not-moved`.
- [ ] C9a marker reset → re-open → rows byte-equal, one `statusRepairs`. M10a `repair-not-idempotent`.
- [ ] C9b never throws: limited confirmed stuck group with a token deficit repairs (ledger from `budgetBalance`, every §4.3.1 field, `proposal_version` column = body); an unreadable `budget_proposals` body is left alone. M10b `reopen-uses-residual`, M10c `column-not-updated`.
- [ ] C10 every other table byte-equal. M11 `repair-touches-runs`.
- [ ] Rewrites (schema 19): existing criteria that pin `schemaVersion === "18"` or the `pre-v17` backup name of the newest step, each named.

## Task 3 — H2 (§5) — criteria C11–C15, C11a

Files: `src/control/estimator.ts` (`ESTIMATE_GRANT` = 1,000,000 / 1,800,000 / 1 / 1; `estimateGrantFor`; input bound =
window; `withEstimateGrant(prepared, grant)` re-freezes the contract), `src/control/estimateRetry.ts` (bound = window;
retry grant; `reserve-insufficient` on non-token dims or a 0 token reserve of a limited group),
`src/control/webService.ts` (`createEstimate`, retry reservation), `src/control/planImport.ts` (import grant).
New test `tests/control/estimateGrant.test.ts`.

- [ ] C11 `estimateGrantFor` table. M12 `grant-fixed-250k`, M13 `limited-ignores-remaining`, M13a `ignores-cap-headroom`, M13b `headroom-below-request-used`.
- [ ] C11a repository cap headroom 400,000 → grant 400,000, claimed (not cap-blocked). M13c `cap-read-after-reserve`.
- [ ] C12 limited 200,000 remaining, required 300,000, window 1,000,000 → queued, grant 200,000; window 250,000 → `input-too-large`. M14 `input-bound-by-grant`.
- [ ] C13 `retryPromptFits` ignores the grant, keeps the window. M15 `retry-bound-by-grant`.
- [ ] C14 0 remaining → `group-budget-unavailable`; 1 remaining → 1-token grant. M16 `zero-remaining-queues`.
- [ ] C15 limited 600,000 remaining: row, contract and claimed run carry 600,000; claim equality passes. M17 `contract-keeps-cap`.
- [ ] Rewrites (H2) per §16.2: `importPlanStoredBytes.golden.json`, `driverEstimate.test.ts:21`, `driverEstimateHandoff.test.ts:43,61`, `estimator.test.ts:58,79,103`, `estimateE2E.test.ts:82`, `tokenPolicy.test.ts:105,158`, `singleCallOutputCap.test.ts:89-93`, `estimateRetry.test.ts:270-283` (three skip cases + a 1-token retry), `debugGroup.test.ts:208` (delete; mutation: reserve an estimate grant for the debug group ⇒ `:207` red); recheck `estimateWithdrawn.test.ts`, `fixtures/web.ts:155-157`.

## Task 4 — H3 (§6.2.1) — criteria C16, C17

Files: `src/control/requirementCommands.ts` (seed in `applyRequirementDraftAccept`). New test
`tests/control/requirementAcceptWorker.test.ts`.

- [ ] C16 accept seeds `agentOverrides.worker` from the opener's pick; tasks resolve to it with provenance `group`. M18 `no-worker-seed`.
- [ ] C17 existing worker kept; no pick ⇒ no worker key; plan group agent ⇒ no worker key, tasks resolve to the plan's agent. M19 `seed-overwrites-worker`, M19a `seed-masks-plan-agent`.

## Task 5 — H4 server (§7.2, §7.3) — criteria C19–C26, C22a–C22d

Files: new `src/control/autoConfirm.ts` (`AutoConfirmBlockerCode`, `AutoConfirmBlocker`, `autoConfirmBlocker(store,
group, defaults)`, `autoConfirmViewOf`), `src/control/planImport.ts` (`createdByPerson` stamp in `writeImportedPlan`,
which both import and accept use), `src/control/errors.ts` (+ en/zh copy) for `auto-confirm-selections-unresolved`
(durable 422), `src/control/webService.ts` (`autoConfirmUnlimitedPass`), `src/panel/controlAssembly.ts` (pump: after the
flow pass, before `autoStart`), `src/control/webProtocol.ts` + `src/panel/controlViews.ts` (`groupView.autoConfirm`).
New test `tests/control/autoConfirmUnlimited.test.ts`.

- [ ] C19 confirmed by `orca-auto`, orchestration `mode: "run"`, started by the same pass (pass then `autoStart`). M22 `auto-confirm-hold`.
- [ ] C20 limited never. M23. C21 delivery scheme never, nothing booked, no `integrationHash` row. M24.
- [ ] C22 flow child / system-debug / correction-debug skipped; no `effect_records` / `flow_messages` rows. M25, M25a.
- [ ] C22a condition 11 by principal / schedule origin. M25b, M25c. C22d person-token stamp. M25g.
- [ ] C22b `autoConfirmBlocker` null iff attempted, naming condition and code. M25d `pass-diverges`.
- [ ] C22c condition 10 booked once, `refusedCode`, blocker condition 9 `booked`; condition 8 books nothing. M25e, M25f.
- [ ] C23 running estimate holds; queued is withdrawn `proposal-confirmed`. M26. C24 one attempt per version. M27.
- [ ] C25 operator-default-only agents: not confirmed, nothing booked (condition 10 → booked refusal per N5; see deviation note in the report if C25 and C22c conflict). M28. C26 archived / stopped / stop-intent skipped. M29.
- [ ] Rewrites (H4 stamp): golden bytes that pin the imported group body.

## Task 6 — gate (C38)

- [ ] `ORCA_CCLOOP_BIN=… CCLOOP_CACHE_DIR=… npm test > /private/tmp/orca-ffec7b28/r2s-npmtest.log 2>&1; echo rc=$?`, the log
  read whole; selected count and skips copied as printed. A red not ours is shown red on an untouched `main` first
  (`docs/handoff/known-load-flakes.md`).
