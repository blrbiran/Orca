import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = join(repoRoot, "tests", "fixtures", "ledger");

describe("main — validate exit codes", () => {
  it("returns 0 when everything passes", async () => {
    expect(await main(["validate", join(fixtures, "ok.jsonl")])).toBe(0);
  });

  it("returns 1 when something is rejected", async () => {
    expect(await main(["validate", join(fixtures, "rejected.jsonl")])).toBe(1);
  });

  it("returns 2 when only downgraded, nothing rejected", async () => {
    expect(await main(["validate", join(fixtures, "downgraded.jsonl")])).toBe(2);
  });

  it("returns 1 when both downgraded and rejected are present", async () => {
    const code = await main([
      "validate",
      join(fixtures, "downgraded.jsonl"),
      join(fixtures, "rejected.jsonl"),
    ]);
    expect(code).toBe(1);
  });

  it("a directory argument scans top-level *.jsonl files", async () => {
    expect(await main(["validate", fixtures])).toBe(1);
  });

  it("returns 1 when the path does not exist", async () => {
    expect(await main(["validate", join(fixtures, "nope.jsonl")])).toBe(1);
  });

  it("returns 1 when no subcommand is given", async () => {
    expect(await main([])).toBe(1);
  });

  // Fix wave finding 5: an existing-but-empty directory used to print
  // "ok: 0 ledger file(s)" and exit 0 — indistinguishable in CI output from a
  // real pass. Validating zero files must not read as ok.
  it("returns 1 when a directory contains no .jsonl files (an empty check must not read as a pass)", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "orca-cli-empty-"));
    expect(await main(["validate", emptyDir])).toBe(1);
  });
});

describe("main — check-append-only exit codes", () => {
  it("returns 0 for a pure append diff", async () => {
    const diff = [
      "diff --git a/.decisions/x.jsonl b/.decisions/x.jsonl",
      "--- a/.decisions/x.jsonl",
      "+++ b/.decisions/x.jsonl",
      "@@ -1,0 +2 @@",
      '+{"ev":"bound","id":"x/1"}',
    ].join("\n");
    expect(await main(["check-append-only"], diff)).toBe(0);
  });

  it("returns 1 when the diff contains a deleted line", async () => {
    const diff = [
      "diff --git a/.decisions/x.jsonl b/.decisions/x.jsonl",
      "--- a/.decisions/x.jsonl",
      "+++ b/.decisions/x.jsonl",
      "@@ -1 +1 @@",
      '-{"ev":"decision","id":"x/1"}',
      '+{"ev":"decision","id":"x/2"}',
    ].join("\n");
    expect(await main(["check-append-only"], diff)).toBe(1);
  });
});

// Warning: every assertion above measures the return value of main(). The return
// value is not the process exit code — dropping process.exitCode = code would
// leave all of them green while the real gate stops working. So here we spawn a
// real process and measure its actual exit status directly.
describe("real process exit code", () => {
  it("rejected.jsonl makes the process exit with 1", async () => {
    await expect(
      execFileAsync("npx", ["tsx", "src/cli.ts", "validate", join(fixtures, "rejected.jsonl")], {
        cwd: repoRoot,
      }),
    ).rejects.toMatchObject({ code: 1 });
  }, 60_000);

  it("ok.jsonl makes the process exit with 0", async () => {
    const { stdout } = await execFileAsync(
      "npx",
      ["tsx", "src/cli.ts", "validate", join(fixtures, "ok.jsonl")],
      { cwd: repoRoot },
    );
    expect(stdout).toContain("ok");
  }, 60_000);
});

describe("validate — the directory is the resolution scope (ruling orca-dev-c1c3c2ec/4)", () => {
  function decision(id: string, run: string): string {
    return JSON.stringify({
      ev: "decision", id, at: "2026-09-05T18:04:11Z", run,
      question: "q", chose: "c",
      alternatives: [{ option: "o", why_not: "w" }],
      because: "b",
      undo: { how: "git checkout <sha> -- README.md", cost: "x", blast_radius: "y" },
      scope: "repo", kind: "scheduling",
    });
  }

  function overturned(): string {
    return JSON.stringify({
      ev: "overturned", id: "run-7c/1", correctionId: "c_1",
      replacedBy: "run-9d/1", at: "2026-09-05T18:04:11Z", run: "run-9d",
    });
  }

  // Single-pass, file-by-file validation cannot see this: the decision being
  // overturned lives in the run that made it, and the fix agent that overturns
  // it is a different run writing a different file.
  it("resolves an overturned against a decision that lives in a sibling ledger file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-cli-scope-"));
    await writeFile(join(dir, "run-7c.jsonl"), decision("run-7c/1", "run-7c") + "\n");
    await writeFile(
      join(dir, "run-9d.jsonl"),
      decision("run-9d/1", "run-9d") + "\n" + overturned() + "\n",
    );
    expect(await main(["validate", dir])).toBe(0);
  });

  it("still rejects when that decision exists in no file in the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-cli-scope-"));
    await writeFile(
      join(dir, "run-9d.jsonl"),
      decision("run-9d/1", "run-9d") + "\n" + overturned() + "\n",
    );
    expect(await main(["validate", dir])).toBe(1);
  });
});
