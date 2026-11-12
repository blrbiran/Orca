import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveChecks } from "./checks/settings.js";
import type { ControlStore } from "./store.js";

/**
 * Group acceptance full suite spec 2026-11-12 §2 (#279): the project's full-suite command is its integration-check command
 * (checks spec 2026-10-22 §4.1), read as every other check setting is -- project > global > built-in null, under the global
 * lock -- and independent of `enabled`, which switches only the integration check's event trigger. Null: none set.
 */
export function fullSuiteCommand(store: ControlStore, repoId: string): string | null {
  return effectiveChecks(store, repoId).kinds["integration-check"].command.value;
}

/** npm writes this as `scripts.test` in a fresh package.json; it fails by design and is no suite. */
const NPM_PLACEHOLDER = /no test specified/;

function readText(dir: string, name: string): string | null {
  try { return readFileSync(join(dir, name), "utf8"); } catch { return null; }
}

/**
 * Spec §3 (human: 「人采纳才用。如果没设或人没采纳，就默认没有，不跑测试。」): a suggestion detected by code from the
 * repository's files, first match wins; it is shown with an Adopt action and never run. Null when nothing matches.
 */
export function suggestFullSuiteCommand(dir: string): string | null {
  const pkg = readText(dir, "package.json");
  if (pkg !== null) {
    try {
      const test = (JSON.parse(pkg) as { scripts?: { test?: unknown } } | null)?.scripts?.test;
      if (typeof test === "string" && test.trim() !== "" && !NPM_PLACEHOLDER.test(test)) return "npm test";
    } catch { /* a package.json that does not parse suggests nothing */ }
  }
  if (readText(dir, "pytest.ini") !== null || ["pyproject.toml", "setup.cfg", "tox.ini"].some((name) => /pytest/.test(readText(dir, name) ?? ""))) return "pytest";
  if (readText(dir, "go.mod") !== null) return "go test ./...";
  if (readText(dir, "Cargo.toml") !== null) return "cargo test";
  return null;
}
