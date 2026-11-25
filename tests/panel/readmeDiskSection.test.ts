import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const README = readFileSync("README.md", "utf8");
const gcSource = readFileSync("src/control/gc.ts", "utf8");

/**
 * Tester #443: the README never mentioned disk use at all — `orca gc`, `status --disk`, `disk-top` and `artifacts` had
 * zero hits, `Known limitations` said nothing about the store growing, and the "What writes where" table left
 * `artifacts/` out. The one place a person looks for "why is this 8 GB" said nothing, and the cleanup command they would
 * try (`orca gc`) is the one that deliberately excludes the biggest directory.
 */
describe("README documents disk use and gc's real scope (#443)", () => {
  it("names the commands a person needs, and the gap", () => {
    for (const phrase of ["orca gc", "status --disk", "disk-top", "artifacts", "reclaim"]) {
      expect(README.toLowerCase()).toContain(phrase.toLowerCase());
    }
    expect(README).toMatch(/## Disk use/);
  });

  it("names every skip reason gc can report", () => {
    // mutation: drop a reason from README -> it is documented nowhere the person looks
    for (const reason of ["too-recent", "group-not-archived", "not-cleaned-up", "run-not-found"]) {
      expect(README, reason).toContain(reason);
    }
  });

  it("the what-writes-where row names the artifacts sibling", () => {
    // mutation: drop `artifacts` from the state-dir row -> a person reading the table believes gc owns everything under it
    const row = README.split("\n").find((line) => line.includes("$ORCA_CONTROL_DIR/<repo key>"));
    expect(row).toBeDefined();
    expect(row).toContain("artifacts");
  });

  // Ruling (tester #468, session 5d3d0c09): gc took artifacts in behind --include-artifacts, which this criterion foresaw
  // ("this pair must be updated together"). The pair is now: gc's run pass still leaves artifacts alone and points at the
  // separate pass, and the README says artifacts are touched only with the flag -- never "out of gc's scope" any more.
  it("gc's run pass leaves artifacts to --include-artifacts, and the README says so", () => {
    // mutation: drop the pointer from gc.ts, or keep the old README sentence -> red.
    expect(gcSource).toMatch(/`artifacts`[^\n]*out of scope/);
    expect(gcSource).toMatch(/`orca gc --include-artifacts` is a separate pass/);
    expect(README).toContain("`gc` touches it only with `--include-artifacts`");
    expect(README).not.toMatch(/artifacts[^\n]*out of `gc`'s scope/);
    // Tester #468 (issue's third ask): --include-uncleaned is the run trees' flag; a person must not read it as reclaiming artifacts.
    expect(README).toContain("`--include-uncleaned` widens the run trees only; it never touches artifacts.");
  });
});
