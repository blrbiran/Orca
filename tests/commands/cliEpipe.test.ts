// Tester follow-up K: `orca help | head -1` -- a reader that stops reading early -- made node throw an unhandled EPIPE:
// a stack trace on stderr and exit 1, for a command that did nothing wrong. Why it matters: piping the CLI into head,
// grep -q or a pager that quits is ordinary shell use, and an agent reading stderr takes the trace for a failure.
// The reader here closes before the CLI writes anything (the help fits a pipe buffer, so a reader that closes after
// one line would race the CLI's single write and pass by luck); every write after that point gets EPIPE.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("a closed stdout ends the CLI quietly (tester follow-up K)", () => {
  it("orca help into a reader that already closed: exit 0, no stack trace on stderr", async () => {
    const child = spawn(resolve("node_modules/.bin/tsx"), ["src/cli.ts", "help"], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const code = await new Promise<number | null>((done) => child.on("close", (exit) => done(exit)));
    expect(stderr).not.toMatch(/EPIPE|Unhandled 'error' event|\n\s+at /);
    expect(code).toBe(0);
  }, 30_000);
});
