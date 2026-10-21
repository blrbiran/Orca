import { useEffect, useId, useRef, useState, type JSX, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { GroupSummaryV1 } from "./controlTypes.js";
import type { ControlRefusal } from "./controlState.js";
import { RefusalNotice } from "./RefusalNotice.js";

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
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (): void => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open]);
  // Issue #81: an open menu closes on a press anywhere outside it (its own button toggles it) and on Escape wherever focus is.
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event): void => {
      const target = event.target as Node | null;
      if (target !== null && (menu.current?.contains(target) || trigger.current?.contains(target))) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const context = (event: MouseEvent<HTMLElement>): void => { event.preventDefault(); setOpen(true); };
  const act = (action: () => void): void => { action(); close(); };
  const moveFocus = (key: string): void => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = key === "Home" ? 0 : key === "End" ? items.length - 1
      : key === "ArrowDown" ? (current + 1) % items.length
      : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  return <div className="group-card-row">
    {props.children(context)}
    <span id={ownerDescriptionId} className="sr-only">{t("control.groupMenu.owner", { groupId: props.group.groupId })}</span>
    <button ref={trigger} type="button" className="group-more" aria-label={t("control.groupMenu.more")}
      aria-describedby={ownerDescriptionId} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>⋯</button>
    {open && <div ref={menu} role="menu" className="group-actions-menu" aria-label={t("control.groupMenu.more")}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); moveFocus(event.key); }
      }}>
      <button type="button" role="menuitem" onClick={() => act(props.onOpen)}>{t("control.groupMenu.open")}</button>
      <button type="button" role="menuitem" disabled={props.onAction === undefined || archivePending}
        aria-describedby={props.onAction === undefined || archivePending ? `archive-reason-${props.group.groupId}` : undefined}
        onClick={() => act(() => props.onAction?.(props.group.groupId, props.group.archived ? "unarchive-group" : "archive-group", props.group.repoId))}>
        {t(props.group.archived ? "control.group.unarchive" : "control.group.archive")}
      </button>
      {(props.onAction === undefined || archivePending) && <small id={`archive-reason-${props.group.groupId}`}>{t(archivePending ? "control.groupMenu.archivePending" : "control.groupMenu.archiveUnavailable")}</small>}
      <button type="button" role="menuitem" onClick={() => act(() => { void navigator.clipboard?.writeText(props.group.groupId); })}>
        {t("control.groupMenu.copyId")}
      </button>
    </div>}
    {props.refusal && <RefusalNotice refusal={props.refusal} testId={`card-refusal-${props.group.groupId}`} />}
    {props.refusal?.code === "archive-run-active" && props.onOpenDispatch && <button type="button" onClick={props.onOpenDispatch}>{t("control.groupMenu.openDispatch")}</button>}
  </div>;
}
