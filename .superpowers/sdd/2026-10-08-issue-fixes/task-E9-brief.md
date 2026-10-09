### Task E9: The work-items graph: always drawn, filled by category, with live node text (spec §6.5)

**Files:**
- Modify: `web/src/DependencyGraph.tsx` (whole file, lines 1-76)
- Modify: `web/src/ControlGroupView.tsx` — the `<DependencyGraph … />` line (146) gets `runs` and `now`; props gain `now?`
- Modify: `web/src/styles.css` — the three token blocks (lines 5-40, 41-48, 50-60) and the graph rules (lines 239-252)
- Modify: `web/src/locales/en.ts` `control.graph` (lines 373-381), `web/src/locales/zh.ts` `control.graph` (lines 279-287)
- Test: `web/tests/dependencyGraph.test.tsx` (two rewrites, new cases), `web/tests/styles.test.ts`, `web/tests/contrast.test.ts`

**Interfaces:**
- Consumes: `WorkItemViewV1.category` (E2), `WEB_WORK_ITEM_CATEGORIES`; Part B `RunViewV1.startedAt`, `.lastActivityAt`; `useClock`.
- Produces: `DependencyGraph(props: { items: WorkItemViewV1[]; runs: readonly RunViewV1[]; openTask: string | null; onOpen: (taskId: string) => void; now?: number })`;
  `export function runNumber(item, runs): number`; `export function nodeLines(item, runs, now): { progress: string | null; run: string | null; stalled: string | null }`;
  CSS tokens `--cat-idle|running|waiting|blocked|done` in all three theme blocks.

- [ ] **Step 1: Write the failing tests.** In `web/tests/dependencyGraph.test.tsx`:
  - rewrite "draws one button per task…" input to
    `render2([workItem({ taskId: "a", status: "completed", category: "done" }), workItem({ taskId: "b", status: "blocked", category: "blocked", dependencyTaskIds: ["a"] })]);`
    (assertions unchanged);
  - replace the test "draws nothing for a group without dependencies, where the table already says all there is" with:

```tsx
  it("draws every task even when no task depends on another (issue-fixes spec §6.5)", () => {
    render2([workItem({ taskId: "a" }), workItem({ taskId: "b" })]);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    expect(within(graph).getAllByRole("button").map((node) => node.getAttribute("aria-label"))).toEqual(["a · active", "b · active"]);
    expect(graph.querySelectorAll("path[data-edge]")).toHaveLength(0);
  });
```

  and append (imports: add `run` to the `./fixtures/board.js` import, and `import { nodeLines, runNumber } from "../src/DependencyGraph.js";`):

```tsx
describe("category fill, legend and live node text (issue-fixes spec §6.5)", () => {
  const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
  const minutes = (n: number) => NOW - n * 60_000;
  const progress = { runId: "run-a", step: "execute" as const, attempt: { current: 2, max: 3 }, tokens: null, lastTransitionAt: null };
  const runningItem = workItem({ taskId: "a", category: "running", currentRunId: "run-a", lineageRunIds: ["run-0", "run-a"], progress });
  const runs = (lastActivityAt: number) => [run({ runId: "run-0", state: "settled-restartable" }), run({ runId: "run-a", startedAt: minutes(12), lastActivityAt })];

  it("classes each node by the server's category and draws a legend of all five", () => {
    render(<ControlGroupView view={view([workItem({ taskId: "i", category: "idle" }), workItem({ taskId: "w", category: "waiting" }), workItem({ taskId: "r", category: "running" }),
      workItem({ taskId: "b", category: "blocked" }), workItem({ taskId: "d", category: "done" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    for (const [taskId, category] of [["i", "idle"], ["w", "waiting"], ["r", "running"], ["b", "blocked"], ["d", "done"]] as const) {
      expect(screen.getByRole("button", { name: `${taskId} · active` }).getAttribute("class")).toBe(`dep-node dep-${category}`);
    }
    expect(within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["idle", "running", "waiting", "blocked", "done"]);
  });

  it("shows a running task's step and attempt, its run number past 1 and the time since its run started", () => {
    expect(nodeLines(runningItem, runs(minutes(2)), NOW)).toEqual({ progress: "execute · attempt 2", run: "run 2 · 12 min", stalled: null });
    expect(runNumber(runningItem, [run({ runId: "run-0", state: "failed-before-provider" }), run({ runId: "run-a" })])).toBe(1);
    expect(nodeLines(workItem({ taskId: "z", category: "idle" }), runs(minutes(2)), NOW)).toEqual({ progress: null, run: null, stalled: null });
  });

  it("says 'no progress for N min' only once the current run has been quiet for more than 10 minutes", () => {
    expect(nodeLines(runningItem, runs(minutes(10)), NOW).stalled).toBeNull();
    expect(nodeLines(runningItem, runs(minutes(11)), NOW).stalled).toBe("no progress for 11 min");
    render(<ControlGroupView view={view([runningItem], runs(minutes(11)))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    const node = screen.getByRole("button", { name: "a · active" });
    expect(node.querySelector("text.dep-stall")?.textContent).toBe("no progress for 11 min");
  });

  it("opens the task detail from a node, the same task the table opens", () => {
    render(<ControlGroupView view={view([runningItem], runs(minutes(2)))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "a · active" }));
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
  });
});
```

  (`run({...startedAt, lastActivityAt})` relies on Part B's optional `RunViewV1` fields.)

  Append to `web/tests/styles.test.ts` inside its `describe`:

```ts
  // Issue-fixes spec §6.5, plan Review Focus 5: every category colour exists in the dark theme and in both light blocks.
  it("defines every work-item category colour for the dark theme and both light-theme blocks, and fills each node with its own", () => {
    const blockOf = (opener: string): string => {
      const at = css.indexOf(opener);
      if (at === -1) throw new Error(`no block ${opener}`);
      return css.slice(at, css.indexOf("}", at));
    };
    const blocks = [":root {", ':root[data-theme="light"] {', ':root:not([data-theme="dark"]) {'].map(blockOf);
    for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
      for (const block of blocks) expect(block, category).toMatch(new RegExp(`--cat-${category}:\\s*[^;]+;`));
      expect(rule(`.dep-${category} rect`)).toContain(`fill: var(--cat-${category})`);
    }
  });

  it("pulses a running node slowly, and not at all under prefers-reduced-motion", () => {
    expect(rule(".dep-node.dep-running rect")).toContain("animation: dep-pulse");
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const media = css.slice(at, css.indexOf("}", at));
    expect(media).toContain(".dep-node.dep-running rect { animation: none;");
  });
```

  Append to `web/tests/contrast.test.ts` inside its `describe` (after the last `it`):

```ts
  // Issue-fixes spec §6.5: a node's words stay readable on its category fill (painted over the card it sits on).
  it("keeps node text readable on every work-item category fill", () => {
    for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
      const fill = paint(token(`cat-${category}`), card);
      expect(ratio(hex(token("text")), fill), category).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(token("text-strong")), fill), category).toBeGreaterThanOrEqual(4.5);
    }
  });
```

- [ ] **Step 2: Run, expect FAIL** —
  `cd <wt>/web && ../node_modules/.bin/vitest run tests/dependencyGraph.test.tsx tests/styles.test.ts tests/contrast.test.ts > <S>/e9.txt 2>&1; echo rc=$?`
  → `rc=1` (no figure for zero edges; class `dep-node dep-active`; `nodeLines` not exported; no tokens).

- [ ] **Step 3: Implement.** Replace `web/src/DependencyGraph.tsx` with:

```tsx
/**
 * Board spec 2026-10-03 B1, D1, D2: the group's tasks drawn by dependency, left to right. Layout is `layoutDependencies`
 * (code, not taste); a node is a button that opens the same task detail as the table. Every task is drawn whatever the
 * table's label filter, and the status word is in the node's text so color never carries it alone.
 * Issue-fixes spec §6.5: drawn whenever the group has work items, edges or not; each node is filled by the server's
 * §6.1 category (with a legend), and a running node says its step and attempt, its run number past 1, how long its run has
 * run, and -- after 10 quiet minutes -- how long it has made no progress.
 */
import type { JSX, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useClock } from "./clock.js";
import { WEB_WORK_ITEM_CATEGORIES } from "./controlTypes.js";
import type { RunViewV1, WorkItemViewV1 } from "./controlTypes.js";
import { layoutDependencies } from "./dependencyLayout.js";
import i18n, { enumText } from "./i18n.js";

const NODE_W = 180, NODE_H = 88, GAP_X = 56, GAP_Y = 16, PAD = 8;
/** Spec §6.5: a current run quiet for longer than this is shown as making no progress. */
const STALL_MS = 10 * 60_000;

// Single-word literals joined, so the panel text scan (scripts/scan-panel-text.mjs) does not read a class list as words.
function nodeClass(category: WorkItemViewV1["category"]): string {
  return (category === undefined ? ["dep-node"] : ["dep-node", `dep-${category}`]).join(" ");
}

/** Issue-fixes spec §4.2: the task's runs that reached the provider (its lineage, less failed-before-provider). */
export function runNumber(item: WorkItemViewV1, runs: readonly RunViewV1[]): number {
  return runs.filter((run) => item.lineageRunIds.includes(run.runId) && run.state !== "failed-before-provider").length;
}

/** Spec §6.5: the lines under a running node's status word; null lines are not drawn. */
export function nodeLines(item: WorkItemViewV1, runs: readonly RunViewV1[], now: number): { progress: string | null; run: string | null; stalled: string | null } {
  if (item.category !== "running") return { progress: null, run: null, stalled: null };
  const step = item.progress?.step ?? null;
  const attempt = item.progress?.attempt?.current ?? null;
  const progress = step === null ? null : attempt === null
    ? enumText("progressStep", step)
    : i18n.t("control.graph.stepAttempt", { step: enumText("progressStep", step), attempt });
  const current = runs.find((run) => run.runId === item.currentRunId);
  const n = runNumber(item, runs);
  const parts = [
    ...(n > 1 ? [i18n.t("control.graph.runNumber", { n })] : []),
    ...(current?.startedAt != null ? [i18n.t("control.graph.elapsed", { minutes: Math.floor((now - current.startedAt) / 60_000) })] : []),
  ];
  const quiet = current?.lastActivityAt != null ? now - current.lastActivityAt : null;
  return {
    progress,
    run: parts.length === 0 ? null : parts.join(" · "),
    stalled: quiet !== null && quiet > STALL_MS ? i18n.t("control.graph.stalled", { minutes: Math.floor(quiet / 60_000) }) : null,
  };
}

export function DependencyGraph(props: { items: WorkItemViewV1[]; runs: readonly RunViewV1[]; openTask: string | null; onOpen: (taskId: string) => void; now?: number }): JSX.Element | null {
  const { t } = useTranslation();
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  if (props.items.length === 0) return null;
  const layout = layoutDependencies(props.items);
  const byId = new Map(props.items.map((item) => [item.taskId, item]));
  const place = new Map(layout.nodes.map((node) => [node.taskId, { x: PAD + node.layer * (NODE_W + GAP_X), y: PAD + node.index * (NODE_H + GAP_Y) }]));
  const rows = Math.max(...layout.nodes.map((node) => node.index + 1));
  const width = PAD * 2 + layout.layers * NODE_W + (layout.layers - 1) * GAP_X;
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;
  const key = (taskId: string) => (event: KeyboardEvent<SVGGElement>): void => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onOpen(taskId); }
  };
  return (
    <figure className="dep-graph" aria-label={t("control.graph.region")}>
      <figcaption>{t("control.graph.caption")}</figcaption>
      <ul className="dep-legend" aria-label={t("control.graph.legend")}>
        {WEB_WORK_ITEM_CATEGORIES.map((category) => (
          <li key={category}><span className={["dep-swatch", `dep-${category}`].join(" ")} aria-hidden="true" />{t(`control.graph.category.${category}` as const)}</li>
        ))}
      </ul>
      <div className="dep-scroll">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <marker id="dep-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="dep-arrow" />
            </marker>
          </defs>
          {layout.edges.map((edge) => {
            const from = place.get(edge.from)!, to = place.get(edge.to)!;
            const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2, x2 = to.x, y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return <path key={`${edge.from}->${edge.to}`} data-edge={`${edge.from}->${edge.to}`} className="dep-edge" d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} markerEnd="url(#dep-arrow)" />;
          })}
          {layout.nodes.map((node) => {
            const at = place.get(node.taskId)!;
            const item = byId.get(node.taskId)!;
            const word = enumText("workStatus", item.status);
            const lines = nodeLines(item, props.runs, now);
            return (
              <g
                key={node.taskId}
                role="button"
                tabIndex={0}
                aria-label={t("control.graph.node", { taskId: node.taskId, status: word })}
                aria-current={props.openTask === node.taskId ? "true" : undefined}
                className={nodeClass(item.category)}
                transform={`translate(${at.x},${at.y})`}
                onClick={() => props.onOpen(node.taskId)}
                onKeyDown={key(node.taskId)}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} />
                <text x={8} y={16}>{node.taskId}</text>
                <text x={8} y={32} className="dep-status">{word}</text>
                {lines.progress !== null && <text x={8} y={48} className="dep-detail">{lines.progress}</text>}
                {lines.run !== null && <text x={8} y={64} className="dep-detail">{lines.run}</text>}
                {lines.stalled !== null && <text x={8} y={80} className="dep-stall">{lines.stalled}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {layout.missing > 0 && <p role="note">{t("control.graph.missing", { count: layout.missing })}</p>}
      {layout.cycleEdges > 0 && <p role="alert">{t("control.graph.cycle", { count: layout.cycleEdges })}</p>}
    </figure>
  );
}
```

  `web/src/ControlGroupView.tsx`: add to `ControlGroupViewProps`
  `  /** Issue-fixes spec §6.5: the clock the graph's elapsed and no-progress text is read against; the graph reads it itself when absent. */\n  now?: number;`
  and change the graph line to
  `<DependencyGraph items={view.workItems} runs={view.runs} now={props.now} openTask={openTask} onOpen={(taskId) => setOpenTask(openTask === taskId ? null : taskId)} />`.

  `web/src/styles.css`: in `:root {` after `--kind-3: #facc15;` add

```css
  /* Issue-fixes spec §6.5: work-item category fills (over --card); web/tests/contrast.test.ts pins text on each. */
  --cat-idle: rgba(168, 168, 179, 0.18);
  --cat-running: rgba(34, 197, 94, 0.28);
  --cat-waiting: rgba(245, 158, 11, 0.28);
  --cat-blocked: rgba(248, 113, 113, 0.30);
  --cat-done: rgba(96, 165, 250, 0.28);
```

  in `:root[data-theme="light"] {` and in the `:root:not([data-theme="dark"]) {` block, after their
  `--kind-1: …; --on-accent: #ffffff;` line, add

```css
    --cat-idle: rgba(110, 105, 96, 0.12); --cat-running: rgba(21, 128, 61, 0.16); --cat-waiting: rgba(180, 83, 9, 0.16);
    --cat-blocked: rgba(185, 28, 28, 0.16); --cat-done: rgba(37, 99, 235, 0.14);
```

  and replace the graph lines from `.dep-node text.dep-status { … }` through `.dep-node[aria-current="true"] rect { … }`
  (lines 244-248) with

```css
.dep-node text.dep-status, .dep-node text.dep-detail { fill: var(--text); font-family: var(--font); font-size: var(--text-xs); }
.dep-node text.dep-stall { fill: var(--warn); font-family: var(--font); font-size: var(--text-xs); }
/* Issue-fixes spec §6.5: the fill is the §6.1 category; the stroke repeats it. */
.dep-idle rect { fill: var(--cat-idle); stroke: var(--border-strong); }
.dep-running rect { fill: var(--cat-running); stroke: var(--ok); }
.dep-waiting rect { fill: var(--cat-waiting); stroke: var(--warn); }
.dep-blocked rect { fill: var(--cat-blocked); stroke: var(--danger); }
.dep-done rect { fill: var(--cat-done); stroke: var(--info); }
@keyframes dep-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
.dep-node.dep-running rect { animation: dep-pulse 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dep-node.dep-running rect { animation: none; }
}
.dep-node[aria-current="true"] rect { stroke: var(--accent); stroke-width: 3; }
.dep-legend { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; margin: 4px 0 8px; padding: 0; font-size: var(--text-xs); color: var(--muted); }
.dep-swatch { display: inline-block; width: 12px; height: 12px; margin-right: 4px; vertical-align: middle; border-radius: 3px; border: 1px solid var(--border-strong); }
.dep-swatch.dep-idle { background: var(--cat-idle); }
.dep-swatch.dep-running { background: var(--cat-running); }
.dep-swatch.dep-waiting { background: var(--cat-waiting); }
.dep-swatch.dep-blocked { background: var(--cat-blocked); }
.dep-swatch.dep-done { background: var(--cat-done); }
```

  Locales: in en `control.graph`, after `cycle_other: …,` add

```ts
      legend: "Legend",
      category: { idle: "idle", running: "running", waiting: "waiting", blocked: "blocked", done: "done" },
      stepAttempt: "{{step}} · attempt {{attempt}}",
      runNumber: "run {{n}}",
      elapsed: "{{minutes}} min",
      stalled: "no progress for {{minutes}} min",
```

  in zh `control.graph`, after `cycle_other: …,` add

```ts
      legend: "图例",
      category: { idle: "空闲", running: "进行中", waiting: "等待依赖", blocked: "受阻", done: "已完成" },
      stepAttempt: "{{step}} · 第 {{attempt}} 次尝试",
      runNumber: "第 {{n}} 次运行",
      elapsed: "{{minutes}} 分钟",
      stalled: "已 {{minutes}} 分钟没有进展",
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`; then `npm run check --workspace web > <S>/e9-web.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutation** (clone, web built): restore `if (layout.edges.length === 0 && layout.missing === 0 && layout.cycleEdges === 0) return null;`
  → "draws every task even when no task depends on another" red; replace `nodeClass(item.category)` with `"dep-node"` →
  the class test red; change `quiet > STALL_MS` to `quiet >= STALL_MS` → "only once … more than 10 minutes" red (10 min
  shows); change `n > 1` to `n > 2` → the step/attempt test red (no `run 2`); change
  `run.state !== "failed-before-provider"` to `true` → `runNumber(...)` expectation `1` red; delete the reduced-motion
  media block → the pulse test red; delete `--cat-done` from the light block → the token test red.
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/DependencyGraph.tsx web/src/ControlGroupView.tsx web/src/styles.css web/src/locales/en.ts web/src/locales/zh.ts web/tests/dependencyGraph.test.tsx web/tests/styles.test.ts web/tests/contrast.test.ts`,
  message `feat(web): draw the work-items graph always, filled by category, with live node text` (+ Co-Authored-By).

