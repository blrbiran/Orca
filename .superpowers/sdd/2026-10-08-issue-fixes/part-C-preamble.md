## Part C — Shutdown stop-intent lifecycle (spec §3)

> **Controller amendment (2026-10-08, binding).** (1) Review Focus 1 (plan index): C2 adds a criterion that writes a
> **v8** store (the pre-Part-B schema, built the way `tests/control/schema8.test.ts` builds older stores) holding an
> empty-frozen-set shutdown intent and a run without `startedAt`, opens it through the normal store open (migrating to 9),
> runs `recoverControl`, reads the group view (the run's `startedAt` is null and the view renders), and then `start`
> succeeds. (2) C3: per-task "Continue task" buttons render only when the group has **no** stop intent (the server refuses
> `continue-task` under any stop intent); rewrite the affected web tests (`handoffResume`, `controlI18n`, `controlPanel`)
> accordingly and list them in the report.

Spec: `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §3 (invariant S1), §5.2 (`stop-cleared` row), §6.5 (banner
position), §8, §9 step 4. Part B (activity table, `recordActivity`, `readGroupActivity`, schema v9) has landed before
this part; C2 consumes its interface exactly as fixed in the controller's brief.

Every line number below was measured on the worktree at the commit whose subject is
`docs(spec): revise the issue-fixes design after independent review` (before Parts A and B). Parts A and B touch some
of the same files (`web/src/ControlGroupView.tsx`, `web/src/locales/*.ts`, `src/control/recovery.ts` is not expected to
be touched by them); the executor re-measures each anchor with `grep -n -F '<anchor text>' <file>` before editing, and
every anchor below must hit exactly one line — anything else is a stop-and-report.

How this part was checked while it was written (evidence, not an instruction): every code block and rewritten criterion
below was applied in a `git clone --local` copy under the planning session's scratchpad, with a stub `activity.ts` in
place of Part B's module, and run: the three rewritten server test files plus the new ones pass (34 tests), `npm run
typecheck` is clean, the full web suite passes (80 files, 625 tests), and each mutation named in a Step 5 below was seen
red. The full root suite in that clone showed no other shutdown-related failure (its other failures were environment
only: no `web/dist`, no ccloop build at the sibling path, load timeouts).

### Existing criteria rewritten by this part (spec §3.4; human-approved rewrite of criteria the spec requires)

The spec names five; running the suite against the C1 change found four more criteria that pin the old idle-group
behaviour (marked **not named in §3.4**). Each rewrite keeps the criterion's intent and is commented with the spec section.

| File | Test name (current) | What changes | Named in §3.4? |
|---|---|---|---|
| `tests/panel/controlLifecycle.test.ts` | "gives a ready group an empty frozen set that completes, so restart can resume and start" | replaced by "lists an idle ready group as unchanged-idle: no stop intent, not stopped, revision and projection unchanged" (+ new "lists an all-done group as unchanged-idle") | yes |
| `tests/panel/controlLifecycle.test.ts` | "commits one global command and leaves unchanged groups out of the command ledger and projection" | harness claims `g`, so `g` is still `created` (the idle half moves to the test above) | yes |
| `tests/panel/controlLifecycle.test.ts` | "waits for a writer admitted before the gate and then commits every group at once" | harness claims `g` and `h`, so both stop rows still prove the single commit | **no** |
| `tests/panel/controlLifecycle.test.ts` | "records an inconsistent frozen set as a blocker while still committing the other groups" | harness claims `g` and `h`, so `h` is still `created` | **no** |
| `tests/panel/controlLifecycle.test.ts` | "leaves nothing behind when the commit is lost and replays the closed result once it succeeds" | harness claims `g` and `h`, so the lost commit has intents to lose and both revisions still advance | **no** |
| `tests/panel/shutdownDriverGroup.test.ts` | "freezes a started group exactly as before when no driver exists, idle or running" | idle half: `unchanged-idle`, no intent, not stopped | yes (idle half) |
| `tests/panel/shutdownDriverGroup.test.ts` | "freezes a group that was never started even when a driver exists: it is not the driver's yet" | renamed "lists a group that was never started as unchanged-idle even when a driver exists: it is not the driver's yet" | yes |
| `tests/panel/shutdownDriverGroup.test.ts` | "freezes a started group whose body carries no planHash: the planHash is part of the definition" | renamed "does not skip a started group whose body carries no planHash as driver-owned: the planHash is part of the definition"; expects `unchanged-idle` (still not `skipped-driver-owned`) | **no** |
| `tests/control/webFaults.test.ts` | "applies a cross-group shutdown to every group or to none, and an epoch replays it once" | verified: `g` holds a claimed run, `g2` is imported but never confirmed/started ⇒ idle. Decision: rewrite — stop rows `["g"]`, count 1, `g2` listed as `unchanged-idle`; the two-frozen-groups atomicity is carried by the rewritten controlLifecycle "leaves nothing behind…" (both groups active) | yes (spec said "if its groups are idle"; they are) |

Unchanged and still green after C1 (checked): every other test in the three files, `tests/control/handoffE2E.test.ts`,
`tests/control/requirementGuards.test.ts`, `tests/control/driverRequirementClarify.test.ts` (they pin
`skipped-driver-owned`, which keeps precedence over `unchanged-idle`), and `web/tests/handoffResume.test.tsx`,
`web/tests/controlI18n.test.tsx`, `web/tests/controlPanel.test.tsx` after C3.

---

