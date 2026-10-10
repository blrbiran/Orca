# Deterministic execution normalization and saved-result verification

Owner: Codex controller, 2026-10-11 Asia/Shanghai. Human approved no model format repair, strict deterministic normalization, and complete-evidence verifier-only recovery retaining original failure. Authority/release constraints are in `2026-10-11-feedback-followup-design.md`.

## 1. Live normalization

Execute accepts exactly one strictly valid complete/partial execution object either directly or inside exact `{result:execution}`. Reuse balanced bounded candidate scanner for decorated output. Envelope and its body count as one semantic answer; other independent valid or invalid answer-shaped nodes make ambiguity fail closed. Treat taskResult as opaque optional metadata using existing original fingerprints so lossy sanitization cannot collapse distinct answers. Reject extra keys, missing core fields, incompatible shapes, hidden/truncated spans and bounded-scan overflow. No coercion, synthesized core fields, first/last-brace extraction or model invocation. Plan and verifier acceptance/extraction semantics unchanged, especially never infer approval.

Preserve raw bytes plus normalization diagnostic and method. Event/completion/usage validation is independent of final schema validation. Eligible format failure requires successfully completed process, intact stream, unique completion and finite actual usage; timeout, skills cleanup, missing final, event corruption, usage failure, provider error or verification-started are ineligible. Keep typed failure classification through PhaseExecutionError and account failed execution's real observed/model usage.

## 2. Durable failure capsule

Before cleanup, while controller owns the settled executor and after descendants/skill cleanup, publish immutable content-addressed `ccloop-execution-format-failure-v1`.

Capsule binds accepted group/work/task/run/generation/graphVersion/targetVersion/execution/envelope identity, current attempt, executor kind/config hash, frozen contract/base and attempt start HEAD, decoder/classification version, process outcome, original final/events/schema/decode-error/successful-plan artifact refs and hashes, validated actual usage/settled high-water observation, controller proof verifier never entered, complete execution snapshot ref (Git bundle/tree/index/untracked/deletions/modes), completeness list and owner capture identity/time. All artifact refs private and hash validated, atomically publish only after bytes durable. Capture failure leaves original failed and recovery unavailable; optional Results display snapshots are not recovery authority.

Extend collected evidence with optional capsule ref; archive recursively copies verified referenced bytes under existing run identity and read permissions. Original failed outcome and evidence are not rewritten to success or corrected output.

## 3. Legacy eligibility

Existing immutable archives may qualify only with exact original envelope/config/contract, isolated settled process proof, complete archive/snapshot nested hashes, terminal attempt identity, successful original plan, unique original execute call directory and valid raw events/outcome/usage. Verify archived snapshot HEAD equals the exact namespaced attempt ref in archived bundle and failed terminal attempt; reject publication failures, ambiguous calls, later attempts, missing files, verification entry or cleanup failures. Restore archived bytes only; current target files, mutable worktrees and Agent claims cannot qualify.

Derive immutable eligibility artifact referencing old hashes, do not modify old logs/state. Missing evidence reports precise reason and ordinary retry. Preserve original unknown-usage blocking/settlement rules; finding actual raw usage is not permission to silently rebook historical spend.

## 4. New verification recovery

Read-only eligibility model indexed original run/attempt/capsule hash exposes eligible/unavailable and reason, source identity and normalized execution hash. Command `verify-saved-result` targets current task with payload `{sourceRunId,sourceAttempt,capsuleHash}`; expected revision, same command id replay, current run membership, auth, stop/admission/usage/cap/exclusion rules all apply. Revalidate all evidence at admission and again before provider spawn.

Reserve a fresh linked run with immutable `recoveryOf` carrying source identity, snapshot and normalized-execution hashes. New protocol4 start input discriminates `mode:'verify-saved-result'` and references controller-owned materialized recovery package; legacy normal/handoff inputs unchanged. Validate private paths/no-symlink/realpath/hash/tree-index/bundle authority using existing materialization primitives. Do not trust Agent reported diff as actual tree.

ccloop recovery entry restores complete execution snapshot against original base, loads saved successful plan/normalized execution, consumes one new attempt/session and skips plan/execute. Run existing real validation commands and configured verifier once under current approved recovery selection and limits. Rejection, timeout, handoff or exhaustion ends/parks this recovery without entering executor retry loop. Successful verification proceeds ordinary write-set checks, harvest, reconciliation, goal review/landing and measured usage; no special auto-approval. Failed recovery offers ordinary retry.

Crash/replay fences make package/run publication idempotent and mutually exclusive with ordinary retry; no duplicate verifier or model call after already recorded terminal result. Actual verification lifecycle and output captures use existing Results protocol. Source failure/history remains separate and visible.

## 5. UI and acceptance

Button `验证已保存成果` / `Verify saved results`; nearby says execution is skipped but validation may consume model usage. Show only eligibility authority, preserve unavailable reason and ordinary retry. Never describe it as free/repair code. Diagnostics and output links use authorized evidence paths.

Tests: both valid shapes/decorated unique/ambiguity/opaque-report collisions; typed decode failure finite usage; capsule before cleanup; capture failure; exact legacy eligibility versus tampered identity/base/config/hash/partial snapshot/verifier entry; zero planner/executor invocations and one real command/verifier, preserved original failure and new lineage; rejected/timed out/paused/cap-exhausted recovery never executes or lands; ordinary successful landing; stale command/concurrent retry/crash idempotency. Mutations independently delete skip-execute, source snapshot hash check, lineage identity check, real verification, cap reservation and original-failure preservation. No paid live provider required.

## 6. Independent-review amendments — Codex controller, 2026-10-11

Eligibility requires exactly one valid normalized execution under the supported strict normalizer; a complete capsule alone does not authorize invented fields. Source must be the current terminal failed run/current terminal attempt of the task, no newer accepted/pending/current run, and exact group/work/task/graphVersion/targetVersion/frozen contract including goal/acceptance/safety/write-set authority. Check at admission and pre-spawn. Changed semantic authority refuses `saved-result-source-stale`; original config/base remain source facts. Current target-tip movement may proceed only through ordinary post-verification reconciliation, never rebase snapshot before verification. Allowed differences: fresh funded limits and explicitly newly frozen verifier selection/provenance.

Persist/hash recovery mode/package identity in accepted input, run state and every resume/adoption path. Before validation/provider invocation persist verification-entry marker. Crash before entry may continue fenced admission. After entry, reuse only complete durable validated verification output; otherwise settle known usage or hold unknown, reap and park without automatically repeating commands/verifier or entering planner/executor. New verification requires a new authorized command. No claim of exactly-once external effects across an unobservable crash.

Before verification record candidate tree/index/protected untracked identity. After checks/verifier and before result publication/harvest require equality for saved source files/modes/deletions/index and protected inputs. Any change refuses `saved-result-modified-during-verification`; never execute or land. Only contract-declared validation scratch outputs or controller-owned external temporary paths may differ and are excluded from harvest. Normal non-recovery verification semantics unchanged. Add tests for modifying checks/verifier, all named crash entry/output/terminal windows, semantic stale source, latest replacement/racing retry and harmless target-tip drift.

Protocol4 verify-only envelopes are negotiated via independent `features` command defined by token-policy amendment; protocol3 response shapes do not acquire new mandatory metadata.
