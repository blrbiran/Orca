import { describe, expect, it } from "vitest";
import { reportedDebugOf, reportedDecisionsOf } from "../../src/control/reportedDecisions.js";

describe("reportedDecisionsOf", () => {
  it("reads an absent decisions field as not reported", () => {
    expect(reportedDecisionsOf({ events: [] })).toEqual({ kind: "absent" });
    expect(reportedDecisionsOf(null)).toEqual({ kind: "absent" });
    // Final review T1: a present-but-undefined field is not reported (mutation: drop `value === undefined` -> malformed,
    // red), and a result that is not an object reports nothing.
    expect(reportedDecisionsOf({ decisions: undefined })).toEqual({ kind: "absent" });
    expect(reportedDecisionsOf("x")).toEqual({ kind: "absent" });
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

// Debug task plan Task 8: the `debug` sibling is read from the same place, the result's top level, never from inside `decisions`.
describe("reportedDebugOf", () => {
  it("reportedDebugOf reads only the top-level debug key", () => {
    expect(reportedDebugOf({ events: [] })).toEqual({ kind: "absent" });
    expect(reportedDebugOf(null)).toEqual({ kind: "absent" });
    expect(reportedDebugOf({ decisions: { debug: { reproCommand: "c" } } })).toEqual({ kind: "absent" });
    expect(reportedDebugOf({ debug: { reproTests: ["t.test.ts"], reproCommand: "c", choseInstead: "x" } }))
      .toEqual({ kind: "object", value: { reproTests: ["t.test.ts"], reproCommand: "c", choseInstead: "x" } });
    expect(reportedDebugOf({ debug: "x" })).toEqual({ kind: "malformed", value: "x" });
    // The schema is closed: an unknown field, or a reproduction other than not-expressible, is malformed too.
    expect(reportedDebugOf({ debug: { stray: 1 } }).kind).toBe("malformed");
    expect(reportedDebugOf({ debug: { reproduction: "expressible" } }).kind).toBe("malformed");
  });
});
