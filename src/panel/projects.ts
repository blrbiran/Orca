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
import { controlRepoKey } from "./controlOptions.js";
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

/** The one construction of ProjectsDeps, for the HTTP API and the control socket alike. */
export function projectsDepsOf(opts: ProjectsDeps["opts"], registry: ProjectRegistry | null, controlOn: boolean): ProjectsDeps {
  return { opts, registry, controlRepoId: (key) => (controlOn && opts.repos.some((repo) => repo.projectKey === key) ? controlRepoKey(key) : null) };
}

const FROM_COMMAND_LINE = { code: "projects-from-command-line", message: "this panel's projects come from the command line (--repo/--root); restart it without them to manage projects here" };

const row = (deps: ProjectsDeps) => (p: { id: string; name: string; path: string }) => ({ projectKey: p.id, name: p.name, path: p.path, controlRepoId: deps.controlRepoId(p.id) });

/** GET /api/projects's body; the control socket serves the same body (CLI v2 spec §4: the project is resolved from cwd). */
export async function listProjects(deps: ProjectsDeps): Promise<unknown> {
  if (deps.registry) {
    const view = deps.registry.list();
    return { ...view, projects: view.projects.map(row(deps)) };
  }
  const { repos } = await discoverRepos({ root: deps.opts.root, repos: deps.opts.repos });
  const projects = repos
    .map((repo) => ({ projectKey: repo.projectKey, name: repo.projectKey, path: repo.path, controlRepoId: deps.controlRepoId(repo.projectKey) }))
    .sort((left, right) => compareText(left.projectKey, right.projectKey));
  return { source: "command-line", editable: false, projects, pendingRestart: [], fileError: null };
}

/**
 * In-repo plan path spec 2026-10-21 (#65): register, or re-trust, a plan file of a project; file mode only. One handler for
 * the HTTP route and the control socket's (CLI v2 spec §14 R4): the same validation, the same answer.
 */
export function registerPlan(deps: ProjectsDeps, projectId: string, body: unknown): { status: number; body: unknown } {
  if (!deps.registry) return { status: 409, body: FROM_COMMAND_LINE };
  const path = (body as { path?: unknown } | undefined)?.path;
  if (typeof path !== "string") return { status: 400, body: { code: PANEL_BAD_REQUEST, message: "POST /api/projects/:id/plans wants { path: string }" } };
  try { return { status: 201, body: { plan: deps.registry.addPlan(projectId, path.trim()) } }; }
  catch (error) {
    if (!(error instanceof ProjectRegistryError)) throw error;
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
}

/** CLI v2 spec §14 R4: the plan registration (and the project list it needs to resolve cwd) on the control socket. */
export function registerSocketProjectRoutes(app: Express, deps: ProjectsDeps): void {
  app.get("/api/control/projects", (_req, res, next) => { void listProjects(deps).then((body) => res.json(body), next); });
  app.post("/api/control/projects/:id/plans", (req, res) => {
    const answer = registerPlan(deps, String(req.params.id), req.body);
    res.status(answer.status).json(answer.body);
  });
}

export function registerProjectRoutes(app: Express, deps: ProjectsDeps): void {
  const refused = (res: import("express").Response, error: unknown): void => {
    if (!(error instanceof ProjectRegistryError)) throw error;
    res.status(error.status).json({ code: error.code, message: error.message });
  };

  app.get("/api/projects", (_req, res, next) => { void listProjects(deps).then((body) => res.json(body), next); });

  app.post("/api/projects", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown; path?: unknown } | undefined;
    if (typeof body?.name !== "string" || typeof body.path !== "string") {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "POST /api/projects wants { name: string, path: string }" });
      return;
    }
    try { res.status(201).json({ project: row(deps)(deps.registry.add(body.name, body.path)) }); }
    catch (error) { refused(res, error); }
  });

  // In-repo plan path spec 2026-10-21 (#65): register, or re-trust, a plan file of a project; file mode only.
  app.post("/api/projects/:id/plans", (req, res) => {
    const answer = registerPlan(deps, String(req.params.id), req.body);
    res.status(answer.status).json(answer.body);
  });

  app.patch("/api/projects/:id", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown } | undefined;
    if (typeof body?.name !== "string") {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "PATCH /api/projects/:id wants { name: string }" });
      return;
    }
    try { res.json({ project: row(deps)(deps.registry.rename(String(req.params.id), body.name)) }); }
    catch (error) { refused(res, error); }
  });
}
