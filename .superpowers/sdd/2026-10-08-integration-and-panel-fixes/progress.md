# Integration schemes and panel fixes — progress ledger

Session eaee0f2c (2026-10-08). Branch `feat/integration-schemes`, stacked on `deps/usage-by-model-pin`
(subjects `chore(deps): repin ccloop to report usage per model`, `fix(auth): end every session of the user on a password change, this one too`).
Spec: `docs/superpowers/specs/2026-10-08-integration-and-panel-fixes-design.md`. Plan: `docs/superpowers/plans/2026-10-08-integration-and-panel-fixes.md`.
Authority: the human authorized the whole round on 2026-10-08 ("先按你的建议执行（不要再找我）… 最后阶段报给我审核"),
including subagent review of the spec and subagent-driven execution. Append only.

## Human decisions (conversation, 2026-10-08)
- H1–H6 as in spec §2.
- Password change: a successful change ends every session of the user, this one too; a wrong password ends none and only
  counts toward the per-name throttle (kept). Implemented on `deps/usage-by-model-pin` (subject above).

## Spec review (independent subagent, 2026-10-08)
2 Critical (C1 squash/rebase resolution shape; C2 run-shaped reconciliation), 13 Important, 15 Minor.
Ruling: R1–R8 in spec §12; every other finding adopted. Spec revised in subject `docs(spec): revise the integration design after an independent review`.

## Tasks

## Pre-flight scan (controller, before Task 1)
| rows | produces / consumes | found |
|---|---|---|
| T1↔T2 | T1 `integrationSchemeSchema`, `readIntegrationDefault`, `checkScheme`, `githubRepoOf`; T2 consumes them for the group copy and preflight | consistent |
| T2↔T3/T5/T6 | `GroupIntegration` (incl. `transient`, `pending`, `conflict`, `resolution`) | consistent after the plan self-review added `transient` to T2 |
| T3↔T4 | `runChild`, pass step 5 → `syncGroupPr` | consistent |
| T3↔T5 | `IntegrationCrashPoint` names | consistent |
| T1/T4 | GitHub identity read: T4 says raw `git config --get remote.<r>.url`; T1 `checkScheme` same | consistent |
| T1/T2/T3/T6 ↔ T7 | four verbs, routes, view `integration.schemeHash` | consistent |
| T7↔T10 | both may touch the confirm step / BudgetEditor; serial order T7 then T10 | no conflict |
| T2 own text | "authority hash equals a constant captured from main" is vague | Ruling: the test computes `authorityCommandHash` for a keep-group confirm without the field and asserts it equals the hash the ledger's own hashing function gives the same payload object (absent key adds no bytes) — cost if wrong: a weaker pin than a captured constant |
| T3 own text | test 8 uses `ext::` transport | Ruling: allowed only via the test repo's local config (`protocol.ext.allow=always`); if git refuses it, a fake remote via `GIT_SSH_COMMAND` pointing at a sleeping script is used instead — cost if wrong: none to product |
| T6 own text | needs ccloop world; skip when `ORCA_CCLOOP_BIN` unset | consistent with existing E2Es |
| others | each task's tests match its code | clean |
Task 1: dispatched (base 3ed8447, implementer opus)
Task 1: implementer DONE_WITH_CONCERNS (commits e018413, 9c36d72; report task-1-report.md)
Ruling: run `git check-ref-format --branch <name>` without `--` — git 2.50.1 exits 129 on `--`, and the regex already refuses a leading `-` — cost if wrong: none while the regex stays in front of it.
Ruling: the `@{` clause is dropped from the branch check — the character class never admits `@` or `{`, so the clause is dead and no mutation could see it red — cost if wrong: none.
Ruling: no server-side target default in the setter; the payload carries an explicit `target`. Task 7 adds `suggestedTarget` (remote HEAD branch, else current branch, else null) to `GET /api/control/repositories/:id/integration` for the UI to pre-fill — cost if wrong: a client without the UI must name the target itself.
Ruling: `integrationSchemeSchema` lives in webProtocol.ts and is re-exported (import cycle) — cost if wrong: none.
Task 1: review Approved (no Critical/Important). Mutation table M1-1..M1-21 (all red, restores 0/0): see task-1-report.md (committed with the ledger).
Ruling: remote existence and the GitHub identity are read with `git config --get remote.<r>.url` (raw value, before `insteadOf`), not `git remote get-url` as spec §3.3 says — the plan's Task 4 needs the raw value so criteria can redirect transport to a local bare repo while Orca still sees the GitHub URL — cost if wrong: a remote defined only through `url.*.insteadOf` without `remote.<r>.url` is reported missing. Spec correction recorded at the round's end (§13).
Ruling: no server-side `remote` default either; the UI (Task 7) pre-fills `origin` — cost if wrong: an API client must name the remote.
Task 1: minor (deferred → Task 2): no criterion/mutation for the `knownRepository` guard before `checkScheme` (webService.ts:579); Task 2 adds the unknown-repository POST test and its mutation.
Task 1: minor (deferred → Task 3): `checkScheme` reports a git spawn failure/timeout as a name/remote check failure; Task 3's runner distinguishes them.
Task 1: minor (deferred → Task 7): SKILL.md `get` list lacks `repositories/<id>/integration`.
Task 1: minor (deferred): the workspace GET field pick has no red-able criterion (defensive only).
Task 1: minor (deferred → Task 3): admission gate held across up to three 10 s git children in the setter.
Task 1: complete (commits 3ed8447..9c36d72, review clean)
Task 2: dispatched (base 9c36d72, implementer opus)
Task 2: implementer DONE_WITH_CONCERNS (commit 5fc4870; report task-2-report.md; copy point `writeImportedPlan`, shared by import-plan and requirement-draft-accept)
Ruling: a post-start `set-group-integration` runs only `checkScheme`, not the confirm preflight (spec §3.3 lists preflight for confirm) — a missing target then surfaces as `blocked integration-target-missing` at the next integration — cost if wrong: the owner learns of a bad target one round later.
Ruling: accepted the additions (scheme change resets `retryAfter`/`transient`; reopening the proposal unfreezes the copy; a clarifying group is refused `group-state-invalid`) — each follows from the spec's freeze-at-confirm rule and is mutated red — cost if wrong: small, reversible.
Ruling: import now reads the repository settings body; an unparseable body blocks that repository's import as it already blocks its runs at A1 — cost if wrong: none new.
Note: mutation clones may symlink the worktree's node_modules (npm ci over ssh for the ccloop git dependency hung > 30 min in a clone).
Task 2: review Approved (no Critical/Important; named risks: confirm/preflight race covered by the group revision CAS, agent keep-confirm unchanged, keep body/view byte-identical). Mutations M2-1..M2-29 in task-2-report.md.
Task 2: minor (deferred → Task 3): preflight/setter children use 10 s, not `ORCA_INTEGRATION_TIMEOUT_MS` (60 s default); move onto the shared runner.
Task 2: minor (deferred → Task 3): `repositoryPath` plain Error / `resolveRepository` refusal and `githubRepoOf(...)!` TOCTOU before the transaction are unbooked 500s; map to named `integration-preflight-failed:<check>`.
Task 2: minor (deferred → Task 3): test title at integrationScheme.test.ts:1149 claims an unfrozen case it does not assert; rename.
Task 2: minor (deferred → Task 7): SKILL.md row order; web/src/controlApi.ts group integration helper.
Ruling: `set-group-integration` on a completed group stays allowed — trigger `task` after `continue-task` and Retry flows need it; spec §3.1 does not restrict it — cost if wrong: an owner can change a finished group's scheme, which only matters if it runs again.
Task 2: complete (commits 9c36d72..5fc4870, review clean)
Task 3: dispatched (base 5fc4870, implementer opus)
Task 3: attempt 1 BLOCKED — incident: the implementer's scratch git experiment ran in the main checkout (a failed `cd` chained with `;`): local main gained two junk commits (`base` 270de58, `main` 7ce8db2, file `f` only) and a branch `side` (9a73583). Not pushed (remote main = df3f577, ls-remote). The repair (`git reset --keep 254371c && git branch -D side` in the main checkout) is Tier 0 — the gate refused it — so it is the human's; a terminal notification was sent. common.md gained absolute-path git rules. No Task 3 code was written.
Task 3: facts from attempt 1 — person pause = `stop_intents` row mode "pause" (read by `groupStopped`); budget block = `group.status === "blocked"` (usage.ts:40) ⇒ due check uses `groupStopped` only; group complete = every `work_items` kind "task" status "done" and no `runs` row for the group with active=1; a pre-receive hook cannot produce "[rejected] (fetch first)" ⇒ use a `beforePublish` test seam (style of `beforeCas`); `runChild` must spawn detached and kill the process group on timeout.
Ruling: accepted the `beforePublish` seam for the "target moved between fetch and push" case — the push protocol cannot be made to say "fetch first" from a hook — cost if wrong: the moved-path test exercises the seam, not a real race.
Task 3: dispatched attempt 2 (base 5fc4870, implementer opus)
Task 3: implementer DONE_WITH_CONCERNS (commits 03aefc3, 18034e5, 7ac5e94; report task-3-report.md; 53 mutations red). TDD order not kept (code before tests; RED shown against base source in a clone).
Ruling: no `ls-remote` check before pushing `orca/<g>` (spec §6.1 step 4) — an up-to-date push is accepted by git and the write-ahead re-entry covers a crash; the check had no criterion that could see it — cost if wrong: one extra no-op push per re-entry.
Ruling: `retry-integration` keeps the `conflict` record so attempt numbers keep counting — conflict refs stay unique per attempt — cost if wrong: none.
Ruling (provisional, reviewer to weigh): an auth / non-network remote failure is recorded as `integration-remote-missing`.
Ruling: confirm's preflight stays inside the admission gate (moving it out broke an agentFreeze criterion); only the two setters run git checks outside the gate — cost if wrong: a slow remote can delay a drain by up to the runner timeout per confirm.
Note: re-entry and `after-publish` crash are tested in Task 5.
Task 3: review Needs fixes — I1 `worktree prune` touches the person's worktree records (+ duplicates `removeOwnPath`); I2 inconsistent remote-failure classification; I3 plan-mandated `unable to access` pattern makes HTTPS 401/403 transient forever.
Ruling (replaces the provisional one): `integration-remote-missing` only when `remote.<r>.url` is not configured; every other non-network failure on fetch, ls-remote or push ⇒ `blocked integration-push-refused:<git's words>` — spec §6.5 lists permission under push-refused, and "remote missing" sends the person to the wrong fix — cost if wrong: none.
Ruling (plan defect I3): the network pattern for `unable to access` is narrowed to resolve/connect/timeout/refused causes; HTTP 401/403 are permanent (`integration-push-refused`) — cost if wrong: a flaky proxy answering 403 blocks instead of retrying; Retry clears it.
Ruling: fold two minors into the fix round — the test `g` helper clears `GIT_*` and sets `core.hooksPath=/dev/null` (incident class), and a remote that timed out this round is skipped for the rest of the round (bounds the stall to one timeout per remote per round) — cost if wrong: a group on a slow-but-alive shared remote waits one more round.
Task 3: fix round 1/5 implementer done (commit 718eeb7; reconciling runs are active=1, groupComplete unchanged)
Task 3: fix round 1/5 (5 addressed, 0 open — I1 prune removed, I2 classification, I3 403 permanent, M1 per-round unreachable remote skip, M3 test env; commits 7ac5e94..718eeb7). Mutations F1-1..F1-6 red.
Task 3: minor (deferred): `integration-push-refused:` has an empty suffix when git writes nothing to stderr.
Task 3: minor (deferred): every frozen idle group costs one `rev-parse` per round forever; `refs/orca/integration/<g>/*` never deleted; detached children orphaned if Orca dies mid-child; `git status` may refresh the person's index stat cache (`--no-optional-locks` would avoid it).
Task 3: process note: code written before tests in attempt 2 (RED shown against base src in a clone).
Task 3: complete (commits 5fc4870..718eeb7, review clean after 1 fix round)
Task 4: dispatched (base 718eeb7, implementer sonnet)
Task 4: correction — implementer dispatched on opus, not sonnet as the line above says
Task 4: implementer DONE (commits e11fc54, 3519737; report task-4-report.md; 28 mutations red)
Ruling: a `github-pr` group with `pr === null` and landed work is due even when `tip == lastIntegrated` (a group switched to github-pr after integrating elsewhere opens its PR at once instead of at the next landing) — spec §5 is silent; H2 wants the PR to exist — cost if wrong: one extra `gh pr list` per such group. To be implemented in Task 4's fix round.
Ruling: accepted additions — `gh auth status` on every PR sync (names `integration-gh-unavailable` before a confusing failure), PR body counts tasks done, a remote re-pointed off GitHub blocks `integration-pr-refused` — cost if wrong: one extra gh child per sync.
Task 4: review Approved (no Critical/Important; injection, one-PR-per-group across re-entry, single guarded write all hold).
Ruling: `set-group-integration` clears `pr` (and `pr.ready`) when `delivery`, `target` or `remote` changes — a PR into the old base must not be `pr view`ed / readied as the group's — cost if wrong: an unchanged PR is re-found by `pr list` anyway.
Ruling: fold into a fix round with the `pr === null` due rule: (M1) unreachable-remote marking only for git children; (M2) `pr list` also reads `headRepositoryOwner` and only records a PR whose head owner equals the slug owner; (M3) empty first line of the goal ⇒ title `orca/<g>` — cost if wrong: none.
Task 4: minor (deferred): JSON/parse errors from gh treated as transient forever; `prBody` reads work_items directly; ready-only due rule not restricted to trigger task (harmless).
Task 4: fix round 1/5 implementer done (commits 50826ec, 0267b08; F1-1..F1-7 red)
Task 4: fix round 1/5 (5 addressed, 0 open — R1 pr-null due, R2 clear pr on delivery/target/remote change, M1 git-only unreachable, M2 head owner, M3 empty title; commits 3519737..0267b08)
Task 4: minor (deferred → Task 5): head-owner comparison is case-sensitive; GitHub logins are not — lowercase both sides.
Task 4: complete (commits 718eeb7..0267b08, review clean after 1 fix round)
Task 5: dispatched (base 0267b08, implementer opus)
Task 5: implementer DONE (commits 63cfb3c, d87e906; report task-5-report.md; 16 crash criteria; real bug fixed: a merge delivery crashed after-publish was never settled because the due rule skipped a target that already holds the tip — a write-ahead record of the current scheme now always gets its re-entry; 10 mutations red)
Task 5: review Approved (named risk: the re-entry relaxation sits behind idle/frozen/retryAfter/groupStopped gates and terminates on every path).
Task 5: minor (deferred → final fix wave): case-insensitive owner test pins only the login side (add remote `O/r` + login `o`); no criterion for a pending record whose target holds neither `pending.new` nor tip settling in one pass, nor for a paused group with a pending record; `reentry()` comment overstates ("always finished"); re-entry "contains" untested for push-branch/github-pr.
Task 5: complete (commits 0267b08..d87e906, review clean)
Task 6: dispatched (base d87e906, implementer opus)
Ruling: a conflict that merges cleanly when re-run in the copy is state `conflict` with reason `integration-conflict-unreproducible` (Retry recomputes) — mirrors materialiseConflict's refusal — cost if wrong: a transient object-store disagreement needs one Retry.
Task 6: implementer DONE (commits 46e6a3e, f2cf667; report task-6-report.md; 39 mutations red)
Ruling: `integration-no-checks` counts blank checks as none (confirmed contracts require ≥1 requiredCheck, so only blank strings can reach it) — cost if wrong: the branch is nearly unreachable, harmless.
Ruling: an orphaned integration resolution run is re-spawned (spec §7) where the landing reconciliation blocks one — the resolution was approved by an owner and an affordability check runs again first — cost if wrong: one extra paid run after a crash.
Ruling: the resolving step ignores retryAfter and a person's pause/stop, as stepR does for landing reconciliations (a stop never kills a running resolution, spec §7) — cost if wrong: a paused group's approved resolution still finishes.
Note: the Rule 6 figures the subagents quote are the controller session's context level reported by a shared hook, not theirs.
Task 6: review Approved (named risks clean; the reviewer's own mutation saw the "no dispatch" assertion red at integrationResolve.test.ts:145).
Ruling: Minor 3 (blocked/conflict/discarded settles keep a stale `resolution`) and Minor 4 (a `runTask` rejection during driver stop goes to `conflict`, against spec §7 "collected after restart") are load-bearing — Task 7 shows the record, and §7 is explicit — fixed in a round now — cost if wrong: one extra fix round.
Task 6: minor (deferred): real-ccloop "no dispatch" check is timing-based (deterministic stand-in carries it); orphan re-spawn drops the earlier spawn's spend (per the re-spawn ruling).
Note: the controller's second checkpoint (717306a) landed on main on top of the incident's junk commits. Repair is now: in the main checkout, `git rebase --onto 254371c 7ce8db2 main && git branch -D side` (keeps the checkpoint commit, drops base/main junk). No further checkpoint writes until the human repairs main.
Task 6: fix round 1/5 implementer done (commit fab1764; F1-1, F2-1 red)
Note: session context passed T2 (450k, tool-reported 450016) at Task 6 fix round; continuing under the human's explicit instruction for this round ('暂时不要考虑context大小'); checkpoint written.
Task 6: fix round 1/5 (3 addressed, 0 open — stale resolution cleared on blocked, stop guard restored, real-ccloop no-dispatch check strengthened; commits f2cf667..fab1764)
Task 6: complete (commits d87e906..fab1764, review clean after 1 fix round)
Task 7: dispatched (base fab1764, implementer opus)
Task 7: implementer DONE_WITH_CONCERNS (commits 3f81edd, cac9c07, 2516fad; report task-7-report.md; 42 mutations red)
Ruling: a started group's scheme must be editable in the UI (H3 allows it; §6.5 names "change scheme" as the recovery for several blocks) — the same editor as the confirm step, shown in the group detail outside the Git section (board spec C4 keeps the Git section button-free) — to be done in Task 7's fix round — cost if wrong: one more panel control.
Ruling: a member's Confirm is disabled on a non-keep group with the owner-only note, rather than sent and refused — cost if wrong: none (the server still refuses).
Task 7: review Approved (keep payload/Git area unchanged, server-provided hash only, C4 green for keep, zh enforced by type).
Task 7: fix round 1 scheduled: post-start scheme editing (ruling above); late suggestion applied while target untouched (Minor 1); board-spec correction also names C4 (Minor 2, appended); reason texts for Task 6's `integration-markers-remaining`, `integration-resolution-spawn`, `integration-resolution-terminal` (controller check of server codes).
Task 7: minor (deferred): `mayLimit` reused for the integration permission; two git children per integration GET (count under the parallelism goal); zh "Pull request" label left in English.
Task 7: fix round 1/5 implementer done (commit 251801a; F4 needed no change)
Task 7: fix round 1/5 (4 addressed, 0 open — post-start editor outside the Git section, late suggestion, C4 correction appended, reason texts present; commits 2516fad..251801a)
Task 7: complete (commits fab1764..251801a, review clean after 1 fix round)
Ruling: Tasks 9 and 11 (single-component layout fixes) go to one implementer as one dispatch with two commits; Tasks 8 and 10 are dispatched alone — cost if wrong: one review covers two small diffs.
Task 8: dispatched (base 251801a, implementer sonnet)
Task 8: implementer DONE (commits 1b4080b, f9ac4d9; report task-8-report.md; 9 mutations red)
Ruling: Unreviewed keeps reading /api/todo; /api/decisions is fetched only for Reviewed/All and after a recorded review — keeps the sidebar badge and existing criteria meaningful — cost if wrong: one more request when switching filters.
Ruling: Reviewed and All get their own empty-list sentence (the todo sentence would be false there) — cost if wrong: none.
Task 9+11: dispatched together (base f9ac4d9, implementer sonnet) while Task 8 is in review (read-only; disjoint files)
Task 8: review Approved (listing records nothing; correction from Reviewed refetches list and metrics; /api/todo byte-identical).
Task 8: minor (deferred → final fix wave, user-visible): title/lede still say "Unreviewed high-tier decisions" under Reviewed/All; a brief "No decisions in this status" flash before the first fetch (render loading while allRows is null).
Task 8: minor (deferred): the page-level already-recorded test mocks the 409.
Task 8: complete (commits 251801a..f9ac4d9, review clean)
Task 9+11: implementer DONE (commits baefed0, 4965147; report task-9-report.md; 5 mutations red; no rewrites)
Task 10: dispatched (base 4965147, implementer sonnet) while Task 9+11 is in review
Task 9+11: review Needs fixes — Important: the `writeOpen` try/catch test (`expect(...).not.toThrow()`) cannot go red; no mutation of the write catch seen red (Rule 9). Fix round 1 queued until Task 10's implementer finishes (one committer at a time in the worktree).
Task 9+11: minor (deferred): no named mutation for the "stores 0" test; inline style on the summary h3; un-reindented JSX.
Task 10: implementer DONE (commits ace2c15, d55aafc, b2fe242; report task-10-report.md; M1-M18 red; 6 web tests rewritten, listed in the report)
Ruling: accepted `TokenInput` `value=null` + `onInvalid` — parents hold Save/Set/Submit while the text is invalid, instead of silently sending the last valid number — cost if wrong: none.
Ruling: clearing a budget token field shows the field error rather than snapping back — consistent with "refused before sending" — cost if wrong: none.
Task 10: minor (deferred → final fix wave): the magnitude hint renders inside the group-limit label ("token约 900 万").
Task 10: review Needs fixes — I1 error flag and field text can come apart (Requirements `limitBad` after an external value change; BudgetEditor `BAD_DRAFT` after remount) ⇒ submit held with no visible error; I2 handoff label says blank keeps it unset but blank is now an error.
Ruling (I2): the handoff field accepts blank (`allowEmpty`) meaning unset; the label stays true — unset is a real capability the label promises — cost if wrong: none.
Task 10: fix round 1 queued until Task 11's fix round returns (one committer at a time).
Task 10: minor (deferred): misplaced doc comment above BAD_DRAFT; hasBadDraft scans all groups' drafts; leading zeros now accepted in UsagePanel.
Task 9+11: fix round 1/5 implementer done (commit 8481970; write-catch mutation and 'stores 0' mutation red)
Task 9+11: fix round 1/5 (1 addressed + optional minor, 0 open; commits b2fe242..8481970)
Task 9: complete (commits f9ac4d9..baefed0, review clean)
Task 11: complete (commits baefed0..8481970, review clean after 1 fix round)
Task 10: fix round 1/5 implementer done (commits ff5e133, 079f1e2; F1-F7 red)
Task 10: fix round 1/5 (2 Important + 1 minor addressed, 0 open; commits 8481970..079f1e2)
Task 10: complete (commits 4965147..079f1e2, review clean after 1 fix round)
Final review: dispatched (range 8db3120..HEAD, opus)
Final review: Needs a fix wave — C1 a second conflict after a resolved one reuses attempt 1 and collects the stale terminal loop state (wrong tree published; with push-target pushed; no spawn, no spend); I1 a delivery/target/remote change keeps lastIntegrated (squash onto the new target drops earlier work; a finished group never reaches the new target). Reproduced by the reviewer in a scratch clone. Triage: fix before merge — T3 `git status --no-optional-locks`, T5 re-entry criteria, T8 title/lede + flash, T10 hint label.
Ruling: one fix wave takes C1, I1, the four fix-before-merge minors, and final-review Minors 2–7 and 9 (preflight fetch without FETCH_HEAD; PR URL validated before use as href; Resolve hidden for `integration-conflict-unreproducible`; targets starting `orca/` refused; GIT_SSH_COMMAND only when neither the env var nor `core.sshCommand` is set; older conflict copies removed when a new attempt materialises; spec §13 corrections) — cost if wrong: a larger single fix diff.
Ruling: final-review Minor 8 (a hung remote holds every group's landing up to the timeout per backoff cycle; no second-group driver criterion) is recorded for the handoff, not fixed — bounded and spec-accepted — cost if wrong: up to 60 s stalls per cycle under a dead remote.
Final review fix wave: dispatched (base 079f1e2, fixer opus)
Final review fix wave: fixer DONE (commits 079f1e2..50e9c52, 13 commits; report final-fix-report.md; 32 mutations red; broad 2001 passed / 54 skipped + real-ccloop 72/72; reds driverRequirementSplit, controlShutdown 143 = known flakes, 14/14 alone)
Ruling: accepted — the attempt counter also counts attempts whose spend was booked (a keep→scheme→keep round trip cannot renumber from 1 and skip booking); the stale runs dir is removed on the first round after approval, not in the transaction (crash-safe); Minor 6 adds one short `git config` child per remote-talking git child; Minor 3 blocks a `pr create` that prints no URL; M-T10 applied to all five labelled token fields — cost if wrong: small, reversible.
Final review fix wave: re-review all 13 addressed, no new Critical/Important (named checks: no stale terminal state readable across attempts; only destination changes reset lastIntegrated; pre-change records parse with attempts=0).
Final: parked — Decisions pane stays "Reading decisions…" if the first /api/decisions fetch fails (error is shown beside it) — Ruling: cosmetic, error visible — cost if wrong: confusing text after a network error.
Final: parked — `nextAttempt` scans the outbox (no index on the id prefix), same pattern as driverLanding — Ruling: bounded by outbox size — cost if wrong: slower conflict settles on huge stores.
Final: parked — main→rel→main resets lastIntegrated so the next squash starts from the fork point — Ruling: spec "new destination starts from scratch" — cost if wrong: a conflict if the person edited the same lines meanwhile.
Final: parked — `GIT_SSH` (older variable) is dropped by unsetInheritedGitEnv and BatchMode GIT_SSH_COMMAND set instead — Ruling: rare; recorded for the handoff — cost if wrong: a person relying on GIT_SSH sees push-refused.
Task 12: gate dispatched (tip 50e9c52)

## Task 12: gate (session eaee0f2c, 2026-10-08; tree = branch tip after subject `test(control): ...` of the final fix wave, commit 50e9c52)
Isolated clone (`git clone --local`; node_modules symlinked from the worktree — `npm ci` hung > 10 min on the ssh ccloop dependency), HOME + four XDG relocated (0700), TMPDIR `/private/tmp/claude-501/og3/t`, `ORCA_CCLOOP_BIN` = built clone of ccloop c82b212, fake codex `integration` agents table.
| command | rc | counts | load |
|---|---|---|---|
| web build | 0 | | |
| typecheck | 0 | | |
| `--ws check` | 0 | web 79 files / 618 | |
| `verify:control` | 0 | 142 files, 1533 passed / 4 skipped | |
| `verify:panel` | 0 | PASS 0–14 | |
| `npm test` | 0 | 354 files, 3260 passed / 7 skipped / 0 failed | 4.97 → 8.78 |
| `check-tmp-leak` | 0 | 0 entries left (its inner vitest exit 1; a replica run named `driverReconcileN` "lands all three…" deadline red, 3/3 alone at load 5–7 — new load-flake candidate, not in the list) | |
Real home: `ls -la ~/.orca/control` before/after `cmp` rc 0.
Mutation tables: per task in task-<N>-report.md (Tasks 1–11 and fix rounds) and final-fix-report.md (32 rows); every row seen red with restore 0/0 bytes. Rewrite inventory: in the same reports (skill.test route counts; decisionsApi toStrictEqual; six web tests for TokenInput; budgetI18n label; integrationGh R1 ×2; executionDriverE2E E1 lives on the base branch).

## Round close
All 12 tasks complete; final whole-branch review + one fix wave + scoped re-review clean.
awaitingHuman:
1. Repair the main checkout (subagent incident): `git rebase --onto 254371c 7ce8db2 main && git branch -D side` in /Users/biran/code/skills/loop/Orca.
2. Merge: `deps/usage-by-model-pin` then `feat/integration-schemes` into main (`--ff-only`; merge main into the branch first if main moved), push.
3. Delete worktrees `Orca-usage-pin`, `Orca-integration` and the two prunable scratchpad worktrees.
4. Review every `Ruling:` line in this ledger and in the accounts ledger's Task 12 section.
5. Decide whether `driverReconcileN` "lands all three…" joins the load-flake list.
6. Downgrade note: once a repository has an integration default, an older Orca build reads its settings body as invalid (spec §3.1).
