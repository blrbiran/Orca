/**
 * CLI v2 spec §14 R4, §15.6 criterion 11: `orca project register-plan` reaches the plan registration over the control
 * socket -- the HTTP route's own handler and validation (projects.ts registerPlan), not a copy. A registered plan is
 * importable; a file changed after registration is refused at import (plan-changed-since-registration).
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
import { overSocket } from "./fixtures/socketPanel.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sp-")));
  const repo = join(root, "web");
  mkdirSync(repo);
  execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "plan.json"), "{}");
  writeFileSync(join(repo, "untracked.json"), "{}");
  execFileSync("git", ["add", "plan.json"], { cwd: repo });
  const file = join(root, "home", "projects.json");
  mkdirSync(join(root, "home"));
  writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "web", name: "Web", path: repo }] }));
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file };
  delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE;
  return { root, repo, file, env, state: join(root, "s") };
}

async function boot(w: ReturnType<typeof world>, args: string[]) {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", "--control-state-dir", w.state, ...args], w.env), w.env);
  started.push(panel);
  const socket = join(w.state, "control.sock");
  return async (method: string, path: string, body?: unknown) => {
    const answer = await overSocket(socket, method, `/api/control/${path}`, { "x-orca-client": "cli" }, body);
    return { status: answer.status, body: JSON.parse(answer.text) as Record<string, unknown> };
  };
}

describe("POST /api/control/projects/:id/plans over the socket (CLI v2 §14 R4)", () => {
  it("registers a tracked plan file, lists it in the config, and an import of the changed file is refused", async () => {
    const w = world();
    const call = await boot(w, ["--projects-file", w.file]);
    const sha256 = createHash("sha256").update("{}").digest("hex");
    expect(await call("POST", "projects/web/plans", { path: "plan.json" })).toEqual({ status: 201, body: { plan: { id: "web.plan.json", path: "plan.json", sha256 } } });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects[0]!.plans).toEqual([{ id: "web.plan.json", path: "plan.json", sha256 }]);
    expect((await call("GET", "config")).body.plans).toEqual([{ planId: "web.plan.json", repoId: controlRepoKey("web"), displayName: "plan.json" }]);
    // The same validation as the HTTP route: an untracked file and a missing body are refused by name.
    expect(await call("POST", "projects/web/plans", { path: "untracked.json" })).toMatchObject({ status: 422 });
    expect(await call("POST", "projects/web/plans", {})).toMatchObject({ status: 400 });
    // Changed after registration: the import refuses it.
    writeFileSync(join(w.repo, "plan.json"), "{\"changed\":true}");
    const imported = await call("POST", "groups/import-plan", { commandId: "imp-1", expectedRevision: 0, payload: { groupId: "g1", repoId: controlRepoKey("web"), planId: "web.plan.json" } });
    expect(JSON.stringify(imported.body)).toContain("plan-changed-since-registration");
  });

  it("lists the projects with their roots, so the CLI can resolve cwd; command-line mode refuses registration by name", async () => {
    const w = world();
    const call = await boot(w, ["--repo", `web=${w.repo}`]);
    const listed = await call("GET", "projects");
    expect(listed.status).toBe(200);
    expect(listed.body.projects).toEqual([{ projectKey: "web", name: "web", path: w.repo, controlRepoId: controlRepoKey("web") }]);
    expect(await call("POST", "projects/web/plans", { path: "plan.json" })).toMatchObject({ status: 409, body: { code: "projects-from-command-line" } });
  });
});
