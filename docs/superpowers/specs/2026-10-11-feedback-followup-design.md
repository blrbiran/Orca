# Feedback followup: reliable execution and approachable controls

Owner: Codex controller, 2026-10-11 Asia/Shanghai. The human approved the decisions below in this chat, then authorized this session to write/review specs (including an extra independent subagent review), write plans, finish the previous Results 5, implement through subagents, verify, and merge all work locally into main. Intermediate questions and architectural rulings are delegated to the controller; final audit goes to the human. This authorization supersedes intermediate skill review stops and covers local merges in both changed repositories. It does not authorize remote push, package publication, default dependency repin, deletion of the previous WIP, paid providers, production databases or service changes.

## 1. Outcome and decomposition

People should understand task progress, preserved results, execution controls, failures and preparation without repeating settings or guessing whether a command ran. Scope is the approved feedback of 2026-10-08 (updated through Issue 44), against current source rather than the feedback's stale status table.

Architectural subprojects, each with a separate authoritative spec:
- `2026-10-11-token-policy-design.md`: genuine optional cumulative token ceilings and independent spend-cap allocation.
- `2026-10-11-saved-result-recovery-design.md`: deterministic output normalization and verifier-only recovery from complete saved evidence.
- `2026-10-11-agent-preparation-design.md`: primary Agent/role overrides and installation observation/preview/apply.

Bounded browser changes are specified here. Previous progress/overview/settings implementations are retained. Previous Results 5 is a prerequisite, governed by `2026-10-10-task-results-design.md` including append-only amendments, its plan Task 5 and predecessor brief. Do not replace saved source identity, verification lifecycle or Git delivery with Agent claims. No extra summarizer, cost-estimation service, cross-group autonomous planner, wizard, permanent delete or visual skin rewrite.

## 2. Results 5 and workspace ownership

Previous uncommitted Results 5 lives in `/Users/biran/.codex/worktrees/progress-results-20261010/Orca`, owned by another chat. Keep it untouched. Its web patch and untracked result components/tests are copied into this session's isolated writable clone after spec and plan review. Exclude its node_modules, parent-owned spec/self-review changes and historical ledger. Use current main APIs/DTOs and the previous brief as authority. Preserve the old worktree even after local integration.

This session owns `/private/tmp/orca-feedback-followup-20261011` and `/private/tmp/ccloop-feedback-followup-20261011` on `codex/feedback-followup-20261011`. Native managed worktree creation succeeded but its directory is outside sandbox writable roots; use these isolated no-hardlink clones for development. Do not mutate source main until final authorized fast-forward integration. Dependencies may be symlinked but must never be staged. Record all artifacts in this plan's `.superpowers/sdd/2026-10-11-feedback-followup/`; old ledger remains historical.

## 3. Execution controls

Title: `执行控制` / `Execution controls`.
- pause-dispatch: `暂停启动新任务` / `Pause new tasks`; running work continues.
- resume-dispatch: `继续执行` / `Continue execution`; future dispatch resumes.
- handoff-stop: `保存进度并停止` / `Save progress and stop`; requests safe handoff, does not promise task completion or recoverability.

Show pending stop as `正在停止` / `Stopping`, and settled stop as `已停止` / `Stopped` only from authoritative stop facts. Display continuable, retryable and unresolved work separately. Task completion remains separate. Existing server eligibility, frozen selections and command semantics control available actions; do not reduce controls to a broad group-state switch. No force-kill control.

## 4. Uncertain command outcomes

Command recovery first reads the retained command result even if its group no longer exists. A found result resolves normally. Ordinary absent result semantics remain distinct from proven success. For a genuine group scope whose result is unavailable and group does not exist, park automatic lookup and show one owned attention item: `任务组已不存在，无法确认这条操作的结果。` / `The task group no longer exists; this operation's outcome cannot be confirmed.`

Persist original command id, scope, import marker, known verb/payload metadata if already available, reason and parked/dismissed state in the browser uncertainty storage. Do not fabricate metadata absent from old entries. Offer `重新核对` / `Check again` and `关闭提示` / `Dismiss`. Check again explicitly performs one lookup and may resume transient recovery; dismiss hides attention, preserves unknown identity and performs no POST. Epoch reset/auth/scope changes must not turn parked unknown into succeeded or restart polling. Network/temporary server errors continue existing bounded recovery. `@repository`, `@operator`, `@spend` are command scopes, never missing-group heuristics. No SQL deletion and no automatic resend.

## 5. Failure diagnosis and activity

Render authoritative phase, typed direct cause and applicable next action before opaque status/failure codes. Preserve raw error code and run/attempt identity. Execution decode failures may say missing envelope only if the normalizer's typed diagnostic says so; no guessed token exhaustion. Unknown cause is explicit. Link existing evidence/log download and saved final/decode diagnostics through authorized evidence routes; never expose arbitrary server paths. Add saved-result verification eligibility from its spec; retain ordinary retry/recovery where legal. No model diagnosis.

The Activity API remains its existing strict envelope with numeric ordered entries; a valid run with no entries returns `entries: []`, missing run and unavailable/malformed data remain errors. Reproduce the reported CLI null by a real isolated API/CLI path, not by teaching UI to silently turn every invalid body into empty activity. Retain newest-window backend and chronological window display, clearly label its limited history.

## 6. Group/requirement menu

Cards expose visible `更多操作` / `More actions`: open exact owner details, archive/unarchive and copy group id. Context menu invokes the same accessible menu. Button works by keyboard/touch; Escape closes, focus returns to trigger, disabled actions explain reason. Avoid buttons nested inside card buttons/links. Clarifying card navigation opens its exact requirement and its menu can archive without navigating. Resolve current group revision before POST, preserve source identity through project switch/late reply, server archive conditions remain authoritative. No permanent deletion.

## 7. Preparation and requirement transition

Rename budget confirmation entry to `确认任务方案` / `Confirm task plan`. Review goals, acceptance, effective Agent, workspace and integration; show optional explicit token policy. Retain two explicit actions: confirm, then start. Missing prerequisites include deterministic reason and destination; no automatic confirmation/start. Requirement split acceptance offers `前往任务准备` / `Go to task preparation`, exact same group. Retain inspect-source requirement link/history after acceptance. Existing overview/next actions are reused; do not implement another wizard/state authority.

## 8. Advanced chains

Rename navigation to `连续改进（高级）` / `Continuous improvement (advanced)`. Browser preference `orca.showAdvanced` defaults false and is edited in Global settings. Recognized `#chains` links remain accessible even hidden. Any active chain retains status banner and stop access regardless of preference; there are currently no real chain instances to migrate. No environment-variable display switch, no new task-level auto-execute flag, no cross-group automatic planning. Document its current Orca-development scope honestly.

## 9. Validation and release boundary

Both locales and placeholder/pseudo coverage. Browser real authenticated HTTP app at desktop, 390px mobile and short height: no horizontal viewport overflow, account/sidebar footer usable, card menus accessible, results file text inert, tabs keyboard reachable. Keep selected project globally visible and existing distinct global/project settings.

Run affected criteria with meaningful RED/GREEN and independent branch-deletion mutations in separate clones. Final root/Web/type/build/control/panel/scheduler/chain/pin/leakage gates retain unfiltered logs, exit codes and exact measured tree identity. Collect every skipped test's name and condition, including the six extra merged-main skips and two agentPreviewRefresh timeouts. A single passing rerun is not a blanket flake exemption.

Test HOME/XDG/TMPDIR/CCMEM_DATA_ROOT redirected, CCMEM_CONFIG_PATH absent; no real ~/.orca or ccmem data access. Old pinned ccloop and paired new source binary both get compatibility coverage. package.json/package-lock/default installed ccloop remain fixed until separately authorized repin; new peer-only features visibly refuse unsupported old peers rather than silently falling back. Final local source merges do not imply deployed capabilities.

After final review and fixes, fast-forward both changed main branches from this session's branches and run relevant merged-main checks; preserve old WIP and new branch evidence. Replace live Orca entry and each sister handoff's existing Orca rolling section, not append growing sections. Use topic/path anchors rather than hard-coded current HEAD. ccmem gets no product changes. Human final audit includes rulings, exact test changes, failures/skips, unsupported/deployment boundaries. Chat executive handoff at most ten lines, not a file.
