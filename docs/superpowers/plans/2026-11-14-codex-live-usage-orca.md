# Codex Live Usage in Orca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Codex's observed tokens during a loop phase without booking them as settled usage, and describe its response-boundary ceiling accurately.

**Architecture:** Accept ccloop's optional `ccloop-live-usage-v1` collect field. Check its run identity and monotonicity, retain a provisional snapshot on the run, and project it only while that run is active and the observation fresh. Keep `recordUsage` and the group budget sourced exclusively from settled usage events. The installed ccloop dependency remains backward compatible when the field is absent.

**Tech Stack:** TypeScript, Zod, SQLite, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-codex-live-usage-design.md` (append a correction for its §5 claim that existing usage events already expose provisional observations).

## Global Constraints

- Only a completed Codex response supplies a live observation. An in-flight request can exceed a ceiling; never describe this as a hard stop.
- `liveUsage` is provisional and must never enter `usage_events`, `usage_ledger`, or group `used`.
- `contextObservation` remains `unavailable`: cumulative spend and `model_context_window` do not count the exact next request's input or bound its output.
- Keep old ccloop collect results and archived runs readable. The new field is optional on all wire and view schemas.
- Daily Orca verification uses `TMPDIR=/tmp npm test` with typecheck; `npm run verify` is reserved for releases.

## Review Focus

1. A stale read for an earlier call must never replace a later observation of the current call.
2. An observation from another run or after a terminal must not appear or change the ledger.
3. A phase with no completed response must show no numeric live observation.
4. A stopped or silent run must not keep showing a stale value as live.
5. An old ccloop that omits the field must retain today's phase-end wording.

---

### Task 1: Accept and retain provisional readings

**Files:** Modify `src/control/ccloopPort.ts`, `src/control/executionPort.ts`, `src/control/executionDriver.ts`, the run-body schema in `src/panel/controlViews.ts`; test `tests/control/ccloopPort.test.ts` and `tests/control/codexLiveUsage.test.ts`.

**Interfaces:** Consume optional `liveUsage: {schema:'ccloop-live-usage-v1';runId:string;attempt:number;phase:'plan'|'execute'|'verify';callId:string;threadId:string;tokens:number;observedAt:string;revision:number}`. Produce an optional run-body provisional field of the same shape, with no settled ledger write.

- [ ] **Step 1: Add failing tests.** A real driver collect with a matching observation updates its run view but leaves `group.used` and `usage_events` unchanged; foreign run ID refuses; older revision of the same call cannot regress the snapshot; absent/terminal removes it.
- [ ] **Step 2: Run those tests and confirm the named failures.** `./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts tests/control/codexLiveUsage.test.ts`.
- [ ] **Step 3: Add the exact optional strict schema, identity checks, monotonic snapshot and terminal cleanup.** No new accounting event or settlement path.
- [ ] **Step 4: Re-run the focused tests and typecheck.** `npm run typecheck` plus the focused Vitest command.
- [ ] **Step 5: Commit the verified control-side change.**

### Task 2: Explain observed and settled values separately

**Files:** Modify `src/control/webProtocol.ts`, `src/panel/controlViews.ts`, `src/commands/domains/usageLines.ts`, `web/src/controlTypes.ts`, `web/src/usageNotes.ts`, `web/src/RunLiveCeiling.tsx`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`; test `tests/commands/runUsageLines.test.ts`, `web/tests/usagePhaseEnd.test.tsx`, `web/tests/liveCeilingCodexNote.test.tsx`.

**Interfaces:** The run view exposes the optional provisional value while in flight. Its label says at least N tokens observed in the current phase at the given time; `used` remains booked spend. Codex's ceiling note says it stops after an observed response and may overshoot by the request already in flight.

- [ ] **Step 1: Add failing CLI/Web tests for the separate numbers, no observation yet, terminal/stale values, and the new ceiling wording.**
- [ ] **Step 2: Run each affected test and confirm it fails on its own behavior.**
- [ ] **Step 3: Project the provisional field and update English/Chinese copy.** Preserve old phase-end copy for an older ccloop result.
- [ ] **Step 4: Re-run focused tests, then `TMPDIR=/tmp npm test` once.** Report selected/skipped counts and any red tests.
- [ ] **Step 5: Commit the verified display change.**

### Task 3: Compatibility and documentation correction

**Files:** Append a dated correction to `docs/superpowers/specs/2026-11-14-codex-live-usage-design.md`; update the rolling `docs/handoff/handoff.md` at the end of the session.

- [ ] **Step 1: Check the old installed ccloop pin gives no `liveUsage`, while the new producer's exact schema parses when it is locally available.** Use a local binary override in isolated tests; only repin after the ccloop commit is published.
- [ ] **Step 2: Append the measured contract correction without rewriting the published spec.** State why #195 stays unavailable.
- [ ] **Step 3: Record the test commands, observed commits and publishing blocker in the rolling handoff.**
