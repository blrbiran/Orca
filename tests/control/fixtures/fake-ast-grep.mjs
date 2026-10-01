// N1 plan Task 5: a stand-in for the ast-grep binary. argv: <mode> <log> ...the arguments ast-grep receives.
// Modes: "ok" (one NDJSON line per file under the working directory, sorted), "fail" (exit 3), "hang" (never answers).
// Every call appends {args, cwd, config, work} to <log>, where config is the text of the file `-c` names and work lists
// every path under the working directory's parent (Orca's private work directory) with its permission bits (PR-I6).
import { appendFileSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const [mode, log, ...args] = process.argv.slice(2);
const parent = dirname(process.cwd());
const work = [];
const list = (dir) => { for (const name of readdirSync(dir).sort()) { const path = join(dir, name); const s = lstatSync(path); work.push({ path: relative(parent, path), dir: s.isDirectory(), mode: s.mode & 0o777 }); if (s.isDirectory()) list(path); } };
list(parent);
appendFileSync(log, `${JSON.stringify({ args, cwd: process.cwd(), config: args[0] === "-c" ? readFileSync(args[1], "utf8") : null, work })}\n`);
if (mode === "fail") { process.stderr.write("fake-ast-grep: failure\n"); process.exit(3); }
if (mode === "hang") setInterval(() => {}, 1000);
else {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else files.push(path); } };
  walk(".");
  for (const file of files.sort()) {
    const name = file.split("/").pop().replace(/\W/g, "_");
    process.stdout.write(`${JSON.stringify({ path: `./${file}`, language: "TypeScript", items: [
      { role: "item", symbolType: "function", name: `exported_${name}`, isExported: true, isImport: false, signature: "", astKind: "function_declaration", range: { byteOffset: { start: 0, end: 1 }, start: { line: 0, column: 0 }, end: { line: 0, column: 1 } } },
      { role: "item", symbolType: "function", name: `private_${name}`, isExported: false, isImport: false, signature: "", astKind: "function_declaration", range: { byteOffset: { start: 2, end: 3 }, start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
    ] })}\n`);
  }
}
