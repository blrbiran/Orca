# The delivery tail: acceptance, integration, delivered acceptance, review, done

Session 2026-11-17 (Orca). Tester issues #333, #334, #336, and the prompt half of #337
(`orca_archived_files/issue-20261023.md`). #334 shipped first, alone (commit
`fix(review): bound the review diff and close a review that cannot be prepared (#334)`); this design is the rest.

## Human rulings this design rests on (2026-11-17, this session, verbatim answers to three questions)

1. "Should integration wait for the requirement review to pass?" Proposed: *the review does not hold integration, but a
   group is not done until it is reviewed* -- so a criterion like "merged into main" has a moment at which it can be true.
   Human: 「同意」.
2. "What does #333's *integrate now* skip?" Proposed: *only the backoff and the trigger's timing; all tasks done and the
   acceptance satisfied are still required; with a pending or published history chain, it only re-tries that CAS and
   never starts a separate ordinary integration.* Human: 「同意」.
3. "Run the acceptance again on the target after delivery?" Proposed: *only when the delivered tree differs from the tree
   that was accepted, running the same configured commands, no extra full suite.* Human: 「同意」. This narrows, and does not
   reopen, the #279/#283 ruling (no full suite run on the person's behalf): the commands are the ones already run.

The human was away for the rest of the session and asked the agent to go with its own proposals and report them for
review at the end (「这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核」). Every choice below not covered by
the three rulings is marked **(agent's call)**.

## Why

The tester's three newest delivery reports share one shape: the work is finished, but Orca neither delivers it nor says why.

- #333: with integration `idle`, nothing in the CLI or the Web makes Orca integrate now; a transient backoff is invisible.
- #334 (fixed): a review that could not be prepared held `reviewing` forever and kept a run active, which held integration.
- #336: the reviewer sees only the diff, so "the suite is green" or "merged into main" are always `cannot-judge`; and
  review runs *before* integration, so "merged" cannot be true when it is judged. A delivered group then sat in
  `review` with nothing in `group brief` saying so. Separately, the acceptance only ever ran on `orca/<g>`'s tip; a merge
  that changed the tree on the target was never checked.
- #337 (prompt half): the review prompt itself tells the reviewer a binary file is a reason to answer `cannot-judge`.

## Goals

- One order, visible: **acceptance on the tip -> integration -> acceptance on the delivered commit (only if its tree
  differs) -> review with those facts -> done.**
- A person (or an agent, where the verb allows) can ask for the integration now, and can see why it is not happening.
- The review is given what Orca knows beyond the diff: the acceptance record, the delivery record, the delivered
  acceptance record -- in words that do not assume any language or test framework.
- A not-passed review, a failed delivered acceptance and a waiting delivery each show in Overview / `group brief`.

## Non-goals

- Extracting text from binaries (PDF pages, image sizes) for the reviewer (#337 logic half) -- a separate design.
- Reviewing dir / multi-directory groups (#337 tier 3) -- unchanged: `not-run`.
- A `trigger` other than `group`, or a manual-only scheme.
- Changing the history chain's own acceptance (`historyAcceptance.ts`): a named-source delivery keeps its literal
  parent proof, and gets no delivered acceptance here **(agent's call: its tree claims are already proved there)**.

## Anti-goals

- A second integration commit for the same tip (integrate-now must stay idempotent: `nothingLanded`, `caughtUp`).
- Integrating a group whose tasks are not done or whose acceptance is not satisfied because someone pressed a button.
- A review that waits forever on a delivery that will never come.

## Approaches considered

A. **Keep the order; only feed facts to the reviewer.** Cheapest, but "merged into main" still cannot be true when
   judged, and ruling 1 asked for a moment when it can. Rejected.

B. **Review after integration (chosen).** The review pass waits until the delivery of the reviewed tip settled
   (integrated, nothing to carry, or blocked/conflicted with its reason), and the delivered acceptance (when needed) is
   recorded. Matches ruling 1; one extra driver round of latency on a normal group.

C. **Review twice: once on the tip, once after delivery for delivery criteria only.** Two calls, two records, and a
   classifier deciding which criterion is "about delivery" -- a model judgement Rule 5 keeps out of routing. Rejected.

## Design

### D1. Integration does not wait for a review run (ruling 1)

`groupComplete` (integrationPass.ts) ignores an active run whose purpose is `requirement-review`. Any other active run
still holds integration (a reconciling run, a landing, a no-change judge -- tasks are not done then anyway).

### D2. The review waits for the delivery of the tip it reviews

In `reviewRequirements`, after the acceptance gate, a group whose integration record is frozen and not `keep` (not dir,
multi, or dir-flow, which have none) is reviewed only when one of these holds for the current tip `T`:

- `integration.lastIntegrated === T` and no `pending` (delivered; a history group: `historyPublished.groupTip === T`);
- `integration.state` is `blocked` or `conflict` (delivery failed; the review goes ahead and is told why);
- `T` is already contained in the target as `nothingLanded` judges it (local refs only, no network) -- nothing to carry.

And, when D3 applies to that delivery, its record exists for `(T, integratedCommit)`. While the integration is idle and
behind (waiting for its first pass, backing off) or `resolving`, the review waits. A keep group is reviewed as today.

### D3. Acceptance on the delivered commit (ruling 3)

A new pass step after integration (`deliveredAcceptance.ts`, driver round after `integratePendingGroups`, before the
review). For a group whose delivery is `local` or `push-target` without `historyExpectation`, whose
`lastIntegrated === T` (current tip) and `integratedCommit = C` is non-null, and whose acceptance on `T` is recorded and
satisfied:

- `C^{tree} == T^{tree}` -> record `{ tip: T, commit: C, result: "not-needed", why: "same-tree" }`, no command runs.
- Otherwise the same union of setup and required checks (and the project's full-suite command when set, red run retried
  once) runs in a scratch worktree at `C`, off the round, exactly as `runAcceptance` does for the tip, with the same
  bound. `C` exists in the local object store for both deliveries (computeNew created it before publishing).
- Result: `passed`; `passed-relative` when only the full suite is red and the tip's own acceptance was `passed-relative`
  on the same command **(agent's call: the base already showed that suite red; running the base again adds nothing)**;
  otherwise `failed`, with the failing tail.
- Kept on the group body as `deliveredAcceptance` (one record; keyed by `tip` and `commit`, so a new delivery checks
  again; a restart does not rerun a recorded pair). Activity `delivered-acceptance` on passed / passed-relative / failed.
- `github-pr` is not checked here: nothing reached the target **(agent's call)**.

The done gate (`prerequisiteDone`) requires a satisfied `deliveredAcceptance` for the current `(lastIntegrated,
integratedCommit)` whenever D3 applies; a group already `done` without one stays done (records written before this
existed). A failed record is a problem row (`delivered-acceptance-failed:<command>`), in `group brief`, and in the
review prompt. Exits: `group recheck-acceptance` runs both again; `group waive-acceptance` also waives a failed delivered
acceptance (its note is recorded on it) **(agent's call: one verb for "I accept these checks as they are")**. The target
is never rewound.

### D4. What the reviewer is given (#336, #337 prompt half)

`buildReviewPrompt` gains a section "What Orca recorded beyond the diff", each line present only when known:

- `Acceptance on the reviewed tip <short>: <result>` then one line per command: `<command> -> exit <code> (<ms> ms)`,
  and the full-suite line (`command`, its exits, `flaky`, the baseline exits when classified relative).
- `Delivery scheme: <delivery> <method> into <target>[ on <remote>]`; then one of `delivered as <commit> (<n> parents)
  on <target>`, `not delivered: <state> (<reason>)`, `nothing to carry: the tip is already in <target>`, or `kept on
  orca/<g> (no delivery configured)`. A `github-pr` delivery names the PR url and whether it is ready.
- `Acceptance on the delivered commit <short>: <result>` with its commands, or `not needed: the delivered tree equals
  the reviewed tip's`.

The prompt's framing changes: evidence may be file content, file metadata, a command's result, or an Orca record; a
`met` verdict may cite `{"path": "orca:acceptance" | "orca:delivery" | "orca:delivered-acceptance", "line": null}`.
`cannot-judge` is "only when neither the diff, the files listed nor Orca's records can show it; say in `missing` which
record or content would", and the binary-file example is removed. A binary file is still named by path, bytes and sha256.
The JSON schema is unchanged (evidence is already `{path, line|null}`).

### D5. Visibility

- Overview: a not-passed review is a `task-attention` row (shipped with #334); a failed delivered acceptance is too.
- `group show`/`brief`: an integration line names `retryAfter` (local time) and the last transient message when
  backing off; a review that waits for delivery says `review: waiting for delivery of <short>`.
- Activity: a transient integration failure writes `integration-backoff {message, retryAfter, transient}`; the record
  gains `transientReason` (string|null; optional, so old records read).

### D6. Integrate now (#333, ruling 2)

New authority verb `integrate-now` on a group (Web route `POST /api/control/groups/:groupId/integration/now`, CLI
`orca group integrate <group>`, open to agents as `retry-integration` is **(agent's call: it never bypasses a gate a
person owns)**). In one transaction it requires:

- a frozen, non-keep integration (`integration-not-configured`); state `idle` (`integration-not-idle:<state>`, whose hint
  names `retry-integration` / `resolve-integration`);
- every task done and the acceptance satisfied (`integration-not-ready:tasks-not-done` /
  `integration-not-ready:acceptance-not-satisfied`);
- not already delivered: `lastIntegrated` (or `historyPublished.groupTip`) equals the current tip and nothing is pending
  -> `integration-up-to-date` (the tip is read before the transaction, as other git-reading verbs do).

It then clears `retryAfter` and `transient`, records activity `integration-requested {by}`, and wakes the driver; the next
round integrates (the integration pass is unchanged and still runs `groupComplete`, `nothingLanded`, the CAS). With a
pending history chain the same pass re-enters that one CAS; nothing else starts. Web: an "Integrate now" button in the
Git region while `idle`, enabled unless up to date; the backoff line beside it.

## Left to the builder

- Exact copy of the new strings (en/zh), the activity body field names beyond those named, the CLI help line.
- Where the delivered-acceptance check entries live (the acceptance's `checks` map pattern is the model).

## Corrections

### Correction 1 (same session, after the builder check; all agent's calls, for the human's review)

A fresh reader planned from the text above against the code and found seven places a builder would have to guess. Each
is settled here; where this conflicts with a section above, this section wins.

1. **A failed acceptance keeps #314's path.** D2 applies only when the acceptance on `T` is *satisfied*. A failed
   acceptance (no `why`) still opens the review at once, as today, so a failing tip still gets its fix task or check
   conflict; such a tip is never delivered (integration needs a satisfied acceptance), so waiting would deadlock.
2. **D3 is for `local` delivery only, this round.** `local` is the only delivery whose done gate already waits for the
   integration (`prerequisiteDone`: `lastIntegrated` set, nothing pending); adding D3 there changes nothing for
   dependents of `push-target` / `github-pr` groups, which today count as done before anything is pushed. Checking what
   a push reached, and whether done should wait for a push, is left for a later design (recorded in the handoff).
3. **D3 checks the commit made for this tip, or nothing.** The integration record gains `integratedFor` (commit,
   optional): the tip that `integratedCommit` was made for, written only when a delivery published a new commit. When
   the target already held the tip (`computeAndPublish` keeps the old `integratedCommit`), `integratedFor !== T` and D3
   records `not-needed` / `why: "already-in-target"` (the tip's own acceptance covers the tree that reached the target).
4. **"Nothing to carry" stays as it is (out of scope).** D2 lets the review go ahead; whether such a group can then be
   done is unchanged (it needs `lastIntegrated`), a pre-existing behaviour noted in the handoff, not fixed here.
5. **A delivery that keeps failing does not hold the review for ever.** D2 also opens the review after three consecutive
   transient failures (`transient >= 3`); the review is told `not delivered: retrying at <time> (<message>)`. A group
   the person paused or stopped waits, as its integration does (`groupStopped`).
6. **D3 and the tip's acceptance.** D3 runs whenever its other conditions hold, including after `not-needed` (the
   union then runs for the first time, on the delivered tree: the same configured commands, per ruling 3). After
   `waived`, a red D3 whose failing command is the one the person waived is recorded `waived` with the waiver carried
   (`waived.note` names it); any other failure is `failed`.
7. **Driver order.** The review pass moves after the integration pass and the new D3 step in `pass()`: acceptance ->
   landing watch -> integration -> history acceptance -> delivered acceptance -> review. D2 still gates by records, so
   the order only removes a round of latency.

### Correction 2 (same session, after the independent branch review; agent's calls)

A fresh reviewer read the five implementation commits against this spec. No Critical finding; these changed the code
(commit `fix(delivery): address the delivery-tail review (#333 #336)`), and win over the sections above:

1. **D3 needs the group's delivery, not any delivery.** Besides Correction 1's conditions, D3 runs only when every task
   is done and the acceptance is *recorded* for the delivered tip (a `trigger: task` group delivers after each landing;
   an intermediate delivery is not checked and never shows a problem).
2. **A delivery integrated before `integratedFor` existed** is recorded `not-needed` with `why: "before-record"` (it is
   not known which tip the commit was made for); the review prompt says so instead of "the target already held it".
3. **An archived group does not hold its dependents** waiting for a delivered acceptance the pass never runs for it. A
   stopped one still waits (its integration waits too) -- recorded in the handoff, not changed.
4. **integrate-now refuses a stopped group** (`integration-not-ready:stopped`); an archived group was already refused
   `group-archived` by the command ledger.
5. **A red delivered acceptance's output tail** (cut at 1,500 bytes) is in the review prompt, as D3 says.

### Correction 3 (session 2026-11-17 evening, after the human's review)

The human reviewed Correction 1 (seven items) and Correction 2 (five items) with the controller's recommendation for each
and answered 「按你的建议走」: all twelve stand as written, including 1.6 (a single-landing group's delivered tree that
differs from its tip runs the configured union, the project's full-suite command included when set). One change:

1. **"Nothing to carry" now reaches done** (replaces Correction 1.4's "out of scope"). When the integration pass finds a
   `local` group's tip already in the target (`nothingLanded`, local refs) and the group is complete (every task done, no
   active run but a review's, the acceptance satisfied), it settles the record as delivered: `lastIntegrated = T`,
   `integratedCommit = null`, no commit made. D3 then records `not-needed` / `already-in-target`, and the done gate is met.
   An incomplete group, a caught-up one and `push-target` / `github-pr` are unchanged.

### Correction 4 (2026-11-18, builder for tester #337 prompt half under session 4389b15f, on `ca11313b`; agent's calls, for the human's review)

D4's last sentences ("A binary file is still named by path, bytes and sha256") and the Non-goal "image sizes ... for the
reviewer" no longer hold for the type and image size; everything else in D4 and the Non-goals stands (no text is
extracted, dir / multi-directory groups stay `not-run`).

1. **A changed binary file's header facts are in the prompt** (`src/control/binaryFacts.ts`, computed in code from the blob
   bytes `groupChanges` already reads for the sha256, no dependency): the type from magic bytes -- PDF (with its version),
   PNG, GIF, JPEG, ZIP, and a ZIP named Word (docx), Excel (xlsx), PowerPoint (pptx) or OpenDocument from its central
   directory's entry names -- and the pixel size of a PNG (IHDR), GIF (logical screen) or JPEG (first start-of-frame
   marker). The line reads `(binary: <facts>; its other bytes are not shown)`; an unrecognised type keeps `(binary: named
   only, its bytes are not shown)`. **No PDF page count**: without a PDF parser it cannot be counted reliably (object
   streams, incremental updates); the PDF line says its page count is not read.
2. **Bounds**: the type reads the first bytes; the JPEG frame header is searched for in the first 1 MiB; a ZIP's central
   directory is read only when found in the blob's last 65,557 bytes and at most 1 MiB long (ZIP64 is not read). Past a
   bound the line names the type only.
3. **Evidence forms**: `met` may cite a file's path with `line: null` when the evidence is what is listed for it (size,
   hash, type, image size); `not-met` names its evidence in the same forms; a record above (`orca:acceptance` ...) stands
   for a command and its exit as recorded there. `cannot-judge` is unchanged and adds "Do not guess what a file's unshown
   content says." The JSON schema is unchanged.
4. **Web**: the review state `not-run` reads "not reviewed (Orca cannot review folder or multi-repository groups yet)" /
   「未复核（Orca 暂时还不能复核文件夹或多仓库的任务组）」. What counts as satisfied is unchanged.

### Correction 5 (2026-11-18, same builder, after the independent branch review of #337; wins over Correction 4)

1. **Office labels need their marker entry**: docx / xlsx / pptx only when `[Content_Types].xml` is at the archive's
   root as well as `word/` / `xl/` / `ppt/` entries (an archive that merely holds such a folder is "ZIP archive").
2. **A size is named only when it is real**: an image whose width or height is 0, or a PNG dimension of 2^31 or more
   (above the PNG limit), is named by its type only. The size is the **stored** pixel size; EXIF rotation is not read,
   and the prompt says so.
3. **Metadata shows only itself**: the prompt's evidence framing and its `met` form both say a file's listed metadata
   (size, hash, type, stored pixel size) shows only those facts, never what its unshown content says.
