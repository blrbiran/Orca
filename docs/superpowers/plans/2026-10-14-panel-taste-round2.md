# Panel Taste Refinement — Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three items the human authorised after batch 3 (#3 nav dot, #4 English metric notes, #5 data-health labels) and the nine "group A" minors from `final-review.md`, then fold batch 3 into `docs/handoff/handoff.md`.

**Architecture:** Web-only except Task 2 (server metric sentences in `src/metrics/compute.ts` and their golden fixture). Every change is TDD: the criterion is seen red before the code moves, and each new branch gets a named mutation run in a `git clone --local` copy.

**Tech Stack:** React 19, Vite, vitest (web default env `node`; DOM tests start with `// @vitest-environment jsdom`), react-i18next (named locale exports `en`, `zh`), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-10-14-panel-taste-refinement-design.md` (§7 supersedes earlier text) + `web/DESIGN.md` + human rulings recorded in session 1f3cceb2 (see Global Constraints). Triage source: `.superpowers/sdd/2026-10-14-panel-taste-refinement/final-review.md`.

## Global Constraints

- Work only in worktree `/Users/biran/code/skills/orca/Orca-wt/ui-taste`, branch `ui/panel-taste` (fast-forwarded to main `4afd9d5`). Never touch `/Users/biran/code/skills/orca/Orca` (another agent runs there).
- Merge, push, deleting branches/worktrees: human only (Tier 0). List them under awaitingHuman.
- Existing criteria are not rewritten except those the human authorised in session 1f3cceb2:
  - `web/tests/shell.test.tsx` (nav dot, #3)
  - `tests/metrics/noteCodes.test.ts` + server sentences in `src/metrics/compute.ts` (#4)
  - `web/tests/metricsNotes.test.tsx` (data-health duplicate, #5)
  - Agent ruling R-a (spec §5, reported at the end): `tests/fixtures/metrics/golden.json` (four sentence copies) follows H2.
  Every rewritten line carries `// REWRITTEN (human authorisation, session 1f3cceb2): <why>`.
- Spec §6 (independent review) overrides earlier spec text: A7 is dropped (Task 9 below is withdrawn — do not implement it).
- Colour only via `data-tone="info|ok|warn|danger"`; only `.btn-primary` is filled; every section pane stays mounted and is hidden by CSS only (`web/DESIGN.md`).
- English locale notes for metrics must equal the server sentence byte for byte (`tests/metrics/noteCodes.test.ts`).
- Root test `scanPanelText` flags web string literals containing spaces as untranslated copy — keep CSS selectors and test ids space-free in `web/src`.
- `git add` by explicit path only (the `node_modules` symlinks get swept in otherwise).
- Code, comments, specs, plans, ledger in English; `docs/handoff/**` in Chinese.
- Ledger: `.superpowers/sdd/2026-10-14-panel-taste-round2/progress.md` (`git add -f`), every entry with session, date, commit subject.

## Review Focus

1. A person who left Decisions on a kind filter clicks Overview's "View all n decisions" → lands on the unreviewed, unfiltered list whose length is n (Task 4 App test).
2. A touch-device person sees normal-size checkboxes and radios while buttons stay 44px (Task 7 CSS test; screenshot in Task 11).
3. Double-clicking "Dismiss all" acknowledges each notice exactly once, and a stale refusal disappears after a later success (Task 6).
4. With no execution port configured, the amber note still shows inside Task control but the nav shows no red dot; a real alert (reset/refetch/blocked/blockers/refusal) still lights it (Task 1).
5. The CLI `orca metrics --json` output changes wording for two caveats; nothing parses those strings (grep in Task 2 step 1 proves it).

---

### Task 1: Nav red dot ignores "no execution port" (#3)

**Files:**
- Modify: `web/src/Shell.tsx:14-34`, `web/src/App.tsx:1256-1267`
- Test: `web/tests/shell.test.tsx:24-37` (authorised rewrite)

**Interfaces:** Produces `controlAlert(input: ControlAlertInput | null): boolean` where `ControlAlertInput` no longer has `executionPort`.

- [ ] **Step 1: Rewrite the criterion (lines 21, 24, 31 only, each with the REWRITTEN comment).** In `shell.test.tsx` remove `executionPort: "configured", ` from `quiet` (line 21), retitle the describe (line 24) to `"controlAlert (the five alert conditions ControlPanel renders as role=alert)"`, and replace the `executionPort` line (31) with:

```ts
    // REWRITTEN (human authorisation, session 1f3cceb2): "no execution port" is an amber role="note"
    // (taste refinement P1-1), not an alert, so it must not light the red nav dot.
    expect(controlAlert({ ...quiet, executionPort: "unconfigured" } as ControlAlertInput)).toBe(false);
```
  Keep the other five `toBe(true)` lines.
- [ ] **Step 2:** `cd web && npx vitest run tests/shell.test.tsx` → expect FAIL on the new line (got `true`).
- [ ] **Step 3: Implement.** In `Shell.tsx` delete `executionPort: string;` from `ControlAlertInput`, delete `input.executionPort === "unconfigured" ||`, and change the doc comment to `/** The five conditions under which ControlPanel renders a role="alert" line ("no execution port" is a note, not an alert). */`. In `App.tsx` delete the `executionPort: controlConfig.executionPort,` line and drop `controlConfig === null ||` from the null guard only if `controlConfig` is no longer read there (it is not — remove it).
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/shell.test.tsx tests/groupRefusal.test.tsx tests/i18nPseudo.test.tsx` → PASS. (The cast in Step 1 keeps the test compiling after the field is gone; it proves an extra field is ignored.)
- [ ] **Step 5: Mutation (clone).** Re-add `(input as { executionPort?: string }).executionPort === "unconfigured" ||` → shell.test red. Restore; clone `git diff | wc -c` = 0.
- [ ] **Step 6: Commit** `git add web/src/Shell.tsx web/src/App.tsx web/tests/shell.test.tsx && git commit -m "fix(web): a missing execution port no longer lights Task control's red dot"`

### Task 2: English metric notes speak without spec citations (#4)

**Files:**
- Modify: `src/metrics/compute.ts:40-51`, `web/src/locales/en.ts:30-33`, `tests/fixtures/metrics/golden.json` (lines 77, 93, 113, 167 — pending authorisation), `web/tests/metricsLayout.test.tsx` (comment only)
- Test: `tests/metrics/noteCodes.test.ts` (authorised; add one case)

- [ ] **Step 1: Prove no consumer parses the sentences.** `grep -rn "E2 spec §3.5\|E2 spec §3.2.1" src tests scripts web > $LEDGER_DIR/t2-consumers.txt` and read it whole; expect only `compute.ts`, `golden.json`, `en.ts`.
- [ ] **Step 2: Failing case.** Append to `noteCodes.test.ts` inside the describe:

```ts
  it("speaks to the reader: no spec, section or erratum citation in any sentence (human, session 1f3cceb2)", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    const sentences = [...r.correction_rate.caveats, ...r.repair_rate.caveats, r.repair_rate.stale_only.known_bias, r.review_coverage.reason, computePanelCoverage([], []).caveat];
    for (const s of sentences) expect(s, s).not.toMatch(/§|\bspec\b|ERRATUM|\bA' |schema\.ts/);
  });
```
- [ ] **Step 3:** `npx vitest run tests/metrics/noteCodes.test.ts` (root) → FAIL on the new case.
- [ ] **Step 4: Implement.** In `compute.ts`:

```ts
const NO_REVIEW_COVERAGE =
  "review coverage has no data: only the panel produces it, " +
  "and the correction rate must never be read on its own";

const STALE_BIAS =
  "systematically low: closing a stale correction requires the chose_instead field " +
  "(CLI flag --chose-instead), which a stale correction must not have";
```
  Mirror both strings byte for byte in `en.ts` `metricsNote["no-review-coverage"]` / `["stale-bias"]`. zh stays as is. Keep the words "review coverage" and "chose_instead" (required by `tests/metrics/compute.test.ts:61-62,72`). Both the JSON and plain-text (`src/metrics/report.ts:45,55`) outputs change; run `tests/metrics/report.test.ts` too.
- [ ] **Step 5:** `npx vitest run tests/metrics` → expect noteCodes green, `cli.test.ts` red on golden.json (this red is the evidence the fixture must move).
- [ ] **Step 6 (needs authorisation):** replace the four old sentence copies in `golden.json` with the new ones; rerun `npx vitest run tests/metrics` → PASS.
- [ ] **Step 7:** In `web/tests/metricsLayout.test.tsx` change only the comment above `"speaks to the reader, not in spec citations (zh only)"` to `// en mirrors the server's sentences byte for byte; tests/metrics/noteCodes.test.ts pins that neither carries a citation.` (assertions unchanged).
- [ ] **Step 8: Mutation (clone).** Put `(E2 spec §3.5)` back into `NO_REVIEW_COVERAGE` and `en.ts` together → new case red. Restore.
- [ ] **Step 9: Commit** `git add src/metrics/compute.ts web/src/locales/en.ts tests/fixtures/metrics/golden.json tests/metrics/noteCodes.test.ts web/tests/metricsLayout.test.tsx && git commit -m "fix(metrics): say the two caveats without spec citations, in the CLI and the panel"`

### Task 3: Data-health row states each count once (#5)

**Files:**
- Modify: `web/src/MetricsView.tsx:80-84`, `web/src/locales/en.ts:1029,1031` (+ `futureCount`), `web/src/locales/zh.ts` (same three keys)
- Test: `web/tests/metricsNotes.test.tsx:57-59` (authorised), `web/tests/metricsLayout.test.tsx` (append one case)

- [ ] **Step 1: Failing cases.** Append to `metricsLayout.test.tsx`:

```ts
  it("states each data-health count once: the heading names it, the line under it is the number", () => {
    const report = { ...REPORT, unresolved_decisions: ["a", "b"], malformed_lines: [{ path: "p", line: 1, msg: "m" }], excluded_as_future: 3 } as typeof REPORT;
    const html = renderToStaticMarkup(<MetricsView report={report} coverage={COVERAGE} />);
    for (const [title, id, n] of [["Unresolved decisions", "unresolved-count", "2"], ["Malformed lines", "malformed-count", "1"], [en.metrics.futureTitle, "excluded-as-future", "3"]] as const)
      expect(html).toContain(`<h2>${title}</h2><p data-testid="${id}">${n}</p>`);
  });
```
  Import `en` from `../src/locales/en.js` if the file does not already. The number must stay the direct text child of the testid `<p>` (no wrapper) — `web/tests/metricsView.test.tsx:87-98` match through it (spec §6 I3).
  (If `REPORT`'s field shapes differ, copy them from `web/src/types.ts` `MetricsReport`.) Rewrite `metricsNotes.test.tsx` 57-59 to `.toBe("0")` each, with one REWRITTEN comment: `// REWRITTEN (human authorisation, session 1f3cceb2): the h2 above names the count in the reader's language (pinned a few lines up), so the line repeats only the number.`
- [ ] **Step 2:** `cd web && npx vitest run tests/metricsLayout.test.tsx tests/metricsNotes.test.tsx` → both new assertions FAIL.
- [ ] **Step 3: Implement.** In `MetricsView.tsx` render `{report.unresolved_decisions.length}`, `{report.malformed_lines.length}`, `{report.excluded_as_future}` directly in the three `<p>`; delete `unresolvedCount`, `malformedCount`, `futureCount` from `en.ts` and `zh.ts`.
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.json && npx vitest run` (web) → PASS.
- [ ] **Step 5: Mutation (clone).** Put `t("metrics.unresolvedTitle")}: ` before the first number → new case red. Restore.
- [ ] **Step 6: Commit** `git add web/src/MetricsView.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/metricsLayout.test.tsx web/tests/metricsNotes.test.tsx && git commit -m "fix(web): the data-health row names each count once"`

### Task 4: "View all n decisions" lands on the list it counted (M4)

**Files:**
- Modify: `web/src/Overview.tsx:16,40`, `web/src/App.tsx:1352-1354`
- Test: `web/tests/overviewQueueCap.test.tsx` (append), `web/tests/reviewApp.test.tsx` (append)

**Interfaces:** `Overview` gains optional prop `onViewDecisions?: () => void`, called from the link's `onClick` (no `preventDefault`; the hash still navigates).

- [ ] **Step 1: Failing App case.** Append to `reviewApp.test.tsx`:

```ts
describe("Overview's view-all link (final review M4)", () => {
  it("resets Decisions to the unreviewed, unfiltered list it counted", async () => {
    rows = [A, B, C, row("D", "question D")];
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".decision-list li button")).toHaveLength(4));
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "reconcile" } });
    // Narrow the list some other way the person could have left it: a kind that matches nothing after the reset proves nothing,
    // so use the existing filter value and check it is cleared.
    window.location.hash = "#overview";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const link = await screen.findByRole("link", { name: "View all 4 decisions" });
    fireEvent.click(link);
    window.location.hash = "#decisions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Kind" }) as HTMLSelectElement).value).toBe(""));
    expect(document.querySelectorAll(".decision-list li button")).toHaveLength(4);
  });
});
```
  jsdom does not follow hash links on click, hence the explicit hash + event. If the Kind select's accessible name differs, read it from `DecisionsView.tsx:142` (`decisions.filterKind` = "Kind").
- [ ] **Step 2:** `cd web && npx vitest run tests/reviewApp.test.tsx -t "view-all"` → FAIL (value stays `reconcile`).
- [ ] **Step 3: Implement.** `Overview.tsx`: add `onViewDecisions?: () => void` to the props type; link becomes `<a href="#decisions" onClick={() => props.onViewDecisions?.()}>`. `App.tsx`: pass `onViewDecisions={() => { setStatus("unreviewed"); setFilter(NO_FILTER); setSelected(null); }}` to `<Overview>` (spec §6 M-g: a Reviewed row must not stay open over the unreviewed list).
- [ ] **Step 4: Unit case.** Append to `overviewQueueCap.test.tsx` a source check that the link keeps a bare hash (Review Focus 5 of batch 1) — already pinned by `'href="#decisions"'`; no new case needed. Run `npx vitest run tests/overviewQueueCap.test.tsx tests/reviewApp.test.tsx` → PASS.
- [ ] **Step 5: Mutation (clone).** Drop `setFilter(NO_FILTER);` from the App prop → App case red. Restore.
- [ ] **Step 6: Commit** `git add web/src/Overview.tsx web/src/App.tsx web/tests/reviewApp.test.tsx && git commit -m "fix(web): Overview's view-all link resets Decisions to the list it counted"`

### Task 5: Category tints derive from the current palette (M7)

**Files:**
- Modify: `web/src/styles.css:31,35,55-56,69-70`
- Test: `web/tests/lightTheme.test.ts` (append; it already has `blockOf`, `tok`)

- [ ] **Step 1: Failing case.** Append:

```ts
const rgbOf = (v: string): string => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),/.exec(v);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  return hex(v).join(",");
};
const dark = blockOf(":root {");
describe("category tints follow the palette (final review M7)", () => {
  it("tints idle with --muted and done with --accent, in dark and both light blocks", () => {
    for (const block of [dark, manual, system]) {
      expect(rgbOf(tok(block, "cat-idle"))).toBe(rgbOf(tok(block, "muted")));
      expect(rgbOf(tok(block, "cat-done"))).toBe(rgbOf(tok(block, "accent")));
    }
  });
});
```
- [ ] **Step 2:** `cd web && npx vitest run tests/lightTheme.test.ts` → FAIL (dark idle 168,168,179 ≠ 166,168,174).
- [ ] **Step 3: Implement.** Dark: `--cat-idle: rgba(166, 168, 174, 0.18);` (`--cat-done` already 96,165,250). Both light blocks identically: `--cat-idle: rgba(106, 100, 90, 0.12);` and `--cat-done: rgba(29, 78, 216, 0.14);`.
- [ ] **Step 4:** `npx vitest run tests/lightTheme.test.ts tests/contrast.test.ts` → PASS (contrast still holds; byte-identical light blocks still hold).
- [ ] **Step 5: Mutation (clone).** Revert light `--cat-done` in one block only → both the new case and the byte-identity case red. Restore.
- [ ] **Step 6: Commit** `git add web/src/styles.css web/tests/lightTheme.test.ts && git commit -m "fix(web): category tints take their base from the current palette"`

### Task 6: "Dismiss all" acknowledges once and clears a stale refusal (T3 deferred)

**Files:**
- Modify: `web/src/AuthGate.tsx:284-308`
- Test: `web/tests/authGate.test.tsx` (append two cases inside the notices describe)

- [ ] **Step 1: Failing cases.**

```ts
  it("acknowledges each notice once when Dismiss all is pressed twice in a row", async () => {
    notices = [
      { seq: 3, at: 0, kind: "user-created", body: { name: "eve" } },
      { seq: 5, at: 0, kind: "password-changed", body: { name: "eve" } },
    ];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    routes["POST /api/auth/notices/3/ack"] = async () => { await held; return jsonResponse({ acknowledged: true }); };
    meAnswers = [me({ name: "olga", roles: ["owner"] })];
    render(<AuthGate><p>app body</p></AuthGate>);
    const banner = await screen.findByRole("region", { name: /security notices/i });
    const button = within(banner).getByRole("button", { name: "Dismiss all" });
    fireEvent.click(button);
    fireEvent.click(button);
    notices = [];
    release();
    await waitFor(() => expect(screen.queryByRole("region", { name: /security notices/i })).toBeNull());
    expect(posts("/api/auth/notices/3/ack")).toHaveLength(1);
    expect(posts("/api/auth/notices/5/ack")).toHaveLength(1);
  });

  it("drops an earlier refusal once Dismiss all succeeds", async () => {
    notices = [
      { seq: 3, at: 0, kind: "user-created", body: { name: "eve" } },
      { seq: 5, at: 0, kind: "password-changed", body: { name: "eve" } },
      { seq: 7, at: 0, kind: "user-created", body: { name: "fay" } },
    ];
    let refuse = true;
    routes["POST /api/auth/notices/3/ack"] = () => refuse ? jsonResponse({ code: "notice-ack-failed", message: "no" }, 409) : jsonResponse({ acknowledged: true });
    meAnswers = [me({ name: "olga", roles: ["owner"] })];
    render(<AuthGate><p>app body</p></AuthGate>);
    const banner = await screen.findByRole("region", { name: /security notices/i });
    fireEvent.click(within(banner).getAllByRole("button", { name: "Dismiss" })[0]!);
    await within(banner).findByTestId("refusal-code");
    refuse = false;
    notices = [{ seq: 5, at: 0, kind: "password-changed", body: { name: "eve" } }, { seq: 7, at: 0, kind: "user-created", body: { name: "fay" } }];
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss all" }));
    notices = [];
    await waitFor(() => expect(screen.queryByRole("region", { name: /security notices/i })).toBeNull());
  });

  it("shows a refusal and offers Dismiss all again when an acknowledgement request fails outright (spec §6 I4)", async () => {
    notices = [
      { seq: 3, at: 0, kind: "user-created", body: { name: "eve" } },
      { seq: 5, at: 0, kind: "password-changed", body: { name: "eve" } },
    ];
    routes["POST /api/auth/notices/3/ack"] = () => { throw new TypeError("Failed to fetch"); };
    meAnswers = [me({ name: "olga", roles: ["owner"] })];
    render(<AuthGate><p>app body</p></AuthGate>);
    const banner = await screen.findByRole("region", { name: /security notices/i });
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss all" }));
    await within(banner).findByTestId("refusal-code");
    expect((within(banner).getByRole("button", { name: "Dismiss all" }) as HTMLButtonElement).disabled).toBe(false);
    for (const b of within(banner).getAllByRole("button", { name: "Dismiss" })) expect((b as HTMLButtonElement).disabled).toBe(false);
  });
```
  If the harness's `routes` handler cannot throw to simulate a rejected `fetch`, make the stubbed `fetch` reject for that URL instead (read how `routes` is consulted near `web/tests/authGate.test.tsx:41`). Match the ack success body and route-key format to the existing `routes[...]` usage in this file (e.g. line 281) and the success shape `ackNotice` expects in `AuthGate.tsx`. `refusal-code` is the test id `Refusal` renders.
- [ ] **Step 2:** `cd web && npx vitest run tests/authGate.test.tsx` → first case FAIL (3/ack posted twice); second FAIL (region stays: refusal keeps it mounted); third FAIL (unhandled rejection / no refusal shown).
- [ ] **Step 3: Implement.**

```tsx
  const dismissingAll = useRef(false);
  const [dismissing, setDismissing] = useState(false);
  const dismissAll = async (): Promise<void> => {
    if (dismissingAll.current) return;
    dismissingAll.current = true; setDismissing(true);
    try {
      let refused: PanelRefusal | null = null;
      for (const notice of notices) {
        const answer = await ackNotice(notice.seq);
        if (!answer.ok) { refused = answer; break; }
      }
      setRefusal(refused);
      await read();
    } catch (err) { setRefusal(failureFrom(err)); }
    finally { dismissingAll.current = false; setDismissing(false); }
  };
```
  and `disabled={dismissing}` on both the "Dismiss all" button and every per-notice "Dismiss" button (spec §6 I4). Import `useRef` if missing. Use the exact refusal type already declared for `setRefusal`.
- [ ] **Step 4:** `npx vitest run tests/authGate.test.tsx` → PASS.
- [ ] **Step 5: Mutation (clone).** (a) delete the `if (dismissingAll.current) return;` line → case 1 red (the `disabled` alone does not stop two synchronous clicks if React has not re-rendered — if it does stay green, record that the ref is redundant and drop it, keeping `disabled`). (b) change `setRefusal(refused)` back to setting only on failure → case 2 red. Restore.
- [ ] **Step 6: Commit** `git add web/src/AuthGate.tsx web/tests/authGate.test.tsx && git commit -m "fix(web): Dismiss all acknowledges once and clears an earlier refusal"`

### Task 7: Touch sizing spares checkboxes; key hint hides on touch (T3, T4 deferred)

**Files:**
- Modify: `web/src/styles.css` (after the `@media (pointer: coarse)` block at :374-376), `web/DESIGN.md` (touch line)
- Test: `web/tests/shellReflow.test.ts` (append; its existing slice of the first coarse block stays untouched)

- [ ] **Step 1: Failing case.**

```ts
  it("keeps checkboxes and radios at their own size on touch, and hides the key hint there", () => {
    const first = css.indexOf("@media (pointer: coarse) {");
    const second = css.lastIndexOf("@media (pointer: coarse) {");
    expect(second).toBeGreaterThan(first); // a second block, after the pinned first one
    const block = css.slice(second, css.indexOf("\n}", second));
    expect(block).toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ min-height: 0;/);
    expect(block).toMatch(/\.kbd-hint \{ display: none;/);
  });
```
  (`css` is the stylesheet string the file already reads; reuse its name.)
- [ ] **Step 2:** `cd web && npx vitest run tests/shellReflow.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Directly after the existing coarse block add a second block (separate so the pinned first block stays byte-identical):

```css
@media (pointer: coarse) {
  input[type="checkbox"], input[type="radio"] { min-height: 0; }
  .kbd-hint { display: none; }
}
```
  In `web/DESIGN.md` **add** a line in its layout/buttons area (there is no touch line today): "On touch (`pointer: coarse`) buttons, selects, inputs and nav items are at least 44px tall; checkboxes and radios keep their native size; the j/k/a/c hint is hidden."
- [ ] **Step 4:** `npx vitest run tests/shellReflow.test.ts` → PASS.
- [ ] **Step 5: Mutation (clone).** Delete the `.kbd-hint` line → red. Restore.
- [ ] **Step 6: Commit** `git add web/src/styles.css web/DESIGN.md web/tests/shellReflow.test.ts && git commit -m "fix(web): touch sizing leaves checkboxes alone and hides the key hint"`

### Task 8: Only wide usage tables force a minimum width (T6 deferred)

**Files:**
- Modify: `web/src/UsagePanel.tsx:189`, `web/src/styles.css:267`
- Test: `web/tests/metricsLayout.test.tsx` (append)

- [ ] **Step 1: Failing case.**

```ts
  it("does not force the two-column groups table to scroll", () => {
    expect(src("../src/UsagePanel.tsx")).toContain('<table data-testid="usage-groups" className="table-narrow">');
    const css = src("../src/styles.css");
    expect(css).toMatch(/\.table-scroll \.table-narrow \{ min-width: 0;/);
  });
```
- [ ] **Step 2:** `cd web && npx vitest run tests/metricsLayout.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** `UsagePanel.tsx:189` → `<div className="table-scroll"><table data-testid="usage-groups" className="table-narrow">` (wrapper string unchanged, so the existing "3 wrappers" count holds). `styles.css` after line 267: `.table-scroll .table-narrow { min-width: 0; }`.
- [ ] **Step 4:** `npx vitest run tests/metricsLayout.test.tsx` → PASS.
- [ ] **Step 5: Mutation (clone).** Delete the CSS line → red. Restore.
- [ ] **Step 6: Commit** `git add web/src/UsagePanel.tsx web/src/styles.css web/tests/metricsLayout.test.tsx && git commit -m "fix(web): the two-column usage table no longer scrolls sideways on phones"`

### Task 9: WITHDRAWN (spec §6 I1) — do not implement

Kept below only as the record of what was considered.

#### (withdrawn) The requirement answer round has a primary action (T7 deferred)

**Files:**
- Modify: `web/src/RequirementsPanel.tsx:172`
- Test: `web/tests/template.test.ts:33` (pending authorisation: `"RequirementsPanel.tsx": 1` → `2`)

- [ ] **Step 1: Rewrite the count** to 2 with `// REWRITTEN (human authorisation, session 1f3cceb2): the answer round's Send answers is that view's primary action (final review T7).`
- [ ] **Step 2:** `cd web && npx vitest run tests/template.test.ts` → FAIL (found 1).
- [ ] **Step 3: Implement.** `<button type="submit" className="btn-primary" disabled={…}>{t("requirements.sendAnswers")}</button>` ("Accept all recommended" stays secondary).
- [ ] **Step 4:** `npx vitest run tests/template.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add web/src/RequirementsPanel.tsx web/tests/template.test.ts && git commit -m "fix(web): Send answers is the requirement round's primary action"`

### Task 10: Pin the tone of each notice site and the generic memory refusal (T2, T8 deferred)

**Files:**
- Create: `web/tests/toneSites.test.tsx`
- Modify: `web/tests/memoryView.test.tsx` (append one case)

Tests only — no source change, so "seen red" comes from the mutation step.

- [ ] **Step 1: Write `toneSites.test.tsx`.**

```tsx
// @vitest-environment jsdom
/**
 * Final review T2: each notice site's colour comes from its data-tone, and nothing pinned it per component.
 * Rendered where cheap (RefusalNotice, Overview, UsageSettlement); read from source where the component needs the
 * whole control plane (ControlPanel, App) -- the same trade web/tests/template.test.ts makes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefusalNotice } from "../src/RefusalNotice.js";
import { Overview } from "../src/Overview.js";

const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("notice tones per site (final review T2)", () => {
  it("a refusal is danger", () => {
    expect(renderToStaticMarkup(<RefusalNotice refusal={{ status: 409, code: "x", message: "m" }} />)).toContain('role="alert" data-tone="danger"');
  });
  it("an Overview issue is warn", () => {
    const html = renderToStaticMarkup(<Overview model={{ progress: [], queue: [], issues: [{ groupId: "g", reason: "r" }], sources: [], scopeUnavailable: false, complete: true } as never} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
    expect(html).toContain('role="alert" data-tone="warn"');
  });
  it("ControlPanel: no port is a warn note; reset and recovery-blocked are danger; refetch is info", () => {
    const s = src("../src/ControlPanel.tsx");
    expect(s).toContain('<p role="note" data-tone="warn">{t("control.noPort")}');
    expect(s).toContain('<p role="alert" data-tone="danger">{t("control.resetRequired")}');
    expect(s).toContain('<p role="alert" data-tone="info">{t("control.refetchRequired")}');
    expect(s).toContain('<p role="alert" data-tone="danger">{t("control.dispatchBlockedRecovery")}');
  });
  it("App: a recorded review is ok; a running chain banner is info", () => {
    const s = src("../src/App.tsx");
    expect(s).toMatch(/role="status" data-tone="ok">\{t\(inline\.status\.text\)\}/);
    expect(s).toMatch(/role="status" data-tone="info" className="chain-banner"/);
  });
  it("MemoryView: a missing ccmem is a warn note (spec §6 M-d)", () => {
    expect(src("../src/MemoryView.tsx")).toContain('<p role="note" data-tone="warn">{t("memory.configureHint")}');
  });
  it("UsageSettlement: a refusal reason is warn", () => {
    expect(src("../src/UsageSettlement.tsx")).toContain('<p role="status" data-tone="warn">{refusalText(');
  });
});
```
  Check `RefusalNotice`'s actual props in `web/src/RefusalNotice.tsx` and adjust the call; same for the Overview issue shape (`web/src/overviewModel.ts`).
- [ ] **Step 2: Memory case.** Append to `memoryView.test.tsx` next to the ccmem-missing case:

```ts
  it("shows the full refusal, not the configure hint, for any other unavailable code (final review T8)", async () => {
    status = { ...OK_STATUS, health: { status: "unavailable", code: "ccmem-failed", message: "ccmem exited 2" } };
    render(<MemoryView active />);
    expect((await screen.findByTestId("refusal-code")).textContent).toBe("ccmem-failed");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Set ORCA_CCMEM_BIN/)).toBeNull();
  });
```
- [ ] **Step 3:** `cd web && npx vitest run tests/toneSites.test.tsx tests/memoryView.test.tsx` → PASS.
- [ ] **Step 4: Mutations (clone), each must turn its case red:** Overview `data-tone="warn"`→`"danger"`; ControlPanel refetch `info`→`warn`; MemoryView ccmem note `warn`→`info`; MemoryView condition `health.code === "ccmem-missing"` → `true`. Restore; 0 bytes.
- [ ] **Step 5: Commit** `git add web/tests/toneSites.test.tsx web/tests/memoryView.test.tsx && git commit -m "test(web): pin each notice site's tone and the generic memory refusal"`

### Task 11: Verify, record, fold into handoff

**Files:**
- Create: `.superpowers/sdd/2026-10-14-panel-taste-round2/progress.md`
- Modify: `docs/handoff/handoff_ui.md` §七 (Chinese), `docs/handoff/handoff.md` (Chinese, fold batch 3 conclusions)

- [ ] **Step 1: Full run in a clean clone** of the branch tip (`git clone --local --branch ui/panel-taste`, symlink both `node_modules`, HOME + XDG redirected, `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js`, `ECC_GATEGUARD=off DISABLE_OMC=1`). Each command redirected to its own log, read whole: `npm run typecheck`, `npm run build --workspace web`, `npm run --ws check`, `npx vitest run` (root), `npm run verify:panel`. Expected reds only: `taskResultPaired` ×2 (baseline) and load timeouts that pass when rerun alone (rerun each red file alone 3×).
- [ ] **Step 2: Browser check.** Build web, start the panel on a free port with `ORCA_CORRECTIONS_DIR`/`ORCA_CONTROL_DIR` redirected, screenshot at 390px with touch emulation (checkbox size, no key hint, usage groups table), Task control with no port (no red dot), Metrics data-health row, both themes. Save under this session's scratchpad `shots/round2/`. Confirm `~/.orca` unchanged (`ls -la` before/after).
- [ ] **Step 3: Ledger** — one section per task: commit subject, red/green logs, mutation results with clone `git diff | wc -c`, rulings.
- [ ] **Step 4: handoff_ui.md §七** — replace the awaitingHuman list: merge+push done (merge commit subject `Merge branch 'ui/panel-taste'`, with the UsageSettlement conflict + zh `所有者不计量放行` fix); #3/#4/#5 done; undo-agree not wanted (human, 1f3cceb2); group A done; group B left (list stays in final-review.md). New awaitingHuman: visual review + merge of round 2.
- [ ] **Step 5: handoff.md** — conclusions only, no process (spec §6 M-f; the file is already ~66K). Fold batch 3 conclusions (DESIGN.md as the UI rulebook; root tests that guard web copy: noteCodes, scanPanelText; symlinked node_modules + path-only add; tone rules) into the matching sections, Chinese, no hashes.
- [ ] **Step 6: Commit** `git add -f .superpowers/sdd/2026-10-14-panel-taste-round2/progress.md && git add docs/handoff/handoff_ui.md docs/handoff/handoff.md docs/superpowers/plans/2026-10-14-panel-taste-round2.md && git commit -m "docs(handoff): record panel taste round 2 and fold batch 3 into the Orca handoff"`

### Task 12: A no-port panel's agents read does not raise a red refusal (spec §7 H1-b)

**Files:**
- Modify: `web/src/App.tsx` (`loadAgents` catch, ~552-556)
- Test: a new App-level case — put it in the existing file that already serves `executionPort: "unconfigured"` to the App with an agents 422 (`web/tests/agentPreviewRefresh.test.tsx` has the harness: `servedConfig`, `agentsFailures`); append a new `it`, existing cases unchanged.

- [ ] **Step 1: Failing case.** With `servedConfig = { ...config, executionPort: "unconfigured" }` and the agents read answering 422 `control-port-unconfigured`, render the App, wait for the Task control pane, and assert: `screen.queryByTestId("nav-dot-tasks")` is null; no element in the Task control pane whose text contains `control-port-unconfigured · HTTP 422` outside the agent-selection section (the panel refusal line); the amber `p[role="note"][data-tone="warn"]` no-port note is present.
- [ ] **Step 2:** run it → FAIL (dot present / panel refusal present).
- [ ] **Step 3: Implement.** In `loadAgents`'s catch, compute `refusal` as today; call `dispatchControl({ type: "refusal", place: "panel", … })` only when `refusal.code !== "control-port-unconfigured"`; keep `setAgentsFailure(refusal.code)` unconditional; add a one-line comment: the amber no-port note already says this, so it is not a panel alert (taste round 2, H1-b).
- [ ] **Step 4:** focused file green, then web `npm run --ws check`.
- [ ] **Step 5: Mutation (clone).** Remove the `!== "control-port-unconfigured"` condition → new case red. Restore 0/0.
- [ ] **Step 6: Commit** `fix(web): a no-port panel's agents read no longer raises a red refusal`.
