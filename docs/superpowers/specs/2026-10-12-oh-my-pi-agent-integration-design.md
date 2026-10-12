# oh-my-pi Agent Integration Design

> Initial design direction approved in conversation on 2026-10-12; this written spec awaits review. It specifies the first full Orca task path for oh-my-pi (omp) and does not claim implementation or acceptance.

## 1. Outcome and boundaries

An operator can select an installed `omp` agent in Orca's existing agent settings and run one task through ccloop's plan, execute, and verify phases. Orca must receive the same frozen selection, phase outcomes, observed token usage, failure boundaries, and standard run evidence that it receives from the existing kinds. Acceptance includes one isolated real omp task on this machine, using a locally runnable model selected at acceptance time; the model ID is never a source constant.

The first increment does not add omp skill injection, a bounded single-call estimator, OMP subagents, an interactive approval bridge, codex-only saved-result recovery, or changes to ccmem. It does not repin a production Orca service or merge/push either repository. Those release steps remain under each repository's separate authorization rules.

The owner split remains unchanged: ccloop owns agent discovery, model resolution, process execution, and phase evidence; Orca owns selection, confirmation, dispatch, and presentation. The existing `ccloop-agents-table-v1`, control capability response, and Orca agent view stay compatible. A new kind is additive.

## 2. Why this approach

Three approaches were considered:

1. **Native ccloop descriptor plus one-shot JSON adapter (chosen).** It follows the existing `RuntimeAdapter` and process/evidence lifecycle. Each phase starts a fresh `omp -p --mode json --no-session` process.
2. **Long-lived OMP RPC bridge.** It could mediate interactive permissions and reuse a session, but introduces a new recovery, framing, and approval protocol before the first task can run.
3. **Masquerade as a Claude or Codex installation.** It would avoid a descriptor but misstate capabilities and parse the wrong event format.

The chosen adapter must not assume that a successful OMP process or a plausible final sentence is a valid phase result. The ccloop controller remains authoritative for worktree state, required checks, retry decisions, and completion.

## 3. Installation and model selection

`omp` is discovered by the same absolute executable search and `--version` probe as existing kinds. The installed binary path comes from discovery or the operator's private agents table, never from the oh-my-pi source checkout. The new installation kind is `omp`; its strict extra field `defaultModel` is a provider-qualified selector of the form `<provider>/<model-id>`. Its context option is only `agent-default`. Capabilities declare phase-end usage observation, soft budget enforcement, unavailable context observation, durable mechanical handoff, unknown context window, and no request-bound proof. `singleCallExecution` is `null`.

Discovery obtains a proposed `defaultModel` from that installation's `omp config get modelRoles --json` result. It reads `value.default`; it does not infer a provider from a built-in catalog or guess one from an unqualified ID. If the configuration has no provider-qualified default, discovery still reports the executable candidate with a named diagnostic but does not create an automatically applicable installation. The operator may set `defaultModel` explicitly in the private table or qualify the OMP default in their own config. The installation's `configDir`, when non-null, is passed as `PI_CODING_AGENT_DIR` for OMP's default profile; `null` inherits the worker's environment, matching the existing table convention. OMP's named profiles and generic config lookup have separate path rules, so this field is not described as complete configuration isolation.

The descriptor's displayed default and `resolveAgent` fallback use this installation's `defaultModel`, rather than a repo-wide constant. A model override in Orca's existing operator/group/task selection wins, but it too must be provider-qualified for `omp`. The chosen selector is materialized into `AgentSelectionV1.model` when the task is confirmed and contributes to `configHash`; every phase passes it explicitly to `omp --model`. A later change to the person's OMP default therefore does not silently switch an already frozen task. A provider-qualified selector may address a custom model absent from `omp models find`; the actual CLI startup must resolve it. Actual assistant-message `provider` and `model` are recorded separately from the requested selector for usage attribution and diagnostics.

Selection validation retains ccloop's existing nonempty, non-flag, whitespace-free, at-most-200-character model rule and additionally requires one nonempty provider segment plus one nonempty model-ID remainder for `omp`. A missing, bare, or malformed default fails discovery/selection visibly. A configured selector that OMP cannot run fails the phase visibly; the adapter never substitutes another model by itself. A model supplied only by an OMP extension is unsupported in this first increment because phase tool confinement requires extension discovery to be off. The operator can select a model registered without extensions on that machine.

## 4. Phase invocation and scope control

The OMP phase runner writes a private evidence directory under the ccloop run, starts a detached process group in the attempt worktree, registers its PID/process identity before sending the prompt on stdin, and uses the smaller of the installation timeout and remaining run time. It bounds stdout and stderr, closes and reaps the group on abort, timeout, or overflow, and preserves terminal status plus raw event evidence with private file modes. It does not use a shell to construct arguments.

Each invocation uses `--mode json -p --no-session --no-title --no-prewalk --no-extensions --no-skills --no-tools --tools <phase list> --model <frozen selection>`. It supplies a phase-specific plain custom system prompt through `--system-prompt`, plus the existing ccloop business prompt on stdin. This replaces OMP's bundled default instruction block, while retaining generated repository rules and its project footer. Because that footer still says completion is the stopping condition, the custom prompt defines *the task for this invocation* as this one phase and defines returning the final object as that phase's completion. It names the allowed action and explicitly stops there. It forbids independently starting another plan/execute/verify loop, retrying the whole task, dispatching an OMP subagent, or treating OMP's own completion wording as ccloop acceptance. Prompt text is sent on stdin, never as a long argv value. The adapter must not rely on prompt compliance as its only boundary.

| Phase | OMP tools | Worktree rule | Final answer |
|---|---|---|---|
| plan | `read,grep,glob` | No worktree mutation | Existing `AttemptPlan` shape; plan this attempt only |
| execute | `read,grep,glob,edit,write,bash` | Changes remain subject to ccloop's target-path and controller checks | Existing complete or partial execution shape; report this attempt, do not declare task accepted |
| verify | `read,grep,glob` | No worktree mutation | Existing `VerificationResult` shape; judge the saved execution only |

The controller itself runs `requiredChecks` before the model verifier, so verify does not need a shell. The runner compares the worktree's tracked/untracked state before and after plan and verify. Any mutation causes a named phase failure and leaves the evidence for inspection; it is not silently reverted. The execute phase is also checked against the contract's existing allowed-path and saved-result controls. No `task`, browser, computer, network, or extension tool is intentionally enabled by this adapter. Inspection of OMP 18.10.1 found that an explicit CLI `--tools` list alone does not exclude extension-registered tools; therefore `--no-extensions` is mandatory. Tests must prove that the installed binary offers only the requested tools with this combination. If they cannot, the first path fails acceptance and must be redesigned.

OMP's permission mode is not an operating-system sandbox. The execute process still has the worker's ambient filesystem and network access, just as a shell command can. The first increment therefore runs real acceptance only against a disposable target repository and redirected user-data roots. Its product boundary is the ccloop worktree, contract, tool list, and post-phase checks, not a claim of host containment. This limitation must appear in the operator-facing installation documentation.

## 5. Output, usage, and failure semantics

The adapter reads OMP's newline-delimited JSON events. It requires a clean terminal process exit, an `agent_end` that is not marked continuing/nonterminal, and a final assistant `message_end` with a successful stop reason and text answer for the phase. It validates the business object against the existing plan, execution, or verification schema. A decorated or repeated answer is handled only by the already specified conservative extraction/normalization rules; ambiguous candidates, malformed JSON, missing fields, a terminal model error, or an absent final answer fail the phase. There is no second model call to repair an answer.

Usage is accumulated from distinct completed assistant `message_end` events, never from the repeated cumulative `agent_end` payload. For each message, the four nonnegative safe-integer OMP fields `input`, `output`, `cacheRead`, and `cacheWrite` must reconcile with `totalTokens`. The phase total is the checked sum across messages. The existing ccloop `UsageEvidence` carries noncached input/output and cache fields; `modelUsage` groups observed spend by actual message model, sorted by model and reconciled to the phase total. OMP's reported dollar cost remains diagnostic evidence in this increment; no price is inferred from a model name and no new monetary-ledger contract is introduced. If OMP omits or corrupts usage, the phase reports usage unknown under the existing control semantics, never a synthetic zero. A phase stopped after valid completed messages may carry their observed tokens as a lower bound; a torn/incomplete message is not counted.

Exit failures, timeout, abort, output overflow, process-registration failure, invalid events, invalid result, and read-only-phase mutation have distinct evidence reasons. On execute interruption, the adapter follows ccloop's existing partial-or-null contract; it does not turn a half-finished OMP explanation into successful execution. The existing controller decides retry, stop proof, recovery, and final task status.

## 6. Orca surface and rollout

Orca's existing agent list, preference editor, task override, frozen selection, driver, and usage ledger consume the new `omp` kind through the current ccloop control interface. The panel shows the per-installation default and lets the operator override it. OMP is not advertised as supporting skills; tasks with a syncskill profile continue to receive the existing `skills-unsupported-agent` refusal. Estimate and other single-call purposes see `singleCallExecution: null` and retain their current blocked-capability behavior.

The first real acceptance uses only a locally built ccloop candidate and isolated Orca/target roots. It does not update the pinned ccloop package or restart the launchd service. Publication order, if later authorized, remains ccloop release, Orca repin and service verification, then handoff. Each merge and push requires its own authorization under the repository rules.

## 7. Verification and acceptance

Tests use a fake OMP executable with JSON event fixtures and an isolated Git target. They must prove discovery and missing/bare-default behavior, model override and frozen-model reuse, argv/tool separation by phase, PID registration before prompt delivery, process-group abort, output/timeout failure, final-result parsing, multi-message usage and cache reconciliation, unknown usage, model breakdown, and no duplicate counting from `agent_end`. A deliberate fake OMP that attempts to edit in plan/verify must be blocked or detected. An execute fake that writes a disallowed path and returns a valid-looking result must not be accepted by the controller.

The real acceptance task is deliberately small: one specified file change in a disposable repository, one deterministic required check, and a tight target-path list. First prove that the chosen selector resolves under `--no-extensions`; a value in `modelRoles.default` alone is insufficient. Inspect the rendered system prompt and effective tools for each phase before making the paid task call. Capture the OMP event log, ccloop phase artifacts, changed paths, controller result, and Orca usage ledger. Inspect whether OMP independently explores, edits, tests, or retries beyond its assigned phase; an overrun is a failed acceptance, even if the final file and JSON answer look correct. Compare before/after snapshots of the target and redirected user-data roots. Record the actual requested selector, observed provider/model, OMP version, test command and commit, and the tool-reported token/cost values without extrapolation.

Completion requires: ccloop typecheck/build and targeted plus full test commands exit 0 with named skips reported; Orca's relevant control/panel/typecheck gates exit 0 against the local candidate; the isolated real task reaches controller acceptance with only allowed file changes, all three phase records, reconciling known usage, and no phase overrun. A failed real test is a diagnostic result, not a reason to loosen the acceptance criteria or repin production.

## 8. Known limits

- OMP's CLI model catalog may not list a selector named in local settings. On 2026-10-12 the local `modelRoles.default` value `ep-20261012204110-nvhqw` failed a short explicit `omp -p --model` probe with `Model not found`, both with and without `--no-extensions`; no model request was made. A no-request RPC state probe resolved that same default to provider `local-litellm`, and explicit `--model local-litellm/ep-20261012204110-nvhqw` initialized successfully under `--no-extensions`. The real acceptance still needs a completed model call; none of these names is a source default.
- The no-request OMP 18.10.1 RPC state probe reported exactly `read,grep,glob` when launched with `--no-extensions --no-skills --no-tools --tools=read,grep,glob`. This supports the planned read-only phase list but does not prove behavior during a model turn or across future OMP versions.
- The executable's tool restrictions and event schema are grounded in the inspected OMP 18.10.1 source and must be checked against the installed binary during implementation. Explicit `--tools` does not by itself suppress extension-registered tools, which is why this design requires `--no-extensions` and excludes extension-only models.
- A model can ignore a prompt. The tool list, phase-specific system instruction, process deadline, worktree mutation check, and controller checks limit and detect the behavior; none proves host-level containment.
- Existing soft token budgets remain soft. OMP usage and cost are observations, not a strict request spending cap.
