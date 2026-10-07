// Agent entry spec §4.1, §4.4 (C16): orca control prints exactly one JSON line for every outcome.
import { describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/entry/controlCommand.js";

async function run(args: string[], env: NodeJS.ProcessEnv = { ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json", ORCA_CONTROL_DIR: "/nonexistent/ctl" }, files: Record<string, string> = {}) {
  const lines: string[] = [];
  const code = await runControlCommand(args, env, { write: (line) => lines.push(line), readFile: (path) => { if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files[path]!; } });
  return { code, lines };
}

describe("orca control argv and output (spec §4.1, §4.4, C16)", () => {
  it("prints exactly one JSON line for every outcome, including local refusals", async () => {
    for (const args of [[], ["get"], ["send", "r"], ["send", "r", "--expected-revision", "x", "--payload", "{}"], ["send", "r", "--expected-revision", "0", "--payload", "{bad"], ["get", "summary", "--bogus"], ["get", "summary"]]) {
      const { code, lines } = await run(args);
      expect(lines.length, JSON.stringify(args)).toBe(1);
      expect(lines[0]!.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.schema).toBe("orca-cli-response-v1");
      expect(code).toBe(1);
    }
  });

  it("names argument errors, and panel-not-running when nothing listens", async () => {
    expect(JSON.parse((await run(["send", "r", "--expected-revision", "0"])).lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
    expect(JSON.parse((await run(["send", "r", "--expected-revision", "0", "--payload", "{}", "--payload-file", "f"])).lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
    expect(JSON.parse((await run(["get", "summary"])).lines[0]!).body.error.code).toBe("panel-not-running");
  });

  it("reads --payload-file and refuses a bad --client-name", async () => {
    const out = await run(["send", "r", "--expected-revision", "0", "--payload-file", "/p.json"], undefined, { "/p.json": "{\"a\":1}" });
    expect(JSON.parse(out.lines[0]!).body.error.code).toBe("panel-not-running");
    expect(JSON.parse((await run(["get", "summary", "--client-name", "bad name"])).lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
  });

  it("refuses an empty --control-state-dir instead of falling through to the default socket", async () => {
    const { code, lines } = await run(["get", "summary", "--control-state-dir", ""]);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
    expect(code).toBe(1);
  });
});
