# Task 8 — controller notes (binding; they override the brief where they conflict)

Read after `task-8-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" means: run it, redirect to a file, read
the file whole. Never pipe or grep a verifying run.

⚠️ The brief is "criterion outlines, filled in at execution". **Every `it` you land must assert something that a named
mutation below can turn red.** An empty or assertion-free `it` is a defect.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.** `/usr/bin/git` for every git command.
- Scratch files in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/`.
  The brief's `/tmp/ws.txt` and `/tmp/whoF.txt` fixed names are NOT to be used.
- `/bin/rm` (local `rm`/`cp` are aliased to `-i`); guard variables in destructive commands with `"${VAR:?msg}"`.
- Code, comments, UI text and commit messages in English.
- **You do NOT run the named mutations** (an independent verifier does). You DO run the survey grep (redirected) and
  predict every mutation below.
- **Never `git stash`, reset or checkout in the main tree** (it holds the controller's uncommitted ledger and `.decisions/orca-dev-5d5c8055.jsonl`). To measure a red against BASE, use a throwaway `git clone --local` copy.
- **No subagents. Do not write to `.decisions/`.** Do not touch `.superpowers/sdd/**` except your own report file.
- 🔴 **Control bytes.** Never type a NUL-class escape sequence literally into a Write/Edit/heredoc (the tool has delivered
  such escapes as RAW bytes; git then treats the file as binary and the reviewer cannot read it). After your last edit,
  byte-scan every touched file (count bytes < 0x20 other than tab/LF/CR) — all must be 0.
- Server endpoints that exist at BASE (read `src/panel/api.ts`): `GET /api/metrics` → `{ report, panel_review_coverage }`;
  `GET /api/decisions` → `{ rows }`; `GET /api/decision?projectKey&decisionId` (build it with `detailUrl` semantics) →
  `{ decision }`; `POST /api/corrections` body `{ projectKey, decisionId, kind, because, chose_instead?, again? }`;
  `POST /api/reviews` body `{ projectKey, decisionId }`. Every `/api` call carries header `x-orca-token`; the token
  reaches the page through `TOKEN_ANCHOR` injection (read `src/panel/staticFiles.ts` for the anchor and how
  `web/index.html` must carry it — if `web/index.html` lacks the anchor today, add it).

## Rulings

- **K1 — real field names (carried ruling R9).** `src/metrics/types.ts` has no `overall`. The correction rate is
  `report.correction_rate.rate_excluding_stale` (null when the denominator is 0). Re-read the file; every field the
  view touches must exist there.
- **K2 — web types and their parity with the server (carried ruling R10; ruling R51).** `web/` cannot import `src/`.
  So `web/src/api.ts` (or a JSX-free `web/src/types.ts`) declares the web's own copies of `MetricsReport` (and its
  nested types), `PanelCoverage`, `DecisionListRow`, plus two constants: `WEB_REPORT_FIELDS` (the top-level report keys)
  and `WEB_LIST_FIELDS` (the list row keys). Parity is enforced from the ROOT side, twice:
  1. **runtime**: `tests/panel/webParity.test.ts` imports `METRICS_FIELDS` (src/metrics/types.ts) and
     `LIST_FIELDS` (src/panel/listProjection.ts) and the two web constants, and asserts set equality for each pair
     (sorted copies deep-equal — METRICS_FIELDS' order is deliberately not declaration order).
  2. **compile time**: the same file (or a sibling `.ts` under `tests/`) carries mutual-assignability checks that the
     root `npm run typecheck` sees, e.g. a function taking the server type and returning it as the web type and the
     reverse, for `MetricsReport`, `PanelCoverage` and `DecisionListRow`. Measure first whether the root tsconfig
     type-checks a file under `tests/` that imports from `web/src/` (include/rootDir); if it does not, report
     NEEDS_CONTEXT with the measurement rather than weakening this.
  The web types file must stay free of JSX and DOM-only globals so the root can import it.
- **K3 — the fixture lies ON PURPOSE, and is typed.** Type the metricsView fixture as the web `MetricsReport`; no
  `as never` anywhere (neither on the fixture nor at `<MetricsView report={…}>`). Keep `rate_excluding_stale: 0.99`
  against 3 of 10. Fill `repair_rate` field by field. Give each annotation a DISTINCT count so an assertion cannot
  pass on another number: e.g. 2 unresolved decisions, 3 malformed lines, 7 excluded as future; the stale bias
  assertion must look for the fixture's own `repair_rate.stale_only.known_bias` sentence (a bare `/stale/i` matches a
  label like "excluding stale" and pins nothing); E2's `caveats` arrays of both rates are rendered and asserted by
  their own fixture strings; the review-coverage caveat is `review_coverage.reason`.
- **K4 — the null-coverage criterion needs a positive observation.** Keep `not.toMatch(/\b0%/)` and add
  `toContain("unknown")` (or whatever the view prints for null — one literal, defined once in the view module and
  imported by the criterion).
- **K5 — the todo list is served, not computed in the browser (carried ruling R13; ruling R52).** spec §4.2's
  mitigation (default view = unreviewed high-tier decisions) needs the high-tier classification, and the frontend
  computes nothing. Add to the server:
  - `unreviewedHighTier(decisions, reviews): DecisionObservation[]` in `src/panel/coverage.ts`, next to
    `computePanelCoverage`, reusing its `(projectKey, id)` key and `isHighTier` (one key definition, not two). A
    decision is listed when it is high tier and there is NO `reviewed` row with the same projectKey AND id; `opened`
    rows do not remove it. Output order: the order of `decisions`.
  - `GET /api/todo` in `src/panel/api.ts` (above the error handler, through `currentMetrics`, reading reviews with
    `readReviews`) → `{ rows: DecisionListRow[] }` projected with `projectForList`. Records nothing.
  - Root criteria in `tests/panel/todo.test.ts`: pure (a) reviewed high-tier excluded, (b) opened-only high-tier
    included, (c) low-tier excluded, (d) a reviewed row with the same id but another projectKey does not exclude;
    HTTP (e) a server with two high-tier decisions and one `POST /api/reviews` answers `/api/todo` with exactly the
    other one, deep-equal to its `LIST_FIELDS` projection built in the criterion (not by calling `projectForList`),
    and `readReviews` shows only the one `reviewed` row (nothing recorded by the GET). Reuse Task 6/7's HTTP harness
    and fixtures; every server gets a redirected `ORCA_CORRECTIONS_DIR`, a dist fixture, and closes in `finally`.
    Fixture decisions need kinds/scopes that `isHighTier` classifies — choose them by calling `isHighTier`, do not
    hard-code a table.
  - Web: `App` shows the todo list first (a `DecisionList` of the todo rows under its own heading), then the metrics
    view. Put the render in a pure component (`PanelHome({ todo, report, coverage, … })`) that `App` feeds after
    fetching, so a criterion can render it statically: it renders the todo rows' ids, and the todo heading precedes
    the metrics heading in the markup.
- **K6 — `DecisionList` renders only list fields.** Criterion: a row object carrying an extra `question` value renders
  HTML that does not contain that value but does contain the row's `id` (positive observation).
- **K7 — `DecisionDetail` renders the reasoning.** Criterion: given a decision with distinct `question`, `chose`,
  `because`, one alternative's `option` and `why_not`, the HTML contains each. Interaction (agree / correct buttons)
  has no frontend criterion — plan ruling 2's registered cost (Task 9's end-to-end run covers the HTTP side). Keep
  the click handlers thin: they call functions in `web/src/api.ts`.
- **K8 — plan ruling 2 (renderToStaticMarkup, no jsdom/testing-library)** is a ledger row the controller writes. Add
  no dependency to either package.json.
- **K9 — verify.** `npm run --ws check` must stay green and include the new web tests; root verify must include the new
  root criteria.

## Mutations the verifier will run (predict each; run the survey grep first)

| id | change |
|---|---|
| F-4 | `MetricsView` renders `numerator_corrections_excluding_stale / denominator_decisions` formatted as a percent instead of `rate_excluding_stale` |
| F-4b | `MetricsView` stops rendering all of E2's annotations (coverage reason, both caveats arrays, unresolved, malformed, stale bias, excluded as future) |
| F-4c | `MetricsView` stops rendering only `review_coverage.reason` |
| F-5 | the null-rate formatter prints `0%` for null |
| F-6 | `DecisionList` renders every key of the row object instead of only the list fields |
| P-8 | web `WEB_LIST_FIELDS` gains `"question"` (runtime parity) |
| P-8b | a nested field in the web `MetricsReport` type is renamed (`rate_excluding_stale` → `rate`) and the view follows it — the root typecheck must go red; report `npm run typecheck`'s RC, not only vitest |
| T-1 | `unreviewedHighTier` ignores reviews (every high-tier decision listed) |
| T-2 | `unreviewedHighTier` treats `opened` as reviewed |
| T-3 | `unreviewedHighTier` drops the `isHighTier` condition |
| T-4 | `unreviewedHighTier` keys reviews by decision id alone |
| H-1 | `PanelHome` renders the metrics view before the todo list |

For each use "red in X and only X" or "red in X and Y" — never "at least". Before each, answer: (1) does an earlier
assertion short-circuit before the named one? (2) who else walks the changed line (the five annotations share one
view — say exactly which criteria read each rendered string)? (3) where does the literal in the named assertion come
from — E2's report or the panel's own `PanelCoverage`?

## Final checks, after the commit

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report the three tiers
  separately. Baseline at BASE is in your dispatch. Report any `skipped`/`todo` count.
- `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — non-zero only because of controller files under
  `.superpowers/sdd/2026-09-10-panel-e3/`. List what you saw.
- `/usr/bin/git diff <BASE> HEAD --stat -- src/metrics` → empty. `/usr/bin/git diff <BASE> HEAD --stat` → no `Bin` line;
  `web/package.json` and `package.json` unchanged (K8).
- Byte scan of every touched file → all 0. `ls ~/.orca` → absent. `ps` for leftover `tsx`/panel processes.
- Stage by explicit path. Commit trailer names the model you actually are. Mutation reds in the message are predictions.

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-8-report.md`: measured red, survey grep,
the K2 tsconfig measurement, every mutation prediction with the three answers, verify tiers, porcelain, diffstats,
byte-scan counts, `ls ~/.orca`, process check, and every deviation with its reason. Final reply SHORT: status, commit
sha(s), one-line test summary, concerns.
