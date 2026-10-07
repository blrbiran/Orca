import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

// macOS tmpdir() sits under the /var -> /private/var symlink; resolve it so the
// main-module guard is exercised on a real path unless a test links on purpose.
async function tempRoot(): Promise<string> {
  const out = await realpath(await mkdtemp(join(tmpdir(), "bd-")));
  roots.push(out);
  return out;
}

// Compile src into <out>/dist; the checkout's package.json makes .js ESM and its
// node_modules resolves express, so give the copy both.
async function buildInto(out: string): Promise<void> {
  const tsc = spawnSync(join("node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json", "--outDir", join(out, "dist")], { encoding: "utf8" });
  expect(tsc.status, `${tsc.stdout}${tsc.stderr}`).toBe(0);
  await writeFile(join(out, "package.json"), JSON.stringify({ type: "module" }));
  await symlink(join(process.cwd(), "node_modules"), join(out, "node_modules"));
}

describe("the service runs a node build, never tsx (spec §3, plan D4)", () => {
  it("compiles src alone, so src/cli.ts lands at dist/cli.js and every module keeps ../.. as the checkout root", async () => {
    const config = JSON.parse(await readFile("tsconfig.build.json", "utf8")) as { compilerOptions: Record<string, unknown>; include: string[] };
    expect(config.compilerOptions.rootDir).toBe("src");
    expect(config.compilerOptions.outDir).toBe("dist");
    expect(config.include).toEqual(["src/**/*.ts"]);
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json");
    // "npm run build --workspace web" also contains "npm run build"; pin the root build, which must precede the tests.
    expect(pkg.scripts.verify).toContain("npm run typecheck && npm run build && npm test");
  });

  it("the compiled CLI runs under plain node and boots a panel that exits 0 on SIGTERM", async () => {
    const out = await tempRoot();
    await buildInto(out);
    const usage = spawnSync(process.execPath, [join(out, "dist", "cli.js")], { encoding: "utf8" });
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain("orca panel");

    const dist = join(out, "web-dist");
    await mkdir(dist);
    await writeFile(join(dist, "index.html"), "<!doctype html><html><body></body></html>");
    const repo = join(out, "repo");
    await mkdir(repo);
    const child = spawn(process.execPath, [join(out, "dist", "cli.js"), "panel", "--by", "t", "--repo", `p=${repo}`, "--port", "0", "--dist", dist], {
      env: { ...process.env, ORCA_AGENTS_TABLE: "", ORCA_CCLOOP_BIN: "", ORCA_CONTROL_DIR: join(out, "c"), ORCA_CORRECTIONS_DIR: join(out, "k") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    try {
      await new Promise<void>((resolve, reject) => {
        const stop = (): void => { clearInterval(timer); clearTimeout(deadline); };
        const timer = setInterval(() => { if (stdout.includes("orca-panel ready url=")) { stop(); resolve(); } }, 50);
        const deadline = setTimeout(() => { stop(); reject(new Error(`no ready line in 30s; stderr: ${stderr}`)); }, 30_000);
        void exited.then((code) => { stop(); reject(new Error(`exited ${code} before ready; stderr: ${stderr}`)); });
      });
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
    } finally { if (child.exitCode === null) child.kill("SIGKILL"); }
  }, 120_000);

  it("the main-module guard compares real paths, so a CLI reached through a symlink still runs instead of exiting 0 silently", async () => {
    const out = await tempRoot();
    await buildInto(out);
    // A symlink to the file and a symlinked directory: node resolves the main module to its
    // real path but leaves argv[1] as typed, so a plain path compare would never match.
    await symlink(join(out, "dist", "cli.js"), join(out, "orca-link.js"));
    await symlink(join(out, "dist"), join(out, "dist-link"));
    for (const entry of [join(out, "orca-link.js"), join(out, "dist-link", "cli.js")]) {
      const usage = spawnSync(process.execPath, [entry], { encoding: "utf8" });
      expect(usage.status, entry).toBe(1);
      expect(usage.stderr, entry).toContain("orca panel");
    }
  }, 120_000);

  it("the main-module guard fails loud: a missing argv[1] is just not-main, any other realpath error surfaces", async () => {
    const out = await tempRoot();
    await buildInto(out);
    const cli = join(out, "dist", "cli.js");
    const load = (argv1: string) => spawnSync(process.execPath, ["--input-type=module", "-e", `process.argv[1] = ${JSON.stringify(argv1)}; await import(${JSON.stringify(cli)});`], { encoding: "utf8" });
    const missing = load(join(out, "no-such-entry.js"));
    expect(missing.status, missing.stderr).toBe(0);
    expect(missing.stdout + missing.stderr).not.toContain("orca panel");
    // A NUL byte makes realpath throw ERR_INVALID_ARG_VALUE, not ENOENT.
    const broken = load("bad\0entry");
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain("ERR_INVALID_ARG_VALUE");
  }, 120_000);
});
