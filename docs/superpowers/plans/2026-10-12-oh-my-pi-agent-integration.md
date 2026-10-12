# oh-my-pi Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an installed oh-my-pi (`omp`) agent selectable in Orca and able to complete one ccloop plan → execute → verify task with truthful model identity, usage, and phase evidence.

**Architecture:** Add an `omp` descriptor and a one-shot JSON phase adapter inside ccloop. Keep model names and profiles per installation, resolve exact selectors from the local OMP catalog, and make Orca consume the new kind through its existing agent control interface. A local ccloop build supports isolated acceptance before any production repin.

**Tech Stack:** TypeScript, Zod, Node child processes, OMP CLI JSON events, Vitest, Orca React panel.

**Spec:** `docs/superpowers/specs/2026-10-12-oh-my-pi-agent-integration-design.md`

## Global Constraints

- `omp` model names are installation/user choices. Never put this machine's `local-litellm` or `ep-20261012204110-nvhqw` in product defaults.
- OMP installation `command` is binary-only; `profile` and `defaultModel` are structured fields. Model selection is an exact catalog selector, not OMP fuzzy matching.
- Every phase uses a private system-prompt file, stdin business prompt, `--no-extensions --no-skills --no-tools`, a phase tool list, an explicit frozen model, and the same frozen profile.
- Plan/verify are read-only. Execute uses only its named tools and ccloop's target-path controls. Audit forbidden events; in-allowlist extra work remains the human-accepted pilot risk.
- Incomplete phase usage is unknown to ccloop; any observed lower bound stays diagnostic. No synthetic zero or inferred monetary cost.
- All acceptance roots and user-data writes are redirected to private temporary directories. Run the real task only with a local ccloop build; do not repin or restart the production Orca service.
- Keep ccloop's existing tests intact; add new coverage. Every listed test/gate command, including targeted runs, redirects unfiltered output to a log that is read in full before judging the exit code; report skips explicitly.
- No merge to main, push, branch/worktree deletion, or gate opening without each repository's separately required authorization. These actions are outside this implementation plan.
- Use `rtk` for shell commands. For Git checks use `rtk proxy /usr/bin/git` where the handoff requires native Git behavior.

## Review Focus

1. A table-supplied `--extension`/`--hook` preargument must be refused before process launch (Task 1 test).
2. A named profile's catalog and auth must be selected consistently for discovery, confirmation, and phases (Tasks 1 and 3 tests).
3. A model that disappears between preview and Apply must leave the table unchanged (Task 2 test).
4. An interrupted phase with completed-message tokens must not become a known usage total (Task 3 test).
5. A valid-looking answer after forbidden tool activity or extra continuation must fail the phase (Task 3 test).

---

### Task 1: Exact OMP installation and model resolution in ccloop

**Files:**
- Create: `src/agents/omp.ts`, `src/agents/ompModels.ts`, `tests/agents/ompSelection.test.ts`
- Modify: `src/agents/registry.ts`, `src/agents/table.ts`, `src/agents/materialize.ts`, `src/control/command.ts`

**Interfaces:**
- `ompDescriptor: AgentDescriptor` has strict `defaultModel: string`, `profile: string | null`, and an exact one-element `command` schema; `singleCallExecution()` returns `null`.
- `readOmpModels(installation: InstallationV1): Promise<string[]>` reads bounded `omp models --json --no-extensions` under the installation's profile/config environment and returns exact catalog selectors.
- `canonicalOmpSelector(input: string, selectors: readonly string[]): string | null` accepts an exact selector or a bare ID with exactly one matching row for **draft-default discovery**; task/operator overrides require an exact returned catalog selector. It never uses fuzzy matching.
- `descriptorDefaults(descriptor: AgentDescriptor, installation: InstallationV1)` returns the existing constants for Claude/Codex and the installation's `defaultModel` for OMP. `tableView` and `resolveAgent` use this helper.

- [ ] **Step 1: Create an isolated ccloop worktree from local main**, leaving the current `codex/codex-strict-output-wire` checkout and its uncommitted handoff untouched. Write failing tests for binary-only OMP command rejection, exact/fuzzy/thinking selector behavior (including legitimate colons inside exact IDs), per-installation defaults in `capabilities` and `resolveAgent`, and distinct named/default profiles. Fake the bounded OMP catalog/config commands; no provider call.
- [ ] **Step 2: Run `rtk proxy npx vitest run tests/agents/ompSelection.test.ts`** and confirm the new cases fail for the specified missing behavior.
- [ ] **Step 3: Implement the descriptor, strict installation parsing, bounded catalog probe, canonical selection, and default hook.** Until Task 3 supplies the runtime, its `createAdapter` fails explicitly with `omp-adapter-unavailable`; the branch is not released between tasks. Keep Claude/Codex's existing descriptor values and hashes unchanged.
- [ ] **Step 4: Run the targeted test plus `tests/agents/registry.test.ts tests/agents/materialize.test.ts tests/agents/table.test.ts tests/control/command.test.ts`, then `rtk proxy npm run typecheck`** and confirm exit 0.
- [ ] **Step 5: Commit only Task 1 files locally.**

### Task 2: Discovery and installation update safety

**Files:**
- Create: `tests/agents/ompDetect.test.ts`, `tests/agents/ompUpdates.test.ts`
- Modify: `src/agents/detect.ts`, `src/agents/updates.ts`, `src/control/command.ts`

**Interfaces:**
- OMP's async draft probe runs `omp config get modelRoles --json` plus Task 1's catalog resolver under the candidate's profile/configuration. Failed/ambiguous defaults leave a candidate with `omp-default-model-unresolved` and no draft installation.
- `DetectionChange.unavailableReason?: "omp-frozen-model-unavailable"` represents a version/path candidate whose frozen selector is absent. Apply independently rechecks and refuses before table mutation.

- [ ] **Step 1: Write failing tests** for a valid OMP draft, missing/bare ambiguous default, preview addition without installation, unavailable version/path preview, and a model disappearing after preview but before Apply. Assert the table bytes do not change on refusal.
- [ ] **Step 2: Run `rtk proxy npx vitest run tests/agents/ompDetect.test.ts tests/agents/ompUpdates.test.ts`** and observe the intended failures.
- [ ] **Step 3: Add the async OMP draft path and preview/apply recheck.** Preserve current Claude/Codex discovery behavior. Extend ccloop's strict preview schema only with the optional reason field.
- [ ] **Step 4: Run the targeted tests plus `tests/agents/detect.test.ts tests/agents/updates.test.ts`, then `rtk proxy npm run typecheck`** to exit 0.
- [ ] **Step 5: Commit only Task 2 files locally.**

### Task 3: OMP phase runner, result decoder, and fake end-to-end control path

**Files:**
- Create: `src/runtime/omp/runOmpPhase.ts`, `src/runtime/omp/ompProtocol.ts`, `src/runtime/omp/ompAdapter.ts`, `src/runtime/omp/phasePrompt.ts`, `src/runtime/omp/worktreeSnapshot.ts`, `tests/runtime/omp/ompPhase.test.ts`, `tests/control/ompEndToEnd.test.ts`
- Modify: `src/agents/omp.ts`

**Interfaces:**
- `runOmpPhase(config: MaterializedAgentConfigV1, phase: "plan" | "execute" | "verify", prompt: string, context: AttemptContext)` returns bounded event evidence, process outcome, and private evidence path; registers the process before writing stdin and reaps its group on stop.
- `decodeOmpPhase(phase, events, expectedSelector)` takes the final answer from the authoritative event stream and validates OMP terminal state, exact frozen provider/model, phase result schema, and reconciled per-model token usage. Incomplete usage is evidence only, not `observedTokens`.
- `OmpAdapter implements RuntimeAdapter` builds the existing business prompts and its own phase system prompt, and returns ccloop's existing result types.

- [ ] **Step 1: Write failing fake-OMP tests** for argv/system-prompt-file privacy, tool lists, profile/model consistency, process registration, timeout/abort, output limit, forbidden tool or continuation events, plan/verify mutation, disallowed execute path, OMP-created commit with clean status, rename from a forbidden source into an allowed destination, JSON ambiguity, multi-message/cache usage, error usage unknown, and complete plan → execute → verify through ccloop control.
- [ ] **Step 2: Run `rtk proxy npx vitest run tests/runtime/omp/ompPhase.test.ts tests/control/ompEndToEnd.test.ts`** and confirm the intended failures.
- [ ] **Step 3: Implement runner, parser, phase prompts and adapter.** Reuse existing prompt builders, execution normalizer, private evidence helpers, and controller checks without changing their historical contracts. Record a lower bound only in diagnostic evidence on interrupted calls. Include HEAD in plan/verify read-only snapshots; before returning execute, reject any HEAD movement, then independently observe Git-visible tracked/untracked paths with rename detection off (both endpoints) and require an exact match with OMP's `changedFiles`, so the controller's existing path policy sees actual paths rather than an unverified claim.
- [ ] **Step 4: Run targeted tests, `rtk proxy npm run typecheck`, and `rtk proxy npm run build`** to exit 0. Run the full ccloop suite unfiltered with controlled concurrency and capture its complete log; investigate any new red before continuing.
- [ ] **Step 5: Commit only Task 3 files locally.**

### Task 4: Orca preview/UI and control compatibility

**Files:**
- Modify: `src/control/agentInstallationProtocol.ts`, `web/src/controlTypes.ts`, `web/src/AgentSettings.tsx`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Create: `web/tests/ompAgentSettings.test.tsx`, `tests/control/ompAgentPort.test.ts`

**Interfaces:**
- Orca parses the optional `unavailableReason` in the ccloop installation preview, shows it, and disables selection for unavailable version/path changes. Its existing generic agent preferences and frozen task selections accept kind `omp` without a special model name.

- [ ] **Step 1: Add failing tests** for a disabled unavailable change, a normal selectable OMP addition, exact default displayed from ccloop, per-task override and frozen selection, and continued `skills-unsupported-agent` refusal for an OMP task with syncskill.
- [ ] **Step 2: Run `rtk proxy npm test -- tests/control/ompAgentPort.test.ts` and `rtk proxy npm exec vitest run tests/ompAgentSettings.test.tsx` from `web/`** and observe the intended failures.
- [ ] **Step 3: Implement only the protocol/UI additions and localized reason text.** Keep ccloop authoritative for model validity.
- [ ] **Step 4: Run targeted tests, `rtk proxy npm run typecheck`, `rtk proxy npm run build --workspace web`, and `rtk proxy npm run --workspace web check`** to exit 0. Then run the relevant Orca control/panel gates with the local ccloop build.
- [ ] **Step 5: Commit only Task 4 files locally.**

### Task 5: Isolated real acceptance and documentation

**Files:**
- Modify: `README.md` in ccloop for OMP table/profile/model setup and host-containment limitation; `docs/handoff/2026-10-12-oh-my-pi-acceptance.md` in Orca for commands, tool-reported usage, and evidence paths.
- Temporary only: disposable target repository and redirected HOME/XDG/OMP roots under `/private/tmp`.

- [ ] **Step 1: Build a one-file disposable target** with one exact required check and target path. Record a pre-run file and directory snapshot; the configured provider must be reachable. Copy only the OMP settings/model definition needed for this machine into a `0700` temporary HOME (private files `0600`), redirect all HOME/XDG/OMP state there, and never print credentials. Use only a local ccloop build through Orca's execution-port override.
- [ ] **Step 2: Verify a short no-tool OMP call** reports the selected provider/model and nonzero reconciling usage. Inspect each phase's rendered system prompt and effective tool list before the coding run.
- [ ] **Step 3: Run one real Orca task** through plan, execute, verify. Preserve event logs, phase artifacts, controller result, allowed-path diff, and Orca/ccloop usage ledger. Run an explicit artifact check that returns nonzero for missing phases, unknown or mismatched usage, forbidden events, direct Git staging/reset/commit/checkout/branch commands, changed out-of-scope paths, or missing successful required check. Inspect in-allowlist extra work separately; any material overrun fails the pilot.
- [ ] **Step 4: Run final ccloop and Orca gates** unfiltered to complete logs; read them whole and report every skip and any environment-specific failure. Recheck no production Orca pin or launchd service changed.
- [ ] **Step 5: Document exact evidence and limitations, then commit local docs.** Do not turn this one accepted run into a reliability claim.

### Task 6: Handoff and final user review

**Files:**
- Modify only the existing rolling Orca section of `docs/handoff/handoff.md` in ccloop and ccmem; update `docs/handoff/handoff.md` in Orca in place. Do not grow new numbered Orca sections in the sister repositories.

- [ ] **Step 1: After all planned implementation and acceptance work, recheck the three primary repository worktrees and local/remote state.** Preserve other agents' uncommitted work and do not record a mutable HEAD as a handoff fact.
- [ ] **Step 2: Update all three named handoff files** with verified outcome, exact evidence paths, remaining limitations, branch/release boundaries, and next action. Keep each sister repository's Orca section compact and rolling.
- [ ] **Step 3: Run a handoff consistency check** against the accepted artifacts and local Git state; commit only owned handoff edits where allowed. Do not merge, push, or clean worktrees.
- [ ] **Step 4: Give the user final review material**: concise changed-files/test evidence, any unresolved risks, and an Orca executive handoff summary in at most 10 lines in chat, not in a file.
