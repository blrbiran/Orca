# G1 baseline rebuild — 2026-09-24

**Who**: Orca dev session `a4f77b1f-c842-41ee-8e25-70d1dcdfaa75` (controller, Opus 5 1M).
**When**: 2026-09-24.
**On which commits**: Orca `430b70a` (`chore(checkpoint): orca-dev-1de723ea, level 696219 …`),
ccloop `d8708c7` (`docs(handoff): the queue is empty here; the next thing is the wire contract`),
ccmem `316721b`. All three: `ls-remote` == local at session start.

## 1. Why this round existed

Orca handoff §8.2 listed two artifacts as present, "measured 2026-09-22". Both were gone.
macOS periodic `/tmp` cleaning removed them overnight; the directory mtimes are `Sep 24 00:00`.

The damage was larger than "dist was cleaned": the whole worktree at
`/private/tmp/ccloop-codex-0919` was reduced to **115 directories and 1 regular file**
(`docs/handoff/handoff.md`). `package.json` and the `.git` file were gone, which is why
`git worktree list` reports it `prunable`.

The stale worktree registration was **not touched** — pruning a worktree is Tier 0.

## 2. What was rebuilt, and how it differs from what it replaces

Branch `codex/codex-adapter-0919` (`1760f74`) was intact in ccloop's refs, so the tree was
rebuilt by `git clone --local` + checkout into the session scratchpad (human ruling 137),
**not** as a new worktree — a worktree would be something this session could create but,
under Rule 15, could not remove.

| item | value |
|---|---|
| tree | `<scratchpad>/ccloop-codex-0919`, HEAD `1760f74`, 392 tracked files |
| `node_modules` | symlink to the ccloop main tree's |
| build | `BUILD_RC=0`, read **from the log file** |
| `dist/cli.js` | 166 bytes, `Sep 24 00:14:55` |
| adapter config | `<scratchpad>/fixtures/fake-codex-config.json`, 501 B, mode `0600` |
| its sha256 | `f4fe42c9e504f4ffaab00c02b6ffc61ddc6ddf35e7e9ffd04cfcde9f729f4cff` |

*** The config is a functionally equivalent **new** fixture, not the original. *** Its contents
were never recorded anywhere; it was reconstructed from `configSchema` in
`src/runtime/codex/protocol.ts`. The published sha256 `f6c14da8…` recorded in
`.superpowers/sdd/2026-09-19-web-recoverable-control/` describes a file that no longer exists and
**must not be used to verify this one**. That record is history and stays unedited.

## 3. Two facts the handoff got wrong, corrected here

- §8.2 writes the adapter config path as `/tmp/…`. ccloop's `src/control/command.ts:115-119`
  requires the path to be absolute, a regular file, not a symlink, **and `realpath` equal to
  itself**. On macOS `/tmp` is a symlink to `/private/tmp`, so a `/tmp/…` spelling is rejected
  as `control-adapter-config-invalid`. The 2026-09-19 plan already wrote `/private/tmp/…`; the
  handoff table dropped the prefix.
- §8.2 says both gates need `ORCA_CCLOOP_ADAPTER_CONFIG`. `verify:web-control:consumer` does
  **not** — measured: it runs, and its two capability tests pass, with only `ORCA_CCLOOP_BIN`
  set. `verify:control` does require it (`scripts/verify-control.mjs` exits 1 without it).

## 4. The baseline, reproduced

Commands as run, each redirected to a file and read back whole; RC taken from the file, never
from the background-task notification (see §6).

| gate | RC | result |
|---|---|---|
| `verify:web-control:consumer` | 1 | 2 failed / 2 passed (4), 0 skipped |
| `verify:control` | 1 | 42 files passed / 1 failed (43); 430 passed / 2 failed (432), 0 skipped |

Both failures, in both gates, are the same pair in `tests/control/webCcloopSmoke.test.ts`,
both `start-envelope-conflict:run:targetVersion`, thrown at `src/control/startEnvelope.ts:65`.
**This matches handoff §3 cell for cell. Not a regression.**

`0 skipped` was verified by a case-insensitive scan of the full log for `skip`/`todo`: no hits.

ccloop side, main tree, `ECC_GATEGUARD=off DISABLE_OMC=1`:
`vitest run --reporter=json` gave `VITEST_RC=1`; `node scripts/check-known-reds.mjs` gave
**RC 0** — roster 13, failed 1, all known, unexpected 0. The one red is the standing
`stopProof` failure. RC 1 alone carries no information here; the subset check is the criterion.

## 5. Capabilities, measured first-hand today

```
echo '{}' | node <tree>/dist/cli.js control capabilities \
  --adapter codex --adapter-config <scratchpad>/fixtures/fake-codex-config.json
```
RC 0, answer verbatim:

```json
{"protocol":1,"durableAccept":true,"ownershipIsolation":true,"evidenceRetention":true,
 "usageObservation":"phase-end","budgetEnforcement":"soft","requestBoundEvidence":null}
```

Seven fields. The five `CapabilityViewV1` requires — `contextObservation`, `handoffControl`,
`handoffExecution`, `contextWindowTokens`, `requestBoundProof` — are **all absent**. Gap one in
handoff §8.4 is confirmed against a binary built today, not against the Sep 19 21:48 one.

⚠️ Worth carrying into G1: `requestBoundEvidence` is present but its value is `null`, not a
boolean. Whether null means "unknown" or "unsupported" is undefined by the current contract.

## 6. Two traps this round paid for

1. *** A background task's reported exit code is the **last** command's, not the one being
   measured. *** The first rebuild reported "exit code 0" while the build had actually failed
   with RC 254 — the trailing `echo … | tee` supplied the 0. This is the pipeline-swallows-
   exit-code trap (handoff §7.3) reappearing as *notification*-swallows-exit-code.
   ⇒ **Write the real RC into the log file and grep it back. Never read RC off the notification.**
2. *** Directory listings through rtk hid this. *** `ls -la` on the dead worktree printed only
   directory entries, which read as "src and tests are still there"; the controller said so in
   the conversation before re-measuring. `rtk proxy ls -la` plus `find -type f` showed one file.
   ⇒ Handoff §7.1.6 already says listings lie; it was still believed once first.

## 7. What this changes for G1

`targetVersion` is **not** an open design question. Measured on both sides today:

- ccloop (the contract's owner under ruling G1) types it `safeInteger`/`number` in five places,
  zero as a string: `src/control/protocol.ts:34,118`, `handoff.ts:31`, `command.ts:84`.
- Orca's only producer is `src/control/commands.ts:61`: `(old?.targetVersion ?? 0) + 1` —
  a monotonic counter. Every `src/control/**` schema agrees.
- The string spellings are downstream: `webProtocol.ts:377,815` (`nonemptyString`),
  `web/src/controlTypes.ts:78`, `scheduler/planFile.ts`.
- `panel/controlViews.ts:61,112` accepts **both** via `z.union([z.string().min(1), safeInteger])`
  and then compares with `String(...)` at lines 388 and 488.

That last one is the eighth shape in handoff §6.1: one variable carrying both "is judged" and
"is displayed", where the normalisation silently disarms the guard — `String(1) === String("1")`,
so the union's type guard bears no weight on that path. This is a live defect, not a design
choice, and it is what G1 has to collapse.

⇒ G1's real design surface is the **capability vocabulary** (five fields ccloop answers none of,
plus the meaning of a null `requestBoundEvidence`). `targetVersion` is a convergence task.
