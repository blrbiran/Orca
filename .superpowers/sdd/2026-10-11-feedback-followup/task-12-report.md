# Task 12 implementation report

Source: `/private/tmp/orca-feedback-followup-task8-20261011`, branch `codex/feedback-followup-task8`, base `9703a92e28e0796fdcb03386b75073d49225ee5d`, product/test commit `b89e3452c3ca9d6609c6c2ffc22cfd7877bfda7f` (`feat(web): simplify execution controls and expose accessible group actions`). The committed tree was clean except the pre-existing untracked `node_modules` symlink. The controller-owned `progress.md`, source main/default pins, old Results 5 WIP, real user data, services, and remotes were untouched. Commit used one-command `core.hooksPath=/dev/null` because Git worktree metadata lives outside the sandbox writable root.

## Product behavior

- Execution controls now use the approved exact English/Chinese names. Pending or unresolved stop facts show Stopping/正在停止; settled facts show Stopped/已停止. Continuable, retryable, and unresolved work have separate counts. Start remains a distinct action from Confirm task plan; no execution flag or command semantics changed.
- Preparation reuses the existing proposal, Agent selection, workspace, integration and budget controls. The review names goal and acceptance criteria, points to effective Agent/role choices and integration, and gives a Global settings destination when Agent resolution blocks confirmation. Requirement acceptance exposes Go to task preparation for its exact group; the group links back to its source requirement/history.
- Group and requirement cards now have a visible More actions button and the same context menu. The card action stays a sibling of the card button/link. Keyboard activation, touch click, Escape/focus return, disabled reason, exact-owner details, archive/unarchive and copy ID are present; there is no delete action. Card archive reads its owner again and uses that current revision before POST. A changed owner is rejected locally; server refusals are displayed at the card or selected detail.
- Advanced Chains are hidden by default via the browser-only `orca.showAdvanced` preference in Global settings. A recognized `#chains` link remains reachable; an active chain keeps a status banner and Stop control visible even when the preference is off. The chain page describes its current Orca-development scope. Existing sidebar project control remains in place; no visual skin rewrite.

## RED/GREEN and test changes

RED logs: `task-12-red.log` (missing menu), `task-12-advanced-red.log`, `task-12-transition-red.log`, `task-12-stop-red.log`, `task-12-menu-pending-red.log`, `task-12-work-categories-red.log`, `task-12-chain-scope-red.log`, `task-12-prereq-red.log`, and `task-12-card-refusal-red.log`. These were behavior failures before the corresponding UI change. The first attempted RED command from the root selected no Web tests; the subsequent Web-directory run is the valid witness. Focused final `task-12-focused-final.log` passed.

The first full Web run (`task-12-web-check.log`, RC 1) had 54 failed/909 passed, largely exact old labels and direct-card selector assumptions. The exact 54 test names, unfiltered, are in `task-12-initial-web-failures-raw.txt`; the exact changed test files are in `task-12-test-changes-raw.txt` (17 files). Old assertions were updated to the approved strings and sibling menu structure. The second full run (`task-12-web-check2.log`, RC 1) had one stale clarifying-card assertion; it now checks the approved visible More actions button. Third run (`task-12-web-check3.log`, RC 0) passed 964/964 before the last focused additions. Final committed-source Web check (`task-12-web-final.log`, RC 0) passed **970/970 tests in 110 files**, with no skips. `git diff --cached --check` and post-commit status confirmed no staged product changes remain.

Four independent `git clone --local --no-hardlinks` clones from `b89e345` were mutated only in their own directories; each targeted assertion failed for the intended behavior (RC 1, no unrelated failures):

| Mutation | Clone | Evidence |
|---|---|---|
| Menu sends `wrong-owner` | `/private/tmp/orca-task12-mutant-menu-owner` | `task-12-mutant-menu-owner.log`: expected `g`, received wrong owner |
| Archive uses stale summary revision 7 rather than fresh 9 | `/private/tmp/orca-task12-mutant-revision` | `task-12-mutant-revision.log`: expected revision 9, received 7 |
| Preparation navigation also sends Start | `/private/tmp/orca-task12-mutant-auto-start` | `task-12-mutant-auto-start.log`: expected no command, observed one |
| Running chain banner filters for stopped state | `/private/tmp/orca-task12-mutant-active-hidden` | `task-12-mutant-active-hidden.log`: active-chain banner not found |

Each mutant run selected one test by name, intentionally skipping the other 9 or 3 tests in that file. The unmutated focused files passed together on the final source.

## Build and command guards

All gate commands redirected `HOME`, `XDG_CONFIG_HOME`, `TMPDIR`, and `CCMEM_DATA_ROOT` under `/private/tmp`, and unset `CCMEM_CONFIG_PATH`. Where needed, `ORCA_CCLOOP_BIN` was the built fixture `/private/tmp/ccloop-feedback-followup-task9-20261011/dist/cli.js` and `ORCA_AGENTS_TABLE` was `/private/tmp/ccloop-task9-formal/agents.json`. No real provider or service was invoked.

| Gate/log | RC and result | Source qualification |
|---|---|---|
| `task-12-typecheck-final.log` | 0 | final product source, before metadata-only commit |
| `task-12-build-final.log` | 0 | final product source, before metadata-only commit |
| `task-12-web-build-final.log` | 0; Vite build with existing 500 kB chunk warning | final product source, before metadata-only commit |
| `task-12-root-focused.log` | 0; 107/107 across archiveGroup, stopIntent, commands and panel controlApi | committed `b89e345` |
| `task-12-verify-ccloop-pin-final.log` | 0; 3/3, no skips | committed `b89e345` |

The first `verify:control` invocation had RC 1 because the required ccloop binary/table variables were absent (`task-12-verify-control.log`). Configured sandbox run had RC 1 with 1388 failures/487 passes/33 skips, predominantly `spawnSync ps EPERM`; raw `task-12-verify-control-configured.log` preserves every result. An unsandboxed configured full run began before the final Web-only source freeze; per controller instruction it was stopped at RC 130 and is **not acceptance evidence** (`task-12-verify-control-escalated.log`). The initial sandbox `verify:scheduler` had RC 1 (47 failures/150 passes/5 skips) because it defaulted to a missing sibling ccloop path; `task-12-verify-scheduler.log` is retained. The initial sandbox `verify:chain` had RC 1 (76 failures/137 passes) from process start-time permission errors and one timeout; `task-12-verify-chain.log` is retained. The first sandbox `verify:ccloop-pin` had RC 1 from tsx local IPC `listen EPERM` (`task-12-verify-ccloop-pin.log`); the final unsandboxed rerun above passed. Full integrated control/scheduler/chain and merged-main gates are reserved for Task 14.

No live authenticated browser/viewport service check was run in this isolated Task 12; final end-to-end browser validation belongs to the controller's integrated gate. The Web tests did exercise keyboard/context menu, exact-owner navigation, stale revision, no auto-start, settings persistence, active hidden-chain banner/Stop, both locales and existing width/focus criteria.

## Independent-review follow-up (2026-10-12)

The five findings in `task-12-independent-review.md` were fixed in a second scoped commit, `8ac8c07cd536335fdfbfabb254a087e982c24425` (`fix(web): preserve card action scope and preparation focus`), on the same branch. This is now the Task 12 source head. The first commit and its evidence above remain preserved.

1. A card archive now captures the project scope and source identity before its awaited group GET, then rechecks both and the current group's repository immediately before POST. A held-GET project-switch App test observes zero POSTs.
2. Go to task preparation now sets an exact group Preparation focus request. App tests verify the selected Preparation tab for both an already mounted group and a newly ready group. Neither path confirms or starts work.
3. An enabled Archive reaches the authoritative ledger after its fresh owner/revision read. Estimate `start-unknown` and resolving integration tests observe a POST and the server's named refusal at the card, instead of a silent client return.
4. Unresolved work now counts distinct affected task/run identities from unknown runs, start-unknown work items and run-scoped blockers. A group blocker does not add a work item; a run plus its blocker counts once.
5. Repeated More actions buttons have per-card accessible descriptions (`Group <id>` / `任务组 <id>`) while the approved visible control text remains. The menu handles ArrowUp/ArrowDown/Home/End across enabled items and Escape returns focus to the trigger.

`task-12-review-red.log` (RC 1) records six behavior failures before the fix; exact names are in `task-12-review-red-names.txt`. After the RED run, the newly-ready Preparation case was strengthened from `draft` to `ready`; its own RED sensitivity is demonstrated by the clone mutation below rather than relabeling the original RED run. `task-12-review-focused-green.log` (RC 0) passed 21/21 at the first GREEN point. Final `task-12-review-web-final.log` (RC 0) passed **977/977 tests in 110 files**, no skips, on the exact product tree committed as `8ac8c07`. `task-12-review-typecheck.log`, `task-12-review-build.log`, and `task-12-review-web-build.log` all had RC 0 on the same tree. `task-12-review-root-focused.log` (RC 0) passed **107/107** archiveGroup/stopIntent/commands/panel controlApi criteria on the same tree. `git diff --cached --check` passed before the one-command empty-hook commit; post-commit status had only the pre-existing untracked `node_modules` symlink. No package pin, domain command, main/default branch, previous Results 5 WIP, real service/data, or remote changed.

Six further independent `git clone --local --no-hardlinks` clones of `8ac8c07` were mutated only in `/private/tmp`; every targeted test failed for the intended assertion (RC 1). Their targeted `-t` runs intentionally skipped unrelated tests in that one file:

| Deleted/altered behavior | Clone | Raw evidence |
|---|---|---|
| Omit scope/source recheck after awaited GET | `/private/tmp/orca-task12-review-mutant-scope` | `task-12-review-mutant-scope.log`: late old-scope POST observed |
| Add automatic Start to preparation transition | `/private/tmp/orca-task12-review-mutant-autostart` | `task-12-review-mutant-autostart.log`: unexpected command observed |
| Remove per-card trigger description | `/private/tmp/orca-task12-review-mutant-menu` | `task-12-review-mutant-menu.log`: missing owner association |
| Restore double-counting of blockers and unknown runs | `/private/tmp/orca-task12-review-mutant-count` | `task-12-review-mutant-count.log`: 3 rather than 1 |
| Restore silent estimate guard return | `/private/tmp/orca-task12-review-mutant-archive` | `task-12-review-mutant-archive.log`: no archive POST |
| Remove Preparation focus request | `/private/tmp/orca-task12-review-mutant-preparation` | `task-12-review-mutant-preparation.log`: newly ready group remains on Progress |

The follow-up changes only seven Web source/test files. The full integrated control/scheduler/chain and live authenticated viewport gates remain Task 14 responsibilities, as directed by the controller.
