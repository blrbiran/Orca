# Tester follow-up E: rulings and design

Date: 2026-11-11. Owner: the Orca session that triaged tester issues #242–#260 against main after
`docs(handoff): tester follow-up D round -- browser login, estimate as expectation, accept-attempt, the issue batch, what waits for the human`.
Evidence: `orca_archived_files/issue-20261023.md` (the tester's report is evidence, not a mandate) and three
read-only triage passes recorded in `.superpowers/sdd/2026-11-11-tester-followup-e/progress.md`.

## 0. Human rulings (verbatim; context in the ledger)

- On the controller's recommendations for the open items (#125 (a), #101/#104/#116, #168, D21, attempts counted
  per lineage, #84): 「其他都按你的建议走」. On #200: 「加」.
- On #241's group acceptance check and #251's `--finish`: 「其他都同意」. On #243 (a Live composer): 「这一轮先不做，下一轮我们讨论一下」.
- On the proposed scope of this session: 「同意」. Browser review: 「暂时不看，我之后发现问题会再找你」.
- On #125 the human asked for the best whole-system answer across Orca and ccloop, without deferring to earlier
  rulings: 「你看下 Orca 和 ccloop 整体如何调整最优，先不要顾虑之前裁定的部分，之前裁定时不一定有考虑好」.

Each section below names the earlier spec text it overrides; that spec gets a dated correction section appended, its
original text untouched (Rule 13).

## 1. ccloop: a codex call's usage survives an error row (#249)

`CodexUsageFold` (ccloop `src/runtime/codex/protocol.ts`) turns any `error` / `turn.failed` row anywhere in the stream
into `codex-event-error`. A mid-stream `error` row followed by a successful `turn.completed` therefore makes
`decodePhase` throw a plain Error without `observedTokens`; `outcome.json` records `observedTokens:null`,
`failure-cause.json` `usageObserved:false`, and Orca books the call as unknown (soft groups: floor `null`, booked 0).
The tester lost 2.58M and 4.50M tokens this way.

- Both catch blocks of `decodePhase` attach the usage the stream's `turn.completed` reported
  (`TurnUsageFold`, input + output as the existing sum rule counts it) as the thrown error's observed tokens, so the
  existing observed-usage path books it. Nothing else changes: the phase still fails, the cause classification is
  unchanged, the strict decoder is not relaxed, and a stream with no `turn.completed` keeps `null`.
- Criterion: a fake-codex mode that prints an `error` row, then `turn.completed` with usage, then a final answer;
  `outcome.json` carries that usage and `usageObserved` is true. Additive only (ccloop Rule 15: no existing criterion
  is rewritten without a named ruling).
- Consistent with ccloop ruling 26 (`codexAdapter.ts` comment: a failed phase carries the turn usage its stdout showed)
  and the C1 sum rule (`docs/superpowers/specs/2026-10-21-failure-causes-and-transient-retries-design.md`).
- Treating such a call as a success is out of scope (it would change failure semantics; needs its own ruling).
- Orca needs no code change, only a repin after the human pushes ccloop.

## 2. The Web reads every activity kind (side finding)

`web/src/controlApi.ts` `activityKinds` omits `saved-result-top-up`, and `activityResponse` rejects the whole run
activity response on an unknown kind: any run with a top-up shows `activity-response-invalid`. Add the kind, and add a
criterion that the Web's set equals the server's `ACTIVITY_KINDS` so the two cannot drift again.

## 3. `run show --group` checks membership (#242)

An explicit `--group` skips the only membership check (`groupOfRun`, `src/commands/domains/reads.ts`). The CLI
refuses, before reading activity or evidence, when the named group's view does not list the run:
`run-not-found: run <r> is not in group <g>` (non-zero exit). Without `--group` behaviour is unchanged.

## 4. Post-merge checks leave a record (#245)

Today only a failed post-merge check (R2, `src/control/driverLanding.ts`) leaves anything (`blockedReason`). Every
landing through the clean-merge path records what happened:

- The landed run's drive record gains `postMergeCheck`:
  `{ result: "passed" | "failed" | "not-needed", why?: "fast-forward" | "tree-equal" | "no-required-checks" | "no-task",
     attemptSha, mergedSha, oldTip, commands: [{ command, exit, ms }], tail? }` (tail ≤2048 bytes, failed only).
  Old drive records without the field stay valid.
- A new activity kind `post-merge-check` is written in the same transaction as the landing (passed) or the block
  (failed), body as above. `not-needed` writes only the drive field.
- A stopped check still lands nothing (unchanged) and records nothing.
- `orca run show` and the Web run detail show one line: "post-merge check passed (2 commands, 41 s)",
  "not needed (fast-forward)", or the failure with its tail.
- Multi-repo landings and reconcile landings are unchanged (no post-merge check there today); recorded as a known gap.

## 5. A group is accepted on its final tree before it is done (#241)

Group done today (`src/control/groupDone.ts`) runs no checks; each task's required checks ran on its own attempt tree
and (R2) on its merge, so a later landing can break an earlier task's checks unseen — the tester's 7/7-done group whose
final `npm test` failed. This overrides the D1 rule quoted at `groupDone.ts` ("all tasks done and landed ⇒ done
automatically"): done now also needs a passing acceptance on the group's final tip.

- **When**: every task is done and landed, before delivery and before `done`.
- **What runs**: the union of the done tasks' required checks (deduplicated by command), after the union of their
  setup commands, in a scratch worktree at the group branch tip — the same runner the post-merge check uses
  (`runAsCheck`). No new configuration; on by default (R2 precedent).
- **Not needed** when at most one task landed in the group (its checks already ran on that tree): recorded as
  `not-needed`. Multi-repo groups: recorded as `not-run: multi-repo`, behaviour unchanged (known gap).
- **Record**: durable, keyed by group and tip sha, same shape as §4 (`result`, `commands`, `tail`), plus a
  `group-acceptance` activity row. A restart does not rerun an acceptance already recorded for the current tip.
- **Pass** ⇒ the group proceeds to delivery and done as today.
- **Fail** ⇒ the group does not become done. It shows a problem `group-acceptance-failed:<command>` (Board, Problems,
  `group show`). Ways out:
  - the tip moves (a retried task, a debug group lands) ⇒ acceptance reruns on the new tip automatically;
  - `orca group recheck <g>` (any access) reruns on the same tip (a flaky check);
  - `orca group waive-acceptance <g> --note <why>` (human only, socket person token) marks it accepted with an activity
    row naming who and why.
  - The Web problem row offers Recheck, and Waive to an owner.
- New verbs follow the checklist: archiveGroup CALLS, accessMatrix, refusalCoverage, i18nPseudo enum count, CLI docs.

## 6. Transcript (#244, #252, #253, #254, #255)

#243's composer is deferred to the next round by ruling. The rest:

- **#244 wrap**: expanded fields wrap (`white-space: pre-wrap; overflow-wrap: anywhere`); the event list gets
  `min-width: 0` and no horizontal scroll. In the Runs pane the open run's transcript renders full width below the
  runs table instead of inside a table cell, so the table's 40rem narrow-screen rule (`web/DESIGN.md`) no longer widens
  it. The transcript sets its own type size (the body's 14px / 1.55) so Live and Runs read the same; this settles the
  font half of #243.
- **#252 order**: Orca orders the call listing by attempt, then phase rank (plan, execute, verify, then other phases by
  name), then seq. The label drops "call N" when the phase has one call in that attempt. Live's follow (the newest
  recorded call) then follows the running execute, not plan — a second bug the triage found. Cross-repo `startedAt`
  is not added (would need ccloop and both strict schemas).
- **#253 tools**: within the loaded window the Web joins a `tool_call` and `tool_result` with the same `meta.id` into one
  row, toned `ok` / `danger` (`data-tone`); a call without a result reads "running"; a result without a call keeps its
  own row. The API keeps both events (the live-transcript spec already says the Web joins them).
- **#254 result rows**: codex `turn.completed` keeps cached and reasoning token counts in `num` when present; the Web
  shows `num` in the row summary; a row with no fields is not expandable (omp `agent_end` included).
- **#255 paging**: Earlier/Later become ‹ › icon buttons with accessible names and a tooltip ("previous / next 200
  events"), beside the loaded range ("rows a–b of n") and "at newest" / "at oldest". The 200-row window stays.

## 7. Requirements and CLI (#125, #250, #251, #246)

- **#125**: `lastInvalidReason` keeps quoting `no-output` into the next prompt (provider error text gives the model
  nothing and is untrusted). What changes is the human-facing reason: a round or draft that ends because its last call
  *failed* (record outcome not complete) gets `reasonCode` `clarify-call-failed` / `split-call-failed` instead of
  `clarify-output-invalid` / `split-output-invalid`, whose Web text says the model's output was invalid three times
  (false for a call refused before it ran). The Web shows the failed call's code and `detail` beside it. The flow
  clarify path (`src/flow/kinds/clarify.ts`, `src/flow/feedback/intake.ts`) does the same and keeps `detail`.
  ccloop is unchanged (it already gives the code and `failureCause.detail`). Overrides
  `2026-10-15-ccloop-error-codes-design.md` §4.5's "requirement failed with `clarify-output-invalid`" for call failures.
  Both new codes are retryable like the old ones.
- **#250**: the confirm refusal `agent-selection-unresolved` leads with
  `orca proposal set-agent <g> --slot worker --agent <installation>  (sets every task and reconcile)` when any worker or
  reconcile slot is unselected. `plan save --requirement <r> --draft <n>` writes the requirement's estimator agent into
  the saved plan's `agent` when the plan names none (the accept-time seed, tester-round2 spec §6.2).
- **#251**: `orca requirement answer … --finish` (payload `finish: true`) answers the round and closes clarification at
  once: no next round is queued (as when the round cap is reached) and the consensus that follows uses these answers.
  The Web answer form has a secondary "Answer and finish clarifying" button. A plain answer that queues the next round
  says so ("round N+1 is now drafting; use --finish to stop after a round"); the consensus `round-state` refusal names
  the drafting round and `--finish`. Extends `2026-10-02-requirement-to-split-design.md` (answer queues the next round).
- **#246**: not a defect (no layer names an agent ⇒ `agent-unselected`, agent-selection spec). The hint improves: with no
  `defaultAgent` and exactly one `perAgent` entry it says "pass --agent <that one>".

## 8. Budget (#101/#104/#116, attempts per lineage)

- **Settling unknown usage**: a socket client without a person token (an orchestrating agent) may settle a run's
  unknown usage with `acknowledge: "charge-remaining-grant"` (books the whole remaining grant: never under-books, and
  the grant was already reserved) or `"release-known-zero"` (still only when the code proves zero). `release-unmetered`
  and every other settlement stay person-only. Dispatched runs are still refused. The CLI help and refusal text say
  which forms an agent may use.
- **Attempts in an unlimited group**: in a group whose `limit.tokens` is null, an explicit `task retry` (person or
  agent) starts its run with the default attempts and active time, not what is left of the lineage's; the ladder's
  automatic retries keep counting the lineage. Spend caps, the T2 funding floor and the ladder bound stay. Finite groups
  are unchanged byte for byte. Overrides `2026-11-11-budget-defaults-and-reviewed-acceptance-design.md` §7 item 7's
  first consequence.

## 9. Projects and split (D21, #168)

- **D21**: `orca project add <name> --path <dir>` (or `--dirs <id,id>` for a multi project) on the control socket,
  human only (person token); dispatched runs and MCP refused. The Web `POST /api/projects` becomes owner-only
  (`owner-required` for a member). Registering a project lets Orca and its agents write in a new directory: agents must
  not widen that set themselves.
- **#168**: split validation hands back a draft (`check-docs-only-suite:<task>[:<dir>]`, with an explanation in the
  retry prompt) where every target path of a task is documentation (`*.md`, `*.mdx`, `*.rst`, `*.txt`, `docs/**`,
  `README*`, `CHANGELOG*`, `LICENSE*`) and one of its required checks runs a repository-wide suite (`npm test`,
  `npm run test`, `pnpm test`, `yarn test`, `npx vitest run` or `jest` without paths, `pytest` without paths,
  `go test ./...`, `cargo test`, `make test`). Overrides `2026-11-08-tester-followup-design.md` §#168 ("guidance, not a new
  refusal rule"): the tester lost 116k tokens to it, and #130/#135/#136 already moved prompt rules into validation. The
  repository-wide suite belongs to an implementation task or the group acceptance (§5).

## 10. Web (#256, #258, #257, #84, #200)

- **#256**: Overview Progress lists done groups in a collapsed "Completed (N)" block below the active ones (a done group
  can still carry delivery work). No `closed` state.
- **#258**: memory list and search take `offset` (default 0); the page answers `offset` and `hasMore` besides
  `records/total/truncated`, over the existing stable sort. The Memory page has "Load more" and shows "1–100 of 508".
  Adds to `2026-09-29-memory-tab-design.md` (which defines `limit` only).
- **#257**: the default stays "Unreviewed = high tier and not reviewed" (`2026-10-08-integration-and-panel-fixes-design.md`).
  When major unreviewed decisions exist outside the high tier the list says "N major decisions outside the high tier"
  with one action showing them.
- **#84**: overlays (Radix dialog, menu, select) fade and scale in over the 120 ms motion token on open; collapsible
  blocks fade in. Everything stops under `prefers-reduced-motion`. Corrects `web/DESIGN.md` "Motion is limited to
  colour/edge/shadow transitions and the press". List reordering stays unanimated.
- **#200**: a new light candidate theme `lilac` (zh 丁香): a soft lilac page (a gradient through one new optional
  token, default none for every other theme), white cards with a 1px edge and 16px card radius, an accent from
  `#847aff` darkened where text sits on it so `web/tests/themes.test.ts`'s bar holds. The tester's 36px numbers are not
  taken (type scale 14/18/22). `web/DESIGN.md` Themes lists it.

## 11. Out of scope

- #243's composer (next round, by ruling).
- #247, #248, #259, #260: defects in code an agent generated in the tester's target repository, not Orca. Their lesson
  (tests that encode wrong behaviour all pass) is what §5 addresses on Orca's side.
- #237 and #241's missing evidence stay parked by earlier rulings.

## 12. Criteria

Rewrites authorized by the rulings above: the `i18nPseudo` enum count (new activity kinds and verbs); the
`singleCallErrorCode` and Web assertions that pin `clarify-output-invalid` / `split-output-invalid` for call failures
(#125); tests that pin the theme list (#200); tests that pin Overview's flat Progress list (#256). Any other existing
criterion that must change goes in its own commit marked `Ruling: pending` and waits for the human before merging to
main. Every new branch is shown red by a named mutation in a `git clone --local` copy.
