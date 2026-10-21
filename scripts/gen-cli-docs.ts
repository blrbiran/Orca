// CLI v2 spec §11 (plan Task 13): write every file src/commands/generate.ts computes from the registry.
//   npm run gen:cli-docs
// tests/commands/drift.test.ts fails until the committed files equal what this writes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDocs, generatorInputs } from "../src/commands/generate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let written = 0;
for (const [path, text] of generateDocs(generatorInputs(root))) {
  const file = join(root, path);
  let current: string | null = null;
  try { current = readFileSync(file, "utf8"); } catch { current = null; }
  if (current === text) continue;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  written += 1;
  console.log(`gen-cli-docs: wrote ${path}`);
}
console.log(`gen-cli-docs: ${written} file(s) changed`);
