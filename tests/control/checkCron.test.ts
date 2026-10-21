import { describe, expect, it } from "vitest";
import { cronSlotsBetween, cronTooFrequent, latestSlot, nextSlots, parseCron } from "../../src/control/checks/cron.js";
import { ControlError } from "../../src/control/errors.js";

/**
 * Checks spec 2026-10-22 §2.2 / §2.4: a scheduled check's `schedule{cron}` is a 5-field cron expression evaluated by
 * code (Rule 5) in the panel's usage-calendar zone. Slots are instants; missed slots collapse to the latest (so a panel
 * that was down three weeks runs one review, not three), and a cron firing more often than hourly is refused (a schedule
 * spends review budget unattended).
 */
const at = (iso: string): number => Date.parse(iso);

describe("cron", () => {
  it("names Mondays 09:00 in the given zone, not in UTC (a weekly review lands on the person's Monday morning)", () => {
    const spec = parseCron("0 9 * * 1");
    // 2026-10-22 is a Thursday; Asia/Shanghai is UTC+8 with no DST.
    expect(nextSlots(spec, "Asia/Shanghai", at("2026-10-22T00:00:00Z"), 3)).toEqual([
      at("2026-10-26T01:00:00Z"), at("2026-11-02T01:00:00Z"), at("2026-11-09T01:00:00Z"),
    ]);
  });

  it("keeps the local hour across a DST change (America/New_York leaves DST on 2026-11-01)", () => {
    expect(nextSlots(parseCron("0 9 * * *"), "America/New_York", at("2026-10-31T00:00:00Z"), 3)).toEqual([
      at("2026-10-31T13:00:00Z"), at("2026-11-01T14:00:00Z"), at("2026-11-02T14:00:00Z"),
    ]);
  });

  it("ORs day-of-month and day-of-week when both are restricted (vixie cron)", () => {
    // The 13th of the month or any Friday, at 00:00 UTC. 2026-11-06 and -13 are Fridays; -13 counts once.
    expect(nextSlots(parseCron("0 0 13 * 5"), "UTC", at("2026-11-01T00:00:00Z"), 4)).toEqual([
      at("2026-11-06T00:00:00Z"), at("2026-11-13T00:00:00Z"), at("2026-11-20T00:00:00Z"), at("2026-11-27T00:00:00Z"),
    ]);
    // Only day-of-month restricted ⇒ only the 13th.
    expect(nextSlots(parseCron("0 0 13 * *"), "UTC", at("2026-11-01T00:00:00Z"), 2)).toEqual([at("2026-11-13T00:00:00Z"), at("2026-12-13T00:00:00Z")]);
  });

  it("reads lists, ranges and steps; 7 is Sunday", () => {
    expect(nextSlots(parseCron("15,45 8-9/1 * * 0"), "UTC", at("2026-10-24T00:00:00Z"), 4)).toEqual([
      at("2026-10-25T08:15:00Z"), at("2026-10-25T08:45:00Z"), at("2026-10-25T09:15:00Z"), at("2026-10-25T09:45:00Z"),
    ]);
    expect(nextSlots(parseCron("0 12 * * 7"), "UTC", at("2026-10-24T00:00:00Z"), 1)).toEqual([at("2026-10-25T12:00:00Z")]);
  });

  it("collapses three missed weekly slots to the newest one", () => {
    const spec = parseCron("0 9 * * 1");
    const after = at("2026-10-26T01:00:00Z"); // the slot consumed last
    const now = at("2026-11-18T00:00:00Z"); // three Mondays later (11-02, 11-09, 11-16)
    expect(cronSlotsBetween(spec, "Asia/Shanghai", after, now)).toEqual([at("2026-11-02T01:00:00Z"), at("2026-11-09T01:00:00Z"), at("2026-11-16T01:00:00Z")]);
    expect(latestSlot(spec, "Asia/Shanghai", after, now)).toBe(at("2026-11-16T01:00:00Z"));
    // Several missed slots inside one day collapse to that day's newest too.
    expect(latestSlot(parseCron("5 * * * *"), "UTC", at("2026-11-01T00:00:00Z"), at("2026-11-01T03:30:00Z"))).toBe(at("2026-11-01T03:05:00Z"));
    // No slot after the consumed one yet ⇒ nothing due.
    expect(latestSlot(spec, "Asia/Shanghai", after, at("2026-11-01T00:00:00Z"))).toBeNull();
    // The bound is exclusive below, inclusive above.
    expect(latestSlot(spec, "Asia/Shanghai", at("2026-11-09T01:00:00Z"), at("2026-11-09T01:00:00Z"))).toBeNull();
    expect(latestSlot(spec, "Asia/Shanghai", at("2026-11-09T00:59:00Z"), at("2026-11-09T01:00:00Z"))).toBe(at("2026-11-09T01:00:00Z"));
  });

  it("bounds a slot listing at 10,000 slots", () => {
    expect(cronSlotsBetween(parseCron("0 * * * *"), "UTC", at("2026-01-01T00:00:00Z"), at("2028-01-01T00:00:00Z"))).toHaveLength(10_000);
  });

  it("calls a cron with more than one minute value too frequent; one minute value fires at most hourly", () => {
    expect(cronTooFrequent(parseCron("*/30 * * * *"))).toBe(true);
    expect(cronTooFrequent(parseCron("0,1 9 * * *"))).toBe(true);
    expect(cronTooFrequent(parseCron("* 9 * * *"))).toBe(true);
    expect(cronTooFrequent(parseCron("5 * * * *"))).toBe(false);
    expect(cronTooFrequent(parseCron("0 9 * * 1"))).toBe(false);
  });

  it.each(["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "a * * * *", "*/0 * * * *", "5-1 * * * *", "1,,2 * * * *"])(
    "refuses %j as control-argument-invalid", (expr) => {
      let caught: unknown;
      try { parseCron(expr); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ControlError);
      expect((caught as ControlError).code).toBe("control-argument-invalid");
    },
  );
});
