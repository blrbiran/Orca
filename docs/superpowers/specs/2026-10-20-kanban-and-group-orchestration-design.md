# Kanban board and automatic group orchestration — design

- **Author:** controller of Orca session `308b874c` (2026-10-20), from a brainstorming conversation with the human.
- **Status:** design, approved section by section in conversation; not yet planned. Ledger with every quoted ruling:
  `.superpowers/sdd/2026-10-20-session-308b874c/progress.md` ("Rulings, late round" and "Kanban answers").
- **Related:** `docs/handoff/goal.md` §1.3 (few, important decisions; human can always ratify) and §1.4 (confirmed groups
  start on their own; one blocked group never stalls the rest) — §1.4 was written from this conversation.
- **Research inputs (ideas only, no code copied):** multica (`/Users/biran/code/skills/loop/multica`, Multica License —
  source-available, UI code may not be reused) and hermes-agent (MIT). Summaries are in the ledger.

## 1. Intent

The human, in their words:

> 确认之后要不要自动开跑？ => 要，这就是我做 orca 的意义。提高效率不要被等人的相关操作block住。

> 其实我更希望orca能自动编排各个group 之间的顺序和串联、并联关系。通过kanban拖拽来启动 group 的逻辑应该弱化。

> 现在默认不限额。needs-human 这类状态如果挡住就尽量跑后续的group，不要被挡死。

> 要知道工程师平时工作是也是会遇到冲突的，遇到冲突解决冲突就好。这里无非是group 并行的多了之后冲突的概率会变大而已。我们需要可以控制并行 group 的数量。（控制并行数一方面是缓解cpu压力，一方面是控制遇到冲突的概率）

> 我们的最终目的是把事情做完，而不是每个task / group 都告诉人做不了。

So Orca should take a confirmed group to done on its own: order groups itself, run them in parallel up to a cap,
resolve conflicts when they land, escalate failures automatically, and surface to the person only what needs a person —
flagged after the fact, never as a gate on unrelated work. The kanban board is how the person **watches** this.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Confirming a group authorizes it to start; it starts as soon as its explicit prerequisites are done and a slot is free.
2. Groups run in parallel by default, bounded by a configurable cap on concurrently running groups.
3. Ordering comes from explicit dependencies only; conflicts are resolved at landing time.
4. A group that is blocked (needs a person, or failed past the escalation ladder) holds back only the groups that
   explicitly depend on it.
5. A task whose run ends `exhausted`/`failed` is escalated automatically (§6) before anyone is asked.
6. Problems that only appear once several groups are combined are caught by an integration check and, when warranted,
   a model review (§7).
7. A board view in its own tab shows groups by state, with what each card is waiting on.

**Non-goals (this design)**
- Predicting write sets before running to decide order (the human: "agent 在运行之前可能也无法知道具体group里各个task的agent分别会改哪些文件").
- Budget gating: default is unlimited (human). Existing caps keep working where a person set them; nothing new is added.
- Replacing the existing task list (decide later from usage: "我们观察一下 kanban 和当前 task 的使用情况，再决定是否要互斥或phase out其中之一").
- Task-level drag-and-drop, custom columns, manual card ordering.

**Anti-goals (would be failures even if they work)**
- An LLM deciding routing, order or eligibility (CLAUDE.md Rule 5). Every scheduling decision is code.
- A drag that has an implicit side effect beyond exactly one existing command (multica's "entering a column reassigns
  and starts a run" is explicitly not copied).
- A needs-human state anywhere that stops unrelated groups.
- Marking a task done by a person's say-so (completion only from verification evidence).

## 3. Orchestration

### 3.1 Start on confirm
- `confirm` is the authorization to start. After confirm, the driver starts the group when (a) all its explicit
  prerequisite groups are done (landed), and (b) the running-group cap has a free slot. No separate "start" click.
- The confirm action tells the person before confirming that the group will start on its own, and offers two choices:
  **"Confirm and run"** (the default) and **"Confirm only, don't run yet"** (confirmed but held, like a paused group;
  the person starts it later). Human: "点击确认之前提示一下用户，并且给一个只同意，先不跑的选项给用户。默认是直接开始跑。"
- Pause/resume and stop keep their current meaning; a paused, held or stopped group is not started automatically.
- Builder: find today's start path (`start` command, start guard `groupExecutionPendingInStore`, wake pump) and add the
  automatic start as a code rule in the same place, not a second scheduler.

### 3.2 Running-group cap
- One global setting "max concurrently running groups", editable in the panel; the human asked for it for CPU load and
  conflict probability. **Default: 3** (controller's call; capacity measurement is still open, handoff §六.8).
- Debug groups (corrections) are counted separately or admitted first so a fix is not starved by normal groups
  (controller's call; builder picks the simpler of the two and records it).
- Waiting for a slot is a visible card state ("waiting for a slot"), not an error.

### 3.3 Dependencies
Edges between groups come from, in order:
1. dependencies written in the plan / requirement split;
2. edges a person adds or removes in the group graph view (take effect immediately, recorded as decisions in the ledger);
3. edges an agent proposes — they take effect, are recorded as major decisions and **flagged red** for the person to
   ratify or remove (same "land, then flag" rule the human gave for weakened tests).

Automatically derived edges are recorded in the ledger but not shown as attention items ("静默" in the spirit of the
human's version-refresh ruling). Overlapping declared write sets are shown on cards as "may conflict"; they do **not**
create edges.

A new control command is needed to add/remove a group edge (none exists today); it goes through the same command path
(commandId, revision) as the other group commands. Cycles are refused by code.

### 3.4 Blocked groups do not stall others
- A group in needs-human / blocked holds back only groups with an explicit edge to it (transitively). Their cards show
  "waiting for <group>".
- Everything else keeps running; the cap slot of a blocked group is released while it waits for a person.

### 3.5 Conflicts at landing
- Today a landing conflict goes to reconciliation (`src/control/driverLanding.ts` → `scheduler/reconcile.js`, spec §5.3;
  between groups `src/control/integrationResolve.ts`), followed by the required checks. This stays the mechanism.
- New: the reconciling agent reports what each side changed and how it merged them as a **major decision, flagged**, so
  the person learns of a resolved conflict when it happens.
- A clean merge that is semantically wrong is caught by §7, by later QA/issues (→ correction ⇒ debug task), or not at
  all — accepted risk, stated.

## 4. Board (separate tab)

- **Placement:** a new tab; the existing task list stays.
- **Level:** groups. Task state is decided by the scheduler; the person's actions are group-level.
- **Columns** (all computed by code from the group summary; reuse `web/src/groupCategory.ts`):
  clarifying · awaiting confirmation · queued (confirmed, waiting for prerequisites or a slot) · running · needs you ·
  done · archived (hidden by default).
- **Drag** is weak by design: only pause ⇄ resume and done → archived (⇄ unarchive). Each drag is exactly one existing
  command; a refusal snaps the card back and shows the refusal text. clarifying, needs-you and done refuse drops.
  Confirm, stop, retry and requirement acceptance stay buttons/menus.
- **Card:** goal, repo, progress, stop state, debug badge and its correction, "waiting for <group>" / "waiting for a
  slot" / "may conflict", the needs-you reason (reuse `readControlOverview` step kinds), and three new summary fields:
  budget used / limit, pending-decision count, first failure cause.
- **Group graph view:** reuse `DependencyGraph.tsx` / `dependencyLayout.ts`; edges editable by the person (§3.3).

## 5. What counts as "needs you"
Unchanged categories (blocked task, recovery blocker, claim blocked, `state=blocked`, unsettled stop) plus: the
escalation ladder exhausted (§6), and flagged decisions awaiting ratification (shown, but not blocking anything).

## 6. Escalation ladder after a failed task

The human: "我们的最终目的是把事情做完". After ccloop's own in-run handling (first required-check failure retries once
with the failure fed back — ccloop spec `2026-10-20-verifier-sees-checks-and-last-failure-design.md`, option (b)):

1. **Re-dispatch with fresh context.** Orca starts a new run for the task carrying all prior failures (ccloop's allowance
   continuation evidence path). If the agents table configures an alternate agent for the role, use it.
2. **Debug task.** Still failing ⇒ Orca opens a debug task asking why it cannot be fixed: wrong/ambiguous check or task
   (as in the 2026-10-20 median case), baseline already red (ccloop annotates failures that also fail on base), or
   environment. If the debug agent concludes the check or contract should change, it changes it as a major decision,
   lands, and flags it.
3. **Needs you.** Only then the task is marked for a person; it holds back explicit dependents only (§3.4).

Cap: at most **2 extra runs per task** (levels 1 and 2) before level 3 — human: "同意". All attempts are booked to the
group's ledger as today.

## 7. Whole review after groups land

Two layers (human-approved, with the controller's defaults):

1. **Integration check (code only).** Runs when ≥2 groups have landed since the last check **and** (the queue is idle
   **or** ≥6 h passed since the last check). Re-runs the landed groups' required checks on merged main, or a per-project
   "integration check command" if set (some suites are slow — the human cited Orca itself). Per-project on/off switch.
   Red ⇒ a debug task (enters §6).
2. **Model review.** Only when a reconciliation ran or two groups changed the same files since the last review; minimum
   interval 24 h (configurable); reviews only the range since the last review; findings become corrections/debug tasks.
   (Import-graph detection was proposed and dropped by the human: "暂时可以不加这一层，靠集成检查去兜底就好".)

A single landed group triggers neither (its own required checks already ran).

## 8. Constraints
- Rule 5: scheduling, eligibility, cycle checks, triggers — code. The model is used only inside runs (reconcile, debug,
  review).
- Rule 13: every automatic decision (edge, start, escalation) is attributable in the ledger.
- Rule 17: no new out-of-repo writes beyond the control store (settings live where the existing panel settings live).
- ccloop is changed only through its own spec (Rule 16); this design needs no ccloop change beyond the referenced spec.

## 9. Left to the builder (decide and record)
- Where the cap and per-project settings are stored and edited.
- Exact column predicates on `GroupSummaryV1`, and the three new summary fields' sources.
- The edge command's schema and how plan-declared dependencies are imported.
- How "alternate agent for a role" is expressed in the agents table / profile (or defer level 1's alternate to later).
- Test plan: each scheduling rule red-first with a named mutation; one end-to-end with ≥3 groups, a conflict and a
  blocked group showing others keep running.

## 9a. Decisions after the builder check (human: "同意按你的建议走", session 308b874c, 2026-10-21)

Human's:
1. **When a prerequisite counts as done, and where dependents branch from.** If the project's delivery is `local`
   (merged into the target branch), a prerequisite is done once integrated into the target; dependents branch from the
   target and the integration check (§7) runs there. If delivery is `keep` or needs a person to merge, dependents branch
   **from the prerequisite's `orca/<g>` branch** (stacked) and the integration check runs on the top of the stack. No
   dependency ever waits for a person to merge. (Today: default delivery is `keep`, `src/control/integrationScheme.ts`
   `readIntegrationDefault`; new groups branch from the target `HEAD`, `src/control/workspace.ts` `ensureWorkBranch`.)
2. **Inter-group integration conflicts are resolved automatically** by an agent the driver dispatches, reported as a
   flagged major decision. This overrides integration spec 2026-10-08 §7 ("Nothing is dispatched", human-only
   `resolve-integration-conflict` in `src/panel/humanOnly.ts`) — a Correction section is appended there. Integration
   blocks that are not code conflicts (dirty target, non-fast-forward, target moved) are needs-you for that group only.
3. **System-generated debug runs start automatically** (estimate, confirm, start without a click) — the ladder's level 2,
   a red integration check, model-review findings. This overrides the 2026-10-18 correction-debug-task spec's anti-goals
   for those sources only; a person's correction keeps today's flow. A Correction section is appended there.
4. **Ladder level 2 is a task inside the original group**, which the failed task then depends on; after it lands the
   original task reruns once automatically against the (possibly changed) check/contract. That rerun is part of level 2,
   not an extra run. Dependents of the group keep waiting meanwhile.
5. **v1 group edges come from the person only** (group graph view). Cross-group dependencies in plan files / requirement
   split and agent-proposed edges are v2 — today `dependsOn` is within one group (`src/scheduler/planFile.ts`,
   `splitTaskSchema`), one requirement yields one group, and no agent sees several groups. §3.3 sources 1 and 3 are
   therefore deferred; default-parallel plus landing-time resolution runs without edges.

Controller's calls (reversible, recorded here):
- **Flagged decisions** are a new state on landed decisions (`src/ledger/types.ts` has only major/minor today; pending
  in `pendingDecisions.ts` means "rejected, not written" and is not reused). Ratify clears the flag; disagreeing goes
  through a correction (no automatic revert). Same for edges, reconcile reports and changed checks.
- **Automatic start** is a start command the driver synthesizes through the existing command path (`scheduleStart`,
  `src/control/webDispatch.ts`), actor `orca-auto` (Rule 13). A refusal (`recovery-blocked`, `estimate-in-flight`, …)
  backs off and shows the reason on the card; a refusal that persists becomes needs-you for that group.
- **Ladder level 1** (re-dispatch with all prior failures) waits for the ccloop spec to land; until then the ladder starts
  at level 2.
- **Columns:** `web/src/groupCategory.ts` has 5 categories today; the board's 7 columns extend it (correcting §4's "reuse").
- **Group graph view** does not exist; `DependencyGraph.tsx`/`dependencyLayout.ts` draw one group's task graph — the
  layout is reused for a new group-level view (correcting §3.3/§4).

## 10. Open questions (none blocking the plan)
- Default cap 3 and the 6 h / 24 h intervals are controller defaults; revisit after measuring.
- Whether to phase out the list view — decided later from usage (human).
