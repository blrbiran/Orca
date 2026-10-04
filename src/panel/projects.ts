/**
 * Project switcher spec D1: the projects this panel has, from the same discovery /api/metrics and /api/memory use,
 * each joined to its control repository when the control plane holds it. The browser never derives a control
 * `repoId` itself; it asks here.
 *
 * Project registry spec §6 (session 3d68f934): in file mode the list, add and rename go through the registry; in
 * command-line mode the list is discovery's and add/rename are refused by name.
 */
import type { Express } from "express";
import { compareText } from "../control/webProtocol.js";
import { discoverRepos } from "../metrics/discover.js";
import { PANEL_BAD_REQUEST } from "./rejection.js";
import { ProjectRegistryError, type ProjectRegistry } from "./projectRegistry.js";
import type { PanelOptions } from "./server.js";

export interface ProjectsDeps {
  opts: Pick<PanelOptions, "root" | "repos">;
  /** The control `repoId` of a project, or null when the control plane is off or does not hold that repository. */
  controlRepoId: (projectKey: string) => string | null;
  /** Project registry spec §5: present in file mode; absent or null means command-line mode. */
  registry?: ProjectRegistry | null;
}

const FROM_COMMAND_LINE = { code: "projects-from-command-line", message: "this panel's projects come from the command line (--repo/--root); restart it without them to manage projects here" };

export function registerProjectRoutes(app: Express, deps: ProjectsDeps): void {
  const row = (p: { id: string; name: string; path: string }) => ({ projectKey: p.id, name: p.name, path: p.path, controlRepoId: deps.controlRepoId(p.id) });
  const refused = (res: import("express").Response, error: unknown): void => {
    if (!(error instanceof ProjectRegistryError)) throw error;
    res.status(error.status).json({ code: error.code, message: error.message });
  };

  app.get("/api/projects", (_req, res, next) => {
    void (async () => {
      if (deps.registry) {
        const view = deps.registry.list();
        res.json({ ...view, projects: view.projects.map(row) });
        return;
      }
      const { repos } = await discoverRepos({ root: deps.opts.root, repos: deps.opts.repos });
      const projects = repos
        .map((repo) => ({ projectKey: repo.projectKey, name: repo.projectKey, path: repo.path, controlRepoId: deps.controlRepoId(repo.projectKey) }))
        .sort((left, right) => compareText(left.projectKey, right.projectKey));
      res.json({ source: "command-line", editable: false, projects, pendingRestart: [], fileError: null });
    })().catch(next);
  });

  app.post("/api/projects", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown; path?: unknown } | undefined;
    if (typeof body?.name !== "string" || typeof body.path !== "string") {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "POST /api/projects wants { name: string, path: string }" });
      return;
    }
    try { res.status(201).json({ project: row(deps.registry.add(body.name, body.path)) }); }
    catch (error) { refused(res, error); }
  });

  app.patch("/api/projects/:id", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown } | undefined;
    if (typeof body?.name !== "string") {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "PATCH /api/projects/:id wants { name: string }" });
      return;
    }
    try { res.json({ project: row(deps.registry.rename(String(req.params.id), body.name)) }); }
    catch (error) { refused(res, error); }
  });
}
