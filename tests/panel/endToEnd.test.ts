import { describe, expect, it } from "vitest";
import { parseReadyLine, ReadyLineParseError } from "../../scripts/verify-panel.js";

// The real shape src/cli.ts prints (spec §7 / task 9 ruling L3): ONE machine
// -readable line, url=http://127.0.0.1:<port>, token=64 lowercase hex.
const GOOD_TOKEN = "0123456789abcdef".repeat(4);
const GOOD_LINE = `orca-panel ready url=http://127.0.0.1:54321 token=${GOOD_TOKEN}`;

describe("parseReadyLine (task 9 ruling L3: this script's own parser)", () => {
  it("parses the real shape, even with other log lines before and after", () => {
    const stdout = `some startup log\n${GOOD_LINE}\nanother log line after\n`;
    const parsed = parseReadyLine(stdout);
    expect(parsed.url).toBe("http://127.0.0.1:54321");
    // A value assertion, not just a shape check: a shape-only assertion is
    // blind to a mutation that returns a fixed, well-shaped, WRONG token.
    expect(parsed.token).toBe(GOOD_TOKEN);
  });

  it("throws when there is no ready line at all", () => {
    expect(() => parseReadyLine("some startup log\nanother log line\n")).toThrowError(ReadyLineParseError);
  });

  it("throws when the line is missing token=", () => {
    expect(() => parseReadyLine("orca-panel ready url=http://127.0.0.1:54321\n")).toThrowError(ReadyLineParseError);
  });

  it("throws when url= is not http://127.0.0.1:<port>", () => {
    for (const bad of [
      // RFC 5737 TEST-NET-2 -- non-loopback, and never 0.0.0.0 (ruling R62: that
      // literal must not appear anywhere in this plan's files, real or as a
      // test fixture, so it can never be copy-pasted into a real bind).
      `orca-panel ready url=http://198.51.100.1:54321 token=${GOOD_TOKEN}`,
      `orca-panel ready url=http://192.0.2.1:54321 token=${GOOD_TOKEN}`,
      `orca-panel ready url=https://127.0.0.1:54321 token=${GOOD_TOKEN}`,
    ]) {
      expect(() => parseReadyLine(bad), bad).toThrowError(ReadyLineParseError);
    }
  });

  it("throws when the token is not 64 lowercase hex characters", () => {
    for (const bad of [
      "orca-panel ready url=http://127.0.0.1:54321 token=short",
      `orca-panel ready url=http://127.0.0.1:54321 token=${"A".repeat(64)}`,
      `orca-panel ready url=http://127.0.0.1:54321 token=${"g".repeat(64)}`,
      `orca-panel ready url=http://127.0.0.1:54321 token=${"0".repeat(63)}`,
    ]) {
      expect(() => parseReadyLine(bad), bad).toThrowError(ReadyLineParseError);
    }
  });
});
