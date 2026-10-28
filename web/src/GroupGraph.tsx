/**
 * Kanban spec 2026-10-20 §3.3, §4, §9a.5: the groups of the board drawn by the person's edges, left to right (the task
 * graph's layout, dependencyLayout.ts, applied to groups). v1 edges come from the person only: add one (the dependent
 * waits until the other has landed) or remove one. The server refuses a cycle, a started dependent and the rest by name.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { GroupSummaryV1 } from "./controlTypes.js";
import { layoutDependencies } from "./dependencyLayout.js";

export function GroupGraph(props: { groups: GroupSummaryV1[]; onCommand: (action: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const live = props.groups.filter((group) => group.archived !== true);
  const [dependent, setDependent] = useState("");
  const [prerequisite, setPrerequisite] = useState("");
  const layout = layoutDependencies(live.map((group) => ({ taskId: group.groupId, dependencyTaskIds: group.dependsOn ?? [] })));
  const byId = new Map(live.map((group) => [group.groupId, group]));
  const layers = Array.from({ length: layout.layers }, (_, layer) => layout.nodes.filter((node) => node.layer === layer).map((node) => node.taskId));
  const send = (verb: "add-group-dependency" | "remove-group-dependency", groupId: string, dependsOn: string): void => {
    const group = byId.get(groupId);
    if (group !== undefined) props.onCommand({ verb, groupId, expectedRevision: group.commandRevision, payload: { dependsOn } });
  };
  return (
    <figure className="group-graph" aria-label={t("board.graph.region")}>
      <figcaption>{t("board.graph.caption")}</figcaption>
      <div className="group-graph-layers flex gap-6 overflow-x-auto">
        {layers.map((ids, layer) => (
          <ol key={layer} aria-label={t("board.graph.layer", { n: layer + 1 })}>
            {ids.map((id) => <li key={id}>{id}{byId.get(id)?.goal !== undefined ? ` · ${byId.get(id)!.goal}` : ""}</li>)}
          </ol>
        ))}
      </div>
      {layout.edges.length === 0 ? <p>{t("board.graph.none")}</p> : (
        <ul aria-label={t("board.graph.edges")}>
          {layout.edges.map((edge) => (
            <li key={`${edge.from}>${edge.to}`}>
              {t("board.graph.edge", { dependent: edge.to, prerequisite: edge.from })}{" "}
              <button type="button" onClick={() => send("remove-group-dependency", edge.to, edge.from)}>{t("board.graph.remove")}</button>
            </li>
          ))}
        </ul>
      )}
      <div role="group" aria-label={t("board.graph.add")}>
        <label>{t("board.graph.dependent")}
          <select value={dependent} onChange={(event) => setDependent(event.currentTarget.value)}>
            <option value="" />
            {live.map((group) => <option key={group.groupId} value={group.groupId}>{group.groupId}</option>)}
          </select>
        </label>
        <label>{t("board.graph.prerequisite")}
          <select value={prerequisite} onChange={(event) => setPrerequisite(event.currentTarget.value)}>
            <option value="" />
            {live.filter((group) => group.groupId !== dependent).map((group) => <option key={group.groupId} value={group.groupId}>{group.groupId}</option>)}
          </select>
        </label>
        <button type="button" disabled={dependent === "" || prerequisite === "" || dependent === prerequisite}
          onClick={() => send("add-group-dependency", dependent, prerequisite)}>{t("board.graph.addButton")}</button>
      </div>
    </figure>
  );
}
