/**
 * Project switcher spec D1 (session 08011394): `GET /api/projects` is the one place the browser learns which
 * projects the panel has and which of them the control plane can act on. The join to a control `repoId` is asked
 * of the trusted config, so a project the control plane does not hold answers null rather than an id the page
 * would then import into; and the rows are in code unit order, the order every other set on the wire uses.
 */
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/panel/api.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { registerProjectRoutes } from "../../src/panel/projects.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";

const token = "b".repeat(64);
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function listen(app: express.Express): Promise<string> {
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  return `http://127.0.0.1:${address.port}`;
}

async function panelApp(repos: Array<{ projectKey: string; path: string }>, control: unknown): Promise<string> {
  const app = express();
  app.use(express.json());
  const reviews = new ReviewsWriter(await mkdtemp(join(tmpdir(), "projects-reviews-")));
  await reviews.load();
  buildApi(app, {
    opts: { by: "operator", bind: "127.0.0.1", port: 0, confirmedExternal: false, correctionsDir: await mkdtemp(join(tmpdir(), "projects-corr-")), repos },
    token, reviews, statics: { get: () => undefined, indexHtml: undefined, names: [] },
    ...(control === undefined ? {} : { control }),
  } as never);
  return listen(app);
}

async function twoRepos(): Promise<Array<{ projectKey: string; path: string }>> {
  const root = await mkdtemp(join(tmpdir(), "projects-"));
  await mkdir(join(root, "zeta"));
  await mkdir(join(root, "alpha"));
  // `zeta` before `Alpha` as given; code unit order puts `Alpha` first (`A` < `z`), and so would ICU.
  return [{ projectKey: "zeta", path: join(root, "zeta") }, { projectKey: "Alpha", path: join(root, "alpha") }];
}

describe("GET /api/projects", () => {
  it("lists every project in code unit order, joined to the control repository only where the control plane holds it", async () => {
    const repos = await twoRepos();
    const app = express();
    registerProjectRoutes(app, { opts: { repos }, controlRepoId: (key) => (key === "zeta" ? "zeta-0123abcd" : null) });
    const res = await fetch(`${await listen(app)}/api/projects`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [{ projectKey: "Alpha", controlRepoId: null }, { projectKey: "zeta", controlRepoId: "zeta-0123abcd" }] });
  });

  it("orders by code unit where ICU would not", async () => {
    const root = await mkdtemp(join(tmpdir(), "projects-"));
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    const app = express();
    registerProjectRoutes(app, { opts: { repos: [{ projectKey: "ccloop", path: join(root, "a") }, { projectKey: "Orca", path: join(root, "b") }] }, controlRepoId: () => null });
    const body = await (await fetch(`${await listen(app)}/api/projects`)).json() as { projects: Array<{ projectKey: string }> };
    expect(body.projects.map((p) => p.projectKey)).toEqual(["Orca", "ccloop"]);
  });

  it("is served by the panel behind its token, and with no control plane no project has a control repository", async () => {
    const url = await panelApp(await twoRepos(), undefined);
    expect((await fetch(`${url}/api/projects`)).status).toBe(401);
    const res = await fetch(`${url}/api/projects`, { headers: { "x-orca-token": token } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [{ projectKey: "Alpha", controlRepoId: null }, { projectKey: "zeta", controlRepoId: null }] });
  });

  it("with the control plane mounted, joins every --repo project to the repoId its trusted config holds it under", async () => {
    // The control read routes only register handlers here; nothing in this criterion reaches the store.
    const control = { store: {}, epoch: "epoch-test", config: { readView: async () => ({}) } };
    const url = await panelApp(await twoRepos(), control);
    const res = await fetch(`${url}/api/projects`, { headers: { "x-orca-token": token } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [
      { projectKey: "Alpha", controlRepoId: controlRepoKey("Alpha") },
      { projectKey: "zeta", controlRepoId: controlRepoKey("zeta") },
    ] });
  });
});
