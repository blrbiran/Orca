import type { TFunction } from "i18next";

/** Final review (E8 deferred minor): minutes up to 119, then whole hours up to 47, then whole days ("updated 5 min ago"). */
export function updatedText(t: TFunction, minutes: number): string {
  if (minutes === 0) return t("control.groupCard.updatedNow");
  if (minutes < 120) return t("control.groupCard.updated", { minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t("control.groupCard.updatedHours", { hours }) : t("control.groupCard.updatedDays", { days: Math.floor(hours / 24) });
}

/** Whole minutes between `at` and `now`, never negative (a clock a little behind the server's reads "just now"). */
export const minutesSince = (now: number, at: number): number => Math.max(0, Math.floor((now - at) / 60_000));
