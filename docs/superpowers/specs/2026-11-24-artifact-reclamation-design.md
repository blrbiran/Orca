# Artifact reclamation (`orca gc` for `artifacts/`) — design draft

Status: **draft for the human's approval. No code has been written.**
Author: session `221948a1`, 2026-11-24. Tester issue: #433 (and #443, its README half, shipped).

## Intent

On a long-lived install `~/.orca/control/<key>artifacts/` is the biggest thing Orca writes: the tester measured
5.16 GB / 52,672 directories (sha256 4.52 GB / 36,785, evidence 0.49 GB), and the `artifacts` table only grows — the
tester's `rg "DELETE FROM artifacts" src` finds nothing. `orca gc` documents artifacts as out of scope on purpose.
The README now says so (#443), but the directory is still never reclaimed, so a person has no supported way to recover
the space. This draft is the design that `gc.ts`'s header says is needed: it deletes user data, so it needs its own
guards, a dry run and an explicit answer.

## What exists today (measured in this tree)

- `artifacts(id, hash, body)`; the bytes live at `<stateDir>artifacts/<id>/data` (`archive.ts:93`), created 0700 and read
  back through `readArtifact`, which refuses a missing row, a hash mismatch, or a symlinked parent.
- Five readers name an artifact **by id + hash**: `archive.ts` (read), `taskResultOutputs.ts:19`, `controlViews.ts:2324`
  (evidence), `usageSettlement.ts:79`. Ids are content-addressed by name (`<something>:<sha>`), so two ids can share a
  hash and therefore share bytes by construction (each id still has its own directory today).
- What names an artifact id: a candidate's `artifacts[]`/`snapshot` (persisted in `checkpoints`, `runs`), decisions'
  `evidence[]`, usage-settlement proof refs, and the archive outbox rows.
- `orca gc` walks `.runs/<runId>` and `.workspaces/<runId>` only, eligibility = archived group + terminal run + driver
  finished + older than N days; every refusal becomes a named skip.

## Approaches

### A. Extend `orca gc` with a third root (recommended)

`orca gc` grows an `--include-artifacts` switch (off by default, so today's behaviour and every existing criterion stay
byte-identical). With it on, an artifact is eligible only if **every** holder of its id is already gc-eligible:

1. collect the ids referenced by runs/checkpoints/decisions/usage proofs of the runs this same pass is about to remove
   (or has already removed), and nothing else;
2. drop any id that any *surviving* row still names (a run not eligible, a decision in a live group, a retained
   checkpoint) — the reference scan is the guard, computed from the store, not assumed;
3. refuse an id whose directory is a symlink or whose `data` is not a regular file (same rules `readArtifact` states);
4. remove the directory, then `DELETE FROM artifacts WHERE id=?` in the same transaction that records the run's removal;
5. report bytes and counts; `--json` lists every removed id and every skip with its reason (`still-referenced`,
   `not-a-run-artifact`, `too-recent`, ...).

Trade-offs: one more flag on a command people already know; the reference scan is the expensive part (a full scan of
`checkpoints`/`runs`/decisions bodies). But it reuses gc's eligibility rules, its dry-run, and its skip vocabulary, and a
person cannot accidentally turn it on.

### B. A separate `orca gc-artifacts` command

Same rules, its own command and its own exit codes. Cleaner separation; but a person with 5 GB of artifacts now has two
commands to learn and two places to look, and the eligibility rules would be duplicated or shared through an awkward
export. Only worth it if we expect the rules to diverge (e.g. artifacts eligible on a different clock than runs).

### C. Reference-counted deletion on every run removal (no new command)

Whenever a run is removed, decrement a counter per artifact and delete at zero. No scan needed at gc time. But it needs a
trustworthy reference count, which means every writer that names an artifact must increment it — a new invariant across
decisions, checkpoints, usage records and the outbox, where one missed writer silently deletes evidence a live decision
cites. Rule 9 territory: the change that closes this class would be the one to introduce it.

**Recommendation: A.** It is the only one that keeps a single "reclaim" entry point and a single set of guards, and its
reference scan is honest data rather than an invariant we would have to maintain everywhere.

## Open questions for the human

1. **Clock.** Artifacts go with their run (A), or on their own age clock (e.g. "evidence older than 90 days regardless of
   the run")? The tester's pain is the *volume of old runs*; run-scoped is simpler and safer, but leaves artifacts of
   runs a person keeps forever. My call: run-scoped first, an age flag later if asked.
2. **Dedup.** Two ids may share a hash; bytes are currently duplicated per id. Should the same hash share one directory
   (saves space now, changes `readArtifact`'s layout and every criterion that names a path)? My call: no — a separate
   change, because it touches the read path.
3. **Decisions.** A decision in a live group cites evidence by artifact id. A is safe (still-referenced → skip), but if a
   person archives a group whose decisions they still want to read later, A deletes the evidence. Acceptable?
4. **`--apply` vs dry run.** Default dry run like the staging prunes in syncskill, or follow `orca gc --apply`? My call:
   follow `orca gc` (it already defaults to a plan and needs `--apply`).

## Non-goals

- Automatic reclamation on a timer (a scheduled deletion of evidence is a bigger product decision).
- Deleting evidence a live or reviewable group cites — the scan refuses it by design.
- Touching `.runs`/`.workspaces` rules.

## Success criteria (for the plan)

- `orca gc --include-artifacts --json` on the tester's tree reports the same numbers `ora status --disk` shows, and an
  `--apply` pass leaves every surviving reader able to `readArtifact` its ids (a criterion that reads back each id a
  surviving row names).
- Without the flag, every byte of today's `gc` output is unchanged.