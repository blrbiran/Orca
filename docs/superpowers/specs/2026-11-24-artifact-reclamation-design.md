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

## Human rulings and implementation notes (session 5d3d0c09)

Added 2026-11-25 by the implementing agent (Claude Opus 5.5, Orca session `5d3d0c09`, branch `feat/artifact-gc-468` from
main `b27d71c9`). The text above is unchanged; where the implementation departs from it, this section says so.

### Rulings this implements

- **Approach A, approved** (integrity spec §3.3: run-scoped clock, no hash dedup, an archived group's evidence goes with
  it, dry run by default and `--apply` like `orca gc`).
- **Human, 2026-11-25: the panel deletes.** Artifact deletion is executed by the panel process, under its admission gate;
  the CLI asks it (`POST /api/control/gc/artifacts` on the control socket). The dry run is read-only and runs in the CLI.
  `orca gc --include-artifacts` is off by default; without it every byte of `orca gc`'s output is unchanged.
- **Triage notes:** hardlink dedup is out of scope (`assertRegular` and `currentIdentity` require `nlink === 1`). The dry
  run totals the bytes held by each skip reason with its group count and the next step; `--include-uncleaned`'s help and
  the README say it does not touch artifacts; `status --disk` stays file-system only.

### Departures from the draft above

- Step 4 ("remove the directory, then `DELETE` in the same transaction that records the run's removal") cannot hold: a
  file-system delete is not in a sqlite transaction and `gc` reads the store read-only. The panel removes every planned
  directory first, then deletes their rows in one transaction (below).
- Eligibility is not "ids referenced by runs this pass removes": the store's rows are never deleted, so every artifact
  stays named by some row. An artifact is planned when a **retired** holder names it and no **live** holder does:
  a retired run passes `gc`'s own run guards (`basicSkip`), ended before the cutoff (its `endedAt`, else its run
  directory's mtime; neither: `run-age-unknown`), is not among `--keep-last` (counted over every run row, since the
  directories of older runs may already be gone), and its group's terminal mark is older than the cutoff
  (`group-archived-recently`; an unarchive inside the window keeps everything). A retired group carries a valid mark
  older than the cutoff and every run of it is retired.
- Skip reasons are the run pass's plus `group-archived-recently`, `run-age-unknown`, `outbox-undelivered`,
  `held-by:<table>`, `holder-run-unknown` / `holder-group-unknown` / `holder-flow-unknown`, `published-since-panel-start`,
  `outside-group` (with `--group`), `unreferenced`, `artifact-path-unsafe`, `reference-scan-incomplete`, `remove-failed`.
  `unreferenced` (nothing names it at all) is kept, as the draft's `not-a-run-artifact` was.

### How the integrity review's High findings are met

1. **The delete races the panel over a content id.** The panel first reads every artifact's contents without blocking
   (a cache keyed by id and row hash; contents are immutable per hash). Then, in **one synchronous step inside its
   admission gate** (`WebControlService.reclaimArtifacts` → `applyArtifactReclaim`), it re-reads every table, re-plans,
   removes and deletes rows: no write of the panel interleaves with it (Node runs one step at a time; the panel is the
   control store's single writer). A writer between steps -- one that has published or reused an id and holds the ref only
   in memory until it persists the row naming it -- is covered by a process-wide set in `archive.ts`: `publish()` notes
   the id before its first await, and the panel never deletes an id it has published or reused since it started
   (`published-since-panel-start`; a later gc after a restart may plan it). Such ids are also live roots, so what their
   contents name is kept. A write after the step finds no directory and publishes afresh.
   Residual risk, named: an operation that read a ref from a *retired* holder before the step and persists it into a live
   row after it. Today no live operation copies refs out of an archived group (the terminal gate refuses every verb but
   unarchive/close), and an unarchive before the step makes the group live in the re-plan.
2. **The holder scan goes through artifact contents and fails closed.** Holders are every column of every table except the
   `artifacts` index, read as text (a BLOB as latin1), tokenized at separator boundaries; a token counts when it is an
   artifact id, a row hash, a 64-hex piece of an id (`checkpoint-<hash>`, `recovery-<hash>` are built from a hash), or a
   run or group id an artifact id embeds (`acceptance-<runId>`, `handoff-<runId>` are built from the run id). The closure
   reads the contents of every held artifact the same way -- no JSON parse, so a capsule, a packet, a snapshot tree, a
   manifest or any unparseable bytes all hold what they name. A held artifact whose contents cannot be read (anything but
   ENOENT: a symlinked directory, a non-regular file, EACCES) makes the plan empty: every candidate is skipped as
   `reference-scan-incomplete`. A held artifact whose bytes are gone (#469) names nothing a reader could reach.
   Over-holding (a hash shared by two ids, a group id that happens to be a piece of an id, any id-shaped text in a source
   blob) only keeps more.
3. **Per-table classification and a structural criterion.** `ARTIFACT_HOLDER_TABLES` lists every table of the store and
   its columns with the owner of a row (run, group, a flow's group, global, the outbox's own rule, or the index). A
   criterion compares it with a fresh store's `sqlite_master` and `PRAGMA table_info` and goes red on any table or
   column not classified. At run time an unknown table is scanned as a global holder and an unknown column is still
   scanned (both listed in `scan.unclassified`): unknown never frees anything.
4. **Crash ordering: directory first, then rows.** A crash between them leaves rows whose `data` is gone -- the state
   #469 already handles: views degrade to `evidence missing`, `orca doctor` counts it, a later write of the same content
   restores the file (the poisoned-write repair), and the next gc plans those rows again (bytes 0, `dataMissing`). The
   other order would leave directories no row names, which no command ever finds again.
- **Outbox rows** hold until delivered; a delivered one belongs to the run or group its body names, else the run or group
  its key names (`report:<runId>`), else it holds for good.

### Access

The socket route refuses a run Orca dispatched (`control-dispatched-run-refused`); the CLI refuses `--apply` over MCP
(`gc-artifacts-not-over-mcp`). No person token is required, matching `orca gc --apply`. With no panel the CLI answers
`panel-not-running` before removing anything (the run trees included).
