# Memory in Orca runs, and a supported read API (tester #417 / #418)

> Status: **design only** (2026-11-20, Orca session `48bc4690`). Human ruling the same day: do **not** enable ccmem's
> harness hooks or extensions inside Orca's isolated phases; give runs memory through an Orca-produced bundle instead, and
> make `orca status` say the truth until then. Nothing in this document is implemented.

## 1. Facts the design starts from (verified in code, 2026-11-20)

- ccloop's codex phases run with a private `CODEX_HOME` and `-c features.hooks=false`
  (`src/agents/codexIsolation.ts`); omp phases pass `--no-extensions` and `-p`
  (`src/runtime/omp/runOmpPhase.ts:139`); ccmem's omp extension returns immediately for `ctx.mode === 'print'`.
  A run therefore never loads memory today, by design (isolation spec 2026-11-18 §3.1).
- `orca status`'s ccmem check only proved the binary is executable (`src/commands/status.ts`); it now warns and says
  that Orca-launched agents do not load memory (tester #417, this round).
- The panel reads ccmem by running two full `ccmem export --json` calls per request and filtering the strings
  (`src/memory/`); corrections are off unless the service was started with `--ccmem-corrections`, are tagged
  `retrieval_only`, and `dir:` project keys are skipped (`src/memory/correctionExport.ts:159`).
- ccloop already carries a person's note into plan/execute (`work.operatorNote`, spec
  2026-10-23-live-transcript §10.2.6) — the precedent for a prompt-carried, Orca-produced text block.

## 2. Decision

1. **No harness hooks, no extensions, no flags flipped** inside a phase. Isolation is the reason codex and omp phases can
   be replayed; a hook is arbitrary code in the agent's process.
2. Memory reaches a run as **text Orca writes into the work envelope** — the same way the operator note travels.
3. Until the bundle ships, `orca status` and the README say runs do not use memory. No green line may imply otherwise.
4. The panel's read path must become a **supported query** of ccmem, not two full exports per request.

## 3. ccloop half: `work.memory` (protocol 4, optional)

```jsonc
"work": {
  "tokens": 120000,
  "memory": {
    "format": "ccloop-memory-v1",
    "sha256": "<hex of text>",
    "tokens": 1200,            // the producer's estimate; ccloop does not re-tokenize
    "ids": ["m1042", "m1057"], // ccmem ids the text came from, for the run evidence
    "text": "## ccmem context\n- …\n"
  }
}
```

- **Only plan and execute** receive it (as `operatorNote`); verify never does — a judge must not see notes that could
  change the verdict.
- Absent key ⇒ envelope, prompt and argv bytes are unchanged (the usual only-add rule). A `memory` with `text` over the
  cap (proposed 8 KiB of UTF-8, refined by #416's measurement) is refused as `memory-bundle-too-large` rather than cut.
- The prompt places it after the operator note under a delimiter (`=== ccloop: memory bundle ===`), so a transcript reader
  can tell it apart from the task.
- `collect` gains `memory: {sha256, ids, tokens} | null` per attempt (never the text), so the panel can answer "did this
  run see memory, and which ids".
- `features.memory: "v1"` announces the key; Orca only sends it when announced, as with `attemptRef`.

## 4. Orca half

### 4.1 Producing the bundle

- New `src/memory/bundle.ts`: `ccmem export --json --scope project` (cwd = the task's repository) plus `--scope global`,
  then a **deterministic** pick: drop `retrieval_only` only if the human turns that off (Q2 below), rank by
  `pinned`, `trust_score`, `updated_at`, take up to `memory.budgetTokens` (profile key, default 1200), render
  `- (<type>) <content>` per line, and compute the sha256 over the exact text.
- The bundle is frozen into the run's dispatch record (like `operatorNote`), so a retry or a continuation sends the same
  text; a new run may get a different one.
- A ccmem failure (non-zero exit, unparseable JSON) **does not fail the run**: the run goes on without memory and the
  fact is recorded (`drive.memory = {error}`), because memory is an amplifier, not a prerequisite.

### 4.2 The read API (tester #418)

- ccmem gains `ccmem list --json --query <text> [--scope global|project] [--limit N] [--offset N]` returning the same
  rows `export` already emits, plus `score` when retrieval ran. Read-only; no schema change; `export` stays byte-compatible.
- The panel's `/api/memory/*` uses one query per request instead of two exports + substring filtering; its search and the
  agent retrieval then agree (#414 made both paths safe against `C++`).
- Corrections: the service starts with corrections **on** by default (Q1), and a correction's `retrieval_only` tag is
  reconsidered — "do not do that again" is exactly what the stable section is for. `dir:` projects get a local
  `dir:<id>` key so their corrections are not skipped.
- Run evidence records the injected ids and bytes; the Memory page can show the same ids (Q3: same list, not a second one).

## 5. Costs and risks

- **Prompt cache**: the bundle sits in the user turn (as the operator note does), so it does not disturb the system/tools
  prefix. #416's A/B measurement must precede any further churn (ref + on-demand retrieval).
- **Staleness**: a frozen bundle can be wrong by round 3 of a long run; that is accepted (the operator note has the same
  property), and `resolve from handoff` produces a new run with a new bundle.
- **Leakage**: `retrieval_only` exists to keep project corrections out of the session-start stable section; the bundle is
  per-run and per-task, not session-wide, so the same tag does not constrain it the same way (Q2).
- **Size**: `8 KiB` is a placeholder until #416's numbers; the cap is refused, never silently cut.

## 6. Criteria (each must be seen red first)

1. With no `memory` key, an envelope's dispatch bytes equal today's (fixture comparison).
2. `memory.text` of 9 KiB is refused `memory-bundle-too-large`; 8 KiB is carried.
3. Plan and execute prompts contain the bundle; verify's does not.
4. `collect` reports the ids/sha of the bundle an attempt saw, and nothing after a run without one.
5. A ccmem failure produces a run without memory and a recorded error, not a failed run.
6. `ccmem list --json --query "C++"` returns the rows the hook path returns, without an export.
7. A `dir:` project's correction is visible to the next run in the same project (Q4 chooses the key).

## 7. Open questions for the human

- **Q1** corrections on by default in the service (today: opt-in flag)?
- **Q2** may `retrieval_only` corrections enter the per-run bundle?
- **Q3** one memory list in the panel (run evidence and page agree) — accept the extra read per run?
- **Q4** `dir:` key: `dir:<projectId>` locally, or refuse memory for dir projects for now?