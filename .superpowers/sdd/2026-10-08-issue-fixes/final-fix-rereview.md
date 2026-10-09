# Re-review of the final fix wave (11027ab..75ec937), read-only

Reviewer: subagent of session 3156185d, 2026-10-09. Read the fix diff, src/control/archiveGroup.ts, src/control/stopIntent.ts,
src/panel/controlViews.ts. Ran `git diff 11027ab HEAD -- docs`; I did not rerun the test suites.

| Finding | Verdict | Where |
|---|---|---|
| M1 | ADDRESSED | web/src/runFacts.ts:44-53 (archiveOpen), web/src/ControlGroupView.tsx:~374 |
| M2 | ADDRESSED | web/src/locales/en.ts:62, zh.ts:162 |
| M4 | ADDRESSED | web/src/locales/en.ts:858, zh.ts:796 |
| M8 | ADDRESSED | en.ts:859, zh.ts:797 (`{{detail}}` removed) |
| A5+A6-1 | ADDRESSED | web/src/App.tsx:365-370 |
| M7 | ADDRESSED | docs numstat 13/0 and 13/0; `grep -c '^-[^-]'` on the docs diff = 0 |
| E8 | ADDRESSED | web/src/GroupList.tsx:29-35 (<120 min: minutes, <48 h: hours, else days), en/zh keys present |

## M1 against the server guards (the focus)
Server order (archiveGroup.ts refuseArchive): estimate running/start-unknown; clarifying + pending requirement call; stop intent
with mode != pause and derived state not in {handoff-complete, handoff-partial}; integration resolving; any run active=1.
Client archiveOpen: the same four checks, the same sets, the pause exemption included. The requirement guard has no counterpart,
and that is exact: a clarifying group has no group view (refuseClarifying). The run set is exact because runViews refuses a view
whose active flag disagrees with the terminal-state set (controlViews.ts:~740). Estimate states and integration come from the
same readers as the server's. No case found where the button is hidden but the server accepts, or shown but it refuses.
Residual (Minor, not a new break): the client reads the STORED stop state (view.stop.state), the server the DERIVED one
(deriveStopState). The stored state is rewritten at the settle points (stopIntent.ts:741, :876), so they differ only transiently.
In that window the button would be hidden for a moment where the server would accept. Using a derived value would need a server change.

## Other checks
- M2 partial banner now names Archive; handoff-unresolved left alone as allowed. Server accepts archive at handoff-partial (E4 ruling).
- M4 text names "Resume dispatch", which is the real label (en.ts:286, zh.ts:186).
- A5: found + originalStatus>=400 dispatches the refusal at `place` (import form for imports); import still returns before reading
  the group. The requirement-verb gap is a stated, accepted concern.
- M7 facts: 585fb72 and 6a88636 exist, are ancestors of HEAD, and their subjects match the quoted ones. The corrections say
  "kept verbatim" and the originals are untouched.
- Two rewritten tests: archiveGroup "offers no editor..." baseline > 10 becomes >= 10. That is a consequence of M1 (the fixture's blocked run is
  active, so Archive drops out) and the test still pins what it pinned. failureReasons: two `{{detail}}` expectations were removed and the
  opposite is now pinned by a new test (not a read-back before the call). Both follow from ordered fixes (progress.md final-fix ruling at :236).

## New Critical/Important in the fix diff
None.
