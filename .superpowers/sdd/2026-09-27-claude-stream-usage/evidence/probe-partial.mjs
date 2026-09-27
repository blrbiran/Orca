// Stream-json shape probe (Orca session 4d2e426e, human-approved 2026-09-27). Two real claude calls, each capped at $2.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const [claude, outDir] = process.argv.slice(2);
for (const k of Object.keys(process.env)) if (k.startsWith("CLAUDE")) delete process.env[k];
const projects = join(homedir(), ".claude", "projects");
const list = () => existsSync(projects) ? readdirSync(projects).sort() : ["<absent>"];
const before = list();
const schema = JSON.stringify({ type: "object", properties: { summary: { type: "string" }, changedFiles: { type: "array", items: { type: "string" } } }, required: ["summary", "changedFiles"], additionalProperties: false });
const iso = ["--permission-mode", "acceptEdits", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands", "--settings", '{"autoMemoryEnabled":false}', "--max-budget-usd", "2"];
const prompt = "Create a file named answer.txt in the current directory whose entire content is 42 followed by one newline, then read it back to confirm. Answer with a one-sentence summary and the list of files you changed.";
function run(name, killOnFirstUsage) {
  const cwd = join(outDir, `${name}-repo`); mkdirSync(cwd, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd });
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", schema, "--model", "claude-opus-5-5", ...iso, prompt];
  return new Promise((resolve) => {
    const t0 = Date.now(); const lines = []; let buf = ""; let err = ""; let killedAt = null;
    const child = spawn(claude, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const hard = setTimeout(() => { if (killedAt === null) { killedAt = Date.now() - t0; child.kill("SIGKILL"); } }, 240_000);
    child.stdout.on("data", (c) => {
      buf += c; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        lines.push({ ms: Date.now() - t0, line });
        if (killOnFirstUsage && killedAt === null) {
          try { const e = JSON.parse(line); if (e.type === "assistant" && e.message?.usage) { killedAt = Date.now() - t0; child.kill("SIGTERM"); } } catch {}
        }
      }
    });
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", (code, signal) => {
      clearTimeout(hard);
      if (buf.length) lines.push({ ms: Date.now() - t0, line: buf, torn: true });
      writeFileSync(join(outDir, `${name}.lines.json`), JSON.stringify({ args, code, signal, killedAt, durationMs: Date.now() - t0, stderr: err, lines }, null, 1));
      resolve({ name, code, signal, killedAt, lineCount: lines.length });
    });
  });
}
const r1 = await run("partial", false);
const r2 = null;
const after = list();
console.log(JSON.stringify({ r1, r2, projectsUnchanged: JSON.stringify(before) === JSON.stringify(after), newEntries: after.filter((x) => !before.includes(x)) }));
