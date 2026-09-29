# #13(a), #13(b) and the ccloop re-pin script — round ledger (session `1d7d9aa0`, 2026-09-29/30)

> Append-only. Corrections go in a new section; the original text stays verbatim (Rule 13).
> Source: `docs/handoff/handoff.md` §4.0, "⛔ 下一会话按这个顺序做", items 1 and 2.
> All paths under `$S` mean this session's scratchpad,
> `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`.

## §1 Authorisation

- Human, session `2f65a729`: "#13(a)/(b) 改测试部分同意" (rewrite the named existing criteria), and "同意" to the pin script plus the gate step; re-pinning is the agent's after the human pushes ccloop.
- Human, this session: "同意，继续" to the listed order.
- Not authorised and not done: push, paid calls, deleting data, killing processes, a real re-pin commit (ccloop's new commit is not on GitHub).

## §2 Start-of-session remote check (`/usr/bin/git ls-remote origin refs/heads/main` vs local HEAD)

- Orca: remote = local = `9d3c56a`. ccmem: remote = local = `5ed049d`.
- ccloop: remote `926d74f`, local `b1bb6db` — one local-only commit, `docs(handoff): the Orca line's twenty-second version …` (handoff only).

## §3 #13(a) — ccloop commit `fix(agents): refuse a claude model that carries the [1m] context suffix itself`

- Executed plan `docs/superpowers/plans/2026-09-29-backlog-hardening.md` Task 7 as written. The plan's `tests/agents/registry.test.ts:56-61` had moved to `:59-63` (measured before editing).
- `[1m]"` literal scan over ccloop `tests` and `src`: every other hit is an argv OUTPUT (`claude-opus-5-5[1m]` built from contextWindow 1M) or a runner env value, not a selection input; none changed colour.
- Rewritten criterion: "sonnet[1m]" removed from the array; the name "accepts opaque models it cannot interpret, including aliases with a [1m] suffix and 200 characters" became "… including 200 characters", because the old name would state something false. `git grep` of the old name in both repos: only historical records (sdd ledgers, an old plan, handoffs).
- Red first: new file red at `["claude-opus-5-5[1m]", "agent-default", null]`. Green: the five files of Task 7 Step 4, 65 passed; typecheck RC 0.
- Mutations in `$S/t7/mut` (clone --local, working files copied with `cat`, `cmp` before and after):
  - M7-1 delete the whole `if` block → red, `claude-opus-5-5[1m]` / `agent-default` / `null`.
  - M7-2 drop the `i` flag → red at `claude-opus-5-5[1M]`.
  - Control: new code + the OLD registry criterion → red, `AgentError: agent-context-unsupported … "sonnet[1m]"` — the rewrite was necessary.

## §4 #13(b) — Orca commit `fix(control): count an unusable frozen killGraceMs as its 60 s ceiling, not 0`

- `handoffGraceMsOf` fallback 0 → 60_000 (the frozen slot's max, `webProtocol.ts` `killGraceMs: safeInteger.max(60_000)`). The published doc comment is kept verbatim with a named ERRATUM appended.
- Rewritten (authorised): `tests/panel/assemblyHandoffGrace.test.ts` "is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable" → renamed "… and the ceiling's grace when killGraceMs is unusable", unusable inputs expect 120_000; `tests/control/agentFreeze.test.ts` "judges a handoff's grace by the run's frozen killGraceMs plus the fixed extra" (name unchanged, still true), unusable inputs expect 120_000.
- Red first against the old code: both red, `expected 60000 to be 120000`. That run IS the deletion mutation of the new fallback (fallback back to 0). Green after the change; typecheck RC 0. `handoffE2E` skipped outside the gate (needs `ORCA_CCLOOP_BIN`); it passed in the gate (§6).

## §5 Pin script and gate step — Orca commit `build: re-pin ccloop by script, and let the gate run the default-ccloop E2E`

- `scripts/pin-ccloop.mjs <sha>`; `scripts/verify-ccloop-pin.mjs` (also `npm run verify:ccloop-pin`, now inside `npm run verify` right after the web build).
- Two deliberate departures from plan C Task 5 Step 3 and its correction section, both because the plan was written for a first pin:
  1. Check 2 allowed only ADDED ccloop lock entries; on a re-pin `node_modules/ccloop` CHANGES. Rule now: every differing lock key is `""`, `node_modules/ccloop`, or under it.
  2. Correction item 4 cloned the committed state before the commit, so `npm ci` would reproduce the OLD lock and pass vacuously. The script copies this tree's `package.json` and lock into the clone first, and also requires the clone's hidden lockfile (`node_modules/.package-lock.json`) to resolve the new commit.
- `tests/scripts/pinCcloop.test.ts`: 15 criteria, real script in a throwaway repo, fake `npm` on PATH and fake `node_modules/.bin/vitest`.
- Mutations in `$S/pin/mut` (harness `$S/pin/mutate.py`, output `$S/pin/mutations2.txt`): 18 deletion mutations P1–P14, V1–V4, every one red on the predicted criterion; files restored (`cmp`). First pass had P5 (symlink branch) GREEN: the fake linked to an EMPTY directory, so the "built" branch refused it first. The fake now links to a complete built package; P5 then red.
- Real run with real npm (`$S/pin/real`, a clone with its OWN `npm ci`'d node_modules — not the symlinked one, which would write through to the main tree): `node scripts/pin-ccloop.mjs 927bbfe979b0da8406b095d35e0f280f6768ca5b` (on GitHub, carries `0b31ea8`) → RC 0, all seven checks `ok`; lock differing keys `["","node_modules/ccloop"]`; E2E 12/12; changes stayed in that clone. Output `$S/pin/real-pin.txt`.
- Honest scope: the gate step catches only what `ccloopDefaultE2E` exercises (package layout, `orca agents init/show`, a panel boot), not every wire-protocol change.

## §6 Gate (`$S/gate.sh`, outputs `$S/gate/`)

Fresh `clone --local` of each repo; HOME and four XDG roots relocated; TMPDIR `mktemp -d /private/tmp/cl-XXXX`; fixture table fake codex `integration`; `ORCA_CCLOOP_BIN` = the ccloop clone's build.

- ccloop (content = `fix(agents): refuse a claude model …`): build, typecheck RC 0; 1087 tests, 1086 passed, 1 failed (`stopProof`); `check-known-reds` RC 0; `check-tmp-leak` RC 0.
- Orca (content = `build: re-pin ccloop by script …`): web build, typecheck RC 0; 2168 tests, 2164 passed, 1 failed, 3 pending (`ccloopDefaultE2E`, gated off in the full run); web check RC 0; `verify:panel` RC 0; `verify:ccloop-pin` RC 0 (3/3 passed, 0 skipped); `check-tmp-leak` RC 0 (0 entries); real `~/.orca` stat identical before and after.
- The one red: `tests/control/driverLanding.test.ts` > "D: … leaves the branch alone when it moved between the merge and the swap, …", `Test timed out in 5000ms`; 1-minute load reached 22.05 during the run (`$S/gate/uptime.txt`). Registered flake. Single-file reruns in the gate clone: 3/3 passed (5/5 each), load 2.6 (`$S/gate/rerun-*`).
