/**
 * Dir-requirements spec §5.1, §5.2, §6.5, §12, criterion D10 (plan Task 2's rows; Tasks 4-5 add the delivery and
 * folder-change rows): what is refused on a `dir` project.
 *
 * - `import-plan`, and opening a correction-debug or a system-debug group, on a dir project's repo id are refused
 *   `dir-project-plan-import-unsupported` (only a requirement gets a dir workspace in this spec), booked, and no group exists.
 * - `requirement-open` on a dir project by a run Orca dispatched is refused `control-dispatched-run-refused` (it would make
 *   the folder a write target); the same run may open one on a repository project. The check reads the `dirProjectOf`
 *   the panel builds from the projects file's `kind: "dir"` entries (controlAssembly.ts).
 *
 * Rule 17: every path is under a temporary root; HOME, ORCA_VAULT_DIR, ORCA_CONTROL_DIR, ORCA_PROJECTS_FILE and
 * ORCA_CORRECTIONS_DIR point there.
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { debugGroupIdFor } from "../../src/control/debugGroup.js";
import { systemDebugGroupId } from "../../src/control/systemDebug.js";
import { WebControlService } from "../../src/control/webService.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { registerControlMutationRoutes, verifyControlJsonBody } from "../../src/panel/controlApi.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { parsePanelArgs } from "../../src/panel/server.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";

const REFUSED = "dir-project-plan-import-unsupported";
const errorCode = (answer: unknown): string | undefined => (answer as { error?: { code?: string } }).error?.code;
const groupExists = (store: { db: { prepare(sql: string): { get(...args: unknown[]): unknown } } }, groupId: string): boolean =>
  store.db.prepare("SELECT id FROM groups WHERE id=?").get(groupId) !== undefined;

afterEach(() => { vi.unstubAllEnvs(); });

/** The requirement harness's store and service, with "repo" registered as a dir project on a plain folder. */
async function world() {
  const x = await requirementHarness({ answers: [], startAt: "none" });
  const env = { HOME: join(x.root, "home"), ORCA_VAULT_DIR: join(x.root, "vaults"), ORCA_CONTROL_DIR: join(x.root, "control"),
    ORCA_PROJECTS_FILE: join(x.root, "projects.json"), ORCA_CORRECTIONS_DIR: join(x.root, "corrections") };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  mkdirSync(env.HOME, { mode: 0o700 });
  mkdirSync(env.ORCA_CORRECTIONS_DIR, { mode: 0o700 });
  const folder = join(x.root, "posts");
  mkdirSync(folder);
  writeFileSync(join(folder, "a.md"), "A\n");
  const deps = {
    ...x.service.deps, correctionsDir: env.ORCA_CORRECTIONS_DIR, correctionsBy: "owner@example.invalid",
    listRepositories: () => [{ repoId: "repo", path: folder }], repoIdOfProjectKey: (key: string) => (key === "posts" ? "repo" : `other-${key}`),
  };
  return {
    ...x, env, folder,
    dirService: new WebControlService({ ...deps, dirProjectOf: (repoId: string) => (repoId === "repo" ? { path: folder } : null) }),
    repoService: new WebControlService({ ...deps, dirProjectOf: () => null }),
  };
}

describe("plan imports on a dir project are refused dir-project-plan-import-unsupported (D10, §5.2)", () => {
  it("import-plan: refused and booked on a dir project; a repository project gets past the refusal", async () => {
    const w = await world(); try {
      const command = (groupId: string) => ({ schema: "orca-raw-command-v1", commandId: `import-${groupId}`, actorId: "human", expectedRevision: 0, verb: "import-plan",
        target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", planId: "plan" } }) as never;
      expect(errorCode(await w.dirService.importPlan(command("i1")))).toBe(REFUSED);
      expect(lookupCommandResult(w.store, "i1", "import-i1")!.body).toMatchObject({ error: { code: REFUSED } });
      expect(groupExists(w.store, "i1")).toBe(false);
      // The harness's trusted config has no plan files: a repository project reaches that refusal instead.
      expect(errorCode(await w.repoService.importPlan(command("i2")))).toBe("control-plan-rejected");
    } finally { await w.dispose(); }
  });

  it("correction-debug-open: refused on a correction whose project is a dir project, before its repository is read", async () => {
    const w = await world(); try {
      const correction = await recordNewCorrection(w.env.ORCA_CORRECTIONS_DIR, correctionRowFrom({ projectKey: "posts", decisionId: "run-1/agent-0", kind: "wrong",
        because: "the premise was false", by: "owner@example.invalid" } as never, () => new Date("2026-10-24T00:00:00.000Z")), { again: false });
      const command = (service: WebControlService, commandId: string) => {
        const groupId = debugGroupIdFor(w.store, correction.id, false);
        return { groupId, answer: service.openCorrectionDebugGroup({ schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0,
          verb: "correction-debug-open", target: { kind: "group", groupId }, payload: { correctionId: correction.id } } as never) };
      };
      const refused = command(w.dirService, "debug-dir");
      expect(errorCode(await refused.answer)).toBe(REFUSED);
      expect(groupExists(w.store, refused.groupId)).toBe(false);
      // On a repository project the open goes on to read the repository (this folder is not one: another refusal).
      const other = command(w.repoService, "debug-repo");
      const code = errorCode(await other.answer);
      expect(code).toBeDefined();
      expect(code).not.toBe(REFUSED);
    } finally { await w.dispose(); }
  });

  it("system-debug-open: refused on a dir project's repo id, and no group exists", async () => {
    const w = await world(); try {
      const source = { kind: "ladder" as const, groupId: "g", taskId: "t", runId: null };
      const command = (commandId: string) => ({ schema: "orca-raw-command-v1", commandId, actorId: "orca-auto", expectedRevision: 0, verb: "system-debug-open",
        target: { kind: "group", groupId: systemDebugGroupId(source) }, payload: { source, stackOn: null, repoId: "repo", facts: ["a task failed"], checks: ["true"] } }) as never;
      expect(errorCode(await w.dirService.openSystemDebugGroup(command("sys-dir")))).toBe(REFUSED);
      expect(groupExists(w.store, systemDebugGroupId(source))).toBe(false);
      expect(errorCode(await w.repoService.openSystemDebugGroup(command("sys-repo")))).not.toBe(REFUSED);
    } finally { await w.dispose(); }
  });
});

describe("requirement-open by a run Orca dispatched (D10, §5.1, §12)", () => {
  /** The panel's own dirProjectOf, from a projects file with a repository project "code" and a dir project "posts". */
  async function panelDirProjectOf() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "dir-group-access-")));
    const repo = join(root, "repo"), posts = join(root, "posts");
    mkdirSync(repo); mkdirSync(posts); mkdirSync(join(root, "home"), { mode: 0o700 });
    const file = join(root, "projects.json");
    writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "code", name: "code", path: repo }, { id: "posts", name: "Posts", path: posts, kind: "dir" }] }));
    const binary = join(root, "ccloop");
    copyFileSync(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
    chmodSync(binary, 0o700);
    writeFileSync(join(root, "agents.json"), "{}", { mode: 0o600 });
    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file,
      ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: join(root, "agents.json"), HOME: join(root, "home") };
    const opts = parsePanelArgs(["--by", "tester", "--projects-file", file], env);
    const runtime = (await assembleControlRuntime({ control: opts.control, repos: opts.repos, epoch: "epoch-dir-access", env }))!;
    const dirProjectOf = runtime.service.deps.dirProjectOf!;
    return { root, posts, dirProjectOf, close: () => { runtime.close(); rmSync(root, { recursive: true, force: true }); } };
  }

  it("the panel's dirProjectOf answers the dir project's folder, and null for a repository project", async () => {
    const p = await panelDirProjectOf(); try {
      expect(p.dirProjectOf(controlRepoKey("posts"))).toEqual({ path: p.posts });
      expect(p.dirProjectOf(controlRepoKey("code"))).toBe(null);
    } finally { p.close(); }
  });

  it("permissionRefusal: a dispatched run is refused on the dir project only; the socket agent, a member and the owner are not", async () => {
    const p = await panelDirProjectOf(); try {
      const person = { userId: "u", name: "o", roles: ["owner" as const] };
      const principals: Record<string, Principal> = {
        socket: { kind: "agent", client: "cli" },
        marker: { kind: "agent", client: "cli", dispatchedRun: "run-1" },
        markerToken: { kind: "agent", client: "cli", dispatchedRun: "run-1", person },
        webMember: { kind: "user", userId: "m", name: "m", roles: ["member"] },
        webOwner: { kind: "user", userId: "o", name: "o", roles: ["owner"] },
      };
      const on = (projectKey: string) => Object.fromEntries(Object.entries(principals).map(([name, principal]) =>
        [name, permissionRefusal(principal, "requirement-open", { groupId: "r", repoId: controlRepoKey(projectKey), idea: "x" }, p.dirProjectOf)?.code ?? "accepted"]));
      expect(on("posts")).toEqual({ socket: "accepted", marker: "control-dispatched-run-refused", markerToken: "control-dispatched-run-refused", webMember: "accepted", webOwner: "accepted" });
      expect(on("code")).toEqual({ socket: "accepted", marker: "accepted", markerToken: "accepted", webMember: "accepted", webOwner: "accepted" });
    } finally { p.close(); }
  });

  it("the route: 403 control-dispatched-run-refused on the dir project, never reaching the service; the repository project is opened", async () => {
    const p = await panelDirProjectOf();
    const x = await requirementHarness({ answers: [], startAt: "none" });
    const opened: string[] = [];
    const service = { deps: { dirProjectOf: p.dirProjectOf }, openRequirement: async (command: { payload: { repoId: string } }) => { opened.push(command.payload.repoId); } } as unknown as WebControlService;
    const app = express();
    app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "agent", client: "cli", dispatchedRun: "run-1" } satisfies Principal; next(); });
    app.use(express.json({ verify: verifyControlJsonBody }));
    registerControlMutationRoutes(app, x.store, service, "socket");
    const server = createServer(app); await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
    try {
      const send = (groupId: string, projectKey: string) => fetch(`http://127.0.0.1:${address.port}/api/control/requirements`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: `open-${groupId}`, expectedRevision: 0, payload: { groupId, repoId: controlRepoKey(projectKey), idea: "Export notes." } }) });
      const refused = await send("d", "posts");
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("control-dispatched-run-refused");
      const allowed = await send("c", "code");
      expect(allowed.status).not.toBe(403);
      expect(opened).toEqual([controlRepoKey("code")]);
    } finally { await new Promise<void>((done) => server.close(() => done())); await x.dispose(); p.close(); }
  });
});
