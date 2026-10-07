import { describe, expect, it } from "vitest";
import { periodBounds } from "../../src/control/usageCalendar.js";

const iso = (ms: number) => new Date(ms).toISOString();
describe("calendar periods (spec §5.2)", () => {
  it("computes weeks across a DST change in New York with Monday weeks", () => {
    const ny = { timeZone: "America/New_York", weekStart: 1 };
    const spring = periodBounds("week", Date.parse("2026-03-08T12:00:00Z"), ny);
    expect([iso(spring.from), iso(spring.to)]).toEqual(["2026-03-02T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
    expect(spring.to - spring.from).toBe(7 * 86_400_000 - 3_600_000);
    const after = periodBounds("week", Date.parse("2026-03-10T12:00:00Z"), ny);
    expect([iso(after.from), iso(after.to)]).toEqual(["2026-03-09T04:00:00.000Z", "2026-03-16T04:00:00.000Z"]);
    const month = periodBounds("month", Date.parse("2026-03-31T23:00:00Z"), ny);
    expect([iso(month.from), iso(month.to)]).toEqual(["2026-03-01T05:00:00.000Z", "2026-04-01T04:00:00.000Z"]);
    const fall = periodBounds("day", Date.parse("2026-11-01T12:00:00Z"), ny);
    expect(fall.to - fall.from).toBe(25 * 3_600_000);
  });

  it("honors weekStart and crosses a year end in Tokyo", () => {
    const tokyo = { timeZone: "Asia/Tokyo", weekStart: 7 };
    const week = periodBounds("week", Date.parse("2026-12-31T03:00:00Z"), tokyo);
    expect([iso(week.from), iso(week.to)]).toEqual(["2026-12-26T15:00:00.000Z", "2027-01-02T15:00:00.000Z"]);
    const month = periodBounds("month", Date.parse("2026-12-31T20:00:00Z"), tokyo); // already 2027-01-01 05:00 in Tokyo
    expect([iso(month.from), iso(month.to)]).toEqual(["2026-12-31T15:00:00.000Z", "2027-01-31T15:00:00.000Z"]);
    expect(periodBounds("week", Date.parse("2026-12-31T03:00:00Z"), { ...tokyo, weekStart: 1 }).from).toBe(Date.parse("2026-12-27T15:00:00Z"));
  });

  it("finds local midnight when the zone's offset changes between UTC midnight and local midnight (Sydney, DST starts 2026-10-04)", () => {
    // At UTC midnight of that date Sydney is already on +11, but its local midnight is still +10: one offset pass is wrong by an hour.
    const sydney = { timeZone: "Australia/Sydney", weekStart: 1 };
    const day = periodBounds("day", Date.parse("2026-10-04T05:00:00Z"), sydney);
    expect([iso(day.from), iso(day.to)]).toEqual(["2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z"]);
  });
});
