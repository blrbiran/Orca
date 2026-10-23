/**
 * Gaps spec §8.4 (plan Task 10-B): the reads behind the Web's flow start dialog. The templates read lists each built-in
 * with its params in the template's order and types, so the dialog renders one typed field per param. The folder-image
 * read offers exactly the images a start would accept and see: the run's import excludes apply (the vault defaults, the
 * template's `workspace.excludes`, the folder's own `.gitignore`), a link is never offered (a start refuses one), a
 * name a start refuses (a quote) is not offered, and the list is bounded at 200 -- saying when it was cut, so the
 * person knows to type the path of a file past the bound.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { FOLDER_ENTRY_LIMIT, FOLDER_IMAGE_LIMIT, FOLDER_LIST_MS, listFolderImages, readBuiltinTemplates } from "../../src/flow/startForm.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { WebControlService } from "../../src/control/webService.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { getFlowRun } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const tempRoot = (): string => { const root = mkdtempSync(join(tmpdir(), "orca-start-form-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; };
const put = (root: string, rel: string, body = "x"): void => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), body); };

describe("the built-in templates read (§8.4)", () => {
  it("lists wechat-article with its params in order, typed, with the import excludes", () => {
    const read = readBuiltinTemplates();
    const wechat = read.templates.find((t) => t.id === "wechat-article")!;
    expect(read.schema).toBe("orca-flow-templates-v1");
    expect(wechat.version).toBe(3);
    expect(wechat.title).toEqual({ en: "WeChat article", zh: "公众号文章" });
    // mutation: drop the params' order or types -> red
    expect(wechat.params.map((p) => [p.id, p.type, p.required])).toEqual([
      ["idea", "longtext", true], ["slug", "slug", false], ["language", "enum", false], ["illustrations", "bool", false], ["coverImage", "image", false]]);
    expect(wechat.params.find((p) => p.id === "language")).toMatchObject({ options: ["zh", "en"], default: "zh" });
    expect(wechat.params.find((p) => p.id === "slug")).toMatchObject({ derive: "slug-of-idea" });
    expect(wechat.excludes).toEqual([".md2publish/cache/"]);
  });
});

describe("the folder-image read (§8.4)", () => {
  it("offers only the images a start accepts and would import: excludes, .gitignore, links and refused names left out", async () => {
    const dir = tempRoot();
    for (const rel of ["a.png", "b/c.JPG", "b/d.webp", "e.gif", "notes.md", "node_modules/x.png", ".md2publish/cache/y.png", "ignored.png", "it's.png", "nested/.git/z.png"]) put(dir, rel);
    put(dir, ".gitignore", "ignored.png\n");
    symlinkSync(join(dir, "a.png"), join(dir, "link.png"));
    const read = await listFolderImages(dir, [".md2publish/cache/"]);
    // mutation: drop the template excludes -> .md2publish/cache/y.png listed, red; mutation: follow links -> link.png listed, red
    expect(read).toEqual({ schema: "orca-flow-folder-images-v1", dir, files: ["a.png", "b/c.JPG", "b/d.webp", "e.gif"], truncated: false, limit: FOLDER_IMAGE_LIMIT });
  });

  it("is bounded at 200 and says it was cut", async () => {
    const dir = tempRoot();
    for (let i = 0; i < FOLDER_IMAGE_LIMIT + 5; i++) put(dir, `img-${String(i).padStart(3, "0")}.png`);
    const read = await listFolderImages(dir, []);
    expect(FOLDER_IMAGE_LIMIT).toBe(200);
    // mutation: no bound -> 205 files, red; mutation: never say truncated -> false, red
    expect(read.files).toHaveLength(200);
    expect(read.files.at(-1)).toBe("img-199.png");
    expect(read.truncated).toBe(true);
    expect((await listFolderImages(dir, [], { images: 205 })).truncated).toBe(false);
  });

  it("writes nothing into the folder and refuses a path that is not a folder", async () => {
    const dir = tempRoot();
    put(dir, "a.png");
    put(dir, "notes/b.md");
    // Task 10-B fix (review minor 4): measured on the folder itself, not through the listing under test (which would
    // hide a `.git/` or a non-image it wrote).
    const tree = (): string[] => (readdirSync(dir, { recursive: true }) as string[]).map((p) => `${p}:${statSync(join(dir, p)).mtimeMs}`).sort();
    const before = tree();
    // mutation: init the scratch repo inside the folder -> a .git entry appears, red
    expect((await listFolderImages(dir, [])).files).toEqual(["a.png"]);
    expect(tree()).toEqual(before);
    await expect(listFolderImages(join(dir, "a.png"), [])).rejects.toThrow();
    await expect(listFolderImages(join(dir, "missing"), [])).rejects.toThrow();
  });
});

describe("the folder-image read is bounded on work (Task 10-B fix I1)", () => {
  it("refuses a folder past the entry cap as too large -- by name, never as not a folder", async () => {
    const dir = tempRoot();
    for (let i = 0; i < 12; i++) put(dir, `doc-${i}.md`);
    put(dir, "a.png");
    // mutation: no entry cap -> the listing answers ["a.png"], red
    await expect(listFolderImages(dir, [], { entries: 10 })).rejects.toMatchObject({ name: "FolderTooLarge", code: "flow-folder-too-large", why: "entries" });
    expect((await listFolderImages(dir, [], { entries: 13 })).files).toEqual(["a.png"]);
  });

  it("refuses a listing past the time cap as too large", async () => {
    const dir = tempRoot();
    put(dir, "a.png");
    // A cap of 0 ms passes before git can answer (the timer is armed before the child's first output can be read).
    // mutation: no time cap -> the listing answers, red
    await expect(listFolderImages(dir, [], { ms: 0 })).rejects.toMatchObject({ name: "FolderTooLarge", why: "time" });
    expect(FOLDER_ENTRY_LIMIT).toBe(20_000);
    expect(FOLDER_LIST_MS).toBe(5_000);
  });
});

describe("the start dialog's routes (§8.4)", () => {
  it("answers the templates and a folder's images, and refuses a bad query, an unknown template and a non-folder", async () => {
    const root = tempRoot();
    const store = await openControlStore({ stateDir: join(root, "control") });
    cleanups.push(() => store.close());
    const dir = join(root, "folder");
    put(dir, "covers/one.png");
    const app = express();
    registerControlReadRoutes(app, { store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web");
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const get = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const templates = await get("/api/control/flows/templates");
    expect(templates.status).toBe(200);
    expect((templates.body.templates as Array<{ id: string }>).map((t) => t.id)).toContain("wechat-article");
    const images = await get(`/api/control/flows/images?dir=${encodeURIComponent(dir)}&template=wechat-article`);
    expect(images).toEqual({ status: 200, body: { schema: "orca-flow-folder-images-v1", dir, files: ["covers/one.png"], truncated: false, limit: 200 } });
    expect((await get(`/api/control/flows/images?dir=relative&template=wechat-article`)).body).toMatchObject({ error: { code: "query-invalid" } });
    // A relative folder that exists (from the panel's own working directory) is still refused: only absolute folders.
    // mutation: drop the absolute-path check -> "." listed, 200, red
    expect(await get(`/api/control/flows/images?dir=.&template=wechat-article`)).toMatchObject({ status: 400, body: { error: { code: "query-invalid" } } });
    expect(await get(`/api/control/flows/images?dir=${encodeURIComponent(dir)}&template=no-such`)).toMatchObject({ status: 422, body: { error: { code: "flow-template-invalid" } } });
    expect(await get(`/api/control/flows/images?dir=${encodeURIComponent(join(dir, "covers/one.png"))}&template=wechat-article`)).toMatchObject({ status: 400, body: { error: { code: "query-invalid" } } });
    // Task 10-B fix I1: a folder past the entry cap is named too large, not "not a folder".
    const big = join(root, "big");
    mkdirSync(big);
    for (let i = 0; i <= FOLDER_ENTRY_LIMIT; i++) writeFileSync(join(big, `f${i}`), "");
    // mutation: map every failure to query-invalid -> "query-invalid", red
    expect(await get(`/api/control/flows/images?dir=${encodeURIComponent(big)}&template=wechat-article`)).toMatchObject({ status: 400, body: { error: { code: "flow-folder-too-large" } } });
  });
});

/**
 * Task 10-B fix round 2 (the controller's corrected ruling): the start names no project -- the server derives it from
 * the folder (flowCommands.ts registeredDirProject) -- and the dialog's presets read `?dir=` resolves the same folder's
 * dir project by the same resolver (dirProjectOf), so what the dialog shows is what the start applies.
 */
describe("the folder's project presets (Task 10-B fix round 2)", () => {
  const TPL = { yaml: "format: orca-flow-v1\nid: t\nparams:\n  tone: {type: text, default: plain}\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: draft, prompt: p.md}\n", assets: { "p.md": "Write.\n" } };
  const global = (store: ControlStore, flows: Record<string, unknown>) => store.transaction(() => writeOrchestrationSettings(store, { maxRunningGroups: 3, flows } as never, orchestrationRevision(store) + 1));
  const project = (store: ControlStore, repoId: string, flows: Record<string, unknown>) => store.transaction(() => writeRepositorySettingsBody(store, repoId, { workspaceMode: "worktree", revision: (readRepositorySettingsBody(store, repoId)?.revision ?? 0) + 1, flows } as never));

  it("reads the folder's dir project presets over the global ones, which the start then applies; another folder reads the global layer", async () => {
    const w = await flowWorld({ t: TPL });
    cleanups.push(() => w.dispose());
    const projects = [{ repoId: "posts-1a2b3c4d", path: w.folder }];
    global(w.store, { paramDefaults: { t: { tone: "global" } } });
    project(w.store, "posts-1a2b3c4d", { paramDefaults: { t: { tone: "project" } } });
    const elsewhere = join(w.root, "elsewhere");
    mkdirSync(elsewhere);
    const app = express();
    registerControlReadRoutes(app, { store: w.store, epoch: "epoch", config: { readView: async () => ({}) } as never, flowProjects: () => projects }, "web");
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const tone = async (query: string) => {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control/flows/settings${query}`);
      const body = await response.json() as { paramDefaults?: Record<string, Record<string, { value: unknown; source: string }>>; error?: { code: string } };
      return response.status === 200 ? body.paramDefaults!.t!.tone : [response.status, body.error?.code];
    };
    // mutation: resolve nothing from dir (always the global layer) -> source global, red
    expect(await tone(`?dir=${encodeURIComponent(w.folder)}`)).toEqual({ value: "project", source: "project", lockedBy: null });
    expect(await tone(`?dir=${encodeURIComponent(join(w.folder, "."))}`)).toEqual({ value: "project", source: "project", lockedBy: null });
    expect(await tone(`?dir=${encodeURIComponent(elsewhere)}`)).toEqual({ value: "global", source: "global", lockedBy: null });
    expect(await tone(`?dir=${encodeURIComponent(join(w.root, "missing"))}`)).toEqual({ value: "global", source: "global", lockedBy: null });
    expect(await tone("?dir=relative")).toEqual([400, "query-invalid"]);
    expect(await tone(`?dir=${encodeURIComponent(w.folder)}&repoId=posts-1a2b3c4d`)).toEqual([400, "query-invalid"]);
    // The start on that folder, with no projectId, applies the same project preset.
    const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps, flowProjects: () => projects } as never);
    const started = await service.flowCommand({ schema: "orca-raw-command-v1", commandId: "start-presets", actorId: "owner", expectedRevision: 0, verb: "flow-start", target: { kind: "flows" },
      payload: { template: "t", dir: w.folder, params: {} } } as never) as { result?: { flowRunId: string }; error?: unknown };
    expect(started.error).toBeUndefined();
    const body = getFlowRun(w.store, started.result!.flowRunId)!.body as { projectId: string | null; params: Record<string, unknown> };
    expect(body).toMatchObject({ projectId: "posts-1a2b3c4d", params: { tone: "project" } });
  });

  it("serves ?dir= to the Web only, and refuses it to a run Orca dispatched", async () => {
    const root = tempRoot();
    const store = await openControlStore({ stateDir: join(root, "control") });
    cleanups.push(() => store.close());
    const serve = async (channel: "web" | "socket", principal: unknown) => {
      const app = express();
      app.use((_req, res, next) => { res.locals.orcaPrincipal = principal; next(); });
      registerControlReadRoutes(app, { store, epoch: "epoch", config: { readView: async () => ({}) } as never, flowProjects: () => [{ repoId: "posts-1", path: root }] }, channel);
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control/flows/settings?dir=${encodeURIComponent(root)}`);
        return [response.status, ((await response.json()) as { error?: { code: string } }).error?.code ?? "ok"];
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    };
    // mutation: serve ?dir= on the socket -> 200, red
    expect(await serve("socket", { kind: "agent", client: "cli:claude" })).toEqual([404, "route-not-found"]);
    // mutation: drop the dispatched-run check -> 200, red
    expect(await serve("web", { kind: "agent", client: "cli:claude", dispatchedRun: "run-1" })).toEqual([403, "control-dispatched-run-refused"]);
    expect(await serve("web", { kind: "user", userId: "u1", name: "o", roles: ["owner"] })).toEqual([200, "ok"]);
  });
});
