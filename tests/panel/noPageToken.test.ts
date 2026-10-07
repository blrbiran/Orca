import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";

/**
 * Accounts spec §3.4 (H5): the page carries no credential and every `/api` route wants a session. The page token
 * (injected into the page, sent back as a header) is gone in the same change (§9), not kept as a second way in.
 */

let tmp: string, dist: string, env: NodeJS.ProcessEnv;
const panels: StartedPanel[] = [];

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "orca-no-page-token-")));
  dist = join(tmp, "dist");
  await mkdir(dist);
  await mkdir(join(tmp, "repo"));
  // No anchor of any kind: the page is whatever the build wrote, served as it is.
  await writeFile(join(dist, "index.html"), "<!doctype html><html><head><title>orca</title></head><body><div id=\"root\"></div></body></html>");
  env = { ...process.env, ORCA_CONTROL_DIR: join(tmp, "control"), ORCA_CORRECTIONS_DIR: join(tmp, "corrections") };
});

afterEach(async () => {
  for (const panel of panels.splice(0)) await panel.close().catch(() => undefined);
  await rm(tmp, { recursive: true, force: true });
});

/** With a control plane (one --repo), so the /api/control routes exist and the walker reaches them too. */
async function boot(): Promise<StartedPanel> {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--dist", dist, "--repo", `proj=${join(tmp, "repo")}`], env), env);
  panels.push(panel);
  return panel;
}

describe("the page carries no credential (spec §3.4, H5)", () => {
  it("serves index.html byte-for-byte from dist and refuses x-orca-token", async () => {
    const panel = await boot();
    const page = await fetch(`${panel.url}/`);
    expect(await page.text()).toBe(await readFile(join(dist, "index.html"), "utf8"));
    expect(Object.keys(panel)).not.toContain("token");
    const res = await fetch(`${panel.url}/api/metrics`, { headers: { "x-orca-token": "a".repeat(64) } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "login-required" });
  });

  it("every /api route answers 401 without a cookie (walker over the route table)", async () => {
    const sources = ["src/panel/api.ts", "src/panel/controlApi.ts", "src/panel/chains.ts", "src/panel/memoryApi.ts", "src/panel/projects.ts", "src/panel/authRoutes.ts"]
      .map((file) => readFileSync(file, "utf8")).join("\n");
    // `path: ` is the mutation route table in controlApi.ts (all POST); `app.patch` is projects.ts's rename.
    const routes = [...sources.matchAll(/(?:app\.(get|post|patch)\(|path: )"(\/api\/[^"]+)"/g)]
      .map((m) => ({ method: m[1] === undefined ? "POST" : m[1].toUpperCase(), path: m[2]!.replace(/:[A-Za-z]+/g, "x") }));
    expect(routes.length).toBeGreaterThan(40);
    const panel = await boot();
    for (const { method, path } of routes) {
      if (path === "/api/auth/login") continue;
      const res = await fetch(`${panel.url}${path}`, { method, ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }) });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
