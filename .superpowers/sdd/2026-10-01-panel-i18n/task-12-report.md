# Task 12 report: the round's gate

Who: gate subagent of session e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1 (controller-dispatched). When: 2026-10-01, 07:05-07:28 local.
Scope: this round = loop-plan follow-ups W1-W7 and the panel-i18n plan (commits after 9d4a335).
Nothing in the Orca or ccloop main trees was modified, committed or pushed; everything ran in fresh `git clone --local` copies.

## Content anchors

- Orca clone HEAD: `2bcd2b0677383c71b46352a7aa6b1cbce33d8233 test(web): let the pseudo-locale see values interpolated into a translation`
- ccloop clone HEAD: `bd8a995f9c588ec5ad0d37761198b278fa30762b docs(handoff): stop naming #13(a) as the next thing in the title line; it has landed`

(Measured by `git log -1 --format='%H %s'` inside each clone; files `$G/or-head.txt`, `$G/cc-head.txt`.)

## Environment

- Script: `$S/gate-final.sh` (adapted from session 1d7d9aa0's `gate2.sh`; its `rm -rf $F` was replaced by a refusal if the directory already exists).
  `S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`, `G=$S/gate-final`.
- Clones: `$G/cc` (ccloop local main), `$G/or` (Orca local main); `node_modules` (and Orca `web/node_modules`) symlinked to the main trees'.
- `HOME=$G/home`, `XDG_{CONFIG,DATA,STATE,CACHE}_HOME=$G/xdg/{config,data,state,cache}`, `ECC_GATEGUARD=off DISABLE_OMC=1`.
- `TMPDIR` root `/private/tmp/cl-fCPl` (from `mktemp -d /private/tmp/cl-XXXX`), per-step 0700 subdirs `cc`, `or`, `web`, `panel`, `pin`.
- Agents table `$G/agents/agents.json`: mode `-rw-------` in dir `drwx------` (measured by `stat -f '%Sp %N'`); codex installation, command `[node, $G/cc/tests/fixtures/fake-codex.mjs, "integration", $G/agents/marker.json]`, version `9.9.9-fake`. `ORCA_AGENTS_TABLE` points at it.
- `ORCA_CCLOOP_BIN=$G/cc/dist/cli.js`.
- Test runs used `npm test -- --reporter=default --reporter=json --outputFile.json=<file>` (one run gives both the printed counts and the JSON).

## Results (fresh clones)

| step | command | RC | counts as printed |
|---|---|---|---|
| ccloop clone | `git clone --local` | 0 | |
| ccloop build | `npm run build` | 0 | |
| ccloop typecheck | `npm run typecheck` | 0 | |
| ccloop full test | `npm test` (json) | 1 | `Test Files  2 failed \| 97 passed (99)`; `Tests  2 failed \| 1085 passed (1087)`; JSON: suites 273 (270 passed, 3 failed), tests 1087, passed 1085, failed 2, pending 0, todo 0 |
| ccloop known reds | `node scripts/check-known-reds.mjs cc.json` | 0 | `Known reds in roster: 14`, `failed: 2`, both `known`, `unexpected: 0` |
| ccloop tmp leak | `node scripts/check-tmp-leak.mjs` | 0 | `vitest exit 1, 1087 tests, 0 entries left in /private/tmp/cl-fCPl/cl-gJiYGL` |
| Orca clone | `git clone --local` | 0 | |
| Orca web build | `npm run build --workspace web` | 0 | `91 modules transformed`, built in 733ms |
| Orca typecheck | `npm run typecheck` | 0 | |
| Orca full test | `npm test` (json) | 1 | `Test Files  2 failed \| 260 passed (262)`; `Tests  3 failed \| 2353 passed \| 3 skipped (2359)`; JSON: suites 709 (705 passed, 4 failed), tests 2359, passed 2353, failed 3, pending 3, todo 0 |
| web check | `npm run check --workspace web` | 0 | `Test Files  53 passed (53)`; `Tests  316 passed (316)` |
| verify:panel | `npm run verify:panel` | 0 | PASS 0 … PASS 14 (15 of 15 PASS) |
| verify:ccloop-pin | `npm run verify:ccloop-pin` | 0 | `{"total":3,"passed":3,"failed":0,"skipped":0}` |
| Orca tmp leak | `node scripts/check-tmp-leak.mjs` | 0 | `vitest exit 1, 2359 tests, 0 entries left in /private/tmp/cl-fCPl/cl-LMUB5p` |

The 3 skipped Orca tests are `tests/control/ccloopDefaultE2E.test.ts` (skip when `ORCA_CCLOOP_BIN` is set); `verify:ccloop-pin` runs that file and it passed 3/3.

Note: `check-tmp-leak.mjs` runs the whole suite a second time (its own vitest, JSON report deleted afterwards). Its `vitest exit 1` says that second run also had reds; which tests is not recoverable from its output (the script prints only the exit code). Its RC 0 means only "nothing left in TMPDIR".

### Reds in the full runs

ccloop:
- `tests/control/stopProof.test.ts > quiet execution proof > does not treat leader exit as group quiet and proves only after the full tree is gone` — `Test timed out in 5000ms`. The known stable red.
- `tests/validation/codexWatchdog.test.ts > matches historical double-space start identities on single-digit days` — `Matcher did not succeed in 1500ms` (poll timeout at line 25). Not in the controller's flake list, but `check-known-reds` classifies it as `known` (in the roster). Rerun alone 3/3 green (below) ⇒ load flake, not a regression. Unusual: its name mentions single-digit days and today is 2026-10-01; it passed three times on that same date, so the date is not what failed it here.

Orca:
- `tests/control/driverLanding.test.ts > D: landing on orca/<group> (spec §5.1-§5.2) > X1: lands while the person has orca/<group> checked out, leaving their files and index alone` — timed out in 5000ms. Known flake.
- `tests/control/driverLanding.test.ts > D: landing on orca/<group> (spec §5.1-§5.2) > leaves the branch alone when it moved between the merge and the swap, and lands on the new tip next round` — timed out in 5000ms. Known flake.
- `tests/panel/controlShutdown.test.ts > a real SIGTERM to a real panel > makes it exit cleanly, having written one shutdown row for its epoch` — `expected 143 to be +0` (line 126). Known flake.

### Single-file reruns in the gate clones (script `$S/gate-reruns.sh`, same environment, TMPDIR root `/private/tmp/cl-bW80`)

| file | run 1 | run 2 | run 3 | counts each run |
|---|---|---|---|---|
| ccloop `tests/validation/codexWatchdog.test.ts` | RC 0 | RC 0 | RC 0 | `Tests  2 passed (2)` |
| Orca `tests/control/driverLanding.test.ts` | RC 0 | RC 0 | RC 0 | `Tests  5 passed (5)` |
| Orca `tests/panel/controlShutdown.test.ts` | RC 0 | RC 0 | RC 0 | `Tests  6 passed (6)` |

Uptime during reruns: `07:27 load averages: 9.99 17.02 16.24` (first start) … `7.52 15.40 15.69` (last end). The reruns script also re-ran both tmp-leak checks: ccloop RC 0 (`vitest exit 1, 1087 tests, 0 entries left`), Orca RC 0.

### Uptime during the full runs

```
start          7:06  load averages: 5.35 7.13 7.29
cc-test-start  7:06  load averages: 7.07 7.42 7.39
cc-test-end    7:07  load averages: 33.30 15.40 10.39
or-test-start  7:08  load averages: 35.10 20.34 12.67
or-test-end    7:17  load averages: 7.24 15.10 13.91
end            7:26  load averages: 11.34 17.74 16.48
```
The ccloop full run drove the 1-minute load to 33; the Orca run started at 35. All the reds are timing reds under that load.

## Real ~/.orca

Recorded before anything moved `HOME` and after the last step: `ls -la /Users/biran/.orca` plus `stat -f '%N %Sp %m %c %z %i'` of every entry (`find`). `cmp` RC 1, `diff` (`$G/orca-diff.txt`):

```
3c3
< drwxr-x---+ 175 biran  staff  5600 Oct  1 07:05 ..
---
> drwxr-x---+ 175 biran  staff  5600 Oct  1 07:26 ..
```
The only differing line is `..`, i.e. `/Users/biran` itself (the listing format included the parent directory; its mtime changed during the run for reasons outside `~/.orca`). Every `~/.orca` entry (10: the dir, `reviews.jsonl`, `control/`, `control/orca-e0c92460/` and its 6 entries) has identical mode, mtime, ctime, size and inode before and after. ⇒ `~/.orca` unchanged.

## Verdict

PASS. Every step RC 0 except the two full test runs, whose reds are the ccloop stable red (stopProof), one ccloop roster-known timing red (codexWatchdog, 3/3 on rerun), and known Orca load flakes (driverLanding, controlShutdown), each 3/3 green alone. No suspected regression.

Scratch paths for the human (deleting them needs the human): `$G` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad/gate-final`, TMPDIR roots `/private/tmp/cl-fCPl`, `/private/tmp/cl-bW80`.

## Re-gate at c73b220

Who: the same gate subagent (session e604b1ba), at the controller's request after the fix wave. When: 2026-10-01, 07:38-07:56 local.
Orca part only, in a new fresh `git clone --local` of Orca local main at `$G/or2`; same environment (HOME, XDG roots, agents table, `ECC_GATEGUARD=off DISABLE_OMC=1`) and the same ccloop clone build (`ORCA_CCLOOP_BIN=$G/cc/dist/cli.js`; ccloop unchanged). Script `$S/regate.sh`, outputs in `$G/regate/`, TMPDIR root `/private/tmp/cl-gFkZ`.

### Content anchors

- Orca clone HEAD: `c73b22040489b9f81244720bd839ae1f895721a7 fix(web): show an unknown label source as sent; correct stale criterion text` (the fix wave: `0698645 fix(control): keep a label-chosen loop task's chosenBy on a budget-only change`, `c73b220`, on top of `2bcd2b0`).
- ccloop clone HEAD (reused build): `bd8a995f9c588ec5ad0d37761198b278fa30762b docs(handoff): stop naming #13(a) as the next thing in the title line; it has landed`

### Results

| step | command | RC | counts as printed |
|---|---|---|---|
| Orca clone | `git clone --local` | 0 | |
| Orca web build | `npm run build --workspace web` | 0 | `91 modules transformed`, built in 739ms |
| Orca typecheck | `npm run typecheck` | 0 | |
| Orca full test | `npm test` (json) | 1 | `Test Files  1 failed \| 262 passed (263)`; `Tests  1 failed \| 2358 passed \| 3 skipped (2362)`; JSON: suites 711 (709 passed, 2 failed), tests 2362, passed 2358, failed 1, pending 3, todo 0 |
| web check | `npm run check --workspace web` | 0 | `Test Files  54 passed (54)`; `Tests  318 passed (318)` |
| verify:panel | `npm run verify:panel` | 0 | PASS 0 … PASS 14 (15 of 15 PASS) |
| verify:ccloop-pin | `npm run verify:ccloop-pin` | 0 | `{"total":3,"passed":3,"failed":0,"skipped":0}` |
| Orca tmp leak | `node scripts/check-tmp-leak.mjs` | 0 | `vitest exit 1, 2362 tests, 0 entries left in /private/tmp/cl-gFkZ/cl-zjB2Wq` |

Skipped 3: `tests/control/ccloopDefaultE2E.test.ts` (as in the first run; covered by verify:ccloop-pin, 3/3).

Only red: `tests/control/driverRecovery.test.ts > a person's recovery-retry on a blocked driver run (spec §2.3) > drives a retried run on from where it was blocked, to settled` — `Test timed out in 5000ms`. Known load flake. Rerun alone in `$G/or2` (TMPDIR root `/private/tmp/cl-SlZC`, left empty): RC 0, 0, 0; each `Tests  8 passed (8)`; load averages at the reruns `3.87 9.00 12.18` … `5.09 9.10 12.18` (07:56).

The first run's reds (driverLanding, controlShutdown) did not recur here.

### Uptime

```
start          7:38  load averages: 6.57 12.01 14.93
or-test-start  7:38  load averages: 6.03 11.71 14.79
or-test-end    7:47  load averages: 5.30 9.95 13.25
tmpleak-start  7:47  load averages: 10.82 11.05 13.53
end            7:56  load averages: 4.52 9.83 12.61
```

### Real ~/.orca

This time recorded with `ls -lA` (no `.`/`..` lines, so the parent's mtime no longer enters the record) plus the same per-entry `stat`. `cmp` RC 0: byte-identical before and after (10 entries, same mode, mtime, ctime, size, inode as in the first run's records).

### Verdict (re-gate)

PASS. Every step RC 0 except the full test run, whose single red is the known load flake driverRecovery, 3/3 green alone. No suspected regression.

Additional scratch paths for the human: `$G/or2`, `$G/regate`, `/private/tmp/cl-gFkZ`, `/private/tmp/cl-SlZC`.
