/** All owner panels remain mounted: navigation never throws away unfinished input. */
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DETAIL_REGIONS, type DetailRegion } from "./detailRegion.js";
import { overviewRegionId } from "./overviewNavigation.js";
export function GroupDetailRegions(props: { groupId: string; selected: DetailRegion; onSelect: (region: DetailRegion) => void; regions: Record<DetailRegion, ReactNode> }): JSX.Element {
 const { t } = useTranslation();
 return <>
  <div role="tablist" aria-label={t("detail.regions")} className="detail-region-tabs">
   {DETAIL_REGIONS.map(region => <button key={region} type="button" role="tab" id={`${overviewRegionId("group", props.groupId, region)}-tab`} aria-controls={overviewRegionId("group", props.groupId, region)} aria-selected={props.selected === region} onClick={() => props.onSelect(region)}>{t(`detail.${region}`)}</button>)}
  </div>
  {DETAIL_REGIONS.map(region => <div key={region} role="tabpanel" aria-labelledby={`${overviewRegionId("group", props.groupId, region)}-tab`} id={overviewRegionId("group", props.groupId, region)} tabIndex={-1} data-overview-region={region} hidden={props.selected !== region}>{props.regions[region]}</div>)}
 </>;
}
