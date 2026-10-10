# Progress Task 3 implementation report

Owner: `/root/progress_task3`, 2026-10-10. Workdir: `/Users/biran/.codex/worktrees/progress-results-20261010/Orca`. Branch: `codex/progress-results-20261010`. Base: `7a5088391183bd1ba86216a50d95799d1d9095e2`. Implementation/source/test commit: `4043d40cfe4ae4d56d983b517efa435683d3d32b` (`feat(web): separate global and project settings`). This report is Task 3's own evidence; existing SDD history is untouched.

## Delivered scope

Two hash-backed navigation entries (`global-settings`, `project-settings`) compose existing controls. App retains browser preference ownership, shared operator preference reads/drafts, repository readers and all command handlers. Theme/language moved from the sidebar into GlobalSettings. Agent defaults explicitly describe their shared **panel operator** scope and continue to show the server's actual operatorId/revision, including a changed returned identity. Their POST retains the original `{ preferences }` payload and expectedRevision envelope, CSRF header, and re-read.

AuthGate exposes an additive AccountSettings context/surface with its ready Me and password-change transition callback. GlobalSettings mounts the ordinary password form and owner AddUser form once. The existing password validation, password API, session owner and all-session logout semantics are reused; ordinary instructions differ from the mandatory first-password gate. Identity/logout and the sole owner Notices instance remain above the shell. No duplicate fetchMe, password handler, AddUser instance or notice reader was added. The account frame still owns the same shell viewport; jsdom checks structure only.

ProjectSettings receives only the resolved project scope's explicit repository, with its workspace/integration values and the existing revision-aware callbacks. All, a pending/failed registry, and an unheld project expose a choose-concrete-project note and no repository save controls; they do not borrow a prior/first repository. Selection is through the existing global project picker. Import remains an operation in Tasks and the existing Overview import action. Group-level budget, frozen Agent/skill choices and actual integration remain in details. Archived read-only behavior and integer budget handling are unchanged.

Self-review found that the original settings senders put refusals only on the now-inactive Tasks line. Controller approved an App-only owner-keyed display map and per-owner send sequence, alongside the original dispatch (not a replacement). Both settings surfaces reuse RefusalNotice. Only setting POST answers enter this map, keyed by actual operator/repository; newer answers win, old-epoch replies cannot write current feedback, cached old-epoch feedback is hidden, and a known success clears that owner's feedback. Imports/groups/readers never masquerade as a settings save. No extra reads or new backend semantics.

## Scope/interface rulings

Controller approved the additive AuthGate surface, direct owner AddUser composition, sole global Notices placement, and resolved-project-only target design. A subsequent controller ruling approved owner-keyed display-only feedback because controlState.panelRefusal drops its event's scope and cannot alone establish attribution. Original three settings sender dispatch paths are preserved.

Actual inherited uncertain-outcome behavior: these three senders dispatch the panel refusal and re-read their default values, but do **not** dispatch `command-uncertain` or subscribe to a command lookup. Task 3 does not add a lookup, automatic retry or extra request. The settings notice remains until another known settings save or epoch invalidation; a criterion proves lost transport feedback and clearing on the next known save without inventing a lookup. Existing group/import lookup and outcome assertions still pass in full Web. This limitation is reported rather than relabelled as a resolved command.

Controller ruled Task 3 Step 4 satisfied by full Web plus relevant root member/permission/parity checks. No backend source changed. No Task-3 whole-root run was performed or claimed. The controller must run whole-root and actual HTTP browser geometry (desktop, 390px, short height) at the final branch gate; older whole-root evidence is not evidence for this source commit.

## TDD and setup evidence

Pre-commit runs (RED/GREEN/type attempts, both Web full runs, root type/build, Web build and the installed-package build setup attempt) observed HEAD `7a5088391183bd1ba86216a50d95799d1d9095e2` with Task-3-owned working changes. All post-commit clone, fixed-pin source-build, authentic root HTTP, default-package and panel runs observed source/test HEAD `4043d40cfe4ae4d56d983b517efa435683d3d32b`. The latter is byte-equal to the final frozen source/test files. The fixed-pin source has its separately verified ab824d1 identity. Commands/CWDs and native logs below identify the exact observation rather than attributing an early failed setup to the final code.

- Initial RED: `task3-red`, RC1, 8 failures / 1 existing mandatory-gate pass. Missing settings links/regions drove the expected failures; one new frozen-group selector used exact text instead of the actual accessible button name. The test setup was corrected, as was the actual integration endpoint/GET-vs-POST boundary, before implementation.
- Corrected behavioral RED: `task3-red-corrected`, RC1, 8 failures / 1 pass, all missing settings/account composition; the frozen-group setup reached the missing GlobalSettings surface. No import/transform error counted as RED.
- First GREEN iteration `task3-green1`, RC1: four selector failures (coexisting Password again fields; unnamed navigation queries seeing several navs; clone radio's actual label). These were test harness precision corrections, not relaxed permission/payload expectations.
- `task3-green2`, RC0: 162 tests across 12 files, including original auth, integration, project scope, member, Agent and i18n criteria.
- Feedback RED `task3-refusal-red`, RC1: actual preference POST refused, active GlobalSettings lacked the alert. Attribution RED `task3-attribution-red`, RC1: active feedback and late-owner return failed; strengthening the frozen-skill assertion also exposed that its task detail had not been opened. The task detail was opened rather than weakening the frozen-skill expectation.
- `task3-green3`, RC0: 68 tests across six files, including attributed feedback, frozen choices, epoch behavior, Overview async guards and archived behavior.
- Type setup attempts are retained: `task3-type1` RC1 used root-relative `web/tsconfig.json` inside npm's Web cwd; `task3-type2` RC2 exposed the moved old fixture prop and two inaccurate fixture types; `task3-type3` RC2 exposed the held-project Promise<void> type. Full Web typechecks then passed.
- First full Web `task3-web-full`, RC0: 98 files / 816 tests. Added final proof criteria for unread defaults, workspace refusal and uncertain feedback; `task3-focused-final` RC1 used the wrong assumed transport code. Existing API returns `http-unreachable`, corrected without changing production code. Final frozen full Web `task3-web-frozen-final`, RC0: 98 files / 818 tests, no skips/failures.
- Fixed-pin setup `task3-fixed-pin-build`, RC1: installed package excludes tsconfig.json, TS5058. This is a package/source setup failure, not a business failure or automatic approval rejection. Controller supplied `/private/tmp/orca-d9-ccloop-ab824d1`; absolute `/usr/bin/git` verified and automatically recorded HEAD `ab824d16004de2d3c1613a76ec0431520aa16cc9`, and the source build passed. No reinstall, repin or runtime switch.

## Exact old criterion changes

- `authGate.test.tsx` / **lets an owner add a user, checking the password twice before sending it**: render the additive AccountSettings surface under AuthGate; remove the old Menu click/closed-form placement assertions because owner management now lives in settings. Anchor `Password again` so the ordinary password form's `New password again` does not collide. Existing body, role, success and CSRF assertions remain. Other login/refusal/refresh/password/notice/member assertions are retained unchanged.
- `integrationScheme.test.tsx` / **is placed in Task control beside the workspace mode, and its Save reaches the panel's handler** becomes **is placed in Project settings beside the workspace mode, and its Save reaches the App's handler**: compose ProjectSettings instead of ControlPanel; preserve exact scheme `{ delivery: keep }` and revision 4 callback assertion. Existing owner/member read-only, confirmation, approval and command assertions remain.
- `controlI18n.test.tsx` / **shows the control summary, one group, recovery and the workspace mode in Chinese**: compose the moved WorkspaceModeSelector beside the original ControlPanel fixture; every original Chinese wording assertion is retained. Remove the now-removed ControlPanel default-save callback prop.
- `shell.test.tsx` / **round-trips every section through its hash and sends an empty or unknown hash to overview**: allow hyphens for the two binding hash names. **lists Requirements in the nav after Task control and keeps its pane mounted while another is active**: extend the exact section list with both settings entries. Default Overview, mounted panes, navigation and badges remain asserted.
- Shell-only fixtures in `shell.test.tsx`, `i18nDetect.test.tsx`, `i18nPseudo.test.tsx` remove the moved theme/language props; `i18nPseudo` also removes the moved workspace default callback. No detection, translation, role or refusal assertion was deleted. Existing App i18n-switch/browser persistence tests pass with the controls in GlobalSettings.

## Final verification

At source `4043d40cfe4ae4d56d983b517efa435683d3d32b` (disk/commit byte agreement verified for all 18 source/test files):

| Check | Native result |
| --- | --- |
| Final Web `check` | RC0; 98 files, 818 tests, no skips/failures |
| Root typecheck + root build | RC0 each |
| Web build | RC0; standard >500kB chunk warning retained |
| Fixed-pin ab824d1 source build | RC0 |
| Authentic root focused HTTP/permission/parity/freeze | RC0; 10 actual files, 149 tests |
| Correct agent-selection HTTP filename | RC0; 1 file, 12 tests |
| Default installed-package criteria, override unset | RC0; 3/3, no skips |
| Native panel verifier | RC0; PASS 0–14 |
| Restored committed-clone settings/account criteria | RC0; 16/16 |
| Independent clone faults | 23/23 intended semantic RC1; exact restore, working/cached diff bytes 0 |

The initial focused root argv supplied absent `tests/panel/agentApi.test.ts`; Vitest selected the ten real files and reported 149 tests. That nonexistent path is not claimed as a test. The correct `tests/panel/agentSelectionApi.test.ts` was then independently run: 12/12. Backend refusal assertions include member account creation, all-session invalidation, current-password failure, CSRF/session refusal, owner-only integration, repository workspace revision, shared operator identity/revision and frozen config/Agent/skills/integration binding. Original root test files were not edited.

Heavy gates ran sequentially. Root/Web builds precede the panel gate. The private owned runner `/private/tmp/orca-progress-results-20261010/run.py` records native argv before execution and retains unfiltered stdout/stderr plus RC. HOME/XDG/TMPDIR/CCMEM roots and fake agents are inherited from its controller-owned private environment; env.json was never printed. Vitest 5 runs use `--maxWorkers=2 --no-cache`, no min-worker option. Native diagnostic DEBUG_PRINT_LIMIT affects only Testing Library's diagnostic DOM display; captured native streams remain complete. No pipeline filters or swallowed RCs. Node SQLite experimental warnings and Vite's existing chunk warning are recorded.

## Native commands / logs / CWDs

Raw evidence root: `/private/tmp/orca-progress-results-20261010`. For each name below, `.command.json` is exact argv, `.log` is complete native output, `.rc` is numeric exit status, and `.cwd` records its cwd. Unless noted, cwd is the feature worktree above. Test/source byte agreement is in `task3-source-agreement.json`; complete raw-log audit (byte length/SHA256, every failure header, summaries and warnings) is `task3-raw-output-audit.json`; final source/restoration audit is `task3-final-audit.json`. These indexes accompany, not replace, the raw files.

| Evidence name | Exact native command | RC | CWD exception |
| --- | --- | --- | --- |
| task3-attribution-red | `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx --maxWorkers=2 --no-cache` | 1 | same |
| task3-default-pin | `env -u ORCA_CCLOOP_BIN ORCA_CCLOOP_DEFAULT_E2E=1 node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts --maxWorkers=2 --no-cache` | 0 | same |
| task3-fixed-pin-build | `npm --prefix /Users/biran/code/skills/loop/Orca/node_modules/ccloop run build` | 1 | same |
| task3-fixed-pin-source-build | `npm run build` | 0 | `/private/tmp/orca-d9-ccloop-ab824d1` |
| task3-focused-final | `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx --maxWorkers=2 --no-cache` | 1 | same |
| task3-green1 | `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx tests/authGate.test.tsx tests/shell.test.tsx tests/integrationScheme.test.tsx --maxWorkers=2 --no-cache` | 1 | same |
| task3-green2 | `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx tests/authGate.test.tsx tests/shell.test.tsx tests/integrationScheme.test.tsx tests/projectFiltering.test.tsx tests/projectSwitcher.test.tsx tests/agentSettings.test.tsx tests/i18nSwitch.test.tsx tests/i18nDetect.test.tsx tests/i18nPseudo.test.tsx tests/memberControls.test.tsx --maxWorkers=2 --no-cache` | 0 | same |
| task3-green3 | `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx tests/controlI18n.test.tsx tests/overviewApp.test.tsx tests/overviewFreshness.test.tsx tests/archiveGroup.test.tsx --maxWorkers=2 --no-cache` | 0 | same |
| task3-mutations | `python3 /private/tmp/orca-progress-results-20261010/task3-mutations.py` | 0 | same |
| task3-panel | `npm run verify:panel` | 0 | same |
| task3-red-corrected | `npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx --maxWorkers=2 --no-cache` | 1 | same |
| task3-red | `npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx --maxWorkers=2 --no-cache` | 1 | same |
| task3-refusal-red | `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx -t 'shows refused default changes' --maxWorkers=2 --no-cache` | 1 | same |
| task3-restored-green | `npm exec --workspace web -- vitest run tests/settingsScopes.test.tsx tests/globalSettingsAccounts.test.tsx --maxWorkers=2 --no-cache` | 0 | `/private/tmp/orca-progress-results-20261010/task3-clones/unread-integration` |
| task3-root-agent-api | `node_modules/.bin/vitest run tests/panel/agentSelectionApi.test.ts --maxWorkers=2 --no-cache` | 0 | same |
| task3-root-build | `npm run build` | 0 | same |
| task3-root-focused | `node_modules/.bin/vitest run tests/panel/auth.test.ts tests/panel/permissions.test.ts tests/panel/humanOnly.test.ts tests/panel/webParity.test.ts tests/panel/agentApi.test.ts tests/panel/workspaceModeApi.test.ts tests/panel/integrationApi.test.ts tests/control/agentPreferences.test.ts tests/control/agentFreeze.test.ts tests/control/confirmSkills.test.ts tests/control/integrationScheme.test.ts --maxWorkers=2 --no-cache` | 0 | same |
| task3-root-type | `npm run typecheck` | 0 | same |
| task3-source-commit | `git commit -m 'feat(web): separate global and project settings'` | 0 | same |
| task3-source-stage | `git add -- web/src/App.tsx web/src/AuthGate.tsx web/src/ControlPanel.tsx web/src/Shell.tsx web/src/GlobalSettings.tsx web/src/ProjectSettings.tsx web/src/locales/en.ts web/src/locales/zh.ts web/src/sections.ts web/src/styles.css web/tests/authGate.test.tsx web/tests/controlI18n.test.tsx web/tests/i18nDetect.test.tsx web/tests/i18nPseudo.test.tsx web/tests/integrationScheme.test.tsx web/tests/shell.test.tsx web/tests/settingsScopes.test.tsx web/tests/globalSettingsAccounts.test.tsx` | 0 | same |
| task3-type1 | `npm exec --workspace web -- tsc --noEmit -p web/tsconfig.json` | 1 | same |
| task3-type2 | `npm exec --workspace web -- tsc --noEmit -p tsconfig.json` | 2 | same |
| task3-type3 | `npm exec --workspace web -- tsc --noEmit -p tsconfig.json` | 2 | same |
| task3-web-build | `npm run build --workspace web` | 0 | same |
| task3-web-frozen-final | `env DEBUG_PRINT_LIMIT=1000 npm run --workspace web check -- --maxWorkers=2 --no-cache` | 0 | same |
| task3-web-full | `env DEBUG_PRINT_LIMIT=1000 npm run --workspace web check -- --maxWorkers=2 --no-cache` | 0 | same |

## Committed-clone proof details

All mutations used independent `/usr/bin/git clone --local --no-hardlinks` copies of the committed feature tree. Full HEAD was captured automatically with absolute Git, matched in each clone before mutation and after restoration, and equals `4043d40cfe4ae4d56d983b517efa435683d3d32b`. No feature-tree fault was applied. Each clone's exact original file was restored and both `git diff` and `git diff --cached` measured zero bytes. None of these faults failed due to a transform, ReferenceError or TypeError. Clones were retained, not deleted.

Per proof prefix `task3-mutant-<name>`, `.patch`, `.command.json` (includes sourceSha and cwd), `.log`, `.rc`, `.cwd` retain complete evidence. Clone creation prefixes are `task3-clone-<name>`. Native mutant test command is `env DEBUG_PRINT_LIMIT=1000 npm exec --workspace web -- vitest run tests/<criterion-file> --maxWorkers=2 --no-cache`, in the named clone. `task3-mutation-results.json` records every intended failure header, log hash, exact source SHA and restore proof; `task3-mutations.py` is the executable orchestration. The final restored clone then ran both complete added files, 16/16 green.

| Fault | Criterion file / intended failing behavior | Native result / restoration |
| --- | --- | --- |
| implicit-all | `settingsScopes.test.tsx` / requires deliberate concrete selection | RC1 semantic; exact restore; working0/cached0 |
| concrete-required | `settingsScopes.test.tsx` / requires deliberate concrete selection | RC1 semantic; exact restore; working0/cached0 |
| reply-sequence | `settingsScopes.test.tsx` / does not replace the newest settings answer | RC1 semantic; exact restore; working0/cached0 |
| reply-epoch | `settingsScopes.test.tsx` / hides cached settings errors | RC1 semantic; exact restore; working0/cached0 |
| cached-epoch | `settingsScopes.test.tsx` / hides cached settings errors | RC1 semantic; exact restore; working0/cached0 |
| success-clear | `settingsScopes.test.tsx` / keeps late repository refusals | RC1 semantic; exact restore; working0/cached0 |
| owner-tag | `settingsScopes.test.tsx` / shows refused default changes | RC1 semantic; exact restore; working0/cached0 |
| global-refusal | `settingsScopes.test.tsx` / shows refused default changes | RC1 semantic; exact restore; working0/cached0 |
| project-refusal | `settingsScopes.test.tsx` / shows refused default changes | RC1 semantic; exact restore; working0/cached0 |
| unknown-refusal | `settingsScopes.test.tsx` / shows an unknown settings outcome | RC1 semantic; exact restore; working0/cached0 |
| integration-feedback | `settingsScopes.test.tsx` / shows refused default changes | RC1 semantic; exact restore; working0/cached0 |
| operator-feedback | `settingsScopes.test.tsx` / shows refused default changes | RC1 semantic; exact restore; working0/cached0 |
| owner-only-user | `globalSettingsAccounts.test.tsx` / lets a member change their own password | RC1 semantic; exact restore; working0/cached0 |
| password-login | `globalSettingsAccounts.test.tsx` / lets a member change their own password | RC1 semantic; exact restore; working0/cached0 |
| normal-lede | `globalSettingsAccounts.test.tsx` / lets a member change their own password | RC1 semantic; exact restore; working0/cached0 |
| first-password-gate | `globalSettingsAccounts.test.tsx` / retains the mandatory first-password gate | RC1 semantic; exact restore; working0/cached0 |
| duplicate-notices | `globalSettingsAccounts.test.tsx` / mounts one owner Add user surface | RC1 semantic; exact restore; working0/cached0 |
| no-frozen-agent-rewrite | `settingsScopes.test.tsx` / default saves preserve the open confirmed group | RC1 semantic; exact restore; working0/cached0 |
| no-frozen-skill-rewrite | `settingsScopes.test.tsx` / default saves preserve the open confirmed group | RC1 semantic; exact restore; working0/cached0 |
| no-frozen-integration-rewrite | `settingsScopes.test.tsx` / default saves preserve the open confirmed group | RC1 semantic; exact restore; working0/cached0 |
| unread-agent | `settingsScopes.test.tsx` / keeps unread defaults explicit | RC1 semantic; exact restore; working0/cached0 |
| unread-workspace | `settingsScopes.test.tsx` / keeps unread defaults explicit | RC1 semantic; exact restore; working0/cached0 |
| unread-integration | `settingsScopes.test.tsx` / keeps unread defaults explicit | RC1 semantic; exact restore; working0/cached0 |

The epoch-arrival fault and cached-epoch fault independently fail the cross-epoch behavior; the sequence fault fails earlier-refusal-after-newer-success; owner-tag deletion fails cross-surface attribution. Presentation/absence branches additionally prove unavailable defaults remain explicit. Frozen Agent, skill and integration rewrites each independently fail the actual rendered open confirmed group after saving a changed default, alongside unchanged group-only commands/config in root freeze criteria.

## Files and self-review

- `web/src/App.tsx`
- `web/src/AuthGate.tsx`
- `web/src/ControlPanel.tsx`
- `web/src/GlobalSettings.tsx`
- `web/src/ProjectSettings.tsx`
- `web/src/Shell.tsx`
- `web/src/locales/en.ts`
- `web/src/locales/zh.ts`
- `web/src/sections.ts`
- `web/src/styles.css`
- `web/tests/authGate.test.tsx`
- `web/tests/controlI18n.test.tsx`
- `web/tests/globalSettingsAccounts.test.tsx`
- `web/tests/i18nDetect.test.tsx`
- `web/tests/i18nPseudo.test.tsx`
- `web/tests/integrationScheme.test.tsx`
- `web/tests/settingsScopes.test.tsx`
- `web/tests/shell.test.tsx`

Reviewed every changed source/test diff and the actual new settings files against the Task 3 brief, global constraints and progress spec §4 / effective §8. Existing Overview source/navigation handlers and all group hierarchy/actions remain intact. The main implementation files were already large; this task adds only two focused views and the additive account surface, with no adjacent restructuring. CSS constrains settings text/fields/table and keeps the established skin/common viewport. Real-browser pixel/overflow geometry is deliberately not inferred from jsdom; controller final gate remains required.

Own source/test working diff bytes and cached diff bytes are zero after the source commit. Controller dirty `plan-self-review.md` and untracked node_modules were excluded and left untouched. Report is the only additional task-owned write. No backend authorization/schema, package/lock dependency, paid provider, runtime/data, main merge, push or deletion was performed. No subagent/reviewer was spawned.

Concerns: inherited settings unknown-outcome lookup limitation described above; large existing App remains an architectural constraint; routine build/runtime warnings are retained. No unresolved Task 3 implementation failure is known. Final whole-root and actual browser geometry are controller-owned outstanding branch gates, not passed claims in this report.
