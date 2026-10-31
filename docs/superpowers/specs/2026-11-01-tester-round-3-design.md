# Tester round 3: acting on `issue-20261023.md` #99–#117

Who: Claude Code session `4ed8eb65`, 2026-11-01. Human ruling: 「同意你的建议，Q1–Q5 都按推荐走」. The triage and its evidence are in `.superpowers/sdd/2026-10-31-session-4ed8eb65/progress.md`.

## 1. Not defects

- **#99 / #110**: 13 log lines are 13 command rows, one per proposal version (autoConfirm condition 9). The group was a draft then; `running` is its state after v19 confirmed. The line now carries an ISO time, so an old line no longer reads as a current one.
- **#112**: the pin and the installed ccloop here both answer `features.transcripts: "v1"`. The tester's output points at an out-of-date `node_modules`. The panel's text now says that and names `npm ci`.

## 2. #111: the changed-files check (ccloop)

The recommendation was "stop failing on a difference". Reading the code changed how: `runLoop` judges the path policy and picks the verifier's primary targets from `execution.changedFiles`, so merely dropping the compare would let an unreported file past a denylist. `OmpAdapter.execute` therefore returns git's observed list in place of the reported one. This is stricter than before on what is judged and no longer fails a finished attempt. A difference is kept in `<runDir>/changed-files-difference.json`; a failed write of it changes nothing.

Gitignored files an agent wrote stay invisible to the policy, as they are for claude and codex.

## 3. #116: the observed usage floor (ccloop + Orca)

- ccloop `collect` gains optional top-level `usageLowerBound: { tokens }`, the sum of the run's `run/<kind>/<attempt>/<phase>/call-*/usage-lower-bound.json`. Malformed or non-positive files contribute nothing.
- Orca's `collectionSchema` accepts it (optional, so an older ccloop still parses). The driver keeps it on the run as `usageLowerBound`. The run view reports the single call's floor, else this one; the settlement panel prints "At least N tokens".
- Shown only, never charged, like the single call's (spec 2026-10-27 D3). No auto-settlement: a floor can under-count the real spend.
- Until Orca repins past the ccloop commit (needs a push, §6) no real run carries the key.

## 4. Q2: the 30-minute wall clock

Conflict surfaced to and decided by the human: ccloop spec 2026-10-21-activity-watchdog kept existing installations at 30 minutes.

`migrateAgentTimeouts` runs once when the installed service starts (§7 corrects the first version of this sentence). `timeoutMs` equal to the old drafted default moves to `7_200_000`. Other values stay. `timeoutMs` is not in the configHash, so frozen groups resolve as before.

**Rule 17 registration.** Writer: the panel service at start. Paths: `$ORCA_AGENTS_TABLE` or `~/.orca/agents.json` (rewritten keeping mode and layout) and `<table>.bak-pre-2h-timeout` (0600, the previous bytes). The marker's existence means done, so a person who sets 30 minutes back keeps it. Failure leaves the table as it was and logs one line; a crash between the two writes leaves the marker with the table unmoved, and that table stays on 30 minutes.

## 5. #117: the word follows the colour

The tester proposed making a blocked item look running. Red is correct: the run is blocked. What was wrong is the word. `shownWorkStatus` shows `blocked` when the server's category is blocked, except `held`, which has its own meaning.

## 6. Not done here

- Orca's repin to the ccloop commit of §2–§3: Orca pins by GitHub commit, and pushing is the human's.

## 7. Incident and correction: a criterion rewrote the real table

The first version ran the migration in `startPanelFromArgs`. Criteria boot `orca panel` as a child with the real `HOME`, so at 2026-11-01 00:54 a test run rewrote the real `~/.orca/agents.json` (three `timeoutMs` 1800000 to 7200000) and wrote its marker. `relocateUserData` turned 9 root test files red in that run; which of them wrote is not established, since the guard blames every file open at that moment. The content is what Q2 decided, and the previous bytes are the marker, so it was left in place and reported to the human.

Now only `mode.service === true` migrates. Limit: a person who only ever runs a foreground `orca panel` keeps 30 minutes. `tests/service/servicePanel.test.ts` still reached it in service mode, as a first proof run showed, so `tests/setup/relocateUserData.ts` also points `ORCA_AGENTS_TABLE` into its temp root. Proof: the whole root suite run with `HOME` at a temp directory holding an old table leaves it byte-identical and creates no marker (ledger).
