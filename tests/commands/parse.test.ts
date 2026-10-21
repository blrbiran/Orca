// CLI v2 spec §4, §7 (plan Task 1): one registry parses every command; a refusal made here is exit 1 with a named code.
import { describe, expect, it } from "vitest";
import { EntryRejection } from "../../src/entry/envelope.js";
import { findCommand, REGISTRY } from "../../src/commands/registry.js";
import { parseArgs } from "../../src/commands/parse.js";
import type { CommandDef } from "../../src/commands/types.js";
import { main } from "../../src/cli.js";
import { captureStreams } from "../scheduler/sandbox.js";

const def: CommandDef = {
  domain: "thing", action: "poke", summary: "poke a thing",
  positionals: [{ name: "group", summary: "the group", required: true }],
  flags: [{ name: "note", type: "string", summary: "a note" }, { name: "hold", type: "boolean", summary: "hold it" }],
  access: "open", mapsTo: { kind: "local", load: async () => async () => 0 }, examples: [], format: () => "",
};

const refusal = (fn: () => unknown): EntryRejection => {
  try { fn(); } catch (error) { if (error instanceof EntryRejection) return error; throw error; }
  throw new Error("expected a refusal");
};

describe("parseArgs (spec §4: arguments instead of payloads)", () => {
  it("reads positionals, value flags, boolean flags and the global flags", () => {
    const parsed = parseArgs(def, ["g1", "--note", "hi", "--hold", "--json", "--if-revision", "7", "--project=/r"]);
    expect(parsed.positionals).toEqual({ group: "g1" });
    expect(parsed.flags).toEqual({ note: "hi", hold: true });
    expect(parsed.global).toMatchObject({ json: true, ifRevision: 7, project: "/r" });
  });

  it("refuses a missing required positional by name, as control-cli-argument-invalid", () => {
    const error = refusal(() => parseArgs(def, ["--note", "x"]));
    expect([error.code, error.message.includes("<group>")]).toEqual(["control-cli-argument-invalid", true]);
  });

  it("refuses an unknown flag, an extra positional and a value flag with no value", () => {
    for (const argv of [["g1", "--bogus"], ["g1", "g2"], ["g1", "--note"]]) {
      expect(refusal(() => parseArgs(def, argv)).code, JSON.stringify(argv)).toBe("control-cli-argument-invalid");
    }
  });

  it("refuses --if-revision that is not a non-negative integer", () => {
    for (const value of ["abc", "-1", "01", "1.5"]) {
      expect(refusal(() => parseArgs(def, ["g1", "--if-revision", value])).code, value).toBe("control-cli-argument-invalid");
    }
  });
});

describe("unknown commands (spec §4: did you mean, exit 1)", () => {
  it("suggests the nearest registered command for a typo", async () => {
    const { result, stderr } = await captureStreams(() => main(["gat"]));
    expect(result).toBe(1);
    expect(stderr).toContain("did you mean orca dev gate?");
  });

  it("suggests within a known domain, and nothing for a word far from every command", async () => {
    expect(findCommand(["dev", "gte"])).toEqual({ suggestion: "dev gate" });
    expect(findCommand(["zzzzzzzzzzzz"])).toEqual({ suggestion: null });
  });

  it("a registered command answers a missing positional with exit 1 and one JSON line under --json", async () => {
    const { result, stdout } = await captureStreams(() => main(["control-free-check-not-a-command"]));
    expect(result).toBe(1);
    expect(stdout).toBe("");
    const refused = await captureStreams(() => main(["dev", "gate", "--json"]));
    expect(refused.result).toBe(1);
    const lines = refused.stdout.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ schema: "orca-cli-response-v1", status: 0, body: { error: { code: "control-cli-argument-invalid" } } });
  });

  it("every registry row has a unique path", () => {
    const paths = REGISTRY.map((row) => [row.domain, row.action].filter((part) => part !== null).join(" "));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
