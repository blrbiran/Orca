# SDD ledger — plan: docs/superpowers/plans/2026-09-03-p2-scheduler-c.md

Run: `orca-dev-c2fd0c3b` (session c2fd0c3b-0aaf-4a1b-960e-2d6cab3f7ad3), started 2026-09-04.
Controller: subagent-driven-development. Human ruled: SDD execution mode; **no push** in either repo.

## Opening measurements (this session, commands shown)

| Quantity | Value | Command |
|---|---|---|
| Orca remote main | `a0d5e52` | `/usr/bin/git ls-remote origin refs/heads/main` |
| Orca local main | `e60c2a2`, one commit ahead | bare `git log --oneline -8` |
| Orca `npm run verify` | **exit 0**, `7 files / 119 tests`, seven `downgraded to tier 0` lines | `npm run verify > file 2>&1; echo $?` |
| ccloop remote / local | `7caa4cb` / `7f2c5f6`, five ahead, clean | bare git |
| ccloop suite | **exit 0**, `35 files / 624 tests`, 0 skipped, 27.32s | `ECC_GATEGUARD=off DISABLE_OMC=1 npm test -- --run` |
| ccmem | on `main` but **worktree dirty** (v0.14 docs in progress by another line) | bare git |

**Correction to the incoming briefing:** it said neither repo had been pushed. False for Orca —
the human pushed through `a0d5e52`, so all of P1 (five implementation commits, the two spec errata,
three handoff commits) is **published text**: erratum-only from here.

## Hard prerequisites, verified mechanically (not by reading docs)

| Check | Result |
|---|---|
| P1: `bound` without taskId/runId | `{"verdict":"downgraded","tier":0,"reasons":["taskId: Required","runId: Required"]}` |
| P1: `reconcile` kind | `DECISION_KINDS` = dependency,interface,scheduling,abandon,criteria,boundary,**reconcile** |
| P0: ccloop publishes attempt commits | `worktreeManager.ts:53 attemptRefName`, `:75 publishAttemptCommit` |
| `appendEvent` arity | 3 — matches the plan's `appendEvent(dir, runId, event)` |
| `DecisionEvent` type | exported from `src/ledger/schema.ts` — Task 4's signature is satisfiable |

🔴 **Plan defect found while running Task 1 Step 1 verbatim:** the probe as written
(`npx tsx -e 'import{validateLine}from"./src/ledger/validateLine.js"'`) **cannot work** —
`-e` evaluates in an `[eval]` module with no directory, so the relative specifier throws
`MODULE_NOT_FOUND`. Re-run through a real file with absolute specifiers; results above are from that.

## Pre-flight conflict scan

### Cross-task rows (every pair sharing a file or an interface)

| Producer → consumer | What crosses | Finding |
|---|---|---|
| T1 → T5,T6,T7,T8,T10,T12,T14 | `tests/scheduler/sandbox.ts` | 🔴 **F1** scenario criteria call `runCli`, `seedTwoTaskPlan`, `seedIntersectingPlan`, `seedLyingPlan`, `readLedgerOnBranch`, `runChecksOnBranch`, `blameCommitOfLine`, `headOf`, `showFile`, `git` — none has an owning task |
| T1 → T8 | contract shape | 🔴 **F2** `ContractSpec` is never defined in the plan, and a contract the sandbox writes must satisfy ccloop's `.strict()` schema or the first spawn (T8) is where it blows up |
| T2 → T4 | `PlanFile`/`PlanTask` | ✅ consistent |
| T2 ↔ T4 | cycle detection | 🔴 **F3** T2's text says "Task 4 再合并"; Task 4's text never mentions converging the two detectors |
| T2 → T6/T7/T8 | where `base` comes from | ✅ resolved against spec §4.2: base is runtime-derived (W's rolling HEAD), **not** a plan-file field. S19 = the default branch HEAD must be a real commit |
| T3 → T4,T5,T9 | `ClaimedPath`, `PathConflict`, `ConflictKind` | ✅ consistent |
| T4 → T13 | `DecisionEvent` | ✅ exists (measured above) |
| T5 → T6 | `PreflightReport` | 🔴 **F5** T5 consumes a type Task 6 defines — ordering inversion |
| T6 ↔ T14 | S18 / S19 | 🔴 **F6** both tasks claim them |
| T10 → T13 | orchestrator ledger on W | 🔴 **F8** S2 (Task 10) asserts a `scheduling` line on W, but ledger wiring is Task 13 |
| T10/T14 → — | `run` subcommand, `src/scheduler/run.ts` | 🔴 **F9** no task creates them; T10 is the first to invoke `runCli(["run", …])` |
| T12 → T13 | `ledgerWiring.ts` in two halves | ⚠️ **F10** declared by the plan, not a conflict |
| T1 → all | `package.json` verify chain | ✅ sequential, no concurrent edit |

### Intra-task self-consistency

| Task | Finding |
|---|---|
| T1 | third criterion uses `readFile` with no import shown — trivial, implementer adds it |
| T2 | `codes(r)`/`t(id,deps)` helpers written in-file — declared by the plan's placeholder scan ✅ |
| T3 | full code given; `M-TRIE-c` already registered as unobservable ✅ |
| T4 | 🔴 **F4** the generated decision must pass the **real** validator: 11 required fields, `alternatives` ≥ 1, and an `undo.how` that clears `undoHowIsExecutable` — a predicate with known false negatives |
| T7 | 🔴 **F7** "derives the same id from the same contract and base" contradicts S15 ("a fresh id on the second call") unless derivation and allocation are two functions |
| T9 | `Disposition` union matches all four criteria ✅ |
| T13 | `taskLedgerName`/`orchestratorLedgerName` undefined — implementer names them |
| T14 | S11/S12/S13 are skeletons — covered by the plan's stated convention ✅ |

## Rulings made before execution

- **Ruling R1 (F1, F2):** every cross-file test helper lives in `tests/scheduler/sandbox.ts`, added and
  exported by the **first task that needs it**; later tasks import, never re-write. Task 1 builds only the
  seven declared harness entry points plus `ContractSpec`, whose shape it takes from a fresh reading of
  ccloop's `src/contract/schema.ts`. **No fabricated "the contract is valid" criterion at T1** — a
  hand-made fixture asserting itself is exactly the shape that let `.strict()` reject seven real
  decisions while 34 criteria stayed green. The real proof is T8's first spawn; registered as T1's known
  unproven point and named in T8's dispatch. — Cost if wrong: T8 rejects the contract and T1's sandbox
  needs one revision.
- **Ruling R2 (F3):** Task 4 exports `detectCycle(tasks)` and Task 2's standalone DFS is replaced by a
  call to it. The plan's own Task 2 text authorises the convergence; verbatim duplication of a logic
  block is a defect under the review rubric. — Cost if wrong: one small refactor.
- **Ruling R3 (F5):** `renderPlanReport` takes `preflight: { rejections: PlanRejection[] }` structurally;
  Task 6's `PreflightReport` is declared to that same shape, so it stays assignable. The renderer owns the
  list of all nine check names and prints each as pass / fail / not-evaluated from whatever report it is
  handed; Task 6 wires the real preflight into the CLI. — Cost if wrong: Task 6 adjusts one signature.
- **Ruling R4 (F6):** S18 and S19 belong to **Task 6**, per the plan's own §10.2 coverage table, which is
  the plan's authority over a task's prose list. Task 14 covers S10/S11/S12/S13/S16 only. — Cost if wrong:
  two scenarios written in the wrong file.
- **Ruling R5 (F7):** Task 7 splits into `deriveRunId(taskId, contractBytes, baseCommit)` (pure, stable)
  and `allocateRunId(...)` (mkdir placeholder, `EEXIST` increments). The determinism criterion measures
  `deriveRunId`; S15 measures `allocateRunId`. — Cost if wrong: one signature change.
- **Ruling R6 (F8, F9):** Task 10 creates `src/scheduler/run.ts` and the `run` subcommand, and writes the
  `scheduling` decisions onto W with `appendEvent` after landing, because S2 measures them. Task 13 then
  owns the two-ledger split, the evidence field, the filenames and the exit-code reduction, and may
  refactor Task 10's write path. — Cost if wrong: Task 13 rewrites a few lines Task 10 wrote.
- **Ruling R7 (F4):** every task that generates a ledger record (T4, T10, T12, T13) must feed its
  generated `undo.how` through `undoHowIsExecutable` **before** asserting anything, and paste the output
  into its report. The gate caught prose twice in prior rounds and the predicate has known false
  negatives in both directions. — Cost if wrong: a decision that cannot be appended, discovered late.
- **Ruling R8:** work lands as local commits on `main`, no worktree and no branch. `CLAUDE.md` Rule 15
  makes deleting a branch or worktree a human-authorised act, and every prior round in this repository
  committed to `main` directly; Rule 11 puts the repo's convention above the skill's default. The human
  has separately ruled **no push**. — Cost if wrong: history is linear on main, as it already is.
- **Ruling R9:** the controller does **not** read the scheduler spec in full; implementers read the named
  sections themselves. Rule 6 budgets context occupancy, and the measured lesson from this project is
  that a large controller context is re-sent on every call. Each adjudication reads the specific section
  first. — Cost if wrong: a ruling made without a spec detail; mitigated by reading before ruling.
- **Ruling R10:** where the skill's "never stop to ask" collides with `CLAUDE.md` Rule 15, Rule 15 wins:
  push, merging into main, deleting a branch or worktree still stop and ask. Everything else is decided
  here and recorded. — Cost if wrong: one extra question to the human.

## Task progress

Task 1: dispatched (implementer, sonnet). BASE `e60c2a2`. Brief `task-1-brief.md`, report `task-1-report.md`.
Task 1: Ruling: the brief's Step 1 prerequisite probe is itself defective (`npx tsx -e` cannot resolve a
  relative specifier from an `[eval]` module). The controller ran an equivalent probe through a real file
  and both prerequisites hold; the implementer skips Step 1. — Cost if wrong: none, the facts were measured.
Task 1: Ruling R11: ccloop is **not** built or otherwise written to by this task. `dist/` is gitignored and
  already present, so `resolveCcloopBin()` resolves today; the first real spawn is Task 8, which owns any
  build. — Cost if wrong: Task 8 discovers a stale `dist/` and rebuilds.

## 🔴 Closing contract (human instruction, 2026-09-04, mid-round — must survive compaction)

1. Rule on problems as they come up and keep executing; report to the human for review **only at the end**.
2. **After all 15 tasks are done**, update the handoff documents in all three repositories:
   `Orca/docs/handoff/handoff.md`, `ccloop/docs/handoff/handoff.md`, `ccmem/docs/handoff/handoff.md`.
3. In ccloop and ccmem, the Orca material **updates the single existing rolling section in place** —
   never add another numbered section. (Human's rule of 2026-09-02.)
4. **Do not pin a current git HEAD anywhere in a handoff** — committing the handoff itself moves HEAD.
   Reference commits by subject line. The one exception stands: a measured value's observation-anchor
   commit must be written, because that is its expiry date, not a current-state claim.
5. Also produce a separate **handoff executive summary of at most 10 lines**, for the next agent's
   fast entry, **delivered in chat only — not written to any file**.
6. The `/handoff` skill additionally asks for a handoff document in the OS temp directory: write it
   under the session scratchpad, reference specs/plans/commits by path rather than restating them,
   and include a "suggested skills" section.
7. ccmem is currently dirty with another line's v0.14 work — re-measure before writing anything there,
   and if it is still someone else's live worktree, report the prepared text instead of writing it.
Task 1: implementer reported DONE — commit `fdd72a1` "test(scheduler): build the sandbox harness and arm its gate first".
  `npm run verify` exit 0, 122 tests (119 + 3 new). Gate-armed proof run in a `git clone --local` copy:
  control exit 0, broken criterion exit 1, main worktree byte-identical by `shasum -a 256`, ccloop untouched.
  Implementer concern carried forward: `resolveCcloopBin()` assumes Orca and ccloop are siblings on disk.
Task 1: task review dispatched (sonnet) over e60c2a2..fdd72a1.
Task 1: review returned 0 Critical / 2 Important (both plan-mandated) / 3 Minor / 1 ⚠️.
Task 1: Ruling: finding 1 (the identity criterion asserts porcelain and ref count, neither of which depends
  on the injected git identity) is **fixed, not parked**, even though the criterion is verbatim from the
  plan's Step 2 sample. `CLAUDE.md` Rule 9 is the binding authority over the plan: a criterion not seen red
  for its own property is not a criterion. The fix only adds an assertion, so no existing criterion is
  weakened. A named mutation `M-T1-ID` (drop the identity spread from the commit call) must be seen red.
  — Cost if wrong: one extra assertion and one extra mutation run.
Task 1: Ruling: finding 2 (every `makeSandbox()` throws when ccloop's gitignored `dist/` is absent) is
  **fixed**, because G1 requires `npm run verify` to exit 0 and this makes it depend on a sibling repo's
  build artifact. Fixed as a **lazy getter**, so the declared interface `ccloopBin: string` that Task 8
  consumes is unchanged and the named error surfaces at first real use. — Cost if wrong: Task 8 adjusts
  one property access.
Task 1: Ruling: the ⚠️ item (the `shasum` restoration proof predates a later self-review edit) is **not**
  a gap. The edit was an intentional change carried in the committed diff, not mutation residue, and the
  suite was re-run green afterwards. — Cost if wrong: an unproved byte-identity claim on one file.
Task 1: minor (deferred): `refSha` swallows every `git rev-parse` error, not just an unknown ref.
Task 1: minor (deferred): scheduler tests run twice per `verify` — `vitest.config.ts` already globs them.
Task 1: minor (deferred): `resolveCcloopBin()` hard-codes Orca and ccloop as siblings, no override.
  Carried into Task 8's dispatch, which is the first task to actually spawn ccloop.
Task 1: fix round 1/5 dispatched (implementer resumed) — 2 findings sent.
Task 1: fix round 1/5 (2 addressed, 0 open; commits fdd72a1..5d04f2d). Re-review confirmed the laziness
  criterion measures the production path, not the injected double: the getter/caching code is shared by
  both resolvers, so removing the laziness reddens it.
Task 1: complete (commits e60c2a2..5d04f2d, review clean). `npm run verify` exit 0, 4 scheduler tests.
Task 2: dispatched (implementer, sonnet). BASE `5d04f2d`.
Task 2: implementer reported DONE — commit `dcee344`. `npm run verify` exit 0, 131 tests (123 + 8 new).
  All seven named mutations (M-P2-REL/DUP/CYC/IN/WB/POL/ALL) seen red in a `git clone --local` copy,
  each on its named criterion; main worktree byte-identical by `shasum -a 256`; ccloop untouched.
  Disclosed deviation: committed before mutating, because `clone --local` only clones committed state.
Task 2: task review dispatched (sonnet) over 5d04f2d..dcee344.
Task 2: review ✅ spec compliant, 0 Critical / 0 Important / 3 Minor, one ⚠️.
Task 2: Ruling: the ⚠️ (the `M-P2-ALL` patch is described in prose, and read literally it would also have
  reddened the single-code criteria) is **not a gap**. The recorded red output settles it:
  `expected [ 'relative-path' ] to deeply equal [ 'relative-path', 'unsupported-policy', 'work-branch-is-default' ]`.
  An unguarded early return would have produced `[]` on that input and reddened the six single-code
  criteria too; they stayed green, so the mutation was the guarded form — which is the faithful model of
  "stop at the first rejection." — Cost if wrong: one mutation's evidence is weaker than claimed.
Task 2: minor (deferred): `contract` exactly equal to `targetRepo` is not treated as inside (degenerate).
Task 2: minor (deferred): all zod failures collapse to one generic `malformed` code.
Task 2: complete (commits 5d04f2d..dcee344, review clean).
Task 3: dispatched (implementer, sonnet). BASE `dcee344`.
Task 3: implementer reported DONE_WITH_CONCERNS — commit `7f5a683`. `npm run verify` exit 0, 131 -> 144 tests.
  Six mutations run in a `git clone --local` copy, worktree byte-identical by `shasum -a 256`.
  Concern A: `M-TRIE-c` reddened **two** criteria, not the one the plan predicted — a second unnamed
  consumer of the same deleted branch. **This corrects the plan's model and needs an ERRATUM at the end**
  (the P2 plan is published text; in-place edits are forbidden).
  Concern B: `writeSetOf` has no brief-given criterion or mutation; baseline tests added, no invented mutation.
Task 3: task review dispatched (sonnet) over dcee344..7f5a683, asked to judge both disclosures.
Task 3: review ✅ spec compliant (verbatim transcription verified), 0 Critical / 1 Important
  (plan-mandated) / 4 Minor / 1 ⚠️ (mutation execution is outside the diff by nature — accepted,
  the reviewer hand-traced all six patches against the logic and found each consistent with its red).
Task 3: Ruling: the reviewer's own hand-trace **confirms** the implementer's `M-TRIE-c` argument — the
  second red comes from the same deleted branch reached through a second fixture, not from cases ② and ③
  being separately judged. The plan's shared-judgement model stands; only its predicted blast radius was
  wrong. **ERRATUM owed to the P2 plan** (published text, no in-place edit). — Cost if wrong: a mutation
  table row over-claims coverage.
Task 3: Ruling: the Important finding (no `.`/`..` resolution, so `./src/**` vs `src/a.ts` and
  `src/foo/../bar/x.ts` vs `src/bar/**` are both judged **disjoint**) is **fixed, not parked**, even
  though the code is transcribed verbatim from the plan. Spec §3.1 names "disjoint when actually
  overlapping" the unsafe direction and the spec outranks the plan; the conflict trunk keeps the system
  correct when the criterion is wrong, so this is not a correctness hole, but it is a hole in the one
  direction the spec singles out, and it costs a few lines. Guarded specifically against
  `path.posix.normalize("")` returning `"."`, which would move the empty claim from "the whole
  repository" to "a directory named ." — itself an unsafe-direction change. New mutation `M-NORM-DOT`.
  **ERRATUM owed to the P2 plan for the deviation from its Step 3 code.** — Cost if wrong: a slightly
  larger normalisation surface than the plan specified.
Task 3: minor (deferred): `writeSetOf` concatenates instead of deduplicating despite the ∪ wording.
Task 3: minor (deferred): a leading `/` gives a `new-contains-old` diagnosis where `equal` would read better.
Task 3: minor (deferred): the empty-string claim's root behaviour is undocumented.
Task 3: fix round 1/5 dispatched (implementer resumed) — 1 finding sent.
Task 3: fix round 1/5 (1 addressed, 0 open; commits 7f5a683..77d34a8). Re-review hand-traced all eight
  named inputs: `""` and `"**"` return before `posix.normalize` is ever called, so the `normalize("") === "."`
  trap is structurally unreachable; `./src/**` and `src/**` now normalise identically; `declared` verbatim
  on every path. `M-NORM-DOT` patch confirmed to delete only the resolution step, 2 of 17 red.
Task 3: complete (commits dcee344..77d34a8, review clean). `npm run verify` exit 0, 148 tests.
Task 4: dispatched (implementer, sonnet). BASE `77d34a8`.
Task 4: implementer reported DONE — commit `cb4fbb2`. 36/36 scheduler, 155/155 full suite, typecheck and
  verify both RC=0. M-IMPL / M-DEC / M-LAYER all seen red in a clone copy, worktree byte-identical.
Task 4: 🔴 **A recorded measurement in the Orca handoff is false.** Round `213d1395`'s section 四.6 says
  `undoHowIsExecutable` has a false negative on `git checkout <sha> -- README.md`. Controller re-measured
  on this commit: it returns **true**. Also measured true: `git checkout abc1234 -- README.md`,
  `git checkout -- README.md`, `rm -rf .decisions/orca-dev-x.jsonl`; the Chinese prose example still
  returns false. `/usr/bin/git log -- src/ledger/undoExecutable.ts` shows one commit only (`6c7be59`),
  so the predicate has not changed since that claim was written — the claim was wrong when recorded.
  **ERRATUM owed to the Orca handoff** (published text: append a named erratum, never edit in place).
Task 4: task review dispatched (sonnet) over 77d34a8..cb4fbb2.
Task 4: review 0 Critical / 2 Important / 1 Minor / 1 ⚠️ (the diff rendered `graph.ts` as binary, so the
  reviewer read the committed blob out of band — that is finding 1's own symptom, not a process gap).
Task 4: Ruling: finding 1 (`pairKey` joins task ids with a literal NUL, which makes git treat
  `src/scheduler/graph.ts` as a binary file — already manifested in this task's own review package) is
  **fixed**; the key becomes `JSON.stringify([a,b].sort())`. — Cost if wrong: a slightly longer key string.
Task 4: 🔴 Ruling: finding 2 (layering serialises every connected component, because it takes only
  `ready[0]` per iteration) is **fixed as batched Kahn, and the plan's `**` criterion is amended by me.**
  Two spec statements contradict each other and the evidence decides it:
    - §2.4 line 168, definitional: "分层用 Kahn 拓扑排序，**层内并行**".
    - §9.1 line 824, warning copy: a root-claiming task means "整图串行；并行度恒为 1".
  §9.1's quantification is only true in degenerate cases — with `T1:**, T2:a.txt, T3:b.txt`, T2 and T3
  are disjoint from each other, so the true layering is `[[T1],[T2,T3]]`. A definitional section outranks
  warning copy, the plan's own first criterion already requires intra-layer parallelism, and a
  `string[][]` whose every layer holds one task is a lie. The amended criterion asserts the property that
  survives: **the root-claiming task is alone in the first layer and both implicit edges exist**, plus
  **T2 and T3 share a layer** — the half the old criterion had backwards. `M-IMPL` must still redden it.
  A diamond criterion (A→B, A→C, B→D, C→D ⇒ `[[A],[B,C],[D]]`) is added to prove the batching is real.
  **ERRATUM owed to the published P2 plan and to spec §9.1.** Task 5's degradation warning must say
  "nothing runs concurrently with this task", not "this plan has no parallelism" — carried into Task 5.
  — Cost if wrong: the scheduler runs more tasks concurrently than the plan's author intended, which the
  conflict trunk still handles correctly but at higher reconciliation cost.
Task 4: minor (deferred): the defensive `throw` for "no schedulable task" has no exercising test.
Task 4: fix round 1/5 dispatched (implementer resumed) — 2 findings sent.
Task 4: fix round 1/5 (2 addressed, 0 open; commits cb4fbb2..05a7eb5). Re-review hand-traced both layer
  shapes: `T1:**` gives `[[T1],[T2,T3]]`, the diamond gives `[[A],[B,C],[D]]`; intra-layer order is an
  explicit `.sort()` on taskId, never Map order; the amended criterion is **stronger** than the one it
  replaced — `M-IMPL` now reddens three independent assertions instead of one.
Task 4: complete (commits 77d34a8..05a7eb5, review clean). `npm run verify` exit 0.
Task 4: note for the round's write-up — the implementer disclosed that it had *seen* `git diff` report
  `graph.ts` as binary during the first mutation round and worked around it with `--text` instead of
  investigating. That is what let finding 1 reach review.
Task 5: dispatched (implementer, sonnet). BASE `05a7eb5`.
Task 5: implementer reported DONE — commit `7383cf0`. `npm run verify` exit 0, 165/165 (46 in tests/scheduler,
  including S17 and eight planReport criteria). Three mutations seen red in a clone copy; worktree
  byte-identical. Two disclosures carried to the reviewer:
  (a) the "requiredChecks union is empty" warning has printer logic and a passing criterion but **no
      production wiring** — `TaskGraph` carries no parsed contracts, so the test widens the type itself.
      This is the "green that was empty" shape; the reviewer was asked to rule it load-bearing,
      decorative, or misleading.
  (b) three runtime preflight check code strings were invented here and **Task 6 must reuse them
      verbatim** or the report prints "not evaluated" forever. Carried into Task 6's dispatch.
Task 5: task review dispatched (sonnet) over 05a7eb5..7383cf0.
Task 5: review ❌ spec (one concrete conflict) / 0 Critical / 2 Important / 2 Minor / 1 ⚠️.
Task 5: Ruling: finding 1 — `planReport.ts` invented `target-worktree-dirty` while Task 6's brief already
  hardcodes `dirty-worktree`. **The brief is the requirement; the code moves.** The three runtime check
  identifiers become an exported `RUNTIME_CHECKS` constant so there is one source of truth, and Task 6
  must import it rather than retype. The two unauthored names are fixed by ruling as
  `work-branch-already-exists` and `base-not-a-commit`. — Cost if wrong: a rename in Task 6.
Task 5: Ruling: finding 2 — the empty-`requiredChecks`-union warning is **wired for real here**, not
  marked "not evaluated". The data was always in hand: the CLI loads every contract to build write sets
  and `buildGraph` already receives them, so only the plumbing was missing. `requiredChecksUnion` is
  implemented now in `writeSet.ts` (the module that already reads contract fields) and **Task 11 must
  import it rather than define a second copy**. New mutation `M-PLAN-UNION` must redden through the
  production path. — Cost if wrong: a function lands one task earlier than the plan placed it.
Task 5: 🔴 Measured fact that changes Task 11: ccloop's contract schema has
  `requiredChecks: z.array(z.string()).min(1)` (`ccloop/src/contract/schema.ts:65`), so **a contract
  ccloop would accept can never contribute an empty union.** The condition stays reachable only because
  subsystem C reads contract files as opaque JSON and never validates them against ccloop's schema.
  ⇒ Task 11's S4 and `M-EMPTYCHK` must be fed a contract that is deliberately invalid by ccloop's rules,
  and must say so. **ERRATUM owed to spec §5.3 / §9.1(6)**, which do not mention this.
Task 5: minor (deferred): `git symbolic-ref` runs against an unvalidated `targetRepo` before path checks.
Task 5: fix round 1/5 dispatched (implementer resumed) — 2 findings sent.
Task 5: fix round 1/5 (2 addressed, 0 open; commits 7383cf0..f5945d7). Re-review traced the production
  path hop by hop (cli.ts:149-152 load contracts -> :154 buildGraph -> :161 emptyRequiredChecksPairs ->
  :171 renderPlanReport -> planReport.ts:144-150 prints) and confirmed the scenario test asserts on real
  captured stdout through `runCli(["plan", …])`. `requiredChecksUnion` is a deduped set union, not a
  concatenation, and degrades to `[]` for missing or non-array fields.
Task 5: Ruling: the re-review noted `M-PLAN-UNION` mutated the renderer's consumption loop rather than
  the CLI wiring line itself, closing that gap **by inspection rather than by a seen red**. This project's
  own rule is that an unseen mutation is not proof, so instead of spending a whole round now I am adding
  **`M-PLAN-WIRE`** (delete the CLI's `emptyRequiredChecksPairs` computation) to Task 15's mandatory
  mutation re-run list, where every mutation is re-run against the finished code anyway.
  — Cost if wrong: one wiring line is proved by trace until Task 15 proves it by red.
Task 5: minor (deferred): the fix report asserts the final `npm run verify` result rather than pasting raw output.
Task 5: complete (commits 05a7eb5..f5945d7, review clean). `npm run verify` exit 0, 171 tests.
Task 6: dispatched (implementer, sonnet). BASE `f5945d7`.
Task 6: implementer reported DONE — commit `1535db1`. `npm run verify` exit 0, 181/181 (62 scheduler).
  Five mutations seen red in a clone copy; worktree byte-identical over all 76 tracked files.
  🔴 Disclosure worth keeping: Task 5 shipped a nine-check report in which the three runtime checks'
  `evaluated` flag was hardcoded `false`, so `[pass]` was **structurally unprintable** — Task 5's own
  review did not catch it, and Task 6 found it through a real RED run, not by inspection. Fixed with an
  optional default-preserving flag; `planReport.ts` is outside Task 6's brief file list, so the reviewer
  was asked to judge necessity and minimality.
  Second disclosure: `preflight.ts`'s `git status --porcelain` has no try/catch and throws when
  `targetRepo` is not a repository.
Task 6: task review dispatched (sonnet) over f5945d7..1535db1.
Task 6: review ✅ spec compliant, 0 Critical / 1 Important (plan-mandated) / 3 Minor / 1 ⚠️.
Task 6: Ruling: the ⚠️ is settled by the controller — `src/cli.ts:133` derives `defaultBranch` via
  `resolveDefaultBranch(targetRepo)` and passes the same value to `loadPlan` (:135) and `preflight` (:170).
  Pre-existing and correct.
Task 6: Ruling: the Important finding — S21's second assertion
  (`refSha(targetRepo, "refs/heads/orca/w/x")` is null) **cannot fail**, because nothing in the test
  reaches code that touches that branch; it passes identically under M-LOCK and M-LOCK-b — is fixed by
  **deleting the assertion and moving the "never enters W" half of S21 to Task 10**, where `orca run`
  exists and can actually be attempted under a held lock. An assertion that cannot fail while looking
  load-bearing is worse than none. 🔴 **Task 10's dispatch must carry this requirement** — it is a move,
  not a deletion. — Cost if wrong: S21's second half is unproven until Task 10 lands it.
Task 6: Ruling: the Chinese quotation inside `src/scheduler/preflight.ts:53` violates G12 (code and
  comments are English; plan prose is Chinese and stays there) and is fixed now even though the reviewer
  graded it Minor — it is a direct breach of a convention the human set. — Cost if wrong: none.
Task 6: minor (deferred): `preflight.ts` throws rather than rejecting when `targetRepo` is not a git
  repository — loud rather than silent, but zero-coverage on `orca plan`'s new primary path.
Task 6: minor (deferred → corrected in report): the report claimed every locking test wraps `release()`
  in a `finally`; two of four do. Harmless because each sandbox is a fresh `mkdtemp` that is removed.
Task 6: fix round 1/5 dispatched (implementer resumed) — 2 items sent.
Task 6: fix round 1/5 (2 addressed, 0 open; commits 1535db1..d2d9ce0). Re-review confirmed the surviving
  S21 assertion is byte-identical, no substitute fixture was synthesised, and no Chinese remains in the
  touched files (`grep -nP '[\x{4e00}-\x{9fff}]'` over all of them: zero matches).
Task 6: complete (commits f5945d7..d2d9ce0, review clean). `npm run verify` exit 0, 181 tests.
Task 7: dispatched (implementer, sonnet). BASE `d2d9ce0`.
Task 7: implementer reported DONE — commit `4fe2ba1`. `npm run verify` exit 0, 187 tests (68 scheduler).
  `M-ID` sent both S15 criteria red; worktree byte-identical. `deriveRunId` throws for a taskId that the
  ledger writer would later refuse — loud at allocation time, no silent sanitisation.
  Disclosure carried to the reviewer: the run-id character class was **duplicated locally** rather than
  imported, because `RUN_ID` at `src/ledger/writer.ts:11` is module-private and the controller had said
  not to touch `src/ledger/**`. That is a second copy of a constant across a module boundary — the exact
  shape the preceding P1 round existed to collapse (a reference-event list had silently acquired four).
Task 7: task review dispatched (sonnet) over d2d9ce0..4fe2ba1.
Task 7: review ✅ spec compliant, 0 Critical / 1 Important / 1 Minor.
Task 7: Ruling: the Important finding (run-id character class duplicated across a module boundary) is
  fixed by **exporting `RUN_ID` from `src/ledger/writer.ts` and importing it**, deleting the copy. I
  rejected the reviewer's proposed fix — a test comparing the two files' source text — because it detects
  drift instead of preventing it, breaks on reformatting, and adds a novel fragile mechanism where a
  one-word `export` suffices. The plan's "do not touch `src/ledger/**`" boundary exists to stop P2 from
  redesigning P1's work; an additive export that removes a duplicate is the opposite of that risk, and is
  the same move P1 made when it derived the reference-event router from one source. A new criterion keeps
  measuring something after the import: the ids these functions **produce** (including an incremented
  `-2` id) must themselves satisfy `RUN_ID`. — Cost if wrong: one exported symbol in the ledger module.
Task 7: Ruling: the Minor (unbounded `for (let attempt = 1; ; attempt++)` retry) is **folded into this
  round** rather than deferred, because what it leaves open is a **silent hang** and Rule 12 is fail
  loud. Capped at 1000 with a named error. — Cost if wrong: an error path no test exercises.
Task 7: fix round 1/5 dispatched (implementer resumed) — 1 Important + 1 promoted Minor.
Task 7: fix round 1/5 (2 addressed, 0 open; commits 4fe2ba1..50e2b8a). Re-review confirmed the
  `writer.ts` edit is exactly `export` plus a comment (regex text and `appendEvent` untouched), no second
  copy of the character class survives in `src/scheduler/`, and both new criteria measure produced ids —
  S15's incremented case really claims the first directory with a real `mkdir` before the second call, so
  `-2` comes from the production path, not from a string the test built.
Task 7: complete (commits d2d9ce0..50e2b8a, review clean). `npm run verify` exit 0, 188 tests.
Task 7: minor (deferred): the cap-exhaustion error carries no `{ cause }`.
Task 8: dispatched (implementer, **opus** — first task that actually spawns ccloop, the plan's highest
  integration risk). BASE `50e2b8a`.
Task 8: implementer reported DONE_WITH_CONCERNS — commits `1695922`, `4c10aaf`, `f254c74`.
  `npm run verify` exit 0, 27 files / 201 tests, nine real ccloop spawns, whole suite 2.84s, nothing
  skipped. M-STATUS / M-REPOPATH / M-ROUTE all seen red, plus three self-added (M-IMPLICIT, M-BIN, M-BIN-b).
  Controller verified independently: ccloop `git status --short` empty, HEAD still `7f2c5f6`.
  🔴 Measured facts recorded for later tasks:
    - all four non-success terminal states really do exit 2;
    - `exhausted` vs `failed` is decided by the attempt limit being checked before retry-safety;
    - `blocked_waiting_human` is reachable only via the path-policy evaluation under a command verifier —
      the pause-signal route is dead there;
    - **a blocked run publishes no attempt ref** — Task 9 harvests from those refs, so this matters.
    - `ContractSpec` survived the first real spawn with only two additive optional fields ⇒ Task 1's
      known-unproven point is now proven.
  Four disclosures sent to the reviewer, the first being the important one:
    (a) 🔴 the brief's own repoPath assertion `headOf(workdir/repo) === base` **does not go red** under
        M-REPOPATH, because the clone exists either way; three replacement assertions were added;
    (b) `disposeWorkdir` is exported but not called by `runTask`, because deleting a successful clone at
        step 3 would destroy the only copy of what §4.3 steps 4-6 (Tasks 9-10) read;
    (c) `adapterConfig` has no home in the plan file and is a required option for now;
    (d) `cancelled` has only pure-function coverage, and "S9 never calls resume" is structural.
  Also disclosed: M-BIN-b initially passed green, exposing a criterion that did not measure its stated
  purpose — fixed and re-proved red. That is the project's own failure shape, caught by the implementer.
Task 8: task review dispatched (**opus** — largest and subtlest diff so far) over 50e2b8a..f254c74.
Task 8: review ❌ spec (one new branch with no criterion) / 0 Critical / 3 Important / 11 Minor / 3 ⚠️.
  The reviewer independently confirmed the implementer's central disclosure and traced the mechanism in
  ccloop: `worktreeManager.ts:91` runs `git update-ref` with cwd inside the worktree, and a worktree
  shares its parent repo's ref store — so without the `repoPath` rewrite the attempt ref lands in the
  **user's own repository**. Of the three replacement assertions, `:125` is the one carrying the weight;
  `:123` and `:124` redden for the same proxy reason under this mutation.
Task 8: Ruling: finding 1 (the non-terminal-status guard at `ccloopRunner.ts:148-152` has no criterion —
  delete it and a never-terminated run is reported as a plain failure) is **fixed**, with a stub-binary
  criterion and a named mutation `M-NONTERMINAL`. — Cost if wrong: one more criterion than needed.
Task 8: Ruling: finding 2 (`/bin/rm -rf` at `:378` on an unvalidated `run.workdir`; an empty or `"."`
  runId makes `workdir === plan.runsDir`, so disposal would remove every other task's clone) is **fixed**
  with a guard requiring a non-empty runId and `basename(workdir) === runId`, plus a criterion that also
  asserts nothing was deleted — a guard that throws after deleting is not a guard. This repository's
  operating rules single out recursive deletion as the unrecoverable class. — Cost if wrong: none.
Task 8: Ruling: finding 3 — the implementer's refusal to call `disposeWorkdir` from `runTask` is
  **upheld**: deleting a successful clone at step 3 destroys the only object store the attempt commit is
  reachable from, which Tasks 9-10 must read. But §4.5's guarantee then has no owner, so it is
  **assigned to Task 10's land step**, after the fetch into W. 🔴 Task 10's dispatch must carry it.
  — Cost if wrong: clones accumulate until a later task deletes them.
Task 8: Ruling (mine, not the reviewer's): `S8.test.ts:67` and `S9.test.ts:65` assert the absence of a run
  directory the test never creates, and nothing in this task decides what to run, so no mutation can
  redden them. The reviewer graded this Minor; **I am grading it Important, because I ruled the identical
  shape that way in Task 6** (S21's unreachable assertion) and grading the same shape differently would
  make the rule meaningless. Deleted, with the property deferred to Task 14 where an orchestrator exists.
  — Cost if wrong: two assertions removed that were measuring nothing.
Task 8: 🔴 **Two errata owed to the P2 plan**: (a) the brief's Interfaces block pins
  `runTask(plan, task, base, runId)` but ccloop's `run` requires `--adapter-config` and the plan file has
  no field for it, so a fifth required `options` parameter exists — Tasks 13/14 read that block, not this
  report; (b) the brief's own repoPath assertion is defective and must not be copied by a later task.
Task 8: fix round 1/5 dispatched (implementer resumed) — 3 findings + 1 consistency item.
Task 8: fix round 1/5 (4 addressed, 0 open; commits f254c74..9128d56). Re-review confirmed the deletion
  guard runs before any removal — `M-GUARD-LATE` (guard moved after the `rm`) reddens the
  "nothing was deleted" assertion while the `rejects` assertion still passes, so it is that assertion,
  not the rejection, that pins the ordering. The stub binary exits **0**, so neither the exit code nor a
  fallback could produce the right answer by accident. Item 4's deletions are exactly two assertions with
  the unused import dropped and nothing else touched.
Task 8: out-of-scope note carried forward: `basename(workdir) === runId` is bypassable by a relative
  `workdir`, but no code path can produce one — `workdir` is only ever `join(runsDir, runId)` and `runId`
  only ever comes from `deriveRunId`, which rejects any taskId containing a slash. Worth a note if
  `disposeWorkdir` ever gains an externally-influenced caller.
Task 8: complete (commits 50e2b8a..9128d56, review clean). `npm run verify` exit 0, 204 tests.
Task 9: dispatched (implementer, **opus** — spec calls §7 C's only drift detection, and it only fires
  after the money is spent). BASE `9128d56`.
Task 9: implementer reported DONE — commit `03c02b5` (7 files, +701/-21). `npm run verify` exit 0,
  211 tests (204 + 7), all driven by real ccloop scripted runs. ccloop `status --short` empty, HEAD `7f2c5f6`.
  🔴 **`M-C` ran for real and reddened all seven criteria** — with the whole of §7 replaced by a no-op
  harvest and a land-everything disposition, nothing stayed green. So the reconciliation itself is
  measured, not merely its branches. That is the answer D6 existed to get.
  `harvest` **throws** for a run with no attempt ref (only `blocked_waiting_human` produces that),
  because absorbing it as "empty" would demote a §6.3 escalation (3) into a failure (2).
  The deferred `latestAttemptSha` criterion got a genuinely multi-ref run: `verifierType: "agent"` plus a
  frame with `approved:false, safeToRetry:true` and `maxAttempts: 2` is the only route to `retryable`,
  and each attempt writes a file named after its own worktree, so picking the wrong ref is visible.
  Four disclosures sent to the reviewer: M-A1 and M-A2 produce identical observable results on S7;
  the tier-1 `boundary` ledger entry has no criterion yet; `exitContribution` has no consumer until
  Task 14; and a fifth export `sameLayerWriteSets` was added so "layer, not whole graph" lives in
  production code where a mutation can delete it.
Task 9: task review dispatched (sonnet) over 9128d56..03c02b5.
Task 9: review ✅ spec compliant, 0 Critical / 1 Important / 3 Minor / 2 ⚠️.
Task 9: Ruling: both ⚠️ items are settled by the controller. `graph.ts:12-17` declares
  `layers: string[][]` and `writeSets: Map<string, ClaimedPath[]>`, exactly as `sameLayerWriteSets`
  assumes; and the suite count moving 204 -> 211 inside a full `npm run verify` is itself the proof that
  the seven new criteria are executed, not merely written.
Task 9: Ruling: the Important finding — `M-C`'s patch is paraphrased in the report while the other three
  are byte-exact — is **fixed as an evidence repair, with no code change**. D6 exists because a mutation
  written as a skip is an admission it never ran, and a patch a reader cannot check character-for-character
  falls short the same way; M-C is also the mutation the whole task's claim rests on. The reviewer did
  independently reconstruct the stub and reproduce every quoted failure line for line, so the substance is
  corroborated and only the artifact is short. **No re-review seat for this round** — there is no code to
  regress, so the controller checks the pasted patch itself. — Cost if wrong: one mutation's evidence
  stays a paraphrase.
Task 9: Ruling: `M-A1` and `M-A2` are **one proof told two ways**, and stronger than the implementer
  claimed — the two mutants are the same function for all inputs, not just on S7, because deleting the
  `if (collides)` branch is behaviourally identical to hard-coding `collides = false`. Both satisfy G3
  individually; nobody should later count them as two independent proofs.
Task 9: minor (deferred): the tier-1 `boundary` ledger entry has no criterion — **assigned to the ledger
  wiring task (Task 13)**; `exitContribution` has no consumer until Task 14; `TaskSpec` lacks a doc comment.
Task 9: fix round 1/5 dispatched (implementer resumed) — 1 evidence repair, no code.
Task 9: fix round 1/5 (1 addressed, 0 open; no commits — evidence-only repair). The M-C patch is now the
  literal 111-line diff, generated and run in a single invocation and proved byte-identical across two
  independent runs by `shasum`; result unchanged, 7 failed of 7.
Task 9: 🔴 The implementer **contested one of the reviewer's line citations and was right.** Controller
  re-measured at `03c02b5`: `S5.test.ts:55` really is `expect(d.land).toBe(false)`, and the "harvest.ts
  line 116" the reviewer flagged was git's own hunk header, not a citation. `harvest.ts:118` is the
  `harvest` signature as claimed. Rewriting a true line number to match a reviewer's mistaken one would
  have been the actual audit failure. **Reviewers are to be verified, not obeyed.**
Task 9: complete (commits 9128d56..03c02b5, review clean). `npm run verify` exit 0, 211 tests.
Task 10: dispatched (implementer, **opus**). BASE `03c02b5`. Carries four debts from earlier rulings.
Task 10: implementer reported DONE_WITH_CONCERNS — commits `624b097`, `f845305`, `1632b06`.
  `npm run verify` rc=0, 218 tests / 35 files, 99 in verify:scheduler, 12.7s wall. Seven new criteria,
  six seen red against the pre-task tree; eight mutations run, each reddening its named assertion
  (M-MAIN, M-LOCK, M-DISPOSE-a/b/c, M-SERIALISE, M-LAYERBASE, M-LEDGER).
  `undoHowIsExecutable` audit over the decisions actually committed on W: 2/2 pass.
  ccloop untouched, HEAD `7f2c5f6`.
Task 10: 🔴 Ruling on the language of generated ledger prose — the implementer flagged it for overturn
  and was right to. **Two categories, and the line runs between them:**
    - Orca's **own development ledger** (`Orca/.decisions/*.jsonl`) is internal notes about building Orca,
      the same kind of artifact as the handoff ⇒ **Chinese, and the existing records stay untouched**
      (they are append-only history in any case).
    - Decisions the scheduler **generates at runtime into a target repository** are product output that
      lands in someone else's repo ⇒ **English**, the same category the human's language rule assigns to
      CLI help text and README-class product documentation.
  ⇒ `src/scheduler/graph.ts:209-219`'s generated `question`/`chose`/`because` are Chinese and are the
  runtime kind. **I approved that in Task 4 and should have caught it.** Both they and Task 10's new
  decision must move to English. No existing `.decisions/*.jsonl` record is touched. Task 4's criteria
  assert kind, alternatives length and validator verdict — none assert the prose — so this is safe.
  — Cost if wrong: generated ledger prose is in a language the target repo's owner may not read.
Task 10: task review dispatched (sonnet) over 03c02b5..1632b06.
Task 10: review ❌ spec (the G12 ledger-prose ruling) / 0 Critical / 2 Important / 3 Minor / 1 ⚠️.
  The reviewer checked all eight mutation patches line by line against the real code and found every one
  byte-for-byte literal; verified the landing-order decision's factual claim against `graph.ts:161`;
  confirmed `Math.max` is a faithful stand-in for 3>2>1>0 because `harvest.ts` only emits 0, 2 and 3; and
  judged both follow-up commits genuine measurement fixes rather than loosened criteria.
Task 10: Ruling: finding 1 is the G12 ledger-prose ruling applied — `run.ts:175-191` **and**
  `graph.ts:209-219` move to English. Task 4's criteria assert kind, alternatives length and validator
  verdict, never the prose, so it is safe; no `.decisions/*.jsonl` record is touched.
Task 10: 🔴 Ruling: finding 2 — `runRound` has a `finally` but no `catch`, and `cli.ts:202-204` has no
  `.catch`, so a thrown error becomes an unhandled promise rejection: **Node picks the exit code instead
  of the 3>2>1>0 scheme, and the line telling the human where the work branch is never prints.** The
  target repository is left checked out on a branch the person did not choose, with no orca-authored
  message at all. Spec §4.2.1 permits checking out their worktree precisely because the design promises
  to be explicit about it; abandoning them mid-operation is the part it does not permit. **Fixed in both
  places**, with the original error still reported and the best-effort branch read unable to mask it, and
  a criterion that measures the exceptional path. The `cli.ts` change is narrow: the `validate` and
  `check-append-only` handlers are untouched and `tests/cli/cli.test.ts` must stay green.
  — Cost if wrong: one more catch than strictly needed.
Task 10: minor (deferred): byte-identical `git()` helper duplicated in `land.ts:18` and `run.ts:23`;
  `readLedgerOnBranch`'s catch is broader than its documented failure mode, so a typo'd branch name reads
  back as "zero decisions" (test-only).
Task 10: fix round 1/5 dispatched (implementer resumed) — 2 findings sent.
Task 10: fix round 1/5 (2 addressed, 0 open; commits 1632b06..1ab2882). Re-review ran a full CJK scan of
  the diff: no `+` line contains CJK, the only hits are deleted lines and one pre-existing comment
  quoting the spec; no `.decisions/*.jsonl` appears in the diff at all. It confirmed independently that
  `undoHowIsExecutable` inspects only `undo.how` (untouched) and the zod schema is language-blind, so the
  translation cannot break validation. `describeRepoState` wraps each git read in its own try/catch and
  cannot throw, so the diagnostic cannot mask the original error.
Task 10: Ruling: the implementer asked whether translating three further `graph.ts` fields beyond the
  three I named was in scope. **Approved** — same prose, same JSON line, same target repository, and
  half-translating is the failure shape this project has recorded repeatedly. — Cost if wrong: none.
Task 10: out-of-scope note for Task 15: the exception criterion's "exit code is 3" half is not
  independently reddened — `M-CATCH` kills the whole catch block, so the test dies on the earlier
  stdout assertion first. Add a `return 3` -> `return 2` mutation to Task 15's re-run list to close it.
Task 10: complete (commits 03c02b5..1ab2882, review clean). `npm run verify` exit 0, 220 tests.
Task 11: dispatched (implementer, **opus** — conflict trunk, the hardest remaining section). BASE `1ab2882`.
Task 11: implementer reported DONE_WITH_CONCERNS — commits `9e5ff19`, `a5c9d93`. `npm run verify` exit 0,
  39 files / 227 tests (+7). Thirteen mutations run; twelve red. `M-SLUG` **passed first**, exposing a
  decorative assertion (a two-level `../..` can never escape `runsDir` because `path.join` pops the
  `contract-reconcile-..` segment) — fixed and then seen red. ccloop clean at `7f2c5f6`.
Task 11: 🔴 Ruling on the plan gap the implementer found — **spec §5.4's escalation file has no owning
  task.** §5.4 requires three things on escalation: write both sides' intent, the conflict blocks and an
  executable `undo.how` into `<runsDir>/escalations/<run-id>.md` (explicitly **not** onto W, which is a
  code branch and should not carry process files); exit 3; and print the copy's path. Task 10 already
  does the second and third. The first is genuinely unassigned, and the plan's coverage table lists
  §5.0-§5.4 against both Task 11 and Task 12, which is how it fell through.
  ⇒ **Assigned to Task 13**, because escalations arise in five different places (S4, S20, S7's
  disposition, a failed reconciliation, and the exception path) and Task 13 already owns §6.3's
  exit-code reduction — the one point where every escalation contribution converges. Task 13 must carry
  a criterion that the file exists under `runsDir/escalations/`, is **not** on W, and contains an
  `undo.how` that passes the real `undoHowIsExecutable` predicate. **ERRATUM owed to the P2 plan.**
  — Cost if wrong: the escalation file lands one task later than a different reading would place it.
Task 11: task review dispatched (sonnet) over 1ab2882..a5c9d93.
Task 11: review ✅ spec compliant, 0 Critical / 0 Important / 3 Minor / 1 ⚠️. **No fix round triggered.**
  The reviewer hand-traced the repaired `M-SLUG` criterion and confirmed it is strengthened, not
  relabelled: with a two-level escape `path.join` cancels the literal `contract-reconcile-..` segment and
  lands back inside `runsDir` no matter what, so the old assertion could not fail; the three-level
  fixture makes the escape real. It also traced `repoPath` end to end — each task's own contract carries
  the **real** repository as `repoPath`, so without the fifth argument the only available candidate would
  have been the person's own checkout; `conflict.copyPath` provably points at the clone. And it verified
  `requiredChecksUnion` has exactly one implementation, imported, with no wrapper.
Task 11: Ruling: the ⚠️ (mutation workflow and restoration proof are process claims outside the diff) is
  **settled by the controller's own measurement** at `a5c9d93`: Orca porcelain empty, `git diff` and
  `git diff --cached` both 0 bytes, one worktree only; ccloop porcelain empty, HEAD `7f2c5f6`.
Task 11: minor (deferred): `S20.test.ts:704` asserts the refusal message contains `T2` but never `T1`, so
  a narrower mutation dropping only the "for X x Y" prefix would go unnoticed; a third literal copy of the
  four-line `git()` wrapper now exists (`reconcile.ts`, `land.ts`, `run.ts`); four supplementary
  assertions are real but masked by an earlier assertion firing first (all named in the report).
Task 11: complete (commits 1ab2882..a5c9d93, review clean).
Task 12: dispatched (implementer, **opus** — the plan names §5.2 step 4 its most fragile implementation
  point and §8.3 the easiest to get backwards). BASE `a5c9d93`.
Task 12: implementer reported DONE_WITH_CONCERNS — commits `b0ac6c0`, `36f2610`. `npm run verify` exit 0,
  233 tests (was 227). Seven mutations run, six red — `M-OPT`, `M-TREE`, `M-BOUND` all red, and
  `M-OPT`'s shortcut was **proved reachable with a temporary throw** before the mutation was trusted.
  ccloop clean at `7f2c5f6`.
Task 12: 🔴 Ruling on the S3 conflict the implementer surfaced. **Spec §10.2's S3 row expects exit 0;
  that is unreachable under §7.3, and §7.3 wins.** Two same-layer tasks can only collide by writing
  outside their declared sets — if a path lay inside both declarations the sets would intersect and the
  graph would serialise them into different layers — and §7.3 prices every out-of-bounds write at 2 or
  3 (S6: lands, contributes 2; S7: refuses and contributes 3). So the very thing that makes S3
  interesting, an undeclared collision, guarantees a non-zero contribution.
  Evidence decides it: §7.3 is carried by three scenarios and four mutations (S5/S6/S7,
  M-A1/M-A2/M-B1/M-C); §10.2's S3 row is a single expected value. ⇒ **S3 asserts exit 2** and keeps
  everything else it stood for — reconciled, landed, a `reconcile` kind in the ledger, every line valid
  through the real validator. **ERRATUM owed to spec §10.2.** — Cost if wrong: S3 pins a weaker exit
  code than the spec's author intended, while still pinning the behaviour the scenario exists for.
Task 12: Ruling: concern 4 (the `reconcile` decision lands **inside** the merge commit rather than in a
  separate commit on W) is **upheld** — a commit on W in between would be silently reverted by the
  rebuilt tree, which is the same insight §8.3 is built on. Correct, not a shortcut.
Task 12: Ruling: concern 3 (§5.4's escalation file still unowned) was already **assigned to Task 13** when
  Task 11 raised it. Confirmed, not re-opened.
Task 12: 🔴 Confirmed finding to fix: `M-MARKERS-CALL` **passed green** — no shipped fixture produces a
  reconciliation that leaves conflict markers behind, so deleting the escalation on that branch changes
  nothing. The function has a criterion and the call site is live, but that branch has none. This is the
  project's own "green that is empty" shape and the scripted adapter makes a fixture cheap.
Task 12: task review dispatched (sonnet) over a5c9d93..36f2610.
Task 12: review ❌ (one undisclosed substitution) / 0 Critical / 2 Important / 4 Minor / 1 ⚠️.
  Confirmed right: both given code blocks transcribed token-for-token; the unit parents-and-tree
  criterion measures ordered parents plus a tree belonging to neither parent; `M-BOUND` is a genuine
  order swap that leaves the `bound` write in place (three of four S3 criteria stay green, the red is two
  different shas — §8.3 reproduced); `M-OPT` proved reachable twice; containment traced in code — the
  reconciled attempt is consumed as a **tree**, never as a parent, so neither it nor the conflicted
  commit is in the fetch closure.
Task 12: 🔴 Ruling: finding 1 — `S3.test.ts:103-111`'s every assertion is entailed by the selection
  filter that produced its input (`ps.length === 2 && ps[1] === incoming`), so the body cannot fail while
  its comment claims it measures that parent 0 is the W tip. A first-parent swap would leave all four
  green. **Fixed** by asserting against `git rev-list --first-parent <workBranch>` (must contain
  `parents[0]`, must not contain `incoming`) plus a **new named mutation swapping the first parent**,
  which must be seen red. — Cost if wrong: the scenario keeps a claim the unit criterion already carries.
Task 12: 🔴 Ruling: finding 2 — three new escalation branches have no reddening mutation. Decided branch
  by branch rather than as a block: **markers-remain** and **reconciliation-did-not-succeed** both get
  fixtures (the scripted adapter makes them cheap) and named mutations; **`otherSideOf`'s not-exactly-one
  match** is to be *attempted* first — a unit-level criterion if reachable, and if it proves unreachable
  by construction, **registered honestly as an unobservable branch** whose defence is code review, which
  this project has precedent for and which is worth more than faking a fixture. — Cost if wrong: one
  defensive guard is defended by review rather than by a criterion.
Task 12: Ruling: `run.ts:429-432` prints that the conflicted commit "stays in <copy>" while
  `disposeWorkdir` deletes that copy seven lines later. Graded Minor by the reviewer; **folded into the
  fix round anyway** — it is only false on the path where nobody needs it, which is exactly how a false
  message survives, and Rule 12 covers what the tool prints, not just what it returns.
Task 12: Ruling: `S3.test.ts:126-128`'s substitution of reachability-from-W for the brief's literal
  `allRefShas(targetRepo)` check is **upheld as the stronger measurement** — it catches the commit
  arriving under any ref and being merged — but must be recorded as a fourth deviation in the report.
Task 12: fix round 1/5 dispatched (implementer resumed) — 2 findings + 2 folded items.
Task 12: fix round 1/5 (4 addressed, 0 open; commits 36f2610..e93e907). Re-review confirmed the
  replacement parents criterion derives T1's sha from an **independent** locator call rather than reading
  it back from the commit under test, and that `M-EXTRAPARENT` keeps the fast-forward working while
  reddening exactly `expect(t2.parents[0]).toBe(t1.sha)`. The implementer was honest that
  `M-FIRSTPARENT` reddens by a crash and `M-CONFLICTPARENT` reddens the locator's own guard — neither
  isolates the target — before landing on the one that does. `otherSideOf`'s body is byte-for-byte
  identical after reshaping; only the parameter surface changed.
Task 12: Ruling: the re-review's out-of-scope note claiming S3 asserts `rc === 0` is **wrong**, and the
  controller measured it: `tests/scheduler/scenarios/S3.test.ts:91` is `expect(rc).toBe(2)`, exactly the
  S3 ruling. Second time this round a reviewer's incidental claim has failed verification — **reviewers
  are to be verified, not obeyed.**
Task 12: complete (commits a5c9d93..e93e907, review clean). `npm run verify` exit 0, 238 tests.
Task 13: dispatched (implementer, sonnet). BASE `e93e907`. Carries §5.4's escalation file and Task 9's
  deferred `boundary` criterion.
Task 13: implementer reported DONE — commit `7e9f3c5`. `npm run verify` exit 0; scheduler suite
  37 files / 131 tests; seven mutations run, each reddening its named criterion; worktree byte-identical;
  ccloop untouched at `7f2c5f6`.
Task 13: Ruling: `route.escalates` (a `blocked_waiting_human` run) **gets no escalation file**, upholding
  the implementer's judgement. Spec §5.4 sits inside §5, the conflict trunk, and the content it mandates
  — both sides' intent and the conflict blocks — **does not exist** for a blocked run: there are no two
  sides and no conflict. Fabricating them would be worse than omitting the file. That escalation is
  already served by exit 3 plus the printed copy path, which Task 10 landed. **Registered as a known
  gap** for the panel work rather than silently skipped. — Cost if wrong: a blocked run's operator gets
  the exit code and the copy path but no written summary.
Task 13: task review dispatched (sonnet) over e93e907..7e9f3c5.
Task 13: review ❌ (one branch of the escalation-file debt) / 0 Critical / 1 Important / 3 Minor / 1 ⚠️.
  Confirmed right: `exitCode.ts`'s `PRECEDENCE` table survives a future contribution value with
  non-monotonic severity, which `Math.max` could not; `roundExitCode` fully deleted, no inline reduction
  survives; "no mode where a failed task exits 0" measured against the pure function rather than by
  enumerating today's values; every generated `undo.how` checked with the **real** predicate rather than
  `validateLine`'s aggregate verdict, with `M-UNDO` proving that assertion non-redundant; the two-ledger
  criterion exercises the real `deriveRunId` with both real shapes; none of the six mutations reddens by
  crashing before its assertion.
Task 13: 🔴 Ruling: the Important finding — the **tier-0** escalation (out-of-bounds *and* colliding,
  §7.3's most severe branch) writes only the acting task's intent, while the colliding sibling's write
  set is sitting in scope one line above, passed inline to `disposition` and never bound. This is a
  direct shortfall against the debt's own "both sides' intent" requirement, on exactly the branch where
  a person most needs to know who the other party was; the other two escalation call sites do populate
  both sides. **Fixed**, reusing `intersect` rather than reimplementing the collision test, plus the
  assertion that would have caught it and a mutation that must redden **on that assertion, not by
  crashing earlier**. If a sibling cannot be identified, the file must say so rather than silently write
  one side — an escalation that quietly omits a party is worse than one that admits it could not tell.
  — Cost if wrong: the escalation file names one more party than strictly necessary.
Task 13: minor (deferred): boundary decisions commit one per decision while `edgeDecisions` batches;
  `otherSideOf`'s ambiguous branch has no dedicated fixture; `intentOfContract`'s "no goal" placeholder
  is unexercised; `conflictBlocks` changes shape by call site (a one-line comment was requested).
Task 13: fix round 1/5 dispatched (implementer resumed) — 1 finding sent.
Task 13: fix round 1/5 (1 addressed, 0 open; commits 7e9f3c5..fec384b). Re-review confirmed the sibling
  filter uses the **same** `normalizeClaim` + `intersect` pair `disposition` uses internally, differing
  only in aggregation (`.some` for a boolean vs `.filter` to name the keys), so the escalation file
  cannot disagree with the verdict that triggered it. `M-ESC-ONESIDE` reddens exactly the new
  `**T2**` assertion with the earlier assertions still green — not a crash. The undetermined-sibling
  path states plainly that a sibling exists but could not be re-identified rather than silently writing
  one side. The requested `conflictBlocks` comment is present.
Task 13: Ruling: the ⚠️ ("verify exit 0" unverified from the diff) is **settled by the controller's own
  run**: `npm run verify` exit 0, scheduler档 37 files / 131 tests, 9.07s.
Task 13: complete (commits e93e907..fec384b, review clean).
Task 14: dispatched (implementer, sonnet). BASE `fec384b`. Carries Task 8's deferred property.
Task 14: implementer reported DONE_WITH_CONCERNS — commits `5ef5dc6`, `e10a0f2`. Scheduler suite
  37->42 files, 131->141 tests, `npm run verify` exit 0 (22.48s). ccloop untouched.
  Self-caught: S16's first fixture used `/dev/zero`, which tripped git's binary-diff heuristic and would
  have let `M-BIGDIFF` pass by accident — replaced with repeating ASCII before the mutation was trusted.
Task 14: review ❌ / 0 Critical / 1 Important / 2 Minor. Confirmed right: `--serial` is one line and adds
  no scheduling policy; `seedDisjointPlan` was the **more correct** fixture than the brief's pseudocode,
  because an intersecting plan is already split across layers so flattening would show nothing; the
  deferred no-run-directory property is genuinely measured, with T1/T3 controls making the absence
  assertion mean "never created" rather than "created and cleaned up".
Task 14: 🔴 Ruling: the Important finding is **broader than the implementer disclosed** and the reviewer
  traced it structurally. All six S11/S12/S13 cases call `runCli(["run", planPath])` without
  `--adapter-config`; `loadRound` runs at `run.ts:526-530`, the adapter-config guard returns 1 at
  `:534-537`, and the first line that can touch the target repo is at `:586` — downstream of both. So
  deleting **any** rejection check yields the identical observable result the tests assert:
  **none of the six can fail**, and the only evidence that ever existed was in a probe script since
  deleted. Fixed by (a) passing a real `--adapter-config` so a broken check would reach
  `checkoutWorkBranch`, and (b) asserting each case's **own** rejection code so it cannot pass for a
  neighbouring reason. **One discriminating mutation is required, not six** — each check already has its
  own named unit-level mutation from the plan-loader task (M-P2-REL/DUP/CYC/IN/WB/POL, all seen red
  there); what these scenarios add is the end-to-end claim, and the mutation's staying-green half is what
  proves the assertions discriminate. — Cost if wrong: the end-to-end gate is proved once rather than six
  times, on top of six existing unit proofs.
Task 14: fix round 1/5 dispatched (implementer resumed) — 1 finding + a report correction.
Task 14: fix round 1/5 (1 addressed, 0 open; commits e10a0f2..edd6e49). Re-review re-traced the guard
  order with a real `--adapter-config` supplied and confirmed a deleted rejection check now genuinely
  reaches `checkoutWorkBranch` — confirmed live by `M-S12-POL` creating a new ref in the target repo.
  All six cases now assert their own `rejected: <code>:` string, so none can pass on another's output.
  `M-S12-POL` reddens S12 on `expect(rc).toBe(1)` (`expected 3 to be 1`, a normal return value, not an
  escaped exception) while S11 and all four S13 cases stay green — one discriminating mutation, both
  halves. The two dead-end mutations that crashed `buildGraph` before any assertion are recorded as
  **not** evidence, which is the honest framing.
Task 14: out-of-scope note: `land.ts:73-81` carries its own defence-in-depth `workBranch === defaultBranch`
  throw, so deleting the upstream check would still leave the repo untouched — via a different, also
  legitimate mechanism, and S11's assertions still redden, just with a different failure signature.
Task 14: complete (commits fec384b..edd6e49, review clean).
Task 15: dispatched (implementer, sonnet). BASE `edd6e49`. Final task: mutation re-run, verify tiering,
  this round's ledger, README.
Task 15: implementer reported DONE — commit `366ed92`. `npm run verify` exit 0, 49/49 files overall,
  42/42 files and 141/141 criteria in the scheduler gate. **All 16 mutations re-run** (the plan's 14 plus
  the controller-added `M-PLAN-WIRE` and `M-EXIT-RETURN`), each seen red on a **named** criterion, main
  worktree byte-identical afterwards. Ledger validates clean apart from the seven known historical
  downgrades. Two concerns: `README.md` did not exist anywhere in this repo's history and was created
  fresh at the root rather than escalating (reversible, so decided under Rule 1's ladder); and the
  "no `verify:fast` tier needed" call rests on the pre-commit hook's current narrow scope.
Task 15: task review dispatched (sonnet) over edd6e49..366ed92.
Task 15: review ✅ spec compliant, 0 Critical / 0 Important / 2 Minor. The reviewer independently
  verified the twelve §10.4 gaps line-by-line against the spec (all present, none dropped or diluted),
  confirmed the pre-commit hook's actual scope matches the "no new tier needed" claim rather than
  assuming it, checked each of the six ruling-decisions carries its **reason** and a real rejected
  alternative rather than only an outcome, and confirmed no pre-existing `.decisions` line is modified.
Task 15: minor (deferred): `M-C`'s row names an aggregate symptom rather than one `it(...)` title, the
  only row in the table that does not let a reader point at a single named assertion; and README gap #4
  adds an interpretive clause beyond the spec's wording (defensible, since the README is English by
  convention and a literal Chinese copy would violate it, but it is translation-with-elaboration).
Task 15: complete (commits edd6e49..366ed92, review clean).

## All 15 tasks complete. Final whole-branch review dispatched over e60c2a2..366ed92.

## Final whole-branch review (opus): 0 Critical / 7 Important / 12 Minor. Verdict: merge with fixes.

It confirmed the three design principles hold in shipped code rather than in comments — including that
**no path short-circuits on "declared disjoint"**, which is principle 2's whole point — that layering is
genuinely enforced (layer ① imports only `node:path`, `zod` and each other; the `planFile ↔ graph` cycle
is `import type` and erased at runtime), and that **no subprocess uses a shell**: every one is
`execFile`/`spawn` with an argv array, and it traced every plan-file string reaching a git argument
looking for argument injection and found no hole.

Final-review Ruling: 🔴 **the reviewer showed one of my rulings was decided on a false premise, and I am
reversing it.** I ruled that a `blocked_waiting_human` run gets no escalation file because §5.4's
mandated content — both sides' intent and the conflict blocks — does not exist for it. But
`writeEscalationFile` already handles exactly that shape (`sides: []` renders "no side's declared intent
is known", `conflictBlocks: []` renders "not about a merge conflict"), and **the round-exception path
already uses that degraded form**. So the machinery exists, is exercised, and is deliberately used for
the other non-conflict escalation; giving one non-conflict escalation a file and not the other is
arbitrary. ⇒ **A blocked run now writes the escalation file too**, and the ledger decision recording the
original ruling gets a correction rather than an edit. — Cost if wrong: one more file written on a path
where the log alone might have sufficed.

Final-review Ruling: Important 7 is split. **Printing the base branch and sha in the plan report is
done now** — §9.4 makes `plan` the picture a human approves, and today that picture omits the round's
starting point, which is the single most consequential fact about it. **Resolving the repository's true
default branch is NOT done now**: `defaultBranch` is derived from `git symbolic-ref --short HEAD`, which
is factually the base, so the fix is to stop *calling* it the default branch in code and README and to
print the substitution, not to change the behaviour late in a branch whose criteria are built on it.
Registered as a follow-up. — Cost if wrong: a run started from a feature branch cuts W from that branch,
which is now printed rather than silent.

Final-review Ruling: Important 6 (no concurrency cap, and `Promise.all` discarding a whole layer on one
task's exception) is **a spec-to-plan drop, not an implementer miss** — spec §1.3 says v1 uses a fixed
upper bound and the plan never carried it forward. Fixed with a small fixed pool and `allSettled`.

## Fix-wave scoped re-review (opus): all findings ADDRESSED, no new Critical/Important.

It verified independently that no previously-passing criterion was weakened — it extracted every removed
`-` line touching an assertion or a call under test and accounted for each one — and that the fix wave's
own self-caught regression (a new Base line silently satisfying `roundFailure`'s whole-stdout assertion)
was properly scoped, sweeping the whole test tree for the same shape and finding no other instance.

### Residual adjudications — no second fix wave (skill rule); these are parked with rulings

Ruling: **parked — `PLAN_LEVEL_CHECKS` is consumed by positional destructuring** (`planFile.ts:49-57`).
  Reordering the array silently rebinds every code name to a different message
  (`[fail] relative-path: duplicate taskId: T3`), and the anti-drift criterion compares sorted **sets**,
  so it cannot see a permutation. Real, but it needs a future edit to trigger and it produces a visibly
  wrong *label* rather than a false `[pass]`. A keyed record instead of positional destructuring closes
  it. — Cost if wrong: one mislabelled line in the report until someone reorders the array.

Ruling: **parked — the pool created a state that did not exist before**: tasks queued but not yet
  launched. `stopRound` is consulted only at layer boundaries, so a `cancelled` result from an early task
  does not stop the pool from launching the layer's fifth and later tasks. Near-unreachable in practice
  (README limitation 7: `cancelled` comes from a stop signal to the whole process group, which takes orca
  down with it), but the invariant "stop launching new tasks" is now **expressible and unenforced**. A
  flag checked at the top of the pool's worker closes it. — Cost if wrong: on a signal that somehow
  spares orca, up to three more tasks launch than should.

Ruling: 🔴 **parked and promoted to the top follow-up — a fabricated `[pass]` already exists.**
  The re-review found that for a `targetRepo` that is not a git repository, `preflight.ts:20-28`'s
  `refIsKnown` swallows its error and the report prints **`[pass] work-branch-already-exists`** beside two
  genuine failures. This predates the wave and is out of its scope, but it is *exactly* the shape finding
  B6 was about — a false green line in the report a human approves from — and it also undercuts the
  reasoning offered for reusing the `dirty-worktree` code. It should be the first thing the next round
  fixes. — Cost if wrong: an approval report can show a check passing that was never evaluated.

Ruling: **the §9.1(4) "nine checks" erratum is filed incompletely** — recorded in the README and in
  `planReport.ts`, but the spec still says nine in three places with nothing pointing at the correction,
  and this repository's own precedent (commit `docs(spec): record two errata …`) is to record errata **in
  the spec**. ⇒ **Folded into the erratum pass the controller already owes** the spec and the plan, rather
  than parked. — Cost if wrong: a spec reader counts nine and finds ten.

Ruling: **parked — `land.ts:66`'s comment still describes `M-MAIN` as a single-guard mutation** without
  pointing at its documented second half at `:118`. The mutation table itself was verified **accurate**
  (Task 10's report names two guards and its literal patch deletes both); only the one-line summaries are
  terse. — Cost if wrong: a reader re-running `M-MAIN` from that comment alone sees it not redden and
  mistakes it for lost coverage — which is exactly what happened to the fix-wave implementer.

### Deviation from the skill, taken deliberately

The skill ends by deleting the plan's workspace, on the reasoning that git history is then the record.
**Not done.** This repository's own precedent (the A′ round) commits `progress.md`, `final-fix-report.md`
and every `task-N-report.md` with `git add -f`, and leaves the review diffs and briefs out because the
first are regenerable by `git diff` and the second by `scripts/task-brief`. Deleting a 700-line ledger of
38 rulings that the repo's convention says to preserve would destroy the record rather than hand it over.
`CLAUDE.md` Rule 11 puts the repository's convention above the skill's default.
