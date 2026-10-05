# Codex Skill Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Orca runs with the existing `skills` declaration use their frozen skills during Codex plan, execute, and verify phases, without changing existing skills in an attempt worktree or writing them into a published commit.

**Architecture:** Extend protocol 3 with the mutually exclusive `work.codexSkillsDir` field and pass it only when ccloop reports a Codex agent. In ccloop, install temporary links under the attempt worktree's `.agents/skills` around each Codex CLI phase, then remove only links owned by that setup before the phase can publish. Implement ccloop in a local clone under `/private/tmp`; exercise Orca against its built CLI with `ORCA_CCLOOP_BIN` and leave the ccloop clone available for the human to push and Orca to re-pin later.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Zod protocol schemas, Vitest, Codex CLI, local recording model endpoint.

**Spec:** `docs/superpowers/specs/2026-10-05-codex-skill-support-design.md`

## Global Constraints

- Do not read, write, or migrate real `~/.orca/*`; isolate `HOME`, all four XDG roots, and `TMPDIR` for every verification gate.
- Do not modify `/Users/biran/code/skills/loop/ccloop`; make and test ccloop changes only in a clone under `/private/tmp`, and leave that clone available for handoff.
- Never read, copy, change, or overwrite Codex credentials or the user's `CODEX_HOME`.
- The snapshot stays external to the attempt worktree and read-only; `codexSkillsDir` is its canonical absolute `skills` directory.
- `skillPluginDir` and `codexSkillsDir` are mutually exclusive. ccloop accepts `skillPluginDir` only for Claude and `codexSkillsDir` only for Codex.
- Existing `.agents/skills` content is preserved byte-for-byte. Refuse selected-name collisions; never recursively remove `.agents` or `.agents/skills`.
- Remove generated links after each Codex child exits and before attempt publication. Cleanup failure blocks publication.
- Preserve the no-skill envelope and argv goldens, existing Claude behavior, and the current lock record.
- Do not pin Orca to an unpublished ccloop commit or push either repository. Keep any ccloop local commit/diff for the human; re-pin only after the human has pushed ccloop.
- The Codex `exec` acceptance probe must use a local recording endpoint and temporary home directories. If it cannot prove that the linked skill is read without an external model, stop and revise the design before implementation proceeds.
- No paid or external-model acceptance is part of this work.

## Review Focus

- A pre-existing `.agents/skills` tree contains a legacy skill and unrelated files: assert their bytes and paths are unchanged after success and failure in Task 3.
- A selected skill name collides with a directory, file, or foreign symlink: assert refusal occurs before Codex starts and the original entry remains intact in Task 3.
- `.agents` or `.agents/skills` is a symlink or non-directory: assert setup refuses without traversing or mutating its target in Task 3.
- Setup partially creates links, or encounters an exact stale same-run link: assert only owned/adopted links are cleaned; foreign links survive in Task 3.
- A Codex child exits abnormally or cleanup fails: assert child close precedes cleanup, the stable error survives phase evidence and Orca's blocked-run reason, and no attempt is published with an Orca link in Tasks 3 and 5.

---

## File Map

**ccloop clone (`/private/tmp/orca-h6-ccloop`):** protocol and accept validation stay in `src/control/protocol.ts` and `src/control/accept.ts`; adapter option propagation stays in `src/control/worker.ts` and `src/agents/registry.ts`; link ownership lives in a focused `src/runtime/codex/codexSkills.ts`; per-phase wrapping belongs in `src/runtime/codex/codexAdapter.ts` / `runCodexPhase.ts`. Tests remain beside these boundaries under `tests/control` and `tests/runtime/codex`. Update the clone's handoff with the local-only commit and human push/re-pin sequence.

**Orca:** kind gating is in `src/control/webService.ts`; the typed work object and strict schema are in `src/control/executionPort.ts` and `src/control/schema.ts`; envelope selection is in `src/control/executionDriver.ts` and `src/control/startEnvelope.ts`. Focused tests are `tests/control/confirmSkills.test.ts`, `setTaskLoopSkills.test.ts`, `driverSkills.test.ts`, `startEnvelope.test.ts`, and `skillsE2E.test.ts`. Update `docs/handoff/handoff.md` and the relevant SDD progress record with verified outcomes and remaining human steps.

### Task 1: Prove Codex `exec` Uses the Linked Skill Offline

**Files:**
- Create or extend: isolated probe under `/private/tmp/orca-h6-probe/` (do not add probe fixtures to Orca until the behavior is proven).
- Test: actual installed `codex exec` against a localhost recording provider.

**Interfaces:**
- Produces: an offline reproducible probe command and recorded evidence; no product code changes.

- [x] **Step 1: Build the isolated fixture.** Create a temporary attempt git worktree, a temporary `HOME` and `CODEX_HOME`, a selected skill with a unique marker, an unrelated pre-existing skill, and a symlink at `.agents/skills/<selected-name>` to the selected snapshot.
- [x] **Step 2: Run the actual Codex CLI against a local recorder.** Ask Codex to invoke the selected skill; have the localhost provider return a deterministic tool/action response that makes Codex read `SKILL.md`. Record requests and assert the unique marker is model-visible, the unrelated skill remains byte-identical, and all model traffic targets localhost.
- [x] **Step 3: Record the result.** Save the exact command, CLI version, request evidence, and return code in the ccloop clone's progress/handoff notes. If deterministic local activation cannot be demonstrated, stop here and revise the design; do not count `codex debug prompt-input` alone as acceptance.

### Task 2: Add the Protocol Field and Agent-Kind Validation in ccloop

**Files:**
- Modify: `src/control/protocol.ts`, `src/control/accept.ts`
- Test: `tests/control/protocol.test.ts`, `tests/control/skillPluginDirAccept.test.ts` (extend or rename to cover both fields)

**Interfaces:**
- Produces: parsed `work.codexSkillsDir?: string`; accept-time validation requires a canonical existing directory and enforces Claude/Codex field pairing.

- [x] **Step 1: Clone ccloop into `/private/tmp/orca-h6-ccloop` and capture its base revision.** Keep the original ccloop checkout untouched; install or link dependencies only inside the clone as project instructions allow.
- [x] **Step 2: Add failing protocol tests.** Assert a canonical absolute `codexSkillsDir` parses; relative/missing/noncanonical paths fail at accept; either field alone with the wrong agent kind fails; both fields together fail; later protocol methods accept absolute paths without rechecking directory existence. Preserve the no-field protocol golden.
- [x] **Step 3: Implement the strict additive schema and accept checks.** Add the optional field to loop work, validate both fields as absolute paths for all methods and canonical directories at accept, reject both together, and pair each field with its only supported agent kind.
- [x] **Step 4: Run focused protocol and accept tests.** Run the ccloop Vitest files above and typecheck; expect all existing Claude cases and new Codex cases to pass.
- [x] **Step 5: Commit the protocol boundary in the ccloop clone.** Use a message naming protocol 3 Codex skill path support; do not push.

### Task 3: Implement Safe Per-Phase Codex Skill Link Ownership

**Files:**
- Create: `src/runtime/codex/codexSkills.ts`
- Modify: `src/runtime/codex/runCodexPhase.ts`, `src/runtime/codex/codexAdapter.ts`, `src/agents/registry.ts`, `src/control/worker.ts`
- Test: new `tests/runtime/codex/codexSkills.test.ts`; extend `tests/runtime/codex/runCodexPhase.test.ts`, `tests/control/worker.test.ts`

**Interfaces:**
- Produces: `withCodexSkillLinks<T>(worktreePath: string, skillsRoot: string, run: () => Promise<T>): Promise<T>`; adapter options are `{ skillPluginDir?: string; codexSkillsDir?: string }` and accept validation guarantees at most one is set.
- Consumes: Task 2's validated `codexSkillsDir`.

- [x] **Step 1: Add failing helper tests.** Cover canonical source validation and root containment; preserving pre-existing `.agents/skills/legacy/SKILL.md` bytes and unrelated files; successful creation/removal; directory/file/foreign-link leaf collisions; symlink and non-directory parents; partial setup cleanup; adoption and removal of an exact same-run stale link; and cleanup failure reporting.
- [x] **Step 2: Implement `withCodexSkillLinks` in `codexSkills.ts`.** Read selected names from the frozen root in sorted order; verify each source is a canonical directory within that root; use `lstat` for `.agents` and `.agents/skills`; create only absent leaf symlinks; adopt only an exact symlink to the same run-specific canonical source; track created parents and owned/adopted leaves; remove only still-matching links and only empty parents created by this call. Emit the spec's stable `codex-skills-source-invalid:*`, `codex-skills-path-conflict:*`, `codex-skills-setup-failed:*`, and `codex-skills-cleanup-failed:*` prefixes.
- [x] **Step 3: Run helper tests and typecheck.** Confirm each preservation/refusal assertion passes before adding it to the Codex process lifecycle.
- [x] **Step 4: Add lifecycle tests.** Use a fake Codex child to assert links exist while the process runs, are removed only after its `close` event, and are absent after success, error, timeout, and abort. Assert setup refusal prevents spawn; cleanup refusal returns a failed phase outcome; and `codex-skills-*` reasons remain in ccloop phase evidence.
- [x] **Step 5: Wire adapter options through worker to each Codex phase.** Extend `AgentDescriptor.createAdapter` options, pass `codexSkillsDir` from the accepted envelope, and wrap each plan/execute/verify child lifetime with `withCodexSkillLinks`; leave absent-field behavior and Claude adapter construction unchanged.
- [x] **Step 6: Run focused runtime, worker, Claude golden, and protocol tests.** Expect all three Codex phases to see the frozen skill and the existing Claude/no-skill goldens to remain unchanged.
- [x] **Step 7: Commit the ccloop lifecycle change locally.** Do not publish the clone or push it.

### Task 4: Allow Orca Skills for Codex and Select the Correct Wire Field

**Files:**
- Modify: `src/control/webService.ts`, `src/control/executionPort.ts`, `src/control/schema.ts`, `src/control/executionDriver.ts`, `src/control/startEnvelope.ts`
- Test: `tests/control/confirmSkills.test.ts`, `setTaskLoopSkills.test.ts`, `driverSkills.test.ts`, `startEnvelope.test.ts`

**Interfaces:**
- Produces: `LoopWork.codexSkillsDir?: string`; the driver sets exactly one path field based on the frozen ccloop-reported agent kind and omits both when the run has no skills.

- [x] **Step 1: Add failing Orca tests.** Codex kind passes confirmation and loop skill changes; unsupported kinds remain refused; Codex runs put the snapshot's canonical `skills` directory in `codexSkillsDir`; Claude runs continue to use `skillPluginDir`; lock contents remain unchanged; both fields are rejected together; and no-skill envelope JSON remains equal to its existing golden.
- [x] **Step 2: Implement kind-aware work typing and schema.** Add the optional strict `codexSkillsDir` field and cross-field exclusivity validation without loosening unrelated fields.
- [x] **Step 3: Implement kind-aware confirmation and envelope selection.** Permit only `claude` and `codex` for skill-bearing runs; keep the existing unsupported-agent error for all other or missing kinds; select the protocol field from ccloop's agent table result, not caller-supplied kind.
- [x] **Step 4: Run focused Orca tests and typecheck.** Include current Claude skill tests and no-skill golden tests; expect no lock-format changes.
- [x] **Step 5: Commit the Orca control-path change locally.** Leave dependency pin files unchanged because the ccloop commit is not pushed.

### Task 5: Prove End-to-End Phase Cleanup and Preserve the Rollout Boundary

**Files:**
- Modify: ccloop clone's control/runtime integration fixtures and tests; Orca `tests/control/skillsE2E.test.ts` and/or a dedicated Codex skills E2E test.
- Modify: Orca `docs/handoff/handoff.md`; ccloop clone's handoff/progress notes.

**Interfaces:**
- Consumes: Task 3's local ccloop CLI build and Task 4's Orca envelope selection.
- Produces: isolated end-to-end evidence that all phases receive the frozen skill, attempt publication contains no generated link, old Claude behavior remains, and rollout is waiting for human ccloop push before Orca re-pin.

- [x] **Step 1: Add a fake-Codex E2E fixture.** Run a Codex skill-bearing task with `ORCA_CCLOOP_BIN` pointing to the ccloop clone's build and a temporary agents table. Assert plan, execute, and verify each read the unique skill marker; inject a pre-existing `.agents/skills/legacy` skill and assert it survives unchanged; and inspect the published attempt to prove the generated link is absent.
- [x] **Step 2: Add conflict and interrupted-run E2E cases.** Assert a selected-name conflict blocks before Codex invocation and preserves the original; assert a recoverable stale exact link is cleaned before publication and foreign links are never removed; inject a cleanup failure and prove neither normal completion nor resume can publish the attempt while an Orca link remains. Verify Orca's blocked-run reason contains the same stable failure prefix.
- [x] **Step 3: Run the E2E tests with isolated state.** Redirect `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, and `TMPDIR`; verify the tests use only fixtures and temporary paths.
- [x] **Step 4: Update handoff evidence.** Record ccloop local commit subjects and clone path, offline Codex CLI probe results, tests/gates and any red items, plus the required human action: push ccloop first, then authorize/update Orca's exact dependency pin. Do not state the rollout is shipped or remotely verified.
- [x] **Step 5: Commit the E2E and handoff changes locally.** Keep ccloop commits and Orca commits separate; do not push.

### Task 6: Run Isolated Verification and Report Exact Results

**Files:**
- No source changes unless a focused failure reveals a defect; if changed, update the owning task's tests and rerun its gates.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: recorded pass/fail/skip counts, ccloop clone location, Orca local commit subjects, and remaining human rollout action.

- [x] **Step 1: Create clean verification clones.** Use isolated Orca and ccloop clones under `/private/tmp`; point Orca's `ORCA_CCLOOP_BIN` at the completed ccloop build and use redirected home/XDG/TMPDIR roots. Do not treat a mutation clone as the `ORCA_CCLOOP_BIN` build.
- [x] **Step 2: Run focused gates.** Run the protocol, runtime, worker, skills E2E, confirmation, envelope, typecheck, build, control, scheduler, panel, workspace, and ccloop-pin checks that apply. Record each command, exit code, and skipped count.
- [x] **Step 3: Run full Vitest once in the isolated Orca clone.** Record every failed or skipped test by name, including known-red classifications; do not report all-green if any red or skip remains.
- [x] **Step 4: Verify no temporary skill path is in an attempt commit.** Inspect the produced commit/tree and run the temp-leak checker; confirm generated symlinks have been cleaned before publication.
- [x] **Step 5: Report completion without claiming remote rollout.** State that no live/paid model call, push, or real `~/.orca/*` access occurred; identify that the human must push ccloop before Orca can be re-pinned.
