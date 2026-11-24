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

## Review and revisions (2026-11-25, Orca session `6add92a5`, Claude Opus 5.5; on main after `chore(deps): repin ccloop to 276114a…`)

The human asked for an independent review (「请你审 #469+#468 的 spec。 => 派独立subagent review」). A read-only reviewer
subagent (no conclusion handed to it) checked every claim against main `98dd522c`. The text above is unchanged; this
section records what the review found and the controller's recommended revisions. **Still not implemented**: the human's
review of this section comes first (the ruling was "implement after the human reviews").

### Facts corrected (reviewer, verified against code)

1. §2 line 1: the throw is at `src/panel/controlViews.ts:1654` (not 1652). The chain is `validTerminalClosure` →
   `sealedProof` → `settlementProof` / `settlementArtifact` (`terminalRunClosure.ts:24-48`); each layer catches and
   returns false/null, and `blocked()` (`controlViews.ts:360`) turns the false into `recovery-blocked`.
2. §2 line 3 is **wrong**: `readArtifact` (`archive.ts:155-164`) already names `artifact-not-found` (no row),
   `artifact-hash-mismatch` and `control-path-symlink`. A missing `data` file is not a ControlError at all: `assertRegular`
   (`paths.ts:35-37`) lets a raw ENOENT escape, mapped to `control-internal-error` — the tester's `run show` 500, because
   `readRunEvidence` (`controlViews.ts:2402-2405`) only tolerates the first two codes.
3. **Missed by §2**: `group show` never reaches `readArtifact`; it fails through `settlementArtifact`
   (`usageSettlement.ts:79-90`), a second synchronous reader that throws a plain `Error` swallowed by `sealedProof`.
   Changing `readArtifact` alone does not fix `group show`.
4. `run show` fails for **every** run of a group with one bad closure: `readRunEntry` goes through `readControlGroup`
   (`controlViews.ts:1878-1886`) and `readRunEvidence` calls `runViews` again (`:2398`).

### Gaps (by severity) and the recommended revision

- **High — the delete races the panel.** `gc` opens the store read-only out of process (`gc.ts:85`); "delete the
  directory and `DELETE FROM artifacts` in one transaction" cannot hold (a file system delete is not in a sqlite
  transaction, and gc has no write path). Content ids (`sha256-<hash>`) are shared: `publishOnce` reuses an existing
  directory (`archive.ts:104-112`), so a live run can come to name an id between the scan and the `rm`.
  **Recommendation:** the delete is done **by the panel**, under its admission gate, as a control command; the CLI only
  asks (dry run stays out of process and read-only). This is the decision the human should make first.
- **High — the holder scan is not a list of tables.** Ids are also named *inside* artifacts (snapshot `bundle` /
  `tree[].ref` `snapshot.ts:71-72`; capsule `artifacts.normalization` `runDiagnosis.ts:57`; packet `rawLogs`/`artifacts`
  `handoff.ts:17`; `logs[].ref` `savedResultRecovery.ts:46`), and in more tables than §3.3 lists (`usage_events`
  `usageSettlement.ts:144`, `savedRecovery.admission`, `funding.historicalPolicy.authority` `fundedAllowance.ts:189-190`,
  `savedNoDispatch`, `savedSettlement`, `terminalClosure`). **Recommendation:** the scan expands transitively through
  artifact contents and fails closed (an unparseable artifact counts as "still referenced"); a structural criterion
  enumerates `sqlite_master` tables and columns and goes red on any table the scan has not classified.
- **High — a row whose `data` is gone poisons later writes.** `observeDuplicate` throws
  `artifact-id-conflict:data-missing` when the directory exists without `data` (`archive.ts:61`), so any later write of the
  same content fails a live run; a fully removed directory republishes (`:58`). **Recommendation:** on publish, a row
  present with `data` missing is restored from the bytes being written (same hash, safe); criterion: delete only `data`,
  write the same content, the write succeeds and the file is back.
- **Medium — degradation is already silent today** (`runDiagnosis.ts:47-65` returns null; `settlementPreview` reports a
  missing proof as `run-stop-proof-required` `controlViews.ts:2464`; `validSavedNoDispatch` catches to false
  `savedResultNoDispatch.ts:14`). **Recommendation:** one named state, `evidence-missing:<id>`, used by all of them.
- **Medium — a third closure state.** A degraded run must not read `terminalClosed: true`, and leaving the field out sends
  the Web (`runFacts.ts:63-64`) down a path that offers Close, which `terminalRunClosure.ts:65` then refuses.
  **Recommendation:** `closure: "evidence-missing"` on the view; `validTerminalClosure` stays two-valued and strict for
  the decision paths (`retryTask.ts:290,298`, `savedResultRecovery.ts:71`, `systemDebug.ts:306`), each with a criterion
  naming its refusal code.
- **Medium — the stuck runs need an exit.** With decision paths strict, the tester's 42 runs in live groups can never be
  retried or closed; "see the integrity line" is a dead end because the line repairs nothing. **Recommendation:** the hint
  names the exit that works (archive the group); nothing else in this change.
- **Low:** `doctor` reading the store out of process needs gc's read-only open and `busy_timeout`; "referenced by a live
  group" needs the same full scan as reclamation, so it is not "stat only". Name the new code `artifact-data-missing`
  (not `artifact-missing`, too close to `artifact-not-found`).

### Scope (recommended)

- Drop `gc --forget-missing-artifacts` (it permanently drops index rows and is not #469's P0).
- The integrity line goes in `orca doctor` only; `status --disk` keeps its file-system-only promise (`status.ts:278-280`).
- Criteria: "no view route answers `control-internal-error`" enumerates the route table, not a hand list; the fixture is
  a run **with** a `terminalClosure` whose report or stop-proof `data` is deleted, in two variants (directory removed /
  only `data` removed).

### Open questions, recommended answers

1. Clock: run-scoped first, as approved — and say in the README that this frees little (the tester measured only 73
   artifacts held solely by archived/terminal groups), so a small result is not read as a bug.
2. No dedup (also: `assertRegular` requires `nlink === 1`, `paths.ts:37`; hard links would break every read).
3. Archived groups' decision evidence goes with the group; the dry run lists each id; `--apply` asks nothing more.
4. **Who deletes: the panel** (see the first High gap). Human decision needed before step 3 of §4.

### Revised order (after the human's review)

1. #469 reads: `artifact-data-missing` from both readers (`readArtifact`, `settlementArtifact`); view paths degrade to
   `closure: "evidence-missing"`; decision paths refuse by code; the poisoned-write repair.
2. `orca doctor` integrity line (read-only open).
3. #468: panel-side delete command with the transitive, fail-closed scan and the `sqlite_master` structural criterion.
4. README.
