# Checks and triggers: one model for the integration check, the model review and scheduled checks — design

- **Author:** spec writer for the controller of Orca session `8b1469ea` (2026-10-22), at Orca main `e4bdf4d6`.
- **Status:** design; not planned, not built. Ledger: `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md`.
- **Builds on, and partly supersedes:** kanban spec `2026-10-20-kanban-and-group-orchestration-design.md` §7 (both
  layers), §9a, §11–§14; system debug task spec `2026-10-21-system-debug-task-design.md`; protect-acceptance-criteria
  spec `2026-10-21-protect-acceptance-criteria-design.md` §5 and §9 (the criteria-review run is the pattern for the model
  review); research `docs/research/2026-10-21-flow-architecture-options.md` §3.5–§3.8 (Option B, adopted); CLI v2 spec
  `2026-10-21-cli-v2-design.md` §4, §14–§16.
- **What it supersedes:** kanban §7 layer 2's "minimum interval 24 h" becomes 7 days (human, §1). Kanban §7 layer 1's
  trigger and its per-repository setting `integrationCheck` move into the unified shape (§2, §4) with the same default
  behaviour. The kanban spec is not edited (Rule 13); the builder appends a one-paragraph pointer section to it.

## 1. Intent and the human rulings

Kanban §7 promised two layers of whole review after groups land. Layer 1 (integration check, code only) is built
(`src/control/integrationCheck.ts`, kanban §12). Layer 2 (model review) is not. The human asked that both, plus
user-defined periodic checks (cron, issue #82), share one model, with conditions editable in global and project
settings. This spec defines that model and builds layer 2 on today's code in a shape that later becomes Option B's
built-in check templates and triggers (phase 3).

Human rulings, verbatim, from `progress.md` (entry "Design item 1 (kanban layer-2 model review), human rulings
2026-10-22", line 59 at `e4bdf4d6`; measured with `grep -n "Design item 1" .superpowers/sdd/2026-10-21-session-8b1469ea/progress.md`):

- What to catch: contract/convention drift between groups (top priority), duplication, uncovered whole-behaviour
  change — **"三种都要抓，第一种最在意"**.
- The controller's review design was accepted with **"同意"**: the reviewer reads the diff range since the last review,
  each group's requirement document and reported decisions, and the conflict resolutions; findings need two-sided
  evidence (file:line, which groups); code drops findings whose refs are not in the range; dismissals are recorded (for
  later learning); major + valid ⇒ an orca-auto system debug group + a red flag; minor ⇒ a flagged decision; it never
  blocks landing; it is a read-only full run (like criteria-review), with a per-review budget cap, and its agent comes
  from a settings "review" role.
- Default and triggers: **"同意，默认开，只在触发条件满足时跑。条件也可以默认更严格…这些条件期望也可以在全局设置/项目设置里修改…用户还可以定义cronjob来周期性做这类检查。你是不是可以再统筹看下"**.
- The unified model (controller's proposal in the same entry: built-in integration check off, built-in model review on
  with trigger "conflict reconciled or overlapping files AND min interval", user-defined scheduled checks = check +
  trigger, settings project > global, a shared per-project per-check-kind "reviewed up to" watermark so a range is
  never reviewed twice by the same kind, layer 2 built now on current code, migrated to engine templates + triggers in
  phase 3) and the interval: **"默认一周吧，同意统一的模型"**.

Related rulings this spec must respect (same ledger): settings precedence project > global and optional admin locks
that only tighten (`:51`, `:52`, "能锁，也能不锁"); CLI v2 tiers and attribution (`:25`, `:26`, `:33`), including
"set-integration-check with a custom command → token: '同意'" (`:33`) — these apply when CLI v2 lands; until then this
spec keeps today's `VERB_ACCESS` tiers unchanged (§4.4); P2 (never block; flag red), P5 (few, graded
decisions), P6 (Web UI and agent path), P7 (code decides triggers and validity; the model only judges).

## 2. The unified model

A **check** is three things, all held as data and evaluated by code (Rule 5):

```
check = { id, kind, trigger, enabled }      // plus kind-specific settings (§4)
range = target commits after the watermark of (project, kind, target), up to the target head captured at start
```

### 2.1 Check kinds (closed set in v1)

| Kind | What it does | Who judges |
|---|---|---|
| `integration-check` | Re-runs, on the target branch head, the project's integration command when set, else the union of the required checks of the groups landed in the range (today's `runIntegrationCheck`, unchanged). Red ⇒ a system debug group (as built). | code (exit codes) |
| `model-review` | A read-only full system run that reads the range and looks for, in priority order: (1) **contract/convention drift between groups** — two groups that each follow a different contract, naming, error shape, schema or convention for the same thing; (2) **duplication** — two groups that built the same thing twice; (3) **uncovered whole-behaviour change** — a behaviour that only exists in the combination of two groups' changes and that no check covers. §6. | the model finds; code validates and routes |

A new kind is a code change (a registered handler), never a setting. Phase 3 turns each kind into a built-in check
template (§8).

### 2.2 Trigger (a closed condition set, AND of ORs)

```
trigger = { all: Clause[] }            // every clause must hold
Clause  = { any: Condition[] }         // at least one condition of the clause must hold
Condition (closed set, each evaluated by code):
  landed-groups      {min: n}          // ≥ n groups landed in the range (default n = 2)
  conflict-reconciled                  // a group landed in the range carries a flag of source
                                       //   `integration-conflict` (an inter-group conflict an agent resolved,
                                       //   integrationPass.ts:476). A `reconcile` flag (driverLanding.ts:589) is a
                                       //   conflict inside one group's landing and never counts, so a single landed
                                       //   group can never trigger.
  overlapping-files  {minGroups: 2}    // ≥ minGroups groups landed in the range changed at least one same path
  queue-idle                           // no group of the project holds a running slot (runningGroupIds)
  since-last         {ms}              // ≥ ms since the last run START of this (project, kind, target); true if none
  schedule           {cron}            // a slot of the cron expression passed since the last slot consumed by
                                       //   THIS scheduled check (lastSlot is keyed by scheduled-check id, §5.4)
```

Naming: a **trigger** is the whole condition document; **cron** is only the expression inside a `schedule` condition.
Implied for every trigger, not configurable: the range contains at least one landed group (§5), and no run of the same
(project, kind, target) is in flight. So a trigger can never review an empty or already-reviewed range.

Why this shape: it is the smallest structure that states both built-in triggers exactly (§3) and lets a person
tighten or loosen them in settings without a new code path. Validation (code, on write): 1–4 clauses, 1–6 conditions
per clause, `landed-groups.min` 1–50, `since-last.ms` ≥ 10 minutes, a `schedule` whose cron fires more often than once
an hour is refused (`check-schedule-too-frequent`). Unknown condition kinds are refused (`.strict()`).

### 2.3 Range

The range of a run is `W..H` on the project's target branch: `W` = the watermark of (project, kind, target) (§5), `H` =
the target head read when the run starts (frozen into the run's input). "Groups landed in the range" = the project's
groups whose `integratedCommit` is reachable from `H` and not from `W`, using today's `landedGroups` definition (local
delivery, not archived). With one target per project — the normal case — this is exactly "per project per kind".

**System-generated groups are excluded** from "groups landed in the range" wherever it is counted or compared
(`landed-groups`, `overlapping-files`, `conflict-reconciled`, the review's input list): every group with a
`body.systemDebug` mark of any source kind (`ladder`, `integration-check` fixes, `criteria-review` judges,
`model-review` reviews, `model-review-finding` fixes). Their commits still lie inside `W..H` and are visible to the
reviewer as code, but they never make a range "due" and never appear as a side of a finding. Correction debug groups
(`body.debug`, a person's act) are ordinary groups and count. **This changes the integration check** (until now
`landedGroups` counted every locally delivered group, system debug groups included): a ladder or integration-check fix
group landing no longer counts toward its `landed-groups{min:2}`. Their commits are still on the target, so the next
integration check that does run still checks them.

**Scope, by design (human, §11 Q1):** both kinds cover only groups Orca itself merged into a local target (`local`
delivery), as the as-built integration check does. Groups delivered as `keep` (today's default,
`readIntegrationDefault`) or by PR/push are **out of scope**: no review, no "not covered" warning, no alternative
mechanism. Other safeguards cover them: each group's own required checks, criteria protection at landing, and a
person's corrections (⇒ debug task).

### 2.4 Scheduled checks (#82)

A **scheduled check** is a user-defined check: `{ id, kind, trigger: {all: [{any: [{schedule: {cron}}]}]}, enabled }`.
It uses the same kind handler, the same effective kind settings other than `enabled` (§4) and **the same watermark** as
the built-in check of that kind, so an event-triggered review and a scheduled review never cover the same range twice.
**A kind's `enabled` governs its event trigger only; each scheduled check has its own `enabled`.** So "weekly only" is
`modelReview.enabled: false` plus one enabled scheduled check, and a scheduled check of a kind whose event trigger is
off still runs. A slot whose range is empty is consumed and recorded `skipped: nothing new` (no run, no spend).

Slots: evaluated by the pump each tick; missed slots collapse to the latest (Option B §3.6 "Triggers"); a slot that
falls while a run of that kind is in flight stays pending and is consumed by the next start. Time zone: the panel's
usage-calendar time zone when set, else the panel host's local zone; the view shows the next slot in that zone.

**Global scheduled checks run per project:** a scheduled check defined in the global layer is evaluated separately for
every registered project (each with its own range, watermark and `lastSlot`), so one global weekly review **spends a
review budget per project** whose range is non-empty. A project disables it by an entry with the same id and
`enabled: false`.

**v1:** scheduled checks of the two built-in kinds; at most 8 per project and 8 global (a 9th is refused
`check-schedule-limit`); add / remove / enable /
disable / edit cron in the Web UI (a list with a cron text field and a "next 3 slots" preview computed by code) and
through the control API (an `orca check` CLI domain is deferred to CLI v2, §7); a "Run now" action on any check (the
person's run: ignores the trigger, respects the watermark and the in-flight rule). **Deferred to the flow engine (phase 4, Option B §3.8):** scheduled checks with their own command or
their own review focus (`params`, reserved in v1 as a strict empty object), scheduled runs of arbitrary flow templates,
event conditions other than §2.2's, and a visual trigger editor.

## 3. Built-in defaults

| Check | Default | Default trigger (as §2.2 data) |
|---|---|---|
| `builtin:integration-check` | **off** (as built; a fresh worktree has no installed dependencies — kanban §12) | `all: [ {any: [landed-groups{min:2}]}, {any: [queue-idle, since-last{ms: 6 h}]} ]` — today's rule, except that system groups no longer count (§2.3) |
| `builtin:model-review` | **on** | `all: [ {any: [conflict-reconciled, overlapping-files{minGroups:2}]}, {any: [since-last{ms: 7 days}]} ]` |

- Model review default "on" with a strict trigger is the human's ruling ("默认开，只在触发条件满足时跑", "默认一周吧").
  A single landed group never triggers either default (kanban §7: its own checks already ran): `landed-groups` needs 2,
  `overlapping-files` needs 2 groups, and `conflict-reconciled` counts only inter-group conflicts (§2.2). A person can
  still loosen `landed-groups.min` in settings.
- `overlapping-files` (code): for each group landed in the range, the paths its integration changed
  (`git diff --name-only <integratedCommit>^1 <integratedCommit>` for a merge, the group's own commits otherwise —
  builder fixes the exact rule and records it); two groups overlap when the sets intersect. Groups landed before `W`
  are not compared (accepted: a drift against an already-reviewed group is found only if a conflict or overlap inside
  a later range also fires; stated).
- `since-last` counts from the last **start**, as today's `lastAt`, so a run that errors does not retrigger at once.
- The first evaluation of a kind for a project that has no watermark sets `W` = the target head at that moment and
  runs nothing (§5.3) — turning model review on does not review the whole history.

## 4. Settings

### 4.1 Shape and storage

Two layers, field by field: **project > global > built-in default**. Stored where the existing settings are, no new
out-of-repo write (Rule 17):

- **Project layer:** the `repository_settings` body (`src/control/workspaceSettings.ts`), new optional field `checks`.
- **Global layer:** the `orchestration_settings` body (`src/control/orchestration.ts`, `@orchestration` scope), new
  optional field `checks`, plus `checks.locks`.

```
checks = {
  integrationCheck?: { enabled?: boolean, trigger?: Trigger, command?: string | null },
  modelReview?:      { enabled?: boolean, trigger?: Trigger, budgetTokens?: int, maxGroupsPerReview?: int },
  scheduled?:        ScheduledCheck[],              // keyed by id; a project entry with a global id overrides it
  locks?:            LockablePath[]                  // global layer only
}
ScheduledCheck = { id: slug, kind: "integration-check" | "model-review", cron: string, enabled: boolean, params: {} }
LockablePath   = "integrationCheck.command" | "modelReview.budgetTokens"
```

- `enabled` on a kind switches its **event trigger** only; scheduled checks carry their own `enabled` (§2.4).
- A whole `trigger` is one field (replaced as a unit, not merged condition by condition — a merged trigger would be
  one nobody wrote).
- Absent field ⇒ next layer. Built-in values: §3, `command: null`, `budgetTokens: 1_000_000` (human,
  §11 Q2: kept until measured review costs exist), `maxGroupsPerReview: 12`.
- **Migration (no aliases, P1):** a schema step moves each `repository_settings.integrationCheck {enabled, command}` to
  `checks.integrationCheck {enabled, command}` (byte-identical meaning) and removes the old field; the global
  `criteriaReview` and the repository `criteriaReview` stay where they are (criteria review is per flag, not a range
  check; it already follows repository > global > on).
- **Revisions:** project fields move the repository settings body's revision; global fields move the `@orchestration`
  revision (as today).

### 4.2 Admin locks (optional, Option B §3.6, human "能锁，也能不锁")

- Lockable fields are the security-class ones only: `integrationCheck.command` (runs a command in Orca's environment
  outside the sandbox) and `modelReview.budgetTokens` (spend). Nothing is locked by default.
- A lock is set in the global layer. Then a project value may only **tighten**: `budgetTokens` ≤ the global value;
  `command` must be absent, `null`, or equal to the global value. A looser write is refused `check-setting-locked`
  naming the lock; an existing looser project value is ignored while the lock stands and shown struck through with
  "overridden by lock".
- "Admin" = the panel owner today (accounts spec); a separate admin role arrives with multi-user (Option B §3.6).

### 4.3 Source layer, always shown

`GET /api/control/checks?repoId=<id>` (and the global read without `repoId`) returns, per field, `{value, source:
"project" | "global" | "builtin", lockedBy: "global" | null}`, plus each check's state (§5.4). The Web UI renders exactly this (Option B §3.6 last bullet).

### 4.4 Commands and who may run them (today's `VERB_ACCESS` tiers)

This spec does **not** depend on CLI v2. Every verb maps onto today's two tiers in `src/panel/humanOnly.ts`
(`any` / `human-only`) and **loosens nothing**: today `set-integration-check` (`humanOnly.ts:47`),
`set-orchestration-settings` (`:59`) and `ratify-flagged-decision` (`:58`) are human-only, so every settings change and
every dismissal stays human-only. `set-integration-check` is **removed** (no alias) and replaced by:

| Verb (target) | Payload | `VERB_ACCESS` | Why |
|---|---|---|---|
| `set-check-settings` (repository or `@orchestration`) | `{kind, set: {...}, clear: [field]}` | `human-only` | replaces `set-integration-check` (human-only) and extends `set-orchestration-settings` (human-only); the custom command runs in Orca's environment |
| `set-scheduled-check` (repository or `@orchestration`) | `{id, kind, cron, enabled} \| {id, remove: true}` | `human-only` | a schedule spends review budget unattended |
| `set-check-locks` (`@orchestration` only) | `{locks: LockablePath[]}` | `human-only` | admin act (§4.2); gated like every other human-only settings verb today, no extra owner check |
| `run-check-now` (repository) | `{kind}` | `human-only` | starts a paid run on a person's request |
| `resume-check` (repository) | `{kind}` (after a failure-streak pause, §5.4) | `human-only` | re-arms an unattended paid trigger |
| dismiss a finding = `ratify-flagged-decision` + optional `note` | `{decisionId, note?}` | `human-only` (unchanged) | as today's ratify |
| set the `review` agent slot = `set-agent-preferences` | `{preferences: {…, review}}` | `any` (unchanged) | like the `estimator` and `reconcile` slots today |

When CLI v2 lands, its §15 table decides which of these open to a socket agent (its §15.1 already lists
`set-integration-check` with a custom command in the token tier); that is CLI v2's change to make, not this spec's.
Attribution: person writes are recorded as today's human-only verbs record their principal (and gain `by`/`via` when
CLI v2 §16 lands); every automatic act (trigger start, review-group open, debug-group open, flag write, watermark move)
is actor `orca-auto` with a deterministic command id (Rule 13).

## 5. Watermark

### 5.1 What it is

One record per (project, kind, target): **"reviewed up to `<commit>`"** on the target branch. It replaces the
integration check's `covered` map (per group integrated commit) with a single commit, because the target's history is
linear from the check's point of view and a commit is what both kinds and scheduled runs can share. Stored in a new
control-DB table `check_state(repo_id, kind, target, body)` (the schema step creates the empty table only).

**Migration of today's integration-check state — lazy, not SQL.** It needs git (ancestry of integrated commits), so a
schema step cannot do it. Until converted, the old `meta` row `integration-check:<repo>` (`covered` = group →
integrated commit) stays the source of truth and is read as today. At the pump's **first evaluation per repository**
after the upgrade, code converts it, writes the `check_state` row and deletes the `meta` row in one transaction (a
crash before the commit leaves the old row; the conversion is repeatable). The conversion derives `W` from the
`covered` map so no landed-but-unchecked group is skipped:
1. Take the repository's landed groups for the target (today's `landedGroups`, system groups excluded per §2.3),
   ordered by the target's first-parent history of their `integratedCommit`.
2. If every one is in `covered` with its current `integratedCommit`: `W` = the newest such `integratedCommit`.
3. Otherwise: `W` = the first parent of the **earliest** uncovered group's `integratedCommit`. Covered groups after it
   are checked again in the next range (over-include, never skip; recorded as `migrated: re-covers <n> groups`).
4. No landed group: `W` unset (the §5.3 first-evaluation rule applies).
`lastAt` → `lastStartAt`; `last` is kept as `last`. The model-review kind has no prior state and starts by the §5.3
rule.

### 5.2 What moves it (completion, never start)

| Run outcome | Watermark |
|---|---|
| integration check `passed` | → `H` |
| integration check `failed` (red; a debug group owns the fix) | → `H` (as today: a red check covers its groups) |
| model review completed (findings or none), output valid (§6.4) | → `H`, or → the last included group's `integratedCommit` when the range was cut to `maxGroupsPerReview` (oldest first; the rest is the next range) |
| `errored` (no worktree, no target, run failed, budget exhausted, findings file invalid after ccloop's retry) | unchanged |
| interrupted by an Orca stop (today's `forgetInterruptedIntegrationCheck`) | unchanged |

The same record serves event-triggered, scheduled and "run now" runs of the kind, so no range is checked twice by
the same kind. Moving it is one transaction with recording the run's end.

### 5.3 Edge cases (code)

- **No watermark yet:** set `W := H` at the first evaluation, run nothing, record `initialised` (§3).
- **Target rewritten** (`W` not an ancestor of `H`): range = `merge-base(W, H)..H`; record `watermark-rebased` in the
  state (visible in settings).
- **Target missing/unreadable:** the evaluation records `errored: target unreadable` once per change of reason and does
  not start.

### 5.4 Failure handling

`check_state.body` keeps `{watermark, lastStartAt, lastSlot: {<scheduledCheckId>: <slot time>}, runSeq,
failureStreak, paused, last: {state, at, from, to, groups, detail, reviewGroupId, debugGroupIds}}`. `runSeq` counts
every run start of that (project, kind, target) and is never reused; it makes each attempt at a range a distinct run
(§6.1 Ids). Each `errored` end adds 1 to `failureStreak` (an interruption does not); a
completed run resets it. At 3 the check of that kind is **paused for that project** (no trigger or schedule starts it),
shown red in Project settings with the last error; nothing else waits (P2). `resume-check` (human-only, §4.4) clears the pause.

## 6. The model-review run

### 6.1 Mechanism: a read-only system run (built on the criteria-review substrate)

The review reuses the substrate the criteria-review judge uses (protect spec §9): a **system debug group** opened by
the pump as `orca-auto`, confirmed and started without a click, with claims, recovery and run machinery from the
existing code. **It is not like the judge in one respect:** the criteria-review judge may change code (its instruction,
`systemDebug.ts:82`, says "restore the stronger criteria and fix the code", and a `restored` verdict fast-forwards its
branch into the flagged group's). Read-only enforcement for the model review is **new work**, specified below.

- **Source kind (schema change).** `systemDebugSourceSchema` (`webProtocol.ts:940-942`) requires `groupId`; a review
  has no single source group. It becomes a discriminated union on `kind`: the three existing variants unchanged, plus
  - `{kind: "model-review", repoId, target, from: <W>, to: <H>, runSeq}` (the review; `runSeq` from §5.4), and
  - `{kind: "model-review-finding", repoId, reviewGroupId, findingId}` (a major finding's fix, §6.5).
  `SYSTEM_DEBUG_SOURCE_KINDS`, the `INSTRUCTION` table and `systemDebugGoalText` (which reads `source.groupId`) gain
  these variants; every reader of `mark.source.groupId` is listed in the plan and handles their absence.
- **Ids** (`systemDebugGroupId`, sha256 of the canonical source), with prefixes that are not prefixes of each other:
  `sysreview-<sha256(canonical {kind, repoId, target, from, to, runSeq})[:16]>` for a review and
  `sysfinding-<sha256(canonical {kind, repoId, reviewGroupId, findingId})[:16]>` for a finding's fix. A second open of
  the same attempt or finding is an idempotent lookup; **a retry after an `errored` review opens a new group** because
  the next start has a new `runSeq` (the errored group stays as the record of that attempt).
- **Auto-confirm without a source group (controller's call).** For the review: agent selection = the settings `review`
  slot (below); **profiles and budget mode = those of the newest confirmed group in the same repository** (by confirm
  time, system groups included only if no other exists); integration scheme forced to `keep`. No confirmed group in
  the repository ⇒ the review is not opened and settles `errored: no-profiles`; Project settings shows the hint "confirm
  one group in this project first". The confirm payload requires `profileIds`/`profileHashes` for `worker`, `handoff`
  and `goalReview` (`webProtocol.ts:758-759`): all three are copied from that group's confirmed bindings. They are
  bindings only; with no handoff and no goal-review allocation (below) nothing is ever claimed against them. For a
  finding's fix: `profilesFrom` = the newest involved group (by landing order among the evidence groups), as other
  system debug groups.
- **Stripped group.** The review group is imported with **no goal-review allocation and no handoff allocation**
  (`planImport.ts` adds both for ordinary groups); its only allocation is the task's work grant, whose **tokens =
  `budgetTokens`** (not `TASK_WORK`'s 3,000,000; only the non-token dimensions come from `TASK_WORK`,
  `src/control/estimator.ts`), and the group limit equals the same amount. So `budgetTokens` caps the whole group; no
  estimate call (system debug spec §2).
- **Settling a review (new branch in `systemDebugPass`, next to the `criteria-review` branch, keyed on
  `mark.source.kind === "model-review"`).** Code maps the group's state to exactly one end, recorded on the mark's
  `settled` and in `check_state.last`:
  - run `succeeded` ⇒ read the findings (§6.4) ⇒ `completed` (or `errored: not-read-only` / `errored: findings-invalid`);
  - `errored: budget` when the run ends with a terminal whose `budgetSnapshot.tokenBudgetRemaining` is 0 (or
    `attemptsRemaining`/`timeRemainingMs` is 0, recorded as which), **or** the group's claim or continuation is refused
    for lack of grant/limit before any `succeeded` run. The outcome `exhausted` alone is not enough (it is read with the
    snapshot);
  - `errored: archived` (a person archived it), `errored: stopped` (a stop intent settled), `errored:
    blocked-waiting-human` (terminal `blocked_waiting_human`), `errored: claim-refused:<code>` (any other refused claim),
    `errored: confirm-refused:<code>`;
  - `errored: not-admitted` when the group was not admitted within **24 h** of opening (lowest admission priority can
    starve it; the group is archived as `orca-auto` so it frees nothing it never held);
  - any other non-`succeeded` terminal ⇒ `errored: run-failed:<failureCause | outcome>`.
- **Start point:** a branch at `H` (no `stackOn`); **it never lands and is never folded**: integration `keep` (work stays
  on its `orca/<id>` branch), and no pass may fast-forward it into another branch.
- **Read-only, enforced by code (new):**
  0. **A dedicated plan builder** (`buildModelReviewPlanSource`, next to `buildSystemDebugPlanSource`, which
     hard-codes the write set `**` and so cannot be reused). Same input ⇒ same bytes, no model, no I/O.
  1. The task contract's write set is `.orca-review/findings.json` plus `.decisions/**` (the run's own decision
     ledger); ccloop's write-set enforcement rejects anything else inside the run. **Rule 16:** at open, code checks
     both paths against the target repository's denylist (the contract denylist the repository's groups use); a denied
     path ⇒ the review is not opened and settles `errored: findings-path-denied` (Orca never loosens a target repo's
     rules).
  2. Required check = a findings-schema validator shipped with Orca, invoked **by absolute path** to Orca's installed
     `dist` from the worktree (`node <abs>/validate-findings.js .orca-review/findings.json <from> <to>`), so it needs
     nothing installed in the target repo. Malformed output fails the run's own check and ccloop's in-run retry sees
     the error.
  3. After the run settles `succeeded`, code lists `git diff --name-only <H> <attemptCommit>`; any path other than the
     two above ⇒ `errored: not-read-only`, nothing is read, no flag or debug group is opened.
  4. The criteria-protection detection and the criteria-review pass skip model-review groups (they can change no test).
- **Admission:** it takes a running slot but is admitted **after** person-confirmed groups (lowest priority; it fixes
  nothing). Debug groups opened from its findings are admitted first, as system debug groups are today.
- **Agent:** a new `review` slot in the operator's agent preferences (`operatorPreferencesSchema`, next to `estimator`
  and `reconcile`), set from Agent settings through `set-agent-preferences` (`any`, §4.4); absent ⇒ `defaultAgent`. Phase 3 maps it to Option B's `review` role.
- **No recursion:** review and finding groups are system groups, excluded from every range count (§2.3); a finding
  group's own failure is not escalated (system debug spec §2).

### 6.2 Inputs (built by code, frozen, each bounded and cut by the head rule with the cut recorded)

The inputs exceed the system debug input's `facts` limit (32 lines × 4096, `webProtocol.ts:948`), so they are **not**
passed as facts. Code writes them as files (one JSON per item below, plus `index.json`) into a per-run input
directory under Orca's existing run root (no new out-of-repo path, Rule 17), and `facts` carries only the range and
that directory's absolute path. If the agent's sandbox cannot read outside its worktree, the builder instead writes
them to `.orca-review/input/` in the worktree, lists that prefix in the worktree's `.git/info/exclude`, and the
post-run path check (§6.1 step 3) ignores exactly that prefix; the plan records which was chosen and why. Their bytes are frozen in the review's input artifact (sha256 recorded on the mark).

1. The range: target, `W`, `H`, and per landed group: id, goal, `integratedCommit`, changed paths, diff stat.
2. Each group's **requirement document** (the accepted requirement of a requirement group; a plain-plan group gives its
   plan goal and task goals instead).
3. Each group's **reported decisions** landed in the range (the group's decision ledger lines: question, choice,
   reason, evidence).
4. **Conflict resolution records**: the `integration-conflict` flags (inter-group, what each side changed and how they
   were merged) and, as context only, the `reconcile` flags of groups in the range.
5. The instruction: categories in priority order (drift first), the output schema, "change no file except
   `.orca-review/findings.json`", "every finding needs evidence from two groups", "report nothing rather than guess".

The agent reads the code at `H` in its workspace; the diff itself it reads with git (`W..H`), not from a pasted copy.

### 6.3 Output schema (`orca-model-review-findings-v1`, zod, strict)

```
{ schema: "orca-model-review-findings-v1",
  range: { from: <W>, to: <H> },                       // must equal the input; else the review is errored
  findings: [ {                                         // 0–20
    id: slug,
    category: "contract-drift" | "duplication" | "uncovered-behaviour",
    severity: "major" | "minor",
    title: string ≤ 120, explanation: string ≤ 2000,
    evidence: [ { groupId, path, line: int ≥ 1, note: string ≤ 300 } ],   // 2–8 entries, ≥ 2 distinct groupIds
    suggestedFix: string ≤ 2000 } ] }
```

### 6.4 Code-side validation (Rule 5; the model never decides validity)

A finding is **valid** only if every evidence entry has: `groupId` among the groups landed in the range; `path` among
that group's changed paths; `1 ≤ line ≤` the line count of `path` at `H`; and the entries span ≥ 2 distinct groups.
Invalid findings are **dropped**, kept in the review record with the reason (`ref-not-in-range:<groupId>:<path>`,
`one-sided`, `line-out-of-file`) for later learning, and never shown as flags. A file that fails the schema or whose
`range` differs is `errored` (§5.2).

### 6.5 Handling

| Finding | What code does |
|---|---|
| valid, `major` | opens a system debug group of source `model-review-finding` (id from review id + finding id; not stacked; the project's own integration scheme; facts = the finding, its evidence and suggested fix; held to the union of the involved groups' required checks) as `orca-auto`, **and** writes a red flag `source: model-review` (decision id `model-review:<reviewGroupId>:<findingId>`, row keyed to the review group, `involvedGroupIds` = the evidence groups, §6.6). If the union of the involved groups' required checks is **empty**, no debug group is opened (a system debug group must be held to ≥ 1 check, `webProtocol.ts:949`); the red flag alone stands and records `no-checks: fix not opened` |
| valid, `minor` | a flag `source: model-review` with `severity: minor`; listed under the involved groups' decisions, **not** counted in the card's "decisions waiting" and not red (P5) |
| invalid | dropped (§6.4) |

- **Never blocks landing**: nothing waits on a review; landings, starts and the integration check run as before.
- **Dismissal** = `ratify-flagged-decision` (human-only, unchanged) with an optional `note` (the person's reason).
  Dismissals are queryable through the control API (`GET` of the review detail, §7) for later learning. Dismissing does
  not stop an open debug group; the person stops or archives it as any group.
- **Correcting** instead (the person thinks the fix is wrong) goes through the existing correction path.

### 6.6 Schema work this needs (listed so the plan cannot miss one)

- **Flag body** (`flagBodySchema`, `src/control/flaggedDecisions.ts:15-23`, `.strict()`): optional `severity: "major" |
  "minor"` (absent = major, today's meaning), optional `note` (≤ 2048, the dismissal reason), optional
  `involvedGroupIds: string[]` (2–8, the finding's evidence groups, stored **structurally**, not parsed from text).
  No `dismissedBy`: the existing `ratifiedBy` / `ratifiedAt` / `ratifyCommandId` already record who dismissed and when.
  `source` needs no change (free kebab-case, `:10-14`). The card's "decisions waiting" count excludes `severity: minor`.
- **Query by involved group:** the group view lists flags whose `group_id` is the group **or** whose
  `involvedGroupIds` contains it (a JSON scan over `source = 'model-review'` rows is enough at this size; the builder
  may add an index table if measured slow). That is how an involved group's card shows the badge.
- **Ratify target:** a model-review flag's row stays keyed to the **review group** (`group_id` = the review group,
  decision id `model-review:<reviewGroupId>:<findingId>`); `ratify-flagged-decision` targets the review group whatever
  card the person clicked from.
- **Ratify payload** (`ratifyFlaggedDecisionPayloadSchema`, `webProtocol.ts:924`): optional `note`, stored on the flag
  body next to `ratifiedBy`.
- **System debug source** (`webProtocol.ts:940-942`): the discriminated union of §6.1.
- **Operator preferences** (`operatorPreferencesSchema`, `webProtocol.ts:64-71`): optional `review` slot.
- **Settings bodies**: `checks` on `repository_settings` and `orchestration_settings`; `integrationCheck` removed from
  the repository body; `setOrchestrationSettingsPayloadSchema` unchanged (checks go through `set-check-settings`).
- **New table** `check_state` and the migration of the `integration-check:<repo>` `meta` rows (§5.1).
- **Review record**: the review's valid and dropped findings, stored as an artifact referenced from `check_state.last`
  (content-addressed `artifacts` table), so the detail view and later learning read one place.

## 7. Web UI and agent path (P6)

| Where | What | Agent path today (control API; human-only verbs need a person, §4.4) |
|---|---|---|
| Global settings → Checks (`web/src/GlobalSettings.tsx` / `OrchestrationSettings.tsx`) | each kind: event trigger enabled, trigger (a form per condition, generated from the closed set), command, budget, groups per review; global scheduled checks, each with its own enable; locks (owner only) | `GET /api/control/checks`; `set-check-settings`, `set-scheduled-check`, `set-check-locks` on `@orchestration` |
| Project settings → Checks (`web/src/ProjectSettings.tsx`) | the same fields with a **source badge** per field (project / global / built-in, "locked"), "override" and "reset to inherited"; per kind: watermark (short sha + time), last run, failure streak / paused + Resume, next scheduled slot, **Run now** | `GET /api/control/checks?repoId=`; `set-check-settings`, `set-scheduled-check`, `run-check-now`, `resume-check` on the repository |
| Board card | "review finding" badge on involved groups (major red, minor grey); the review group itself shows as a system group card | group summary read |
| Review detail (new view, linked from Project settings and the card) | range, groups, valid findings with evidence links, dropped findings with reasons, dismissals with notes, the debug groups opened | a read route for the review record (builder names it) |
| Decisions list | model-review flags; Dismiss (with note), Correct | `ratify-flagged-decision {decisionId, note}`; correction verbs |
| Agent settings | the `review` slot | `set-agent-preferences` |

Reads are open to an agent today; the writes are human-only (§4.4), so an agent completes these flows only where a
person performs the human-only step, as with every human-only verb today. **Deferred to CLI v2** (and said so in its
plan): the `orca check` domain (`show`, `set`, `reset`, `schedule`, `run`, `resume`, `findings`, `lock`),
`orca decision ratify --note`, `orca agent set-preferences --review`, removing `set-integration-check` from CLI v2 §4's
`orca project` row, and any loosening of §4.4's tiers for a socket agent.

## 8. Migration to the flow engine (Option B phase 3)

| Today (this spec) | Phase 3 | Stable across the move |
|---|---|---|
| kind handler `integration-check` | built-in check template `builtin/integration-check`: one `check` step (`role: gate`) + `onFailure` subflow = system debug | the kind name, the command/required-checks rule |
| kind handler `model-review` | built-in template `builtin/model-review`: one `review` step (isolated judge, typed verdict = §6.3 schema) + a code step that validates and routes (§6.4–§6.5) | the findings schema, the validation rules, the routing |
| §2.2 trigger, scheduled checks | Option B triggers (`(trigger, plannedAt)` keyed, missed slots collapse, failure-streak pause, credited to the last publisher) targeting a template instead of a kind | the trigger document shape and its condition names; `kind` becomes a template id (`params` gains the template's params) |
| `checks` settings in the two existing bodies | Option B settings layers (project > global, locks only tighten, source shown) | field paths and precedence; locks |
| `check_state` watermark per (project, kind, target) | the same table, keyed by template id | the record and the "advance on completion" rule |
| system debug groups as the run substrate | flow runs | — |

## 9. Success criteria (each a command with an exit code; Rule 4, Rule 9)

Per Rule 18 the day-to-day gate is `npm test` (+ typecheck), which selects affected tests and prints what it selected;
the builder records the selection (0 selected is reported, not counted as green). Named tests (paths are the builder's
to fix; each must first be **seen red** on its named mutation in a `git clone --local` copy, Rule 15):

1. **Selection and green, as one command:** `npm test > /tmp/checks-npm-test.log 2>&1; rc=$?; node
   scripts/assert-selected.mjs /tmp/checks-npm-test.log tests/control/checkTriggers.test.ts
   tests/control/checkWatermark.test.ts tests/control/checkSettings.test.ts tests/control/checkStateMigration.test.ts
   tests/control/modelReviewFindings.test.ts tests/control/modelReviewE2E.test.ts tests/control/checkAccess.test.ts
   tests/control/removedVerb.test.ts web/src/checksSettings.test.tsx || exit 1; exit $rc` — exits 0 only if `npm test`
   exited 0 **and** every named path appears in its printed selection (the small `assert-selected.mjs` exits 1 naming
   each missing path; paths are the builder's to rename, the list in the plan is authoritative). The whole log is read
   back, not filtered (Rule 14). Mutation seen red: drop one named file from the selection map.
2. **Trigger evaluator** (`checkTriggers.test.ts`, pure function over a fixture store): the integration default
   reproduces today's four cases (≥2 landed & idle; ≥2 & 6 h; 1 landed ⇒ no; running ⇒ no) **with system groups now
   excluded** (a ladder fix group plus one ordinary group ⇒ no check; this is the one intended change, §2.3); the
   model-review default fires on (`integration-conflict` flag ∧ 7 days) and on (overlap ∧ 7 days), not on overlap at
   6 days, not on 3 landed groups without overlap or conflict, not on a single landed group carrying a `reconcile`
   flag; a system group of each source kind landing with overlapping files neither counts toward `landed-groups` nor
   makes an overlap; a `keep`-delivery group never counts (out of scope, §2.3); with `modelReview.enabled: false` and one
   enabled scheduled check, the event trigger never fires and the schedule does; **missed slots collapse** (three
   missed weekly slots ⇒ one run, `lastSlot` = the latest); `lastSlot` is per scheduled-check id (two schedules of one
   kind consume their own slots); a global scheduled check evaluates once per project. Mutations seen red: AND/OR of
   clauses swapped; `since-last` from the last completion; `overlapping-files` against groups before `W`; "range
   non-empty" dropped; `reconcile` flags counted; system groups counted; `keep` groups counted; kind `enabled` gating
   scheduled checks; every missed slot run; `lastSlot` keyed by kind.
3. **Trigger and schedule validation** (`checkSettings.test.ts`): `check-schedule-too-frequent` for a cron firing more
   than hourly; `since-last.ms` < 10 min refused; a 9th scheduled check refused `check-schedule-limit` (project and
   global separately); unknown condition kind refused. Mutation seen red per rule: remove it.
4. **Watermark** (`checkWatermark.test.ts`): completion moves it, start does not; `errored` and interruption leave
   it; a scheduled slot right after an event-triggered review of the same kind with no new landing is `skipped: nothing
   new`; cut range moves it to the last included group's commit; rewritten target uses the merge-base; first evaluation
   initialises without a run. **Retry:** an `errored` review, then the trigger on the same range ⇒ a **new** review group
   (different `runSeq`, different id) is opened; the errored group is untouched. **Failure streak:** three `errored`
   ends ⇒ paused (no trigger or slot starts it) ⇒ `resume-check` ⇒ the next trigger starts it; an interruption does not
   count. Mutations seen red: advance at start; advance on `errored`; per-trigger watermark; id without `runSeq` (retry
   returns the errored group); streak counting interruptions; pause ignored by schedules.
5. **Settings precedence and locks** (`checkSettings.test.ts`): project > global > built-in per field; whole-trigger
   replacement; a locked `budgetTokens` refuses a higher project value and accepts a lower one; a locked `command`
   refuses a different project command; **an existing looser project value written before the lock is ignored** while
   the lock stands (effective = global, `lockedBy: "global"`) and applies again after unlock; the read returns `source`
   and `lockedBy`. Mutations seen red: swap layer order; allow a looser write under a lock; honour the existing looser
   value under a lock; deep-merge triggers.
6. **Migration** (`checkStateMigration.test.ts`): a repository body with `integrationCheck {enabled:true, command:"npm ci
   && npm test"}` reads back with the identical effective setting; the lazy conversion (§5.1) runs at the first pump
   evaluation for that repository and not before (the old `meta` row is read until then): all covered ⇒ `W` = the
   newest covered commit; one landed-but-uncovered group between covered ones ⇒ `W` = the first parent of its
   integrated commit; none landed ⇒ unset; the `meta` row is gone after and a crash injected before commit leaves it.
   Mutations seen red: drop the field mapping; `W` from `last.commit`; delete the `meta` row before writing
   `check_state`.
7. **Findings validation** (`modelReviewFindings.test.ts`): must-keep and must-drop sample sets (an out-of-range
   group, a path the group did not change, a line past EOF, one-sided evidence, a `range` mismatch). Mutations seen red:
   accept refs outside the range; accept one-sided evidence.
8. **Model review end to end** (`modelReviewE2E.test.ts`, control-plane harness with fake agents,
   `tests/control/fixtures/ccloopWorld.ts`; no paid run). The fixture **first lets the pump initialise `W` on an empty
   range and asserts `W` = the target head**, then lands 3 groups, two overlapping; after the faked 7 days the pump opens
   exactly one review group as `orca-auto` with id prefix `sysreview-`; profiles copied from the newest confirmed group;
   no goal-review and no handoff allocation; work grant tokens = limit = `budgetTokens`. The fake reviewer writes one
   valid major, one valid minor, one invalid finding ⇒ exactly one `sysfinding-` debug group, one red and one minor flag
   with `involvedGroupIds`, both listed on the involved groups' views, one dropped record; watermark = `H`; a landing
   during the review is not delayed. Variants, each its own case: a reviewer editing another file ⇒ `errored:
   not-read-only`, `W` unchanged, streak 1; a terminal with `budgetSnapshot.tokenBudgetRemaining: 0` ⇒ `errored:
   budget`; a claim refused for the group limit ⇒ `errored: budget`; archived ⇒ `errored: archived`; stopped ⇒
   `errored: stopped`; `blocked_waiting_human` ⇒ `errored: blocked-waiting-human`; other refused claim ⇒ `errored:
   claim-refused:<code>`; not admitted within 24 h ⇒ `errored: not-admitted`; no confirmed group in the repository ⇒
   `errored: no-profiles`; findings path on the repo denylist ⇒ `errored: findings-path-denied`; a major finding whose
   involved groups have no required checks ⇒ red flag, no debug group, `no-checks: fix not opened`. Mutations seen red:
   remove the post-run path check; route minor like major; let the review land or fold; give it a goal-review
   allocation; grant `TASK_WORK` tokens; derive budget from `exhausted` alone; drop the refused-claim → budget mapping;
   drop the not-admitted timeout; skip the denylist check; open a debug group with an empty check list.
9. **Access** (`checkAccess.test.ts`, today's tiers): every new §4.4 verb is `human-only` in `VERB_ACCESS` (a socket
   agent is refused, a person succeeds); `set-agent-preferences` with a `review` slot stays `any`. Mutation seen red:
   mark `set-check-settings` `any`. *(The CLI v2 access-matrix extension is deferred to CLI v2.)*
10. **Removed verb** (`removedVerb.test.ts`): fails if `set-integration-check` appears in `src/`, `web/src/`, `skills/`
    outside the migration code and its test. Mutation seen red: re-add the string to a route table.
11. **Web** (`checksSettings.test.tsx`, jsdom): Project settings shows source badges, "locked", Run now, Resume, the
    `no-profiles` hint; the card badge on an involved group; Dismiss sends `ratify-flagged-decision` to the review
    group with the note. Mutations seen red: render the global value's badge as `project`; send the ratify to the
    clicked card's group.
12. **Deferred, not a criterion of this spec — agent path (P6) via CLI:** the `orca check` walk (show → set → schedule
    add → run → findings → ratify with note) belongs to CLI v2's plan; this spec's agent path today is the control API
    reads of §7, exercised by criterion 8.

## 10. Left to the builder (decide, record in the plan's ledger)

- Exact verb, route and field names within §4.4 and §7.
- The changed-paths rule per landed group (merge vs fast-forward integrations) and how it is cached.
- Cron parsing (an existing dependency if one is already in the tree, else a small 5-field parser with tests); the time
  zone source.
- Input size bounds per item (§6.2) and the head-rule cut; which of the two input locations of §6.2 is used.
- The validator's exact file name in `dist` and how the contract names its absolute path.
- Whether the review group's branch is deleted after its findings are read, or kept for audit (Orca-owned
  `refs/heads/orca/*`).
- Where the "groups per review" cut sits relative to admission (one review per range vs splitting a backlog).
- The pump order of the check pass relative to the system debug pass.

## 11. Questions the human answered (ruled 2026-10-22)

- **Q1 — keep/PR delivery: ruled out of scope.** Human (verbatim, `progress.md`, last entries, "Human on S1 Q1"):
  "不用这么复杂，keep和 PR 合入的都不用审阅，靠其他方式兜底就好。" ⇒ both check kinds cover only groups Orca merged into a
  local target; `keep` and PR groups are not reviewed, no "not covered" warning is shown, and no alternative mechanism
  is built; their safeguards are their own checks, criteria protection and corrections (§2.3). (An earlier controller
  proposal in `progress.md` to watch the target branch regardless of who merged is superseded by this ruling.)
- **Q2 — budget cap default: ruled.** Human (verbatim, relayed by the controller 2026-10-22; to be logged in
  `progress.md`): "可以先用这个" ⇒ `modelReview.budgetTokens` defaults to 1,000,000 tokens until measured review costs
  exist (no cost is estimated here, Rule 14).
