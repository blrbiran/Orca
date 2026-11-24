# Test time across the four repos — analysis for the next session

Status: **analysis only, no code changed.** Written 2026-11-24 (Orca session `221948a1` continuation) at the human's
request: "当前测试总是跑全量非常浪费时间，这已经变成一个非常严重的问题了，下个session需要优先解决这个问题。跑全量你可以做成
一个单独的 npm run 命令，只有在发布、人特别说要跑的时候才跑，其他时候都应该只跑修改到部分的测试。测试本身你也看下是否有冗余、
是否需要优化、是否有已经不需要的测试了、是否有可以缩减时间的方案。" Implementation is the next session's first item.

**This direction supersedes CLAUDE.md Rule 18's "每批合入 main 跑一次 npm run test:wide"** — the human now wants only
the changed part tested except at release or on request. Rule 18 must be amended in the same change (Rule 11).

## 1. What happens today (measured)

| Repo | `npm test` | Selection | Notes |
|---|---|---|---|
| Orca | `scripts/test-affected.mjs` (quick) | mirror dir (prefix-limited above 60 files) + direct importers + dir table | `test:wide` = transitive importers + whole mirror dir; `verify` = release gate |
| ccloop | `vitest run` | **none — always the full ~300 files** | `check-known-reds.mjs` interprets reds |
| ccmem | `run-tests.sh` over every unit+integration file | none | ~1,090 tests, ~40 s at low load — not the problem |
| syncskill | `vitest run tests/unit tests/integration` | none | **no vitest config: also runs copies under `.claude/worktrees/`** |

### 1.1 Orca's wide tier is the full suite in practice

The 2026-11-24 wide gate for a batch that changed 8 paths (`src/control/ccloopPort.ts`, `src/control/groupEdges.ts`,
two test files, one fixture, the ccloop pin) selected **918 of ~938 root test files**
(log: `test-affected: 918 test files selected (918 root, 0 web)`):

- 870 files were selected because they *transitively* import `ccloopPort.ts`, 727 for `groupEdges.ts`.
- 542 files were selected by the mirror rule for `tests/control/` (the whole directory — wide does not apply quick's
  filename-prefix limit).
- Only 3 files were selected by the ccloop-pin rule alone.

Hub modules (the port, the store, controlViews, groupEdges, …) sit under almost every test through fixtures, so "transitive
importers" ≈ everything. Any change to one of them turns wide into a full run.

### 1.2 Where Orca's time goes

From vitest's results cache (`node_modules/.vite/vitest/<hash>/results.json`, last written by a run at load ~100, so
absolute seconds are inflated; proportions hold): 996 files, ~19,960 file-seconds summed.

- `tests/control` 15,428 s (77%), `tests/flow` 2,311 s, `tests/panel` 1,141 s.
- Top 10 files = 18%, top 30 = 37%, **top 100 = 63%**. 299 files under 1 s total 96 s.
- Slowest: `workerLostE2E` 530 s, `executionDriverE2E` 472, `flow/stepSkipDefer` 386, `agentSelectionE2E` 370,
  `handoffE2EResume` 347, `handoffE2E` 336, `multiDirLandingD` 321, `flow/feedbackIntake` 314,
  `sleepBlockedResumeE2E` 303, `driverReconcile` 298, `handoffE2ERecovery` 276, `offPlanWritesE2E` 268,
  `integrationResolve` 266, `requirementReviewFix` 258, `flow/coverParam` 228.
- Fixed per-file overhead not yet measured: `tests/setup/relocateUserData.ts` snapshots the real `~/.orca` in setup and
  afterAll of **every** file (#338 bounded it; it once took ~12 s). × ~900 files this may be a large share.

### 1.3 Other observations

- syncskill: `install-cli` (91 s), `profile-inject-cli` (35 s) spawn `npx tsx` per case (2.5–4.3 s each under load
  against a 5 s timeout) — they time out under load and ran once per stale worktree copy. Stray worktrees present:
  `syncskill/.claude/worktrees/tester-open-issues-20261123` (not this session's; leave to the human), and a
  `/private/tmp/ss-baseline` worktree registration.
- Machine load during this session was 50–300 (other sessions); every wall-clock-deadline test turns red under it, and
  reds trigger reruns — load amplifies the cost of every over-selected file.

## 2. Proposal (for the next session; pick and implement)

1. **Three tiers, named for what they are** (all repos that use vitest; ccmem may stay as is):
   - `npm test` — changed part only (today's quick rule). Default for every patch set **and** for merges into main.
   - `npm run test:full` — everything; only at release (`verify`) or when the human asks. Rename Orca `test:all`/drop
     `test:wide` as a routine merge gate; keep `--rerun-failed`.
2. **Stop transitive selection from hub modules.** Options, in order of preference:
   - a. direct importers + the module's own mirror tests (filename prefix) only — what quick already does;
   - b. transitive with a depth limit (≤2) and a hub list (modules imported by >N% of tests count as direct-only);
   - c. keep transitive but cap the selection and print what was cut (honest but still slow).
   Recommendation: (a) for merges; full suite catches the rest at release.
3. **ccloop gets a `test-affected`** (port Orca's script or share one): `npm test` = affected, `test:full` = today's run;
   `check-known-reds` runs on either.
4. **syncskill**: add `vitest.config.ts` with `include: ["tests/**/*.test.ts"]` (or exclude `.claude/**`, `.worktrees/**`);
   make install-cli / profile-inject-cli run the built `dist` entry once instead of `npx tsx` per case.
5. **Slow-file work (Orca)**, measured before and after each change:
   - measure `relocateUserData` per-file overhead first (cheapest possible win if large);
   - the ~15 E2E files above: release-tier only unless their own source changed (the pin rule already does this for the
     real-ccloop ones); look for shortened polling intervals / deadlines in their drivers;
   - redundancy candidates to check by scenario, not by name: `handoffE2E`/`handoffE2EResume`/`handoffE2ERecovery`;
     `requirementE2E`/`dirRequirementE2E`/`dirRequirementOutOfRepo`/`agentWalk` (all drive a split through the same fake
     claude queue); `workerLostE2E` vs `workerLost` unit tests. A test is removable only when a named mutation it catches
     is also caught by another (Rule 9 — run the mutation, do not argue it).
6. **Never in a test**: `vitest run` without an explicit file list from inside a repo that has worktrees under it.

## 3. Open questions for the human

1. Merges into main: changed-part only (proposal 1), or changed-part plus a small fixed smoke set (e.g. the real-ccloop
   default-resolution E2E)? My call: changed-part plus the smoke set only when the ccloop pin changes (already a rule).
2. May E2E files that run > 60 s move to the release tier even when a module they import changes? My call: yes, unless
   the change is to the file itself or to the module it exists to test.
