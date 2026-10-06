# Task 6 report: `orca control` CLI

Commit: 66e6b92 `feat(cli): add orca control get and send over the panel socket` (observed at HEAD when committed).

## Implementation
- src/entry/controlCommand.ts: `runControlCommand` exactly as in the brief.
- src/cli.ts: `control` dispatch (dynamic import) before `checkpoint`; USAGE entry after `orca agents show`.
- tests/panel/fixtures/socketPanel.ts: `boot(w, extra, { port: true })` configures the fake-ccloop execution port (ruling P6); the env stays in `w.env` so a spawned CLI sees it. tests/panel/controlSocketGate.test.ts switched mechanically (removed local `configured`, unused imports; assertions unchanged).
- src/panel/controlApi.ts (outside the brief's file list, see concerns): the GET `/api/control/groups/:groupId/commands/:commandId` route called `readVersions` first, which throws `group-not-found` for a repository scope (`@repository:<id>` has no group row). It now looks the result up first and reads versions only on a miss. No URL-encoding needed: the `@`/`:` segment passes the router and the client's SEGMENT regex.
- tests/panel/usage.test.ts: extended with one test for the control USAGE text.

## Tests
- tests/entry/controlCommand.test.ts (3), tests/entry/panelSocketE2e.test.ts (3; C3 also asserts stderr `orca-panel: control socket <realpath>/control.sock` and the socket's removal on SIGTERM, with a SIGKILL in finally; spawned panel has ORCA_CONTROL_DIR, ORCA_CORRECTIONS_DIR, HOME, ORCA_PROJECTS_FILE relocated).
- Deviation from the brief's E2E: the lookup returns the wrapper `{schema:"orca-command-lookup-v1", originalStatus, body}`, so the test compares that wrapper, not the bare body.
- Full run `npx vitest run tests/entry tests/panel`: 58 files, 429 tests passed (before adding the usage test; usage.test.ts alone then passed). `tsc --noEmit` rc=0 (empty output). Outputs in $SCRATCH: t6-all.txt, t6-tsc.txt, t6-usage.txt.

## TDD
- RED (t6-red.txt): controlCommand.test.ts failed to load (module missing); E2E get-summary and C14 failed (exit 1 / empty stdout, `control` unknown).
- GREEN (t6-green.txt): 5/6, the remaining failure was the lookup `group-not-found` above; after the route fix, all green.

## Mutations (clone $SCRATCH/mut-t6, node_modules and web/dist symlinked; baseline 6/6 green)
| Mutation | Red | Restore |
|---|---|---|
| a. `print` writes two `io.write` calls | controlCommand "prints exactly one JSON line" | git diff 0 bytes |
| b. remove --payload/--payload-file exclusivity | controlCommand "names argument errors..." | 0 bytes |
| c. dispatch `"controlX"` | E2E read/send test and C14 | 0 bytes |
| d. revert route fix (readVersions before lookup) | E2E "reads the summary, sends..." (lookup step) | 0 bytes |
Evidence: mut-base/a/b/c/d.txt in $SCRATCH. An earlier mutation pass was invalid (clone lacked web/dist; zsh did not word-split a variable) and was discarded and rerun.

## Concerns
1. src/panel/controlApi.ts edit is outside the listed files; it fixes a real gap (repository-scope results were unlookable). Task 2/3 owner should know. A miss on a repository scope still answers 404 group-not-found rather than command-result-not-found (not addressed).
2. tests/entry/skill.test.ts is untracked in the main worktree (another agent's); not touched or committed.
3. C3 mutation for the stderr assertion was not run separately.
