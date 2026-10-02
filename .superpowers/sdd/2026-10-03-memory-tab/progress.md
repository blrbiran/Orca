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
Task 0: minor (deferred): task-0-report labels a git blob id as SHA256 (report untracked; check itself holds)
Task 0: complete (commits c91d029..941a89f, review clean; plan blob verified equal to the controller's file by git rev-parse vs git hash-object)
| 1 | test(memory): relocate ccmem's data root for every test file and guard the real one by name | ccmemGuard.test.ts (4 tests); setup file relocateCcmem.ts wired in vitest.config.ts | M-G1 body→`return []` → 2 flags tests red → seen red; M-G2 delete disappeared line → "flags the database disappearing" red → seen; M-G3 drop `BACKUP.test(name) &&` → "ignores what ccmem's own daemon…" red → seen; M-G4 REAL_ROOT→temp dir + afterAll writes global.db.bak.9 → file fails in afterAll hook ("changed the real ~/.claude/ccmem") → seen | full root suite 1 failed (driverRequirementSplit 5 s load flake, passes alone) / 2497 passed / 46 skipped; red evidence in task-1-report.md |
Ruling: commit trailers name the model that wrote the commit (a sonnet implementer writes 'Claude Sonnet 5.5'), not the controller's model as common.md first said — the subagent's own harness attribution is the accurate one; common.md amended — cost if wrong: cosmetic trailer text on some commits.
Task 1: minor (deferred): ccmemRoot.ts existsSync+readdirSync throws ENOTDIR if the root is a file, at module load of every test file (brief-mandated code)
Task 1: minor (deferred): no criterion for the branch "root vanished while it held global.db" (ccmemRoot.ts after===null arm); Rule 9 wants its own mutation seen red — fix in the final wave
Task 1: minor (deferred): Task 0 completion lines sit inside the ledger's table (cosmetic)
Task 1: complete (commits 941a89f..dc8527b, review clean; mutation outputs mut-G1..G4 opened by the controller)
| 2 | feat(memory): adapter types and a strict reader for ccmem's export | ccmemExport.test.ts (13 tests); adapter.ts is types only | M8a .strict()→.passthrough() → "an extra row field" red → seen; M8b type z.enum()→z.string() → "a type ccmem never had" red → seen; M8c parseTags→silent fail → "tags that are not JSON" and "tags not array of strings" red → seen; M8d delete scope !== scope line → both "…in a…answer" rows red → seen; M-D11 epochMs→z.number().int() → "Review Focus 3" rows red → seen | |
Task 2: complete (commit TBD; all 13 mutations seen red as brief-mandated)
Correction to the Task 2 row above (controller, after review): the criterion is 15 tests (2 it + 13 it.each rows) and 5 mutations, not "13 tests / 13 mutations". Mutation outputs opened by the controller in $SCRATCH/t2: M8a 1 red (extra row field), M8b 1 red (type), M8c 2 red (both tags rows), M8d 2 red (both scope rows), M-D11 2 red (created_at row with RangeError: Invalid time value; updated_at row). All 15 pass unmutated.
Task 2: minor (deferred): no row for project_key "" (the === "" arm of the project-key check), so its deletion is never seen red (Rule 9)
Task 2: minor (deferred): the source-enum row asserts only /row id 7/; tighten to /memories\.0\.source/
Task 2: complete (commits dc8527b..8eb52a1, review clean after the controller verified the mutation evidence; the reviewer's Important item was evidence accuracy, resolved by the correction line above)
| 3 | feat(memory): substring search with a fixed order, and strict request parsing | search.test.ts (10 tests) | M9a delete \|\| r.tags.some(...) → "counts a record whose only match is a tag" red → seen; M9b fold → text.toLowerCase() → "matches across normalisation forms, both ways" red → seen; M9c compareRecords → Number(a.ref) - Number(b.ref) → "orders pinned first, then newest update, then larger ref" red → seen; M9d [...query].length → query.length → "takes a trimmed query of up to 200 code points" red → seen; M-RF2 single → (raw) => String(raw) → "refuses a control character and a repeated parameter" red → seen | |
Task 3: complete (commit eda2781, all 5 mutations seen red as brief-mandated)
