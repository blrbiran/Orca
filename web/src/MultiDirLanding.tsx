/**
 * Multi-directory projects spec §9.4, §12: a multi group's integration region -- each directory's delivery and landing
 * state, both answers to a stopped landing, and a folder member's answers -- in place of the scheme picker. Only a
 * person may act (§12): the buttons follow the same `mayHumanOnly` gate as the other human-only actions.
 */
import { useContext } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupMultiDirV1, GroupViewV1 } from "./controlTypes.js";

/** §9.7: the landing states the two answers apply to. */
const PENDING = new Set(["partial", "blocked", "folder-changed", "folder-unwritable"]);
/** DIR §9.2, §12: the placement states a folder answer waits on; the same three actions as the single-folder region. */
const STOPPED = new Set(["folder-changed", "folder-unwritable", "folder-missing"]);

export function MultiDirLandingBlock(props: { view: GroupViewV1; onCommand?: (action: ControlAction) => void; archived?: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const humanOnly = mayHumanOnly(useContext(AccountContext));
  const multi = props.view.summary.multiDir;
  if (multi === undefined) return null;
  const groupId = props.view.summary.groupId;
  const mayAct = humanOnly && props.onCommand !== undefined && props.archived !== true;
  const landing = multi.landing;
  const sendLanding = (action: "retry-rest" | "mark-resolved"): void =>
    props.onCommand?.({ verb: "multi-dir-landing", groupId, expectedRevision: props.view.summary.commandRevision, payload: { action } });
  const sendFolder = (dir: string, action: "take-folder" | "recheck" | "withhold"): void =>
    props.onCommand?.({ verb: "resolve-folder-change", groupId, expectedRevision: props.view.summary.commandRevision, payload: { dir, action } });
  const reason = reasonText(multi, t);
  return (
    <section aria-label={t("control.multiDir.region")} data-multi-dir={multi.project}>
      <h3>{t("control.multiDir.region")}</h3>
      <p data-multi-dir-state={landing?.state ?? "idle"}>{t(`control.multiDir.state.${landing?.state ?? "idle"}`)}</p>
      {reason !== null && <p role="note">{reason}</p>}
      <ul>
        {multi.dirs.map((dir) => {
          const placement = dir.placement;
          const stopped = placement !== undefined && STOPPED.has(placement.state);
          const withholdable = placement !== undefined && placement.changedTotal + placement.unwritableTotal > 0;
          return (
            <li key={dir.key} data-multi-dir-key={dir.key} data-multi-dir-landed={dir.failed ? "failed" : dir.landed ? "landed" : "pending"}>
              <strong>{dir.key}</strong>
              {" · "}{dir.kind === "dir" ? t("control.multiDir.kind.dir") : t("control.multiDir.kind.repo")}
              {dir.primary && <>{" · "}{t("control.multiDir.primary")}</>}
              {" · "}{t("control.multiDir.delivery", { delivery: t(`control.multiDir.deliveryName.${dir.delivery ?? "unknown"}`) })}
              {" · "}{dir.failed ? t("control.multiDir.dirState.failed") : dir.landed ? t("control.multiDir.dirState.landed") : t("control.multiDir.dirState.pending")}
              {placement !== undefined && placement.detail !== null && <>{" · "}{placement.detail}</>}
              {stopped && <>{" · "}{t(`control.placement.state.${placement.state}`)}</>}
              {mayAct && stopped && (
                <>
                  {" "}
                  {placement.state === "folder-changed" && <button type="button" onClick={() => sendFolder(dir.key, "take-folder")}>{t("control.placement.take")}</button>}
                  {" "}<button type="button" onClick={() => sendFolder(dir.key, "recheck")}>{t("control.placement.recheck")}</button>
                  {withholdable && (
                    <>{" "}<button type="button" onClick={() => sendFolder(dir.key, "withhold")}>{t("control.placement.withhold")}</button></>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {multi.landing !== null && multi.landing.landedKeys.length > 0 && (
        <p>{t("control.multiDir.updated", { keys: multi.landing.landedKeys.join(", ") })}</p>
      )}
      {mayAct && landing !== null && PENDING.has(landing.state) && (
        <p>
          <button type="button" onClick={() => sendLanding("retry-rest")}>{t("control.multiDir.retryRest")}</button>
          {" "}<button type="button" onClick={() => sendLanding("mark-resolved")}>{t("control.multiDir.markResolved")}</button>
        </p>
      )}
    </section>
  );
}

/** §13's landing reasons in the reader's language; a reason this panel has no words for is shown as sent. */
function reasonText(multi: GroupMultiDirV1, t: TFunction): string | null {
  const landing = multi.landing;
  if (landing === null || landing.reason === null) return null;
  const key = landing.failedKey ?? "";
  const cut = landing.reason.indexOf(":");
  const prefix = cut === -1 ? landing.reason : landing.reason.slice(0, cut);
  const detail = landing.detail ?? (cut === -1 ? "" : landing.reason.slice(cut + 1));
  switch (prefix) {
    case "multi-dir-precheck-conflict": return t("control.multiDir.reason.conflict", { key, paths: detail });
    case "multi-dir-precheck-check-failed": return t("control.multiDir.reason.checkFailed", { key, command: detail });
    case "multi-dir-target-moved": return t("control.multiDir.reason.targetMoved", { key });
    case "multi-dir-target-missing": return t("control.multiDir.reason.targetMissing", { key });
    case "dir-folder-changed": return t("control.multiDir.reason.folderChanged", { key });
    case "dir-folder-unwritable": return t("control.multiDir.reason.folderUnwritable", { key });
    case "multi-dir-precheck-failed": return t("control.multiDir.reason.precheckFailed", { detail });
    default: return landing.reason;
  }
}
