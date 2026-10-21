// CLI v2 spec §4, §5 (plan Task 1): help is generated from the registry; `dev` and `control` stay out of the top level.
import { describe, expect, it } from "vitest";
import { renderHelp } from "../../src/commands/help.js";
import { main } from "../../src/cli.js";
import { captureStreams } from "../scheduler/sandbox.js";

describe("orca help (spec §4, §5)", () => {
  it("the top level lists user commands and omits the hidden dev and control domains", () => {
    const text = renderHelp([]);
    expect(text).toContain("orca status");
    expect(text).not.toContain("orca dev gate");
    expect(text).not.toContain("orca control get");
    expect(text).toContain("orca help dev");
  });

  it("orca help dev lists the dev commands; orca help control lists the escape hatch", () => {
    expect(renderHelp(["dev"])).toContain("orca dev gate --hook <hook>");
    expect(renderHelp(["control"])).toContain("orca control get");
  });

  it("orca help <domain> <action> prints that command's flags and examples", () => {
    const text = renderHelp(["dev", "gate"]);
    expect(text).toContain("--hook <hook>");
    expect(text).toContain("exit 2");
  });

  it("an unknown help topic is exit 1 with a suggestion", async () => {
    const { result, stderr } = await captureStreams(() => main(["help", "dvv"]));
    expect(result).toBe(1);
    expect(stderr).toContain("did you mean orca help dev?");
  });

  it("orca help and orca --help print to stdout and exit 0", async () => {
    for (const argv of [["help"], ["--help"], ["dev", "gate", "--help"]]) {
      const { result, stdout } = await captureStreams(() => main(argv));
      expect([result, stdout.startsWith("usage:") || stdout.startsWith("orca ")], JSON.stringify(argv)).toEqual([0, true]);
    }
  });
});
