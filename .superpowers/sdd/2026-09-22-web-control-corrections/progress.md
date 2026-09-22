# 2026-09-22 Web control corrections -- round ledger

**Who:** controller session (Qoder agent), 2026-09-22, working tree `/Users/biran/code/skills/loop/Orca`
on local `main`. **HEAD is deliberately not pinned here** -- committing this file moves it; locate the
round by commit subject instead (`fix(control): read a settled checkpoint as continuable rather than
finished`, `fix(panel): refuse content sniffing on the evidence bytes route`,
`test(control): put the acceptance rows where the store actually looks`).

Scope: the human-ruled items from the handoff's open list, not new features. The ruling list the
human approved was "同意，按你的建议做" over items ①-⑧ reported in chat.

## 1. Rulings taken on this plan

Ruling (§6.3 predecessor predicate): `recoverable` answers "can this checkpoint be continued from",
not "did the task finish". `checkpoints.ts` split it into `continuable` / `completed`;
`repairAcceptedWork` now requires `result === "complete"`; `exportResumeBundle` requires a whole
snapshot instead of a terminal outcome; `cleanup.ts:11` keeps its own explicit `complete` guard.
Completion stayed conjunctively identical to before (`settled && complete && whole && accepted`), so
only the continuation-source judgement widened.

Ruling (production assembly, four answers to four questions): mount the full control plane by
default with `--no-control` to disable; default state dir `~/.orca/control/<repoKey>`; require
`ORCA_CCLOOP_BIN` + adapter config with no legacy fallback; the Panel process owns recovery-before-
listen and an in-process periodic wake. Written up as
`docs/superpowers/specs/2026-09-22-panel-control-assembly-design.md` with
`docs/superpowers/plans/2026-09-22-panel-control-assembly.md`. **Design, not implementation** -- no
seam was wired in this round.

Ruling (named consequence, not averaged): R1 x R3 (mount by default + port config required) leaves
"routes mounted, port unconfigured" undefined. Recorded in spec §3 as: boot succeeds, reads serve,
port-dependent commands refuse with `control-port-unconfigured`, with the rejected alternative (hard
boot failure) written down and the reason it was rejected (existing Panel criteria would need two env
vars; the restarted Panel is precisely where crash state must be readable). The display question
stays open -- `ControlConfigV1` is closed and adding a field is a protocol change for a human.

Ruling (criterion rewrite ratified): `web/tests/controlPanel.test.tsx:147` assertion rewrite is
ratified by the human and the comment now names that ruling (an implementer may not change a
judgement; it was put up and approved).

Ruling (two self-adjudicated spec divergences): both accepted as ERRATUM appended to
`docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` §11 -- shutdown command id
`shutdown:<epoch>` vs `shutdown-<sha256(epoch)>` (root cause: `idSchema` at
`src/control/schema.ts:3` forbids `:`), and `HandoffJoinV1.origin` `"human"` vs `"handoff"` plus the
observation that the canonical request body carries no origin at all. §1-§10 unchanged, one byte.

## 2. Verification numbers, verbatim

Baseline before this round's changes (`test-logs/test.log`):
`Test Files 173 passed | 1 skipped (174)`, `Tests 1520 passed | 5 skipped (1525)`, `TEST_RC=0`,
`TYPECHECK_RC=0`.

After the two fixes (`test-logs/full-after.log`, lines 1420-1425, read whole):
`Test Files 174 passed | 1 skipped (175)`, `Tests 1526 passed | 5 skipped (1531)`, `TEST_RC=0`.
Delta: +1 file (the new `tests/control/checkpointRecoverability.test.ts`), +6 tests (5 there, 1 the
nosniff criterion in `tests/panel/controlRecoveryApi.test.ts`).

**Correction to what was said in chat this round:** an interim message claimed "零 skip". That was
wrong and is retracted -- the 5 skips are real and expected
(`ccloopProtocol.integration` x3, `webCcloopSmoke` x2, gated on `ORCA_CCLOOP_BIN` +
`ORCA_CCLOOP_ADAPTER_CONFIG`), plus 1 skipped file.

`verify:panel` after the change (`test-logs/panel-after.log`, read whole):
`PASS 0` .. `PASS 14`, `PANEL_RC=0`, and it reports `~/.orca is unchanged (absent before and after)`.

`verify:control` and the two formal ccloop gates were **not** rerun this round (no `/tmp` ccloop
artifact present). Their last numbers are older and must not be quoted as current.

After the ledger's own doc/comment edits: `typecheck` `TC_RC=0` and `npm --prefix web run check`
`13 files / 64 tests passed`, `WEBCHECK_RC=0`
(`test-logs/post-docs.log`; `test-logs/new6.log` is the focused 6-criterion pass of the new file).


## 3. Mutation battery (clone: `git clone --local` copy at `/tmp/orca-mut-0922`, main tree untouched)

Round 1 (`test-logs/mutations.json`, target
`tests/control/checkpointRecoverability.test.ts`):

- M1 conflate `continuable` with `completed` -- `rc=1`, 3 red (the three commit-time criteria).
- M2 drop the whole-snapshot requirement -- `rc=1`, 1 red:
  `refuses the bundle when the snapshot is gone, even though the run settled` (which asserts
  `recoverable === false` first). This is the §9.4:1467 mapping under the new vocabulary.
- M3 let acceptance finish an interrupted task -- **`rc=0`, survived**.
- M4 make the completion judgement the status driver again -- **`rc=0`, survived**.
- M5 refuse a bundle for an interrupted predecessor -- `rc=1`, 1 red (the continuation-bundle test).
- M6 serve evidence bytes without `nosniff` -- `rc=1`, 1 red (the panel criterion).
- Every step restored; `restored_clean: true` recorded per step.

Round 2, after fixing the test (`test-logs/mutations-round2.py`, results preserved as
`test-logs/mutations-round2.json`):

- M3 (delete `if(c.result!=="complete") return;` in `repairAcceptedWork`) -- `rc=1`, red on
  `does not let late acceptance finish a task that stopped short of its outcome`.
- M4 (`work.status=continuable && accepted`) -- `rc=1`, red on
  `does not complete an interrupted task's work at commit time, acceptance or not`.
- M7 (remove the split's `completed` expression) -- anchor hit 0, not run; the same fault is already
  covered by M4.

**Why M3/M4 first survived, and it is the lesson worth keeping:** the new criteria wrote their
acceptance outbox rows under invented ids (`acceptance-before-commit:<runId>`,
`acceptance-interrupted:<runId>`), while `acceptanceEvidence` looks the row up by
`id = 'acceptance:' || runId`. Nothing was ever found, so both criteria could only observe "nothing
happened" -- green for the right-looking reason and red for none. Fixed in
`test(control): put the acceptance rows where the store actually looks`. Rule 9's inference again: a
criterion whose setup writes to a key no reader uses is empty, and no amount of passing tells you.

## 4. Open items this round did not close

1. `does not call a checkpoint with missing evidence continuable` (added after the battery,
   `/tmp/orca-mut-0922/new6.log`: 6 passed) has **not been seen red**. The mutation that would kill it
   (`continuable = settled && !!c.snapshot`) was not permitted by the session's approval mode, and it
   was not retried. Anyone resuming: run it in a clone and put the log here.
2. spec §9.1 row "Estimator interrupted by stop", third clause ("requires a new estimate command
   rather than task continuation"): still no criterion. The production guard exists
   (`continuation.ts:155` refuses `work.kind !== "task"`), but reaching it with a real estimate needs
   estimate-side fixture work; the two candidates named this round (this row and "Handoff time
   limits") were traded against the assembly design, which the human had ranked first. That trade is
   the human's to judge, not mine.
3. spec §9.1 row "Handoff time limits": the absolute-deadline half is covered
   (`tests/control/stopIntent.test.ts:349-375` -- default `+30min`, saturation at the max instant, past
   deadline expiring, never extended by a later stop). The independent `activeMs` enforcement half
   lives behind the execution port, which is precisely what is unwired -- it belongs with the assembly
   slice, and that is a name, not a claim of coverage.
4. `tests/panel/fixtures/controlPanel.ts:229` still writes `recoverable: true` by hand into the run
   body with `snapshot: null`, which the derivation now refuses. Panel-level §6.3 criteria therefore
   still do not exercise `commitCandidate`'s judgement. Found while writing §11; not fixed here.
5. All eight assembly seams remain 0-caller in `src/` (re-measured this round,
   `commands/seam-census-0922.txt`); `acceptContextObservation` additionally has no producer for
   `ContextObservationV1` anywhere in `src/` -- that is a ccloop-side emit, recorded in the assembly
   spec §8.

---

## 5. Backfill (2026-09-22, session `2adcc8bb`, on commit `1f1bb0b` — §1–§4 above unchanged)

§4.1 is now closed. The mutation that §4.1 said had never been run was run, and both assertions of
`does not call a checkpoint with missing evidence continuable` were seen red — each against its own
guard, which is not what §4.1 assumed.

**Method.** `git clone --local` copy at `…/scratchpad/orca-mut-missing`, `node_modules` symlinked from
the main tree. The copy's `src/control/checkpoints.ts` and
`tests/control/checkpointRecoverability.test.ts` were proved byte-identical to the main worktree with
`cmp` before any edit (the worktree was clean at `1f1bb0b`, so the clone of committed state equals it).
Every mutation used an exact-full-line anchor with an asserted hit count of 1. Runs are unfiltered,
redirected to a file, read back whole; each log's first `RUN` line points at the copy, not the main tree.

| # | Mutation | Log | Result |
|---|---|---|---|
| 0 | none (baseline in the copy) | `test-logs/m-missing-0-baseline.log` | RC0, 6 passed |
| 1 | `checkpoints.ts:85` `continuable = settled && c.missing.length===0 && !!c.snapshot` → `settled && !!c.snapshot` | `test-logs/m-missing-1-checkpoints85.log` | **RC1, exactly 1 failed** — `:73` `expected true to be false` |
| 2 | M1 still applied, plus the criterion's **first** assertion elided in the copy (probe only) | `test-logs/m-missing-2-probe-unshadowed.log` | RC0, 6 passed |
| 3 | M1 + probe still applied, plus `resumeBundle.ts:82` `if (checkpoint.missing.length \|\| !checkpoint.snapshot)` → `if (!checkpoint.snapshot)` | `test-logs/m-missing-3-resumebundle82.log` | **RC1, exactly 1 failed** — `:74` `promise resolved … instead of rejecting` |

**What run 2 found, and why it matters.** With `checkpoints.ts:85`'s `missing` conjunct deleted and the
first assertion out of the way, the criterion's **second** assertion still passed. So the second
assertion is not shadowed duplication of the first, and it is not carried by `checkpoints.ts` at all:
`src/control/resumeBundle.ts:82` independently refuses a checkpoint with `missing.length`. The two
assertions pin two different guards — defence in depth that nobody had written down. Run 3 names and
kills the second guard on its own and observes it red, so neither assertion is now resting on the other.

⚠️ This corrects an assumption implicit in §4.1, which spoke of "the mutation" (singular) that would
kill this criterion. One mutation kills half of it. §4.1's text is left verbatim; this is the correction.

**Restore proof (main worktree, run after the battery).** `git diff` **0 bytes**, `git diff --cached`
**0 bytes**, `git status --porcelain` **0 bytes**, `HEAD` still `1f1bb0b`. Byte counts are from
`wc -c` on redirected files, not from eyeballing: `commands/m-missing-restore-diff.txt` and
`commands/m-missing-restore-diff-cached.txt` are both 0 bytes and are the artifacts themselves.
The copy was deleted with `/bin/rm -rf` (the local `rm -i` alias makes a bare `rm -rf` hang).

**Not measured here.** Nothing else was re-run; the round's counts in §1–§3 stand as they were, and
`verify:control` / `:consumer` remain not-run this session for want of a `/tmp` ccloop artifact.
