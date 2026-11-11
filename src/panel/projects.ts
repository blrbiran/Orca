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
import { sendControlError } from "./controlErrors.js";
import { projectAddRefusal, type Principal } from "./permissions.js";
import { PANEL_BAD_REQUEST } from "./rejection.js";
import { ProjectRegistryError, type ProjectRegistry } from "./projectRegistry.js";
import { projectKindOf, type MultiDirProjectEntryV1, type ProjectEntryV1 } from "./projectsFile.js";
import type { PanelOptions } from "./server.js";

export interface ProjectsDeps {
  opts: Pick<PanelOptions, "root" | "repos">;
  /** The control `repoId` of a project, or null when the control plane is off or does not hold that repository. */
  controlRepoId: (projectKey: string) => string | null;
  /**
   * Multi-directory projects spec §4.2: the control `repoId` of a multi project, answered by the assembly's multi map
   * (a multi has no path and never joins `opts.repos`). Absent while the control plane is off.
   */
  multiControlRepoId?: (projectKey: string) => string | null;
  /** Project registry spec §5: present in file mode; absent or null means command-line mode. */
  registry?: ProjectRegistry | null;
}

/** The one construction of ProjectsDeps, for the HTTP API and the control socket alike. */
export function projectsDepsOf(
  opts: ProjectsDeps["opts"], registry: ProjectRegistry | null, controlOn: boolean,
  multiControlRepoId?: (projectKey: string) => string | null,
  /** Issue #201: the control plane's own answer, so a project whose folder moved lists as unheld rather than as a target it cannot act on. */
  holds?: (repoId: string) => boolean,
): ProjectsDeps {
  return {
    opts, registry,
    controlRepoId: (key) => (controlOn && (holds === undefined ? opts.repos.some((repo) => repo.projectKey === key) : holds(controlRepoKey(key))) ? controlRepoKey(key) : null),
    ...(multiControlRepoId === undefined || !controlOn ? {} : { multiControlRepoId }),
  };
}

const FROM_COMMAND_LINE = { code: "projects-from-command-line", message: "this panel's projects come from the command line (--repo/--root); restart it without them to manage projects here" };

// Flow engine spec §5.1: only a `dir` project names its kind; a repository's row keeps the shape it always had.
const row = (deps: ProjectsDeps) => (p: ProjectEntryV1) => ({
  projectKey: p.id, name: p.name, path: p.path, ...(p.kind === "dir" ? { kind: "dir" as const } : {}), controlRepoId: deps.controlRepoId(p.id),
});

/** Multi-directory projects spec §4.2: the row a multi project adds; its `path` is the primary member's, for display. */
const multiRow = (deps: ProjectsDeps, projects: readonly ProjectEntryV1[]) => (m: MultiDirProjectEntryV1) => ({
  projectKey: m.id, name: m.name, path: projects.find((p) => p.id === m.dirs[0])?.path ?? "", kind: "multi" as const,
  dirs: m.dirs.map((id) => {
    const member = projects.find((p) => p.id === id);
    return { projectKey: id, kind: member === undefined ? "repo" : projectKindOf(member) };
  }),
  controlRepoId: deps.multiControlRepoId?.(m.id) ?? null,
});

/** GET /api/projects's body; the control socket serves the same body (CLI v2 spec §4: the project is resolved from cwd). */
export async function listProjects(deps: ProjectsDeps): Promise<unknown> {
  if (deps.registry) {
    const view = deps.registry.list();
    const rows = [
      ...view.projects.map(row(deps)),
      ...(view.multiDirProjects ?? []).map(multiRow(deps, view.projects)),
    ].sort((left, right) => compareText(left.projectKey, right.projectKey));
    return { ...view, projects: rows };
  }
  const { repos } = await discoverRepos({ root: deps.opts.root, repos: deps.opts.repos });
  const projects = repos
    .map((repo) => ({ projectKey: repo.projectKey, name: repo.projectKey, path: repo.path, controlRepoId: deps.controlRepoId(repo.projectKey) }))
    .sort((left, right) => compareText(left.projectKey, right.projectKey));
  return { source: "command-line", editable: false, projects, pendingRestart: [], fileError: null };
}

/** The row of a project the registry just changed, single or multi. */
function rowFor(deps: ProjectsDeps, id: string): unknown {
  const registry = deps.registry;
  if (registry === null || registry === undefined) return null;
  const view = registry.list();
  const single = view.projects.find((p) => p.id === id);
  if (single !== undefined) return row(deps)(single);
  const multi = view.multiDirProjects?.find((m) => m.id === id);
  return multi === undefined ? null : multiRow(deps, view.projects)(multi);
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

/**
 * Project registry spec §6, multi-directory projects spec §4.2: add a project, `{name, path}` or `{name, dirs}`; file mode
 * only. Tester follow-up E §9 (D21): one handler for the HTTP route and the control socket's (`orca project add`), as
 * registerPlan is -- the same validation, the same answer. Who may call it is the route's question (projectAddRefusal).
 */
export function addProject(deps: ProjectsDeps, raw: unknown): { status: number; body: unknown } {
  if (!deps.registry) return { status: 409, body: FROM_COMMAND_LINE };
  const bad = (message: string) => ({ status: 400, body: { code: PANEL_BAD_REQUEST, message } });
  const body = raw as { name?: unknown; path?: unknown; dirs?: unknown } | undefined;
  if (body === undefined || body === null || typeof body.name !== "string") return bad("POST /api/projects wants { name: string, path: string } or { name: string, dirs: string[] }");
  const hasPath = body.path !== undefined;
  const hasDirs = body.dirs !== undefined;
  if (hasPath === hasDirs) return bad("POST /api/projects takes either path or dirs, not both and not neither");
  try {
    if (hasPath) {
      if (typeof body.path !== "string") return bad("POST /api/projects wants path as a string");
      return { status: 201, body: { project: rowFor(deps, deps.registry.add(body.name, body.path).id) } };
    }
    if (!Array.isArray(body.dirs) || body.dirs.some((dir) => typeof dir !== "string")) return bad("POST /api/projects wants dirs as an array of project ids");
    return { status: 201, body: { project: rowFor(deps, deps.registry.addMulti(body.name, body.dirs as string[]).id) } };
  } catch (error) {
    if (!(error instanceof ProjectRegistryError)) throw error;
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
}

/** CLI v2 spec §14 R4: the plan registration (and the project list it needs to resolve cwd) on the control socket. */
export function registerSocketProjectRoutes(app: Express, deps: ProjectsDeps): void {
  app.get("/api/control/projects", (_req, res, next) => { void listProjects(deps).then((body) => res.json(body), next); });
  // Tester follow-up E §9 (D21): `orca project add`. A new project is a new directory Orca and its agents write in, so
  // only a person adds one: an owner's person token, never a run Orca dispatched (projectAddRefusal).
  app.post("/api/control/projects", (req, res) => {
    const refusal = projectAddRefusal(res.locals.orcaPrincipal as Principal);
    if (refusal !== null) { sendControlError(res, 403, refusal.code, refusal.message); return; }
    const answer = addProject(deps, req.body);
    res.status(answer.status).json(answer.body);
  });
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
    // Tester follow-up E §9 (D21): owner only. buildApi mounts this behind authMiddleware, which sets a principal on every
    // request it lets through; a criterion that mounts the routes bare has none, and is answered as before.
    const principal = res.locals.orcaPrincipal as Principal | undefined;
    const refusal = principal === undefined ? null : projectAddRefusal(principal);
    if (refusal !== null) { res.status(403).json({ code: refusal.code, message: refusal.message }); return; }
    const answer = addProject(deps, req.body);
    res.status(answer.status).json(answer.body);
  });

  // In-repo plan path spec 2026-10-21 (#65): register, or re-trust, a plan file of a project; file mode only.
  app.post("/api/projects/:id/plans", (req, res) => {
    const answer = registerPlan(deps, String(req.params.id), req.body);
    res.status(answer.status).json(answer.body);
  });

  app.patch("/api/projects/:id", (req, res) => {
    if (!deps.registry) { res.status(409).json(FROM_COMMAND_LINE); return; }
    const body = req.body as { name?: unknown; dirs?: unknown } | undefined;
    const hasName = body?.name !== undefined;
    const hasDirs = body?.dirs !== undefined;
    if (hasName === hasDirs) {
      res.status(400).json({ code: PANEL_BAD_REQUEST, message: "PATCH /api/projects/:id takes either { name: string } or { dirs: string[] }, not both and not neither" });
      return;
    }
    try {
      let id: string;
      if (hasName) {
        if (typeof body!.name !== "string") {
          res.status(400).json({ code: PANEL_BAD_REQUEST, message: "PATCH /api/projects/:id wants name as a string" });
          return;
        }
        id = deps.registry.rename(String(req.params.id), body!.name).id;
      } else {
        if (!Array.isArray(body!.dirs) || body!.dirs.some((dir) => typeof dir !== "string")) {
          res.status(400).json({ code: PANEL_BAD_REQUEST, message: "PATCH /api/projects/:id wants dirs as an array of project ids" });
          return;
        }
        id = deps.registry.setDirs(String(req.params.id), body!.dirs as string[]).id;
      }
      res.json({ project: rowFor(deps, id) });
    } catch (error) { refused(res, error); }
  });
}
