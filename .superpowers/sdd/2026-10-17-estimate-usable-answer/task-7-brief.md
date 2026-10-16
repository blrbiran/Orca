### Task 7: Acceptance harness for paid runs

**Files:**
- Modify: `scripts/live-driver-acceptance.ts`
- Test: run it in fake modes (no paid call)

**Interfaces:**
- Produces flags: `--scenario estimate` accepts `--codex <bin> --model <name>` (soft estimate mode, profile declares the window from `--context-window`, default 1000000); `--instruction-version 1|2` (default `2`, written into the harness's own profile); `--repeat <n>` (default 1) runs n estimates of the same plan in fresh groups; `summary.json` gains `estimates: [{ state, reasonCode, repairs, origin, retriedAs, retrySkipped, calls, tokens }]` and a tally `{ firstCallReady, readyAfterRepair, readyAfterRetry, failed }`.

- [ ] **Step 1: Run** `--fake-omp --scenario estimate --estimate-only --repeat 2 --instruction-version 2` before the change — expect a usage error (flags unknown).
- [ ] **Step 2: Implement**; the fake-omp answer for the second repeat is the evidence shape (duplicate `a` + placeholder) so the tally shows one `readyAfterRepair`.
- [ ] **Step 3: Run** the fake command above and `--fake --scenario estimate …` for codex — exit 0, tally as expected, `~/.orca` unchanged (the script's own check).
- [ ] **Step 4: Commit** `test(acceptance): estimate scenario for codex, instruction v2 and repeated runs`.

### After Task 7 (controller only, not a subagent task)

Whole-branch review; final gate in a fresh clone; paid acceptance per spec §6 (omp alias ×5+, codex `gpt-6-luna` ×1, claude 1M ×1) with tool-reported tokens only; ledger `.superpowers/sdd/2026-10-17-estimate-usable-answer/progress.md`; handoff with the human's one-field profile edit (`instructionVersion` → `"2"`, after checking no estimate is queued/running).
