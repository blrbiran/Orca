### Task C3: Web — resume dialog for a completed panel shutdown, stop banner, refused buttons hidden

**Files:**
- Modify `web/src/ControlGroupView.tsx`: line 79 (`handoffActive`), line 105 (insert banner after the claim-blocked
  alert), lines 121-132 (remove the old stop line; its text moves into the banner), lines 277, 280, 286.
- Modify `web/src/locales/en.ts`: after line 52 (end of `stopState`), and after line 235 (`stop:` in `control.group`).
- Modify `web/src/locales/zh.ts`: after line 142 (`stop:` in `control.group`).
- Create test `web/tests/stopBanner.test.tsx`.

**Interfaces:**
- Consumes: `GroupViewV1.stop`, `summary.stopMode`, `summary.stopState` (existing). `unchanged-idle` is not shown
  anywhere in the web (no view renders shutdown dispositions; checked with `grep -rn disposition web/src`), so it gets
  no en/zh string.
- Produces: i18n keys `control.group.stopBanner.how.<pause|handoff|shutdown>` and
  `control.group.stopBanner.exit.<paused|handoff-pending|handoff-partial|handoff-unresolved|handoff-complete>` (en
  typed as `Record` over the `GroupSummaryV1` unions, so a new mode/state is a compile error); DOM
  `<div role="status" data-testid="stop-banner">` directly after the `h2` (or after the claim-blocked alert / Part A's
  group refusal when those render — spec §6.5 order).
- Buttons after this task: Start only when `state === "ready"` and **no** stop intent (start refuses any intent with
  `stop-mode-conflict`, `src/control/webDispatch.ts:132`); Pause/Handoff-stop not under handoff, shutdown or pause;
  resume dialog (`Continue selected tasks` / `Resume (no continuation)`) under handoff **or shutdown** at
  `handoff-complete`.

- [ ] **Step 1: Write the failing test** — create `web/tests/stopBanner.test.tsx`:
```tsx
// @vitest-environment jsdom
/**
 * Issue-fixes spec §3.2 (3), (4) and §3.4: a group stopped by a panel shutdown is left through the same resume dialog as a
 * human handoff-stop, every stopped group shows one banner (how it stopped, its state, the one way out), and the buttons
 * the stop mode refuses -- Start, Pause dispatch, Handoff stop -- are not rendered.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-08T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const settled: RunViewV1 = {
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "settled-restartable", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], continuable: false,
};
type Stop = NonNullable<GroupViewV1["stop"]>;
const view = (state: GroupViewV1["summary"]["state"], stop: Stop | null): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state, commandRevision: 6, projectionSeq: 4, stopMode: stop?.mode ?? null, stopState: stop?.state ?? null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000), used: amount(10), committedRemaining: amount(0), explicitUnallocatedReserve: amount(8_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs: [settled], checkpoints: [], handoffRequests: [], stop, recoveryBlockers: [], recentCommandIds: [],
});
const shutdownStop = (state: Stop["state"]): Stop =>
  ({ mode: "shutdown", state, frozenRunIds: ["run-a"], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: "2026-10-08T00:02:00.000Z" });
const mount = (shown: GroupViewV1, onCommand = vi.fn()) => {
  render(<ControlGroupView view={shown} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
  return onCommand;
};
const refusedButtons = ["Start", "Pause dispatch", "Handoff stop"];

afterEach(cleanup);

describe("leaving a panel shutdown (issue-fixes spec §3.2 (3))", () => {
  it("renders the resume dialog for a shutdown/handoff-complete group and no Start, Pause or Handoff-stop button", () => {
    const onCommand = mount(view("ready", shutdownStop("handoff-complete")));
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers no resume and none of the refused buttons while the shutdown's frozen runs are still settling", () => {
    mount(view("running", shutdownStop("handoff-pending")));
    expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
  });
});

describe("the stop banner (issue-fixes spec §3.2 (4))", () => {
  it("says how the group stopped, its state, and the one way out, at the top of the group view", () => {
    const { container } = render(<ControlGroupView view={view("ready", shutdownStop("handoff-complete"))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const banner = screen.getByTestId("stop-banner");
    expect(banner.textContent).toContain("Stopped: the panel shut down while runs were active.");
    expect(banner.textContent).toContain("Ready to resume: use the resume button under Dispatch.");
    expect(banner.textContent).toContain("stop shutdown handoff-complete");
    // Above the plan line and everything after it: the first thing under the heading.
    const heading = container.querySelector("h2")!;
    expect(heading.nextElementSibling).toBe(banner);
  });

  it("names the settling state while a handoff-stop is still pending", () => {
    mount(view("running", { mode: "handoff", state: "handoff-pending", frozenRunIds: ["run-a"], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: "2026-10-08T00:30:00.000Z" }));
    expect(screen.getByTestId("stop-banner").textContent).toContain("Stopping: the frozen runs are still settling.");
  });

  it("does not offer Start on a paused ready group, because start refuses any stop intent; Resume dispatch is its way out", () => {
    const onCommand = mount(view("ready", { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null }));
    expect(screen.getByTestId("stop-banner").textContent).toContain("Way out: press Resume dispatch under Dispatch.");
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume dispatch" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-dispatch", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("renders no banner, and the Start button, for a ready group with no stop intent", () => {
    mount(view("ready", null));
    expect(screen.queryByTestId("stop-banner")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("shows the banner in Chinese", async () => {
    await i18n.changeLanguage("zh");
    mount(view("ready", shutdownStop("handoff-complete")));
    const text = screen.getByTestId("stop-banner").textContent ?? "";
    expect(text).toContain("已停止：面板关闭时有运行在跑。");
    expect(text).toContain("可以恢复了：用「派发」下的恢复按钮。");
    expect(screen.getByRole("button", { name: "恢复（不续跑）" })).toBeTruthy();
  });
});
```
(`web/tests/setup.ts` already switches the language back to English after each test.) If Part A has added a group
refusal block between the `h2` and the claim-blocked line, the `heading.nextElementSibling` assertion still holds
because these fixtures carry no refusal; if Part A's block always renders a wrapper element, change that one assertion to
`expect(banner.compareDocumentPosition(container.querySelector("table")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()`.

- [ ] **Step 2: Run, expect FAIL**
```
cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/vitest run tests/stopBanner.test.tsx > $SCRATCH/c3-red.txt 2>&1; echo rc=$?
```
Expected rc=1: no `stop-banner` test id; the shutdown test finds no `Resume (no continuation)` button and finds
`Pause dispatch`; the paused test finds `Start`. Only "renders no banner, and the Start button…" passes.

- [ ] **Step 3: Implement**

`web/src/ControlGroupView.tsx` line 79, current:
```tsx
  const handoffActive = view.summary.stopMode === "handoff";
```
replacement:
```tsx
  const stopMode = view.summary.stopMode;
  // Issue-fixes spec §3.2 (3): a panel shutdown that froze runs is left the same way as a human handoff-stop, through the
  // resume dialog once its stop state is handoff-complete.
  const handoffActive = stopMode === "handoff" || stopMode === "shutdown";
```
Line 105, anchor `      {view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}` — insert directly after it
(after Part A's group refusal block, if Part A placed one right after this line):
```tsx
      {/* Issue-fixes spec §3.2 (4): one banner for any stop intent -- how it stopped, its state, and the one way out. */}
      {view.stop !== null && (
        <div role="status" data-testid="stop-banner">
          <p>{t(`control.group.stopBanner.how.${view.stop.mode}` as const)}</p>
          <p>{t(`control.group.stopBanner.exit.${view.stop.state}` as const)}</p>
          <p>
            {t("control.group.stop", {
              mode: enumText("stopMode", view.stop.mode),
              state: enumText("stopState", view.stop.state),
              accepted: view.stop.acceptedAt ?? t("common.na"),
              deadline: view.stop.deadlineAt ?? t("common.none"),
              n: view.stop.frozenRunIds.length,
              runs: view.stop.frozenRunIds.join(", ") || t("common.none"),
            })}
          </p>
        </div>
      )}
```
Delete lines 121-132 (the old block, which the banner now carries verbatim):
```tsx
      {view.stop !== null && (
        <p role="status">
          {t("control.group.stop", {
            mode: enumText("stopMode", view.stop.mode),
            state: enumText("stopState", view.stop.state),
            accepted: view.stop.acceptedAt ?? t("common.na"),
            deadline: view.stop.deadlineAt ?? t("common.none"),
            n: view.stop.frozenRunIds.length,
            runs: view.stop.frozenRunIds.join(", ") || t("common.none"),
          })}
        </p>
      )}
```
Line 277, current `      {view.summary.state === "ready" && !handoffActive && (` → replacement:
```tsx
      {/* Issue-fixes spec §3.2 (4): start refuses every stop intent (stop-mode-conflict), so it is not offered under one. */}
      {view.summary.state === "ready" && stopMode === null && (
```
Line 280, current `      {!handoffActive && view.summary.stopMode !== "pause" && (` → `      {!handoffActive && stopMode !== "pause" && (`.
Line 286, current `      {view.summary.stopMode === "pause" && (` → `      {stopMode === "pause" && (`.

`web/src/locales/en.ts` — after line 52 (`} as const satisfies Record<NonNullable<GroupSummaryV1["stopState"]>, string>;`, end of `stopState`) insert:
```ts
// Issue-fixes spec §3.2 (4): the stop banner says how the group stopped and the one way out of each stop state.
const stopBannerHow = {
  pause: "Stopped: a person paused dispatch. No new run is claimed.",
  handoff: "Stopped: a person asked for a handoff-stop. The runs that were active are frozen and hand off their work.",
  shutdown: "Stopped: the panel shut down while runs were active. Those runs were frozen and hand off their work.",
} as const satisfies Record<NonNullable<GroupSummaryV1["stopMode"]>, string>;
const stopBannerExit = {
  paused: "Way out: press Resume dispatch under Dispatch.",
  "handoff-pending": "Stopping: the frozen runs are still settling. Nothing to press yet; the way out appears here when they finish.",
  "handoff-partial": "A frozen run could not hand off. The group stays stopped; press Retry recovery under Dispatch when it is offered.",
  "handoff-unresolved": "A frozen run's outcome is not known yet. The group stays stopped; press Retry recovery under Dispatch when it is offered.",
  "handoff-complete": "Ready to resume: use the resume button under Dispatch.",
} as const satisfies Record<NonNullable<GroupSummaryV1["stopState"]>, string>;
```
and after line 235 (`      stop: "stop {{mode}} {{state}} · accepted {{accepted}} · deadline {{deadline}} · {{n}} frozen run(s): {{runs}}",`) insert:
```ts
      stopBanner: { how: stopBannerHow, exit: stopBannerExit },
```

`web/src/locales/zh.ts` — after line 142 (`      stop: "停止 {{mode}} {{state}} · 受理于 {{accepted}} · 截止 {{deadline}} · {{n}} 个冻结的运行：{{runs}}",`) insert:
```ts
      stopBanner: {
        how: {
          pause: "已停止：有人暂停了派发，不会再认领新的运行。",
          handoff: "已停止：有人发起了交接停止。当时在跑的运行已冻结，正在交接各自的工作。",
          shutdown: "已停止：面板关闭时有运行在跑。这些运行已冻结，正在交接各自的工作。",
        },
        exit: {
          paused: "出路：点「派发」下的「恢复派发」。",
          "handoff-pending": "正在停止：冻结的运行还在收尾。现在不用操作，收尾完成后出路会显示在这里。",
          "handoff-partial": "有冻结的运行没能完成交接。组保持停止；「派发」下出现「重试恢复」时点它。",
          "handoff-unresolved": "有冻结的运行结果还不清楚。组保持停止；「派发」下出现「重试恢复」时点它。",
          "handoff-complete": "可以恢复了：用「派发」下的恢复按钮。",
        },
      },
```

- [ ] **Step 4: Run, expect PASS**
```
cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > $SCRATCH/c3-wtc.txt 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/vitest run > $SCRATCH/c3-web.txt 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts tests/panel/scanPanelText.test.ts tests/panel/webParity.test.ts > $SCRATCH/c3-root.txt 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca-issues && npm run build --workspace web > $SCRATCH/c3-build.txt 2>&1; echo rc=$?
```
All rc=0 (the whole web suite, so `handoffResume`, `controlI18n` — which still finds `停止 暂停 已暂停 · 受理于 不适用 · 截止 无 · 0 个冻结的运行：无` inside the banner — and `controlPanel` stay green).

- [ ] **Step 5: Mutation** (clone copy, after `npm run build --workspace web`; each observed red while planning)
  1. `const handoffActive = stopMode === "handoff" || stopMode === "shutdown";` → `const handoffActive = stopMode === "handoff";` ⇒ "renders the resume dialog for a shutdown/handoff-complete group…", "offers no resume and none of the refused buttons…", "shows the banner in Chinese" red.
  2. `view.summary.state === "ready" && stopMode === null` → `view.summary.state === "ready" && !handoffActive` ⇒ "does not offer Start on a paused ready group…" red.
  3. Delete the whole `{view.stop !== null && ( <div … data-testid="stop-banner"> … )}` block ⇒ the four banner tests red.

- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add web/src/ControlGroupView.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/stopBanner.test.tsx
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(web): stop banner and the resume dialog for a completed panel shutdown

Issue-fixes spec §3.2 (3)(4): a shutdown/handoff-complete group gets the same resume
dialog as a human handoff-stop; every stopped group shows one banner (how it stopped,
its state, the way out, en and zh); Start, Pause dispatch and Handoff stop are not
rendered under a stop mode that refuses them.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

