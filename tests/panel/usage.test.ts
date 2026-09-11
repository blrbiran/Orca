import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { captureStreams } from "../scheduler/sandbox.js";

// spec §3.3: the sentence about --bind's blast radius has to actually be in
// the help text a user sees, not just in the plan that describes it. `main([])`
// with no subcommand prints USAGE to stderr and returns 1 (tests/cli/cli.test.ts's
// own pattern) -- captureStreams is the existing seam scheduler and metrics
// criteria already use to read what a CLI path wrote (tests/scheduler/sandbox.ts).
describe("orca panel usage text (spec §3.3)", () => {
  it("warns that --bind's external mode does not suit a team, and names the flag that must be typed to accept it", async () => {
    const { stderr } = await captureStreams(() => main([]));
    expect(stderr).toContain("does not suit a team");
    expect(stderr).toContain("--i-know-this-is-exposed");
  });
});
