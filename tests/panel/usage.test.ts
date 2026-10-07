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

  it("documents orca control and its exit codes (agent entry spec §4)", async () => {
    const { stderr } = await captureStreams(() => main([]));
    expect(stderr).toContain("orca control get <path>");
    expect(stderr).toContain("orca control send <route>");
    expect(stderr).toContain("Never starts a panel");
    expect(stderr).toContain("3 is reserved for crashes (unexpected errors)");
    expect(stderr).toContain("orca mcp serve");
    expect(stderr).toContain("orca_read and orca_send");
  });

  it("documents the panel service commands (panel service spec §2, §4)", async () => {
    const { stderr } = await captureStreams(() => main([]));
    for (const text of ["orca panel run --by <who>", "orca panel install", "orca panel status", "orca panel logs [-f] [-n <lines>]",
      "orca panel start [--detach]", "neither restarts on crash nor survives a reboot", "ask the person"]) expect(stderr).toContain(text);
  });
});
