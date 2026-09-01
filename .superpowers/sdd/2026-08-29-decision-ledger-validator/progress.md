# SDD ledger — plan: docs/superpowers/plans/2026-08-29-decision-ledger-validator.md

Controller run: orca-dev-cd28ef61 (session cd28ef61). Started 2026-09-01.
Spec: docs/superpowers/specs/2026-08-29-decision-ledger-design.md (read in full).
Base at start: `a5a19b8` (subject `docs(handoff): 记下三条语言约定与本轮开工核对`), remote main == local main at session open.

## Pre-flight conflict scan

### A. Pairs sharing a file or an interface

| pair | producer → consumer | checked | finding |
|---|---|---|---|
| T1 → T2,T3,T5,T6,T7 | `.decisions/orca-dev-09cc3ea1.jsonl` (T1 writes 8 lines; T2 +2, T3 +1, T5 +1, T6 +1, T7 +1 = 14) | counted the `bound` lines against the 7-decision table | consistent: 7 decisions, 7 bounds, T4 appends none (its decision `/2` binds in T5) |
| T1 → T8 | `package.json` (T1 creates scripts test/typecheck/ledger; T8 adds verify/hooks:install) | T1 devDeps include `tsx` ^4.19.2, which `ledger`/`verify` need | consistent |
| T2 → T3,T4,T7 | `validateLine(raw: string): ValidationResult` | all three call sites pass a **string**, not an object | consistent |
| T2 → T3 | T3 modifies `validateLine.ts` + `validateLine.test.ts` created by T2 | strictly sequential, no parallel edit | consistent |
| T4 → T6 | `validateFile(lines: string[]): FileVerdict` ← T6 passes `text.split("\n")` | signature match | consistent |
| T5 → T6, T8 | `checkAppendOnly(diffText: string)` ← T6 CLI, T8 pre-commit via stdin | T8 hook feeds a temp file, not a pipe (avoids swallowing git's exit code) | consistent |
| T6 → T8 | `main(argv, stdinText?)`; hook goes through the real process + stdin | M6-c pins that the return value reaches `process.exitCode` | consistent |
| T1 → T7 | T7 replays the hand-written ledger through `appendEvent` and compares bytes | `JSON.parse` → `JSON.stringify` round-trip preserves key order (no integer-like keys); plan's lines are compact, raw-UTF-8, same escaping as `JSON.stringify` | consistent |
| T1 → T8 | `npm run verify` runs `validate .decisions`, which must be green on the real ledger | **ran the check mechanically** — see B | consistent |

### B. Mechanical pre-flight check (not eyeballed)

Transcribed Task 3's predicate + checks 1/2/4/5 into a throwaway script and ran it over the ledger
lines the plan writes verbatim. Command:
`node <scratchpad>/preflight.mjs <scratchpad>/ledger-draft.jsonl` (grep of `^{"ev":` over the plan file).

Result: **all 7 real decisions OK** (11 required fields present, `alternatives` non-empty with
`option`+`why_not`, `kind`/`scope` in whitelist, `undo.how` executable), **all 7 `bound` lines
reference an existing decision id**. Only the deliberate test fixtures (`fx/2`, `fx/3`, `bad/1`)
came back downgraded/rejected — which is what they exist for.

Notable: `/1` is the only decision matching the **command** clause; the other six pass via the
**named-target** clause. So M3-a (kill the command clause) will NOT be caught by the repo's own
ledger — it is caught only by the dedicated `npm test -- --run` assertion. That assertion is
load-bearing; it must not be dropped.

`wc -l CLAUDE.md` = **135** — matches the number Task 8 Step 4 expects verbatim.

### C. Each task against itself

| task | its tests vs its code | files created vs files later touched | finding |
|---|---|---|---|
| T1 | smoke test asserts `1+1===3` first (deliberate red), then flipped green | creates the 3 skeleton files T8 later extends | consistent — the red is the point (proves vitest matched the include glob) |
| T2 | 3 named mutations M2-a/b/c, each names the assertion it must redden | `.strict()` on decisions vs `.passthrough()` on reference events — two schemas, not a contradiction | consistent |
| T3 | M3-a/M3-b are the exclusive-coverage pair the plan's own drafting found | modifies T2's files | consistent |
| T4 | M4-a/b/c | creates only validateFile + its test | consistent |
| T5 | M5-a/b/c pin the hunk gate | — | consistent |
| T6 | M6-c pins process exit code, not just `main()`'s return | fixtures under `tests/fixtures/ledger/` | consistent |
| T7 | M7-a/b/c; fail-closed order pinned by M7-c | — | consistent |
| T8 | proves the gate reds before it greens | drops `.decisions/orca-tmp-bad.jsonl` in Step 1, removes it in Step 4 | **flagged**: that file must never be `git add`ed — carried into the T8 dispatch |

Total named mutations: **18** (3 × T2..T7). Matches the plan's claim.

### D. Plan vs. review rubric

No task mandates a test that asserts nothing, and none mandates verbatim duplication of a logic
block. The 18 mutations are process, not code. Nothing to reconcile.

## Rulings

Ruling 1: work on `main` with local commits, no branch and no worktree — the plan's Global
Constraints mandate it, CLAUDE.md Rule 15 gates branch/worktree deletion behind separate human
approval, and this repo's sibling (ccloop) has the same precedent. Cost if wrong: the work sits on
local `main` instead of a branch; recoverable with `git branch` + `git reset --hard <base>` since
nothing is pushed.

Ruling 2: all code artifacts are written in **English** — comments, error strings, and `it(...)`
descriptions — even though the plan's code blocks carry Chinese ones. The user's standing
instruction (2026-09-01) puts code, comments, CLI help and README in English, and a user
instruction outranks plan text. Logic, assertions and the mutation tables are unchanged. To keep
the 18 mutation proofs checkable, every implementer must report the Chinese-plan-name →
English-test-name mapping for the assertions its mutation table names. Cost if wrong: cosmetic,
fixable by a mechanical rename.

Ruling 3: the ledger file keeps the previous session's run-id `orca-dev-09cc3ea1` verbatim, because
those 7 decisions really were made by that run and attribution is the point (spec §6). Decisions
made by THIS run go to `.decisions/orca-dev-cd28ef61.jsonl` instead — written after Task 8 using
the writer Task 7 builds, which is a stronger dogfood proof than hand-writing them. Cost if wrong:
one extra file and one extra commit, revertible.

Ruling 4: the plan's Global Constraints name remote main as `b6d2253`; it is now further ahead.
The stale SHA does not weaken the constraint it supports (the spec is published text ⇒ append a
named ERRATUM, never edit in place). Proceeding on the substance, not the number. Cost if wrong:
none — the constraint only ever tightens behaviour.

Ruling 2 addendum: **commit messages stay verbatim as the plan writes them** (Chinese). They are
process record, the repo's history already mixes both, and the plan specifies them word for word.
Each implementer appends the standard `Co-Authored-By` / `Claude-Session` trailers. Cost if wrong:
cosmetic, and history is not rewritten to fix it.

Ruling 5: the 8 ledger lines are **data, not code** — Ruling 2 does not touch them. They stay
byte-identical to the plan, Chinese and all, because Task 7 compares them byte for byte and the
plan is published text. Implementers extract them mechanically (`grep '^{"ev":' <brief>`, verified
to yield exactly 8 lines) rather than retyping them. Cost if wrong: Task 7's reproduction test
fails and the dogfood closure is lost.

Task 1: dispatched (model sonnet), BASE a5a19b8
Task 1: implementer DONE — commit e9dae43, 8-line ledger, smoke test seen red then green; task review dispatched (sonnet), diff a5a19b8..e9dae43.

Controller observation on Task 1 (to adjudicate after the review returns):
`package-lock.json` was produced by `npm install` and left **untracked** (`git status` shows `?? package-lock.json`).
The brief's `git add` list does not name it, so the implementer was following the brief. But measured:
`git ls-files | grep package-lock.json` in ccloop returns 1 — **ccloop tracks its lockfile**, and CLAUDE.md
Rule 11 makes conformance to the sibling repo binding. Without it the pinned versions (zod ^3.23.8,
vitest ^2.0.5) are only ranges, so `npm ci` is impossible and a later install can drift the stack this
very task exists to pin.

Task 1: review clean (Spec ✅, Approved, 0 Critical / 0 Important).
Task 1: ⚠️ item resolved by controller — `git log -1 --format=%B e9dae43` matches the brief's Step 6
message verbatim, plus the two standard trailers. Not a gap.
Task 1: minor (deferred): `package-lock.json` left untracked. Measured: ccloop DOES track its lockfile
(`git ls-files` returns it), and CLAUDE.md Rule 11 makes sibling conformance binding; without it the
pinned ranges (zod ^3.23.8, vitest ^2.0.5) cannot be reproduced by `npm ci`. Ruling: commit it in
Task 8, which already modifies `package.json` — not worth disturbing the Task 2-7 diffs for.
Task 1: minor (deferred): `package.json` has no `engines` field though the stack requires Node >= 20.
Inherited from the plan's own code block, not an implementer deviation. Final review triages.
Task 1: complete (commits a5a19b8..e9dae43, review clean)

Ruling 6: mutations are run in a `git clone --local` copy, never in the main working tree.
CLAUDE.md Rule 15 states this outright, and the plan's Step 5 does it in the main tree. Two independent
reasons, the second one load-bearing:
  (a) Rule 15 is the repo's binding rule; the plan is an argument made under it.
  (b) **The plan's restore command is broken.** Probed mechanically in a throwaway repo:
      `git checkout -- <a new, still-untracked file>` returns `error: pathspec ... did not match any
      file(s) known to git`, exit=1, and restores nothing. At Step 5 the mutated file is created by
      that same task and not yet committed, so Tasks 2, 4, 5, 6 and 7 would all fail there loudly —
      and **Task 3 is worse**: it mutates `validateLine.ts`, which Task 2 committed, so
      `git checkout --` succeeds and *silently discards Task 3's own Step 3 implementation*.
Cost if wrong: mutation runs cost a local clone plus a symlinked `node_modules` each. The mutation
evidence itself is unchanged — same edits, same named assertions, same seen-red requirement.

Task 2: dispatched (model sonnet), BASE e9dae43
Task 2: implementer DONE — commit 3c31320, 34/34 passing, all three mutations reported seen red in a
clone, main-tree fingerprint identical before/after, clone deleted. Controller verified independently:
ledger is now 10 lines, its first 8 diff clean against e9dae43's version (exit=0), and no
`mutant-task-2` directory survives. Task review dispatched (sonnet), diff e9dae43..3c31320.

Task 2: review returned Spec ❌ / Needs fixes — 1 Important, 2 Minor.

Ruling 7 (the Important finding — CONFIRMED by the controller, not taken on the reviewer's word):
`decisionEventSchema` is `.strict()` over exactly the 11 fields spec §3.8 check 1 names, and the real
ledger's `decision` records all carry a 12th key, `evidence`. Measured by running the built validator
over the repo's own ledger (`npx tsx` harness, output read back whole):
**7 of 10 lines came back `{"verdict":"rejected","reasons":["<root>: Unrecognized key(s) in object: 'evidence'"]}`** —
i.e. every real decision in Orca's own ledger. Key inventory over the same file shows `evidence` is the
**only** offending key (nested `undo` = how/cost/blast_radius, alternatives = option/why_not, reference
events = ev/id/note, all already accounted for), and every `evidence` element is a string.

Why it is load-bearing rather than cosmetic: Task 7's `appendEvent` fail-closes on any non-`ok` verdict,
so its byte-reproduction test would throw on line 1; and Task 8's `npm run verify` runs
`validate .decisions`, so the gate this whole plan exists to build could never go green.

The conflict is inside the spec, not invented by the reviewer: §3.8 check 1 enumerates the **required**
fields and never says "and no others"; §3.4's canonical `decision` example carries `evidence`; §3.5.1
makes `evidence` the thing by which a decision's trustworthiness is judged ("看 evidence 空不空").
⇒ `evidence` is a legitimate, non-required field. Resolution: add
`evidence: z.array(z.string()).optional()`. `.strict()` stays — rejecting `confidence` is the point of
§3.5.1 and that assertion must stay green.

Added to the fix, because its absence is what let this through: a regression test that runs
`validateLine` over the repo's **own** `.decisions/orca-dev-09cc3ea1.jsonl` and asserts every line is
`ok`. That moves the dogfood loop from Task 8 back to Task 2, where it bites six tasks earlier.
Cost if wrong: `evidence` becomes writable without being checked for content. Spec asks for no content
check on it, so the exposure is bounded.

Task 2: minor (deferred): `REFERENCE_EVENT_TYPES` exported from schema.ts but unused; the same three
literals are inlined at schema.ts:77 and validateLine.ts:157. Drift risk only.
Task 2: minor (deferred): check 2 has tests for missing/empty `why_not` but not the symmetric `option`
cases. Same schema mechanism, so low risk.
Task 2: fix round 1/5 (2 addressed per implementer, 0 open — evidence field + real-ledger regression
test; commits 3c31320..00ccd07). Controller re-ran the validator over the real ledger independently:
**TOTAL=10 NOT_OK=0**, was 7. Scoped re-review dispatched (sonnet) over 3c31320..00ccd07.
Task 2: re-review — both findings ADDRESSED, no new breakage, no out-of-scope observations.
Task 2: complete (commits e9dae43..00ccd07, review clean after 1 fix round)

Task 3: dispatched (model sonnet), BASE 00ccd07
Task 3: implementer DONE — commit 6c7be59, 49/49 passing, M3-a/b/c reported seen red in a clone.
Controller verified independently: ledger now 11 lines with lines 1-10 diffing clean against 00ccd07
(exit=0), and `validateLine` over the real ledger gives TOTAL=11 NOT_OK=0 — check 3 did not downgrade
any real record, as the pre-flight predicted.

Correction to a process note in the Task 3 report: it claims `git diff | wc -c` returned inconsistent
byte counts across consecutive no-op invocations and calls it a pipe-filtering artifact. **That does not
reproduce.** Measured just now on a clean tree: five consecutive redirected runs and five consecutive
piped runs, all ten returned 0. The likely explanation is that the implementer sampled while its own
edits were in flight, not a tooling defect. Recording it so the claim does not travel forward as fact —
the substantive proof (tree clean, diff empty) holds either way.
Task 3: review clean (Spec ✅, Approved, 0 Critical / 0 Important). The reviewer hand-traced both
exclusivity assertions and confirmed each is satisfiable by only its own clause — the exact dead-code
risk this task carried.
Task 3: both ⚠️ items resolved by the controller — `"naming"` is genuinely absent from `DECISION_KINDS`
(src/ledger/types.ts), so that assertion does bite; and no `mutant-*` directory survives while
`git worktree list` shows the main tree only, so the clone-based mutation runs left nothing behind.
Task 3: minor (deferred): `isArgShaped`'s `=`, `*` and FILE_NAME sub-branches have no assertion that
only they can satisfy — deleting one would go unnoticed. Not required by the brief.
Task 3: complete (commits 00ccd07..6c7be59, review clean)

Task 4: dispatched (model sonnet), BASE 6c7be59
Task 4: implementer DONE — commit fe64513, 59/59 passing, M4-a/b/c reported seen red in a clone.
Controller verified independently: ledger still 11 lines and `git diff 6c7be59 HEAD -- .decisions` is
empty, so this task appended nothing as required; no `mutant-*` directory survives. Task review
dispatched (sonnet) over 6c7be59..fe64513, with the reviewer asked to confirm M4-b's *named* assertion
is among its failures rather than only the three collateral ones the implementer reported.
Task 4: review clean (Spec ✅, Approved, 0 Critical / 0 Important). Reviewer confirmed M4-b's *named*
assertion is itself among the failures, not just the collateral three.
Task 4: minor (deferred): validateFile re-parses each line and guards `typeof parsed.id !== "string"`,
both unreachable given validateLine already rejects those cases — an untestable branch plus duplicated
JSON.parse work per line.
Task 4: minor (deferred): the reference-event literal list now exists in THREE places —
`REFERENCE_EVENT_TYPES` (schema.ts, exported but unused), inlined in schema.ts, and `REFERENCE_EVENTS`
in validateFile.ts. This is the second review to report the same drift; the final whole-branch review
should consolidate it rather than treat it as a nit.
Task 4: minor (deferred): a malformed `decision` line still contributes its id to the set that backs a
reference. No behavioural impact (the malformed line already forces `rejected`), but untested.
Task 4: complete (commits 6c7be59..fe64513, review clean)

Task 5: dispatched (model sonnet), BASE fe64513
Task 5: implementer DONE — commit c0e1799, 67/67 passing, M5-a/b/c reported seen red in a clone.
Controller verified independently: ledger now 12 lines with its first 11 diffing clean against fe64513
(exit=0), `validateLine` over the real ledger gives TOTAL=12 NOT_OK=0, no `mutant-*` directory survives.
Task review dispatched (sonnet) over fe64513..c0e1799, with the reviewer additionally asked to give the
diff parser a hostile read (a `---`/`+++` pair inside a hunk body, `\ No newline at end of file`, a
rename header with no `@@`, the empty string).
Task 5: review clean (Spec ✅, Approved, 0 Critical / 0 Important). The reviewer re-derived all three
mutations by hand rather than trusting the transcript, and confirmed M5-c is the sole failure of the
"deleted line whose content starts with --" assertion — the precise subtlety this check exists for.
Its hostile read of the parser found no defect: rename-only diffs never enter a hunk, `\ No newline`
lines are inert, the empty string returns ok, and mixed rename+modify diffs are handled.
Task 5: minor (deferred): `appendOnly.ts` hardcodes `.decisions/**` into its reason string though the
function is a generic diff parser; and the mirror case (an *added* line whose content looks like a
header) is untested.
Task 5: complete (commits fe64513..c0e1799, review clean)

Task 6: dispatched (model sonnet), BASE c0e1799
Task 6: implementer DONE — commit 0cc160b, 78/78 passing, M6-a/b/c reported seen red in a clone, with
M6-c's failure confirmed to be the exit-code assertion rather than a module/path resolution error.
Controller measured the real process exit codes directly rather than trusting the report:
`validate tests/fixtures/ledger/ok.jsonl` → **0**, `downgraded.jsonl` → **2**, `rejected.jsonl` → **1**,
`validate .decisions` (the real ledger) → **0**. Ledger is 13 lines with its first 12 diffing clean
against c0e1799 (exit=0); none of the brief's three JSON fixtures leaked into `.decisions/`; no
`mutant-*` directory survives. Task review dispatched (sonnet) over c0e1799..0cc160b, asked specifically
to judge whether the real-process assertion would still catch a broken exit-code wiring, and to check
the CLI's error paths (missing path, unknown subcommand, no args, empty stdin).
Task 6: review clean (Spec ✅, Approved, 0 Critical / 0 Important).
Task 6: ⚠️ item resolved by controller — `printf '' | npx tsx src/cli.ts check-append-only` prints
`ok: append-only` and exits **0**. Correct: an empty diff contains no deleted line. Not a gap.

Ruling 8 — a real weakness in MY OWN mutation procedure, found by the Task 6 reviewer and confirmed:
**`git diff` is blind to an untracked file's content.** Probed in a throwaway repo: create an untracked
file, `git diff | wc -c` = 0; overwrite its contents entirely, `git diff | wc -c` = 0 still, and
`git status --porcelain` shows the same `??` line both times. Every task's newly created source file is
untracked at mutation time, so the "main tree untouched" fingerprint I handed to Tasks 2, 4, 5 and 6
proved nothing about exactly the files most at risk. The safety actually came from the mutation
commands only ever writing under `$MUT`.
Retroactive check, which is conclusive: the full suite on the committed tree is **78/78 passing,
typecheck exit=0**, and the real CLI still returns 0/2/1 on its three fixtures. A leaked mutation would
have been committed and would show as red. **Nothing leaked.**
Forward fix: Task 7's dispatch replaces the fingerprint with a `shasum` of each participating main-tree
file taken before and after, which does see untracked content.
Cost if wrong: none now — the retroactive check closes Tasks 2-6; the change only strengthens Task 7.

Pre-flight for Task 7, measured before dispatch so the task does not discover it the hard way: feeding
every line of the real ledger through `JSON.parse` → `JSON.stringify` reproduces the file **byte for
byte** (10997 bytes both ways). Task 7's reproduction test therefore rests on a premise that holds.

Task 6: complete (commits c0e1799..0cc160b, review clean)
Task 6: minor (deferred): no `.catch()` on the `main(...)` invocation and no try/catch around
`readFile` in the validate loop — a TOCTOU removal or permission error would surface as an unhandled
rejection instead of a controlled exit code, in a CLI whose entire job is exit codes.
Task 6: minor (deferred): unknown-subcommand shares the no-argument fallback path and has no named test.

Task 7: dispatched (model sonnet), BASE 0cc160b
Task 7: implementer DONE — commit 2141c90, 89/89 passing, M7-a/b/c reported seen red in a clone with
checksum-based main-tree proof. **The dogfood closure is confirmed by the controller independently, not
from the report**: feeding every line of `.decisions/orca-dev-09cc3ea1.jsonl` through the committed
`appendEvent` into a temp dir reproduces the file byte-for-byte — **11172 bytes both ways, identical**.
Ledger is 14 lines with its first 13 diffing clean against 0cc160b; no `mutant-*` directory survives.
Task review dispatched (sonnet) over 0cc160b..2141c90, asked to give the run-id character-set check a
hostile read (`..`, `a\b`, absolute paths, NUL/newline, Unicode normalisation) and to judge whether the
implementer's re-expression of M7-c proves the same property as the brief's wording.
Task 7: review clean (Spec ✅, Approved, 0 Critical / 0 Important). The reviewer hand-walked the run-id
regex against `..`, `../escape`, `a/b`, `a\b`, absolute paths, dot-only names, embedded NUL and newline
(noting JS `$` has no trailing-newline exception, unlike Python), and Unicode normalisation — all
rejected, and nothing that passes can contain a separator, so `join()` only ever receives one segment.
It also accepted the implementer's re-expression of M7-c as faithful, with the right reasoning: moving
only `appendFile` would have failed on ENOENT from the not-yet-created directory, which would prove
nothing about ordering.
Task 7: minor (deferred): the run-id regex has no length cap, so an absurdly long id fails later at the
OS level rather than cleanly at validation.
Task 7: minor (deferred): `JSON.stringify(undefined)` returns `undefined`, not a string, so an
`appendEvent(dir, id, undefined)` call would hand `validateLine` a non-string despite its typed
signature. Untested.
Task 7: minor (deferred): `appendFile` calls are not serialised per run file; safe for the awaited,
single-writer usage the spec assumes, and inherited verbatim from the plan's own reference code.
Task 7: complete (commits 0cc160b..2141c90, review clean)

Ruling 9: Task 8's Step 8 (update `docs/handoff/handoff.md`) is **removed from the implementer's scope
and done by the controller instead**. The handoff has to record the whole session — the nine rulings,
the two structural findings, the corrections — none of which a task-scoped implementer can see, and it
is a multi-agent shared document where a partial write is worse than none. Cost if wrong: none; the
content is the controller's either way.

Ruling 10: Task 8 also commits `package-lock.json`, closing the minor deferred from Task 1. Task 8
already modifies `package.json`, so it is the one place this belongs, and ccloop — the sibling repo
CLAUDE.md Rule 11 makes binding — tracks its own lockfile. Without it the pinned ranges cannot be
reproduced by `npm ci`. Cost if wrong: a large file enters the repo; removable with one `git rm --cached`.

Task 8: dispatched (model sonnet), BASE 2141c90
Task 8: implementer DONE — commit 2eb4249. Controller verified the deliverable directly rather than
from the report: `npm run verify` on HEAD **exits 0** and prints both expected lines
(`ok: 1 ledger file(s)` and `ok: CLAUDE.md is 135/200 lines`); 89/89 tests, typecheck clean; working
tree clean with `package-lock.json` now tracked; `core.hooksPath=scripts/githooks` and the hook is
executable; `.decisions/` holds only the one real ledger, `orca-tmp-bad.jsonl` is gone.

Controller ran its OWN pre-commit proof in a `git clone --local` copy, all three branches:
  A. edit an existing ledger line in place  -> **BLOCKED**, commit exit=1, HEAD unmoved, reason names
     the exact deleted line.
  B. append one new line only               -> **ALLOWED**, exit=0, prints `ok: append-only` + `ok: 1 ledger file(s)`.
  C. commit touching no `.decisions` file   -> **ALLOWED**, ledger checks skipped, only the line-budget
     check ran. This also settles the open question about the hook's
     `git diff --cached --name-only -- .decisions | read -r _` construct: both branches behave correctly.
Main-tree checksum identical before and after; `git status --porcelain` empty.

Note on the controller's first attempt at branch B: it was also blocked, and that was a bug in the
*probe*, not the gate. After branch A failed, the bad content was still staged, and
`git checkout -- <path>` restores from the **index**, not from HEAD — so it wrote the corrupted content
straight back. Re-run from a fresh clone gave the clean result above. Recording it because it is the
same shape as Ruling 6: `git checkout --` does not mean what it looks like it means.

Task 8 review dispatched (sonnet) over 2141c90..2eb4249.
Task 8: review — Spec ✅, Approved, but **1 Important labeled plan-mandated** plus 4 Minor.
Task 8: both ⚠️ items resolved by the controller in a clone, main tree untouched (checksum diff exit=0):
  D. `git rm` the entire ledger file -> **BLOCKED**, exit=1, every removed record named in the reason.
  E. two ledger files staged at once (one appended, one brand new) -> **ALLOWED**, exit=0, `ok: 2 ledger file(s)`.
So multi-file and whole-file-deletion both behave correctly. Not gaps.

Ruling 11 (the Important finding — accepted, not dismissed despite being plan-mandated):
the hook's `if git diff --cached --name-only -- .decisions | read -r _; then` is a pipeline used as an
`if` condition, which POSIX exempts from `set -e`. It therefore cannot distinguish "nothing under
.decisions changed" from "the diff computation itself failed" — in the second case the body is skipped
and **the commit is allowed with the append-only and schema checks never run**. That is the one
direction a gate must never fail. spec §1's governing principle is "what can be made impossible should
not be left to self-discipline", and this task exists precisely to make the append-only rule mechanical;
a construct that silently degrades to no enforcement contradicts the thing being built. The plan's
authorship does not settle it — the fix is one line and strictly better: branch on
`git diff --cached --quiet -- .decisions` (0 = no changes, 1 = changes, >1 = git failed), treating
anything that is not a clean "no changes" as "run the checks".
Cost if wrong: the hook runs the ledger checks on a few commits that did not need them — a small,
visible waste, in the safe direction.

Task 8: the four Minor findings (temp-file leak on a blocked commit, `wc -l` divergence when a file
lacks a trailing newline, raw stack trace when CLAUDE.md is missing, `verify` running its cheapest check
last) stay OUT of this fix round per the loop's rules and are carried to the final whole-branch review.
Task 8: fix round 1/5 (1 addressed, 0 open — the `.decisions`-touched test now branches on
`git diff --cached --quiet`'s own exit status with the default set to "run the checks";
commits 2eb4249..f7af633).
Controller verified the fail-open path independently rather than from the report: in a clone, with a
stub `git` that returns **129** for `diff --cached --quiet` and delegates everything else to the real
git, the **real hook script** with an empty index printed `ok: append-only` and `ok: 1 ledger file(s)` —
it took the run-the-checks branch. The control run with the real git and an empty index printed only the
CLAUDE.md line. The difference between those two outputs is the proof. Main-tree checksum identical.
`npm run verify` still exits 0 on HEAD.
Also worth keeping: the implementer found that a stub `git` cannot be injected through a real
`git commit`, because git prepends its own exec directory to `PATH` for hooks. Driving the hook script
directly is the way to test that path.
Scoped re-review dispatched (sonnet) over 2eb4249..f7af633.
Task 8: re-review — finding ADDRESSED, no new breakage. The re-reviewer traced all four git exit codes
(0, 1, 129, git-missing) through the new construct and confirmed every one lands in a safe branch, and
that the body is byte-identical to the version the first review approved.
Task 8: complete (commits 2141c90..f7af633, review clean after 1 fix round)

ALL EIGHT TASKS COMPLETE. Dispatching the final whole-branch review over 94d18ed..f7af633.

Publication status, measured at the end of the run (not read from any document):
`git ls-remote origin refs/heads/main` returns **3c31320**, whereas it returned 94d18ed at session
open. **The human pushed mid-session**, up to Task 2's first commit. So `a5a19b8` (the handoff section),
`e9dae43` (the skeleton and the ledger's first 8 lines) and `3c31320` (checks 1/2/4) are now published
text; everything from `00ccd07` onward — including the `evidence` fix — is still local only.
This is the exact pattern the handoff warns about, which is why it was re-measured rather than assumed.

Final whole-branch review dispatched (model opus) over 94d18ed..f7af633, 11 commits, with the 16
deferred minors handed over for triage.

FINAL WHOLE-BRANCH REVIEW (opus): 0 Critical, 5 Important, 5 Minor, plus a triage of the 16 deferred
minors. Every Important is cross-task — none falls inside any single task's scope, which is what the
whole-branch vantage was for.

Ruling 12 (final-review finding 1 — ACCEPTED): `appendEvent` validates with `validateLine`, which is
checks 1/2/3/4 only, so **check 5 is absent from the product's own write path**. Measured by the
reviewer: writing `{"ev":"bound","id":"probe/999"}` succeeds, and `validateFile` on that same file then
returns `rejected`. The one class of bad line that append-only makes unrepairable — a reference to an id
that does not exist — is exactly the class the writer does not screen. The agent that makes that typo
cannot fix it the sanctioned way; it must hand-edit the file, which is the mutation this whole system
exists to forbid. Fix: `appendEvent` runs `validateFile([...existing lines, new line])` and throws on
any non-`ok`.
Known, deliberate consequence, recorded rather than discovered later: this **narrows** the writer
relative to the file format. `validateFile` accepts a reference that appears before the decision it
names (spec §3.8 check 5 asks for existence, not order), but a streaming writer cannot see the future,
so writing a `bound` before its `decision` now throws. That narrowing is correct for a writer — you
cannot bind a record you have not written — but it must be pinned by a test, not left implicit.
Pre-measured before dispatch so the fix cannot silently break the dogfood closure: all **14 prefixes**
of the real ledger validate `ok`, so Task 7's byte-for-byte reproduction test still passes.
Cost if wrong: one extra `readFile` per append, and a writer stricter than the file format in a way a
named test makes visible.

Ruling 13 (finding 2 — ACCEPTED): a ledger file whose last byte is not a newline is **permanently
wedged**. Measured by the reviewer: git emits `\ No newline at end of file` plus a `-`/`+` pair for the
unchanged last line, and `check-append-only` reports a non-append change — on a strictly appending
commit, forever. Today's ledger is safe because `writer.ts` always emits the newline, but spec §9.2
requires Orca to work against *any* target repo, where a hand-written ledger is ordinary.
Cost if wrong: the narrow exemption (a `-` line immediately followed by `\ No newline at end of file`
whose content is byte-identical to the next `+` line) could in principle mask one real deletion; the
byte-identity requirement is what keeps that closed, and a mutation must prove it.

Ruling 14 (finding 3 — ACCEPTED, with a stronger fix than the reviewer proposed): `core.hooksPath` is
local git config, not tracked content, so **a fresh clone has no hook** and check 6 is unenforced until
someone remembers `npm run hooks:install`. The reviewer suggested asserting it in `verify`. Asserting is
still self-discipline one step removed; the repo's own principle is to make the failure impossible.
So: add an npm `prepare` script, which npm runs automatically after install, to set `core.hooksPath`
(no-op outside a git repo so it cannot break an install), **and** have `verify` assert it, so a machine
where it somehow did not take says so loudly. Armed by default, and audible when not.
Cost if wrong: `npm install` writes one line of local git config — the same thing husky does, and
reversible with `git config --unset core.hooksPath`.

Ruling 15 (finding 5 — ACCEPTED): `isArgShaped`'s `=`, `*` and FILE_NAME sub-branches can each be
deleted with the suite green. CLAUDE.md Rule 9 states the per-branch mutation requirement in the
imperative, and this branch's whole thesis is that an unredded criterion is not a criterion — three
unredded branches in the predicate implementing the spec's central gate is the wrong thing to ship.
Controller verified the exclusivity of all three candidate inputs by hand against both clauses before
dispatch: `make target=foo` reaches only `=`; `rm *.tmp` reaches only `*`; `node build.mjs` reaches only
FILE_NAME. None is caught by the named-target clause.

Also entering the single fix wave: deferred minor #2 (the reference-event literal list in three places,
which two independent reviews reported and which can silently desynchronise check 5 from check 1), and
final-review minor #6 (`validate` on an empty directory prints `ok: 0 ledger file(s)` and exits 0 — an
"ok" that means "I checked nothing" is this repo's cardinal sin).

Finding 4 is the controller's own debt, not an implementer's: Ruling 3's
`.decisions/orca-dev-cd28ef61.jsonl` and Ruling 9's handoff section. Both are discharged by the
controller after the fix wave.
Also recorded from that finding, worth carrying forward: the seven existing `decision` records share the
identical `at` timestamp `2026-08-29T05:48:37.196Z` — it was backfilled in one batch by the plan, so
`at` in those records is not a measurement of when each decision was made.

Deferred to follow-up work, not fixed here: minors #1, #7, #8, #12, #13 from the deferred list, and
final-review minors #7 (writer does not cross-check the event's `run` against the filename), #8
(duplicate decision ids accepted), #9 (two result vocabularies), #10 (exit code 2 has no consumer yet).
Final fix wave dispatched (single subagent, model sonnet), FIX_BASE f7af633.
Final fix wave DONE — commit 9486af3, 98/98 tests (was 89/89), typecheck clean.
Controller verified each fix independently rather than from the report:
  `npm run verify` -> exit 0, now printing a third line `ok: core.hooksPath is scripts/githooks`;
  the dogfood reproduction is still byte-identical (11172 both ways);
  `appendEvent(dir,"probe",{ev:"bound",id:"probe/999"})` -> throws
  `refusing to append: rejected: bound references unknown decision id: "probe/999"` **and writes no file
  at all**, so check 5 is now on the write path and still fail-closed;
  `validate <empty dir>` -> **exit 1**, `error: 0 ledger files found — nothing was validated`.
Self-declared residuals from the fixer, to adjudicate after the re-review: `validateLine.ts` holds a
fourth copy of the reference-event list in an OR-chain (out of the stated scope), and `prepare`'s
`|| true` also swallows a genuine git-config failure inside a real repo (deliberate — `verify`'s
assertion is the loud backstop).
Single scoped re-review dispatched (sonnet) over f7af633..9486af3.
Scoped re-review of the fix wave: **all six findings ADDRESSED**, no Critical — but it found genuine new
breakage at the intersection of Fix 1 and Fix 2, and the controller reproduced it exactly rather than
taking it on trust:

Ruling 16 (ACCEPTED, and fixed now rather than deferred — the human's standing instruction this session
is to act on the controller's own recommendation and report at the end):
`appendEvent` writes `line + "\n"` unconditionally. Against a ledger whose last byte is **not** a
newline — the shape Fix 2 itself establishes as ordinary for a hand-written or externally-trimmed
ledger — the new record is glued onto the previous one. Measured: seeded a file with one real decision
record and no trailing newline (898 bytes), called `appendEvent`, and it **reported success**; the file
then held **one** physical line, and `validateFile` over the actual bytes returned `rejected` —
`not valid JSON: Unexpected non-whitespace character after JSON at position 898`.
Since the ledger is append-only, the only repair is hand-editing the file: **the exact failure mode
Fix 1 was written to eliminate, reached through a different door.**
The second half matters as much: the new check-5 step validates `[...existingText.split("\n"), line]`,
which models a separator that will not be written. It can therefore return `ok` for contents that are
corrupt the instant they land. A guarantee describing bytes other than the ones written is not a
guarantee.
Fix: prepend a separating newline when the existing text is non-empty and does not end in one, so the
bytes written are exactly the lines that were validated in all three cases (absent/empty, newline-
terminated, not newline-terminated). Pinned by a test that seeds a non-newline-terminated file directly
with `writeFile`, appends, and asserts on the bytes **read back from disk** — two parseable lines and
`validateFile` `ok` — plus one named mutation deleting the separator logic.
Cost if wrong: one extra byte on a ledger that was already malformed. The dogfood reproduction test
seeds from an empty directory, so no separator is ever prepended there and its bytes cannot move.

Residuals parked with rulings, not fixed:
- `validateLine.ts` holds a fourth copy of the reference-event list as an OR-chain. Parked: it is a
  routing condition rather than a whitelist, no current behaviour depends on the two staying in sync,
  and the finding names it out of scope. It becomes real only when a fifth event type is added, which
  belongs to subsystem E. Recorded for the follow-up list.
- `prepare`'s `|| true` also swallows a genuine git-config failure inside a real repo. Parked: the
  division of labour is deliberate and sound — `prepare` must never break an install, and
  `npm run verify` asserts the outcome loudly. A silent `prepare` plus a loud `verify` is the right
  shape; making `prepare` fail hard would trade a detectable condition for a broken install.
