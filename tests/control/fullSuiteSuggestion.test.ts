import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { suggestFullSuiteCommand } from "../../src/control/fullSuite.js";

// Full suite spec 2026-11-12 §3 (#279): Orca suggests a full-suite command from the repository's own files, by code. It is
// only a suggestion (human: 「人采纳才用」), so a wrong one costs a person a glance -- but a placeholder that fails by design
// must never be offered as "the project's tests", and a repository with nothing recognisable gets no suggestion at all.

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "suite-suggest-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("the full-suite suggestion (spec §3)", () => {
  it.each([
    [{ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) }, "npm test"],
    [{ "pytest.ini": "[pytest]\n" }, "pytest"],
    [{ "pyproject.toml": "[tool.pytest.ini_options]\n" }, "pytest"],
    [{ "go.mod": "module x\n" }, "go test ./..."],
    [{ "Cargo.toml": "[package]\nname = \"x\"\n" }, "cargo test"],
    // First match wins: a root package.json's test script before a Python test runner.
    [{ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }), "pytest.ini": "" }, "npm test"],
  ])("%j suggests %s", (files, expected) => {
    expect(suggestFullSuiteCommand(repo(files))).toBe(expected);
  });

  it.each([
    [{}],
    // npm's placeholder fails by design: it is no suite.
    [{ "package.json": JSON.stringify({ scripts: { test: "echo \"Error: no test specified\" && exit 1" } }) }],
    [{ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) }],
    [{ "package.json": "{ not json" }],
    [{ "pyproject.toml": "[project]\nname = \"x\"\n" }],
  ])("%j suggests nothing", (files) => {
    expect(suggestFullSuiteCommand(repo(files))).toBeNull();
  });
});
