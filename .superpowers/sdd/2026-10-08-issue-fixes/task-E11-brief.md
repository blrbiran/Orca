### Task E11: The task detail shows its current run's activity (spec §6.5)

**Files:**
- Modify: `web/src/controlApi.ts` — after `fetchRunEvidence` (lines 110-112)
- Modify: `web/src/TaskDetail.tsx` — imports (lines 11-18); new `RunActivity`; insertion before
  `<h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>` (line 178)
- Modify: locales (`control.activity`, `enums.activityKind`)
- Modify: `web/tests/taskLabels.test.tsx` (the rewrite listed above)
- Test: `web/tests/taskActivity.test.tsx` (new)

**Interfaces:**
- Consumes: Part B route and `RunActivityViewV1`/`ActivityEntryV1`; Part A `explainRunReason`.
- Produces: `fetchRunActivity(runId: string): Promise<RunActivityViewV1>`; `RunActivity(props: { runId: string; changeSeq: number })`.

- [ ] **Step 1: Write the failing test** — `web/tests/taskActivity.test.tsx`:

```tsx
// @vitest-environment jsdom
/** Issue-fixes spec §6.5: selecting a task shows its current run's recent activity, above the evidence list. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../src/TaskDetail.js";
import { run, view, workItem } from "./fixtures/board.js";

const AT = Date.UTC(2026, 9, 8, 10, 5, 0);
const answer = {
  schema: "orca-run-activity-v1", runId: "run-a",
  entries: [
    { seq: 2, groupId: "g", taskId: "a", runId: "run-a", at: AT, kind: "phase", body: { step: "execute", attempt: 2 } },
    { seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: AT - 60_000, kind: "run-started", body: { providerAttemptOrdinal: 1 } },
  ],
};
let urls: string[] = [];
beforeEach(() => {
  urls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the task detail's run activity (spec §6.5)", () => {
  it("reads the current run's activity from its route and lists it, newest first, above the runs and their evidence", async () => {
    const item = workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] });
    render(<TaskDetail view={view([item], [run({})])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual([
      `${new Date(AT).toISOString()} · phase · execute · attempt 2`,
      `${new Date(AT - 60_000).toISOString()} · started`,
    ]);
    expect(urls).toEqual(["/api/control/runs/run-a/activity"]);
    const runsHeading = screen.getByRole("heading", { name: "Runs of a" });
    expect(region.compareDocumentPosition(runsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("reads nothing for a task with no current run", () => {
    const item = workItem({ taskId: "a" });
    render(<TaskDetail view={view([item])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Recent activity of run-a" })).toBeNull();
    expect(urls).toEqual([]);
  });
});
```

  Rewrite in `web/tests/taskLabels.test.tsx` ("lists the manifest's entries and downloads one with the session alone",
  spec §6.5): in the `beforeEach` fetch mock, before the evidence branch, add
  `if (url === "/api/control/runs/run-a/activity") return new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [] }), { status: 200, headers: { "content-type": "application/json" } });`
  and change the final assertion to

```ts
      expect(requests).toEqual([{ url: "/api/control/runs/run-a/activity", headers: undefined }, { url: "/api/control/runs/run-a/evidence", headers: undefined }, { url: "/api/control/runs/run-a/evidence/ev-2", headers: undefined }]);
```

- [ ] **Step 2: Run, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/taskActivity.test.tsx tests/taskLabels.test.tsx > <S>/e11.txt 2>&1; echo rc=$?` → `rc=1` (no region; the activity URL never requested).

- [ ] **Step 3: Implement.**

  `web/src/controlApi.ts` (add `RunActivityViewV1` to the type import list), after `fetchRunEvidence`:

```ts
/** Issue-fixes spec §5.2, §6.5: GET /api/control/runs/:runId/activity -- the run's newest activity rows, newest first. */
export const fetchRunActivity = (runId: string): Promise<RunActivityViewV1> =>
  controlGet<RunActivityViewV1>(`/api/control/runs/${segment(runId)}/activity`);
```

  `web/src/TaskDetail.tsx`: change line 11 to `import { useEffect, useState } from "react";`, add `fetchRunActivity` to the
  `./controlApi.js` import, `ActivityEntryV1` to the `./controlTypes.js` type import, and
  `import { explainRunReason } from "./refusalExplain.js";`. Add above `export interface TaskDetailProps`:

```tsx
/** One activity row in words: its kind, and for a phase, a block or a settle what it said. */
function activityText(entry: ActivityEntryV1): string {
  const kind = enumText("activityKind", entry.kind);
  const body = entry.body as Record<string, unknown>;
  if (entry.kind === "phase" && typeof body.step === "string") {
    const step = enumText("progressStep", body.step);
    return `${kind} · ${typeof body.attempt === "number" ? i18n.t("control.activity.phase", { step, attempt: body.attempt }) : step}`;
  }
  if (entry.kind === "run-blocked" && typeof body.reason === "string") return `${kind} · ${explainRunReason(body.reason) ?? body.reason}`;
  if (entry.kind === "run-settled" && typeof body.state === "string") return `${kind} · ${enumText("runState", body.state)}`;
  return kind;
}

/**
 * Issue-fixes spec §6.5: the current run's recent activity, read when the detail opens and again whenever the group's
 * projection moves (changeSeq). A refusal is named in place; the rest of the detail does not wait on it.
 */
export function RunActivity(props: { runId: string; changeSeq: number }): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntryV1[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchRunActivity(props.runId).then(
      (answer) => { if (live) { setEntries(Array.isArray(answer?.entries) ? answer.entries : []); setRefusal(null); } },
      (err: unknown) => { if (live) setRefusal(controlFailureFrom(err).code); },
    );
    return () => { live = false; };
  }, [props.runId, props.changeSeq]);
  return (
    <section aria-label={t("control.activity.region", { runId: props.runId })}>
      <h5>{t("control.activity.heading")}</h5>
      {refusal !== null && <p className="detail-note">{t("control.activity.refused", { code: refusal })}</p>}
      {entries !== null && (entries.length === 0 ? <p>{t("control.activity.none")}</p> : (
        <ol>
          {entries.map((entry) => <li key={entry.seq}>{new Date(entry.at).toISOString()} · {activityText(entry)}</li>)}
        </ol>
      ))}
    </section>
  );
}
```

  and in `TaskDetail`'s return, directly before `<h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>`:

```tsx
      {item.currentRunId !== null && <RunActivity runId={item.currentRunId} changeSeq={view.changeSeq} />}
```

  Locales: en, inside `control` after the `evidence: { … },` block:

```ts
    activity: {
      region: "Recent activity of {{runId}}",
      heading: "Recent activity",
      none: "no activity recorded yet",
      refused: "activity refused · {{code}}",
      phase: "{{step}} · attempt {{attempt}}",
    },
```

  en, a new enum const next to `progressStep` (before `export const en`), and `activityKind` added to the `enums:`
  list after `progressStep,`:

```ts
// Issue-fixes spec §5.2: the activity kinds a run's feed shows.
const activityKind = {
  command: "command", "run-claimed": "claimed", "run-started": "started", phase: "phase", "run-blocked": "blocked", "run-resumed": "resumed",
  "run-settled": "settled", "task-retried": "task retried", integration: "integration", stop: "stopped", "stop-cleared": "stop cleared",
  archived: "archived", unarchived: "unarchived",
} as const satisfies Record<ActivityEntryV1["kind"], string>;
```

  (add `ActivityEntryV1` to en.ts's type import from `../controlTypes.js`). zh, inside `control` after `evidence`:

```ts
    activity: {
      region: "{{runId}} 的近期活动",
      heading: "近期活动",
      none: "还没有活动记录",
      refused: "活动读取被拒绝 · {{code}}",
      phase: "{{step}} · 第 {{attempt}} 次尝试",
    },
```

  zh `enums`, after `progressStep: {…},`:

```ts
    activityKind: {
      command: "命令", "run-claimed": "已认领", "run-started": "已开始", phase: "阶段", "run-blocked": "受阻", "run-resumed": "已恢复",
      "run-settled": "已结束", "task-retried": "任务重试", integration: "集成", stop: "已停止", "stop-cleared": "停止已解除",
      archived: "已归档", unarchived: "已取消归档",
    },
```

  (If Part B already added `enums.activityKind`, keep Part B's entries and skip these; Rule 7.)

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`; `npm run check --workspace web > <S>/e11-web.txt 2>&1; echo rc=$?` → `rc=0`;
  `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > <S>/e11-scan.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutation** (clone, web built): delete the `<RunActivity …/>` line → the first test red (and the taskLabels
  rewrite red); replace `item.currentRunId !== null &&` with `true &&` and pass `runId={item.currentRunId ?? "run-a"}` →
  "reads nothing for a task with no current run" red (a request is made); delete the
  `if (entry.kind === "phase" …) { … }` block → the first test red (the line reads `phase` only).
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/controlApi.ts web/src/TaskDetail.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/taskActivity.test.tsx web/tests/taskLabels.test.tsx`,
  message `feat(web): show the current run's recent activity in the task detail` (+ Co-Authored-By).

