# Global Constraints (verbatim from plan lines 15-33) + controller rulings
## Global Constraints

- omp argv for a single call, in this order: `--profile <p> --no-extensions --no-skills --no-rules --no-lsp --no-tools --no-session --no-title --no-prewalk --model <m> --mode json -p --system-prompt <file> --cwd <request.cwd> --config <overlay>`; no `--tools` list.
- Timeout of a single call: `min(request.timeoutMs, installation.timeoutMs)`; cwd and runDir are the request's.
- Spawn-time check: re-read the catalog row immediately before spawning; run only when the row exists, `singleCallExecution` would still be `"v1"`, and `0 < row.maxTokens <= request.maxOutputTokens`; otherwise refuse `omp-single-call-cap-exceeded` (or `omp-single-call-unavailable`), `neverStarted` (books 0).
- `singleCallExecution` is `"v1"` only when the row has a `maxTokens` and its provider is not `openrouter`, else null. `contextWindowTokens` is the row's `contextWindow`, else null. `singleCallOutputCap` is the row's `maxTokens` for omp, null for claude and codex.
- A catalog number is used only when it is a positive safe integer.
- Decode, fail closed: exactly one assistant `message_end` (more ⇒ `omp-single-call-multiple-requests`); no `tool_execution_*` event (`omp-phase-tool-forbidden`); `provider/model` equals the selection (`omp-model-mismatch`); `stopReason` `"stop"` decodes, `"length"` ⇒ `SingleCallOutputInvalid`, any other ⇒ `omp-single-call-stop:<reason>`.
- Output rule: the final text, trimmed, with at most one surrounding fenced block removed, must `JSON.parse` to a plain non-array object; anything else is `SingleCallOutputInvalid`.
- Usage: the assistant message's `usage` with the per-model breakdown; output-invalid and decode failures book that observed total; a process that exits non-zero, is aborted or times out books null even after a complete `message_end`; `ompUsageLowerBound` stays diagnostic.
- Orca: `bound = max(preflight.maxOutputTokens, singleCallOutputCap ?? 0)` is the contract/envelope `maxOutputTokens`; `requiredRequestTokens = inputTokens + bound`; the `input-too-large` rule is unchanged (`ESTIMATE_GRANT.tokens` = 250 000).
- Orca: `singleCallOutputCap` is optional, nullable, a positive safe integer; never frozen (like `singleCallExecution`); no persisted schema changes.
- omp's `budgetEnforcement` stays `"soft"` and `requestBoundProof` null: omp serves soft estimate mode only.
- No proxy, no wire-format scope (ruling 3).
- If Task 0 cannot confirm every overlay key, omp keeps answering `singleCallExecution: null` (spec §3.3.3) — see Task 0's stop rule.
- Mutations only in a `git clone --local` copy; restore proven by the byte counts of `git diff` and `git diff --cached` (redirected to files, read whole). `ORCA_CCLOOP_BIN` points at a built ccloop clone, never `node_modules/ccloop`.
- No existing test is rewritten unless the human names it (ccloop Rule 15; Orca Rule 9/11). Every commit message ends with the two trailer lines below. The agent never pushes, merges, or deletes branches/worktrees (ccloop Rule 13, Orca Rule 15); those go to `awaitingHuman`.
- No paid model call (no real `omp -p` against a real provider, no codex/claude prompt) without the human's yes for that run.
- Verification output is redirected to a file and read back whole (never piped through grep/tail/head).

## Controller rulings that bind reviews
- Ruling I1: adopt — Task 8 adds an envelope-level assertion (ESTIMATE.prepare in src/control/singleCallPurposes.ts) and Task 10 adds mutation Menv (contract.maxOutputTokens → preflight value) — spec §5.8 names the envelope — cost if wrong: one extra test.
- Ruling I2: adopt all — Task 6 adds M1d (positiveSafe identity), M4f (drop unavailable clause), M5d (decode a non-completed outcome), M5e (Math.min → installation timeout), M5f (regex → .+); Task 10 adds M10b (positive() dropped) — ccloop's own methodology §1 already requires a seen-red mutation per new branch, so this is ccloop's rule, not Orca's spilling over (Rule 16) — cost if wrong: extra mutation runs.
- Ruling I3: adopt — the new C7 test reads `(failure as {tokenUsage?: unknown} | null)?.tokenUsage` so M7 reds on the assertion — new test, no rewrite — cost if wrong: none.
- Ruling m1: Task 2 dispatch carries the corrected expected-red text (C1 rejects omp-model-catalog-unavailable; "still refuses…" red with uncoded Error; C2 red at toBeNull/toBe("v1")) — cost if wrong: none.
- Ruling m2: every edit is applied by its quoted unique anchor text, never by line number — cost if wrong: none.
- Ruling m3: Global Constraints decode bullet reads as the spec (tool_execution_*, extension_ui_request, *subagent*) — spec wins — cost if wrong: none.
- Ruling m4: keep the plan's behaviour (unparseable line → null; pre-spawn abort/spawn error → neverStarted books 0, as types.ts ERRATUM and ompAdapter.ts:32) and record both as interpretations — consistent with existing phase adapter — cost if wrong: a rare observed total is booked null (conservative) / a never-sent call books 0.
- Ruling m5: mut.sh is called with the pattern as positional arg 6 (no literal -t) — cost if wrong: none.
- Ruling m6: fake-omp.mjs edit kept; named in the checkpoint's fixtures-touched line and in the ccloop report — cost if wrong: none.
- Ruling m7: Task 2 appends an ERRATUM to the registry.ts singleCallExecution doc comment (ccloop Rule 16 append-only) — cost if wrong: one comment line.
- Ruling m8: Task 10 adds Mfloor (`?? 0` → `?? 1_000_000`) that must red "C8: no cap…" — cost if wrong: one mutation run.
