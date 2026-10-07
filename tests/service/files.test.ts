import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePrivateDir, ensurePrivateFile, readServiceConfig, tailLines, writePrivateFile, writeServiceFiles } from "../../src/service/files.js";
import { renderRunSh, renderServiceEnv } from "../../src/service/render.js";
import { runTool } from "../../src/service/tools.js";
import { fakeTools, sampleConfig, testPaths } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "sf-")); roots.push(r); return r; }
const mode = (p: string) => statSync(p).mode & 0o777;

describe("service files on disk (Rule 17 modes)", () => {
  it("creates missing directories 0700 at every level and never changes an existing one", async () => {
    const r = await root();
    mkdirSync(join(r, "keep"), { mode: 0o755 });
    chmodSync(join(r, "keep"), 0o755);
    ensurePrivateDir(join(r, "keep", "a", "b"));
    expect([mode(join(r, "keep")), mode(join(r, "keep", "a")), mode(join(r, "keep", "a", "b"))]).toEqual([0o755, 0o700, 0o700]);
  });

  it("gives every new directory level 0700 even when the umask strips the owner's bits", async () => {
    const r = await root();
    const old = process.umask(0o200);
    try { ensurePrivateDir(join(r, "one", "two")); } finally { process.umask(old); }
    expect([mode(join(r, "one")), mode(join(r, "one", "two"))]).toEqual([0o700, 0o700]);
  });

  it("gives new files 0600 under a umask that strips the owner's bits", async () => {
    const r = await root();
    const old = process.umask(0o277);
    try {
      writePrivateFile(join(r, "f"), "x");
      ensurePrivateFile(join(r, "log"));
    } finally { process.umask(old); }
    expect([mode(join(r, "f")), mode(join(r, "log"))]).toEqual([0o600, 0o600]);
  });

  it("writes files 0600 by replacing them atomically, and creates empty log files 0600 once", async () => {
    const r = await root();
    const file = join(r, "f");
    writePrivateFile(file, "one");
    writePrivateFile(file, "two");
    expect([mode(file), statSync(file).size]).toEqual([0o600, 3]);
    ensurePrivateFile(join(r, "log"));
    writeFileSync(join(r, "log"), "kept");
    ensurePrivateFile(join(r, "log"));
    expect([mode(join(r, "log")), statSync(join(r, "log")).size]).toEqual([0o600, 4]);
  });

  it("writes service.json, service.env and run.sh together, and nothing when one of them is refused", async () => {
    const r = await root();
    const paths = testPaths(r);
    const config = sampleConfig(paths);
    writeServiceFiles(paths, config);
    expect(readServiceConfig(paths)).toEqual(config);
    expect([mode(paths.panelDir), mode(paths.logsDir), mode(paths.configFile), mode(paths.envFile), mode(paths.runScript), mode(paths.outLog), mode(paths.errLog)])
      .toEqual([0o700, 0o700, 0o600, 0o600, 0o600, 0o600, 0o600]);
    // What landed on disk is what the renderers produce, read back after the call.
    expect(readFileSync(paths.envFile, "utf8")).toBe(renderServiceEnv(config));
    expect(readFileSync(paths.runScript, "utf8")).toBe(renderRunSh(config, paths));
    const other = testPaths(join(r, "other"));
    expect(() => writeServiceFiles(other, { ...sampleConfig(other), env: { X: "a$b" } })).toThrow(expect.objectContaining({ code: "service-env-value-unsupported" }));
    expect(existsSync(other.panelDir)).toBe(false);
  });

  it("names a missing or broken service.json", async () => {
    const paths = testPaths(await root());
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-not-installed" }));
    ensurePrivateDir(paths.panelDir);
    writePrivateFile(paths.configFile, "{\"schema\":\"other\"}");
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-config-invalid" }));
    // Each of these is otherwise a complete config, so only the schema literal / the strict object can refuse it.
    const good = sampleConfig(paths);
    writePrivateFile(paths.configFile, JSON.stringify({ ...good, schema: "orca-panel-service-v2" }));
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-config-invalid" }));
    writePrivateFile(paths.configFile, JSON.stringify({ ...good, extra: 1 }));
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-config-invalid" }));
    writePrivateFile(paths.configFile, "not json");
    expect(() => readServiceConfig(paths)).toThrow(expect.objectContaining({ code: "service-config-invalid" }));
  });

  it("tails the last lines of a log", async () => {
    const dir = await root();
    const file = join(dir, "log");
    writeFileSync(file, "a\nb\nc\nd\n");
    expect(tailLines(file, 2)).toEqual(["c", "d"]);
    expect(tailLines(join(dir, "missing"), 2)).toEqual([]);
  });

  it("keeps the private-file helpers free of imports beyond node built-ins (P20: discovery must not load the panel server)", () => {
    const source = readFileSync(join(__dirname, "../../src/service/privateFiles.ts"), "utf8");
    const specs = [...source.matchAll(/^(?:import|export)\b[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => !s.startsWith("node:"))).toEqual([]);
  });
});

describe("the tool runner and the fake tools", () => {
  it("logs argv, consumes queued exit codes in order, prints the canned output", async () => {
    const r = await root();
    const fake = await fakeTools(r);
    await fake.codes("launchctl", "bootstrap", [5, 0]);
    await fake.output("launchctl", "managername", "Aqua\n");
    const env = { ...process.env, ...fake.env };
    expect(runTool("launchctl", ["bootstrap", "gui/1", "/x.plist"], { env }).code).toBe(5);
    expect(runTool("launchctl", ["bootstrap", "gui/1", "/x.plist"], { env }).code).toBe(0);
    expect(runTool("launchctl", ["managername"], { env }).stdout).toBe("Aqua\n");
    expect(runTool("systemctl", ["--user", "daemon-reload"], { env }).code).toBe(0);
    expect(await fake.calls()).toEqual(["launchctl bootstrap gui/1 /x.plist", "launchctl bootstrap gui/1 /x.plist", "launchctl managername", "systemctl --user daemon-reload"]);
  });

  it("answers 127 for a command that does not exist", () => {
    expect(runTool("orca-no-such-tool", [], { env: { PATH: "/nonexistent" } }).code).toBe(127);
  });
});
