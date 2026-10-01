# SDD ledger — C4 plan change and a three-hour v2 phase timeout

Session `ceca1c47` (controller), 2026-10-01. Base: main at the commit titled
`docs(handoff): loop-plan follow-ups and panel languages landed; the human reviews this round's rulings and zh text next`
(local = remote, `/usr/bin/git ls-remote` at session start in all three repos).

## Human rulings (in the conversation, 2026-10-01)

- H1, on the phase timeout: asked why 2,147,483,647, "定在 3小时是不是可以？我预期默认值是在 3-10 小时之间"; then "阶段超时 => 同意3小时".
- H2, on C4 (rewrites `loopPlans.test.ts` "each plan's rules land in the contract (criterion 2)" 7 cells and the
  loopPlanView successCondition line) and the ccloop root fix: "同意".
- H3: "C4 => 这次临时允许你直接改 v2。v2虽然push了，但是还没人用。"
- H4: "两本台账里其余的 Ruling => 都认可" (the `Ruling:` lines of the 2026-10-01 loop-plans-followups and panel-i18n
  ledgers). The controller's question had also named the i18n plan's Controller rulings and zh-review.tsv; the answer
  did not mention zh-review.tsv, so it is not recorded as reviewed.
- H5, on the scratchpad clones: "删".

## Clone deletion (H5)

Listed every directory holding `.git` under the Orca project's old session scratchpads (excluding this session):
314, top-level only; no process held them (`lsof +D`). C4 patch copied to this session's scratchpad first (`cmp` 0).
Deleted with `/bin/rm -rf`; afterwards 0 `.git` left outside this session; scratch root 2.8G → 647M (`du -sh`).
Logs, reports and evidence files kept.

## Change

- `src/control/loopPlans.ts`: the scratch C4 patch (`e604b1ba…/scratchpad/w7/c4-impl-only.patch`) applied as is;
  v2 `perAttemptTimeoutMs` 10_800_000; comments name H1/H3.
- `web/src/locales/{en,zh}.ts`: design v2 / investigate v2 discipline text = the registry's new English; new Chinese
  for the two lines (not in zh-review.tsv; the human has not seen it).
- Spec `2026-09-30-loop-plans-design.md` §13 (appended).

Ruling: the bugfix suffix, discipline texts and document-check commands are the scratch patch's, unchanged — cost:
none measured beyond the criteria below.

## Criteria

Red set measured in a clone with the change and old criteria (`scratchpad/red1.txt`, then `g1-web.txt`):
- named by H2: criterion 2 bugfix>rejectOn, design>verifierType/rejectOn/checks, investigate>verifierType/rejectOn/checks; loopPlanView "shows the plan, how it was chosen…" (objective line).
- follows H1 (v2 timeout pinned at MAX_TIMER_MS): loopPlans "%s v2: no file cap … phase timeout of MAX_TIMER_MS" ×5 (renamed "…of three hours"); loopPlanV2Derived "gives each phase the task's whole active time" (renamed "…three hours of the task's active time").
- NOT named, found by measurement (the 2026-10-01 C4 entry listed only the H2 set): loopPlans criterion 1 "expands bugfix's fixed input to exactly these bytes…" (v2 twin: timeout + suffix + rejectOn); web/tests/loopSummary.test.tsx design v2 ×4 and investigate v2 ×4 row literals, and "never puts a check command's text … only agent-verified plans say a model checks them" (agent-verified now depends on version).
- turned green by the change itself, not rewritten: tests/panel/taskLoopApi.test.ts "mirrors every plan's current version on the web side…" (en.ts mirror).
Ruling: rewrite all of them in the working tree and hold the commit until the human names the NOT-named group —
cost: one round trip; the project rule (CLAUDE.md, the human's item 7) names criteria per test.

New: `tests/control/loopPlanDocumentChecks.test.ts` (runs `documentCheck` output with `sh -lc` on real files).

After rewrite (clone, HOME + 4 XDG + TMPDIR redirected): related root 18 files 181 passed 1 skipped RC 0; related web
11 files 106 passed RC 0; `tsc --noEmit` RC 0 (`scratchpad/g2-*.txt`, `g1-tsc.txt`).

Mutations (clone `scratchpad/w`, `scratchpad/mut.py`, outputs `scratchpad/M*-root.txt`; restored, file equal to main tree):
| id | mutation | red |
|---|---|---|
| M1 | no document checks | criterion 2 design/investigate checks |
| M2 | documentCheck returns `true` | 3 loopPlanDocumentChecks + criterion 2 ×2 |
| M3 | no success-condition suffix | criterion 1, loopPlanView |
| M4 | v2 timeout back to MAX_TIMER_MS | v2 ×5, loopPlanV2Derived, criterion 1 |
| M5 | path not quoted | "one shell word" + criterion 2 ×2 |
| M6 | drop `-size +0c` | prefix case + criterion 2 design |
| M7 | drop `test -s` | exact case + criterion 2 investigate |
| M8 | document checks after the task's checks | criterion 2 ×2 |

## Gate (session `ceca1c47`, `scratchpad/gate.sh`, outputs `scratchpad/gate/`)

Fresh `clone --local` of both repos; Orca clone = main HEAD (title `docs(handoff): loop-plan follow-ups and panel
languages landed; …`) + the uncommitted change above copied in (`or-sync.txt`, every file `cmp` 0); HOME + 4 XDG
redirected; TMPDIR short real dir; fixture table fake codex `integration`; web built in the clone.
- ccloop (content = title `docs(handoff): roll the Orca section to 2026-10-01: …`): build / typecheck RC 0; 1087 tests,
  1086 passed, 1 failed (`stopProof`); `check-known-reds` RC 0; `check-tmp-leak` RC 0.
- Orca: web build / typecheck RC 0; 2365 tests, 2359 passed, 3 failed, 3 pending (`ccloopDefaultE2E`); web check 54
  files / 318 passed; `verify:panel` RC 0; `verify:ccloop-pin` RC 0 (3/3); `check-tmp-leak` RC 0.
  Failed: `driverLanding` D, `driverRecovery` "drives a retried run on…", `controlShutdown` (all known load flakes; 1-min
  load 43–45 during the run). Each file alone 3/3 RC 0 at load 5–6 (`gate/reruns.txt`).
- `~/.orca`: before/after listings differ only in the `..` line (home directory mtime); entries under `~/.orca` identical.

## Human rulings, second turn (2026-10-01)

- H6: "同意修改所有相关判据，修改后提交" — names every criterion listed under "Criteria" above, including the NOT-named group.
- H7, on zh-review.tsv: "我先认可，你之后告诉我位置，我再review一下。" — accepted provisionally; the human reviews it later. The two new v2 discipline lines in `web/src/locales/zh.ts` are not in that file.
- H8, on ccloop's rejectOn: "你看下如何做是整体最优的。提供你的建议和原因。" — controller recommends; the human picks before a spec is written.
