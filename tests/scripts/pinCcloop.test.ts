import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * scripts/pin-ccloop.mjs (human ruling 2026-09-29, session 2f65a729: re-pinning ccloop is the agent's, after the human
 * pushed ccloop; the script must fail on any check that does not hold). Every criterion runs the real script in a
 * throwaway git repository shaped like Orca, with a fake `npm` first on PATH and a fake `node_modules/.bin/vitest`, so
 * nothing here touches this checkout's package.json, its lock, the network, or a real home directory. The fakes do
 * what npm and vitest are measured to do (install writes package.json, the lock, node_modules and the hidden lockfile
 * node_modules/.package-lock.json; `ci` installs what the lock says) unless FAKE_PIN asks them to misbehave in one way.
 */
const script = resolve("scripts/pin-ccloop.mjs");
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// Shared by the fake npm (install, ci, run) and the fake vitest. Faults come from FAKE_PIN (a JSON object).
const FAKE_NPM = String.raw`#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const fault = JSON.parse(process.env.FAKE_PIN || "{}");
const cwd = process.cwd();
fs.appendFileSync(process.env.FAKE_PIN_LOG, JSON.stringify({ cwd, args: process.argv.slice(2) }) + "\n");
const [cmd, ...rest] = process.argv.slice(2);
const resolvedOf = (sha) => "git+ssh://git@github.com/blrbiran/ccloop.git#" + sha;
function installPackage(sha, dir = path.join(cwd, "node_modules", "ccloop")) {
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "cli.js"), "#!/usr/bin/env node\n", { mode: fault.notExecutable ? 0o644 : 0o755 });
  fs.writeFileSync(path.join(dir, "scripts", "claude-phase-runner.mjs"), "");
  if (!fault.noStream) fs.writeFileSync(path.join(dir, "scripts", "claude-stream.mjs"), "");
  const hidden = { packages: { "node_modules/ccloop": { resolved: resolvedOf(sha) } } };
  fs.writeFileSync(path.join(cwd, "node_modules", ".package-lock.json"), JSON.stringify(hidden));
}
if (cmd === "install") {
  const spec = rest[0];
  const sha = spec.split("#")[1];
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.dependencies.ccloop = fault.depForm === "git+https" ? "git+https://github.com/blrbiran/ccloop.git#" + sha : spec;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  lock.packages["node_modules/ccloop"] = { version: "0.1.0", resolved: resolvedOf(fault.lockSha || sha), integrity: "sha512-" + sha };
  lock.packages[""].dependencies.ccloop = pkg.dependencies.ccloop;
  if (fault.touchUnrelated) lock.packages["node_modules/zod"].version = "9.9.9";
  fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  if (fault.touchOther) fs.writeFileSync("README.md", "changed\n");
  if (fault.symlink) {
    // A complete, built package -- only reached through a link, so nothing but the link check can refuse it.
    installPackage(sha, path.join(cwd, "elsewhere"));
    fs.symlinkSync(path.join(cwd, "elsewhere"), path.join(cwd, "node_modules", "ccloop"));
    process.exit(0);
  }
  installPackage(sha);
} else if (cmd === "ci") {
  if (fault.ci) process.exit(fault.ci);
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  installPackage(fault.ciSha || lock.packages["node_modules/ccloop"].resolved.split("#")[1]);
} else if (cmd === "run" && rest[0] === "typecheck") {
  process.exit(fault.typecheck || 0);
} else if (cmd === "run" && rest[0] === "build" && rest.includes("web")) {
  fs.mkdirSync(path.join(cwd, "web", "dist"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "web", "dist", "index.html"), "");
} else {
  process.exit(99);
}
`;

// The fake vitest refuses exactly what the real E2E refuses (ORCA_CCLOOP_BIN present, flag off, no web/dist) and
// otherwise reports FAKE_PIN.vitest, so the script's verdict on a report is what is measured.
const FAKE_VITEST = String.raw`#!/usr/bin/env node
const fs = require("fs");
const fault = JSON.parse(process.env.FAKE_PIN || "{}");
fs.appendFileSync(process.env.FAKE_PIN_LOG, JSON.stringify({ vitest: process.argv.slice(2), home: process.env.HOME }) + "\n");
const out = process.argv.find((a) => a.startsWith("--outputFile.json=")).slice("--outputFile.json=".length);
const refused = process.env.ORCA_CCLOOP_BIN !== undefined || process.env.ORCA_CCLOOP_DEFAULT_E2E !== "1" || !fs.existsSync("web/dist/index.html");
const r = refused ? { total: 1, passed: 0, failed: 1, skipped: 0, status: 1 } : { total: 12, passed: 12, failed: 0, skipped: 0, status: 0, ...fault.vitest };
fs.writeFileSync(out, JSON.stringify({ numTotalTests: r.total, numPassedTests: r.passed, numFailedTests: r.failed, numPendingTests: r.skipped, numTodoTests: 0 }));
process.exit(r.status);
`;

type Repo = { repo: string; log: string; run: (sha: string, fault?: object) => { code: number | null; out: string } };

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function orcaLike(opts: { webDist?: boolean } = {}): Repo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pin-")));
  roots.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  writeFileSync(join(bin, "npm"), FAKE_NPM, { mode: 0o755 });
  const repo = join(root, "repo");
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(repo, "node_modules", ".bin", "vitest"), FAKE_VITEST, { mode: 0o755 });
  const dep = `github:blrbiran/ccloop#${OLD}`;
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "orca-like", dependencies: { ccloop: dep, zod: "^3" } }, null, 2) + "\n");
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "orca-like", dependencies: { ccloop: dep, zod: "^3" } },
      "node_modules/ccloop": { version: "0.1.0", resolved: `git+ssh://git@github.com/blrbiran/ccloop.git#${OLD}`, integrity: `sha512-${OLD}` },
      "node_modules/zod": { version: "3.23.8" },
    },
  };
  writeFileSync(join(repo, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
  writeFileSync(join(repo, "README.md"), "orca-like\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\ndist/\nelsewhere/\n");
  if (opts.webDist !== false) {
    mkdirSync(join(repo, "web", "dist"), { recursive: true });
    writeFileSync(join(repo, "web", "dist", "index.html"), "");
  }
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  const log = join(root, "npm.log");
  const run = (sha: string, fault: object = {}) => {
    const r = spawnSync(process.execPath, [script, sha], {
      cwd: repo,
      encoding: "utf8",
      // ORCA_CCLOOP_BIN is present on purpose: the gate's E2E must run without it, whatever the caller's shell has.
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: join(root, "home"), TMPDIR: process.env.TMPDIR, FAKE_PIN: JSON.stringify(fault), FAKE_PIN_LOG: log, ORCA_CCLOOP_BIN: "/nonexistent/cli.js" },
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { repo, log, run };
}

const calls = (log: string): Array<{ cwd?: string; args?: string[]; vitest?: string[]; home?: string }> =>
  existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];

describe("scripts/pin-ccloop.mjs", () => {
  it("pins the commit, and exits 0 only after every check held, the E2E and npm ci included", () => {
    const r = orcaLike();
    const result = r.run(NEW);
    expect(result.code, result.out).toBe(0);
    expect(JSON.parse(readFileSync(join(r.repo, "package.json"), "utf8")).dependencies.ccloop).toBe(`github:blrbiran/ccloop#${NEW}`);
    const log = calls(r.log);
    expect(log[0]).toEqual({ cwd: r.repo, args: ["install", `github:blrbiran/ccloop#${NEW}`] });
    // The E2E ran in this repository with its own HOME, and on the package's resolution alone.
    const e2e = log.find((c) => c.vitest);
    expect(e2e!.vitest).toEqual(expect.arrayContaining(["tests/control/ccloopDefaultE2E.test.ts", "tests/control/ccloopBin.test.ts"]));
    expect(e2e!.home).not.toBe(join(r.repo, "..", "home"));
    expect(log.some((c) => c.args?.join(" ") === "run typecheck" && c.cwd === r.repo)).toBe(true);
    // npm ci ran in a clone, not here -- and against the lock this install wrote, not the committed one.
    const ci = log.find((c) => c.args?.[0] === "ci");
    expect(ci!.cwd).not.toBe(r.repo);
    expect(result.out).toMatch(/^ok\s+npm ci reproduces the lock/m);
  });

  it("builds web/dist before the E2E when it is missing", () => {
    const r = orcaLike({ webDist: false });
    const result = r.run(NEW);
    expect(result.code, result.out).toBe(0);
    expect(calls(r.log).some((c) => c.args?.join(" ") === "run build --workspace web")).toBe(true);
  });

  it("refuses a malformed commit, a dirty tree and the commit already pinned, before npm runs at all", () => {
    const r = orcaLike();
    expect(r.run("b".repeat(12)).code).toBe(1);
    expect(r.run(OLD).code).toBe(1);
    writeFileSync(join(r.repo, "README.md"), "dirty\n");
    expect(r.run(NEW).code).toBe(1);
    expect(calls(r.log)).toEqual([]);
  });

  it.each([
    ["the dependency line is not the ruled github: form", { depForm: "git+https" }, "package.json pins the commit"],
    ["the lock resolves another commit", { lockSha: "c".repeat(40) }, "the lock pins the commit and changes only ccloop"],
    ["the lock changes a package that is not ccloop's", { touchUnrelated: true }, "the lock pins the commit and changes only ccloop"],
    ["the install touched a third file", { touchOther: true }, "only package.json and package-lock.json changed"],
    ["the installed cli is not executable", { notExecutable: true }, "the installed package is a built real directory"],
    ["the package lacks the runner's stream module", { noStream: true }, "the installed package is a built real directory"],
    ["the installed package is a symlink", { symlink: true }, "the installed package is a built real directory"],
    ["the E2E skipped a test", { vitest: { passed: 11, skipped: 1 } }, "the default-resolution E2E passed"],
    ["the E2E reports no tests", { vitest: { total: 0, passed: 0 } }, "the default-resolution E2E passed"],
    ["typecheck fails", { typecheck: 2 }, "typecheck"],
    ["npm ci fails", { ci: 1 }, "npm ci reproduces the lock"],
    ["npm ci installs another commit than the lock's", { ciSha: "c".repeat(40) }, "npm ci reproduces the lock"],
  ])("exits 1 when %s, naming that check", (_why, fault, check) => {
    const result = orcaLike().run(NEW, fault);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain(`FAIL ${check}`);
  });
});
