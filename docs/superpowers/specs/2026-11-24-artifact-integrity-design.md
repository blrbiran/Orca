# Missing artifact data: degraded reads and an integrity line (#469), with #468's reclamation — design

Status: **draft for the human's review. No code has been written.** Author: Orca session after `221948a1`, 2026-11-24
(session id `d7ca40c0`/`6f9b7b78`). Tester issues: #469 (reads break on a missing artifact file), #468 (no supported
artifact reclamation; same as #433). Human, this session: 「#468 + #469：两条合成一个 spec。 => 同意你的建议」 — one spec,
written this session for review, implemented next session.

Companion to `2026-11-24-artifact-reclamation-design.md` (#433/#468). That draft stays as written; this one adds the read
side and records the decisions taken for it.

## 1. Why both in one change

#468: `artifacts/` only grows (the tester: 4.8 GB of 5.16 GB under `~/.orca/control/`), and `orca gc` leaves it alone by
design (`src/control/gc.ts` header). With no supported way out, the tester wrote a cleanup script, misjudged 2,053 artifacts
still named by the outbox and acceptance records as orphans, and deleted them. #469 is what happened next: 63 of 160 groups
could no longer be shown (`orca group show` / `run show` answered `control-internal-error` or `recovery-blocked`), because a
missing `data` file is treated as "this run is unreadable" rather than "this piece of evidence is gone".

So the two must ship together: a supported reclaimer (so nobody scripts it) and reads that survive a missing file (so a
mistake, a disk error or an old backup does not take a whole group view down).

## 2. Measured on current main (read-only, this session)

- `src/panel/controlViews.ts:1652` throws `run-closure-invalid` when a run's closure proof cannot be read; the view of the
  whole group fails with it.
- `src/control/usageSettlement.ts:94-115` (`settlementProof`) turns any read failure, a missing artifact included, into
  `run-stop-proof-required`.
- `readArtifact` (`src/control/archive.ts`) refuses a missing row, a hash mismatch or a symlinked parent with one error
  shape; callers cannot tell "missing file" from "tampered file".
- Nothing checks artifacts against their `data` files; `orca status --disk` reports sizes only.

## 3. Design

### 3.1 Reads degrade per artifact (#469)

- `readArtifact` keeps refusing, but names the case: `artifact-missing:<id>` (row present, `data` absent) apart from
  `artifact-invalid:<id>` (hash mismatch, symlink, not a regular file). Tampering stays a hard refusal.
- **View paths only** (group show, run show, Results, evidence lists, the summary card): an `artifact-missing` becomes a
  field on the item — `evidence: { missing: "<id>" }` — and the rest of the view renders. The CLI prints
  `evidence missing: <id>`; the Web shows a warn-toned line. A group view never fails because one artifact is gone.
- **Decision paths stay strict**: accepting an attempt, settling usage, landing — anything that would *act* on the
  evidence — still refuses, by the named code, with a hint pointing at the integrity line below. A missing proof is never
  read as "no proof needed".

### 3.2 An integrity line (`orca status --disk`, and `orca doctor`)

- Counts artifact rows whose `data` is missing, and rows referenced by a live group whose `data` is missing, in one bounded
  pass (stat only, no hashing), and prints both: `artifacts: 2056 rows without data (403 referenced by 42 runs)`.
- `--json` lists the ids. No repair: the bytes are gone; the line exists so a person learns it before a view fails.
- Optional, human-gated: `orca gc --forget-missing-artifacts` drops rows whose `data` is gone **and** that no surviving row
  names; referenced ones are kept (the views degrade around them). Not in the first cut unless asked.

### 3.3 Reclamation (#468) — approach A of the companion draft, approved

`orca gc --include-artifacts` (off by default), artifacts eligible only when every holder of their id is gc-eligible,
the reference scan computed from the store, dry run by default with `--apply` (follows `orca gc`). The companion draft's
open questions, answered as recommended there (human: 「同意你的建议」): run-scoped clock first; no hash dedup in this change;
archived groups' decision evidence may be reclaimed with the group (named in the dry run); `--apply` like `orca gc`.

The reference scan must include **every** holder the tester's script missed: the archive outbox rows and the group
acceptance records, beside runs, checkpoints, decisions and usage proofs. A criterion pins each holder kind: a fixture
with one artifact named only by that holder must survive `--apply`.

## 4. Order (next session's plan)

1. `artifact-missing` vs `artifact-invalid` in `readArtifact`; view paths degrade; decision paths name the code. Criteria:
   a group with one deleted `data` file still renders in `group show`, `run show` and the Web summary (red on main today).
2. The integrity line in `status --disk` / `doctor`.
3. `gc --include-artifacts` with the full holder scan; a criterion per holder kind.
4. README "Disk use" section updated; tester note.

## 5. Not in scope

Automatic (timer) reclamation; hash dedup (`hardlink`/shared directory); restoring deleted bytes; changing `.runs` /
`.workspaces` rules.

## 6. Success criteria

- On a copy of a store with deleted `data` files, every group view renders and names the missing ids; no read path answers
  `control-internal-error` for a missing artifact (a test over every view route).
- `orca gc --include-artifacts --apply` never removes an artifact that any surviving row names, for each holder kind.
