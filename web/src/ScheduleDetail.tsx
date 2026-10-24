/**
 * Scheduled flows and groups spec 2026-10-24 §13.3: one schedule's fires, newest first (GET
 * /api/control/schedules/:id/fires). The server names the outcome and the reason; this module only words the row.
 * A failed read is a quiet line, never an alert: it refuses nothing the person did.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { fetchScheduleFires } from "./controlApi.js";
import type { ScheduleFiresViewV1, ScheduleFireViewV1 } from "./controlTypes.js";
import { formatRoute } from "./sections.js";

const slotText = (at: number): string => new Date(at).toLocaleString();
const durationText = (ms: number, t: TFunction): string => (ms >= 60_000 ? t("schedules.duration.minutes", { count: Math.round(ms / 60_000) }) : t("schedules.duration.seconds", { count: Math.round(ms / 1000) }));
/** §13.3: the hash route to this fire's run (the board) or its group (the tasks list); null when neither. */
const fireHref = (fire: ScheduleFireViewV1): string | null =>
  fire.flowRunId !== null
    ? formatRoute({ kind: "flow-run", section: "board", flowRunId: fire.flowRunId })
    : fire.groupId !== null
      ? formatRoute({ kind: "group", section: "tasks", groupId: fire.groupId, region: null, taskId: null })
      : null;

function FireRow(props: { fire: ScheduleFireViewV1; scheduleId: string }): JSX.Element {
  const { t } = useTranslation();
  const { fire } = props;
  const target = fire.flowRunId ?? fire.groupId;
  const href = fireHref(fire);
  return (
    <li data-testid={`schedule-fire-${fire.seq}`}>
      <p>{t("settings.schedules.fire.line", { slot: slotText(fire.slot), at: slotText(fire.at), outcome: t(`settings.schedules.fire.outcome.${fire.outcome}`) })}</p>
      {fire.lateMs !== null && fire.lateMs > 0 && <p>{t("schedules.lastFire.late", { duration: durationText(fire.lateMs, t), missed: fire.missed })}</p>}
      {fire.missed > 0 && <p>{t("settings.schedules.fire.missed", { count: fire.missed })}</p>}
      {fire.reason !== null && <p>{t("settings.schedules.fire.reason", { reason: fire.reason })}</p>}
      {target !== null && <p>{t("settings.schedules.fire.target", { id: target })}</p>}
      {href !== null && target !== null && (
        <p><a data-testid={`schedule-fire-link-${fire.seq}`} href={href}>{t("settings.schedules.openTarget", { id: target })}</a></p>
      )}
      <p>{fire.by === "orca-auto" ? t("schedules.creditedTo", { id: props.scheduleId, person: fire.creditedTo ?? fire.by }) : `${fire.by} ${fire.via}`}</p>
      {fire.creditedTo !== null && fire.by !== "orca-auto" && <p>{t("settings.schedules.fire.credited", { person: fire.creditedTo })}</p>}
    </li>
  );
}

export function ScheduleDetail(props: { scheduleId: string }): JSX.Element {
  const { t } = useTranslation();
  const [view, setView] = useState<ScheduleFiresViewV1 | null>(null);
  const [unread, setUnread] = useState(false);
  // An answer for a previous schedule is dropped (the section is also keyed by the id).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const next = await fetchScheduleFires(props.scheduleId);
        if (!Array.isArray(next?.fires)) throw new TypeError("schedule-fires-shape");
        if (live) { setView(next); setUnread(false); }
      } catch { if (live) setUnread(true); }
    })();
    return () => { live = false; };
  }, [props.scheduleId]);
  return (
    <section aria-label={t("settings.schedules.fires")}>
      <h4>{t("settings.schedules.fires")}</h4>
      {unread && <p data-testid="schedule-fires-unread">{t("settings.schedules.unread")}</p>}
      {view !== null && (view.fires.length === 0 ? <p>{t("settings.schedules.fire.none")}</p> : (
        <ul>{view.fires.map((fire) => <FireRow key={fire.seq} fire={fire} scheduleId={props.scheduleId} />)}</ul>
      ))}
    </section>
  );
}
