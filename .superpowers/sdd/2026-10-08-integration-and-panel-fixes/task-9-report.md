# Tasks 9 and 11 report

Worktree `/Users/biran/code/skills/loop/Orca-integration`, branch `feat/integration-schemes`. progress.md untouched (its pre-existing modification was not committed).

## Task 9 - Memory split layout
Commit baefed0 `feat(web): show a memory's detail beside the list`.
- `web/src/MemoryView.tsx`: list nav now in `.split > .split-list`; the detail (and the "select" placeholder) in `.split-detail` (ref); a `useEffect` on `record` calls `scrollIntoView({block:"nearest"})` when a record is opened. No CSS change (classes exist, `.split` stacks at the existing narrow breakpoint).
- Test `web/tests/memoryLayout.test.tsx` (2 tests): structure; scrollIntoView stubbed, called once on selection, not before, on an element inside `.split-detail`.
- RED evidence: `$S/t9-red.txt` (both new files, 6/6 failed before implementation); green `$S/t9-green.txt`.

## Task 11 - Agents folded by default
Commit 4965147 `feat(web): fold the Agents section by default`.
- `web/src/AgentSettings.tsx`: whole section wrapped in `<details open={open}>` with `<summary><h3>`; initial state from `localStorage["orca.panel.agentsOpen"]==="1"` (try/catch, false on throw); `onToggle` writes "1"/"0" (try/catch). Wrapping lives in AgentSettings so ControlPanel needs no change. No new i18n strings (reuses `agents.title`).
- Test `web/tests/agentsCollapsed.test.tsx` (4 tests): collapsed on first render; toggle writes "1" and a fresh render is open; folding writes "0"; throwing getItem/setItem still renders collapsed and toggle does not throw.

## Verification
- `npm run --ws check` rc=0 (78 files, 571 tests), `npm run typecheck` rc=0, full web vitest rc=0 (`$S/t9-check.txt`, `t9-tc.txt`, `t9-web.txt`).
- Rewrite inventory: none. No existing test needed changing (closed `<details>` content stays in the DOM).

## Mutations (clone `$S/mut-t9/c`, node_modules symlinked; outputs `$S/mut-m*.txt`)
| id | mutation | test | red assertion | restore diff / cached bytes |
|---|---|---|---|---|
| m1 | `split-detail` class renamed (detail outside it) | memoryLayout (both) | "expected null not to be null" | 0 / 0 |
| m2 | scrollIntoView call removed | memoryLayout scroll test | expected vi.fn() called 1 times, got 0 | 0 / 0 |
| m3 | default `useState(true)` (open) | agentsCollapsed first-render + throwing-storage | expected true to be false | 0 / 0 |
| m4 | stored state ignored `useState(false)` | agentsCollapsed read-back | expected false to be true | 0 / 0 |
| m5 | read try/catch removed | agentsCollapsed throwing-storage | Error: denied | 0 / 0 |

## Concerns
- `onToggle` also fires when React sets `open` on mount in some browsers; writing the already-stored value is harmless.
- Commit trailer uses the brief's "Claude Opus 5.5" line per common.md.

## Fix round 1 (Task 11, finding I1) - commit 8481970
- `agentsCollapsed.test.tsx` throwing-storage test now captures window "error" events and `console.error` during the toggle (jsdom reports listener exceptions there instead of rethrowing), asserts none, and asserts `details.open` is still true. The old `not.toThrow` is gone.
- Minor: inline `style` on the summary h3 replaced with class `agents-summary` in `web/src/styles.css`.
- `npm run --ws check` rc=0, `npm run typecheck` rc=0.
- Mutations (clone `$S/mut-t11f/c`, outputs `$S/mutf-*.txt`):
| id | mutation | test | red assertion | restore diff / cached |
|---|---|---|---|---|
| w1 | `writeOpen` try/catch removed | throwing-storage | expected [ Error: denied ] to deeply equal [] | 0 / 0 |
| w2 | `writeOpen` writes constant "1" | "stores 0 when folded again" | expected '1' to be '0' | 0 / 0 |
