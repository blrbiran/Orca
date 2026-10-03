# Final review — syncskill integration (per-run skill snapshots)

Reviewer: final whole-change reviewer (read-only), Orca session 08b1007d, 2026-10-03.
Inputs read: spec `docs/superpowers/specs/2026-10-03-syncskill-integration-design.md` (§10 overrides §1–§9), plan
`docs/superpowers/plans/2026-10-03-syncskill-integration.md`, ledger `progress.md` (Rulings and deferred Minors),
`final-orca.diff` (Orca d017cb0..bacb9d7; the checkpoint and ledger commits skipped), `review-t1-85a9564..af26a22.diff`
(ccloop). Source files were re-read at HEAD where a seam crossed task boundaries (executionDriver.ts, driverHandoff.ts,
executionSnapshot.ts, webService.ts, schedulerBridge.ts, scheduler/run.ts, requirementSplit.ts, controlViews.ts,
locales) and syncskill's own `src/inject.ts` was read to check the lock order and error codes.
Nothing was built, run, edited or committed. Line numbers are at HEAD bacb9d7 (Orca) / af26a22 (ccloop).

Done in two passes: ccloop diff + Orca source diff first, then the six requested seams across tasks.

## Strengths

- The "absent stays absent" discipline is applied at every producer: `expandLoopPlan` / `keptExpansion` (conditional
  spread), `prepareExecutionSnapshot` (key omitted when empty), `replaceTaskInSnapshot` (key deleted when the last
  entry goes), `toStartEnvelope` (conditional spread), the claude adapter (command and extraArgs untouched without the
  option), `taskPlanView` / `runViews`. Each has a golden recorded before the change (loopPlanGolden.json, snapshot
  golden, envelope golden `46bdd075…`, ccloop argv golden per phase).
- The lock-order check in A2 (`executionDriver.ts:303-316`) is consistent with syncskill: Orca sorts with
  `[...new Set()].sort()` and syncskill's `normalizeSkillList` / `buildLock` sort by the same UTF-16 code-unit order
  (`syncskill/src/inject.ts`), so mixed-case names do not trip `syncskill-output-invalid`.
- Cleanup keyed on the runId (`workspace.ts:173`) closes the restartRun hole that keying on `drive.skills` would leave.
- Every removal site of `skills-<runId>` runs only after ccloop is done with it or provably never started it (seam 4
  below), which is exactly what ccloop's accept-only directory check (Task 1 Minor) requires.
- ccloop refuses the field for a non-claude agent before anything is persisted, with a named exit-2 refusal that
  Orca's existing `accept-refused:` path already blocks by name.
- `profile ls --no-refresh` and the temp `SYNCSKILL_DIR`/`HOME` + real-`~/.syncskill` snapshot in both real-binary
  test files satisfy Rule 17.

## Seam-by-seam

1. **Envelope field end to end.** Orca `schema.ts:51` and ccloop `protocol.ts:193` both add
   `skillPluginDir: z.string().min(1).optional()` to a strict loop work; `executionPort.ts` `LoopWork` matches ccloop's
   `LoopWork`. Orca records `realpath(skills-<runId>)` (`executionDriver.ts:307`), which is what ccloop's
   `validateCanonicalDirectory` demands at accept. Replays: `inspect`/`handoff`/`collect`/`read-evidence` only check
   absoluteness (`protocol.ts:281-283`), so Orca's post-cleanup calls still parse. Continuation runs inject into their
   own `skills-<newRunId>`; the predecessor's goes in `cleanupPredecessor` after its bundle verified. OK.
2. **Snapshot `skills` shape and normalisation.** Writers: confirm (`webService.ts` confirm, names copied from an
   already-normalised recipe, profile members normalised in `profileMembers`), set-task-loop (`normalizeLoopSkills`
   then `replaceTaskInSnapshot`). Readers: A2 via `readConfirmedTaskExecution` (checks entry ⇔ effective recipe), panel
   `controlViews.ts` (`snapshot.skills[].names` by taskId). One shape `{taskId, profile|null, names}` everywhere. OK.
3. **No skills ⇒ byte-identical.** Archive/planHash/contract (Task 3 golden), snapshot hash (Task 4 golden), envelope
   hash (Task 6 golden), claude argv (ccloop per-phase golden). The drive record gains `skills: null` on every new run
   (accepted by spec §10.6; the drive record is not hashed). The ccloop envelope-hash golden cannot go red (Minor T1-d).
4. **Cleanup of `skills-<runId>`.** Sites: step E (`executionDriver.ts:711`, only when `settled`), `cleanupPredecessor`
   (`:345`, successor's A2, predecessor stopped), `restartRun` (`driverHandoff.ts:112`, reached only for runs blocked at
   A1/A2 or at B with `accept-refused`, i.e. never accepted), and A2's own pre-inject removal. None runs while ccloop can
   still relaunch a worker for that run. A failed workspace removal leaves the snapshot too (`removeOwnPath` throws
   before `removeSkillsSnapshot`); step E retries, the other two record `cleanupError` — same residue convention as the
   workspace. OK.
5. **Rule 17.** Real-binary tests set `HOME` and `SYNCSKILL_DIR` to temp dirs and snapshot `~/.syncskill`; the fake
   writes only to `--target` and `$FAKE_SYNCSKILL_LOG`. Modes: dirs `0700` (umask can only narrow), `plugin.json` `0600`.
   OK, but every real-binary criterion is `ctx.skip()`-gated (Minor N4).
6. **Error codes.** syncskill emits `E_SKILL_NOT_FOUND`, `E_TARGET_OCCUPIED`, `E_USAGE_SKILL_NAME`,
   `E_USAGE_INJECT_SELECTION`, `E_PROFILE_NOT_FOUND`; Orca never enumerates them (`syncskill-failed:<E>`). Every
   `SyncskillError` code Orca can raise (`syncskill-unconfigured|missing|timeout|output-too-large|output-invalid`,
   `skills-shape`, `skills-profile-empty`, `syncskill-failed:*`) maps to a registered `errors.ts` code via
   `SYNCSKILL_REFUSALS` / `syncskillRefusal`, and each has a zh string. `skills-unsupported-agent` is ccloop-only and
   reaches Orca as a block reason, not a ControlError code, so its absence from `errors.ts` is correct after ruling F1.
   One stale zh message (Minor N2).

## Issues

### Critical

None.

### Important

**I1. A codex task with skills is not "refused at run start" — it is stuck (ruling F1 and its set-task-loop sibling).**
- Where: `src/control/webService.ts:582` (comment replacing the agent check), ruling lines in `progress.md`.
- What: with the Orca-side check removed, confirm accepts a task with skills on a codex installation. At run start A2
  injects (spawns syncskill, copies the set), then ccloop refuses at B and the run blocks
  `accept-refused:2:skills-unsupported-agent`. From there nothing a person can do in the panel unsticks the task:
  `recovery-retry` re-sends the same sealed envelope (refused again); `set-task-loop` refuses any task with a `runs` row
  (`task-already-started`); `proposal-set-agent`/`confirm` go through `prestart` + `refuseAfterTaskStarted`
  (`grant-amendment-unsupported`); a handoff-stop only reaches `restartRun`, after which the task is redispatched with the
  same frozen agent and skills. The ruling's stated cost ("refused at run start instead of at confirm") understates this.
  There is also no Orca-side criterion showing the path ends in a named block rather than a run without skills (only
  ccloop's `skillPluginDirAccept.test.ts`).
- Fix (pick one, before ccloop is pushed since option (a) touches ccloop):
  (a) have ccloop's `resolveAgent`/capabilities answer carry the installation `kind` (additive), have Orca's
  `AgentResolution` read it, and refuse `skills-unsupported-agent` at confirm and at set-task-loop on a confirmed task,
  as spec §4.2 / §10.5 intended; or
  (b) keep the ruling, but correct its cost statement in spec §11 and the handoff ("the task cannot be changed or
  re-agented after the refusal; the group must be re-planned"), and add an Orca criterion (a codex variant of
  `tests/control/skillsE2E.test.ts`) asserting the run blocks with `accept-refused:2:skills-unsupported-agent` and that
  no claude/codex call happened. (a) is the better product; (b) is the minimum before push.

**I2. Spec §9's open points were never measured, and the read-only addition created a new one.**
- Where: spec §3 ("The probe is to be re-run as a plan task and committed under `scripts/`"), §9 (lock file inside
  `<dir>/skills`; plugin-skill namespacing); §10 does not replace §9; the plan has no probe task and `scripts/` has none.
- What: nothing in this change shows a real claude 2.1.288 (a) ignoring `skills/syncskill-lock.json`, (b) exposing the
  skills under the names a prompt would use, (c) loading a plugin directory whose `skills/` tree is `0500/0444`
  (introduced by the read-only ruling after the §3 measurement; if claude writes anything under a plugin dir, every run
  with skills fails). C9 is explicitly fake-claude only. The §3 recorder method costs nothing (API pointed at a local
  recorder that answers 500), so H5 ("no paid real-claude acceptance") does not cover skipping it.
- Fix: run the §3 recorder probe once against a directory produced by A2 (read-only, lock file inside, `plugin.json`),
  commit it under `scripts/`, and record the three answers in spec §11 with the measuring command and commit. If (a)
  fails, move the lock to `<dir>/syncskill-lock.json` as §9 already prescribes.

### Minor (new in this review)

- **N1 — set-task-loop on a confirmed task accepts `names` with `ORCA_SYNCSKILL_BIN` unset** (`webService.ts:130`
  `profileToLookUp` returns null for names; no other unset-bin check after fix round 1 of Task 5). Confirm refuses the
  same declaration (`syncskill-unconfigured`, ledger F2), so the two doors disagree and the run fails later at A2 with
  `skills-inject-failed:syncskill-unconfigured`. Fix: in the confirmed branch, when `!skillsUnchanged &&
  expanded.recipe.skills !== undefined && (this.deps.syncskill?.bin ?? null) === null`, throw
  `ControlError("syncskill-unconfigured")` (decided after the existing checks, next to `if ("failure" in skillLookup)`);
  add the case to `setTaskLoopSkills.test.ts` with its mutation seen red. **Must fix.**
- **N2 — stale zh message** `web/src/locales/zh.ts:650` `syncskill-unconfigured` says only tasks declaring a *profile*
  are refused; after F2 it also covers names-only tasks (and N1's set-task-loop case). Reword to "声明了技能的任务".
- **N3 — the plugin manifest is writable by the agent** (`executionDriver.ts:314` makes only `<dir>/skills` read-only;
  `<dir>` and `<dir>/.claude-plugin` stay `0700`, `plugin.json` `0600`). An executing agent can add `hooks/`,
  `commands/` or rewrite `plugin.json` in the plugin dir that the verify phase then loads, outside every diff harvest
  sees. Advisory like the ruling itself (the owner can chmod back), but cheap to close: `makeReadOnly(dir)` after writing
  `plugin.json` (update C5's `0700` assertions accordingly; `restoreOwnerWrite` already handles the whole tree).
- **N4 — every real-binary criterion is skipped by default** (`tests/skills/syncskillReal.test.ts`,
  `tests/control/driverSkillsReal.test.ts`, `tests/control/skillsE2E.test.ts` gate on `ORCA_SYNCSKILL_REAL_BIN` /
  `ORCA_CCLOOP_BIN`). Rule 12: the push gate's record must show those three files *ran* (not skipped) with the env vars
  named, against the Task 1 ccloop build. **Must do before push** (evidence, not code).
- **N5 — spec §6 capacity numbers not recorded.** §6 says the gate records spawn time and bytes per run with skills; at
  HEAD nothing does. A2 awaits syncskill (timeout 30 s) inside the driver step, so this number matters for the
  massive-parallelism goal. **Must do before push** (Task 8 gate).
- **N6 — spec §11 "implementation corrections" not yet appended** (plan Task 8; Rule 13: the published spec is
  corrected only by a new section). It must carry: the C2 ruling (three shapes refused as `malformed`, not
  `skills-shape`); F1 and the dropped set-task-loop `skills-unsupported-agent` (with I1's corrected cost); the §7 row's
  real reason `skills-inject-failed:syncskill-failed:E_SKILL_NOT_FOUND`; codex refusal moved from the adapter (§4.4) to
  `acceptStart`; the H3 rule for set-task-loop (unchanged declaration keeps its frozen entry, drafts never look up);
  the I2 probe results. **Must do before push.**
- **N7 — the run view duplicates the lock schema** (`webProtocol.ts:1140` vs `src/skills/syncskill.ts`
  `lockSkillSchema`). `readControlGroup` safe-parses the whole group view (`controlViews.ts:823`), so a drift between
  the two would block the entire group view, not just the table. Reuse `lockSkillSchema` (webProtocol may import it;
  `driveRecord.ts` already does).
- **N8 — Orca's own schema does not require an absolute `skillPluginDir`** (`schema.ts:51`; ccloop does,
  `protocol.ts:282`). Harmless today (A2 records a realpath); add `.refine(isAbsolute)` if the copy is meant to refuse
  what the peer refuses.

### Deferred Minors — triage

| Task | Minor | Must fix before push? | Reason |
|---|---|---|---|
| T2 | `STDERR_EXCERPT_BYTES` slices characters | No | Excerpt length only; no correctness effect. |
| T2 | `--no-refresh` guarded only by the fake-argv test | No | The argv test is a real criterion that goes red when the flag is dropped; the real binary cannot distinguish with a seeded dir. |
| T2 | an inject failure test uses target `/x` | No | The fake errors before writing; prefer a temp path for hygiene. |
| T1 | envelope-hash golden (`ccloop tests/control/protocol.test.ts:342`) never passes through the schema | **Yes** | It is the only ccloop criterion for "an envelope without the field hashes as before" and it cannot go red (Rule 9). ccloop is unpushed, so fixing now costs nothing; after push it costs a re-pin. Hash the payload returned by `parseControlRequest` (with fixture dirs created at the fixed paths, or via the exported loop work schema) and show the mutation "schema adds `skillPluginDir` with a default" red. |
| T1 | M4 per-method check in one `it`; `collect` alone never red | No | Ordering within one `it`; the absolute check is one shared code path. |
| T1 | replayed `accept` after the dir is removed answers `control-request-invalid` | No (resolved) | Seam 4: every removal runs after terminal or for a never-accepted run. |
| T3 | `loopRecipeSchema` does not apply the name rule | No | Recipes are produced only by expansion and are hash-verified; A2's `injectSkills` re-checks the rule. |
| T3 | "contract has no skills" test passes trivially | No | Guard only; `expandRecipe` builds the contract field by field. |
| T4 | skills refusals precede `prepareExecutionSnapshot`'s checks | No | Only error precedence for groups with skills; record in §11 (N6). |
| T4 | lookup spawned when confirm will refuse no-op/stale | No | Cost only (one short process). |
| T4 | broad catch reading recipes before the transaction | No | Worst case a misleading `recovery-blocked:skills-lookup-missing`; fails closed. |
| T4 | `syncskill-timeout` recorded as a durable outcome | No | Matches the `control-port-unconfigured` convention; a fresh click mints a new command id. |
| T4 | fake-syncskill path depends on cwd | No | vitest runs from the repo root. |
| T5 | a skills-only change never sets `planChanged` | No | H12 is about the contract; skills are not in it. |
| T6 | `driverSkills.test.ts:35` relies on EACCES (not as root) | No | Test environment assumption. |
| T7 | profile/source sent but not rendered; commit cut to 12; no schema parse test; taskId filter without mutation | No | "No schema parse test" is not accurate: `skillsView.test.ts` goes through `readControlGroup`, which safe-parses `groupViewSchema`. The rest is presentation. |

**Minors that must be fixed before push: 5** — T1 golden (deferred), N1, N4, N5, N6.

## Ruling judgements

| Ruling | Judgement |
|---|---|
| Skills apply to plan, execute and verify alike (human agreed) | Agree. Note N3: the verifier also loads whatever the executor can write into the plugin dir. |
| The injected snapshot is made read-only (human agreed) | Agree as defence in depth. It is advisory (the owner can chmod back), it covers only `skills/` (N3), and it is unmeasured against real claude (I2). |
| Work directly on Orca and ccloop `main`, no worktree branch | Acceptable: unattended run, nothing pushed, Rule 15 keeps merge and push human. Memory `parallel-agents-use-worktree-branch` applies only when another agent works on main; nothing in the ledger shows one did. |
| One helper restores owner write before removing a skills dir | Agree; needed, and both callers use it. |
| Task 1 and Task 2 run concurrently | Agree; different repositories, no shared state. |
| C2's three shapes refused by zod as `malformed`, not `skills-shape` | Agree. Fails closed, matches every other malformed plan field; record it in §11 (N6). |
| F1: drop Orca's confirm-time agent check, rely on ccloop `acceptStart` | Agree that the check as planned was wrong (an installation id is not a kind). Disagree with the stated cost: the task is stuck, not just refused later (I1). Accept only with I1 (a) or (b). |
| set-task-loop `skills-unsupported-agent` dropped for the same reason | Same as F1. |
| A set-task-loop payload without `skills` removes them; a profile looked up whether draft or confirmed | First half: agree (the payload is the full state, like `inputs`; both panel builders carry `skills`). Second half: superseded by the next ruling. |
| Unchanged declaration keeps its frozen entry; drafts never look up; a confirm race is refused `proposal-version-conflict` | Agree; this is what H3 requires, and the race refusal is reachable only when a draft read turned confirmed under the command. Leaves N1 open. |

## Declined to judge

- Whether the 39 bundled claude skills and the target repository's own `.claude/skills` reaching the model when
  `--disable-slash-commands` is dropped is acceptable — settled by human ruling H1.
- Codex skills — deferred to the next round by H6.
- Whether two runs of one task may see different skill content (fresh inject per continuation) — stated and accepted
  in spec §10.6.
- Driver throughput while A2 awaits syncskill — the same shape as the existing git work in A2; only its measurement is
  asked for (N5).
- The ccloop pin / push order — governed by memory `ccloop-repin-by-agent` and Rule 15, outside the code under review.
- The modified, uncommitted `progress.md` in the working tree — ledger content, not part of either range.

## Assessment

**Ready to merge: With fixes.** No defect breaks a run without skills or lets a run with skills proceed silently
without them. Before push: resolve I1 (preferably by making the agent kind visible to Orca while ccloop is still
unpushed), run the free claude probe (I2), and close the five must-fix Minors.
