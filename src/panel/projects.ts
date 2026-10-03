/**
 * Project switcher spec D1: the projects this panel has, from the same discovery /api/metrics and /api/memory use,
 * each joined to its control repository when the control plane holds it. The browser never derives a control
 * `repoId` itself; it asks here.
 */
import type { Express } from "express";
import { compareText } from "../control/webProtocol.js";
import { discoverRepos } from "../metrics/discover.js";
import type { PanelOptions } from "./server.js";

export interface ProjectsDeps {
  opts: Pick<PanelOptions, "root" | "repos">;
  /** The control `repoId` of a project, or null when the control plane is off or does not hold that repository. */
  controlRepoId: (projectKey: string) => string | null;
}

export function registerProjectRoutes(app: Express, deps: ProjectsDeps): void {
  app.get("/api/projects", (_req, res, next) => {
    void (async () => {
      const { repos } = await discoverRepos({ root: deps.opts.root, repos: deps.opts.repos });
      const projects = repos
        .map((repo) => ({ projectKey: repo.projectKey, controlRepoId: deps.controlRepoId(repo.projectKey) }))
        .sort((left, right) => compareText(left.projectKey, right.projectKey));
      res.json({ projects });
    })().catch(next);
  });
}
