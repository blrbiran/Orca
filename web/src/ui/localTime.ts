import { currentLanguage } from "../i18n.js";

/** Format an observed instant for the reader; a missing or invalid instant is not a date. */
export function localDateTime(at: string | number | null | undefined): string {
  if (at === null || at === undefined) return "—";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  const offset = -date.getTimezoneOffset(), minutes = Math.abs(offset);
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0"), remainder = String(minutes % 60).padStart(2, "0");
  return `${date.toLocaleString(currentLanguage())} (UTC${offset >= 0 ? "+" : "-"}${hours}:${remainder})`;
}
