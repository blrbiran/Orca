/**
 * Kanban spec 2026-10-20 §3.3, §4, §9a.5: the groups of the board drawn by the person's edges, left to right (the task
 * graph's layout, dependencyLayout.ts, applied to groups). v1 edges come from the person only: add one (the dependent
 * waits until the other has landed) or remove one. The server refuses a cycle, a started dependent and the rest by name.
 * #378 (tester 2026-11-18): drawn with the task graph's renderer (DependencyDrawing): a node is the group's id, its goal's
 * summary, its state word and done/total, and opens the group; the "A waits for B" list with its Remove buttons is the
 * folded text fallback under the drawing.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { GroupSummaryV1, WorkItemCategoryV1 } from "./controlTypes.js";
import { DependencyDrawing, type DrawnNode } from "./DependencyGraph.js";
import { layoutDependencies } from "./dependencyLayout.js";
import { groupLed, type GroupLed } from "./groupCategory.js";
import { enumText } from "./i18n.js";
import { Select } from "./ui/Select.js";

/** #378: a node's fill follows the card's status light (ruling H8); the state word carries the meaning. */
const LED_CATEGORY: Record<GroupLed, WorkItemCategoryV1> = { running: "running", failed: "blocked", waiting: "waiting", idle: "idle" };

export function GroupGraph(props: { groups: GroupSummaryV1[]; onCommand: (action: ControlAction) => void; onOpen: (groupId: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const live = props.groups.filter((group) => group.archived !== true);
  const [dependent, setDependent] = useState("");
  const [prerequisite, setPrerequisite] = useState("");
  const [replaces, setReplaces] = useState("");
  const layout = layoutDependencies(live.map((group) => ({ taskId: group.groupId, dependencyTaskIds: group.dependsOn ?? [] })), { reduce: false });
  const byId = new Map(live.map((group) => [group.groupId, group]));
  const selectedReplacement = byId.get(dependent)?.dependsOn?.includes(replaces) ? replaces : "";
  const nodes = new Map(live.map((group): [string, DrawnNode] => {
    const state = enumText("groupState", group.state);
    const progress = group.completion !== undefined && group.completion.total > 0
      ? t("board.card.tasksDone", { done: group.completion.done, total: group.completion.total }) : null;
    return [group.groupId, {
      label: [group.groupId, state, ...(progress === null ? [] : [progress])].join(" · "),
      category: LED_CATEGORY[groupLed(group)],
      goal: group.goal,
      status: state,
      details: [progress === null ? null : { text: progress }],
    }];
  }));
  const send = (verb: "add-group-dependency" | "remove-group-dependency", groupId: string, dependsOn: string, from?: string): void => {
    const group = byId.get(groupId);
    if (group !== undefined) props.onCommand({ verb, groupId, expectedRevision: group.commandRevision,
      payload: { dependsOn, ...(from === undefined ? {} : { replaces: from }) } });
  };
  return (
    <figure className="group-graph" aria-label={t("board.graph.region")}>
      <figcaption>{t("board.graph.caption")}</figcaption>
      {live.length > 0 && <DependencyDrawing layout={layout} nodes={nodes} onOpen={props.onOpen} />}
      {layout.edges.length === 0 ? <p>{t("board.graph.none")}</p> : (
        <details>
          <summary>{t("board.graph.edges")}</summary>
          <ul aria-label={t("board.graph.edges")}>
            {layout.edges.map((edge) => (
              <li key={`${edge.from}>${edge.to}`}>
                {t("board.graph.edge", { dependent: edge.to, prerequisite: edge.from })}{" "}
                <button type="button" onClick={() => send("remove-group-dependency", edge.to, edge.from)}>{t("board.graph.remove")}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div role="group" aria-label={t("board.graph.add")}>
        <label>{t("board.graph.dependent")}
          <Select value={dependent} onValueChange={(next) => { setDependent(next); setReplaces(""); }}
            options={[{ value: "", label: "" }, ...live.map((group) => ({ value: group.groupId, label: group.groupId }))]} />
        </label>
        <label>{t("board.graph.prerequisite")}
          <Select value={prerequisite} onValueChange={setPrerequisite}
            options={[{ value: "", label: "" }, ...live.filter((group) => group.groupId !== dependent).map((group) => ({ value: group.groupId, label: group.groupId }))]} />
        </label>
        <label>{t("board.graph.replace")}
          <Select value={selectedReplacement} onValueChange={setReplaces}
            options={[{ value: "", label: "" }, ...(byId.get(dependent)?.dependsOn ?? []).map((id) => ({ value: id, label: id }))]} />
        </label>
        <button type="button" disabled={dependent === "" || prerequisite === "" || dependent === prerequisite || selectedReplacement !== ""}
          onClick={() => send("add-group-dependency", dependent, prerequisite)}>{t("board.graph.addButton")}</button>
        <button type="button" disabled={dependent === "" || prerequisite === "" || dependent === prerequisite || selectedReplacement === "" || selectedReplacement === prerequisite}
          onClick={() => send("add-group-dependency", dependent, prerequisite, selectedReplacement)}>{t("board.graph.replaceButton")}</button>
      </div>
    </figure>
  );
}
