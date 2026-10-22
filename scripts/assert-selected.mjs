#!/usr/bin/env node
// Checks plan 2026-10-22 Task 11: read an `npm test` log and exit 1 naming each expected path that
// scripts/test-affected.mjs did not select. Selected = a line `  <root|web> <path> <- <why>` (test-affected.mjs prints
// one per selected file); a path seen only elsewhere in the log (a vitest result line) does not count.
// Usage: node scripts/assert-selected.mjs <npm-test.log> <path>...   (exit 2 on a usage error)
import { readFileSync } from "node:fs";

const [log, ...expected] = process.argv.slice(2);
if (log === undefined || expected.length === 0) {
  process.stderr.write("usage: node scripts/assert-selected.mjs <npm-test.log> <path>...\n");
  process.exit(2);
}
const selected = new Set();
for (const line of readFileSync(log, "utf8").split("\n")) {
  const match = /^ {2}(root|web) (\S+) <- /.exec(line);
  if (match !== null) selected.add(match[2]);
}
const missing = expected.filter((path) => !selected.has(path));
for (const path of missing) process.stderr.write(`assert-selected: not selected: ${path}\n`);
process.exit(missing.length === 0 ? 0 : 1);
