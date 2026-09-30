# Task 6 review: the chains area, and the switch's helper-built case

Task reviewer subagent of session e604b1ba, 2026-10-01. Range 1d036e2..4ff8d23 (one commit, `4ff8d23 feat(web): translate the chains area and its banners`), read from `review-1d036e2..4ff8d23.diff`. Read-only on the repository; own scratch files only under `$SCRATCH/rev-t6` (no clone was needed; no test was re-run).

### Spec Compliance

- ✅ Spec compliant. Every file the brief lists has its hunk:
  - `ChainPanel.tsx`: diff 44-227 (helpers 72-89, `ChainBanners` 95-118, `ChainPanel` 133-225).
  - `chainBanner.ts`: diff 238-249 (imports, `BANNER_TEXT = en.chains.banner`), 267 (`bannersFor` text via `i18n.t` at call time).
  - `App.tsx`: diff 32-33 (`chains.notLoaded`).
  - `en.ts`: 290, 312-318, 341-367, 390. `zh.ts`: 407-433, 455.
  - `chainsI18n.test.tsx`: new (460-559). `i18nSwitch.test.tsx`: one `it` added after the first (575-587).
- Interfaces hold: `chainStateText`, `costText`, `progressText`, `bannersFor` keep their signatures (diff 72-89, 261); `BANNER_TEXT` is still exported and English (F10). `web/tests/chainPanel.test.tsx` is untouched and green (`t6-green.txt`, 8 tests), and it still reads `BANNER_TEXT` at its lines 36 and 39.
- **Named risk: other callers of the changed helpers.** Checked with `grep -rn -e chainStateText -e costText -e progressText -e bannersFor -e BANNER_TEXT web/src web/tests > $SCRATCH/rev-t6/callers.txt` (rc=0, read whole). The chain helpers are called only inside `ChainPanel` (which subscribes via `useTranslation`) and `bannersFor` only in App's render (App.tsx:642), so every call site re-runs on a language change. `TaskDetail.progressText` is a different function (Task 7's).
- **Helper-built re-render (spec §3.3).** `bannersFor` is called during App's render, so the banner text is rebuilt on each switch; the added `i18nSwitch` case proves both directions (en → zh → en), and MT6-1 turns it red (`t6-MT6-1.txt` line 487: `'Chain finished acme-alpha: r-1知道了'` not containing `链已完成`).
- Plural rule: `sessionProgress` takes `n`, not `count` (diff 88, 365), as the Global Constraints require.
- Stop reason is data, shown as sent; category goes through `enumText("chainStopCategory", …)` (diff 76-79). A missing stop reads `common.unknown` for both parts, matching today's `"unknown"`.
- **English byte-identity, measured.** `tsx $SCRATCH/rev-t6/bytecheck.mts $SCRATCH/rev-t6 > $SCRATCH/rev-t6/bytecheck.txt 2>&1`, rc=0, read whole. Base sources are `/usr/bin/git show 1d036e2:web/src/{ChainPanel.tsx,chainBanner.ts,App.tsx}`. Every `en.chains` value and every `enums.chainStopCategory` value, split at `{{…}}`, occurs verbatim in the base source: 32/32 OK, `bad 0`. The substring check is loose for short words (`Goal`), so I also paired each removed literal with its replacement in the diff (lines 73-87, 111, 145-223, 242-247): each value equals the removed text byte for byte, including the leading space of `stopsAfter` and the trailing spaces of the five form labels. JSX `Got it` / `Stop chain` / `Start chain` sat on their own lines, so React rendered them trimmed, as the values are. `common.unknown` is `"unknown"` (en.ts:52) and `enumText`'s English values are the raw categories, so `stopped: unknown (unknown)` and `stopped: r-1 (limit)` render as before.
- **Chinese vs spec §5.** Glossary terms in this area: Chains → 链 (title, all sentences) ✓; Goal → 目标 (the `<dt>` and the form label) ✓. All 27 `chains` values and the 4 enum values match the brief's table verbatim (diff 407-432, 455). One glossary divergence, plan-mandated, is listed as Minor 1.
- ⚠️ **Cannot verify from diff:** the brief's App.tsx site (`:630`) is stale; the hunk is at 645 at HEAD (diff line 21: `@@ -635,21 +635,21 @@`). Only the brief's line number is affected.

### Strengths

- The criterion is stronger than the brief's. The brief's `toContain("链")` passes on almost any Chinese string here; the implementer added a tag-bounded assertion per site (test lines 518-543), so MT6-6 (title back to `Chains`) is red on `<h2>链</h2>` (`t6-MT6-6-title.txt`, read whole) while the brief's own case stays green.
- The two `common.unknown` branches each have their own criterion and deletion mutation (MT6-26 red on `已停止：unknown（未知）`, `t6-MT6-26-reasonUnknown.txt`, read whole; MT6-27 likewise).
- 28 named mutations cover every new `t`/`i18n.t`/`enumText` site; 27 are rc=1 with restore files empty (`t6-mutations.txt`); `t6-copy.txt` and `t6-clone-final-cmp.txt` are 0 bytes. The script `t6-mutate.py` checks each anchor occurs exactly once before editing, so no mutation silently missed its site.
- MT6-28 (`chains.cost`) is honestly reported green and explained: en and zh values are both `USD {{amount}}`, so no rendered byte can change; the interpolation is pinned by `costText(1.5) === "USD 1.50"` and `<dd>第 2 个会话；USD 1.50</dd>`.
- Fixture keys follow ruling P2 (`acme-alpha/beta/gamma`).
- Test output is pristine: `t6-green.txt` (14 tests) and `t6-web-check.txt` (tsc clean, 47 files, 272 tests) carry no warnings.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **Start: 启动 vs the glossary's 开跑** (`zh.ts`, diff 422-423: `start: "启动链"`, `started: "链 {{chainId}} 已启动。"`). Spec §5 maps Start → 开跑. That row groups Start with Confirm / Pause / Handoff (task-control buttons), so it may not be meant to cover the chain's start, but the panel will then say 开跑 in one area and 启动 in another for the same English verb. The value is exactly as the brief mandates (plan-mandated), so this is not an implementer defect; list it for the human's zh review (spec §5), which should pick one reading (Rule 7).
2. **`USD` stays English in Chinese** (`zh.ts` diff 430: `cost: "USD {{amount}}"`) while the form label beside it says 美元 (`formMaxCost: "费用上限（美元，软限制） "`). Plan-mandated; a wording point for the zh review. It is also why MT6-28 is unobservable.
3. **`chainsI18n` case 3 replaces `globalThis.fetch` and never restores it** (test lines 549-555). Harmless today (last case in the file; vitest isolates files), but a case added after it would inherit a fetch whose `/api/chains` never answers. `i18nSwitch` sets fetch in `beforeEach`; the same shape here would remove the trap.

### Assessment

**Task quality:** Approved

**Reasoning:** Every listed site reads through the resource, English is byte-identical to the base rendering (measured), the Chinese matches the brief and the spec glossary except one plan-mandated divergence for the human's zh review, and each new site has a deletion mutation seen red (the one green mutation is unobservable by construction and explained).
