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
Ruling: Task 3's café pair stays as distinct literal bytes for now (composed c3a9 / decomposed 65cc81, measured with python; M9b seen red proves non-vacuous) — the plan file itself received literals because the Write tool converted the controller's escapes; converting them to \u escapes is queued for the final fix wave (written with python, byte-checked) — cost if wrong: a future normalising edit could make the NFC test vacuous until then.
Task 3: minor (deferred): convert "café" literals in tests/memory/search.test.ts:121 to é / é escapes (python write + byte check)
Task 3: minor (deferred): task-3-report claims escapes were used; the file holds literals (report untracked; this line is the correction)
Task 3: minor (deferred): no criterion for NFC on tags or for needle trimming inside searchRecords
Task 3: complete (commits fdfb729..79b87a0, review clean; mutation outputs M9a-d, M-RF2 opened by the controller, each red)
| 4 | feat(memory): the ccmem adapter, reading only ccmem export, in the repository, with the panel's env | ccmemAdapter.test.ts (18 tests) | M1 dropped --scope value → "runs export ... (M1)" red → seen; M2 drop cwd → "starts ccmem in the repository (M2)" red → seen; M3 env→process.env → red (fake lacks its log var; M3b data-root-only variant → "hands ccmem the env it was given (M3)" red on env equality) → seen; M5 → "names the exit code ... (M5)" red → seen; M6 → "gives up at the timeout" red (5 s test timeout) → seen; M7 → "refuses output past the cap (M7)" red → seen; M10/M10b → "reads a global and a project ref ... (M10)" red → seen; M-RF1 → "starts nothing for a relative path" red → seen; M-H → 3 health tests red → seen |
Ruling: Task 4 review Important (M3 does not pin "nothing added from process.env"; a merge {...process.env, ...options.env} stays green) is accepted although the test is plan-mandated — the global constraint says "nothing added, nothing removed" and the spec is the authority; fix adds a sentinel the fake logs — cost if wrong: one extra env var in a test.
Ruling: the Task 4 minors in the same files (two misleading comments; no criterion for the EACCES arm and the signal arm of the error mapping) are folded into fix round 1 instead of the final wave — same files, same implementer context — cost if wrong: a slightly larger fix diff.
Task 4: minor (deferred): STDERR_EXCERPT_BYTES slices UTF-16 units, not bytes (cosmetic name)
Task 4: fix round 1 (M3 sentinel pins nothing-added, comments made true, EACCES and signal arms covered; each new criterion seen red under its mutation; tests/memory 49/49)
Task 4: re-review of fix round 1: 4 addressed, 0 open (commits f64e2a7..00df086)
Task 4: minor (deferred): EACCES/health tests assume chmod is honoured (fail if the suite runs as root)
Task 4: complete (commits 79b87a0..00df086, review clean after fix round 1)
Task 5: panel options and the four read-only routes, wire schemas, USAGE, README, seven zh error entries (tests/memory/memoryApi.test.ts 22/22; M4, M11, M12, M13, M-route, M-RF2 each seen red; M-route needed one criterion beyond the brief)
Ruling: Task 5's added criterion (a non-MemoryError route failure answers 500 JSON panel-internal-error) is kept in place of the plan's M-route mutation — measured: express 5 still matches a route registered after the 4-argument error handler, so the plan's premise was false; the real risk (errors escaping the JSON handler) is what the new criterion pins — cost if wrong: one extra criterion with a fragile lever (Symbol in env makes execFile throw).
Task 5: minor (deferred): four branches without a seen-red mutation (item 404 arm; MemoryError→refuse catch; opts.memory fallback; env pass-through in parsePanelArgs) — run in the final mutation wave
Task 5: minor (deferred): no unit assertion that parsePanelArgs maps ORCA_CCMEM_BIN "" to null on its own (M4 pins it together with the adapter guard)
Task 5: minor (deferred): the 500 criterion's Symbol-in-env lever depends on Node spawn arg handling; note beside the adapter error mapping
Task 5: minor (deferred): existing comment src/panel/api.ts "never below it, or express stops matching them as ordinary routes" is measured false (mut-Mroute); flag only (Rule 3), the real effect is errors escaping the JSON handler
Task 5: minor (deferred): inputs parsed twice with `as { ok: true }` casts (brief-verbatim)
Task 5: complete (commits 00df086..be7663f, review clean)
Task 6: the web Memory section, read-only, nothing sent until opened (web 357/357, root memory+panel scan files 81/81, full root 2566 passed 46 skipped; W1a, W1b, W1c, W1d, W-par (both parts), W-zh each seen red; one fixture line in web/tests/i18nPseudo.test.tsx changed, see report)
Ruling: Task 6 changed one fixture string in web/tests/i18nPseudo.test.tsx (raw code unresolved-project-keys → corrections-store-busy) because the new English value "project" collided with it — that file's own header says 'if this criterion names a fixture string, change the fixture's data, not the rule'; no assertion changed — cost if wrong: one fixture line to revert and a different way around the collision.
Task 7: R1 against a real ccmem (tests/memory/ccmemReal.test.ts; skipped without ORCA_CCMEM_REAL_BIN, passed with it; ~/.claude/ccmem entry names before/after ccmemRootDiff = []; mutation tags z.string()->z.array(z.string()) in a clone: R1 red with 'memories.0.tags (row id 1): Expected array, received string' and fake ccmemAdapter 5 + ccmemExport 6 red; timing of one adapter.search, 3 runs each, via 'node --import tsx timing.mts' at commit 1520995: fake 770.5/125.2/133.6 ms, real 194.7/192.0/198.2 ms, temp root with 2 rows)
Ruling: Task 6 review Important (no guard against out-of-order responses in MemoryView: a slow list/search/item answer can overwrite a newer one) is accepted although the code is plan-mandated — showing records under the wrong repository contradicts spec §5.2's purpose; fix with a request counter, pinned by a criterion — cost if wrong: a few lines of state.
Ruling: Task 6 minors "wrong label while status loads" and "repository selector has no criterion" are folded into fix round 1 (same file, same implementer) — cost if wrong: slightly larger fix diff.
Task 6: minor (deferred): no retry after a failed status read (until reload)
Task 6: minor (deferred): seven branches never seen red alone (opened guard half; health gate; configureHint; detail shows whole content; markup as text; noProject hint; refused-detail catch; lone-surrogate assertion) — final mutation wave
Task 6: minor (deferred): MemoryView not in i18nPseudo AREAS
Task 7: timing (from the implementer's ledger row, command `node --import tsx timing.mts` at 1520995, temp data only): one adapter.search on the fake 770.5/125.2/133.6 ms (first run cold); on a real ccmem with two rows 194.7/192.0/198.2 ms.
Task 7: complete (commits 1520995..b59aa58, review clean; the controller's Task 6 ruling line riding in that commit was intended)
Task 6: fix round 1: stale list/search/item answers dropped (two request counters), loading label no longer reads a ref, repository selector criterion; memoryView 12 tests, web 361/361, each of four mutations seen red
