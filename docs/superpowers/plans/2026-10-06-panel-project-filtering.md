# Panel project filtering and all-projects view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Owner: Orca session `32306496` (Claude), 2026-10-06. Written on default `main` above subject
`docs(spec): bind recovery, drafts and decision results to their owners`. The human approved the written spec
(including §11 R1–R3) on 2026-10-06 and asked for subagent-driven execution on the current `main` branch.

**Goal:** Task control, Requirements and Decisions show only the chosen project's rows, or every project's rows
(labelled) in a new All projects view, without changing polling, recovery, command or execution semantics.

**Architecture:** The server adds an authoritative `repoId` to every group summary. The browser keeps polling and
reducing the whole control projection exactly as today and applies a display scope after the reducer. A pure
module (`projectScope.ts`) owns view mode, storage and scope predicates; App owns the view state, per-repository
workspaces, recovery retry targets (R1), detail drafts (R2) and decision request records (R3).

**Tech Stack:** TypeScript, Node 22, express, zod, vitest (+ jsdom, @testing-library/react for `web/`), React 19, i18next.

**Spec:** `docs/superpowers/specs/2026-10-06-panel-project-filtering-design.md` — §11 (R1–R3) overrides §§5, 7, 9
where they differ; §12 (added by Task 10 of this plan) records plan- and implementation-time decisions.

## Global Constraints

- Commit on the current branch `main`; never push, merge, or delete branches/worktrees (Rule 15).
  Every commit body names `Orca session 32306496.` and ends with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `docs/handoff/handoff.md` carries another session's uncommitted edit. **Never stage it** — `git add` only the
  files your task names; never `git add -A`, `git add .`, `git commit -a`, `git stash`, `git checkout -- .`.
- Code, comments, commit messages in English. New UI strings go into BOTH `web/src/locales/en.ts` and
  `web/src/locales/zh.ts` with identical keys and placeholders (`web/tests/i18nKeys.test.ts` enforces parity).
- Rule 17: no criterion touches the real `~/.orca`, ccmem data, a paid model or the human's running panel.
  Web criteria use fake `fetch` only.
- Run single test files with output redirected to a file and read back whole (Rule 14):
  root `./node_modules/.bin/vitest run <file> > $SCRATCH/x.txt 2>&1; echo RC=$?`,
  web `cd web && ../node_modules/.bin/vitest run <file> > $SCRATCH/x.txt 2>&1; echo RC=$?`.
  `$SCRATCH` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad`.
  `rm`/`cp` are `-i` aliases here: use `/bin/rm`, and `cat a > b` instead of `cp`.
- Existing criteria: assertions are not edited. Allowed fixture edits, and only these:
  (a) add the genuine `repoId` field to a literal group summary (spec §4);
  (b) add a `/api/projects` route to an App-rendering test's fake `fetch` (plan decision P1 below);
  (c) nothing else — any other existing criterion that goes red: fix the implementation, or stop and report the
  test name and the raw failure. Every fixture file touched is listed in the commit body.
- Labels on rows appear AFTER today's text (`g · running … · Alpha`), so existing name regexes such as
  `/^r · clarifying/` keep matching.
- Every new branch gets a named deletion mutation (spec §9 and §11 tables). Mutations run only in Task 10, in a
  `git clone --local` copy, never in the main tree.

## Plan-time decisions (recorded into spec §12 by Task 10)

- **P1 — unresolved scope.** Before `/api/projects` has answered, or after it failed, control groups and
  requirements are not listed; a note says the project list is unavailable; import/new-requirement are disabled;
  recovery, uncertain commands and alerts stay visible (spec §3, §8). Existing App-rendering tests that list
  groups or requirements never served `/api/projects`; they get a one-project route (allowed edit (b)) whose
  `controlRepoId` is the file's own first configured repository. Assertions unchanged.
- **P2 — Decisions under unresolved scope.** Decision rows name their own project and Agree/Correct act on the
  row's own `projectKey`, so they are not ambiguous: with no project list the Decisions pane shows every row
  and keeps today's repository filter. With a project list it uses the global scope (spec §3/§5).
  This keeps `appSelection`/`decisionsI18n` (rows of unregistered keys) untouched.
- **P3 — workspace in All projects.** The panel-level workspace-mode selector is shown only in project mode, for
  the selected project's repository. In all mode it is hidden; an open group's detail always gets the workspace of
  its own `plan.repoId` (spec §5), read into a per-repository map.
- **P4 — uncertain commands.** The panel's "outcome unknown" line lists every unresolved command (all groups, all
  projects) with its repository label; the open group's detail still receives only its own (spec §7).
- **P5 — repository label.** `repoLabel(repoId)` = the registered project whose `controlRepoId` equals it
  (its display name), else the config repository's `displayName`, else the raw `repoId`. Never the selected
  project's name.

## Review Focus

1. A second tab or a focus re-read returns a project list without the selected project — selection falls back to
   the first project and every open detail closes (Task 3, criterion "removed project").
2. A summary poll that arrives while All projects is shown and moves a group of another project — the row updates
   in place, no `refetchRequired`, no extra complete read (Task 4, criterion "poll stability").
3. A group whose repository was removed from the registry but is still in the control config — listed in All
   projects with the config display name or raw `repoId`, never with another project's name (Task 4, criterion
   "label fallback").
4. Pressing a recovery Retry button whose blocker disappeared in the poll that landed between render and click —
   no POST (Task 7, criterion "vanished blocker").
5. A decision correction whose POST is answered after the person opened another project's decision — the answer
   is announced against its own decision in the global notice, never inline under the other one (Task 9).

---

### Task 1: Server — authoritative `repoId` on every group summary

**Files:**
- Modify: `src/control/webProtocol.ts` (`groupSummarySchema`, ~line 964)
- Modify: `src/panel/controlViews.ts` (`readGroupSummary`, ~line 314)
- Modify: `tests/control/webProtocol.test.ts` (two literal summaries ~lines 305 and 340: add `repoId`)
- Modify: `tests/panel/controlApi.test.ts`, `tests/panel/controlReadApi.test.ts` — only if they hold literal summaries
  that now fail to parse (allowed edit (a)); list them in the commit body.
- Create: `tests/panel/projectGroupScope.test.ts`

**Interfaces:**
- Produces: `GroupSummaryV1.repoId: string` (zod `idSchema`, required) on the wire, in `readControlSummary`
  (complete and `sinceChangeSeq`), in `GroupViewV1.summary` and in `RequirementViewV1.summary`.
- Produces: blocked read reason `group-summary:repository-mismatch` when a requirement-bearing plan group's
  archived `plan.repoId` differs from its `requirement.repoId`.

- [ ] **Step 1: Write the failing server criterion** `tests/panel/projectGroupScope.test.ts`.
  Use the existing harnesses: `webFixture()` from `tests/control/fixtures/web.ts` (a plan group `g` on repo
  `repo`) and `requirementHarness()` from `tests/control/fixtures/requirementHarness.ts` (a clarifying group `r`
  on repo `repo`). Read their setup before writing. Cases:

```ts
import { describe, expect, it } from "vitest";
import { groupSummarySchema } from "../../src/control/webProtocol.js";
import { readControlGroup, readControlSummary, readGroupSummary, readRequirementView } from "../../src/panel/controlViews.js";
import { readRequirementGroup, saveRequirementGroup } from "../../src/control/requirementRecords.js";
// + the two harness imports above

describe("group summary repository identity (project filtering spec §4)", () => {
  it("names the archived plan's repository on a plan group, in the summary list and in the group view", async () => {
    // webFixture: g imported for repo "repo". Assert readGroupSummary(store,"g").repoId === archived plan repoId,
    // readControlSummary(store,epoch,null).groups[0].repoId === same, and readControlGroup(...).summary.repoId === same.
  });
  it("names the requirement's repository on a clarifying group, in the summary and in the requirement view", async () => {
    // requirementHarness: r clarifying. readGroupSummary(store,"r").repoId === readRequirementGroup(store,"r").requirement.repoId
    // and readRequirementView(store,epoch,"r").summary.repoId equals it too.
  });
  it("gives the same repoId in a sinceChangeSeq (partial) summary as in a complete one", async () => {
    // record a projection change for g (recordProjectionChange) then readControlSummary(store, epoch, prevSeq).
  });
  it("refuses to guess when an accepted requirement group's plan and requirement disagree", async () => {
    // After accept (see tests/control/requirementAccept.test.ts `reviewed()` + accept), rewrite the requirement
    // block's repoId with saveRequirementGroup({...readRequirementGroup(store,"r"), requirement: {...requirement, repoId: "other"}})
    // (read saveRequirementGroup's signature first). expect(() => readGroupSummary(store,"r")) toThrow with
    // a message/code containing "group-summary:repository-mismatch".
  });
  it("rejects a summary without repoId and one with an invalid repoId at the protocol boundary", () => {
    const base = { groupId: "a", state: "draft", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 };
    expect(groupSummarySchema.safeParse(base).success).toBe(false);
    expect(groupSummarySchema.safeParse({ ...base, repoId: "" }).success).toBe(false);
    expect(groupSummarySchema.safeParse({ ...base, repoId: "repo" }).success).toBe(true);
  });
});
```
  Fill each comment with concrete code against the harness API you read; every `it` must call production code
  after its own setup (Rule 9: no assertion that only reads back test-written values).

- [ ] **Step 2: Run it, expect RED** (missing `repoId`): `./node_modules/.bin/vitest run tests/panel/projectGroupScope.test.ts`.

- [ ] **Step 3: Implement.** In `groupSummarySchema` add `repoId: idSchema,` right after `groupId`.
  In `readGroupSummary`:

```ts
  const requirementBlock = hasRequirementBlock(body as { requirement?: unknown });
  // Project filtering spec §4: the group's repository, from its archived plan, or from its requirement while it
  // is still clarifying. An accepted requirement group must agree with its plan; a disagreement is never guessed.
  const repoId = archived !== null ? archived.plan.repoId : readRequirementGroup(store, groupId).requirement.repoId;
  if (archived !== null && requirementBlock && readRequirementGroup(store, groupId).requirement.repoId !== archived.plan.repoId) {
    return blocked("group-summary:repository-mismatch");
  }
  const summary = { groupId, repoId, state: body.status, /* …unchanged… */ };
```
  (reuse `requirementBlock` in the existing `requirement:` spread). Confirm `readRequirementGroup` is already
  imported in `controlViews.ts`; import it if not.

- [ ] **Step 4: Add `repoId` to the literal summaries in `tests/control/webProtocol.test.ts`** (values `"repo"`,
  matching each fixture's own `plan.repoId`), then run
  `./node_modules/.bin/vitest run tests/panel/projectGroupScope.test.ts tests/control/webProtocol.test.ts tests/control/requirementAccept.test.ts tests/panel/controlReadApi.test.ts tests/panel/controlApi.test.ts tests/panel/requirementApi.test.ts tests/panel/controlViewOrder.test.ts`
  and `npm run typecheck` (root tsc covers `src` + `tests`; read `tsconfig.json` to confirm). Expect all green.
  Any red outside allowed edit (a): stop and report.

- [ ] **Step 5: Commit** `feat(control): name each group summary's repository` — list fixture files edited.

---

### Task 2: Web type and fixtures carry `repoId`

**Files:**
- Modify: `web/src/controlTypes.ts` (`GroupSummaryV1`, line ~62): add required `repoId: string;` after `groupId`
  with comment `/** Project filtering spec §4: the group's repository, from its plan or its requirement. */`.
- Modify (allowed edit (a) only): every web test/fixture holding a literal group summary. Candidate list (from
  `grep -rl recoveryBlockerCount web/tests` at plan time — re-run it and use the live result):
  `fixtures/board.ts` (`"orca"`), `fixtures/requirement.ts` (`"repo"`), `agentPreviewRefresh`, `agentSelectionEditor`,
  `agentsI18n`, `budgetHandoffCapability`, `budgetI18n`, `budgetSuggestions`, `confirmSelection`,
  `controlCommandRecovery`, `controlI18n`, `controlKeys`, `controlPanel`, `controlPollSettles`, `controlRefetch`,
  `controlState`, `driverRetry`, `estimateStale`, `evidenceLink`, `handoffResume`, `i18nPseudo`, `labelSourceFallback`,
  `loopBudgetRows`, `loopPlanCard`, `loopPlanDraft`, `loopPlanEdit`, `loopPlanSkillsPayload`, `loopSuggestionApply`,
  `loopSuggestionDraft`, `taskLabels`, `taskLabelsDraft`, `taskLabelsDraftBase`, `workspaceMode` (`.test.tsx`/`.ts`).
  Value rule: the file's own group view `plan.repoId` when it has one; otherwise its config's first repository;
  otherwise `"repo"`.

**Interfaces:**
- Produces: `GroupSummaryV1.repoId: string` for every later web task.

- [ ] **Step 1: RED by type.** Add the field, run `cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json`
  (to a file). Expect errors only of the form "Property 'repoId' is missing" in the listed fixtures.
- [ ] **Step 2: Add `repoId` to each literal** (summary objects only; nothing else in the file changes).
- [ ] **Step 3: GREEN.** `cd web && npm run check` (tsc + full web vitest) → RC 0. Also root
  `./node_modules/.bin/vitest run tests/panel/webParity.test.ts` → green (server/web parity).
- [ ] **Step 4: Commit** `test(web): carry the group summary's repository in literal fixtures` (+ `feat(web)` type change in the same commit; list every fixture file).

---

### Task 3: View mode, storage, sidebar selector and selection lifecycle

**Files:**
- Create: `web/src/projectScope.ts`
- Modify: `web/src/ProjectControl.tsx` (All projects option), `web/src/App.tsx` (view state, normalization,
  closing details), `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Create: `web/tests/fixtures/twoProjects.ts` (shared fake panel for Tasks 3–9)
- Create: `web/tests/projectFiltering.test.tsx`

**Interfaces:**
- Produces (`web/src/projectScope.ts`):

```ts
export const PROJECT_VIEW_KEY = "orca.projectView";
export type ProjectView = "project" | "all";
/** The scope lists are filtered by. `unresolved`: no project list yet, or it failed (plan decision P1). */
export type GroupScope = { kind: "unresolved" } | { kind: "all" } | { kind: "project"; repoId: string | null };
export const ALL_PROJECTS = "\u0000all";  // sentinel <option> value only; never stored, never a projectKey
export function readProjectView(storage: Pick<Storage, "getItem"> | undefined): ProjectView;  // invalid/throw -> "project"
export function writeProjectView(storage: Pick<Storage, "setItem"> | undefined, view: ProjectView): void;  // swallow errors
export function allowsAll(projectCount: number): boolean;  // >= 2
export function groupScope(answer: ProjectsAnswerV1 | null, project: string | null, view: ProjectView): GroupScope;
export function inScope(scope: GroupScope, repoId: string): boolean;  // unresolved -> false; all -> true; project -> repoId === scope.repoId
```
  `groupScope`: `answer === null` → unresolved; `view === "all" && allowsAll(answer.projects.length)` → all;
  otherwise `{ kind: "project", repoId: chosen?.controlRepoId ?? null }` (zero projects ⇒ `repoId: null`).
- Produces (App): `const [projectView, setProjectView] = useState<ProjectView>(() => readProjectView(browserStorage()))`;
  `const scope = groupScope(projectsAnswer, project, projectView)`; `chooseProject(key)` also sets and persists
  `"project"`; `chooseAll()` sets and persists `"all"` only.
- Produces (ProjectControl): new optional props `view?: ProjectView; onAll?: () => void`. When
  `projects.length >= 2 && onAll`, the select gets a first option `ALL_PROJECTS` labelled `t("project.all")`;
  its value is `ALL_PROJECTS` when `view === "all"`. Choosing it calls `onAll`, any other option `onProject`.
- Produces (`twoProjects.ts`): `ALPHA = "alpha-11111111"`, `BETA = "beta-22222222"`, `twoConfig`,
  `TWO_PROJECTS` (`alpha`/"Alpha"→ALPHA, `beta`/"Beta"→BETA, `editable: true`), `groupSummary(groupId, repoId, over?)`,
  `planGroupView(summary)` (built from `fixtures/board.ts` `view([])` with `summary` and `plan.repoId` replaced),
  `decisionRow(projectKey, id, over?)`, `installFakePanel(init?) : FakePanel` where

```ts
export interface FakePanel {
  projects: { status: number; body: unknown };
  summary: ControlSummaryV1;            // served for every /api/control/summary read (tests mutate it)
  recovery: RecoveryViewV1;
  todo: DecisionListRow[];
  groupViews: Record<string, GroupViewV1>;
  requirementViews: Record<string, RequirementViewV1>;
  workspaces: Record<string, { mode: "worktree" | "clone"; delayMs?: number }>;
  decisions: Record<string, Decision>;  // key rowKey({projectKey,id})
  requests: string[];                   // "METHOD url" in order
  posts: Array<{ url: string; body: unknown }>;
  /** Answer one POST; default: control success {commandRevision: 1}, panel 200 {}. Tests replace it to hold/refuse. */
  onPost: (url: string, body: unknown) => Promise<Response>;
}
```
  Serve: `/api/todo`, `/api/metrics` (copy `METRICS` from `projectSwitcher.test.tsx`), `/api/chains` (`{repos:[]}`),
  `/api/projects`, `/api/control/config`, `/api/control/summary*`, `/api/control/recovery`,
  `/api/control/agents` + `/api/control/operator/agent-preferences` (as in `requirementsApp.test.tsx`),
  `/api/control/groups/:id` (groupViews or 404 `group-not-found`), `/api/control/groups/:id/requirement`,
  `/api/control/repositories/:id/workspace` (honour `delayMs` with `setTimeout`), `/api/decision?…` (look up
  `fetchDecision` in `web/src/api.ts` for the exact URL), memory status/list as in `projectSwitcher.test.tsx`,
  every POST via `onPost` after recording it. Unknown URL → 404 `route-not-found` (never throw).

- [ ] **Step 1: Write failing criteria** in `web/tests/projectFiltering.test.tsx` (`// @vitest-environment jsdom`),
  describe "view mode and persistence":
  1. *two projects*: sidebar `combobox "Project"` has options `All projects`, `Alpha`, `Beta`; choose All → value
     is All and `localStorage["orca.projectView"] === "all"`; `localStorage["orca.project"]` still `"alpha"`.
  2. *reload*: render with `orca.projectView = "all"` and `orca.project = "beta"` → All is selected; choose Beta →
     project mode, stored `"project"`/`"beta"`; unmount + render → Beta.
  3. *one project*: `TWO_PROJECTS` reduced to alpha, stored `"all"` → no All option, project mode, stored value
     normalised to `"project"`.
  4. *invalid / throwing storage*: stored `"bogus"` → project mode; `Storage.prototype.getItem/setItem` throwing
     (as `projectSwitcher.test.tsx` D2) → page renders, two-project selector works.
  5. *removed project*: open a group of beta (Task control) and a beta decision, then the focus re-read returns
     only alpha → selector shows Alpha, the group detail region and the decision detail are gone.
  6. *scope change closes details*: open a group, a requirement and a decision; switch Alpha → All → each detail
     closes (`queryByRole("region", {name: /Control group/})` null, requirement article gone, Decisions shows
     "Select one" text — read the exact strings from `en.ts`).
- [ ] **Step 2: RED.** Run the file; expect failures for the missing All option/storage.
- [ ] **Step 3: Implement** `projectScope.ts`, ProjectControl props, App state:
  - `readProjects` success: if `!allowsAll(answer.projects.length)` and current view is `"all"` → set and persist
    `"project"`.
  - A `useEffect` keyed on `[scopeKey]` where `scopeKey = JSON.stringify([projectView === "all" && allowsAll(...), project])`
    calls `setSelectedGroup(null); setSelectedRequirement(null); setSelected(null)`. Skip the very first run
    (`useRef(true)` guard) so the initial project resolution does not matter either way; drafts and
    `control.drafts` are never touched.
  - `ProjectControl` gets `view={projectView} onAll={chooseAll}`.
  - i18n: `project.all: "All projects"` / zh `"全部项目"`.
- [ ] **Step 4: GREEN** for this file plus `tests/projectSwitcher.test.tsx tests/projectRegistry.test.tsx tests/i18nKeys.test.ts`.
- [ ] **Step 5: Commit** `feat(web): choose All projects or one project from the sidebar`.

---

### Task 4: Scoped Task control and Requirements lists, explicit import target

**Files:**
- Modify: `web/src/ControlPanel.tsx`, `web/src/RequirementsPanel.tsx` (list + NewRequirement target only — drafts are Task 8),
  `web/src/App.tsx`, locales
- Modify (allowed edit (b)): App-rendering tests that list groups/requirements and never served `/api/projects`.
  Candidates: `agentPreviewRefresh`, `controlCommandRecovery`, `controlI18n`, `controlPollSettles`, `controlRefetch`,
  `loopPlanDraft`, `loopSuggestionApply`, `loopSuggestionDraft`, `requirementsApp`, `taskLabelsDraft`,
  `taskLabelsDraftBase`. Edit only those that actually go red, each by adding one line to its fake fetch:
  `if (url === "/api/projects") return json({ projects: [{ projectKey: "<k>", controlRepoId: "<file's first config repoId>" }] });`
- Test: `web/tests/projectFiltering.test.tsx` (new describes)

**Interfaces:**
- Consumes: `GroupScope`, `inScope` (Task 3); `GroupSummaryV1.repoId` (Task 2).
- Produces: `ControlPanel` new optional props `scope?: GroupScope; repoLabel?: (repoId: string) => string`.
  Absent `scope` = today's behaviour (component tests unchanged). `RequirementsPanel` same two props.
- Produces (App): `repoLabel` per plan decision P5, memoised on `[projects, controlConfig]`.

- [ ] **Step 1: Failing criteria** (describe "two-project lists"), using `installFakePanel` with groups
  `a1`(ALPHA, ready), `b1`(BETA, running), requirement-bearing `ra`(ALPHA, clarifying) and `rb`(BETA, clarifying):
  1. Alpha: Task control nav lists `a1` (and `ra` link) only; Requirements lists `ra` only. Beta: only `b1`/`rb`.
  2. All: both, each button/link text ends with ` · Alpha` / ` · Beta`.
  3. *label fallback*: group `c1` on repoId `gamma-3` present in config (`displayName "Gamma"`) but not in
     projects → All shows ` · Gamma`; a group on `zeta-9` in neither → ` · zeta-9`; neither shows `Alpha`/`Beta`.
  4. *not under control*: a project with `controlRepoId: null` → no groups, the existing not-under-control note.
  5. *unresolved*: `/api/projects` answers 500 → no group rows, note `t("project.listUnavailable")`, Import and
     Start clarifying absent/disabled, but a recovery blocker and an uncertain command stay visible.
  6. *import target, all mode*: Import region shows a `Repository` select with placeholder selected and the Import
     button disabled; choose Beta → Plan select lists only Beta plans; Import posts `repoId: BETA`.
     Choosing a repository there does not leave All mode (sidebar still All).
  7. *new requirement target, all mode*: Requirements form shows placeholder; `Start clarifying` disabled until a
     repository is chosen; payload carries the chosen repoId. In project mode the form's repository select is
     today's (changing it switches the global project).
  8. *poll stability*: viewing Alpha, the next partial summary moves `b1` to `done`; no `GET /api/control/summary`
     without `sinceChangeSeq` follows (count complete reads before/after over 3 ticks; use fake timers or
     `waitFor` on request log); switch to All → `b1 · done …` shown; no "refetch required" alert.
  9. *uncertain everywhere* (P4): an uncertain command on `b1` while viewing Alpha with `a1` open → the outcome-unknown
     line names `b1` and its label.
  10. *requirement-open after a switch*: hold the `POST /api/control/requirements` answer, switch project, release
     a success → the new requirement's detail is NOT opened (Requirements shows no article).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.**
  - ControlPanel: `const listed = props.scope === undefined ? summary.groups : summary.groups.filter((g) => inScope(props.scope!, g.repoId));`
    unresolved → `<p role="note">{t("project.listUnavailable")}</p>` instead of the nav content; all mode appends
    `` ` · ${props.repoLabel?.(group.repoId) ?? group.repoId}` `` to each row. `waiting` for the panel line =
    every `uncertain` command (P4), each rendered `` `${commandId} (${groupId}${label ? ` · ${label}` : ""})` `` where
    label comes from `summary.groups.find(g => g.groupId === command.groupId)?.repoId`; the open group's
    ControlGroupView still gets `uncertain.filter(c => c.groupId === selected)`.
  - ImportForm: new prop `scope`. `all` → repository `<select>` (label `t("control.import.repository")`) with a
    disabled placeholder `<option value="">{t("project.chooseTarget")}</option>`, options = config repositories
    whose `repoId` is some registered project's `controlRepoId`; button disabled until chosen; plans restricted to
    it. `unresolved` → note, no button. `project` → today's code path with `repoId = scope.repoId`.
    Key ImportForm by `scope.kind === "all" ? "all" : (repoId ?? "")`.
  - RequirementsPanel: filter `listed` the same way; NewRequirement gets `scope`: `all` → local target select
    with placeholder (form-local, does NOT call `onRepo`), submit disabled until chosen; `unresolved` → note,
    no form; `project` → today's behaviour with `repoId = scope.repoId` (null → note `notUnderControl`).
  - App: pass `scope` and `repoLabel` to both panels. In `sendControl`, capture
    `const scopeAtSend = scopeKeyRef.current` before the POST and only `setSelectedRequirement(action.groupId)`
    when `scopeKeyRef.current === scopeAtSend`.
  - i18n: `project.listUnavailable` ("The project list is unavailable; groups are not shown until it is read."),
    `project.chooseTarget` ("Choose a repository"), `control.import.repository` ("Repository").
- [ ] **Step 4: GREEN**: new file; then `cd web && npm run check`. For each pre-existing App test that went red,
  confirm the failure is "content missing because the project list never answered", add the allowed route,
  re-run. Any other red: fix implementation or stop and report.
- [ ] **Step 5: Commit** `feat(web): show only the chosen project's groups and requirements, or all of them labelled`
  — list the fixture files that got the projects route.

---

### Task 5: Decisions follow the global scope

**Files:** Modify `web/src/DecisionsView.tsx`, `web/src/App.tsx`, locales. Test: `projectFiltering.test.tsx`.

**Interfaces:**
- Produces: `DecisionsView` optional prop
  `scope?: { projects: ProjectV1[]; value: string /* projectKey or ALL_PROJECTS */; allowAll: boolean; onChange: (value: string) => void }`.
  When present the repository FilterSelect is replaced by this select (label `t("decisions.filterRepository")`,
  options from `projects`, plus All when `allowAll`), and App passes `rows` already restricted. When absent:
  today's component (unchanged criteria `decisionsView`/`decisionsI18n`).
- App: with a project list (P2): `scopedTodo = allMode ? home.todo : home.todo.filter(r => r.projectKey === project)`;
  `filter.projectKey` forced to `""`; onChange → `chooseAll()` or `chooseProject(key)`. Without a project list:
  today's props (no `scope`).

- [ ] **Step 1: Failing criteria** (describe "decision identity and count"): todo rows `alpha/d1`, `beta/d1`
  (same id), `beta/d2`.
  1. Alpha: one row; count text `1 of 1`. Beta: `2 of 2`. All: `3 of 3`, both `d1` rows present.
  2. Open `beta/d1`, kind filter narrows — the existing hidden-by-filter note still works within Beta.
  3. Choose a project with no rows (add `gamma` project, controlRepoId null) → "Nothing to review", no alpha/beta rows.
  4. The Decisions repository select and the sidebar selector are the same state: change one, the other follows.
  5. Opening `alpha/d1` loads `/api/decision` for `alpha` (not `beta`) — identity is `(projectKey,id)`.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** (+ `decisionsView`, `decisionDetail`, `decisionsI18n`, `appSelection`).
- [ ] **Step 5: Commit** `feat(web): scope Decisions to the chosen project or all projects`.

---

### Task 6: Workspace per repository

**Files:** Modify `web/src/App.tsx`, `web/src/ControlPanel.tsx`. Test: `projectFiltering.test.tsx`.

**Interfaces:**
- App: replace `workspace` state with `workspaces: Record<string, RepositoryWorkspaceV1>` plus
  `workspaceSeq = useRef<Record<string, number>>({})`. `readWorkspace(repoId)` bumps the repo's seq and applies
  the answer only if the seq is still current. Reads: the selected project's `controlRepoId` (project mode) and the
  open group's `plan.repoId` (any mode, once its canonical view is cached).
- ControlPanel: `workspace` prop for the panel-level selector = project mode ? `workspaces[repoId]` : `null` (P3);
  new prop `workspaceFor?: (repoId: string) => RepositoryWorkspaceV1 | null`; ControlGroupView gets
  `props.workspaceFor?.(view.plan.repoId) ?? props.workspace`.
- `sendWorkspaceMode(repoId, mode, revision)` takes the repository explicitly.

- [ ] **Step 1: Failing criteria** (describe "group workspace"): ALPHA workspace `worktree`, BETA `clone`.
  1. Concrete Alpha, then All, open `b1` → its Git section reflects `clone` (find the GitScheme text for clone in
     `en.ts`); `GET …/repositories/beta-22222222/workspace` was requested.
  2. *late reply*: ALPHA workspace `delayMs: 300`; open All, open `b1` immediately; after the delayed alpha reply
     lands, `b1` still shows `clone`.
  3. Project mode: panel-level workspace selector present for Alpha; All mode: absent.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** (+ `projectSwitcher` B, `workspaceMode`, `gitScheme`).
- [ ] **Step 5: Commit** `feat(web): read each open group's own repository workspace`.

---

### Task 7: R1 — recovery retry belongs to the blocker's target

**Files:**
- Create: `web/src/recoveryTarget.ts`
- Modify: `web/src/RecoveryView.tsx`, `web/src/ControlPanel.tsx`, `web/src/App.tsx`, locales
- Create: `web/tests/projectScopeRecovery.test.tsx`

**Interfaces:**
- Produces (`recoveryTarget.ts`):

```ts
import type { ControlAction } from "./controlApi.js";
import type { ControlClientState } from "./controlState.js";
export interface RecoveryTarget {
  source: "recovery" | "group-view";
  epoch: string;              // the recovery view's (or group view's) epoch the button was rendered from
  groupId: string;
  runId: string | null;
  code: string;               // blocker code, to find it again
}
/** Spec §11 R1: the command, built now from the target's own current summary -- or null when it must not be sent. */
export function recoveryRetryAction(state: ControlClientState, target: RecoveryTarget): ControlAction | null {
  if (target.groupId === "" || state.refetchRequired || state.epoch === null || state.epoch !== target.epoch) return null;
  const listed = target.source === "recovery"
    ? state.recovery?.epoch === target.epoch && state.recovery.blockers.some((b) => b.groupId === target.groupId && b.runId === target.runId && b.code === target.code)
    : (state.canonical[target.groupId]?.recoveryBlockers ?? []).some((b) => b.runId === target.runId && b.code === target.code);
  if (!listed) return null;
  const summary = state.groups[target.groupId];
  if (summary === undefined) return null;
  const payload = target.runId === null ? { scope: "group" as const, groupId: target.groupId } : { scope: "run" as const, runId: target.runId };
  return { verb: "recovery-retry", groupId: target.groupId, expectedRevision: summary.commandRevision, payload };
}
```
- RecoveryView props become `{ recovery; group: GroupViewV1 | null; state: ControlClientState; onRetry: (t: RecoveryTarget) => void; onReread: () => void; repoLabel?: (repoId: string) => string }`.
  For each blocker: build its target; `enabled = recoveryRetryAction(state, target) !== null`; render Retry
  `disabled={!enabled}`; when not enabled render a `Re-read` button (`t("recovery.reread")`) calling `onReread`;
  label each global blocker with `repoLabel(state.groups[groupId].repoId)` when known, else the explicit groupId.
  Remove the old `revision` derived from the selected `group`.
- App: `onRetry={(target) => { const action = recoveryRetryAction(controlNow.current, target); if (action !== null) void sendControl(action); }}`
  and `onReread={() => void readControlTick()}`. ControlPanel passes these through (new props `controlState`,
  `onRecoveryRetry`, `onRecoveryReread`; when absent — component tests — RecoveryView falls back to building the
  action with `recoveryRetryAction` over a state assembled from `summary`/`recovery`/`groups` props and calls
  `onCommand`).

- [ ] **Step 1: Failing criteria** `web/tests/projectScopeRecovery.test.tsx` (App-level with `installFakePanel`):
  1. Groups `a1`(ALPHA, rev 3) and `b1`(BETA, rev 9); recovery blocker `{scope:"group", groupId:"b1", runId:null}`.
     View Alpha, open `a1`, click Retry on the `b1` blocker → exactly one POST `/api/control/recovery/retry` with
     `expectedRevision: 9` and `payload {scope:"group", groupId:"b1"}`.
  2. Same with `b1` clarifying (state `clarifying`, requirement summary) → POST carries 9; no
     `GET /api/control/groups/b1` follows (requirement view is read instead).
  3. Run-scoped blocker `{scope:"run", groupId:"b1", runId:"run-b"}` → `payload {scope:"run", runId:"run-b"}`, revision 9.
  4. Blocker for `zz` with no summary → Retry disabled, Re-read present; clicking Re-read issues a summary read and no POST.
  5. Recovery view epoch `epoch-b` while summary epoch `epoch-a` → Retry disabled.
  6. *vanished blocker*: render with the blocker, then the fake's recovery drops it; call the retry handler with
     the old target (pure test on `recoveryRetryAction`) → `null`; and App-level: after the poll that removed it
     no Retry button exists.
  Also unit-test `recoveryRetryAction` directly for each null branch (empty groupId, refetchRequired, epoch,
  not listed, no summary) and one positive case.
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** (+ `controlPanel`, `controlCommandRecovery`, `controlI18n`, `i18nPseudo`).
- [ ] **Step 5: Commit** `fix(web): send a recovery retry at its own group's revision`.

---

### Task 8: R2 — detail drafts outlive the detail, keyed by owner

**Files:**
- Create: `web/src/detailDrafts.ts`
- Modify: `web/src/RequirementsPanel.tsx`, `web/src/DecisionDetail.tsx`, `web/src/App.tsx`
- Create: `web/tests/projectScopeDrafts.test.tsx`

**Interfaces:**
- Produces (`detailDrafts.ts`):

```ts
import type { CorrectionForm } from "./api.js";
import type { PanelLanguage } from "./i18n.js";
export type AnswerChoice = { kind: "recommended" } | { kind: "text"; text: string };
export interface NewRequirementDraft { idea: string; tokens: number; language: PanelLanguage; agent: string }
export interface AnswerDraft { choice: Record<string, AnswerChoice>; decisions: Record<string, boolean> }
export interface DetailDrafts {
  newRequirement: Record<string, NewRequirementDraft>;  // key: repoId
  answer: Record<string, AnswerDraft>;                  // key: answerKey
  feedback: Record<string, string>;                     // key: feedbackKey
  limit: Record<string, number>;                        // key: limitKey
  correction: Record<string, CorrectionForm>;           // key: correctionKey
}
export type DraftSlot = keyof DetailDrafts;
export const EMPTY_DRAFTS: DetailDrafts = { newRequirement: {}, answer: {}, feedback: {}, limit: {}, correction: {} };
// JSON.stringify of a tuple is injective (DecisionList.tsx rowKey comment).
export const answerKey = (repoId: string, groupId: string, requirementId: string, roundNo: number): string => JSON.stringify([repoId, groupId, requirementId, roundNo]);
export const feedbackKey = (repoId: string, groupId: string, requirementId: string, draftNo: number): string => JSON.stringify([repoId, groupId, requirementId, draftNo]);
export const limitKey = (repoId: string, groupId: string): string => JSON.stringify([repoId, groupId]);
export const correctionKey = (projectKey: string, decisionId: string): string => JSON.stringify([projectKey, decisionId]);
export function setDraft<S extends DraftSlot>(all: DetailDrafts, slot: S, key: string, value: DetailDrafts[S][string]): DetailDrafts;
/** Spec §11 R2: clear only when the stored draft still equals what was submitted. */
export function clearIfUnchanged<S extends DraftSlot>(all: DetailDrafts, slot: S, key: string, submitted: DetailDrafts[S][string]): DetailDrafts;
```
  `clearIfUnchanged` compares with `JSON.stringify` and returns `all` unchanged when different or absent.
- Produces: an `EditableDrafts` prop bundle `{ drafts: DetailDrafts; onDraft: <S extends DraftSlot>(slot: S, key: string, value: DetailDrafts[S][string]) => void }`
  passed App → RequirementsPanel → NewRequirement / Detail → RoundForm / DraftReview / RaiseLimit, and App → DecisionDetail
  (`draft?: CorrectionForm; onDraft?: (form: CorrectionForm) => void` — when absent DecisionDetail keeps local state
  so `decisionDetail.test.tsx` is unchanged; make the form controlled either way).
- RequirementsPanel `onCommand` gains an optional second argument `submitted?: { slot: DraftSlot; key: string; value: unknown }`.
  App: `const revision = await sendControl(action); if (revision !== null && submitted) setDetailDrafts((d) => clearIfUnchanged(d, submitted.slot, submitted.key, submitted.value));`
  Decision correction: same, via the R3 request record success (Task 9 calls `clearIfUnchanged(…, "correction", …)`).
- RoundForm: initial values = stored draft if present, else today's defaults; every edit calls `onDraft`;
  the payload iterates `result.questions` / `result.glossary` / `result.adrs` (current ids only) and falls back
  to `recommended` / `true` for an id the draft lacks. Rendered only for `awaiting-answers` (unchanged), so an
  answered round cannot reuse its draft; a new round has a new key.
- NewRequirement: content from `drafts.newRequirement[target]` (defaults when absent: idea `""`, tokens
  `10_000_000`, language = panel language, agent `""`); with no confirmed target in all mode the inputs are disabled
  and show defaults (never another target's draft).

- [ ] **Step 1: Failing criteria** `web/tests/projectScopeDrafts.test.tsx` (App-level; requirement views built from
  `web/tests/fixtures/requirement.ts` with `repoId`/`groupId`/`requirementId` overridden per project):
  1. Alpha requirement `ra` round 1 awaiting answers: choose "own answer" for q1, type `alpha text`, reject glossary
     entry `G1`; type split feedback on `ra2` (draft awaiting review) `alpha feedback`; open decision `alpha/d1` and
     type because `alpha because`, kind second option. Switch to Beta (details close), open `rb` → defaults; open
     `beta/d1` → empty because. Switch back to Alpha, reopen each → every value restored.
  2. *new round*: while `ra` is closed the fake advances it to round 2 → reopen shows round 2 with defaults; the
     round-1 draft is not submitted (POST payload for round 2 contains only round-2 question ids, recommended).
  3. *late success*: type `first`, submit (hold the POST), edit to `second`, release success → `second` survives.
     *failure*: submit, refuse → draft survives unchanged.
  4. *new requirement per target* (all mode): choose Alpha target, type `idea A`; choose Beta → empty idea; type
     `idea B`; choose Alpha → `idea A`. Switch sidebar to project Alpha and back to All → target placeholder again,
     but choosing Alpha still restores `idea A`.
  Pure unit tests for `clearIfUnchanged` (equal → removed; different → kept; absent → same object) and for key
  injectivity (`answerKey("a,b","c",…) !== answerKey("a","b,c",…)`).
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** (+ `requirements`, `requirementsApp`, `requirementsI18n`, `decisionDetail`, `appSelection`).
- [ ] **Step 5: Commit** `fix(web): keep requirement and correction drafts with their owners across detail closure`.

---

### Task 9: R3 — decision results and retries keep their request ownership

**Files:**
- Create: `web/src/decisionRequests.ts`, `web/src/DecisionOperations.tsx`
- Modify: `web/src/App.tsx`, locales
- Create: `web/tests/projectScopeDecisionRequests.test.tsx`

**Interfaces:**
- Produces (`decisionRequests.ts`, pure):

```ts
import type { PanelRefusal, RecordCorrectionInput } from "./api.js";
export type RecordedKey = "decisions.recordedReviewed" | "decisions.correctionRecorded";
export type RequestStatus = { kind: "pending" } | { kind: "recorded"; text: RecordedKey } | { kind: "refused"; refusal: PanelRefusal };
export interface DecisionRequest {
  requestId: string;                          // browser correlation token only (spec §11 R3)
  owner: { projectKey: string; decisionId: string };
  verb: "agree" | "correct";
  payload: RecordCorrectionInput | null;      // an independent copy; null for agree
  status: RequestStatus;
  dismissed: boolean;
}
export interface DecisionRequests { records: DecisionRequest[]; active: Record<string, string> }  // active: correctionKey(owner) -> requestId
export const MAX_RECORDS = 20;
export function startRequest(all: DecisionRequests, record: Omit<DecisionRequest, "status" | "dismissed">): DecisionRequests;  // pending, becomes active for its owner, keeps at most MAX_RECORDS (drops oldest non-pending first)
export function settleRequest(all: DecisionRequests, requestId: string, status: Exclude<RequestStatus, { kind: "pending" }>): DecisionRequests;  // updates that record only
export function dismissRequest(all: DecisionRequests, requestId: string): DecisionRequests;
/** The record shown inline under the selected decision: only that owner's ACTIVE request. */
export function inlineRequest(all: DecisionRequests, selected: { projectKey: string; id: string } | null): DecisionRequest | null;
/** Records owned by anything but the selected decision, not dismissed (spec §11 R3 global notice). */
export function noticeRequests(all: DecisionRequests, selected: { projectKey: string; id: string } | null): DecisionRequest[];
/** "Record another": a copy of THIS record's payload with again:true, or null when it has none. */
export function retryPayload(record: DecisionRequest): RecordCorrectionInput | null;
```
- App: replace `outcome` and `lastCorrection` with `const [decisionRequests, setDecisionRequests] = useState<DecisionRequests>({ records: [], active: {} })`.
  `submitDecision(owner, verb, payload)`: `requestId = nextCommandId()` (from `controlApi.ts`), `startRequest`,
  POST with the captured payload copy (`structuredClone`), `settleRequest` on success/refusal/transport error
  (functional `setState` — never a closure value), on success `loadHome()` and (correct) `clearIfUnchanged(… "correction", correctionKey(owner), submittedForm)`.
  Inline slot under `DecisionDetail`: `inlineRequest(decisionRequests, selected)` — `recorded` → status line,
  `refused` → `<Refusal onRecordAnother={() => { const p = retryPayload(record); if (p) void submitDecision(record.owner, "correct", p); }} />`,
  `pending` → nothing new. Remove the effect lines `setOutcome(null); setLastCorrection(null)`; keep
  `setDecision(null)` and the `wanted`/`acceptArrival` GET guard unchanged.
- `DecisionOperations.tsx` (pure): `{ requests: DecisionRequest[]; projectName: (k: string) => string; onDismiss(id); onRecordAnother(record) }`,
  a `<section aria-label={t("decisions.operations")}>` listing each record as
  `t("decisions.operationLine", { project, decision, status })`, a Refusal-like code/message for refused ones,
  `Record another` (`t("decisions.recordAnotherFor", { project, decision })`) only when `refusal.retry_field === "again"`
  and `record.payload !== null`, and Dismiss. Rendered by App inside Shell's `banners` next to ChainBanners, so it
  is visible in every section.

- [ ] **Step 1: Failing criteria** `web/tests/projectScopeDecisionRequests.test.tsx` (App-level; `onPost` holds
  `/api/corrections` and `/api/reviews` with controllable deferreds):
  1. Correct `alpha/d1` (hold), open `beta/d1` (or switch to Beta and open it), resolve A with success → B's detail
     has no status line/alert; the operations notice names Alpha / d1 recorded. Repeat with a refusal (code
     `correction-exists`, `retry_field: "again"`).
  2. B also submits its own correction `beta because`; then click A's notice `Record another` → the POST body is A's
     exact payload (`projectKey: "alpha"`, `because: "alpha because"`) with `again: true`.
  3. Two requests for `alpha/d1`: first held, second held; resolve second (success) then first (refusal) → the inline
     slot shows the success (latest active request), not the late refusal.
  4. Switch scope with no decision selected while A is pending → after resolution the notice still shows A.
  5. Agree refusal never shows `Record another` (even after a correction refusal exists elsewhere).
  Pure unit tests for `startRequest`/`settleRequest`/`inlineRequest`/`noticeRequests`/`retryPayload`
  (including `MAX_RECORDS` bound and that settle touches only its own record).
- [ ] **Step 2: RED. Step 3: Implement. Step 4: GREEN** (+ `appSelection`, `outcome`, `decisionsI18n`, `refusalText`, `i18nKeys`, `i18nPseudo`).
- [ ] **Step 5: Commit** `fix(web): bind decision results and retries to the request that made them`.

---

### Task 10: Gates, mutations, documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-panel-project-filtering-design.md` — append `## 12. Plan and
  implementation decisions — 2026-10-06, session 32306496` (P1–P5 verbatim, plus any implementation-time
  correction). §§1–11 byte-for-byte unchanged (verify with `git diff` showing only appended lines).
- Create: `.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md` (`git add -f`; the directory's
  `.gitignore` is `*`).
- Modify: `docs/handoff/handoff.md` — **only after the human has dealt with the other session's uncommitted edit**;
  otherwise write the handoff text into the ledger and report it (do not stage that file).

- [ ] **Step 1: Isolated clone.** `git clone --local /Users/biran/code/skills/loop/Orca $SCRATCH/orca-pf` then
  `npm ci` there (offline cache allowed). Export `HOME=$SCRATCH/home`, `XDG_CONFIG_HOME/XDG_DATA_HOME/XDG_STATE_HOME/XDG_CACHE_HOME`
  under it, `TMPDIR=$SCRATCH/t` (short, real directory), `ECC_GATEGUARD=off DISABLE_OMC=1`.
- [ ] **Step 2: Gates** (each redirected to its own file, read back whole, RC recorded):
  `npm run typecheck`; `npm run --ws check`; `npm run build --workspace web`;
  `./node_modules/.bin/vitest run tests/panel/projectGroupScope.test.ts tests/control/webProtocol.test.ts`;
  web focused `tests/projectFiltering.test.tsx tests/projectSwitcher.test.tsx tests/projectRegistry.test.tsx tests/controlPollSettles.test.tsx tests/decisionsView.test.tsx tests/decisionDetail.test.tsx tests/projectScopeRecovery.test.tsx tests/projectScopeDrafts.test.tsx tests/projectScopeDecisionRequests.test.tsx`;
  `npm run verify:control`; `npm run verify:panel`; full `npm test`. Record every failure and skip by name;
  compare against the known reds in handoff §4.0 (driverRecovery/K13 timeouts, ccmemAdapter ENOEXEC) — known
  ≠ closed, unknown = stop and diagnose (superpowers:systematic-debugging).
- [ ] **Step 3: Mutations.** In the clone, after a green baseline of the owning criterion file, apply each named
  mutation (spec §9 table and §11 R1/R2/R3 lists — one row per mutation, e.g. "omit repoId", "first repository
  instead", "clarifying via plan", "remove required repoId schema check", "remove Task control filter", "remove
  Requirements filter", "remove all branch", "label from selected project", "remove selection reset", "remove
  requirement-open scope guard", "compare decision id only", "count global rows under project scope",
  "import falls back to first repo", "omit plan restriction", "unkeyed new-requirement draft",
  "use current concrete workspace", "remove workspace seq guard", "scope recovery list", "selected-only waiting list",
  "drop mode storage try/catch", "drop one-project normalisation", "filter reducer inputs", "reset on scope change",
  R1: "selected-group revision", "first summary", "omit target/epoch/refetch checks" (three rows), "allow vanished",
  "clarifying through group view"; R2: "draft left in component state" (per form), "key without owner",
  "reuse previous owner", "drop current-id payload check", "unconditional clear on success";
  R3: "unconditional inline outcome", "owner but not request identity", "retry reads current form",
  "remove global notice", "discard records on scope change"). Each must turn a named criterion red; record the
  criterion name and the restore. Restore by `git checkout -- <file>` in the clone; prove restoration with
  `git diff | wc -c` and `git diff --cached | wc -c` both `0` (raw output files). Any mutation that stays green:
  add the missing criterion in the main tree (new test only), re-run, record.
- [ ] **Step 4: Docs.** Spec §12, ledger (commands, observed commit subjects, RC, raw-output paths, mutation table,
  fixture-edit list), handoff text. Run `git diff --stat` and confirm `docs/handoff/handoff.md` is not staged.
- [ ] **Step 5: Commit** `docs(spec): record project filtering plan and implementation decisions` and
  `docs(sdd): record the project filtering round`.

---

## Self-review (done at plan time)

- Spec coverage: §3 → T3; §4 → T1/T2; §5 lists/labels/poll → T4, selection closure → T3, workspace → T6, Decisions → T5;
  §6 targets → T4, drafts → T8; §7 → T4 (P4) + T7; §8 → T3 (removed project), T4 (unresolved, not-under-control,
  requirement-open guard), T6 (stale workspace); §9 → per-task criteria + T10; §11 R1 → T7, R2 → T8, R3 → T9.
- Chains/Memory: unchanged components keep their concrete project selector; in all mode they keep the retained
  concrete project (`project` state is never cleared by `chooseAll`). Covered by T3 criterion 1 (stored project kept).
- Metrics: untouched (global).
- Names cross-checked: `GroupScope`, `inScope`, `ALL_PROJECTS`, `recoveryRetryAction`, `RecoveryTarget`,
  `DetailDrafts`, `clearIfUnchanged`, `correctionKey`, `DecisionRequests`, `inlineRequest`, `noticeRequests`, `retryPayload`.
