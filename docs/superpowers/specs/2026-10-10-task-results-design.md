# Task results and group result aggregate

Owner: Codex controller, 2026-10-10 Asia/Shanghai. Human approved the conversational overall design and authorized specification self-review, independent subagent review, planning and subagent-driven implementation to completion, with rulings handled by recommendation and reported at final audit. No intermediate approval prompt is required for this round.

## 1. Human choices and scope

Tasks leave a structured explanation within their original execution invocation. Do not open any separate summarization model call, auto-backfill job or group summarizer. Task and group result pages are both required. Saved partial results remain visible for running/handed-off/failed work and are marked unverified or verification-failed. Missing/malformed explanations never change the actual execution/verification outcome; existing products and evidence remain visible.

Historical-task report compatibility/backfill/log inference is out of scope: absent explicit report gives an explicit missing message. Keep actual execution/verification, explanation availability and Git delivery separate. Agent conclusions are attributed to the Agent; actual verifier/ledger status is controller-owned. Never promote a report's claim to verified completion or fabricate observations, cost or time.

## 2. Producer channel: minimal ccloop extension

Current pin `ab824d16004de2d3c1613a76ec0431520aa16cc9` has strict execute schemas and no report channel. Worktree-sidecar metadata would alter product write sets/limits/cleanup, and direct external report writes lack dependable provider permissions. Do not use those paths or reinterpret ordinary logs/commandOutputs as a report.

Add optional raw `taskResult` to complete/partial `ExecutionResult` in ccloop, shared executor prompt, Claude runner JSON schema and Codex JSON/Zod schemas/decoders. Its raw value is accepted independently of the execution core (`unknown`/unconstrained JSON); invalid report content must not cause `codex-result-invalid`, overwrite usage, inhibit verifier execution, change complete/partial semantics or add attempts. An invalid execution core or invalid final JSON retains existing refusal behavior. Missing/raw-invalid report is diagnostic only.

Prompt the same executor to provide the following logical schema when possible. It is metadata, not a product file or a command to claim success. No new mandatory acceptance condition is introduced.

`task-result-v1`: `schema` literal; `goal` nonempty text; `completedWork`, `conclusions`, `limitations` arrays of text; `outputs` array of `{path,label}`. Limits: total report UTF-8 JSON at most 65536 bytes; goal 4000 characters; arrays at most 32 items each; text item at most 4000 characters; outputs at most 32; path at most 1024 characters and label at most 256. Empty arrays are valid. Output paths must be relative POSIX paths with no empty, dot/dot-dot, NUL, backslash, absolute/drive prefix or URL components. Invalid path makes that output unavailable, not the task failed. No model-supplied task/run/group/verification identity is accepted.

## 3. Durable report and output capture

ccloop captures explicit report payloads and bounded file bytes while the corresponding attempt workspace still exists, before cleanup, for complete and partial execute results. Capture is controller-owned; the Agent need not write outside its allowed workspace. Capture the report raw payload and status (`missing`, `invalid`, `available`) separately from execution/verification evidence. Missing report may still expose actual saved changed-file/output evidence where a controller snapshot authorizes it; do not infer semantic conclusions from it.

An attempt-indexed immutable evidence manifest binds control identity (`groupId`, `workItemId`, taskId, runId, generation, graphVersion, targetVersion), positive attempt ordinal, execution ref, optional verification ref, report status/ref and output entries. Each entry has exact logical path, captured byte length/hash/ref or explicit unavailability reason. Manifest and referenced bytes are content-addressed evidence, retained before workspace removal. Report metadata failures do not affect control budget or terminal outcome.

Extend the hashed handoff packet with an optional versioned `taskResults` manifest reference/list. This is an explicitly labelled channel, not scanning arbitrary artifact JSON for matching shapes. Keep top-level StartEnvelope/Candidate wire protocol and existing capability fields unchanged. New Orca validates the optional field and absence gives missing reports. Both handoff exporters and their strict readers accept old packets without the field. New producer/consumer are rolled out together; do not claim an old strict consumer supports the extension.

Supplemental report/output refs must be isolated from the acceptance-critical `candidate.artifacts`, packet `artifacts` and `rawLogs` lists. Bind them through the optional hashed packet field; register their upstream evidence context only under the current accepted source and validate their own manifest before admitting output refs. Failure to read/validate supplemental metadata marks results unavailable and does not make core collect, usage booking, handoff, verifier or outcome fail. The control handoff artifact itself remains integrity-critical. Its optional field is raw/versioned metadata for the report reader; handoff export cannot fail merely because report content is malformed.

Capture reported safe output paths and controller-observed changed paths, de-duplicated, at most 64 files per attempt, at most 1048576 bytes each. Keep missing/deleted/symlink/binary/too-large/changed-during-read states explicit. Reject unsafe ancestors/escaping/special files; do not follow symlinks or expand directories/submodules. Byte reads use containment, no-follow, regular-file and before/after identity/size checks. Partial runner-synthesized execution without a semantic report remains missing; it may retain controller-authorized snapshot file bytes.

Do not carry an earlier attempt's explanation into a newer attempt or a predecessor run as if it were the current result. Keep prior attempts/runs accessible as history, with their original identities and statuses. Snapshot stage is explicit: saved execute-stage outputs are that attempt's captured version, not a promise that later reconciliation or target HEAD is identical.

## 4. Orca retention and read service

At collect, hash-verify the labelled manifest and all admitted refs, verify controller identity against current accepted run/envelope/candidate, and persist them in the existing private artifact store. Put a versioned per-run result index in an owned outbox row, not a schema migration. Reject conflicting ownership or hash metadata; mark result data unavailable without inventing a successful report. Preserve terminal report, usage and control outcome.

Successful and handoff paths already archive snapshots. A non-succeeded terminal at stepC has not necessarily archived output bytes until `stepCleanupFailed`; retain eligible quiet-terminal results before first display, without requiring retry/settlement or mutating outcome/budget. Reuse `archiveRun`/existing outbox for an authorized quiet source; capture failure is a separate result diagnostic, not a fabricated checkpoint or success. Do not read live repo files from a GET request. Do not duplicate cleanup/settlement or alter D9/M3 transitions.

Prefer new ccloop attempt-bound captured output refs for previews. Existing archive snapshot fallback is permitted only when its run/attempt association can be proved from controller records; a final-run snapshot cannot authorize an earlier attempt's output. Partial output capture and the existing `stepCleanupFailed` archive path are complementary, not a claim that failed work was previously never archived.

Read-only routes:

- `GET /api/control/groups/:groupId/results`: deterministic aggregate and per-plan-task records.
- `GET /api/control/runs/:runId/results`: per-run attempt history with actual execution/verification status, explanation status/content, snapshot and output metadata.
- `GET /api/control/runs/:runId/results/outputs/:outputId`: bounded inert preview/download of a controller-authorized output entry.

These use strict versioned DTOs mirrored in the browser; group ordering follows the plan task order and run/attempt history is explicit. No per-task model calls, polling every report while hidden, arbitrary artifact access or live path concatenation. Route authorization uses current run -> group -> result-index or authorized snapshot membership. An existing artifact id/hash alone is not access authority. Forged cross-run/cross-group output ids and escaped paths refuse by name.

Outputs stored in an authorized archive snapshot may be read by exact tree entry membership; symlink entries never authorize target reads. Do not serve an arbitrary `file:`/external URL or content from current target HEAD. Preview at most 131072 bytes of UTF-8 text; larger safe captured files are downloadable up to the capture bound. Non-UTF-8/binary/unsupported preview is explicit and may offer saved download. HTML/script is displayed as inert text, never executed. Download uses attachment/nosniff and existing auth; no unsanitized HTML, remote assets or automatic external links.

## 5. Human result surfaces

Task result surface shows goal, completed-work explanation, conclusions, outputs, verification status/evidence and limitations. It clearly attributes Agent statements and independently displays actual verification and Git landing/delivery status. Missing/unavailable explanation is visible; original products/evidence still have their existing access. “Not produced yet” for an unstarted task differs from a completed/failed run missing explanation.

Group result surface aggregates task results without inventing a narrative. Show task coverage (available/missing/invalid/partial), unfinished/unverified work, group goal-review state and actual integration state. No task percentage stands in for goal completion or delivery. Summaries link to their exact run/attempt and captured outputs. Earlier failed/partial runs remain history; a later missing report cannot silently reuse the earlier successful-looking explanation.

Integrate Results into state-sensitive group/task detail from the Progress specification. Completed task/group default to Results; active defaults to progress; attention navigation defaults to its relevant handling region and keeps partial results available. Do not force tab changes during polling or discard drafts. Reading results does not mark decisions reviewed, perform writes, settle usage or resume work.

Text/Markdown preview is rendered using safe React text nodes and a minimal block renderer (headings, paragraphs, lists, fenced code). Raw HTML is escaped; links/images are text unless explicitly safe handling is implemented and independently tested. No new runtime/package dependency is required. First version does not add an export synthesizer, PDF pipeline, external report publishing or new notifications.

## 6. Validation

ccloop criteria cover Claude and Codex optional field schema parity, valid/absent/malformed/oversized report preserving core success/partial and usage, original strict invalid execution refusal, prompt instruction without extra provider call, capture before cleanup, failed/partial output retention, multiple attempts and continuation identity, unsafe/symlink/changing output paths and capture bounds. Independent mutants prove malformed metadata isolation and explicit manifest ownership.

Orca criteria cover typed manifest hash/identity/owner validation, current/prior attempts, no stale-report reuse, successful/blocked-terminal/handoff archive availability, damaged/missing artifacts, snapshot membership, text escaping, oversized/binary/unsafe path and cross-owner refusal, deterministic group aggregate, no GET writes, no change to D9/M3 outcomes and no extra command/model request from UI. Web criteria cover task/group views, partial/missing/malformed states, bilingual parity and actual App wiring.

Run ccloop full tests/build/typecheck plus affected schema/control gates on its new build. Orca main baseline and default regression use the existing fixed pin clone build; paired result integration uses the exact absolute ccloop feature build path with source/hash identity recorded. Final Orca root/Web/build/typecheck/panel/pin/leak gates and real browser localhost geometry are mandatory. Mutation work happens only in clones with exact working/cached diff zero after restoration. No paid/live model, production-data migration, service switching or claimed real-provider support.

## 7. Release and handoff

ccloop source work is isolated at `/private/tmp/orca-results-ccloop-20261010`, branch `codex/task-result-channel-20261010`; Orca at the managed `codex/progress-results-20261010` worktree. Package/lock/installed ccloop pin remains ab824d1. Source implementation and local paired-build acceptance do not establish installed report production on that old pin. After human review, ccloop publication and Orca repin through the existing pin script are required to enable this channel in the default installed setup. A local ORCA_CCLOOP_BIN override is a development/runtime configuration option, not an npm publication proof; production remains untouched.

Final report must name this release prerequisite and the missing-report behavior under the old pin, without presenting local overrides as shipped defaults. Handoffs replace existing rolling Orca sections in sisters, keep necessary state/rulings/evidence paths and avoid hard current-HEAD requirements. Executive summary is supplied only in chat, at most ten lines.

## 8. Independent-review rulings: effective transport and lifecycle

Controller, 2026-10-10. This section supersedes earlier handoff-field transport, retention and collection wording. Findings are preserved in `.superpowers/sdd/2026-10-10-progress-results-design/independent-spec-review.md`; existing source was re-read. Rulings are authorized by the human's request to proceed on recommendations and report at final audit.

### 8.1 P1-1/P1-2: isolated live channel

Do NOT add a field to handoff packets, Candidate or core collection/capabilities. Add two independent read-only ccloop control methods: `task-results` with `{input,afterRevision}` and `read-task-result-evidence` with `{input,manifestRef,ref}`. `input` is the accepted StartEnvelope. Validate canonical accepted envelope hash, source root, run/generation/execution identity before reading. Methods do not read model installations beyond existing table-path shape checks, invoke providers, write captures, create candidates or requests, or run filesystem discovery over arbitrary files. Old methods keep their exact wire shapes.

The versioned collection response `ccloop-task-results-v1` carries accepted control identity, authoritative `currentAttempt`, monotonic revision, immutable manifest refs and `nextRevision`. Return at most 64 new manifest observations per page; cursor is an observation revision, never a guessed attempt count. A dedicated result reader authorizes the supplied manifest by membership in that run's validated capture index and authorizes the requested ref by membership in that manifest, then performs bounded hash/no-follow reads. A known content hash alone grants no access. No supplemental ref enters core evidenceContext or acceptance artifact lists.

Namespaces are `sourceDir/control/task-result-evidence/` and `sourceDir/run/task-result-captures/`. Writers are the ccloop controller under the existing lease/owner fence at execute and verifier boundaries. Reads create no files. Directories/files are private (0700/0600); sourceDir/runDir come from the accepted envelope/test redirection, not HOME. Capture staging and atomically published index live only in these namespaces; failed staging is removed best-effort or left explicitly diagnosable, never mixed with core artifacts. Existing raw provider output transport bounds remain unchanged. Before core execution.json persistence, optional report content is separated and bounded so metadata serialization/capture cannot fail a valid core write. Oversized invalid report retains bounded diagnostic content/reason; no arbitrary oversized raw report is demanded as critical evidence.

`archiveRun` excludes both namespaces explicitly in normal settlement, handoff settlement and settled-failed cleanup. The same exclusion applies to source-tree continuation/rehydration paths. Result data is retained independently through the typed result index and its authorized closure before result workspace removal. Exclusion does not weaken existing handling of genuine core snapshot/handoff damage. Test injected missing/unreadable/changing/special supplemental files through all core archival paths: outcome, booked usage, checkpoint missing and continuation eligibility must remain equal to the no-metadata baseline.

Expose optional `ExecutionPort.collectTaskResults(input,afterRevision)` and `readTaskResultEvidence(input,manifestRef,ref)` methods. Core collect/book/transition is not gated on these calls. A separate bounded, fenced metadata job retains new refs/index changes; at most one job per run is in flight, optional RPC timeout is 1000 ms, concurrent jobs globally at most two. Shutdown/admission fencing rejects late writes. Deduplicate observation revisions and advance only after a complete admitted page. A transient failure leaves prior admitted results explicitly stale/unavailable and does not replace them with missing or retry business work. Old-pin `control-command-invalid` caches unsupported for that process-port binary identity; identity uses resolved executable file identity (device/inode/size/mtime/ctime) and a changed build clears the cache. Unsupported does not probe every round. Other failures are not mislabeled unsupported.

Metadata acquisition is scheduled by existing run collection lifecycle and maintains a results-only projection change when admitted data changes, even with unchanged usage. An old pin/fake port without the optional method yields explicit missing/unsupported result state; it never blocks ordinary execution. Result GET reads only already-admitted artifact/index data. Active result views can poll their read-only projection; no hidden-pane report fetching and no new model call. Baseline and paired feature tests must prove both old-pin behavior and live saved results with no terminal candidate/stop request.

### 8.2 P2-2: opaque, bounded report decoding

Codex decorated/fenced candidate discovery treats `taskResult` contents as opaque metadata within execute answers: answer-like keys or deep nested objects inside it do not create another answer or consume candidate traversal depth. Genuine independent execute answers and invalid core envelopes keep existing refusal. The Claude runner and runtime adapters bound/normalize optional report data before serialization/return; report-only invalidity cannot throw through the valid execution path. Oversized/deep metadata is an invalid-report diagnostic, not a core result failure. Invalid whole JSON or overall provider transport beyond its existing bound still has its original failure semantics because no valid core object was obtained.

Acceptance: one decorated/fenced valid execute envelope containing report `result` keys and excessive report depth still yields the core; two independent real answers refuse; malformed report preserves complete/partial, usage and verifier invocation count; a 65537-byte report becomes invalid without execution failure. Common report normalization is shared where possible; any runner/build linkage must be covered in source and packaged build tests.

### 8.3 P2-3: immutable observations and verifier authority

Capture one immutable execute-stage output snapshot per attempt while its workspace is available. Later verifier capture creates a successor immutable manifest reusing that snapshot, with a strictly higher observation revision and explicit stage `execution` or `verification`; never recapture changed/missing paths over the earlier file bytes. Atomic run index publication orders observations under owner fencing. An interrupted verifier has no fabricated pass/ref; a genuine unavailable capture is explicit.

Verifier display states are `not-run`, `in-progress`, `passed`, `failed`, `unavailable`, derived from controller-created stage and captured verifier evidence, not Agent report claims or the overall terminal result. Run terminal outcome never upgrades earlier rejected attempts. Missing/damaged verification evidence yields unavailable. Authoritative currentAttempt from progress is returned independently of latest available explanation: if attempt two is executing and only attempt one has a saved result, show it as previous-attempt history, not the current result. Continuation runs start a new identity/index and link predecessors; they do not copy old report availability into the new run.

Orca admits pages monotonically by run/generation/index revision. A late older page cannot roll back newer state. Per-run DTO carries capture revision/currentAttempt; frontend request/epoch identity likewise rejects stale replies. Tests cover execute-visible-before-verify, reject then retry success, attempt two active with prior history, handoff before verify, damaged verifier ref, and delayed older collection/read responses.

### 8.4 Shared default and required follow-through

Completed task/group default to Results even when explanation is missing. Active/attention defaults and explicit focus navigation follow the Progress spec. Separate execution/verification/explanation/delivery facts remain binding. The old-pin/publication/repin/production-runtime boundary in §7 remains unchanged. Independent scoped re-review of these amended contracts is required before planning.
