/**
 * Gaps spec §8.4 (plan Task 10-B): the reads behind the Web's flow start dialog. The templates read lists each built-in
 * with its params in the template's order and types, so the dialog renders one typed field per param. The folder-image
 * read offers exactly the images a start would accept and see: the run's import excludes apply (the vault defaults, the
 * template's `workspace.excludes`, the folder's own `.gitignore`), a link is never offered (a start refuses one), a
 * name a start refuses (a quote) is not offered, and the list is bounded at 200 -- saying when it was cut, so the
 * person knows to type the path of a file past the bound.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { FOLDER_IMAGE_LIMIT, listFolderImages, readBuiltinTemplates } from "../../src/flow/startForm.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { openControlStore } from "../../src/control/store.js";

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
    expect((await listFolderImages(dir, [], 205)).truncated).toBe(false);
  });

  it("writes nothing into the folder and refuses a path that is not a folder", async () => {
    const dir = tempRoot();
    put(dir, "a.png");
    await listFolderImages(dir, []);
    expect((await listFolderImages(dir, [])).files).toEqual(["a.png"]);
    await expect(listFolderImages(join(dir, "a.png"), [])).rejects.toThrow();
    await expect(listFolderImages(join(dir, "missing"), [])).rejects.toThrow();
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
    expect(await get(`/api/control/flows/images?dir=${encodeURIComponent(dir)}&template=no-such`)).toMatchObject({ status: 422, body: { error: { code: "flow-template-invalid" } } });
    expect(await get(`/api/control/flows/images?dir=${encodeURIComponent(join(dir, "covers/one.png"))}&template=wechat-article`)).toMatchObject({ status: 400, body: { error: { code: "query-invalid" } } });
  });
});
