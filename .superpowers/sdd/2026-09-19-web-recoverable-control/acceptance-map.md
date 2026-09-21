# Acceptance map -- web recoverable control (spec 2026-09-19 section 9)

> **Read `final-report.md` §0 first (2026-09-21 whole-branch review).** It corrects what this file
> states too eagerly: the `webFaults:243`/`:266` rows describe a re-boot and an HTTP observation,
> which the tests are not (`:243` is also cited at line 60 below for a pause-strengthening scenario it
> does not exercise), and `final-report.md` quoted "43 §9.1 scenarios" where the spec's §9.1 table has
> 51 rows and this file's has 70. Every
> `file:line` citation in this file was re-checked on 2026-09-21: the 45 that quote a test title match
> within six lines of the cited line.

Scope of this file: which automated test proves which acceptance row of
`docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` section 9.1, plus the fault
injection (9.3) and mutation (9.4) criteria. Task 10 is the verification task; most rows were
implemented by Tasks 1--9 and are cited here at the test that proves them, all of which are in the
tree and all of which ran green in `commands/2026-09-21-task-10.md`.

`test-logs/` holds the unfiltered logs; `commands/2026-09-21-task-10.md` holds every command, exit
code and pass count, including the red runs that produced the findings in `final-report.md`.

## 9.1 Required product scenarios

| Scenario | Proven by |
|---|---|
| Import allowlisted plan: atomic draft, graph, provenance, defaults, immutable snapshot | `tests/control/planImport.test.ts:94` "normalizes sets, archives contracts, and keeps imported authority unchanged after source edits"; `tests/control/webFaults.test.ts:75` "dies before the import commit with nothing booked, and the identical command then imports once" |
| Import omits estimator choices: defaults expanded before hashing and frozen | `tests/control/commandLedger.test.ts:66` "replays the persisted effective default before reading changed defaults"; `tests/control/webProtocol.test.ts:61` "couples command verbs to closed raw payloads and explicit effective defaults" |
| Import response lost, then server default changes: replay persists effective defaults | `tests/control/planImport.test.ts:118` "replays the original result without rereading a changed source or changed server defaults"; `tests/control/commandLedger.test.ts:66` |
| Stable profile reference changes content: stale import/confirm/start rejected | `tests/control/profiles.test.ts:80` "changes profileHash when any resolved execution byte changes"; `tests/control/planImport.test.ts:217` "persists and replays a durable %s profile rejection across a later config change" |
| Source plan changes after import: group stays bound to its canonical snapshot | `tests/control/confirmation.test.ts:51` "reads only archived derived execution authority after the original source changes"; `tests/control/planImport.test.ts:94` |
| Automatic estimate succeeds: versioned, group-accounted advice with evidence | `tests/control/estimator.test.ts:77` "settles accounted estimate atomically and never overwrites dirty fields (invalid=%s)"; `tests/control/estimator.test.ts:45` |
| Estimate fails or lacks capability: defaults stay editable and confirmable, nothing fabricated | `tests/control/estimator.test.ts:66` "blocks estimate claim when observed handoff execution is missing or mismatched (%s)"; `tests/control/planImport.test.ts:311` "persists a terminal %s preflight without a scheduler wake" |
| Estimate input exceeds its bound: no model call, typed `estimate-input-too-large` | `tests/control/estimator.test.ts:24` "freezes exact input formula, contract constants, and checks later degradation"; `tests/control/estimator.test.ts:45` |
| Invalid estimator output: whole estimate rejected, no partial application | `tests/control/webFaults.test.ts:113` "refuses a non-V1 estimate answer before anything is published, then publishes the valid one once"; `tests/control/estimator.test.ts:135` |
| Human edits during estimate: advice does not overwrite human fields | `tests/control/estimator.test.ts:77` "settles accounted estimate atomically and never overwrites dirty fields (invalid=%s)" |
| Apply estimate fields: one command records exact estimate id and provenance | `tests/control/proposal.test.ts:41` "validates explicit model field provenance again at confirmation"; `tests/panel/controlApi.test.ts:45` |
| Re-estimation response loss: one versioned, accounted estimate work item | `tests/control/estimator.test.ts:45` "accounts durable estimate creation/replay, terminal preflight, and claim degradation without a run" |
| Confirm: grants, limits, mode, context policy, provenance, derived contracts commit together | `tests/control/confirmation.test.ts:16` "freezes every profile and derived grant and invalidates confirmation on prestart edit"; `tests/control/webFaults.test.ts:137` |
| Contract policy cannot represent grant: `execution-policy-unrepresentable` | `tests/control/executionSnapshot.test.ts:128` "rejects missing task buckets and unrepresentable original policies"; `tests/control/confirmation.test.ts:98` |
| Codex plus strict: confirmation may succeed, start rejects the observed soft capability | `tests/control/webCcloopSmoke.test.ts:146` "claims phase-end usage and soft enforcement, and the ledger opens no strict run on it" (strict start refused with `control-capability-unsupported`, no wake, no run); `tests/control/webMutations.test.ts:110` "gates a strict claim on proof the profile cannot produce, while soft mode keeps claiming" |
| Codex plus explicitly selected soft: start allowed and visibly non-strict | `tests/control/webCcloopSmoke.test.ts:146` (same real capability answer, soft start claims) and ":218" (the soft run's frozen envelope is durably accepted by a real consumer process) |
| Profile capability disappears before claim: no run/session/provider call, group-local blocker | `tests/panel/controlRecoveryApi.test.ts:67` "keeps a refused claim durable and group-local, and one retry re-arms it into a real run"; `tests/control/webDispatch.test.ts:63` |
| Strict proof synchronously invalid: provider not called, `failed-before-provider`, group-scoped retry | `tests/control/webDispatch.test.ts:89` "does not call the provider when an invalid proof is synchronously proved no-start"; `tests/control/webDispatch.test.ts:290` |
| Worker and handoff profiles differ: each phase verifies its own profile-bound artifact | `tests/control/profiledService.test.ts:189` "rejects a task-only profile where a separate handoff profile is required"; `tests/control/profiledService.test.ts:101` |
| Soft profile invokes provider: no proof required, execution stays visibly soft | `tests/control/webMutations.test.ts:110` (soft claim proceeds with `requestBoundProof: null`) |
| Unknown context window: no 1M fallback, no strict watermark claim | `tests/control/profiles.test.ts:142` "intersects every ordered capability and keeps proof only on exact descriptor equality" |
| Context watermark: gap latches once and suppresses the provider | `tests/control/webFaults.test.ts:198` "latches a context gap once, keeps the gap observation out of the ledger, and suppresses the provider"; `tests/control/webMutations.test.ts:160` "holds exactly one context latch per run generation, whatever reason a writer claims" |
| Pause dispatch: no new claims, accepted executions continue | `tests/control/stopIntent.test.ts:107` "records a typed pause intent that blocks a pending start claim without touching the wake" |
| Start wake delivery lost: durable wake retries, HTTP replay makes no duplicate claim | `tests/control/webFaults.test.ts:157` "keeps a start intent durable until it is delivered, and one delivery claims one run"; `tests/control/webDispatch.test.ts:150` |
| Handoff-stop: intent, frozen run set, requests, outbox and command result commit atomically | `tests/control/stopIntent.test.ts:224` "freezes every active run and commits one deterministic request identity per frozen run"; `tests/control/webFaults.test.ts:221` |
| Handoff transaction crash: entirely absent or fully replayable, no latch-only state | `tests/control/stopIntent.test.ts:207` "leaves no latch, request, or outbox row when the transaction is interrupted before commit"; `tests/control/webFaults.test.ts:221` |
| Complete handoff: continuation only after proof, usage and checkpoint validation | `tests/control/handoffTransaction.test.ts:41` "archives and commits a proven candidate before releasing the parent reserve"; `tests/control/checkpoints.test.ts:11` |
| Partial or unknown handoff: evidence retained, reserve held, continuation refused | `tests/control/checkpoints.test.ts:26` "retains active ownership and reserves for partial %s evidence"; `tests/control/handoffTransaction.test.ts:30` |
| Handoff-stop catches start uncertainty: `starting`/`start-unknown` frozen | `tests/control/stopIntent.test.ts:257` and `:286` ("always includes a start-unknown estimate so the frozen set cannot be vacuously complete") |
| Batch continuation: one command validates all, registers all atomically, clears the stop | `tests/control/webContinuation.test.ts:199` "registers every selection in one transaction and clears the completed handoff stop"; `tests/control/webMutations.test.ts:196` |
| Unselected recoverable task becomes `held`, unclaimable by normal scheduling | `tests/control/webContinuation.test.ts:239` "holds an unselected recoverable task out of both the continuation batch and ordinary dispatch" |
| Continuation: resume bundle used, cumulative inherited, consumed handoff reserve not restored | `tests/control/continuation.test.ts:13` and `:31` |
| Continuation identity timing: registration persists the pending run id, only claim moves it | `tests/control/webContinuation.test.ts:397` and `:438` |
| Soft run exceeds a grant dimension: typed `budget-overrun`, no negative remaining | `tests/control/webContinuation.test.ts:378` "refuses a soft-overrun predecessor that leaves no representable subtraction and rolls back"; `tests/control/usage.test.ts:35` |
| Limit conservation: one allocation occupies exactly one commitment-ledger state | `tests/control/confirmation.test.ts:35` and `:61` |
| Re-estimate consumes reserve; unused settlement returns it | `tests/control/estimator.test.ts:45` and `:77` |
| Browser reload or disconnect: execution unaffected, canonical state reloaded | `web/tests/controlState.test.ts:71` "drops canonical caches on epoch change but keeps unsaved drafts and uncertain command ids"; `:147` |
| Background usage or checkpoint update: projection sequence invalidates UI, command revision unchanged | `tests/control/projectionJournal.test.ts:119` "projects starting and unknown run transitions without changing authority"; `tests/control/checkpoints.test.ts:65` |
| Concurrent tabs: one command commits, stale command gets revision conflict | `tests/panel/controlApi.test.ts:194` "refuses the second of two commands naming the same revision and keeps exactly one durable effect"; `tests/control/webMutations.test.ts:64` |
| Lost response: same command id resolves without duplicate effect | `tests/panel/controlApi.test.ts:170` "answers an applied-but-lost command from the ledger, and replays the identical envelope instead of re-issuing" |
| Panel restart: new epoch forces full reload, unresolved recovery blocks dispatch | `tests/panel/controlApi.test.ts:222`; `tests/panel/controlRecoveryApi.test.ts:139` "reopens onto a run still marked active and stops dispatching until a person recovers it"; `tests/control/webFaults.test.ts:266` |
| Normal Panel exit: shutdown requests persist | `tests/panel/controlLifecycle.test.ts:116` "commits one global command and leaves unchanged groups out of the command ledger and projection"; `:88` |
| Claim races normal Panel exit: admission gate and writer barrier decide | `tests/control/admissionGate.test.ts:5` "makes a claim either visible before shutdown or inadmissible after it"; `tests/panel/controlLifecycle.test.ts:105` |
| Paused group with active run exits: pause strengthened, run frozen | `tests/panel/controlLifecycle.test.ts:151` "strengthens a pause only when an active run must be stopped, and freezes that run"; `tests/control/webFaults.test.ts:243` |
| Existing unresolved shutdown exits again: deadline, frozen set, revision byte-for-byte unchanged | `tests/panel/controlLifecycle.test.ts:185` "never extends an equal-strength shutdown intent from an earlier epoch"; `tests/control/stopIntent.test.ts:173`; `:171` "preserves a stronger human handoff-stop byte-for-byte" |
| Non-allowlisted target: server rejects it | `tests/control/planImport.test.ts:494` "persists non-allowlisted source rejection without creating a group"; `tests/panel/controlConfig.test.ts:82` |
| Immediate-kill request: no route, typed `404 route-not-found` | `tests/panel/controlReadApi.test.ts:256` "authenticates reads, enforces canonical sinceChangeSeq spelling, and keeps immediate kill absent"; `tests/control/webMutations.test.ts:225` |

## 9.3 Fault injection -- what Task 10 added

The seams named by the spec that are new to the Web layer are executable in
`tests/control/webFaults.test.ts`; the pre-existing low-level crash and SIGKILL criteria
(`tests/control/fixtures/crashCase.ts`, `control-crash-worker.mjs`, and the `stopIntent`/
`handoffTransaction` interruption tests) remain regression dependencies and were rerun unchanged
inside `npm run verify:control` (39 files / 403 tests).

| Spec seam | Executable test |
|---|---|
| before and after import transaction commit | `webFaults:75` (zero rows on fault; one import after retry) |
| estimate committed with wake/acknowledgement loss | `webFaults:97` (queued estimate durable; two claims book one run) |
| estimator request rejected before dispatch (input bound) | `estimator.test.ts:24` (pre-existing, cited above) |
| estimate output validation before acceptance | `webFaults:113` |
| confirmation snapshot and derived-contract atomic commit | `webFaults:137` (proposal stays `editable`, `executionSnapshotHash: null`, no ledger row) |
| start wake commit before delivery | `webFaults:157` |
| proof accepted / no-start / unknown recovery | `webFaults:173` plus `webDispatch.test.ts:89` and the context latch tests |
| context-observation gap and duplicate handling | `webFaults:198`, `webMutations.test.ts:160` |
| handoff stop/request/outbox atomic commit | `webFaults:221` |
| continuation registration before wake delivery | `webContinuation.test.ts:199`/`:397`; refusal case in `webMutations.test.ts:196` |
| global shutdown cross-group commit | `webFaults:243` (all groups or none; a second epoch replays it once under the same command id) |
| startup recovery before listen | `webFaults:266` (`recover()` then `listen()`, `dispatchBlocked` already true, first request refused) |

## 9.4 Mutation criteria -- guards added by Task 10

`tests/control/webMutations.test.ts` mutates ledger state (or replays an envelope) the way a bug or
a hostile process would and requires the code to notice; each mutation is undone in the same test.

| Spec mutation | Guard |
|---|---|
| accepts the same command id with a different canonical raw request | `webMutations:45` (corrupt `raw_request_hash` -> `command-id-conflict`; restore -> cached 200 again) |
| replays a stale command against a newer revision | `webMutations:64` (one effect, refusal durable, replay adds no row) |
| safe-integer boundary clamped instead of refused | `webMutations:87` (`MAX_SAFE_INTEGER+1`, `-1`, `1.5`, `NaN` all refused before the ledger; proposal and revision untouched) |
| treats a soft adapter as strict | `webMutations:110` (strict claim blocked with a `claim-capability-unavailable` blocker, soft keeps claiming) |
| treats unknown usage as zero / releases its reserve | `webMutations:132` (an unknown run's zeroed grant is refused by the read; the retained grant survives) |
| commits a stop latch without the frozen set / weakens a stop | `webMutations:179` (`stop-mode-conflict`; the handoff mode is never downgraded to pause) |
| creates only some selected continuation claims | `webMutations:196` |
| epoch / change-sequence reset used to fake a clean projection | `webMutations:210` (a rewound `change_seq` throws, books no command, and advances no revision) |
| exposes immediate kill or an in-place release route | `webMutations:225` (six forged paths all `404 route-not-found`, revision unchanged; only `recovery/retry` is a durable command) |

## 9.6 Boundary statement

No live model call occurred while producing this evidence. `verify:web-control`,
`verify:web-control:consumer`, the root suite, `verify:control` and `verify:panel` all completed with
the deterministic fixture adapters described in `commands/2026-09-21-task-10.md`. The live model
chain remains a separate human gate; nothing here authorises or implies it.
