# Change-sized runs: a run's disk and step E time follow its change, not its repository (#363, #366, #364; R1, R5) — design

- **Who:**
  - First draft: a read-only design subagent (Claude Opus 5.5) spawned by the Orca control session on 2026-11-18. It read
    Orca `main` at `5220b1c1` and ccloop at the pin `dd491c1` (`/usr/bin/git -C ccloop show dd491c1:<path>`).
  - This revision: a second design subagent (Claude Opus 5.5), same session, 2026-11-18, after the independent review
    `/Users/biran/code/skills/orca/.review-363/review.md` and the controller's decisions on it (§16). It read Orca `main`
    at `b1f458c6`. `git diff --stat 5220b1c1 b1f458c6 -- src` touches only `src/commands/**`, `src/control/webService.ts`
    and `src/panel/controlApi.ts`, so every `src/control` line number cited here is the same at both commits.
  - No code was changed and no Orca or ccloop test was run. The only things executed were toy-repository git checks
    (Appendix A, and the review's `t1.out` / `t2b.out`).
- **Status:** design, not built. A person has to review it first. Changing the ccloop criteria listed in §11.2 needs the
  person to name each test (ccloop CLAUDE.md Rule 15, and its ruling 88: a blanket approval does not count); they are
  marked **awaiting human naming**.
- **Human ruling (2026-11-18, verbatim):** asked 「为什么要复制 git 仓库，是不是可以不复制？…大仓库也复制，在实际使用中是无法容忍的」,
  then approved the direction 「同意这样大改，并且同意改所有必要的判据」: the attempt result is kept as a ref in the target
  repository; archives store only what git does not hold; ccloop stops copying the tree; Orca stops checking out a
  workspace nobody uses.
- **Inputs:** `/Users/biran/code/skills/orca/.measure-363/report.md` and `results.md` (the copy chain and the measurements),
  the triage `.superpowers/sdd/2026-11-18-tester-pm/g2-runs-settle-storage.md` (R1, R2, R5, #363, #364, #366), and the
  review above.
- **Phases** (§13): **P0** Orca on the current pin `dd491c1`; **P1** ccloop; **P2** Orca repinned to P1. The first draft's
  P1/P2 ccloop split is merged into one P1 (review I8c), so its P3 is now P2.
- **Language:** English, per the repository convention (handoffs are in Chinese; specs are not).

---

## 1. Problem (measured)

Source: `.measure-363/results.md`, taken with `bin/measure.sh <repoL>` then `bin/extra.sh`, on Orca `5220b1c1` / ccloop
`dd491c1`, 2026-11-18 21:28–22:45. Machine: 10 CPUs, macOS 26.6.2, APFS, `/usr/bin/git` 2.50.1. Load average was 14–74
from other work, so the wall times are upper-range values. Repo L has 26,200 tracked files, 3,651 MiB tracked at HEAD,
a 1.33 GiB pack, and a checkout of 3,795,600 KB (`du -sk`).

| What | Today on repo L |
|---|---|
| Step E archive (bundle `--all` 5.7 s + one `cat-file` per index entry 958 s + publish each blob 1,622 s + publish each working-tree file again 1,222 s + re-hash 26 s) | **≈ 3,834 s ≈ 64 min**. This leaves out 2 × 26k SQLite transactions and `verifySnapshot`. The tester saw 43–49 min (`archive 2,886,689 ms`, triage #363). |
| Of that, the share that re-archives bytes the bundle already holds | ≈ 99.8 % (a C5b result repository has no untracked file, so pass (c) holds nothing git lacks) |
| Full trees written per run | C1 Orca workspace 3.8 GB (deleted at settle) + C3 attempt worktree 3.8 GB (transient) + C5 `<sourceDir>/repo` 3.8 GB (**never deleted**) |
| Residual disk per run after settle | ≈ **5.2 GB** (C5 3.8 GB + a fresh full-history bundle of 1.42 GB every run), plus 3.16 GB of unique blobs the first time per repository |
| Peak while a run is active | ≈ 11.4 GB of trees |
| Continuation (C7) / saved-result recovery (C8) | each writes the whole artifact closure again (≈ 4.6 GB, fsynced per file). Derived from the code, not run. |
| Hard caps that refuse repo L | saved-result recovery stops at 20,000 closure entries (`savedResultRecoveryPackage.ts:38`); ccloop's saved-result capture stops at 10,000 files (`executionFormatFailure.ts:70,75`) |
| The same steps done with refs (`results.md` rows 12a–12h) | `worktree add --no-checkout` 0.03 s / 4 KB; `update-ref` 0.02 s; `bundle create base..attempt` 0.04 s / **713 bytes**; `diff --stat base attempt` 0.03 s; `merge-tree --write-tree` 0.02 s (trivial merge only) |

Settles also share one global lane (R2, `executionDriver.ts:2010-2035`). One 64-minute settle therefore holds up every
project on the panel, so the per-repository cost becomes a whole-panel stall.

## 2. Goals and non-goals

**Scope of "time follows the change".** The human's ruling is about copying the repository. This spec makes **step E**
(archive and its verification) change-sized, and removes every **residual** repository-sized copy. It does **not** make a
whole run's time change-sized: step D still checks out the full tree once per landing, about **15–25 s on repo L**
(12–22 s `worktree add` + 3.1 s removal, `driverLanding.ts:347-349`). After P2 that is the largest remaining
repository-sized term, about 50–60 % of the remaining per-run git time (review I7). It leaves no residual disk and does
not cause the settle-lane stall. It is the subject of the next spec (§13, "Next spec").

**Goals (each checked by a command in §12):**

- G1. On the measured repository class, step E **including its snapshot verification** (`stepE_ms + verify_ms`) takes
  **≤ 10 s** for a small change, with a run directory of ≤ 100 log files. The measured small run had 68 log files
  (triage R1).
- G2. **No repository-sized residual per run.** In bytes (apparent sizes, never `du` blocks mixed with bytes):
  - the run's new artifact rows total exactly `logsBytes + changeBytes + metaBytes`, with `metaBytes ≤ 65,536`;
  - `<runsRoot>/<runId>` holds at most `logsBytes + 1 MiB` (its logs stay on disk: the driver path never deletes the
    source directory, `cleanupCommittedRun` is bridge-only, `cleanup.ts`; callers `schedulerBridge.ts:95`,
    `recovery.ts:78`);
  - `<workspacesRoot>` is empty after cleanup.

  `changeBytes` is the size of `git bundle create - <base>..<attempt>`; `logsBytes` is the sum of the archive manifest's
  log file sizes; `metaBytes` is the snapshot plus the archive manifest. So the logs are counted twice (on disk and
  archived), which is what the design leaves. The target repository additionally holds the attempt's own objects. That
  is git holding the change, which the human's direction wants, and §12 reports it separately.
- G3. Only one full checkout per attempt remains on the run path outside step D: ccloop's attempt worktree (C3). Orca's
  workspace (C1) and the result repository (C5) stop being checkouts.
- G5. Archived v1 runs stay readable by every reader (Results, accept-attempt, continuation, recovery). No run in flight
  across the upgrade is refused silently.

(The first draft's G4, change-sized saved-result capture and recovery caps, is deferred: N6.)

**Non-goals:**

- N1. **Sparse checkout of the attempt worktree (C3).** The agent, its setup commands and its verifier may read any path.
  Measured: a 5-directory cone took 0.29 s and 22.8 MB, so it is worth doing later, behind its own spec.
- N2. **Step D's transient full checkouts:** the landing worktree, the post-merge check, the reviewed-acceptance and
  group-acceptance worktrees, the integration check, and conflict copies. See §2 scope and "Next spec".
- N3. Automatic garbage collection of `refs/orca/runs/*`, of `refs/ccloop/*` (which also accumulates today), and of
  `panel/artifacts`. Each needs a human ruling (#366(d)).
- N4. The legacy scheduler path (`ccloop run`, `schedulerBridge.ts:74`, reconcile and integration-resolve clones
  `scheduler/ccloopRunner.ts:301-310`). It keeps the v1 result repository and the v1 snapshot.
- N5. Settle-lane parallelism (#363(b)), artifact publish dedup (#363(a)) and the staging sweep (#364). Complementary,
  specified separately. Once G1 holds, R2 stops mattering in practice.
- N6. **Deferred to a later spec (review C1, I8):**
  - ccloop's saved-result capture C9 (`captureWorktreeSnapshot`) and the exhausted / omp-without-final recovery bundles
    (`exhaustedCompletion.ts:170`, `ompWithoutFinal.ts:110`) stay **exactly as at `dd491c1`**: full closure,
    self-contained. Reason: their readers verify the bundle inside a freshly `git init --bare`'d repository
    (`savedResultRecovery.ts:195-201`, `changedPathsFromAttemptBundle` `:228-236`, called at `:369` and `:405`), which
    holds no base, so a range bundle fails `bundle verify` there ("Repository lacks these prerequisite commits",
    review `t1.out` D). They are off the normal run path, and on repo L C9 already refuses at 10,000 files, so leaving
    them adds no regression.
  - The git-level saved-result delivery check (`assertSavedResultDelivery` against a commit instead of
    `<sourceDir>/repo`). It is not needed: a saved-result recovery envelope never carries the key (§6.1), so its
    delivery sites keep their result repository.
  - G4: making the 20,000-entry recovery cap and the 10,000-file capture cap stop refusing large repositories.
  - `snapshot.dirs[]` (evidence for extra directories). Extras are **pinned** (clone-mode safety) but not snapshotted,
    as today.
  - The temporary alternates repository for the Results review diff (§5.5.2 reads the target or answers `diff: null`).

## 3. Controller decisions: what is kept and what is amended

| Decision | Kept? | Amendment (evidence in §14, §16) |
|---|---|---|
| D1 C1 not checked out | **kept** | In clone mode, `clone --no-checkout` leaves HEAD at the target's current branch tip, not at `base`. ccloop cuts attempts from repoPath's HEAD, so Orca must also run `update-ref --no-deref HEAD <base>` (Appendix A check 6; review `t1.out` A). Hardlinks are kept and `--shared` is rejected (O11). |
| D2 C3 the only checkout; attempt recorded as a commit; C5 decided | **kept; C5 disappears for key runs** | Live worktrees are recorded with a **temporary index**: the live index and HEAD stay untouched (Appendix A check 7; `t2b.out`). Recording and removing kept worktrees happens in the **control worker**, not in `runLoop`, so no runLoop criterion changes. "Ignored left out exactly as `skipIgnored`" is not what happens today without setup commands (O4). |
| D3 Orca takes ccloop's sha; git-only readers read commits; command readers get a temp worktree | **kept** | The attempt is pinned into the target at step C, not only at step E. After that every reader uses one repository handle, the target, in both modes. The pin is create-only (§5.3, review I3). |
| D4 snapshot v2 = ref + range bundle + logs | **kept** | Verification has two levels: artifact-level and repository-level. Several verify callers have no repository handle (O3). The snapshot keeps v1's `head` field and its meaning, so continuation semantics and the real-ccloop H1 criterion hold. |
| D5 accept / review / continuation / recovery read v2 | **kept** | The review diff needs no alternates repository (§5.5.2). C9 and the exhausted/omp bundles are not changed (N6). |
| D6 delete per-run copies at settle; no automatic ref GC in v1; Rule 17 register | **kept** | The deletion is ordered and resumable, the re-archive is skipped when an archive row exists, and recoverable settles delete too (§5.6). Retained attempt worktrees are excluded from the archived logs (O7). |
| D7 multi-directory: the same per extra directory | **kept, narrowed** | Extras are pinned; `snapshot.dirs[]` is deferred (N6). |
| D8 flag by feature key or envelope version | **kept, both** | The per-run switch is an **optional envelope key** (in-flight envelopes are frozen byte for byte). The feature key only tells Orca whether it may send it. Orca's `featuresSchema` (`ccloopPort.ts:254`) **and** its envelope `loopWorkSchema` (`schema.ts:73`) are `.strict()`, so Orca learns both keys in P0 (O6, review I4). |

## 4. The copy chain, before and after

"After" is the state once P2 (§13) ships, for a run whose envelope carries `attemptDelivery`. The legacy rows describe
runs whose envelope has no key (in flight across the upgrade, saved-result recovery runs, or a ccloop without the
feature).

| # | Before (`report.md` §1.1) | After | Who reads it | Deleted |
|---|---|---|---|---|
| C1 Orca workspace | full checkout at `base` (`workspace.ts:137` / `:140-141`); 3.8 GB, 12–29 s | **(P0)** `worktree add --no-checkout --detach` (0.03 s, 4 KB) / `clone --local --no-checkout` + `update-ref --no-deref HEAD <base>` (0.12 s, hardlinked packs). Contains only `.git`. | ccloop, as a git handle only (§5.1). Orca, as the repository that holds `refs/ccloop/<runId>/*` until step C pins the attempt. | at settle, as today (`cleanupRunWorkspace`, `workspace.ts:211-216`) |
| C2 skill snapshot | repo-independent | unchanged | ccloop agent | unchanged |
| C3 attempt worktree | full checkout per attempt (9 s, 3.8 GB). Removed after publish, **kept** at a handoff boundary, allowance park, `blocked_waiting_human`, or a failed removal. | **unchanged checkout; it is the only one.** Under the key, the worker records a kept worktree (§5.2) and removes it, and every older published leftover, before the lease is released. Only a removal failure leaves it, reported as `worktree:"retained"`. | agent, setup, verifier, ccloop capture | by ccloop (key); retained only on a failed removal |
| C4 attempt commit + refs | `refs/ccloop/run/attempts/<n>` + `refs/ccloop/<runId>/attempts/<n>`, only on published cleanup | the same commits, plus a commit for **every** kept worktree (temp index). **Plus Orca's pin `refs/orca/runs/<runId>`** in each written directory's target repository. | Orca step C onwards, accept-attempt, review, verify | `refs/ccloop/*`: never (as today). `refs/orca/runs/*`: never automatically (§5.6). |
| C5 `<sourceDir>/repo`, `repos/<key>` | full checkout, or a live `fs.cp` copy (39 s, 4.48 GB); **never deleted** | **not created** (key). Legacy-envelope runs: **(P0)** deleted once the archive that holds all of it is persisted (§5.6). | nobody (key). Legacy: step C `commitAttempt` and the pin fetch, then nothing. | §5.6 |
| C6 step E archive | bundle `--all` (1.42 GB) + every index blob + every working-tree file; ≈ 64 min | **snapshot v2:** one range bundle `base..refs/orca/runs/<runId>` (≈ change size) + snapshot JSON + archive manifest + logs (§7). **(P0)** logs no longer include attempt worktrees. | verify, accept, review, continuation export, recovery | never (artifact GC is out of scope, N3) |
| C7 resume bundle | every artifact of C6, fsynced per file; ccloop rewrites the whole tree twice | checkpoint + snapshot v2 + range bundle + logs. ccloop fetches the bundle and does **one** `worktree add` at the attempt (§5.5.3). | ccloop `materializeFirstWorkspace` | as today (in the new run's sourceDir) |
| C8 saved-result recovery package | closure of C6; refuses at 20,000 entries | closure of v2 (logs + capsule artifacts + bundle); the cap stays | ccloop saved-result recovery | as today |
| C9 ccloop saved-result capture | walks the whole attempt tree (refuses at 10,000 files) + `clone --local --no-hardlinks` + full-history bundle | **unchanged** (N6) | Orca recovery, ccloop verify | as today |
| new: check worktree `<workspacesRoot>/check-<runId>` | — (commands ran inside C5) | `worktree add --detach` of the target at the attempt, only for a debug reproduce-first check or a criteria-base re-run (§5.3) | `checkReproduction`, `runChecksAtBase` | after the verdict, and on restart before it is recreated |

## 5. Design per decision

### 5.1 D1 — Orca's workspace is a git handle, not a checkout (P0)

`ensureWorkspace` (`workspace.ts:130-142`):

- `worktree`: `git -C <targetRepo> worktree add --no-checkout --detach <path> <base>`.
- `clone`: `git clone --local --no-checkout <targetRepo> <path>`, then `git -C <path> update-ref --no-deref HEAD <base>`.
  Without the second command, HEAD is the target's current branch (Appendix A check 6: HEAD was `later`, not `base`;
  review `t1.out` A), and ccloop's `worktree add --detach <path>` without a start point (`worktreeManager.ts:27`, called
  with no start point unless a capture mode froze one, `runLoop.ts:1941-1948`) would cut the attempt from the wrong
  commit.
- The reuse check `checkedOutAt` (`:122-127`) still works: `rev-parse --show-toplevel` answers the path (check 1). A
  clone left by a crash between the two commands has HEAD ≠ `base` and is rebuilt.
- Multi-directory extras use the same function (`executionDriver.ts:601-602`).
- No `-c gc.auto=0` is needed here: neither `worktree add` nor `update-ref` starts an automatic gc.

**Every Orca use of the workspace** is creation (`executionDriver.ts:512`, `:602`), the envelope (`:525`, `:621`,
`:2473`), or deletion (`:751`, `:1677`, `:1699`, `driverHandoff.ts:182`). Skills injection reads nothing from it
(`:664-693`). Flows and vault runs go through the same `ensureWorkspace` (review, verdict on P0).

**Every ccloop use of `repoPath` at `dd491c1`** (all 68 `git grep repoPath` hits re-checked by the review, including
`runLoop.ts:470` for extras and `resumeLoop.ts:173-182`) is a git object/ref operation or a worktree add/remove:

| Use | Where | Works without a checkout? |
|---|---|---|
| `worktree add --detach <wt> [startPoint]` | `worktreeManager.ts:27`, `:187` | yes (check 2: files present, HEAD = base) |
| `rev-parse HEAD^{commit}` (initializedBase) | `runLoop.ts:1942` | yes (check 3) |
| `fetch <bundle> HEAD` (continuation), `rev-parse FETCH_HEAD` | `materialize.ts:163` | yes (check 5) |
| `rev-parse <ref>`, `^{tree}`, `^`, `diff --name-only`, `ls-tree`, `bundle list-heads` | `resultRepository.ts:95,132`; `verifySavedResult.ts:101-104`; `savedResultRecovery.ts:411-415`; `savedResultEvidence.ts:144-146,173-178` | yes (object-store and ref reads) |
| `clone --no-checkout <repoPath>` (legacy C5b) | `resultRepository.ts:25,96` | yes (check 4) |
| `worktree remove --force <attempt>` | `worktreeManager.ts:169`, `runLoop.ts` (12 sites), `resumeLoop.ts:181` | yes |
| `rev-parse --git-common-dir` (accept) | `protocol.ts:455-462` | yes (check 4b) |
| realpath disjointness | `protocol.ts:473,487` | path only |

**One trap, for the implementer's notes:** a `--no-checkout` worktree has an **empty index** (check 1: `ls-files` = 0),
so `git status` inside C1 reports every path as deleted. Nothing runs `status` or `diff-index` in `repoPath` today.
Nothing may start doing so.

**Not chosen:** removing C1 entirely by giving ccloop `base` explicitly (O10).

### 5.2 D2 — ccloop records every attempt end as a commit; no result repository (P1)

All of the following applies **only when the v4 envelope carries `work.attemptDelivery: "ref-v1"`** (§6.1). Without the
key, ccloop behaves byte for byte as at `dd491c1`.

1. **Published attempts:** `publishAttemptCommit` is unchanged (`worktreeManager.ts:137-166`). `bindExhaustedCandidate`
   and `bindOmpWithoutFinal` are unchanged, bundles included (N6).
2. **Kept worktrees.** Today a worktree is kept at a handoff boundary (`persistHandoffBoundary`, `runLoop.ts:1803-1807`),
   at an allowance park (`:1808-1822`), at `blocked_waiting_human` (`scheduler/harvest.ts:125-131` documents it), and
   after a failed removal (`status:"retained"`, `:600-610`). These are recorded in the **control worker**, at the point
   where `materializeResultRepository` is called today (`control/worker.ts:403-405`, inside
   `onRunSettledBeforeLeaseRelease`, under the lease). For `<runDir>/worktrees/attempt-<currentAttempt>` when it exists:
   - refuse while skills are pending (the `codexSkillsPendingPath` check, `worktreeManager.ts:139-142`); the record then
     says `reason:"skills-cleanup-pending"` and nothing is published, which matches today's base-only materialisation
     (`resultRepository.ts:85-89`);
   - copy the worktree's index to `<runDir>/attempt-record.index` (0600). With `GIT_INDEX_FILE=<that>`, run `git add -A`
     and `git write-tree`, then `git commit-tree <tree> -p HEAD` with `ATTEMPT_IDENTITY` and
     `attemptCommitMessageArgs(ref, goal)` (`worktreeManager.ts:42`, `:53-59`). Then `update-ref` both names
     `attemptRefNames` gives (`:120-123`), verify `rev-parse <ref> == sha` and `sha^{tree} == tree`, and delete the temp
     index. The worktree's own index and HEAD are untouched (Appendix A check 7; review `t2b.out`: index digest and
     status unchanged);
   - then `cleanupAttemptWorkspace` (`worktreeManager.ts:168-170`). A failure leaves the worktree, records
     `worktree:"retained"`, and appends `attempt_record_failed` / `workspace_cleanup_failed`;
   - extras: the same for each `<runDir>/dirs/attempt-<n>/<key>`, merged into `run/attempts/<n>/commits.json` (read by
     `collect.ts:160-180`), then `removeEmptyExtraDirs`.
   - **Older retained leftovers** (review minor 7): every `<runDir>/worktrees/attempt-<m>`, `m < currentAttempt`, is a
     published attempt whose removal failed. Under the key the worker removes each one whose
     `refs/ccloop/<runId>/attempts/<m>` exists and equals its HEAD; any other is left and reported `retained`.
     `settleLostWorker` already iterates all of them.
   - **No event on success.** 17 criteria pin `events.jsonl` sequences (`runLoop.ts:580-584`). A failure event appears
     only in key runs, which no existing criterion uses.
   - **Why the worker and not runLoop:** runLoop criteria pin the kept worktree (`runLoop.integration.test.ts:3447`,
     `:3589`; `leaseLifecycle.integration.test.ts:1980`; `allowanceContinuation.test.ts:22`;
     `verifySavedResult.test.ts:171`, `:185`). The worker is the control path only, so none of them changes.
3. **No result repository:** under the key, neither `materializeResultRepository` nor
   `materializeExtraResultRepositories` runs in the worker's non-saved-result branch (`worker.ts:403-405`) or in
   `settleLostWorker.ts:110-111`. `settleLostWorker` records kept worktrees the same way before its cleanup
   (`settleLostWorker.ts:108`). `copyLiveWorkspace` remains only for legacy envelopes.
   **Saved-result delivery sites are untouched** (review I4): `worker.ts:396-397`, `worker.ts:431`,
   `settleSavedResult.ts:85`, `settleSavedResult.ts:100`, `verifySavedResult.ts:161`. All five run only for
   `mode: "verify-saved-result"` envelopes, and the schema refuses the key beside `mode` on both sides (§6), so they
   keep their result repository and their tree walk. (`verifySavedResult.ts:161` silently skips the delivery check when
   `<sourceDir>/repo` is ENOENT; that is why no key may ever reach a saved-result envelope.)
4. **What the commit holds:** tracked changes and untracked non-ignored files, because `add -A` honours `.gitignore`.
   Ignored files are left out (review `t2b.out`: ignored `x.log` absent). This equals today's rule **for tasks with
   setup commands** (`skipIgnored`, `resultRepository.ts:31-41`). For a kept worktree **without** setup commands,
   today's live copy carries ignored files (`:91`), and v2 does not (O4).
5. **C5 is gone rather than a no-checkout clone.** A `clone --no-checkout` of a linked worktree hardlinks the target's
   packs, so after the target repacks, every such clone that still exists holds the old pack's bytes (≈ 1.33 GiB on
   repo L).

### 5.3 D3 — Orca's step C takes ccloop's sha, pins it, and every reader reads the target (P2)

**Attempt and its repository** (replacing `executionDriver.ts:1117-1155`; multi `:1140-1148`):

- Key run: `attempt = report.attempt` (§6.1). The attempt repository `R` is C1 (`workspaceOf(drive)`). For extras,
  `report.dirs[i].attemptSha` (already collected, `collect.ts:151-180`) in that directory's workspace.
- Legacy-envelope run: first `head = rev-parse HEAD` in `<sourceDir>/repo`, recorded on the drive record
  (`drive.attemptHead`), then `attemptSha = commitAttempt(<sourceDir>/repo)` exactly as today (`workspace.ts:149-156`),
  and `R` is C5. So for `source:"orca-commit"`, `head` is C5's HEAD before the commit: equal to the attempt for a clean
  C5b, the attempt's parent for a dirty C5a (review minor 1). This keeps in-flight runs working (§5.8).
- **Checks before use** (all git, in `R`; each failure blocks C by name): `rev-parse --verify <sha>^{commit}`
  (`attempt-missing`); `merge-base --is-ancestor <base> <sha>` (`attempt-not-from-base`). Key runs also check
  `<sha>^{tree} == attempt.tree` (`attempt-tree-mismatch`) and `rev-parse refs/ccloop/<runId>/attempts/<n> == sha`
  (`attempt-ref-mismatch`).
- **Pin (new, idempotent, create-only)** — `pinAttempt(targetRepo, R, runId, sha)` (review I3):
  1. if `git -C <targetRepo> rev-parse -q --verify refs/orca/runs/<runId>` answers `sha`, done;
  2. if `cat-file -e <sha>^{commit}` fails in the target (clone mode, legacy C5), run
     `git -c gc.auto=0 -c maintenance.auto=false -C <targetRepo> fetch --no-tags <R> <sha>` — **no destination**, so
     only `FETCH_HEAD` is written. A plain refspec fetch is not used: a non-forced fetch silently fast-forwards an
     existing ref to a descendant (review `t1.out` C, rc 0);
  3. `git -C <targetRepo> update-ref refs/orca/runs/<runId> <sha> ""` — the empty old value makes it **create-only**;
  4. if step 3 fails and the ref now holds a different sha, answer `run-ref-conflict` (never forced); if it holds `sha`
     (a concurrent pin), done; anything else blocks by git's own words.

  The write records `drive.runRef = { ref, sha }` (and per dir `dirs[i].runRef`). Pinning at C rather than at E is what
  makes clone mode safe: `refs/ccloop/*` die with C1 at cleanup (`report.md` §1.2).
- **Readers after the pin use the target** (or each dir's `targetRepo`): `boundedHarvest(…, targetRepo)`
  (`harvestBound.ts:45`); `classifyCriteriaChange(targetRepo, …)` (`executionDriver.ts:1184`,
  `driverLanding.ts:311-312`); no-change tree ids (`executionDriver.ts:1208-1219`); landing:
  `update-ref refs/orca/incoming/<runId> <sha>` in the target replaces the fetch (`driverLanding.ts:422`, `:679-683`);
  archive (§5.4).
- **Commands get a check worktree** (debug reproduce-first `executionDriver.ts:1160-1173`; criteria-base re-run
  `:1181-1196`; restart `stepDebugCheck` `:1310-1325`). `checkPathOf(roots, runId) = <workspacesRoot>/check-<runId>`
  (a direct child, so `assertOwnPath` holds). Sequence: `removeOwnPath`, then
  `git -C <targetRepo> worktree add --detach <check> <sha>`, then `snapshotWorkspace(check, setup)`, then
  `checkReproduction` / `runChecksAtBase` with `workdir: check`, then `removeOwnPath` after the verdict. On restart the
  path is removed and recreated, not restored. The persisted marker keeps its schema (`debugRepro.test.ts:243`). Setup
  commands still run first (`runSetup`). Cost on repo L: one 12–22 s checkout per such check, transient (N2 class).
  - **Isolation change, named** (review minor 6): in worktree mode the check worktree is a linked worktree of the
    person's repository, so a check command that runs git can write the target's refs. C5 was a separate clone and
    isolated them. The post-merge check worktree is the existing precedent. Accepted; listed in §9.
- **Every new git command Orca runs in the person's repository** (pin fetch, `update-ref`, `bundle create`,
  `bundle verify`, the check `worktree add`) carries `-c gc.auto=0 -c maintenance.auto=false` (review minor 5), so Orca
  never starts a gc or maintenance there. The existing landing fetch is left as it is (N2).

### 5.4 D4 — step E: snapshot v2 (P2)

`archiveRun(store, { runId, sourceDir, stopProof, repositories })`, where `repositories` is
`[{ key: null | string, targetRepo, base, attempt: oid | null, head: oid, source }]` (primary first; extras only pin,
N6). The v1 signature (`repoDir`) stays for the legacy scheduler bridge only (`schedulerBridge.ts:74`, N4).

1. **Logs:** `captureTree(sourceDir, "", missing, deps, [repo, repos, run/worktrees, run/dirs, …TASK_RESULT_SOURCE_EXCLUSIONS])`
   (`archive.ts:200`). The `run/worktrees` and `run/dirs` exclusions ship in **P0** (§5.6, O7). Nothing is added to the
   manifest for them (review minor 2: the first draft's `retained` field is dropped): the content of the current
   attempt is in the snapshot, and an older retained attempt is a published commit, like every earlier attempt whose
   removal succeeded.
2. **Per repository:**
   - `pinAttempt` again, which is a no-op when step C pinned. Failure paths that never ran C (`:1088`, `:1698`,
     `:2273`, `:2423`; `driverHandoff.ts:406`, `:550`) pin here from C1, before cleanup.
   - `attempt === null`: `snapshot.attempt = base`, `bundle = null`, `source: "base"`, plus `missing` per §8.
   - Otherwise `git -c gc.auto=0 -c maintenance.auto=false -C <targetRepo> bundle create <staging>/<uuid>.bundle <base>..refs/orca/runs/<runId>`,
     then `archiveFile` once, then delete the staging copy in `finally` (the D6 rule of `snapshot.ts:45-51`).
     `attempt === base` gives no bundle: git refuses an empty one (check 8, exit 128; `t2b.out`).
   - Missing evidence kept from v1: one `ls-tree -r -z <attempt>` → every `160000` entry is `submodule:<path>`; LFS:
     `diff --name-only -z <base> <attempt>`, then one `cat-file --batch-check` and `--batch` over the changed blobs under
     1,024 bytes → `lfs-pointer:<path>` (narrowed from v1's every-file check, `archive.ts:174`).
3. `snapshot-<sha256>` (schema §7) and the archive manifest `{version:1, runId, sourceIdentity, logs, snapshot, missing}`
   (shape unchanged; ccloop's `refuseRecoveryCheckpoint` reads `version:1` and `snapshot`, `materialize.ts:85-100`). The
   outbox row keeps its keys with `repoDir: null` (`cleanupCommittedRun`, `cleanup.ts:10-36`, reads only `sourceDir`,
   `runsRoot`, `sourceIdentity`).

Cost: one ref write, one range bundle, one `ls-tree`, one `diff`, three artifacts plus logs.

**What a ref + range bundle cannot carry, and why that is acceptable:**

| Lost | v1 carried it when | Why acceptable / how kept |
|---|---|---|
| ignored files | live copies without setup (C5a) | regenerable; a landing never carries them; setup tasks dropped them since 2026-11-04 I2. **Behaviour change** for no-setup handoff and park continuations (O4). |
| permission bits other than 644/755 | live copies only | a landing never carries them |
| empty directories | live copies only | git never lands them |
| index split (staged/unstaged, intent-to-add, unmerged stages) | v1 index list (`snapshot.ts:28`) | nothing downstream reads it. Continuation reproduces HEAD + dirty tree with `reset --mixed` (§5.5.3; `t2b.out`: a staged path comes back untracked, O9). |
| availability when `base` is gone from the target | v1 was self-contained (full bundle) | **deliberate loss** (O3, risk 1), narrower than the first draft said: the pins keep `base` reachable (§5.6). Named failures in §8. |
| symlinks, untracked non-ignored files | — | **carried** |

### 5.5 D5 — readers of v2 (P2 Orca; P1 ccloop)

1. **accept-attempt.** `prepareAcceptAttempt` (`acceptAttempt.ts:71-82`) dispatches on `version`: v1 unchanged; v2 runs
   `verifySnapshotInRepository` (§7.2). The driver (`acceptAttemptDriver.ts:131-160`) for v2: `ensurePinned` (ref at the
   attempt; else the §5.3 pin from the target's own object if present; else fetch the bundle artifact, via a staging
   file, into `FETCH_HEAD` and pin create-only; `base` must exist, or it is `snapshot-base-unavailable`). Then
   `attemptSha = snapshot.attempt`: **no rebuild**. Harvest and classify run on the target; `mergeOnTip` sets
   `refs/orca/incoming/<runId>` with `update-ref` (`:191`). `restoreSnapshotAttempt` (`:334-393`) stays for v1.
2. **Results review diff** (`panel/attemptReview.ts:41-52`). v2: if `git -C <target> cat-file -e <attempt>^{commit}`
   succeeds (the ref, or objects a deleted ref left until a gc), run `diff --shortstat` / `--stat=120 <base> <attempt>`
   there. Otherwise answer `diff: null` with the reason (`attempt-objects-unavailable`). No alternates repository
   (review I8b). On repo L that is 0.03 s, against 42 s + 3.8 GB today.
3. **Continuation.**
   - Orca: `exportResumeBundle` (`resumeBundle.ts:88-162`) parses the snapshot by version. The closure is the
     checkpoint, its logs, snapshot v2 and the bundle. Manifest `protocol: 1` and its shape are unchanged.
   - ccloop (P1): `materialize.ts` accepts `version: 2`, then:
     1. write the bundle to `<runDir>/continuation-repo.bundle`;
     2. `git fetch -q <bundle> refs/orca/runs/<predecessor>` into `repoPath` (FETCH_HEAD only; `base` is there because
        the continuation keeps its predecessor's base, `executionDriver.ts:510`), and check `FETCH_HEAD == attempt`;
     3. `createAttemptWorkspace(repoPath, runDir, 1, attempt)`;
     4. **when `source` is `ccloop-live`**, `git reset -q --mixed <head>`, so that HEAD and the dirty tree are what v1
        restored;
     5. verify: `rev-parse HEAD == head`; a temp-index `add -A` + `write-tree` equals `tree`.

     Review `t2b.out` ran exactly this in a fresh clone-mode C1: `FETCH_HEAD == attempt`, `HEAD == head`, temp-index
     tree == tree. The real-ccloop criterion H1 (`handoffE2E.test.ts:31`, line 77) holds unchanged.
4. **Saved-result recovery of a v2 source.**
   - Orca `recoveryClosure` (`savedResultRecoveryPackage.ts:36-58`) gains an explicit `snapshot-` `version:2` branch:
     visit `bundle` without expanding. Needed so a v2 archive can be packaged at all; the 20,000 guard (`:38`) stays.
   - Orca `sourceRecord` (`savedResultRecovery.ts:43-47`) names `authorityKind: "legacy-published-candidate-v2"`.
     ccloop (P1) validates it in git **in the recovery run's `repoPath`** (a handle on the target, so `base` is
     present), never in an empty bare repository (review C1): `bundle verify`; `list-heads` is exactly
     `<attempt> refs/orca/runs/<source>`; `attempt^ == base` or `attempt == head`; the index is derived from
     `ls-tree -r attempt`.
   - C9, the exhausted and omp bundles, and the delivery check are unchanged (N6).

### 5.6 D6 — what is deleted, and when

**The rule:** a per-run copy is deleted only when something durable holds all of it, and only after the run's last
ccloop control call. For `<sourceDir>/repo` that durable thing is a **complete** archive: the run's latest archive row
has `missing: []` and a non-null `snapshot` (a v1 snapshot holds the full bundle, the index and every working-tree file;
a v2 snapshot plus the pin holds the commit).

**`removeResultCopies(store, runId, sourceDir, { extras })` (P0)** — one helper, beside `cleanupCommittedRun` whose guard
set it reuses (`cleanup.ts:16-24`):

| Check | Outcome |
|---|---|
| no archive row for `runId` | throws `result-copy-unarchived` (every call site archived first; absence is a broken invariant) |
| latest row's `missing` non-empty or `snapshot` null | **keeps** the copies; returns `{ removed: [], kept: "archive-partial" }` |
| run state not terminal (`isTerminalRunState`, `budget.ts:65`) | throws `result-copy-run-active` |
| `basename(sourceDir) !== runId`, or `realpath(sourceDir) !== row.sourceDir`, or the `lstat` identity (dev, ino, birthtime) differs from `row.sourceIdentity` | throws `cleanup-path-invalid` / `cleanup-source-reused` |
| `<sourceDir>/repo` (and, with `extras`, `<sourceDir>/repos`) absent | nothing to do (idempotent) |
| present but a symlink or not a directory | throws `cleanup-path-invalid`; nothing removed |
| otherwise | `rm -r` the directory; returns the removed paths |

The terminal-state check matters beyond tidiness: ccloop's `recoverSavedResultEntry` silently skips its delivery check
when `<sourceDir>/repo` is ENOENT (`verifySavedResult.ts:161`). A terminal run gets no further ccloop control call.

**Call sites and order (P0):**

| Path | Order (each step idempotent; a crash anywhere resumes from the top) |
|---|---|
| step E, succeeded (`executionDriver.ts:1676-1683`) | archive (only while `landed`, `:1599`) → commit → publish → `cleanupRunWorkspace` → extras → **`removeResultCopies({extras:true})`** → write `cleanedUp:true`. A crash after the removal repeats publish (idempotent), the workspace cleanup (idempotent) and the removal (absent ⇒ nothing), then writes `cleanedUp`. Writing `cleanedUp` before the removal would strand C5 for ever, so it is the last write. |
| `stepCleanupFailed` (`:1692-1708`; review I1) | **skip `archiveRun` when an archive row for the run exists** (failed terminals are archived at C, `:1088`; recovery-mode runs are not, and keep their archive here) → `cleanupRunWorkspace` → extras → **`removeResultCopies({extras:false})`** → `cleanedUp:true`. Without the skip, a crash after the removal makes every later round throw ENOENT in `archiveRun`'s `realpath(repoDir)` (`archive.ts:189`) and leaves `cleanupError` set for ever. |
| recoverable settles: `settleTokenAllowance` (`:2265-2287`), `settleCeilingStopOnce` (`:2373`; orphan `:2419-2421` and normal `:2423-2428`), `settleHandoffCheckpoint` (`driverHandoff.ts:545-588`) (review I2) | after the settle's transaction has committed and the run is in a terminal state: **`removeResultCopies({extras:false})`**. A failure is written to stderr (`orca-driver: <runId>: result copy kept: …`) and never changes the settle's answer; `cleanupPredecessor` retries it. |
| `cleanupPredecessor` (`:747-757`) | `cleanupRunWorkspace` → **`removeResultCopies({extras:false})`**; a failure joins the existing `cleanupError` on the predecessor. A backstop for runs settled before P0 and for a failed removal above. |
| `settleAbandonedUnderStop` (`driverHandoff.ts:400-416`) | archive → `removeNeverStartedWorkspace` → **`removeResultCopies({extras:false})`** → the write that sets `cleanedUp:true`; a failure joins `cleanupError`. |

**Why the recoverable settles delete at once, not "while a continuation can still use it"** (resolution of review I2,
§16): no continuation reads `<sourceDir>/repo`. Orca continues from the archive (`exportResumeBundle`, `resumeBundle.ts`
reads only the checkpoint's artifacts; `continuationBundle` `executionDriver.ts:734-740`), and ccloop materialises from
the resume bundle (`materialize.ts:134-166`). Accept-attempt and saved-result recovery read the archive too (the only
`"repo"` readers in `src/control` are step C/D sites `executionDriver.ts:1132-1317`, `driverLanding.ts:311,422,679`,
all before settle). Deleting at the settle covers every later way a recoverable run stops being continuable (group
archived, run closed, superseded) with no new call site.

**Why `repos/` only at step E:** the v1 archive has no snapshot of extra directories (`archive.ts:197-200`), so for a
multi-directory run that did not land, `repos/<key>` is the only copy of the extra's result. At step E every extra's
attempt is landed in its target (or the run is no-change). P2 pins every extra before its copy goes.

**Retained attempt worktrees** (`<sourceDir>/run/worktrees/attempt-<n>`, `run/dirs/...`) are ccloop's, registered in the
target (worktree mode) or in C1. P0 only stops archiving them as logs (O7). They are removed by ccloop under the key
(P1, §5.2.2).

**P0 disk, stated per case** (predicted from the measured rows; the P0 acceptance in §12 measures the workspace part):

| Run kind (repo L) | Today after settle | After P0 |
|---|---|---|
| succeeded or failed, complete archive | C5 3.8 GB + 1.42 GB bundle + logs (+3.16 GB unique blobs once per repository) | **1.42 GB bundle + logs** (+3.16 GB once). C1 never held files. |
| allowance / ceiling / handoff (recoverable), complete archive | C5 3.8 GB + C1 3.8 GB until continued + kept C3 3.8 GB + 1.42 GB + logs | **kept C3 3.8 GB** (ccloop's, until P1) + 1.42 GB + logs. C1 ≈ 4 KB until continued or superseded. |
| any run whose archive is partial (`missing` non-empty) | as above | **C5 kept, 3.8 GB, by design** (the archive does not hold all of it) |
| multi-directory, not landed | `repos/<key>` per extra | `repos/<key>` kept (no extra snapshot until N6) |

Step E time is **unchanged** in P0 (≈ 64 min on repo L), except that a handoff or park run no longer publishes its kept
worktree file by file as logs (O7). Peak while active: 11.4 GB → about 7.6 GB (C3 + C5 during the settle).

**Refs, v1 (P2):** no automatic GC of `refs/orca/runs/*`. They are excluded from Orca's views (`corrections/gitState.ts:193`).
A person can list them with `git for-each-ref --format='%(refname) %(objectname) %(creatordate:iso)' refs/orca/runs/` and
delete one with `git update-ref -d refs/orca/runs/<runId>`. Deleting one degrades that run's Results to `diff: null`
once a gc prunes the objects; accept, continuation and recovery still work from the bundle while `base` exists.

**What the pins protect, and what they do not** (review minor 4; `t1.out` F: the person deleted the branch and ran
`gc --prune=now`; `base` survived until the pins were deleted):
- they keep `base` reachable through the attempt's ancestry, so a rebase or branch deletion followed by gc does not
  lose it;
- `base` is lost by: deleting the pin and then a gc; `git filter-repo` (rewrites `refs/orca/*` too); a re-clone; a
  `fetch --prune` with a `+refs/*:refs/*` mirror refspec (deletes local `refs/orca/*`);
- exposure: a person's `git push --mirror` publishes the pins. Orca itself pushes only explicit refspecs
  (`integrationGit.ts:158`), and a plain `git push` does not send them.

### 5.7 D7 — multi-directory groups (P2)

- Extra C1s are no-checkout (§5.1, P0). ccloop records and removes the extra worktrees under the key (§5.2.2). Orca takes
  `dirs[i].attemptSha` for key runs, or `commitAttempt(repos/<key>)` for legacy ones, checks it as in §5.3, and pins
  `refs/orca/runs/<runId>` in **each directory's target** (`dirs[i].runRef`).
- No `snapshot.dirs[]` (N6). Extras have no snapshot, as today. Unchanged refusals: multi continuation
  (`executionDriver.ts:470`), multi saved-result recovery (`:466`), multi accept-attempt (`acceptAttempt.ts:100`).
- A legacy multi run's `repos/` goes at settle in P2 once every extra is pinned.

### 5.8 D8 — migration

| Combination | Behaviour |
|---|---|
| Orca P0 + ccloop `dd491c1` | no-checkout C1, `<sourceDir>/repo` deleted under §5.6, v1 archive without attempt worktrees in its logs. Orca's schemas know `attemptRef` / `attemptDelivery` but never send the key. No protocol change. |
| Orca P2 + ccloop without `features.attemptRef` | A2 sends no key: a legacy-envelope run. C5 exists; Orca commits it, pins it from C5, archives v2 and deletes C5 at settle. Continuation and saved-result recovery **of a v2 predecessor** are refused by name at A2 (`resume-predecessor-snapshot-v2-unsupported`, `saved-result-source-v2-unsupported`), because that ccloop cannot read v2. |
| Orca P2 + ccloop P1 | A2 sends the key on every protocol-4 loop envelope **except** `mode: verify-saved-result` (`stepA2Multi` too; the rebuilt saved-result envelope `:2473-2477` never carries it). The full path. |
| A run whose A2 ran before the upgrade | its stored envelope (no key) is re-sent byte for byte (B and B′, `executionDriver.ts:843-856`): legacy path |
| A ccloop that advertises the key under an Orca older than P0 | `featuresSchema` would refuse the whole answer (`control-response-invalid`, `ccloopPort.ts:254-262`). Avoided by order: P0 teaches Orca the key; Orca pins ccloop, so no ccloop newer than the pin talks to an Orca until the P2 repin (review I8c). |
| Orca rolled back from P2 to P0 or P1-repinned Orca | P0's `loopWorkSchema` parses stored P2 envelopes that carry `attemptDelivery` (`savedResultRecovery.ts:37`, `dispatch.ts:52`, `startEnvelope.ts:143,162`). v2 archives are not readable by a P0 Orca; that rollback is refused by name, not silently (a v2 snapshot fails v1 `snapshotSchema` parsing). |
| v1 archives | every reader dispatches on `version`. v1 code paths are kept (`snapshot.ts`, `restoreSnapshotAttempt`, ccloop `materialize.ts` v1). |

## 6. Protocol, collect and envelope changes

### 6.1 ccloop (P1)

- **Envelope:** `loopWorkSchema` and `nullableLoopWorkSchema` (`protocol.ts:300-322`, `:339-347`) gain
  `attemptDelivery: z.literal("ref-v1").optional()`, refined to protocol 4 only and **refused beside `mode`**
  (`attempt-delivery-with-saved-result`). Absent means the envelope parses and hashes exactly as before.
- **Collect** (`collect.ts:32-103`, assembled `:297-345`): a new top-level `attempt?: AttemptRecordV1`, present iff the
  key is present and there is a terminal state or a sealed boundary candidate.

```ts
type AttemptRecordV1 =
  | { attempt: number;            // >= 1
      sha: string; base: string;  // base = the attempt worktree's start HEAD
      tree: string;               // sha^{tree}
      ref: string;                // refs/ccloop/<runId>/attempts/<n>
      head: string;               // the worktree HEAD when captured: sha (published) or base (live)
      capture: "published" | "live";
      worktree: "removed" | "retained" }
  | { attempt: number;            // >= 0
      sha: null; reason: "not-started" | "skills-cleanup-pending" | "record-failed"; detail?: string };
```

  `dirs[]` (`CollectedDirV1`) is unchanged. `resultRepo: "repos/<key>"` stays as a constant even though nothing is
  materialised under the key, so Orca's collect schema does not move.
- **Features** (`command.ts:317`, `:369`): `attemptRef: "v1"`, advertised in the same P1 once producers and readers
  exist.
- **`docs/control-protocol-v1.md`**, section "Continuation and result repository": a Correction paragraph appended (never
  an edit) saying that under `attemptDelivery` there is no `{sourceDir}/repo`, and that the archival source is the
  recorded attempt commit.

### 6.2 Orca

- **P0:** `featuresSchema` (`ccloopPort.ts:254`) gains `attemptRef: z.literal("v1").optional()` (O6).
  `loopWorkSchema` (`schema.ts:73`) gains `attemptDelivery: z.literal("ref-v1").optional()`, and `startEnvelopeSchema`'s
  refinement refuses it on protocol 3 (`attempt-delivery-requires-protocol4`) and beside `mode`
  (`attempt-delivery-with-saved-result`) — the same rules as ccloop's. Nothing sends it in P0.
- **P2:** `toStartEnvelope` puts `attemptDelivery: "ref-v1"` into loop work when `readFeatures().attemptRef === "v1"` at
  A2 and the envelope has no `mode`. `ExecutionReport` gains `attempt` (`ccloopPort.ts:349` mapping, strict).
  `terminal.repoDir` is `null` for key runs. `DriveRecord` gains `runRef: { ref, sha } | null`, `dirs[i].runRef`, and
  `attemptHead` (legacy runs). Run bodies are JSON, so no control-store migration is needed.
- **P2:** `ORCA_SETTLE_SLOW_MS` is read where driver deps are assembled and feeds `settleSlowMs` (`executionDriver.ts:154`,
  `:1548`), so A3 can print every settle. The default stays 5,000.

## 7. Snapshot v2 (P2)

### 7.1 Schema

```ts
const oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const snapshotV2Schema = z.object({
  version: z.literal(2),
  objectFormat: z.enum(["sha1", "sha256"]),
  base: oid,              // drive.base
  attempt: oid,           // ccloop's attempt commit, Orca's legacy commit, or base when there is none
  tree: oid,              // attempt^{tree}
  head: oid,              // the worktree HEAD at capture (v1 meaning): attempt for ccloop-published; attempt^ for
                          // ccloop-live; C5's HEAD before commitAttempt for orca-commit (§5.3); base for "base"
  ref: z.string().regex(/^refs\/orca\/runs\/run-[A-Za-z0-9-]+$/),
  source: z.enum(["ccloop-published", "ccloop-live", "orca-commit", "base"]),
  bundle: artifactSchema.nullable(),   // `git bundle create <base>..<ref>`; null iff attempt === base
  missing: z.array(z.string()),        // the archive's missing list, as v1 stores it (snapshot.ts:63)
}).strict();
```

### 7.2 Verification, two levels

- **`verifySnapshotArtifacts(store, ref)`**, which needs no repository: parse; `missing` empty, else `snapshot-partial`;
  read the bundle artifact (sha256-checked by `readArtifact`); parse the bundle header in code: `# v2 git bundle` (or v3
  with `@object-format`) with exactly one prerequisite `-<base>` and exactly one head `<attempt> <ref>` (Appendix A
  check 9). Failure: `snapshot-bundle-heads-mismatch`.
  - **Callers without a repository:** `recovery.ts:57` (legacy runs only) and `cleanup.ts:19`.
- **`verifySnapshotInRepository(store, ref, resolveRepository)`**: the artifact level first. Then, in the target:
  1. `git -c gc.auto=0 -c maintenance.auto=false bundle verify <file>`. A missing prerequisite gives
     `snapshot-base-unavailable` (check 8, exit 1).
  2. `<attempt>^{tree} == tree` (`snapshot-tree-mismatch`), with the attempt object read from the target if present;
     otherwise from a temp alternates repository `<stateDir>/staging/verify-<uuid>` (`git init --bare`,
     `objects/info/alternates` → the target's `objects`, `fetch <bundle> <ref>`), removed in `finally` (review `t1.out`
     D: "alt fetch rc=0, target objects unchanged").

  It **never writes the target** (a criterion: the ref list and `count-objects -v` are unchanged).
- **v2 callers, corrected** (review minor 3; each direct v1 call is dispatched on `version`, none is left behind):

| Site | What it is today | v2 |
|---|---|---|
| `executionDriver.ts:1625` | `commitCandidate` → `verifyCandidateArtifacts` (`checkpoints.ts:93`) | `verifyCandidateArtifacts` gains an optional `resolveRepository`; the driver passes it |
| `executionDriver.ts:2275`, `:2419`, `:2425` | direct `verifySnapshot` | `verifySnapshotInRepository` |
| `executionDriver.ts:2277`, `:2420`, `:2427` | `commitCandidate` | as `:1625` |
| `driverHandoff.ts:563` | `verifyCandidateArtifacts` | with `resolveRepository` |
| `acceptAttempt.ts:79` | `prepareAcceptAttempt` | `verifySnapshotInRepository` |
| `checkpoints.ts:170`, `recovery.ts:57`, `cleanup.ts:19` | `verifyCandidateArtifacts` without a repository | artifact level only |

  (`executionDriver.ts:1599` and `:1698` are `archiveRun`; `:1698` has no `commitCandidate`.)
- An unresolvable repository is `snapshot-repository-unavailable`. v1 snapshots keep `verifySnapshot` (`snapshot.ts:66-86`).

## 8. Failure handling

| Failure | Detected by | Outcome |
|---|---|---|
| collect `attempt.sha: null`, `record-failed` | step C / E (P2) | succeeded run: blocked at C, `attempt-unavailable:record-failed`. Failed run: archived with `missing: attempt-unavailable:…` ⇒ partial ⇒ not recoverable or acceptable, by name. |
| reported sha absent, not from base, tree or ref mismatch | step C (§5.3) | blocked at C by name; nothing pinned |
| `refs/orca/runs/<runId>` exists at another sha (an ancestor included) | `pinAttempt` (create-only `update-ref`) | `run-ref-conflict` blocks. Never forced, never fast-forwarded. |
| `update-ref` lock contention (`packed-refs.lock` from the person's own gc) | pin | ENOENT/EBUSY-class errors are retried in place (`transientSettleError`, `executionDriver.ts:262-267`); anything else blocks by name |
| ref deleted by a person, objects still there | readers | accept re-pins; review and verify read the object; continuation and recovery ship the bundle |
| ref deleted **and** objects pruned | readers | review `diff: null` (`attempt-objects-unavailable`); accept, continuation, recovery use the bundle while `base` exists |
| `base` gone (§5.6 list) | `bundle verify` | `snapshot-base-unavailable`: accept refused (`accept-attempt-snapshot-partial`, detail); review `diff: null`; continuation `resume-predecessor-unrecoverable` (detail); recovery `unavailable` with the reason. **Never** a guess. |
| target repository gone or moved | `resolveRepository` | `snapshot-repository-unavailable` |
| kept worktree cannot be removed | ccloop (P1) | `worktree:"retained"`, `workspace_cleanup_failed` event; not archived as logs (P0) |
| crash between bundle creation and publish | staging | `finally` removes it; a hard kill leaves one file in staging (#364) |
| **P0:** `removeResultCopies` guard refuses or `rm` fails | step E / `stepCleanupFailed` / `cleanupPredecessor` / `settleAbandonedUnderStop` | recorded in `cleanupError`, retried next round; never blocks a settle |
| **P0:** the same at a recoverable settle | §5.6 | a stderr line; the settle's answer is unchanged; `cleanupPredecessor` retries |
| **P0:** crash after the removal, before `cleanedUp` | the next round | resumes: the archive is skipped (row exists), the removals find nothing, `cleanedUp` is written |
| **P0:** archive partial | `removeResultCopies` | C5 kept by design; the partial archive is already visible on the run |

## 9. Out-of-repository writes and deletes (Orca Rule 17; ccloop's §11.8 analogue)

All Orca paths below follow `ORCA_CONTROL_DIR` / `--control-state-dir` (`controlWorkspaceRoots`, `workspace.ts:33-35`).
New directories are created `0700` and new files `0600`; existing modes are left as they are. Every criterion runs in a
temporary control directory (driver harness), never the person's.

| Writer | Path | Trigger | Phase | Residue on failure |
|---|---|---|---|---|
| Orca | `<workspacesRoot>/<runId>` (no-checkout worktree or clone) + `.git/worktrees/<runId>` in the target (worktree mode) | A2 | P0 | as today; now ~4 KB |
| Orca **(delete)** | `<runsRoot>/<runId>/repo`; `repos/` only at step E | §5.6 call sites | P0 | guarded; a failure stays in `cleanupError` or on stderr; partial archives keep it by design |
| Orca | `<workspacesRoot>/check-<runId>` + `.git/worktrees/check-<runId>` in the target; check commands may write the target's refs (§5.3) | debug or criteria-base check | P2 | removed on the next round or restart; at settle at the latest |
| Orca | `refs/orca/runs/<runId>` in each written directory's target (+ the attempt's objects in clone mode, and `FETCH_HEAD`) | step C, or `archiveRun` on failure paths; accept re-pin | P2 | **kept by design** (§5.6) |
| Orca | `refs/orca/incoming/<runId>` | landing (now `update-ref`, no fetch) | P2 | as today, deleted at cleanup |
| Orca | `<stateDir>/staging/<uuid>.bundle`, `<stateDir>/staging/verify-<uuid>/` | step E, verify, accept | P2 | `finally`; a hard kill leaves it (#364) |
| Orca | `panel/artifacts/` range bundle + snapshot v2 | step E | P2 | never deleted (N3) |
| ccloop | `refs/ccloop/run/attempts/<n>`, `refs/ccloop/<runId>/attempts/<n>` for a kept worktree (new occasion, same refs) | worker settle | P1 | as today |
| ccloop | `<runDir>/attempt-record.index` (0600) | worker settle | P1 | removed after use; a kill leaves one small file in the run directory |
| ccloop **(delete)** | kept `<runDir>/worktrees/attempt-<n>`, older published leftovers, `<runDir>/dirs/attempt-<n>/<key>` | worker settle, after the record | P1 | `retained` on failure |
| ccloop | no longer creates `<sourceDir>/repo`, `repos/` (key) | — | P1 | — |

## 10. Corrections to published specs (pointers only; those specs are not edited — Orca Rule 13)

Each spec below gets an appended "Correction (2026-11-19, change-sized runs)" section pointing here, in the phase that
changes its behaviour.

- **P0:**
  - `2026-09-25-execution-driver-design.md` §3.2 (the workspace is not checked out; clone mode sets HEAD with
    `update-ref`) and §3.5 (the result copy is removed at settle, §5.6).
  - `2026-10-08-issue-fixes-design.md` §4.2(2) (`stepCleanupFailed` archives only when no archive row exists, and
    removes the result copy).
  - `2026-10-10-task-results-design.md` (archive exclusions, line 89): `run/worktrees` and `run/dirs` are added.
  - `2026-09-25-handoff-delivery-design.md` (H-settle) and `2026-09-19-web-recoverable-control-design.md` §6.3: the
    result copy goes at the recoverable settle; continuation reads only the archive.
- **P2:**
  - `2026-09-25-execution-driver-design.md` §3.3 (attempt from ccloop's record or `commitAttempt`, pinned at
    `refs/orca/runs/<runId>`), §5.2 (no fetch from `<sourceDir>/repo`), §2.2 row E (snapshot v2).
  - `2026-09-25-handoff-delivery-design.md` (C2, "archives the snapshot the way stepE does"): v2.
  - `2026-09-19-web-recoverable-control-design.md` §11.1 (continuation resumes from the dirty snapshot): v2 and
    `reset --mixed` (§5.5.3).
  - Snapshot v1 (commit `785d4f75`; the shape lives in `snapshot.ts:17-33`): v1 kept for the legacy bridge and reading.
  - `2026-10-11-saved-result-recovery-design.md` §6.7/§6.9: `legacy-published-candidate-v2`; C9 unchanged.
  - `2026-11-11-budget-defaults-and-reviewed-acceptance-design.md` §4, §7, §8: v2 does not rebuild.
  - `2026-11-16-completed-attempt-acceptance-design.md` "Eligibility" (line 54): v2 wholeness is §7.2.
  - `2026-10-24-multi-dir-projects-design.md` §7.1–§7.3 (extras pinned), §11.6 and §11.8 (no `repos/<key>` under the
    key), §7.4 (still refused).
  - `2026-11-04-task-setup-and-check-retry-design.md` §4.6 (checks run in a check worktree), §4.9.
  - `2026-11-18-salvage-accept-design.md` (designed, not built): when built, it reads v2.
- **P1:** ccloop `docs/control-protocol-v1.md` "Continuation and result repository" (§6.1).

## 11. Criteria

The test scope follows Orca Rule 18: `npm test` per patch set, `npm run test:wide` per merge batch, and the full gate
only for a release. ccloop uses its own full vitest run plus `check-known-reds`. Every new branch names the mutation that
must turn it red (Orca Rule 9); mutations run only in a `git clone --local` copy (Rule 15).

### 11.1 Orca criteria to rewrite (the human approved 「同意改所有必要的判据」 — named here for the record)

Found with `/usr/bin/grep -rnE "\"repo\"\)|, \"repo\"|snapshotSchema|snapshot\.(tree|index|deleted)|for-each-ref[^)]*refs/orca" tests`
at `5220b1c1`, plus the review's additions (I5) and this revision's own reading of every test that reads a file in the
workspace or in `<sourceDir>/repo` after a settle. The list is what was found; the quick and wide tiers are the check
that it is complete.

**P0:**

| Test (file:line of `it`) | Lines that change | Intent it encodes | New form that keeps the intent |
|---|---|---|---|
| `tests/control/dirRequirementExport.test.ts:193` "prepares the task in a worktree of the bare vault at the work branch and hands it to the agent" | 205 (reads `src/export.ts` from the workspace) | the agent starts from the exported work branch | `git -C <workspace> show HEAD:src/export.ts` is `export {};\n`, and the workspace's entries are exactly `[".git"]`. Mutation: ensure the workspace at a wrong base ⇒ red. |
| `tests/control/liveCeilingSettle.test.ts:81` "reuses the committed ceiling checkpoint instead of blocking a late C visit" | 105 (writes `late.txt` into `<sourceDir>/repo`, which P0 removes at the ceiling settle) | a late C visit reuses the committed checkpoint and never re-archives | assert `<sourceDir>/repo` is gone after the first settle; write `late.txt` into the **source directory** instead (a re-archive would capture it as a log and differ). Mutation "the late visit re-archives" ⇒ two checkpoints or `checkpoint-identity-conflict` ⇒ red. |
| `tests/control/taskResultIsolation.test.ts:88` "settled-failed cleanup ignores supplemental faults and keeps failed outcome and usage" | 93–98 | supplemental faults never make a failed run's evidence partial | the cleanup no longer re-archives when the step-C row exists, so the poison (made after C) would reach no archive. New form: delete the run's archive rows after it blocks (as `acceptAttemptCommand.test.ts:145` does), poison, run `stepCleanupFailed`; exactly one new row, `missing: []`. Mutation: drop `TASK_RESULT_SOURCE_EXCLUSIONS` from the capture ⇒ red. |

**P0 hardening (no change of intent):** `debugRepro.test.ts:346` (line 355) and `criteriaBaseRun.test.ts:248` (line 262)
check that `<sourceDir>/repo/node_modules` does not exist. Both run while the run is `landed`, before step E, so they
still mean something; each gains `expect(existsSync(join(sourceDir, "repo"))).toBe(true)` first, so a future deletion
before E cannot make them pass vacuously (Rule 9).

**P2:**

| Test (file:line of `it`) | Lines that change | Intent it encodes | New form that keeps the intent |
|---|---|---|---|
| `tests/control/debugRepro.test.ts:290` "a failed check blocks the debug run at C and does not land" | 304–305 (`<sourceDir>/repo` HEAD = attemptSha, clean status) | the check leaves the attempt untouched | `check-<runId>` no longer exists after the verdict; `refs/orca/runs/<runId>` = `drive.attemptSha`. Mutation: skip the removal ⇒ red. |
| `tests/control/debugRepro.test.ts:346` "a debug run's reproduction leaves no setup output in the run's workspace" | 355 | setup output never survives the check | the check path is gone; `ls-tree -r <attempt>` has no `node_modules`. Mutation I2-M6 stays named. |
| `tests/control/debugRepro.test.ts:495` "a restart finding the marker restores the workspace and checks again, with no new attempt commit" | 506–510 | a restart re-checks and never makes a new attempt commit | tamper with (or leave) a stale `check-<runId>`; the restart recreates it at the attempt; `attemptSha` unchanged; the landing's `^2` = the marker's sha |
| `tests/control/criteriaBaseRun.test.ts:248` "a base re-run's setup output is neither left in the workspace nor archived" | 261–267 | base re-run output is neither left nor archived | check path gone; `ls-tree -r <snapshot.attempt>` contains `src/value.txt` and no `node_modules`. Mutation I2-M4 stays named. |
| `tests/control/criteriaBaseRun.test.ts:272` "a restart while that re-run is in flight recomputes its files with the setup commands" (review I5) | 291–297 (poll `<sourceDir>/repo` status and `.git/index.lock`) | a restart mid-re-run recomputes the check files with setup | poll `check-<runId>` (removed or recreated) instead of C5; the rest unchanged. Mutation "the resume path's classifyCriteriaChange drops setup" stays named. |
| `tests/control/criteriaBaseRun.test.ts:315` "a restart while the re-run is in flight restores the workspace and runs it again" | 325–326 | a restart mid-re-run re-runs it cleanly | poll until `check-<runId>` is removed or recreated |
| `tests/control/acceptAttemptLanding.test.ts:77` "is the snapshot's tree path by path and byte by byte, with every path the attempt deleted gone" | 79–92 | the attempt landed is the archived one, deletion included, and a restart lands the same commit | v2: `snapshot.attempt` = the run's `attemptSha`; `ls-tree` lacks `base.txt`; a **fresh repository at `base` + the bundle** gives the same sha and tree; two accepts use the same sha |
| `tests/control/acceptAttemptLanding.test.ts:99` "rebuilds the attempt with its deletion, lands it by one merge commit…" | 112–118 | criterion 17, as above | as above. Criteria 20–23 unchanged. |
| `tests/control/driverSettle.test.ts:102` "cleans only the run's own workspace and incoming ref, keeps its source directory, and never touches orca/<group>" | 108 (`refs/orca/` empty) | cleanup removes only the run's transient refs | `for-each-ref refs/orca/` is exactly `refs/orca/runs/<runId> <attemptSha>`; no `incoming`; `<sourceDir>/repo` does not exist |
| `tests/control/executionDriver.test.ts:177` "T1 (synthetic): blocks a terminal other than succeeded and leaves orca/<group> where it was" (review I5) | 185 (`for-each-ref refs/orca/` empty) | a failed terminal moves no branch and makes no landing ref | the failed terminal is archived at C, which pins: `for-each-ref refs/orca/` is exactly `refs/orca/runs/<runId>`; `orca/<group>` unmoved. Mutation: a landing ref written at C ⇒ red. |
| `tests/control/liveCeilingSettle.test.ts:150` "finishes a valid ceiling checkpoint written before its DB transaction" (review I5) | 162 (`archiveRun` v1 signature), 171 (write into C5) | an orphan ceiling checkpoint is finished exactly as written, never re-archived | call `archiveRun` with `repositories`; the post-crash write goes to the source directory; the committed snapshot equals the orphan's. Mutation "re-archive the orphan" ⇒ red. |

**Stay as they are (and why):** `snapshot.test.ts:9,25,36` and `archive.test.ts:12–148` (v1 capture kept for the legacy
bridge); `workspace.test.ts:66,77,90,111,122` (`rev-parse HEAD` still equals `base`; `commitAttempt` kept);
`acceptAttemptView.test.ts:47` (same numbers); `multiDirCollect.test.ts:95` (fake port without the feature = legacy);
`handoffE2E.test.ts:31` (H1: `head` keeps its meaning); `ccloopProtocol.integration.test.ts:70-78` (legacy service path);
`retryTask.test.ts:313` (`archived > 0` holds with the skip).

**Fixture change, not a criterion (P2):** `tests/control/fixtures/driverPort.ts:101-112` gains a feature switch. Off (the
default) keeps today's C5 behaviour. On, it commits the attempt in a worktree of `repoPath`, removes it, and reports
`attempt`.

### 11.2 ccloop criteria to rewrite (P1) — **awaiting human naming** (ccloop Rule 15, ruling 88)

Each row needs the person to name it before it is changed; a blanket approval does not count.

| Test | Line | Intent | Rewrite (whole, not loosened) | Status |
|---|---|---|---|---|
| `tests/control/protocol4.test.ts:9` "negotiates implemented recovery independently of core capabilities" | 12 | `features` answers exactly the implemented capabilities | the exact `toEqual` gains `attemptRef:"v1"` | **awaiting human naming** |
| `tests/control/savedResultEvidence.test.ts:80` "captures original attempt, usage, full snapshot and exact runtime bytes before cleanup without changing v3" | 112 | the same exact features answer | the same addition; nothing else in the test changes (C9 is unchanged, N6) | **awaiting human naming** |

**Nothing else in ccloop changes.** Every behaviour change is gated by the envelope key, and no existing criterion's
envelope carries it. These stay: `resultRepository.test.ts:54,64,76,100,107`, `multiRepoCollect.test.ts:33`,
`materialize.test.ts:113`, `claudeEndToEnd.test.ts:92`, `codexSkillsFailureWorker.test.ts:18`, the runLoop kept-worktree
criteria in §5.2, every saved-result recovery criterion (their envelopes carry `mode` and can never carry the key), and
`savedResultEvidence.test.ts:80` lines 90 and 96–100. The review confirmed the list is complete for the exact `features`
answers (`collectTranscripts.test.ts:48` uses `toMatchObject`).

### 11.3 New criteria (additive)

**Orca P0** (the plan `docs/superpowers/plans/2026-11-19-change-sized-runs-p0.md` gives files and mutations):

- **P0-1:** after `ensureWorkspace` in both modes, the workspace's entries are exactly `[".git"]`. In clone mode, with
  the target's HEAD moved past `base`, the workspace HEAD is `base` and detached, and a worktree cut from it with no start
  point (as ccloop cuts it) holds `base`'s tree. Mutations: drop `--no-checkout` (red); drop the `update-ref` (red).
- **P0-2:** `featuresSchema` accepts `attemptRef:"v1"` and refuses any other value; `startEnvelopeSchema` accepts
  `attemptDelivery:"ref-v1"` on a protocol-4 loop envelope, refuses it on protocol 3 and beside `mode`, never adds it.
- **P0-3:** the logs capture excludes `run/worktrees` and `run/dirs` with `missing: []`.
- **P0-4:** `removeResultCopies` — one criterion per row of §5.6's table (each with its mutation).
- **P0-5:** step E removes `<sourceDir>/repo` after the archive persisted; the archived snapshot still verifies; a crash
  between the workspace cleanup and the removal resumes to `cleanedUp:true` with the copy gone (mutation: write
  `cleanedUp` before the removal ⇒ red).
- **P0-6 (review I1):** a crash after `stepCleanupFailed`'s removal, before `cleanedUp`; the next round sets
  `cleanedUp:true`, `cleanupError:null`, and the archive row count is unchanged. Mutation "re-archive unconditionally"
  ⇒ red.
- **P0-7 (review I2):** each recoverable settle (ceiling, handoff with the fake port; allowance with the real ccloop at the
  pin) leaves no `<sourceDir>/repo`, and `exportResumeBundle` still succeeds from its checkpoint; `cleanupPredecessor`
  removes a copy left by a pre-P0 settle. One mutation per call site.

**ccloop P1:**

- **P1-1:** with the key, a kept live worktree (handoff boundary) is recorded. Its tree has the tracked edit and the
  untracked file, and not the ignored one. The worktree's index bytes and HEAD are equal before and after the record
  (measured directly). The worktree is removed. Both refs are set. collect gives `capture:"live"` with `head` = parent.
  Mutations: `git add -A` on the real index (red on index bytes); skip the removal (red).
- **P1-2:** with the key, no `<sourceDir>/repo` and no `repos/`. Without the key, the envelope hash is byte-identical to
  a `dd491c1` fixture and collect has no `attempt`.
- **P1-3:** the key on protocol 3 is refused; the key beside `mode: verify-saved-result` is refused.
- **P1-4:** `record-failed` is reported, not thrown.
- **P1-5:** an older published retained worktree is removed under the key; one whose ref does not match its HEAD is left
  `retained`.
- **P1-6:** continuation from v2 (live and published): HEAD = `head`; temp-index tree = `tree`.
- **P1-7:** `legacy-published-candidate-v2` recovery verifies in the recovery run's `repoPath` and refuses a bundle whose
  head is not the recorded attempt. Mutation: verify in an empty bare repository ⇒ red (prerequisite missing).

**Orca P2:**

- **P2-1:** the pin exists in the target after C, in both modes. In clone mode it survives C1's removal. Mutation: pin
  at E after cleanup (red in clone mode).
- **P2-2 (review I3):** a ref already at an **ancestor** of the attempt is refused `run-ref-conflict`, and the ref is
  unmoved. Mutation: a plain refspec fetch (`<sha>:refs/orca/runs/<runId>`) ⇒ fast-forward ⇒ red.
- **P2-3:** each of the four step-C checks blocks by name (one mutation per check).
- **P2-4 (R1):** a target with 2,000 unchanged tracked files and a 1-file change. Step E registers exactly `logs + 3`
  new artifacts (bundle, snapshot, manifest), independent of the tracked-file count (re-run at 4,000: same count).
  Mutation: call v1 `captureSnapshot` (red).
- **P2-5:** `verifySnapshotInRepository` names `snapshot-base-unavailable`, `snapshot-bundle-heads-mismatch` and
  `snapshot-tree-mismatch`, and it **never writes the target**: `for-each-ref` and `count-objects -v` are equal before and
  after, measured directly.
- **P2-6:** accept-attempt re-pins from the bundle after the ref was deleted.
- **P2-7:** the review diff for v2 never calls `restoreSnapshotAttempt` (spy), gives the same numbers as the v1 fixture,
  and answers `diff: null` with `attempt-objects-unavailable` when the objects are gone.
- **P2-8:** the continuation export of a v2 predecessor contains the bundle and no `sha256-` blob of any unchanged file.
- **P2-9:** multi: each extra is pinned in its own target.
- **P2-10:** a legacy-envelope run (fake port without the feature) archives v2 from Orca's commit with `head` = C5's HEAD
  before the commit, and deletes C5.
- **P2-11:** with ccloop lacking the feature, continuing a v2 predecessor is refused at A2 by name, before any workspace
  exists; a saved-result envelope never carries the key.

## 12. Acceptance (each a command that exits 0 or non-zero; numbers are reported as measured, never estimated)

Each command runs on the measured repository class (repo L, or one with ≥ 25,000 tracked files and ≥ 3 GiB tracked).
Every output records `uptime` before and after, the Orca commit and the ccloop pin (Rule 14, Rule 18). Output goes to a
file that is read back in full, never through a pipe. All sizes are **bytes** (apparent sizes); `du` is never mixed in.

**P0-A — no-checkout workspace on repo L (Orca code, no agent, no panel):**

```bash
ORCA_BENCH_REPO=<repoL> ORCA_CONTROL_DIR=<scratch>/state npx tsx tests/bench/noCheckoutWorkspace.ts \
  > <scratch>/p0a.json 2> <scratch>/p0a.err; echo $?
```

The bench makes a `clone --local --no-checkout` of the repository in `<scratch>` as the target, adds a `later` commit with
`commit-tree` (no checkout) so that the target's HEAD is past `base`, and, for each mode, runs the real `ensureWorkspace`
at `base`, cuts an attempt worktree from the workspace with no start point (as ccloop does), and runs the real
`cleanupRunWorkspace`. It exits 1 unless, for each mode:
- `ensureMs ≤ 2,000` (measured 0.03 s / 0.12 s under load 14–74; the old checkout took 12–29 s);
- the workspace's entries are exactly `[".git"]`;
- `unsharedBytes ≤ 1,048,576`, where `unsharedBytes` is the sum of apparent sizes of the regular files under the
  workspace (and, in worktree mode, under the directory `git -C <workspace> rev-parse --git-dir` names) whose link
  count is 1 — hardlinked
  packs are not new bytes;
- the workspace HEAD and the attempt worktree's HEAD both equal `base`.

**P0-B — one real run (paid; only when the person allows it, per handoff convention):**

```bash
node <scratch>/p0b-check.mjs <stateDir> <runId> > <scratch>/p0b.txt 2>&1; echo $?
```

Exits 0 iff `<runsRoot>/<runId>/repo` and `<workspacesRoot>/<runId>` do not exist, and the apparent size of
`<runsRoot>/<runId>` is ≤ 104,857,600 bytes (100 MiB: logs, not a 3.8 GB tree). The script only reads.

**A1 — git-level budget for P2 (no Orca code).** Save `.measure-363/bin/measure-v2.sh` (outside both repositories) with
the rows of the first draft — `c1-worktree`, `c1-clone`, `c1-clone-head`, `c3-attempt`, `record-add`, `pin`, `bundle`,
`verify`, `lstree`, `diffstat`, `c3-remove`, each timed with `/usr/bin/time -l` into `t/v2-<row>.time` — and end it with:

```bash
fail=0
for f in "$TD"/v2-*.time; do row=$(basename "$f" .time); row=${row#v2-}
  case $row in c3-attempt|c3-remove) continue;; esac
  real=$(awk '/ real /{print $1}' "$f" | tail -1)
  awk -v r="$real" 'BEGIN{exit !(r <= 1.0)}' || { echo "FAIL $row real=$real" >> "$LOG"; fail=1; }
done
ws=$(find "$W/ws" -type f -exec stat -f %z {} + | awk '{s+=$1} END{print s+0}')
[ "$ws" -le 65536 ] || { echo "FAIL ws bytes=$ws" >> "$LOG"; fail=1; }
exit $fail
```

Run `bash bin/measure-v2.sh <repoL> > t/v2.out 2>&1; echo $?`, then read `t/log-v2.txt` in full. When done, move `w2/` to
the Trash with `/usr/bin/trash` (an `rm -rf` is refused by the permission layer, report.md §2.3).

**A2 — Orca code-level bench for P2 (not part of any test tier):**

```bash
ORCA_BENCH_REPO=<repoL> ORCA_CONTROL_DIR=<scratch>/state npx tsx tests/bench/changeSizedSettle.ts \
  > <scratch>/bench.json 2> <scratch>/bench.err; echo $?
```

It drives the real `ensureWorkspace`, a real attempt worktree with a 2-file change recorded as P1 records it, step C's
pin, the real `archiveRun` v2 with a 70-file run directory, `verifySnapshotInRepository`, then the real cleanup. It prints
`{stepE_ms, verify_ms, changeBytes, logsBytes, metaBytes, artifactBytes, sourceBytes, workspacesEntries,
targetObjectsGrowthBytes, uptimeBefore, uptimeAfter}` and exits 1 unless:
- `stepE_ms + verify_ms ≤ 10,000` (G1);
- `artifactBytes == logsBytes + changeBytes + metaBytes` and `metaBytes ≤ 65,536` (G2);
- `sourceBytes ≤ logsBytes + 1,048,576` (G2);
- `workspacesEntries == 0`.

**A3 — one real run for P2 (paid; only when the person allows it).** Start the panel with `ORCA_SETTLE_SLOW_MS=0`, run one
small task on repo L, then:

```bash
node <scratch>/a3-check.mjs <panel.err.log> <stateDir> <runId> <repoL> > <scratch>/a3.txt 2>&1; echo $?
```

It reads the run's `orca-driver: <runId>: settle took … (archive N …)` line in full, the run's artifact rows, the source
directory's apparent size and `git count-objects -v` before and after (recorded by the person's start step), and exits 1
unless `archive ≤ 10,000` ms, the G2 byte bounds above hold, and the target's `size + size-pack` grew by
≤ 1,048,576 bytes.

**Expected (predicted from the measured rows; the commands above replace these with measurements):**

| Step | Before | After P0 | After P2 |
|---|---|---|---|
| C1 at A2 | 12–29 s, 3.8 GB | 0.03–0.12 s, ≈ 4 KB | same |
| step E | ≈ 3,834 s | ≈ 3,834 s | 0.02 s ref + 0.04 s bundle + sub-second ls-tree + ≈ 70 log publishes at ≈ 60 ms ≈ 4 s |
| per-run residual | ≈ 5.2 GB | ≈ 1.42 GB + logs (cases in §5.6) | change (≈ 1 KB) + 2 × logs + metadata |
| peak | ≈ 11.4 GB | ≈ 7.6 GB | ≈ 3.8 GB (C3), plus a transient landing worktree (N2) |

## 13. Phased delivery (each phase ships alone)

| Phase | Repository | Content | Ships alone because | Gate |
|---|---|---|---|---|
| **P0** | Orca, pin `dd491c1` | §5.1 (both modes, O1); §5.6 `removeResultCopies` with its call sites and order, and the archive skip in `stepCleanupFailed` (I1, I2); the logs exclusion (`run/worktrees`, `run/dirs`, O7); `featuresSchema` learns `attemptRef` and `loopWorkSchema` learns `attemptDelivery` (O6, I4); the P0 corrections of §10 | no protocol change; ccloop `dd491c1` works with a no-checkout `repoPath` (§5.1); nothing sends the key | `npm test` per patch set, `npm run test:wide` per merge; §11.1 P0 rewrites; §11.3 P0-1..7; P0-A (P0-B if the person allows) |
| **P1** | ccloop | the envelope key (refused beside `mode`); recording and removing kept worktrees and older published leftovers in the worker and `settleLostWorker`; no result repository under the key; collect `attempt`; the v2 continuation reader; the `legacy-published-candidate-v2` reader (verifying in `repoPath`); then advertise `features.attemptRef:"v1"` | everything is gated by the key and no Orca sends it before P2; Orca pins ccloop, so no unpinned ccloop meets Orca | ccloop full vitest + `check-known-reds`; P1-1..7; the two §11.2 rewrites **after the person names them** |
| **P2** | Orca, repin to P1 | send the key; §5.3 step C + create-only pin + check worktree; §5.4 step E v2; §5.5 readers; §7.2 verification and caller list; §5.7 extras pinned; §5.8 refusals; `ORCA_SETTLE_SLOW_MS`; the P2 corrections of §10 | v1 readers stay; legacy-envelope runs follow row 2 of §5.8 | `npm test` / `test:wide`; §11.1 P2 rewrites; §11.3 P2-1..11; A1, A2; A3 if the person allows |

Repinning is `scripts/pin-ccloop.mjs` in an independent `git clone --local` install tree (handoff convention). Push
needs `allow-push` (Rule 15).

**Next spec (not this one):**
- **Step D without a checkout.** Land with `git merge-tree --write-tree` against the tip and `commit-tree`, instead of a
  landing worktree (`driverLanding.ts:347-349`). It must handle the ledger, which today is written as files into the
  landing worktree (`writeRunLedger(join(landing, ".decisions"), …)`, `driverLanding.ts:441`; `debugClosingOf` `:326`):
  the `.decisions/` entries have to be written into an index or a tree instead. It changes conflict detection, so it
  needs its own criteria. Saves 15–25 s per landing on repo L.
- N6's deferred items (C9 and the exhausted/omp bundles with base-aware readers, git-level delivery, G4,
  `snapshot.dirs[]`), sparse C3 (N1), and ref / artifact GC (N3).

## 14. Objections and flagged consequences

- **O1 (D1, amendment, evidence):** `git clone --local --no-checkout` leaves HEAD on the target's checked-out branch
  (Appendix A check 6; review `t1.out` A). Without `update-ref --no-deref HEAD <base>`, ccloop would cut every clone-mode
  attempt from the person's current tip.
- **O2 (scope):** D1–D8 do not make a whole run's *time* change-sized. Step D still checks out the full tree for every
  landing (15–25 s on repo L with its removal); the post-merge, acceptance and integration checks also check out the
  tree (they run commands, so that part is inherent). Against today's step E of ≈ 3,834 s that is under 1 %, and it
  leaves no residual disk. §2 states the scope; §13 names the next spec.
- **O3 (D4, verification):** a range bundle cannot be verified without `base`, and three verify callers have no
  repository handle (§7.2). Hence the two levels. **Consequence the person should know:** v1 evidence was
  self-contained. v2 Results, accept-attempt, continuation and recovery of a run stop working, by name, when `base` is
  lost from the target. The pins make that rarer than the first draft said (§5.6: a rebase plus gc does not lose it;
  deleting the pin plus gc, `filter-repo`, a re-clone or a mirror `fetch --prune` does).
- **O4 (D2, "ignored files left out exactly as today"):** true **only for tasks with setup commands**. Without setup, a
  kept worktree's live copy carries ignored files (`resultRepository.ts:91`; `snapshot.test.ts:18` keeps "kept
  ignored"). After P1/P2, a no-setup handoff or park continuation does not see the ignored files the agent made.
  Accepted: ignored output is regenerable, never lands, and carrying it is what made the archive repository-sized.
- **O5 (D4, clone mode):** pinning in the target brings a clone-mode run's attempt objects into the person's repository
  **even when the run never lands**. Every alternative either re-creates per-run copies or depends on the target anyway.
  The refs are hidden from Orca's views and not pushed by a plain push.
- **O6 (D8, ordering):** Orca's `featuresSchema` and `loopWorkSchema` are `.strict()`. A ccloop that advertises a key
  Orca does not know makes `readFeatures` throw `control-response-invalid`, and therefore every protocol-4 accept with a
  token policy (`:269`) and every Web dispatch probe (`webDispatch.ts:272`); an envelope with an unknown key fails
  Orca's own `startEnvelopeSchema` at A2 (`startEnvelope.ts:143,162`). So Orca learns both keys in P0.
- **O7 (D6, a copy the report did not list):** a kept or retained attempt worktree lives at
  `<sourceDir>/run/worktrees/attempt-<n>`. `archiveRun` captures `sourceDir` minus `repo`, `repos` and the task-result
  paths only (`archive.ts:200`), so on a handoff or park run the whole live worktree is published file by file **as
  logs**, about 26k more publishes on repo L (read from the code, not measured). P0 excludes those paths. In clone mode
  an older retained attempt's commit dies with C1, as every earlier attempt's already does.
- **O8 (D3):** `debugRepro.ts:113` says the check runs where "its dependencies are installed". That held only for live
  copies without setup. The check worktree is no regression.
- **O9 (D5, continuation fidelity):** v1 restored the exact index (`materialize.ts:146-150`). v2 restores HEAD and the
  dirty tree (`reset --mixed`) and loses the staged/unstaged split and unmerged stages (review `t2b.out`: a staged path
  comes back untracked). Nothing downstream reads them. Accepted.
- **O10 (not taken):** dropping C1 altogether by telling ccloop the base: saves 0.03 s and 4 KB at the cost of a protocol
  change.
- **O11 (D1, `--shared` rejected):** a `--shared` clone borrows the target's objects through alternates, so a target
  `gc --prune` can corrupt it mid-run. Hardlinks cost the same (0.12 s) without that dependency.
- **O12 (I2, extends the controller's wording):** the controller asked to keep `<sourceDir>/repo` on a recoverable run
  "only while a continuation can still use it". No continuation reads it (§5.6), so P0 deletes it at the recoverable
  settle and keeps `cleanupPredecessor` as a backstop. If a reader of C5 after a recoverable settle is ever found, the
  alternative is to delete only in `cleanupPredecessor` and at each non-continuable transition; there is no existing call
  site for those today (the C1 workspace of a never-continued run already leaks).

## 15. Biggest risks

1. **Evidence now lives in the person's repository** (P2). Mitigations: the pins keep `base` reachable, named failures
   (§8), and no silent guessing. No mitigation makes it self-contained again without re-creating repository-sized
   archives.
2. **Two strict schemas, two repositories, one ordering.** Orca's schemas learn both keys in P0; ccloop ships readers and
   the advertisement together in P1; Orca sends the key only after the P2 repin. Because Orca pins ccloop, a wrong order
   can only come from a repin, so the P2 gate must include a cross-version run (§5.8 rows 1–3).
3. **Deleting the result copy (P0).** It is the one irreversible step in P0. It is guarded by a complete archive, the
   run's terminal state and the source identity, and partial archives keep the copy. The P0 criteria measure each guard.
4. **Refs accumulate in users' repositories** (P2). `refs/orca/runs/*` (and the existing `refs/ccloop/*`) are never
   collected in v1. Some GUIs list them. Each is change-sized, but one is added per run.
5. **Step D stays repository-sized (O2).** The dominant per-run cost on repo L moves from step E's 64 min to step D's
   15–25 s landing checkout.

## 16. Review resolutions

Review: `/Users/biran/code/skills/orca/.review-363/review.md` (independent read-only subagent, 2026-11-18). Each finding,
the controller's decision, and where this revision applies it.

1. **C1 — range bundles break ccloop's saved-result recovery readers.** Decision: option (a). C9 and the exhausted and
   omp-without-final bundles stay exactly as at `dd491c1` (full closure, self-contained). Applied: N6 (with the reason:
   their readers verify in an empty bare repository), §4 C9 row, §5.2.1, §5.5.4, §11.2. The v2 candidate reader that
   remains verifies in `repoPath` (§5.5.4, P1-7 with the empty-bare mutation).
2. **I1 — `stepCleanupFailed` re-archives and fails after a partial cleanup.** Decision: the archive is idempotent; the
   copy is deleted last or the deletion is resumable. Applied: §5.6 call-site table spells out both orders (step E and
   `stepCleanupFailed`); the archive is skipped when a row exists; the removal runs before the `cleanedUp` write so a
   crash resumes; P0-5, P0-6.
3. **I2 — no deletion for recoverable settles.** Decision: delete in `cleanupPredecessor` and when the run is no longer
   continuable; state the P0 disk prediction per case. Applied: §5.6 (recoverable settles delete at once because no
   continuation reads the copy — O12 records this as an extension of the decision on code evidence — plus
   `cleanupPredecessor` and `settleAbandonedUnderStop`); the per-case disk table in §5.6; P0-7.
4. **I3 — a non-forced fetch fast-forwards.** Decision: fetch without a destination, then create-only
   `update-ref <ref> <sha> ""`; a different value is `run-ref-conflict`. Applied: §5.3 pin steps 1–4, §8, P2-2.
5. **I4 — Orca's strict envelope schema.** Decision: add `attemptDelivery` to Orca's `loopWorkSchema` in P0; name the
   extra ccloop call sites. Applied: §6.2 (P0, with the protocol-4 and no-`mode` refinements), §3 D8, O6, §5.8 rollback
   row; the five delivery sites are named in §5.2.3 and stay unchanged because a saved-result envelope never carries the
   key.
6. **I5 — four missing rewrites.** Applied: §11.1 P2 rows for `executionDriver.test.ts:177`,
   `liveCeilingSettle.test.ts:150`, `criteriaBaseRun.test.ts:272`; `liveCeilingSettle.test.ts:81` moves to **P0**,
   because P0 already removes C5 at the ceiling settle. "Nothing else asserts on C5's contents" is struck. This revision
   adds three P0 rewrites the review did not list (`dirRequirementExport.test.ts:193`, `taskResultIsolation.test.ts:88`,
   and the ceiling one) and two hardenings.
7. **I6 — acceptance not commands / G2 cannot pass.** Applied: §2 G1 includes verification; G2 is in bytes and counts
   the logs twice; §12 every check is a command with numeric thresholds and an exit code (P0-A, P0-B, A1 with its
   closing check, A2, A3).
8. **I7 — step D.** Decision: out of scope; "time follows the change" for step E only; a "Next spec" pointer. Applied:
   §2 scope paragraph (15–25 s per landing as the largest remaining term), N2, O2, §13 "Next spec" (merge-tree landing
   that writes `.decisions/` into a tree).
9. **I8 — over-building.** Decision: defer C9 v2, the git-level delivery, G4, `snapshot.dirs[]`, and the alternates
   repository for the Results diff; keep the v2 continuation reader and `legacy-published-candidate-v2`; one ccloop
   phase. Applied: N6, §5.5.2, §5.7, §7.1 (no `dirs`), §13 (P0 / P1 / P2).
10. **Minor 1 — `head` for `orca-commit`.** Applied: §5.3 records C5's HEAD before `commitAttempt`; §7.1 defines `head`
    per source; P2-10.
11. **Minor 2 — manifest `retained`.** Applied: dropped (§5.4.1).
12. **Minor 3 — §7.2 callers.** Applied: §7.2 caller table.
13. **Minor 4 — the pins mitigate O3 more than said.** Applied: §5.6 "What the pins protect", O3, risk 1.
14. **Minor 5 — gc in the person's repository.** Applied: §5.3 last bullet, §5.4, §7.2 (`-c gc.auto=0 -c
    maintenance.auto=false` on every new command there).
15. **Minor 6 — the check worktree can write the person's refs.** Applied: §5.3, §9.
16. **Minor 7 — older retained attempt worktrees.** Applied: §5.2.2 (removed by ccloop under the key when published),
    §5.6, P1-5. In P0 they are only excluded from the logs.
17. **Minors 8, 9** (toy confirmations; the 20,000 cap's line) — no change needed; the spec's `:38` is right.

**Not resolved here:** none of the findings is left open. One point is flagged rather than settled: O12 (deleting the
recoverable run's copy at its settle extends the controller's I2 wording on code evidence).

## Appendix A — toy-repository checks behind §5 (run once by the first author)

Run on 2026-11-18 with `/usr/bin/git` 2.50.1, in a session scratchpad (since cleared; reproduce from these steps). The
review re-ran the relevant ones (`.review-363/t1.out`, `t2b.out`; `t2.out` is void).
Target: `d/a`, `b` (mode 755), `link` → `b`; commit `base`; then commit `later`.

1. `worktree add --no-checkout --detach ws base`: rc 0; `ws` contains only `.git`. `rev-parse --show-toplevel HEAD
   --git-common-dir` gives `ws`, `base`, `target/.git`. `ls-files` gives 0, so `status --porcelain` lists 3 deletions
   (the empty index).
2. `(cd ws && git worktree add --detach <src>/run/worktrees/attempt-1)` with no start point: rc 0; files `b d link`;
   HEAD = `base`.
3. `(cd ws && git rev-parse 'HEAD^{commit}')` = `base`.
4. After an agent edit (`d/a` edited, `new.txt` mode 700, `x.log` ignored by a new `.gitignore`, empty `emptydir/`):
   `add -A`, commit, `update-ref refs/ccloop/r1/attempts/1`. The attempt tree is `.gitignore`, `b` (100755), `d/a`,
   `link` (120000), and `new.txt` as **100755**: mode 700 became 755, `x.log` and `emptydir` are absent. The ref is in
   the target. `git clone --no-checkout ws c5 && checkout` gives rc 0. (4b) `rev-parse --git-common-dir` in `ws`: rc 0.
5. `update-ref refs/orca/runs/r1 <attempt>`; `bundle create r.bundle base..refs/orca/runs/r1`: 531 bytes;
   `bundle verify` in the target rc 0 ("requires this ref: base"). After `clone --local --no-checkout target fresh`,
   `fetch r.bundle refs/orca/runs/r1:refs/orca/runs/r1` gives rc 0 and the sha.
6. `clone --local --no-checkout target cl`: HEAD = `later` (symbolic `refs/heads/main`). After
   `update-ref --no-deref HEAD base`, HEAD = `base` and is detached (`symbolic-ref` rc 1). A `worktree add --detach`
   from `cl` gives HEAD = `base`.
7. A live dirty worktree (` M b`, `A  st`, `?? untracked.txt`): copy the index to a temp file, then with
   `GIT_INDEX_FILE` set run `add -A` + `write-tree` + `commit-tree -p HEAD`. The commit's parent is `base`; its tree is
   `b d/a link st untracked.txt`. The worktree's index md5 is unchanged and `status` shows the same three lines.
8. A bundle in an empty bare repository: `bundle verify` rc 1, "Repository lacks these prerequisite commits".
   `bundle create base..<ref at base>` gives rc 128, "Refusing to create empty bundle."
9. `git bundle list-heads r.bundle` run outside any repository gives rc 0. Header: `# v2 git bundle` / `-<base> base` /
   `<attempt> refs/orca/runs/r1`.
10. `worktree remove --force ws` gives rc 0. The nested attempt worktree stays registered in the target until ccloop
    removes it, as today.

## Correction (2026-11-19, change-sized runs P0 review)

Appended by the P0 fix wave on branch `feat/change-sized-p0` (worktree `.wt-p0`, over `ebce5fa0`), after an independent
review of the P0 commits; human approval for the rewrites: 「同意这样大改，并且同意改所有必要的判据」. The text above is
unchanged; where it and this section differ, this section is what ships.

**§5.6, call-site row `settleAbandonedUnderStop` (`driverHandoff.ts`).** The row says archive →
`removeNeverStartedWorkspace` → `removeResultCopies({extras:false})` → the write that sets `cleanedUp:true`. As built in
`e5d6460f` the removal was never called and the write set `cleanedUp:true`, so `stepCleanupFailed` (which acts only on
`cleanedUp:false`) never visited the run and `<sourceDir>/repo` leaked for ever. Corrected order: archive →
`removeNeverStartedWorkspace` → the settle's write sets **`cleanedUp:false`** (its `cleanupError` as before) → the next
round's `stepCleanupFailed` finishes the run with the order of its own row (archive skipped, see below; the idempotent
workspace cleanup; `removeResultCopies({extras:false})`; then `cleanedUp:true`). A crash anywhere between is finished by a
later round. Criteria: `tests/control/abandonUnderStop.test.ts` "an abandoned run settled under a stop loses its result
copy"; the earlier criterion there that read `cleanedUp:true` straight after the settle now reads it after that round.

**§5.6, call-site row `stepCleanupFailed`.** "Skip `archiveRun` when an archive row for the run exists" becomes **skip it
only when the run's latest archive row is complete** (`missing: []` and a snapshot; `latestArchiveComplete`,
`cleanup.ts`). A partial latest row keeps the copy (`removeResultCopies` returns `archive-partial`), so archiving again
reads it safely and may yield a complete row, which then lets the copy go. The crash case the original row guards (copy
removed, `cleanedUp` not yet written) only follows a complete row, so it is still skipped there.

**§5.6, "Why `repos/` only at step E" — now judged at each call site.** A multi-directory run that failed (retry-task, then
`stepCleanupFailed`) and one settled recoverable (handoff) each keep `repos/<key>` byte-intact while `repo` goes; step E
removes both (`tests/control/multiDirDispatch.test.ts`).

**Known gaps (no backstop in P0; for P1/P2, no code in this wave).** `<sourceDir>/repo` can still outlive its run where
nothing calls `removeResultCopies` again after a missed or failed removal:
- a crash between a recoverable settle's commit and `dropResultCopyAfterSettle` (the run reads terminal, the copy stays);
  only `cleanupPredecessor` retries it, and only if the run is continued;
- a `settled-unrecoverable` handoff run: removed at the settle when its archive is complete, but a failed removal there is
  never retried (it is never continued, so `cleanupPredecessor` never runs);
- a recoverable run that is never continued — its group archived, the run superseded or closed — whose removal at the
  settle was missed or failed;
- a ceiling run moved to `settled-recoverable` by `repairCommittedCeilingBlock` (`stopIntent.ts`), which settles it inside
  a command transaction and never reaches `dropResultCopyAfterSettle`.

## Correction (2026-11-19, change-sized runs P2 as built against ccloop P1)

Appended by the P2 implementer (Orca session `3ba26002`, branch `feat/change-sized-p2`, worktree `.wt-p2`, over
`77c2baf4`), developed against ccloop P1 at its local `main` `633534c` (`ORCA_CCLOOP_BIN=<ccloop>/dist/cli.js`); the npm
pin was not moved (still `57b6d15`). Human approval for the criteria: 「同意这样大改，并且同意改所有必要的判据」. The text
above is unchanged; where it and this section differ, this section is what ships.

**ccloop P1 as built (binding for P2; ccloop `docs/control-protocol-v1.md`, its two Corrections under "Continuation and
result repository", and `git log -p 214125f..633534c`).**
- collect's top-level `attempt` is `AttemptRecordV1`: `{attempt, sha, base, tree, ref, head, capture:
  "published"|"live", worktree: "removed"|"retained"}` or `{attempt, sha: null, reason: "not-started" |
  "skills-cleanup-pending" | "record-failed", detail?}`, present only with the key and a candidate. Orca's strict collect
  schema mirrors it (`src/control/attemptRecord.ts`) and refuses it beside an envelope without the key.
- `attempt.base` is `attempt^` (the HEAD the attempt was captured on), **not** the run's start base: when the agent
  committed inside its worktree it is the agent's commit. §5.3's checks therefore test ancestry
  (`merge-base --is-ancestor <drive.base> <sha>`), never equality; the v2 bundle range is `drive.base..<pin>`;
  `snapshot.head` is `attempt.head`.
- Such a run (agent committed in its worktree) can be continued but is **not** saved-result recoverable: ccloop answers
  `saved-result-attempt-not-on-base`. New ccloop recovery reasons: `saved-result-attempt-not-on-base`,
  `saved-result-snapshot-too-large`, `saved-result-snapshot-partial`. Continuation fetch failures are
  `control-resume-head-mismatch`, `control-resume-snapshot-invalid`, `control-resume-base-unavailable`.
- Under the key, settle-lost leaves the trees it could not remove in the target repository (retained, `record-failed`,
  older unpinned trees, an older attempt's extra worktree). Orca does not assume they are gone and removes none of them
  (its cleanup removes only its own workspace, landing and check paths).
- collect's `dirs[].resultRepo` still says `"repos/<key>"` under the key although no `repos/` exists; `dirs[].attemptSha`
  is read by ccloop from `run/attempts/<n>/commits.json`. Orca keeps the `repos/<key>` check and now passes `dirs[]` to C.
- Eligibility answers may carry `authorityKind: "legacy-published-candidate-v2"`; source-only eligibility verifies in
  `source.work.targetRepo`. Orca's eligibility and package schemas accept the kind.
- §11.2's two ccloop criteria (`protocol4.test.ts:9`, `savedResultEvidence.test.ts:80`, the exact `features` answers
  gaining `attemptRef: "v1"`) were approved by the person and are done in ccloop P1 (`1793ad4`).

**§5.8 row 2 and §11.1 (P2), amended: v2 only under a ccloop that reads it.** As built, a run archives snapshot v2 iff
its A2 found `features.attemptRef === "v1"` (and it is not a saved-result recovery or a recovery run); the drive records
`snapshotVersion: 2`, and on protocol 4 its envelope carries the key (`attemptDelivery: "ref-v1"` on the drive). Under a
ccloop without the feature — the pinned `57b6d15` — nothing changes at all: no key, v1 archive, no pin, the result copy
handled as P0 left it. The spec's row 2 (an older ccloop still gets v2 archives, and its continuations and recoveries of
them are refused) would have broken every allowance, ceiling and handoff continuation under the current pin until the
repin; reversible, decided on the Rule 1 ladder. A protocol-3 (no token policy) run under a v2-reading ccloop is the
legacy-envelope v2 case (Orca commits its result copy, `head` = the copy's HEAD before the commit, pins, archives v2).
Consequently none of §11.1's P2 rewrites was needed: those criteria run against the synthetic ccloop without the feature
and still encode the v1 behaviour that ships; the v2 forms are new criteria (`changeSizedDriver.test.ts`,
`changeSizedReaders.test.ts`, `snapshotV2.test.ts`, `attemptPin.test.ts`, `attemptRecordPort.test.ts`).

**Other as-built differences.**
- Drive record (all optional, so older bodies parse): `snapshotVersion`, `attemptDelivery`, `runRef`, `attemptHead`,
  `attemptSource`, and `dirs[].runRef` (schema only; see below).
- Block reasons at C: the four check names; `attempt-unavailable:<reason>` (`no-record` when collect gave none,
  `no-result-copy` for a legacy run without its copy); `run-ref-conflict:<held sha>`; `run-ref-failed:<git's words>`.
  In an archive the same strings are missing evidence (a refused pin is `attempt-unpinned:<reason>`), so it is partial.
- The pin's fetch writes no `FETCH_HEAD` (`--no-write-fetch-head`, falling back to a plain fetch); accept-attempt's re-pin
  from the bundle fetches into `FETCH_HEAD` only.
- Results review (§5.5.2): a v2 diff the target cannot answer is `diff: null`; the reason
  (`attempt-objects-unavailable`) is not surfaced, because the view's schema is strict and shared with the web client.
- `saved-result-source-v2-unsupported` is answered at eligibility (before any recovery run exists), not at A2.
- **Not built in this wave:** §5.7 (multi-directory runs get no key and stay v1; `dirs[].runRef` exists in the schema
  only), the A2 bench (`tests/bench/changeSizedSettle.ts`) and A1/A3. See the implementer's hand-off for the list.

**Rule 17 (§9), as built.** No writer beyond §9's table: `refs/orca/runs/<runId>` (+ objects in clone mode) in each
target (`attemptPin.ts`, from step C, `archiveRunV2`, accept-attempt's re-pin); `<workspacesRoot>/check-<runId>` and its
`.git/worktrees/check-<runId>` (removed after the verdict and on restart); `<stateDir>/staging/<uuid>.bundle` and
`<stateDir>/staging/verify-<uuid>/` (removed in `finally`); `refs/orca/incoming/<runId>` now set by `update-ref`. Every new
command in a person's repository carries `-c gc.auto=0 -c maintenance.auto=false` except the check `worktree add`'s
removal (the existing `removeOwnPath`).

## Correction (2026-11-19, change-sized runs P2 second wave: §5.7, the remaining criteria, A2)

Appended by the second P2 implementer (Orca session `3ba26002`, branch `feat/change-sized-p2`, worktree `.wt-p2`, over
`e9d43c8e`), against ccloop P1 at `633534c`; the npm pin is still `57b6d15`. Human approval for the criteria: 「同意这样大改，
并且同意改所有必要的判据」 (no existing criterion was rewritten in this wave; the fixture change is named below). The text
above is unchanged; where it and this section differ, this section is what ships. The previous Correction's "Not built in
this wave" line is superseded for §5.7 and A2; A1 and A3 are still not run.

**§5.7 as built.** Under a ccloop that advertises `features.attemptRef: "v1"`, `stepA2Multi` asks for the key on
protocol 4 and the run records `snapshotVersion: 2` (and `attemptDelivery` when the envelope carries the key), as `stepA2`
does. Step C resolves each written directory's attempt -- the primary exactly as a one-directory run; an extra from
collect's `dirs[].attemptSha` (keyed) checked in that directory's own workspace, or from `repos/<key>` committed by Orca
(legacy envelope) -- and pins it create-only at `refs/orca/runs/<runId>` in that directory's target before anything reads
it. Differences from §5.7's text:
- An extra is checked only for `attempt-missing` and `attempt-not-from-base`: collect's `dirs[]` carries no tree and no
  ref for an extra (ccloop's extras share `refs/ccloop/run/attempts/<n>`), so the other two checks have nothing to compare.
- A refusal for an extra is the same block reason prefixed with its key (`alpha:attempt-not-from-base`,
  `alpha:run-ref-conflict:<sha>`); in an archive the same as missing evidence (`attempt-unpinned:alpha:…`).
- The primary's pin stays on `drive.runRef`; `drive.dirs[i].runRef` is written for extras only (i ≥ 1).
- Readers after the pin read each directory's target: harvest, the no-change trees, the multi criteria flag
  (`driverLanding.ts`, the `multiCriteriaFlag` loop) and the landing (`produceMultiMerge` sets
  `refs/orca/incoming/<runId>` with `update-ref` when the directory's pin holds the attempt; a v1 run fetches as before).
- `archiveDriveRun` pins every extra too (the failure paths that never ran C); extras are never snapshotted (N6).
- `repos/` at a settle that did not land (`stepCleanupFailed`, `dropResultCopyAfterSettle`) goes iff the run is v2 and
  every extra is pinned (`extrasPinned`); a v1 run keeps it exactly as P0 left it. Step E removes it as before.
  `cleanupPredecessor` is unchanged (a multi run is never continued).

**A2 as built** (`tests/bench/changeSizedSettle.ts`, not in any test tier). The bench clones `ORCA_BENCH_REPO`
`--local --no-checkout` under `ORCA_CONTROL_DIR` and never writes the measured repository; it refuses a control directory
under `~/.orca` and an existing one. `stepE_ms` is the real `archiveRunV2` plus the real `cleanupRunWorkspace`;
`artifactBytes` is the growth of `<state>/artifacts/*/data` on disk across the archive; `logsBytes` the 70 run-directory
files as written; `changeBytes` the bundle artifact; `metaBytes` the snapshot artifact plus the archive manifest;
`targetObjectsGrowthBytes` the growth of the target clone's `.git/objects` (apparent sizes). Measured once, on the
measured repository class (26,200 tracked files, 3,828,534,171 bytes tracked at HEAD), Orca `f8d12edb` with the bench as
committed in `77516016`: exit 0; `stepE_ms` 3,979 (archive 3,826, cleanup 152); `verify_ms` 234; `changeBytes` 796;
`logsBytes` 145,055; `metaBytes` 17,027; `artifactBytes` 162,878; `sourceBytes` 145,055; `workspacesEntries` 0;
`targetObjectsGrowthBytes` 2,560; load averages 40.62 before, 44.23 after. The original's `git worktree list`,
`git status --porcelain` and HEAD were byte-identical before and after.

**A gap the criteria cannot see (measured).** With an empty global git config (every criterion runs under a relocated
`HOME`), `git fetch --no-tags <missing path> +<oid>:<ref>` exits 0 when `<oid>` is already in the repository; under the
person's own `HOME` on this machine the same command exits 128 (`/usr/bin/git` 2.50.1, measured in a scratch repository
both ways). So the landing's `update-ref` branch (one-directory `stepD` and `produceMultiMerge`) is invisible to every
criterion: the mutation "always fetch from the result copy" stays green in `changeSizedDriver.test.ts` and
`changeSizedMulti.test.ts` alike. The branch is kept (it is what works under a person's configuration); no criterion
claims it.

**Rule 17 (§9).** No writer beyond §9's table: the extras' pins and their objects are §9's "each written directory's
target" row. The bench writes only under `ORCA_CONTROL_DIR`.

**Criteria added (additive).** `tests/control/changeSizedMulti.test.ts` (P2-9: keyed multi with an extra in clone mode,
the failed keyed archive, the empty keyed run's no-change trees, a legacy-envelope multi run's failed cleanup and handoff
settle dropping `repos/`); `tests/control/changeSizedReaders.test.ts` (accept-attempt `snapshot-base-unavailable` after
the target's history was rewritten and pruned; the `!record` gate on a saved-result recovery envelope; `sourceRecord`'s
`-v2` / `-v1` kinds and `saved-result-source-v2-unsupported` before the source port is asked). Fixture change, not a
criterion: the synthetic ccloop (`driverPort.ts`) records keyed extras as ccloop P1's `recordExtras` does and answers
`dirs[]` (option `extraFiles`); without the key it is unchanged.

## Correction (2026-11-19, change-sized runs P2 review)

Appended by the P2 review-and-fix wave (Orca session `3ba26002`, branch `feat/change-sized-p2`, worktree `.wt-p2`, over
`95f30d04`). Human approval for the criteria: 「同意这样大改，并且同意改所有必要的判据」. The text above, the two P2 Corrections
included, is unchanged; where it and this section differ, this section is what ships.

**"A gap the criteria cannot see" (second-wave Correction) -- the measurement is wrong, and the gap is closed.** The cause
is not the git configuration. `git fetch <path> +<oid>:<ref>`, whose only source is an exact object id, lists no remote
refs; when `<oid>` is already in the repository and connected (`rev-list --objects --stdin --not --all` finds nothing
missing) fetch's quickfetch never connects to `<path>`, so a missing path exits 0. Measured with `/usr/bin/git` 2.50.1 in
a scratch repository at this wave's base (`95f30d04`): `git fetch --no-tags <missing>/repo "+${OID}:refs/x/q"` exits 0
under the person's own configuration and under `GIT_CONFIG_GLOBAL=/dev/null` alike, also for a present but unreferenced
commit; `GIT_TRACE=1` inside a criterion shows only the `rev-list` connectivity check and no `git-upload-pack`. The exit
128 reported "under the person's own HOME" was not reproduced; the same command typed as `$OID:refs/...` in zsh exits 128
because zsh reads `:r` as a history modifier and git receives `<oid>efs/...` (observed in this wave). Consequences: the
landing's `update-ref` branch is not needed for correctness (the old fetch of a pinned attempt would also succeed), and it
is kept as the direct form. Criteria now see it: `tests/control/fixtures/gitSpy.ts` records every git child's argv, and
`changeSizedDriver.test.ts` / `changeSizedMulti.test.ts` assert no fetch from the run's source directory and one incoming
`update-ref` per directory's attempt (mutation "never take the update-ref branch" in `driverLanding.ts`: red in both).

**§6.2, the report a run saves.** As first built, collect's `dirs[]` was copied into every `ExecutionReport`, so under the
pinned ccloop a multi-directory run's saved report (an artifact whose id hashes the report) differed from the one it saved
before P2. It is copied only for a keyed run, the only one whose step C reads it.

**§5.3 / §9, the check worktree.** "Removed on the next round or restart; at settle at the latest" was built without the
last part: a run that left `accepted` while its check was in flight, or whose marker write lost a race after the worktree
was made, kept `<workspacesRoot>/check-<runId>` and its registration in the target for ever. `cleanupRunWorkspace` now
removes it when it exists, so every settle and cleanup path does; a v1 run never has one and its cleanup is unchanged.

**Rule 17 (§9), first P2 Correction's last sentence.** "Every new command in a person's repository carries `-c gc.auto=0
-c maintenance.auto=false`" is not exact: the landings' `update-ref refs/orca/incoming/<runId>` (`driverLanding.ts`,
`acceptAttemptDriver.ts`) and the read-only commands (`rev-parse`, `cat-file`, `merge-base`, `diff`, `ls-tree`) carry no
such flags. None of them starts an automatic gc or maintenance; the commands that can (`fetch` -- the trace above shows
`git maintenance run --auto` after it -- and the check `worktree add`, `bundle create`/`verify`) carry them.
