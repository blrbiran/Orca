// CLI v2 spec §7, §14 R1 (plan Task 1): --json prints exactly one line; human text otherwise; request rides on --json.
import { describe, expect, it } from "vitest";
import { printResponse } from "../../src/commands/output.js";

const capture = () => {
  const out: string[] = [];
  return { out, io: { stdout: (text: string) => out.push(text), stderr: (_text: string) => undefined } };
};

describe("printResponse (spec §7)", () => {
  it("--json: exactly one line, the v1 envelope, request included when given", () => {
    const { out, io } = capture();
    const request = { route: "groups/g/start", expectedRevision: 3, payload: {}, commandId: "cli-1" };
    const code = printResponse({ schema: "orca-cli-response-v1", status: 200, commandId: "cli-1", body: { a: "x\ny" } }, { json: true, quiet: false, format: () => "never" }, io, request);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]!.endsWith("\n")).toBe(true);
    expect(out[0]!.slice(0, -1).includes("\n")).toBe(false);
    expect(JSON.parse(out[0]!)).toEqual({ schema: "orca-cli-response-v1", status: 200, commandId: "cli-1", body: { a: "x\ny" }, request });
  });

  it("human: the formatter's text for 2xx; a named error line and exit 2 for a panel error; exit 1 for a local refusal", () => {
    const ok = capture();
    expect(printResponse({ schema: "orca-cli-response-v1", status: 200, body: { n: 1 } }, { json: false, quiet: false, format: (body) => `n=${(body as { n: number }).n}` }, ok.io)).toBe(0);
    expect(ok.out.join("")).toBe("n=1\n");
    const err: string[] = [];
    const io = { stdout: (_text: string) => undefined, stderr: (text: string) => err.push(text) };
    expect(printResponse({ schema: "orca-cli-response-v1", status: 409, body: { error: { code: "revision-conflict", message: "stale" } } }, { json: false, quiet: false, format: () => "" }, io)).toBe(2);
    expect(printResponse({ schema: "orca-cli-response-v1", status: 0, body: { error: { code: "panel-not-running", message: "none" } } }, { json: false, quiet: false, format: () => "" }, io)).toBe(1);
    expect(err.join("")).toContain("revision-conflict: stale");
    expect(err.join("")).toContain("panel-not-running: none");
  });

  it("no automatic JSON when stdout is not a TTY: human text unless --json", () => {
    const { out, io } = capture();
    printResponse({ schema: "orca-cli-response-v1", status: 200, body: {} }, { json: false, quiet: false, format: () => "text" }, io);
    expect(out.join("")).toBe("text\n");
  });
});
