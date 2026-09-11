# Task 1 Review — workspace + express + `orca panel` skeleton + verify wiring

Base `eab103e`, head `29c0de4` (single commit). Reviewed against `task-0-brief.md`,
`task-1-brief.md`, `task-1-controller-notes.md` (binding), and spec §§1.2, 2, 2.1, 2.2, 3.1,
3.3, 9 item 2.

### Spec Compliance (✅)

- ✅ `package.json`: `workspaces: ["web"]` added; `os: ["darwin","linux"]` kept at root only;
  `express`/`@types/express` added; `verify` gains `npm run --ws check` as the **last** stage
  (verified: `... && npm run verify:scheduler && npm run --ws check`). Matches brief Step 3 and
  controller ruling C1 (edited in place, no stray fields lost).
- ✅ `web/package.json`: no `os` field (spec §9 item 2 — not propagated); no
  `web/package-lock.json` on disk or in the diff (checked directly and via `grep` on the
  lockfile diff — global constraint 8 held).
- ✅ `web/tsconfig.json`, `web/vite.config.ts` (C3: `defineConfig` from `"vitest/config"`, not
  `"vite"` — confirmed empirically per report and structurally consistent with the hoisted vs.
  nested `vite` version conflict described), `web/index.html` (token anchor comment present
  verbatim), `web/src/main.tsx`, `web/src/App.tsx` (C2: `import type { JSX } from "react"`)
  all match the brief's target content exactly.
- ✅ `src/panel/rejection.ts`, `src/panel/server.ts`: byte-for-byte match to the brief's minimal
  stub. `--by` is required with no default (spec §3.1); dynamic `import()` used for both
  `startPanelFromArgs` and `PanelRejection` in `src/cli.ts`'s `runPanel` — confirmed no static
  `import` of `express` or `./panel/*` anywhere in `src/cli.ts` (grep), so `orca validate` etc.
  never load express.
- ✅ `src/cli.ts`: USAGE block for `orca panel` carries the exact spec §3.3 sentence ("does not
  suit a team") and `--i-know-this-is-exposed`; the `command === "panel"` branch is correctly
  placed. `main([])` (no subcommand) falls through to `process.stderr.write(USAGE); return 1;`
  — confirmed at src/cli.ts:371-372 — so the new `tests/panel/usage.test.ts` criterion is real
  and can fail (not vacuous).
- ✅ Root isolation (C5): confirmed root `tsconfig.json` include (`src/**/*.ts`,
  `tests/**/*.ts`, ...) and root `vitest.config.ts` include (`tests/**/*.test.ts`) neither
  reach `web/**/*.tsx`; no root config file was touched, matching the report's claim that C5
  measured negative.
- ✅ `tests/panel/usage.test.ts` reuses `captureStreams` from `tests/scheduler/sandbox.ts`,
  the same cross-directory import pattern `tests/metrics/cli.test.ts` already uses
  (`captureStdout` from the same file) — not a new pattern, no new export added to `cli.ts`.
- ✅ Lockfile named risks: (a) no `web/package-lock.json` added (grep, zero hits); (b) all
  268 `"resolved"` entries point at `https://registry.npmjs.org/` except the internal
  workspace link `"node_modules/@orca/web": {"resolved": "web", "link": true}`, which is the
  expected local workspace pointer, not an external fetch; (c) the `web` lockfile package
  entry's direct `dependencies`/`devDependencies` match `web/package.json` exactly, and the
  root package entry's direct deps match root `package.json` exactly.
- ✅ Rule 17 (no writes to real `~/.orca`): task touches nothing under corrections/panel
  persistence yet; `~/.orca` confirmed absent both before and after.
- ✅ Attribution: commit trailer uses this session's live instruction (Sonnet 5) rather than
  the stale one embedded in the controller notes, and the deviation is stated in both the
  report and the commit body — correct call per the system's own overriding instruction.
- ✅ Decision-log citation (C8): `.decisions/orca-dev-ad1e30c6.jsonl` has exactly 2 lines;
  entry `/1` is the React/workspaces decision, entry `/2` is the express decision — verified
  directly, matches the commit message's citation.

⚠️ Cannot verify from the diff alone: actual `npm install` / `npm run verify` runtime
behavior (report claims `VERIFY_RC=0`, 85/477 whole-repo tests, 51/167 scheduler, 1/1 web
check) — not re-run per instructions; left to the independent verifier. Also cannot verify
from the diff alone whether the 5 npm audit vulnerabilities the report flags are pre-existing
in the reference dependency tree or newly introduced by `express`/vite's transitive deps —
would need a registry audit, out of scope for this diff-based review.

### Strengths

- Every controller ruling (C1–C9) is both applied correctly in the code and narrated
  correctly in the report/commit message, with a concrete empirical repro for the two
  rulings that predicted TypeScript failures (C2, C3) rather than just asserting they fired.
- The report does not paper over the brief's own defect: Step 2 predicted "5 red," the
  actual run produced "4 red, 1 green" (the lockfile-absence test is vacuously true before
  `web/` exists). This is disclosed with the actual assertion lines, not hidden — good-faith
  compliance with Rule 12 (fail loud) and Rule 9's evidence discipline, even though it also
  correctly recognizes it isn't the implementer's contract to edit that test file.
- Dynamic-import discipline (`await import("./panel/server.js")` / `await
  import("./panel/rejection.js")`) is followed exactly as the brief specifies, and was
  verified independently here by grepping `src/cli.ts` for any static `express`/`panel`
  import — there are none.
- `web/tests/App.test.tsx` was added per ruling C4 with a real assertion
  (`renderToStaticMarkup` contains `"orca panel"`) instead of reaching for
  `--passWithNoTests`, with an inline comment explaining why the test exists — avoids a
  silent gate.

### Issues

#### Critical
None.

#### Important
None. The one open item — untriaged npm audit findings (3 moderate/1 high/1 critical) — is
called out honestly in the report as out-of-scope for a workspace-registration task and does
not correspond to anything the briefs or rulings asked this task to fix; not treating it as
blocking here.

#### Minor
- `tests/panel/workspace.test.ts:46-52` ("gives web/ no lockfile of its own"): as the report
  itself flags, this assertion was vacuously satisfied before this diff (root
  `package-lock.json` pre-existed, `web/package-lock.json` never existed) and is not exercised
  by anything this diff changes — it only becomes a live regression guard going forward. This
  is a property of the brief's prescribed test file, not something the implementer was
  authorized to rewrite, and it is already disclosed under "Concerns" in the report. No action
  needed inside this task.
- `web/package.json`'s `check` script criterion (`expect(web.scripts.check).toBeTypeOf("string")`)
  only checks presence/type, not that `check` actually runs both `tsc` and `vitest` — again
  inherited verbatim from the brief's Step 1 test file, not an implementer choice.

### Assessment

**Task quality:** Approved

**Reasoning:** Every file in the diff matches its brief-specified target content exactly
(byte-for-byte for the stub/config files), all controller rulings C1–C9 fired-or-not exactly
as measured and are independently verifiable in the current tree (root/web tsconfig excludes,
express only reachable via dynamic import, `--by` required with no default, spec §3.3 sentence
present and pinned by a non-vacuous criterion, decision-log citation checked line-by-line).
Global constraints (English-only, `--by` always required, no `os` propagation, single root
lockfile, dynamic-import discipline) all hold under direct inspection. The report is candid
about the two soft spots it found (the brief's own "5 red" prediction not holding, and one
vacuous-until-later assertion) rather than smoothing them over, which is exactly the standard
Rule 12 asks for. No defect in this diff rises above Minor, and both Minor items trace back to
the brief's prescribed test content rather than to implementation choices.
