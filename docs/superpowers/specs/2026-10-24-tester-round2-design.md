# Tester round 2 — estimate grant, auto-confirm, agent inheritance, task names, hash routes — design

Status: draft for the human's review, revision 1 (review findings applied in place; mapping in §19). Written by a spec-drafting subagent of Orca session `ffec7b28`, 2026-10-24.
Facts measured on Orca main `fdceeb83` (`git log -1 --format=%h`), working tree clean. Line numbers were taken with
`grep -n` / `sed -n` / `cat -n` at that commit and are valid only there (Rule 14). Nothing was run against a paid agent.
`~/.orca` was only read, with `sqlite3 "file:…?mode=ro"` (§2.3).

Inputs: the triage `.superpowers/sdd/2026-10-23-session-0e13a9b7/tester-triage-20261023.md` (P0 #8/#9, P1 #3/#6/#12,
P1 #10/#14/#19, P2 #4, P2 #5/#16, delta section D2 for #45/#46/#47/#51/#52, #55, §3 and D4 human decisions); the
rulings in `.superpowers/sdd/2026-10-23-session-0e13a9b7/progress.md:179,193,195`; the tester's raw issues
`orca_archived_files/issue-20261023.md` (Issues 3, 4, 5, 6, 8, 9).

## 1. Scope

In scope, one section each:

| Item | Tester issues | Ruling | Section |
|---|---|---|---|
| An estimate breach never changes a group's status; stuck groups repaired once | #8, #9 | H1 | §4 |
| The estimate grant is split from the preflight's input bound; warn past it, never block | #9 | H2 | §5 |
| The requirement's agent becomes the group worker default; the per-task prompt folds away | #3, #6, #12 | H3 | §6 |
| Unlimited-token groups confirm on their own; a computed confirm checklist | #4, #10, #14, #19 | H4 | §7 |
| Tasks show a summary of their goal (table and graph) | #5, #16 | H5 | §8 |
| One hash route scheme; a shared back line; cross-project links ask before switching | #45, #46, #47, #51, #52 | H11 | §9 |
| No global single-letter shortcuts; a list of the keys that exist | #55 | H12 | §10 |

Already done in session `0e13a9b7`, not re-specified: the `.sr-only` CSS rule (#2, #11, #18), merged as `f6f2cf3e
fix(web): Task 11 acceptance — cards, goal summary and run page details` (`web/src/styles.css:242`). The same commit
rewrote `goalSummary` (`web/src/CardGoal.tsx:14-23`), which §8 reuses.

Out of scope: H6–H10 (next session, `progress.md:179`); the preparation-page reorder (#7/#13), #11's column hiding,
#53 (scroll), #54 (drag targets) — none of them was ruled on, and none is needed by the items above.

## 2. Rulings (verbatim) and the security boundary

### 2.1 Rulings

- **H1** (`progress.md:179`): "agree — an estimate breach never changes a group's status (record on the run, banner);
  stuck groups repaired by a one-time migration limited to groups whose only blocking cause is an estimate breach
  (install backs up the DB first)."
- **H2** (`progress.md:179`, verbatim): 「这次卡死更不可取，至少这个上限要放宽，且超上限之后仅提示用户异常而不是卡住不让做。」
  Refined and agreed 2026-10-24 (session `ffec7b28`): split the two jobs `ESTIMATE_GRANT` does today
  (`src/control/estimator.ts:19`, 250k tokens, also the preflight's input bound): the input bound follows the selected
  model's context window; the estimate grant is 1,000,000 tokens / 30 minutes in unlimited-token groups and
  min(group remaining, 1,000,000) in limited groups; past it, warn only (run record + banner), never block.
- **H3** (`progress.md:179`): "agree — the agent picked on New requirement becomes the group's worker default after
  accept (still editable)." Plus: fold away the per-task ×N override prompt.
- **H4** (`progress.md:179`, verbatim): 「如果是 token 不限模式，为什么不能自动确认？非要那么大费周章去让人找确认预算按钮吗？」
  ⇒ in unlimited-token mode the budget is confirmed automatically when nothing else blocks; limited mode keeps a
  prefilled one-click confirm. Also the computed confirm checklist (#10/#14/#19).
- **H5** (`progress.md:179`): "agree — show a summary of the task goal, no plan-hash change."
- **H11** (`progress.md:193,195`): adopt the hash route scheme (`parseRoute`/`formatRoute` in `web/src/sections.ts`, one
  `navigate()` in `App.tsx`, a shared back line); a link to another project's group shows a line + switch button, no
  auto switch.
- **H12** (`progress.md:193,195`): no global single-letter shortcuts (Vimium, WCAG 2.1.4); at most a `?` overlay.

### 2.2 The security boundary stays

Releasing a held external or irreversible flow effect needs person authority on every path (gaps spec
`docs/superpowers/specs/2026-10-22-flow-phase1-gaps-design.md:987-995`, §21 entry 8; enforced by `releaseRefusal`,
`src/flow/messages.ts`). Nothing in this spec touches that path:

- The automatic confirm of §7 sends only the `confirm` verb (classified `any`, `src/panel/humanOnly.ts:13`) for a
  group's budget. It never sends `flow-effect`, never writes `effect_records` or `flow_messages`, and it skips every
  flow child group (`body.flow` present; those are confirmed by `confirmChild`, `src/flow/childPort.ts:92-112`).
- It never carries `integrationHash` (a `human-only` payload field, `src/panel/humanOnly.ts:108`): a group with a
  delivery scheme (`readGroupIntegration(group) !== null`) is never confirmed automatically (§7.2 condition 6).
- It confirms only groups a person created, or that a person's schedule fired (§7.2 condition 11): never a group an
  agent imported, never one a run Orca dispatched created.

### 2.3 What `~/.orca` holds now (read-only)

Command (Rule 14, at `fdceeb83`, 2026-10-24):

```
for db in ~/.orca/control/*/control.sqlite; do sqlite3 "file:$db?mode=ro" \
  "SELECT value FROM meta WHERE key='schemaVersion'; SELECT g.id FROM groups g WHERE json_extract(g.body,'$.status')='blocked';"; done
```

Result: `orca-e0c92460` schema `13`, no blocked group; `panel` schema `18`, no blocked group. The tester's stuck group
(`requirement-ee636dcd-…`) is not on this machine (triage line 10-12). So the §4.3 migration is exercised here only by
criteria on temp stores; on this machine it will repair 0 groups.

## 3. Terms

- **Unlimited-token group**: a Web group whose `limit.tokens === null` (`BudgetAmount`, `src/control/tokenPolicy.ts:7`).
  The panel shows it as "Unlimited"/「不限」 (`web/src/locales/en.ts:797`, `zh.ts:674`). A requirement opens unlimited
  by default (`REQUIREMENT_LIMIT_DEFAULT.tokens: null`, `src/control/requirementSchemas.ts:13`), and an accepted
  requirement carries that limit (`src/control/planImport.ts:314`).
- **Limited group**: a Web group whose `limit.tokens` is a number.
- **Group remaining (tokens)**: `limit.tokens − used.tokens − committedRemaining.tokens`, read at the moment an estimate
  is created and before its own grant is reserved. It is the proposal's `explicitUnallocatedReserve.tokens` at that
  moment (`src/control/planImport.ts:319`, `src/control/webService.ts:585-586`).
- **Estimate run**: a run whose stored `phase` is `"estimate"` (`src/control/singleCall.ts:7-9, 21`). This is the only
  run kind §4 and §5 change.
- **Estimate grant**: the `Amount` an estimate is created with — on the estimate row (`grant`), in its execution
  contract (`grant`, `src/control/webProtocol.ts:422`), and as the estimate run's work grant
  (`src/control/singleCallLedger.ts:42`). It is a reservation and the breach line; the single call itself is sent no
  token cap (the envelope carries only `maxOutputTokens`, `src/control/startEnvelope.ts:144`).
- **Input bound**: the preflight's check that the estimate request fits before it is queued
  (`src/control/estimator.ts:121`).
- **Over-grant**: a run whose cumulative usage in its bucket exceeds its grant in some dimension; today recorded as
  `run.breaches.push(eventSeq)` (`src/control/usage.ts:40-41`).
- **Stuck group**: a Web group in status `blocked` whose only cause is an estimate run's over-grant (§4.3.1 gives the
  exact predicate).
- **Auto-confirm**: the `confirm` command Orca sends as `orca-auto` (`ORCHESTRATION_ACTOR`,
  `src/control/orchestration.ts:18`) for an unlimited-token group (§7.2).
- **Confirm blockers**: the computed list of reasons the confirm button is disabled (§7.4); one function decides both
  the list and the button.
- **Route**: the parsed form of the URL hash (§9.2).

## 4. H1 — an estimate breach never changes a group's status

### 4.1 As built (measured)

- `recordUsage` books each usage event; when a cumulative exceeds the run's grant it pushes the breach and, unless the
  group is `clarifying` (DR18), sets `group.status = "blocked"` for any group with `planHash`
  (`src/control/usage.ts:40-44`). It does not look at the run's phase, so an estimate run blocks a `draft` or `ready`
  group.
- `blocked` is set nowhere else in `src/control` (`grep -rnE 'status ?= ?"blocked"' src` → only `usage.ts:43`). No code
  moves a group out of `blocked`.
- A `blocked` group is held: no provider attempt starts (`groupHeld`, `src/control/executionDriver.ts:234-236`).
- `prestart` refuses everything but `draft` and `ready` with `group-state-invalid` (`src/control/webService.ts:274-277`),
  so a blocked group's proposal edit, set-agent, re-estimate and confirm are all refused. The zh copy of that code says
  only 「组当前的状态不允许这个操作。」 (`web/src/locales/zh.ts:1754`).
- The refusal is shown among the alerts at the top of the group view (`web/src/ControlGroupView.tsx:444`), often off
  screen from the button that was clicked (triage #8).
- The run view carries no breach facts: `runViewSchema` (`src/control/webProtocol.ts:1580-1640`) has no breach field;
  `progressOfRun` only hides the token figures of a breached run (`src/panel/controlViews.ts:757`).

### 4.2 Change

1. `src/control/usage.ts:42-43`: a breach by an **estimate run** is recorded on the run only. The condition becomes
   "status changes only if the run is not an estimate run and the group is not `clarifying`". The breach is still
   pushed to `run.breaches` (line 41), the ledger is booked exactly as now (lines 33-39), and the `else
   group.stopped=true` branch for non-Web groups is unchanged. A breach by a work, handoff or other single-call run
   still blocks as before.
2. **Run record on the view.** `runViewSchema` gains `overGrant: z.array(amountDimensionSchema).optional()` — the
   dimensions in which `cumulative[bucket] > grant[bucket]` (bucket `handoff` for a handoff run, else `work`), sorted
   in `dimensions` order, from the persisted run (`src/panel/controlViews.ts:206` already parses `breaches`). The server
   always sends it (an empty array when none); optional on the wire so older fixtures parse, as `git` is.
3. **Banner** (`web/src/ControlGroupView.tsx`, among the alerts after the refusal at :444): for each run in
   `view.runs` with `phase === "estimate"` and a non-empty `overGrant`, one `role="status"` line
   `control.group.estimateOverGrant` (§13) naming the run, the dimension, used and grant (tokens short, as
   `shortTokens` writes them). For a group whose `summary.state === "blocked"`, one `role="alert"` line
   `control.group.blockedBanner` naming the first non-estimate run with a non-empty `overGrant`. While the group is
   `blocked`, the BudgetEditor and AgentSelectionEditor render read-only (the same `archived` read-only path they
   already have), so the page no longer invites edits the server refuses.
4. `group-state-invalid` copy is not changed; the banner names the cause.
5. **No deficit-induced refusal from an estimate overrun (review C1).** H1 alone is not enough: an estimate overrun
   that eats the group's reserve leaves a `budgetDeficit`, and `assertKnownConservation` refuses every prestart command
   while any deficit is non-zero (`src/control/webService.ts:332-334`) — proposal edit, set-agent, re-estimate and
   confirm (`:482, 522, 584, 633, 1604`), including the limit raise that would cure it. Two rules, one per kind of
   dimension:
   - **Limited-token deficit (tokens of a limited group; a person-set bound).** Raising the limit is the way out. A
     `proposal-edit` that carries `proposedGroupLimit` is checked for conservation against **that** limit. Exactly:
     `assertKnownConservation` gains an optional `proposedLimit`; when it is given, the two limit-dependent checks at
     `webService.ts:333-334` — `residual(group.limit, group.used, group.reserved)` equal to the proposal's reserve
     (`residual` itself throws on a deficit, `estimator.ts:38`), and every `budgetDeficit[d] === 0` — are replaced by
     one: `budgetBalance(proposedLimit, group.used, group.reserved).deficit` is 0 in every dimension
     (`src/control/budget.ts:64-74`, which never throws on a deficit). They are evaluated **before** any other use of
     the stored limit, so the stored deficit cannot refuse the raise. The `:327-331` checks and the `:332` ledger-mirror
     equality are unchanged. A `proposal-edit` without `proposedGroupLimit`, and
     every other prestart command, keep today's check, so they stay refused until the raise lands. The edit then
     re-derives the reserve as today (`resetDraftReserve`, `webService.ts:418-422`) and clears
     `group.ledger.budgetDeficit` from the same arithmetic. The banner (§4.2.3) names the deficit and the way out
     (`control.group.estimateDeficit`, §13).
   - **Non-token dimensions (`activeMs`, `attempts`, `sessions`) in every group, and so every deficit an unlimited-token
     group can have.** An estimate run's 30-minute grant can be outrun by its slot's longer `timeoutMs`
     (`singleCallLedger.ts:45`). ⇒ (controller, round 2 N3) The growth happens **in `recordUsage` at breach time**
     (`usage.ts:40-44`), for **estimate runs only**: in the same transaction that books the event, for each non-token
     dimension `d` with `next.cumulative[d] > run.grant.work[d]`, the not-yet-grown part of the excess (the excess minus
     what earlier events of this run already grew) is added to `group.limit[d]`, `group.ledger.groupLimit[d]` and the
     `budget_proposals` body's `groupLimit[d]` — all three kept identical, because both readers refuse a mismatch
     (`group.limit` vs `ledger.groupLimit`, `src/control/stopIntent.ts:166-167`; `proposal.groupLimit` vs
     `ledger.groupLimit`, `src/control/queries.ts:217`) — and recorded as
     `group.estimateOverrunGrowth[] += { runId, eventSeq, dimension, amount, at }` (append-only). So the overrun never
     becomes a deficit in those dimensions, whichever path books the run's usage: a normal usage event, a run recovered
     from `start-unknown`, a recovery retry, or `settle-unknown-usage` (any path that books an estimate run's
     cumulative without `recordUsage` calls the same exported helper `growForEstimateOverrun`). Tokens are never grown
     (writer's decision D11, §15).

### 4.3 The one-time repair (schema 18 → 19)

The repair is a data migration in `src/control/migrations.ts`. `schemaVersion` becomes `"19"` (now `"18"`,
`src/control/migrations.ts:4`). If another spec lands a version 19 first (the parallel spec
`2026-10-24-scheduled-flows-and-groups-design.md:461` also names 18 → 19), this repair takes the next free number,
the `by` value and the backup name (`pre-v<from>`) follow it, and the predicate does not change.

#### 4.3.1 Which rows, and how they are identified

For each row of `groups` (in `rowid` order), with `body = JSON.parse(groups.body)`:

1. `body.status === "blocked"` and `Object.hasOwn(body, "planHash")` (a Web group; only Web groups are set `blocked`,
   `usage.ts:43`).
2. Read every run of the group: `SELECT body FROM runs WHERE group_id=?`. Split the runs with a non-empty `breaches`
   array into **estimate breaches** (`phase === "estimate"`) and **blocking-capable breaches** — every other breached
   run **except** a `single-call` run whose `purpose` is `clarify` or `split` (review I1): those ran while the group was
   `clarifying`, where DR18 records a breach without blocking (`usage.ts:42-43`), so they cannot be why the group is
   blocked.
3. At least one estimate breach.
4. **No** blocking-capable breach. Any one means the group may be blocked for a reason H1 does not cover; it is left
   alone.
5. No run of the group has `phase` `"work"` or `"handoff"`. The group never started, so returning it to a pre-start
   status cannot strand a work run.

The repaired status is **always `"draft"`** (review I2), never `ready`, so nothing a person confirmed days ago starts on
its own after an install. If the proposal was `confirmed`, the repair also reopens it exactly as `reopenProposal`
does (`src/control/webService.ts:425-445`): proposal `state "editable"`, `proposalVersion + 1`, `budgetMode`,
`profiles`, `executionSnapshotHash` null, `contextPolicy {handoffAtContextTokens: null}`, allocations
`draft-encumbered`; each task work item `status "draft"`, `derivedContractHash`/`configHash` null and its frozen agent
fields removed, its `grant` from the proposal; `reconcileSlot` null; an integration scheme `frozen: false`; and the
group's `group_orchestration` row is deleted, so no confirm-time "run" authorization survives. To keep one source,
the body transformation of `reopenProposal` is extracted into a pure function over the group, proposal and work-item
bodies, called by both `reopenProposal` and the migration. The person re-confirms, or §7's auto-confirm does it when
all its conditions — including the person-created condition 11 — hold.

**The repair never throws inside `migrateSchema`** (round 2 N1): a throw there rolls back the migration and leaves the
store unopenable by the new build (`store.ts:118-120`). So the extracted reopen function computes the reserve with
`budgetBalance` (`budget.ts:64-74`, which reports a deficit instead of throwing), **never** `residual` (which throws
`group-budget-unavailable` on a deficit, `estimator.ts:38`; today's `resetDraftReserve` uses it,
`webService.ts:418-422`), and does no schema `parse` that can throw on a stored value. A group whose `groups`,
`budget_proposals` or `work_items` body cannot be read as JSON with the fields the reopen needs is left as it is (not
repaired, not thrown); criterion C9b names it.

Every field the reopen writes for a confirmed stuck group (the same as `reopenProposal` + `saveWebAuthority`,
`webService.ts:361-374, 425-445`, with `budgetBalance` in place of `residual`):

- `budget_proposals`: the `proposal_version` **column** and the body — `proposalVersion + 1`, `state "editable"`,
  `budgetMode`/`profiles`/`executionSnapshotHash` null, `contextPolicy {handoffAtContextTokens: null}`, each allocation
  `state "draft-encumbered"`, `explicitUnallocatedReserve` and the `reserve` allocation's amount =
  `budgetBalance(groupLimit, used, committedRemaining).reserve`.
- `groups.body`: `status "draft"`; the `proposal` mirror (`state`, `proposalVersion`, `planHash`, `budgetMode`,
  `contextPolicy`, `profiles`, `executionSnapshotHash`); `limit = proposal.groupLimit`; `reviewReserve` and
  `reviewRemaining` = the goal-review allocation's amount; `reserved = ledger.committedRemaining` (unchanged value);
  `ledger.groupLimit`, `ledger.used`, `ledger.explicitUnallocatedReserve`, and `ledger.budgetDeficit` from the same
  `budgetBalance`; `reconcileSlot` null; an integration scheme `frozen: false`; `statusRepairs[]`.
- `token_policies`: the group row (`saveTokenPolicy(store, groupId, "", groupLimit.tokens, …)`) and, under the optional
  policy, each task's work row — written with the same values they hold, as `saveWebAuthority` does.
- `work_items`: each task body as `reopenProposal` resets it.
- `group_orchestration`: the group's row deleted.

For a stuck group whose proposal is **not** confirmed only `groups.body.status` and `statusRepairs` change.

The archive mark and the `stopped` flag are not read and not changed: an archived or stopped group that is stuck is
repaired the same way, and stays archived or stopped.

#### 4.3.2 What is written

In the migration transaction (`src/control/store.ts:118-120`), for each selected group only:

- `body.status` = `"draft"`, and for a confirmed proposal the reopen of §4.3.1.
- `body.statusRepairs` (new optional array; appended, never rewritten):
  `{ from: "blocked", to: "draft", reopened: boolean, cause: "estimate-breach", runIds: <estimate-breach runIds, sorted>,
  by: "migration-18-to-19", at: <ms> }`. `at` is the store's clock: `migrateSchema` gains a third parameter
  `now: () => number`, passed from `openControlStore`'s `options.now ?? Date.now` (`src/control/store.ts:47, 113`).
  This is the attribution Rule 13 asks for (who: the migration step; when: `at`; on which commit: the Orca build that
  carries schema 19, recorded by the release that installs it).
- `UPDATE groups SET body=? WHERE id=?` with `JSON.stringify(body)` — the encoding `saveGroup` uses
  (`src/control/queries.ts:43`). The group's `revision` is **not** moved, as `migrateSettings15To16` does not move a
  settings revision (`src/control/migrations.ts:223-231`): no command changed the group. The projection is read fresh
  by every client after a panel restart, which a schema migration implies (the store is opened by the new build).

No run, estimate, usage-ledger or command row changes. For a reopened proposal the rows listed in §4.3.1 change —
including ledger figures in the group body and the `token_policies` rows — so the first draft's "no ledger row
changes" claim is withdrawn.

#### 4.3.3 Backup

Already built: on any schema-version change, `openControlStore` takes one consistent copy before the migration
transaction opens — `VACUUM INTO '<stateDir>/control.sqlite.pre-v18-<ms>'` (a free `-<n>` suffix if taken), mode
`0600`; a failed copy throws and nothing migrates (`src/control/store.ts:110-117`). So the backup precedes the repair
on whichever process first opens the store with the schema-19 build (the panel service after install, or a CLI
command). No new backup code.

#### 4.3.4 Idempotence

- The version marker moves to `"19"` in the same transaction (`finishMigration`/`migrateSchema` pattern,
  `src/control/migrations.ts:245-251, 266-315`); a store at 19 never runs the step again.
- The predicate is idempotent too: a repaired group is no longer `blocked`, so a re-run (a criterion that resets the
  marker) selects nothing and appends nothing.
- `migrateSchema` gains a `fromVersion === "18"` branch (repair, then marker) and every older branch ends with the
  repair before the marker.
- Criterion C9a (§16) proves it directly: open a v18 store (repairs), reset the marker to `"18"` by raw SQL, open again;
  the `groups`, `budget_proposals`, `work_items` and `group_orchestration` rows are byte-equal to the first open's and
  `statusRepairs` has one entry.

#### 4.3.5 Rollback

- Data: stop the panel service; copy `control.sqlite.pre-v18-<ms>` over `control.sqlite` (and remove `control.sqlite-wal`
  and `control.sqlite-shm`); everything written after the migration is lost. Done by the person in their terminal.
- Code: a schema-18 build refuses a schema-19 store (`migrateSchema("19")` falls to `throw new
  Error("control-schema-unsupported")`, `src/control/migrations.ts:310`), so a code rollback needs the data rollback
  above. A single group cannot be put back into `blocked`; nothing should need it.

## 5. H2 — the estimate grant and the input bound are two different numbers

### 5.1 As built (measured)

- `ESTIMATE_GRANT = { tokens: 250_000, activeMs: 900_000, attempts: 1, sessions: 1 }` (`src/control/estimator.ts:19`).
- It is the input bound: `tooLarge = requiredRequestTokens > observed.contextWindowTokens || requiredRequestTokens >
  ESTIMATE_GRANT.tokens` (`estimator.ts:121`), and the retry re-check (`src/control/estimateRetry.ts:83`).
- It is the grant: the contract (`estimator.ts:118`), the estimate row (`webService.ts:590`, `planImport.ts:384`), the
  reservation (`webService.ts:585`, `planImport.ts:304, 317-318`), the retry's grant and reservation
  (`estimateRetry.ts:56, 101, 105`; `webService.ts:2022`), and part of the default limit sizing
  (`planImport.ts:301`; `complex1mDefaults`, `estimator.ts:51`, which has no caller in `src/` — `grep -rn
  complex1mDefaults src`).
- The claim checks `contract.grant === estimate.grant` (`webService.ts:654-656`) and gates it against spend caps by
  `estimate.grant.tokens` (`webService.ts:616, 638, 650`).
- `residual()` throws `group-budget-unavailable` when the reserve after the grant would go below zero in any finite
  dimension (`estimator.ts:32-41`), so today a limited group with less than 250k tokens of reserve cannot be estimated.

### 5.2 Change

1. **Input bound.** `estimator.ts:121` becomes `requiredRequestTokens > observed.contextWindowTokens`; the
   `estimateRetry.ts:83` re-check drops its grant term the same way. `estimate-input-too-large` now means "does not
   fit the selected model's context window", and nothing else.
2. **The grant.** `ESTIMATE_GRANT` keeps its name and becomes the cap
   `{ tokens: 1_000_000, activeMs: 1_800_000, attempts: 1, sessions: 1 }` (1,000,000 tokens / 30 minutes). A new pure
   function in `estimator.ts`:

   ```ts
   export function estimateGrantFor(input: {
     limitTokens: number | null;      // the group's token limit; null = unlimited-token group
     remainingTokens: number | null;  // group remaining (§3); null when limitTokens is null
     capHeadroom: number | null;      // the binding spend cap's headroom at reservation time; null = no cap applies
     requiredRequestTokens: number;   // the preflight's input + output bound for this request
   }): Amount
   // tokens = min(ESTIMATE_GRANT.tokens, remainingTokens (limited groups only),
   //              capHeadroom (only when capHeadroom >= requiredRequestTokens));
   // activeMs / attempts / sessions = ESTIMATE_GRANT's
   ```

   `activeMs`, `attempts` and `sessions` are the cap's in every group (the ruling gives a minimum only for tokens).
   **Spend-cap term (controller's call, review I4):** `capHeadroom` is `capStatuses(store, repoId, at)[0]?.headroom ??
   null` (`src/control/spendCaps.ts:45-57`, the binding cap first), read in the same transaction that reserves the
   grant. ⇒ (controller, round 2 N4) The term is included **only when `capHeadroom ≥ requiredRequestTokens`** (the
   preflight's input + output bound for this request, `estimator.ts:117`; for a retry, the `required` of
   `retryPromptFits`): then the estimate is sized to run now instead of waiting, and an overrun past that smaller grant
   stays warn-only (§5.2.5). Otherwise the term is omitted, the grant exceeds the headroom, and the claim gate
   (`gateClaim`, `spendCaps.ts:84-89`) holds the estimate as today — the person's cap stays hard; it is never sized
   below what the request itself needs. `estimateGrantFor` therefore also takes `requiredRequestTokens`. The headroom can shrink between reservation and claim; the claim gate still decides
   with the frozen grant (`webService.ts:616, 638, 650`).
3. **Where it is computed** (each place that today uses `ESTIMATE_GRANT` as a grant): `createEstimate`
   (`webService.ts:585, 590`), the import (`planImport.ts:304, 317-318, 384`, computed from `limit`, `used` and the
   commitments before the grant, then passed into `buildBudgetEstimateRequest` as a new `grant` input that the contract
   at `estimator.ts:118` freezes), and the retry (`estimateRetry.ts:56, 101, 105`; `webService.ts:2022`, from
   `reserveAfterSettlement` and the cap headroom read in the settlement transaction). The retry's
   `reserve-insufficient` skip (`estimateRetry.ts:56`) then fires when a finite **non-token** dimension of the reserve
   is below the cap's (`activeMs < 1,800,000`, `attempts < 1`, `sessions < 1`) or the token reserve of a limited group is
   0. The default limit sizing (`planImport.ts:301`) keeps adding `ESTIMATE_GRANT` (the cap), so
   a fresh group's finite dimensions cover a 30-minute estimate.
4. **A limited group with 0 tokens remaining** refuses the estimate with the existing `group-budget-unavailable` (at
   `createEstimate`, at import, and as the retry's existing skip `reserve-insufficient`). Before this change the
   threshold was "under 250,000"; it is now "0". (Writer's decision D3, §15.)
5. **Past the grant: warn only.** With §4.2.1 an estimate run over its grant changes no status. The breach is on the run
   (`run.breaches`, `overGrant` in the view) and on the banner (§4.2.3). No stop is added: the single call has no token
   cap to stop it (`startEnvelope.ts:144`); its own `timeoutMs` (the frozen slot's, `singleCallLedger.ts:45`) remains
   the only stop, as today.
6. **Spend caps.** The claim gate is unchanged (`webService.ts:616, 638, 650`; Accounts spec D9). Because the grant
   already fits the binding cap's headroom at reservation (item 2), an estimate waits on a cap only when the cap has no
   headroom left, or lost it between reservation and claim; the existing spend-cap line shows it
   (`ControlGroupView.tsx:464-475`). (Replaces the first draft's D4.)

## 6. H3 — the requirement's agent is the group's worker default

### 6.1 As built (measured)

- `requirement-open` stores the picked agent only as the estimator override:
  `agentOverrides: payload.agent === null ? {} : { estimator: payload.agent }` (`src/control/requirementCommands.ts:106`).
- `requirement-draft-accept` imports the plan with the requirement group's body carried (`existingBody: { ...group }`,
  `requirementCommands.ts:349-351`), so `agentOverrides` survives but has no `worker`.
- The worker slot resolves operator default → group plan → group panel → task plan → task panel
  (`src/control/agentSelection.ts:83`). With no operator default and no plan agent, every task is `agent-unselected`.
- The agent editor renders a full `SelectionFields` plus Set and Clear on every task row
  (`web/src/AgentSelectionEditor.tsx:197-225`): 17 tasks give 17 × 5 controls, read as "required per task" (#6).

### 6.2 Change

1. **Seed at accept.** In `applyRequirementDraftAccept`'s transaction (`requirementCommands.ts:322`), before
   `writeImportedPlan` (`:349`): if `agentOverrides.estimator` is present, `agentOverrides.worker` is absent, **and the
   accepted plan has no group-level agent** (`plan.agent?.group?.agent` undefined — the split chose none; the same `planAgent`
   the accept already reads at `requirementCommands.ts:313-315`), set `agentOverrides.worker =
   agentOverrides.estimator` on the carried body. A plan that names a group agent keeps it (the panel layer would
   otherwise mask it, `agentSelection.ts:83`). An existing worker override is never
   overwritten. The estimator override stays. Seeding at accept (not at open) also covers requirements opened before
   this change.
2. It is an ordinary panel layer: the person changes or clears it with the existing group worker Set/Clear
   (`AgentSelectionEditor.tsx:177-196`), and `proposal-set-agent` reopens the proposal as today.
3. **Fold the per-task fields.** Each task row keeps its resolved cells (`SelectionCells`/`FailedCell`). Its
   `SelectionFields` and Set/Clear move into a `<details>` whose summary is `agents.overrideTask`; it is open by default
   only when that task has its own panel override or its slot failed.
4. **One line above the table**: `agents.inheritLine` — the count of task slots whose resolved agent provenance is not
   `task` or `task-plan`, and the group worker's resolved `agent · model` (from `preview.rolePreviews.worker`).
5. When the group worker role does not resolve because no layer names an agent, the group worker block shows
   `agents.noWorker` with a link to `#global-settings`.
6. No "batch set" button: the group worker slot is the batch set (triage, P1 #3).

## 7. H4 — unlimited-token groups confirm on their own; the confirm checklist

### 7.1 As built (measured)

- Confirm is the person's click (`web/src/BudgetEditor.tsx:526-527`); by default it also starts the group (Kanban
  spec 2026-10-20 §3.1; `recordConfirmed(..., "run")`, `src/control/webService.ts:1688`;
  `src/control/orchestration.ts:59`).
- The button is disabled by four conditions (`BudgetEditor.tsx:301, 304, 526`): `confirmBlocked` (no mode or no
  profiles), `shownSelectionsHash === null` (a slot unresolved), `integrationBlocked` (a delivery scheme and the person
  is not an owner — an ownership check, triage correction), `hasBadDraft(drafts)`. Only the second has a note
  (`BudgetEditor.tsx:524`).
- With control-config defaults, mode and all four profiles come from them (`BudgetEditor.tsx:287, 296-300`), so the
  limited-mode confirm is already one click when defaults exist.
- The "Review task plan" section is static text (`ControlGroupView.tsx:538-547`); its `control.preparation.sequence`
  (「先确认任务方案；开始执行是确认后的单独操作。」, `zh.ts:273`) contradicts `budget.confirmStartsNote`
  (「确认后，一有空位这个组就会自动开跑。」, `zh.ts:706`), rendered on the same page.
- Orca already auto-confirms two kinds of group: system-debug groups (`autoConfirmSystemDebug`,
  `webService.ts:962-990`) and flow children (`confirmChild`, `src/flow/childPort.ts:92-112`). Both book a refusal
  under a fixed command id so it is not retried in a loop (`webService.ts:966-967`).
- A queued estimate is withdrawn without a run once the proposal is confirmed (`withdrawalReason` →
  `"proposal-confirmed"`, `webService.ts:308-314`); a running one runs to its end.

### 7.2 The automatic confirm (server)

A new pass `autoConfirmUnlimitedPass(defaults)` on `WebService`, called by the panel pump after the flow pass and
before `service.autoStart()` (`src/panel/controlAssembly.ts:297-301`), so a group it confirms starts in the same pass.
`defaults` is the same `() => ImportDefaults | null` the requirement commands use (the control config's estimator
profile and mode), so the server and the panel's `config.defaults` read one source.

**It is the single automatic confirmer for ordinary groups** (review I3). The scheduled-flows spec
(`docs/superpowers/specs/2026-10-24-scheduled-flows-and-groups-design.md` §9.2) sends no confirm of its own: a fired
group is an ordinary `draft` group that this pass confirms or not by the conditions below, and that spec only records
this pass's booked result. Only a fire whose schedule pins the `keep` delivery (no integration scheme on the group,
condition 6) and `tokenLimit: null` (condition 2) can be auto-confirmed. There is no project- or panel-wide token mode;
"unlimited" is per group (condition 2) and nothing else.

For each `groups` row in `rowid` order, every condition is code (Rule 5):

1. `status === "draft"` and the body has `planHash`.
2. **Unlimited-token**: `limit.tokens === null`. A limited group is never auto-confirmed (ruling H4).
3. Not archived (`isGroupArchived`), not `stopped`, no stop intent (`readStopIntent`).
4. Not a flow child (no `body.flow`), not a system-debug group (`readSystemDebugMark(body) === null`,
   `src/control/systemDebug.ts:43`), and not a correction debug group (no object `body.debug`; the same test
   `orchestration.ts:104` uses): those have their own paths or are a person's correction to review.
5. The proposal's `state === "editable"`.
6. **No delivery scheme**: `readGroupIntegration(body) === null`. A scheme is an owner's approval
   (`humanOnly.ts:107-108`; integration spec §3.2 R2); such a group keeps the person's click.
7. No estimate of the group in `running` or `start-unknown`. A `queued` estimate does not wait: confirming withdraws it
   with `estimate-withdrawn:proposal-confirmed` and no run (D5, §15).
8. `defaults()` is non-null (an estimator profile and a mode are configured).
9. The command id `orca-auto-confirm-unlimited-v<proposalVersion>` is not yet in `commands` for this group — one
   attempt per proposal version; a person's edit bumps the version and allows a new attempt. The booked row's result
   (a confirm refusal, or condition 10's `selections-unresolved` below) is what the view and the scheduler read.
10. `resolveGroupSelections({ store, port }, groupId, ORCHESTRATION_ACTOR).selectionsHash !== null`. `orca-auto` has no
    operator preferences, so this resolves only from the plan's and the group's own layers (D6, §15). With §6's seed,
    an accepted requirement whose person picked an agent resolves. ⇒ (round 2 N5, option a) A failure here **is
    booked**: the pass writes the `commands` row `(group, orca-auto-confirm-unlimited-v<N>)` through `applyWebCommand`
    with an `apply` that throws the new code `auto-confirm-selections-unresolved` (a `ControlError`, added to the error
    catalog with en/zh copy, §13). So it is visible without a port, and condition 9 then stops the pass from
    re-resolving every pump. It clears when the proposal version moves (any agent or budget edit); a fix outside the
    proposal (a newly installed agent) needs one edit or a manual confirm, which the refused line says.
11. **A person created the group, or the person's schedule did** (review C2). ⇒ (round 2 minor) At import
    (`writeImportedPlan`) and at `requirement-draft-accept`, the group body is stamped `createdByPerson: boolean` =
    the routed principal is `web`/`user:<id>` (`commandPrincipalFor`, `commandClient.ts:55`) **or**
    `routedPersonAuthorityFor(commandId)` is true (`commandClient.ts:66`: an owner on the Web, or an owner's person
    token on the socket; never a run Orca dispatched). Condition 11 holds when `createdByPerson === true` **or** the
    body carries `origin.kind === "schedule"` (the scheduled spec's fire import, its §9.1; the owner's `schedule-set`
    is the person's approval). For a group created before this change (no stamp), the fallback is the creating
    command's `commands.principal` (`web` or `user:<id>`; the first successful `import-plan` or
    `requirement-draft-accept` row by `rowid`). It fails for `agent:<client>` without person authority, for anything a
    dispatched run sent, for `orca-auto` without a schedule origin, and when nothing says who created it.

Conditions 1–11 failing send nothing and book nothing. When all hold, the pass sends `this.confirm(...)` as
`orca-auto`, with `expectedRevision` read now, the plan hash and proposal version read now, `budgetMode =
defaults.estimateMode`, all four profiles = the defaults' estimator profile (the binding `BudgetEditor.tsx:296-300`
sends), `contextPolicy = proposal.contextPolicy`, the resolved `selectionsHash`, no `integrationHash`, no `hold`
(Kanban: confirm also starts; D7, §15). The confirm path is the unchanged `confirm` (`webService.ts:1578-1690`),
so every server check still applies. Its answer is booked under the command id either way. The pass returns
`{ confirmed: string[]; refused: Array<{ groupId; code }> }`; refusals are written to stderr like the auto-start
pass's (`controlAssembly.ts:301-303`).

A person can still confirm by hand at any time before the pass does; the pass then sees `proposal.state ===
"confirmed"` (condition 5) and skips.

**One predicate, exported** (scheduled spec review; signature fixed in round 2 N5). In `src/control/autoConfirm.ts`:

```ts
export type AutoConfirmBlockerCode =
  | "not-draft" | "limited" | "archived" | "stopped" | "stop-intent" | "flow-child" | "system-debug" | "correction-debug"
  | "proposal-not-editable" | "delivery-scheme" | "estimate-running" | "defaults-missing" | "already-attempted"
  | "not-person-created";
export type AutoConfirmBlocker = {
  condition: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 11;
  code: AutoConfirmBlockerCode;
  booked?: string;          // condition 9 only: the error code of the booked row, e.g. "auto-confirm-selections-unresolved"; absent if it succeeded
};
export function autoConfirmBlocker(store: ControlStore, group: Record<string, unknown> /* parsed groups.body */,
  defaults: ImportDefaults | null): AutoConfirmBlocker | null;
```

It covers every **port-free** condition (1–9 and 11), reads the store only (no I/O, no clock, no port), and returns
the **first** failing one in that order, or null. Condition 10 is not in it: it needs the port, and its failure is
booked (above), so a reader sees it as condition 9 with `booked: "auto-confirm-selections-unresolved"`. `defaults` is
a parameter because it comes from the control config, not the store (a deviation from a bare `(store, group)`
signature, kept so condition 8 has one source). The pass calls it, and on null resolves selections (condition 10) and
then confirms or books — so the pass has no other condition. Condition 8 is not sticky: it clears on the next pass
once an estimator profile and mode are configured (nothing is booked for it). The scheduler (scheduled spec) calls the
same function to mark a fired group whose auto-confirm will not happen.

### 7.3 What the group view adds

`groupViewSchema` gains `autoConfirm` (optional on the wire, always sent):
`{ eligible: boolean; refusedCode: string | null }`.

- `eligible`: conditions 2, 3, 4, 6 and 11 of §7.2 hold (computed with the same `autoConfirmBlocker` building blocks:
  the conditions that do not change while the person looks at the page, plus archive/stop). The web treats an absent
  `autoConfirm` as **not eligible** (an older server never auto-confirms).
- `refusedCode`: the `error.code` in the `result` of the `commands` row `(group_id, 'orca-auto-confirm-unlimited-v<current
  proposalVersion>')`, or null — a confirm refusal or `auto-confirm-selections-unresolved`. One indexed read per group
  view.

### 7.4 The confirm checklist (web)

1. `BudgetEditor.tsx` exports `confirmBlockers(view, config, selectionsHash, mayLimit, drafts, manual):
   ConfirmBlocker[]`, `ConfirmBlocker = "profiles" | "selections" | "owner" | "draft"` — the four conditions of §7.1, in
   that order. Both buttons' `disabled` becomes `confirmBlockers(...).length > 0`, and `submitConfirm` returns early on
   the same test: one function decides the list and the buttons.
2. Rendered as a `<ul aria-label={t("budget.checklist.title")}>` directly above the two confirm buttons, one `<li>`
   per blocker (`budget.blocker.*`, §13), each with its own `data-blocker` attribute. With no blockers in a limited
   group: one `role="status"` line `budget.blocker.none`.
3. In an unlimited-token group (`view.ledger.groupLimit.tokens === null`) with `view.autoConfirm.eligible`:
   - the `budget.autoConfirm.pending` line replaces `budget.confirmStartsNote`;
   - an estimate run in `running`/`start-unknown` adds the `budget.blocker.estimate` line;
   - a task slot whose resolved agent provenance is `operator` adds `budget.blocker.ownAgent` (the automatic confirm
     cannot use the person's own default agent, §7.2 condition 10);
   - `view.autoConfirm.refusedCode !== null` adds `budget.autoConfirm.refused` with that code's existing error copy.
   With `eligible` false because of a delivery scheme, the `budget.autoConfirm.integration` line is shown instead.
4. The buttons stay in every mode: a person may confirm by hand.
5. `ControlGroupView.tsx:541-546`: the static `<p>`s `agentReview`, `integrationReview`, `tokenPolicy` and `sequence`
   are removed; the goal, success conditions and workspace lines stay. The `control.preparation.sequence`,
   `.agentReview`, `.integrationReview`, `.tokenPolicy` keys and `budget.confirmWaits` are removed from both locales
   (the `selections` blocker replaces `confirmWaits`, keeping its link to `#global-settings`).

### 7.5 Limited mode

Unchanged on the server. The one click exists when control-config defaults exist (`BudgetEditor.tsx:287, 296-300`);
when they do not, the `profiles` blocker says so and links to Global settings. No auto path.

## 8. H5 — tasks show a summary of their goal

### 8.1 As built (measured)

- The task table cell is the bare id (`web/src/ControlGroupView.tsx:520`).
- A graph node has the id line and the status line (`web/src/DependencyGraph.tsx:106-111`); `NODE_W = 180, NODE_H = 88`
  (`DependencyGraph.tsx:18`), five 16 px text rows at y = 16…80.
- Every work item may carry `objective.goal` (`src/control/webProtocol.ts:1562`, optional).
- `goalSummary(goal)` joins the lines, keeps ≤ 120 characters (`CARD_SUMMARY_MAX`, `web/src/CardGoal.tsx:5`), and marks
  a cut with `…` (`CardGoal.tsx:14-23`).

### 8.2 Change (no plan, plan-hash or schema change)

1. Table (`ControlGroupView.tsx:518-521`): after the id button, `<span className="task-goal" title={goal}>{goalSummary(goal)}</span>`
   when `item.objective` exists. CSS: one line, `max-width: 40ch`, `overflow: hidden`, `text-overflow: ellipsis`,
   `white-space: nowrap`. No objective ⇒ the id alone, as now.
2. Graph: `NODE_H` becomes 104; a goal line at y = 32 (`className="dep-goal"`), the status and later lines move down
   16 px; the goal `<text>` is clipped to the node by a per-node `<clipPath>` of width `NODE_W − 16`; the node `<g>`
   gains an SVG `<title>` child with the full goal. No objective ⇒ no goal line, node height unchanged at 104 (one
   layout height for every node).
3. The split's own `title` is not carried into the plan (H5: no plan-hash change).

## 9. H11 — one hash route scheme

### 9.1 As built (measured)

- Only the section is in the hash: `sectionFromHash` (`web/src/sections.ts:10-13`) maps `#<section>` and turns anything
  else into `overview`. Ten sections (`sections.ts:6`).
- Cross-section jumps assign `window.location.hash` directly at `web/src/App.tsx:936, 948, 1542, 1605, 1606, 1645,
  1646, 1654`; `hashchange` sets the section (`App.tsx:265-269`). Browser Back already returns to the previous section,
  and section panes stay mounted (triage D2 facts 2 and 3).
- Selections are React state only: the decisions tab (`App.tsx:243`), the group view's `openTask` and `region`
  (`ControlGroupView.tsx:276, 278`), the open flow run (`FlowBoard.tsx:204, 214, 220, 223`). The board pane is mounted
  only while shown (`App.tsx:1639-1650`), so its open run is lost when the person leaves.
- A correction from a run drops the run: `onCorrect(projectKey, decisionId)` (`RunDecisions.tsx:29, 143`;
  `TaskDetail.tsx:205, 245`; `ControlGroupView.tsx:191, 675`) → `openDecisionById` (`App.tsx:934-937`).
- `openOverviewTarget` already validates a target: the group exists, is not archived and is in scope, else
  `overview.navigationUnavailable` (`App.tsx:942-998`).

### 9.2 The route codec (`web/src/sections.ts`)

Pure functions, no React:

```ts
export type Route =
  | { kind: "section"; section: Section }
  | { kind: "group"; section: "tasks"; groupId: string; region: DetailRegion | null; taskId: string | null }
  | { kind: "requirement"; section: "requirements"; groupId: string }
  | { kind: "decision"; section: "decisions"; projectKey: string; decisionId: string }
  | { kind: "corrections"; section: "decisions" }
  | { kind: "flow-run"; section: "board"; flowRunId: string };
export function parseRoute(hash: string): Route;
export function formatRoute(route: Route): string;
```

Grammar (each part `encodeURIComponent`-ed by `formatRoute`, decoded by `parseRoute`):

| Hash | Route |
|---|---|
| `#<section>` (any of the ten) | `section` |
| `#tasks/<groupId>` | `group`, region null, taskId null |
| `#tasks/<groupId>/<region>` | `group`; `region ∈ DETAIL_REGIONS` (`web/src/detailRegion.ts:4`) |
| `#tasks/<groupId>/<region>/<taskId>` | `group` with task |
| `#requirements/<groupId>` | `requirement` |
| `#decisions/<projectKey>/<decisionId>` | `decision` |
| `#decisions/corrections` | `corrections` |
| `#board/flow/<flowRunId>` | `flow-run` |

Fallbacks: an unknown or empty section ⇒ `{ kind: "section", section: "overview" }` (today's behaviour); a known
section with a malformed tail (wrong part count, unknown region, a part that fails `decodeURIComponent`, an empty
part) ⇒ that bare section. `parseRoute` never throws. `sectionFromHash(h)` stays as `parseRoute(h).section` so existing
callers and old `#tasks`-style links keep working. `formatRoute(parseRoute(x)) === x` for every hash `formatRoute` can
produce.

### 9.3 One `navigate()` (`web/src/App.tsx`)

- `navigate(route, { replace })`: `replace` ⇒ `history.replaceState(null, "", formatRoute(route))` and apply it
  directly (no `hashchange` fires); otherwise assign `window.location.hash = formatRoute(route)` and let the existing
  `hashchange` handler apply it. Every site listed in §9.1 calls `navigate`.
- **Push** (a history entry): a section change, opening a group, a requirement, a decision, or a flow run.
- **Replace**: a region-tab click, opening or closing a task in the group view, the Decisions/Corrections toggle
  (`App.tsx:1673-1680`; the toggle buttons keep their markup, not ARIA tabs). A reload restores them; Back is not
  flooded (triage D2 recommendation).
- **Apply** (`applyRoute`, on load and on every `hashchange`) sets the section at once. Applying a target is
  **deferred** until the data it is checked against has been read (review I6): on load, a `group` or `requirement`
  route is held as `pendingRoute` until the first overview read answers (`overview.status === "available"`) and then
  checked the way `openOverviewTarget` does (exists, not archived, in scope, `App.tsx:942-998`) and opened by reading
  that group (`fetchControlGroup` / `fetchRequirement`); a `decision` route is fetched by its id
  (`fetchDecision(projectKey, decisionId)`, as `openOverviewTarget` does for a decision) and opened with
  `openDecisionById`, needing no list row; a `flow-run` route is passed to FlowBoard, whose run page reads the run
  itself. A failed overview read, or a target that is not found ⇒ the bare section plus one `role="status"` line
  `nav.routeMissing` (id and section named). A later `hashchange` applies immediately (the data is already read). A `pendingRoute` is **cancelled** by any
  `navigate` or `hashchange` that happens before the first read answers (the person moved on; the newest route wins).
- **Bare section routes and selection:** a bare `#tasks` or `#requirements` (typed, Back to it, or the sidebar link)
  **keeps** the pane's current selection — the pane stays mounted, as today (`Shell.tsx:88-94`) — so Back from
  `#tasks/<g>` to a bare `#tasks` written by an older link does not close anything. Only a route that names another
  group replaces the selection. The sidebar link writes the bare section, unchanged.
- **Another project's group (H11 sub-ruling)**: when the target exists but belongs to a project other than the one in
  scope, the section is shown with one `role="status"` line `nav.otherProject` and a button `nav.switchProject`. The
  project is never switched by the route; the button calls the existing `chooseProject(projectKey)` and then applies the
  same route again.
- `ControlGroupView`: `region` and `openTask` take their first value from the route when it names this group, and
  report changes up through `onRegionChange`/`onOpenTaskChange` (App calls `navigate(..., { replace: true })`). The
  label filter stays out of the URL (labels spec 2026-09-28 §121).
- `FlowBoard`: `open` comes from a prop (`openFlowRunId`) instead of `useState` (`FlowBoard.tsx:204`); opening a run
  (`onOpenFlow`, the start dialog's `onStarted`, `:220`) pushes `#board/flow/<id>`; the run page's Back
  (`FlowRunPage`'s `onBack`) pushes `#board`. The live-transcript offset and open attempt stay out of the URL.

### 9.4 The shared back line

- App keeps `from: { leftHash: string; pushedHash: string; label: string } | null`.
  - **Set** only when an in-app action calls `navigate` with push **and** the route's section differs from the current
    one: `leftHash` = the hash being left, `pushedHash` = `formatRoute(route)`, `label` = `t("nav.<old section>")`
    (`web/src/locales/en.ts:228`).
  - **Shown** only while `window.location.hash === pushedHash`.
  - **Cleared** (set to null) on: any `hashchange` whose new hash is not `pushedHash` (Back, Forward, a typed hash, a
    sidebar link); any later `navigate` push (a replace within the same section keeps it, and updates `pushedHash` to
    the replaced hash); a project switch (`chooseProject`).
- One component `BackLine` renders, at the top of the target section pane, a button `nav.back` that calls
  `history.back()` — safe because the entry is known to be Orca's.
- **#47 origin**: `onCorrect(projectKey, decisionId, origin)` with `origin = { groupId, taskId, runId }` from the run
  `RunDecisions` already has (`RunDecisions.tsx:29`), passed through `TaskDetail` and `ControlGroupView` to
  `openDecisionById`. App keeps the origin with the selection; the decision detail shows `decisions.origin` above the
  back line. The origin is not in the URL (a reload keeps the decision, loses the origin line); it is cleared when
  another decision is opened. No API change, no modal.

## 10. H12 — no global single-letter shortcuts

### 10.1 As built (measured)

Scoped keys only: Decisions `j`/`k`/`a`/`c` (`web/src/reviewKeys.ts:16-25`), acting only with focus on the page body
or inside the Decisions pane (`App.tsx:1342-1377`, WCAG 2.1.4 guard at :1347); `r` retries the open task's run under
the same kind of guard (`reviewKeys.ts:28-30`, `ControlGroupView.tsx:294-309`); arrow keys in the region tablist and
the group menu.

### 10.2 Change

- No new key binding. In particular **no `?` binding**: `?` is a single printable character, so WCAG 2.1.4 applies to
  it as to a letter, and Vimium binds `?` to its own help (D8, §15). "At most a `?` overlay" is met by a list opened
  from a visible button.
- A `button` `shortcuts.open` in the sidebar footer (`web/src/Shell.tsx:77`) opens a native `<dialog>` with
  `showModal()` (modal, focus trapped and Escape-to-close by the browser), `aria-labelledby` pointing at its
  `<h2>` (`shortcuts.title`), a close button (`shortcuts.close`), and on close focus returns to the button that opened
  it. It lists the existing keys with where they act.
- The list is a constant `SHORTCUTS` exported from `web/src/reviewKeys.ts`, next to the functions that decide the keys,
  so a criterion can prove the list and `reviewKeyAction`/`isRetryKey` name the same letters.

## 11. Data and schema changes (all of them)

| Change | Where | Kind |
|---|---|---|
| `schemaVersion` `"18"` → `"19"`; repair of stuck groups (§4.3) | `src/control/migrations.ts`, `store.ts` (passes `now`) | data migration, no DDL |
| `groups.body.statusRepairs[]` (append-only; only on repaired groups); a repaired confirmed proposal reopened, its task work items reset, its `group_orchestration` row deleted | group body JSON; `budget_proposals`, `work_items`, `group_orchestration` rows of repaired groups | new optional field; data |
| `groups.body.estimateOverrunGrowth[]` and the non-token `limit` growth at an estimate run's breach (`recordUsage`, §4.2.5), mirrored in `ledger.groupLimit` and the proposal | group body JSON, proposal `groupLimit` | new optional field; value change |
| `proposal-edit` with `proposedGroupLimit` checks conservation against that limit (§4.2.5) | `webService.ts` `editProposal` / `assertKnownConservation` | behaviour |
| `ESTIMATE_GRANT` = 1,000,000 tokens / 1,800,000 ms / 1 / 1 (cap); per-estimate grant from `estimateGrantFor` (group remaining, spend-cap headroom) | `estimator.ts`; estimate rows' `grant` and contracts' `grant` for new estimates | value change; existing rows untouched |
| `agentOverrides.worker` seeded at accept (§6.2) | group body JSON | existing field, new writer |
| `runView.overGrant` | `src/control/webProtocol.ts` run view | optional view field |
| `groupView.autoConfirm` | group view | optional view field |
| Command id family `orca-auto-confirm-unlimited-v<N>` | `commands` rows | new booked ids, existing table |
| `autoConfirmBlocker` (exported predicate) | new `src/control/autoConfirm.ts` | code |
| `groups.body.createdByPerson` stamped at import and accept (§7.2 condition 11) | group body JSON | new optional field |
| Error code `auto-confirm-selections-unresolved` (booked condition-10 failure) | error catalog, `commands` rows | new code |

No new table, no new column, no new file outside the state directory.

## 12. Access

| Action | Who | Channel | Notes |
|---|---|---|---|
| Estimate breach recorded without status change (§4.2) | Orca (usage booking) | — | no command |
| Schema 18 → 19 repair | Orca at store open | — | attributed `by: "migration-18-to-19"`; backup first |
| Estimate grant computation (§5) | inside `estimate` / `import-plan` / `requirement-draft-accept` / retry | any principal that may send those verbs today (`humanOnly.ts`) | unchanged classification |
| Worker seed at accept (§6) | inside `requirement-draft-accept` | `any` (`humanOnly.ts:36`) | seeds only what the requirement's opener picked |
| Auto-confirm (§7.2) | `orca-auto` | pump, in-process | verb `confirm` = `any`; never `integrationHash` (human-only field); never flow children, system-debug or correction-debug groups, limited groups; only groups whose creating command was a person's (`web`/`user:<id>`) or that a person's schedule fired (`origin.kind = "schedule"`) — never `agent:<client>`, never a dispatched run |
| Limit raise past an estimate deficit (§4.2.5) | as `proposal-edit` today | Web, socket | the `proposedGroupLimit` field's classification is unchanged |
| Manual confirm | as today | Web, socket | unchanged |
| Read `overGrant`, `autoConfirm`, checklist, banners | whoever may read the group view today | Web | no new route |
| Routes, back line, cross-project switch | the viewer | client only | switching project is the person's click; reads stay scope-checked as `openOverviewTarget` does |
| Shortcut list | the viewer | client only | no key binding |

## 13. Copy (en / zh)

| Key | en | zh |
|---|---|---|
| `control.group.estimateOverGrant` | Estimate run {{runId}} used {{used}} {{dimension}}, over its grant of {{grant}}. It was not stopped and the group was not blocked; the estimate is advice only. | 估算运行 {{runId}} 用了 {{used}} {{dimension}}，超过了它的额度 {{grant}}。运行没有被停止，任务组也没有被阻塞；估算只作参考。 |
| `control.group.estimateDeficit` | An estimate run went over this group's token limit by {{deficit}}. Raise the limit (proposed group limit) to continue; other changes are refused until then. | 估算运行使本组超出 token 上限 {{deficit}}。请先提高上限（提议的组上限）才能继续；在此之前其它修改都会被拒绝。 |
| error `auto-confirm-selections-unresolved` | Orca could not resolve every agent slot with the group's own choices. | Orca 用组自己的选择没能解析出每个 agent 槽位。 |
| `control.group.blockedBanner` | This group is blocked: run {{runId}} went over its {{dimension}} grant ({{used}} of {{grant}}). No new step starts in it, and preparation changes are refused. | 任务组已阻塞：运行 {{runId}} 超出了 {{dimension}} 额度（{{used}} / {{grant}}）。组里不会再开始新的步骤，准备阶段的修改也会被拒绝。 |
| `budget.checklist.title` | Before confirming | 确认前 |
| `budget.blocker.profiles` | Choose a budget mode and agent profiles, or set the defaults in Global settings. | 请选择预算模式和 agent 配置档，或在全局设置里设好默认值。 |
| `budget.blocker.selections` | Every agent slot must resolve; see Agent selection below, or check installation and defaults in | 每个 agent 槽位都要解析成功；请看下方 Agent 选择，或在此检查安装和默认值： |
| `budget.blocker.owner` | This group has a delivery scheme (push or PR); only an owner can confirm it. | 这个组设了交付方式（推送或 PR），只有 owner 能确认。 |
| `budget.blocker.draft` | Fix the highlighted values first. | 先修正标出的数值。 |
| `budget.blocker.none` | Nothing blocks confirming. | 没有阻止确认的项。 |
| `budget.blocker.estimate` | Waiting for the running estimate to finish. | 正在等进行中的估算结束。 |
| `budget.blocker.ownAgent` | Orca confirms only with the group's own agent choice; your personal default agent does not count. Set the group worker below, or confirm by hand. | Orca 自动确认只认组自己的 agent 选择，你个人的默认 agent 不算。请在下方设置组执行，或手动确认。 |
| `budget.autoConfirm.pending` | Token use is unlimited, so Orca confirms and starts this group on its own once nothing above blocks it. | token 不限，所以上面各项都满足后，Orca 会自动确认并开跑这个组。 |
| `budget.autoConfirm.refused` | Orca's automatic confirm was refused: {{reason}}. Fix it and edit the proposal to try again, or confirm by hand. | Orca 自动确认被拒：{{reason}}。处理后修改提案即可再试，或手动确认。 |
| `budget.autoConfirm.integration` | A group with a delivery scheme needs an owner's confirm, so it is not confirmed automatically. | 设了交付方式的组需要 owner 确认，不会自动确认。 |
| `agents.inheritLine` | {{count}} tasks use the group worker: {{agent}} | {{count}} 个任务沿用组执行：{{agent}} |
| `agents.overrideTask` | Override task {{taskId}} | 覆盖任务 {{taskId}} |
| `agents.noWorker` | No agent is chosen for the group worker. Choose one here, or set a default agent in | 组执行还没有选定 agent。请在这里选择，或在此设置默认 agent： |
| `nav.back` | ← Back to {{label}} | ← 返回{{label}} |
| `nav.routeMissing` | {{id}} was not found; showing {{section}}. | 没有找到 {{id}}，显示{{section}}。 |
| `nav.otherProject` | {{id}} belongs to project {{project}}. | {{id}} 属于项目 {{project}}。 |
| `nav.switchProject` | Switch to {{project}} | 切换到 {{project}} |
| `decisions.origin` | From {{group}} / {{task}} / {{run}} | 来自 {{group}} / {{task}} / {{run}} |
| `shortcuts.open` | Keyboard shortcuts | 键盘快捷键 |
| `shortcuts.title` | Keys Orca uses | Orca 用到的按键 |
| `shortcuts.decisions` | j / k: next / previous row · a: agree · c: correct — on the Decisions page, with focus on the page | j / k：下一条 / 上一条 · a：同意 · c：纠正 —— 在决策页、焦点在页面上时 |
| `shortcuts.retry` | r: retry the open task's run — in a group, where Retry task is offered | r：重试打开的任务的运行 —— 在任务组里、提供"重试任务"时 |
| `shortcuts.arrows` | Arrow keys: move between region tabs and menu items | 方向键：在区域标签和菜单项之间移动 |
| `shortcuts.close` | Close | 关闭 |

Removed keys (both locales): `control.preparation.agentReview`, `.integrationReview`, `.tokenPolicy`, `.sequence`;
`budget.confirmWaits`. `budget.confirmStartsNote` stays for limited groups. Dimension words come from the existing
`enumText("dimension", …)`.

## 14. Rule 17 notes

- The only write outside the repository is the existing control database under the control state directory
  (`~/.orca/control/<instance>/` by default, relocated by `ORCA_CONTROL_DIR`, `src/panel/controlOptions.ts:50-57`). The
  schema-19 step writes `control.sqlite` and the existing backup `control.sqlite.pre-v18-<ms>[-<n>]` (mode `0600`,
  `store.ts:117`), both inside that directory. Registered here: **writer** `openControlStore` on a version change;
  **trigger** the first open by the schema-19 build (panel service after install, or any CLI that opens the store);
  **residue** the backup file, never deleted by Orca; on a failed copy nothing migrates (`store.ts:116`).
- Every criterion opens stores in `mkdtemp(join(tmpdir(), "s19-"))` via `openControlStore({ stateDir, now })`, as
  `tests/control/flowFeedbackMigration.test.ts:22-25` does; panel-level criteria set `ORCA_CONTROL_DIR` to a temp dir
  (`src/panel/controlAssembly.ts:181`). No criterion reads or writes `~/.orca`; the only touch of the real store in this
  work is the read-only query of §2.3.
- New files and directories are created by existing code with explicit modes; this spec adds none. An existing file's
  mode is not changed.

## 15. Decisions the writer made (reversible; for the human to see)

- **(revised)** The first draft's D4 (keep the full grant against caps) is replaced by the controller's I4 call (§5.2.2);
  the first draft's "repair to `ready`" is replaced by the controller's I2 call (always `draft`, §4.3.1).
- **D11 (§4.2.5)**: an estimate overrun in a non-token dimension **grows** the group's limit in that dimension by the
  excess (recorded in `estimateOverrunGrowth`), instead of excusing the deficit in the conservation check. Why: the
  ledger stays conserved, so no later claim (`decideFundedAllowance`) is refused for a deficit the estimate made;
  non-token limits size Orca's own reservations. Grown in `recordUsage` at breach time (controller, round 2 N3). Cost if
  wrong: a person who set an `activeMs` limit by `set-limit` sees it grow by an estimate's overrun (recorded, at most
  the overrun of one call). Tokens are never grown.
- **D12 (§7.2 condition 11)**: withdrawn in round 2 — the `createdByPerson` stamp uses `routedPersonAuthorityFor`, so a
  socket import with an owner's person token counts as a person's. Only unstamped (older) groups fall back to the
  `commands.principal` reading, where such a session reads as not a person.
- **D14 (§7.2)**: `autoConfirmBlocker` takes `defaults` as a third parameter (round 2 N5 asked for `(store, group)`),
  because the defaults live in the control config, not the store.
- **D13 (§9.3)**: a bare `#tasks`/`#requirements` keeps the current selection.
- **D1 (§4.3.1 condition 5)**: the repair skips any group with a `work` or `handoff` run, even if only estimate runs
  breached. Why: such a group started; "draft" would lie about it. Cost if wrong: a started group blocked only
  by an estimate stays blocked (none exist on this machine, §2.3).
- **D2 (§4.3.2)**: the repair does not move the group's `revision`, following `migrateSettings15To16`. Cost if wrong: a
  command prepared before the restart against the blocked group is accepted on a now-draft group; such a command was
  refused anyway while blocked.
- **D3 (§5.2.4)**: a limited group with 0 tokens remaining refuses the estimate (`group-budget-unavailable`) instead of
  running it with a 0 grant. Why: a 0 grant is a guaranteed overrun of a person-set limit, not "past the grant".
- **D5 (§7.2 condition 7)**: auto-confirm does not wait for a **queued** estimate; confirming withdraws it with no run
  and no spend. So in an unlimited-token group the estimate of a freshly accepted requirement normally never runs.
  Alternative: wait for every estimate to settle (costs up to 1,000,000 tokens and minutes per group; its figures are
  never applied without a person's "Use" click, `webService.ts:1878`). It does wait for a **running** one, whose spend
  would otherwise be wasted.
- **D6 (§7.2 condition 10)**: auto-confirm resolves agents as `orca-auto`, which has no operator preferences, so the
  person's own default agent does not satisfy it; the checklist says so (`budget.blocker.ownAgent`). Why: a confirm
  must not be sent under one principal with another principal's preferences (`confirm` re-checks
  `currentPartials(..., command.actorId)`, `webService.ts:1626`). Requirement groups get a group worker from §6.
- **D7 (§7.2)**: auto-confirm uses the default confirm, which also starts the group (not "Confirm only"). So in
  unlimited-token mode an accepted requirement runs with no further click. Kept by the controller (review C2): H4 asks
  for no extra click; condition 11 limits it to groups a person created or a person's schedule fired.
- **D8 (§10.2)**: no `?` key binding at all; the list opens from a visible button. Why: `?` is in WCAG 2.1.4's scope and
  is Vimium's own help key.
- **D9 (§9.3)**: tab and open-task changes replace the history entry; group, requirement, decision and flow-run opens
  push. Recommended by the triage; reversible.
- **D10 (§8.2)**: one node height (104) for every graph node, with or without a goal, so the layout's rows stay even.

## 16. Success criteria

Each criterion is a command that exits 0 when it holds. Root files run with `npx vitest run <file>` from the repository
root; web files with `(cd web && npx vitest run <file>)`. Every named mutation is applied only in a
`git clone --local` copy (Rule 15), its run must exit non-zero with the named test red, and the restore is proved by
`git diff | wc -c` and `git diff --cached | wc -c` both printing `0`. Logs are redirected to files and read whole
(Rule 14). Paid agents are never run: every criterion uses the fake ports the existing harnesses use.

### 16.1 Criteria and their mutations

| # | Command | What it proves | Mutation that must be seen red |
|---|---|---|---|
| C1 | `npx vitest run tests/control/estimateBreachAdvisory.test.ts` | an estimate run over its grant leaves a `draft` group `draft` (and a `ready` one `ready`), with the breach on `run.breaches` | M1 `estimate-breach-blocks`: drop the estimate-run condition at `usage.ts:43` |
| C1a | same file | **limited → overrun → raise → confirm**: a limited group whose estimate overruns into a token deficit refuses a plain `proposal-edit` and `confirm` (`recovery-blocked`); a `proposal-edit` with a `proposedGroupLimit` that covers the deficit is accepted, clears the deficit, and the following `confirm` succeeds; a `proposedGroupLimit` still short of the deficit is refused | M1a `old-conservation-order`: evaluate `webService.ts:333`'s `residual(group.limit, …)` (stored limit) before the proposed-limit check — it throws on the deficit |
| C1b | same file | **unlimited + activeMs overrun**: an estimate run in an unlimited-token group that uses more `activeMs` than its 1,800,000 grant leaves no `budgetDeficit` in any dimension; `group.limit.activeMs`, `ledger.groupLimit.activeMs` and the proposal's `groupLimit.activeMs` all grow by exactly the excess (one `estimateOverrunGrowth` entry per growing event, none twice for the same excess); a following `proposal-set-agent` and `confirm` are accepted; a work run's overrun grows nothing | M1b `no-nontoken-growth`; M1c `proposal-not-mirrored` (grow only `group.limit` ⇒ the mirror check refuses); M1d `grows-for-work-runs` |
| C1c | same file | the same growth through the other booking paths: an estimate run recovered from `start-unknown`, a recovery retry, and `settle-unknown-usage` (`charge-remaining-grant`) each leave the three limits identical and no deficit | M1e `settle-path-skips-growth` |
| C2 | same file | a **work** run over its grant still sets `blocked` | M2 `no-breach-blocks`: make the status branch never run |
| C3 | same file | the run view's `overGrant` names exactly the over dimensions (tokens only; tokens + activeMs) | M3 `overGrant-empty`: always `[]` |
| C4 | `(cd web && npx vitest run tests/estimateBanner.test.tsx)` | the estimate banner shows run, dimension, used, grant; a blocked group shows the alert and read-only editors | M4 `banner-missing`; M5 `blocked-editors-open` |
| C5 | `npx vitest run tests/control/estimateBreachRepairMigration.test.ts` | a v18 store with a stuck draft group opens as v19 with the group `draft`, a `statusRepairs` entry (`by`, `at` from the injected clock, sorted `runIds`), revision unchanged | M6 `no-attribution`: omit the entry |
| C6 | same file | a stuck group whose proposal is confirmed becomes `draft` with the proposal `editable` at version + 1, its task work items `draft`, and no `group_orchestration` row; the next pump's auto-start does not start it | M7 `repair-to-ready`: restore `ready` for a confirmed proposal; M7a `orchestration-kept`: keep the row |
| C7 | same file | a blocked group with a work-run breach (alone, or beside an estimate breach) stays `blocked` | M8 `repair-any-breach`: drop condition 4 |
| C7a | same file | a blocked group with an estimate breach plus a breached `single-call` `clarify` or `split` run is repaired; plus a breached `single-call` `flow-draft` run is not | M8a `count-clarify-breach`: treat clarify/split breaches as blocking-capable; M8b `ignore-other-single-call`: exclude every single-call run |
| C8 | same file | a blocked group with only an estimate breach but a `work` run stays `blocked` | M9 `repair-started-group`: drop condition 5 |
| C9 | same file | exactly one `control.sqlite.pre-v18-*` exists after the first open; a second open adds none and changes no row (bytes of `groups` equal) | M10 `marker-not-moved`: skip the version update |
| C9b | same file | **never throws**: a v18 store holding a confirmed, stuck, **limited** group whose ledger carries a token deficit (the overrun ate the reserve) opens without error at v19 and repairs the group to `draft` with `ledger.budgetDeficit` from `budgetBalance`, every field of §4.3.1's list written and `proposal_version` column = body version; a group with an unreadable `budget_proposals` body is left as it was and the open still succeeds | M10b `reopen-uses-residual` (throws, store fails to open); M10c `column-not-updated` |
| C9a | same file | idempotence of the step itself: after the marker is reset to `"18"` by raw SQL and the store reopened, the `groups`, `budget_proposals`, `work_items` and `group_orchestration` rows are byte-equal to the first open's and `statusRepairs` has one entry | M10a `repair-not-idempotent`: widen the predicate to also select groups that already carry a `statusRepairs` entry, so a re-run appends again |
| C10 | same file | every other table's rows are byte-equal before and after (pattern of `flowFeedbackMigration.test.ts`) | M11 `repair-touches-runs`: also clear `breaches` |
| C11 | `npx vitest run tests/control/estimateGrant.test.ts` | `estimateGrantFor` with no limit and no cap is 1,000,000 / 1,800,000 / 1 / 1; limited gives `min(remaining, 1,000,000)` tokens and the cap's other dimensions; a cap headroom of 300,000 with a request needing 200,000 gives 300,000; with a request needing 350,000 the headroom is omitted (grant 1,000,000, and the claim is cap-blocked) | M12 `grant-fixed-250k`; M13 `limited-ignores-remaining`; M13a `ignores-cap-headroom`; M13b `headroom-below-request-used` |
| C11a | same file | with a repository cap whose headroom is 400,000, a created estimate in an unlimited group has a 400,000 grant and is claimed (not cap-blocked) on the next wake | M13c `cap-read-after-reserve`: read headroom with the grant already counted |
| C12 | same file | in a limited group with 200,000 tokens remaining, a request of 300,000 required tokens and a 1,000,000 context window is `queued` with a 200,000-token grant; with an 250,000 context window it is `input-too-large` | M14 `input-bound-by-grant`: restore `\|\| required > grant.tokens` at `estimator.ts:121` |
| C13 | same file | the retry re-check (`retryPromptFits`) ignores the grant and keeps the window | M15 `retry-bound-by-grant` at `estimateRetry.ts:83` |
| C14 | same file | 0 tokens remaining refuses with `group-budget-unavailable`; 1 token remaining queues with a 1-token grant | M16 `zero-remaining-queues` |
| C15 | same file | in a **limited group with 600,000 tokens remaining** (below the 1,000,000 cap, review I7), the created estimate row, its contract and the claimed run all carry a 600,000-token grant, and the claim's equality check (`webService.ts:655-656`) passes | M17 `contract-keeps-cap`: freeze `ESTIMATE_GRANT` into the contract |
| C16 | `npx vitest run tests/control/requirementAcceptWorker.test.ts` | accept seeds `agentOverrides.worker` from the opener's pick; the tasks resolve to it with provenance `group` | M18 `no-worker-seed` |
| C17 | same file | an existing worker override is kept; no pick ⇒ no worker key; a split plan with a group agent ⇒ no worker key and the tasks resolve to the plan's agent | M19 `seed-overwrites-worker`; M19a `seed-masks-plan-agent` |
| C18 | `(cd web && npx vitest run tests/agentInheritFold.test.tsx)` | per-task fields are inside a closed `<details>`; open when the task has its own override; the inherit line counts only inheriting tasks | M20 `task-fields-open`; M21 `inherit-line-counts-all` |
| C19 | `npx vitest run tests/control/autoConfirmUnlimited.test.ts` | an unlimited draft group with resolved group-level agents and defaults is confirmed by `orca-auto`, orchestration `mode: "run"`, and started by the same pump pass | M22 `auto-confirm-hold`: send `hold: true` |
| C20 | same file | a limited group is never auto-confirmed | M23 `auto-confirms-limited` |
| C21 | same file | a group with a delivery scheme is never auto-confirmed: after the pass the `commands` table has **no** row `(group, orca-auto-confirm-unlimited-v<N>)` and no row of that group whose `effective_payload_json` has `integrationHash` | M24 `auto-confirms-integration` |
| C22 | same file | a flow child, a system-debug group and a correction-debug group (`body.debug`) are skipped by this pass; the pass writes no `effect_records` and no `flow_messages` row (counts before = after) | M25 `auto-confirms-flow-child`; M25a `auto-confirms-debug` |
| C22a | same file | condition 11: a group imported by `agent:<client>` and one imported by a dispatched run are not confirmed and nothing is booked; one imported by `user:<id>`/`web`, one accepted from a requirement by a person, and one with `origin.kind = "schedule"` imported by `orca-auto` are confirmed | M25b `auto-confirms-agent-import`; M25c `schedule-origin-ignored` |
| C22b | same file | single source: for every group fixture in this file, `autoConfirmBlocker(store, body, defaults)` returns null **iff** the pass attempts that group (confirms or books condition 10), and for each failing fixture it names the expected condition and code | M25d `pass-diverges`: add one extra condition to the pass that the function does not have (or drop condition 3 from the function only) |
| C22c | same file | condition 10 is booked: a group whose selections do not resolve gets one `commands` row with `auto-confirm-selections-unresolved`, is not re-resolved on the next pass (port call count unchanged), shows `refusedCode`, and `autoConfirmBlocker` then returns condition 9 with that `booked` code; condition 8 (`defaults` null) books nothing and the group is confirmed on the first pass after defaults are set | M25e `selections-not-booked`; M25f `defaults-booked` |
| C22d | same file | `createdByPerson` stamp: a socket import with an owner's person token (`routedPersonAuthorityFor` true) is confirmed; the same import from a dispatched run is not | M25g `stamp-ignores-person-token` |
| C23 | same file | a running estimate holds the confirm; a queued one does not, and it is then withdrawn as `proposal-confirmed` with no run | M26 `ignores-running-estimate` |
| C24 | same file | a refused confirm is booked once per proposal version and not resent on later passes; a proposal edit allows one new attempt | M27 `retries-refusal` |
| C25 | same file | a group whose agents resolve only through a person's operator default is not confirmed and nothing is booked | M28 `uses-person-prefs`: resolve with the creator's id |
| C26 | same file | archived, stopped or stop-intent groups are skipped | M29 `confirms-stopped` |
| C27 | `(cd web && npx vitest run tests/confirmChecklist.test.tsx)` | for each of the four blockers alone: its `data-blocker` line shows and both buttons are disabled; none ⇒ `budget.blocker.none` and enabled | M30 `button-own-conditions`: compute `disabled` without `confirmBlockers`; M31 `owner-line-missing` |
| C28 | same file | unlimited + eligible: the pending line replaces the starts note; the estimate, own-agent and refused lines appear on their conditions; the false `sequence` copy is not rendered anywhere on the page | M32 `sequence-kept`; M33 `refused-line-missing` |
| C29 | `(cd web && npx vitest run tests/taskGoalSummary.test.tsx)` | the table shows `goalSummary(goal)` with the full goal in `title`; the graph node has the goal line and an SVG `<title>`; no objective ⇒ id only | M34 `table-no-goal`; M35 `graph-no-title` |
| C30 | `(cd web && npx vitest run tests/routes.test.ts)` | `formatRoute(parseRoute(x)) === x` for one hash of every row of §9.2's grammar, with characters that need encoding (`/`, space, `#`, CJK); every fallback of §9.2 | M36 `format-drops-region`; M37 `malformed-throws` (remove the decode guard) |
| C31 | `(cd web && npx vitest run tests/routeApp.test.tsx)` | re-mounting App on `#tasks/<g>/preparation/<t>` restores group, region and open task; a region click does not change `history.length`; opening a group does | M38 `tab-click-pushes` |
| C32 | same file | `#board/flow/<id>` re-mounts on that run page; leaving and Back returns to it | M39 `flow-run-not-in-route` |
| C33 | same file | a link to another project's group leaves the project unchanged and shows the line and switch button; the button switches and opens the group | M40 `cross-project-auto-switch` |
| C33d | same file | a `pendingRoute` is dropped when the person navigates (or a `hashchange` arrives) before the first overview read answers; the late answer opens nothing | M40e `pending-route-sticky` |
| C33a | same file | `#requirements/<id>` re-mounts with that requirement open; `#decisions/<pk>/<id>` fetches that decision by id and opens it with no list row; both apply only after the first overview read answers (a fixture that delays it shows the bare section first, then the target) | M40a `apply-before-read` (apply on mount); M40b `decision-needs-row` |
| C33b | same file | a route naming a group that does not exist shows `nav.routeMissing` with the id and the bare section | M40c `missing-silent` |
| C33c | same file | Back from `#tasks/<g>` to a bare `#tasks` keeps group `<g>` open | M40d `bare-clears-selection` |
| C34 | same file | a jump from a group to Decisions shows the back line, and it calls `history.back()`; a correction from a run shows `decisions.origin` with group/task/run; the line disappears after a sidebar link, after Forward/Back to another hash, and after a project switch, and stays across a replace within the section | M41 `back-line-missing`; M42 `origin-dropped`; M42a `back-line-sticky` (never cleared) |
| C35 | same file | an old bare `#tasks` link still opens Task control | M43 `bare-section-broken` |
| C36 | `(cd web && npx vitest run tests/shortcutsHelp.test.tsx)` | a `?` keydown on the body opens nothing and no listener calls `preventDefault`; the footer button opens a `<dialog>` via `showModal` whose `aria-labelledby` names its heading; closing it returns focus to the button | M44 `question-key-bound`; M44a `no-focus-return` |
| C37 | same file | `SHORTCUTS` names exactly the letters `reviewKeyAction` and `isRetryKey` act on (checked by calling them on a–z) | M45 `list-drift`: drop `c` from `SHORTCUTS` |
| C38 | `npm test` | Rule 18's daily gate (selects by change, includes typecheck); its "N test files selected" line and per-file skips are copied into the report as printed, not read as green | — |

Rule 9 shape check, for every new criterion: no assertion that only reads back a value the test itself wrote before the
call under test (e.g. C5 seeds `status: "blocked"` through raw SQL and asserts on what the migration wrote, never on
the seed).

### 16.2 Criteria that must be rewritten (human approval needed before the plan)

Changing the grant value and H1's behaviour changes what these existing criteria pin (list completed after review I5).
Measured at `fdceeb83` with
`grep -rnE "250_?000|ESTIMATE_GRANT" tests web/tests` (16 files match the pattern, 8 import `ESTIMATE_GRANT`) and
`grep -rn '"blocked"' tests/control/estimate*.test.ts`:

- `tests/control/estimateRetry.test.ts:253` pins `status === "blocked"` after a soft estimate overrun (and
  `group-not-prestart` at :254). Under H1 the group stays `draft`, so the skip becomes the next condition in
  `decideEstimateRetry`'s order (`budget-deficit`, `estimateRetry.ts:53`).
- `tests/control/fixtures/importPlanStoredBytes.golden.json` (lines 8, 39, 70, 124, 184) pins `grant`
  `{250000, 900000, 1, 1}` and limit/reserve figures derived from it.
- `tests/control/driverEstimate.test.ts:21`, `driverEstimateHandoff.test.ts:43, 61`, `estimator.test.ts:58, 79, 103`,
  `estimateE2E.test.ts:82`, `tokenPolicy.test.ts:105, 158` pin 250,000 or 1,250,000 (= review 1,000,000 + 250,000).
- `tests/control/singleCallOutputCap.test.ts:89-93` pins `input-too-large` for a request that fits the window but not
  250,000.
- `tests/control/estimator.test.ts:184` pins `summary.state === "blocked"` after an estimate overrun (and :185-187 the
  token deficit it leaves). Under H1 the state is `draft`; the deficit assertions stay (§4.2.5 keeps a limited-token
  deficit until a raise).
- `tests/control/estimateRetry.test.ts:270-283` (`reserve-insufficient`) shrinks the **token** reserve below
  `ESTIMATE_GRANT.tokens` and expects the skip. Under §5.2.3 a non-zero token reserve gives a smaller retry grant, so
  the skip no longer fires for tokens. Rewrite as three cases: token reserve 0 (limited) ⇒ skip; `activeMs` reserve
  below 1,800,000 ⇒ skip; `attempts`/`sessions` reserve 0 ⇒ skip; and add a case where a 1-token reserve queues a
  1-token retry.
- `tests/control/debugGroup.test.ts:208` — `expect(committed.activeMs).not.toBe(… + ESTIMATE_GRANT.activeMs)` runs
  right after `:207` pins the exact value, so it can never be red on its own (Rule 9 consequence 2 shape: a short-
  circuited assertion). Fix: delete `:208`; the intent ("no estimate grant reserved") is measured directly by `:202`
  (0 estimate rows) and `:207` (the exact committed value). Mutation that must be seen red after the fix: reserve an
  estimate grant for the debug group ⇒ `:207` red.
- Rechecked, need **no** rewrite if their fixtures keep ≥ 1,000,000 tokens of reserve and no cap (to be confirmed by
  running them in the plan's first step): `tests/control/estimateWithdrawn.test.ts:31, 52-54, 96-97` (they subtract
  `ESTIMATE_GRANT.tokens`, which equals the computed grant only then; otherwise read `estimate.grant` instead), and
  `tests/control/fixtures/web.ts:155-157` (`seedHistoricalFiniteBudget` adds `ESTIMATE_GRANT.tokens` back to a finite
  reserve; with the new cap value the seeded reserve still conserves only if the queued estimate's grant equals the
  cap — the fixture must read the estimate row's `grant` instead of the constant).

The plan must list each rewrite with its reason and wait for the human's ruling, as session `0e13a9b7` did
(`progress.md` "Ruling: 这次批准改写所有必要的判据").

## 17. Build order

1. **H1 server** (§4.2.1, §4.2.2, §4.2.5) with C1–C3, C1a, C1b. Stops new stuck groups and new deficit refusals.
2. **Schema 19 repair** (§4.3; the extracted reopen function first) with C5–C10, C7a, C9a. Lands with step 1 so no group is repaired and then re-blocked by an
   estimate.
3. **H2** (§5) with C11–C15, C11a and the §16.2 rewrites (after the human's ruling).
4. **H1 web** (§4.2.3 banner, read-only editors) with C4.
5. **Confirm checklist** (§7.4 items 1, 2, 4, 5) with C27 and part of C28. H4's web lines build on it.
6. **H3** (§6) with C16–C18.
7. **H4**: `autoConfirmBlocker` first, then the pass and the view field (§7.2, §7.3) with C19–C26, C22a, C22b, then the unlimited lines of §7.4 item 3 (rest of C28).
8. **H5** (§8) with C29.
9. **H11** (§9) in this order: codec (C30) → `navigate`/`applyRoute` and the §9.1 call sites → group region/openTask
   (C31) → deferred apply, requirement and decision routes, missing line, bare sections (C33a–C33c) → Decisions toggle →
   FlowBoard (C32) → cross-project line (C33) → back line and #47 origin (C34, C35).
10. **H12** (§10) with C36–C37.
11. `npm test` (C38) at the tip; then the human's install (the store backup and the repair happen at the service's
    first open; push and install stay the human's, Rule 15).

## 18. Not changed

- The `group-state-invalid` refusal and its copy; `prestart`.
- A work, handoff or other single-call run's breach: it still blocks the group, and there is still no command that
  unblocks it (out of H1's scope).
- The estimate's single call: no token cap is added or removed; its timeout is unchanged.
- The split's `title`, the plan schema and every plan hash (H5).
- Spend caps, their gate and copy.
- Held flow effects and `releaseRefusal` (§2.2).
- The section list and every existing bare-section hash.

## 19. Revision 1 — review findings and where each is addressed (session `ffec7b28`, 2026-10-24)

An independent review of the first draft found the anchors correct and raised the design issues below. The controller's
choices are marked ⇒; this revision applies them in place (the draft was uncommitted). The scheduled-flows spec's review
added one requirement (last row).

| Finding | Change | Where | New criteria |
|---|---|---|---|
| C1 a limited group is still stuck: a deficit makes `assertKnownConservation` refuse everything, a limit raise included; activeMs can overrun a 30-min grant in unlimited groups | ⇒ a `proposal-edit` with `proposedGroupLimit` is checked against that limit (the raise is the way out; banner `control.group.estimateDeficit`); non-token overruns grow the limit by the excess (D11), so no estimate overrun causes a deficit refusal in any dimension of an unlimited group | §4.2.5, §11, §13, §15 D11 | C1a (mutation `old-conservation-order`), C1b |
| C2 auto-confirm would start agent- or dispatched-run-imported groups | ⇒ condition 11: creating command by a person (`web`/`user:<id>`) or `origin.kind = "schedule"`; never `agent:`/dispatched; skip `body.debug` groups (condition 4). D7 stays | §2.2, §7.2 conditions 4 and 11, §12, §15 D7/D12 | C22 (`auto-confirms-debug`), C22a (`auto-confirms-agent-import`) |
| I1 repair predicate counted breaches that could not have blocked | only blocking-capable breaches count; estimate runs and single-call `clarify`/`split` runs excluded | §4.3.1 conditions 2–4 | C7a |
| I2 a repaired confirmed group would start days later | ⇒ always `draft`; a confirmed proposal is reopened exactly as `reopenProposal` does (one extracted function) and its `group_orchestration` row deleted | §4.3.1, §4.3.2, §11 | C6 (rewritten), C9a |
| I3 two automatic confirmers | ⇒ `autoConfirmUnlimitedPass` is the single one; the scheduled spec records its booked result; only `keep` delivery auto-confirms; no project/panel-wide token mode exists in this spec | §7.2 preamble | — |
| I4 a 1M grant waits on caps | ⇒ (controller's call) grant = min(1M, group remaining, binding cap headroom at reservation); headroom ≤ 0 is ignored so an exhausted cap still holds the claim; overrun stays warn-only. First draft's D4 withdrawn | §5.2.2, §5.2.3, §5.2.6, §15 | C11 (extended), C11a |
| I5 §16.2 list incomplete | added `estimator.test.ts:184`, `estimateRetry.test.ts:270-283`, retry `reserve-insufficient` for non-token dimensions, `debugGroup.test.ts:208` (vacuous — delete, with its mutation), rechecked `estimateWithdrawn.test.ts:31-97` and `fixtures/web.ts:155-157` | §16.2 | — |
| I6 route apply before data; decision route; bare sections | apply deferred until the first overview read; decision fetched by id; bare `#tasks`/`#requirements` keep the selection (D13) | §9.3 | C33a, C33b, C33c |
| I7 C15 could not tell the computed grant from the cap | C15 uses a limited group with 600,000 tokens remaining | §16.1 C15 | — |
| Minor: H3 seed masks a plan's group agent | seed only when the plan has no group agent | §6.2.1 | C17 (`seed-masks-plan-agent`) |
| Minor: `eligible` incomplete | `eligible` includes conditions 3 and 11; an absent `autoConfirm` is not eligible | §7.3 | — |
| Minor: back-line clearing vague | set/shown/cleared rules defined | §9.4 | C34 (`back-line-sticky`) |
| Minor: no criteria for `nav.routeMissing`, `#requirements/<id>`, `#decisions/<pk>/<id>` | added | §16.1 | C33a, C33b |
| Minor: H12 dialog semantics | native `<dialog>.showModal()`, `aria-labelledby`, focus return | §10.2 | C36 (`no-focus-return`) |
| Minor: idempotence not proved by a criterion | C9a | §4.3.4, §16.1 | C9a |
| Minor: C21 asserted on what was sent, not what was booked | C21 asserts on the `commands` table | §16.1 | C21 |
| Scheduled spec review: the scheduler must know when auto-confirm will never happen | exported `autoConfirmBlocker(store, groupId, facts)` — the pass's only predicate, first failing condition 1–11 with a code; condition 10 is a passed-in fact because it needs the port | §7.2, §11 | C22b (`pass-diverges`) |

### 19.1 Round 2 (session `ffec7b28`, 2026-10-24)

| Finding | Change | Where | New criteria |
|---|---|---|---|
| N1 (Critical) the repair could throw inside `migrateSchema` | the extracted reopen uses `budgetBalance`, never `residual`, and no throwing parse; unreadable bodies are skipped; every written field listed (incl. the `proposal_version` column, the `proposal` mirror, `limit`, `reviewRemaining`, `token_policies`, `committedRemaining`/ledger); the "no ledger row changes" claim withdrawn | §4.3.1, §4.3.2 | C9b (`reopen-uses-residual`, `column-not-updated`) |
| N2 `webService.ts:333`'s `residual` throws on the stored limit | with `proposedGroupLimit`, the `:333-334` checks are replaced by one `budgetBalance(proposedLimit, …)` deficit check, evaluated first | §4.2.5 | C1a (mutation targets that ordering) |
| N3 ⇒ grow at breach time | growth in `recordUsage`, estimate runs only; `group.limit`, `ledger.groupLimit` and `proposal.groupLimit` kept identical; one helper for every booking path | §4.2.5, §15 D11 | C1b (extended), C1c |
| N4 ⇒ cap term only if it covers the request | `capHeadroom` used only when `≥ requiredRequestTokens`; else the claim gate holds the estimate | §5.2.2 | C11 (rewritten) |
| N5 ⇒ option (a) | condition-10 failures booked as `auto-confirm-selections-unresolved`; `autoConfirmBlocker(store, group, defaults)` covers conditions 1–9 and 11, signature stated (D14 for the `defaults` parameter) | §7.2, §7.3, §13 | C22b (updated), C22c |
| Minor: person-token socket imports | `createdByPerson` stamp at import via `routedPersonAuthorityFor`; fallback to `commands.principal` for older groups; D12 withdrawn | §7.2 condition 11 | C22d |
| Minor: stale `pendingRoute` | cancelled by any `navigate`/`hashchange` before the first read | §9.3 | C33d |
| Minor: condition 8 | stated to clear on the next pass once defaults are configured; nothing booked | §7.2 | C22c |

## 20. Corrections found while building the server part (appended; earlier text unchanged)

Recorded by the server implementer subagent of session `ffec7b28`, 2026-10-24, on branch `feat/tester-round2-server`
(first built at `7726b8e6`, review fixes after it). Rule 13: the sections above stay as written; these notes correct them.

1. **§16.1 C1a's refusal code.** A plain `proposal-edit` (no `proposedGroupLimit`) or a `confirm` while an estimate overrun
   has left a token deficit is refused `group-budget-unavailable`, not `recovery-blocked`: today's
   `assertKnownConservation` evaluates `residual(group.limit, …)` (`webService.ts`, the check §4.2.5 keeps for these
   commands) before the deficit test, and `residual` throws `group-budget-unavailable` on a deficit. Unchanged by design
   (§4.2.5 keeps today's check). A raise still short of the deficit is `recovery-blocked`, as C1a says. The criterion
   (`tests/control/estimateBreachAdvisory.test.ts` C1a) pins both codes.
2. **§7.2 the automatic confirm's `contextPolicy`.** "`contextPolicy = proposal.contextPolicy`" cannot work: an editable
   proposal's threshold is always null (`reopenProposal`), and `confirm` refuses a null threshold under a worker profile
   that declares a context window (`execution-policy-unrepresentable`), which the defaults' estimator profile must do to
   estimate at all. The pass sends the proposal's threshold when it names one, else the worker profile's declared
   `contextWindowTokens` -- the binding flow children are confirmed with (`src/panel/flowAssembly.ts:69`).
3. **§6.2.1 the plan's group agent.** The accepted plan's group-level agent is `plan.agent?.agent` (the plan's `agent` is a
   `PartialSelection`, `src/scheduler/planFile.ts`), not `plan.agent?.group?.agent`. The seed is written after
   `writeImportedPlan`, whose estimator-layer check reads the layers as they were before the seed.

## 21. Corrections found while building the web part (appended; earlier text unchanged)

Recorded by the web implementer subagent of session `ffec7b28`, 2026-10-24, on branch `feat/tester-round2-web`, after the
independent code review of that branch (finding I1, controller's choice). Rule 13: the sections above stay as written.

1. **§7.4 item 1 — a fifth confirm blocker, `deficit`.** While a limited group's ledger carries a deficit in any dimension
   (`view.ledger.groupLimit.tokens !== null` and some `view.ledger.budgetDeficit[d] > 0`), the server refuses `confirm`
   (`assertKnownConservation`, §4.2.5; §20 item 1 for the code). `confirmBlockers` therefore returns
   `"profiles" | "selections" | "owner" | "draft" | "deficit"`, in that order; the `deficit` line
   (`budget.blocker.deficit`) carries a button (`budget.blocker.toLimit`) that moves focus to the group limit field, the
   one way out. An unlimited-token group never shows it. Criterion: C27's `deficit` row (`web/tests/confirmChecklist.test.tsx`).
2. **§7.4 item 2 — an empty checklist is not rendered.** The `<ul>` appears only when it has a line.
