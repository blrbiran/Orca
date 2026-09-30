# Task 10 report — error page, refusals, web-made messages, zhErrors

Implementer: session e604b1ba (Task 10 subagent), 2026-10-01. BASE 5cb8ce4, on local `main`.
Commit: `1ff214921691ee635b73779c056ff170e46cf34d` — feat(web): show refusals in the reader's language, the code always beside them
(trailer read back with `/usr/bin/git log -1 --format=%B > $SCRATCH/t10-commit-msg.txt`: ends with the two required lines; tree clean after).

`$SCRATCH` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`

## Built

- `web/src/i18n.ts`: `refusalText(refusal)` exactly as the brief (hasOwnProperty lookup, `http-<n>` → `http-status`, `{{message}}`/`{{status}}` filled by a function replacer); imports `zhErrors`.
- `web/src/locales/en.ts` / `zh.ts`: `panelErrors` (11 keys, brief values), inserted after `agents`. `zhErrors`: 172 entries from the brief (one deviation, below).
- `ErrorPage.tsx`, `Refusal.tsx`, `ControlPanel.tsx:167-173`, `api.ts:47`, `controlApi.ts` (7 sites) as the brief. `GET ${path}` / `POST ${path}` fragments kept (F18).
- `tests/panel/refusalCoverage.test.ts` (brief verbatim), `web/tests/refusalText.test.tsx` (brief verbatim + additions below).

## Catalog at HEAD

`$SCRATCH/t10-cat.mts` via tsx → `$SCRATCH/t10-catalog.txt`: 124 codes at 5cb8ce4, `estimate-stale` included. Every one has an entry in the brief's table (the coverage criterion is green against the live catalog). **No code needed Chinese written beyond the brief's table** — nothing new for the human's zh review beyond the whole table (spec §5), plus the two changed entries below.

## Commands and results

| Step | Command (output file) | rc |
|---|---|---|
| red root | `vitest run tests/panel/refusalCoverage.test.ts` (`t10-red-root.txt`) | 1 — coverage red, 172 codes missing; placeholder test green (empty table) |
| red web | `vitest run tests/refusalText.test.tsx` (`t10-red-web.txt`) | 1 — 3 of 4 red (`refusalText is not a function` ×2, `GET /api/x answered 409`); the English byte-for-byte test green (it pins today's behaviour) |
| green root | `t10-green-root.txt` | 0 (2/2) |
| green web | refusalText, outcome, controlCommandRecovery, controlPanel, controlState (`t10-green-web.txt`) | 0 (40/40) |
| web check | `npm run check --workspace web` (`t10-web-check.txt`) | 0 — tsc + 52 files / 294 tests |
| typecheck | `npm run typecheck` (`t10-tsc.txt`) | 0 |
| related root | webParity, scanPanelText, noSkips, refusalCoverage (`t10-root-related.txt`) | 0 (12/12) |

All files read whole.

## Mutations (`$SCRATCH/mut-t10`, `git clone --local`, copy check `t10-copy.txt` empty)

Script `$SCRATCH/t10-mut.py`; summary `t10-mut-summary.txt`; all outputs concatenated in `t10-mut-all.txt` (read whole). Every mutation rc=1 with the named test red, every restore `cmp` rc=0 with an empty `t10-MT10-<n>-restore.txt`.

| id | edit | red test (file `t10-MT10-<n>-{root,web}.txt`) |
|---|---|---|
| MT10-1 | `refusalText` returns the message first | shows the Chinese entry … (revision-conflict) |
| MT10-2 | drop the English early return | renders an English refusal's message byte for byte … |
| MT10-3 | no `http-<n>` mapping | shows the Chinese entry … (http-503) |
| MT10-4 | `zhErrors[key]` without hasOwnProperty | shows the message as sent … (`entry.replace is not a function`) |
| MT10-5 | ErrorPage `{failure.message}` | shows the Chinese entry … (`没有连上面板：Failed to fetch`) |
| MT10-6 | delete `revision-conflict` entry | root: has a Chinese entry … (`['revision-conflict']`); web: shows the Chinese entry … |
| MT10-7 | api.ts literal `${what} answered ${status}` | builds the web's own refusal messages … |
| MT10-8 | `group-stopped` gets `{{detail}}` | interpolates nothing but … |
| MT10-9 | ErrorPage title raw English | shows the Chinese entry … (heading) |
| MT10-10 | ErrorPage "no answer from the panel" raw | shows the Chinese entry … (error-status) |
| MT10-11 | ErrorPage `answered ${status}` raw | shows the Chinese entry … (`返回了 409`) |
| MT10-12 | Refusal "Record another" raw | shows the Chinese entry … (record-another) |
| MT10-13 | ControlPanel " · server revision" raw | shows the Chinese entry … (control line) |
| MT10-14 | ControlPanel `{refusal.message}` | shows the Chinese entry … (control line) |
| MT10-15 | Refusal `{refusal.message}` | shows the Chinese entry … (refusal-message) |
| MT10-16 | controlGet "no answer" raw | builds the control requests' own fallback messages … |
| MT10-17 | downloadEvidenceArtifact "no answer" raw | same |
| MT10-18 | controlGet `answered ${status}` raw | same |
| MT10-19 | downloadEvidenceArtifact `answered ${status}` raw | same |
| MT10-20 | sendControlCommand "never answered" raw | same |
| MT10-21 | sendControlCommand "the panel may not have committed…" raw | same |
| MT10-22 | refusalFromAnswer noOutcome raw | builds the web's own refusal messages … |
| MT10-23 | `reviews-store-busy` back to the brief's text | shows the Chinese entry … |
| MT10-24 | `reviews-store-is-symlink` back to the brief's text | shows the Chinese entry … |

Unobservable site: `panelErrors.httpStatus` (`" · HTTP {{status}}"` is identical in both languages, so putting the raw English back renders the same bytes; the English control-line assertion still pins it).

Clone kept at `$SCRATCH/mut-t10` (deletion needs the human).

## Deviations and why

1. **`reviews-store-busy` / `reviews-store-is-symlink` carry `{{message}}`** (brief: `评审记录正被另一个写入者占用，请稍后重试。` / `评审记录文件是符号链接，面板拒绝写入。`; now `评审记录正被另一个写入者占用：{{message}}` / `评审记录文件是符号链接，面板拒绝写入：{{message}}`). Reason: `src/panel/api.ts` (~line 367-376) relays these codes for a failed `reviewed` mark with the message "the correction was recorded (id …), but the reviewed mark could not be written: …" — per Refusal.tsx's header (spec §4.3.1) that message is the only place the person learns the correction landed. The brief's entries would have hidden it in Chinese. Reversible; evidence one-sided (Rule 7). Pinned by two added assertions + MT10-23/24. Refusal.tsx's header comment says so.
2. **Criteria added beyond the brief** (dispatch contract's last bullet): in `refusalText.test.tsx`, the ErrorPage `返回了 409` status under zh, the two reviews-store assertions, and a fifth test "builds the control requests' own fallback messages in the reader's language" that stubs `fetch` (`vi.stubGlobal`, unstubbed in `afterEach`) to see the six controlApi fallback sites under zh. These were written after the implementation, so their red evidence is the mutations MT10-11, 16-21, 23-24, not a pre-implementation run.

## Concerns

- The human should review the whole zhErrors table (spec §5); the two changed entries above are the only values not from the brief.
- `panelErrors.httpStatus` is unobservable by language (same text).

## Fix round 1 (review Important 1, controller ruling)

Implementer: session e604b1ba (Task 10 subagent), 2026-10-01, on top of 1ff2149.

- `zh.ts` `http-status` → `面板返回了 HTTP {{status}}，没有给出错误码：{{message}}` (controller ruling). In Chinese, an unparsable 5xx on a command POST (code `http-5xx`) now keeps "面板可能没有提交这条命令", and a GET keeps its path.
- `refusalText.test.tsx`: the pinned `http-503` expectation is now `面板返回了 HTTP 503，没有给出错误码：GET /api/x answered 503`. The fifth test gained a zh control-line assertion: `fetch` answers `Bad Gateway` with status 502, `sendControlCommand` returns an uncertain answer, and `controlLine` of its refusal must be exactly `http-502 · HTTP 502 · 面板返回了 HTTP 502，没有给出错误码：POST /api/control/x: 面板可能没有提交这条命令`.
- Runs (all read whole):
  - `refusalCoverage`: `t10f1-root.txt` rc=0 (2/2).
  - The five web files: `t10f1-web.txt` rc=0 (40/40).
  - `npm run check --workspace web`: `t10f1-web-check.txt` rc=0 (52 files, 294 tests).
  - `npm run typecheck`: `t10f1-tsc.txt` rc=0.
- MT10-25, in `$SCRATCH/mut-t10`: the two changed files were copied in first (`t10f1-copy.txt` empty). Removing `{{message}}` from `http-status` (back to `…没有给出错误码。`) gave rc=1 (`t10f1-MT10-25-web.txt`), red in two tests:
  - "shows the Chinese entry …" (http-503);
  - "builds the control requests' own fallback messages …" (control line: `Received: "http-502 · HTTP 502 · 面板返回了 HTTP 502，没有给出错误码。"`).

  Restore: cmp rc=0, empty `t10f1-MT10-25-restore.txt`.
- Minor findings 1-4 are not addressed; the ruling did not ask for them. Minor 4 is fixed as a side effect.
