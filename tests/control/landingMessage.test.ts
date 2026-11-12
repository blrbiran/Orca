import { describe, expect, it } from "vitest";
import { LANDING_SUBJECT_MAX, landingSubject, landingTrailers } from "../../src/control/landingMessage.js";

/**
 * Tester issue #277: a landing commit's subject describes the work (the task's goal), not `orca: land <runId>`, which tells
 * a reader of the target's history nothing; the run id is not lost -- it moves to the `Orca-Run` trailer. One line, at
 * most 72 characters, cut with "..."; a reconciliation keeps its ` (reconciled with <task ids>)` inside the limit.
 */
describe("a landing commit's message (#277)", () => {
  it("is the goal on one line, cut to 72 characters with ...", () => {
    // mutation: subject stays `orca: land <runId>` -> red
    expect(landingSubject("Export a note\n  as CommonMark.", "land", "run-1")).toBe("Export a note as CommonMark.");
    const long = "x".repeat(100);
    const cut = landingSubject(long, "land", "run-1");
    // mutation: no cut -> red (100 > 72)
    expect(Array.from(cut).length).toBe(LANDING_SUBJECT_MAX);
    expect(cut).toBe(`${"x".repeat(69)}...`);
    // Code points, not UTF-16 units: a goal in Chinese is cut on a character, not inside one.
    expect(Array.from(landingSubject("写".repeat(80), "accept", "run-1")).length).toBe(LANDING_SUBJECT_MAX);
  });

  it("keeps a reconciliation's suffix whole inside the limit", () => {
    const suffix = " (reconciled with a, b)";
    const subject = landingSubject("y".repeat(100), "land", "run-2", suffix);
    // mutation: cut after appending the suffix (suffix lost) -> red
    expect(subject.endsWith(`...${suffix}`)).toBe(true);
    expect(Array.from(subject).length).toBe(LANDING_SUBJECT_MAX);
    expect(landingSubject("short goal", "land", "run-2", suffix)).toBe(`short goal${suffix}`);
  });

  it("falls back to the old subject when no goal can be read", () => {
    expect(landingSubject(null, "land", "run-3")).toBe("orca: land run-3");
    expect(landingSubject("  ", "accept", "run-3")).toBe("orca: accept run-3");
  });

  it("names the run in an Orca-Run trailer beside the group and the task", () => {
    // mutation: no Orca-Run line -> red
    expect(landingTrailers({ groupId: "g", taskId: "a", runId: "run-4" })).toBe("Orca-Group: g\nOrca-Task: a\nOrca-Run: run-4");
    expect(landingTrailers({ groupId: "g", taskId: null, runId: "run-4" })).toBe("Orca-Group: g\nOrca-Run: run-4");
  });
});
