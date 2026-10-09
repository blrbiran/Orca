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
import { lineageRunNumber } from "./runFacts.js";

const NODE_W = 180, NODE_H = 88, GAP_X = 56, GAP_Y = 16, PAD = 8;
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
