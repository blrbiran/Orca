import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PanelRejection } from "./rejection.js";

export const TOKEN_ANCHOR = "<!-- orca-panel-token -->";

export interface StaticAsset {
  bytes: Buffer;
  contentType: string;
}

export interface StaticFiles {
  get(name: string): StaticAsset | undefined;
  readonly indexHtml: StaticAsset | undefined;
  readonly names: readonly string[];
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentTypeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot);
  // Unknown extensions get a type no browser will execute or render. Guessing
  // would be the one place this module could turn a file into script.
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

const defaultDistDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");

/**
 * spec section 2.2. Everything under web/dist is read ONCE into a Map keyed by
 * the exact filename, and requests are answered only by exact key.
 *
 * Why not express.static, now that express is here: it joins paths and follows
 * symbolic links by default, and index.html has to be served from memory
 * anyway because the token is injected into it. Serving statics would then be
 * written in two halves, one of which reintroduces the whole class of
 * normalisation, "..", symlink, content-type and SPA-fallback bugs that this
 * Map makes structurally impossible.
 *
 * withFileTypes + isFile() is what keeps the symlink out: readdir alone would
 * report it as an entry and readFile would follow it straight out of dist.
 */
export async function loadStaticFiles(
  distDir: string | undefined,
  token: string,
): Promise<StaticFiles> {
  const dir = distDir ?? defaultDistDir();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    throw new PanelRejection(
      "panel-dist-missing",
      `orca panel serves ${dir}, which does not exist. Run \`npm run build --workspace web\` first. ` +
        `Serving an empty panel instead would look like a panel with no data in it.`,
    );
  }

  const assets = new Map<string, StaticAsset>();
  for (const entry of entries) {
    // Not isDirectory(): a symbolic link is neither, and isFile() is false for
    // it, so it is skipped without a second check.
    if (!entry.isFile()) continue;
    const bytes = await readFile(join(dir, entry.name));
    assets.set(entry.name, { bytes, contentType: contentTypeOf(entry.name) });
  }

  const index = assets.get("index.html");
  if (index) {
    const html = index.bytes.toString("utf8");
    if (!html.includes(TOKEN_ANCHOR)) {
      throw new PanelRejection(
        "panel-token-anchor-missing",
        `${join(dir, "index.html")} has no ${TOKEN_ANCHOR}. The token is injected there; without ` +
          `the anchor the page would load and every request it makes would answer 401.`,
      );
    }
    assets.set("index.html", {
      bytes: Buffer.from(
        html.replace(TOKEN_ANCHOR, `<script>window.__ORCA_TOKEN__=${JSON.stringify(token)}</script>`),
        "utf8",
      ),
      contentType: "text/html; charset=utf-8",
    });
  }

  return {
    get: (name) => assets.get(name),
    get indexHtml() {
      return assets.get("index.html");
    },
    names: [...assets.keys()],
  };
}
