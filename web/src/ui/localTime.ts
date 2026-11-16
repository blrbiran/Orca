import { currentLanguage } from "../i18n.js";

/** Format an observed instant for the reader; a missing or invalid instant is not a date. */
export function localDateTime(at: string | number | null | undefined): string {
  if (at === null || at === undefined) return "—";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(currentLanguage());
}
