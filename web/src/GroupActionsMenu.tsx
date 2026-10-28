import { useId, useState, type JSX, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { GroupSummaryV1 } from "./controlTypes.js";
import type { ControlRefusal } from "./controlState.js";
import { RefusalNotice } from "./RefusalNotice.js";
import { groupCardRow, groupMore } from "./ui/classes.js";
import { Menu, MenuItem } from "./ui/Menu.js";

export function cardArchivePending(group: GroupSummaryV1): boolean {
  if (group.archived) return false;
  if (group.stopState === "handoff-pending" || group.stopState === "handoff-unresolved") return true;
  if (group.requirement?.roundState === "drafting" || group.requirement?.draftState === "drafting" || group.requirement?.blockedRun !== null && group.requirement?.blockedRun !== undefined) return true;
  return (group.counts?.running ?? 0) > 0;
}

/** A card's visible button and context gesture share one menu and one owner. */
export function GroupActionsMenu(props: {
  group: GroupSummaryV1;
  onOpen: () => void;
  onAction?: (groupId: string, verb: "archive-group" | "unarchive-group", repoId: string) => void;
  refusal?: ControlRefusal | null;
  /** Spec 2026-10-13-unmetered-usage-settlement §B.3: archive-run-active is resolved from the group's dispatch controls. */
  onOpenDispatch?: () => void;
  children: (onContextMenu: (event: MouseEvent<HTMLElement>) => void) => JSX.Element;
}): JSX.Element {
  const { t } = useTranslation();
  const ownerDescriptionId = useId();
  const [open, setOpen] = useState(false);
  const archivePending = cardArchivePending(props.group);
  const archiveBlocked = props.onAction === undefined || archivePending;
  const context = (event: MouseEvent<HTMLElement>): void => { event.preventDefault(); setOpen(true); };
  return <div className={`group-card-row ${groupCardRow}`}>
    {props.children(context)}
    <span id={ownerDescriptionId} className="sr-only">{t("control.groupMenu.owner", { groupId: props.group.groupId })}</span>
    <Menu open={open} onOpenChange={setOpen}
      trigger={<button type="button" className={`group-more ${groupMore}`} aria-label={t("control.groupMenu.more")} aria-describedby={ownerDescriptionId}>⋯</button>}>
      <MenuItem onSelect={props.onOpen}>{t("control.groupMenu.open")}</MenuItem>
      <MenuItem disabled={archiveBlocked} describedBy={archiveBlocked ? `archive-reason-${props.group.groupId}` : undefined}
        onSelect={() => props.onAction?.(props.group.groupId, props.group.archived ? "unarchive-group" : "archive-group", props.group.repoId)}>
        {t(props.group.archived ? "control.group.unarchive" : "control.group.archive")}
      </MenuItem>
      {archiveBlocked && <small id={`archive-reason-${props.group.groupId}`}>{t(archivePending ? "control.groupMenu.archivePending" : "control.groupMenu.archiveUnavailable")}</small>}
      <MenuItem onSelect={() => { void navigator.clipboard?.writeText(props.group.groupId); }}>{t("control.groupMenu.copyId")}</MenuItem>
    </Menu>
    {props.refusal && <RefusalNotice refusal={props.refusal} testId={`card-refusal-${props.group.groupId}`} />}
    {props.refusal?.code === "archive-run-active" && props.onOpenDispatch && <button type="button" className="ms-0" onClick={props.onOpenDispatch}>{t("control.groupMenu.openDispatch")}</button>}
  </div>;
}
