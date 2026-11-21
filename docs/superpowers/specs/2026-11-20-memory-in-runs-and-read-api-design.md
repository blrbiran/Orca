# Memory in Orca runs, and a supported read API (tester #417 / #418)

> Status: **design only** (2026-11-20, Orca session `48bc4690`). Human ruling the same day: do **not** enable ccmem's
> harness hooks or extensions inside Orca's isolated phases; give runs memory through an Orca-produced bundle instead, and
> make `orca status` say the truth until then. Nothing in this document is implemented.

## 1. Facts the design starts from (verified in code, 2026-11-20)

- ccloop's codex phases run with a private `CODEX_HOME` and `-c features.hooks=false`
  (`src/agents/codexIsolation.ts`); omp phases pass `--no-extensions` and `-p`
  (`src/runtime/omp/runOmpPhase.ts:139`); ccmem's omp extension returns immediately for `ctx.mode === 'print'`.
  Neither kind loads a user-level ccmem hook or extension today.
- **Claude phases are different**: they launch with `--setting-sources project,local`
  (`ccloop/src/agents/claude.ts:39`) and `--settings '{"autoMemoryEnabled":false}'` (`:45`). That excludes the person's
  user-level hooks and plugins (where ccmem installs), but a **target repository's own project/local settings still
  load** — including a hook that repository installed itself. So "a run never loads memory" is true for codex and omp,
  and true for ccmem-as-the-person-installed-it under claude, but not for a repository that wires ccmem itself.
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

## 3. ccloop half: `work.memory` (optional)

```jsonc
"work": {
  "tokens": 120000,
  "memory": {
    "format": "ccloop-memory-v1",
    "sha256": "<hex of text; ccloop verifies, does not echo>",
    "tokens": 1200,            // the producer's estimate; ccloop does not re-tokenize
    "ids": ["m1042", "m1057"], // ccmem ids the text came from, for the run evidence
    "text": "## ccmem context\n- …\n"
  }
}
```

- **Both work schemas get the key** (`protocol.ts` `loopWorkSchema` for protocol 3 and its protocol-4 sibling). The
  protocol is chosen by `startEnvelope.ts:124` (`record || policy ? 4 : 3`), and most ordinary runs are 3 — a
  protocol-4-only key would silently mean "some runs have memory and some do not" depending on funding shape.
- **Refused beside `mode`**, exactly as `operatorNote`, `priorFailures` and `handoff` are (`protocol.ts:362-368`; Orca
  mirror `src/control/schema.ts:86-90`): a verify-only recovery envelope never carries an unused bundle whose bytes
  would still move the envelope hash.
- **Only plan and execute** receive it. The plumbing point is `noteFor` in `src/controller/runLoop.ts:1781` (spread at
  `:2148` and `:2226`); verify builds its prompt without it. That is plumbing, not types — the criterion below must
  include the mutation that spreads it into the verifier prompt.
- **Absent means absent.** No `memory: null`, no empty `text` (the schema's `utf8Bounded` has `.min(1)`): when ccmem
  yields nothing, the key is not sent and the envelope is byte-identical to today's.
- **The cap is enforced by Orca** (8 KiB, refined by #416: over it, the bundle is dropped and `drive.memory` records
  `{error:"too-large"}`, and the run proceeds). ccloop checks too, as defence in depth, but a violation there is our bug:
  an envelope refusal is `control-request-invalid`, and a `ControlProtocolError` exits 2, which Orca turns into
  `blockRun("B", "accept-refused:…")` (`executionDriver.ts:1038-1040`) — a too-long bundle must never fail a run.
- **ccloop recomputes `sha256`** over `text` rather than trusting the producer; otherwise the value in run evidence
  proves nothing.
- **The text is encoded as a JSON string** in the prompt, exactly as the operator note is (`runtime/claude/prompts.ts`
  §"operator note"), not pasted raw under a delimiter: memory rows include machine-written sources (`tool_output`,
  `auto_inferred`, `external`) and are untrusted text.
- **Collect: one top-level optional key**, `memory: {sha256, ids, tokens}` per run (the current attempt's, as `attempt`
  is today), spread only when present — never `| null`, which would change every existing collect answer and trip
  Orca's strict `collectionSchema`. The field proves that the run was dispatched with a bundle whose hash the producer
  recorded; Orca's own stored envelope already names the same hash.
- **Lockstep order for `features.memory`**: Orca's features schema is strict and `readFeatures` re-throws anything else,
  so Orca must accept the key **before** ccloop announces it (the `attemptRef` precedent). Sequence: Orca first (accept
  and ignore), then ccloop announces, then Orca starts sending.
- **Cross-version invariant**: ccloop emits `memory` in collect only when the envelope carried it, so a new ccloop and an
  old Orca stay compatible.

## 4. Orca half

### 4.1 Producing the bundle

- New `src/memory/bundle.ts`: `ccmem export --json --scope project` (cwd = the task's repository) plus `--scope global`,
  then a **deterministic** pick: drop `retrieval_only` only if the human turns that off (Q2 below), rank by
  `pinned`, `trust_score`, `updated_at`, take up to `memory.budgetTokens` (profile key, default 1200), render
  `- (<type>) <content>` per line, and compute the sha256 over the exact text.
- The bundle is frozen into the run's dispatch record at `stepA2` → `toStartEnvelope` (`executionDriver.ts:690-703`),
  which every later dispatch and collect reads back. **A retry inside the run is byte-identical**; a **continuation is a
  new run** with its own envelope (`continuation.ts:188-196`) and therefore a new bundle; an A2 crash before the envelope
  is recorded re-enters `stepA2` (`:2189`) and recomputes.
- **Multi-directory groups**: `stepA2Multi` (`executionDriver.ts:716`) has no single "the task's repository"; the bundle
  is produced from the **primary** directory's project scope plus global, and the fact is recorded.
- **Single-call runs (clarify/split/estimate) get no memory**: they are separate envelopes (`requirementCalls.ts:120-133`)
  with no place for a bundle; this is stated as a boundary, not an oversight.
- A ccmem failure (non-zero exit, unparseable JSON) **does not fail the run**: the run goes on without memory and the
  fact is recorded (`drive.memory = {error}`), because memory is an amplifier, not a prerequisite.

### 4.2 The read API (tester #418)

- ccmem gains `ccmem list --json --query <text> [--scope global|project|all] [--limit N] [--offset N]` returning the
  **export row shape** (`id,scope,project_key,type,content,pinned,source,trust_score,tags,created_at,updated_at`) plus
  `score`. Today `cmdList`'s query path returns `renderRow` (`{id,type,content,scope,score}`), ignores `--scope`, has no
  offset, and caps at `inject.max_per_prompt` (default 6) regardless of `--limit` — all three have to change for the
  panel's page sizes to mean what they say. Read-only; `export` stays byte-compatible.
- The panel's `/api/memory/*` uses one query per request instead of two exports + substring filtering; its search and the
  agent retrieval then agree (#414 made both paths safe against `C++`).
- **The run evidence carrier** is the established `transcripts` pattern: collect → written onto the run's body
  (`executionDriver.ts:1170`) → projected by the panel (`controlViews.ts:292`). `drive.memory = {sha256, ids, tokens}`
  rides there, with its own schema in `driveRecord.ts` and one view field; the Memory page can then show the same ids.
- Corrections: the service starts with corrections **on** by default (Q1), and a correction's `retrieval_only` tag is
  reconsidered — "do not do that again" is exactly what the stable section is for.
- **`dir:` projects**: ccmem derives the project key from `cwd` on both paths (`project-key.mjs`: a repository without a
  remote becomes `path:<sha256(cwd)[:16]>`), and `orca-correction` rejects unknown input keys, so `dir:<id>` is not
  reachable through today's interface. Either both wire changes are made (a project-key field on the correction input and
  on `export --scope project`) or dir projects are **refused for memory by name** (Q4).

## 5. Costs and risks

- **Prompt cache**: the bundle sits in the user turn (as the operator note does), so it does not disturb the system/tools
  prefix. But #416 measured the *operator note*; 8 KiB is an order of magnitude larger, and its numbers do not stand in
  for the bundle's. Measure before tuning, and before the ref/on-demand step.
- **Staleness**: a frozen bundle can be wrong by round 3 of a long run; that is accepted (the operator note has the same
  property), and a continuation is a new run with a new bundle.
- **Leakage**: `retrieval_only` exists to keep project corrections out of the session-start stable section; the bundle is
  per-run and per-task, not session-wide, so the same tag does not constrain it the same way (Q2). Untrusted text is
  handled by JSON-string encoding, not by trusting the source.
- **Size**: 8 KiB is a placeholder until #416's numbers; the cap is enforced by the producer (drop + record), never by
  failing the run, and never by silently cutting the text.

## 6. Criteria (each must be seen red first)

1. **Bytes without `memory` are today's**: mutation — `toStartEnvelope` emits `memory: null` unconditionally. (`undefined`
   would not show: `JSON.stringify` drops it.)
2. **The cap is Orca's, not a refusal**: mutation — remove the producer's cap; a 9 KiB bundle must be absent from the
   envelope and `drive.memory.error = "too-large"`, while the run is still dispatched. ccloop's own check, if added, must
   be `control-request-invalid` and therefore unreachable from Orca.
3. **Verify never sees it**: mutation — spread the memory lines into `buildVerifierPrompt`; the verifier-prompt assertion
   must go red. (Before implementation the positive half is red for the trivial reason that nothing carries it.)
4. **Collect proves what was sent**: mutation — emit `ids: []`. The absent case is proven by mutation 1.
5. **A ccmem failure does not fail the run**: mutation — replace the recorded error with a `throw`; the run must stop
   being dispatched.
6. **The list API**: `list --json` is unsupported today (`cli.mjs` prints text and ignores unknown flags), so the parse
   failure is the first red; then assert the export row shape and `--scope`/`--limit`/`--offset`, and count child
   processes (one ccmem call per request, not two exports).
7. **`dir:` projects**: if Q4 is "add the wire surface", the criterion is the correction being visible to the next run in
   the same project; if Q4 is "refuse", the criterion is a named refusal on both the write and the read path.

## 7. Open questions for the human

- **Q1** corrections on by default in the service (today: opt-in flag)?
- **Q2** may `retrieval_only` corrections enter the per-run bundle?
- **Q3** one memory list in the panel (run evidence and page agree) — accept the extra read per run?
- **Q4** `dir:` projects: add the two ccmem wire changes (a project-key input to `orca-correction`, and `--project-key`
  on `export --scope project`), or **refuse memory for dir projects by name** for now (recommended — it is the smaller
  surface, and a wrong key is worse than no memory)?

## 8. Review round 1 (independent, 2026-11-20)

An independent reviewer read this document against both repositories; the load-bearing findings were re-checked here
before this revision. Changes made in response:

- **§1** no longer claims "a run never loads memory": claude phases load `--setting-sources project,local`, so a
  repository's own hook still runs; README and `orca status` say the same (follow-up commit).
- **§3** the key goes into **both** work schemas (protocol 3 is the common case, `startEnvelope.ts:124`); it is refused
  beside `mode`; collect carries it as an absent-or-present top-level key (never `null`); the size cap is enforced by the
  producer because an envelope refusal exits 2 and blocks the run; ccloop verifies the sha; the text is JSON-encoded; the
  `features.memory` lockstep order is named.
- **§4.1** retry vs continuation vs A2 re-prepare are distinguished; multi-directory uses the primary directory;
  single-call runs are out of scope by name.
- **§4.2** the run-evidence carrier is named (`transcripts`' pattern); the list command's row shape, scope, offset and
  the `max_per_prompt` cap are listed as required changes; `dir:` keys are shown to be unreachable through today's
  interface (Q4 rewritten).
- **§6** every criterion now names the mutation that makes it red; the `dir:` criterion depends on Q4.

## 9. Decision round (2026-11-20, human approved the bundle direction)

The human approved the long-term direction in this document ("#417 => 同意你的建议"): runs get memory through an
Orca-produced, bounded bundle; harness hooks and extensions stay closed. The four open questions are settled as
follows. This section is a decision, not an implementation; §3–§6 remain the design of record.

- **Q1 — corrections on by default: yes.** The service writes closed corrections to ccmem unless it is started with an
  explicit opt-out. The current opt-in flag is the reason `orca correct` silently reached nothing in the common
  configuration. The write path keeps its existing failure recording and retry.
- **Q2 — `retrieval_only` in the bundle: yes for `orca-correction`, no for the rest.** A correction means "do not do
  that again"; keeping it out of the run's bundle defeats the correction. Other `retrieval_only` rows (external
  imports) stay retrieval-only. The bundle records the tag it included, and the selection rule is deterministic.
- **Q3 — one memory list, accepting one read per run: yes.** The bundle is frozen at `stepA2`; its `sha256` and `ids`
  are recorded in `drive.memory` and collected. The panel shows those ids, so the run evidence and the Memory page agree.
  The panel's page/search uses the supported `ccmem list --json` query (one process, not two exports).
- **Q4 — `dir:` projects: refuse by name for now.** `dir:<id>` and ccmem's cwd-derived `path:<sha256>` are not the same
  key, and a wrong key would mix one directory's memories into another's run. Both the correction write and the read
  path answer a named refusal (`dir-project-memory-unsupported`) that says the project has no repository key. Adding
  the two wire changes (a project-key input on `orca-correction`, `--project-key` on `export --scope project`) is the
  follow-up once the key mapping is specified.

Boundary kept from §5: a ccmem failure never fails a run; the bundle is capped by Orca (drop + `drive.memory.error`),
never by an envelope refusal; verify never receives it; single-call runs stay out of scope.

## Correction (2026-11-21)

§3 shows `"ids": ["m1042", "m1057"]`. ccmem's memory ids are positive integers (the `m` is display decoration), and
Orca's own export reader validates `id` as a positive integer. Corrected: `"ids": [1042, 1057]`, positive integers, in
the same order as the text's rows. The original text above stays for the record; the outcome writeback spec
(`2026-11-21-run-outcome-writeback-design.md` §7) depends on this shape.