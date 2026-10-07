import type { ControlStore } from "./store.js";

export interface UsageCalendar { timeZone: string; weekStart: number }
export const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function isTimeZone(name: string): boolean { try { new Intl.DateTimeFormat("en-US", { timeZone: name }); return true; } catch { return false; } }
/** The zone's canonical name ("asia/tokyo" → "Asia/Tokyo"), so one zone is stored, compared and shown one way. */
export const canonicalTimeZone = (name: string): string => new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;

export function readUsageCalendar(store: ControlStore): UsageCalendar {
  const row = store.db.prepare("SELECT time_zone,week_start FROM usage_calendar WHERE singleton=1").get();
  return row ? { timeZone: String(row.time_zone), weekStart: Number(row.week_start) } : { timeZone: hostTimeZone(), weekStart: 1 };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function wall(at: number, timeZone: string) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p = Object.fromEntries(format.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second), weekday: WEEKDAYS.indexOf(String(p.weekday)) + 1 };
}
/** The zone's offset at instant t: its wall clock read as UTC, minus t (whole seconds). */
const offsetAt = (t: number, tz: string): number => { const w = wall(t, tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - (t - (t % 1000)); };
/** Spec §5.2: local midnight of a calendar date, found through Intl (two passes settle a DST edge), never by adding 86,400,000. */
function localMidnight(y: number, m: number, d: number, tz: string): number {
  const asUtc = Date.UTC(y, m - 1, d);
  const first = asUtc - offsetAt(asUtc, tz);
  return asUtc - offsetAt(first, tz);
}
const civil = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

export function periodBounds(period: "day" | "week" | "month", at: number, calendar: UsageCalendar): { from: number; to: number } {
  const w = wall(at, calendar.timeZone), tz = calendar.timeZone;
  if (period === "month") { const next = civil(w.y, w.m + 1, 1); return { from: localMidnight(w.y, w.m, 1, tz), to: localMidnight(next.y, next.m, 1, tz) }; }
  const back = period === "week" ? (w.weekday - calendar.weekStart + 7) % 7 : 0;
  const start = civil(w.y, w.m, w.d - back), end = civil(start.y, start.m, start.d + (period === "week" ? 7 : 1));
  return { from: localMidnight(start.y, start.m, start.d, tz), to: localMidnight(end.y, end.m, end.d, tz) };
}
