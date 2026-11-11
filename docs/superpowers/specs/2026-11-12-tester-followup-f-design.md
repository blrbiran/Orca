# Tester follow-up F: rulings and design

Date: 2026-11-12. Owner: Orca session `5abcad7d` (controller), on main after
`docs(handoff): Orca is repinned to ccloop's #249; what is left to push`.
Evidence: the tester's report `orca_archived_files/issue-20261023.md` (unchanged since round E) and three read-only
triage passes over current code, summarised in `.superpowers/sdd/2026-11-12-tester-followup-f/progress.md`.

## 0. Human rulings (verbatim; context in the ledger)

- Scope: 「需要你多做一些task…但是这次我们不做需要brainstorm的部分。」
- #195 and #116, both overturning earlier rulings: 「要改」.
- #81, folding low-frequency features off main paths: 「要收起来」.

Each section names the earlier text it overrides; that spec gets a dated correction section appended, original text
untouched (Rule 13).

## 1. W1 — a context threshold nothing enforces is not required (#195)

Fact (main, 2026-11-12): `acceptContextObservation` (`src/control/contextControl.ts`) has no production caller; no
agent kind under the real ccloop yields a context observation. Yet confirm refuses a null
`contextPolicy.handoffAtContextTokens` when the worker declares a window (`webService.ts` ~2163), and auto-confirm
fills it with the window (~863). The operator is forced to choose a number that does nothing.

Overrides the ruling recorded in handoff §5.2.8 ("add an explicit off value when ccloop can observe context, do not
relax `null`") and whatever spec text pins the confirm refusal (seat locates it and appends the correction).

- Confirm accepts `handoffAtContextTokens: null` whatever the worker's window. A non-null value is still validated
  as today (bounded by the frozen worker window, #203).
- Auto-confirm no longer invents a value: it keeps the proposal's value (null stays null).
- CLI `group confirm` / `proposal show` and the Web budget editor state plainly that context hand-off is not active
  because no installed agent reports context usage; the field becomes optional, not removed.
- If anything downstream needs the threshold non-null (handoff control, dispatch policy, ccloop contract), the seat
  stops and reports instead of changing it.

## 2. W2 — a finite group can settle unknown usage at the observed floor (#116)

Today a run (or single call) with unknown usage in a group with a finite token limit can only be settled by charging
the whole remaining grant (`charge-remaining-grant`) or, when ccloop proved zero, `release-known-zero`. Groups without a
token limit settle automatically at ccloop's observed floor, marked approximate (`softLoopSettlement.ts`; spec
`2026-11-06-soft-mode-loop-run-settlement-design.md`, `2026-11-03-soft-mode-approximate-usage-design.md` §7).

Overrides: "finite groups and flow calls stop as before" (soft-mode specs) for finite groups; flow calls unchanged.

- New acknowledgement `charge-observed-floor` for `orca task settle-usage` and for single calls'
  `orca recovery retry --acknowledge …`, where the single-call path has a floor. Admitted when the remainder is finite
  and a floor is known from the same source the soft path uses; refused `observed-floor-unknown` otherwise (the
  operator falls back to `charge-remaining-grant`). Not for unlimited remainders (their forms are unchanged).
- Charges the floor, marks the usage approximate exactly as the soft path does (same marker shape; new
  `method: "observed-floor"`), principal as for `charge-remaining-grant` (person or `agent:<client>`). Open to socket
  agents without a person token; refused to runs Orca dispatched itself, like the existing forms.
- Explicit, not automatic (ledger C3). Web: offered next to the existing settle action with the floor shown.
- Not a new verb; still: access matrix, refusal coverage, CLI help/docs (`npm run gen:cli-docs`) and the orca-control
  skill get the new value.

## 3. W3 — Web: fold low-frequency controls; members; no agent (#81, D21)

Read `web/DESIGN.md` first; one primary button per view stays.

- Overview: "Import plan" leaves the row beside "New requirement" (secondary menu or link).
- Group header: "Save plan to library" and "Schedule this group…" move into the group's "…" menu.
- New-requirement form: token limit and content language fold into a closed "Options" disclosure. The effective
  agent + model summary (#220) stays visible; its picker may live inside the disclosure.
- Split draft: "Save split" moves into a secondary menu.
- Board: "Start a flow" stops being the Board's primary button.
- D21: the project Add / Rename / Multi-folder controls are hidden for a member (the server keeps refusing).
- No installed agent: the new-requirement form says so before submit and links to Settings → Agents.

## 4. W4 — CLI/Web clarity (#183, #173, #162, empty-result)

- #183: `run results` human output no longer prints `results: available` above `recoverable: no`; the first line says
  what is available (the task's explanation) apart from recoverability. `--json` gains the recoverability fields
  (only-add).
- #173: the "estimator instruction is not the newest" warning also reaches `--json` (only-add) and the Web (where the
  estimate is shown).
- #162: applying an estimate in a finite group never sets `attempts` below 2.
- `empty-result`: CLI and Web explain in plain words that the attempt changed nothing and what the operator can do
  today (retry with the contract's checks deciding the goal / edit the task); no new exit is designed here.

## 5. W5 — criteria for round E's unwitnessed spots (#241, #245)

Add criteria (and fix only what they prove broken) for: post-merge check `no-required-checks` / `no-task` reasons; the
acceptance Web component's place and tab count in `ControlGroupView`; the acceptance pass's stop guard; abort when the
tip moves during the check.

## 6. W6 — transcript calls carry their start time (#252)

- ccloop: the transcript call listing emits `startedAt` (ISO-8601, the call's spawn time) per call when known; additive.
- Orca: accepts the optional field (absent on older ccloop), orders calls by it when present within an attempt
  (fallback: today's attempt → phase → seq order), and shows it per call in the transcript list.
- The ccloop change must be pushed by the human before Orca can repin; Orca's side lands first and is inert until then.

## 7. Out of scope (need design; ledger C1)

Requirement-criteria review run (P0-1); an exit for `empty-result`; a plan-phase budget (#196/#224); early claim after
landing (#192); a generic "allow this decision" (#189); calibrating the judge grant (#174); #243.
