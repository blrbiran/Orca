import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { CAPTURED_ENV, checkDist } from "../../src/service/config.js";
import { domain } from "../../src/service/launchd.js";
import { defaultContext } from "../../src/service/manager.js";
import type { ServicePaths } from "../../src/service/paths.js";

/**
 * Spec §8: one real smoke, opt-in (ORCA_SERVICE_REAL=1), macOS only, under a relocated label and state dir.
 * Never the human's service: every path is under a temp root, the label is not dev.orca.panel.
 * The label is FIXED, not random: `launchctl enable` leaves a persistent override entry per label in the
 * user's launchd database, so a random label per run would accumulate entries nothing clears.
 * The temp root is short and realpath'd: the control socket path is <root>/c/s-xxxxxxxx/control.sock and macOS
 * caps a socket path at 104 bytes (under vitest, tmpdir() is already ~60 bytes deep, so /tmp is used instead).
 * Not run by the gate. Run it only when the human authorizes it: `npm run build && ORCA_SERVICE_REAL=1 npx vitest run tests/service/realSmoke.test.ts`.
 */
const real = process.env.ORCA_SERVICE_REAL === "1" && process.platform === "darwin";
beforeEach((ctx) => { if (!real) ctx.skip(); });

const label = "dev.orca.panel.smoke";
/** The domain the manager itself picks (gui/<uid> under Aqua, user/<uid> over ssh); only run/env/uid are read. */
const launchDomain = (): string => domain(defaultContext(process.env, {} as ServicePaths, { stdout() {}, stderr() {} }));
let root = "";
let env: NodeJS.ProcessEnv = {};
const orca = (...args: string[]) => spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "panel", ...args], { encoding: "utf8", env });
/** `stop` is a bootout: the old panel may still answer for a moment. install/start/restart already wait for a new answer. */
async function untilStatus(code: number, text: string, ms = 30_000): Promise<string> {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = orca("status");
    // The text keeps exit 1 from also matching service-not-installed (a stop that removed the plist).
    if (s.status === code && s.stdout.includes(text)) return s.stdout;
    if (Date.now() > deadline) throw new Error(`status never exited ${code} with ${JSON.stringify(text)}: ${s.stdout}${s.stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
afterAll(async () => {
  if (!real || root === "") return;
  spawnSync("launchctl", ["bootout", `${launchDomain()}/${label}`]);
  // Bounded wait for the old panel to exit, so it cannot recreate files under root while it is removed.
  let pid = 0;
  try { pid = (JSON.parse(await readFile(join(root, "p", "panel.json"), "utf8")) as { pid?: number }).pid ?? 0; } catch { /* never answered */ }
  for (let i = 0; pid > 0 && i < 50; i += 1) {
    try { process.kill(pid, 0); } catch { break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  await rm(root, { recursive: true, force: true });
}, 15_000);

describe("real launchd smoke (opt-in)", () => {
  it("install → answering → restart → stop → start → uninstall, under a relocated label", async () => {
    checkDist(process.cwd());
    root = await mkdtemp(join(await realpath("/tmp"), "r"));
    for (const d of ["repo", "web", "la", "c", "k"]) await mkdir(join(root, d));
    await writeFile(join(root, "web", "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
    // Every captured name this test does not relocate is blanked, so nothing ambient from the human's shell reaches the service.
    const blank = Object.fromEntries([...CAPTURED_ENV, "ORCA_SERVICE_CHECKOUT"].map((name) => [name, ""]));
    env = {
      ...process.env, ...blank, ORCA_SERVICE_LABEL: label, ORCA_PANEL_DIR: join(root, "p"), ORCA_LAUNCH_AGENTS_DIR: join(root, "la"),
      ORCA_CONTROL_DIR: join(root, "c"), ORCA_CORRECTIONS_DIR: join(root, "k"), ORCA_PROJECTS_FILE: join(root, "projects.json"),
      ORCA_SERVICE_MANAGER: "launchd",
    };
    const installed = orca("install", "--by", "smoke", "--repo", `s=${join(root, "repo")}`, "--port", "0", "--dist", join(root, "web"));
    expect(installed.status, installed.stderr).toBe(0);
    expect(existsSync(join(root, "la", `${label}.plist`))).toBe(true);
    const first = orca("status");
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const restarted = orca("restart");
    expect(restarted.status, restarted.stderr).toBe(0);
    const second = orca("status");
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(second.stdout).not.toBe(first.stdout); // a new pid: restart returns only once a different panel answers
    expect(orca("stop").status).toBe(0);
    await untilStatus(1, "panel: not answering");
    const started = orca("start");
    expect(started.status, started.stderr).toBe(0);
    expect(orca("status").status).toBe(0);
    expect(orca("uninstall").status).toBe(0);
    expect(spawnSync("launchctl", ["print", `${launchDomain()}/${label}`]).status).not.toBe(0);
    expect(existsSync(join(root, "la", `${label}.plist`))).toBe(false);
  }, 180_000);
});
