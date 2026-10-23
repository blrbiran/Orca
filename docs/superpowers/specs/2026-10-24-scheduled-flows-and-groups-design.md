# Scheduled flows and scheduled groups, with a plan library — design

- **Author:** spec-writer subagent of the controller of Orca session `ffec7b28` (2026-10-24). **Status:** design only;
  not planned, not built, not committed by the writer (the controller commits).
- **Closes:** tester's old issue #82 (user-defined cron jobs), human decision **H9**. Checks-and-triggers already built
  #82 for the two check kinds (`docs/superpowers/specs/2026-10-22-checks-and-triggers-design.md`, "S1"); this spec
  builds the part S1 §2.4 deferred: "scheduled runs of arbitrary flow templates", plus scheduled task groups.
- **Builds on (cited "S1 §n", "F §n", "G §n"):** S1; flow engine `2026-10-22-flow-engine-design.md` (F); flow phase-1
  gaps `2026-10-22-flow-phase1-gaps-design.md` (G), in particular G §21 entry 8 (releasing a held external effect needs
  person authority on every path); CLI v2 `2026-10-21-cli-v2-design.md` (registry §11, tiers §15, `by`/`via` §16); in-repo
  plan path `2026-10-21-in-repo-plan-path-design.md` (the plan trust boundary); requirement to split
  `2026-10-02-requirement-to-split-design.md`.
- **Depends on:** `docs/superpowers/specs/2026-10-24-tester-round2-design.md` ("R2"), ruling **H4**: R2 §3 (an
  unlimited-token group is one whose `limit.tokens === null`; H4 is **per group**) and R2 §7.2 (`autoConfirmUnlimitedPass`,
  the one automatic confirmer). This spec adds no confirmer of its own (§9.2). It also takes the schema step **after**
  R2's (§12).
- **Revised in place** after an independent review (session `ffec7b28`, controller's choices C-1…C-3, I-1…I-6, minors);
  the change list is §21.
- **Ledger:** `.superpowers/sdd/2026-10-24-session-ffec7b28/progress.md` (cited `progress.md:<line>`).
- **Anchors (Rule 14):** every `path:line` below was measured with `grep -n` / `sed -n` / `cat -n` on Orca `main` at
  **`fdceeb83`** (`git rev-parse --short HEAD`). Line numbers must be re-measured before a plan cites them.
- **Marks.** "(writer's call)" = decided by this spec writer under CLAUDE.md Rule 1 step 2 (reversible), each listed
  again in §20 for the human. "(controller)" = the controller's design given in the brief. Everything else is a human
  ruling (§1) or follows from one.

---

## 1. Human rulings (verbatim)

From `progress.md:27` (2026-10-24, ~00:15–00:25 local) and the controller's brief of the same session:

- **H9 scope:** 「两种都要」 — scheduled flow starts **and** scheduled task groups.
- **Agreed defaults for flows** (controller's proposal, agreed in the same exchange): cron, at most hourly, reusing the
  checks-and-triggers cron rules; a flow template plus fixed params; if the previous fire's run is still active, this
  fire is skipped and recorded; external/irreversible effects stay held for the person — G §21 entry 8 is unchanged:
  **a schedule never counts as the person**.
- **Group source:** 「计划文件，但是不要要求必须是仓库里已合入的计划文件，可以是仓库外的计划文件。同时这个计划文件可以是通过需求拆分并保存的。当前没有合适的导出计划文件的路径也是一个问题。甚至可以是，从已有group直接导出计划文件或者从已有group直接建cronjob」.
- **Controller's design for it** (`progress.md:27`): a **plan library**; entries arrive by (a) saving a requirement's
  split, (b) exporting an existing group's plan, (c) the owner importing any plan file (copied in, content hash pinned);
  a schedule references a library entry by id + hash; "schedule this group" = export + create schedule in one action;
  each fire imports the plan as a new group; only Orca-written or owner-imported entries are trusted; budget:
  unlimited-token groups auto-confirm (H4, through R2's pass), limited groups stop at a one-click confirm.
- **Review:** 「这一轮 spec 写好后都要派独立 subagent review」 (`progress.md:25`) — this spec goes to an independent
  reviewer before a plan is written.

---

## 2. Goals, non-goals, anti-goals

### 2.1 Goals

1. A person defines a **schedule**: a cron expression plus either a **flow start** (template + fixed params on a
   registered `dir` project) or a **group start** (a pinned plan-library entry version, imported into a repository
   project). Code fires it; nothing about whether or when to fire is a model call (Rule 5).
2. A **plan library** that holds plans Orca can import without a git-tracked file inside the repository, filled from a
   requirement split, from an existing group, or from any file the owner imports; and an export path out of it
   (download, `orca plan export --out`).
3. "Schedule this group" on a group page: one action.
4. Every fire, skip and failure is recorded with who/when/why (Rule 13); the person sees and manages schedules on the
   Web, in the CLI and through MCP.

### 2.2 Non-goals (this spec)

- Event-triggered starts (only `schedule` conditions; S1's other conditions stay check-only).
- Global (all-projects) schedules — a library entry and a folder both belong to one project (§6.4, writer's call).
- Editing a plan inside the library (a new version arrives by re-saving or re-importing; §5.6).
- Scheduled groups on `dir` projects: groups run on repository projects today; when `dir` requirements via the vault
  (`progress.md:23`, D1) land, their spec decides whether group schedules extend to them.
- A "fire now" button (§20 item 8).

### 2.3 Anti-goals (must never happen; each has a criterion in §17)

- A fire acts with the person's authority: confirms an external/irreversible effect, releases a held effect, confirms
  a push/PR delivery, or raises a pool.
- A missed or disabled period produces more than one fire when the panel comes back.
- Two runs of one schedule are active at once because of the schedule.
- A library entry whose bytes differ from the pinned hash is imported.
- A test writes under the real `HOME` or `~/.orca` (Rule 17).

---

## 3. As built today (what this spec reuses; measured at `fdceeb83`)

| Fact | Where |
|---|---|
| 5-field cron parser, `cronTooFrequent` = more than one minute value (so at most hourly), `validateSchedule` (cron + zone), `latestSlot` (missed slots collapse to the newest), `nextSlots`, `cronSlotsBetween` | `src/control/checks/cron.ts:33`, `:49`, `:64`, `:127`, `:138`, `:112` |
| Scheduled checks: a new schedule's `lastSlot` starts at the latest slot ≤ now (no catch-up); due slots; paused state; `PAUSE_AFTER = 3` | `src/control/checks/pass.ts:104`, `:113`, `:155` |
| Time zone for slots: the usage calendar's zone, else the host's | `src/control/usageCalendar.ts:9`; used at `src/control/webService.ts:1133` (`dueCheck`, `:1128`) |
| The pump: `systemDebugPass → checksPass → flow pass → autoStart → …`, only when an execution driver and the flow kernel exist; interval `wakeIntervalMs`, default 5000 ms | `src/panel/controlAssembly.ts:297`, `:366`; `src/panel/controlOptions.ts:16` |
| `checksPass` finds projects from the `groups` table (a project with no group is never evaluated) | `src/control/webService.ts:1074` |
| Flow start: only a registered `dir` project's folder; built-in templates only; idempotent by command id (`uuidOf(idempotencyKey)`); records `by`, `via`, `unattended`, `pool` | `src/flow/flowCommands.ts:44`, `:125`; `src/flow/kernel.ts:173` |
| Flow effect level resolution (project > global > template > built-in; `irreversible` clamped to `confirm`; built-in `external` = `apply-flag`) | `src/flow/settings.ts:22`, `:41`; called at `src/flow/effects.ts:72` |
| `flow-start` is `any` but refused to a run Orca dispatched; its `pool` is a human-only field (`token` on the socket) | `src/panel/humanOnly.ts:86`, `:101`, `:113`, `:167` |
| Person authority = owner on the Web, or an owner's person token on the socket and not a dispatched run | `src/panel/permissions.ts:51` |
| Attribution `by` (the person, never an agent) / `via` (channel) | `src/panel/permissions.ts:21`; `orca-auto` = `ORCHESTRATION_ACTOR`, `src/control/orchestration.ts:18` |
| Plan trust today: a plan file must be a regular file **inside** its registered repository (`control-path-escape`), re-validated per import, digest pinned (`plan-changed-since-registration`) | `src/panel/controlConfig.ts:214`, `:236`, `:244`, `:254`; registration `src/panel/projectRegistry.ts:277` (git-tracked only, in-repo plan path spec §2) |
| The import form says "No trusted repository and plan are configured for this panel." / 「这个面板没有配置受信任的仓库和计划。」 when nothing is registered | `web/src/ControlPanel.tsx:217`; `web/src/locales/en.ts:444`; `web/src/locales/zh.ts:313` |
| Import without a file: a requirement's accepted split is imported from a **stored** plan (`schedulerControlPlanSourceOf` + `normalizeControlPlan` + `writeImportedPlan`) | `src/control/requirementCommands.ts:346`; `src/scheduler/planFile.ts:320`; `src/control/planImport.ts:89`, `:272` |
| A group's archived plan (`orca-control-plan-v1`, contracts inlined as canonical JSON, loop recipes kept) | `src/control/queries.ts:131`; schema `src/control/webProtocol.ts:435` |
| Confirm as `orca-auto` from another group's confirmed profiles, budget mode, context policy, with `integrationHash` when the scheme is not `keep` | `src/control/webService.ts:962` (`autoConfirmSystemDebug`); confirm payload `src/control/webProtocol.ts:784` |
| (To be built by R2 §7.2) `autoConfirmUnlimitedPass`: confirms as `orca-auto` a `draft` group with `limit.tokens === null`, **no delivery scheme**, not a flow child or system-debug group, defaults configured; booked under `orca-auto-confirm-unlimited-v<proposalVersion>` either way; runs after the flow pass, before `autoStart` | R2 §7.2 (spec, not code at `fdceeb83`) |
| `keep` adds no integration field to a group body (`readGroupIntegration` is null) | `src/control/planImport.ts:205` comment; `src/control/integrationScheme.ts:195` |
| Id format of control ids: `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`, ≤ 200 | `src/control/schema.ts:9` |
| Dispatched runs: refused a verb in `DISPATCHED_RUN_REFUSED`, every human-only entry, and every `token` predicate row | `src/panel/permissions.ts:59-73` |
| Group statuses `clarifying | draft | ready | running | review | done | blocked`; flow run states `running`, `paused`, `stopped`, `done` | `src/control/types.ts:69`; `src/flow/messages.ts:294-300`, `src/flow/kernel.ts:969` |
| Control DB schema `"18"`; a pre-migration backup is made by code (G §21 entry 1) | `src/control/migrations.ts:4` |
| CLI v2 registry; MCP is one `orca` tool running the registry, refusing only `panel`, `user`, `dev` | `src/commands/registry.ts`; `src/entry/mcp.ts:12` |

---

## 4. Vocabulary

- **Schedule**: `{id, projectId, kind: "flow" | "group", cron, enabled, start}` plus its state. Belongs to one project.
- **Slot**: an instant the cron expression names, in the usage calendar's zone (S1 §2.4).
- **Fire**: what the scheduler does for one slot of one schedule — it ends `started`, `waiting` (a group that needs
  the person), `skipped` or `failed` (§6.2, §7). One row per (schedule, slot), never two.
- **Plan library entry**: a named, project-bound plan with append-only **versions**; a version is an immutable
  `orca-plan-v1` document named by its sha256 (§5).
- **Ids** (distinct prefixes, each passing `idSchema`, `src/control/schema.ts:9`): schedule `sch-<slug>`; library entry
  `pl-<16 hex>`; a group a fire imports `sgrp-<16 hex>` (§7.5); its plan id `lib-<entryId>-<sha256[:12]>`.

---

## 5. The plan library

### 5.1 Where it lives (refines the controller's design — writer's call, §20 item 1)

The controller's brief places the library "under `$ORCA_CONTROL_DIR`" as files. **This spec stores it in the control
DB**, which already lives under `$ORCA_CONTROL_DIR` (`control.sqlite`), in two new tables (§12). Reasons, after a forced
rebuttal round (Rule 1):

- *For files:* the person can `ls`, copy and version them. *Against:* a hand edit of a file in Orca's directory would
  silently break the pinned hash and turn a schedule red; files there are not covered by the code-level pre-migration
  backup (G §21 entry 1); and a second store means a second Rule 17 writer with its own failure residue.
- What the human asked for is (1) a source that need not be a git-tracked file in the repository and (2) an export
  path. (1) is met by importing the bytes; (2) by **download** (Web) and **`orca plan export --out`** (CLI, §13.1),
  which write where the person says. So the library adds **no new panel-side out-of-repo writer**; the only new
  out-of-repo write is the CLI's `--out`, the person's own path (§16).

### 5.2 Format `orca-plan-v1` (self-contained, strict, canonical)

```
{ schema: "orca-plan-v1",
  goal: string (1..2000), successConditions: string[] (1..20, unique),
  agent?: PartialSelection, reconcileAgent?: PartialSelection,          // as orca-control-plan-v1
  tasks: [ {                                                             // 1..200
    taskId, dependsOn: taskId[] (unique, no dangling, acyclic), targetVersion: int ≥ 1,
    agent?: PartialSelection, labels?: string[],
    contract: <task contract object>       // exactly one of contract | loop
  | loop: <loop plan recipe>  } ] }
```

- It is the scheduler plan file (`src/scheduler/planFile.ts:42`) **without the repository-bound fields** (`targetRepo`,
  `ccloopBin`, `runsDir`, `workBranch`, `policy`, `ledgerMode`) and with each contract **inline** instead of a path.
- Stored as canonical bytes (`canonicalBytes`); the version id is `sha256` of those bytes. Max 2 MiB canonical
  (`plan-library-doc-too-large`) (writer's call).
- Loop tasks keep their recipe and are expanded **at import into a group**, with the project's path, exactly as a plan
  file's loop tasks are (`expandPlanFileLoop` via `schedulerControlPlanSourceOf`, `src/scheduler/planFile.ts:320`).
  Contracts are checked against `taskContractSchema` and their `objective.taskId` at **every** write and every import.

### 5.3 Sources

| Source | Verb (§11) | What code does |
|---|---|---|
| (b) an existing group | `plan-library-save {source: {kind: "group", groupId}}` | reads the group's archived plan (`readArchivedPlan`, `src/control/queries.ts:131`, which already verifies its hash) and maps it to `orca-plan-v1`: each task's `originalContractCanonicalJson` → `contract`, except a task with a `loop` recipe → `loop` (the recipe, not the expansion). Records `origin {kind: "group", groupId, planHash}` |
| (a) a requirement split | `plan-library-save {source: {kind: "requirement-draft", groupId, draftNo, draftHash}}` | takes the stored draft plan **awaiting review or accepted** (not drafting, not superseded); refuses `plan-version-conflict` when `sha256Canonical(draft.plan) !== draftHash` (the same check acceptance makes, `requirementCommands.ts:333`); maps it to `orca-plan-v1`; **does not accept the draft**. An accepted requirement group can equally be saved as source (b). Records `origin {kind: "requirement-draft", groupId, draftNo, draftHash}` |
| (c) any file the owner imports | `plan-library-import {projectId, doc, provenance}` | the panel **never reads a path**: the Web uploads the file's bytes; the CLI reads the file in its own process (§13.1). Accepted inputs: an `orca-plan-v1` document, or a **scheduler plan file** whose contract paths the CLI reads and inlines (its `targetRepo` must equal the chosen project's path, else `plan-library-target-mismatch`; each contract path, resolved, must lie **inside that repository** and is opened without following a symlink in any component — the `checkedPath` rule of `src/panel/controlConfig.ts` — else `plan-library-contract-path-refused:<taskId>`; loop tasks stay recipes). Records `origin {kind: "import", fileName, fileSha256, format: "orca-plan-v1" \| "scheduler-plan-file"}` |

Every source runs the same validation as an import (`normalizeControlPlan`'s graph checks, `src/control/planImport.ts:89`,
plus §5.2) **before** anything is stored, so the library never holds a plan that cannot be imported (refusal
`control-plan-rejected` with today's item codes).

### 5.4 Trust (controller's rule, made concrete)

- **The library has exactly one writer: Orca's control service, and every write is a person's command** (human-only
  verbs, §11). There is no directory a third party can drop a file into; a row without a person's command does not
  exist. That is what "only Orca-written or owner-imported entries" means here: (a) and (b) are Orca writing data it
  already holds, under a person's command; (c) is the owner's explicit act of trust over bytes they chose — the same
  boundary the in-repo plan path spec draws for registration ("登记计划是信任边界").
- Saving (a)/(b) as a **new** entry is socket-`open` (the data is already in Orca); importing (c) is `token`; and
  **appending a version to an existing entry** (either verb with `entryId`) is `token`, because it changes what that
  entry offers to every schedule's repin and to one-off imports (§11.2).
- **Pinning:** a schedule names `{entryId, sha256}`. At each fire code reads that version's bytes, recomputes the
  sha256 and refuses `plan-library-hash-mismatch` on any difference (defence in depth: the DB is the only store, but a
  restored or hand-edited DB must not import silently).

### 5.5 Import into a group now (one-off)

`import-plan` gains an alternative to `planId`: `libraryEntry: {entryId, sha256}` (exactly one of the two). It builds the
plan source from the pinned version (§5.2 expansion with the project's path) and continues as today
(`normalizeControlPlan` → `writeImportedPlan`), with `planId = lib-<entryId>-<sha256[:12]>`. Access unchanged
(`any`, `src/panel/humanOnly.ts:10`): an entry is trusted on the same footing as a registered plan. This is also what
fixes the import form's empty state (§13.3).

### 5.6 Versions, archive

- Saving or importing with `entryId` given appends a new version to that entry (same project only,
  `plan-library-project-mismatch`); without it, a new entry is made. Versions are never changed or deleted.
- An entry's `head` is its newest version. Schedules **do not follow head**: a schedule is created and repinned only
  with an **explicit `sha256`** (no default to head), and the form, `schedule show` and the CLI's confirmation line
  print that version's `by`, `via`, `origin` and time before the write, so the owner sees whose bytes they pin. The
  schedule view shows "newer version available".
- `plan-library-archive {entryId}` hides an entry from lists; refused `plan-library-entry-in-use` while any schedule
  (enabled or not) pins it. No unarchive in v1 (writer's call; an import makes a new one).

---

## 6. Schedules: data model

### 6.1 Schedule body

```
schedule = {
  id: "sch-<slug>"  (^sch-[a-z0-9][a-z0-9-]{0,59}$), projectId, name (1..80), kind: "flow" | "group",
  cron: string (validateSchedule), enabled: boolean,
  start:
    | { kind: "flow",  template: "builtin/<id>@<n>",  params: Record<string, scalar>, clarify?: "skip",
        unattended?: boolean, pool?: int }                         // the flow-start payload minus dir/projectId
    | { kind: "group", entryId, sha256,                             // sha256 always explicit (§5.6)
        tokenLimit: int | null,                                     // owner-set; null = unlimited-token group (R2 §3)
        integration: IntegrationScheme | null },                    // pinned at write; null = keep
  createdBy, createdVia, createdAt, updatedBy, updatedVia, updatedAt,
  enabledBy, enabledVia, enabledAt,                                 // the last person who enabled it (fires are credited to them)
  state: { lastSlot: int | null, tz: string | null, failureStreak: int, paused: boolean, pausedReason: string | null }
}
```

- `template` is stored **with its version**: the version the person named, or, if they named none, the version the
  build ships at write time (writer's call: a template update must not silently change what a schedule runs). The
  kernel enforces it at every start (§8 step 2, new check): a version the build does not ship is refused
  `flow-template-version-missing` and recorded as a failed fire.
- `params` are checked at write against the template's params (`resolveStartParams`' rules; `flow-param-invalid:<id>`).
  An `image` param must be folder-relative (a preset-style absolute path is refused at write,
  `schedule-param-absolute`): the file is read at each fire by flow start, as at a person's start (G §21 entry 3–4).
- `pool` is the human-only field of `flow-start`; it is accepted only through `schedule-set`, which is `token` (§11), so
  the value a fire passes is one the owner authorised (the same reasoning as configured delivery, F H26).
- `tokenLimit` (controller's choice C-1): the owner may give a group schedule a token limit; it is applied **at import**
  as the new group's `limit.tokens` (§9.1). `null` (the default, as every new group's token ceiling, token-policy spec
  §1) makes each fired group an unlimited-token group, which R2's pass may confirm; a number makes it a limited group,
  which waits for the person's one-click confirm (R2 §7.5). A token limit is a budget amount: only through
  `schedule-set` / `schedule-from-group`, both `token`.
- `integration` is pinned at write: `schedule-from-group` pins **the source group's current scheme**
  (`readGroupIntegration` of its body; `null` for `keep`); `schedule add group` pins the project's default at that
  moment (`readIntegrationDefault`, `src/control/integrationScheme.ts:18`). Any value other than `null` makes every
  fired group wait for the person (§9.2). Setting a non-`keep` scheme here is the same act as `set-integration-scheme`
  and so `token` (`humanOnly.ts:184`'s `deliveryTier`), which `schedule-set` already is.

### 6.2 Fire record (append-only, the audit trail)

```
fire = { scheduleId, seq, slot, at, lateMs, missed,                     // missed = slots collapsed into this one
         outcome: "starting" | "started" | "waiting" | "skipped" | "failed",
         reason: string | null,                                         // skip / waiting / failure code with detail
         commandId, flowRunId: string | null, groupId: string | null,
         confirm: null | { state: "auto-confirmed" | "auto-confirm-refused", commandId, code: string | null, at },
         by: "orca-auto", via: "schedule:<scheduleId>", creditedTo: <schedule.enabledBy> }
```

Allowed moves, each at most once, nothing else of a row ever changes (§12 enforces it in the single writer, as the flow
journal does): `outcome` `starting → started | failed`; for a group fire `started → waiting` (the group needs the
person, §9.2); `confirm` null → value (copied from R2's booked command, §9.2). `waiting` is a needs-you state, not a
failure: it never counts toward the failure streak (§7.6) and the group is listed in the panel's needs-you list.

### 6.3 Limits

- At most **8 schedules per project** (enabled or not; a removed one does not count) — `schedule-limit` (S1 §2.4's
  number; writer's call).
- Cron at most hourly, by `validateSchedule` (`src/control/checks/cron.ts:64`) and its refusal
  `check-schedule-too-frequent`; a zone the host cannot read, `check-time-zone-invalid`. **One rule, one name**: the
  code and its name are reused, not copied (Rule 7).
- **DST** (as `src/control/checks/cron.ts:3-9` already does): a wall time that does not exist (spring gap) is not a
  slot that day — no fire; an ambiguous wall time (autumn overlap) is one slot, at the first instant.
- **Time-zone change** (the usage calendar's zone, read each pass): the zone used is stored in `state.tz`. When the
  pass reads a zone different from `state.tz`, it re-initialises `lastSlot` in the new zone (§7.2, no fire) and stores
  the new zone, so a zone change can never fire a slot "in the past" of the new zone; the next slot in the new zone fires
  normally.

### 6.4 Project only, no global layer (writer's call)

S1 has global scheduled checks evaluated per project. Here a group schedule pins a project-bound library entry and a
flow schedule needs a folder, so a global layer has nothing to point at. Schedules live in their own table keyed by
project, not in the settings bodies; there are no locks (nothing lockable: the security-class choices — `pool`,
`tokenLimit`, `integration`, enabling — are already `token`).

---

## 7. The scheduler (deterministic code; Rule 5)

### 7.1 Where it runs

A new `schedulesPass()` on the control service, in the pump **after `checksPass` and before the flow pass**
(`src/panel/controlAssembly.ts:297`): a flow run a fire just started advances in the same pump, and a group a fire just
imported meets R2's `autoConfirmUnlimitedPass` (after the flow pass, before `autoStart`, R2 §7.2) and `autoStart` in
the same pump. It iterates the `schedules` table (not the `groups` table — `checksPass`'s way, `webService.ts:1074`,
would never evaluate a project without groups). With no execution driver the pump does not run it at all; the
schedules view then says so (§14 `schedules.noPump`).

### 7.2 One pass (pure decisions over stored facts, then one write each)

```
0. RESUME FIRST (C-3): for every fire row with outcome "starting", of any schedule, oldest first:
     did the start already happen? flow: a flow_runs row "fr-<uuidOf(commandId)>" exists;
                                    group: a booked commands row (sgrp-…, commandId) for import-plan exists.
     yes ⇒ T2 from what exists (started, or failed with the booked error code).
     no and the schedule is now removed, disabled or paused ⇒ T2 failed, reason "schedule-disabled"
        (M-1: a person's stop between T1 and the crash wins; the streak is not counted for this reason).
     no otherwise ⇒ re-run its start (step 7) with its own commandId, then T2 (step 8).
   Only then evaluate schedules:
1. if !enabled or state.paused: nothing.
2. tz = readUsageCalendar(store).timeZone
   if tz !== state.tz: lastSlot := latestSlot(spec, tz, -∞, now) ?? now; state.tz := tz; stop (no fire).
   slot = latestSlot(parseCron(cron), tz, state.lastSlot, now)          // newest slot in (lastSlot, now]
   if slot === null: nothing.
3. missed = cronSlotsBetween(spec, tz, state.lastSlot, slot).length - 1 // for the record only
4. active = runs this schedule started that are still active (7.4) — a "starting" row counts as active
   if active non-empty: write fire {outcome: "skipped", reason: "previous-active:<id>"}, lastSlot := slot. stop.
5. T1: write fire {outcome: "starting", commandId = "orca-auto-schedule-<scheduleId>-<slot>"}, lastSlot := slot.
6. (no separate step: a T1 insert that hits UNIQUE(schedule_id, slot) means another pass took the slot — stop.)
7. start (§8 or §9), idempotent by commandId.
8. T2: outcome := started (+ ids) | failed (+ code); failureStreak := started ? 0 : failureStreak + 1;
       paused := failureStreak >= PAUSE_AFTER (3, src/control/checks/pass.ts:155), pausedReason := the code.
9. GROUP FOLLOW-UP (§9.2): for every group fire with outcome "started" and confirm or waiting still open,
   copy R2's booked confirm result / derive "waiting" (pure reads, then one write).
```

`lastSlot` is initialised, **without firing**, to `latestSlot(spec, tz, -∞, now) ?? now` — and `state.tz` to the zone
it was computed in, in the same write (M-2) — when a schedule is created, enabled after being disabled, resumed after a
pause, its cron is edited, or the zone changes (S1's `initialiseSlots`
rule, `src/control/checks/pass.ts:104`, extended). So no slot from before the person's act ever fires.

### 7.3 A slot missed while the panel was down: fire **once**, late (writer's call, §20 item 2)

When the panel comes back, step 2 finds the newest missed slot and fires it **once**, recording `lateMs = now − slot`
and `missed` (how many earlier slots collapsed into it). Older missed slots never fire.

- **For:** it is S1's rule ("missed slots collapse to the latest", S1 §2.4; Option B §3.6) — one trigger model, not two
  (Rule 7); the person asked for the work to happen each period, and a period whose slot was missed still gets one run;
  spend is bounded to one run per schedule per restart; the overlap rule (§7.4) still applies.
- **Strongest case against (skip):** a time-sensitive run (a "morning brief" article) firing at 15:00 after a crash may
  be stale, and an unattended run at an unexpected hour spends when nobody expects it.
- **Why "once" still wins:** what could make a late run harmful — publishing, pushing — is exactly what stays held for
  the person (§10), so a stale draft waits for them rather than going out; the cost is one bounded run, visible as
  "late by 6 h" in the fire list. A per-schedule "skip missed" switch is left out (Rule 2) and listed in §20.

### 7.4 Overlap: skip and record (human ruling)

Active = any fire of **this schedule** whose outcome is `starting` (C-3: a start not yet settled), or whose outcome is
`started`/`waiting` and whose run or group is still:

| Kind | Active when | Not active when |
|---|---|---|
| flow | `flow_runs.state ∈ {running, paused}` | `done`, `stopped` |
| group | not archived **and** `status ∈ {draft, ready, running, review, blocked}` (`src/control/types.ts:69`) | `done`, or archived |

A group waiting at the one-click confirm is `draft` and so active: limited or delivery-scheme groups never pile up, one
per schedule at most. The skip **consumes** the slot (unlike S1, where a slot that falls during a run stays pending):
the human's ruling is "skip this fire and record it". A skip neither counts toward nor resets the failure streak. A run
started by hand from the same template or entry is not "this schedule's" and does not block it.

### 7.5 Crash safety

- T1 and T2 are each one transaction; the start between them is idempotent by `commandId`: flow start derives the run
  id from it (`uuidOf(idempotencyKey)`, `src/flow/kernel.ts:174-178`); the group import is an `import-plan` command
  **through the command ledger** (§9.1) with `commandId` and the deterministic group id
  `sgrp-<sha256(scheduleId + "\0" + slot)[:16]>`, and the ledger answers a replayed command id with its first booked
  result (`preflightWebCommand`).
- Step 0 continues every `starting` row before any slot is evaluated, so a crash after T1 followed by downtime past the
  next slot still yields exactly one run for the old slot, and the new slot is then **skipped** as overlapping (that
  run is active) — never two runs, never a lost one.
- `UNIQUE(schedule_id, slot)` (§12) makes a second fire row for one slot impossible even if two passes raced; T1 treats
  the constraint error as "taken" (step 6).
- R2's confirm and this spec's record of it are separate writes; a crash between them is healed by step 9, which reads
  the booked `commands` row each pass until it has copied it (§9.2).

### 7.6 Failure streak and pause

A failed start (any refusal of the start in §8/§9: `flow-dir-unregistered`, `flow-template-invalid`,
`flow-template-version-missing`, `flow-param-invalid:<id>`, `role-unresolved:<role>`, `flow-command-missing:<name>`,
`plan-library-hash-mismatch`, `control-plan-rejected:<item>`, a spend-cap refusal of the import,
`control-target-not-allowed`, …) adds one; a started fire resets it; a skip or a `waiting` group leaves it unchanged;
three in a row pause the schedule (`pausedReason` = the last code), shown red. `schedule-resume` clears it and
re-initialises `lastSlot` (§7.2). A run that **starts** and later fails is the run's own failure, not the schedule's.

---

## 8. Flow fires

Step 7 for `start.kind = "flow"`:

1. Resolve the project's folder from the project registry at fire time (the start's own resolver,
   `registeredDirProject`, `src/flow/flowCommands.ts:44`); a project that is gone or no longer `dir` fails the fire
   `flow-dir-unregistered`.
2. Call `startFlowRun` (`src/flow/kernel.ts:173`) directly — not through the HTTP route, so no principal is involved —
   with `templateRef`, `dir`, `projectId`, `params`, `clarify`, `unattended`, `pool` from the schedule;
   **`by: "orca-auto"`, `via: "schedule:<scheduleId>"`**, `operatorId` = the schedule's `enabledBy` (whose agent
   preferences resolve roles, as `operatorId` does today), `idempotencyKey` = the fire's `commandId`, and a new field
   **`origin: {kind: "schedule", scheduleId, slot}`** written into the run body (`FlowRunBody`,
   `src/flow/kinds/registry.ts:62`; a body field, no DDL).
   **New kernel check (I-1), for every start, scheduled or not:** today `startFlowRun` accepts `builtin/<id>@<n>` and
   loads the built-in without comparing `n` (`src/flow/kernel.ts:179-183`). When a version is given and the loaded
   template's version differs, the start is refused `flow-template-version-missing` (booked, en/zh copy) before
   anything is written.
3. The parent group is confirmed by `orca-auto` with the run pool exactly as every flow start is (F §6.3); there is no
   person confirm for a flow start today, and a fire adds none (writer's call, §20 item 3): the pool (owner-set on the
   schedule, or settings/template) bounds the run.

Everything after the start is an ordinary flow run: the person can send feedback, rewind, stop, answer asks; the run
page shows "started by schedule <name> for <slot>" (§13.3).

---

## 9. Group fires

### 9.1 Import (through the command ledger — writer's call per the review)

Step 7 for `start.kind = "group"` sends **one `import-plan` command** to the service's own import path
(`importControlPlanAsync`, `src/control/planImport.ts`, as the Web route calls it), not a direct `writeImportedPlan`
call: actor `orca-auto`, `commandId` = the fire's, target group `sgrp-<…>` (§7.5), payload
`{groupId, repoId, libraryEntry: {entryId, sha256}, tokenLimit, integration}`. The ledger books it, so a replay after a
crash returns the first answer, and every check of a person's import applies (spend caps, the estimator defaults).
The import path, for the `libraryEntry` form (§5.5): reads the pinned version, recomputes its sha256
(`plan-library-hash-mismatch`), builds the plan source with the project's repository path (§5.2), `normalizeControlPlan`
with `planId = lib-<entryId>-<sha256[:12]>`, then `writeImportedPlan` (`src/control/planImport.ts:272`) with:

- the group limit's `tokens` = `tokenLimit` (other dimensions as today's import default);
- the group's integration = `newGroupIntegration(integration)` (`src/control/integrationScheme.ts:195`), i.e. the
  scheme pinned on the schedule, not the project default of the moment;
- `origin {kind: "schedule", scheduleId, slot}` on the group body;
- the estimate exactly as a person's import of that group (R2 §5 sets the grant by the group's limit).

`tokenLimit` and `integration` are new optional payload fields of `import-plan`, accepted **only with
`libraryEntry`**, and listed in `HUMAN_ONLY_FIELDS["import-plan"]` (socket `token`; a non-`keep` `integration` is what
`confirm.integrationHash` guards today). The fire passes them in-process as `orca-auto`, replaying values the owner
authorised at `schedule-set` (the `pool` reasoning, §6.1). The fire is `started` once the command answers success.

### 9.2 Confirm: one confirmer, R2's pass (C-1, C-2)

This spec **sends no confirm**. A fired group is an ordinary `draft` group; R2's `autoConfirmUnlimitedPass` (R2 §7.2)
is the only automatic confirmer and decides by its own conditions 1–10. Because of §9.1, a fired group meets them
exactly when the schedule says so:

- **auto-confirms** only if `tokenLimit === null` (R2 condition 2) **and** `integration === null`, i.e. `keep` (R2
  condition 6; C-2: `local` is a scheme too and waits) — plus R2's other conditions (defaults configured, selections
  resolve, no running estimate, …);
- **waits for the person** otherwise: a limited group stops at the one-click confirm (R2 §7.5); a group with any
  delivery scheme keeps the owner's click (`confirm.integrationHash`, `humanOnly.ts:108`).

Step 9 of §7.2 then **records**, deriving everything from booked facts (I-2), each at most once:

| Fact read (first that holds) | Fire row write |
|---|---|
| a `commands` row `(sgrp-…, orca-auto-confirm-unlimited-v<N>)` exists with a success result | `confirm = {state: "auto-confirmed", commandId, code: null, at}` |
| that row exists with an error result | `confirm = {state: "auto-confirm-refused", commandId, code, at}`; `outcome := waiting`, `reason = "auto-confirm-refused:<code>"` |
| no such row, the group is `draft`, and `limit.tokens !== null` | `outcome := waiting`, `reason = "limited"` |
| no such row, the group is `draft`, unlimited, no scheme, and R2's exported pure `autoConfirmBlocker(store, group)` returns condition **8** (no control-config defaults) or **10** (selections do not resolve for `orca-auto`) — the two R2 conditions that never clear by waiting | `outcome := waiting`, `reason = "auto-confirm-ineligible:<condition>"` |
| no such row, the group is `draft`, and the body has an integration scheme | `outcome := waiting`, `reason = "delivery-needs-person:<delivery>"` |
| the group's estimate ended failed or refused (H1 keeps status; the estimate row's state says so) | `outcome := waiting`, `reason = "estimate-failed:<code>"` |
| the group is no longer `draft` without such a row (a person confirmed it) | nothing more to record; the group's own `confirm` ledger row names the person |

**Dependency on R2 (N-1):** R2 must export `autoConfirmBlocker(store, group): null | <condition number>`, the same pure
function its pass uses for conditions 1–10, so this table and R2's pass cannot disagree (the controller tells R2's
author). Step 9 never re-implements R2's conditions. Any other R2 condition (an estimate running, a queued estimate,
the command not yet tried) is transient: nothing is recorded and the next pass looks again.

`waiting` puts the group in the needs-you list with "Waiting for you since <slot> (<reason>)" next to the existing
Confirm button (R2 §7.4's checklist) — the one-click confirm. **Which list (M-3):** the control overview's needs-you
steps (`readControlOverview`, `src/panel/controlOverview.ts:19`), whose `budget-review` step a `draft` group with an
editable proposal already gets (`:94`); for a fired group its `reason` becomes `scheduled-waiting:<fire reason>` and
its destination stays the group's budget region. It is **not** the flow board's needs-you rule (`web/src/BoardView.tsx`,
flow runs), which this spec does not touch. Confirming it is the person's ordinary `confirm`. A
waiting group is active, so later slots are skipped (§7.4).

### 9.3 What the person controls

The owner chooses, on the schedule, between "runs on its own" (`tokenLimit: null`, `integration: null`) and "waits for
my click" (a token limit, or any delivery scheme). The schedule form says which one the current values give
(`schedules.groupConfirmMode.*`, §14). Nothing in this spec reads a project- or panel-wide budget mode: H4 is per group
(R2 §3).

---

## 10. The security boundary: a schedule never counts as the person

G §21 entry 8 and F §9 stand unchanged. Concretely, by code:

1. **Who acts.** Every act of a fire is `orca-auto` with `via: schedule:<id>`; no fire path builds a principal, so
   `hasPersonAuthority` (`src/panel/permissions.ts:51`) is false for everything a fire does, and the kernel's
   `flow-effect-needs-person` refusals apply to it as to any run.
2. **External and irreversible effects are held.** For a run whose body carries `origin.kind = "schedule"`,
   `resolveLevel` (`src/flow/settings.ts:41`) gains `opts.scheduled: true`, which clamps classes `external` and
   `irreversible` to **at least `confirm`** (a `stage-only` setting stays `stage-only`; locks still only tighten). So
   under today's built-in `external: apply-flag` (`src/flow/settings.ts:22`) a scheduled run's WeChat draft upload waits
   at a confirm card, while the same template started by hand keeps the person's setting. `local` and `cost` are not
   clamped (`cost` stays apply + flag, F H35; the pool caps it). The clamp shows in the run page's provenance as
   `source: "schedule"`.
   **The schedule clamp beats configured delivery (I-6).** Today `opts.configuredDelivery: true` sets the project
   value to `apply-flag` and exempts it from the `irreversible` clamp (`src/flow/settings.ts:49-54`), because a push/PR
   the person configured is their explicit choice (F H26). In a scheduled run nobody is there to make it at that
   moment, so `scheduled` is applied **last**, after the configured-delivery value, the irreversible clamp and the lock:
   `scheduled && cls ∈ {external, irreversible} && value === "apply-flag" ⇒ confirm`. (Configured delivery reaches
   flows with `repo` workspaces in phase 3; the rule is stated now so it cannot be forgotten.)
3. **Confirming** that card is `flow-effect` (human-only, `token` on the socket, refused to dispatched runs): only the
   person.
4. **Groups:** this spec sends no confirm (§9.2). R2's pass never confirms a group with a delivery scheme or a token
   limit; a fire never sets a group limit beyond the owner's `tokenLimit`, never raises a pool, never confirms a push,
   PR or local-merge delivery.
5. **Unattended** (if the schedule says so) changes only how asks are answered (defaults recorded as decisions, today's
   meaning); it never confirms an effect.

---

## 11. Access

### 11.1 Verbs

| Verb (target) | Payload | `VERB_ACCESS` | Socket tier (`SOCKET_TIER`) | Why |
|---|---|---|---|---|
| `schedule-set` (schedule) | create: `{projectId, name, cron, enabled, start}`; edit: `{scheduleId, set: {...}}` with expected revision; a group `start` always carries `sha256` | `human-only` | `token` | starts paid work unattended; `pool` and `tokenLimit` are budget amounts; `integration` is a delivery choice |
| `schedule-enable` (schedule) | `{scheduleId, enabled}` | `human-only` | `enabled: true` → `token`; `false` → `open` | as `set-scheduled-check` (`humanOnly.ts:158`): arming spends, disarming does not |
| `schedule-remove` (schedule) | `{scheduleId}` | `human-only` | `open` | stops spending |
| `schedule-resume` (schedule) | `{scheduleId}` | `human-only` | `open` | as `resume-check` (`humanOnly.ts:181`) |
| `schedule-from-group` (group) | `{groupId, name, cron, enabled, tokenLimit?}` | `human-only` | `token` | = `plan-library-save` (b) + `schedule-set` with the new version's sha256 and the source group's integration scheme, one transaction |
| `plan-library-save` (library) | `{source, name, entryId?}` | `human-only` | without `entryId` → `open`; with `entryId` → `token` | a new entry copies data Orca holds; appending a version changes an existing entry (§5.4) |
| `plan-library-import` (library) | `{projectId, name, entryId?, doc, provenance}` | `human-only` | `token` | the owner's act of trust over outside bytes (§5.4) |
| `plan-library-archive` (library) | `{entryId}` | `human-only` | `open` | hides only |
| `import-plan` + `libraryEntry` | §5.5; fields `tokenLimit`, `integration` only with `libraryEntry` | `any` (unchanged); `tokenLimit`, `integration` in `HUMAN_ONLY_FIELDS` | those fields `token` | as a registered plan; the two fields are a budget amount and a delivery choice |
| reads: schedules, fires, library, versions, download | — | — | open | — |

- **Owner** (Web) may do everything; **members** (Web) are refused every human-only verb (`control-verb-human-only`;
  Web members are not tiered, `src/panel/humanOnly.ts:120`) and see the lists read-only; the **socket agent** follows
  the tier column (a `token` row needs `--as-person`); **a run Orca dispatched is refused every row above** except
  reads and `import-plan` without the two fields — by the existing rule, because each row is a human-only entry
  (`permissionRefusal`, `src/panel/permissions.ts:59-73`), not by a new list. The mutation that would open a row to a
  dispatched run is classifying its verb `any` in `VERB_ACCESS` (C9 names it).
- Every write records `by`/`via` from `attributionOf` (`src/panel/permissions.ts:21`), stored on the schedule
  (`createdBy`, `updatedBy`, `enabledBy`, with `…Via`, `…At`) and on each library version.
- Command scope: each schedule has its own revision (optimistic concurrency on edit, as groups and settings bodies);
  the library uses one `@plan-library` scope with revision 0 like `@flows` (`src/flow/flowCommands.ts:2-6`), its writes
  guarded by their own checks (an entry id is unique; versions are append-only). Exact scope names are the builder's.

### 11.2 Why these tiers (Rule 1 rebuttal recorded)

The strongest case for letting members save to the library is that saving spends nothing. It is refused anyway
because an entry becomes schedulable and importable by anyone (§5.5), so creating one is a trust act, as registering a
plan is today (owner only). Reversible: one row each in `VERB_ACCESS` (§20 item 7).

---

## 12. Data model and schema migration

One schema step, taken **after R2's** (R2 §4.3 is 18 → 19): **19 → 20** when R2 merges first, which the build order
requires (§18); if the H7 spec also lands a step first, this one takes the next free number at merge. The step's
predecessor is whatever version is current when it merges, never 18 by assumption. Every table is `STRICT`, created
empty with `CREATE TABLE IF NOT EXISTS`; nothing existing is rewritten; the code-level backup of G §21 entry 1 precedes
it as for every version change.

```sql
CREATE TABLE IF NOT EXISTS plan_library(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','archived')), body TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS plan_library_versions(entry_id TEXT NOT NULL REFERENCES plan_library(id),
  version INTEGER NOT NULL CHECK(version > 0), sha256 TEXT NOT NULL, doc TEXT NOT NULL, origin TEXT NOT NULL,
  "by" TEXT NOT NULL, via TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY(entry_id, version), UNIQUE(entry_id, sha256)) STRICT;
CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('flow','group')), revision INTEGER NOT NULL CHECK(revision >= 0),
  removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)), body TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS schedule_fires(schedule_id TEXT NOT NULL REFERENCES schedules(id),
  seq INTEGER NOT NULL CHECK(seq > 0), slot INTEGER NOT NULL, at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('starting','started','waiting','skipped','failed')), reason TEXT,
  flow_run_id TEXT, group_id TEXT, "by" TEXT NOT NULL, via TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY(schedule_id, seq), UNIQUE(schedule_id, slot)) STRICT;
CREATE INDEX IF NOT EXISTS schedules_by_project ON schedules(project_id);
CREATE INDEX IF NOT EXISTS plan_library_by_project ON plan_library(project_id);
```

- **Remove is a mark, not a delete** (`removed = 1`), so fire rows keep their schedule (Rule 13). A removed schedule is
  never evaluated, frees its slot in the 8-per-project limit, and its fires stay readable.
- `plan_library_versions` is append-only; `schedule_fires` is append-only except the forward moves of §6.2, enforced
  by their single writer module (as `src/flow/store.ts` enforces the flow journal) and by a criterion (§17 C10).
- Body fields with no DDL: `origin` on a flow run body and on a group body; `libraryEntry`, `tokenLimit`, `integration`
  in the `import-plan` payload schema (`importPlanPayloadSchema`, `src/control/webProtocol.ts:712`, gains an
  exactly-one-of `planId`/`libraryEntry` refinement, and the two fields only with `libraryEntry`).

---

## 13. Surfaces

### 13.1 CLI v2 registry rows (new `schedule` domain; `plan` and `group` gain actions)

Project resolution is `c.project()` from the working directory, as the `check` domain (`src/commands/domains/check.ts`).

| Command | Verb / read | Tier |
|---|---|---|
| `orca schedule list [--all]` | read `schedules?repoId=` (`--all`: every project) | open |
| `orca schedule show <id>` | read `schedules/<id>`: body, next 3 slots, last fires | open |
| `orca schedule fires <id> [--limit n]` | read `schedules/<id>/fires` | open |
| `orca schedule add flow <template> --cron <c> [--param k=v]… [--clarify skip] [--unattended] [--pool n] [--name s] [--disabled]` | `schedule-set` | token |
| `orca schedule add group <entry> --version <sha256> --cron <c> [--token-limit n] [--name s] [--disabled]` (`--version` required; the CLI prints that version's `by`, `via`, `origin`, time and the resulting confirm mode before sending) | `schedule-set` | token |
| `orca schedule edit <id> [--cron c] [--param k=v]… [--name s] [--repin <sha256>] [--pool n] [--token-limit n \| --unlimited]` (`--repin` takes an explicit sha256 and prints its provenance as `add group` does) | `schedule-set` | token |
| `orca schedule enable <id>` / `orca schedule disable <id>` | `schedule-enable` | token / open |
| `orca schedule remove <id>` | `schedule-remove` | open |
| `orca schedule resume <id>` | `schedule-resume` | open |
| `orca group schedule <group> --cron <c> [--token-limit n] [--name s] [--disabled]` | `schedule-from-group` | token |
| `orca group import --library <entry> [--version <sha256>]` | `import-plan` + `libraryEntry` | — (as `group import`) |
| `orca plan list [--archived]` | read `plan-library?repoId=` | open |
| `orca plan show <entry> [--version <sha256>]` | read | open |
| `orca plan save (--group <id> \| --requirement <group> --draft <n>) [--name s] [--entry <id>]` | `plan-library-save` | open; with `--entry`: token |
| `orca plan import <path> [--name s] [--entry <id>]` | `plan-library-import` (the CLI reads `<path>` and, for a scheduler plan file, each contract path — inside the plan's repository only, no symlink followed (§5.3) — in its own process; it sends the document and `{fileName, fileSha256, format}`, never a path) | token |
| `orca plan export <entry> [--version <sha256>] --out <path>` | read + a local write (§16) | open |
| `orca plan archive <entry>` | `plan-library-archive` | open |

`plan preview` (`src/commands/domains/dev.ts:127`) is unchanged. The orca-control skill's command list is regenerated
from the registry (`scripts/gen-cli-docs.ts`) and its test (`tests/entry/skill.test.ts`) covers the new rows;
`tests/commands/verbCoverage.test.ts` forces a row for every new verb.

### 13.2 MCP

No new tool: MCP is the one `orca` tool running the registry (`src/entry/mcp.ts:12-19`). `schedule` and `plan` are **not**
added to `MCP_REFUSED_DOMAINS`; the panel refuses by tier. `orca plan import` over MCP reads a file the MCP process can
read, which is why it is `token` (an agent cannot import without the person's token). `orca plan export --out` over MCP
writes where the agent says, inside what the MCP process may write; it carries no secret beyond what `plan show`
already returns.

### 13.3 Web

| Where | What |
|---|---|
| **Project settings → Schedules** (new section in `web/src/ProjectSettings.tsx`, beside Checks) | list: name, kind, cron with "next 3 slots" (code, `nextSlots`), enabled toggle, last fire (outcome, late, link to run/group), failure streak or **Paused** + Resume, "newer plan version available" + Repin, Edit, Remove. "Add flow schedule" form (template, params rendered by the start dialog's params form, cron, clarify/unattended/pool — pool shown to owners only); "Add group schedule" (library entry + an explicit version, showing that version's by/via/origin/time; cron; token limit or unlimited; delivery as pinned, with the line saying whether fires run on their own or wait for a click, `schedules.groupConfirmMode.*`). Members: read-only. No pump: the `schedules.noPump` note |
| **Schedule detail** (new `web/src/ScheduleDetail.tsx`) | the fire list: slot, fired at, late by, missed count, outcome, reason, run/group link, `by orca-auto via schedule:<id>`, "credited to <person>" |
| **Group page** (`web/src/ControlGroupView.tsx`, `web/src/GroupActionsMenu.tsx`) | "Save plan to library" and **"Schedule this group…"** (name + cron + next 3 slots + optional token limit, and the confirm-mode line from the source group's scheme; one `schedule-from-group`). A group a schedule started shows "Started by schedule <name> for <slot>" and, when its fire is `waiting`, "Waiting for you since <slot> (<reason>)" above R2's confirm checklist; it is in the needs-you list |
| **Requirements** (`web/src/RequirementsPanel.tsx`) | on a draft awaiting review or accepted: "Save split to library" |
| **Plan library** (new `web/src/PlanLibraryView.tsx`, reached from the project view) | entries of the project: name, origin (group / requirement / imported file name), versions with short sha256, used by n schedules; Download (a version's `orca-plan-v1` bytes), Import file (owner; upload), Import into a group now, Schedule…, Archive |
| **Import form** (`web/src/ControlPanel.tsx`) | lists the repository's library entries beside registered plans; when neither exists, the new `control.import.noPlanAnywhere` copy (§14) replaces "No trusted repository and plan are configured" for a panel that has repositories (the old copy stays for a panel with none) |
| **Flow run page / board card** (`web/src/FlowRunPage.tsx`, `web/src/FlowBoard.tsx`) | badge "scheduled · <name>"; a clamped effect's provenance reads "held for you: started by a schedule" |

API (control routes; exact paths the builder's): `GET /api/control/schedules?repoId=`, `GET /api/control/schedules/:id`,
`GET /api/control/schedules/:id/fires`, `GET /api/control/plan-library?repoId=`, `GET /api/control/plan-library/:id`,
`GET /api/control/plan-library/:id/versions/:sha256` (download, `Content-Disposition: attachment`),
`POST /api/control/plan-library/import` (owner; the upload body; the same verb as the CLI's).

---

## 14. Copy (en / zh)

The builder adds these keys to `web/src/locales/en.ts` and `zh.ts` (the locale parity test fails on a missing one).
Wording is the writer's draft; the human reviews it as a diff (as G's ~60 copy lines were, `progress.md:5`).

| Key | en | zh |
|---|---|---|
| `schedules.title` | Schedules | 定时任务 |
| `schedules.addFlow` | Add flow schedule | 新建定时流程 |
| `schedules.addGroup` | Add group schedule | 新建定时任务组 |
| `schedules.cron` | Cron (minute hour day month weekday), at most hourly | Cron（分 时 日 月 周），最多每小时一次 |
| `schedules.nextSlots` | Next: {{slots}} ({{zone}}) | 接下来：{{slots}}（{{zone}}） |
| `schedules.lastFire.started` | Started {{target}} for {{slot}} | 已为 {{slot}} 启动 {{target}} |
| `schedules.lastFire.late` | late by {{duration}}; {{missed}} earlier slot(s) skipped while the panel was down | 晚了 {{duration}}；面板停机期间跳过了更早的 {{missed}} 次 |
| `schedules.lastFire.skipped` | Skipped {{slot}}: the previous run ({{id}}) was still active | 跳过 {{slot}}：上一次的运行（{{id}}）仍在进行 |
| `schedules.lastFire.failed` | Could not start for {{slot}}: {{reason}} | {{slot}} 未能启动：{{reason}} |
| `schedules.paused` | Paused after 3 failed starts in a row: {{reason}} | 连续 3 次启动失败，已暂停：{{reason}} |
| `schedules.resume` | Resume | 恢复 |
| `schedules.newerVersion` | A newer version of this plan exists; this schedule still runs the pinned one. | 这个计划有更新的版本；本定时任务仍运行固定的版本。 |
| `schedules.repin` | Use the newest version | 改用最新版本 |
| `schedules.noPump` | This panel has no execution port, so schedules do not fire. | 这个面板没有执行端口，定时任务不会触发。 |
| `schedules.heldNote` | A run started by a schedule waits for you before any external or irreversible step. | 定时启动的运行，在任何外部或不可逆的步骤前都会等你确认。 |
| `schedules.creditedTo` | by orca-auto via schedule {{id}}, scheduled by {{person}} | 由 orca-auto 经定时任务 {{id}} 执行，设置人 {{person}} |
| `group.scheduleThis` | Schedule this group… | 定时运行这个任务组… |
| `group.savePlan` | Save plan to library | 把计划存入计划库 |
| `group.startedBySchedule` | Started by schedule {{name}} for {{slot}} | 由定时任务 {{name}} 为 {{slot}} 启动 |
| `group.waitingSince` | Waiting for you since {{slot}} ({{reason}}) | 自 {{slot}} 起等待你确认（{{reason}}） |
| `schedules.groupConfirmMode.auto` | Each fired group confirms on its own (unlimited tokens, no delivery scheme). | 每次触发的任务组会自动确认（不限 token、无交付方式）。 |
| `schedules.groupConfirmMode.limited` | Each fired group waits for your click: it has a token limit. | 每次触发的任务组会等你点击确认：它设了 token 上限。 |
| `schedules.groupConfirmMode.delivery` | Each fired group waits for your click: it delivers by {{delivery}}. | 每次触发的任务组会等你点击确认：它的交付方式是 {{delivery}}。 |
| `schedules.versionProvenance` | Version {{sha}} — saved by {{by}} via {{via}} at {{at}} from {{origin}} | 版本 {{sha}} —— 由 {{by}} 通过 {{via}} 于 {{at}} 从 {{origin}} 保存 |
| `schedules.lastFire.waiting` | Started {{target}} for {{slot}}; it waits for you ({{reason}}) | 已为 {{slot}} 启动 {{target}}；等待你确认（{{reason}}） |
| `errors.flow-template-version-missing` | This version of the template is not installed. | 这个模板版本未安装。 |
| `errors.plan-library-contract-path-refused` | A contract file is outside the plan's repository or reached through a link. | 某个契约文件在计划所属仓库之外，或经由链接访问。 |
| `requirements.saveSplit` | Save split to library | 把拆分结果存入计划库 |
| `planLibrary.title` | Plan library | 计划库 |
| `planLibrary.empty` | No plans yet. Save one from a group or a requirement split, or import a plan file. | 还没有计划。可以从任务组或需求拆分保存，或导入一个计划文件。 |
| `planLibrary.import` | Import a plan file | 导入计划文件 |
| `planLibrary.importNote` | Importing trusts this file's tasks and their check commands for this project. | 导入即表示你信任这个文件中的任务及其检查命令，仅用于本项目。 |
| `planLibrary.download` | Download | 下载 |
| `planLibrary.importNow` | Import into a new group | 导入为新任务组 |
| `planLibrary.inUse` | Used by {{n}} schedule(s); archive is refused while any schedule uses it. | 被 {{n}} 个定时任务使用；有定时任务使用时不能归档。 |
| `control.import.noPlanAnywhere` | No plan to import yet: save one to the plan library from a group or a requirement split, import a plan file, or register a tracked plan file below. | 还没有可导入的计划：可以从任务组或需求拆分存入计划库、导入计划文件，或在下方登记仓库中已跟踪的计划文件。 |
| `errors.schedule-limit` | A project has at most 8 schedules. | 每个项目最多 8 个定时任务。 |
| `errors.plan-library-hash-mismatch` | The plan's stored bytes no longer match the pinned version. | 计划的存储内容与固定版本不一致。 |
| `errors.plan-library-entry-in-use` | A schedule still uses this plan. | 仍有定时任务在使用这个计划。 |
| `errors.plan-library-target-mismatch` | The plan file names another repository than this project. | 计划文件指向的仓库不是本项目。 |
| `errors.plan-library-project-mismatch` | This plan belongs to another project. | 这个计划属于另一个项目。 |
| `errors.schedule-param-absolute` | A scheduled flow takes folder-relative paths only. | 定时流程只接受相对于文件夹的路径。 |

Every new refusal code is registered in `src/control/errors.ts` with its status, and each has en/zh copy (G's rule:
no code without copy).

---

## 15. Audit trail (Rule 13)

- **Who set it up:** the schedule body's `createdBy/Via/At`, `updatedBy/Via/At`, `enabledBy/Via/At`; the command ledger
  row of each write (verb, principal, payload hash) as for every verb.
- **Each fire:** one `schedule_fires` row per (schedule, slot): `at`, `lateMs`, `missed`, outcome, reason, the run or
  group id, `by: orca-auto`, `via: schedule:<id>`, `creditedTo`; for a group, the copy of R2's booked confirm result
  (its command id and code) or the `waiting` reason.
- **On what it started:** `origin {kind: "schedule", scheduleId, slot}` on the flow run body and the group body; the
  group's import is a booked `import-plan` command of `orca-auto` with id `orca-auto-schedule-<id>-<slot>`; its
  confirm, if automatic, is R2's booked `orca-auto-confirm-unlimited-v<N>`; if by hand, the person's `confirm` row.
- **Library:** each version's `origin`, `by`, `via`, `at`, sha256.
- Nothing is deleted: removed schedules and archived entries keep their rows.

---

## 16. Out-of-repo writes (Rule 17 registration)

| Path (env redirect) | Writer / trigger | Modes | Failure residue |
|---|---|---|---|
| control DB (`$ORCA_CONTROL_DIR`, default `~/.orca/control/`) — the four new tables | the control service, on the verbs of §11 and on fires | as today (already registered) | a failed command writes nothing (one transaction); a crash between T1 and T2 leaves one `starting` fire row, completed at the next pass (§7.5) |
| `--out <path>` of `orca plan export` | the CLI process, on the person's command | a new file `0600`, written to a temp file in the same directory and renamed; an existing path is refused (`control-cli-argument-invalid: --out exists`); an existing parent directory's mode is never changed, a missing parent is refused | none: the temp file is removed on failure |
| Web download | the person's browser | the browser's | none |

No other path. Criteria set `HOME` and every `ORCA_*` redirect to separate temp dirs and assert nothing appears under
`HOME` (C12), as F C21 does.

---

## 17. Success criteria (Rule 4: commands with exit codes; Rule 9: each named mutation seen red; Rule 18: `npm test`)

Day-to-day gate: `npm test` (+ typecheck). Each mutation is made in a `git clone --local` copy and seen red before the
criterion counts (Rule 15); the plan records the clone's restore by `git diff` / `git diff --cached` byte counts.
Clocks are fake; no paid agent runs (fake agents of `tests/control/fixtures/ccloopWorld.ts` and the flow fixtures).

**C0 — selection and green, one command:**
`npm test > "$LOG" 2>&1; rc=$?; node scripts/assert-selected.mjs "$LOG" tests/control/scheduleModel.test.ts tests/control/schedulePass.test.ts tests/control/scheduleCrash.test.ts tests/flow/scheduledFlowFire.test.ts tests/flow/templateVersion.test.ts tests/control/scheduledGroupFire.test.ts tests/control/scheduleWithAutoConfirm.test.ts tests/control/planLibrary.test.ts tests/control/scheduleAccess.test.ts tests/control/scheduleMigration.test.ts tests/commands/scheduleCli.test.ts web/src/schedules.test.tsx || exit 1; exit $rc`
(`$LOG` under the session's scratch dir; the log is read back whole, Rule 14; 0 selected is reported, not green).
Mutation: remove one file from the selection map.

**Seeability rule (I-5).** Every mutation below is named so that the criterion it belongs to measures the mutated
thing directly (Rule 9: "要量什么就直接量什么"); where a code path guards a race the test reaches the guard directly
(a second insert, a pre-set row), never by hoping a race happens.

| # | Criterion (file) | Mutations that must turn it red |
|---|---|---|
| C1 | **Model** (`scheduleModel.test.ts`): a cron firing twice an hour is refused `check-schedule-too-frequent`; an unreadable zone `check-time-zone-invalid`; a 9th schedule `schedule-limit` (a removed one frees a place); a flow schedule on a non-`dir` or unregistered project `flow-dir-unregistered`; a param not of the template's type `flow-param-invalid:<id>`; an absolute `image` param `schedule-param-absolute`; a template without version is stored with the shipped version; a group schedule without `sha256`, with an unknown entry/version, or with another project's entry is refused; `schedule-from-group` stores the source group's integration scheme (a `local` source ⇒ `integration` = that scheme; a `keep` source ⇒ `null`) and the new version's sha256; ids: a schedule id matches `^sch-`, a fired group `^sgrp-`, an entry `^pl-`, and each passes `idSchema` | drop the `validateSchedule` call; drop the limit; skip param validation at write; store the template without its version; default a missing `sha256` to head; pin the project default in `schedule-from-group`; give fired groups the `sch-` prefix |
| C2 | **Slots** (`schedulePass.test.ts`, pure over a store fixture, fake clock): created at 10:30 with `0 9 * * *` ⇒ no fire until the next 09:00; disabled 3 days then enabled ⇒ no catch-up; panel "down" over 3 daily slots ⇒ **exactly one** fire for the latest slot with `missed = 2` and `lateMs` = now − slot; a cron edit re-initialises `lastSlot`; after create, enable, resume and cron edit `state.tz` equals the zone `lastSlot` was computed in (so the next pass does not take the zone-change branch); **DST**: `30 2 * * *` in `America/New_York` has no fire on the spring-forward day and one fire on the autumn day; **zone change**: the calendar moves from `Asia/Shanghai` to `Europe/London` at a moment where a London slot lies in (lastSlot, now] ⇒ no fire that pass, `state.tz` updated, the next London slot fires | fire every missed slot; initialise `lastSlot` to −∞; skip the re-initialisation on enable; skip the zone-change re-initialisation; leave `state.tz` null at create (the first pass then re-initialises instead of firing a due slot: red); fire twice on the ambiguous autumn time |
| C2u | **Unique slot** (`schedulePass.test.ts`): with a fire row for (schedule, slot) already present, a direct second T1 insert for the same slot is rejected by the store and the pass records nothing new | drop `UNIQUE(schedule_id, slot)` (the direct second insert then succeeds: red) |
| C3 | **Overlap** (`schedulePass.test.ts`): previous flow run `running` or `paused` ⇒ `skipped: previous-active:<id>`, slot consumed (the next pass does not fire it); `done`/`stopped` ⇒ fires; a group of this schedule in `draft`, `ready`, `running`, `review`, `blocked` ⇒ skipped; `done` or archived ⇒ fires; **a fire row left `starting` counts as active** (with step 0 stubbed out to isolate step 4, a due slot is skipped `previous-active`); a hand-started run of the same template does not block; skips leave the failure streak unchanged | keep the slot pending instead of consuming it; treat `paused` as inactive; treat `blocked` as inactive; leave `starting` out of the active set; count any run of the template; count a skip as a failure |
| C4 | **Failure streak** (`schedulePass.test.ts`): three failed starts ⇒ paused with `pausedReason`; no fire while paused; `schedule-resume` re-initialises `lastSlot` (no catch-up) and the next slot fires; a started fire resets the streak; a `waiting` group fire neither counts nor resets | never pause; resume catches up; reset the streak on a skip; count `waiting` as a failure |
| C5 | **Crash** (`scheduleCrash.test.ts`): (a) a throw after T1 ⇒ the next pass completes that fire: one flow run (same `flowRunId`), one group (same `sgrp-` id, one booked `import-plan` row); (b) a throw after the start before T2 ⇒ still one; (c) **a throw after T1, then the clock moves past the next slot before the next pass** ⇒ that pass first completes the old fire (step 0), then records the new slot `skipped: previous-active`, never two runs; (d) R2's confirm booked, then a throw before step 9 records it ⇒ the next pass copies `auto-confirmed` from the `commands` row; (e) a throw after T1, then the person disables the schedule ⇒ step 0 finds no run/booked import and records `failed: schedule-disabled`, no run, streak unchanged; with the start already made before the disable ⇒ `started` (what happened is recorded); a fire row's only changes are the §6.2 moves | a random command id; a group id without the slot; evaluate slots before resuming `starting` rows (case c turns into two runs); record the confirm from in-memory pass state instead of the booked row (case d stays null); skip the "already happened" check in step 0 (case e starts a run after the disable) |
| C6 | **Flow fire and the clamp** (`tests/flow/scheduledFlowFire.test.ts`, fake agents, temp vault): the run's `by` is `orca-auto`, `via` `schedule:<id>`, `origin` set, params and pinned template as stored, `operatorId` = `enabledBy`; with project setting `external: apply-flag` the scheduled run's external step parks at a confirm card (`source: schedule`), an `irreversible` step too, a `stage-only` setting stays `stage-only`, a `cost` step runs apply + flag; a **hand-started** run with the same settings runs the external step apply + flag; **`resolveLevel` with `configuredDelivery: true` and `scheduled: true` gives `confirm`** for `external` and `irreversible` (unit cases in `tests/flow/policyResolution.test.ts`); the confirm card is refused to an `orca-auto` `flow-effect` and to a member, and the owner's succeeds | drop the clamp; apply the clamp before the configured-delivery value (configured delivery then wins: red on the unit case); clamp hand-started runs too; clamp `cost`; read `scheduled` from the template instead of the run's `origin` |
| C6v | **Template version** (`tests/flow/templateVersion.test.ts`): `startFlowRun` with `builtin/wechat-article@<shipped>` starts; with `@<shipped + 1>` it is refused `flow-template-version-missing` and writes nothing (no vault import, no group, no run); a schedule pinned to a version the build no longer ships records a failed fire with that code | drop the kernel's version comparison (the `@<shipped + 1>` start then succeeds: red) |
| C7 | **Group fire** (`scheduledGroupFire.test.ts`, R2's pass **not** run): the fire books one `import-plan` command as `orca-auto` with the fire's command id; the group body has `origin`, `limit.tokens` = the schedule's `tokenLimit`, the pinned integration; its archived plan equals the pinned version's tasks (contract hashes) and `planId = lib-<entry>-<sha[:12]>`; a version whose stored bytes are altered ⇒ failed `plan-library-hash-mismatch`; the estimate of the fired group ends failed ⇒ `outcome: waiting`, `reason: estimate-failed:<code>`, listed in needs-you, streak unchanged; **this spec's code sends no `confirm`** (no `commands` row with verb `confirm` from the schedule's paths) | import the entry's head instead of the pinned sha256; skip the hash recompute; take the project's default integration at fire time; drop `tokenLimit`; call `writeImportedPlan` directly (no booked `import-plan` row: red); send a confirm from §9; mark an estimate failure `failed` |
| C7a | **Both passes together — the anti-goal through H4** (`tests/control/scheduleWithAutoConfirm.test.ts`; the real pump order `schedulesPass → flow pass → autoConfirmUnlimitedPass → autoStart`, fake agents): `tokenLimit: null`, `integration: null` ⇒ R2's pass confirms as `orca-auto`, the fire row copies `auto-confirmed` with R2's command id, `autoStart` starts the group in the same pump; `tokenLimit: 500000` ⇒ never confirmed by either pass, fire `waiting: limited`, the owner's one click confirms it; `integration: local` and `integration: push` ⇒ never confirmed by either pass (no `orca-auto` confirm row at all), fire `waiting: delivery-needs-person:<delivery>`; R2 refuses (a changed selection) ⇒ fire `waiting: auto-confirm-refused:<code>`; with `defaults()` returning null, `tokenLimit: null`, `integration: null` ⇒ no confirm row is ever booked and the fire becomes `waiting: auto-confirm-ineligible:8` (not left open forever); in every case the next slot while the group is not `done` is `skipped` | let §9.1 drop `integration` for `local` (R2 then confirms it: red); give fired groups a default finite limit; copy a confirm R2 did not book; drop the `auto-confirm-ineligible` row (the null-defaults case stays open: red) |
| C8 | **Plan library** (`planLibrary.test.ts`): save from a group then import from the entry into a new group ⇒ the same task ids, dependencies, contract hashes and loop recipes as the source group (round trip); save from a draft awaiting review with its `draftHash` (the draft stays awaiting review); a wrong `draftHash` ⇒ `plan-version-conflict`; an upload with an unknown key, a dangling dependency, a cycle, a contract whose `objective.taskId` differs, or > 2 MiB ⇒ refused and nothing stored; a second save with `entryId` appends version 2, version 1 byte-identical; archive refused while a disabled schedule pins it; `import-plan` with `libraryEntry` and with `planId` both work, with both or neither refused, `tokenLimit` without `libraryEntry` refused | store contracts by reference; rewrite version 1 in place; allow archive while pinned; drop the `draftHash` check; accept the draft while saving |
| C9 | **Access** (`scheduleAccess.test.ts` + rows in `tests/panel/accessMatrix.test.ts`): every §11.1 verb has the `VERB_ACCESS` and `SOCKET_TIER` entries of the table; a Web member is refused each human-only verb; the socket agent without a token is refused `schedule-set`, `schedule-enable {enabled:true}`, `schedule-from-group`, `plan-library-import`, **`plan-library-save` with `entryId`**, and `import-plan` with `tokenLimit` or `integration` (`control-person-token-required`), and allowed the `open` rows (including `plan-library-save` without `entryId`); a run Orca dispatched is refused every row, even with a token | move `schedule-set` to `open`; make `schedule-enable {enabled:true}` open; make the `plan-library-save` predicate ignore `entryId`; classify `plan-library-save` as `any` in `VERB_ACCESS` (the dispatched run then saves: red) |
| C10 | **Audit** (`schedulePass.test.ts`, `planLibrary.test.ts`): every fire row has `by = orca-auto`, `via = schedule:<id>`, `creditedTo = enabledBy`; every schedule write stores the person's `by`/`via`; the single writer refuses any update of a fire row other than `starting → started|failed`, `started → waiting`, and `confirm` null → value, and any update of a version row; the schedule form/CLI show the pinned version's `by`/`via`/`origin` | set `by = creditedTo`; allow a second outcome move; allow `waiting → started` |
| C11 | **Migration** (`scheduleMigration.test.ts`): a store at **this step's predecessor version** (`"19"` once R2's step is merged, read from `schemaVersion − 1` in the test, never hard-coded 18) with groups, flow runs and settings migrates: the four tables exist and are empty, every pre-existing table's rows are byte-identical, the backup file exists; a fresh store has the tables | drop a table from the step; rewrite an existing table |
| C12 | **CLI, MCP, Rule 17** (`scheduleCli.test.ts`): every §13.1 row parses and maps to its verb or read; `schedule add group` without `--version` is refused locally; `plan import` of a scheduler plan file sends an inline `orca-plan-v1` document and never a path (asserted on the request body), refuses a `targetRepo` ≠ the project's path, refuses a contract path outside the repository and one reached through a symlink (`plan-library-contract-path-refused`); `plan export --out` creates a `0600` file, refuses an existing path and leaves no temp file on a forced failure; the MCP tool runs `schedule list`; run with `HOME` and every `ORCA_*` redirect in separate temp dirs, nothing appears under `HOME` | send the path instead of the document; follow symlinks when reading contracts; drop the inside-repository check; write `--out` with the default mode; overwrite an existing file; default a path from `os.homedir()` |
| C13 | **Web** (`web/src/schedules.test.tsx`, jsdom): Project settings lists schedules with next 3 slots, last fire with late/missed/waiting, Paused + Resume, "newer version" + Repin with the version's provenance; the add-group form shows the confirm-mode line for the chosen token limit and delivery; a member sees no write control; "Schedule this group…" sends one `schedule-from-group`; "Save split to library" sends `plan-library-save` with the draft hash; the import form lists library entries and shows `noPlanAnywhere` when there is nothing; a waiting scheduled group shows "Waiting for you since … (<reason>)" above R2's checklist **and appears in the overview's needs-you list as a `budget-review` step with reason `scheduled-waiting:<reason>`** (server side in `tests/panel/controlOverview.test.ts`, rendered in the overview); every new key exists in en and zh | send `schedule-set` from the group page; hide the paused state; show `auto` for a group with a delivery scheme; drop the `scheduled-waiting` reason from the overview step; drop a zh key |

---

## 18. Build order (each package ends green on `npm test`, Rule 18)

0. **Prerequisite: R2 merged** (its schema step 18 → 19 and `autoConfirmUnlimitedPass`). This spec's schema step follows
   it (§12); C7a needs R2's pass.
1. **P1 — library:** schema step (all four tables, so one migration), `orca-plan-v1` codec and validation, library
   store and its single writer, `plan-library-save|import|archive`, `import-plan` + `libraryEntry` (+ the two
   human-only fields), access rows, `plan` CLI rows incl. `export --out`, Web plan library view and import-form
   listing. Criteria C8, C9 (library rows), C11, C12 (plan rows).
2. **P2 — schedules and flow fires:** schedule model and verbs, `schedulesPass` (resume-first, slots, DST/zone,
   overlap incl. `starting`, streak, crash), flow fires with `origin`, the kernel's template-version check, the effect
   clamp after configured delivery, `schedule` CLI rows. C1–C6v, C9, C10, C12.
3. **P3 — group fires:** booked `import-plan` from the pinned version with `tokenLimit` and the pinned integration,
   step 9's record of R2's result and of `waiting`, `schedule-from-group`, `group schedule`. C7, C7a.
4. **P4 — Web schedules and copy:** Project settings section, schedule detail, group page actions, requirement "Save
   split", run page/card badges, en/zh copy, skill regeneration. C13.

Each package is reviewed independently before merge (`progress.md:25` applies to specs; the plan sets the review per
package as this repo's plans do).

---

## 19. Left to the builder (decide, record in the plan's ledger)

- Exact verb, route, scope and refusal-code spellings within §11 and §13; module paths (suggested:
  `src/control/schedules/{model,pass,fires}.ts`, `src/control/planLibrary/{codec,store}.ts`).
- How step 9 (§7.2) reads "the estimate ended failed or refused" from the estimate rows R2 leaves (R2 §4: an estimate
  breach no longer changes the group's status), and the exact `estimate-failed:<code>` codes.
- How the start dialog's params form is shared with the flow schedule form.
- The schedule id slug rule when the person gives only a name; the 16-hex derivation of `pl-` ids.

---

## 20. Decisions the human should see (all reversible; writer's calls unless marked)

1. **Library in the control DB, not as files** under `$ORCA_CONTROL_DIR` (§5.1) — a refinement of the controller's
   design: no hand-edit trap, covered by the pre-migration backup, no new panel-side out-of-repo writer; export by
   download / `orca plan export --out`.
2. **A missed slot fires once, late**, never more (§7.3); no per-schedule "skip missed" switch in v1.
3. **Flow fires start without a person confirm** (§8 step 3): a flow start has no confirm today and the pool bounds
   it. The "limited ⇒ one-click confirm" rule applies to **groups** (via R2 §7.5).
4. **(Controller C-1, C-2)** One automatic confirmer, R2's pass; a fired group runs on its own only when the schedule
   has no token limit **and** delivery is `keep`; any delivery scheme (`local` included) or a token limit ⇒ the person's
   click. The owner sets `tokenLimit` on the schedule (token tier).
5. **Scheduled runs clamp `external` effects to `confirm`** (not `stage-only`), irreversible stays `confirm`, and the
   clamp wins over configured delivery (I-6); `cost` is not clamped (§10).
6. **Schedules are per project only; library entries are project-bound** (§6.4, §5.6); reusing a plan in another
   project = import it there.
7. **Library writes are owner-only** (members read and import into a group only); a new entry by saving is
   socket-`open`, appending a version or importing a file is `token` (§11). Disabling/removing/resuming a schedule is
   socket-`open`, as for scheduled checks.
8. **No "fire now"** in v1; a person starts the same flow or imports the same entry by hand.
9. **Templates are pinned to a version** (and the kernel now refuses a version it does not ship, for every start —
   **effect on hand starts (M-4):** a person's `orca flow start builtin/<id>@<n>` or a Web start that names a version
   the build does not ship, which today silently runs the shipped one, is now refused `flow-template-version-missing`;
   a start without `@<n>` is unchanged);
   group schedules pin an explicit sha256 and the delivery scheme; nothing follows updates silently.
10. **A zone change re-initialises slots without firing**; a DST gap skips that day's slot.
11. **Remove is a mark** (the fire history stays); archive has no undo in v1.

---

## 21. Revision after the independent review (session `ffec7b28`, 2026-10-24; spec not yet committed)

| Finding | Change |
|---|---|
| C-1 (one confirmer; H4 per group) | §9.2 rewritten: no confirm of this spec's own; R2's `autoConfirmUnlimitedPass` decides; step 9 copies its booked result into the fire. `confirmBasis` and `tokenModeOf` removed; `tokenLimit` (owner-set, `token`) applied at import. New C7a runs both passes in pump order |
| C-2 (only `keep` auto-confirms) | §6.1 `integration` pin; §9.2: any scheme ⇒ `waiting: delivery-needs-person` |
| C-3 (`starting` rows) | §7.2 step 0 resumes every `starting` row first; §7.4 counts `starting` as active; C5 case (c), C3 case |
| I-1 (template version) | §8 step 2 kernel check `flow-template-version-missing` for every start; C6v |
| I-2 (confirm from the ledger) | §9.2 table derives from the booked `commands` row; §7.5 last bullet; C5 case (d) |
| I-3 (append is `token`; explicit sha256) | §5.4, §5.6, §11.1 `plan-library-save` predicate; `--version` required; provenance shown; C9, C12, C13 |
| I-4 (schema after R2) | §12: 19 → 20 after R2; C11 starts from the predecessor version; §18 step 0 |
| I-5 (seeable mutations) | C2u direct second insert; C9's dispatched mutation = `VERB_ACCESS` `any`; C6's `by` mutation moved to C10 (attribution), C6 measures the clamp and its order; C3 `starting` case; C7a for the anti-goal through H4 |
| I-6 (clamp vs configured delivery) | §10 item 2: `scheduled` applied last; C6 unit case |
| Minors | DST and zone change (§6.3, §7.2, C2); id prefixes `sch-`/`sgrp-`/`pl-` (§4, C1); group import through the command ledger (§9.1, C7); `schedule-from-group` pins the source scheme (§6.1, C1); estimate failure ⇒ `waiting` (§6.2, §9.2, C7); plan import refuses contract paths outside the repository and symlinks (§5.3, C12) |
| Round 2 N-1 | §9.2 row `auto-confirm-ineligible:<8\|10>` from R2's exported `autoConfirmBlocker`; R2 must export it; C7a null-defaults case, mutation "drop the row" |
| Round 2 M-1 | §7.2 step 0 checks whether the start already happened (`fr-<uuidOf(commandId)>` or the booked `import-plan` row); not started and the schedule removed/disabled/paused ⇒ `failed: schedule-disabled`; C5 case (e) |
| Round 2 M-2 | `state.tz` written with `lastSlot` at create/enable/resume/cron edit; C2 assertion and mutation |
| Round 2 M-3 | the waiting group joins the control overview's `budget-review` needs-you step with reason `scheduled-waiting:<reason>` (`src/panel/controlOverview.ts:94`), not the flow board's rule; C13 |
| Round 2 M-4 | §20 item 9 states the kernel version check's effect on hand starts |
