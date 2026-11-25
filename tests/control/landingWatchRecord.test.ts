// Tester #494: the landing watch's first observation recorded a check red when the file the check names did not exist
// yet -- the output of a later task -- so `states` and a green acceptance disagreed. A missing file on a tip the check
// has never been green on is `not-run`, not `red`; a file that disappears after a green check is still a regression.
import { describe, expect, it } from "vitest";
import { nextLandingWatch } from "../../src/control/landingWatchRecord.js";

const tip = (n: number): string => String(n).repeat(40);
const outcome = (commands: Array<{ command: string; exit: string; tail?: string }>) =>
  ({ setupFailure: null, commands: commands.map((command) => ({ ...command, ms: 5 })) });

describe("#494: a check whose file a later task creates is not-run, not red", () => {
  it("a first observation that cannot find the file the check names is not-run", () => {
    const first = nextLandingWatch(null, {
      tip: tip(1), at: 1, coveredRunIds: ["r1"], landedTaskIds: ["t1"],
      outcome: outcome([
        { command: "node --test test/links-readme.test.js", exit: "1", tail: "Could not find 'test/links-readme.test.js'" },
        { command: "npm test", exit: "0" },
      ]),
    });
    expect(first.record.states["node --test test/links-readme.test.js"]).toBe("not-run");
    expect(first.record.states["node --test test/links-readme.test.js"]).not.toBe("red");
    // A real failure is still red, and no regression is recorded for the not-run file (it was never green).
    expect(first.record.states["npm test"]).toBe("green");
    expect(first.record.regressions).toEqual([]);
  });

  it("ENOENT reads the same way", () => {
    const first = nextLandingWatch(null, {
      tip: tip(1), at: 1, coveredRunIds: ["r1"], landedTaskIds: ["t1"],
      outcome: outcome([{ command: "node --test test/new.test.js", exit: "1", tail: "Error: ENOENT: no such file or directory, open 'test/new.test.js'" }]),
    });
    expect(first.record.states["node --test test/new.test.js"]).toBe("not-run");
  });

  it("the later task lands, the file exists, and the check is green", () => {
    const first = nextLandingWatch(null, {
      tip: tip(1), at: 1, coveredRunIds: ["r1"], landedTaskIds: ["t1"],
      outcome: outcome([{ command: "node --test test/new.test.js", exit: "1", tail: "Could not find 'test/new.test.js'" }]),
    });
    const second = nextLandingWatch(first.record, {
      tip: tip(2), at: 2, coveredRunIds: ["r1", "r2"], landedTaskIds: ["t2"],
      outcome: outcome([{ command: "node --test test/new.test.js", exit: "0" }]),
    });
    expect(second.record.states["node --test test/new.test.js"]).toBe("green");
    expect(second.turnedRed).toEqual([]);
  });

  it("a green check whose file later disappears with ENOENT is still a regression", () => {
    const green = nextLandingWatch(null, {
      tip: tip(1), at: 1, coveredRunIds: ["r1"], landedTaskIds: ["t1"],
      outcome: outcome([{ command: "node --test test/old.test.js", exit: "0" }]),
    });
    const gone = nextLandingWatch(green.record, {
      tip: tip(2), at: 2, coveredRunIds: ["r1", "r2"], landedTaskIds: ["t2"],
      outcome: outcome([{ command: "node --test test/old.test.js", exit: "1", tail: "Could not find 'test/old.test.js'" }]),
    });
    expect(gone.record.states["node --test test/old.test.js"]).toBe("red");
    expect(gone.turnedRed.map((regression) => regression.command)).toEqual(["node --test test/old.test.js"]);
  });
});