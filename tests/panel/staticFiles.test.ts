import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOKEN_ANCHOR, loadStaticFiles } from "../../src/panel/staticFiles.js";

describe("static serving (spec section 2.2)", () => {
  let dist: string;
  let outside: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-dist-"));
    dist = join(root, "dist");
    outside = join(root, "secret");
    await mkdir(dist, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "passwd.txt"), "root:x:0:0\n");
    await writeFile(join(dist, "index.html"), `<html><body>${TOKEN_ANCHOR}</body></html>`);
    await writeFile(join(dist, "index.js"), "console.log(1)\n");
    await writeFile(join(dist, "index.css"), "body{}\n");
    await symlink(join(outside, "passwd.txt"), join(dist, "linked.txt"));
  });
  afterEach(async () => {
    await rm(join(dist, ".."), { recursive: true, force: true });
  });

  it("serves a key it has, with a content type derived from the extension", async () => {
    const files = await loadStaticFiles(dist, "t0ken");
    expect(files.get("index.js")?.contentType).toBe("text/javascript; charset=utf-8");
    expect(files.get("index.css")?.contentType).toBe("text/css; charset=utf-8");
    expect(files.get("index.js")?.bytes.toString("utf8")).toBe("console.log(1)\n");
  });

  it("has no key for any traversal spelling, because there is no path to join", async () => {
    const files = await loadStaticFiles(dist, "t0ken");
    // Not "returns 404 for these": the point of the Map is that a traversal is
    // STRUCTURALLY impossible, so what is pinned is the absence of the key.
    // Mutation S-12 replaces the Map with a path join; every one of these then
    // resolves to something.
    for (const spelling of [
      "../../etc/passwd",
      "..%2f..%2fetc%2fpasswd",
      "%2e%2e/",
      "/etc/passwd",
      "./index.js",
      "subdir/index.js",
      "index.js/",
      "nope.js",
    ]) {
      expect(files.get(spelling), spelling).toBeUndefined();
    }
  });

  it("enumerates exactly the flat names it loaded, and no symlinked one", async () => {
    const files = await loadStaticFiles(dist, "t0ken");
    // Deep equality on a sorted list, not "contains": a loader that walked into
    // the symlink would still contain all three real names.
    expect([...files.names].sort()).toEqual(["index.css", "index.html", "index.js"]);
    expect(files.get("linked.txt")).toBeUndefined();
  });

  it("injects the token into index.html in memory, and leaves the anchor nowhere in the output", async () => {
    const files = await loadStaticFiles(dist, "s3cret-token");
    const html = files.indexHtml?.bytes.toString("utf8") ?? "";
    expect(html).toContain("s3cret-token");
    // The anchor has to be consumed. If it survives, a second load would inject
    // twice and the criterion below could not tell one token from two.
    expect(html).not.toContain(TOKEN_ANCHOR);
    expect(html.match(/s3cret-token/g)).toHaveLength(1);
    expect(files.indexHtml?.contentType).toBe("text/html; charset=utf-8");
  });

  it("says so by name when web/dist has not been built, instead of serving nothing quietly", async () => {
    await expect(loadStaticFiles(join(dist, "does-not-exist"), "t0ken")).rejects.toMatchObject({
      code: "panel-dist-missing",
    });
  });

  // --- F3: three more branches, each with a criterion only it can fail. ---

  it("F3.1 rejects by name when index.html exists without the token anchor", async () => {
    // The brief's loadStaticFiles implements this refusal but the brief pins
    // nothing on it -- deleting the throw (mutation S-15) would fall through
    // silently and every request the anchor-less page makes would answer 401.
    await writeFile(join(dist, "index.html"), "<html><body>no anchor here</body></html>");
    await expect(loadStaticFiles(dist, "t0ken")).rejects.toMatchObject({
      code: "panel-token-anchor-missing",
    });
  });

  it("F3.2 does not relabel a non-ENOENT readdir failure as panel-dist-missing", async () => {
    // Point distDir at a regular FILE, not a directory. Measured on this
    // machine (node v22.13.1, darwin): readdir on a plain file rejects with
    // ENOTDIR, not ENOENT -- asserted as the actual errno, not a guess, so a
    // future node renaming the errno would be visible here rather than
    // silently passing. Deleting the `code !== "ENOENT"` rethrow (mutation
    // S-17) would relabel this as "run the build first", which is false: the
    // build ran, something else is broken.
    const regularFile = join(dist, "not-a-directory");
    await writeFile(regularFile, "just a file\n");
    const failure: unknown = await loadStaticFiles(regularFile, "t0ken").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as { code?: string }).code).not.toBe("panel-dist-missing");
    expect((failure as NodeJS.ErrnoException).code).toBe("ENOTDIR");
  });

  it("F3.3 never guesses a content type for an extension it does not know", async () => {
    // Scoped to this criterion's own dist (not the shared beforeEach fixture),
    // so the sorted-names and traversal criteria above are untouched by it.
    await writeFile(join(dist, "notes.txt"), "plain text\n");
    const files = await loadStaticFiles(dist, "t0ken");
    // Mutation S-18 turns the fallback into text/html; that would let an
    // unknown upload be rendered as a page instead of downloaded as data --
    // the one class of bug contentTypeOf's fallback exists to foreclose.
    expect(files.get("notes.txt")?.contentType).toBe("application/octet-stream");
  });
});
