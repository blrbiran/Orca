# A run that burned its ceiling with nothing to show — design draft

Status: **draft for the human's approval. No code has been written.**
Author: session `221948a1`, 2026-11-24. Tester issue: #431.

## What the tester saw

A single-repo split's first L1 task, run on codex: `stopReason=live token ceiling reached`, `used=8,114,560`, **zero
changed files, no checkpoint**, `continuable=false`. `usageDetail` = plan 520,157 + execute 7,594,403. The transcript
shows 86 shell calls, all `rg`/`cat`, no write. `continue` could only start over. And neither the page nor the CLI
quantified "this run burned 8.1M tokens and changed nothing".

Three separate complaints hide in that sentence, and they want different answers:

1. **The spend was invisible as spend.** A task that ends with nothing does not say how much it cost, nor that the cost
   bought nothing.
2. **It was not continuable.** No checkpoint existed, so `continue` meant "from the top".
3. **Why it burned** — a model that keeps reading and never writes — has no brake short of the ceiling.

## What exists today (measured in this tree)

- `checkpoints.ts` sets `recoverable = settled && missing.length === 0 && snapshot`. A run with no candidate/stop proof
  produces no snapshot, so nothing is continuable. The ceiling-stop path does settle (`settleCeilingStop`), but with a
  `partial` candidate whose artifacts may be logs only.
- `run show` reports `used`, `stopReason`, `usageDetail` (by phase) and `continuable`. So the raw numbers exist; what is
  missing is the *reading* — "8.1M tokens, 0 files, not continuable" as one line.
- `usage.ts` books the spend against the group whatever the outcome; nothing in the read path contrasts spend with
  result.

## Approaches

### A. Make the reading honest first (recommended for this round)

No behaviour change to the run. `run show` and the board card gain one derived line when a terminal run has usage above a
threshold **and** zero changed files / no candidate: `spent 8,114,560 tokens, changed no files`. The threshold and the
"changed nothing" test are computed from data already stored (`candidate`, `drive.landedCommit`, `dirs[].changedPaths`).
It is display-only, testable, and answers complaint 1 directly.

For complaint 2, add the honest sentence to `run show`'s `continuable:false`: *why* (no snapshot: the run never produced a
candidate this Orca could settle into a checkpoint), so `continue` is not a silent dead end.

### B. Give a zero-change ceiling stop a continuable checkpoint

Record a checkpoint whose snapshot is the run's base tree (nothing changed) with `missing: []`, and let `continue` start
the next attempt from it. Tempting, but a checkpoint is a claim that the tree is reproducible from it; an empty snapshot
still needs its own identity checks against the work item, and "continue from an unchanged tree" is exactly "start over"
with extra machinery. If the goal is "don't pay for the same reading twice", the answer is a different one (C), not a
checkpoint.

### C. A reading-only brake (the real fix for complaint 3, but a bigger design)

A per-attempt "work observed" rule already exists for the *failure* reading (#347: narration-only / execution-not-json),
and ccloop reports work-observed signals. A phase that has spent X tokens with **no** work-observed event could stop
early with a named cause instead of running to the group ceiling. This is a ccloop-side change (an early stop cause, not
a new Orca concept) and needs its own design with ccloop, plus a decision about how much "reading" is legitimate for a
large repo before it counts as stuck. My call: design it separately; do A now.

## Open questions for the human

1. **Is A enough for this round?** My reading of the tester's complaint is that the *invisibility* is the sharpest part
   (they said so in their ledger: "页面/CLI 都没有『这次白烧』的量化"). A answers that; B and C are larger.
2. **Threshold.** A fixed token number (e.g. 1M) or a fraction of the group/task grant (e.g. >50% with no change)? A
   fraction reads better in a group with a small budget; a fixed number reads better in an unlimited group. My call:
   fraction when a finite ceiling exists, else a fixed 1M.
3. **Where it shows.** `run show` only, or the board card and `group brief` too? My call: `run show` + the card, not the
   brief (the brief is polled often).
4. **C.** Do you want C designed in parallel with ccloop, or parked until A's rollout says whether people hit this often?

## Non-goals

- Changing how usage is booked (a spend is a spend).
- Making a zero-change run "succeed".
- Any ccloop behaviour in this round.

## Success criteria (for A's plan)

- A run with usage above the threshold and no changed files prints the one line; a run with changes, or below the
  threshold, prints nothing (byte-identical to today).
- `continuable:false` names the missing snapshot.
- Criteria derived from stored data only; no new store writes.