# Task 1 report — ccloop answers the v2 eight-field capability vocabulary

Repo: `/Users/biran/code/skills/loop/ccloop`, branch `main`.
Starting HEAD: `6b3f1d6` (clean tree). Final HEAD: `f9727a1` (clean tree, 1 commit ahead of
`origin/main`, not pushed).

## What changed

- `src/control/command.ts`:
  - `capabilitiesSchema`: `protocol: z.literal(1)` → `z.literal(2)`; removed
    `durableAccept`/`ownershipIsolation`/`evidenceRetention` (booleans) and
    `requestBoundEvidence` (`string|null`); added `contextObservation`,
    `handoffControl`, `handoffExecution`, `contextWindowTokens`, and
    `requestBoundProof` (the strict nullable descriptor object), all exactly as
    specified in the brief's Step 3. `budgetEnforcement`'s third enum value
    changed `"unsupported"` → `"unavailable"`.
  - `defaultHandler`'s `method === "capabilities"` branch: returns the new
    eight-field object verbatim (protocol 2, usageObservation "phase-end",
    budgetEnforcement "soft", contextObservation "unavailable", handoffControl
    "durable", handoffExecution "mechanical-in-run-v1", contextWindowTokens
    null, requestBoundProof null).
  - No comment in this file described the old seven-field answer (the file has
    zero `//`/`/* */` comments — confirmed by `grep -n "^\s*//\|/\*"`, 0
    matches), so no ERRATUM append was needed or made.

- `tests/control/command.test.ts`:
  - Rewrote in place the named criterion
    `it("routes the real CLI through control before legacy parsing and emits one JSON value")`
    to assert the exact v2 eight-field object via `toEqual` (kept `toEqual`,
    kept the real-CLI route via `runCli`, kept `result.stderr === ""`, kept the
    one-line-stdout assertion). Added an English comment immediately above the
    `it(...)` stating this rewrite is authorized by the human (2026-09-24,
    "task 1 3 5 6 都同意授权") for G1 seam A Task 1, and citing
    `docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md §5.1`.
  - No other test was added or modified. `does not print until a handler
    result passes the response schema` was left untouched and verified still
    green (see GREEN evidence — 7/7 passed, including this one).

## RED evidence (before implementation)

Command:
```
cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 \
  ./node_modules/.bin/vitest run tests/control/command.test.ts > $SP/t1-red.log 2>&1; \
  echo "RC=$?" >> $SP/t1-red.log
```
Result (`$SP/t1-red.log`), read back whole:
```
 ❯ tests/control/command.test.ts (7 tests | 1 failed) 1003ms
   × control command boundary > routes the real CLI through control before legacy parsing and emits one JSON value 956ms
     → expected { protocol: 1, …(6) } to deeply equal { protocol: 2, …(7) }
...
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
RC=1
```
Exactly the rewritten criterion failed; the other 6 tests (including "does not
print until…") stayed green.

## GREEN evidence (after implementation)

Command: same as above, run again after editing `command.ts`.
Result (`$SP/t1-green.log`):
```
 ✓ tests/control/command.test.ts (7 tests) 521ms
   ✓ control command boundary > routes the real CLI through control before legacy parsing and emits one JSON value 482ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
RC=0
```

typecheck: `npm run typecheck` → RC=0 (`$SP/t1-typecheck.log`, re-confirmed
after mutation cleanup at `$SP/t1-typecheck-final.log`, RC=0).
build: `npm run build` → RC=0 (`$SP/t1-build.log`; re-confirmed at
`$SP/t1-build-final.log`, RC=0).

## Python scan output (Step 3, `unsupported` → `unavailable`)

Scanned line-by-line with Python (not grep), excluding `node_modules`, `.git`,
`dist`, `reference/`, over the whole repo tree. Full output at
`$SP/t1-scan-unsupported.log` (45 hits total). Every hit outside `docs/**` and
`.superpowers/sdd/**` (which are historical/spec text, not touched) is either
an unrelated identifier (`control-protocol-unsupported`,
`control-adapter-unsupported`, "rejects a contract with unsupported ... fields",
"unsupported persisted truth") or the one real hit:

```
./src/control/command.ts:34:    budgetEnforcement: z.enum(["bounded", "soft", "unsupported"]),
```

That is the only production-code occurrence of the `budgetEnforcement`
enum literal `"unsupported"`, and it has been changed to `"unavailable"`.

I also ran a second Python scan for the v1 field names
(`durableAccept`, `ownershipIsolation`, `evidenceRetention`,
`requestBoundEvidence`) to double-check the controller's claim that old-
vocabulary hits outside docs/spec history live only in `src/control/command.ts`
and `tests/control/command.test.ts`. Full output at
`$SP/t1-scan-oldfields.log` (31 hits total). Confirmed: every hit outside
`docs/**` is in exactly those two files, and both have now been updated.

## Mutation table (Steps 5–6)

Clone: `/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop
$SP/t1-mut`; `node_modules` symlinked from the main tree. Since the
implementation was not yet committed at mutation time, I proved byte-identity
by `cat`-ing the two changed working-tree files into the clone and diffing
(`$SP/t1-diff-command.log`, `$SP/t1-diff-test.log`: both empty, RC=0).

GREEN baseline in the clone (`tests/control/command.test.ts` only):
`$SP/t1-mut-baseline-green.log` — 7 tests passed, RC=0.
Baseline sha256 of `src/control/command.ts` in the clone:
`cde02f6d12ecf909c5d6447ac3dc4542c75e54ddc1c753cfaceccb64923af123`
(`$SP/t1-sha-baseline.log`).

| Mutation | sha256 before | sha256 after | differ? | Test run | Assertion that reds |
|---|---|---|---|---|---|
| M1: `protocol: 2,` → `protocol: 1,` in the `defaultHandler` capabilities return | `cde02f6d...af123` | `a63cb908...babbbe` | yes | `$SP/t1-mut-m1.log`, RC=1, 1 failed/6 passed | `expect(result.code).toBe(0)` — the mutated payload fails the (still-`z.literal(2)`) `capabilitiesSchema.strict()` parse inside `validateResponse`, so the CLI returns `control-response-invalid` with code 1 before the test's `toEqual` line is ever reached. The named criterion still turns red overall. |
| M2: extra field `durableAccept: true,` added to the `defaultHandler` capabilities return | `cde02f6d...af123` | `0e41be74...2cdac` | yes | `$SP/t1-mut-m2.log`, RC=1, 1 failed/6 passed | Same assertion, same reason: the `.strict()` schema rejects the extra field at the CLI's own response-validation boundary before the response is ever printed, so `result.code` is 1, not 0. |

Restore proof: after each mutation, `cat $SP/t1-pristine/command.ts.pristine >
$MUT/src/control/command.ts`; sha256 back to `cde02f6d...af123` both times
(`$SP/t1-sha-m1-restored.log`, `$SP/t1-sha-m2-restored.log`), and a final
`diff` against the pristine copy after M2's restore is empty
(`$SP/t1-diff-restore-final.log`, RC=0).

**Concern to flag** (not a blocker, but worth recording): both mutations are
caught by the CLI's own `.strict()` zod validation on the response, one
assertion *before* the test's `expect(JSON.parse(result.stdout)).toEqual(...)`
line. So while the named criterion does turn red for both M1 and M2 as
required, this run does not by itself demonstrate that the test's own
`toEqual` (as opposed to a hypothetical `toMatchObject`) is what's carrying
the weight — the schema's `.strict()` at the production boundary gets there
first. I did not attempt an M3-style mutation (e.g. dropping the schema's
`.strict()`) to isolate that, since it wasn't authorized by the brief/ruling;
flagging per Rule 9's warning that "which assertion reds" isn't automatically
informative once an earlier assertion can short-circuit.

Main tree zero-touch proof: `/usr/bin/git -C
/Users/biran/code/skills/loop/ccloop diff --cached | wc -c` = 0 both before
mutation testing began (`$SP/t1-pre-mutation-status.log`: "no changes added to
commit") and after (`$SP/t1-maintree-diff-after.log`: 0). The unstaged
`git diff` was 3561 bytes both before and after (that's the legitimate Step
3/4 implementation, present the whole time since the commit happened only
after mutation testing per the brief's step order); I additionally diffed the
live main-tree copies of both changed files against the pristine snapshot
taken right before cloning and both are byte-identical
(`$SP/t1-maintree-untouched-proof.log`, both RC=0/empty), which is the
stronger proof that nothing in the main tree moved during the mutation window.

Cleanup: `/bin/rm -f $SP/t1-mut/node_modules` then `/bin/rm -rf $SP/t1-mut`;
confirmed deleted (`$SP/t1-mut-dir-check.log`: "DELETED").

## Full suite + check-known-reds + typecheck + build (Step 7)

```
export ECC_GATEGUARD=off DISABLE_OMC=1
./node_modules/.bin/vitest run --reporter=json --outputFile=$SP/t1-full.json > $SP/t1-full.log 2>&1
echo "RC=$?" >> $SP/t1-full.log       # RC=1 (a standing known red, expected)
node scripts/check-known-reds.mjs $SP/t1-full.json > $SP/t1-known.log 2>&1
echo "RC=$?" >> $SP/t1-known.log      # RC=0
```

`$SP/t1-known.log` contents:
```
known reds in roster: 13
failed: 1
  known  quiet execution proof > does not treat leader exit as group quiet and proves only after the full tree is gone
unexpected: 0
RC=0
```
`unexpected: 0` and `RC=0` — this is the pass criterion per the brief, and it
matches the standing known red noted in the task instructions.

typecheck (post-mutation-cleanup, pre-commit): `$SP/t1-typecheck-final.log`,
RC=0. build: `$SP/t1-build-final.log`, RC=0.

## Files changed

- `/Users/biran/code/skills/loop/ccloop/src/control/command.ts`
- `/Users/biran/code/skills/loop/ccloop/tests/control/command.test.ts`

Commit: `f9727a1` "feat(control): answer the v2 eight-field capability
vocabulary" on `main`. Working tree clean afterward; local branch is 1 commit
ahead of `origin/main` (not pushed, per instructions).

## Concerns

1. The mutation table's "which assertion reds" is `expect(result.code).toBe(0)`
   for both M1 and M2, not the `toEqual` line — see the concern noted inline
   in the mutation table above. The named criterion does turn red for both
   mutations, satisfying the letter of Steps 5–6, but the specific claim in
   the original brief comment ("多答一个字段必须红，否则删不掉那三个布尔就没人
   发现") is actually enforced by the schema's own `.strict()` at the
   CLI-response-validation boundary, one layer below the test's `toEqual`.
   Both layers agree here, so there's no live gap, but it's worth someone
   downstream knowing that the redundancy exists two levels deep (schema +
   test), not one.
2. No comment describing the old seven-field answer existed in `command.ts`
   (file had zero comments before this change), so the "append an ERRATUM"
   instruction in the task did not apply — nothing was skipped, there was
   simply nothing to erratum.
3. Per spec §6/§7 (read for context, not part of this task's scope), the
   downstream consequence — `contextWindowTokens: null` making every Web
   group's budget estimate `estimate-blocked-capability` in Orca — is
   explicitly out of scope for Task 1 and is Orca's problem to carry forward
   in later G1 seam-A tasks. Flagging only so it isn't lost.
