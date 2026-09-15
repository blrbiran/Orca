import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * spec Rule 12 / task 5 ruling G9: the skip gate is a CRITERION, not a grep --
 * a grep run once by a human is not something a mutation can be checked
 * against. This file both scans every real test file under tests/panel and
 * web/tests, and tests the scanner it uses to do that.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL_TESTS_DIR = HERE;
const WEB_TESTS_DIR = join(HERE, "..", "..", "web", "tests");

// Kept as a runtime VALUE, never spelled as a literal "." inside a string next
// to "it"/"test"/"describe": this file is itself under tests/panel/, and the
// "no test file contains a skip spelling" criterion below scans it too. If the
// must-catch samples further down spelled "it.skip(" out as one contiguous
// string literal, THIS file's own bytes would contain a real skip spelling --
// and the fix must not be excluding this file from the scan (ruling G9).
const DOT = ".";

/**
 * A minimal tokenizer, not a full JS parser: it only needs to tell a `//` or
 * `/* *\/` comment from ordinary code and from the inside of a string, which
 * is exactly what "strips comments first, then scans" requires. String
 * contents are copied through unchanged (not stripped) -- only real comments
 * are removed.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && src.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        out += src[i];
        i += 1;
      }
      if (i < n) {
        out += src[i];
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// Two forms: `it`/`test`/`describe` followed by `.skip`/`.todo` (with any
// amount of whitespace around the dot -- the must-catch set below includes
// `it .skip (`), and the `x`-prefixed forms (`xit(`, `xtest(`, `xdescribe(`).
// `\b` before each keyword is what keeps "submit.skipped" and "exit(" out:
// there is no word boundary between a preceding word character and "it"/"x".
const SKIP_PATTERN = /\b(it|test|describe)\s*\.\s*(skip|todo)\b|\bx(it|test|describe)\s*\(/g;

function findSkipSpellings(src: string): string[] {
  const stripped = stripComments(src);
  return [...stripped.matchAll(SKIP_PATTERN)].map((m) => m[0]);
}

// --- the scanner's own criteria -------------------------------------------

// Built by concatenation around DOT, on purpose (see DOT's comment above): at
// runtime each entry equals a real spelling ("it.skip(", "it .skip (", ...),
// but nowhere in THIS FILE'S source text does a contiguous matching spelling
// appear -- there is no literal "." character directly between "it" and
// "skip" anywhere here, only the three-letter identifier DOT.
const mustCatch = [
  "it" + DOT + "skip(",
  "test" + DOT + "skip(",
  "describe" + DOT + "skip(",
  "it" + DOT + "todo(",
  "test" + DOT + "todo(",
  "describe" + DOT + "todo(",
  "x" + "it(",
  "x" + "test(",
  "x" + "describe(",
  "it " + DOT + "skip (", // the whitespace spelling
];

const mustNotCatch = [
  "// it" + DOT + "skip(",
  "/* it" + DOT + "skip( */",
  "submit" + DOT + "skipped(",
  "ex" + "it(",
];

describe("the noSkips scanner itself (task 5 ruling G9)", () => {
  it("catches every skip/todo spelling, one per named form, plus one with stray whitespace", () => {
    for (const sample of mustCatch) {
      expect(findSkipSpellings(sample), sample).not.toEqual([]);
    }
  });

  it("does not flag a commented-out spelling, or a word that merely contains skip/exit as a substring", () => {
    for (const sample of mustNotCatch) {
      expect(findSkipSpellings(sample), sample).toEqual([]);
    }
  });

  it("does not flag its own file", async () => {
    // The must-catch/must-not-catch samples above are built so that this
    // file's own bytes never contain a contiguous spelling (see DOT's
    // comment); this is what proves that construction actually worked,
    // rather than excluding this file from the scan below.
    const ownText = await readFile(fileURLToPath(import.meta.url), "utf8");
    expect(findSkipSpellings(ownText)).toEqual([]);
  });
});

// --- the real gate ----------------------------------------------------------

async function collectSourceFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

describe("no skipped or todo test in this subsystem (spec Rule 12)", () => {
  it("tests/panel/*.ts and web/tests/* (if present) contain no skip or todo spelling", async () => {
    const files = [...(await collectSourceFiles(PANEL_TESTS_DIR)), ...(await collectSourceFiles(WEB_TESTS_DIR))];
    // A scan over zero files would pass vacuously; tests/panel/*.ts alone
    // guarantees at least this file, but assert it anyway so a future path
    // typo here reads as a failure, not a silent no-op.
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const hits = findSkipSpellings(text);
      if (hits.length > 0) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
