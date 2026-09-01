#!/usr/bin/env node
// spec §2.1: the CLAUDE.md ≤ 200-line hard budget "must be checked by machine
// (CI or pre-commit), otherwise it will inevitably be exceeded."
import { readFileSync } from "node:fs";

const LIMIT = 200;
const path = "CLAUDE.md";
const lines = readFileSync(path, "utf8").split("\n");
// A trailing newline splits off an extra empty string; that does not count as a line.
const count = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

if (count > LIMIT) {
  process.stderr.write(`${path}: ${count} lines exceeds the hard budget of ${LIMIT} (spec §2.1)\n`);
  process.stderr.write("Over budget must move to ccmem project scope; \"just one more line\" is not allowed.\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`ok: ${path} is ${count}/${LIMIT} lines\n`);
}
