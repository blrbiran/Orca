/**
 * Review finding I4 (controller's call, flagged for the human): `flow-start` is `any`, and a flow writes into the folder
 * it runs on (copy-back). So it starts only on a registered `dir` project's folder -- never on a path a caller names --
 * and the run belongs to that project (its settings layer); a `projectId` naming another project is refused. A run Orca
 * dispatched is refused `flow-start` whatever its token (it would spend and write a folder nobody attends); the person and
 * an attended agent are not.
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { parsePanelArgs } from "../../src/panel/server.js";
import { WebControlService } from "../../src/control/webService.js";
import { getFlowRun } from "../../src/flow/store.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { yaml: "format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: draft, prompt: p.md}\n", assets: { "p.md": "Write.\n" } };
let n = 0;
const start = (payload: Record<string, unknown>) => ({ schema: "orca-raw-command-v1", commandId: `start-${++n}`, actorId: "owner", expectedRevision: 0, verb: "flow-start", target: { kind: "flows" }, payload }) as never;

describe("flow-start only on a registered dir project (I4)", () => {
  it("refuses an unregistered folder and a repository project's folder; accepts the dir project's and books the run under it", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const elsewhere = join(w.root, "elsewhere");
      mkdirSync(elsewhere);
      const projects = [{ repoId: "posts-1a2b3c4d", path: w.folder }];
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps, flowProjects: () => projects } as never);
      const send = async (payload: Record<string, unknown>) => (await service.flowCommand(start(payload))) as { result?: { flowRunId?: string }; error?: { code: string } };
      expect((await send({ template: "t", dir: elsewhere, params: {} })).error?.code).toBe("flow-dir-unregistered");
      expect((await send({ template: "t", dir: join(w.root, "missing"), params: {} })).error?.code).toBe("flow-dir-unregistered");
      expect((await send({ template: "t", dir: w.folder, params: {}, projectId: "other-00000000" })).error?.code).toBe("flow-dir-unregistered");
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM flow_runs").get()!.n).toBe(0);
      // The folder by another spelling (a trailing component that resolves to it) is the same project.
      const started = await send({ template: "t", dir: join(w.folder, "."), params: {} });
      expect(started.error).toBeUndefined();
      expect((getFlowRun(w.store, started.result!.flowRunId!)!.body as { projectId: string | null }).projectId).toBe("posts-1a2b3c4d");
    } finally { await w.dispose(); }
  });

  it("with no registered dir project (a panel without a projects file), nothing starts", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps } as never);
      expect(((await service.flowCommand(start({ template: "t", dir: w.folder, params: {} }))) as { error?: { code: string } }).error?.code).toBe("flow-dir-unregistered");
    } finally { await w.dispose(); }
  });

  it("a run Orca dispatched is refused flow-start, token or not; the socket agent, a Web member and the owner are not", () => {
    const person = { userId: "u", name: "o", roles: ["owner" as const] };
    const principals: Record<string, Principal> = {
      socket: { kind: "agent", client: "cli" },
      marker: { kind: "agent", client: "cli", dispatchedRun: "run-1" },
      markerToken: { kind: "agent", client: "cli", dispatchedRun: "run-1", person },
      webMember: { kind: "user", userId: "m", name: "m", roles: ["member"] },
      webOwner: { kind: "user", userId: "o", name: "o", roles: ["owner"] },
    };
    expect(Object.fromEntries(Object.entries(principals).map(([name, p]) => [name, permissionRefusal(p, "flow-start", { template: "t", dir: "/x", params: {} })?.code ?? "accepted"]))).toEqual({
      socket: "accepted", marker: "control-dispatched-run-refused", markerToken: "control-dispatched-run-refused", webMember: "accepted", webOwner: "accepted",
    });
    // The marker refuses only the verbs named for it: a message to a run stays open to it.
    expect(permissionRefusal(principals.marker!, "flow-message", {})).toBe(null);
  });

  it("the panel hands the projects file's dir projects (and only those) to the flow verbs", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-start-scope-")));
    try {
      const repo = join(root, "repo"), posts = join(root, "posts");
      mkdirSync(repo); mkdirSync(posts);
      const file = join(root, "projects.json");
      writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "code", name: "code", path: repo }, { id: "posts", name: "Posts", path: posts, kind: "dir" }] }));
      const binary = join(root, "ccloop");
      copyFileSync(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
      chmodSync(binary, 0o700);
      writeFileSync(join(root, "agents.json"), "{}", { mode: 0o600 });
      const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file,
        ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: join(root, "agents.json"), HOME: root };
      const opts = parsePanelArgs(["--by", "tester", "--projects-file", file], env);
      expect(opts.repos).toEqual([{ projectKey: "code", path: repo }, { projectKey: "posts", path: posts, kind: "dir" }]);
      const runtime = (await assembleControlRuntime({ control: opts.control, repos: opts.repos, epoch: "epoch-flow-scope", env }))!;
      try {
        expect(runtime.service.deps.flowProjects!()).toEqual([{ repoId: controlRepoKey("posts"), path: posts }]);
      } finally { runtime.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
