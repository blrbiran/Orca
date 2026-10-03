#!/usr/bin/env node
// Syncskill integration spec §3 / §9 (final review I2): an offline probe of what a real `claude` does with the plugin
// directory Orca's A2 makes (src/control/executionDriver.ts injectRunSkills). No model call and no real key: HOME and
// CLAUDE_CONFIG_DIR are temp dirs, ANTHROPIC_API_KEY is a dummy, and ANTHROPIC_BASE_URL points at an in-process recorder
// that saves each request body and answers 500. A skill "reaches the model" when its name is in a recorded
// `POST /v1/messages` body.
//
//   node scripts/probe-claude-skills.mjs --claude <absolute path to claude> [--keep]
//
// Prints one JSON verdict on stdout:
//   (a) skillReached / skillNameAs: whether the skill's name is in a body, as `orca-run-skills:<name>` or bare;
//   (b) lockReached: whether anything distinctive from skills/syncskill-lock.json (its schema id, its file name, its
//       unique content_md5 / created_at) is in a body;
//   (c) readOnlyPluginLoaded: whether the skill reached the model from a plugin dir whose skills/ tree is read-only, and
//       whether claude changed anything in that dir (pluginDirChanged).
// Exit 0 when (a) reached and (b) absent, else 1 (2 on a usage error). The temp dir is removed unless --keep.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const args = process.argv.slice(2);
const claudeAt = args.indexOf("--claude");
const claude = claudeAt === -1 ? undefined : args[claudeAt + 1];
const keep = args.includes("--keep");
if (claude === undefined || !isAbsolute(claude)) {
  process.stderr.write("usage: node scripts/probe-claude-skills.mjs --claude <absolute path> [--keep]\n");
  process.exit(2);
}

const PLUGIN_NAME = "orca-run-skills"; // executionDriver.ts injectRunSkills
const FIRST_REQUEST_GRACE_MS = 3_000; // after the first POST /v1/messages, how long to keep recording retries
const OVERALL_TIMEOUT_MS = 90_000;

/** Copied from src/control/workspace.ts makeReadOnly (that file is TypeScript): strip write bits, skip symbolic links. */
async function makeReadOnly(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) for (const entry of await readdir(path)) await makeReadOnly(join(path, entry));
  await chmod(path, stat.mode & 0o555);
}
/** `chmod -R u+w` (and u+x on directories), so the temp dir can be removed. */
async function restoreOwnerWrite(path) {
  let stat;
  try { stat = await lstat(path); } catch { return; }
  if (stat.isSymbolicLink()) return;
  await chmod(path, (stat.mode & 0o777) | (stat.isDirectory() ? 0o300 : 0o200));
  if (stat.isDirectory()) for (const entry of await readdir(path)) await restoreOwnerWrite(join(path, entry));
}
/** Every path under `dir` with its mode, size and mtime, to tell whether claude wrote anything there. */
async function listing(dir, prefix = "") {
  const out = [];
  for (const entry of (await readdir(join(dir, prefix))).sort()) {
    const rel = prefix === "" ? entry : join(prefix, entry);
    const stat = await lstat(join(dir, rel));
    out.push(`${rel} ${(stat.mode & 0o7777).toString(8)} ${stat.size} ${stat.mtimeMs}`);
    if (stat.isDirectory()) out.push(...(await listing(dir, rel)));
  }
  return out;
}

const root = await realpath(await mkdtemp(join(tmpdir(), "orca-probe-claude-skills-")));
const home = join(root, "home"), configDir = join(root, "claude-config"), cwd = join(root, "cwd"), requests = join(root, "requests");
for (const dir of [home, configDir, cwd, requests]) await mkdir(dir, { mode: 0o700 });

// The plugin dir, laid out as A2 makes it: 0700 dirs, the lock file beside the skill inside skills/, plugin.json 0600,
// then skills/ made read-only.
const tag = randomBytes(4).toString("hex");
const skillName = `orcaprobe${tag}`;
const lockMd5 = randomBytes(16).toString("hex");
const createdAt = `2026-10-03T00:00:00.${String(Number.parseInt(tag.slice(0, 4), 16) % 1000).padStart(3, "0")}Z`;
const plugin = join(root, `skills-run-${tag}`);
for (const sub of [plugin, join(plugin, "skills"), join(plugin, ".claude-plugin"), join(plugin, "skills", skillName)]) await mkdir(sub, { mode: 0o700 });
await writeFile(join(plugin, "skills", skillName, "SKILL.md"), `---\nname: ${skillName}\ndescription: Orca run skills probe\n---\nProbe body.\n`, { mode: 0o600 });
const lock = { schema: "syncskill-lock-v1", created_at: createdAt, profile: null, skills: [{ name: skillName, source: null, resolved_commit: null, content_md5: lockMd5 }] };
await writeFile(join(plugin, "skills", "syncskill-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: PLUGIN_NAME, version: "0.0.0" }), { mode: 0o600 });
await makeReadOnly(join(plugin, "skills"));
const before = await listing(plugin);

// The recorder: saves `<method> <url>\n<body>` per request, answers 500.
const recorded = [];
let firstMessagesAt = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    recorded.push({ method: req.method, url: req.url, body });
    void writeFile(join(requests, `${String(recorded.length - 1).padStart(3, "0")}.txt`), `${req.method} ${req.url}\n${body}`);
    if (req.method === "POST" && (req.url ?? "").startsWith("/v1/messages") && firstMessagesAt === null) firstMessagesAt = Date.now();
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"type":"error","error":{"type":"api_error","message":"orca probe recorder"}}');
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const argv = ["-p", "Say ok.", "--setting-sources", "project,local", "--strict-mcp-config", "--no-session-persistence", "--max-turns", "1",
  "--plugin-dir", plugin, "--debug-file", join(root, "claude.debug")];
const env = {
  PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: home, CLAUDE_CONFIG_DIR: configDir,
  XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_STATE_HOME: join(home, ".local", "state"),
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: "sk-ant-orca-probe-dummy",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
};
const child = spawn(claude, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let stdout = "", stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
const started = Date.now();
let stoppedBy = "exit";
let exit = null;
while (exit === null) {
  exit = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 100))]);
  if (exit !== null) break;
  if (firstMessagesAt !== null && Date.now() - firstMessagesAt > FIRST_REQUEST_GRACE_MS) { stoppedBy = "probe-after-first-request"; break; }
  if (Date.now() - started > OVERALL_TIMEOUT_MS) { stoppedBy = "probe-timeout"; break; }
}
if (exit === null) {
  // The whole process group: claude and anything it started.
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  exit = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 5_000))]);
  if (exit === null) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } exit = await exited; }
}
let groupGone = false;
try { process.kill(-child.pid, 0); } catch { groupGone = true; }
await new Promise((resolve) => server.close(resolve));
server.closeAllConnections?.();

const after = await listing(plugin);
const messages = recorded.filter((r) => r.method === "POST" && (r.url ?? "").startsWith("/v1/messages"));
const bodies = messages.map((r) => r.body);
const any = (needle) => bodies.some((body) => body.includes(needle));
const namespaced = any(`${PLUGIN_NAME}:${skillName}`);
// Bare: the name not after `<plugin>:` and not inside a path (after `/`); the description does not contain the name.
const bareRe = new RegExp(`(^|[^:/\\w-])${skillName}(?![\\w-])`);
const bare = bodies.some((body) => bareRe.test(body));
const lockNeedles = ["syncskill-lock", "syncskill-lock-v1", lockMd5, createdAt, "resolved_commit", "content_md5"];
const lockHits = lockNeedles.filter(any);
let debugSkillLines = [];
try {
  debugSkillLines = (await readFile(join(root, "claude.debug"), "utf8")).split("\n")
    .filter((line) => line.includes(PLUGIN_NAME) || line.includes(skillName) || line.includes("syncskill-lock") || /EACCES|EPERM/.test(line));
} catch { /* no debug file */ }

const verdict = {
  claude, argv, skillName, plugin: PLUGIN_NAME,
  requests: { total: recorded.length, messages: messages.length, urls: recorded.map((r) => `${r.method} ${r.url}`) },
  stoppedBy, exit, processGroupGone: groupGone,
  a: { skillReached: namespaced || bare, skillNameAs: namespaced ? `${PLUGIN_NAME}:<name>` : bare ? "<name> (bare)" : null, namespaced, bare },
  b: { lockReached: lockHits.length > 0, needles: lockNeedles.map((needle) => needle === lockMd5 ? "<content_md5>" : needle === createdAt ? "<created_at>" : needle), hits: lockHits.map((needle) => needle === lockMd5 ? "<content_md5>" : needle === createdAt ? "<created_at>" : needle) },
  c: { readOnlyPluginLoaded: namespaced || bare, skillsTreeModesBefore: before.filter((line) => line.startsWith("skills")).map((line) => line.split(" ").slice(0, 2).join(" ")), pluginDirChanged: before.join("\n") !== after.join("\n") },
  debugLines: debugSkillLines.map((line) => line.replaceAll(root, "<tmp>")),
  stderrTail: stderr.slice(-2000).replaceAll(root, "<tmp>"), stdoutTail: stdout.slice(-500).replaceAll(root, "<tmp>"),
  pass: (namespaced || bare) && lockHits.length === 0,
  kept: keep ? root : null,
};
process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
await restoreOwnerWrite(plugin);
if (!keep) await rm(root, { recursive: true, force: true });
process.exit(verdict.pass ? 0 : 1);
