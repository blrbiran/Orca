import { describe, expect, it } from "vitest";
import { reportedDecisionsOf } from "../../src/control/reportedDecisions.js";

describe("reportedDecisionsOf", () => {
  it("reads an absent decisions field as not reported", () => {
    expect(reportedDecisionsOf({ events: [] })).toEqual({ kind: "absent" });
    expect(reportedDecisionsOf(null)).toEqual({ kind: "absent" });
  });
  it("passes an array through unchanged, empty included", () => {
    expect(reportedDecisionsOf({ decisions: [] })).toEqual({ kind: "array", entries: [] });
    const e = [{ question: "q" }];
    const read = reportedDecisionsOf({ decisions: e });
    expect(read.kind === "array" && read.entries).toBe(e);
  });
  it("names a non-array decisions value as malformed", () => {
    expect(reportedDecisionsOf({ decisions: { question: "q" } })).toEqual({ kind: "malformed", value: { question: "q" } });
  });
});
