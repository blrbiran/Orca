import { ControlError } from "../errors.js";

/**
 * Checks spec 2026-10-22 §2.2 / §2.4 / §10 ("a small 5-field parser with tests" — no cron package is in the tree): the
 * `schedule{cron}` condition of a scheduled check. Fields: minute hour day-of-month month day-of-week; each `*`, a
 * number, `a-b`, `*`/`a-b` with `/step`, or a comma list of those. Day-of-week 0–7 (0 and 7 are Sunday). As vixie cron:
 * when both day fields are restricted (do not start with `*`) a day matches either; otherwise both. Slots are evaluated
 * in a time zone's wall clock: a wall time that does not exist (a DST gap) is skipped; an ambiguous one (a DST overlap)
 * fires once, at the instant the zone's offset gives first.
 */
export interface CronSpec {
  minutes: number[]; hours: number[]; doms: Set<number>; months: Set<number>; dows: Set<number>;
  domRestricted: boolean; dowRestricted: boolean;
}

const invalid = (expr: string, why: string): ControlError => new ControlError("control-argument-invalid", `cron ${JSON.stringify(expr)}: ${why}`);

function field(expr: string, text: string, name: string, lo: number, hi: number): number[] {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (m === null) throw invalid(expr, `${name} field ${JSON.stringify(text)} unreadable`);
    const from = m[1] === "*" ? lo : Number(m[2]);
    const to = m[1] === "*" ? hi : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? hi : from;
    const step = m[4] === undefined ? 1 : Number(m[4]);
    if (from < lo || to > hi || from > to) throw invalid(expr, `${name} ${part} outside ${lo}-${hi}`);
    if (step < 1) throw invalid(expr, `${name} step must be >= 1`);
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === "") throw invalid(expr, "needs 5 fields: minute hour day-of-month month day-of-week");
  const [mi, h, dom, mon, dow] = parts as [string, string, string, string, string];
  return {
    minutes: field(expr, mi, "minute", 0, 59),
    hours: field(expr, h, "hour", 0, 23),
    doms: new Set(field(expr, dom, "day-of-month", 1, 31)),
    months: new Set(field(expr, mon, "month", 1, 12)),
    dows: new Set(field(expr, dow, "day-of-week", 0, 7).map((d) => d % 7)),
    domRestricted: !dom.startsWith("*"),
    dowRestricted: !dow.startsWith("*"),
  };
}

/** More than one minute value can fire twice inside one hour; one minute value fires at most once an hour. */
export const cronTooFrequent = (spec: CronSpec): boolean => spec.minutes.length > 1;

const formatters = new Map<string, Intl.DateTimeFormat>();
function wall(t: number, tz: string): { y: number; m: number; d: number; h: number; mi: number } {
  let format = formatters.get(tz);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, format);
  }
  const p = Object.fromEntries(format.formatToParts(new Date(t)).map((part) => [part.type, part.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}
/** The zone's offset at instant t (wall clock read as UTC, minus t), to the minute. */
const offsetAt = (t: number, tz: string): number => { const w = wall(t, tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - (t - (t % 60_000)); };
/** The instant of a wall time in `tz`, or null when that wall time does not exist there (a DST gap). */
function instantOf(y: number, m: number, d: number, h: number, mi: number, tz: string): number | null {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  const t = asUtc - offsetAt(asUtc - offsetAt(asUtc, tz), tz);
  const w = wall(t, tz);
  return w.y === y && w.m === m && w.d === d && w.h === h && w.mi === mi ? t : null;
}

const DAY_CAP = 3000; // ~8 years of days: enough for a "29 Feb on a Monday" cron to be found or given up on.
type Day = { y: number; m: number; d: number };
const shift = (day: Day, by: number): Day => { const t = new Date(Date.UTC(day.y, day.m - 1, day.d + by)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

function dayMatches(spec: CronSpec, day: Day): boolean {
  if (!spec.months.has(day.m)) return false;
  const dom = spec.doms.has(day.d);
  const dow = spec.dows.has(new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay());
  return spec.domRestricted && spec.dowRestricted ? dom || dow : dom && dow;
}
/** The day's slots, ascending. */
function slotsOn(spec: CronSpec, day: Day, tz: string): number[] {
  if (!dayMatches(spec, day)) return [];
  const out: number[] = [];
  for (const h of spec.hours) for (const mi of spec.minutes) {
    const t = instantOf(day.y, day.m, day.d, h, mi, tz);
    if (t !== null) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

export const CRON_SLOT_LIMIT = 10_000;

/** Slots s with afterExclusive < s <= toInclusive, ascending, at most CRON_SLOT_LIMIT. */
export function cronSlotsBetween(spec: CronSpec, tz: string, afterExclusive: number, toInclusive: number): number[] {
  const out: number[] = [];
  const last = wall(toInclusive, tz);
  // A day starts one wall day before the bound's local date: an instant's local date can trail its UTC date.
  for (let day = shift(wall(afterExclusive, tz), -1), n = 0; n < DAY_CAP + 2; day = shift(day, 1), n += 1) {
    for (const s of slotsOn(spec, day, tz)) {
      if (s > afterExclusive && s <= toInclusive) { out.push(s); if (out.length === CRON_SLOT_LIMIT) return out; }
    }
    if (day.y > last.y || (day.y === last.y && (day.m > last.m || (day.m === last.m && day.d > last.d)))) break;
  }
  return out;
}

/** The newest slot s with afterExclusive < s <= now, or null (missed slots collapse to this one). */
export function latestSlot(spec: CronSpec, tz: string, afterExclusive: number, now: number): number | null {
  for (let day = shift(wall(now, tz), 1), n = 0; n < DAY_CAP; day = shift(day, -1), n += 1) {
    const slots = slotsOn(spec, day, tz).filter((s) => s > afterExclusive && s <= now);
    if (slots.length > 0) return slots[slots.length - 1]!;
    const dayStart = instantOf(day.y, day.m, day.d, 0, 0, tz) ?? Date.UTC(day.y, day.m - 1, day.d);
    if (dayStart <= afterExclusive - 36 * 3_600_000) return null;
  }
  return null;
}

/** The next n slots after `from` (exclusive), ascending. */
export function nextSlots(spec: CronSpec, tz: string, from: number, n: number): number[] {
  const out: number[] = [];
  for (let day = shift(wall(from, tz), -1), k = 0; k < DAY_CAP && out.length < n; day = shift(day, 1), k += 1) {
    for (const s of slotsOn(spec, day, tz)) if (s > from && out.length < n) out.push(s);
  }
  return out;
}
