# Task 10 review — error page, refusals, web-made messages, zhErrors

Reviewer: task-reviewer subagent of session `e604b1ba` (Claude Opus 5.5), 2026-10-01. Range reviewed: `5cb8ce4..1ff2149`
(package `review-5cb8ce4..1ff2149.diff`, read whole). Brief `task-10-brief.md`, report `task-10-report.md`. Rulings applied:
P8, F13, Review Focus 4.
Probe and mutation work was done only in `$SCRATCH/rev-t10/repo`, a `git clone --local` at 1ff2149. The clone is kept, with an
untracked `web/tests/revProbe.test.ts`. `$SCRATCH` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

## Spec Compliance

✅ Spec compliant. The one deviation from the brief is justified (see "The two changed brief values" below).

- **Every listed file has its hunk.** Checked file by file:
  - `i18n.ts:405-417` (`refusalText`) and `zh.ts` (`panelErrors`, `zhErrors`).
  - `en.ts` (`panelErrors`) and `ErrorPage.tsx`.
  - `Refusal.tsx`: the body, the button and the header comment.
  - `ControlPanel.tsx:170-172` and `api.ts:47`.
  - `controlApi.ts:77,80,139,141,166,169,178`: all 7 sites.
  - Both criteria files.
  - The `GET ${path}` / `POST ${path}` fragments are kept (F18).
- **Tables checked against the brief mechanically.** I extracted the `zhErrors` block and both `panelErrors` blocks from the
  brief and from HEAD and diffed them (`$SCRATCH/rev-t10-zhdiff.txt`).
  - `panelErrors` en and zh: identical.
  - `zhErrors`: differs only at `reviews-store-busy` and `reviews-store-is-symlink`.
  - `tsx` load of `zhErrors` (`$SCRATCH/rev-t10-zhkeys.txt`): 172 keys. `controlErrorCatalog().length` is 124.
- **P8**: `zhErrors` is a plain `Record<string, string>` read by `hasOwnProperty`. There is no i18next namespace, so codes
  containing `:` are safe.
- **Review Focus 4** (`i18n.ts:414`): `toString`, `constructor` and `__proto__` fall back to the message as sent
  (`refusalText.test.tsx:778`).
  - MT10-4 is seen red: without `hasOwnProperty`, `entry.replace is not a function`.
  - The replacer is a function, so a `$&` or `$'` in the server message is not expanded. Measured by my probe:
    `面板内部出错：a $& b $' c` (`$SCRATCH/rev-t10-probe.txt`).
- **F13**: web-made messages are built with `i18n.t` at construction time and keep that language. My probe shows a message
  built in zh and then read in en staying Chinese (`SHOWN-EN` line), which is the registered behaviour.
- **English byte-identity**: pinned by the first test (`refusalText.test.tsx:740-749`) on all three surfaces. Every `en`
  value equals the literal it replaces in the diff's `-` lines.

### The two changed brief values (`reviews-store-busy`, `reviews-store-is-symlink` carry `{{message}}`)

**Accepted: the change is correct, and the evidence is one-sided.**

- I checked `src/panel/api.ts:366-376`. When the `reviewed` append fails after a correction landed, the server answers 409 with
  `code` = the `PanelRejection` code (`reviews-store-busy` / `reviews-store-is-symlink`, else `panel-internal-error`) and
  `message` = "the correction was recorded (id …), but the reviewed mark could not be written: …".
  - That sentence is the only place the person learns the correction was stored and gets its id (spec §4.3.1, `Refusal.tsx`
    header).
  - The brief's entries would have replaced it in Chinese with a generic sentence. `panel-internal-error` already carried
    `{{message}}`; these two now match it.
- There is a second reason the report does not give. The English messages themselves carry actionable data:
  - busy: the lock path and "if the directory is stale, remove it by hand" (`reviewsLock.ts:33-37`);
  - symlink: the link path and the `ORCA_CORRECTIONS_DIR` remedy (`compactReviews.ts:102-106`).

  The brief's "请稍后重试" would even be wrong for a stale lock.
- Pinned by `refusalText.test.tsx:757-759` and seen red by MT10-23/24 (`$SCRATCH/t10-mut-summary.txt`).
- **For the controller (Rule 13):** the plan and brief still carry the old two values. Record the change as a correction
  note. Do not edit the brief's text.

### Does the coverage criterion read the catalog at run time?

**Yes.** `refusalCoverage.test.ts:30` calls `controlErrorCatalog()` when the test runs. My mutation RV1 checks this. I added
`"a-future-code": 409` to `readErrorStatuses` in `src/panel/controlErrors.ts`, in the clone.
- Result: rc=1, red at `refusalCoverage.test.ts:32` with `expected [ 'a-future-code' ] to deeply equal []`
  (`$SCRATCH/rev-t10-RV1.txt`, read whole).
- Restore: `cmp` rc=0, empty `$SCRATCH/rev-t10-RV1-restore.txt`.
- The `>= 124` floor stops the check from passing on an empty catalog.

`WEB_MADE` and `BY_HAND` are static lists. A future inline server code, `ChainRejection` code or web-made code with no zh entry
would **not** turn it red. The spec (§3.2, "listed by hand in the plan") and the brief mandate this; see Minor 1.

### Is any code the panel can show outside the criterion?

**No, at HEAD.** One focused check per path that feeds a rendered refusal. Only `Refusal` (App, ChainPanel), `ErrorPage` and
the `ControlPanel` control line render a refusal message. Every other site renders only the code
(`web/src/*.tsx` grep for `.message` / `.code`).

- **Control routes:** `sendMappedControlError` (`src/panel/controlErrors.ts:63-85`) collapses every non-catalog `ControlError`
  to `control-internal-error`.
  - The literal `sendControlError` codes in `src/panel/controlApi.ts` (`query-invalid`, `command-result-not-found`,
    `control-target-not-allowed`, `route-not-found`, `control-non-json-payload`) are all in the catalog.
  - So are `token-required` and `panel-host-not-allowed`.
  - The internal codes my scan found (`control-response-invalid`, `budget-overrun`, `usage-regression` and others) never
    reach the wire.
- **`src/panel/api.ts`:**
  - `decision-not-found` and `panel-bad-request`.
  - `panel-internal-error`, both at :434 and :368.
  - The `CorrectRejection` codes that `recordNewCorrection` can throw (`record.ts:47`, `store.ts:8-10`, `storeLock.ts:7`).
  - The six `MetricsRejection` codes (`src/metrics/{discover,resolve,collect}.ts`).
  - The two `PanelRejection` codes on the request path (`reviewsLock.ts`, `compactReviews.ts`).

  All are in `BY_HAND`. The other `PanelRejection` codes (`malformed-port`, `panel-no-address`,
  `external-bind-not-confirmed`, `no-viewer-identity`, static files) are raised at startup and never reach a browser. The
  CLI-only `CorrectRejection` codes (`original-decision-not-found`, `no-chose-instead`, `repo-locked`, `no-git-identity`,
  argument errors) are not on the panel's `recordNewCorrection` path.
- **Chains:** the only producer of the `rejected: <code>:` line that `chains.ts:166` parses is `src/chain/command.ts:55-56`,
  and it only prints `ChainRejection`s. All 26 literal `new ChainRejection("…")` codes in `src` are in `BY_HAND`, and there
  is no non-literal construction. `chain-start-failed`, `chain-start-timeout` and `repo-not-found` are covered.
- **Web-made:**
  - `http-<n>` (`api.ts:47`, `controlApi.ts:52`) and `http-unreachable` (`controlApi.ts:52`, status null);
  - `panel-unreachable` (`api.ts:63`) and `command-result-invalid` (`controlApi.ts:178`).

  All are covered, and `http-unreachable` does not match `/^http-\d+$/`, so it keeps its own entry.
- Method: extract every quoted kebab code in rejection or error constructors and `code:` literals under `src/panel`,
  `src/corrections`, `src/metrics` and `src/control` (`$SCRATCH/rev-t10-codes.txt`). Compare with the zh keys, and trace
  each of the 65 codes left over (`$SCRATCH/rev-t10-missing.txt`) to its producer. Every one is startup-only, CLI-only,
  internal-and-mapped, or not a code at all (`orca-loop-recipe-v1`, `panel-shutdown` = an actor name).

## Strengths

- The implementer found and fixed a real information loss in the brief (the two reviews-store entries). The fix is pinned
  with the exact server sentence shape (`the correction was recorded (id c-1)…`), not a placeholder.
- The fifth test (`refusalText.test.tsx:792-807`) stubs `fetch` and exercises all six `controlApi` fallback sites in zh
  through the real request functions. Each site has its own mutation (MT10-16..21). No site was merely asserted by
  construction.
- The Review Focus 4 test covers `__proto__` as well as `toString` and `constructor`. MT10-4 fails loudly (`entry.replace is
  not a function`), so the guard cannot be removed silently.
- There are 24 mutations, each with its own red and a `cmp`-verified restore. `t10-copy.txt` is empty (0 bytes, measured).
  The unobservable site (`panelErrors.httpStatus`, same text in both languages) is named, not hidden (Rule 12).
- `setup.ts`'s `afterEach` restores `en`, so the tests that switch to zh do not leak into the next one. The fourth test's
  first two English assertions really run in English.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **Plan-mandated: in Chinese, an uncertain POST that got a non-JSON 5xx hides "the panel may not have committed this
   command".**
   - Where: `zh.ts` `"http-status": "面板返回了 HTTP {{status}}，没有给出错误码。"` together with `i18n.ts:413`.
   - How it happens: `sendControlCommand` (`controlApi.ts:169`) builds code `http-5xx` with the message
     `POST <path>: 面板可能没有提交这条命令`. `App.tsx:299,416,427` put that refusal on the control line. `refusalText` maps
     `http-5xx` to the `http-status` entry, which does not carry `{{message}}`, so the only sentence saying the outcome is
     unknown disappears.
   - Measured in the clone (`$SCRATCH/rev-t10-probe.txt`, `fetch` answering `Bad Gateway`, 502): refusal
     `{"status":502,"code":"http-502","message":"POST /api/control/x: 面板可能没有提交这条命令"}`, shown as
     `面板返回了 HTTP 502，没有给出错误码。`. English shows the full sentence.
   - Impact:
     - For group commands, the `control.outcomeUnknown` line still says the outcome is unknown.
     - For `sendWorkspaceMode` and `sendAgentPreferences`, no uncertain entry is kept, so the control line is the only
       notice. A Chinese reader is told the command failed with a status. A resend is guarded by `expectedRevision`, so
       nothing runs twice, but the reader is misinformed.
   - It is the same class of loss as the reviews-store case the implementer fixed. The implementer's own test
     (`refusalText.test.tsx:806`) checks the raw message, never what is displayed, so it cannot see this.
   - Fix: give `http-status` a `{{message}}`, e.g. `面板返回了 HTTP {{status}}，没有给出错误码：{{message}}`.
     - The message is always web-made, and after this Task it is already in the reader's language.
     - Update the brief's pinned expectation at `refusalText.test.tsx:755`.
     - Add an assertion that renders an uncertain 5xx answer through `controlLine` in zh.

     This also brings back the `GET <path>` that the zh `http-status` line drops today. The human decides, because the
     brief mandates the value.

### Minor (Nice to Have)

1. **Plan-mandated scope limit.** `refusalCoverage.test.ts:11-25`: `WEB_MADE` and `BY_HAND` are fixed lists. A new
   `ChainRejection`, `MetricsRejection`, request-path `PanelRejection`, `CorrectRejection` or web-made code with no zh entry
   stays green, and in Chinese it would silently fall back to the English message; the code is still shown.
   - The catalog half is mechanical (RV1 above). The spec's §3.2 wording calls the web-made codes "mechanical" too, but they
     are hand-listed here.
   - A cheap hardening, if wanted: have the criterion also scan `src/chain` for `new ChainRejection("…")` literals.
2. `i18n.ts:416` `String(refusal.status ?? "")`: the null arm is unreachable today (only `http-status` carries `{{status}}`,
   and `http-<n>` always has a number). No mutation is named for it (Rule 9 / P16). List it as unobservable, or drop the
   `?? ""`.
3. The function-replacer choice (`i18n.ts:416`) is right (probe above) but not pinned. No test message contains `$`, so
   replacing it with a string replacement `refusal.message` would stay green. Put `$&` in one `{{message}}` assertion.
4. The brief's `http-status` wording also drops the request path in Chinese for a GET (`GET /api/x answered 503` →
   `面板返回了 HTTP 503，没有给出错误码。`). Fixing Important 1 fixes this too.

## Assessment

**Task quality:** Needs fixes. One plan-mandated Important remains for the human to rule on. Everything else is approved.

**Reasoning:** `refusalText`, the error page, the control line and all web-made messages match the brief, and the English
byte-identity is pinned. The catalog is read at run time, and every code the panel can render has an entry at HEAD. The
implementer's two-value deviation is correct. The same reasoning applies to the brief's `http-status` entry, which hides the
"may not have committed" notice from Chinese readers on a non-JSON 5xx.

## Re-review (fix round 1)

Re-reviewer: scoped re-review subagent of session `e604b1ba` (Claude Opus 5.5), 2026-10-01. Range `1ff2149..ee57fc9`
(package `review-1ff2149..ee57fc9.diff`, read whole; report `task-10-report.md` "Fix round 1"). Controller ruling applied:
zh `http-status` = `面板返回了 HTTP {{status}}，没有给出错误码：{{message}}` plus a zh control-line assertion.
Probe run only in `$SCRATCH/rev-t10/repo`. The two changed files were written in from `git show ee57fc9:<path>`; `git diff --stat`
in the clone equals the commit's stat (`$SCRATCH/rr-t10-stat.txt`, `$SCRATCH/rr-t10-clonediff.txt`).

### Finding Verdicts

- **Important 1 (zh hides "the panel may not have committed this command" on an unparsable 5xx command POST)** — ADDRESSED.
  - `web/src/locales/zh.ts:535` is now exactly the ruled text.
  - Same probe as the first review (`revProbe.test.ts`: `fetch` answers `Bad Gateway`, 502), re-run at the fix: `SHOWN 面板返回了 HTTP 502，没有给出错误码：POST /api/control/x: 面板可能没有提交这条命令`
    (`$SCRATCH/rr-t10-probe.txt`, rc=0, read whole). Before the fix it showed `…没有给出错误码。`.
  - The zh control-line assertion is there: `web/tests/refusalText.test.tsx:125`. It goes through the real
    `sendControlCommand` and `controlLine`, and it is placed after the call under test. It is not a read-back of a value the
    test wrote itself. The report's MT10-25 shows it red in both tests when `{{message}}` is removed; the restore was checked with `cmp`.
  - Minor 4 (a GET losing its path in zh) is gone as a side effect: `refusalText.test.tsx:66`.

### New Breakage in the Fix Diff

None. The only `http-<n>` builders are `api.ts:47` and `controlApi.ts:52`. The message is always either the server's own
string or the web's own fallback, so `{{message}}` always has content. Minor, not blocking: if a server sent `message: ""`
with no code, zh would end in a bare `：`.

### Out-of-Scope Observations

None new. Minors 1-3 from the first review are still open, as the ruling did not ask for them.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
