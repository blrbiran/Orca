/**
 * Ruling R1 (#219, 2026-11-10; extended to the group regions in tester follow-up G): only the selected region is rendered.
 * Every other tab panel is an empty, hidden marker (its id stays, so each tab's aria-controls names a real element).
 * A region's unsent input lives in the group view's region draft store (regionDraft.ts), so a switch keeps it; a region
 * with side effects (Live, Results, a run transcript) asks nothing while it is not rendered.
 */
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DETAIL_REGIONS, type DetailRegion } from "./detailRegion.js";
import { overviewRegionId } from "./overviewNavigation.js";
import { regionTabRow, tabButton } from "./ui/classes.js";

/**
 * What a tab says before it is opened: how many things the Problems region lists, and how much work Live shows running.
 * The tab's name stays its label (aria-labelledby) and the hint is its description, so finding a tab by name, and the
 * panel named by that label, are unchanged. Colour only through data-tone (DESIGN.md): needs you = warn, running = info.
 */
export type RegionHints = { problem?: number; live?: number };
const HINT_TONE = { problem: "warn", live: "info" } as const;

export function GroupDetailRegions(props: { groupId: string; selected: DetailRegion; onSelect: (region: DetailRegion) => void; regions: Record<DetailRegion, ReactNode>; hints?: RegionHints }): JSX.Element {
 const { t } = useTranslation();
 const hintOf = (region: DetailRegion): { count: number; tone: "warn" | "info"; words: string } | null => {
  if (region !== "problem" && region !== "live") return null;
  const count = props.hints?.[region] ?? 0;
  return count > 0 ? { count, tone: HINT_TONE[region], words: t(region === "problem" ? "detail.hint.problem" : "detail.hint.live", { n: count }) } : null;
 };
 return <>
  <div role="tablist" aria-label={t("detail.regions")} className={regionTabRow}>
   {DETAIL_REGIONS.map(region => {
    const id = `${overviewRegionId("group", props.groupId, region)}-tab`;
    const hint = hintOf(region);
    return <button key={region} type="button" role="tab" className={tabButton} id={id} aria-labelledby={`${id}-label`} aria-describedby={hint === null ? undefined : `${id}-hint`} aria-controls={overviewRegionId("group", props.groupId, region)} aria-selected={props.selected === region} tabIndex={props.selected === region ? 0 : -1} onKeyDown={event => {
     const index = DETAIL_REGIONS.indexOf(region);
     const next = event.key === "Home" ? 0 : event.key === "End" ? DETAIL_REGIONS.length - 1 : event.key === "ArrowRight" ? (index + 1) % DETAIL_REGIONS.length : event.key === "ArrowLeft" ? (index + DETAIL_REGIONS.length - 1) % DETAIL_REGIONS.length : null;
     if (next === null) return;
     event.preventDefault(); const target = DETAIL_REGIONS[next]!; props.onSelect(target);
     document.getElementById(`${overviewRegionId("group", props.groupId, target)}-tab`)?.focus();
    }} onClick={() => props.onSelect(region)}><span id={`${id}-label`}>{t(`detail.${region}`)}</span>
     {hint !== null && <><span className="badge ms-1.5 num" data-tone={hint.tone} data-tab-hint={region} aria-hidden="true">{hint.count}</span><span id={`${id}-hint`} className="sr-only">{hint.words}</span></>}
    </button>;
   })}
  </div>
  {DETAIL_REGIONS.map(region => <div key={region} role="tabpanel" aria-labelledby={`${overviewRegionId("group", props.groupId, region)}-tab-label`} id={overviewRegionId("group", props.groupId, region)} tabIndex={-1} data-overview-region={region} hidden={props.selected !== region}>{props.selected === region ? props.regions[region] : null}</div>)}
 </>;
}
