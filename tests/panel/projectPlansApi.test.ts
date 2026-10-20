/**
 * In-repo plan path spec 2026-10-21 §2.2/§2.5 (#65): the panel registers a plan file of a file-mode project over HTTP,
 * and the plan is importable at once (it is in the control config the import form lists); command-line mode refuses.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { readProjectsFile } from "../../src/panel/projectsFile.js";
import { sessionFor } from "./fixtures/auth.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plans-api-")));
  const repo = join(root, "web");
  mkdirSync(repo);
  execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "plan.json"), "{}");
  execFileSync("git", ["add", "plan.json"], { cwd: repo });
  const file = join(root, "home", "projects.json");
  mkdirSync(join(root, "home"));
  writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "web", name: "Web", path: repo }] }));
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file };
  delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE;
  return { root, repo, file, env };
}
async function boot(args: string[], env: NodeJS.ProcessEnv) {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", ...args], env), env);
  started.push(panel);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await (await sessionFor(panel, env)).fetch(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { panel, call };
}

describe("POST /api/projects/:id/plans (in-repo plan path spec 2026-10-21)", () => {
  it("A1: file mode registers the plan, files it with its digest, and lists it in the control config at once", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    const sha256 = createHash("sha256").update("{}").digest("hex");
    expect(await call("POST", "/api/projects/web/plans", { path: " plan.json " })).toEqual({ status: 201, body: { plan: { id: "web.plan.json", path: "plan.json", sha256 } } });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects[0]!.plans).toEqual([{ id: "web.plan.json", path: "plan.json", sha256 }]);
    expect((await call("GET", "/api/control/config")).body.plans).toEqual([{ planId: "web.plan.json", repoId: controlRepoKey("web"), displayName: "plan.json" }]);
    expect(await call("POST", "/api/projects/web/plans", { path: "missing.json" })).toMatchObject({ status: 422, body: { code: "plan-path-missing" } });
    expect(await call("POST", "/api/projects/web/plans", {})).toMatchObject({ status: 400 });
  });

  it("A2: command-line mode refuses by name", async () => {
    const w = world();
    const { call } = await boot(["--repo", `web=${w.repo}`], w.env);
    expect(await call("POST", "/api/projects/web/plans", { path: "plan.json" })).toMatchObject({ status: 409, body: { code: "projects-from-command-line" } });
  });
});
