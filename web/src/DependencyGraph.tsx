/**
 * Board spec 2026-10-03 B1, D1, D2: the group's tasks drawn by dependency, left to right. Layout is `layoutDependencies`
 * (code, not taste); a node is a button that opens the same task detail as the table. Every task is drawn whatever the
 * table's label filter, and the status word is in the node's text so color never carries it alone.
 * Issue-fixes spec §6.5: drawn whenever the group has work items, edges or not; each node is filled by the server's
 * §6.1 category (with a legend), and a running node says its step and attempt, its run number past 1, how long its run has
 * run, and -- after 10 quiet minutes -- how long it has made no progress.
 */
import type { JSX, KeyboardEvent } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useClock } from "./clock.js";
import { goalSummary } from "./CardGoal.js";
import { WEB_WORK_ITEM_CATEGORIES } from "./controlTypes.js";
import type { RunViewV1, WorkItemCategoryV1, WorkItemViewV1 } from "./controlTypes.js";
import { depSwatch } from "./ui/classes.js";
import { layoutDependencies, type DependencyLayout } from "./dependencyLayout.js";
import i18n, { enumText } from "./i18n.js";
import { lineageRunNumber, shownWorkStatus } from "./runFacts.js";

// Tester round 2 §8.2 (D10): one height for every node, with room for the goal line under the id.
const NODE_W = 180, NODE_H = 104, GAP_X = 56, GAP_Y = 16, PAD = 8;
// #232: an edge that skips a layer runs through it on a lane of its own, LANE_GAP apart, below that layer's last task.
const LANE_GAP = 12;
const SWATCH_FILL: Record<WorkItemCategoryV1, string> = {
  idle: "bg-cat-idle", running: "bg-cat-running", waiting: "bg-cat-waiting", blocked: "bg-cat-blocked", done: "bg-cat-done",
};
/** Spec §6.5: a current run quiet for longer than this is shown as making no progress. */
const STALL_MS = 10 * 60_000;

// Single-word literals joined, so the panel text scan (scripts/scan-panel-text.mjs) does not read a class list as words.
function nodeClass(category: WorkItemViewV1["category"]): string {
  return (category === undefined ? ["dep-node"] : ["dep-node", `dep-${category}`]).join(" ");
}

/** Issue-fixes spec §4.2: the task's runs that reached the provider (its lineage, less failed-before-provider). */
export function runNumber(item: WorkItemViewV1, runs: readonly RunViewV1[]): number {
  return lineageRunNumber(item.lineageRunIds, runs);
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

export interface Point { x: number; y: number }
/** A cubic crosses a gap between two layers (its control points at the gap's middle); a line runs along a lane. */
export type EdgeSegment = { kind: "cubic"; from: Point; c1: Point; c2: Point; to: Point } | { kind: "line"; from: Point; to: Point };
export interface GraphGeometry {
  width: number;
  height: number;
  nodes: Array<{ taskId: string; x: number; y: number; w: number; h: number }>;
  edges: Array<{ from: string; to: string; segments: EdgeSegment[] }>;
}

const across = (from: Point, to: Point): EdgeSegment => {
  const mid = (from.x + to.x) / 2;
  return { kind: "cubic", from, c1: { x: mid, y: from.y }, c2: { x: mid, y: to.y }, to };
};

/**
 * Where every node and edge of a laid-out graph is drawn (pure, so a criterion can sample exactly what is drawn). Nodes
 * keep their layer and index. An edge between neighbouring layers is one curve across the gap; an edge that skips layers
 * crosses each gap with a curve and each skipped layer's column straight along a lane below that layer's tasks, so it
 * never runs through a task it does not join (#232). Lanes are handed out in edge order.
 */
export function graphGeometry(layout: DependencyLayout): GraphGeometry {
  const columnX = (layer: number): number => PAD + layer * (NODE_W + GAP_X);
  const place = new Map(layout.nodes.map((node) => [node.taskId, { layer: node.layer, x: columnX(node.layer), y: PAD + node.index * (NODE_H + GAP_Y) }]));
  const tasksIn = new Map<number, number>();
  for (const node of layout.nodes) tasksIn.set(node.layer, (tasksIn.get(node.layer) ?? 0) + 1);
  const lanesIn = new Map<number, number>();
  const edges = layout.edges.map((edge) => {
    const from = place.get(edge.from)!, to = place.get(edge.to)!;
    const segments: EdgeSegment[] = [];
    let at: Point = { x: from.x + NODE_W, y: from.y + NODE_H / 2 };
    for (let layer = from.layer + 1; layer < to.layer; layer += 1) {
      const lane = lanesIn.get(layer) ?? 0;
      lanesIn.set(layer, lane + 1);
      const y = PAD + tasksIn.get(layer)! * (NODE_H + GAP_Y) + lane * LANE_GAP;
      const entry = { x: columnX(layer), y }, exit = { x: columnX(layer) + NODE_W, y };
      segments.push(across(at, entry), { kind: "line", from: entry, to: exit });
      at = exit;
    }
    segments.push(across(at, { x: to.x, y: to.y + NODE_H / 2 }));
    return { ...edge, segments };
  });
  // The lowest thing in each column: its last task's bottom edge, or its last lane.
  const bottom = Math.max(...[...tasksIn].map(([layer, tasks]) => {
    const lanes = lanesIn.get(layer) ?? 0;
    return lanes === 0 ? PAD + tasks * (NODE_H + GAP_Y) - GAP_Y : PAD + tasks * (NODE_H + GAP_Y) + (lanes - 1) * LANE_GAP;
  }));
  return {
    width: PAD * 2 + layout.layers * NODE_W + (layout.layers - 1) * GAP_X,
    height: bottom + PAD,
    nodes: layout.nodes.map((node) => ({ taskId: node.taskId, x: place.get(node.taskId)!.x, y: place.get(node.taskId)!.y, w: NODE_W, h: NODE_H })),
    edges,
  };
}

export function edgePath(segments: readonly EdgeSegment[]): string {
  const first = segments[0]!.from;
  return [`M${first.x},${first.y}`, ...segments.map((segment) => segment.kind === "line"
    ? `L${segment.to.x},${segment.to.y}`
    : `C${segment.c1.x},${segment.c1.y} ${segment.c2.x},${segment.c2.y} ${segment.to.x},${segment.to.y}`)].join(" ");
}

/** Points along an edge, `steps` per segment, ends included. */
export function sampleEdge(segments: readonly EdgeSegment[], steps = 32): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps, u = 1 - t;
      points.push(segment.kind === "line"
        ? { x: segment.from.x + (segment.to.x - segment.from.x) * t, y: segment.from.y + (segment.to.y - segment.from.y) * t }
        : {
          x: u * u * u * segment.from.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t * t * t * segment.to.x,
          y: u * u * u * segment.from.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t * t * t * segment.to.y,
        });
    }
  }
  return points;
}

export function DependencyGraph(props: { items: WorkItemViewV1[]; runs: readonly RunViewV1[]; openTask: string | null; onOpen: (taskId: string) => void; now?: number }): JSX.Element | null {
  const { t } = useTranslation();
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  const clipBase = `dep-goal-clip${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  if (props.items.length === 0) return null;
  const layout = layoutDependencies(props.items);
  const byId = new Map(props.items.map((item) => [item.taskId, item]));
  const geometry = graphGeometry(layout);
  const place = new Map(geometry.nodes.map((node) => [node.taskId, node]));
  const { width, height } = geometry;
  const key = (taskId: string) => (event: KeyboardEvent<SVGGElement>): void => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onOpen(taskId); }
  };
  return (
    <figure className="dep-graph" aria-label={t("control.graph.region")}>
      <figcaption>{t("control.graph.caption")}</figcaption>
      <ul className="dep-legend mt-1 mb-2 flex list-none flex-wrap gap-3 p-0 text-xs text-muted" aria-label={t("control.graph.legend")}>
        {WEB_WORK_ITEM_CATEGORIES.map((category) => (
          <li key={category}><span className={["dep-swatch", `dep-${category}`, depSwatch, SWATCH_FILL[category]].join(" ")} aria-hidden="true" />{t(`control.graph.category.${category}` as const)}</li>
        ))}
      </ul>
      <div className="dep-scroll max-w-full overflow-x-auto">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <marker id="dep-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="dep-arrow" />
            </marker>
          </defs>
          {geometry.edges.map((edge) => (
            <path key={`${edge.from}->${edge.to}`} data-edge={`${edge.from}->${edge.to}`} className="dep-edge" d={edgePath(edge.segments)} markerEnd="url(#dep-arrow)" />
          ))}
          {layout.nodes.map((node) => {
            const at = place.get(node.taskId)!;
            const item = byId.get(node.taskId)!;
            const word = enumText("workStatus", shownWorkStatus(item));
            const lines = nodeLines(item, props.runs, now);
            const goal = item.objective?.goal;
            // Review minor 10: unique per graph instance (two graphs of one group may be on a page), safe in an id.
            const clip = `${clipBase}-${encodeURIComponent(node.taskId).replace(/%/g, "_")}`;
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
                {/* Tester round 2 §8.2 (H5): the goal's summary under the id, clipped to the node; the whole goal in <title>. */}
                {goal !== undefined && <title>{goal}</title>}
                <rect width={NODE_W} height={NODE_H} rx={6} />
                <text x={8} y={16}>{node.taskId}</text>
                {goal !== undefined && <>
                  <clipPath id={clip}><rect width={NODE_W - 16} height={NODE_H} x={8} /></clipPath>
                  <text x={8} y={32} className="dep-goal" clipPath={`url(#${clip})`}>{goalSummary(goal)}</text>
                </>}
                <text x={8} y={48} className="dep-status">{word}</text>
                {lines.progress !== null && <text x={8} y={64} className="dep-detail">{lines.progress}</text>}
                {lines.run !== null && <text x={8} y={80} className="dep-detail">{lines.run}</text>}
                {lines.stalled !== null && <text x={8} y={96} className="dep-stall">{lines.stalled}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {layout.missing > 0 && <p role="note">{t("control.graph.missing", { count: layout.missing })}</p>}
      {layout.cycleEdges > 0 && <p role="alert">{t("control.graph.cycle", { count: layout.cycleEdges })}</p>}
      {/* #271: implied dependencies are not drawn; the count says so, so a reader never takes the drawing for all the data. */}
      {layout.implied > 0 && <p role="note" data-testid="dep-implied">{t("control.graph.implied", { count: layout.implied })}</p>}
    </figure>
  );
}
