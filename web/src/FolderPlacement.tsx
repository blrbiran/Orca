/**
 * Dir-requirements spec §9.3: a dir group's integration region shows its folder placement -- what stopped it, the
 * paths involved and the three answers a person can give -- in place of the scheme picker. Only an owner may answer
 * (§9.2, §12): the buttons follow the same `mayHumanOnly` gate as the other human-only actions.
 */
import { useContext } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupViewV1 } from "./controlTypes.js";

/** §9.3: the body carries the first 50 of each list; the total says how many the server kept. */
const SHOWN = 50;
const REASONS = ["symlink", "type-change", "case-clash"] as const;

export function FolderPlacementBlock(props: { view: GroupViewV1; onCommand?: (action: ControlAction) => void; archived?: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const placement = props.view.summary.placement;
  if (placement === undefined) return null;
  const groupId = props.view.summary.groupId;
  const mayAct = mayHumanOnly(useContext(AccountContext)) && props.onCommand !== undefined && props.archived !== true;
  const send = (action: "take-folder" | "recheck" | "withhold"): void =>
    props.onCommand?.({ verb: "resolve-folder-change", groupId, expectedRevision: props.view.summary.commandRevision, payload: { action } });
  const more = (total: number): JSX.Element | null => (total > SHOWN ? <li>{t("control.placement.more", { n: total - SHOWN })}</li> : null);
  const reason = (value: string): string => (REASONS.includes(value as (typeof REASONS)[number]) ? t(`control.placement.reason.${value as (typeof REASONS)[number]}`) : value);
  const withholdable = placement.changedTotal + placement.unwritableTotal > 0;
  return (
    <section aria-label={t("control.placement.region")}>
      <h3>{t("control.placement.region")}</h3>
      <p>{t(`control.placement.state.${placement.state}`)}</p>
      {placement.detail !== null && <p role="note">{placement.detail}</p>}
      {placement.changed.length > 0 && (
        <>
          <h4>{t("control.placement.changed")}</h4>
          <ul>{placement.changed.map((path) => <li key={path}><code>{path}</code></li>)}{more(placement.changedTotal)}</ul>
        </>
      )}
      {placement.unwritable.length > 0 && (
        <>
          <h4>{t("control.placement.unwritable")}</h4>
          <ul>{placement.unwritable.map((entry) => <li key={entry.path}><code>{entry.path}</code> · {reason(entry.reason)}</li>)}{more(placement.unwritableTotal)}</ul>
        </>
      )}
      {placement.withheld.length > 0 && (
        <>
          <h4>{t("control.placement.withheld")}</h4>
          <ul>{placement.withheld.map((entry) => <li key={entry.path}><code>{entry.path}</code></li>)}</ul>
        </>
      )}
      {mayAct && (
        <p>
          {placement.state === "folder-changed" && <button type="button" onClick={() => send("take-folder")}>{t("control.placement.take")}</button>}
          {" "}<button type="button" onClick={() => send("recheck")}>{t("control.placement.recheck")}</button>
          {withholdable && <>{" "}<button type="button" onClick={() => send("withhold")}>{t("control.placement.withhold")}</button></>}
        </p>
      )}
    </section>
  );
}
