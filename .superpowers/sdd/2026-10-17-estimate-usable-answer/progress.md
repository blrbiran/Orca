# SDD ledger — plan: docs/superpowers/plans/2026-10-17-estimate-usable-answer.md

Who: Orca session 4de777f4 (controller), 2026-10-17. Worktree Orca-wt/round-20261017, branch codex/round-20261017.
Spec: docs/superpowers/specs/2026-10-17-estimate-usable-answer-design.md (reached; binding).
Human's words this round: "花了钱就一定要拿到能用的结果"; Orca self-repair "能接受"; unrepairable "希望 Orca 自动再调一次";
"spec 写好后除了你自己 review 以外，还要派一次独立 subagent review，修复review问题后开始写plan并用 subagent-driven 的方式实现";
"这个 session 中允许改必要的判据"; "这一轮都同意付费验收"; codex: test gpt-6-luna only (gpt-6-sol has no quota).
Context: controller crossed T1 (334286) — checkpoint `chore(checkpoint): orca-dev-4de777f4, level 334286…` on local main.

## Pre-flight scan

| rows | produces / consumes | finding |
|---|---|---|
| T1 ↔ T3 | repairEstimateOutput, problemsFromRefusal → used in completeEstimateInStore | consistent |
| T1 ↔ T4 | T1 converts the v2 keyed answer whose shape T4's schema defines (spec §4.1) | consistent if both follow spec §4.1; T1 brief points at §4.1 |
| T2 ↔ T5 | record fields origin/retriedAs/retrySkipped/proposalVersion, contract retryProblems | consistent |
| T3 ↔ T5 | `failure` local in completeEstimateInStore | consistent; T5 edits the same function after T3 |
| T4 ↔ T5 | buildEstimatePrompt options.retryProblems; prepare passes contract.retryProblems (T5) | consistent |
| T2 ↔ T6 | view fields → web display | consistent |
| T7 | consumes T2 view fields and T4 flag | consistent |
| each task self-consistency | tests vs code vs files | T3 step 1 asserts missing task → estimate-output-invalid (repair runs first) — agrees with spec §4.2/§4.3 |

Ruling: keep this workspace and commit it with `git add -f` instead of deleting it at the end — CLAUDE.md Rule 13 and every earlier round keep `.superpowers/sdd/**` as evidence — cost if wrong: a few KB of history.
Ruling: the final gate runs once after Task 7, not per task — the earlier gate this session already covered the pre-estimate commits — cost if wrong: a regression found later in the round.

## Tasks
Task 1: dispatched (BASE 81746aa5, implementer sonnet)
Task 1: minor (deferred): top-level field problems only collected when tasks is array/object (feedback less complete)
Task 1: minor (deferred): internal exception reported as not-an-object
Task 1: minor (deferred): problemsFromRefusal([],false) returns []; cap can cut output-not-canonical — Task 3/5 must ensure non-empty
Task 1: minor (deferred): no named mutation for steps 5/7 and top-level check (tests assert exact repairs)
Task 1: minor (deferred): constructor test title claims order; order covered by next test
Task 1: complete (commits 81746aa5..3748ab91, review clean)
Task 2: dispatched (BASE 3748ab91)
Task 2: minor (deferred): contract retryProblems/view origin lack per-entry 200-char cap (producer caps)
Task 2: minor (deferred): panel must treat absent repairs as []
Ruling: completeEstimateInStore writes `repairs` (possibly []) on every estimate it settles; absent = settled before this change — keeps "repair ran" visible — cost if wrong: one empty array per record.
Task 2: complete (commits 3748ab91..536ed9f2, review clean)
Task 3: dispatched (BASE 536ed9f2)
Task 3: minor (carried to Task 5): post-repair plan-mismatch falls back to problem "output-not-canonical" — Task 5 gives it an accurate code (e.g. "plan-mismatch")
Task 3: minor (deferred): `failure?.reasonCode ?? null` indirection
Task 3: skip count 36 equals gate3's 36 on the pre-task base (controller check)
Task 3: carried to Task 5: tests must cover failure.problems branches (no-json-object, [] for other call failures, refusal issues, output-not-canonical)
Task 3: complete (commits 536ed9f2..0213d16a, review clean)
Task 4: dispatched (BASE 0213d16a)
Task 4: review — 1 Important (no-json-object feedback wording, spec §4.3, plan-omitted); minors deferred: estimateTaskIds raw JSON.parse cast; size test compares v2 with/without tail not v1 vs v2; full tests/control run not finished by implementer (final gate covers)
Task 4: carried to Task 5: retry size re-check must call buildEstimatePrompt(..., { taskIds, retryProblems }) — same bytes as prepare
Task 4: fix round 1 dispatched (resume implementer; FIX_BASE fc9a2da1)
Task 4: fix round 1/5 (1 addressed, 0 open; commits fc9a2da1..6c66e801)
Task 4: complete (commits 0213d16a..6c66e801, review clean)
Task 5: dispatched (BASE 6c66e801)
Ruling: add retrySkipped `proposal-confirmed` (no retry once the proposal is confirmed) — an estimate is advice for an editable proposal; a retry after confirm spends money the panel cannot use — cost if wrong: a person who re-estimates after confirm gets no automatic retry.
Ruling: a retry still queued when the group starts is claimed and runs (existing queued-estimate behavior, observed in Task 5, not changed) — spec §4.3 keeps it unchanged — cost if wrong: one wasted paid call in that window; logged as a known gap for the handoff.
Ruling: budget-deficit is unreachable end to end (an overrun also blocks the group → group-not-prestart first); unit coverage accepted — cost if wrong: none (same outcome, different code).
Task 5: review approved (0 Critical/Important); minors deferred: RetryGroupFacts index signature; MAX(estimate_version) query x3; full suite not re-run after estimator.test rewrite (final gate)
Task 5: observed (spec §5): a retry still queued at `start` is claimed and runs alongside the first work run; start accepted; group status stays ready — known gap for handoff
Task 5: fix round 1 dispatched (ruling proposal-confirmed + minor: misleading input-too-large for null request/unknown tokenizer; FIX_BASE c71204c9)
Task 5: fix round 1/5 (2 addressed, 0 open; commits c71204c9..e0c89b7f)
Ruling: an unreachable null-request guard keeps code input-too-large — no listed code fits and the path cannot be reached (claim requires a request) — cost if wrong: a misleading label on an impossible path.
Task 5: complete (commits 6c66e801..e0c89b7f, review clean)
Task 6: dispatched (BASE e0c89b7f)
Task 6: minor (deferred): repairs ?? [] evaluated twice; missing referenced estimate shows raw id as version; zh test asserts substrings separately
Task 6: complete (commits e0c89b7f..9dbbaed2, review clean)
Task 7: dispatched (BASE 9dbbaed2)
Task 7: incident: one early fake-codex run (before CCLOOP_CACHE_DIR was redirected) wrote 8 paths under the real ~/.cache/ccloop/agent-catalog/ (catalog entry 769de7de….json + codex-home/bf533527…/ with auth.json/config.toml links); list /private/tmp/acc-xpI0/ccloop-cache-new.txt; not deleted — awaitingHuman
Task 7: review — 1 Important (Rule 17: no CCLOOP_CACHE_DIR default into --output); minors deferred: fake omp retry filename coupling; fake codex/claude ignore retryOutput (readyAfterRetry only under fake-omp); summary.estimateUsage shape change; matrix ran pre-comment-fix
Task 7: fix round 1 dispatched (FIX_BASE e14425e0)
Task 7: fix round 1/5 (1 addressed, 0 open; commits e14425e0..13d5792b)
Task 7: complete (commits 9dbbaed2..13d5792b, review clean)
Final review (opus, c56b17e9..13d5792b): 0 Critical; I1 lone-surrogate/code-unit truncation in model-derived codes throws inside settlement (regression, reproduced); I2 final gate + paid acceptance not yet run; I3 handoff content (instructionVersion edit + queued check, ~/.cache/ccloop incident, queued-at-start gap) and ledger not committed. Minors: M1 queued retry still runs after confirm/start/supersede (handoff, later round); M2 contract retryProblems per-entry cap; M3 whitespace-only rationale (needs spec ruling — deferred); M4 estimateTaskIds unchecked parse in decision; M5 fake codex/claude ignore retryOutput (deferred). Must-fix minors: Task 1 Rule-9 mutation gap.
Final fix wave dispatched: I1 + M2 + M4 + Task 1 mutation gap (FIX_BASE 13d5792b). I2/I3 are the controller's.
Ruling: M3 (whitespace-only rationale) deferred — the placeholder list is pinned by the spec; changing it needs a spec ruling — cost if wrong: a blank rationale reaches ready.
Final fix wave: commit 756d3d28; re-review: I1, M2, M4, Task-1 mutation gap all ADDRESSED, no new breakage. Equivalent mutant: removing step 5's unknown-id filter (step 6 reads only plan ids) — parked as equivalent.
Final: minor (deferred): repairs array unbounded in count; view origin.problems lacks .max(200); capped problems may collide (duplicates)
Final gate (gate4, observed commit 13d5792b): full 3950 = 3912 pass / 36 skip / 2 red (schedulerBridge 30 s timeout; loopPlanE2E git worktree add at load 42); both alone on HEAD 5fe76708 2/2 runs 10/10 (load 19-26). control/chain/panel/wscheck still running when this was written.
Final gate tail (observed 13d5792b): verify:control 2042 pass / 30 skip / 0 fail; verify:chain second full 3914 pass / 36 skip / 0 fail; verify:panel 0; --ws check 1141/1141; claude-md 0; tmpleak 0; ~/.orca hashes unchanged. => gate passed (classified).
Paid acceptance (session d0843ec0, 2026-10-17 09:51-10:08, clone at aff94b70, ccloop 02cbacc build; report paid-acceptance-report.md): omp alias --repeat 5 exit 0, tally firstCallReady 4 / readyAfterRepair 0 / readyAfterRetry 1 / failed 0, 6 calls 17854 tokens (in 14122 / out 3732); claude-opus-5-5[1m] x1 exit 0, firstCallReady 1, 6354 tokens, claude total_cost_usd 0.057268; ~/.orca and ~/.cache/ccloop unchanged (only the home dir's own mtime), ~/.codex creds cmp 0.
Paid acceptance: codex gpt-6-luna x1 NOT MEASURED — account out of quota: codex turn.failed "You've hit your usage limit ... try again at Oct 22nd, 2026 2:13 PM"; ccloop exit-error, usage null; Orca blocked estimate-usage-unknown:codex-exit-error (established handling, spec 2026-09-27 item 4); harness exit 1 at its 900 s deadline. Not re-run (quota; outside the authorized scope). Human (d0843ec0): "codex 额度没了就记下来，先跑全量门" — codex leg owed until the quota resets.
Post-fix gate (session d0843ec0, gate5, fresh clone at aff94b70 — tip after 756d3d28, ORCA_CCLOOP_BIN=ccloop 02cbacc build, load 7→42): ci/webbuild/typecheck/build/pin/scheduler 0; full 3958 = 3922 pass / 36 skip / 0 fail; verify:control 2050 pass / 30 skip / 0 fail; verify:chain 0; verify:panel 0; claude-md 0; tmpleak 0; ~/.orca hashes unchanged. --ws check 1140/1141: taskLabelsDraftBase findByRole timeout (registered shape, known-load-flakes a852f96a) — alone 3/3 green at load 12-13 => load flake. Gate script's ~/.cache/ccloop check RC 1: entry 811b06f8….json and codex-home/6c50abdd…/codex-home/tmp/arg0 mtime 09:33 → 11:17, observedAt 2026-10-17T03:17:20Z; its key is the real nvm codex with real ~/.codex/config.toml, while every gate test runs with CCLOOP_CACHE_DIR and CODEX_HOME relocated (tests/setup/relocateCcloopCache.ts; the gate's own CCLOOP_CACHE_DIR stayed empty) ⇒ written by the running panel service (pid 99731, service.env has no CCLOOP_CACHE_DIR), by design, not by the gate. => gate passed (classified).
