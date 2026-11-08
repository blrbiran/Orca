# UI information architecture: project scope, import, filters and the runs table

Tester feedback `orca_archived_files/issue-20261023.md` #70, #175, #176, #177, #178. **This document proposes; it does not
implement.** Nothing here is built until the person rules on the open questions at the end.

## 1. What the current code does (measured 2026-11-08, local `main`)

1. **Two project controls, one state** (`#70`). `web/src/ProjectControl.tsx` renders the sidebar card: a Radix `Select`,
   an "All projects" option when the view allows it, and Add / Rename / Group-several / Edit-order buttons.
   `web/src/SettingsPage.tsx` renders `ProjectPicker`: one Radix `Select` with no "All projects" option and no actions,
   plus one hint line. `App.tsx` hands both the same `project` state and the same `chooseProject` callback
   (2026-11-05 re-check in the feedback file), so they cannot disagree — but they differ in capability, and the
   "All projects" case leaves the settings select showing a disabled placeholder.
2. **The import form is always on screen** (`#175`). `ControlPanel.tsx` mounts `ImportForm` unconditionally above the
   group list: three selects, a summary line, the import button and the plan-registration form.
3. **Progress filters read as raw controls** (`#176`). `ControlGroupView.tsx` renders a bare `<fieldset>` of checkboxes
   for the label filter, and the task table below it is always present, so the graph gets the remainder.
4. **The runs table carries machine output** (`#177`, `#178`). `ControlGroupView.tsx` puts `EvidenceLink`, `RunTranscript`
   and the raw `evidenceIds` list in the runs table's last `<td>`. Opening a transcript changes the table's column
   widths, and the evidence cell is a hash list a person does not read.

## 2. Goals

- A person always knows where project scope changes and what else that control can do.
- The Tasks page leads with work, not with a form for work that is not being created.
- The runs table reads as a table; transcripts and raw evidence open where they belong, without reflowing the table.
- No new state: every change here is presentation over the state `App.tsx` already holds.

## 3. Non-goals

- Re-designing the sidebar or the sections (H6 stands).
- Adding project actions to the settings page that the sidebar does not have (one source of actions).
- Changing any control route, summary field or command.
- Making the runs table's evidence readable in the browser beyond today's download route (the CLI now has
  `orca run evidence --id`, #184).

## 4. Proposed direction (my recommendation, for the person to accept, change or reject)

**(a) One scope control, two presentations.**
Keep the sidebar `ProjectControl` as the only place that *changes* scope and *edits* projects. Upgrade it from a bare
select to a workspace switcher: the current project's name and kind, with a popover that holds the project list (search
once there are more than ~8), All projects, and the existing Add / Rename / Multi actions. In Settings › This project,
replace `ProjectPicker` with an identity block: the project's name, kind and root, plus a "Switch workspace" link that
moves focus to the sidebar control. This keeps one state, one action set, and answers "why can't I add a project here"
by not offering a second picker at all.

**(b) Import becomes a button, not a resident form.**
Render "Import a plan…" as one button in the Tasks page header that opens the existing `ImportForm` in a dialog (the
board's start dialog is already this shape). Registration of an in-repo plan file stays inside that dialog. No route,
payload or refusal changes.

**(c) A filter toolbar and a collapsible task table.**
Move the label filter into a single toolbar row above the graph (a small popover of checkboxes with the chosen count on
the trigger), and give the task table a "Tasks (n)" disclosure, closed by default when the group is running. The graph
keeps the height it needs; nothing is removed.

**(d) The runs table stops being a container.**
Make each run row expandable; the transcript opens in a full-width region under the table, keyed to the row, reusing
`RunTranscript` as it is. Move `EvidenceLink` and the raw `evidenceIds` into the run's detail (the wo/opened run region),
where a person is already looking at one run. The table keeps: run, phase, state, profile, used, remaining.

## 5. Costs and risks

- (a) touches `ProjectControl`, `SettingsPage` and `App` wiring; the popover is a new component (Radix Popover is not
  yet a dependency; Radix Dialog and Select are).
- (b) and (c) are local to `ControlPanel`/`ControlGroupView`; both need updated face criteria, not new routes.
- (d) changes the runs table's DOM shape, so `runsTableOrder`, `taskDetailTranscript`, `evidenceLink` and the transcript
  window criteria need deliberate updates (each with a `Ruling:` line, as this repo requires).
- All four change screens a tester has already reported on; each should be confirmed in a real browser, not only jsdom.

## 6. Open questions (these decide what gets built)

1. **Do you want a workspace switcher in the sidebar, or should scope move into Settings altogether?** The feedback's
   own analysis argues the sidebar dropdown is the wrong mental model for an agent tool; the alternative is a project
   name in the top bar with a switcher popover.
2. **Should Settings › This project keep any way to change scope**, or only ever show identity plus a link?
3. **Is a dialog acceptable for import**, or do you want it on its own page/tab ("Plans") beside Tasks?
4. **Should the runs table keep an evidence affordance at all**, given raw evidence is now readable from the CLI?

## 7. Decision (2026-11-08, person approved the recommendations)

Keep one workspace switcher at the top of the sidebar, visibly naming the current workspace and exposing All projects,
search when useful, and the existing project actions. Settings shows only the selected project's identity and a link
that focuses the switcher. Tasks shows an Import button opening a dialog, retaining registration and the Overview entry.
Progress moves label filters into a toolbar and makes the task table collapsible. The runs table removes the raw evidence
column: expanding a run displays its transcript at full width and an evidence entry in that run's details. Keep Web
access to evidence even though CLI can now read its content. Preserve the routes, state and refusal semantics.
