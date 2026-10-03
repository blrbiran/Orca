/**
 * Board spec 2026-10-03 B1, D1, D2: the group's tasks drawn by dependency, left to right. Layout is `layoutDependencies`
 * (code, not taste); a node is a button that opens the same task detail as the table. Every task is drawn whatever the
 * table's label filter, and the status word is in the node's text so color never carries it alone.
 */
import type { JSX, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { WorkItemViewV1 } from "./controlTypes.js";
import { layoutDependencies } from "./dependencyLayout.js";
import { enumText } from "./i18n.js";

const NODE_W = 150, NODE_H = 40, GAP_X = 56, GAP_Y = 16, PAD = 8;

// Single-word literals joined, so the panel text scan (scripts/scan-panel-text.mjs) does not read a class list as words.
function statusClass(status: WorkItemViewV1["status"]): string {
  const kind = status === "completed" ? "dep-done" : status === "blocked" ? "dep-blocked" : status === "draft" || status === "ready" ? "dep-idle" : "dep-active";
  return ["dep-node", kind].join(" ");
}

export function DependencyGraph(props: { items: WorkItemViewV1[]; openTask: string | null; onOpen: (taskId: string) => void }): JSX.Element | null {
  const { t } = useTranslation();
  const layout = layoutDependencies(props.items);
  if (layout.edges.length === 0 && layout.missing === 0 && layout.cycleEdges === 0) return null;
  const status = new Map(props.items.map((item) => [item.taskId, item.status]));
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
            const state = status.get(node.taskId)!;
            const word = enumText("workStatus", state);
            return (
              <g
                key={node.taskId}
                role="button"
                tabIndex={0}
                aria-label={t("control.graph.node", { taskId: node.taskId, status: word })}
                aria-current={props.openTask === node.taskId ? "true" : undefined}
                className={statusClass(state)}
                transform={`translate(${at.x},${at.y})`}
                onClick={() => props.onOpen(node.taskId)}
                onKeyDown={key(node.taskId)}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} />
                <text x={8} y={16}>{node.taskId}</text>
                <text x={8} y={32} className="dep-status">{word}</text>
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
