# SDD ledger — plan: docs/superpowers/plans/2026-10-03-memory-tab.md

# Memory tab (N5) — progress ledger

Owner: Orca controller session `184d0372`, 2026-10-03. Plan: `docs/superpowers/plans/2026-10-03-memory-tab.md`. Spec: `docs/superpowers/specs/2026-09-29-memory-tab-design.md` (§9 rulings, §10 corrections).
Every measured value below carries its command and the commit it was observed at (Rule 14).
Human (2026-10-03, this session): plan approved; the one existing-criterion rewrite (`web/tests/shell.test.tsx:74`, plan D10) authorized ("同意改这次必要的判据"); execute in this session, subagent-driven; on problems follow the controller's own recommendation without asking; report at the end.

## Preflight

Ruling: commit on local `main`, no worktree branch — every earlier Orca round landed local commits on main; a worktree branch would need a merge into main and a worktree deletion, both of which Rule 15 reserves for the human — cost if wrong: the human moves the commits onto a branch themselves (nothing is pushed).
Ruling: this ledger's first line is the SDD identity line, followed by the plan's Task 0 header; the controller created the file before Task 0 — Task 0's implementer only appends spec §10 and commits — cost if wrong: one cosmetic header line.
Ruling: the SDD workspace is NOT deleted at the end — CLAUDE.md Rule 13 makes `.superpowers/sdd/**` part of the evidence chain; progress.md is committed with `git add -f`, briefs/reports/review packages stay untracked as in earlier rounds — cost if wrong: some untracked files linger.

Preflight scan (tasks sharing a file or interface):

| Pair | Produces → consumes | Found |
|---|---|---|
| T0 / T8 | ledger file | append-only, consistent |
| T1 → T4 | `relocateCcmem.ts` sets `process.env.CCMEM_DATA_ROOT` → T4 M3 asserts process.env differs from the fake's env | consistent; T4 depends on T1 order |
| T2 → T3 | `MemoryRecord`, `MemoryPage`, `MemorySearchOptions` | consistent |
| T2, T3 → T4 | `parseCcmemExport(stdout, scope)`, `searchRecords(records, opts)` | consistent |
| T4 → T5 | `CcmemAdapterOptions`, `createCcmemAdapter`; helpers `fakeCcmem({mode})`, `.dir`, `.env`, `.calls()`, `memoryRepo()` | consistent |
| T3 → T5 | `Parsed<T>`, `parseQuery/parseLimit/parseRef` | consistent |
| T5 → T6 | wire types ↔ web types (parity file); `zhErrors` 7 entries land in T5, T6 must not re-add | consistent (T6 step 3 says so) |
| T4 → T7 | `memoryRepo`, `PROJECT_KEY`, adapter | consistent |

| Task | Self-consistency |
|---|---|
| T0 | text only; consistent |
| T1 | tests vs code consistent; M-G4 is a hook-wiring mutation, acceptable |
| T2 | each `it.each` regex matches the message the code builds (zod paths `memories.0.type`, unrecognized-key path `memories.0`) |
| T3 | consistent |
| T4 | fake modes ↔ adapter tests consistent; `huge` (>1 MiB) vs injected 64 KiB cap |
| T5 | commit list includes `web/src/locales/zh.ts` for the zh entries its test reads; consistent |
| T6 | shell.test rewrite now authorized; tests vs component consistent |
| T7 | consistent; gated with ctx.skip() per scopeTmpdir erratum |
| T8 | consistent |

Scan: no conflicts beyond the three rulings above.

## Tasks

| Task | Commit subject | Criteria added | Mutations (edit → expected red → seen) | Notes |
|---|---|---|---|---|
| 0 | docs(plan): memory tab (N5) task by task, with the spec's plan-time corrections | none (docs) | none | spec §10 appended |
