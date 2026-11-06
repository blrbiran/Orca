# Observed Path Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized agent or person retry a `blocked_waiting_human` task with only the exact paths its last run reported missing, while preserving old run evidence and a valid next claim.

**Architecture:** ccloop produces bounded, typed allowlist-miss evidence at collect; Orca stores it and applies a dedicated immutable path amendment inside `retry-task`'s transaction. Historical retry claims are checked against their own frozen contracts, while the next claim reads a new confirmed snapshot and work-item hash. CLI, Web and split guidance surface the route.

**Tech Stack:** TypeScript, Zod, SQLite, Vitest, React. ccloop pin currently `a49ab7b`.

**Spec:** `docs/superpowers/specs/2026-11-06-observed-path-retry-design.md`

## Global Constraints

- ccloop and Orca are separate repositories. Commit each locally; the owner pushes. Repin Orca only after the ccloop commit is remote.
- New ccloop collect data is optional and top level; the protocol-3 `terminal` projection stays byte-identical. Old pins lack evidence and Orca refuses path expansion by name.
- Evidence bounds: at most 128 misses, each path at most 4,096 UTF-8 bytes, each repository key at most 128 UTF-8 bytes; omit the field rather than truncate a path.
- Never rewrite an old run, archived plan, previous command row or `.decisions/` line. The path flag alone changes only exact path lists; a simultaneous `work` uses the existing top-up rules.
- Do not add a static import across the Orca control module cycle; use leaf modules, dependency injection or `await import()`.
- Tests use fake-codex integration data, a clone build of the pinned ccloop, scratch `CCLOOP_CACHE_DIR`, and a `web/dist` link in worktrees. No paid provider call without a fresh owner approval.
- Every new criterion is seen red before code; run `npm test` and typecheck after each repository's implementation. Compare a load red with an untouched main clone before registration.

## Review Focus

- A denylist or max-files gate also has incidental allowlist misses: it must emit no path authorization evidence (Task 1 test).
- An executor reports a path Git did not observe in the primary worktree: it must receive no path authorization evidence (Task 1 test).
- The latest run is stale by the time the command arrives: it must refuse without moving any contract or grant (Task 4 test).
- A second expansion follows an earlier retry: both historical claims must still validate against their own contracts (Task 3 and 4 tests).
- A path newly overlaps an unfinished sibling or active group: refuse before changing the actual dispatch order (Task 4 test).

---

### Task 1: ccloop reports every observed allowlist miss

**Files:** ccloop `src/policy/pathPolicy.ts`, `src/controller/runLoop.ts`, `src/state/types.ts`, `src/control/collect.ts`; new `tests/controller/observedPathMisses.test.ts` (or the nearest existing policy and multi-repo files); ccloop plan/handoff.

**Interfaces:** Produce optional top-level `CollectionV1.pathPolicyMisses?: Array<{repoKey: string | null; path: string}>`. Only a terminal blocked by an allowlist miss carries it. The private run state holds the list across later collects; protocol-3 terminal bytes do not change.

- [ ] Add tests: primary two misses, additional-repo misses, mixed primary/additional misses, reported-but-unobserved path, denylist/max-files precedence, non-allowlist terminal absence, collect after restart, protocol-3 terminal byte equality.
- [ ] Run the named ccloop tests against `a49ab7b` and see the missing field fail.
- [ ] Add a pure all-misses helper to `pathPolicy.ts`; keep `evaluatePathPolicy`'s existing first-reason behavior. At the terminal gate, collect the full list only if the existing verdict is `allowlist miss`; bound and dedupe it, then project it at top-level collect.
- [ ] Run the named tests, `npm run typecheck`, `npm run build`, then ccloop's required test gate. Record every red and compare as required.
- [ ] Commit ccloop locally; do not push. The owner must push before Task 7 repins.

### Task 2: Orca accepts and shows typed path evidence

**Files:** Orca `src/control/executionPort.ts`, `src/control/ccloopPort.ts`, `src/control/driveRecord.ts`, `src/control/executionDriver.ts`, `src/panel/controlViews.ts`, `src/control/webProtocol.ts`, `src/commands/domains/reads.ts`, `web/src/TaskDetail.tsx`; new `tests/control/observedPathEvidence.test.ts`, CLI and Web view tests.

**Interfaces:** Orca `PathPolicyMissV1 = {repoKey: string | null; path: string}`; `ExecutionReport.pathPolicyMisses?` maps ccloop's top-level field to the blocked run's drive record. Readers expose the list and `stopReason` for the current blocked run. It is never synthesized from the human text.

- [ ] Add failing parser/driver/view tests for a blocked allowlist run, absence on an old pin, malformed list refusal, and complete human CLI/Web display.
- [ ] Make the intake optional and strict: only `terminal.status=blocked_waiting_human` with an allowlist stop reason may carry the list; bound count, length, uniqueness and repository keys. Persist and project it without changing old-run bytes when absent.
- [ ] Run the named tests and commit this backward-compatible consumer before using ccloop's new binary.

### Task 3: A dedicated path amendment preserves contract and history

**Files:** Orca new `src/control/observedPathAmendment.ts`; `src/control/taskAmendments.ts`, `src/control/executionSnapshot.ts`, `src/control/retryGrant.ts`, `src/panel/controlViews.ts`; new `tests/control/observedPathAmendment.test.ts`.

**Interfaces:** `applyObservedPathAmendment(store, groupId, taskId, sourceRunId, misses, commandId): {originalContractHash: string; derivedContractHash: string; executionSnapshotHash: string}` executes inside the caller's transaction. Its immutable record contains source run, previous/next hashes, repo-qualified exact paths, actor and command. `effectivePlanTask` validates the loop recipe first, then the path overlay. `validateRetryGrantSource` checks historical run identity against each run's own claim plus the recorded amendment chain, not the current work hash.

- [ ] Add failing tests for primary and additional-repo path-only changes, unchanged checks and non-path fields, a second amendment, forged chain, old claim validation and next claim/read projection. Include the unknown repo-key input.
- [ ] Implement the leaf validator and canonical records. Update work `originalContractHash`, `contract.contentAddressedHash`, `derivedContractHash`, `observedPathsVersion` and `proposal.executionSnapshotHash` together; keep `targetVersion` and graph version fixed. Make `readConfirmedTaskExecution` and group projection validate the resulting state.
- [ ] Adjust the historical retry-source check only for a proven amendment chain; keep its grant, usage, lineage, agent and profile guards.
- [ ] Run named tests and commit. Do not introduce a static control import cycle.

### Task 4: Atomic retry authorization and conflict refusal

**Files:** Orca `src/control/webProtocol.ts`, `src/control/retryTask.ts`, `src/control/webService.ts`, `src/panel/permissions.ts`, `src/control/errors.ts`; new `tests/control/observedPathRetry.test.ts`.

**Interfaces:** `retry-task` payload gains `allowObservedPaths?: true`, requiring `runId` when present. Only the last blocked-at-C `blocked_waiting_human` run with typed misses can use it; an Orca-dispatched agent and `orca-auto` cannot. It may coexist with `work` under today's top-up rules.

- [ ] Add failing tests: agent and person success, two misses one retry, stale run/revision, no typed evidence, denylist, symlink escape, unknown repo, same-group and active-group overlap, concurrent claim, replay and no partial writes.
- [ ] Preserve the existing retry eligibility and old-run settlement first. In that same transaction validate exact observed paths, existing frozen `dependsOn` order and active groups, apply Task 3's amendment, then mark the task ready. Recheck the next claim and panel projection before commit.
- [ ] Run named tests, existing `retryTask`/`retryTopUp`/`savedResultRecovery` tests, and commit.

### Task 5: CLI, Web and skill route

**Files:** Orca `src/commands/domains/work.ts`, `src/commands/domains/reads.ts`, `web/src/ControlGroupView.tsx`, `web/src/TaskDetail.tsx`, `web/src/controlApi.ts`, `web/src/locales/{en,zh}.ts`, `skills/orca-control/SKILL.md`, `skills/orca-control/references/task.md`; command and Web tests.

**Interfaces:** `orca task retry <group> <task> --run <id> --allow-observed-paths` sends only the Boolean flag, never caller-chosen paths. Web lists the observed paths before its action. Ordinary retry still states that it retains old paths.

- [ ] Add failing CLI payload/output and Web action tests, including no evidence and unsupported old-pin cases.
- [ ] Implement the flag and views; update the skill's blocked-waiting-human and split-review path, then regenerate CLI references with `npm run gen:cli-docs` if the registry changed.
- [ ] Run command, Web and skill tests; commit.

### Task 6: Prevent the split/loop contradiction

**Files:** Orca `src/control/requirementSplit.ts`, related split prompt/validation tests, `skills/orca-control/SKILL.md`.

**Interfaces:** A `bugfix` split either grants a writable regression-test scope or chooses a loop without reproduce-first. The validator names the task and path-scope contradiction before acceptance; it does not widen paths.

- [ ] Add failing split tests based on #188: `bugfix` with source-only paths and a required new regression test is refused; a corrected split is accepted. Existing test paths and a standard loop remain valid.
- [ ] Update the prompt and deterministic validator without assuming one language's test-directory name; use repository overview/manifests as input.
- [ ] Run split tests, then commit.

### Task 7: Repin and integrated verification

**Files:** Orca `package.json`, `package-lock.json`, any ccloop integration tests, plan/handoff.

**Interfaces:** The Task 1 ccloop commit is pushed by the owner; only then `scripts/pin-ccloop.mjs <remote-sha>` changes the formal pin. Test env points to a build of that exact commit.

- [ ] After the owner's push, repin with the repo script in a worktree with real `node_modules` (not symlinked deps). Record the exact remote SHA from `ls-remote`.
- [ ] Add a real-binary synthetic-agent integration case: blocked allowlist result supplies two typed misses, the amended retry claims the new contract, old run evidence stays unchanged, and the task settles without a second path gate.
- [ ] Run `npm test`, typecheck, the ccloop-pin gate and targeted Web tests; compare any red with untouched main, then commit locally. No paid run is part of this plan.
