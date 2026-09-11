# Task P — make the correction clock injectable, and give the panel the ONE row constructor

Repo: /Users/biran/code/skills/loop/Orca (branch `main`, commit locally, NEVER push, never create branches/worktrees).
Read `CLAUDE.md` first (Rules 3, 9, 12, 14, 15, 17 bind this task).

## Why this task exists

E3 spec `docs/superpowers/specs/2026-09-09-panel-design.md` §2.3 requires ONE correction construction point shared by the CLI and the
future web panel, and a criterion "panel and CLI produce the same correction id for the same input". Today that criterion cannot pass:
`at` is the sixth entry of `CORRECTION_FIELDS` (hashed into the id), and `src/corrections/correct.ts` stamps `new Date().toISOString()`
inside its PRIVATE `correctionRowFrom`. The human authorised by name on 2026-09-10: change `correct.ts` + `record.ts` so the row
constructor is shared and `at` is injectable **as a function parameter**. **No `--at` CLI flag.**

## Exact interface (decided; do not redesign)

In `src/corrections/record.ts`:

```ts
export type NewCorrectionInput = Omit<CorrectionRow, "at">;
export function correctionRowFrom(input: NewCorrectionInput, now: () => Date): CorrectionRow
```

- It is the one and only CorrectionRow literal for NEW corrections in `src/`. Same key order as today's literal in correct.ts
  (`projectKey, decisionId, kind, chose_instead, because, at, by`), `at: now().toISOString()`. `now` is REQUIRED (no default here —
  the entry point owns the clock).
- `recordNewCorrection(dir, row, opts)` keeps its current signature and behaviour. Do not change it.

In `src/corrections/correct.ts`:

```ts
export async function correct(argv: string[], opts: { now?: () => Date } = {}): Promise<number>
```

- `const now = opts.now ?? (() => new Date());`
- Remove the private `correctionRowFrom`; both the `record` and `close-new` branches call the imported `correctionRowFrom(…, now)`.
  Mapping `parsed` (camelCase `choseInstead`) to `NewCorrectionInput` happens in ONE place in correct.ts used by both branches.
- ⚠️ Do NOT touch the separate `const at = new Date().toISOString()` used for the ledger rows in the close path (criterion E16 in
  `tests/corrections/close.test.ts` pins that those are fresh and distinct from the correction's own `at`). Out of scope.
- `projectKey` is NOT made injectable (it is already a caller-computed parameter). `src/cli.ts` keeps calling `correct(args)`.
- Do not touch `fields.ts`, `store.ts`, `schema.ts`, `args.ts`, `src/ledger/**`, `src/scheduler/**`.

## Comments (published text — the ERRATUM rule)

Everything already committed is published. When a comment becomes false, keep the original words and append a named block at the END
of that comment block: `*** ERRATUM (2026-09-10, human authorisation to inject the correction clock) *** …` — no git refs like HEAD,
no counts that a later ruling could falsify.

- The doc comment of the private `correctionRowFrom` in correct.ts moves with the function to record.ts **verbatim**, then gets an
  ERRATUM saying it now lives in record.ts, is exported, and takes the clock as a parameter.
- `tests/corrections/recordSeam.test.ts` (around its second `describe`) says `at` "is stamped from the wall clock and cannot be
  injected" -> append an ERRATUM there. Do NOT change any assertion in that file.
- Run `/usr/bin/grep -rn "inject" src/corrections tests/corrections > <file> 2>&1` and read the file whole; any other comment made false
  by this change gets the same treatment. List every hit and your disposition in the report.

## Criteria — new file `tests/corrections/injectableClock.test.ts` (additive; no existing criterion edited)

Use the existing harness (`tests/corrections/harness.ts`: `withCorrectionsDir`, `makeTargetRepo`, `closeArgs`, `captureStreams`) so every
write goes to an `ORCA_CORRECTIONS_DIR` temp dir (Rule 17: a criterion that writes the real `~/.orca` is unacceptable).
Check how `src/cli.ts` calls `correct(args)` (what `args` contains) and call `correct` directly the same way, passing `{ now }`.
Fixed instant: `const INSTANT = "2026-09-01T12:34:56.000Z"`.

1. **`correctionRowFrom` stamps `at` from the injected clock** — every expected value is a literal written in the test (never computed
   by the function under test): `at` equals `INSTANT`, and the other six fields equal the input literals.
2. **record mode through `correct(argv, { now })` stores `at === INSTANT`** (read back with `readCorrections(dir)`).
3. **close mode through `correct(argv, { now })` stores `at === INSTANT`** (use `closeArgs`).
4. **the same input with the same injected clock yields the same stored id** — two runs of record mode, each with its own fresh
   corrections dir and its own fresh target repo (same remote -> same projectKey). Assert both ids equal, AND equal a golden literal
   (`c_` + 16 hex) that you paste into the test after observing it once. The golden is what Task 7 (panel) will assert against, so the
   comment must say that. Do NOT compute the expected id with `deriveCorrectionId` in the test.

Put a short comment on each `it` saying WHY it matters (Rule 9: tests encode intent).

## TDD order (Rule 9: a criterion is not a criterion until seen red)

1. First make the no-op enabling edit: export `correctionRowFrom(input, now)` that IGNORES `now` (still `new Date()`), and give
   `correct` the `opts` parameter that it IGNORES. Write the four criteria. Run
   `./node_modules/.bin/vitest run tests/corrections/injectableClock.test.ts > <file> 2>&1; echo "RC=$?" >> <file>` and read the file
   whole. All four must be red ON THE `at` / id ASSERTIONS (not compile or setup errors). Paste the relevant failure lines in the report.
   (For criterion 4, before the golden exists, the "both ids equal" assertion is the one that must be red.)
2. Implement for real. Re-run -> green. Then run `./node_modules/.bin/vitest run tests/corrections > <file> 2>&1` -> green, read whole.
3. `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>` -> VERIFY_RC=0; read the file whole; report the whole-repo
   `Test Files`/`Tests` lines AND the verify:scheduler lines separately (two different numbers — do not mix them).
4. `ls ~/.orca` must still be "No such file or directory" at the end. Report it.

Never filter a verifying run with grep/tail/head/sed or a pipe (Rule 14). Use raw `git` (not rtk) for git checks.
Local `rm`/`cp` are aliased to `-i`: use `/bin/rm`.

## Ledger row (write it with the real writer, never by hand)

After the code is green, append decision `orca-dev-6354277a/1` from `.superpowers/sdd/2026-09-10-panel-e3/task-P-decision.json`
with a throwaway script in `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6354277a-65a9-4350-bd38-f099d586198e/scratchpad/`
(NOT in the repo), e.g.:

```ts
import { readFile } from "node:fs/promises";
import { appendEvent } from "/Users/biran/code/skills/loop/Orca/src/ledger/writer.ts";
const d = JSON.parse(await readFile("/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-P-decision.json", "utf8"));
await appendEvent("/Users/biran/code/skills/loop/Orca/.decisions", "orca-dev-6354277a",
  { ev: "decision", id: "orca-dev-6354277a/1", at: new Date().toISOString(), run: "orca-dev-6354277a", ...d });
```

Run it once with `npx tsx`, then `npm run ledger -- validate .decisions > <file> 2>&1; echo "RC=$?" >> <file>` and read whole
(exit 0 or 2 is what verify accepts; report which and every line mentioning `orca-dev-6354277a`).

## Commit

One commit. Stage files by explicit path (the two src files, the new test file, recordSeam.test.ts, `.decisions/orca-dev-6354277a.jsonl`).
Subject EXACTLY: `feat(corrections): make the correction clock injectable and give the panel the one row constructor`
(the ledger row's `undo.how` greps for "make the correction clock injectable"). English body: why (spec §2.3, human authorisation
2026-09-10, no --at flag), what, and the red-then-green evidence in one or two sentences. End the message with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017wXReUvdTXTRSQqnKYSBdY
```

After committing: `git status --porcelain -z > <file>; wc -c <file>` must be 0 bytes. Report it.

## Not yours

Do not dispatch subagents or reviewers. Do not run mutations beyond step 1 of the TDD order — an independent verifier will.
Do not edit the plan, the spec, the handoff, or `.superpowers/sdd/**/progress.md`.
